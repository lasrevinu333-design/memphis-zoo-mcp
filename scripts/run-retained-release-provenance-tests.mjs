// Source-only provenance contracts for the retained, hash-bound 311 plan.
// Current forward SQL, deployment and release admission remain separate gates.
import assert from 'node:assert/strict';
import {copyFileSync,existsSync,lstatSync,mkdirSync,readFileSync,symlinkSync,writeFileSync} from 'node:fs';
import {execFileSync,spawnSync} from 'node:child_process';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {withCurrentMigrationSourceFixture} from './fixtures/current-migration-source-fixtures.mjs';
import {restoreReminderHistoricalSource} from './fixtures/reminder-timing-source-successor.mjs';
const root=resolve(fileURLToPath(new URL('../',import.meta.url)));
assert.equal(process.argv.length,2,'Only the complete retained provenance suite is supported');
const script='test:integrated-backend-authority-release-provenance';
const command='node scripts/integrated-backend-authority-release-provenance-tests.mjs';
const selected=r=>JSON.parse(readFileSync(resolve(r,'package.json'))).scripts[script];
assert.equal(selected(root),command,'The complete original provenance suite remains required');
const tracked=[...new Set(execFileSync('git',['ls-files','-co','--exclude-standard','-z'],{cwd:root}).toString().split('\0').filter(Boolean))];
await withCurrentMigrationSourceFixture(root,311,async fixture=>{
 for(const path of tracked){
  if(path.startsWith('supabase/migrations/')||path.startsWith('scripts/fixtures/sealed-repair/canonical304-predecessor/'))continue;
  const source=resolve(root,path),target=resolve(fixture,path);assert.ok(target.startsWith(fixture+'/'));
  if(existsSync(target))continue;
  assert.ok(lstatSync(source).isFile()&&!lstatSync(source).isSymbolicLink());mkdirSync(dirname(target),{recursive:true});copyFileSync(source,target);
  if(path.startsWith('src/')&&path.endsWith('.js')){
   const current=readFileSync(source,'utf8'),historical=restoreReminderHistoricalSource(path,current);
   if(historical!==current)writeFileSync(target,historical);
  }
 }
 assert.equal(selected(fixture),command);assert.equal(existsSync(resolve(fixture,'.git')),false);
 // This suite intentionally creates signed Git fixtures from its own complete
 // tracked source. Give only the disposable view its own source-only identity.
 const git=args=>execFileSync('git',args,{cwd:fixture,stdio:'pipe',env:{...process.env,
  GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_SYSTEM:'/dev/null',GIT_AUTHOR_NAME:'Custodial source fixture',GIT_AUTHOR_EMAIL:'fixture@invalid',
  GIT_COMMITTER_NAME:'Custodial source fixture',GIT_COMMITTER_EMAIL:'fixture@invalid'}});
 git(['init','-q']);git(['add','--all']);git(['-c','commit.gpgsign=false','commit','-qm','Exact retained 311 source-only provenance fixture']);
 if(!existsSync(resolve(fixture,'node_modules')))symlinkSync(resolve(root,'node_modules'),resolve(fixture,'node_modules'),'dir');
 console.log(JSON.stringify({status:'EXACT_RETAINED311_PROVENANCE_SOURCE_SELECTED',canonicalSourceMigrations:311,sqlExecuted:false,currentForwardAdmission:false,productionWritten:false}));
 const result=spawnSync('npm',['run','--silent',script],{cwd:fixture,env:{...process.env},stdio:'inherit'});
 assert.equal(result.error,undefined);assert.equal(result.signal,null,'Retained provenance suite was interrupted');
 assert.equal(result.status,0,'Complete original provenance contracts failed');
});
