import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {beginBoundedManagerRequest,MANAGER_OPERATION_MILLISECONDS,CLEANUP_RESERVE_MILLISECONDS,
 INITIAL_MANUAL_ACTIVATION_MILLISECONDS,initialManualActivationWorkerDeadline} from '../src/static-weekly-manager-operation.js';
import {createStaticWeeklyControlPlane,STATIC_WEEKLY_DATABASE_OPERATION_STATEMENT_TIMEOUT_MS} from '../src/static-weekly-control-plane.js';
let checks=0;const eq=(a,b,m)=>{assert.deepEqual(a,b,m);checks++;};
eq(MANAGER_OPERATION_MILLISECONDS,60000);eq(CLEANUP_RESERVE_MILLISECONDS,5000);eq(INITIAL_MANUAL_ACTIVATION_MILLISECONDS,120000);
eq(STATIC_WEEKLY_DATABASE_OPERATION_STATEMENT_TIMEOUT_MS,60000,'SQL maximum is unchanged');
function fixture(path,method='POST'){
 let clock=100,timer,cleared=false;const req={path,method,complete:true,body:{timeout:900000},headers:{'x-timeout':'900000'}};
 const res=Object.assign(new EventEmitter(),{headersSent:false,writableEnded:false,writableFinished:false,status(n){this.code=n;return this;},json(v){this.body=v;this.writableEnded=true;this.emit('finish');return this;}});
 const ctx=beginBoundedManagerRequest(req,res,{now:()=>clock,setTimer:(fn,ms)=>(timer={fn,ms}),clearTimer:t=>{assert.equal(t,timer);cleared=true;}});
 return{req,res,ctx,get timer(){return timer;},get cleared(){return cleared;},expire(){clock+=timer.ms;timer.fn();}};
}
for(const path of ['/static-weekly/manual-activation/confirm','/STATIC-WEEKLY/MANUAL-ACTIVATION/CONFIRM/']){
 const f=fixture(path);eq(f.ctx.deadlineAt,120100);eq(f.timer.ms,115000);eq(f.ctx.readOnly,false);
 f.expire();eq(f.ctx.signal.aborted,true);eq(f.res.code,503);eq(f.res.body.code,'static_weekly_recurring_operation_deadline_exceeded');eq(f.cleared,true);
}
for(const path of ['/static-weekly/manual-activation/preview','/static-weekly/manual-activation/confirm//','/static-weekly/manual-activation/confirm-extra','/static-weekly/approved-initial/confirm','/static-weekly/recurring-adaptation/confirm','/static-weekly/manager-snapshot','/static-weekly/staffing-commands/confirm']){
 const f=fixture(path);eq(f.ctx.deadlineAt,60100,path);eq(f.timer.ms,55000);f.res.emit('finish');eq(f.cleared,true);
}
for(const path of ['/static-weekly/manual-activation/roster','/static-weekly/manual-activation/outcome']){
 const f=fixture(path,'GET');eq(f.ctx.deadlineAt,60100);eq(f.ctx.readOnly,true);f.res.emit('finish');
}
for(const method of ['GET','PUT','DELETE'])eq(fixture('/static-weekly/manual-activation/confirm',method).ctx,null,'wrong method cannot select larger owner');
{
 const f=fixture('/static-weekly/manual-activation/confirm');f.req.restoreMutationLease={signal:new AbortController().signal};f.expire();
 eq(f.ctx.signal.aborted,true);eq(f.res.code,undefined,'leased operation must settle, not release early by answering');f.res.emit('finish');eq(f.cleared,true);
}
{
 const f=fixture('/static-weekly/manual-activation/confirm');f.res.emit('close');eq(f.ctx.signal.aborted,true);eq(f.cleared,true);
}
{
 const f=fixture('/static-weekly/manual-activation/confirm');f.res.writableFinished=true;f.res.emit('finish');eq(f.ctx.signal.aborted,false);eq(f.cleared,true);
}
for(const [deadline,now,wanted] of [[120000,1000,61000],[120000,70000,115000],[120000,114999,115000],[120000,116000,115000],[40000,10000,35000]])
 eq(initialManualActivationWorkerDeadline(deadline,now),wanted,'worker receives <=60s and original cleanup edge, never fresh parent budget');
// Execute actual factory deadline enforcement and transaction cleanup. SQL is
// a recording stub; this does not claim successful activation or live effects.
const manager={manager_id:'10000000-0000-4000-8000-000000000001',manager_display_name:'Synthetic Owner',read_only:false};
const input={manager,packetId:'20000000-0000-4000-8000-000000000002',expectedRevision:19,previewDigest:'a'.repeat(64),idempotencyKey:'synthetic-original-once'};
const originalDescriptor=Object.getOwnPropertyDescriptor(performance,'now');let now=0;
Object.defineProperty(performance,'now',{configurable:true,value:()=>now});
try{
 for(const [contextDeadline,advance,wanted] of [[120000,70000,'fixture_stop'],[60000,70000,'static_weekly_recurring_operation_deadline_exceeded'],[999000,121000,'static_weekly_recurring_operation_deadline_exceeded']]){
  now=0;const queries=[];let releases=0;
  const client=Object.assign(new EventEmitter(),{release(){releases++;},async query(sql){queries.push(sql);if(sql==='begin'){now=advance;return {rows:[]};}
   if(sql.startsWith('select public.static_weekly_read_manual_activation_confirmation'))throw Object.assign(Error('fixture stop after deadline admission'),{code:'fixture_stop'});
   return {rows:[]};}});
  const plane=createStaticWeeklyControlPlane({database:{connect:async()=>client},initializeCompiler:async()=>{},shutdownCompiler:async()=>{}});
  await assert.rejects(plane.activateApprovedManualSchedule({...input,signal:new AbortController().signal,deadlineAt:contextDeadline}),e=>e.code===wanted);checks++;
  eq(queries.includes('commit'),false);eq(queries.includes('rollback'),true);eq(releases,1);
  const timeouts=queries.filter(q=>q.startsWith('set local statement_timeout')).map(q=>Number(q.match(/'(\d+)ms'/)[1]));
  eq(timeouts.every(n=>n>0&&n<=60000),true);if(wanted==='fixture_stop')eq(timeouts.includes(50000),true,'factory permits initial work beyond60s within original120s');
 }
}finally{if(originalDescriptor)Object.defineProperty(performance,'now',originalDescriptor);else delete performance.now;}
console.log(JSON.stringify({status:'PASS',checks,scope:'actual ingress, exact initial factory and original remaining SQL budget, compiler deadline adapter; fake clocks/SQL only; no live activation'}));
