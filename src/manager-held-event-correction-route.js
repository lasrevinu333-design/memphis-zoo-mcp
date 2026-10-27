import { createCanonicalHeldCorrectionAdapter } from './held-event-correction-canonical-adapter.js';

export const HELD_CORRECTION_PLACES_ROUTE = '/dashboard-api/held-event-reviews/corrections/places';
export const HELD_CORRECTION_PREVIEW_ROUTE = '/dashboard-api/held-event-reviews/corrections/preview';
export const HELD_CORRECTION_CONFIRM_ROUTE = '/dashboard-api/held-event-reviews/corrections/confirm';
export const HELD_CORRECTION_STATUS_ROUTE = '/dashboard-api/held-event-reviews/corrections/status';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VENUE_COLUMNS = 'id,display_name,location_group_id,event_scope,active,eligible_event_venue';
const allowedScopes = new Set(['SINGLE_VENUE', 'ZOO_WIDE']);
const unavailable = () => Object.assign(new Error('held_correction_target_unavailable'), { status: 503, code: 'held_correction_target_unavailable' });

function currentBinding(session) {
  if (session?.role !== 'ops_manager' || session.read_only === true
    || !UUID.test(session.manager_id || '') || !UUID.test(session.credential_id || '')
    || typeof session.device_id !== 'string' || !session.device_id || session.device_id.length > 96
    || typeof session.token !== 'string' || !session.token || session.token.length > 8192
    || !Number.isFinite(Date.parse(session.expires_at)) || Date.parse(session.expires_at) <= Date.now())
    throw Object.assign(new Error('held_correction_current_manager_required'), { status: 403, code: 'held_correction_current_manager_required' });
  return { manager_id: session.manager_id, credential_id: session.credential_id,
    device_id: session.device_id, token: session.token };
}

async function recheck(req, middleware, expected) {
  const session = await new Promise((resolve, reject) => {
    let finished = false;
    const done = (error, value) => {
      if (finished) return;
      finished = true; clearTimeout(timer);
      if (error) reject(error); else resolve(value);
    };
    const timer = setTimeout(() => done(unavailable()), 6000);
    const sink = { headersSent: false, writableEnded: false,
      status() { return this; }, json() { done(unavailable()); return this; }, setHeader() {} };
    try {
      delete req.memphisAuth;
      Promise.resolve(middleware(req, sink, () => done(null, req.memphisAuth)))
        .catch(() => done(unavailable()));
    } catch { done(unavailable()); }
  });
  const current = currentBinding(session);
  if (current.manager_id !== expected.manager_id || current.credential_id !== expected.credential_id
    || current.device_id !== expected.device_id || current.token !== expected.token)
    throw Object.assign(new Error('held_correction_manager_changed'), { status: 403, code: 'held_correction_manager_changed' });
}

function failure(res, error) {
  if (res.headersSent || res.writableEnded) return;
  const status = [400, 403, 409].includes(error?.status) ? error.status : 503;
  const code = typeof error?.code === 'string' && /^held_(?:canonical|correction)_[a-z_]+$/.test(error.code)
    ? error.code : 'held_correction_unavailable';
  return res.status(status).json({ ok: false, code, error: 'Held event correction is unavailable. Refresh the held review before trying again.' });
}

function privateResponse(res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Vary', 'Authorization, X-Device-Id');
}

/** Mounts only fixed, normally authenticated held-event correction routes. */
export function installManagerHeldEventCorrectionRoutes(app, { client, requireOpsManagerWrite } = {}) {
  if (typeof app?.get !== 'function' || typeof app?.post !== 'function'
    || typeof requireOpsManagerWrite !== 'function')
    throw new TypeError('held_correction_route_and_owning_manager_gate_required');
  const service = client && typeof client.from === 'function' && typeof client.rpc === 'function'
    ? createCanonicalHeldCorrectionAdapter({ client, requireOpsManagerWrite }) : null;

  app.get(HELD_CORRECTION_PLACES_ROUTE, requireOpsManagerWrite, async (req, res) => {
    privateResponse(res);
    try {
      const binding = currentBinding(req.memphisAuth);
      if (!service) throw unavailable();
      let response;
      try {
        response = await client.from('event_venues').select(VENUE_COLUMNS, { count: 'exact' })
          .eq('active', true).eq('eligible_event_venue', true)
          .not('location_group_id', 'is', null).in('event_scope', [...allowedScopes])
          .order('display_name', { ascending: true }).limit(101)
          .abortSignal(AbortSignal.timeout(6000)).retry(false);
      } catch { throw unavailable(); }
      await recheck(req, requireOpsManagerWrite, binding);
      if (response?.error || !Number.isSafeInteger(response?.count) || response.count > 100
        || !Array.isArray(response?.data) || response.data.length !== response.count) throw unavailable();
      const seen = new Set();
      const places = response.data.map(row => {
        if (!row || Object.keys(row).length !== VENUE_COLUMNS.split(',').length
          || VENUE_COLUMNS.split(',').some(key => !Object.hasOwn(row, key))
          || !UUID.test(row.id || '') || !UUID.test(row.location_group_id || '')
          || typeof row.display_name !== 'string' || !row.display_name.trim()
          || row.display_name.length > 240 || row.active !== true || row.eligible_event_venue !== true
          || !allowedScopes.has(row.event_scope) || seen.has(row.id.toLowerCase())) throw unavailable();
        seen.add(row.id.toLowerCase());
        return Object.freeze({ venue_ref: row.id.toLowerCase(), label: row.display_name.trim() });
      });
      return res.status(200).json({ ok: true, data: { schema: 'custodial.held-event-correction-places.v1', places } });
    } catch (error) { return failure(res, error); }
  });

  app.post(HELD_CORRECTION_PREVIEW_ROUTE, requireOpsManagerWrite, async (req, res) => {
    privateResponse(res);
    try {
      if (!service) throw unavailable();
      return res.status(200).json({ ok: true, data: await service.preview(req, req.body) });
    } catch (error) { return failure(res, error); }
  });

  app.post(HELD_CORRECTION_STATUS_ROUTE, requireOpsManagerWrite, async (req, res) => {
    privateResponse(res);
    try {
      if (!service) throw unavailable();
      // Exact original preview readback only. No RPC/write or retry authority.
      return res.status(200).json({ ok: true, data: await service.status(req, req.body) });
    } catch (error) { return failure(res, error); }
  });

  app.post(HELD_CORRECTION_CONFIRM_ROUTE, requireOpsManagerWrite, async (req, res) => {
    privateResponse(res);
    try {
      if (!service) throw unavailable();
      const data = await service.confirm(req, req.body);
      if (data.state === 'OUTCOME_UNKNOWN' || data.state === 'READBACK_UNCONFIRMED')
        return res.status(503).json({ ok: false, code: 'held_correction_write_unconfirmed',
          state: data.state, retry_safe: false,
          error: 'The correction outcome requires reconciliation; do not repeat confirmation.' });
      return res.status(200).json({ ok: true, data });
    } catch (error) { return failure(res, error); }
  });
}
