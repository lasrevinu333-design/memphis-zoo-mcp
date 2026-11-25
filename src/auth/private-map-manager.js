import { hasManagerPermission } from './manager-permissions.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function mapManagerBinding(session) {
  if (session?.role !== 'ops_manager' || !UUID.test(session.manager_id || '')
    || !UUID.test(session.credential_id || '') || !session.device_id
    || !(Date.parse(session.expires_at) > Date.now()) || !hasManagerPermission(session, 'read')) return null;
  return JSON.stringify([session.manager_id, session.credential_id, session.device_id, session.expires_at, session.token]);
}

// Reuse the same credential verification as the route's entry middleware.
// A late denial must not forward the generic middleware's private error text.
export async function recheckMapManager(req, original, requireManager) {
  if (!original || mapManagerBinding(req.memphisAuth) !== original) return 403;
  let accepted = false, status = 503;
  const reply = {
    setHeader() {},
    status(code) { status = [401, 403].includes(code) ? code : 503; return this; },
    json() {},
  };
  await requireManager(req, reply, () => { accepted = true; });
  if (!accepted) return status;
  return mapManagerBinding(req.memphisAuth) === original ? 200 : 403;
}
