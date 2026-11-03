import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

export const NATIVE_EVENT_SCHEMA = 'custodial.native-event-payload.v1';
export const NATIVE_MESSAGE_SCHEMA = 'custodial.native-message-payload.v1';
const COMMON = `schema generation_id principal_digest token_digest receipt_job_id receipt_credential_id receipt_employee_id receipt_device_id receipt_assignment_epoch notification_key reservation_at valid_until content_sha256 kind notification_type title body channel_id route service_date`.split(' ');
export const NATIVE_EVENT_KEYS = Object.freeze([...COMMON, 'event_id', 'instance_id', 'event_revision', 'notification_kind', 'source_revision', 'recipient_device_uuid'].sort());
export const NATIVE_MESSAGE_KEYS = Object.freeze([...COMMON, 'message_id', 'thread_id', 'recipient_user_id', 'source_revision'].sort());
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const SHA = /^[0-9a-f]{64}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const EVENT_KINDS = new Set(['three_days_before', 'two_days_before', 'shift_plus_15']);
const invalid = () => new Error('native_alert_reservation_contract_invalid');
const exact = (value, keys) => value && Object.getPrototypeOf(value) === Object.prototype
  && isDeepStrictEqual(Object.keys(value).sort(), [...keys].sort());

function micros(value) {
  const match = typeof value === 'string' && /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{6})Z$/.exec(value);
  if (!match) throw invalid();
  const [, y, month, day, hour, minute, second, fraction] = match;
  const year = Number(y), m = Number(month), d = Number(day);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || m < 1 || m > 12 || d < 1 || d > days[m - 1]
    || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) throw invalid();
  const epoch = Date.parse(`${y}-${month}-${day}T${hour}:${minute}:${second}Z`);
  if (!Number.isFinite(epoch)) throw invalid();
  return BigInt(epoch) * 1000n + BigInt(fraction);
}

export function canonicalNativeAlert(value, { excludeHash = false } = {}) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) throw invalid();
  const ordered = {};
  for (const key of Object.keys(value).sort()) {
    if (!/^[a-z][a-z0-9_]*$/.test(key) || typeof value[key] !== 'string'
      || /[\u0000-\u001f\u007f-\u009f]/u.test(value[key])) throw invalid();
    if (!excludeHash || key !== 'content_sha256') ordered[key] = value[key];
  }
  return JSON.stringify(ordered);
}

export function validateNativeAlertRecipient(expected) {
  const keys = ['generation_id', 'principal_digest', 'token_digest', 'credential_id', 'employee_id',
    'device_id', 'device_uuid', 'assignment_epoch', 'registration_id'];
  if (!exact(expected, keys) || ![expected.generation_id, expected.credential_id, expected.employee_id,
    expected.device_uuid, expected.registration_id].every(value => typeof value === 'string' && UUID.test(value))
    || ![expected.principal_digest, expected.token_digest].every(value => typeof value === 'string' && SHA.test(value))
    || !/^KIOSK_(?:0[2-9]|10)$/.test(expected.device_id)
    || !/^[1-9][0-9]{0,15}$/.test(expected.assignment_epoch)
    || BigInt(expected.assignment_epoch) > 9007199254740991n) throw invalid();
  return Object.freeze({...expected});
}

export function validateNativeAlertPayload(payload, { jobId, expected, source }) {
  expected = validateNativeAlertRecipient(expected);
  if (!source || Object.getPrototypeOf(source) !== Object.prototype || !UUID.test(jobId)) throw invalid();
  const event = source.kind === 'EVENT';
  if (!['EVENT', 'MESSAGE'].includes(source.kind) || !exact(payload, event ? NATIVE_EVENT_KEYS : NATIVE_MESSAGE_KEYS)
    || Object.values(payload).some(value => typeof value !== 'string')
    || payload.schema !== (event ? NATIVE_EVENT_SCHEMA : NATIVE_MESSAGE_SCHEMA)
    || payload.kind !== (event ? 'employee_event' : 'employee_message')
    || payload.notification_type !== (event ? 'event' : 'message')
    || payload.channel_id !== (event ? 'employee-events' : 'employee-messages')
    || payload.receipt_job_id !== jobId
    || payload.generation_id !== expected.generation_id
    || payload.principal_digest !== expected.principal_digest
    || payload.token_digest !== expected.token_digest
    || payload.receipt_credential_id !== expected.credential_id
    || payload.receipt_employee_id !== expected.employee_id
    || payload.receipt_device_id !== expected.device_id
    || payload.receipt_assignment_epoch !== expected.assignment_epoch
    || !DATE.test(payload.service_date)
    || !SHA.test(payload.content_sha256)
    || createHash('sha256').update(canonicalNativeAlert(payload, { excludeHash: true })).digest('hex') !== payload.content_sha256
    || Buffer.byteLength(canonicalNativeAlert(payload), 'utf8') > 3500) throw invalid();
  const from = micros(payload.reservation_at), until = micros(payload.valid_until);
  if (from >= until || (source.valid_until && until > micros(source.valid_until))) throw invalid();
  if (!payload.title || !payload.body || Buffer.byteLength(payload.title, 'utf8') > 180
    || Buffer.byteLength(payload.body, 'utf8') > 1000
    || Buffer.byteLength(payload.notification_key, 'utf8') > 240) throw invalid();
  if (event) {
    if (![payload.event_id, payload.instance_id, payload.recipient_device_uuid].every(value => UUID.test(value))
      || !/^[1-9][0-9]{0,9}$/.test(payload.event_revision)
      || !EVENT_KINDS.has(payload.notification_kind)
      || !SHA.test(payload.source_revision)
      || payload.event_id !== source.event_id || payload.instance_id !== source.instance_id
      || payload.event_revision !== source.event_revision
      || payload.recipient_device_uuid !== expected.device_uuid
      || payload.source_revision !== source.source_revision
      || payload.notification_kind !== source.notification_kind
      || payload.notification_key !== `event:${payload.event_id}:${payload.event_revision}:${payload.service_date}:${expected.employee_id}:${expected.device_uuid}:${expected.assignment_epoch}:${payload.notification_kind}`
      || payload.route !== `events.html?hub=employee&event_id=${payload.event_id}`) throw invalid();
  } else if (!UUID.test(payload.message_id) || !UUID.test(payload.thread_id)
    || !UUID.test(payload.recipient_user_id) || !SHA.test(payload.source_revision)
    || payload.message_id !== source.message_id || payload.thread_id !== source.thread_id
    || payload.recipient_user_id !== source.recipient_user_id
    || payload.source_revision !== source.source_revision
    || payload.notification_key !== `message:${payload.message_id}`
    || payload.route !== `messages.html?hub=employee&thread_id=${payload.thread_id}`) throw invalid();
  return Object.freeze({ ...payload });
}

export function validateNativeAlertReservation(value, { jobId, leaseToken, expected, source }) {
  if (!exact(value, ['schema', 'dispatch_authorized', 'reservation', 'attempt_id', 'outcome_operation_id', 'ttl_seconds'])
    || value.schema !== 'custodial.native-alert-dispatch.v1' || value.dispatch_authorized !== true
    || !UUID.test(leaseToken) || !UUID.test(value.attempt_id) || !UUID.test(value.outcome_operation_id)
    || value.attempt_id === value.outcome_operation_id
    || !exact(value.reservation, ['current', 'replayed', 'delivery_outcome_unknown', 'dispatch_authorized', 'payload', 'wire'])
    || value.reservation.current !== true || value.reservation.replayed !== false
    || value.reservation.delivery_outcome_unknown !== false || value.reservation.dispatch_authorized !== true) throw invalid();
  const payload = validateNativeAlertPayload(value.reservation.payload, { jobId, expected, source });
  const wire = canonicalNativeAlert(payload);
  const seconds = (micros(payload.valid_until) - micros(payload.reservation_at)) / 1000000n;
  if (value.reservation.wire !== wire || seconds <= 0n || !Number.isSafeInteger(value.ttl_seconds)
    || value.ttl_seconds !== Number(seconds > 2419200n ? 2419200n : seconds)) throw invalid();
  return Object.freeze({ ...value, reservation: Object.freeze({ ...value.reservation, payload }) });
}
