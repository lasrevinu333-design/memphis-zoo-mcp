// Synthetic SQL/provider edges only; never a real reservation or delivery.
import {createHash} from 'node:crypto';
import {canonicalNativeAlert} from '../../src/native-alert-reservation.js';
import {prepareNativeMessageDataSender} from '../../src/native-message-dispatch.js';

export const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export const sha=x=>createHash('sha256').update(x).digest('hex');
const copy=x=>structuredClone(x);
export function messageFixture(options={}){
 const token='SYNTHETIC-FCM-TOKEN-NOT-A-REGISTRATION',calls=[],requests=[];
 const expected={generation_id:id(1),principal_digest:sha('synthetic-principal'),token_digest:sha(token),
  credential_id:id(2),employee_id:id(3),device_id:'KIOSK_08',device_uuid:id(4),assignment_epoch:'2',registration_id:id(5)};
 const job={job_id:id(6),lease_token:id(7),source_id:id(10),job_type:'employee_native_push',
  job_key:`employee-message-push:${id(10)}:${expected.credential_id}`,
  payload_json:{credential_id:expected.credential_id,employee_id:expected.employee_id,device_id:expected.device_uuid,
   device_identifier:expected.device_id,assignment_epoch:2,title:'Synthetic manager',body:'Original synthetic message.',
   channel_id:'employee-messages',data_json:{kind:'employee_message',notification_type:'message',
    notification_key:`message:${id(10)}`,message_id:id(10),thread_id:id(11),route:`messages.html?hub=employee&thread_id=${id(11)}`}}};
 const prepared={schema:'custodial.native-alert-preparation.v1',current:true,dispatch_authorized:false,
  prepared_id:id(13),job_id:job.job_id,lease_token:job.lease_token,kind:'MESSAGE',expected:copy(expected),
  source_revision:sha('synthetic-source'),prepared_until:'2026-10-04T15:01:00.000000Z',
  source_projection:{schema:'custodial.employee-message-admission.v1',message_id:id(10),thread_id:id(11),
   recipient_user_id:id(12),source_revision:sha('synthetic-source'),employee_id:expected.employee_id,
   credential_id:expected.credential_id,device_identifier:expected.device_id,assignment_epoch:2,
   registration_id:expected.registration_id,token_hash:expected.token_digest,payload:copy(job.payload_json)}};
 let permit=null,ledger=options.prior?copy(options.prior):null;
 function finalize(candidate){
  const payload={...candidate,generation_id:expected.generation_id,principal_digest:expected.principal_digest,
   token_digest:expected.token_digest,receipt_job_id:job.job_id,receipt_credential_id:expected.credential_id,
   receipt_employee_id:expected.employee_id,receipt_device_id:expected.device_id,receipt_assignment_epoch:expected.assignment_epoch,
   service_date:'2026-10-04',reservation_at:'2026-10-04T15:00:00.000000Z',valid_until:prepared.prepared_until,content_sha256:''};
  payload.content_sha256=sha(canonicalNativeAlert(payload,{excludeHash:true}));
  return{schema:'custodial.native-alert-dispatch.v1',dispatch_authorized:true,attempt_id:id(18),outcome_operation_id:id(19),ttl_seconds:60,
   reservation:{current:true,replayed:false,delivery_outcome_unknown:false,dispatch_authorized:true,payload,wire:canonicalNativeAlert(payload)}};
 }
 const noReservation={schema:'custodial.native-alert-dispatch-status.v1',reserved:false,dispatch_authorized:false};
 const reserved=(p,outcome='prepared',provider=null,error=null)=>({schema:'custodial.native-alert-dispatch-status.v1',reserved:true,
  dispatch_authorized:false,job_id:job.job_id,attempt_id:p.attempt_id,outcome_operation_id:p.outcome_operation_id,
  content_sha256:p.reservation.payload.content_sha256,provider_outcome:outcome,provider_message_id:provider,error_code:error});
 const db={async rpc(name,args){
  calls.push({name,args:copy(args)});
  if(name==='custodial_native_alert_dispatch_status')return options.statusError?{error:new Error('synthetic status unavailable')}
   :{data:options.statusTransform?options.statusTransform(copy(ledger||noReservation)):copy(ledger||noReservation)};
  if(name==='custodial_native_alert_target'){
   const value={current:true,kind:'MESSAGE',token,expected:copy(expected)};
   return{data:options.targetTransform?options.targetTransform(value):value};
  }
  if(name==='custodial_native_alert_prepare')return options.prepareError?{error:new Error('synthetic preparation loss')}
   :{data:options.prepareTransform?options.prepareTransform(copy(prepared)):copy(prepared)};
  if(name==='custodial_native_alert_finalize'){
   permit=finalize(args.p_candidate);ledger=reserved(permit);
   if(options.finalizeError)return{error:new Error('synthetic finalize response loss')};
   return{data:options.permitTransform?options.permitTransform(copy(permit)):copy(permit)};
  }
  if(name==='custodial_native_alert_record_outcome'){
   const e=args.p_evidence;
   ledger=reserved(permit,e.outcome,e.provider_message_id,e.error_code);
   if(options.recordTransform)ledger=options.recordTransform(ledger);
   if(options.recordError)return{error:new Error('synthetic acknowledgement loss')};
   if(options.recordThrow)throw Error('synthetic acknowledgement loss');
   return{data:{schema:'custodial.native-alert-outcome.v1',recorded:true,replayed:false,
    provider_outcome:e.outcome,provider_message_id:e.provider_message_id,error_code:e.error_code}};
  }
  if(name==='mz_get_employee_native_push_delivery_receipt')return{data:options.legacy||{current:true,already_recorded:false}};
  throw Error('Unexpected RPC '+name);
 }};
 const fetchImpl=async(url,init)=>{
  calls.push({name:'FCM_SYNTHETIC'});requests.push({url,init,body:JSON.parse(init.body)});
  return options.fetchImpl?options.fetchImpl(url,init):new Response(JSON.stringify({name:'projects/synthetic-zoo/messages/original'}),{status:200});
 };
 const pushRuntime={configured:true,async prepareNativeMessageSender(){
  calls.push({name:'OAUTH_SYNTHETIC'});if(options.oauth)await options.oauth(job);
  return options.sender||prepareNativeMessageDataSender({projectId:'synthetic-zoo',accessToken:'synthetic-not-an-oauth-token',fetchImpl});
 },send(){throw Error('Real MESSAGE must not use generic push');}};
 return{job,expected,prepared,token,db,pushRuntime,calls,requests,finalize,reserved,
  get permit(){return permit;},get ledger(){return ledger;}};
}
