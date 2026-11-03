import { readGpsMapHistory, HISTORY_CONTRACT } from './gps-map-history.js';
import { hasManagerPermission } from './auth/manager-permissions.js';

export const GPS_MAP_CONTEXT_ROUTE = '/dashboard-api/gps-map-context';
export const GPS_MAP_CONTEXT_CONTRACT = 'gps-map-context.v1';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const namedPrincipal = session => session?.role === 'ops_manager'
  && UUID.test(session.manager_id || '') && UUID.test(session.credential_id || '')
  && hasManagerPermission(session, 'read')
    ? Object.freeze({ managerId: session.manager_id, credentialId: session.credential_id,
      deviceId: session.device_id }) : null;
const samePrincipal = (a, b) => !!a && !!b && a.managerId === b.managerId
  && a.credentialId === b.credentialId && a.deviceId === b.deviceId;

// Keep the entire dedicated-reader result until completeness is verified. The
// generic .rows-only adapter discards global row/byte truncation metadata, which
// could otherwise turn a partial response into a complete-looking work path.
export function completeGpsHistoryRows(result) {
  if (result?.ok !== true || result.row_limit_truncated !== false
      || result.response_truncated !== false || result.omitted_oversized_rows !== 0
      || !Array.isArray(result.rows) || result.rowCount !== result.rows.length
      || result.originalRowCount !== result.rows.length)
    throw new Error('GPS history dedicated-reader response is incomplete.');
  return result.rows;
}

export function makeGpsMapContextHandler({ runReadOnlyQuery, now = Date.now } = {}) {
  if (typeof runReadOnlyQuery !== 'function' || typeof now !== 'function')
    throw new Error('Existing dedicated read-only query and server clock are required.');
  return async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    const principal = namedPrincipal(req?.memphisAuth);
    if (!principal) return res.status(403).json({ ok: false, error: 'A current named manager read session is required.' });
    // No caller-supplied identities, coordinates, controls, limits or filters.
    if (Object.keys(req.query || {}).length || Object.keys(req.body || {}).length)
      return res.status(422).json({ ok: false, error: 'GPS context uses only existing server-bound work and manager authority.' });
    try {
      const generatedAt = now();
      if (!Number.isFinite(generatedAt)) throw new Error('GPS context server clock unavailable.');
      const work = await readGpsMapHistory({
        assertNamedManager: async () => samePrincipal(principal, namedPrincipal(req.memphisAuth)),
        runReadOnlySql: async sql => completeGpsHistoryRows(await runReadOnlyQuery(sql)),
        now: () => generatedAt,
      });
      if (!samePrincipal(principal, namedPrincipal(req.memphisAuth)))
        return res.status(403).json({ ok: false, error: 'Manager read authority changed.' });
      // No trustworthy approved geographic-control package is available in
      // this candidate. Never replace that missing evidence with canvas pins,
      // proximity fixtures, an inferred transform or browser-supplied controls.
      return res.status(200).json({ ok: true, data: {
        controls: null,
        geographic_registration: 'unverified_controls_missing',
        work,
      }, meta: {
        contract: GPS_MAP_CONTEXT_CONTRACT, history_contract: HISTORY_CONTRACT,
        manager_id: principal.managerId, credential_id: principal.credentialId,
        generated_at: new Date(generatedAt).toISOString(),
      } });
    } catch {
      return res.status(503).json({ ok: false, code: 'GPS_MAP_CONTEXT_UNAVAILABLE',
        error: 'Complete session-bound GPS context is unavailable.' });
    }
  };
}

export function installGpsMapContextRoute(app, { requireOpsManagerAuth, runReadOnlyQuery, now } = {}) {
  if (typeof app?.get !== 'function' || typeof requireOpsManagerAuth !== 'function')
    throw new Error('Existing named-manager middleware and GET mount are required.');
  app.get(GPS_MAP_CONTEXT_ROUTE, requireOpsManagerAuth,
    makeGpsMapContextHandler({ runReadOnlyQuery, now }));
}
