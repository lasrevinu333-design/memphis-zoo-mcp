import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PG_IMAGE,selectPrivateProfile,freshIntentEnvelope,assertOwnedPg,assertPrivateResult,safeSourcePreparationFailure} from './run-private-backup-only-rehearsal.mjs';
import {captureVerifiedOriginalRestoreIntent} from './disaster-recovery-crypto.mjs';
import {captureVerifiedImmutableFreshRestoreIntent} from './immutable-private-fresh-restore-intent.mjs';
const key='offline-fixture-independent-intent-key-32bytes',keyId='fixture';
const binding={archive_digest:'a'.repeat(64),source_identity_sha256:'b'.repeat(64),project_ref:'a'.repeat(20),
  source_identity:{migration_head:'20261111161430',release:{release_id:'original-release',backend_commit:'c'.repeat(40),
    frontend_commit:'d'.repeat(40),migration_head:'20260920010000',migration_manifest_sha256:'e'.repeat(64)}}};
const names=['employee_message_original_outcomes','group_original_creations'];
const source=()=>({selection:{privateTables:names.map(table_name=>({schema_name:'custodial_release_identity',table_name}))}});
test('private selection is exact; new namespace names never substitute',()=>{
  assert.equal(selectPrivateProfile(source()),'private');assert.equal(selectPrivateProfile({selection:{privateTables:[]}}),'native');
  for(const values of [[names[0]],[...names,'other'],[names[0],names[0]],['custodial_employment']])
    assert.throws(()=>selectPrivateProfile({selection:{privateTables:values.map(table_name=>({table_name}))}}));
});
test('fresh intent preserves separate runtime and schema identities; no retry or resume',()=>{
  const e=freshIntentEnvelope(binding,key,keyId);
  const verified=captureVerifiedOriginalRestoreIntent(e,key,keyId);
  assert.equal(verified.target_migration_head,'20261111161430');assert.equal(verified.target_release_identity.migration_head,'20260920010000');
  assert.equal(verified.authority_generation,1);assert.equal(verified.retry_of_restore_id,null);assert.equal(verified.resume_after_verification,false);
  assert.notEqual(freshIntentEnvelope(binding,key,keyId).intent.restore_id,e.intent.restore_id);
});
test('intent signature rejects tampering and wrong key',()=>{
  for(const field of ['archive_digest','target_project_ref','target_migration_head','authority_generation','resume_after_verification']){
    const e=freshIntentEnvelope(binding,key,keyId);e.intent[field]=field==='resume_after_verification'?true:'changed';
    assert.throws(()=>captureVerifiedOriginalRestoreIntent(e,key,keyId));
  }
  assert.throws(()=>captureVerifiedOriginalRestoreIntent(freshIntentEnvelope(binding,key,keyId),'different-key-'.repeat(4),keyId));
});
test('fresh branded capture cannot accept public forged archive',()=>{
  assert.throws(()=>captureVerifiedImmutableFreshRestoreIntent({verifiedArchive:binding,
    originalIntentEnvelope:freshIntentEnvelope(binding,key,keyId),intentVerifyKey:key,intentVerifyKeyId:keyId}));
});
const identity={id:'1'.repeat(64),name:'mz_schema_rebuild_123',owner:'fixture',networkId:'2'.repeat(64),networkName:'owned'};
const pg=()=>({Id:identity.id,Name:'/'+identity.name,Config:{Image:PG_IMAGE,Labels:{'custodial.private-backup-rehearsal':'fixture'}},
  State:{Running:true},NetworkSettings:{Ports:{'5432/tcp':null},Networks:{owned:{NetworkID:identity.networkId,IPAddress:'172.20.0.2'}}}});
test('owned target validates exact ID/image/label/network, never published ports',()=>{
  assert.equal(assertOwnedPg(pg(),identity),'172.20.0.2');
  for(const change of [p=>p.Id='3'.repeat(64),p=>p.Config.Image='postgres:latest',p=>p.Config.Labels={},p=>p.State.Running=false,
    p=>p.NetworkSettings.Ports['5432/tcp']=[{HostIp:'127.0.0.1',HostPort:'1234'}],
    p=>p.NetworkSettings.Ports['5432/tcp']=[{HostIp:'0.0.0.0',HostPort:'5432'}],
    p=>p.NetworkSettings.Networks.owned.NetworkID='wrong',p=>p.NetworkSettings.Networks.owned.IPAddress='localhost']){
    const p=pg();change(p);assert.throws(()=>assertOwnedPg(p,identity));
  }
});
function resultFixture(){
  const e=freshIntentEnvelope(binding,key,keyId);
  const s={...source(),sourceBinding:{...binding,summary:{table_count:365,database_row_count:1234,storage_object_count:1}}};
  const r={ok:true,restore_id:e.intent.restore_id,authority_generation:1,database_only:true,mutations_paused:true,
    state:'PAUSED_RECONCILIATION',database_tables:365,database_rows:1234,complete_restore:false,resume_allowed:false,
    retry_allowed:false,rerun_import_allowed:false,archive_digest:binding.archive_digest,
    original_data_readback:{private_data:{state:'MATCH',tables:names.map(table_name=>({table_name,state:'MATCH'}))},ordinary_data:{state:'MATCH'},storage_data:{status:'MATCH'}},
    authority_observation:{outcome:'AUTHORITY_COMPLETION_OBSERVED'},
    authority_data_readback:{schema:'custodial.immutable-private-post-authority-data-readback.v1',state:'MATCH',
      private_data:{state:'MATCH'},ordinary_data:{state:'SOURCE_TRANSFORMATION_VERIFIED'},storage_data:{status:'MATCH'},
      comparison_only:true,metadata_only:true,complete_restore:false,resume_allowed:false,retry_allowed:false,
      rerun_import_allowed:false,inventory_acknowledged:false,effects:false},storage:{provider_verified:true,object_bytes_verified:true,
      metadata_and_ownership_verified:true,scope:'OFFICIAL_LOCAL_FILE_BACKEND_SAME_ORIGINAL',production_provider_verified:false,
      owner_access_probes:[{status:'VERIFIED_CURRENT_RESTORED_ROLE_BOUNDARY'}]}};
  return {e,s,r};
}
test('success requires private/ordinary/storage readback plus provider and held state',()=>{
  let {e,s,r}=resultFixture();assert.equal(assertPrivateResult(r,s,e.intent),true);
  for(const mutate of [r=>r.original_data_readback.private_data.state='DIFFERENT',r=>r.original_data_readback.private_data.tables.pop(),
    r=>r.original_data_readback.ordinary_data.state='UNSUPPORTED',r=>r.original_data_readback.storage_data.status='DIFFERENT',
    r=>r.storage.provider_verified=false,r=>r.storage.object_bytes_verified=false,r=>r.storage.owner_access_probes=[],
    r=>r.storage.production_provider_verified=true,r=>r.authority_observation.outcome='UNKNOWN',r=>r.database_tables--,
    r=>r.resume_allowed=true,r=>r.state='READY',r=>r.authority_data_readback.private_data.state='DIFFERENT',r=>r.authority_data_readback.ordinary_data.state='CURRENT_TARGET_SOURCE_REQUIRES_OWNER_CHECK']){
    const {e,s,r}=resultFixture();mutate(r);assert.throws(()=>assertPrivateResult(r,s,e.intent));
  }
});
test('workflow dispatches authenticated private selection before native target and bypasses legacy cleanup',()=>{
  const w=readFileSync(new URL('../.github/workflows/production-backup-migration-rehearsal.yml',import.meta.url),'utf8');
  const start=w.indexOf('node scripts/run-private-backup-only-rehearsal.mjs --dispatch'),native=w.indexOf('          docker pull "$image"');
  assert.ok(start>0&&native>start);const branch=w.slice(start,native);
  assert.match(branch,/--dispatch \| tee -a "\$receipt"; then exit 0; else status=\$\?; fi/);
  assert.match(branch,/test "\$status" = 3/);
  assert.ok(w.indexOf('source-binding')<start);assert.ok(w.indexOf('restore:prepare-isolated')>native);
  assert.match(w,/if test "\$\{private_route_active:-false\}" = true; then return "\$status"; fi/);
  assert.ok(w.indexOf('private_route_active=true')<w.indexOf('trap cleanup EXIT'));
  assert.match(w,/python3 scripts\/extract-rehearsal-archive.py/);
  assert.doesNotMatch(w,/tar -C \"\$backup_dir\" -xzf/);
  assert.ok(branch.indexOf('test "$status" = 3')<branch.indexOf('private_route_active=false'));
});
test('new runner has no hydration, legacy intent producer or migration invocation',()=>{
  const s=readFileSync(new URL('./run-private-backup-only-rehearsal.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(s,/['"](?:--publish|-p|restore:prepare-isolated|restore:intent|release:migrations:apply)['"]/);
  assert.match(s,/captureVerifiedImmutableFreshRestoreIntent\(\{verifiedArchive:archive/);
  assert.ok(s.indexOf('await prepareVerifiedImmutableBootstrapSource(archive)')<s.indexOf("phase='create_owned_target'"));
  assert.match(s,/closeOwnedRelay\(relay,sockets/);assert.match(s,/await Promise.allSettled\(\[\.\.\.pendingConnections\]\)/);
  assert.match(s,/database_restore_outcome|disposable_database_restore_outcome/);
});

test('source preparation failure exposes only exact closed code and phase, never operands',()=>{
  const error={code:'IMMUTABLE_BOOTSTRAP_SOURCE_UNAVAILABLE',source_phase:'ORIGINAL_REGISTRY',message:'private fixture',actual:'private fixture'};
  assert.deepEqual(safeSourcePreparationFailure(error),{code:error.code,source_phase:'ORIGINAL_REGISTRY'});
  assert.equal(safeSourcePreparationFailure({...error,source_phase:'private fixture'}),null);
  assert.equal(safeSourcePreparationFailure({...error,code:'other'}),null);
  assert.equal(safeSourcePreparationFailure({get code(){throw Error('must not invoke')}}),null);
});
