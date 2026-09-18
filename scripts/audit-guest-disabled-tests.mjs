import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
const text=fs.readFileSync((process.argv[2]||process.cwd())+'/src/index.js','utf8');
let source='';if(text.includes('async function assertGuestNotificationAllowed(')) source=text.slice(text.indexOf('async function assertGuestNotificationAllowed('),text.indexOf('async function processGuestCleanlinessNotificationJob('));
source+=text.slice(text.indexOf('async function processGuestCleanlinessNotificationJob('),text.indexOf('async function runOperationalNotificationWorker('));
async function run(enabled,dbEnabled=true,switchOff=false){let dispatch=0,reportReads=0,gateReads=0;const flag={enabled};
 const c={GUEST_FEATURE:flag,sqlLiteral:x=>"'"+x+"'",isUuid:()=>true,
  getGuestCleanlinessReportById:async()=>{reportReads++;if(switchOff)flag.enabled=false;return {status:'open',marketing_review_status:'approved',location_code:'NOCX'};},
  runReadOnlySql:async sql=>{if(sql.includes('guest_issues_feature_approved')){gateReads++;return [{approved:dbEnabled}];}if(sql.includes('memphis_user_id'))return [{memphis_user_id:'fixture'}];return [{}];},
  resolveOpsManagerRecipients:async()=>['manager'],notifyGuestReportRecipients:async()=>{dispatch++;return {ops_count:1,errors:[]};}};
 vm.createContext(c);vm.runInContext(source,c);let error=null;
 try{await c.processGuestCleanlinessNotificationJob({source_id:'fixture'});}catch(e){error=e.code||e.message;}
 return {dispatch,reportReads,gateReads,error};
}
const tests=[];async function check(name,fn){try{await fn();tests.push({name,passed:true});}catch(e){tests.push({name,passed:false,error:e.message});}}
await check('environment feature OFF cannot dispatch an old approved report',async()=>{const r=await run(false);assert.equal(r.dispatch,0);assert.equal(r.reportReads,0);});
await check('database feature OFF cannot dispatch',async()=>{const r=await run(true,false);assert.equal(r.dispatch,0);});
await check('a disable between preparation and delivery is checked again',async()=>{const r=await run(true,true,true);assert.equal(r.dispatch,0);});
await check('both approvals permit the already approved report',async()=>{const r=await run(true,true);assert.equal(r.dispatch,1);assert.ok(r.gateReads>=2);});
console.log(JSON.stringify({scope:'Actual guest-job function, synthetic approval/dispatch boundaries; no notification sent',passed:tests.filter(t=>t.passed).length,failed:tests.filter(t=>!t.passed).length,tests},null,2));process.exitCode=tests.some(t=>!t.passed)?1:0;
