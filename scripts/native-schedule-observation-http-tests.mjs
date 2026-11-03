import {readFileSync} from 'node:fs';
import {nativeScheduleRecordId} from '../src/native-schedule-payload.js';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import {createGeneralJsonMiddleware} from '../src/request-json-parser.js';
import {makeDeviceCredentialMiddleware,deviceCredentialInternals} from '../src/auth/device-credential-auth.js';
import {installNativeProviderRoutes} from '../src/native-provider-api.js';
const id=n=>`55000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const env={NODE_ENV:'test',DEVICE_CREDENTIAL_SECRET:'synthetic-provider-route-root-long-enough'};
const secret='syntheticProviderNativeSecret-abcdefghijklmnopqrstuvwxyz1234567890',cid=id(1),pk=id(3),employee=id(4);
const device={requested_device_id:'KIOSK_08',canonical_device_id:'KIOSK_08',canonical_device_pk:pk,device_id:'KIOSK_08',device_name:'Synthetic',
 device_active:true,assignment_valid:true,employee_active:true,employee_code:'EMP998',role:'staff',assignment_epoch:7,assigned_employee_id:employee,assigned_employee_name:'Synthetic'};
const base={credential_id:cid,device_id:pk,token_hash:deviceCredentialInternals.tokenHash(secret,env),created_at:'2026-01-01T00:00:00.000Z',
 confirmed_at:'2026-01-01T00:00:00.000Z',last_used_at:new Date().toISOString(),expires_at:'2099-01-01T00:00:00.000Z',revoked_at:null,
 metadata_json:deviceCredentialInternals.deviceCredentialSecretMetadata(env)};
let row=structuredClone(base),calls=0,lastArgs,lastFunction,checks=0,dbError=null,dbValue=null,requestId=id(9);
const validResponse=args=>({data:{synthetic:true,server_now:'2026-10-02T01:02:03.123455Z'},clock:{native_request_id:args.p_native_request,
 server_now:'2026-10-02T01:02:03.123456Z',valid_until:'2026-10-02T01:17:03.123456Z'}});
let testRpc=()=>{throw new Error('unconfigured synthetic RPC');};
const app=express();app.use(createGeneralJsonMiddleware());
installNativeProviderRoutes(app,{env,db:{rpc:async(fn,args)=>{calls++;lastArgs=args;lastFunction=fn;return testRpc(fn,args);}},
 requireCurrentCredential:makeDeviceCredentialMiddleware({env,store:{getPolicy:async()=>({mode:'enforce'}),findCredential:async n=>n===cid?row:null,touchCredential:async()=>{},audit:async()=>{}},
  runReadOnlySql:async()=>[device],requireEnrolledCredential:true})});
app.use((err,_req,res,_next)=>res.status(err.status||500).json({code:'synthetic_error'}));
const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
console.log('OWNED_HTTP_SERVER',server.address().port,'cleanup=server.close in finally');
const origin='http://127.0.0.1:'+server.address().port,prefix='/employee-notifications-api/native-provider',path=prefix+'/register';
const token='synthetic-fcm-token-0000000000000';
const body={schema:'custodial.native-provider-register.v1',operation_id:id(5),generation_id:id(6),credential_id:cid,employee_id:employee,device_id:'KIOSK_08',assignment_epoch:7,
 principal_digest:'a'.repeat(64),token_digest:crypto.createHash('sha256').update(token).digest('hex'),token,
 native_app:{package_name:'org.memphiszoo.custodial',version_name:'synthetic',version_code:53,build_id:'synthetic.custodial.df36d32368b6'}};
function headers(bytes,p=path,t=new Date().toISOString()){
 const proof=['custodial-native-request.v1',cid,'KIOSK_08','POST',p,crypto.createHash('sha256').update(bytes).digest('hex'),requestId,t,'custodial'].join('\n');
 return {'content-type':'application/json',authorization:`Device ${cid}.${secret}`,'x-device-id':'KIOSK_08',origin:'https://localhost','x-memphis-app-edition':'custodial',
  'x-memphis-native-attestation-version':'custodial-native-request.v1','x-memphis-native-request-id':requestId,'x-memphis-native-request-timestamp':t,
  'x-memphis-native-request-attestation':crypto.createHmac('sha256',secret).update(proof).digest('hex')};
}
async function send(value=body,p=path,edit=()=>{},method='POST'){
 const bytes=typeof value==='string'?value:JSON.stringify(value),h=headers(bytes,p);edit(h);
 return fetch(origin+p,{method,headers:h,...(!['GET','HEAD'].includes(method)?{body:bytes}:{}),signal:AbortSignal.timeout(5000)});
}
const check=(name,value)=>{assert.ok(value,name);checks++;console.log('PASS',name);};
async function refused(name,value=body,p=path,edit=()=>{},method='POST'){
 const count=calls,r=await send(value,p,edit,method);await r.text();check(name,r.status>=400&&calls===count);
}

try{
 const fixture=JSON.parse(readFileSync(new URL('./fixtures/native-schedule-wire.json',import.meta.url),'utf8')),p=fixture.payload;
 const event={schema:'custodial.native-provider-event.v2',event_id:id(60),generation_id:body.generation_id,receipt_job_id:id(61),
  notification_key:'schedule-ownership:'+p.service_date+':'+employee+':09:45',action:'received',receipt_credential_id:cid,receipt_employee_id:employee,
  receipt_device_id:'KIOSK_08',receipt_assignment_epoch:7,principal_digest:body.principal_digest,token_digest:body.token_digest,content_sha256:'c'.repeat(64),
  admission_bounds:{earliest_at:p.reservation_at,latest_at:p.reservation_at,clock_profile_id:'SYNTHETIC_HTTP_ONLY',elapsed_realtime_ms:1,boot_count:1},
  original_observation:{earliest_at:null,latest_at:null,clock_profile_id:null,elapsed_realtime_ms:null,boot_count:null}};
 event.record_id=crypto.createHash('sha256').update(event.generation_id+'\n'+p.source_reservation_id+'\n'+event.notification_key).digest('hex');
 const original={job_id:event.receipt_job_id,generation_id:event.generation_id,source_reservation_id:p.source_reservation_id,record_id:event.record_id,
  notification_key:event.notification_key,credential_id:cid,employee_id:employee,device_id:'KIOSK_08',assignment_epoch:'7',principal_digest:event.principal_digest,
  token_digest:event.token_digest,content_sha256:event.content_sha256};
 const events={schema:'custodial.native-provider-events.v2',events:[event]},accepted={...event,schema:'custodial.native-provider-event-receipt.v2',
  admitted_state:'ACCEPTED',server_received_at:p.reservation_at,replayed:true};
 const requester={current_generation_id:body.generation_id,credential_id:cid,employee_id:employee,device_id:'KIOSK_08',assignment_epoch:7,
  principal_digest:body.principal_digest,token_digest:body.token_digest},query={schema:'custodial.native-provider-event-decision-query.v1',requester,events:[event]};
 const originalEnvelope={schema:'custodial.native-schedule-observation-originals.v1',originals:[original]};
 // Replace only the isolated test RPC stub, not product handlers or assertions.
 // The actual HTTP credential/raw-byte HMAC middleware is unchanged.
 const order=[];let originalsValue=originalEnvelope,originalsError=null;
 testRpc=async(name,args)=>{
  order.push(name);
  if(name==='custodial_native_schedule_observation_originals')return originalsError?{error:originalsError}:{data:originalsValue};
  if(name==='custodial_native_provider_events')return{data:{ok:true,data:{schema:'custodial.native-provider-event-receipts.v2',results:[accepted]}}};
  assert.equal(name,'custodial_native_provider_event_decisions');return{data:{ok:true,data:{schema:'custodial.native-provider-event-decisions.v1',
   native_request_id:args.p_native_request,request_body_sha256:args.p_raw_body_sha256,requester:args.p_body.requester,
   results:[{event_id:event.event_id,decision:'ORIGINAL_ACCEPTED',receipt:accepted}]}}};
  };
 async function request(value=events,suffix='events',edit=()=>{}){
  const url=prefix+'/'+suffix,bytes=typeof value==='string'?value:JSON.stringify(value),h=headers(bytes,url);edit(h);
  const r=await fetch(origin+url,{method:'POST',headers:h,body:bytes,signal:AbortSignal.timeout(5000)});return{status:r.status,body:await r.json()};
 }
 {
  let r=await request();check('actual HMAC events resolves original before admission',r.status===200&&order.join(',')==='custodial_native_schedule_observation_originals,custodial_native_provider_events');
  check('accepted original event echoed unchanged',JSON.stringify(r.body.data.results[0])===JSON.stringify(accepted));
  order.length=0;r=await request(query,'event-decisions');check('actual HMAC query resolves original before readback',r.status===200&&order.join(',')==='custodial_native_schedule_observation_originals,custodial_native_provider_event_decisions');
  check('original decision echo unchanged',r.body.data.results[0].receipt.record_id===event.record_id&&r.body.data.results[0].decision==='ORIGINAL_ACCEPTED');
  for(const k of ['x-memphis-native-attestation-version','x-memphis-native-request-id','x-memphis-native-request-timestamp','x-memphis-native-request-attestation']){
   const before=calls;r=await request(events,'events',h=>delete h[k]);check('no lookup/admission without proof '+k,r.status>=400&&calls===before);
  }
  for(const edit of [h=>h.origin='https://example.invalid',h=>h['x-memphis-app-edition']='manager']){
   const before=calls;r=await request(events,'events',edit);check('origin/edition denied before lookup',r.status>=400&&calls===before);
  }
  const before=calls;r=await request({...events,events:[{...event,receipt_employee_id:id(99)}]});check('crossed actor cannot lookup original',r.status>=400&&calls===before);
  for(const value of [{...originalEnvelope,originals:[]},{...originalEnvelope,originals:[{...original,source_reservation_id:id(98)}]},
   {...originalEnvelope,originals:[original,original]},{...originalEnvelope,extra:true},
   {...originalEnvelope,originals:[{...original,notification_key:'schedule-ownership:2026-02-30:'+employee+':09:45'}]}]){
   originalsValue=value;order.length=0;r=await request();check('bad original response remains pending and cannot admit',r.status===503&&order.length===1&&!JSON.stringify(r.body).includes('ACCEPTED'));
  }
  originalsValue=originalEnvelope;originalsError={code:'42501',message:'SYNTHETIC_PRIVATE'};r=await request();check('revoked original lookup stays denied/redacted',r.status===403&&!JSON.stringify(r.body).includes('PRIVATE'));originalsError=null;
  const wrong={...event,record_id:crypto.createHash('sha256').update(event.generation_id+'\n'+event.receipt_job_id+'\n'+event.notification_key).digest('hex')};
  order.length=0;r=await request({...events,events:[wrong]});check('old job-based Schedule identity has no fallback',r.status===400&&order.length===1);
  const raw=' \n'+JSON.stringify(query,null,2)+'\n';r=await request(raw,'event-decisions');check('raw whitespace digest preserved',r.status===200&&r.body.data.request_body_sha256===crypto.createHash('sha256').update(raw).digest('hex'));
  console.log(JSON.stringify({status:'PASS',checks,actual_local_HTTP:true,actual_credential_HMAC:true,
   synthetic_original_and_receipt_RPC:true,actual_SQL:false,native_qualified:false,provider_dispatch:false,phone:false}));
 }
}finally{server.closeAllConnections();await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));console.log('OWNED_HTTP_SERVER_CLOSED');}
