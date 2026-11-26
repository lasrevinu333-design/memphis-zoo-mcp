import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseJsonValueStream} from './json-value-stream.mjs';
import {summarizeCurrentWeekCoverage} from './current428-rollback-target.mjs';
import {current429,readCurrent429Plan} from './current429-forward-qualification-source.mjs';

const hash=/^[a-f0-9]{64}$/;
const commit=/^[a-f0-9]{40}$/;

export function verifyCurrent429Result({receipt, candidate, tree, runId}) {
  const result=parseJsonValueStream(receipt,'429 rehearsal receipt').at(-1);
  const plan=readCurrent429Plan();
  assert.match(candidate,commit);
  assert.equal(result?.source_commit,candidate);
  assert.match(result.source_tree,commit);
  if(tree)assert.equal(result.source_tree,tree);
  assert.equal(String(result.qualification_run_id),String(runId));
  assert.equal(result.backup_run_id,current429.runId);
  assert.equal(result.archive_digest,current429.archiveDigest);
  assert.equal(result.ok,true);
  assert.equal(result.disposable_database_restore_outcome,'RESULT_RETURNED');
  assert.equal(result.provider_verified,true);
  assert.equal(result.isolated_reconciliation_observed,true);
  assert.equal(result.cleanup_checked,true);
  const scratch=result.scratch;
  assert.equal(scratch?.layout,'owned_local_volume');
  assert.equal(scratch.volume_removed,true);
  assert.ok(Number.isSafeInteger(scratch.samples)&&scratch.samples>=2);
  assert.ok(Number.isSafeInteger(scratch.minimum_bytes)&&scratch.minimum_bytes>=12*1024**3);
  assert.ok(Number.isSafeInteger(scratch.minimum_inodes)&&scratch.minimum_inodes>=64*1024);
  for(const kind of ['pgdata','wal']){
    const first=scratch.admission?.[kind],last=scratch.final?.[kind],lowest=scratch.minimum?.[kind];
    assert.ok(first&&last&&lowest&&/^[A-Za-z0-9_/-]{1,24}$/.test(first.filesystem_type)
      &&!['tmpfs','ramfs'].includes(first.filesystem_type));
    assert.equal(last.filesystem_type,first.filesystem_type);
    assert.equal(lowest.filesystem_type,first.filesystem_type);
    assert.ok([first.free_bytes,last.free_bytes,lowest.free_bytes,first.free_inodes,last.free_inodes,lowest.free_inodes]
      .every(n=>Number.isSafeInteger(n)&&n>0));
    assert.ok(first.free_bytes>=scratch.minimum_bytes&&first.free_inodes>=scratch.minimum_inodes);
    assert.ok(lowest.free_bytes<=Math.min(first.free_bytes,last.free_bytes)
      &&lowest.free_inodes<=Math.min(first.free_inodes,last.free_inodes));
  }
  assert.equal(result.production_restore_performed,false);
  const capture=result.current429_target_capture;
  assert.equal(capture.scope,'isolated_current429_rollback_target');
  assert.equal(capture.archive_digest,current429.archiveDigest);
  assert.equal(capture.candidate_commit,candidate);
  assert.equal(capture.candidate_tree,result.source_tree);
  assert.equal(capture.plan_sha256,plan.plan_sha256);
  assert.equal(capture.rollback_verified,true);
  assert.equal(capture.production_written,false);
  assert.equal(capture.target.checked_routine_and_grant_delta,true);
  assert.equal(capture.target.recovery_inventory_exact,true);
  assert.equal(capture.target.event_guards_preserved,true);
  assert.match(capture.target.event_guard_sha256,hash);
  assert.equal(capture.target.ledger_count,plan.expected_target_ledger_count);
  assert.equal(capture.target.ledger_head,plan.expected_target_ledger_head);
  assert.match(capture.target.ledger_sha256,hash);
  assert.match(capture.target.catalog.fingerprint,hash);
  assert.notEqual(capture.target.catalog.fingerprint,current429.sourceCatalog);
  const schedule=summarizeCurrentWeekCoverage(capture.target.current_chicago_week,{requireVersion2:true});
  assert.deepEqual(capture.target.current_chicago_week_coverage,schedule);
  assert.equal(schedule.working_coverage,true,'Usable signed Chicago week required');
  assert.match(result.completed_at,/^\d{4}-\d\d-\d\dT/);
  return result;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  verifyCurrent429Result({receipt:readFileSync(process.env.RELEASE_MIGRATION_REHEARSAL_RECEIPT,'utf8'),
    candidate:process.env.GITHUB_SHA,runId:process.env.GITHUB_RUN_ID});
  console.log('Verified exact private four-SQL rollback receipt for signing.');
}
