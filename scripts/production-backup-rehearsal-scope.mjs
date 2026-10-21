import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {materializeVerifiedArchive,readVerifiedArchiveSourceBinding,readVerifiedRestoreTableSelection} from './disaster-recovery-archive.mjs';
import {requireSigningKey} from './disaster-recovery-crypto.mjs';

// Detached provenance/result DATA only. Neither function admits SQL, restores
// rows, resumes an app or signs candidate migration/runtime attestations.
export function assertBackupOnlySourceBinding({summary,run,backupRunId,repository}) {
  assert.match(String(backupRunId),/^[1-9][0-9]*(?![\s\S])/);
  assert.equal(String(run.id),String(backupRunId));
  assert.equal(run.repository.full_name,repository);
  assert.equal(run.status,'completed');assert.equal(run.conclusion,'success');
  assert.equal(run.head_sha,summary.source_identity.backup_tool_commit);
  assert.equal(run.path,'.github/workflows/production-disaster-recovery-backup.yml');
  assert.ok(Number.isSafeInteger(summary.database_row_count)&&summary.database_row_count>0,
    'Populated original DATA is required.');
}
export function backupOnlyRestoreReceipt({summary,restore,toolCommit,backupRunId,archiveDigest,storageTableCount}) {
  assert.match(toolCommit,/^[0-9a-f]{40}(?![\s\S])/);
  assert.match(archiveDigest,/^[0-9a-f]{64}(?![\s\S])/);
  assert.match(restore.restore_id,/^[0-9a-f-]{36}(?![\s\S])/);
  assert.ok(Number.isSafeInteger(restore.authority_generation)&&restore.authority_generation>0);
  assert.match(restore.final_manifest_sha256,/^[0-9a-f]{64}(?![\s\S])/);
  assert.equal(restore.ok,true);assert.equal(restore.database_only,true);
  assert.equal(restore.state,'PAUSED_RECONCILIATION');assert.equal(restore.mutations_paused,true);
  assert.equal(restore.database_tables,summary.table_count);
  assert.equal(String(restore.database_rows),String(summary.database_row_count));
  assert.equal(restore.database_evidence.native_text_readback.state,'MATCH');
  assert.equal(restore.database_evidence.native_text_readback.tables,summary.table_count);
  assert.equal(restore.database_evidence.native_text_readback.original_text_multiset,true);
  assert.equal(restore.storage.database_only_metadata_verified,true);
  assert.equal(restore.storage.exact_table_data.status,'MATCH');
  assert.equal(restore.storage.exact_table_data.original_text_multiset,true);
  assert.equal(restore.storage.exact_table_data.tables,storageTableCount);
  return {ok:true,scope:'backup_only',backup_run_id:String(backupRunId),archive_digest:archiveDigest,
    restore_id:restore.restore_id,authority_generation:restore.authority_generation,final_manifest_sha256:restore.final_manifest_sha256,
    source_commit:summary.source_identity.backup_tool_commit,source_tree:summary.source_identity.backup_tool_tree,
    qualification_tool_commit:toolCommit,source_migration_head:summary.source_identity.migration_head,
    database_tables:restore.database_tables,database_rows:restore.database_rows,
    native_text_original_readback:restore.database_evidence.native_text_readback,
    storage_sql_readback:restore.storage.exact_table_data,
    verified_archived_storage_objects:summary.storage_object_count,
    restore_state:restore.state,mutations_paused:true,forward_migrations_applied:false,
    candidate_migration_admission:false,runtime_admission:false,storage_provider_admission:false,
    full_rehearsal_attestation:false,live_production_writes:0,completed_at:new Date().toISOString()};
}
export function backupArchiveMetadata(summary,archiveDigest) {
  const i=summary.source_identity;
  assert.equal(summary.format,'memphis-zoo-disaster-recovery.v4');
  assert.match(i.backup_tool_commit,/^[0-9a-f]{40}(?![\s\S])/);assert.match(i.backup_tool_tree,/^[0-9a-f]{40}(?![\s\S])/);
  assert.match(summary.project_ref,/^[a-z0-9]{20}(?![\s\S])/);assert.match(i.migration_head,/^[0-9]{14}(?![\s\S])/);
  assert.ok(Number.isSafeInteger(i.migration_ledger_count)&&i.migration_ledger_count>0);
  assert.match(i.migration_ledger_sha256,/^[0-9a-f]{64}(?![\s\S])/);assert.match(archiveDigest,/^[0-9a-f]{64}(?![\s\S])/);
  return [summary.format,i.backup_tool_commit,i.backup_tool_tree,summary.project_ref,
    i.migration_head,String(i.migration_ledger_count),i.migration_ledger_sha256,archiveDigest];
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const mode=process.argv[2],p=process.env.RUNNER_TEMP;
  assert.ok(['metadata','source-binding','restore-result'].includes(mode));assert.ok(p);
  const archive=materializeVerifiedArchive({sourceDir:p+'/production-backup',
    archiveVerifyKey:requireSigningKey(process.env.RESTORE_ARCHIVE_VERIFY_KEY,'RESTORE_ARCHIVE_VERIFY_KEY'),
    archiveVerifyKeyId:process.env.RESTORE_ARCHIVE_VERIFY_KEY_ID,supportedFormats:['memphis-zoo-disaster-recovery.v4'],
    requiredEntries:['backup-summary.json','inventory/table-catalog.json','inventory/storage-buckets.json','inventory/storage-objects.json']});
  try {
    const binding=readVerifiedArchiveSourceBinding(archive),summary=binding.summary;
    if(mode==='metadata')console.log(backupArchiveMetadata(summary,binding.archive_digest).join(' '));
    else {
      if(mode==='source-binding') {
        assert.match(process.env.BACKUP_RUN_ID,/^[1-9][0-9]*(?![\s\S])/);
        assert.match(process.env.GITHUB_REPOSITORY,/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?![\s\S])/);
        const commit=summary.source_identity.backup_tool_commit,tree=summary.source_identity.backup_tool_tree;
        assert.match(commit,/^[0-9a-f]{40}(?![\s\S])/);assert.match(tree,/^[0-9a-f]{40}(?![\s\S])/);
        const git=args=>execFileSync('git',args,{encoding:'utf8'}).trim();
        assert.equal(git(['rev-parse','HEAD']),process.env.GITHUB_SHA);
        assert.equal(git(['status','--porcelain']),'');
        git(['merge-base','--is-ancestor',commit,process.env.GITHUB_SHA]);
        assert.equal(git(['rev-parse',commit+'^{tree}']),tree);
        const raw=execFileSync('gh',['api','repos/'+process.env.GITHUB_REPOSITORY+'/actions/runs/'+process.env.BACKUP_RUN_ID],
          {encoding:'utf8',maxBuffer:2*1024*1024});
        writeFileSync(p+'/backup-run-provenance.json',raw,{mode:0o600,flag:'wx'});
      }
      const run=JSON.parse(readFileSync(p+'/backup-run-provenance.json','utf8'));
      assertBackupOnlySourceBinding({summary,run,backupRunId:process.env.BACKUP_RUN_ID,repository:process.env.GITHUB_REPOSITORY});
      if(mode==='restore-result') {
        const restore=JSON.parse(readFileSync(p+'/backup-only-owned-restore-result.json','utf8'));
        console.log(JSON.stringify(backupOnlyRestoreReceipt({summary,restore,toolCommit:process.env.GITHUB_SHA,backupRunId:process.env.BACKUP_RUN_ID,archiveDigest:binding.archive_digest,
          storageTableCount:readVerifiedRestoreTableSelection(archive,{databaseOnly:true}).storageTables.length})));
      }
    }
  } finally {archive.cleanup();}
}
