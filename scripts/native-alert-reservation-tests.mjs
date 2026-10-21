import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { canonicalNativeAlert, NATIVE_EVENT_KEYS, NATIVE_MESSAGE_KEYS,
  validateNativeAlertPayload, validateNativeAlertReservation } from '../src/native-alert-reservation.js';
import { syntheticNativeAlertWire } from './fixtures/native-alert-wire-fixture.mjs';

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const digest = text => createHash('sha256').update(text).digest('hex');
const expected = { generation_id:id(1), principal_digest:digest('principal'), token_digest:digest('token'),
  credential_id:id(2), employee_id:id(3), device_id:'KIOSK_08', device_uuid:id(4),
  assignment_epoch:'2', registration_id:id(5) };
const jobId=id(6), leaseToken=id(7), from='2026-10-04T15:00:00.000000Z', until='2026-10-04T15:01:00.000000Z';
function payload(kind) {
  const event=kind==='EVENT',source=event
    ? {kind,event_id:id(8),instance_id:id(9),event_revision:'3',notification_kind:'two_days_before',source_revision:digest('event-v3'),valid_until:until}
    : {kind,message_id:id(10),thread_id:id(11),recipient_user_id:id(12),source_revision:digest('message-v1'),valid_until:until};
  const p={schema:event?'custodial.native-event-payload.v1':'custodial.native-message-payload.v1',
    generation_id:expected.generation_id,principal_digest:expected.principal_digest,token_digest:expected.token_digest,
    receipt_job_id:jobId,receipt_credential_id:expected.credential_id,receipt_employee_id:expected.employee_id,
    receipt_device_id:expected.device_id,receipt_assignment_epoch:expected.assignment_epoch,
    reservation_at:from,valid_until:until,content_sha256:'',kind:event?'employee_event':'employee_message',
    notification_type:event?'event':'message',title:'Operations Manager',body:'Current, approved reminder.',
    channel_id:event?'employee-events':'employee-messages',service_date:'2026-10-04',
    notification_key:event
      ? `event:${source.event_id}:${source.event_revision}:2026-10-04:${expected.employee_id}:${expected.device_uuid}:${expected.assignment_epoch}:${source.notification_kind}`
      : `message:${source.message_id}`,
    route:event?`events.html?hub=employee&event_id=${source.event_id}`
      :`messages.html?hub=employee&thread_id=${source.thread_id}`,
    ...(event?{event_id:source.event_id,instance_id:source.instance_id,event_revision:source.event_revision,
      notification_kind:source.notification_kind,source_revision:source.source_revision,recipient_device_uuid:expected.device_uuid}
      :{message_id:source.message_id,thread_id:source.thread_id,recipient_user_id:source.recipient_user_id,
        source_revision:source.source_revision})};
  p.content_sha256=digest(canonicalNativeAlert(p,{excludeHash:true}));
  return {p,source};
}
let checks=0;
for(const kind of ['EVENT','MESSAGE']){
  const {p,source}=payload(kind),keys=kind==='EVENT'?NATIVE_EVENT_KEYS:NATIVE_MESSAGE_KEYS;
  assert.deepEqual(Object.keys(p).sort(),keys);checks++;
  assert.deepEqual(validateNativeAlertPayload(p,{jobId,expected,source}),p);checks++;
  const permit={schema:'custodial.native-alert-dispatch.v1',dispatch_authorized:true,
    reservation:{current:true,replayed:false,delivery_outcome_unknown:false,dispatch_authorized:true,payload:p,wire:canonicalNativeAlert(p)},
    attempt_id:id(13),outcome_operation_id:id(14),ttl_seconds:60};
  assert.equal(validateNativeAlertReservation(permit,{jobId,leaseToken,expected,source}).ttl_seconds,60);checks++;
  const hostile=[
    q=>{q.body='changed after source';},q=>{q.content_sha256=digest('forged');},
    q=>{q.valid_until='2026-10-04T15:02:00.000000Z';},q=>{q.receipt_employee_id=id(15);},
    q=>{q.notification_key+=':forged';},q=>{q.route='https://example.invalid';},
    q=>{q.unknown='extra';},q=>{delete q.generation_id;},q=>{q.title='bad\nheader';},
    q=>{q.body='x'.repeat(1001);},q=>{q.reservation_at=q.valid_until;},
    q=>{q.source_revision=digest('stale');},
  ];
  for(const mutate of hostile){const q={...p};mutate(q);
    assert.throws(()=>validateNativeAlertPayload(q,{jobId,expected,source}),/native_alert_reservation_contract_invalid/);checks++;}
  const wrongKind={...source,kind:kind==='EVENT'?'MESSAGE':'EVENT'};
  assert.throws(()=>validateNativeAlertPayload(p,{jobId,expected,source:wrongKind}),/native_alert_reservation_contract_invalid/);checks++;
  const stale={...source,source_revision:digest('new revision')};
  assert.throws(()=>validateNativeAlertPayload(p,{jobId,expected,source:stale}),/native_alert_reservation_contract_invalid/);checks++;
  for(const mutate of [q=>{q.attempt_id=q.outcome_operation_id;},q=>{q.ttl_seconds=120;},
    q=>{q.reservation={...q.reservation,wire:'{}'};},q=>{q.reservation={...q.reservation,replayed:true};}]){
    const q=structuredClone(permit);mutate(q);
    assert.throws(()=>validateNativeAlertReservation(q,{jobId,leaseToken,expected,source}),/native_alert_reservation_contract_invalid/);checks++;
  }
}
for (const kind of ['event','message']) {
  const p=syntheticNativeAlertWire[kind];
  const source=kind==='event'
    ? {kind:'EVENT',event_id:p.event_id,instance_id:p.instance_id,event_revision:p.event_revision,
      notification_kind:p.notification_kind,source_revision:p.source_revision,valid_until:p.valid_until}
    : {kind:'MESSAGE',message_id:p.message_id,thread_id:p.thread_id,
      recipient_user_id:p.recipient_user_id,source_revision:p.source_revision,valid_until:p.valid_until};
  assert.deepEqual(validateNativeAlertPayload(p,{jobId:syntheticNativeAlertWire.jobId,
    expected:syntheticNativeAlertWire.expected,source}),p);checks++;
}
console.log(JSON.stringify({ok:true,checks,schemas:['custodial.native-event-payload.v1','custodial.native-message-payload.v1']}));
