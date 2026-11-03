import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,readFileSync,rmSync,statSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {assertRecurringBrowserStageParent,loadPinnedRecurringChromium,recurringBrowserEvidenceDir,
 recurringBrowserProcessIdentity,runRecurringChromiumConfirmationStage} from './static-weekly-recurring-browser-stage.mjs';

const parent=process.ppid,lease=parent+1000;
const makeEnv=directory=>({CUSTODIAL_RECURRING_BROWSER_STAGE_PARENT_PID:String(parent),
 CUSTODIAL_RECURRING_BROWSER_LEASE_PARENT_PID:String(lease),
 CUSTODIAL_RECURRING_BROWSER_EVIDENCE_DIR:directory,
 CUSTODIAL_RECURRING_BROWSER_RUN_ID:'a'.repeat(32)});
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
let contextsClosed=0,browsersClosed=0,serversClosed=0,launched=0,contextsCreated=0;
const identity={pid:444,startTicks:'123',processGroup:222,
 bootId:'synthetic-boot',uid:process.getuid(),executable:'/synthetic/chromium'};
let alive=true;
const readIdentity=()=>alive?identity:null;
const browser={browserType:()=>({name:()=> 'chromium'}),contexts:()=>[],
 async newContext(options){contextsCreated++;assert.deepEqual(options,{serviceWorkers:'block',acceptDownloads:false,permissions:[]});
  return {pages:()=>[],async close(){contextsClosed++;}};},
 async close(){browsersClosed++;}};
const server={process:()=>({pid:444}),wsEndpoint:()=> 'ws://127.0.0.1:45454/fresh',
 async close(){serversClosed++;alive=false;},async kill(){serversClosed++;alive=false;}};
const chromium={async launchServer(options){launched++;
 assert.equal(options.headless,true);assert.equal(options.host,'127.0.0.1');assert.equal(options.port,0);
 assert.equal(options.env.CUSTODIAL_RECURRING_BROWSER_RUN_ID,'a'.repeat(32));alive=true;return server;},
 async connect(endpoint){assert.equal(endpoint,server.wsEndpoint());return browser;}};
try{
 assert.equal(recurringBrowserProcessIdentity(process.pid)?.pid,process.pid);
 assert.equal(recurringBrowserProcessIdentity(999999999),null);
 const good=directory();
 assert.equal(recurringBrowserEvidenceDir(makeEnv(good)),good);
 const returned=await runRecurringChromiumConfirmationStage({...fixtureArgs,env:makeEnv(good),chromium,
  actualParentPid:parent,emit:message=>events.push(message),readIdentity,
  runFixture:async args=>{assert.equal(args.pool,fixtureArgs.pool);assert.equal(args.week,fixtureArgs.week);
   assert.equal(args.originalManagerId,fixtureArgs.originalManagerId);return{synthetic:true};}});
 assert.deepEqual(returned,{synthetic:true});
 assert.deepEqual(events,['BROWSER_TRANSPORT_STAGE_ENTERED','BROWSER_TRANSPORT_STAGE_CLEANUP']);
 assert.deepEqual([launched,contextsCreated,contextsClosed,browsersClosed,serversClosed],[1,1,1,1,1]);
 const start=JSON.parse(readFileSync(join(good,'browser-stage-start.json')));
 const cleanup=JSON.parse(readFileSync(join(good,'browser-stage-cleanup.json')));
 assert.deepEqual([start.stageParentPid,start.leaseParentPid,start.childPid],[parent,lease,process.pid]);
 assert.deepEqual([cleanup.launched,cleanup.contextCreated,cleanup.contextClosed,cleanup.browserClosed,
  cleanup.serverClosed,cleanup.processIdentityRecorded,cleanup.processGone,
  cleanup.remainingContexts,cleanup.fixtureReturned],[true,true,true,true,true,true,true,0,true]);
 assert.equal(JSON.parse(readFileSync(join(good,'browser-process.json'))).runId,'a'.repeat(32));
 assert.equal(statSync(join(good,'browser-process.json')).mode&0o777,0o600);

 const next=directory();
 await runRecurringChromiumConfirmationStage({...fixtureArgs,
  env:{...makeEnv(next),STATIC_WEEKLY_TEST_CURRENT_219:'1'},chromium,
  actualParentPid:parent,emit:()=>{},readIdentity,runFixture:async()=>({synthetic219:true})});
 assert.equal(JSON.parse(readFileSync(join(next,'browser-stage-start.json'))).source,
  'current-manager-219-single-confirmation');
 assert.equal(statSync(join(good,'browser-stage-cleanup.json')).mode&0o777,0o600);

 const thrown=directory(),original=new Error('original fixture failure');
 await assert.rejects(()=>runRecurringChromiumConfirmationStage({...fixtureArgs,env:makeEnv(thrown),chromium,
  actualParentPid:parent,emit:()=>{},readIdentity,
  runFixture:async()=>{throw original;}}),error=>error===original);
 assert.equal(JSON.parse(readFileSync(join(thrown,'browser-stage-cleanup.json'))).fixtureReturned,false);
 assert.deepEqual([contextsClosed,browsersClosed],[3,3]);

 const launchFailure=directory(),launchError=new Error('synthetic launch refusal');
 await assert.rejects(()=>runRecurringChromiumConfirmationStage({...fixtureArgs,env:makeEnv(launchFailure),
  chromium:{async launchServer(){throw launchError;}},actualParentPid:parent,emit:()=>{},
  runFixture:async()=>assert.fail()}),
  error=>error===launchError);
 const refused=JSON.parse(readFileSync(join(launchFailure,'browser-stage-cleanup.json')));
 assert.deepEqual([refused.launched,refused.contextCreated,refused.fixtureReturned],[false,false,false]);

 const partial=directory(),connectError=new Error('synthetic connection refusal');
 await assert.rejects(()=>runRecurringChromiumConfirmationStage({...fixtureArgs,env:makeEnv(partial),
  chromium:{...chromium,async connect(){throw connectError;}},actualParentPid:parent,emit:()=>{},readIdentity,
  runFixture:async()=>assert.fail()}),error=>error===connectError);
 const partialReceipt=JSON.parse(readFileSync(join(partial,'browser-stage-cleanup.json')));
 assert.equal(partialReceipt.serverClosed,true);
 assert.equal(partialReceipt.processGone,true);
 assert.equal(partialReceipt.contextCreated,false);

 const wrongIdentity=directory();
 await assert.rejects(()=>runRecurringChromiumConfirmationStage({...fixtureArgs,env:makeEnv(wrongIdentity),
  chromium,actualParentPid:parent,emit:()=>{},readIdentity:()=>({...identity,startTicks:'0',pid:445}),
  runFixture:async()=>assert.fail()}),/fresh owned Chromium process identity required/);
 assert.equal(JSON.parse(readFileSync(join(wrongIdentity,'browser-stage-cleanup.json'))).serverClosed,true);

 const cleanupThrown=directory(),first=new Error('fixture first');
 const badServer={...server,async close(){serversClosed++;alive=false;throw new Error('cleanup second');}};
 await assert.rejects(()=>runRecurringChromiumConfirmationStage({...fixtureArgs,env:makeEnv(cleanupThrown),
  chromium:{...chromium,async launchServer(){alive=true;return badServer;}},actualParentPid:parent,
  emit:()=>{},readIdentity,runFixture:async()=>{throw first;}}),error=>error===first);

 const emitThrown=directory(),firstEmit=new Error('fixture before cleanup emitter');
 await assert.rejects(()=>runRecurringChromiumConfirmationStage({...fixtureArgs,env:makeEnv(emitThrown),
  chromium,actualParentPid:parent,readIdentity,
  emit:message=>{if(message==='BROWSER_TRANSPORT_STAGE_CLEANUP')throw new Error('emitter later');},
  runFixture:async()=>{throw firstEmit;}}),error=>error===firstEmit);

 const denied=directory();
 await assert.rejects(()=>runRecurringChromiumConfirmationStage({...fixtureArgs,env:makeEnv(denied),
  chromium,actualParentPid:parent+1,emit:()=>{},runFixture:async()=>assert.fail()}));
 assert.equal(launched,6,'invalid parent refuses before browser launch');
 assert.throws(()=>recurringBrowserEvidenceDir({...makeEnv(denied),CUSTODIAL_RECURRING_BROWSER_EVIDENCE_DIR:'relative'}));

 const fake=directory(),packageDir=join(fake,'node_modules','playwright');
 mkdirSync(packageDir,{recursive:true});
 const index=join(packageDir,'index.mjs'),pkg=join(packageDir,'package.json'),lock=join(fake,'package-lock.json');
 writeFileSync(index,'export const chromium={launchServer:async()=>null,connect:async()=>null};\n');
 writeFileSync(pkg,JSON.stringify({name:'playwright',version:'1.61.1'})+'\n');
 writeFileSync(lock,'{}\n');
 const sha=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
 const pinned={CUSTODIAL_RECURRING_BROWSER_FRONTEND_ROOT:fake,
  CUSTODIAL_RECURRING_BROWSER_PLAYWRIGHT_INDEX_SHA256:sha(index),
  CUSTODIAL_RECURRING_BROWSER_PLAYWRIGHT_PACKAGE_SHA256:sha(pkg),
  CUSTODIAL_RECURRING_BROWSER_PACKAGE_LOCK_SHA256:sha(lock)};
 assert.equal(typeof(await loadPinnedRecurringChromium(pinned)).launchServer,'function');
 await assert.rejects(()=>loadPinnedRecurringChromium({...pinned,
  CUSTODIAL_RECURRING_BROWSER_PLAYWRIGHT_INDEX_SHA256:'0'.repeat(64)}));
 writeFileSync(index,'export const chromium={launchServer:async()=>"changed",connect:async()=>null};\n');
 await assert.rejects(()=>loadPinnedRecurringChromium(pinned),'changed installed dependency refused');
}finally{for(const path of dirs)rmSync(path,{recursive:true});}
console.log('PASS recurring Chromium stage pure single-writer, private receipt and failure cleanup contracts');
