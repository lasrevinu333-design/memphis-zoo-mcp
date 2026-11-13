import { createHash } from 'node:crypto';
import { projectHeldReviewRow, readHeldReviewPage } from './manager-held-event-review.js';

// Existing server-only ledger SELECT. No RPC/table/role/grant changes, source
// payload reads, collector, correction, publication or production fallback.
export const HELD_REVIEW_ROUTE = '/dashboard-api/held-event-reviews';
export const HELD_REVIEW_BOUND_SCHEMA = 'custodial.manager-held-review.v2';
export const HELD_REVIEW_COLUMNS = 'id,event_id,received_at,payload_hash,sync_status';
export const HELD_REVIEW_MAX_ROWS = 1000;
const TABLE = 'events_app_outlook_sync';
const PREFIX = 'custodial-outlook-events-v1/event/%';
const CURSOR = /^hr2:([1-9][0-9]{0,3}):([a-f0-9]{64})$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SOURCE_FIELDS = HELD_REVIEW_COLUMNS.split(',');
const fail = (code, status = 503) => { throw Object.assign(new Error(code), { code, status }); };
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const plain = value => value && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));

function requestPage(query = {}) {
  if (!plain(query) || Object.keys(query).some(key => !['cursor', 'limit'].includes(key))) fail('held_review_request_invalid', 400);
  const cursor = query.cursor ?? null;
  const limitText = query.limit ?? '100';
  if (typeof limitText !== 'string' || !/^(?:[1-9][0-9]?|100)$/.test(limitText)) fail('held_review_limit_invalid', 400);
  if (cursor === null) return { start: 0, snapshot: null, limit: Number(limitText) };
  if (typeof cursor !== 'string' || cursor.length > 74) fail('held_review_cursor_invalid', 400);
  const match = CURSOR.exec(cursor);
  if (!match || Number(match[1]) >= HELD_REVIEW_MAX_ROWS) fail('held_review_cursor_invalid', 400);
  return { start: Number(match[1]), snapshot: match[2], limit: Number(limitText) };
}

export async function readHeldLedgerSnapshot({ client, signal } = {}) {
  if (typeof client?.from !== 'function') fail('held_review_service_not_configured');
  const timeout = signal ? AbortSignal.any([signal, AbortSignal.timeout(6000)]) : AbortSignal.timeout(6000);
  let result;
  try {
    // One bounded statement and exact count, not independent count/page reads.
    // PostgREST truncation or cap overflow is unavailable, NEVER a full list.
    result = await client.from(TABLE).select(HELD_REVIEW_COLUMNS, { count: 'exact' })
      .like('source_event_key', PREFIX).eq('sync_status', 'NEEDS_REVIEW')
      .order('id', { ascending: true }).range(0, HELD_REVIEW_MAX_ROWS - 1)
      .abortSignal(timeout).retry(false);
  } catch { fail('held_review_source_unavailable'); }
  if (timeout.aborted || result?.error || !Array.isArray(result?.data) || !Number.isSafeInteger(result.count)
    || result.count < 0 || result.count > HELD_REVIEW_MAX_ROWS || result.count !== result.data.length) fail('held_review_source_incomplete');
  const source = [], safe = [];
  let previous = '';
  for (const row of result.data) {
    if (!plain(row) || Object.keys(row).some(key => !SOURCE_FIELDS.includes(key))
      || SOURCE_FIELDS.some(key => !Object.hasOwn(row, key)) || !UUID.test(row.id || '')
      || row.id.toLowerCase() <= previous) fail('held_review_source_shape_invalid');
    previous = row.id.toLowerCase();
    // The existing ledger has no event revision or structured review columns.
    // Do not parse sync_note/raw payload or invent a missing-field diagnosis.
    // Existing-event review requires a separate qualified representation; it
    // fails this unpublished-only contract instead of disappearing from it.
    const own = Object.freeze({ id: row.id, event_id: row.event_id, revision: null,
      received_at: row.received_at, payload_hash: row.payload_hash, sync_status: row.sync_status });
    safe.push(projectHeldReviewRow(own));
    source.push(own);
  }
  return Object.freeze({ source: Object.freeze(source), total: source.length,
    snapshot_sha256: digest({ schema: HELD_REVIEW_BOUND_SCHEMA, source: TABLE, rows: safe }) });
}

function managerBinding(session) {
  if (session?.role !== 'ops_manager' || !UUID.test(session.manager_id || '')
    || typeof session.credential_id !== 'string' || !session.credential_id.trim() || session.credential_id.length > 200
    || typeof session.token !== 'string' || !session.token || session.token.length > 8192
    || typeof session.device_id !== 'string' || !session.device_id || session.device_id.length > 96
    || typeof session.expires_at !== 'string' || !(Date.parse(session.expires_at) > Date.now())) fail('held_review_named_manager_required', 403);
  // Only compare private original references, never return/log them. The
  // owning middleware verifies BOTH signature and current protected registry.
  return JSON.stringify({ manager: session.manager_id, credential: session.credential_id,
    device: session.device_id, token: session.token, expires: session.expires_at, mode: session.auth_mode });
}

async function authenticate(req, res, requireOpsManagerAuth) {
  let accepted = false, status = 503;
  const safeAuthResponse = {
    get headersSent() { return res.headersSent; },
    get writableEnded() { return res.writableEnded; },
    status(value) { status = [401, 403, 503].includes(value) ? value : 503; return this; },
    json() { return res.status(status).json({ ok: false, code: 'held_review_authentication_unavailable', error: 'Current named-manager access required.' }); },
    setHeader(name, value) { res.setHeader(name, value); },
  };
  try { await requireOpsManagerAuth(req, safeAuthResponse, () => { accepted = true; }); }
  catch { if (!res.headersSent && !res.writableEnded) safeAuthResponse.status(503).json(); }
  return accepted && !res.headersSent && !res.writableEnded;
}

export function makeBoundManagerHeldReviewHandler({ client, requireOpsManagerAuth, now = () => new Date() } = {}) {
  if (typeof requireOpsManagerAuth !== 'function') throw new TypeError('held_review_owning_manager_middleware_required');
  return async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Vary', 'Authorization, X-Device-Id');
    if (!await authenticate(req, res, requireOpsManagerAuth)) return;
    try {
      const binding = managerBinding(req.memphisAuth), requested = requestPage(req.query);
      const abort = new AbortController();
      const onAborted = () => abort.abort();
      const onClose = () => { if (!res.writableEnded) abort.abort(); };
      req.once?.('aborted', onAborted); res.once?.('close', onClose);
      let snapshot;
      try { snapshot = await readHeldLedgerSnapshot({ client, signal: abort.signal }); }
      finally { req.removeListener?.('aborted', onAborted); res.removeListener?.('close', onClose); }
      if (abort.signal.aborted || res.writableEnded) return;
      // Recheck the SAME normal signature/current-manager/trusted-device gate
      // after asynchronous reading. No internal auth renewal or impersonation.
      if (!await authenticate(req, res, requireOpsManagerAuth)) return;
      if (binding !== managerBinding(req.memphisAuth)) fail('held_review_manager_context_changed', 403);
      if (requested.snapshot !== null && requested.snapshot !== snapshot.snapshot_sha256) fail('held_review_snapshot_changed', 409);
      if (requested.start > snapshot.total || (requested.snapshot !== null && requested.start >= snapshot.total)) fail('held_review_cursor_invalid', 400);
      // Reuse the qualified owning DTO/counter/duplicate validation without
      // mounting its unbound hr1 reader to a public route.
      const page = await readHeldReviewPage({ cursor: requested.start === 0 ? null : `hr1:${requested.start}`,
        limit: requested.limit, readRows: async () => {
          const rows = snapshot.source.slice(requested.start, requested.start + requested.limit), consumed = requested.start + rows.length;
          return { state: 'current', complete: true, rows, page_start: requested.start, consumed_count: consumed,
            total_count: snapshot.total, next_cursor: consumed < snapshot.total ? `hr1:${consumed}` : null };
        } });
      const generated = now()?.toISOString?.();
      if (typeof generated !== 'string' || !Number.isFinite(Date.parse(generated))) fail('held_review_clock_unavailable');
      return res.status(200).json({ ok: true, data: { schema: HELD_REVIEW_BOUND_SCHEMA, source: TABLE,
        generated_at: generated, coverage: 'held_review_only', snapshot_sha256: snapshot.snapshot_sha256,
        rows: page.rows, page_start: page.page_start, consumed_count: page.consumed_count,
        returned_count: page.rows.length, total_count: page.total_count,
        next_cursor: page.next_cursor === null ? null : `hr2:${page.consumed_count}:${snapshot.snapshot_sha256}` } });
    } catch (error) {
      if (res.headersSent || res.writableEnded) return;
      const status = [400, 403, 409].includes(error?.status) ? error.status : 503;
      const code = typeof error?.code === 'string' && /^held_review_[a-z_]+$/.test(error.code) ? error.code : 'held_review_source_unavailable';
      return res.status(status).json({ ok: false, code, error: 'Held review is unavailable. Original ledger records remain unchanged.' });
    }
  };
}

export function installBoundManagerHeldReviewRoute(app, options = {}) {
  if (typeof app?.get !== 'function') throw new TypeError('held_review_route_owner_required');
  app.get(HELD_REVIEW_ROUTE, makeBoundManagerHeldReviewHandler(options));
}
