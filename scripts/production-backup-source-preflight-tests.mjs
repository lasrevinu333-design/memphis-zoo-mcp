import {createHash} from 'node:crypto';
import {ledgerMetadataDigest} from './backup-ledger-binding-v2.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import * as schemaBinding from './backup-release-schema-binding.mjs';
import {assertBackupSchemaBoundary} from './backup-source-preflight.mjs';
import {productionBackupSnapshotStatements} from './production-backup-pg-dump-command.mjs';
import {readProductionBackupOriginalRelease} from './production-backup-original-metadata.mjs';
import {SCHEMA_CATALOG_QUERIES,fingerprintSchemaCatalog} from './schema-fingerprint-catalog.mjs';

// Execute the shipping snapshot's source-admission block. Only I/O is recorded;
// no database, pg_dump, artifact, signing key, or production workflow is used.
const source=readFileSync(new URL('./production-backup.mjs',import.meta.url),'utf8');
const start=source.indexOf('const endBackupClient =');
const end=source.indexOf('  const namespaceResult =',start);
assert.ok(start>=0&&end>start);
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const execute=new AsyncFunction('io',`
 const {client,Client,captureBackupExporterIdentity,productionBackupSnapshotStatements,projectRef,captureApplicationSchema,captureCatalogFromSnapshot,
 readFileSync,bindBackupSchemaExtension,assertBackupSchemaBoundary,
 readProductionBackupOriginalRelease,loadRecoveryRuntimeContract,
 validateRecoveryRuntimeConfiguration,writeJson,join}=io;
 const backupDir='/synthetic-backup',runtimeContractPath='/synthetic-contract',runtimeConfigurationInput='{}';
 let backupExporterIdentity,applicationSchemaSections,snapshot,migrationHead,migrationLedger,cronJobs,extensionInventory,releaseIdentity,sourceSchemaBinding;
 const backupNativeTextOutputStatements=[];
 ${source.slice(start,end).replaceAll('import.meta.url',JSON.stringify(import.meta.url))}
 finishBackupArtifacts=async()=>{};
 ${source.slice(source.indexOf('} catch (error) {\n  backupLifecycleFailed = true;')).replaceAll('import.meta.url',JSON.stringify(import.meta.url))}
 return {applicationSchemaSections,migrationHead,migrationLedger,sourceSchemaBinding};
`);
const original=JSON.parse(readFileSync(new URL('../release/production-backup-source-extension.json',import.meta.url),'utf8'));
const catalog=Object.fromEntries(Object.keys(SCHEMA_CATALOG_QUERIES).map(key=>[key,[]]));
const readSource=(file,location)=>readFileSync(new URL((location==='retained_installed'?'../release/installed-source/':'../supabase/migrations/')+file,import.meta.url));
function fixture(){
 const declaration=structuredClone(original);
 declaration.observed_catalog_fingerprint=fingerprintSchemaCatalog(catalog).fingerprint;
 const ledger=Array.from({length:229},(_,i)=>({version:String(10000000000000+i),name:'synthetic_history',statements:['select 1;']}));
 ledger.push({version:declaration.deployed_release.migration_head,name:'synthetic_release',statements:['select 1;']});
 ledger.push(...declaration.extensions.map(r=>({version:r.ledger_version,name:r.ledger_name,statements:[readSource(r.source_file,r.source_location).toString('utf8')]})));
 return {declaration,ledger,catalog:structuredClone(catalog),release:{...declaration.deployed_release,status:'deployed'},releaseCount:1};
}
async function run(change=()=>{}){
 const f=fixture();change(f);const events=[];
 const select=rows=>({command:'SELECT',rowCount:rows.length,rows});
 const io={projectRef:original.project_ref,join,...schemaBinding,assertBackupSchemaBoundary,readProductionBackupOriginalRelease,productionBackupSnapshotStatements,Client:{prototype:{end:async()=>{events.push('close');}}},
  client:{async connect(){events.push('connect');},async query(sql){
   if(sql==='rollback'){events.push('rollback');return select([]);}
   if(productionBackupSnapshotStatements.includes(sql)){events.push(sql);return select([]);}
   if(sql.includes('pg_export_snapshot()')){events.push('snapshot');return select([{exported_snapshot:'synthetic-snapshot'}]);}
   if(sql.includes('current_database()'))return select([{schema_export_snapshot:'synthetic-snapshot'}]);
   if(sql.includes('select max(version)'))return select([{migration_head:f.ledger.at(-1)?.version}]);
   if(sql.includes('from supabase_migrations.schema_migrations')){events.push('ledger');return select(f.ledger);}
   if(sql.includes('from public.release_deployment_manifest')){events.push('release');return select(Array.from({length:f.releaseCount},()=>({original_row:JSON.stringify(f.release)})));}
   if(sql.includes('from cron.job')||sql.includes('from pg_extension'))return select([]);
   throw Error('Unexpected source-preflight query');
  }},
  async captureBackupExporterIdentity(){return Object.freeze({backend_pid:23,virtualxid:'3/4'});},
  async captureApplicationSchema(snapshot){assert.equal(snapshot,'synthetic-snapshot');events.push('pg_dump');return ['synthetic-schema'];},
  async captureCatalogFromSnapshot(){events.push('catalog');return f.catalog;},
  readFileSync(url){if(String(url).endsWith('/production-backup-source-extension-v2.active.json'))return JSON.stringify(f.declaration);return readFileSync(url);},
  loadRecoveryRuntimeContract(){return {};},
  validateRecoveryRuntimeConfiguration(){events.push('runtime-contract');if(f.runtimeFailure)throw f.runtimeFailure;return {};},
  writeJson(){events.push('inventory-write');}
 };
 try{return {events,result:await execute(io),fixture:f};}catch(error){return {events,error,fixture:f};}
}
test('stale source declaration refuses before catalog capture, pg_dump, and inventory writes',async()=>{
 const r=await run(f=>f.ledger.push({version:'20261110081920',name:'synthetic_later_migration',statements:['select 2;']}));
 assert.equal(r.error?.code,'BACKUP_SOURCE_CONTRACT_MISMATCH');
 assert.deepEqual(r.error.details,{stage:'source-preflight',expected_ledger_count:235,observed_ledger_count:236,expected_ledger_head:'20261021111917',observed_ledger_head:'20261110081920'});
 for(const name of ['catalog','pg_dump','inventory-write'])assert.equal(r.events.includes(name),false,name);
 assert.equal(JSON.stringify(r.error.details).includes('select 2;'),false);
});
test('same count with a different head is equally stale',async()=>{
 const r=await run(f=>f.ledger.at(-1).version='20261110081920');
 assert.equal(r.error?.code,'BACKUP_SOURCE_CONTRACT_MISMATCH');assert.equal(r.events.includes('catalog'),false);assert.equal(r.events.includes('pg_dump'),false);
});
for(const [name,change]of [
 ['changed installed SQL',f=>f.ledger.at(-1).statements[0]+='\nselect 999;'],
 ['changed catalog privileges',f=>f.catalog.routine_grants.push({grantee:'anon',privilege_type:'EXECUTE'})],
 ['changed runtime identity',f=>f.release.backend_commit='f'.repeat(40)],
 ['duplicate ledger row',f=>f.ledger[1].version=f.ledger[0].version],
 ['wrong project',f=>f.declaration.project_ref='a'.repeat(20)],
 ['multiple deployed releases',f=>f.releaseCount=2],
 ['no deployed release',f=>f.releaseCount=0],
 ['runtime configuration refusal',f=>f.runtimeFailure=Error('synthetic runtime mismatch')]
])test(`${name} still refuses before pg_dump`,async()=>{const r=await run(change);assert.ok(r.error);assert.equal(r.events.includes('pg_dump'),false);});
test('qualified historical contract keeps the same snapshot and full source binding',async()=>{
 const r=await run();assert.ifError(r.error);assert.deepEqual(r.result.applicationSchemaSections,['synthetic-schema']);
 assert.equal(r.events.filter(x=>x==='snapshot').length,1);assert.equal(r.events.filter(x=>x==='pg_dump').length,1);
 assert.ok(r.events.indexOf('runtime-contract')<r.events.indexOf('pg_dump'));
 assert.equal(r.result.sourceSchemaBinding.application_upgrade_claimed,false);
 assert.equal(r.result.sourceSchemaBinding.production_mutation_authorized,false);
 assert.equal(schemaBinding.verifyArchivedSchemaExtension({binding:r.result.sourceSchemaBinding,catalog:r.fixture.catalog,ledger:r.fixture.ledger,
  summary:{project_ref:original.project_ref,source_identity:{release:r.fixture.release,migration_head:r.result.migrationHead,migration_ledger_count:r.fixture.ledger.length}}}),true);
});
test('matching deployed head cannot bypass historical identity qualification',async()=>{
 const r=await run(f=>f.release.migration_head=f.ledger.at(-1).version);
 assert.equal(r.error?.code,'BACKUP_SOURCE_CONTRACT_MISMATCH');assert.equal(r.error.retryable,false);
 assert.equal(r.events.includes('catalog'),false);assert.equal(r.events.includes('pg_dump'),false);
 assert.deepEqual(r.events.slice(-2),['rollback','close']);
});

test('permanent preflight drift rolls back and closes once with no retry or expensive capture',async()=>{
 const r=await run(f=>f.ledger.push({version:'20261111161430',name:'later',statements:['private SQL must not appear']}));
 assert.equal(r.error.code,'BACKUP_SOURCE_CONTRACT_MISMATCH');assert.equal(r.error.retryable,false);assert.equal(r.error.details.stage,'source-preflight');
 assert.deepEqual(r.events.slice(-2),['rollback','close']);
 for(const event of ['connect','snapshot','ledger','release','rollback','close'])assert.equal(r.events.filter(e=>e===event).length,1,event);
 assert.ok(r.events.indexOf(productionBackupSnapshotStatements[0])<r.events.indexOf('snapshot'));
 assert.ok(r.events.indexOf('snapshot')<r.events.indexOf('ledger'));assert.ok(r.events.indexOf('snapshot')<r.events.indexOf('release'));
 assert.equal(r.events.includes('catalog'),false);assert.equal(r.events.includes('pg_dump'),false);
 assert.equal(String(r.error.stack).includes('private SQL'),false);
});
const v2=JSON.parse(readFileSync(new URL('../release/production-backup-source-extension-v2.candidate.json',import.meta.url),'utf8'));
function v2Fixture(f){
 f.declaration=structuredClone(v2);f.release={...v2.deployed_release,status:'deployed'};
 f.ledger=v2.ledger.map(r=>({version:r.version,name:r.name,statements:r.statement_sha256.map(()=> 'synthetic historical statement, not production capture')}));
}
test('v2 candidate remains inactive before catalog and pg_dump',async()=>{
 const r=await run(v2Fixture);assert.equal(r.error.code,'BACKUP_SOURCE_CONTRACT_INACTIVE');assert.equal(r.error.details.expected_ledger_count,419);assert.equal(r.error.details.observed_ledger_count,419);assert.equal(r.error.retryable,false);
 assert.deepEqual(r.events.slice(-2),['rollback','close']);assert.equal(r.events.includes('catalog'),false);assert.equal(r.events.includes('pg_dump'),false);
});
test('v2 unknown future ledger drift reports exact boundary without retry',async()=>{
 const r=await run(f=>{v2Fixture(f);f.declaration.activation_status='active';f.ledger.push({version:'20261111161431',name:'unknown',statements:['select secret_literal']});});
 assert.equal(r.error.code,'BACKUP_SOURCE_CONTRACT_MISMATCH');assert.deepEqual(r.error.details,{stage:'source-preflight',expected_ledger_count:419,observed_ledger_count:420,expected_ledger_head:'20261111161430',observed_ledger_head:'20261111161431'});
 assert.equal(r.events.filter(e=>e==='ledger').length,1);assert.deepEqual(r.events.slice(-2),['rollback','close']);assert.equal(r.events.includes('catalog'),false);assert.equal(r.events.includes('pg_dump'),false);assert.equal(r.error.retryable,false);
});
test('v2 same-boundary rewritten historical bytes fail before catalog',async()=>{
 const r=await run(f=>{v2Fixture(f);f.declaration.activation_status='active';});
 assert.equal(r.error.code,'BACKUP_SOURCE_CONTRACT_MISMATCH');assert.equal(r.error.details.expected_ledger_count,419);assert.equal(r.error.details.observed_ledger_count,419);assert.equal(r.events.includes('catalog'),false);assert.equal(r.events.includes('pg_dump'),false);assert.deepEqual(r.events.slice(-2),['rollback','close']);
});
test('active selector is reviewed v2 and v1 declaration remains historical 235',()=>{
 assert.equal(original.observed_ledger_count,235);assert.equal(original.observed_ledger_head,'20261021111917');assert.equal(original.schema,'custodial.backup-schema-extension-declaration.v1');
 assert.equal(source.includes('production-backup-source-extension-v2.candidate.json'),false);
 assert.equal(source.includes('../release/production-backup-source-extension-v2.active.json'),true);
 assert.equal((source.match(/from supabase_migrations\.schema_migrations/g)||[]).length,1,'one ledger query; head derived from its same-snapshot rows');
 assert.equal((source.match(/from public\.release_deployment_manifest r/g)||[]).length,1,'one release query');
});
test('current 419-row observation against historical v1 gives the exact actionable mismatch',async()=>{
 const r=await run(f=>{const declared=f.declaration;v2Fixture(f);f.declaration=declared;});
 assert.equal(r.error.code,'BACKUP_SOURCE_CONTRACT_MISMATCH');assert.deepEqual(r.error.details,{stage:'source-preflight',expected_ledger_count:235,observed_ledger_count:419,expected_ledger_head:'20261021111917',observed_ledger_head:'20261111161430'});assert.match(r.error.message,/Qualify the complete installed ledger/);assert.deepEqual(r.events.slice(-2),['rollback','close']);assert.equal(r.events.includes('catalog'),false);assert.equal(r.events.includes('pg_dump'),false);
});
test('reviewed active v2 path completes full synthetic source binding in one snapshot before pg_dump',async()=>{
 const r=await run(f=>{
  f.declaration=JSON.parse(readFileSync(new URL('../release/production-backup-source-extension-v2.active.json',import.meta.url),'utf8'));
  f.release={...f.declaration.deployed_release,status:'deployed'};
  // Retained installed statements are exact; unavailable historical strings are
  // synthetic fixture data. Rehash only this in-memory fixture, not release files.
  f.ledger=f.declaration.ledger.map(row=>({version:row.version,name:row.name,statements:row.statement_sha256.map((_,i)=>{
   const s=f.declaration.source_bindings.find(s=>s.ledger_version===row.version&&s.statement_index===i);
   return s?readSource(s.source_file,s.source_location).toString('utf8'):`select '${row.version}:${i}' AS synthetic_historical_fixture;`;
  })}));
  f.declaration.ledger=f.ledger.map(row=>({version:row.version,name:row.name,statement_sha256:row.statements.map(s=>createHash('sha256').update(s).digest('hex'))}));
  f.declaration.ledger_sha256=ledgerMetadataDigest(f.declaration.ledger);f.declaration.observed_catalog_fingerprint=fingerprintSchemaCatalog(f.catalog).fingerprint;
 });
 assert.ifError(r.error);assert.equal(r.result.sourceSchemaBinding.schema,'custodial.backup-schema-extension.v2');
 assert.equal(r.result.sourceSchemaBinding.application_upgrade_claimed,false);assert.equal(r.result.sourceSchemaBinding.production_mutation_authorized,false);
 for(const event of ['snapshot','ledger','release','catalog','pg_dump','rollback','close'])assert.equal(r.events.filter(e=>e===event).length,1,event);
 assert.ok(r.events.indexOf('catalog')<r.events.indexOf('pg_dump'));assert.ok(r.events.indexOf('runtime-contract')<r.events.indexOf('pg_dump'));
 assert.equal(schemaBinding.verifyArchivedSchemaExtension({summary:{project_ref:r.fixture.declaration.project_ref,source_identity:{release:r.fixture.release,migration_head:r.result.migrationHead,migration_ledger_count:r.fixture.ledger.length}},binding:r.result.sourceSchemaBinding,catalog:r.fixture.catalog,ledger:r.fixture.ledger}),true);
});
test('matching v2 deployed head plus changed release cannot bypass selected contract',async()=>{
 const r=await run(f=>{v2Fixture(f);f.declaration.activation_status='active';f.release.migration_head=f.ledger.at(-1).version;f.release.backend_commit='f'.repeat(40);});
 assert.equal(r.error?.code,'BACKUP_SOURCE_CONTRACT_MISMATCH');assert.equal(r.error.details.stage,'source-preflight');assert.equal(r.error.retryable,false);
 assert.equal(r.events.includes('catalog'),false);assert.equal(r.events.includes('pg_dump'),false);assert.deepEqual(r.events.slice(-2),['rollback','close']);
 for(const event of ['ledger','release','rollback','close'])assert.equal(r.events.filter(e=>e===event).length,1);
});
test('extra migration with matching new deployed head still fails before capture and closes snapshot',async()=>{
 const r=await run(f=>{v2Fixture(f);f.declaration.activation_status='active';f.ledger.push({version:'20261111161431',name:'unapproved_next_migration',statements:['select 1;']});f.release.migration_head=f.ledger.at(-1).version;});
 assert.equal(r.error?.code,'BACKUP_SOURCE_CONTRACT_MISMATCH');assert.equal(r.error.retryable,false);
 assert.deepEqual(r.error.details,{stage:'source-preflight',expected_ledger_count:419,observed_ledger_count:420,expected_ledger_head:'20261111161430',observed_ledger_head:'20261111161431'});
 assert.equal(r.events.includes('catalog'),false);assert.equal(r.events.includes('pg_dump'),false);assert.deepEqual(r.events.slice(-2),['rollback','close']);
 for(const event of ['ledger','release','rollback','close'])assert.equal(r.events.filter(e=>e===event).length,1);
});
