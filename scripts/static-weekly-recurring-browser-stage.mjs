import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,realpathSync,lstatSync,statSync,openSync,writeSync,closeSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {runRecurringBrowserTransportSqlFixture} from './static-weekly-recurring-browser-transport.mjs';

const sha=file=>createHash('sha256').update(readFileSync(file)).digest('hex');

export function assertRecurringBrowserStageParent(env,actualParentPid=process.ppid) {
 const stage=Number(env.CUSTODIAL_RECURRING_BROWSER_STAGE_PARENT_PID);
 const lease=Number(env.CUSTODIAL_RECURRING_BROWSER_LEASE_PARENT_PID);
 assert.ok(Number.isSafeInteger(stage)&&stage>1&&stage===actualParentPid,
  'browser SQL child must be the exact test stage child');
 assert.ok(Number.isSafeInteger(lease)&&lease>1&&lease!==stage,
  'browser SQL stage requires distinct live guarded lease parent');
 return {stageParentPid:stage,leaseParentPid:lease};
}

export async function loadPinnedRecurringChromium(env) {
 const frontend=env.CUSTODIAL_RECURRING_BROWSER_FRONTEND_ROOT;
 assert.ok(typeof frontend==='string'&&frontend.startsWith('/'),'explicit installed frontend source required');
 const root=realpathSync(frontend);
 assert.equal(root,frontend,'frontend source path must be resolved');
 const index=join(root,'node_modules/playwright/index.mjs');
 const packageFile=join(root,'node_modules/playwright/package.json');
 const lock=join(root,'package-lock.json');
 for(const file of [index,packageFile,lock])assert.equal(realpathSync(file),file,'Playwright dependency path changed');
 for(const [file,key] of [[index,'CUSTODIAL_RECURRING_BROWSER_PLAYWRIGHT_INDEX_SHA256'],
  [packageFile,'CUSTODIAL_RECURRING_BROWSER_PLAYWRIGHT_PACKAGE_SHA256'],
  [lock,'CUSTODIAL_RECURRING_BROWSER_PACKAGE_LOCK_SHA256']]){
  assert.match(env[key]??'',/^[a-f0-9]{64}$/,'explicit browser dependency SHA required');
  assert.equal(sha(file),env[key],`browser dependency changed: ${key}`);
 }
 const pkg=JSON.parse(readFileSync(packageFile,'utf8'));
 assert.equal(pkg.name,'playwright');assert.equal(pkg.version,'1.61.1','supported installed Playwright version');
 const module=await import(pathToFileURL(index).href);
 assert.equal(typeof module.chromium?.launchServer,'function','installed Chromium server launcher');
 assert.equal(typeof module.chromium?.connect,'function','installed Chromium server connector');
 return module.chromium;
}

export function recurringBrowserEvidenceDir(env) {
 const directory=env.CUSTODIAL_RECURRING_BROWSER_EVIDENCE_DIR;
 assert.ok(typeof directory==='string'&&directory.startsWith('/'),'explicit caller-owned evidence directory required');
 const meta=lstatSync(directory);
 assert.ok(meta.isDirectory()&&!meta.isSymbolicLink(),'browser evidence directory must be real');
 assert.equal(realpathSync(directory),directory,'browser evidence directory must be resolved');
 assert.equal(meta.uid,process.getuid(),'browser evidence directory owner');
 assert.equal(meta.mode&0o077,0,'browser evidence directory must be private');
 return directory;
}

function privateJson(path,value) {
 const fd=openSync(path,'wx',0o600);
 try{writeSync(fd,JSON.stringify(value)+'\n');}finally{closeSync(fd);}
}

export function recurringBrowserProcessIdentity(pid) {
 assert.ok(Number.isSafeInteger(pid)&&pid>1,'owned browser PID');
 let stat;
 try{stat=readFileSync(`/proc/${pid}/stat`,'utf8');}
 catch(error){if(error?.code==='ENOENT')return null;throw error;}
 const end=stat.lastIndexOf(')');
 assert.ok(end>0,'owned browser proc stat');
 const fields=stat.slice(end+2).trim().split(/\s+/);
 const startTicks=fields[19],processGroup=Number(fields[2]);
 assert.match(startTicks??'',/^\d+$/,'owned browser process start ticks');
 assert.ok(Number.isSafeInteger(processGroup)&&processGroup>1,'owned browser process group');
 return {pid,startTicks,processGroup,bootId:readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim(),
  uid:statSync(`/proc/${pid}`).uid,executable:realpathSync(`/proc/${pid}/exe`)};
}

// Called once at the existing confirmation assignment, never after the direct
// or Node HTTP variant. The lease stays in the supported parent process.
export async function runRecurringChromiumConfirmationStage({pool,week,originalManagerId,check,
 env=process.env,chromium=null,runFixture=runRecurringBrowserTransportSqlFixture,
 actualParentPid=process.ppid,emit=message=>writeSync(1,message+'\n'),
 readIdentity=recurringBrowserProcessIdentity}) {
 const pids=assertRecurringBrowserStageParent(env,actualParentPid);
 const evidence=recurringBrowserEvidenceDir(env);
 assert.match(env.CUSTODIAL_RECURRING_BROWSER_RUN_ID??'',/^[a-f0-9]{32}$/,
  'exact synthetic Chromium process marker required');
 const launcher=chromium??await loadPinnedRecurringChromium(env);
 const profile=env.STATIC_WEEKLY_TEST_CURRENT_219==='1'?'current-manager-219':'current-manager-218';
 assert.ok(env.STATIC_WEEKLY_TEST_CURRENT_219!=='1'||env.STATIC_WEEKLY_TEST_CURRENT_218!=='1',
  'only one exact current manager browser profile');
 privateJson(join(evidence,'browser-stage-start.json'),{schema:'custodial.synthetic-browser-stage-start.v1',
  ...pids,childPid:process.pid,source:profile+'-single-confirmation',production:false});
 emit('BROWSER_TRANSPORT_STAGE_ENTERED');
 let browserServer=null,browser=null,context=null,result,primary=null,cleanupFailure=null,
  contextClosed=false,browserClosed=false,serverClosed=false,processIdentity=null;
 try{
  browserServer=await launcher.launchServer({headless:true,host:'127.0.0.1',port:0,
   env:{...process.env,CUSTODIAL_RECURRING_BROWSER_RUN_ID:env.CUSTODIAL_RECURRING_BROWSER_RUN_ID}});
  const processHandle=browserServer.process();
  processIdentity=readIdentity(processHandle?.pid);
  assert.ok(processIdentity&&processIdentity.pid===processHandle?.pid&&
   processIdentity.uid===process.getuid()&&/^\d+$/.test(processIdentity.startTicks??'')&&
   typeof processIdentity.bootId==='string'&&processIdentity.bootId.length>0&&
   typeof processIdentity.executable==='string'&&processIdentity.executable.startsWith('/'),
   'fresh owned Chromium process identity required');
  privateJson(join(evidence,'browser-process.json'),{schema:'custodial.synthetic-browser-process.v1',
   ...pids,stageChildPid:process.pid,runId:env.CUSTODIAL_RECURRING_BROWSER_RUN_ID,
   ...processIdentity,production:false});
  const endpoint=new URL(browserServer.wsEndpoint());
  assert.equal(endpoint.protocol,'ws:','isolated browser server websocket');
  assert.equal(endpoint.hostname,'127.0.0.1','isolated browser server stays on loopback');
  browser=await launcher.connect(browserServer.wsEndpoint());
  assert.equal(browser.browserType().name(),'chromium','only isolated Chromium is supported');
  context=await browser.newContext({serviceWorkers:'block',acceptDownloads:false,permissions:[]});
  assert.deepEqual(context.pages(),[],'isolated browser context must start empty');
  result=await runFixture({context,pool,week,originalManagerId,check});
 }catch(error){primary=error;}
 try{if(context){await context.close();contextClosed=true;}}catch(error){cleanupFailure=error;}
 try{if(browser){await browser.close();browserClosed=true;}}catch(error){cleanupFailure??=error;}
 try{if(browserServer){await browserServer.close();serverClosed=true;}}catch(error){cleanupFailure??=error;}
 if(browserServer&&!serverClosed){
  try{await browserServer.kill();serverClosed=true;}catch(error){cleanupFailure??=error;}
 }
 let processGone=processIdentity===null;
 if(processIdentity){
  for(let attempt=0;attempt<20;attempt++){
   let current;
   try{current=readIdentity(processIdentity.pid);}catch(error){cleanupFailure??=error;break;}
   if(!current){processGone=true;break;}
   if(current.startTicks!==processIdentity.startTicks||current.bootId!==processIdentity.bootId){
    processGone=true;break;
   }
   await new Promise(resolve=>setTimeout(resolve,100));
  }
 }
 let remainingContexts=0;
 if(!browserClosed){
  try{remainingContexts=browser?.contexts?.().length??0;}
  catch(error){remainingContexts=-1;cleanupFailure??=error;}
 }
 try{privateJson(join(evidence,'browser-stage-cleanup.json'),{
  schema:'custodial.synthetic-browser-stage-cleanup.v1',...pids,childPid:process.pid,
  launched:browserServer!==null,contextCreated:context!==null,contextClosed,browserClosed,
  serverClosed,processIdentityRecorded:processIdentity!==null,processGone,
  remainingContexts,fixtureReturned:primary===null,cleanupErrorClass:cleanupFailure?.name??null,
  production:false,phoneAccessed:false,sharedUserBrowserAccessed:false});}
 catch(error){cleanupFailure??=error;}
 try{emit('BROWSER_TRANSPORT_STAGE_CLEANUP');}catch(error){cleanupFailure??=error;}
 if(primary)throw primary;
 if(cleanupFailure)throw cleanupFailure;
 assert.ok(browserClosed&&contextClosed&&serverClosed&&processGone&&remainingContexts===0,
  'isolated Chromium cleanup required');
 return result;
}
