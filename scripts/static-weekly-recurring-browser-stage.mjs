import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,realpathSync,lstatSync,openSync,writeSync,closeSync} from 'node:fs';
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
 assert.equal(typeof module.chromium?.launch,'function','installed Chromium launcher');
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

// Called once at the existing confirmation assignment, never after the direct
// or Node HTTP variant. The lease stays in the supported parent process.
export async function runRecurringChromiumConfirmationStage({pool,week,originalManagerId,check,
 env=process.env,chromium=null,runFixture=runRecurringBrowserTransportSqlFixture,
 actualParentPid=process.ppid,emit=message=>writeSync(1,message+'\n')}) {
 const pids=assertRecurringBrowserStageParent(env,actualParentPid);
 const evidence=recurringBrowserEvidenceDir(env);
 const launcher=chromium??await loadPinnedRecurringChromium(env);
 privateJson(join(evidence,'browser-stage-start.json'),{schema:'custodial.synthetic-browser-stage-start.v1',
  ...pids,childPid:process.pid,source:'current-manager-218-single-confirmation',production:false});
 emit('BROWSER_TRANSPORT_STAGE_ENTERED');
 let browser=null,context=null,result,primary=null,cleanupFailure=null,contextClosed=false,browserClosed=false;
 try{
  browser=await launcher.launch({headless:true});
  assert.equal(browser.browserType().name(),'chromium','only isolated Chromium is supported');
  context=await browser.newContext({serviceWorkers:'block',acceptDownloads:false,permissions:[]});
  assert.deepEqual(context.pages(),[],'isolated browser context must start empty');
  result=await runFixture({context,pool,week,originalManagerId,check});
 }catch(error){primary=error;}
 try{if(context){await context.close();contextClosed=true;}}catch(error){cleanupFailure=error;}
 try{if(browser){await browser.close();browserClosed=true;}}catch(error){cleanupFailure??=error;}
 const remainingContexts=browserClosed?0:browser?.contexts?.().length??0;
 try{privateJson(join(evidence,'browser-stage-cleanup.json'),{
  schema:'custodial.synthetic-browser-stage-cleanup.v1',...pids,childPid:process.pid,
  launched:browser!==null,contextCreated:context!==null,contextClosed,browserClosed,
  remainingContexts,fixtureReturned:primary===null,cleanupErrorClass:cleanupFailure?.name??null,
  production:false,phoneAccessed:false,sharedUserBrowserAccessed:false});}
 catch(error){cleanupFailure??=error;}
 emit('BROWSER_TRANSPORT_STAGE_CLEANUP');
 if(primary)throw primary;
 if(cleanupFailure)throw cleanupFailure;
 assert.ok(browserClosed&&contextClosed&&remainingContexts===0,'isolated Chromium cleanup required');
 return result;
}
