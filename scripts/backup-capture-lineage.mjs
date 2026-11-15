import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const sha=b=>createHash('sha256').update(b).digest('hex');
const PRIOR={path:'release/schema-evidence/SOURCE303_PREDECESSOR_PRODUCTION_MIGRATION_STATE.json',bytes:259630,sha256:'d1893f8dcdd84743ca1d8846159078ab1643070871448e5bcc70b876b9042af0'};
const REVIEW={path:'release/schema-evidence/SOURCE303_TICKET_POPULATED_TARGET_CAPTURE.json',bytes:20673079,sha256:'e72cfdabfc25ac244f13c29384d6c7b7892c593531cd810005a8ee2d659b9faa'};
const TARGET={path:'release/schema-evidence/SOURCE304_SEALED_POPULATED_TARGET_CAPTURE.json',bytes:21008281,sha256:'3c7887ce56b51397543e8a32197774ff2c08fa7636ac276f72c8ae3f3f8eb14f'};
const SOURCE304_STATE={path:'release/schema-evidence/SOURCE304_PREDECESSOR_PRODUCTION_MIGRATION_STATE.json',bytes:346139,sha256:'3a08995c01785006951d9fc6d19595c7f72827d2c97df65605a7211aef26d78a'};
const SOURCE304_PROFILE={path:'release/schema-evidence/SOURCE304_PREDECESSOR_PRODUCTION_TARGET_PROFILE.json',bytes:782470,sha256:'6e8fe3f4b1d326a05afe542a49a909e9830850379bff06b673bb75cf3f3c6869'};
const SOURCE311_TARGET={path:'release/schema-evidence/SOURCE311_PRODUCTION_ROLE_ORDER_TARGET_CAPTURE.json',bytes:21522147,sha256:'137bb925c6f621bdc6618cfc73b8945bd8536443016ddcdd51ee8982df6883ed'};
export function assertBackupCaptureLineage(state,profile,read){
 const backup=state.backup_evidence,capture=state.target.normal_source_capture;
 if(profile.schema==='custodial.production-target-schema-profile.source311-existing.v1'){
  assert.equal(typeof read,'function');assert.equal(profile.source_migrations,311);
  const load=ref=>{assert.deepEqual(profile.evidence.find(row=>row.path===ref.path),ref);const bytes=read(ref.path);assert.ok(Buffer.isBuffer(bytes));assert.equal(bytes.length,ref.bytes);assert.equal(sha(bytes),ref.sha256);return JSON.parse(bytes);};
  const ancestorState=load(SOURCE304_STATE),ancestorProfile=load(SOURCE304_PROFILE),target=load(SOURCE311_TARGET);
  // Validate the predecessor by its own exact contract, not by repinning its
  // ancestor backup to a later capture that used a separate backup/run.
  assertBackupCaptureLineage(ancestorState,ancestorProfile,read);
  assert.deepEqual(backup,ancestorState.backup_evidence,'Immutable ancestor backup metadata must remain unchanged');
  assert.deepEqual(capture.report,SOURCE311_TARGET);assert.deepEqual(capture.rollback_evidence.report,SOURCE311_TARGET);
  assert.equal(profile.capture.report_sha256,SOURCE311_TARGET.sha256);assert.equal(profile.capture.report_bytes,SOURCE311_TARGET.bytes);
  assert.equal(capture.original_run_id,41768329871);assert.equal(capture.original_backup_run_id,41725404138);
  assert.equal(target.schema,'custodial.production-migration-target-preparation.v1');assert.equal(target.canonical_source_count,311);
  assert.equal(target.archive_digest,profile.archive_digest);assert.equal(capture.archive_digest,profile.archive_digest);
  for(const key of ['candidate_commit','candidate_tree','plan_sha256']){assert.equal(capture[key],target[key]);assert.equal(profile.capture[key],target[key]);}
  for(const key of ['source_ledger_count','target_ledger_count'])assert.equal(profile.capture[key],target[key]);
  assert.equal(capture.rollback_evidence.committed,false);assert.equal(capture.rollback_evidence.rollback_verified,true);
  assert.equal(target.committed,false);assert.equal(target.rollback_verified,true);
  for(const key of ['production_authorized','candidate_migration_admission','runtime_admission','full_rehearsal_attestation']){assert.equal(capture[key],false);assert.equal(target[key],false);}
  return;
 }
 if(profile.schema!=='custodial.production-target-schema-profile.source304-sealed.v1'){assert.deepEqual(backup.last_verified.reviewed_target_report,capture.report);return;}
 assert.equal(typeof read,'function');assert.equal(profile.source_migrations,304);
 assert.deepEqual(profile.evidence.find(r=>r.path===PRIOR.path),PRIOR);
 const load=ref=>{const bytes=read(ref.path);assert.ok(Buffer.isBuffer(bytes),'Exact retained lineage artifact required');assert.equal(bytes.length,ref.bytes);assert.equal(sha(bytes),ref.sha256);return JSON.parse(bytes);};
 const prior=load(PRIOR);assert.deepEqual(backup,prior.backup_evidence,'Immutable inherited backup metadata cannot be repinned to a later target');
 assert.deepEqual(prior.target.normal_source_capture.report,REVIEW);assert.deepEqual(backup.last_verified.reviewed_target_report,REVIEW);
 assert.deepEqual(capture.report,TARGET);assert.equal(profile.capture.report_sha256,TARGET.sha256);assert.equal(profile.capture.report_bytes,TARGET.bytes);
 assert.deepEqual(profile.evidence.find(r=>r.path===TARGET.path),TARGET);
 const review=load(REVIEW),target=load(TARGET);
 for(const row of [prior.target.normal_source_capture,capture]){
  assert.equal(row.original_backup_run_id,backup.last_verified.workflow_run_id);assert.equal(row.archive_digest,profile.archive_digest);
  assert.equal(row.rollback_evidence.committed,false);assert.equal(row.rollback_evidence.rollback_verified,true);
  for(const key of ['production_authorized','candidate_migration_admission','runtime_admission','full_rehearsal_attestation'])assert.equal(row[key],false);
 }
 for(const [data,meta,count]of[[review,prior.target.normal_source_capture,303],[target,capture,304]]){
  assert.equal(data.schema,'custodial.production-migration-target-preparation.v1');assert.equal(data.archive_digest,profile.archive_digest);
  assert.equal(data.committed,false);assert.equal(data.rollback_verified,true);assert.equal(data.canonical_source_count,count);
  assert.equal(data.candidate_commit,meta.candidate_commit);assert.equal(data.candidate_tree,meta.candidate_tree);assert.equal(data.plan_sha256,meta.plan_sha256);
  for(const key of ['production_authorized','candidate_migration_admission','runtime_admission','full_rehearsal_attestation'])assert.equal(data[key],false);
 }
 assert.notEqual(capture.original_run_id,prior.target.normal_source_capture.original_run_id);
}
