import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fingerprintSchemaCatalog} from './schema-fingerprint-catalog.mjs';
const HASH=/^[a-f0-9]{64}$/;
const VERSION=/^[0-9]{14}$/;
const FILE=/^[0-9]{14}_[a-z][a-z0-9_]*\.sql$/;
const RELEASE_KEYS=['release_id','backend_commit','frontend_commit','migration_head','migration_manifest_sha256'];
const sha=value=>createHash('sha256').update(value).digest('hex');
// Canonical encoding is UTF-8 JSON of arrays, never locale sorting or object-key order.
export function ledgerMetadataDigest(rows){return sha(JSON.stringify(rows.map(r=>[r.version,r.name,r.statement_sha256])));}
export function sourceBindingsDigest(rows){return sha(JSON.stringify(rows.map(r=>[r.ledger_version,r.ledger_name,r.statement_index,r.source_location,r.source_file,r.sql_sha256])));}
export function baselineMembershipDigest(rows){return sha(JSON.stringify(rows.map(r=>[r.version,r.name])));}
function exactKeys(object,keys,label){assert.ok(object&&typeof object==='object'&&!Array.isArray(object),label);assert.deepEqual(Object.keys(object).sort(),[...keys].sort(),label);}
function validateRows(rows,{hashed}){
 assert.ok(Array.isArray(rows)&&rows.length===419,'Exact reviewed 419-row boundary required');
 let previous='';
 for(const row of rows){
  assert.ok(row&&typeof row==='object');assert.equal(typeof row.version,'string');assert.match(row.version,VERSION);assert.ok(row.version>previous,'Ledger order or duplicate version');previous=row.version;
  assert.ok(typeof row.name==='string'&&row.name.length>0&&row.name.length<=512,'Ledger name required');
  const values=hashed?row.statement_sha256:row.statements;
  assert.ok(Array.isArray(values)&&values.length>0,'Nonempty statement array required');
  for(let i=0;i<values.length;i++){assert.ok(Object.hasOwn(values,i),'Sparse statement arrays forbidden');assert.equal(typeof values[i],'string');if(hashed)assert.match(values[i],HASH);}
  if(hashed)exactKeys(row,['version','name','statement_sha256'],'Metadata row fields');
 }
 return rows.map(r=>({version:r.version,name:r.name,statement_sha256:hashed?[...r.statement_sha256]:r.statements.map(sha)}));
}
function validateContract(d){
 assert.equal(d.schema,'custodial.backup-schema-extension-declaration.v2');
 assert.equal(d.application_upgrade_claimed,false);assert.equal(d.production_mutation_authorized,false);
 assert.ok(['candidate','active'].includes(d.activation_status),'Unknown activation state');
 assert.equal(d.observed_ledger_count,419);assert.equal(d.observed_ledger_head,'20261111161430');
 assert.match(d.project_ref,/^[a-z]{20}$/);exactKeys(d.deployed_release,RELEASE_KEYS,'Complete deployed release tuple required');
 assert.ok(typeof d.deployed_release.release_id==='string'&&d.deployed_release.release_id.length>0);
 for(const key of ['backend_commit','frontend_commit'])assert.match(d.deployed_release[key],/^[a-f0-9]{40}$/);
 assert.match(d.deployed_release.migration_head,VERSION);assert.match(d.deployed_release.migration_manifest_sha256,HASH);
 const rows=validateRows(d.ledger,{hashed:true});assert.equal(rows.at(-1).version,d.observed_ledger_head);
 assert.match(d.ledger_sha256,HASH);assert.equal(ledgerMetadataDigest(rows),d.ledger_sha256,'Declared ledger digest changed');
 assert.ok(Array.isArray(d.historical_baseline)&&d.historical_baseline.length===235,'Historical membership must contain exactly 235 rows');
 let previous='';const historical=new Set();const byVersion=new Map(rows.map(r=>[r.version,r]));
 for(const r of d.historical_baseline){exactKeys(r,['version','name'],'Historical member fields');assert.match(r.version,VERSION);assert.ok(r.version>previous);previous=r.version;assert.equal(byVersion.get(r.version)?.name,r.name);historical.add(r.version);}
 assert.match(d.historical_membership_sha256,HASH);assert.equal(baselineMembershipDigest(d.historical_baseline),d.historical_membership_sha256);
 assert.equal(d.historical_membership_sha256,'2fe465338697f3addf6f70cbecc6b3be91c1d976bc1ebaaa5efaf5535dacf3e2','Historical membership is immutable');
 assert.equal(d.historical_baseline_basis,'observed_statement_hashes_not_source_approval');
 assert.match(d.observed_catalog_fingerprint,HASH);
 assert.ok(Array.isArray(d.source_bindings));assert.match(d.source_bindings_sha256,HASH);assert.equal(sourceBindingsDigest(d.source_bindings),d.source_bindings_sha256,'Source binding digest changed');
 assert.equal(d.source_bindings_sha256,'b60e5202381672db119525d19f623e56f89074f08bb61dc7b7a9f9733d120db6','Exact reviewed source bindings required');
 const required=new Set(rows.filter(r=>!historical.has(r.version)).map(r=>r.version));assert.equal(required.size,184);
 assert.ok(Array.isArray(d.original_v1_extensions)&&d.original_v1_extensions.length===5);
 for(const s of d.original_v1_extensions){assert.ok(historical.has(s.ledger_version));required.add(s.ledger_version);}
 const covered=new Set();let last='';
 for(const s of d.source_bindings){
  exactKeys(s,['ledger_version','ledger_name','statement_index','source_location','source_file','sql_sha256'],'Source binding fields');
  assert.match(s.ledger_version,VERSION);assert.equal(s.source_location,'retained_installed');assert.match(s.source_file,FILE);assert.match(s.sql_sha256,HASH);
  assert.ok(Number.isSafeInteger(s.statement_index)&&s.statement_index>=0);
  const key=s.ledger_version+':'+String(s.statement_index).padStart(8,'0');assert.ok(key>last,'Source binding order or duplicate');last=key;
  const row=byVersion.get(s.ledger_version);assert.ok(row);assert.equal(s.ledger_name,row.name);assert.equal(s.sql_sha256,row.statement_sha256[s.statement_index]);assert.ok(required.has(s.ledger_version));covered.add(key);
 }
 for(const version of required){const row=byVersion.get(version);row.statement_sha256.forEach((_,i)=>assert.ok(covered.has(version+':'+String(i).padStart(8,'0')),'Every added statement and original v1 source is required'));}
 for(const s of d.original_v1_extensions){const match=d.source_bindings.find(b=>b.ledger_version===s.ledger_version&&b.statement_index===0);assert.ok(match);for(const k of ['ledger_name','source_file','source_location','sql_sha256'])assert.equal(match[k],s[k],'Original v1 source binding changed');assert.equal(byVersion.get(s.ledger_version).statement_sha256.length,1);}
 return rows;
}
export function validateBackupLedgerDeclarationV2(declaration){validateContract(declaration);return true;}
export function bindBackupLedgerV2({projectRef,releaseIdentity,migrationLedger,catalog,declaration:d,readSource}){
 const expected=validateContract(d);assert.equal(d.activation_status,'active','Candidate declaration is not active');
 assert.equal(projectRef,d.project_ref);for(const key of RELEASE_KEYS)assert.equal(releaseIdentity?.[key],d.deployed_release[key],`Unexpected deployed identity: ${key}`);
 const actual=validateRows(migrationLedger,{hashed:false});assert.deepEqual(actual,expected,'Full ledger differs from reviewed exact boundary');
 assert.equal(ledgerMetadataDigest(actual),d.ledger_sha256);
 for(const s of d.source_bindings)assert.equal(sha(readSource(s.source_file,s.source_location)),s.sql_sha256,'Retained source bytes changed');
 assert.equal(fingerprintSchemaCatalog(catalog).fingerprint,d.observed_catalog_fingerprint,'Undeclared database schema or privilege drift');
 return Object.freeze({schema:'custodial.backup-schema-extension.v2',mode:'exact_full_ledger_observed_boundary',project_ref:projectRef,
  runtime_release_id:releaseIdentity.release_id,runtime_backend_commit:releaseIdentity.backend_commit,runtime_frontend_commit:releaseIdentity.frontend_commit,
  runtime_migration_head:releaseIdentity.migration_head,runtime_migration_manifest_sha256:releaseIdentity.migration_manifest_sha256,
  captured_migration_head:d.observed_ledger_head,captured_ledger_count:actual.length,catalog_fingerprint:d.observed_catalog_fingerprint,
  ledger_sha256:d.ledger_sha256,ledger_contract:structuredClone(d),application_upgrade_claimed:false,production_mutation_authorized:false});
}
export function verifyArchivedLedgerV2({summary,binding:b,catalog,ledger}){
 assert.equal(b?.schema,'custodial.backup-schema-extension.v2');assert.equal(b.mode,'exact_full_ledger_observed_boundary');
 assert.equal(b.application_upgrade_claimed,false);assert.equal(b.production_mutation_authorized,false);
 const d=b.ledger_contract;const expected=validateContract(d);assert.equal(d.activation_status,'active');assert.equal(b.project_ref,d.project_ref);assert.equal(b.project_ref,summary.project_ref);
 const mapping={release_id:'runtime_release_id',backend_commit:'runtime_backend_commit',frontend_commit:'runtime_frontend_commit',migration_head:'runtime_migration_head',migration_manifest_sha256:'runtime_migration_manifest_sha256'};
 for(const key of RELEASE_KEYS){assert.equal(b[mapping[key]],d.deployed_release[key]);assert.equal(b[mapping[key]],summary.source_identity.release[key]);}
 assert.equal(b.captured_migration_head,d.observed_ledger_head);assert.equal(b.captured_migration_head,summary.source_identity.migration_head);
 assert.equal(b.captured_ledger_count,d.observed_ledger_count);assert.equal(b.captured_ledger_count,summary.source_identity.migration_ledger_count);
 assert.equal(b.catalog_fingerprint,d.observed_catalog_fingerprint);assert.equal(fingerprintSchemaCatalog(catalog).fingerprint,b.catalog_fingerprint);
 const actual=validateRows(ledger,{hashed:false});assert.deepEqual(actual,expected,'Archived ledger statement hashes differ');assert.equal(b.ledger_sha256,d.ledger_sha256);assert.equal(ledgerMetadataDigest(actual),b.ledger_sha256);
 return true;
}
