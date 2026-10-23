import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {materializeVerifiedArchive,readVerifiedArchiveSourceBinding,readVerifiedRestoreTableSelection} from './disaster-recovery-archive.mjs';
import {requireSigningKey} from './disaster-recovery-crypto.mjs';

// Detached provenance/result DATA only. Neither function admits SQL, restores
// rows, resumes an app or signs candidate migration/runtime attestations.
// One reviewed split-identity workflow profile, not caller-supplied pins.
// Its whole tree differs from the tool tree ONLY at this workflow. A future
// workflow/tool change needs a separately reviewed profile, never a flag.
const pinnedWorkflow = Object.freeze({
  repository:'lasrevinu333-design/memphis-zoo-mcp',
  branch:'custodial-backup-source-20261021',
  path:'.github/workflows/production-disaster-recovery-backup.yml',
  toolCommit:'1bcc95afa2634a616fa8a063579d48b8c1ad18ed',
  toolTree:'4985b79ae533c62cacf8cc35197631573df9b528',
  workflowTree:'d2ea4b634c3cc320e2c35e4257b6e6e1998e8498',
  workflowBlob:'4ecc7896eb190f0b45733416abad000717153e73',
  workflowSha256:'aea5419affb01837b29b4ea3fe7aaa7d56f43d750fd494ef82a9ae4d02b03ca1',
});
function gitObject(kind,bytes) {
  return createHash('sha1').update(Buffer.from(`${kind} ${bytes.length}\0`)).update(bytes).digest('hex');
}
function proofBytes(proof,name,limit) {
  const text=proof[name];
  assert.equal(typeof text,'string');assert.ok(text.length>0&&text.length<=4*Math.ceil(limit/3));
  const bytes=Buffer.from(text,'base64');
  assert.ok(bytes.length>0&&bytes.length<=limit);assert.equal(bytes.toString('base64'),text);
  return bytes;
}
function commitTree(bytes) {
  const text=bytes.toString('utf8');assert.ok(Buffer.from(text,'utf8').equals(bytes));
  const end=text.indexOf('\n\n');assert.ok(end>0);
  const header=text.slice(0,end).split('\n');
  assert.match(header[0],/^tree [0-9a-f]{40}$/);
  assert.equal(header.filter(line=>line.startsWith('tree ')).length,1);
  assert.deepEqual(header.filter(line=>line.startsWith('parent ')),['parent '+pinnedWorkflow.toolCommit]);
  return header[0].slice(5);
}
function treeEntry(bytes,name,mode) {
  let offset=0;const entries=new Map();
  while(offset<bytes.length) {
    const space=bytes.indexOf(32,offset),zero=bytes.indexOf(0,space+1);
    assert.ok(space>offset&&zero>space+1&&zero+21<=bytes.length);
    const entryMode=bytes.subarray(offset,space).toString('ascii');
    assert.ok(['40000','100644','100755','120000'].includes(entryMode));
    const rawName=bytes.subarray(space+1,zero),entryName=rawName.toString('utf8');
    assert.ok(Buffer.from(entryName,'utf8').equals(rawName)&&!entryName.includes('/')&&!entries.has(entryName));
    entries.set(entryName,{mode:entryMode,sha:bytes.subarray(zero+1,zero+21).toString('hex')});offset=zero+21;
  }
  assert.equal(offset,bytes.length);const entry=entries.get(name);assert.ok(entry);assert.equal(entry.mode,mode);return entry.sha;
}
function assertBackupRun({summary,run,backupRunId,repository}) {
  assert.match(String(backupRunId),/^[1-9][0-9]*(?![\s\S])/);
  assert.equal(String(run.id),String(backupRunId));
  assert.equal(run.repository.full_name,repository);
  assert.equal(run.status,'completed');assert.equal(run.conclusion,'success');
  assert.equal(run.path,'.github/workflows/production-disaster-recovery-backup.yml');
  assert.ok(Number.isSafeInteger(summary.database_row_count)&&summary.database_row_count>0,
    'Populated original DATA is required.');
}
export function assertBackupOnlySourceBinding({summary,run,backupRunId,repository,workflowProof}) {
  assertBackupRun({summary,run,backupRunId,repository});
  // Historical same-SHA captures keep their exact original admission. No new
  // proof is needed and no workflow/tool identity is silently reinterpreted.
  if(run.head_sha===summary.source_identity.backup_tool_commit)return;
  assert.equal(repository,pinnedWorkflow.repository);
  assert.equal(run.head_branch,pinnedWorkflow.branch);assert.equal(run.event,'workflow_dispatch');
  assert.ok(Number.isSafeInteger(run.run_attempt)&&run.run_attempt>0);
  assert.match(run.head_sha,/^[0-9a-f]{40}$/);
  assert.equal(summary.source_identity.backup_tool_commit,pinnedWorkflow.toolCommit);
  assert.equal(summary.source_identity.backup_tool_tree,pinnedWorkflow.toolTree);
  assert.ok(workflowProof&&typeof workflowProof==='object');
  assert.deepEqual(Object.keys(workflowProof).sort(),['commit','githubTree','rootTree','version','workflow','workflowsTree']);
  assert.equal(workflowProof.version,'backup-workflow-git-proof.v1');
  const commit=proofBytes(workflowProof,'commit',32768),root=proofBytes(workflowProof,'rootTree',262144);
  const github=proofBytes(workflowProof,'githubTree',65536),workflows=proofBytes(workflowProof,'workflowsTree',524288);
  const workflow=proofBytes(workflowProof,'workflow',65536);
  assert.equal(gitObject('commit',commit),run.head_sha);
  assert.equal(commitTree(commit),pinnedWorkflow.workflowTree);
  assert.equal(gitObject('tree',root),pinnedWorkflow.workflowTree);
  assert.equal(gitObject('tree',github),treeEntry(root,'.github','40000'));
  assert.equal(gitObject('tree',workflows),treeEntry(github,'workflows','40000'));
  assert.equal(treeEntry(workflows,'production-disaster-recovery-backup.yml','100644'),pinnedWorkflow.workflowBlob);
  assert.equal(gitObject('blob',workflow),pinnedWorkflow.workflowBlob);
  assert.equal(createHash('sha256').update(workflow).digest('hex'),pinnedWorkflow.workflowSha256);
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
      let workflowProof;
      if(run.head_sha!==summary.source_identity.backup_tool_commit) {
        if(mode==='source-binding') {
          assertBackupRun({summary,run,backupRunId:process.env.BACKUP_RUN_ID,repository:process.env.GITHUB_REPOSITORY});
          assert.match(run.head_sha,/^[0-9a-f]{40}$/);
          const rawGit=(kind,sha)=>{assert.match(sha,/^[0-9a-f]{40}$/);return execFileSync('git',['cat-file',kind,sha],{maxBuffer:2*1024*1024});};
          const commit=rawGit('commit',run.head_sha),rootTree=rawGit('tree',commitTree(commit));
          const githubTree=rawGit('tree',treeEntry(rootTree,'.github','40000'));
          const workflowsTree=rawGit('tree',treeEntry(githubTree,'workflows','40000'));
          const workflow=rawGit('blob',treeEntry(workflowsTree,'production-disaster-recovery-backup.yml','100644'));
          workflowProof={version:'backup-workflow-git-proof.v1',...Object.fromEntries(Object.entries({commit,rootTree,githubTree,workflowsTree,workflow}).map(([key,bytes])=>[key,bytes.toString('base64')]))};
        } else workflowProof=JSON.parse(readFileSync(p+'/backup-workflow-git-proof.json','utf8'));
      }
      assertBackupOnlySourceBinding({summary,run,backupRunId:process.env.BACKUP_RUN_ID,repository:process.env.GITHUB_REPOSITORY,workflowProof});
      if(mode==='source-binding'&&workflowProof!==undefined)writeFileSync(p+'/backup-workflow-git-proof.json',JSON.stringify(workflowProof)+'\n',{mode:0o600,flag:'wx'});
      if(mode==='restore-result') {
        const restore=JSON.parse(readFileSync(p+'/backup-only-owned-restore-result.json','utf8'));
        console.log(JSON.stringify(backupOnlyRestoreReceipt({summary,restore,toolCommit:process.env.GITHUB_SHA,backupRunId:process.env.BACKUP_RUN_ID,archiveDigest:binding.archive_digest,
          storageTableCount:readVerifiedRestoreTableSelection(archive,{databaseOnly:true}).storageTables.length})));
      }
    }
  } finally {archive.cleanup();}
}
