'use strict';

// Existing private named-manager/read-only boundary only. This leaf never
// collects a position, writes a row, exposes a table or mounts a route.
const MAX_EVENTS_PER_OPEN_WORK = 1200;
const HISTORY_CONTRACT = 'custodial.gps-work-history.v2';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

// Alias interpolation is internal and closed, never supplied by a request.
function eventLink(alias) {
  if (!['work', 'candidate'].includes(alias)) throw new Error('Invalid internal GPS authority alias');
  return `
    se.device_id = ${alias}.device_id
    and se.location_id = ${alias}.location_id
    and se.device_identifier = ${alias}.device_identifier
    and se.location_code = ${alias}.location_code
    and case
      when ${alias}.source_kind = 'session' then
        se.session_id = ${alias}.session_id
        and (nullif(se.payload_json->>'session_uuid','') is null
          or se.payload_json->>'session_uuid' = ${alias}.session_uuid)
        and (nullif(se.payload_json->>'client_session_id','') is null
          or se.payload_json->>'client_session_id' = ${alias}.client_session_id)
      when ${alias}.source_kind = 'native_offline_context' then
        se.session_id is null
        and se.payload_json->>'session_uuid' = ${alias}.session_uuid
        and se.payload_json->>'client_session_id' = ${alias}.client_session_id
      else false
    end`;
}
const HISTORY_SQL = `
  with open_work as materialized (
    select * from public.custodial_open_work()
    where status = 'active' and ended_at is null
      and (
        (source_kind = 'session' and session_id is not null and context_id is null)
        or (source_kind = 'native_offline_context' and session_id is null
          and context_id is not null and open_work_id = context_id
          and session_uuid = client_session_id)
      )
  )
  select
    work.open_work_id::text as open_work_id, work.source_kind,
    work.session_id::text as work_session_id, work.context_id::text as work_context_id,
    work.session_uuid as work_session_uuid, work.client_session_id,
    work.employee_id::text as employee_id,
    work.device_id::text as work_device_id, work.location_id::text as work_location_id,
    work.location_code, work.device_identifier,
    work.status as work_status, work.started_at, work.ended_at,
    event.id::text as event_id, event.session_id::text as event_session_id,
    event.device_id::text as event_device_id, event.location_id::text as event_location_id,
    event.device_identifier as event_device_identifier, event.location_code as event_location_code,
    event.result as event_result, event.scanned_at as received_at,
    event.association_count, event.payload_json
  from open_work work
  left join lateral (
    select se.id, se.session_id, se.device_id, se.location_id,
      se.device_identifier, se.location_code, se.result, se.scanned_at,
      (select count(*)::int from open_work candidate where ${eventLink('candidate')}) as association_count,
      jsonb_build_object(
        'observed_at', se.payload_json->'observed_at',
        'client_latitude', se.payload_json->'client_latitude',
        'client_longitude', se.payload_json->'client_longitude',
        'accuracy_m', se.payload_json->'accuracy_m',
        'session_uuid', se.payload_json->'session_uuid',
        'client_session_id', se.payload_json->'client_session_id'
      ) as payload_json
    from public.scan_events se
    where se.event_type = 'work_position_check' and ${eventLink('work')}
    order by se.scanned_at desc, se.id desc
    limit ${MAX_EVENTS_PER_OPEN_WORK + 1}
  ) event on true
  order by work.started_at, work.open_work_id, event.scanned_at, event.id
`;

const text = value => typeof value === 'string' && value.trim() ? value : null;
const uuid = value => UUID.test(text(value) || '') ? value.toLowerCase() : null;
const timestamp = value => value instanceof Date && Number.isFinite(value.valueOf()) ? value.toISOString() : text(value);
function captureTime(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    ? Date.parse(value) : NaN;
}
function identity(row) {
  const session = {
    uuid: text(row.work_session_uuid), sessionId: uuid(row.work_session_id),
    contextId: uuid(row.work_context_id), sourceKind: text(row.source_kind),
    clientSessionId: text(row.client_session_id), employeeId: uuid(row.employee_id),
    deviceId: uuid(row.work_device_id), locationId: uuid(row.work_location_id),
    locationCode: text(row.location_code), deviceIdentifier: text(row.device_identifier),
    status: text(row.work_status), startedAt: timestamp(row.started_at)
  };
  const workId = uuid(row.open_work_id);
  const shape = session.sourceKind === 'session'
    ? session.sessionId === workId && row.work_context_id == null
    : session.sourceKind === 'native_offline_context' && row.work_session_id == null &&
      session.contextId === workId && session.clientSessionId === session.uuid;
  return workId && shape && session.uuid && session.employeeId && session.deviceId &&
    session.locationId && session.locationCode && session.deviceIdentifier &&
    session.status === 'active' && row.ended_at == null &&
    Number.isFinite(captureTime(session.startedAt)) ? session : null;
}
function eventBound(row, session, payload) {
  if (row.association_count !== 1 || !uuid(row.event_id) ||
      uuid(row.event_device_id) !== session.deviceId || uuid(row.event_location_id) !== session.locationId ||
      row.event_device_identifier !== session.deviceIdentifier || row.event_location_code !== session.locationCode) return false;
  if (session.sourceKind === 'native_offline_context')
    return row.event_session_id == null && payload.session_uuid === session.uuid &&
      payload.client_session_id === session.clientSessionId;
  return uuid(row.event_session_id) === session.sessionId &&
    (!text(payload.session_uuid) || payload.session_uuid === session.uuid) &&
    (!text(payload.client_session_id) || payload.client_session_id === session.clientSessionId);
}
// These are the core's quality-checked measurement statuses. Missing surveyed
// proximity configuration remains advisory, never a geographic registration.
// Rejected or unknown producer statuses must fail closed even with coordinates.
const measuredQuality = new Set(['near','away','boundary_uncertain','location_uncalibrated','not_configured']);

async function readGpsMapHistory({assertNamedManager, runReadOnlySql, now = Date.now} = {}) {
  if (typeof assertNamedManager !== 'function' || typeof runReadOnlySql !== 'function' || typeof now !== 'function')
    throw new Error('GPS history requires existing named-manager, read-only SQL and server clock adapters');
  if (await assertNamedManager() !== true) throw new Error('GPS history requires a verified named-manager authorization result');
  const instant = now(); if (!Number.isFinite(instant)) throw new Error('GPS history server clock unavailable');
  const rows = await runReadOnlySql(HISTORY_SQL);
  if (!Array.isArray(rows)) throw new Error('GPS history read returned no row array');
  const byWork = new Map(), seenEvents = new Map();
  for (const row of rows) {
    const session = row && identity(row);
    if (!session) throw new Error('GPS history authority identity is unavailable or changed');
    let work = byWork.get(row.open_work_id);
    if (!work) {
      work = {contract: HISTORY_CONTRACT, openWorkId: row.open_work_id, session, observations: [],
        truncated: false, incomplete: false, incompleteReason: null};
      byWork.set(row.open_work_id, work);
      seenEvents.set(row.open_work_id, new Set());
    } else if (!Object.keys(session).every(key => work.session[key] === session[key])) {
      work.incomplete = true; work.incompleteReason = 'authority_identity_conflict';
    }
    if (row.event_id == null) continue;
    const payload = row.payload_json && typeof row.payload_json === 'object' && !Array.isArray(row.payload_json) ? row.payload_json : {};
    if (!eventBound(row, session, payload)) {
      work.incomplete = true; work.incompleteReason ||= 'ambiguous_or_foreign_event_association'; continue;
    }
    const seen = seenEvents.get(row.open_work_id);
    if (seen.has(row.event_id)) {
      work.incomplete = true; work.incompleteReason ||= 'duplicate_event_identity'; continue;
    }
    seen.add(row.event_id);
    const observed = captureTime(payload.observed_at), received = captureTime(timestamp(row.received_at));
    const validCapture = Number.isFinite(observed) && observed >= captureTime(session.startedAt) &&
      observed <= instant && Number.isFinite(received) && observed <= received;
    // Preserve rejected/unknown chronology as a marker, but never return an
    // off-work, bad-clock or rejected-quality coordinate as a measured point.
    const coordinatesValid = [payload.client_latitude, payload.client_longitude, payload.accuracy_m]
      .every(value => typeof value === 'number' && Number.isFinite(value)) &&
      Math.abs(payload.client_latitude) <= 90 && Math.abs(payload.client_longitude) <= 180 && payload.accuracy_m > 0;
    const measured = validCapture && coordinatesValid && measuredQuality.has(row.event_result);
    const safePayload = {session_uuid: payload.session_uuid, client_session_id: payload.client_session_id,
      observed_at: payload.observed_at};
    if (measured) Object.assign(safePayload, {client_latitude: payload.client_latitude,
      client_longitude: payload.client_longitude, accuracy_m: payload.accuracy_m});
    work.observations.push({id: row.event_id, event_type: 'work_position_check',
      session_id: uuid(row.event_session_id), session_uuid: session.uuid,
      location_code: session.locationCode, device_identifier: session.deviceIdentifier,
      employee_id: session.employeeId, received_at: timestamp(row.received_at),
      quality: measured ? 'stored_active_work_measurement' : 'withheld_capture_or_quality',
      payload_json: Object.freeze(safePayload)});
    if (work.observations.length > MAX_EVENTS_PER_OPEN_WORK) work.truncated = true;
  }
  return [...byWork.values()].map(work => Object.freeze({...work,
    session: Object.freeze(work.session),
    observations: Object.freeze(work.incomplete ? [] : work.observations.slice(0, MAX_EVENTS_PER_OPEN_WORK))}));
}
export {readGpsMapHistory, HISTORY_SQL, MAX_EVENTS_PER_OPEN_WORK, HISTORY_CONTRACT};
