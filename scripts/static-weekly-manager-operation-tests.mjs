import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {beginBoundedManagerRequest,MANAGER_OPERATION_MILLISECONDS,CLEANUP_RESERVE_MILLISECONDS} from '../src/static-weekly-manager-operation.js';

let checks=0;
const same=(actual,expected,label)=>{assert.deepEqual(actual,expected,label);checks++;};
function fixture(path='/static-weekly/recurring-adaptation/confirm',method='POST'){
 let now=100,timer=null,status=null,body=null;
 const req={path,method};
 const res=Object.assign(new EventEmitter(),{headersSent:false,writableEnded:false,writableFinished:false,
  status(value){status=value;return this;},json(value){body=value;this.headersSent=true;this.writableEnded=true;this.writableFinished=true;this.emit('finish');return this;}});
 const context=beginBoundedManagerRequest(req,res,{now:()=>now,setTimer:(callback,delay)=>{timer={callback,delay};return timer;},
  clearTimer:(candidate)=>{if(candidate===timer)timer=null;}});
 return{req,res,context,get timer(){return timer;},get status(){return status;},get body(){return body;},
  expire(){now+=MANAGER_OPERATION_MILLISECONDS-CLEANUP_RESERVE_MILLISECONDS;timer.callback();},finish(){res.writableFinished=true;res.emit('finish');}};
}
same(MANAGER_OPERATION_MILLISECONDS,60_000,'one absolute manager request budget');
same(CLEANUP_RESERVE_MILLISECONDS,5_000,'cleanup reserve is inside, not after, the original budget');
for(const [path,method] of [['/static-weekly/recurring-adaptation/confirm','GET'],['/static-weekly/manager-snapshot','POST']]){
 const f=fixture(path,method);same(f.context,null,'unrelated route gets no hidden timer');same(f.timer,null,'unrelated route has no timer');
}
{
 const f=fixture();same(f.context.deadlineAt,60_100,'origin is captured before later middleware');
 same(f.timer.delay,55_000,'request abort leaves bounded cleanup time inside the same minute');
 same(f.req.staticWeeklyManagerOperation,f.context,'middleware carries exact signal and deadline');
 f.expire();same(f.context.signal.aborted,true,'expired pre-lease request aborts');
 same(f.status,503,'expired body/lease wait gets truthful unavailability');
 same(f.body.code,'static_weekly_recurring_operation_deadline_exceeded','error code remains typed');
 same(f.timer,null,'completed response clears owned timer');
}
{
 const f=fixture('/static-weekly/recurring-adaptation/preview');f.req.restoreMutationLease={signal:new AbortController().signal};
 f.expire();same(f.context.signal.aborted,true,'active lease receives abort');
 same(f.status,null,'timer does not send a response that could release an active lease before awaited work settles');
 f.finish();same(f.timer,null,'natural settlement clears timer');
}
{
 const f=fixture();f.finish();same(f.timer,null,'normal finish clears timer before its callback can fire');
 same(f.context.signal.aborted,false,'successful request is not retroactively aborted');
}
{
 const f=fixture();f.res.emit('close');same(f.context.signal.aborted,true,'premature close aborts caller work');
 same(f.timer,null,'closed response clears owned timer');
}
console.log(JSON.stringify({status:'PASS',checks,scope:'pure first-middleware request origin and fail-closed timeout; no HTTP/SQL/solver'}));
