import { createHash } from 'node:crypto';
import { projectOperationsEvents } from './operations-board.js';

export const SHARED_EVENTS_CONTRACT = 'custodial.events-feed.v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const equalId = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();

// Display and reminder eligibility are different. All enrolled custodians may
// read general operational events; individually addressed events stay private.
// Raw mail, general notes and audience identities never enter this projection.
export function employeeVisibleEvents(rows, employeeId) {
  if (!UUID.test(employeeId || '') || !Array.isArray(rows)) throw new Error('employee_event_identity_required');
  return rows.filter(row => row && row.needs_review === false
    && ['SCHEDULED', 'CANCELLED', 'SUPERSEDED'].includes(row.status)
    && row.event_scope !== 'UNKNOWN' && row.place_admissible === true
    && (['assigned_location', 'all_working_employees'].includes(row.audience_scope)
      || (row.audience_scope === 'specific_employees' && Array.isArray(row.audience_employee_ids)
        && row.audience_employee_ids.some(id => equalId(id, employeeId)))));
}

// Shared operational visitor-load display, not a formal event or raw ledger.
export const SHARED_SCHOOL_CONTRACT = 'custodial.school-visitor-load-display.v1';
const safeText = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max
  && !/[\u0000-\u001f\u007f]/.test(v);
const validInstant = v => typeof v === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(v) && Number.isFinite(Date.parse(v));
const safeCount = v => Number.isSafeInteger(v) && v >= 0;
const validDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
  && Number.isFinite(Date.parse(v + 'T00:00:00Z')) && new Date(v + 'T00:00:00Z').toISOString().slice(0,10) === v;
export function unavailableSharedSchools() {
  return {schema:SHARED_SCHOOL_CONTRACT,state:'unavailable',coverage:'imported_only',
    mailbox_completeness_verified:false,generated_at:null,source_latest_at:null,rows:[]};
}
export function projectSharedSchools(value) {
  try {
    if (value?.state !== 'snapshot' || value.coverage !== 'imported_only'
      || value.mailbox_completeness_verified !== false || !validInstant(value.generated_at)
      || !validInstant(value.source_latest_at) || !Array.isArray(value.rows) || value.rows.length > 10000)
      return unavailableSharedSchools();
    const rows=[], seen=new Set();
    for (const row of value.rows) {
      // Private source ambiguities are not published to enrolled employees.
      if (row?.status === 'REVIEW_REQUIRED') continue;
      if (!row || !/^[a-f0-9]{64}$/.test(row.source_revision || '') || !safeText(row.id,500) || !safeText(row.name,240) || !validDate(row.date)
        || !['SCHEDULED','CANCELLED','SUPERSEDED'].includes(row.status)
        || !(row.arrival_at === null || validInstant(row.arrival_at))
        || row.departure_at !== null || row.departure_source !== null
        || !['students','chaperones','teachers','adults','unclassified','total'].every(k => safeCount(row[k]))
        || row.adults !== row.chaperones + row.teachers || !safeCount(row.students + row.adults + row.unclassified)
        || row.total !== row.students + row.adults + row.unclassified
        || !(row.buses === null || safeCount(row.buses))
        || row.notes !== null) return unavailableSharedSchools();
      const id = 'school:' + createHash('sha256').update('custodial-school-display-v1\0').update(row.source_revision).update('\0').update(row.id).digest('hex');
      if (seen.has(id)) return unavailableSharedSchools();
      seen.add(id);
      // Explicit allowlist. No order IDs, source IDs, attachments, provenance,
      // review notes, raw mail, contacts or unrelated operations feeds escape.
      rows.push({id,name:row.name,date:row.date,arrival_at:row.arrival_at,departure_at:null,departure_source:null,
        status:row.status,students:row.students,chaperones:row.chaperones,teachers:row.teachers,adults:row.adults,
        unclassified:row.unclassified,total:row.total,buses:row.buses,notes:null});
    }
    return {schema:SHARED_SCHOOL_CONTRACT,state:'snapshot',coverage:'imported_only',mailbox_completeness_verified:false,
      generated_at:value.generated_at,source_latest_at:value.source_latest_at,rows};
  } catch { return unavailableSharedSchools(); }
}

export function sharedEventFeed(rows, { now = new Date(), employeeId = null, syncStatus = null, schools = null } = {}) {
  const allowed = employeeId === null ? rows : employeeVisibleEvents(rows, employeeId);
  const projected = projectOperationsEvents(allowed);
  const seen = new Set();
  for (const row of projected) {
    if (!UUID.test(row.id) || !Number.isSafeInteger(row.revision) || row.revision < 1 || seen.has(row.id.toLowerCase())) {
      throw new Error('shared_event_identity_invalid');
    }
    seen.add(row.id.toLowerCase());
  }
  const checkedAt = Date.parse(syncStatus?.cursor || "");
  const sourceCurrent = syncStatus?.schema === "custodial.outlook-event-sync.v1"
    && syncStatus.writer_ready === true && syncStatus.mailbox === "eoperle@memphiszoo.org"
    && Number.isFinite(checkedAt) && checkedAt <= now.getTime() + 60000 && now.getTime() - checkedAt <= 7200000;
  return {
    schema: SHARED_EVENTS_CONTRACT,
    timezone: 'America/Chicago',
    generated_at: now.toISOString(),
    source: 'events_app_events',
    state: sourceCurrent ? 'current' : 'snapshot',
    coverage: 'published_records_only',
    mailbox_completeness_verified: sourceCurrent,
    source_checked_at: Number.isFinite(checkedAt) ? new Date(checkedAt).toISOString() : null,
    rows: projected,
    schools: projectSharedSchools(schools),
  };
}

function managerBinding(session) {
  if (session?.role !== 'ops_manager' || !UUID.test(session.manager_id || '')
    || typeof session.credential_id !== 'string' || !session.credential_id || session.credential_id.length > 200
    || typeof session.device_id !== 'string' || !session.device_id || session.device_id.length > 96
    || typeof session.token !== 'string' || !session.token || session.token.length > 8192
    || typeof session.expires_at !== 'string' || !(Date.parse(session.expires_at) > Date.now())) return null;
  // Private comparison only. The injected normal middleware verifies the
  // signature and current protected registry; these values never leave here.
  return JSON.stringify([session.manager_id, session.credential_id, session.device_id,
    session.token, session.expires_at, session.auth_mode, session.read_only]);
}

export function makeSharedManagerEventsHandler({ readEvents, readSyncStatus = null, readSchools = null, requireOpsManagerAuth, now = () => new Date() }) {
  if (typeof readEvents !== 'function') throw new Error('shared_event_reader_required');
  if (typeof requireOpsManagerAuth !== 'function') throw new Error('shared_event_manager_middleware_required');
  return async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Vary', 'Authorization, Cookie, X-Device-Id');
    let binding = null;
    const currentManager = async () => {
      let accepted = false, code = 503;
      const response = {
        get headersSent() { return res.headersSent; },
        get writableEnded() { return res.writableEnded; },
        setHeader(name, value) { res.setHeader(name, value); },
        status(value) { code = [401, 403, 503].includes(value) ? value : 503; return this; },
        json() { return res.status(code).json({ ok: false, error: 'Current named-manager access required.' }); },
      };
      try { await requireOpsManagerAuth(req, response, () => { accepted = true; }); }
      catch { if (!res.headersSent && !res.writableEnded) response.status(503).json(); }
      if (!accepted || res.headersSent || res.writableEnded) return false;
      const next = managerBinding(req?.memphisAuth);
      if (!next || (binding !== null && next !== binding)) {
        res.status(403).json({ ok: false, error: 'Current named-manager access required.' });
        return false;
      }
      binding = next;
      return true;
    };
    if (!await currentManager()) return;
    const manager = Object.freeze({ manager_id: req.memphisAuth.manager_id, credential_id: req.memphisAuth.credential_id });
    try {
      let syncStatus = null;
      if (typeof readSyncStatus === 'function') {
        try { syncStatus = await readSyncStatus(); } catch { /* Published records remain a snapshot. */ }
        if (!await currentManager()) return;
      }
      let rows, unavailable = false;
      try { rows = await readEvents(); } catch { unavailable = true; }
      if (!await currentManager()) return;
      if (unavailable) throw new Error('shared_event_source_unavailable');
      let schools = null;
      if (typeof readSchools === 'function') {
        try { schools = await readSchools(); } catch { /* School source stays unavailable, not empty/current. */ }
        if (!await currentManager()) return;
      }
      return res.status(200).json({ ok: true, feed: sharedEventFeed(rows, { now: now(), syncStatus, schools }), meta: manager });
    } catch {
      return res.status(503).json({ ok: false, error: 'Events could not update.' });
    }
  };
}

// A tombstone is deliberate: stale clients receive a terminal response, never
// a successful-looking empty result or a callable replacement mutation route.
export function retiredEventIntake(_req, res) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(410).json({ ok: false, code: 'EVENT_INPUT_RETIRED',
    error: 'Manual event entry has been retired. Events are supplied by the approved Outlook intake.' });
}
