import { makeOpsAccessMiddleware } from './auth/shared-access-auth.js';
import { assertServerAssignedActor } from './manager-authority.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const error = (status, message) => Object.assign(new Error(message), { status });
function exactBody(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).some(key => !allowed.includes(key))) throw error(422, 'Unsupported request fields.');
  return value;
}
export function managerActionArguments(req) {
  const s = req.memphisAuth;
  if (!uuid.test(s?.manager_id || '') || !uuid.test(s?.credential_id || '') || !s?.device_id)
    throw error(403, 'A current named manager sign-in is required.');
  return { p_manager_id: s.manager_id, p_credential_id: s.credential_id,
    p_device_id: s.device_id, p_session_access: s.access_level };
}
function respond(operation) {
  return async (req, res) => {
    try { res.status(200).json({ ok: true, data: await operation(req) }); }
    catch (e) {
      const sqlStatus = { '42501': 403, '40001': 409, '22023': 422, '22P02': 422, 'P0002': 404 };
      res.status(e.status || sqlStatus[e.code] || 500).json({ ok: false,
        error: e.message || 'Manager action failed.', code: e.code || 'manager_action_failed' });
    }
  };
}
export function installOwnerAccessRoutes(app, { store, runRpc, backendSecret, env = process.env } = {}) {
  const read = makeOpsAccessMiddleware({ env, trustedDeviceStore: store });
  const write = makeOpsAccessMiddleware({ env, trustedDeviceStore: store, requireWrite: true });
  const close = makeOpsAccessMiddleware({ env, trustedDeviceStore: store, requiredPermission: 'close_scan_tickets' });
  const coverage = (req, change) => runRpc('custodial_owner_coverage_v1', {
    ...managerActionArguments(req), p_change: change, p_backend_execution_secret: backendSecret(),
  });
  app.get('/admin-api/access/coverage', read, respond(req => coverage(req, null)));
  app.post('/admin-api/access/coverage', write, respond(req => {
    const body = exactBody(req.body, ['enabled', 'ends_at', 'reason', 'expected_revision']);
    if (typeof body.enabled !== 'boolean' || !Number.isSafeInteger(body.expected_revision)
        || body.expected_revision < 0 || (body.enabled && !Number.isFinite(Date.parse(body.ends_at))))
      throw error(422, 'Supply the current coverage revision and a valid end time.');
    return coverage(req, body);
  }));
  app.post(['/admin-api/close-ticket', '/dashboard-api/close-ticket'], close, respond(async req => {
    assertServerAssignedActor(req.body);
    const body = exactBody(req.body, ['ticket_id', 'close_notes']);
    if (!uuid.test(body.ticket_id || '')) throw error(422, 'A valid ticket_id is required.');
    if (body.close_notes != null && (typeof body.close_notes !== 'string' || body.close_notes.length > 1000))
      throw error(422, 'Closure notes must be text of at most 1,000 characters.');
    return runRpc('custodial_close_scan_ticket_v1', { ...managerActionArguments(req),
      p_ticket_id: body.ticket_id, p_close_notes: body.close_notes || null,
      p_backend_execution_secret: backendSecret() });
  }));
  app.get('/auth-api/map-config', (_req, res) => {
    const key = String(env.MEMPHIS_MAP_SUPABASE_PUBLISHABLE_KEY || '').trim();
    if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) {
      res.status(503).json({ ok: false, error: 'Map sign-in is not configured.' }); return;
    }
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ ok: true, data: {
      url: 'https://dwzdqekusvivjbxsapdu.supabase.co', publishable_key: key,
      permission_schema: 'custodial.manager-permissions.v1',
    } });
  });
}
