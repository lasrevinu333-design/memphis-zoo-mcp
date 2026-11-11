import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {validateBackupLedgerDeclarationV2} from './backup-ledger-binding-v2.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex');
// This cheap, read-only check is NOT capture approval. The source bytes, complete
// catalog and runtime contract must still pass the existing binding afterwards.
export function assertBackupSchemaBoundary({projectRef,releaseIdentity,migrationLedger,declaration:d}) {
 const details={stage:'source-preflight',expected_ledger_count:d?.observed_ledger_count,
  observed_ledger_count:Array.isArray(migrationLedger)?migrationLedger.length:null,
  expected_ledger_head:d?.observed_ledger_head,
  observed_ledger_head:Array.isArray(migrationLedger)&&typeof migrationLedger.at(-1)?.version==='string'?migrationLedger.at(-1).version:null};
 const fail=(code,message)=>Object.assign(new Error(message),{code,details,retryable:false});
 if(!['custodial.backup-schema-extension-declaration.v1','custodial.backup-schema-extension-declaration.v2'].includes(d?.schema))
  throw fail('BACKUP_SOURCE_CONTRACT_UNSUPPORTED','Backup source-preflight refused an unsupported declaration version.');
 if(d.schema.endsWith('.v2')&&d.activation_status!=='active')
  throw fail('BACKUP_SOURCE_CONTRACT_INACTIVE','Backup source-preflight refused the inactive v2 candidate declaration.');
 if(details.expected_ledger_count!==details.observed_ledger_count||details.expected_ledger_head!==details.observed_ledger_head)
  throw fail('BACKUP_SOURCE_CONTRACT_MISMATCH',`Backup source-preflight contract mismatch: expected ${details.expected_ledger_count} migrations through ${details.expected_ledger_head}; observed ${details.observed_ledger_count} through ${details.observed_ledger_head}. Qualify the complete installed ledger, SQL sources, catalog, and runtime contract before updating the declaration.`);
 try {
  assert.equal(d.project_ref,projectRef);assert.equal(d.production_mutation_authorized,false);
  assert.ok(Array.isArray(migrationLedger)&&migrationLedger.length>0);
  let previous='';for(const row of migrationLedger){assert.equal(typeof row.version,'string');assert.match(row.version,/^[0-9]{14}$/);assert.ok(row.version>previous);previous=row.version;}
  for(const [key,value]of Object.entries(d.deployed_release))assert.equal(releaseIdentity?.[key],value);
  if(d.schema.endsWith('.v2')){
   validateBackupLedgerDeclarationV2(d);
   const actual=migrationLedger.map(row=>{assert.ok(Array.isArray(row.statements)&&row.statements.length>0);for(let i=0;i<row.statements.length;i++){assert.ok(Object.hasOwn(row.statements,i));assert.equal(typeof row.statements[i],'string');}return{version:row.version,name:row.name,statement_sha256:row.statements.map(sha)};});
   assert.deepEqual(actual,d.ledger);
  }else{
   assert.equal(d.observed_ledger_count,235);assert.equal(d.observed_ledger_head,'20261021111917');
   const extension=migrationLedger.filter(row=>row.version>releaseIdentity.migration_head);
   assert.ok(Array.isArray(d.extensions)&&d.extensions.length>0&&d.extensions.length<=10);assert.equal(extension.length,d.extensions.length);
   extension.forEach((row,i)=>{const expected=d.extensions[i];assert.equal(row.version,expected.ledger_version);assert.equal(row.name,expected.ledger_name);assert.ok(Array.isArray(row.statements)&&row.statements.length===1);assert.equal(typeof row.statements[0],'string');assert.equal(sha(row.statements[0]),expected.sql_sha256);});
  }
 }catch{
  // Never include assertions' actual values, SQL, credentials or connection text.
  throw fail('BACKUP_SOURCE_CONTRACT_MISMATCH',`Backup source-preflight refused changed ledger, source or identity metadata at ${details.observed_ledger_count} migrations through ${details.observed_ledger_head}. Expected ${details.expected_ledger_count} through ${details.expected_ledger_head}; full qualification is required.`);
 }
 return true;
}
