import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildNativeAlertCandidate, qualifyNativeAlert, validateNativeAlertPreparation } from '../src/native-alert-two-stage.js';
import { canonicalNativeAlert } from '../src/native-alert-reservation.js';

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sha = x => createHash('sha256').update(x).digest('hex');
const expected = {generation_id:id(1),principal_digest:sha('principal'),token_digest:sha('token'),
  credential_id:id(2),employee_id:id(3),device_id:'KIOSK_08',device_uuid:id(4),
  assignment_epoch:'2',registration_id:id(5)};
const jobId=id(6), leaseToken=id(7), from='2026-10-04T15:00:00.000000Z', until='2026-10-04T15:01:00.000000Z';
const eventProjection={current:true,event_id:id(8),instance_id:id(9),event_revision:3,
  notification_kind:'two_days_before',service_date:'2026-10-04',
  notification_key:`event:${id(8)}:3:2026-10-04:${expected.employee_id}:${expected.device_uuid}:2:two_days_before`,
  employee_id:expected.employee_id,employee_name:'Karen',event_name:'Zoo event',
  display_location:'North Plaza',event_date:'2026-10-06',start_time:'09:00',end_time:'11:00'};
const messageProjection={schema:'custodial.employee-message-admission.v1',message_id:id(10),thread_id:id(11),
  recipient_user_id:id(12),source_revision:sha('message'),employee_id:expected.employee_id,
  credential_id:expected.credential_id,device_identifier:expected.device_id,assignment_epoch:2,
  registration_id:expected.registration_id,token_hash:expected.token_digest,
  payload:{title:'Manager',body:'Please check your messages.',data_json:{notification_key:`message:${id(10)}`,
    route:`messages.html?hub=employee&thread_id=${id(11)}`}}};
const prepared = (kind='EVENT') => ({schema:'custodial.native-alert-preparation.v1',current:true,
  dispatch_authorized:false,prepared_id:id(13),job_id:jobId,lease_token:leaseToken,kind,expected,
  source_revision:kind==='EVENT'?sha('event'):sha('message'),
  source_projection:kind==='EVENT'?eventProjection:messageProjection,prepared_until:until});
const eventBody = p => `${p.employee_name}, ${p.event_name} at ${p.display_location}.`;
let checks=0;
for (const kind of ['EVENT','MESSAGE']) {
  const p=prepared(kind),valid=validateNativeAlertPreparation(p,{jobId,leaseToken,expected});checks++;
  const candidate=buildNativeAlertCandidate(valid,{eventBody});checks++;
  assert.equal(Object.hasOwn(candidate,'reservation_at'),false);checks++;
  assert.equal(Object.hasOwn(candidate,'valid_until'),false);checks++;
  assert.equal(Object.hasOwn(candidate,'content_sha256'),false);checks++;
  assert.equal(Object.hasOwn(candidate,'token'),false);checks++;
  assert.equal(candidate.source_revision,p.source_revision);checks++;
  for(const [index,mutate] of [q=>{q.dispatch_authorized=true;},q=>{q.prepared_id=id(14);q.job_id=id(15);},
    q=>{q.expected={...expected,credential_id:id(16)};},q=>{q.source_revision='bad';},
    q=>{q.source_projection={...q.source_projection,employee_id:id(17)};},
    q=>{if(q.kind==='EVENT')q.source_projection={...q.source_projection,notification_key:'other'};
      else q.source_projection.payload.data_json.notification_key='other';}].entries()){
    const q=structuredClone(p);mutate(q);
    assert.throws(()=>validateNativeAlertPreparation(q,{jobId,leaseToken,expected}),/native_alert_stage_contract_invalid/,`${kind} mutation ${index}`);checks++;
  }
}
const calls=[];
const staged=prepared();
const body=eventBody(eventProjection);
const makePermit = candidate => {
  const payload={...candidate,generation_id:expected.generation_id,principal_digest:expected.principal_digest,
    token_digest:expected.token_digest,receipt_job_id:jobId,receipt_credential_id:expected.credential_id,
    receipt_employee_id:expected.employee_id,receipt_device_id:expected.device_id,
    receipt_assignment_epoch:expected.assignment_epoch,reservation_at:from,valid_until:until,content_sha256:''};
  payload.content_sha256=sha(canonicalNativeAlert(payload,{excludeHash:true}));
  return {schema:'custodial.native-alert-dispatch.v1',dispatch_authorized:true,
    reservation:{current:true,replayed:false,delivery_outcome_unknown:false,dispatch_authorized:true,
      payload,wire:canonicalNativeAlert(payload)},attempt_id:id(18),outcome_operation_id:id(19),ttl_seconds:60};
};
const db={rpc:async(name,args)=>{calls.push(name);
  if(name==='custodial_native_alert_prepare')return {data:staged,error:null};
  assert.equal(args.p_prepared,staged.prepared_id);checks++;
  assert.equal(args.p_candidate.body,body);checks++;
  return {data:makePermit(args.p_candidate),error:null};}};
const permit=await qualifyNativeAlert({db,jobId,leaseToken,expected,eventBody});
assert.deepEqual(calls,['custodial_native_alert_prepare','custodial_native_alert_finalize']);checks++;
assert.equal(permit.reservation.payload.body,body);checks++;
for(const mode of ['prepare_error','prepare_stale','finalize_error','finalize_malformed']){
  const order=[];const fake={rpc:async name=>{order.push(name);
    if(name==='custodial_native_alert_prepare')return mode==='prepare_error'?{error:new Error('lost')}
      :{data:mode==='prepare_stale'?{...staged,dispatch_authorized:true}:staged};
    return mode==='finalize_error'?{error:new Error('lost')}:{data:{dispatch_authorized:true}};}};
  await assert.rejects(()=>qualifyNativeAlert({db:fake,jobId,leaseToken,expected,eventBody}));checks++;
  assert.deepEqual(order,mode.startsWith('prepare_')?['custodial_native_alert_prepare']
    :['custodial_native_alert_prepare','custodial_native_alert_finalize']);checks++;
}
console.log(JSON.stringify({ok:true,checks,noProviderInvocation:true}));
