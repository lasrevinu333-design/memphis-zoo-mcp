import assert from 'node:assert/strict';
import express from 'express';
import {assertManualScheduleDeliveryOrigin} from '../src/approved-manual-device-delivery.js';
import {createScheduleRouter} from '../src/schedule-api.js';

// Synthetic identities and authority only. This uses the real HTTP handler,
// validator and Home helper; it never contacts a database, phone or provider.
const id=n=>'97000000-0000-4000-8000-'+String(n).padStart(12,'0');
const employee=id(1),device=id(2),credential=id(3),publication=id(4),projection=id(5),operation=id(6),intent=id(7);
const date='2030-01-06',privateValue='SYNTHETIC_PRIVATE_VALUE_NEVER_LOG';
const assignment={requested_device_id:'KIOSK_08',matched_by:'canonical',canonical_device_pk:device,
  canonical_device_id:'KIOSK_08',device_id:'KIOSK_08',device_name:'Synthetic phone',device_active:true,
  assigned_employee_id:employee,assigned_employee_name:'Synthetic employee',employee_active:true,assignment_epoch:7};
const day={ok:true,governed:true,source:'static_weekly_projection',service_date:date,employee_id:employee,
  employee_name:'Synthetic employee',publication_id:publication,projection_id:projection,projection_status:'current',
  phase:'off_day',schedule_status:'off',shift:null,all_items:[],current_items:[],items:[]};
function valid(){
  const view={schema:'static-weekly.recurring-render-view.v1',service_date:date,employee_id:employee,
    employee_name:'Synthetic employee',publication_id:publication,projection_id:projection,
    projection_status:'current',full_day:true,raw_items:[],shift:null};
  return {schema:'static-weekly.device-schedule-delivery.v1',mode:'RECURRING_SCHEDULE',
    authorityOrigin:{kind:'MANUAL_INITIAL',bindingId:operation},delivery:{intentId:intent,
      target:{schema:'static-weekly.recurring-application-target.v1',targetType:'SCHEDULE',operationId:operation,
        publicationId:publication,projectionId:projection,serviceDate:date,employeeId:employee,
        deviceId:device,credentialId:credential,assignmentEpoch:7,authorityRevision:19},
      view,viewDigest:'b'.repeat(64),targetDigest:'a'.repeat(64),applicationStatus:'PENDING'}};
}
let envelope,calls=[],events=[],sinkThrows=false,rpcThrows=false;
const originalWarn=console.warn;
console.warn=(...args)=>{if(sinkThrows)throw Error('synthetic diagnostic sink failure');events.push(args);};
const read=async sql=>{
  calls.push('read');
  if(sql.includes('from public.device_aliases'))return [structuredClone(assignment)];
  if(sql.includes('static_weekly_v5_read_employee_day'))return [{day:structuredClone(day),data:structuredClone(day)}];
  if(sql.includes('static_weekly_v27_read_home_time_facts')||sql.includes('roster_facts'))return [{facts:null}];
  throw Error('Unexpected synthetic SQL');
};
const runRpc=async name=>{
  calls.push(name);
  if(name==='static_weekly_v24_read_device_schedule_delivery'){
    if(rpcThrows)throw Error('synthetic RPC unavailable');
    return structuredClone(envelope);
  }
  if(name==='static_weekly_v27_issue_recurring_notification_plan')return null;
  throw Error('Unexpected synthetic RPC');
};
const app=express();app.use(express.json());
app.use('/schedule-api',createScheduleRouter({runReadOnlySql:read,runRpc,
  runCommand:async()=>assert.fail('No command permitted'),buildHealthPayload:()=>({ok:true}),
  requireAdminApiAuth:(_q,_s,next)=>next(),requireOpsManagerAuth:(_q,_s,next)=>next(),
  requireDeviceAccess:(req,_res,next)=>{
    req.memphisDevice={canonical_device_id:'KIOSK_08',assigned_employee_id:employee,assignment_epoch:7};
    req.memphisDeviceCredential={credential_id:credential};next();
  },appVersion:'synthetic',releaseId:'synthetic',contractVersion:'synthetic'}));
const server=await new Promise((resolve,reject)=>{
  const s=app.listen(0,'127.0.0.1',()=>resolve(s));s.once('error',reject);
});
const url='http://127.0.0.1:'+server.address().port+'/schedule-api/my-day-summary?device_id=KIOSK_08&service_date='+date;
let cases=0;
async function test(name,fn){await fn();cases++;console.log('PASS '+name);}
async function request(value){
  envelope=value;calls=[];events=[];
  const before=JSON.stringify(value),r=await fetch(url,{signal:AbortSignal.timeout(5000)}),body=await r.json();
  assert.equal(JSON.stringify(value),before,'diagnostics never change source envelope');
  return {status:r.status,body};
}
const expectedBody={ok:false,code:'manual_device_delivery_unavailable',error:'Exact manual schedule delivery authority is unavailable.'};
const mutations=[
  ['ORIGIN_SHAPE',e=>e.authorityOrigin.private=privateValue],
  ['ORIGIN_KIND',e=>e.authorityOrigin.kind=privateValue],
  ['BINDING_ID',e=>e.authorityOrigin.bindingId=privateValue],
  ['DELIVERY_MODE',e=>e.mode='LEGACY_REGISTERED'],
  ['TARGET_MISSING',e=>e.delivery=null],
  ['TARGET_TYPE',e=>e.delivery.target.targetType=privateValue],
  ['OPERATION_MISMATCH',e=>e.delivery.target.operationId=privateValue],
];
try{
  for(const [reason,mutate] of mutations)await test(reason+' preserves strict refusal and emits only finite server fields',async()=>{
    const e=valid();mutate(e);const before=JSON.stringify(e);
    assert.throws(()=>assertManualScheduleDeliveryOrigin(e),error=>{
      assert.equal(error.code,'manual_device_delivery_unavailable');assert.equal(error.status,503);
      assert.equal(error.deliveryDiagnostic,reason);
      assert.deepEqual(Object.keys(error).sort(),['code','deliveryDiagnostic','status']);return true;
    });
    assert.equal(JSON.stringify(e),before);
    const r=await request(e);assert.equal(r.status,503);assert.deepEqual(r.body,expectedBody);
    assert.equal(calls.length,2,'refusal precedes fallback and optional readers');assert.equal(events.length,1);
    assert.equal(events[0].length,1);const log=JSON.parse(events[0][0]);
    assert.deepEqual(Object.keys(log).sort(),['event','intent_present','pending_target','reason','target_present']);
    assert.equal(log.event,'custodial_schedule_delivery_refused');assert.equal(log.reason,reason);
    for(const key of ['intent_present','pending_target','target_present'])assert.equal(typeof log[key],'boolean');
    for(const value of [privateValue,employee,device,credential,publication,projection,operation,intent,date,'KIOSK_08'])
      assert.ok(!events[0][0].includes(value),'no private/request/identity value in log');
  });
  await test('manual pending target identifies missing target without treating it as OFF',async()=>{
    const e=valid();e.delivery={applicationStatus:'PENDING_TARGET_RECONCILIATION',affectedPhonesUpdated:false};
    const r=await request(e);assert.equal(r.status,503);assert.deepEqual(r.body,expectedBody);
    assert.deepEqual(JSON.parse(events[0][0]),{event:'custodial_schedule_delivery_refused',reason:'TARGET_MISSING',target_present:false,intent_present:false,pending_target:true});
  });
  await test('recurring pending target retains first invalid binding reason and missing-target booleans',async()=>{
    const e=valid();e.authorityOrigin={kind:'RECURRING_CONFIRMATION',bindingId:null};
    e.delivery={applicationStatus:'PENDING_TARGET_RECONCILIATION',affectedPhonesUpdated:false};
    const r=await request(e);assert.equal(r.status,503);assert.deepEqual(r.body,expectedBody);
    assert.deepEqual(JSON.parse(events[0][0]),{event:'custodial_schedule_delivery_refused',reason:'BINDING_ID',target_present:false,intent_present:false,pending_target:true});
  });
  for(const kind of ['MANUAL_INITIAL','RECURRING_CONFIRMATION'])await test(kind+' exact empty current target succeeds with no refusal event',async()=>{
    const e=valid();e.authorityOrigin.kind=kind;assert.equal(assertManualScheduleDeliveryOrigin(e),e);
    const r=await request(e);assert.equal(r.status,200);assert.equal(r.body.data.home_facts.phase,'off_day');
    assert.equal(r.body.data.recurring_delivery.applicationStatus,'PENDING');assert.deepEqual(events,[]);
    assert.ok(!calls.some(x=>x.includes('ack')),'read does not fake device acknowledgment');
  });
  await test('unavailable authority remains unavailable without an origin refusal event',async()=>{
    const r=await request({schema:'static-weekly.device-schedule-delivery.v1',mode:'UNAVAILABLE',delivery:null});
    assert.equal(r.status,503);assert.equal(r.body.code,'schedule_request_failed');assert.deepEqual(events,[]);assert.equal(calls.length,2);
  });
  await test('missing origin does not promote a pending target or create a diagnostic event',async()=>{
    const e=valid();delete e.authorityOrigin;e.delivery={applicationStatus:'PENDING_TARGET_RECONCILIATION'};
    const r=await request(e);assert.equal(r.status,503);assert.equal(r.body.code,'schedule_request_failed');assert.deepEqual(events,[]);
  });
  await test('invalid RPC schema is refused before origin diagnostics',async()=>{
    const e=valid();e.schema='wrong';const r=await request(e);assert.equal(r.status,503);assert.equal(r.body.code,'schedule_request_failed');assert.deepEqual(events,[]);
  });
  await test('RPC unavailability is not relabeled as an origin refusal',async()=>{
    rpcThrows=true;try{const r=await request(valid());assert.equal(r.status,400);assert.equal(r.body.code,'schedule_request_failed');assert.deepEqual(events,[]);}finally{rpcThrows=false;}
  });
  await test('failed diagnostic sink cannot replace original C08 refusal or enable fallback',async()=>{
    sinkThrows=true;try{const e=valid();e.delivery=null;const r=await request(e);assert.equal(r.status,503);assert.deepEqual(r.body,expectedBody);assert.equal(calls.length,2);}finally{sinkThrows=false;}
  });
  console.log(JSON.stringify({status:'PASS',cases,actualHTTP:true,authSQLRPC:'explicit synthetic ports',SQL_executed:false,device:false,scope:'finite nonsecret diagnostics; source acceptance and failure behavior preserved; not a repair of target population or live Karen recovery'}));
}finally{
  console.warn=originalWarn;server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
}
