import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {materializeVerifiedArchive,readVerifiedArchiveSourceBinding,readVerifiedMigrationTargetCaptureSource} from './disaster-recovery-archive.mjs';
import {requireSigningKey,stableJsonFileSha256} from './disaster-recovery-crypto.mjs';
import {assertTargetCaptureBoundary,assertOwnedTargetMetadata} from './release-migration-target-capture.mjs';

// Existing isolated archive/target admission, without deriving state, changing
// global release files or authorizing a migration. Production never calls this.
export function openIsolatedPreservationArchive({backendRoot,databaseUrl,rehearsal,apply,targetCapture,candidateCommit,candidateTree,sourceLedgerSha256,captureContext,env}){
 assert.equal(env.GITHUB_ACTIONS,'true');assert.match(String(env.GITHUB_RUN_ID),/^[1-9][0-9]*$/);
 assertTargetCaptureBoundary({rehearsal,apply,databaseUrl,testFingerprint:env.RELEASE_MIGRATION_TEST_SOURCE_CATALOG_FINGERPRINT,
  testCounts:env.RELEASE_MIGRATION_TEST_SOURCE_CATALOG_COUNTS_JSON,failAfterOrder:env.RELEASE_MIGRATION_TEST_FAIL_AFTER_ORDER});
 assert.ok(env.RUNNER_TEMP&&env.RESTORE_SOURCE_DIR);
 assert.equal(resolve(env.RESTORE_SOURCE_DIR),resolve(env.RUNNER_TEMP,'production-backup'));
 const container=env.SCHEMA_FINGERPRINT_DOCKER_CONTAINER,pin='supabase/postgres@sha256:fbf77524fc188126c1775fd2d2e54040bde295438a3e6f07936f3c39e6f688ed';
 assert.equal(container,'mz_schema_rebuild_'+env.GITHUB_RUN_ID);
 const image=JSON.parse(execFileSync('docker',['image','inspect','--format','{"id":{{json .Id}},"digests":{{json .RepoDigests}}}',pin],{encoding:'utf8'}));
 const metadata=JSON.parse(execFileSync('docker',['inspect','--format','{"id":{{json .Id}},"image":{{json .Image}},"image_reference":{{json .Config.Image}},"running":{{json .State.Running}},"privileged":{{json .HostConfig.Privileged}},"ports":{{json .NetworkSettings.Ports}},"mounts":{{json .Mounts}}}',container],{encoding:'utf8'}));
 assertOwnedTargetMetadata({databaseUrl,runId:env.GITHUB_RUN_ID,container,metadata,image});
 const git=args=>execFileSync('git',args,{cwd:backendRoot,encoding:'utf8'}).trim();
 assert.equal(git(['rev-parse','HEAD']),candidateCommit);assert.equal(git(['rev-parse','HEAD^{tree}']),candidateTree);assert.equal(git(['status','--porcelain']),'');
 let archive=null,owned=false;
 try{
  if(targetCapture){assert.ok(captureContext);archive=captureContext.archive;captureContext.assertSourceCurrent();}
  else{assert.equal(captureContext,null);owned=true;archive=materializeVerifiedArchive({sourceDir:env.RESTORE_SOURCE_DIR,
   archiveVerifyKey:requireSigningKey(env.RESTORE_ARCHIVE_VERIFY_KEY,'RESTORE_ARCHIVE_VERIFY_KEY'),archiveVerifyKeyId:env.RESTORE_ARCHIVE_VERIFY_KEY_ID,
   supportedFormats:['memphis-zoo-disaster-recovery.v4'],requiredEntries:['inventory/table-catalog.json','inventory/source-schema-binding.json','inventory/source-catalog.json','inventory/migration-ledger.json']});}
  const binding=readVerifiedArchiveSourceBinding(archive),source=readVerifiedMigrationTargetCaptureSource(archive);
  assert.equal(source.sourceBinding,binding);assert.equal(binding.summary.project_ref,'rqquvtjdmugpigbndmne');
  assert.equal(stableJsonFileSha256(source.ledger),sourceLedgerSha256);assert.equal(binding.source_identity.migration_ledger_sha256,sourceLedgerSha256);
  if(!targetCapture){assert.equal(binding.source_identity.backup_tool_commit,candidateCommit);assert.equal(binding.source_identity.backup_tool_tree,candidateTree);}
  let closed=false;return Object.freeze({archive,close(){assert.equal(closed,false);closed=true;if(owned)archive.cleanup();}});
 }catch(error){if(owned&&archive)archive.cleanup();throw error;}
}
