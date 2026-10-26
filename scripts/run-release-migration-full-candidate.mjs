import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {targetCaptureCommand} from './run-release-migration-target-capture.mjs';

// Reuse the exact disposable-target/candidate/source-hint producer, then enter
// the existing normal rehearsal consumer. Only its migration connection uses
// the existing postgres actor. Restore/reconciliation keep supabase_admin.
export function fullCandidateMigrationCommand(input) {
 const command=targetCaptureCommand(input);
 const summary=JSON.parse(readFileSync(resolve(input.backupDir,'backup-summary.json')));
 assert.equal(summary.source_identity.backup_tool_commit,command.env.RELEASE_MIGRATION_CANDIDATE_COMMIT);
 assert.equal(summary.source_identity.backup_tool_tree,command.env.RELEASE_MIGRATION_CANDIDATE_TREE);
 command.env.RELEASE_MIGRATION_TARGET_CAPTURE='false';
 delete command.env.RELEASE_MIGRATION_TARGET_CAPTURE_OUTPUT;
 command.env.RELEASE_MIGRATION_NAMED_ACTOR='GitHub production backup migration rehearsal '+input.env.GITHUB_RUN_ID;
 return command;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 const backendRoot=resolve(new URL('..',import.meta.url).pathname);
 assert.equal(process.argv.length,5,'Expected only the owned backup directory, container and loopback port.');
 const command=fullCandidateMigrationCommand({backendRoot,backupDir:process.argv[2],container:process.argv[3],port:process.argv[4],env:process.env,
  git:args=>execFileSync('git',args,{cwd:backendRoot,encoding:'utf8'}).trim()});
 const result=spawnSync(process.execPath,[command.file],{cwd:backendRoot,env:command.env,stdio:'inherit'});
 if(result.error)throw new Error('Isolated full-candidate migration child could not start.');
 process.exitCode=Number.isInteger(result.status)?result.status:1;
}
