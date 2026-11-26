import test from 'node:test';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {assertCurrent429ForwardMetadata,current429,readCurrent429Plan,readVerifiedCurrent429ForwardQualificationSource} from './current429-forward-qualification-source.mjs';
import {assertCurrent429CatalogDelta} from './current429-forward-readback.mjs';
import {verifyCurrent429Result} from './verify-current429-rehearsal.mjs';
import {verifySignedCurrent429Receipt} from './apply-current429-forward-plan.mjs';
import {stableJson,signBinding,releaseMigrationRehearsalAttestationBinding} from './disaster-recovery-crypto.mjs';

test('exact source plan binds four migrations to baseline 429',()=>{
  const plan=readCurrent429Plan();
  assert.equal(plan.plan_sha256,'e4c75bc238aaf08c64ac6205bfd2c7910d99e59608b532a1e98e698e0e76ecde');
  assert.equal(plan.expected_target_ledger_count,433);
  assert.equal(plan.pending.length,4);
  assert.ok(plan.pending.every(item=>item.version>current429.sourceHead&&!/^\s*begin;/i.test(item.body)));
  assert.throws(()=>readVerifiedCurrent429ForwardQualificationSource({...current429}));
});

test('backup 45645963579 admission checks the signed v2 migration head field',()=>{
  const declaration=JSON.parse(readFileSync(new URL('../release/production-backup-source-extension-v2.active.json',import.meta.url),'utf8'));
  const metadata={
    sourceBinding:{archive_digest:current429.archiveDigest,project_ref:declaration.project_ref,source_identity:{
      backup_tool_commit:current429.producerCommit,backup_tool_tree:current429.producerTree,
      migration_ledger_sha256:current429.sourceLedgerSha256,
    }},
    binding:{captured_migration_head:declaration.observed_ledger_head,captured_ledger_count:declaration.observed_ledger_count,
      ledger_sha256:declaration.ledger_sha256,catalog_fingerprint:declaration.observed_catalog_fingerprint},
  };
  assert.doesNotThrow(()=>assertCurrent429ForwardMetadata(metadata));
  assert.throws(()=>assertCurrent429ForwardMetadata({...metadata,binding:{...metadata.binding,
    captured_migration_head:'20261115162648',captured_ledger_head:current429.sourceHead}}));
});

test('only the four exact routine additions and their intended grants may survive in the target',()=>{
  const names=['custodial_feedback_create_current_employee','custodial_assign_employee_device_at_epoch',
    'static_weekly_initial_fill_slots','msg_set_memphis_thread_context_for_turn'];
  const source={functions:[{schema_name:'public',function_name:'existing'}],routine_grants:[],tables:[]};
  const target={...source,functions:[...source.functions,...names.map(function_name=>({
    schema_name:'public',function_name,owner_name:'migration_owner',definition:'SECURITY DEFINER',identity_arguments:'fixture',
  }))],routine_grants:names.map(function_name=>({
    schema_name:'public',function_name,grantor:'migration_owner',identity_arguments:'fixture',
    privilege_type:'EXECUTE',is_grantable:false,grantee:function_name===names[2]?'static_weekly_control_plane':'service_role',
  }))};
  assert.doesNotThrow(()=>assertCurrent429CatalogDelta(source,target));
  for (const mutate of [
    target=>target.tables.push({changed:true}),
    target=>target.functions.shift(),
    target=>target.routine_grants[0].grantee='PUBLIC',
    target=>target.routine_grants[1].is_grantable=true,
  ]){
    const changed=structuredClone(target);
    mutate(changed);
    assert.throws(()=>assertCurrent429CatalogDelta(source,changed));
  }
});

test('signing requires the successful scoped result, checked catalog and verified rollback',()=>{
  const plan=readCurrent429Plan(),candidate='a'.repeat(40),tree='b'.repeat(40),runId='246';
  const result={source_commit:candidate,source_tree:tree,qualification_run_id:runId,backup_run_id:current429.runId,
    archive_digest:current429.archiveDigest,ok:true,disposable_database_restore_outcome:'RESULT_RETURNED',
    provider_verified:true,isolated_reconciliation_observed:true,cleanup_checked:true,production_restore_performed:false,
    completed_at:'2026-11-25T20:30:00Z',current429_target_capture:{
      scope:'isolated_current429_rollback_target',archive_digest:current429.archiveDigest,candidate_commit:candidate,
      candidate_tree:tree,plan_sha256:plan.plan_sha256,rollback_verified:true,production_written:false,
      target:{checked_routine_and_grant_delta:true,recovery_inventory_exact:true,event_guards_preserved:true,event_guard_sha256:'f'.repeat(64),
        ledger_count:433,ledger_head:plan.expected_target_ledger_head,ledger_sha256:'c'.repeat(64),
        catalog:{fingerprint:'d'.repeat(64)}},
    }};
  const verify=result=>verifyCurrent429Result({receipt:JSON.stringify(result),candidate,tree,runId});
  assert.deepEqual(verify(result),result);
  const receipt=JSON.stringify(result);
  const digest=value=>createHash('sha256').update(value).digest('hex');
  const key=Buffer.alloc(32,0x11),keyId='test1',attempt='1';
  const repository='lasrevinu333-design/memphis-zoo-mcp';
  const workflowRef=repository+'/.github/workflows/production-backup-migration-rehearsal.yml@refs/heads/test';
  const attestation={repository,workflow_ref:workflowRef,workflow_sha:candidate,run_id:runId,run_attempt:attempt,
    backup_run_id:current429.runId,receipt_sha256:digest(receipt),result_sha256:digest(stableJson(result)),
    result_completed_at:result.completed_at,attested_at:'2026-11-25T20:30:01Z'};
  const envelope={format:'memphis-zoo-release-migration-rehearsal-attestation.v1',algorithm:'hmac-sha256',
    key_id:keyId,attestation,signature:signBinding(releaseMigrationRehearsalAttestationBinding(attestation),key)};
  const input={receipt,envelope,key,keyId,candidate,tree,runId,attempt,workflowRef,now:Date.parse('2026-11-25T20:31:00Z')};
  assert.deepEqual(verifySignedCurrent429Receipt(input),result.current429_target_capture.target);
  assert.throws(()=>verifySignedCurrent429Receipt({...input,attempt:'2'}));
  assert.throws(()=>verifySignedCurrent429Receipt({...input,receipt:receipt+'\n'}));
  assert.throws(()=>verifySignedCurrent429Receipt({...input,key:Buffer.alloc(32,0x22)}));

  for (const mutate of [
    result=>result.source_commit='e'.repeat(40),
    result=>result.backup_run_id='1',
    result=>result.cleanup_checked=false,
    result=>result.current429_target_capture.rollback_verified=false,
    result=>result.current429_target_capture.target.event_guards_preserved=false,
    result=>result.current429_target_capture.target.ledger_count=432,
    result=>result.current429_target_capture.target.catalog.fingerprint=current429.sourceCatalog,
  ]){
    const changed=structuredClone(result);
    mutate(changed);
    assert.throws(()=>verify(changed));
  }
});
