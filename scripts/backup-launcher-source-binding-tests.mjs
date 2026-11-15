import assert from 'node:assert/strict';import fs from 'node:fs';import {createHash} from 'node:crypto';
import {assertBackupOnlySourceBinding} from './production-backup-rehearsal-scope.mjs';
const launcher='5e150a484915849d41ae330babcc4f28cb488729',tool='685d6213d449fcc8dafcba24a47c7e6df0da3db2',repo='lasrevinu333-design/memphis-zoo-mcp';
const workflow=fs.readFileSync(new URL('../release/backup-launcher-source/'+launcher+'.yml',import.meta.url),'utf8');
assert.equal(createHash('sha256').update(workflow).digest('hex'),'29b2c38abfee2891f32a3cd9d38437a697c4577bb38528417097d8d93cf77259');
const input=()=>({summary:{source_identity:{backup_tool_commit:tool},database_row_count:100},run:{id:43766730769,head_sha:launcher,repository:{full_name:repo},status:'completed',conclusion:'success',path:'.github/workflows/production-disaster-recovery-backup.yml'},backupRunId:'43766730769',repository:repo,launcherWorkflowSource:workflow});
assert.doesNotThrow(()=>assertBackupOnlySourceBinding(input()));let checks=1;
const direct=input();direct.run.head_sha=tool;delete direct.launcherWorkflowSource;assert.doesNotThrow(()=>assertBackupOnlySourceBinding(direct));checks++;
for(const [name,edit]of[
 ['unknown launcher',x=>x.run.head_sha='a'.repeat(40)],['wrong tool',x=>x.summary.source_identity.backup_tool_commit='b'.repeat(40)],
 ['missing workflow',x=>delete x.launcherWorkflowSource],['changed workflow',x=>x.launcherWorkflowSource+='\n'],
 ['changed checkout',x=>x.launcherWorkflowSource=x.launcherWorkflowSource.replace(tool,'c'.repeat(40))],
 ['unfinished run',x=>x.run.status='in_progress'],['failed run',x=>x.run.conclusion='failure'],['wrong run',x=>x.backupRunId='123'],
 ['wrong repository',x=>{x.repository='unit/other';x.run.repository.full_name=x.repository;}],
 ['wrong workflow path',x=>x.run.path='other.yml'],['no original data',x=>x.summary.database_row_count=0],
 ['missing launcher identity',x=>delete x.run.head_sha],['missing tool identity',x=>delete x.summary.source_identity.backup_tool_commit],
]){const value=input();edit(value);assert.throws(()=>assertBackupOnlySourceBinding(value),name);checks++;}
console.log(JSON.stringify({status:'PASS_EXACT_LAUNCHER_AND_CHECKED_OUT_TOOL_BINDING',checks,databaseContacted:false,restored:false,productionWritten:false,releaseAdmission:false}));
