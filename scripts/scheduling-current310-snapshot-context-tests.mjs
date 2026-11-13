import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {beginBoundedManagerRequest} from '../src/static-weekly-manager-operation.js';
let checks=0;
function request(path,method='GET'){
 const req={path,method,complete:true},res=new EventEmitter();let timer=null;
 res.status=code=>{res.code=code;return res;};res.json=body=>{res.body=body;res.emit('finish');};
 const context=beginBoundedManagerRequest(req,res,{now:()=>100,setTimer:(fn,delay)=>{timer={fn,delay,unref(){}};return timer;},clearTimer:()=>{timer=null;}});
 return{req,res,context,get timer(){return timer;}};
}
for(const path of ['/static-weekly/manager-snapshot','/static-weekly/MANAGER-SNAPSHOT/']){
 const f=request(path);assert.equal(f.context.readOnly,true);assert.equal(f.context.deadlineAt,60100);assert.equal(f.timer.delay,55000);
 assert.equal(f.req.restoreMutationLease,undefined);f.res.emit('finish');assert.equal(f.timer,null);checks++;
}
for(const path of ['/static-weekly/manager-snapshot-extra','/static-weekly/manager-snapshot/extra']){
 const f=request(path);assert.equal(f.context,null);assert.equal(f.timer,null);checks++;
}
{const f=request('/static-weekly/manager-snapshot');f.timer.fn();assert.equal(f.context.signal.aborted,true);assert.equal(f.res.code,503);assert.equal(f.res.body.code,'static_weekly_recurring_operation_deadline_exceeded');assert.equal(f.timer,null);checks++;}
{const f=request('/static-weekly/manager-snapshot');f.res.emit('close');assert.equal(f.context.signal.aborted,true);assert.equal(f.timer,null);checks++;}
{const f=request('/static-weekly/staffing-commands/owned/confirm','POST');assert.equal(f.context.readOnly,false);assert.equal(f.context.deadlineAt,60100);f.res.emit('finish');assert.equal(f.timer,null);checks++;}
console.log(JSON.stringify({schema:'custodial.scheduling-snapshot-context-regression.v1',checks,passed:true,actualSqlAndBrowserProof:'separate S25 joined consumer'}));
