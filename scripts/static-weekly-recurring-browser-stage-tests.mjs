import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,readFileSync,rmSync,statSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {assertRecurringBrowserStageParent,loadPinnedRecurringChromium,recurringBrowserEvidenceDir,
 runRecurringChromiumConfirmationStage} from './static-weekly-recurring-browser-stage.mjs';

const parent=process.ppid,lease=parent+1000;
const makeEnv=directory=>({CUSTODIAL_RECURRING_BROWSER_STAGE_PARENT_PID:String(parent),
 CUSTODIAL_RECURRING_BROWSER_LEASE_PARENT_PID:String(lease),
 CUSTODIAL_RECURRING_BROWSER_EVIDENCE_DIR:directory});
assert.deepEqual(assertRecurringBrowserStageParent(makeEnv('/unused'),parent),
 {stageParentPid:parent,leaseParentPid:lease});
for(const env of [
 {...makeEnv('/unused'),CUSTODIAL_RECURRING_BROWSER_STAGE_PARENT_PID:'1'},
 {...makeEnv('/unused'),CUSTODIAL_RECURRING_BROWSER_LEASE_PARENT_PID:String(parent)},
 {...makeEnv('/unused'),CUSTODIAL_RECURRING_BROWSER_LEASE_PARENT_PID:'not-a-pid'},
])assert.throws(()=>assertRecurringBrowserStageParent(env,parent));

const dirs=[];
const directory=()=>{const path=mkdtempSync(join(tmpdir(),'mz-recurring-chromium-stage-'));dirs.push(path);return path;};
const fixtureArgs={pool:{synthetic:true},week:'2026-10-05',originalManagerId:'synthetic-manager',check:()=>{}};
const events=[];
let contextsClosed=0,browsersClosed=0,launched=0,contextsCreated=0;
const browser={browserType:()=>({name:()=> 'chromium'}),contexts:()=>[],
 async newContext(options){contextsCreated++;assert.deepEqual(options,{serviceWorkers:'block',acceptDownloads:false,permissions:[]});
  return {pages:()=>[],async close(){contextsClosed++;}};},
 async close(){browsersClosed++;}};
const chromium={async launch(options){launched++;assert.deepEqual(options,{headless:true});return browser;}};
try{
 const good=directory();
 assert.equal(recurringBrowserEvidenceDir(makeEnv(good)),good);
 const returned=await runRecurringChromiumConfirmationStage({...fixtureArgs,env:makeEnv(good),chromium,
  actualParentPid:parent,emit:message=>events.push(message),
  runFixture:async args=>{assert.equal(args.pool,fixtureArgs.pool);assert.equal(args.week,fixtureArgs.week);
   assert.equal(args.originalManagerId,fixtureArgs.originalManagerId);return{synthetic:true};}});
 assert.deepEqual(returned,{synthetic:true});
 assert.deepEqual(events,['BROWSER_TRANSPORT_STAGE_ENTERED','BROWSER_TRANSPORT_STAGE_CLEANUP']);
 assert.deepEqual([launched,contextsCreated,contextsClosed,browsersClosed],[1,1,1,1]);
 const start=JSON.parse(readFileSync(join(good,'browser-stage-start.json')));
 const cleanup=JSON.parse(readFileSync(join(good,'browser-stage-cleanup.json')));
 assert.deepEqual([start.stageParentPid,start.leaseParentPid,start.childPid],[parent,lease,process.pid]);
 assert.deepEqual([cleanup.launched,cleanup.contextCreated,cleanup.contextClosed,cleanup.browserClosed,
  cleanup.remainingContexts,cleanup.fixtureReturned],[true,true,true,true,0,true]);
 assert.equal(statSync(join(good,'browser-stage-cleanup.json')).mode&0o777,0o600);

 const thrown=directory(),original=new Error('original fixture failure');
 await assert.rejects(()=>runRecurringChromiumConfirmationStage({...fixtureArgs,env:makeEnv(thrown),chromium,
  actualParentPid:parent,emit:()=>{},runFixture:async()=>{throw original;}}),error=>error===original);
 assert.equal(JSON.parse(readFileSync(join(thrown,'browser-stage-cleanup.json'))).fixtureReturned,false);
 assert.deepEqual([contextsClosed,browsersClosed],[2,2]);

 const launchFailure=directory(),launchError=new Error('synthetic launch refusal');
 await assert.rejects(()=>runRecurringChromiumConfirmationStage({...fixtureArgs,env:makeEnv(launchFailure),
  chromium:{async launch(){throw launchError;}},actualParentPid:parent,emit:()=>{},runFixture:async()=>assert.fail()}),
  error=>error===launchError);
 const refused=JSON.parse(readFileSync(join(launchFailure,'browser-stage-cleanup.json')));
 assert.deepEqual([refused.launched,refused.contextCreated,refused.fixtureReturned],[false,false,false]);

 const denied=directory();
 await assert.rejects(()=>runRecurringChromiumConfirmationStage({...fixtureArgs,env:makeEnv(denied),
  chromium,actualParentPid:parent+1,emit:()=>{},runFixture:async()=>assert.fail()}));
 assert.equal(launched,2,'invalid parent refuses before browser launch');
 assert.throws(()=>recurringBrowserEvidenceDir({...makeEnv(denied),CUSTODIAL_RECURRING_BROWSER_EVIDENCE_DIR:'relative'}));

 const fake=directory(),packageDir=join(fake,'node_modules','playwright');
 mkdirSync(packageDir,{recursive:true});
 const index=join(packageDir,'index.mjs'),pkg=join(packageDir,'package.json'),lock=join(fake,'package-lock.json');
 writeFileSync(index,'export const chromium={launch:async()=>null};\n');
 writeFileSync(pkg,JSON.stringify({name:'playwright',version:'1.61.1'})+'\n');
 writeFileSync(lock,'{}\n');
 const sha=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
 const pinned={CUSTODIAL_RECURRING_BROWSER_FRONTEND_ROOT:fake,
  CUSTODIAL_RECURRING_BROWSER_PLAYWRIGHT_INDEX_SHA256:sha(index),
  CUSTODIAL_RECURRING_BROWSER_PLAYWRIGHT_PACKAGE_SHA256:sha(pkg),
  CUSTODIAL_RECURRING_BROWSER_PACKAGE_LOCK_SHA256:sha(lock)};
 assert.equal(typeof(await loadPinnedRecurringChromium(pinned)).launch,'function');
 await assert.rejects(()=>loadPinnedRecurringChromium({...pinned,
  CUSTODIAL_RECURRING_BROWSER_PLAYWRIGHT_INDEX_SHA256:'0'.repeat(64)}));
 writeFileSync(index,'export const chromium={launch:async()=>"changed"};\n');
 await assert.rejects(()=>loadPinnedRecurringChromium(pinned),'changed installed dependency refused');
}finally{for(const path of dirs)rmSync(path,{recursive:true});}
console.log('PASS recurring Chromium stage pure single-writer, private receipt and failure cleanup contracts');
