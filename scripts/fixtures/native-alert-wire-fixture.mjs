// Synthetic wire-compatibility fixture only. Times below are literal test
// examples, not a server reservation, business horizon, or provider receipt.
import { createHash } from 'node:crypto';
import { canonicalNativeAlert } from '../../src/native-alert-reservation.js';

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sha = text => createHash('sha256').update(text).digest('hex');
const expected = Object.freeze({ generation_id:id(1),principal_digest:sha('principal'),token_digest:sha('token'),
  credential_id:id(2),employee_id:id(3),device_id:'KIOSK_08',device_uuid:id(4),
  assignment_epoch:'2',registration_id:id(5) });
const jobId=id(6),from='2026-10-04T15:00:00.000000Z',until='2026-10-04T15:01:00.000000Z';
function common(kind) {
  return { schema:kind==='EVENT'?'custodial.native-event-payload.v1':'custodial.native-message-payload.v1',
    generation_id:expected.generation_id,principal_digest:expected.principal_digest,token_digest:expected.token_digest,
    receipt_job_id:jobId,receipt_credential_id:expected.credential_id,
    receipt_employee_id:expected.employee_id,receipt_device_id:expected.device_id,
    receipt_assignment_epoch:expected.assignment_epoch,notification_key:'',reservation_at:from,
    valid_until:until,content_sha256:'',kind:kind==='EVENT'?'employee_event':'employee_message',
    notification_type:kind.toLowerCase(),title:'',body:'',
    channel_id:kind==='EVENT'?'employee-events':'employee-messages',route:'',service_date:'2026-10-04' };
}
const event = { ...common('EVENT'),event_id:id(8),instance_id:id(9),event_revision:'3',
  notification_kind:'two_days_before',source_revision:sha('event-projection'),recipient_device_uuid:expected.device_uuid,
  title:'Memphis Zoo event reminder',body:'Karen, event reminder. Zoo event is at North Plaza on 2026-10-06, from 09:00 to 11:00.' };
event.notification_key=`event:${event.event_id}:${event.event_revision}:${event.service_date}:${expected.employee_id}:${expected.device_uuid}:${expected.assignment_epoch}:${event.notification_kind}`;
event.route=`events.html?hub=employee&event_id=${event.event_id}`;
const message = { ...common('MESSAGE'),message_id:id(10),thread_id:id(11),recipient_user_id:id(12),
  source_revision:sha('message-projection'),title:'Manager',body:'Please check your messages.' };
message.notification_key=`message:${message.message_id}`;
message.route=`messages.html?hub=employee&thread_id=${message.thread_id}`;
for (const payload of [event,message]) payload.content_sha256=sha(canonicalNativeAlert(payload,{excludeHash:true}));
export const syntheticNativeAlertWire = Object.freeze({schema:'custodial.synthetic-native-alert-wire-fixture.v1',
  scope:'PARSER_COMPATIBILITY_ONLY_NOT_SQL_FINALIZED',expected,jobId,
  event:Object.freeze(event),message:Object.freeze(message)});
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href)
  process.stdout.write(`${JSON.stringify(syntheticNativeAlertWire)}\n`);
