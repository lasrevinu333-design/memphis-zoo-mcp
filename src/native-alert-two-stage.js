import { isDeepStrictEqual } from 'node:util';
import { NATIVE_EVENT_SCHEMA, NATIVE_MESSAGE_SCHEMA, validateNativeAlertReservation } from './native-alert-reservation.js';

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const SHA = /^[0-9a-f]{64}$/;
const invalid = () => new Error('native_alert_stage_contract_invalid');
const exact = (value, keys) => value && Object.getPrototypeOf(value) === Object.prototype
  && isDeepStrictEqual(Object.keys(value).sort(), [...keys].sort());

// Stage one is durable source admission, not a permission to send. Its entire
// projection is returned only to the backend, never to the handset or FCM.
export function validateNativeAlertPreparation(value, { jobId, leaseToken, expected }) {
  if (!exact(value, ['schema', 'current', 'dispatch_authorized', 'prepared_id', 'job_id',
    'lease_token', 'kind', 'expected', 'source_revision', 'source_projection', 'prepared_until'])
    || value.schema !== 'custodial.native-alert-preparation.v1'
    || value.current !== true || value.dispatch_authorized !== false
    || !UUID.test(jobId) || !UUID.test(leaseToken) || !UUID.test(value.prepared_id)
    || value.job_id !== jobId || value.lease_token !== leaseToken
    || !['EVENT', 'MESSAGE'].includes(value.kind) || !SHA.test(value.source_revision)
    || !isDeepStrictEqual(value.expected, expected)
    || !value.source_projection || Object.getPrototypeOf(value.source_projection) !== Object.prototype
    || typeof value.prepared_until !== 'string'
    || !Number.isFinite(Date.parse(value.prepared_until))) throw invalid();
  const p = value.source_projection;
  if (value.kind === 'EVENT') {
    if (![p.event_id, p.instance_id].every(x => typeof x === 'string' && UUID.test(x))
      || !Number.isSafeInteger(p.event_revision) || p.event_revision < 1
      || !/^\d{4}-\d{2}-\d{2}$/.test(p.service_date)
      || !['three_days_before', 'two_days_before', 'shift_plus_15'].includes(p.notification_kind)
      || p.notification_key !== `event:${p.event_id}:${p.event_revision}:${p.service_date}:${expected.employee_id}:${expected.device_uuid}:${expected.assignment_epoch}:${p.notification_kind}`
      || p.employee_id !== expected.employee_id
      || ![p.employee_name, p.event_name, p.display_location, p.event_date, p.start_time, p.end_time]
        .every(x => typeof x === 'string' && x.length > 0)) throw invalid();
  } else if (p.schema !== 'custodial.employee-message-admission.v1'
    || ![p.message_id, p.thread_id, p.recipient_user_id].every(x => typeof x === 'string' && UUID.test(x))
    || p.source_revision !== value.source_revision || p.employee_id !== expected.employee_id
    || p.credential_id !== expected.credential_id || p.device_identifier !== expected.device_id
    || String(p.assignment_epoch) !== expected.assignment_epoch
    || p.registration_id !== expected.registration_id || p.token_hash !== expected.token_digest
    || p.payload?.data_json?.notification_key !== `message:${p.message_id}`
    || p.payload?.data_json?.route !== `messages.html?hub=employee&thread_id=${p.thread_id}`) throw invalid();
  return Object.freeze({ ...value, source_projection: Object.freeze({ ...p }) });
}

// Candidate deliberately has no clock, validity, hash, token or send grant.
// SQL must revalidate the exact source before finalizing its own wire bytes.
export function buildNativeAlertCandidate(prepared, { eventBody }) {
  const p = prepared.source_projection;
  let candidate;
  if (prepared.kind === 'EVENT') {
    if (typeof eventBody !== 'function') throw invalid();
    const body = eventBody(p);
    candidate = { schema: NATIVE_EVENT_SCHEMA, kind: 'employee_event',
      notification_type: 'event', title: 'Memphis Zoo event reminder', body,
      channel_id: 'employee-events', route: `events.html?hub=employee&event_id=${p.event_id}`,
      event_id: p.event_id, instance_id: p.instance_id, event_revision: String(p.event_revision),
      notification_kind: p.notification_kind, notification_key: p.notification_key,
      recipient_device_uuid: prepared.expected.device_uuid, service_date: p.service_date,
      source_revision: prepared.source_revision };
  } else {
    candidate = { schema: NATIVE_MESSAGE_SCHEMA, kind: 'employee_message', notification_type: 'message',
      title: p.payload?.title, body: p.payload?.body, channel_id: 'employee-messages',
      route: `messages.html?hub=employee&thread_id=${p.thread_id}`,
      message_id: p.message_id, thread_id: p.thread_id, recipient_user_id: p.recipient_user_id,
      notification_key: `message:${p.message_id}`, source_revision: prepared.source_revision };
  }
  if (!Object.values(candidate).every(x => typeof x === 'string' && x.length > 0)
    || Object.values(candidate).some(x => /[\u0000-\u001f\u007f-\u009f]/u.test(x))
    || Buffer.byteLength(candidate.title, 'utf8') > 180
    || Buffer.byteLength(candidate.body, 'utf8') > 1000) throw invalid();
  return Object.freeze(candidate);
}

// This adapter ends at the durable finalized permit. It never invokes a
// provider. A missing or ambiguous finalize response remains no-send.
export async function qualifyNativeAlert({ db, jobId, leaseToken, expected, eventBody }) {
  if (typeof db?.rpc !== 'function') throw invalid();
  const first = await db.rpc('custodial_native_alert_prepare', {
    p_job: jobId, p_lease: leaseToken, p_expected: expected });
  if (first.error) throw new Error('native_alert_preparation_pending');
  const prepared = validateNativeAlertPreparation(first.data, { jobId, leaseToken, expected });
  const candidate = buildNativeAlertCandidate(prepared, { eventBody });
  const second = await db.rpc('custodial_native_alert_finalize', {
    p_job: jobId, p_lease: leaseToken, p_prepared: prepared.prepared_id,
    p_expected: expected, p_candidate: candidate });
  if (second.error) throw new Error('native_alert_finalization_pending');
  const source = prepared.kind === 'EVENT'
    ? { kind: 'EVENT', event_id: prepared.source_projection.event_id,
      instance_id: prepared.source_projection.instance_id,
      event_revision: String(prepared.source_projection.event_revision),
      notification_kind: prepared.source_projection.notification_kind,
      source_revision: prepared.source_revision, valid_until: prepared.prepared_until }
    : { kind: 'MESSAGE', message_id: prepared.source_projection.message_id,
      thread_id: prepared.source_projection.thread_id,
      recipient_user_id: prepared.source_projection.recipient_user_id,
      source_revision: prepared.source_revision, valid_until: prepared.prepared_until };
  return validateNativeAlertReservation(second.data, { jobId, leaseToken, expected, source });
}
