// Finite SOURCE preparation for the current428 backup. This module never
// connects to a target, changes reconciliation, or executes a migration.
import assert from 'node:assert/strict';
import {openSync,closeSync,readFileSync,lstatSync,fstatSync,constants} from 'node:fs';
import {dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {readVerifiedMigrationTargetCaptureSource} from './disaster-recovery-archive.mjs';
import {readVerifiedImmutableArchiveOwnerProfile} from './immutable-private-owner-profile.mjs';
import {verifyArchivedLedgerV2} from './backup-ledger-binding-v2.mjs';
const archiveDigest='241d1cd711d41708d00d3e61334275f0adde07d85d230d2c0d03fa9c5ff86da5';
const ledgerFileDigest='7ee71df7d6e99fbe508721c7e4508fcd4a9f10c02a67f3769fa54d5b6a4077e7';
const ledgerTupleDigest='c0bbf827afc1f73338cbed414b2e83b82e5525802cc1cbef35c219dcc4f9ae14';
const refs=Object.freeze([
 Object.freeze({file:'20261115205201_accepted_seven_pattern_update_reuse_existing_capacity.sql',version:'20261115205201',bytes:1326046,sha256:'ebbf6b7ff9c2c11d711be7e222c3b27c176cd22993de2ae1cd295cd3991f35bd'}),
 Object.freeze({file:'20261120002521_messenger_direct_reopen_intents_v2.sql',version:'20261120002521',bytes:19878,sha256:'61789ecdf60c55f953ab234dc6a61f42e83dc86e414e7373f2d8af9f8b3d0848'}),
 Object.freeze({file:'20261120010931_messenger_direct_intent_cleanup.sql',version:'20261120010931',bytes:2836,sha256:'1aed43cb28f280d7a42ac2764795c94b6cf8643954b9dfc2076f85b23283bee4'}),
]);
const sha=value=>createHash('sha256').update(value).digest('hex');
const identity=s=>[s.dev,s.ino,s.mode,s.uid,s.gid,s.nlink,s.size,s.mtimeNs,s.ctimeNs];
function sourceFile(ref){
 const path=fileURLToPath(new URL('../supabase/migrations/'+ref.file,import.meta.url));
 const parents=[];for(let p=dirname(path);;p=dirname(p)){
  const s=lstatSync(p,{bigint:true});assert.ok(s.isDirectory()&&!s.isSymbolicLink());parents.push([p,s.dev,s.ino,s.mode,s.uid,s.gid]);if(dirname(p)===p)break;
 }
 const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{
  const before=fstatSync(fd,{bigint:true});assert.ok(before.isFile()&&before.nlink===1n&&before.size===BigInt(ref.bytes));
  const bytes=readFileSync(fd);assert.equal(bytes.length,ref.bytes);assert.equal(sha(bytes),ref.sha256);
  assert.deepEqual(identity(fstatSync(fd,{bigint:true})),identity(before));assert.deepEqual(identity(lstatSync(path,{bigint:true})),identity(before));
  for(const [p,...ids]of parents){const s=lstatSync(p,{bigint:true});assert.ok(s.isDirectory()&&!s.isSymbolicLink());assert.deepEqual([s.dev,s.ino,s.mode,s.uid,s.gid],ids);}
  return {ref,identity:identity(before),parents,sql:new TextDecoder('utf-8',{fatal:true}).decode(bytes)};
 }finally{closeSync(fd);}
}
// Detached metadata checks are testable but confer NO archive or target
// authority. The public reader below separately verifies the full signed v2
// ledger, catalog and actual original owner through the established readers.
export function assertCurrent428ForwardMetadata(source){
 const {sourceBinding:s,binding:b,ledger}=source;
 assert.equal(s.format,'memphis-zoo-disaster-recovery.v4');assert.equal(s.project_ref,'rqquvtjdmugpigbndmne');assert.equal(s.archive_digest,archiveDigest);
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
 const files=refs.map(sourceFile);
 const assertCurrent=()=>{
  assert.equal(readVerifiedMigrationTargetCaptureSource(archive),original);
  assert.deepEqual(readVerifiedImmutableArchiveOwnerProfile(archive),{id:'immutable-private-current-postgres',actor:'postgres'});
  for(const file of files){const now=sourceFile(file.ref);assert.deepEqual(now.identity,file.identity);assert.deepEqual(now.parents,file.parents);assert.equal(now.sql,file.sql);}
  assert.equal(readVerifiedMigrationTargetCaptureSource(archive),original);
 };
 assertCurrent();
 return Object.freeze({schema:'custodial.current428-three-forward-source.v1',scope:'SOURCE_ONLY_NOT_TARGET_OR_MIGRATION_ADMISSION',
  archive_digest:archiveDigest,source_ledger_count:428,source_ledger_head:'20261115162648',source_ledger_file_sha256:ledgerFileDigest,source_ledger_tuple_sha256:ledgerTupleDigest,
  source_catalog_fingerprint:original.binding.catalog_fingerprint,
  pending:Object.freeze(files.map(f=>Object.freeze({...f.ref,sql:f.sql}))),expected_target_ledger_count:431,
  expected_target_ledger_head:refs.at(-1).version,actual_target_fingerprint:null,
  signed_reconciliation_required:true,production_mutation_authorized:false,assertCurrent});
}
