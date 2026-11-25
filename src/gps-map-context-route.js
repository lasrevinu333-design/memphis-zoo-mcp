import { readGpsMapHistory, HISTORY_CONTRACT } from './gps-map-history.js';
import { mapManagerBinding, recheckMapManager } from './auth/private-map-manager.js';

export const GPS_MAP_CONTEXT_ROUTE = '/dashboard-api/gps-map-context';
export const GPS_MAP_CONTEXT_CONTRACT = 'gps-map-context.v1';

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

export function makeGpsMapContextHandler({ requireOpsManagerAuth, runReadOnlyQuery, now = Date.now } = {}) {
  if (typeof requireOpsManagerAuth !== 'function' || typeof runReadOnlyQuery !== 'function' || typeof now !== 'function')
    throw new Error('Existing manager auth, dedicated read-only query and server clock are required.');
  return async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    const original = mapManagerBinding(req.memphisAuth);
    if (!original) return res.status(403).json({ ok: false, error: 'A current named manager read session is required.' });
    // No caller-supplied identities, coordinates, controls, limits or filters.
    if (Object.keys(req.query || {}).length || Object.keys(req.body || {}).length)
      return res.status(422).json({ ok: false, error: 'GPS context uses only existing server-bound work and manager authority.' });
    try {
      const generatedAt = now();
      if (!Number.isFinite(generatedAt)) throw new Error('GPS context server clock unavailable.');
      const work = await readGpsMapHistory({
        assertNamedManager: async () => mapManagerBinding(req.memphisAuth) === original,
        runReadOnlySql: async sql => completeGpsHistoryRows(await runReadOnlyQuery(sql)),
        now: () => generatedAt,
      });
      const access = await recheckMapManager(req, original, requireOpsManagerAuth);
      if (access !== 200)
        return res.status(access).json({ ok: false, error: 'Manager read authority changed.' });
      // No trustworthy approved geographic-control package is available in
      // this candidate. Never replace that missing evidence with canvas pins,
      // proximity fixtures, an inferred transform or browser-supplied controls.
      return res.status(200).json({ ok: true, data: {
        controls: null,
        geographic_registration: 'unverified_controls_missing',
        work,
      }, meta: {
        contract: GPS_MAP_CONTEXT_CONTRACT, history_contract: HISTORY_CONTRACT,
        manager_id: req.memphisAuth.manager_id, credential_id: req.memphisAuth.credential_id,
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
    makeGpsMapContextHandler({ requireOpsManagerAuth, runReadOnlyQuery, now }));
}
