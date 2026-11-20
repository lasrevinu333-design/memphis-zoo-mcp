// Finite SOURCE preparation for the current428 backup. This module never
// connects to a target, changes reconciliation, or executes a migration.
import assert from 'node:assert/strict';
import {openSync,closeSync,readFileSync,readdirSync,lstatSync,fstatSync,constants} from 'node:fs';
import {dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {readVerifiedMigrationTargetCaptureSource} from './disaster-recovery-archive.mjs';
import {readVerifiedImmutableArchiveOwnerProfile} from './immutable-private-owner-profile.mjs';
import {sourceBindingsDigest,verifyArchivedLedgerV2} from './backup-ledger-binding-v2.mjs';
import {splitSchemaStatements} from './isolated-event-owner-schema.mjs';
export const CURRENT428_ARCHIVE_DIGEST='241d1cd711d41708d00d3e61334275f0adde07d85d230d2c0d03fa9c5ff86da5';
const ledgerFileDigest='7ee71df7d6e99fbe508721c7e4508fcd4a9f10c02a67f3769fa54d5b6a4077e7';
const ledgerTupleDigest='c0bbf827afc1f73338cbed414b2e83b82e5525802cc1cbef35c219dcc4f9ae14';
const sourceBindingsSha256='a2b3f2eb1b54225a18d9894f9e1a5ef5c597a3343f736cf0d995310a889f33e0';
const historicalManifestSha256='84ac9ee339abf929a2d50c411b0c69b4cb05699f71fa13ee9ddb17606cd5dabe';
const currentTailFixtureSha256='a3d9010f9bd055834daa86e3a993f5103aaf4658ddd6ad0aa142905dcd8ce5f4';
const refs=Object.freeze([
 Object.freeze({file:'20261115205201_accepted_seven_pattern_update_reuse_existing_capacity.sql',version:'20261115205201',bytes:1326046,sha256:'ebbf6b7ff9c2c11d711be7e222c3b27c176cd22993de2ae1cd295cd3991f35bd'}),
 Object.freeze({file:'20261120002521_messenger_direct_reopen_intents_v2.sql',version:'20261120002521',bytes:19878,sha256:'61789ecdf60c55f953ab234dc6a61f42e83dc86e414e7373f2d8af9f8b3d0848'}),
 Object.freeze({file:'20261120010931_messenger_direct_intent_cleanup.sql',version:'20261120010931',bytes:2836,sha256:'1aed43cb28f280d7a42ac2764795c94b6cf8643954b9dfc2076f85b23283bee4'}),
]);
const sha=value=>createHash('sha256').update(value).digest('hex');
export function qualificationTransactionBody(version, sql) {
 const {statements, psqlGuards} = splitSchemaStatements(sql);
 assert.equal(psqlGuards, 0, 'A forward must contain only server SQL');
 const keyword = token => token?.kind === 'identifier' && !token.quoted ? token.value : null;
 const isBoundary = (statement, word) => statement?.tokens.length === 2 && keyword(statement.tokens[0]) === word;
 const wrapped = version === '20261115205201';
 if (wrapped) {
  assert.ok(isBoundary(statements[0], 'begin') && isBoundary(statements.at(-1), 'commit'),
   'The accepted-seven forward must retain its exact transaction envelope');
 }
 const body = wrapped ? statements.slice(1, -1) : statements;
 assert.ok(body.length > 0, 'The exact forward must contain work');
 for (const statement of body) {
  const first = keyword(statement.tokens[0]);
  const second = keyword(statement.tokens[1]);
  assert.ok(!['begin', 'start', 'commit', 'end', 'rollback', 'abort', 'savepoint', 'release'].includes(first)
   && !(first === 'prepare' && second === 'transaction'),
  'Forward SQL may not control the owning rehearsal transaction');
 }
 // Preserve every source byte between the transaction boundary statements.
 return wrapped ? sql.slice(statements[0].end, statements.at(-1).tokens[0].start) : sql;
}
const identity=s=>[s.dev,s.ino,s.mode,s.uid,s.gid,s.nlink,s.size,s.mtimeNs,s.ctimeNs];
function sourceFile(ref){
 const path=fileURLToPath(new URL('../supabase/migrations/'+ref.file,import.meta.url));
 const parents=[];for(let p=dirname(path);;p=dirname(p)){
  const s=lstatSync(p,{bigint:true});assert.ok(s.isDirectory()&&!s.isSymbolicLink());parents.push([p,s.dev,s.ino,s.mode,s.uid,s.gid]);if(dirname(p)===p)break;
 }
 const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{
  const before=fstatSync(fd,{bigint:true});assert.ok(before.isFile()&&before.nlink===1n&&before.size>0n&&before.size<=16777216n);
  if(ref.bytes!==undefined)assert.equal(before.size,BigInt(ref.bytes));
  const bytes=readFileSync(fd);assert.equal(BigInt(bytes.length),before.size);assert.equal(sha(bytes),ref.sha256);
  assert.deepEqual(identity(fstatSync(fd,{bigint:true})),identity(before));assert.deepEqual(identity(lstatSync(path,{bigint:true})),identity(before));
  for(const [p,...ids]of parents){const s=lstatSync(p,{bigint:true});assert.ok(s.isDirectory()&&!s.isSymbolicLink());assert.deepEqual([s.dev,s.ino,s.mode,s.uid,s.gid],ids);}
  return {ref,identity:identity(before),parents,sql:new TextDecoder('utf-8',{fatal:true}).decode(bytes)};
 }finally{closeSync(fd);}
}

// Source inventory only. The authenticated reader below is still responsible
// for checking that these bindings actually came from the signed backup.
export function readCurrent428SourceInventory(ledgerContract) {
 assert.equal(ledgerContract.observed_ledger_count,428);
 assert.equal(ledgerContract.source_bindings_sha256,sourceBindingsSha256);
 assert.equal(sourceBindingsDigest(ledgerContract.source_bindings),sourceBindingsSha256);
 const historical=readFileSync(new URL('../supabase/canonical/migration-replay-order.json',import.meta.url));
 const fixture=readFileSync(new URL('./fixtures/accepted-seven-current-week-forward.json',import.meta.url));
 assert.equal(sha(historical),historicalManifestSha256);
 assert.equal(sha(fixture),currentTailFixtureSha256);
 const legacy=JSON.parse(historical).phases.flatMap(phase=>phase.files);
 const {forward,deferred}=JSON.parse(fixture);
 assert.equal(forward[0].name,legacy.at(-1).name);
 assert.equal(forward[0].sha256,legacy.at(-1).sha256);
 const appended=[...forward.slice(1),...deferred];
 const declared=[...legacy,...appended].map(file=>file.name).sort();
 const present=readdirSync(new URL('../supabase/migrations/',import.meta.url)).filter(name=>name.endsWith('.sql')).sort();
 assert.equal(legacy.length,311);
 assert.equal(new Set(declared).size,322);
 assert.deepEqual(present,declared,'Current source inventory contains a missing or unclassified migration');
 for(const file of legacy)sourceFile({file:file.name,sha256:file.sha256});
 const installed=[];
 const pending=[];
 for(const file of appended){
  const {sql}=sourceFile({file:file.name,sha256:file.sha256,bytes:file.bytes});
  const name=file.name.slice(15,-4);
  const gps=file.name==='20261111160601_active_work_gps_reader_policy.sql';
  if(gps)assert.ok(sql.endsWith('\n')&&!sql.endsWith('\n\n'));
  // This one retained statement omits exactly the final LF of the repository
  // source. Other retained statements must match the full original bytes.
  const installedSha256=gps?sha(sql.slice(0,-1)):file.sha256;
  const matches=ledgerContract.source_bindings.filter(binding=>binding.sql_sha256===installedSha256);
  if(matches.length===0){
   assert.ok(!ledgerContract.ledger.some(row=>row.version===file.name.slice(0,14)||row.name===name));
   pending.push(file.name);
   continue;
  }
  assert.equal(matches.length,1);
  const [binding]=matches;
  assert.equal(binding.source_location,'retained_installed');
  assert.equal(binding.statement_index,0);
  const row=ledgerContract.ledger.find(item=>item.version===binding.ledger_version);
  assert.equal(row?.name,binding.ledger_name);
  assert.equal(row?.statement_sha256[binding.statement_index],installedSha256);
  if(gps)assert.equal(binding.ledger_version,'20261111161430');
  installed.push(Object.freeze({file:file.name,version:binding.ledger_version,installed_sha256:installedSha256}));
 }
 assert.equal(installed.length,8);
 assert.deepEqual(pending,refs.map(ref=>ref.file),'The signed source must leave exactly the three selected forwards');
 return Object.freeze({source_files:declared.length,historical_files:legacy.length,
  installed:Object.freeze(installed),pending:Object.freeze(pending)});
}
// Detached metadata checks are testable but confer NO archive or target
// authority. The public reader below separately verifies the full signed v2
// ledger, catalog and actual original owner through the established readers.
export function assertCurrent428ForwardMetadata(source){
 const {sourceBinding:s,binding:b,ledger}=source;
 assert.equal(s.format,'memphis-zoo-disaster-recovery.v4');assert.equal(s.project_ref,'rqquvtjdmugpigbndmne');assert.equal(s.archive_digest,CURRENT428_ARCHIVE_DIGEST);
 assert.equal(s.source_identity.migration_ledger_count,428);assert.equal(s.source_identity.migration_head,'20261115162648');
 assert.equal(s.source_identity.migration_ledger_sha256,ledgerFileDigest);
 assert.equal(b.schema,'custodial.backup-schema-extension.v2');assert.equal(b.captured_ledger_count,428);assert.equal(b.captured_migration_head,'20261115162648');assert.equal(b.ledger_sha256,ledgerTupleDigest);
 assert.ok(Array.isArray(ledger)&&ledger.length===428);assert.equal(new Set(ledger.map(r=>r.version)).size,428);assert.equal(ledger.at(-1).version,'20261115162648');
 assert.ok(refs.every(ref=>!ledger.some(row=>row.version===ref.version)),'A selected forward is already present in the original ledger');
 return true;
}
export function readVerifiedCurrent428ForwardQualificationSource(archive){
 assert.equal(arguments.length,1);
 const original=readVerifiedMigrationTargetCaptureSource(archive);
 verifyArchivedLedgerV2({summary:original.sourceBinding.summary,binding:original.binding,catalog:original.catalog,ledger:original.ledger});
 assertCurrent428ForwardMetadata(original);
 assert.deepEqual(readVerifiedImmutableArchiveOwnerProfile(archive),{id:'immutable-private-current-postgres',actor:'postgres'});
 const inventory=readCurrent428SourceInventory(original.binding.ledger_contract);
 const files=refs.map(sourceFile);
 const assertCurrent=()=>{
  assert.equal(readVerifiedMigrationTargetCaptureSource(archive),original);
  assert.deepEqual(readVerifiedImmutableArchiveOwnerProfile(archive),{id:'immutable-private-current-postgres',actor:'postgres'});
  assert.deepEqual(readCurrent428SourceInventory(original.binding.ledger_contract),inventory);
  for(const file of files){const now=sourceFile(file.ref);assert.deepEqual(now.identity,file.identity);assert.deepEqual(now.parents,file.parents);assert.equal(now.sql,file.sql);}
  assert.equal(readVerifiedMigrationTargetCaptureSource(archive),original);
 };
 assertCurrent();
 return Object.freeze({schema:'custodial.current428-three-forward-source.v1',scope:'SOURCE_ONLY_NOT_TARGET_OR_MIGRATION_ADMISSION',
  archive_digest:CURRENT428_ARCHIVE_DIGEST,source_ledger_count:428,source_ledger_head:'20261115162648',source_ledger_file_sha256:ledgerFileDigest,source_ledger_tuple_sha256:ledgerTupleDigest,
  source_catalog_fingerprint:original.binding.catalog_fingerprint,
  source_inventory:inventory,
  pending:Object.freeze(files.map(f=>Object.freeze({...f.ref,sql:f.sql,body:qualificationTransactionBody(f.ref.version,f.sql)}))),expected_target_ledger_count:431,
  expected_target_ledger_head:refs.at(-1).version,actual_target_fingerprint:null,
  signed_reconciliation_required:true,production_mutation_authorized:false,assertCurrent});
}
