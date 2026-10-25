import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

// Only the owning workflow's new disposable target is selected here. These
// archive fields are hints; the existing child independently authenticates
// the complete archive, source catalog/ledger, target image and actual actor.
export function targetCaptureCommand({backendRoot,backupDir,container,port,env,git}) {
 assert.equal(env.GITHUB_ACTIONS,'true');assert.match(String(env.GITHUB_RUN_ID),/^[1-9][0-9]*$/);
 assert.equal(container,'mz_schema_rebuild_'+env.GITHUB_RUN_ID);
 assert.match(String(port),/^[1-9][0-9]{0,4}$/);assert.ok(Number(port)<=65535);
 assert.ok(env.RUNNER_TEMP);assert.equal(resolve(backupDir),resolve(env.RUNNER_TEMP,'production-backup'));
 assert.match(String(env.GITHUB_SHA),/^[a-f0-9]{40}$/);
 const candidateTree=git(['rev-parse','HEAD^{tree}']);assert.match(candidateTree,/^[a-f0-9]{40}$/);
 const summary=JSON.parse(readFileSync(resolve(backupDir,'backup-summary.json')));
 assert.equal(summary.project_ref,'rqquvtjdmugpigbndmne');
 assert.match(String(summary.source_identity?.migration_ledger_sha256),/^[a-f0-9]{64}$/);
 return {file:resolve(backendRoot,'scripts/apply-release-migration-plan.mjs'),env:{...env,
  SCHEMA_FINGERPRINT_DOCKER_CONTAINER:container,RESTORE_SOURCE_DIR:resolve(backupDir),
  RELEASE_MIGRATION_APPLY:'true',RELEASE_MIGRATION_TARGET_CAPTURE:'true',RELEASE_MIGRATION_REHEARSAL:'true',
  RELEASE_MIGRATION_TARGET_CAPTURE_OUTPUT:resolve(env.RUNNER_TEMP,'production-migration-target-capture.json'),
  RELEASE_MIGRATION_CONFIRM_PROJECT_REF:summary.project_ref,SUPABASE_PROJECT_REF:summary.project_ref,
  RELEASE_MIGRATION_NAMED_ACTOR:'GitHub isolated target preparation '+env.GITHUB_RUN_ID,
  RELEASE_MIGRATION_CANDIDATE_COMMIT:env.GITHUB_SHA,RELEASE_MIGRATION_CANDIDATE_TREE:candidateTree,
  RELEASE_MIGRATION_SOURCE_LEDGER_SHA256:summary.source_identity.migration_ledger_sha256,
  SUPABASE_DB_URL:'postgresql://postgres:postgres@127.0.0.1:'+port+'/'+container,
 }};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 const backendRoot=resolve(new URL('..',import.meta.url).pathname);
 assert.equal(process.argv.length,5,'Expected only the owned backup directory, container and loopback port.');
 const command=targetCaptureCommand({backendRoot,backupDir:process.argv[2],container:process.argv[3],port:process.argv[4],env:process.env,
  git:args=>execFileSync('git',args,{cwd:backendRoot,encoding:'utf8'}).trim()});
 const result=spawnSync(process.execPath,[command.file],{cwd:backendRoot,env:command.env,stdio:'inherit'});
 if(result.error)throw new Error('Isolated target-capture child could not start.');
 process.exitCode=Number.isInteger(result.status)?result.status:1;
}
