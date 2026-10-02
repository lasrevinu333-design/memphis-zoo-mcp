import assert from 'node:assert/strict';
import express from 'express';
import {createHash,generateKeyPairSync} from 'node:crypto';
import {installEmployeeNotificationRoutes} from '../src/employee-notifications.js';
import {createPushRuntime} from '../src/manager-notifications.js';
import {canonicalNativeLocation} from '../src/native-location-reservation.js';
import {NATIVE_LUNCH_PAYLOAD_KEYS,validateNativeLunchReservation} from '../src/native-lunch-reservation.js';
import {validateNativeLunchDispatch,deliverNativeLunchJob,prepareNativeLunchDataSender} from '../src/native-lunch-dispatch.js';

const id=n=>`89000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const hash=value=>createHash('sha256').update(value).digest('hex');
let checks=0;const check=(name,a,b)=>{assert.deepEqual(a,b,name);checks++;console.log('PASS',name);};
const reject=async(name,fn,pattern)=>{await assert.rejects(fn,pattern);checks++;console.log('PASS',name);};
const intervals=[],realInterval=globalThis.setInterval,realFetch=globalThis.fetch;
globalThis.setInterval=(...args)=>{const timer=realInterval(...args);intervals.push(timer);return timer;};
try{
 const token='synthetic-lunch-token-not-production-0001';
 const expected={assignment_epoch:'1',credential_id:id(3),device_id:'KIOSK_08',employee_id:id(4),
  generation_id:id(5),principal_digest:'a'.repeat(64),registration_id:id(6),token_digest:hash(token)};
 const data={schema:'custodial.native-provider-payload.v1',kind:'employee_lunch_coverage',notification_type:'lunch_coverage',
  generation_id:expected.generation_id,principal_digest:expected.principal_digest,token_digest:expected.token_digest,
  receipt_job_id:id(1),receipt_credential_id:expected.credential_id,receipt_employee_id:expected.employee_id,
  receipt_device_id:expected.device_id,receipt_assignment_epoch:expected.assignment_epoch,
  notification_key:'b'.repeat(64),reservation_at:'2026-10-02T12:00:01.000001Z',valid_until:'2026-10-02T13:00:00.000000Z',
  title:'Lunch coverage starts now',body:'Your temporary lunch coverage has started. Open My Schedule for borrowed areas.',
  channel_id:'employee-lunch-coverage',route:'employee-schedule.html?hub=employee',service_date:'2026-10-02',
  event:'start',loan_id:'c'.repeat(64),scheduled_time:'12:00',scheduled_at:'2026-10-02T12:00:00.000000Z',
  coverer_slot_id:id(7),projection_id:id(8),document_identity:'d'.repeat(64)};
 const payload={...data,content_sha256:hash(canonicalNativeLocation(data))};
 const reservation={current:true,dispatch_authorized:true,replayed:false,delivery_outcome_unknown:false,
  payload,wire:canonicalNativeLocation(payload)};
 const dispatch={schema:'custodial.native-lunch-dispatch.v1',dispatch_authorized:true,reservation,
  attempt_id:id(9),outcome_operation_id:id(10),ttl_seconds:3598};
 const permit=validateNativeLunchDispatch(dispatch,{jobId:id(1),leaseToken:id(2),expected});
 check('strict original 27-field native LUNCH contract',Object.keys(permit.reservation.payload).sort(),NATIVE_LUNCH_PAYLOAD_KEYS);
 check('business TTL preserves SQL microseconds',permit.ttl_seconds,3598);
 for(const changed of [
  {...payload,schema:'custodial.native-location-payload.v2'},
  {...payload,extra:'unapproved'},
  {...payload,receipt_employee_id:id(77)},
  {...payload,valid_until:'2026-10-02T13:00:00.000001Z'},
  {...payload,scheduled_at:'2026-02-31T12:00:00.000000Z'},
  {...payload,service_date:'2026-02-31'},
  {...payload,receipt_assignment_epoch:'9007199254740992'},
  {...payload,receipt_assignment_epoch:'not-a-number'},
 ])await reject('malformed/stale lunch payload rejected',async()=>validateNativeLunchReservation(
  {...reservation,payload:changed,wire:canonicalNativeLocation(changed)},{jobId:id(1),expected}),/contract_invalid/);
 await reject('changed SQL TTL denied',async()=>validateNativeLunchDispatch({...dispatch,ttl_seconds:3599},
  {jobId:id(1),leaseToken:id(2),expected}),/contract_invalid/);
 let providerCalls=0;
 const sender=prepareNativeLunchDataSender({projectId:'synthetic-project',accessToken:'synthetic-oauth',
  fetchImpl:async(url,options)=>{providerCalls++;check('typed only Firebase endpoint',String(url),
   'https://fcm.googleapis.com/v1/projects/synthetic-project/messages:send');
   const sent=JSON.parse(options.body).message;
   check('data-only no notification or collapse key',Object.keys(sent).sort(),['android','data','token']);
   check('same exact SQL payload reaches sender',sent.data,payload);
   return new Response(JSON.stringify({name:'projects/synthetic-project/messages/synthetic-id'}),{status:200});}});
 check('one synthetic provider acceptance',(await sender({permit,expected,token})).outcome,'provider_accepted');
 await reject('sender cannot be called twice',()=>sender({permit,expected,token}),/already_consumed/);
 check('one synthetic provider attempt',providerCalls,1);

 const positiveCalls=[];
 const positiveDb={rpc:async(name,args)=>{
  positiveCalls.push(name);
  if(name==='custodial_native_lunch_dispatch_status')return{data:{schema:'custodial.native-lunch-dispatch-status.v1',
   reserved:false,dispatch_authorized:false}};
  if(name==='custodial_native_lunch_target')return{data:{current:true,expected,token}};
  if(name==='custodial_native_lunch_dispatch_prepare')return{data:dispatch};
  if(name==='custodial_native_lunch_outcome')return{data:{schema:'custodial.native-lunch-outcome-receipt.v1',
   binding:permit.binding,evidence:args.p_evidence,server_received_at:'2026-10-02T12:00:02.000000Z',
   replayed:false,dispatch_authorized:false}};
  throw new Error('unexpected positive LUNCH RPC '+name);
 }};
 let positiveSends=0;
 const positiveRuntime={prepareNativeLunchSender:async()=>prepareNativeLunchDataSender({
  projectId:'synthetic-project',accessToken:'synthetic-oauth',fetchImpl:async(_url,options)=>{
   positiveSends++;check('actual claimed LUNCH path sends exact original SQL-shaped data',
    JSON.parse(options.body).message.data,payload);
   return new Response(JSON.stringify({name:'projects/synthetic-project/messages/claimed-job'}),{status:200});}})};
 const positiveJob={job_id:id(1),lease_token:id(2),job_type:'employee_native_push',
  payload_json:{credential_id:id(3),assignment_epoch:1,data_json:{kind:'employee_lunch_coverage'}}};
 check('actual claimed LUNCH branch returns provider-only acceptance',
  await deliverNativeLunchJob({db:positiveDb,pushRuntime:positiveRuntime,job:positiveJob}),
  {provider_message_id:'projects/synthetic-project/messages/claimed-job',replayed:false,native_lunch:true});
 check('actual branch order includes original outcome receipt',positiveCalls,[
  'custodial_native_lunch_dispatch_status','custodial_native_lunch_target',
  'custodial_native_lunch_dispatch_prepare','custodial_native_lunch_outcome']);
 check('actual claimed LUNCH branch performs one synthetic send',positiveSends,1);

 const calls=[];let genericSends=0,prepared=0;
 const db={rpc:async name=>{calls.push(name);
  if(name==='custodial_native_lunch_dispatch_status')return{data:{schema:'custodial.native-lunch-dispatch-status.v1',reserved:false,dispatch_authorized:false}};
  if(name==='custodial_native_lunch_target')return{data:{current:false,reason:'native_lunch_target_unavailable'}};
  throw new Error('legacy_route_marker');}};
 const job={job_id:id(1),lease_token:id(2),job_type:'employee_native_push',
  payload_json:{credential_id:id(3),assignment_epoch:1,data_json:{kind:'employee_lunch_coverage'}}};
 const runtime=installEmployeeNotificationRoutes(express(),{env:{},supabase:db,
  pushRuntime:{configured:false,send:async()=>{genericSends++;},prepareNativeLunchSender:async()=>{prepared++;return async()=>{genericSends++;};}}});
 await reject('actual LUNCH callsite requires current protected target',()=>runtime.deliverClaimedJob(job),/native_lunch_target_unavailable/);
 check('protected branch calls only typed status and target',calls,
  ['custodial_native_lunch_dispatch_status','custodial_native_lunch_target']);
 check('no generic sender use',genericSends,0);
 check('one capability preparation before admission',prepared,1);
 calls.length=0;
 await reject('unavailable typed sender remains pending',()=>deliverNativeLunchJob({db,pushRuntime:{},job}),/sender_unavailable/);
 check('missing sender never queries target',calls,['custodial_native_lunch_dispatch_status']);
 calls.length=0;
 await reject('unprotected test path stays separate',()=>runtime.deliverClaimedJob({...job,
  payload_json:{...job.payload_json,data_json:{kind:'employee_lunch_coverage',test_delivery:true}}}),/legacy_route_marker/);
 check('test path is not a protected LUNCH attempt',calls.some(name=>name.startsWith('custodial_native_lunch_')),false);

 const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs8',format:'pem'},
  publicKeyEncoding:{type:'spki',format:'pem'}});
 const oauth=[];
 globalThis.fetch=async(url,options)=>{oauth.push(String(url));check('existing scoped OAuth path',String(url),'https://oauth2.googleapis.com/token');
  check('OAuth POST unchanged',options.method,'POST');return new Response(JSON.stringify({access_token:'synthetic-test-oauth',expires_in:3600}));};
 const push=createPushRuntime({db:null,env:{FIREBASE_SERVICE_ACCOUNT_JSON:JSON.stringify({project_id:'synthetic-project',
  client_email:'synthetic@example.invalid',private_key:privateKey})}});
 check('typed LUNCH closure constructed',typeof await push.prepareNativeLunchSender(),'function');
 check('OAuth capability only, no send',oauth,['https://oauth2.googleapis.com/token']);
 await push.prepareNativeLunchSender();check('same bounded OAuth cache',oauth.length,1);
 await reject('missing account stays unavailable',()=>createPushRuntime({db:null,env:{}}).prepareNativeLunchSender(),/not configured/);
 console.log(JSON.stringify({status:'PASS',checks,syntheticTransport:true,production:false,activation:false}));
}finally{globalThis.fetch=realFetch;globalThis.setInterval=realInterval;for(const timer of intervals)clearInterval(timer);
 console.log('OWNED_NOTIFICATION_TIMERS_CLOSED',intervals.length);}
