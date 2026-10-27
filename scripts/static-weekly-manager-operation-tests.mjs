import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {beginBoundedManagerRequest,MANAGER_OPERATION_MILLISECONDS,CLEANUP_RESERVE_MILLISECONDS} from './fixtures/static-weekly-manager-operation-before-general-owner.mjs';
import {beginBoundedManagerRequest as beginCurrentBoundedManagerRequest,MANAGER_OPERATION_MILLISECONDS as CURRENT_MANAGER_OPERATION_MILLISECONDS,CLEANUP_RESERVE_MILLISECONDS as CURRENT_CLEANUP_RESERVE_MILLISECONDS} from '../src/static-weekly-manager-operation.js';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

let checks=0;
const same=(actual,expected,label)=>{assert.deepEqual(actual,expected,label);checks++;};
function fixture(path='/static-weekly/recurring-adaptation/confirm',method='POST',begin=beginBoundedManagerRequest){
 let now=100,timer=null,status=null,body=null;
 const req={path,method};
 const res=Object.assign(new EventEmitter(),{headersSent:false,writableEnded:false,writableFinished:false,
  status(value){status=value;return this;},json(value){body=value;this.headersSent=true;this.writableEnded=true;this.writableFinished=true;this.emit('finish');return this;}});
 const context=begin(req,res,{now:()=>now,setTimer:(callback,delay)=>{timer={callback,delay};return timer;},
  clearTimer:(candidate)=>{if(candidate===timer)timer=null;}});
 return{req,res,context,get timer(){return timer;},get status(){return status;},get body(){return body;},
  expire(){now+=MANAGER_OPERATION_MILLISECONDS-CLEANUP_RESERVE_MILLISECONDS;timer.callback();},finish(){res.writableFinished=true;res.emit('finish');}};
}
same(MANAGER_OPERATION_MILLISECONDS,60_000,'one absolute manager request budget');
same(CLEANUP_RESERVE_MILLISECONDS,5_000,'cleanup reserve is inside, not after, the original budget');
for(const [path,method] of [['/static-weekly/recurring-adaptation/confirm','GET'],['/static-weekly/manager-snapshot','POST'],
 ['/static-weekly/recurring-adaptation/preview//','POST'],['/static-weekly/recurring-adaptation/preview-extra','POST']]){
 const f=fixture(path,method);same(f.context,null,'unrelated route gets no hidden timer');same(f.timer,null,'unrelated route has no timer');
}
for(const path of ['/static-weekly/recurring-adaptation/PREVIEW', '/static-weekly/recurring-adaptation/preview/',
 '/static-weekly/recurring-adaptation/CONFIRM', '/static-weekly/recurring-adaptation/confirm/']){
 const f=fixture(path);same(f.context?.deadlineAt,60_100,`Express-equivalent ${path} starts the bounded operation`);
 f.finish();
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
// CURRENT_OWNER_COVERAGE_BEGIN: old28 above are frozen narrowroute history,
// never a claim about current broad static-weekly/approved-reader admission.
let currentChecks=0;const currentSame=(actual,expected,label)=>{assert.deepEqual(actual,expected,label);currentChecks++;};
const sourceSha=path=>createHash('sha256').update(readFileSync(new URL(path,import.meta.url))).digest('hex');
currentSame(sourceSha('./fixtures/static-weekly-manager-operation-before-general-owner.mjs'),'74510b9c0f65f6ad03e523e7bd7ff5b0d4af859ec8939044781bfce58797c717','exact historical208368 Source');
currentSame(sourceSha('../src/static-weekly-manager-operation.js'),'ae546852ebde937d1b75f2cb6db35cdfcdc8aea3bc44e5da400076e995e8a32f','exact current general owner Source');
currentSame(CURRENT_MANAGER_OPERATION_MILLISECONDS,60000,'same absolute owner budget');currentSame(CURRENT_CLEANUP_RESERVE_MILLISECONDS,5000,'same interior cleanup reserve');
for(const path of ['/static-weekly/manager-snapshot','/static-weekly/recurring-adaptation/preview//','/static-weekly/recurring-adaptation/preview-extra','/static-weekly/approved-initial/confirm','/static-weekly/staffing-commands/confirm']){
 const f=fixture(path,'POST',beginCurrentBoundedManagerRequest);currentSame(f.context.deadlineAt,60100,'all static-weekly POST starts at original ingress');currentSame(f.context.readOnly,false,'POST is not a readonly owner');currentSame(f.timer.delay,55000,'same reserve');f.finish();currentSame(f.timer,null,'normal completion clears exact timer');
}
for(const path of ['/static-weekly/APPROVED-INITIAL/selection/','/static-weekly/approved-initial/confirmations/owned-original','/static-weekly/recurring-adaptation/confirmations/owned-original','/static-weekly/staffing-commands','/static-weekly/staffing-commands/owned-original']){
 const f=fixture(path,'GET',beginCurrentBoundedManagerRequest);currentSame(f.context.deadlineAt,60100,'approved original reader shares same ingress budget');currentSame(f.context.readOnly,true,'actual approved GET owner is readonly');f.finish();currentSame(f.timer,null,'reader finish clears timer');
}
for(const [path,method]of [['/outside/static-weekly','POST'],['/static-weekly/manager-snapshot','GET'],['/static-weekly/approved-initial/selection-extra','GET'],['/static-weekly/approved-initial/confirmations/','GET']]){
 const f=fixture(path,method,beginCurrentBoundedManagerRequest);currentSame(f.context,null,'unrelated current route gets no owner');currentSame(f.timer,null,'unrelated current route gets no timer');
}
{
 const f=fixture('/static-weekly/approved-initial/selection','GET',beginCurrentBoundedManagerRequest);f.expire();currentSame(f.context.signal.aborted,true,'readonly wait aborts at original deadline');currentSame(f.status,503,'expired prelease readonly work unavailable');currentSame(f.body.code,'static_weekly_recurring_operation_deadline_exceeded','typed deadline unchanged');currentSame(f.timer,null,'expired response clears timer');
}
{
 const f=fixture('/static-weekly/staffing-commands/confirm','POST',beginCurrentBoundedManagerRequest);f.req.restoreMutationLease={signal:new AbortController().signal};f.expire();currentSame(f.context.signal.aborted,true,'current leased POST receives abort');currentSame(f.status,null,'same cleanup ordering avoids early lease release');f.finish();currentSame(f.timer,null,'settled current lease clears timer');
}
{
 const f=fixture('/static-weekly/manager-snapshot','POST',beginCurrentBoundedManagerRequest);f.res.emit('close');currentSame(f.context.signal.aborted,true,'current premature close aborts original owner');currentSame(f.timer,null,'close clears owned timer');
}
// CURRENT_OWNER_COVERAGE_END
console.log(JSON.stringify({status:'PASS',checks,currentChecks,currentOwnerSourceSha256:sourceSha('../src/static-weekly-manager-operation.js'),historicalOwnerSourceSha256:sourceSha('./fixtures/static-weekly-manager-operation-before-general-owner.mjs'),scope:'original28 frozen208368 route cases plus actual current allPOST/approvedGET ingress/cleanup; no HTTP/SQL/solver'}));
