import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';import {resolve} from 'node:path';import {pathToFileURL} from 'node:url';
import {loadNativeScheduleEventOriginals} from '../src/native-schedule-event-originals.js';
import {validateNativeProviderEventsRequest,validateNativeProviderEventsStructure,validateNativeProviderEventsResponse} from '../src/native-provider-events.js';
import {validateNativeProviderEventDecisionQuery,validateNativeProviderEventDecisions,lookupNativeProviderEventDecisions} from '../src/native-provider-event-decisions.js';
import {nativeScheduleRecordId} from '../src/native-schedule-payload.js';
const id=n=>`aa000000-0000-4000-8000-${String(n).padStart(12,'0')}`,sha=x=>createHash('sha256').update(x).digest('hex');
const p=JSON.parse(readFileSync(new URL('./fixtures/native-schedule-wire.json',import.meta.url),'utf8')).payload;
const interval={earliest_at:p.reservation_at,latest_at:p.reservation_at,clock_profile_id:'SYNTHETIC_ONLY_NO_QUALIFICATION',elapsed_realtime_ms:1,boot_count:1};
const e={schema:'custodial.native-provider-event.v2',event_id:id(1),record_id:nativeScheduleRecordId(p),action:'received',generation_id:p.generation_id,
 content_sha256:p.content_sha256,receipt_job_id:p.receipt_job_id,notification_key:p.notification_key,receipt_credential_id:p.receipt_credential_id,
 receipt_employee_id:p.receipt_employee_id,receipt_device_id:p.receipt_device_id,receipt_assignment_epoch:Number(p.receipt_assignment_epoch),
 principal_digest:p.principal_digest,token_digest:p.token_digest,admission_bounds:interval,original_observation:{earliest_at:null,latest_at:null,clock_profile_id:null,elapsed_realtime_ms:null,boot_count:null}};
const original={job_id:e.receipt_job_id,generation_id:e.generation_id,source_reservation_id:p.source_reservation_id,record_id:e.record_id,notification_key:e.notification_key,
 credential_id:e.receipt_credential_id,employee_id:e.receipt_employee_id,device_id:e.receipt_device_id,assignment_epoch:String(e.receipt_assignment_epoch),
 principal_digest:e.principal_digest,token_digest:e.token_digest,content_sha256:e.content_sha256};
const batch={schema:'custodial.native-provider-events.v2',events:[e]},envelope={schema:'custodial.native-schedule-observation-originals.v1',originals:[original]};
const accepted={...e,schema:'custodial.native-provider-event-receipt.v2',admitted_state:'ACCEPTED',server_received_at:p.reservation_at,replayed:true};
const requester={current_generation_id:e.generation_id,credential_id:e.receipt_credential_id,employee_id:e.receipt_employee_id,device_id:e.receipt_device_id,
 assignment_epoch:e.receipt_assignment_epoch,principal_digest:e.principal_digest,token_digest:e.token_digest};
const query={schema:'custodial.native-provider-event-decision-query.v1',requester,events:[e]},context={credentialId:e.receipt_credential_id,credentialHash:'a'.repeat(64),nativeRequestId:id(2),attestationDigest:'b'.repeat(64),rawBodySha256:sha(JSON.stringify(query))};
const decision={ok:true,data:{schema:'custodial.native-provider-event-decisions.v1',native_request_id:context.nativeRequestId,request_body_sha256:context.rawBodySha256,
 requester,results:[{event_id:e.event_id,decision:'ORIGINAL_ACCEPTED',receipt:accepted}]}};
export async function runNativeScheduleEventOriginalsTests(){
 let checks=0;const check=(name,a,b)=>{assert.deepEqual(a,b,name);checks++;},reject=(name,fn)=>{assert.throws(fn,undefined,name);checks++;};
 const load=(value=envelope,events=batch.events,db)=>loadNativeScheduleEventOriginals({db:db??{rpc:async()=>({data:value})},events,credentialId:context.credentialId,credentialHash:context.credentialHash});
 check('structure retains full original with no identity permission',validateNativeProviderEventsStructure(batch),batch);
 reject('default validator cannot invent source original',()=>validateNativeProviderEventsRequest(batch));
 reject('default query cannot invent source original',()=>validateNativeProviderEventDecisionQuery(query));
 let calls=0;const map=await load(envelope,batch.events,{rpc:async(name,args)=>{check('typed original RPC',name,'custodial_native_schedule_observation_originals');
  check('only authoritative credential hash and bounded job keys',args,{p_credential:context.credentialId,p_credential_hash:context.credentialHash,p_jobs:[e.receipt_job_id]});calls++;return{data:envelope};}});
 check('one authoritative lookup',calls,1);check('source original map exact',map.get(e.receipt_job_id),original);check('original map values frozen',Object.isFrozen(map.get(e.receipt_job_id)),true);
 check('resolved original request validates',validateNativeProviderEventsRequest(batch,{scheduleOriginals:map}),batch);
 const receiptEnvelope={ok:true,data:{schema:'custodial.native-provider-event-receipts.v2',results:[accepted]}};
 check('resolved exact original receipt validates',validateNativeProviderEventsResponse(receiptEnvelope,batch,{scheduleOriginals:map}),receiptEnvelope);
 check('resolved original query validates',validateNativeProviderEventDecisionQuery(query,{scheduleOriginals:map}),query);
 check('exact original decision validates',validateNativeProviderEventDecisions(decision,query,context,{scheduleOriginals:map}),decision);
 for(const key of Object.keys(original)){
  const bad={...original};delete bad[key];await assert.rejects(()=>load({...envelope,originals:[bad]}));checks++;
  reject('original field cannot rebind '+key,()=>validateNativeProviderEventsRequest(batch,{scheduleOriginals:new Map([[e.receipt_job_id,{...original,[key]:'wrong'}]])}));
 }
 for(const change of [{extra:true},{schema:'other'},{originals:[]},{originals:[original,original]},
  {originals:[{...original,job_id:id(9)}]},{originals:[{...original,source_reservation_id:id(10)}]},
  {originals:[{...original,credential_id:id(11)}]},{originals:[{...original,assignment_epoch:'1.0'}]},
  {originals:[{...original,notification_key:'schedule-ownership:2026-02-30:'+e.receipt_employee_id+':09:45'}]},
  {originals:Array(1)}]){await assert.rejects(()=>load({...envelope,...change}),x=>x.status===503);checks++;}
 for(const db of [{rpc:async()=>{throw Error('SYNTHETIC_PRIVATE_LOSS');}},{rpc:async()=>({error:{code:'XX000',message:'PRIVATE'}})},null]){
  await assert.rejects(()=>loadNativeScheduleEventOriginals({db,events:batch.events,credentialId:context.credentialId,credentialHash:context.credentialHash}),
   x=>x.status===503&&!x.message.includes('PRIVATE'));checks++;
 }
 await assert.rejects(()=>loadNativeScheduleEventOriginals({db:{rpc:async()=>({error:{code:'42501'}})},events:batch.events,credentialId:context.credentialId,credentialHash:context.credentialHash}),x=>x.status===403);checks++;
 const legacy={...e,notification_key:'message:'+id(12)};legacy.record_id=sha(legacy.generation_id+'\n'+legacy.receipt_job_id+'\n'+legacy.notification_key);
 let legacyCalls=0;check('nonSchedule request remains ordinary',validateNativeProviderEventsRequest({...batch,events:[legacy]}).events[0],legacy);
 const none=await load(envelope,[legacy],{rpc:async()=>{legacyCalls++;throw Error('must not call');}});check('nonSchedule makes no new lookup',[none.size,legacyCalls],[0,0]);
 for(const change of [{record_id:sha(e.generation_id+'\n'+e.receipt_job_id+'\n'+e.notification_key)},
  {record_id:'d'.repeat(64)},{action:'dismissed'},{notification_key:e.notification_key+':changed'},
  {receipt_assignment_epoch:String(e.receipt_assignment_epoch)},{extra:true}])reject('no fallback or shape weakening '+Object.keys(change)[0],()=>validateNativeProviderEventsRequest({...batch,events:[{...e,...change}]},{scheduleOriginals:map}));
 const pending={...decision,data:{...decision.data,results:[{event_id:e.event_id,decision:'UNRESOLVED'}]}};
 check('explicit unresolved retains no cleanup permission',validateNativeProviderEventDecisions(pending,query,context,{scheduleOriginals:map}),pending);
 const order=[];const readback=await lookupNativeProviderEventDecisions({db:{rpc:async(name,args)=>{order.push(name);
  if(name==='custodial_native_schedule_observation_originals')return{data:envelope};return{data:{...decision,data:{...decision.data,requester:args.p_body.requester}}};}},body:query,context});
 check('lookup uses bound original before unchanged decision RPC',order,['custodial_native_schedule_observation_originals','custodial_native_provider_event_decisions']);
 check('lookup exact original result',readback,decision);
 await assert.rejects(()=>lookupNativeProviderEventDecisions({db:{rpc:async()=>({data:{...envelope,originals:[]}})},body:query,context}),x=>x.status===503);checks++;
 return Object.freeze({status:'PASS',checks,synthetic_RPC:true,new_SQL:false,native_qualified:false,provider_dispatch:false,phone:false});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)console.log(JSON.stringify(await runNativeScheduleEventOriginalsTests()));
