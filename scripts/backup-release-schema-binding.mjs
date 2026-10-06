import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fingerprintSchemaCatalog} from './schema-fingerprint-catalog.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex');
const HASH=/^[a-f0-9]{64}$/;

// A backup must not fabricate a new deployed application identity just because
// separately authorized schema changes were installed first. This exception is
// finite and source-bound: unknown migration, changed bytes or schema drift is
// still a refusal. It grants no production mutation or restore authority.
export function bindBackupSchemaExtension({projectRef,releaseIdentity,migrationLedger,catalog,declaration,readSource}) {
 assert.equal(declaration?.schema,'custodial.backup-schema-extension-declaration.v1');
 assert.equal(declaration.production_mutation_authorized,false);
 assert.equal(declaration.project_ref,projectRef);
 assert.ok(Array.isArray(migrationLedger)&&migrationLedger.length===declaration.observed_ledger_count);
 let previous='';for(const row of migrationLedger){assert.match(row.version,/^[0-9]{14}$/);assert.ok(row.version>previous);previous=row.version;}
 for(const [key,value]of Object.entries(declaration.deployed_release))assert.equal(releaseIdentity?.[key],value,`Unexpected deployed identity: ${key}`);
 assert.equal(migrationLedger.at(-1).version,declaration.observed_ledger_head);
 const extension=migrationLedger.filter(row=>row.version>releaseIdentity.migration_head);
 assert.ok(Array.isArray(declaration.extensions)&&declaration.extensions.length>0&&declaration.extensions.length<=10);
 assert.equal(extension.length,declaration.extensions.length,'Only the declared post-release schema changes may differ');
 const observed=[];
 for(let i=0;i<extension.length;i++){
  const row=extension[i],expected=declaration.extensions[i];
  assert.equal(row.version,expected.ledger_version);assert.equal(row.name,expected.ledger_name);
  assert.ok(Array.isArray(row.statements)&&row.statements.length===1&&typeof row.statements[0]==='string');
  assert.match(expected.source_file,/^[0-9]{14}_[a-z][a-z0-9_]*\.sql$/);assert.match(expected.sql_sha256,HASH);
  const bytes=readSource(expected.source_file);assert.equal(sha(bytes),expected.sql_sha256,'Declared source bytes changed');
  assert.equal(sha(row.statements[0]),expected.sql_sha256,'Installed schema statement differs from source');
  observed.push({...expected});
 }
 assert.match(declaration.observed_catalog_fingerprint,HASH);
 const actual=fingerprintSchemaCatalog(catalog).fingerprint;
 assert.equal(actual,declaration.observed_catalog_fingerprint,'Undeclared database schema or privilege drift');
 return Object.freeze({schema:'custodial.backup-schema-extension.v1',mode:'exact_schema_ahead_of_deployed_app',
  project_ref:projectRef,runtime_release_id:releaseIdentity.release_id,runtime_backend_commit:releaseIdentity.backend_commit,
  runtime_frontend_commit:releaseIdentity.frontend_commit,runtime_migration_head:releaseIdentity.migration_head,
  captured_migration_head:declaration.observed_ledger_head,captured_ledger_count:migrationLedger.length,
  catalog_fingerprint:actual,extensions:observed,application_upgrade_claimed:false,production_mutation_authorized:false});
}

export function verifyArchivedSchemaExtension({summary,binding,catalog,ledger}) {
 assert.equal(binding?.schema,'custodial.backup-schema-extension.v1');assert.equal(binding.mode,'exact_schema_ahead_of_deployed_app');
 assert.equal(binding.application_upgrade_claimed,false);assert.equal(binding.production_mutation_authorized,false);
 assert.equal(binding.project_ref,summary.project_ref);
 assert.equal(binding.runtime_release_id,summary.source_identity.release.release_id);
 assert.equal(binding.runtime_backend_commit,summary.source_identity.release.backend_commit);
 assert.equal(binding.runtime_frontend_commit,summary.source_identity.release.frontend_commit);
 assert.equal(binding.runtime_migration_head,summary.source_identity.release.migration_head);
 assert.equal(binding.captured_migration_head,summary.source_identity.migration_head);
 assert.equal(binding.captured_ledger_count,summary.source_identity.migration_ledger_count);
 assert.equal(ledger.length,binding.captured_ledger_count);
 assert.equal(fingerprintSchemaCatalog(catalog).fingerprint,binding.catalog_fingerprint);
 const extension=ledger.filter(row=>row.version>binding.runtime_migration_head);
 assert.ok(Array.isArray(binding.extensions)&&binding.extensions.length>0&&binding.extensions.length<=10);
 assert.equal(extension.length,binding.extensions.length);
 for(let i=0;i<extension.length;i++){
  assert.equal(extension[i].version,binding.extensions[i].ledger_version);
  assert.equal(extension[i].name,binding.extensions[i].ledger_name);
  assert.ok(Array.isArray(extension[i].statements)&&extension[i].statements.length===1);
  assert.equal(sha(extension[i].statements[0]),binding.extensions[i].sql_sha256);
 }
 return true;
}
