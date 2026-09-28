import assert from 'node:assert/strict';
import express from 'express';
import { createScheduleRouter } from '../src/schedule-api.js';

const employee='30000000-0000-4000-8000-000000000099';
const device='80000000-0000-4000-8000-000000000008';
const credential='81000000-0000-4000-8000-000000000008';
const intent='82000000-0000-4000-8000-000000000008';
const publication='83000000-0000-4000-8000-000000000008';
const projection='84000000-0000-4000-8000-000000000008';
const date='2027-02-15';
const lunch='a'.repeat(64),rendered='b'.repeat(64);
const rpcCalls=[];
let deliveryMode='LEGACY_REGISTERED',dayReads=0,deliveryUnavailable=false;
const assignment={requested_device_id:'KIOSK_08',matched_by:'canonical',canonical_device_pk:device,
  canonical_device_id:'KIOSK_08',device_id:'KIOSK_08',device_name:'Employee Phone 8',device_active:true,
  assigned_employee_id:employee,assigned_employee_name:'Taylor New',employee_code:'EMP901',role:'staff',
  employee_active:true,assignment_epoch:7};
const day={ok:true,governed:true,source:'static_weekly_projection',projection_status:'current',
  publication_id:publication,projection_id:projection,projection_authority_revision:19,service_date:date,
  employee_id:employee,employee_name:'Taylor New',employee:{id:employee,display_name:'Taylor New',employee_code:'EMP901'},
  shift:{start:'07:00 AM',end:'04:00 PM',active:true},phase:'assigned_areas',notice:'Ready',current_items:[],all_items:[],items:[]};

const read=async(sql)=>{
  if(sql.includes('from public.device_aliases'))return [assignment];
  if(sql.includes('static_weekly_v5_read_employee_day')){dayReads++;return [{data:day}];}
  if(sql.includes('static_weekly_v6_read_roster'))return [{facts:{employee_active:true,roster:null,exceptions:[]}}];
  throw new Error(`unexpected SQL ${sql}`);
};
const runRpc=async(name,args)=>{
  rpcCalls.push({name,args});
  if(name==='static_weekly_v24_read_device_schedule_delivery'){
   if(deliveryUnavailable)throw new Error('synthetic delivery unavailable');
   const dated={intent_id:intent,operation_id:'85000000-0000-4000-8000-000000000008',
    service_date:date,employee_id:employee,device_id:device,credential_id:credential,assignment_epoch:7,
    authority_revision:19,publication_id:publication,projection_id:projection,lunch_document_identity:lunch,
    application_status:'PENDING'};
   const view={schema:'static-weekly.recurring-render-view.v1',service_date:date,employee_id:employee,
    employee_name:'Taylor New',publication_id:publication,projection_id:projection,projection_status:'current',full_day:true,raw_items:[],shift:day.shift};
   return{schema:'static-weekly.device-schedule-delivery.v1',mode:deliveryMode,
    datedApplication:deliveryMode==='LEGACY_REGISTERED'?dated:null,
    delivery:deliveryMode==='LEGACY_REGISTERED'?null:{intentId:intent,applicationStatus:'PENDING',
     target:{targetType:deliveryMode==='RECURRING_TERMINAL'?'BLOCKED_RECURRING_AUTHORITY':'SCHEDULE',
      publicationId:publication,projectionId:projection,serviceDate:date,authorityRevision:19},
     ...(deliveryMode==='RECURRING_TERMINAL'?{replacementCoverageReady:false}:{view,viewJsonText:JSON.stringify(view),viewDigest:rendered})}};
  }
  if(name==='static_weekly_v10_ack_device_schedule_application')return {intent_id:intent,application_status:'DEVICE_REPORTED_APPLIED',replayed:false};
  if(name==='static_weekly_v24_ack_device_schedule_delivery')return {schema:'static-weekly.device-schedule-delivery-receipt.v1',
   receipt:{intentId:intent,applicationStatus:args.p_target_type==='SCHEDULE'?'DEVICE_REPORTED_APPLIED':'DEVICE_REPORTED_BLOCKED'},currentAuthorityNotInferred:true};
  throw new Error(`unexpected RPC ${name}`);
};
const app=express();app.use(express.json());
app.use('/schedule-api',createScheduleRouter({runReadOnlySql:read,runRpc,runCommand:async()=>({}),
  buildHealthPayload:()=>({ok:true}),requireAdminApiAuth:(_q,_s,n)=>n(),requireOpsManagerAuth:(_q,_s,n)=>n(),
  requireDeviceAccess:(req,_res,next)=>{req.memphisDevice={canonical_device_id:'KIOSK_08',device_id:'KIOSK_08'};
    req.memphisDeviceCredential={credential_id:credential};next();},appVersion:'test',releaseId:'test',contractVersion:'test'}));
const server=await new Promise(resolve=>{const instance=app.listen(0,'127.0.0.1',()=>resolve(instance));});
let checks=0;const same=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;};
try{
 const origin=`http://127.0.0.1:${server.address().port}`;
 const schedule=await fetch(`${origin}/schedule-api/my-day-summary?device_id=KIOSK_08&service_date=${date}`);
 same(schedule.status,200);const scheduleBody=await schedule.json();
 same(scheduleBody.data.schedule_application.application_status,'PENDING');
 const readCall=rpcCalls.find(call=>call.name==='static_weekly_v24_read_device_schedule_delivery');
 same(readCall.args,{p_date:date,p_device:device,p_credential:credential,p_employee:employee,p_epoch:7},
  'read derives every principal fact from authenticated current assignment');
 const appliedAt=new Date().toISOString();
 const receipt={applied_at:appliedAt,authority_revision:19,intent_id:intent,lunch_document_identity:lunch,
  projection_id:projection,rendered_digest:rendered};
 const accepted=await fetch(`${origin}/schedule-api/my-day-summary/application-receipt`,{method:'POST',
  headers:{'content-type':'application/json','x-device-id':'KIOSK_08'},body:JSON.stringify(receipt)});
 same(accepted.status,200);same((await accepted.json()).data.application_status,'DEVICE_REPORTED_APPLIED');
 const ack=rpcCalls.find(call=>call.name==='static_weekly_v10_ack_device_schedule_application');
 same(ack.args,{p_intent_id:intent,p_device_id:device,p_credential_id:credential,p_employee_id:employee,
  p_assignment_epoch:7,p_authority_revision:19,p_projection_id:projection,p_lunch_document_identity:lunch,
  p_rendered_digest:rendered,p_applied_at:appliedAt},'write cannot supply or rebind principal identity');
 const extra=await fetch(`${origin}/schedule-api/my-day-summary/application-receipt`,{method:'POST',
  headers:{'content-type':'application/json','x-device-id':'KIOSK_08'},body:JSON.stringify({...receipt,employee_id:employee})});
 same(extra.status,422);same(rpcCalls.filter(call=>call.name==='static_weekly_v10_ack_device_schedule_application').length,1,
  'unknown body fields fail before database mutation');
 for(const mode of ['RECURRING_TERMINAL','RECURRING_SCHEDULE']){
  deliveryMode=mode;const before=dayReads;
  const response=await fetch(`${origin}/schedule-api/my-day-summary?device_id=KIOSK_08&service_date=${date}`);
  same(response.status,200);const data=(await response.json()).data;
  same(data.schedule_delivery_mode,mode);same(data.canonical_device_pk,device);
  same(data.schedule_application,null,'dated transport cannot override recurring/terminal authority');
  same(dayReads,before,'typed delivery is resolved BEFORE old employee reader');
  same(data.projection_status,mode==='RECURRING_TERMINAL'?'blocked_recurring_authority':'current');
  same(data.recurring_delivery.applicationStatus,'PENDING');
  same(data.full_day,true);
 }
 deliveryMode='UNAVAILABLE';const beforeUnavailable=dayReads;
 same((await fetch(`${origin}/schedule-api/my-day-summary?device_id=KIOSK_08&service_date=${date}`)).status,503);
 same(dayReads,beforeUnavailable,'unavailable recurring winner cannot fallback to older registered reader');
 const typed={intent_id:intent,target_type:'SCHEDULE',authority_revision:19,target_digest:lunch,rendered_digest:rendered,applied_at:appliedAt};
 const sendTyped=body=>fetch(`${origin}/schedule-api/my-day-summary/delivery-receipt`,{method:'POST',
  headers:{'content-type':'application/json','x-device-id':'KIOSK_08'},body:JSON.stringify(body)});
 const typedResponse=await sendTyped(typed);same(typedResponse.status,200);
 same((await typedResponse.json()).data.currentAuthorityNotInferred,true);
 same(rpcCalls.find(x=>x.name==='static_weekly_v24_ack_device_schedule_delivery').args,
  {p_intent:intent,p_device:device,p_credential:credential,p_employee:employee,p_epoch:7,p_target_type:'SCHEDULE',
   p_revision:19,p_target_digest:lunch,p_rendered_digest:rendered,p_applied_at:appliedAt},'typed receipt derives principal from authenticated assignment');
 same((await sendTyped({...typed,target_type:'BLOCKED_RECURRING_AUTHORITY',rendered_digest:lunch})).status,200);
 for(const patch of [{employee_id:employee},{device_id:device},{credential_id:credential},{target_type:'UNKNOWN'},
  {authority_revision:'19'},{authority_revision:0},{intent_id:[intent]},{target_digest:[lunch]},{rendered_digest:'bad'},{applied_at:'invalid'}]){
  const before=rpcCalls.length;same((await sendTyped({...typed,...patch})).status,422);
  same(rpcCalls.length,before,'malformed/identity-rebinding receipt cannot call SQL');
 }
}finally{await new Promise(resolve=>server.close(resolve));}
console.log(JSON.stringify({status:'PASS',checks,scope:'authenticated schedule target read and exact device-reported application receipt; no accepted publication, real phone or person-read proof'}));
