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

export function sharedEventFeed(rows, { now = new Date(), employeeId = null, syncStatus = null } = {}) {
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

export function makeSharedManagerEventsHandler({ readEvents, readSyncStatus = null, requireOpsManagerAuth, now = () => new Date() }) {
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
      return res.status(200).json({ ok: true, feed: sharedEventFeed(rows, { now: now(), syncStatus }), meta: manager });
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
