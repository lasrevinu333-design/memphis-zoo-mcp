import assert from'node:assert/strict';import{readFileSync}from'node:fs';import{createHash}from'node:crypto';import{resolve}from'node:path';import{pathToFileURL}from'node:url';
import{prepareNativeScheduleDataSender,deliverNativeScheduleJob,resolveNativeScheduleTarget}from'../src/native-schedule-dispatch.js';
import{canonicalNativeLocation}from'../src/native-location-reservation.js';
const sha=x=>createHash('sha256').update(x).digest('hex'),id=n=>`ac000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const f=JSON.parse(readFileSync(new URL('./fixtures/native-schedule-wire.json',import.meta.url))),token='synthetic-schedule-private-target-token',p={...f.payload,token_digest:sha(token)};
p.content_sha256=sha(canonicalNativeLocation(p,{excludeHash:true}));const expected={...f.expected,token_digest:sha(token)},lease=id(1);
const binding={receipt_job_id:p.receipt_job_id,lease_token:lease,registration_id:expected.registration_id,generation_id:p.generation_id,
 reservation_at:p.reservation_at,content_sha256:p.content_sha256,token_digest:p.token_digest,principal_digest:p.principal_digest,
 receipt_credential_id:p.receipt_credential_id,receipt_assignment_epoch:p.receipt_assignment_epoch,receipt_employee_id:p.receipt_employee_id,
 receipt_device_id:p.receipt_device_id,source_reservation_id:p.source_reservation_id};
const attempt={attempt_id:id(2),outcome_operation_id:id(3),attempt_reserved_at:'2026-10-08T14:47:00.999999Z',binding,payload:p,wire:canonicalNativeLocation(p),ttl_seconds:779};
const permit={schema:'custodial.native-schedule-dispatch.v1',dispatch_authorized:true,delivery_admitted:false,replayed:false,reason:null,attempt};
const target={schema:'custodial.native-schedule-target.v1',current:true,delivery_admitted:false,expected,token,source_candidate:f.sourceCandidate};
const job={job_id:p.receipt_job_id,lease_token:lease,job_type:'employee_native_push',job_key:`employee-schedule-push:${p.source_reservation_id}:${p.receipt_credential_id}`,
 payload_json:{credential_id:p.receipt_credential_id,device_id:id(5),device_identifier:p.receipt_device_id,employee_id:p.receipt_employee_id,assignment_epoch:p.receipt_assignment_epoch,
 data_json:{kind:'employee_schedule_ownership',source_reservation_id:p.source_reservation_id}}};
const status=(e=null,attempted=true)=>({schema:'custodial.native-schedule-dispatch-status.v1',attempted,dispatch_authorized:false,delivery_admitted:false,
 attempt:attempted?{attempt_id:attempt.attempt_id,outcome_operation_id:attempt.outcome_operation_id,attempt_reserved_at:attempt.attempt_reserved_at,binding,
 provider_outcome:e?.outcome??'prepared',evidence:e,server_received_at:e?'2026-10-08T14:48:00.000000Z':null}:null});
const evidence=outcome=>({operation_id:attempt.outcome_operation_id,outcome,provider_message_id:outcome==='provider_accepted'?'projects/synthetic/messages/original':null,error_code:outcome==='provider_accepted'?null:'synthetic_unknown'});
export async function runNativeScheduleDispatchTests(){
 let checks=0;const eq=(n,a,b)=>{assert.deepEqual(a,b,n);checks++;},reject=async(n,fn,code)=>{await assert.rejects(fn,code?e=>e.code===code:undefined,n);checks++;};
 const resolveTarget=(v=target)=>resolveNativeScheduleTarget({jobId:job.job_id,leaseToken:lease,sourceReservationId:p.source_reservation_id,db:{rpc:async()=>({data:v})}});
 eq('closed target snapshot',await resolveTarget(),{current:true,delivery_admitted:false,expected,token,sourceCandidate:f.sourceCandidate});
 for(const key of Object.keys(target)){const v=structuredClone(target);delete v[key];await reject('target missing '+key,()=>resolveTarget(v));}
 for(const key of Object.keys(f.sourceCandidate)){const v=structuredClone(target);delete v.source_candidate[key];await reject('source candidate missing '+key,()=>resolveTarget(v));}
 for(const patch of [{token:'wrong-token-that-has-enough-bytes'},{delivery_admitted:true},{extra:true},
  {source_candidate:{...f.sourceCandidate,source_reservation_id:id(88)}},{expected:{...expected,employee_id:id(88)}}])await reject('crossed target '+Object.keys(patch)[0],()=>resolveTarget({...target,...patch}));
 const unavailable={schema:'custodial.native-schedule-target.v1',current:false,delivery_admitted:false,reason:'native_schedule_target_unavailable'};eq('source unavailable explicit',await resolveTarget(unavailable),unavailable);
 const arg={permit,expected,sourceCandidate:f.sourceCandidate,token},requests=[];
 const sender=prepareNativeScheduleDataSender({projectId:'synthetic',accessToken:'synthetic-access-only',fetchImpl:async(url,opts)=>{
  requests.push({url,opts});return new Response(JSON.stringify({name:'projects/synthetic/messages/original'}),{status:200});}});
 eq('actual sender data-only accepted',await sender(arg),{outcome:'provider_accepted',provider_message_id:'projects/synthetic/messages/original',error_code:null});
 const sent=JSON.parse(requests[0].opts.body);eq('exact data payload',sent,{message:{token,data:p,android:{priority:'high',ttl:'779s',restricted_package_name:'org.memphiszoo.custodial'}}});
 eq('no legacy title/body or notification envelope',Object.hasOwn(sent.message,'notification'),false);eq('redirect forbidden',requests[0].opts.redirect,'error');
 await reject('private sender consumed once',()=>sender(arg),'native_schedule_sender_already_consumed');eq('second invoke no second request',requests.length,1);
 for(const [http,outcome]of[[400,'known_nonacceptance'],[401,'known_nonacceptance'],[429,'known_nonacceptance'],[408,'delivery_outcome_unknown'],[500,'delivery_outcome_unknown'],[503,'delivery_outcome_unknown']]){
  let n=0;const send=prepareNativeScheduleDataSender({projectId:'synthetic',accessToken:'synthetic',fetchImpl:async()=>{n++;return new Response('synthetic',{status:http});}});
  eq('HTTP outcome '+http,(await send(arg)).outcome,outcome);await reject('HTTP never retries '+http,()=>send(arg));eq('only one HTTP '+http,n,1);
 }
 for(const body of ['not-json',JSON.stringify({name:'projects/other/messages/wrong'}),JSON.stringify({name:'projects/synthetic/messages/'}),
  JSON.stringify({name:'projects/synthetic/messages/good',extra:true}),JSON.stringify({name:'projects/synthetic/messages/ bad'}),'x'.repeat(16385)]){
  const send=prepareNativeScheduleDataSender({projectId:'synthetic',accessToken:'synthetic',fetchImpl:async()=>new Response(body,{status:200})});
  eq('ambiguous response cannot be accepted',(await send(arg)).outcome,'delivery_outcome_unknown');await reject('ambiguous response no resend',()=>send(arg));
 }
 const failed=prepareNativeScheduleDataSender({projectId:'synthetic',accessToken:'synthetic',fetchImpl:async()=>{throw Error('synthetic transport failure');}});
 eq('fetch loss unknown',(await failed(arg)).outcome,'delivery_outcome_unknown');await reject('loss cannot retry capability',()=>failed(arg));
 let network=0;const invalidSender=prepareNativeScheduleDataSender({projectId:'synthetic',accessToken:'synthetic',fetchImpl:async()=>{network++;assert.fail('no malformed send');}});
 await reject('wrong token consumes but never sends',()=>invalidSender({...arg,token:'wrong'}));await reject('bad first call still consumes',()=>invalidSender(arg));eq('malformed no network',network,0);
 assert.throws(()=>prepareNativeScheduleDataSender({projectId:'synthetic',accessToken:'synthetic'}));checks++;
 function runtime({prior=status(null,false),prepared=permit,targetValue=target,outcome=evidence('provider_accepted'),lostWrite=false,missingWrite=false,throwSend=false}={}){
  const calls=[];let sends=0,stored=null;
  const db={rpc:async(name,args)=>{calls.push(name);
   if(name==='custodial_native_schedule_dispatch_status')return{data:stored?status(stored):prior};
   if(name==='custodial_native_schedule_target')return{data:targetValue};
   if(name==='custodial_native_schedule_dispatch_prepare')return{data:prepared};
   if(name==='custodial_native_schedule_outcome'){
    if(!missingWrite)stored=args.p_evidence;if(lostWrite||missingWrite)throw Error('synthetic ambiguous write');
    return{data:{schema:'custodial.native-schedule-outcome-receipt.v1',binding:args.p_binding,evidence:stored,server_received_at:'2026-10-08T14:48:00.000000Z',replayed:false,dispatch_authorized:false,delivery_admitted:false}};
   }throw Error('unexpected RPC');}};
  const pushRuntime={prepareNativeScheduleSender:async()=>{calls.push('prepare-private-sender');return async()=>{sends++;if(throwSend)throw Error('synthetic send loss');return{outcome:outcome.outcome,provider_message_id:outcome.provider_message_id,error_code:outcome.error_code};};}};
  return{db,pushRuntime,calls,get sends(){return sends;}};
 }
 const fresh=runtime(),v=await deliverNativeScheduleJob({...fresh,job});eq('business accepted not handset delivery',[v.provider_message_id,v.delivery_admitted],['projects/synthetic/messages/original',false]);
 eq('OAuth preparation before SQL clock order',fresh.calls,['custodial_native_schedule_dispatch_status','prepare-private-sender','custodial_native_schedule_target','custodial_native_schedule_dispatch_prepare','custodial_native_schedule_outcome']);eq('fresh exactly one send',fresh.sends,1);
 const repeated=runtime({prior:status(evidence('provider_accepted'))});eq('original accepted readback',(await deliverNativeScheduleJob({...repeated,job})).replayed,true);eq('readback does not prepare/send',[repeated.calls,repeated.sends],[['custodial_native_schedule_dispatch_status'],0]);
 for(const outcome of [null,'known_nonacceptance','delivery_outcome_unknown']){const r=runtime({prior:status(outcome?evidence(outcome):null)});
  await reject('original prepared/refused/unknown no resend',()=>deliverNativeScheduleJob({...r,job}),outcome==='known_nonacceptance'?'native_schedule_provider_refused':'native_schedule_outcome_unknown_no_resend');eq('original no send',r.sends,0);}
 const lost=runtime({lostWrite:true});eq('lost outcome exact readback',(await deliverNativeScheduleJob({...lost,job})).replayed,true);eq('lost write no duplicate send',lost.sends,1);
 const missing=runtime({missingWrite:true});await reject('missing write stays pending',()=>deliverNativeScheduleJob({...missing,job}),'native_schedule_outcome_reconciliation_pending');eq('unknown write still only one send',missing.sends,1);
 const thrown=runtime({throwSend:true});await reject('send exception records unknown',()=>deliverNativeScheduleJob({...thrown,job}),'native_schedule_outcome_unknown_no_resend');eq('unknown recorded before stop',thrown.calls.at(-1),'custodial_native_schedule_outcome');
 const retired=runtime({targetValue:unavailable});await reject('retired source not sent',()=>deliverNativeScheduleJob({...retired,job}),'native_schedule_target_unavailable');eq('retired no send',retired.sends,0);
 for(const change of [{job_key:'other'},{payload_json:{...job.payload_json,extra:true}},
  {payload_json:{...job.payload_json,data_json:{...job.payload_json.data_json,test_delivery:true}}},{payload_json:{...job.payload_json,assignment_epoch:1}}]){
  const r=runtime();await reject('malformed job no admission',()=>deliverNativeScheduleJob({...r,job:{...job,...change}}));eq('malformed job no RPC',r.calls,[]);}
 eq('worker hold still before any new transport',readFileSync(new URL('../src/employee-notifications.js',import.meta.url),'utf8').includes('holdUnqualifiedNativeScheduleJob(job);'),true);
 return{status:'PASS',checks,actual_SQL:false,actual_transport_body:true,synthetic_fetch:true,provider_delivery:false,native_qualified:false,phone:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)console.log(JSON.stringify(await runNativeScheduleDispatchTests()));
