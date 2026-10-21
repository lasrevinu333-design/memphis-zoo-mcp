import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { readHeldLedgerSnapshot } from './manager-held-event-review-reader.js';
import { projectHeldReviewRow } from './manager-held-event-review.js';
import { postgresJsonbContentDigest } from './static-weekly-schedule-program.js';

export const HELD_CANONICAL_PREVIEW_REQUEST = 'custodial.held-event-correction-preview-request.v2';
export const HELD_CANONICAL_PREVIEW = 'custodial.held-event-correction-preview.v2';
export const HELD_CANONICAL_CONFIRM_REQUEST = 'custodial.held-event-correction-confirm-request.v2';
export const HELD_CANONICAL_CONFIRMED = 'custodial.held-event-correction-confirmed.v2';
export const HELD_CANONICAL_STATUS_REQUEST = 'custodial.held-event-correction-status-request.v2';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA = /^[a-f0-9]{64}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const SOURCE_KEY_PREFIX = 'custodial-outlook-events-v1/event/';
const CORRECTION_ASSERTION = 'MANAGER_CONFIRMED_MISSING_ORIGINAL_FACTS';
const ORIGINAL_MISSING = Object.freeze(['event_name', 'start_at']);
const FACT_BASIS = Object.freeze({ event_name: 'MANAGER_CONFIRMED', start_at: 'MANAGER_CONFIRMED',
  end_at: 'MANAGER_CONFIRMED', venue_ref: 'MANAGER_CONFIRMED' });
const LEDGER_SELECT = 'id,event_id,received_at,payload_hash,sync_status,outlook_message_id,source_event_key,source_payload';
const VENUE_SELECT = 'id,display_name,location_group_id,event_scope,active,eligible_event_venue,updated_at';
const EVENT_SELECT = 'id,revision,status,event_name,event_date,start_time,end_date,end_time,start_instant_utc,end_instant_utc,primary_venue_id,location_group_id,display_location,operation_id,source_format,manually_overridden,needs_review';
const STATUS_PREVIEW_SELECT = 'preview_id,preview_sha256,ledger_id,source_provenance_digest,original_payload_sha256,original_message_id,original_event_key,original_received_at,original_subject,original_created_at,original_updated_at,venue_id,normalized_event,manager_id,credential_id,device_id,session_fingerprint,state,event_id,applied_at';
const STATUS_LEDGER_SELECT = `${LEDGER_SELECT},source_subject,created_at,updated_at,sync_note`;
const STATUS_EVENT_SELECT = `${EVENT_SELECT},created_by_manager_id,updated_by_manager_id,created_by,overridden_by,event_timezone`;
const fail = (code, status = 409) => { throw Object.assign(new Error(code), { code, status }); };
const plain = value => value && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const exact = (value, keys) => plain(value) && Object.keys(value).length === keys.length
  && keys.every(key => Object.hasOwn(value, key));
const instant = value => typeof value === 'string' && ISO.test(value)
  && Number.isFinite(Date.parse(value));
const sha = value => createHash('sha256').update(value).digest('hex');
const boundUuid = value => typeof value === 'string' && UUID.test(value);
const normalizedInstant = value => new Date(value).toISOString();
const positive = value => Number.isSafeInteger(value) && value > 0;
function chicagoParts(value) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago',
    hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(value)).filter(part => part.type !== 'literal')
    .map(part => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}:${parts.second}` };
}

function parsePreview(value) {
  if (!exact(value, ['schema', 'ledger_id', 'expected_review_snapshot_sha256',
    'source_provenance_digest', 'correction', 'manager_fact_confirmation'])
    || value.schema !== HELD_CANONICAL_PREVIEW_REQUEST || !boundUuid(value.ledger_id)
    || !SHA.test(value.expected_review_snapshot_sha256 || '')
    || !SHA.test(value.source_provenance_digest || '')
    || value.manager_fact_confirmation !== CORRECTION_ASSERTION
    || !exact(value.correction, ['event_name', 'start_at', 'end_at', 'venue_ref'])
    || typeof value.correction.event_name !== 'string'
    || !value.correction.event_name.trim()
    || value.correction.event_name.trim().length > 180
    || !instant(value.correction.start_at) || !instant(value.correction.end_at)
    || !boundUuid(value.correction.venue_ref)) fail('held_canonical_preview_request_invalid', 400);
  const start_at = normalizedInstant(value.correction.start_at);
  const end_at = normalizedInstant(value.correction.end_at);
  if (Date.parse(end_at) <= Date.parse(start_at)) fail('held_canonical_end_invalid', 400);
  return Object.freeze({ ledger_id: value.ledger_id.toLowerCase(),
    snapshot: value.expected_review_snapshot_sha256, digest: value.source_provenance_digest,
    event_name: value.correction.event_name.trim(), start_at, end_at,
    venue_ref: value.correction.venue_ref.toLowerCase() });
}

function parseConfirm(value) {
  if (!exact(value, ['schema', 'preview_id', 'preview_sha256'])
    || value.schema !== HELD_CANONICAL_CONFIRM_REQUEST
    || !boundUuid(value.preview_id) || !SHA.test(value.preview_sha256 || ''))
    fail('held_canonical_confirm_request_invalid', 400);
  return value;
}

function parseStatus(value) {
  if (!exact(value, ['schema', 'preview_id', 'preview_sha256'])
    || value.schema !== HELD_CANONICAL_STATUS_REQUEST
    || !boundUuid(value.preview_id) || !SHA.test(value.preview_sha256 || ''))
    fail('held_canonical_status_request_invalid', 400);
  return Object.freeze({ preview_id: value.preview_id.toLowerCase(), preview_sha256: value.preview_sha256 });
}

const uncertain = () => Object.freeze({ state: 'READBACK_UNCONFIRMED', published: false,
  manager_feed_verified: false, retry_safe: false });
const held = () => Object.freeze({ state: 'HELD', published: false,
  manager_feed_verified: false, retry_safe: false });

function confirmed(input, ledger_id, digest, event_id, revision, event, end_at, venue_ref) {
  return Object.freeze({ schema: HELD_CANONICAL_CONFIRMED, ledger_id,
    preview_id: input.preview_id, preview_sha256: input.preview_sha256,
    event_id, revision,
    canonical_event_readback_sha256: sha(JSON.stringify({ ledger_id,
      source_provenance_digest: digest, event_id, revision, event })),
    normalized_event: event, fact_basis: FACT_BASIS,
    source_evidence_status: 'ORIGINAL_FACTS_INCOMPLETE',
    missing_original_fields: ORIGINAL_MISSING,
    corrected_end_at: end_at, venue_ref,
    state: 'ACCEPTED', published: true, manager_feed_verified: false });
}

function authentication(req, requireOpsManagerWrite) {
  return new Promise((resolve, reject) => {
    let finished = false;
    const timer = setTimeout(() => done(Object.assign(new Error('held_canonical_current_manager_required'), { status: 403 })), 6000);
    const done = (error, session) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (error) reject(error); else resolve(session);
    };
    const sink = {
      headersSent: false, writableEnded: false,
      status() { return this; },
      json() { done(Object.assign(new Error('held_canonical_current_manager_required'), { status: 403 })); return this; },
      setHeader() {},
    };
    try {
      // A caller-populated req.memphisAuth never becomes a principal. Only the
      // normal owning middleware may attach a freshly verified session.
      delete req.memphisAuth;
      Promise.resolve(requireOpsManagerWrite(req, sink, () => done(null, req.memphisAuth)))
        .catch(() => done(Object.assign(new Error('held_canonical_current_manager_required'), { status: 403 })));
    } catch { done(Object.assign(new Error('held_canonical_current_manager_required'), { status: 403 })); }
  });
}

function manager(session) {
  if (session?.role !== 'ops_manager' || session.read_only === true
    || !boundUuid(session.manager_id) || !boundUuid(session.credential_id)
    || typeof session.device_id !== 'string' || !session.device_id || session.device_id.length > 96
    || typeof session.token !== 'string' || !session.token || session.token.length > 8192
    || !instant(session.expires_at) || Date.parse(session.expires_at) <= Date.now())
    fail('held_canonical_current_manager_required', 403);
  return Object.freeze({ manager_id: session.manager_id.toLowerCase(),
    credential_id: session.credential_id.toLowerCase(), device_id: session.device_id,
    session_fingerprint: sha(session.token) });
}
const sameManager = (a, b) => a.manager_id === b.manager_id
  && a.credential_id === b.credential_id && a.device_id === b.device_id
  && a.session_fingerprint === b.session_fingerprint;

function heldRow(snapshot, ledger_id, digest) {
  if (!plain(snapshot) || !SHA.test(snapshot.snapshot_sha256 || '')
    || !Array.isArray(snapshot.source) || snapshot.total !== snapshot.source.length)
    fail('held_canonical_snapshot_unavailable', 503);
  const selected = snapshot.source.filter(row => row?.id?.toLowerCase?.() === ledger_id);
  if (selected.length !== 1) fail('held_canonical_ledger_changed');
  const row = projectHeldReviewRow(selected[0]);
  if (row.event_id !== null || row.revision !== null || row.status !== 'NEEDS_REVIEW'
    || row.source_provenance_digest !== digest || row.published !== false)
    fail('held_canonical_ledger_changed');
  return row;
}

function ledger(value, pin) {
  if (!exact(value, LEDGER_SELECT.split(',')) || value.id?.toLowerCase?.() !== pin.ledger_id
    || value.event_id !== null || value.sync_status !== 'NEEDS_REVIEW'
    || value.payload_hash !== pin.digest || !plain(value.source_payload))
    fail('held_canonical_original_ledger_changed');
  const payload = value.source_payload;
  if (!exact(payload, ['source', 'source_event_key', 'reason'])
    || typeof payload.source_event_key !== 'string' || payload.source_event_key.length < 5
    || payload.source_event_key.length > 400
    || value.source_event_key !== SOURCE_KEY_PREFIX + payload.source_event_key
    || !plain(payload.source)
    || Object.keys(payload.source).some(key => !['mailbox', 'message_id', 'content_sha256',
      'evidence_kind', 'source_at', 'received_at', 'subject'].includes(key))
    || payload.source.mailbox !== 'eoperle@memphiszoo.org'
    || payload.source.message_id !== value.outlook_message_id
    || !SHA.test(payload.source.content_sha256 || '')
    || payload.source.evidence_kind !== 'original_event_notice'
    || (payload.source.subject !== undefined
      && (typeof payload.source.subject !== 'string' || payload.source.subject.length > 200))
    || !instant(payload.source.source_at) || !instant(payload.source.received_at)
    || !instant(value.received_at) || Date.parse(value.received_at) !== Date.parse(payload.source.received_at))
    fail('held_canonical_original_ledger_unverified');
  // The immutable review observation does not contain title/start. A digest
  // cannot recover either field. V2 requires explicit named-manager entry.
  return Object.freeze({ id: pin.ledger_id, payload_hash: value.payload_hash,
    received_at: normalizedInstant(value.received_at),
    source_event_key: value.source_event_key, outlook_message_id: value.outlook_message_id,
    source_payload: structuredClone(payload) });
}

function venue(value, ref) {
  if (!exact(value, VENUE_SELECT.split(',')) || value.id?.toLowerCase?.() !== ref
    || !boundUuid(value.location_group_id) || typeof value.display_name !== 'string'
    || !value.display_name.trim() || value.display_name.length > 240
    || !['SINGLE_VENUE', 'ZOO_WIDE'].includes(value.event_scope)
    || value.active !== true || value.eligible_event_venue !== true
    || !instant(value.updated_at)) fail('held_canonical_venue_unavailable');
  return Object.freeze({ id: ref, name: value.display_name.trim(), scope: value.event_scope,
    location_group_id: value.location_group_id.toLowerCase(), updated_at: normalizedInstant(value.updated_at) });
}

function normalizedEvent(value, requested, place) {
  const keys = ['event_name', 'event_date', 'start_time', 'start_instant_utc',
    'end_date', 'end_time', 'end_instant_utc', 'primary_venue_id', 'display_location'];
  if (!exact(value, keys) || value.event_name !== requested.event_name
    || !instant(value.start_instant_utc) || !instant(value.end_instant_utc)
    || normalizedInstant(value.start_instant_utc) !== requested.start_at
    || normalizedInstant(value.end_instant_utc) !== requested.end_at
    || value.primary_venue_id !== place.id || value.display_location !== place.name
    || !/^\d{4}-\d{2}-\d{2}$/.test(value.event_date || '')
    || !/^\d{4}-\d{2}-\d{2}$/.test(value.end_date || '')
    || !/^\d{2}:\d{2}:\d{2}$/.test(value.start_time || '')
    || !/^\d{2}:\d{2}:\d{2}$/.test(value.end_time || '')
    || value.event_date !== chicagoParts(requested.start_at).date
    || value.start_time !== chicagoParts(requested.start_at).time
    || value.end_date !== chicagoParts(requested.end_at).date
    || value.end_time !== chicagoParts(requested.end_at).time)
    fail('held_canonical_preview_projection_invalid', 503);
  return Object.freeze({ ...structuredClone(value),
    start_instant_utc: normalizedInstant(value.start_instant_utc),
    end_instant_utc: normalizedInstant(value.end_instant_utc) });
}

/** Fixed, server-owned source adapter. Main owns endpoint, middleware and SQL migration. */
export function createCanonicalHeldCorrectionAdapter({ client, requireOpsManagerWrite } = {}) {
  if (typeof client?.from !== 'function' || typeof client?.rpc !== 'function'
    || typeof requireOpsManagerWrite !== 'function')
    throw new TypeError('held_canonical_fixed_client_and_manager_write_gate_required');
  const handles = new Map();
  async function current(req, binding = null) {
    let observed;
    try { observed = manager(await authentication(req, requireOpsManagerWrite)); }
    catch { fail('held_canonical_current_manager_required', 403); }
    if (binding && !sameManager(binding, observed)) fail('held_canonical_manager_changed', 403);
    return observed;
  }
  async function guarded(req, binding, operation) {
    await current(req, binding);
    let value;
    try { value = structuredClone(await operation()); }
    catch { fail('held_canonical_dependency_unavailable', 503); }
    await current(req, binding);
    return value;
  }
  async function single(req, binding, table, columns, field, value) {
    const result = await guarded(req, binding, () => client.from(table).select(columns)
      .eq(field, value).abortSignal(AbortSignal.timeout(6000)).retry(false).single());
    if (result?.error || !plain(result?.data)) fail('held_canonical_fixed_read_unavailable', 503);
    return result.data;
  }
  async function rpc(req, binding, name, args) {
    const result = await guarded(req, binding, () => client.rpc(name, args)
      .abortSignal(AbortSignal.timeout(10000)).retry(false));
    if (result?.error || !plain(result?.data)) fail('held_canonical_typed_rpc_unconfirmed', 503);
    return result.data;
  }
  async function snapshot(req, binding, pin) {
    const result = await guarded(req, binding, () => readHeldLedgerSnapshot({ client }));
    if (result?.snapshot_sha256 !== pin.snapshot) fail('held_canonical_snapshot_changed');
    heldRow(result, pin.ledger_id, pin.digest);
  }
  async function statusRead(req, binding, table, columns, id) {
    try { return await single(req, binding, table, columns, 'id', id); }
    catch (error) {
      if (error?.status === 403) throw error;
      return null;
    }
  }
  async function previewStatusRead(req, binding, id) {
    try { return await single(req, binding, 'custodial_held_event_previews_v2',
      STATUS_PREVIEW_SELECT, 'preview_id', id); }
    catch (error) {
      if (error?.status === 403) throw error;
      return null;
    }
  }
  return Object.freeze({
    async preview(req, body) {
      const pin = parsePreview(body), binding = await current(req);
      await snapshot(req, binding, pin);
      const original = ledger(await single(req, binding, 'events_app_outlook_sync', LEDGER_SELECT, 'id', pin.ledger_id), pin);
      const place = venue(await single(req, binding, 'event_venues', VENUE_SELECT, 'id', pin.venue_ref), pin.venue_ref);
      const data = await rpc(req, binding, 'custodial_held_event_preview_v2', {
        p_ledger_id: pin.ledger_id, p_expected_review_snapshot_sha256: pin.snapshot,
        p_source_provenance_digest: pin.digest, p_manager_id: binding.manager_id,
        p_credential_id: binding.credential_id, p_device_id: binding.device_id,
        p_session_fingerprint: binding.session_fingerprint,
        p_event_name: pin.event_name, p_start_at: pin.start_at, p_end_at: pin.end_at,
        p_venue_ref: pin.venue_ref, p_manager_fact_confirmation: CORRECTION_ASSERTION,
      });
      if (data.schema !== HELD_CANONICAL_PREVIEW || !boundUuid(data.preview_id)
        || !SHA.test(data.preview_sha256 || '') || data.ledger_id !== pin.ledger_id
        || data.expected_review_snapshot_sha256 !== pin.snapshot
        || data.source_provenance_digest !== pin.digest || data.state !== 'PREVIEW_ONLY'
        || data.published !== false || data.coverage_assigned !== false
        || data.reminder_eligible !== false || !SHA.test(data.venue_fingerprint || '')
        || data.source_evidence_status !== 'ORIGINAL_FACTS_INCOMPLETE'
        || !isDeepStrictEqual(data.missing_original_fields, ORIGINAL_MISSING)
        || !isDeepStrictEqual(data.fact_basis, FACT_BASIS))
        fail('held_canonical_preview_receipt_invalid', 503);
      const event = normalizedEvent(data.normalized_event, pin, place);
      await snapshot(req, binding, pin);
      const after = ledger(await single(req, binding, 'events_app_outlook_sync', LEDGER_SELECT, 'id', pin.ledger_id), pin);
      if (!isDeepStrictEqual(after.source_payload, original.source_payload)
        || after.received_at !== original.received_at
        || after.source_event_key !== original.source_event_key
        || after.outlook_message_id !== original.outlook_message_id)
        fail('held_canonical_original_ledger_changed');
      const preview = Object.freeze({ schema: HELD_CANONICAL_PREVIEW,
        ledger_id: pin.ledger_id, expected_review_snapshot_sha256: pin.snapshot,
        source_provenance_digest: pin.digest, preview_id: data.preview_id,
        preview_sha256: data.preview_sha256, normalized_event: event,
        fact_basis: FACT_BASIS, source_evidence_status: 'ORIGINAL_FACTS_INCOMPLETE',
        missing_original_fields: ORIGINAL_MISSING, corrected_end_at: pin.end_at,
        venue_ref: pin.venue_ref, state: 'PREVIEW_ONLY', published: false,
        coverage_assigned: false, reminder_eligible: false });
      for (const [id, handle] of handles) if (Date.now() - handle.created_at_ms >= 300_000) handles.delete(id);
      if (handles.size >= 100 || handles.has(data.preview_id)) fail('held_canonical_preview_capacity_unavailable', 503);
      handles.set(data.preview_id, Object.freeze({ pin, binding, original, place, preview,
        created_at_ms: Date.now() }));
      try { await current(req, binding); }
      catch (error) { handles.delete(data.preview_id); throw error; }
      return preview;
    },
    async confirm(req, body) {
      const input = parseConfirm(body), prior = handles.get(input.preview_id);
      if (!prior || prior.preview.preview_sha256 !== input.preview_sha256)
        fail('held_canonical_preview_missing_or_consumed');
      handles.delete(input.preview_id); // Never retry a possible write.
      if (Date.now() - prior.created_at_ms >= 300_000)
        fail('held_canonical_preview_missing_or_consumed');
      const { pin, binding, original, place, preview } = prior;
      await current(req, binding);
      await snapshot(req, binding, pin);
      const before = ledger(await single(req, binding, 'events_app_outlook_sync', LEDGER_SELECT, 'id', pin.ledger_id), pin);
      if (!isDeepStrictEqual(before.source_payload, original.source_payload)
        || before.received_at !== original.received_at) fail('held_canonical_original_ledger_changed');
      const currentPlace = venue(await single(req, binding, 'event_venues', VENUE_SELECT, 'id', pin.venue_ref), pin.venue_ref);
      if (!isDeepStrictEqual(currentPlace, place)) fail('held_canonical_venue_changed');
      let write;
      try { write = await rpc(req, binding, 'custodial_held_event_confirm_v2', {
        p_preview_id: input.preview_id, p_preview_sha256: input.preview_sha256,
        p_manager_id: binding.manager_id, p_credential_id: binding.credential_id,
        p_device_id: binding.device_id, p_session_fingerprint: binding.session_fingerprint,
      }); } catch { return Object.freeze({ state: 'OUTCOME_UNKNOWN', published: false, retry_safe: false }); }
      if (write.schema !== HELD_CANONICAL_CONFIRMED || write.state !== 'APPLIED'
        || write.preview_id !== input.preview_id || write.preview_sha256 !== input.preview_sha256
        || write.ledger_id !== pin.ledger_id || !boundUuid(write.event_id) || !positive(write.revision))
        return Object.freeze({ state: 'OUTCOME_UNKNOWN', published: false, retry_safe: false });
      let savedLedger, savedEvent;
      try {
        savedLedger = await single(req, binding, 'events_app_outlook_sync', LEDGER_SELECT, 'id', pin.ledger_id);
        savedEvent = await single(req, binding, 'events_app_events', EVENT_SELECT, 'id', write.event_id);
      } catch { return Object.freeze({ state: 'READBACK_UNCONFIRMED', published: false, retry_safe: false }); }
      if (savedLedger.id !== pin.ledger_id || savedLedger.event_id !== write.event_id
        || savedLedger.sync_status !== 'APPLIED' || savedLedger.payload_hash !== pin.digest
        || savedLedger.outlook_message_id !== original.outlook_message_id
        || savedLedger.source_event_key !== original.source_event_key
        || !instant(savedLedger.received_at)
        || normalizedInstant(savedLedger.received_at) !== original.received_at
        || !isDeepStrictEqual(savedLedger.source_payload, original.source_payload)
        || savedEvent.id !== write.event_id || savedEvent.revision !== write.revision
        || savedEvent.status !== 'SCHEDULED' || savedEvent.needs_review !== false
        || savedEvent.manually_overridden !== true
        || savedEvent.operation_id !== input.preview_id
        || savedEvent.source_format !== 'outlook_held_manager_correction'
        || savedEvent.event_name !== preview.normalized_event.event_name
        || savedEvent.primary_venue_id !== place.id
        || savedEvent.location_group_id !== place.location_group_id
        || savedEvent.display_location !== preview.normalized_event.display_location
        || savedEvent.event_date !== preview.normalized_event.event_date
        || savedEvent.end_date !== preview.normalized_event.end_date
        || savedEvent.start_time !== preview.normalized_event.start_time
        || savedEvent.end_time !== preview.normalized_event.end_time
        || !instant(savedEvent.start_instant_utc) || !instant(savedEvent.end_instant_utc)
        || normalizedInstant(savedEvent.start_instant_utc) !== preview.normalized_event.start_instant_utc
        || normalizedInstant(savedEvent.end_instant_utc) !== preview.normalized_event.end_instant_utc)
        return Object.freeze({ state: 'READBACK_UNCONFIRMED', published: false, retry_safe: false });
      try { await current(req, binding); }
      catch { return Object.freeze({ state: 'READBACK_UNCONFIRMED', published: false, retry_safe: false }); }
      return confirmed(input, pin.ledger_id, pin.digest, write.event_id,
        write.revision, preview.normalized_event, pin.end_at, pin.venue_ref);
    },
    async status(req, body) {
      const input = parseStatus(body), binding = await current(req);
      const first = await previewStatusRead(req, binding, input.preview_id);
      if (!first) return uncertain();
      // The preview is private, but every status read still binds to its exact
      // original named manager, credential, device and signed session token.
      if (first.manager_id !== binding.manager_id
        || first.credential_id !== binding.credential_id
        || first.device_id !== binding.device_id
        || first.session_fingerprint !== binding.session_fingerprint)
        fail('held_canonical_manager_changed', 403);
      if (!exact(first, STATUS_PREVIEW_SELECT.split(','))
        || first.preview_id !== input.preview_id
        || first.preview_sha256 !== input.preview_sha256
        || !boundUuid(first.ledger_id) || !SHA.test(first.source_provenance_digest || '')
        || !SHA.test(first.original_payload_sha256 || '')
        || !boundUuid(first.venue_id) || !instant(first.original_received_at)
        || !instant(first.original_created_at) || !instant(first.original_updated_at))
        return uncertain();
      if (first.state === 'PREVIEW_ONLY' && first.event_id === null && first.applied_at === null) {
        const again = await previewStatusRead(req, binding, input.preview_id);
        return again && isDeepStrictEqual(again, first) ? held() : uncertain();
      }
      if (first.state !== 'APPLIED' || !boundUuid(first.event_id) || !instant(first.applied_at))
        return uncertain();
      const savedLedger = await statusRead(req, binding, 'events_app_outlook_sync',
        STATUS_LEDGER_SELECT, first.ledger_id);
      const savedEvent = await statusRead(req, binding, 'events_app_events',
        STATUS_EVENT_SELECT, first.event_id);
      if (!savedLedger || !savedEvent) return uncertain();
      try {
        const source = ledger(Object.fromEntries(LEDGER_SELECT.split(',').map(key => [key,
          key === 'event_id' ? null : key === 'sync_status' ? 'NEEDS_REVIEW' : savedLedger[key]])),
        { ledger_id: first.ledger_id, digest: first.source_provenance_digest });
        const event = normalizedEvent(first.normalized_event,
          { event_name: first.normalized_event?.event_name,
            start_at: normalizedInstant(first.normalized_event?.start_instant_utc),
            end_at: normalizedInstant(first.normalized_event?.end_instant_utc) },
          { id: first.venue_id, name: first.normalized_event?.display_location });
        if (savedLedger.event_id !== first.event_id || savedLedger.sync_status !== 'APPLIED'
          || savedLedger.source_subject !== first.original_subject
          || normalizedInstant(savedLedger.created_at) !== normalizedInstant(first.original_created_at)
          || savedLedger.sync_note !== 'Manager-confirmed held event; original facts incomplete'
          || !instant(savedLedger.updated_at)
          || Date.parse(savedLedger.updated_at) < Date.parse(first.original_updated_at)
          || source.outlook_message_id !== first.original_message_id
          || source.source_event_key !== first.original_event_key
          || source.received_at !== normalizedInstant(first.original_received_at)
          || postgresJsonbContentDigest(source.source_payload) !== first.original_payload_sha256
          || postgresJsonbContentDigest({ action: 'review', observation: source.source_payload })
            !== first.source_provenance_digest
          || savedEvent.id !== first.event_id || savedEvent.operation_id !== input.preview_id
          || savedEvent.revision !== 1 || savedEvent.status !== 'SCHEDULED'
          || savedEvent.source_format !== 'outlook_held_manager_correction'
          || savedEvent.manually_overridden !== true || savedEvent.needs_review !== false
          || savedEvent.created_by_manager_id !== binding.manager_id
          || savedEvent.updated_by_manager_id !== binding.manager_id
          || typeof savedEvent.created_by !== 'string' || !savedEvent.created_by.trim()
          || savedEvent.overridden_by !== savedEvent.created_by
          || savedEvent.event_timezone !== 'America/Chicago'
          || savedEvent.event_name !== event.event_name
          || savedEvent.primary_venue_id !== first.venue_id
          || !boundUuid(savedEvent.location_group_id)
          || savedEvent.display_location !== event.display_location
          || savedEvent.event_date !== event.event_date
          || savedEvent.end_date !== event.end_date
          || savedEvent.start_time !== event.start_time
          || savedEvent.end_time !== event.end_time
          || normalizedInstant(savedEvent.start_instant_utc) !== event.start_instant_utc
          || normalizedInstant(savedEvent.end_instant_utc) !== event.end_instant_utc)
          return uncertain();
        const again = await previewStatusRead(req, binding, input.preview_id);
        if (!again || !isDeepStrictEqual(again, first)) return uncertain();
        await current(req, binding);
        return confirmed(input, first.ledger_id, first.source_provenance_digest,
          first.event_id, savedEvent.revision, event, event.end_instant_utc, first.venue_id);
      } catch (error) {
        if (error?.status === 403) throw error;
        return uncertain();
      }
    },
  });
}
