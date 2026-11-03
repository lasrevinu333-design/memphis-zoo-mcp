// NEW source/loopback qualification: synthetic ledger and protected registry.
// No SQL, Supabase service credential, actual manager login, mailbox or device.
import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createOpsManagerSession, makeOpsAccessMiddleware } from '../src/auth/shared-access-auth.js';
import { HELD_REVIEW_ROUTE, HELD_REVIEW_COLUMNS, HELD_REVIEW_MAX_ROWS,
  readHeldLedgerSnapshot, makeBoundManagerHeldReviewHandler, installBoundManagerHeldReviewRoute } from '../src/manager-held-event-review-reader.js';
import { HELD_CORRECTION_PLACES_ROUTE, HELD_CORRECTION_PREVIEW_ROUTE,
  HELD_CORRECTION_CONFIRM_ROUTE, HELD_CORRECTION_STATUS_ROUTE, installManagerHeldEventCorrectionRoutes } from '../src/manager-held-event-correction-route.js';

const row = n => ({ id: `90000000-0000-4000-8000-${String(n).padStart(12, '0')}`, event_id: null,
  received_at: '2026-10-10T13:00:00.000Z', payload_hash: 'a'.repeat(64), sync_status: 'NEEDS_REVIEW' });
function ledger(data, options = {}) {
  const calls = [];
  const client = { from(...args) {
    calls.push(['from', ...args]); const chain = {};
    for (const method of ['select', 'like', 'eq', 'order', 'range', 'abortSignal']) chain[method] = (...args) => {
      calls.push([method, ...args]); return chain;
    };
    chain.retry = async (...args) => { calls.push(['retry', ...args]);
      if (options.beforeResult) await options.beforeResult();
      if (options.throw) throw new Error('private database error MUST NOT escape');
      return { data, count: options.count ?? data.length, error: options.error ?? null };
    };
    return chain;
  } };
  return { client, calls };
}
function response() {
  return { headersSent: false, writableEnded: false, statusCode: 200, headers: {}, body: null,
    setHeader(name, value) { this.headers[name] = value; }, status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; this.headersSent = this.writableEnded = true; return this; } };
}
const manager = { manager_id: '90000000-0000-4000-8000-000000000101', display_name: 'Synthetic review manager',
  system_key: 'synthetic_review_manager', is_system_principal: false, roles: ['OPS_MANAGER'], active: true, revoked_at: null };
const env = { NODE_ENV: 'production', OPS_MANAGER_SESSION_SECRET: randomBytes(32).toString('hex') };
const device = { credential_id: '90000000-0000-4000-8000-000000000201', device_id: 'synthetic-review-desktop',
  manager_id: manager.manager_id, manager: { ...manager }, max_access_level: 'read_only', revoked_at: null,
  created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 3600000).toISOString() };
const session = () => createOpsManagerSession({ env, manager, credentialId: device.credential_id, deviceId: device.device_id, accessLevel: 'read_only' });
const headers = token => ({ authorization: `Bearer ${token}`, 'x-device-id': device.device_id });
function req(query = {}) { return { query, memphisAuth: session() }; }
async function handle(data, query = {}, options = {}) {
  const source = ledger(data, options), r = req(query), s = response(); let authCalls = 0;
  const gate = options.gate || (async (request, _res, next) => { authCalls++; request.memphisAuth = r.memphisAuth; next(); });
  await makeBoundManagerHeldReviewHandler({ client: source.client, requireOpsManagerAuth: gate })(r, s);
  return { r, s, ...source, authCalls };
}

test('NEW 01 fixed minimum SELECT/filter/order/count/cap/deadline/no-retry contract', async () => {
  const fixture = ledger([row(1)]), result = await readHeldLedgerSnapshot({ client: fixture.client });
  assert.deepEqual(fixture.calls.slice(0, 6), [ ['from', 'events_app_outlook_sync'],
    ['select', HELD_REVIEW_COLUMNS, { count: 'exact' }], ['like', 'source_event_key', 'custodial-outlook-events-v1/event/%'],
    ['eq', 'sync_status', 'NEEDS_REVIEW'], ['order', 'id', { ascending: true }], ['range', 0, HELD_REVIEW_MAX_ROWS - 1] ]);
  assert.ok(fixture.calls[6][1] instanceof AbortSignal); assert.deepEqual(fixture.calls[7], ['retry', false]);
  assert.equal(result.total, 1); assert.match(result.snapshot_sha256, /^[a-f0-9]{64}$/);
});
test('NEW 02 missing client never selects any fallback or environment', async () => {
  await assert.rejects(readHeldLedgerSnapshot(), /held_review_service_not_configured/);
});
test('NEW 03 truncation/exact-count mismatch cannot become complete', async () => {
  await assert.rejects(readHeldLedgerSnapshot(ledger([row(1)], { count: 2 })), /held_review_source_incomplete/);
});
test('NEW 04 cap overflow/missing count/error abort complete-list authority', async () => {
  for (const options of [{ count: HELD_REVIEW_MAX_ROWS + 1 }, { count: NaN }, { error: { message: 'private' } }])
    await assert.rejects(readHeldLedgerSnapshot(ledger([row(1)], options)), /held_review_source_incomplete/);
});
test('NEW 05 injected private/unknown source fields rejected, never projected or logged', async () => {
  for (const key of ['source_payload', 'source_subject', 'sync_note', 'outlook_message_id', 'source_event_key', 'unknown'])
    await assert.rejects(readHeldLedgerSnapshot(ledger([{ ...row(1), [key]: 'private fixture canary' }])), /held_review_source_shape_invalid/);
});
test('NEW 06 missing/duplicate/unordered ledger identities fail closed', async () => {
  const missing = row(1); delete missing.payload_hash;
  for (const rows of [[missing], [row(1), row(1)], [row(2), row(1)]])
    await assert.rejects(readHeldLedgerSnapshot(ledger(rows)), /held_review_source_shape_invalid/);
});
test('NEW 07 existing-event held rows are not silently dropped or called unpublished', async () => {
  await assert.rejects(readHeldLedgerSnapshot(ledger([{ ...row(1), event_id: row(2).id }])), /held_review_event_identity_must_be_explicit_null/);
});
test('NEW 08 source snapshot owns original fields across later input mutation', async () => {
  const rows = [row(1)], result = await readHeldLedgerSnapshot(ledger(rows)), before = JSON.stringify(result);
  rows[0].payload_hash = 'b'.repeat(64); rows.push(row(2)); assert.equal(JSON.stringify(result), before);
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.source) && Object.isFrozen(result.source[0]));
});
test('NEW 09 same sorted facts produce same digest, any retained fact changes it', async () => {
  const a = await readHeldLedgerSnapshot(ledger([row(1)])), b = await readHeldLedgerSnapshot(ledger([row(1)]));
  assert.equal(a.snapshot_sha256, b.snapshot_sha256);
  for (const changed of [{ ...row(1), payload_hash: 'b'.repeat(64) }, { ...row(1), received_at: '2026-10-10T13:01:00.000Z' }, row(2)])
    assert.notEqual((await readHeldLedgerSnapshot(ledger([changed]))).snapshot_sha256, a.snapshot_sha256);
});
test('NEW 10 first and terminal page bound to exact immutable snapshot', async () => {
  const first = await handle([row(1), row(2)], { limit: '1' });
  assert.equal(first.s.statusCode, 200); assert.equal(first.authCalls, 2);
  const p = first.s.body.data; assert.equal(p.schema, 'custodial.manager-held-review.v2');
  assert.equal(p.next_cursor, `hr2:1:${p.snapshot_sha256}`); assert.equal(p.total_count, 2);
  const next = await handle([row(1), row(2)], { cursor: p.next_cursor, limit: '1' });
  assert.equal(next.s.statusCode, 200); assert.equal(next.s.body.data.page_start, 1); assert.equal(next.s.body.data.next_cursor, null);
});
test('NEW 11 changed snapshot rejects continuation without a partial replacement page', async () => {
  const first = await handle([row(1), row(2)], { limit: '1' });
  const next = await handle([row(1), { ...row(2), payload_hash: 'b'.repeat(64) }], { cursor: first.s.body.data.next_cursor });
  assert.equal(next.s.statusCode, 409); assert.equal(next.s.body.code, 'held_review_snapshot_changed'); assert.equal(next.s.body.data, undefined);
});
test('NEW 12 unbound/zero/malformed/array cursor and limits/unknown parameters rejected BEFORE read', async () => {
  const bad = [{ cursor: 'hr1:1' }, { cursor: `hr2:0:${'a'.repeat(64)}` }, { cursor: ['hr2:1:a'] }, { cursor: `hr2:1000:${'a'.repeat(64)}` },
    { limit: '01' }, { limit: '101' }, { limit: '1.0' }, { limit: ['1'] }, { source: 'other' }];
  for (const query of bad) { const result = await handle([row(1)], query); assert.equal(result.s.statusCode, 400); assert.equal(result.calls.length, 0); }
});
test('NEW 13 unclassified source means UNKNOWN fields, not invented parser diagnosis', async () => {
  const result = await handle([row(1)]), record = result.s.body.data.rows[0];
  assert.equal(record.review_reason_code, 'UNCLASSIFIED_SOURCE_REVIEW');
  assert.deepEqual(record.missing_fields, { end_time: 'UNKNOWN', venue_reference: 'UNKNOWN' });
  assert.equal(record.event_id, null); assert.equal(record.revision, null);
  for (const key of ['published', 'coverage_assigned', 'reminder_eligible']) assert.equal(record[key], false);
});
test('NEW 14 no secret/private source error/session reference escapes any response', async () => {
  const result = await handle([row(1)], {}, { throw: true }); assert.equal(result.s.statusCode, 503);
  const serialized = JSON.stringify(result.s.body);
  for (const privateValue of ['private database error', env.OPS_MANAGER_SESSION_SECRET, result.r.memphisAuth.token, device.device_id, device.credential_id])
    assert.equal(serialized.includes(privateValue), false);
  assert.equal(result.s.headers['Cache-Control'], 'private, no-store');
});
test('NEW 15 entrypoint mounts only normal existing client/current manager gate, no permissive fallback', () => {
  const source = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  assert.equal(source.split('installBoundManagerHeldReviewRoute(app, { client: supabaseAdmin, requireOpsManagerAuth });').length - 1, 1);
  const mounts = []; installBoundManagerHeldReviewRoute({ get: (...v) => mounts.push(v) }, { client: ledger([]).client, requireOpsManagerAuth: async () => {} });
  assert.equal(mounts.length, 1); assert.equal(mounts[0][0], HELD_REVIEW_ROUTE);
  assert.throws(() => installBoundManagerHeldReviewRoute({ get() {} }), /owning_manager_middleware_required/);
});

test('G10 mounted product routes use the fixed client and current write gate; absent client fails closed', async () => {
  const mounted = new Map(), app = {
    get(path, gate, handler) { mounted.set(path, { gate, handler }); },
    post(path, gate, handler) { mounted.set(path, { gate, handler }); },
  };
  const source = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  assert.equal(source.split('installManagerHeldEventCorrectionRoutes(app, { client: supabaseAdmin, requireOpsManagerWrite });').length - 1, 1);
  const gate = async (request, _res, next) => { request.memphisAuth = { ...session(), read_only: false }; next(); };
  installManagerHeldEventCorrectionRoutes(app, { client: null, requireOpsManagerWrite: gate });
  assert.deepEqual([...mounted.keys()], [HELD_CORRECTION_PLACES_ROUTE, HELD_CORRECTION_PREVIEW_ROUTE, HELD_CORRECTION_STATUS_ROUTE, HELD_CORRECTION_CONFIRM_ROUTE]);
  for (const route of mounted.values()) {
    assert.equal(route.gate, gate);
    const request = { body: {} }, reply = response();
    await gate(request, reply, () => {});
    await route.handler(request, reply);
    assert.equal(reply.statusCode, 503);
    assert.equal(reply.body.code, 'held_correction_target_unavailable');
    assert.equal(reply.headers['Cache-Control'], 'private, no-store');
  }
});

test('G10 places projects only bounded eligible refs and labels; changed current manager denies result', async () => {
  const id = '90000000-0000-4000-8000-000000000501';
  const group = '90000000-0000-4000-8000-000000000502';
  let candidate = { ...session(), read_only: false }, reads = 0, onRead = null;
  const gate = async (request, _res, next) => { request.memphisAuth = { ...candidate }; next(); };
  const calls = [], mounted = new Map(), app = {
    get(path, _gate, handler) { mounted.set(path, handler); }, post() {},
  };
  const client = { rpc() {}, from(table) {
    assert.equal(table, 'event_venues'); reads++;
    const chain = {};
    for (const method of ['select', 'eq', 'not', 'in', 'order', 'limit', 'abortSignal']) chain[method] = (...args) => {
      calls.push([method, ...args]); return chain;
    };
    chain.retry = async () => { onRead?.(); return { count: 1, error: null,
      data: [{ id, display_name: ' Synthetic Eligible Venue ', location_group_id: group,
        event_scope: 'SINGLE_VENUE', active: true, eligible_event_venue: true }] }; };
    return chain;
  } };
  installManagerHeldEventCorrectionRoutes(app, { client, requireOpsManagerWrite: gate });
  const request = { memphisAuth: { ...candidate } }, reply = response();
  await mounted.get(HELD_CORRECTION_PLACES_ROUTE)(request, reply);
  assert.equal(reply.statusCode, 200);
  assert.deepEqual(reply.body.data, { schema: 'custodial.held-event-correction-places.v1',
    places: [{ venue_ref: id, label: 'Synthetic Eligible Venue' }] });
  assert.equal(reads, 1);
  assert.ok(calls.some(([method, field, value]) => method === 'eq' && field === 'eligible_event_venue' && value === true));
  onRead = () => { candidate = { ...candidate, token: 'synthetic-other-current-session' }; };
  const denied = response(); await mounted.get(HELD_CORRECTION_PLACES_ROUTE)({ memphisAuth: { ...session(), read_only: false } }, denied);
  assert.equal(denied.statusCode, 403);
  assert.equal(denied.body.data, undefined);
});

test('G10 preview and one confirm return V2 envelopes with exact ledger and event readback', async () => {
  const ledgerId = row(601).id, venueId = row(602).id, groupId = row(603).id;
  const eventId = row(604).id, previewId = row(605).id, digest = 'a'.repeat(64), previewHash = 'b'.repeat(64);
  const start = '2026-10-12T15:00:00.000Z', end = '2026-10-12T17:00:00.000Z';
  const original = { source: { mailbox: 'eoperle@memphiszoo.org', message_id: 'synthetic-message-601',
    content_sha256: 'c'.repeat(64), evidence_kind: 'original_event_notice',
    source_at: '2026-10-10T12:59:00.000Z', received_at: '2026-10-10T13:00:00.000Z' },
    source_event_key: 'notice-601', reason: 'Missing end and place' };
  const held = { ...row(601), outlook_message_id: 'synthetic-message-601',
    source_event_key: 'custodial-outlook-events-v1/event/notice-601', source_payload: original };
  const venue = { id: venueId, display_name: 'Synthetic Pavilion', location_group_id: groupId,
    event_scope: 'SINGLE_VENUE', active: true, eligible_event_venue: true,
    updated_at: '2026-10-01T00:00:00.000Z' };
  const normalized = { event_name: 'Synthetic Event', event_date: '2026-10-12', start_time: '10:00:00',
    start_instant_utc: start, end_date: '2026-10-12', end_time: '12:00:00', end_instant_utc: end,
    primary_venue_id: venueId, display_location: 'Synthetic Pavilion' };
  let savedEvent = null, writes = 0, currentSnapshot;
  const client = { from(table) {
    const chain = {};
    for (const method of ['select', 'like', 'eq', 'order', 'range', 'abortSignal']) chain[method] = () => chain;
    chain.retry = () => chain;
    chain.then = (resolve, reject) => Promise.resolve({ data: held.event_id === null ? [{ id: held.id, event_id: null,
      received_at: held.received_at, payload_hash: held.payload_hash, sync_status: held.sync_status }] : [],
      count: held.event_id === null ? 1 : 0, error: null }).then(resolve, reject);
    chain.single = async () => ({ data: structuredClone(table === 'events_app_outlook_sync' ? held
      : table === 'event_venues' ? venue : savedEvent), error: null });
    return { select() { return chain; } };
  }, rpc(name, args) {
    const chain = { abortSignal() { return chain; }, async retry() {
      if (name === 'custodial_held_event_preview_v2') return { data: {
        schema: 'custodial.held-event-correction-preview.v2', ledger_id: ledgerId,
        expected_review_snapshot_sha256: args.p_expected_review_snapshot_sha256,
        source_provenance_digest: digest, preview_id: previewId, preview_sha256: previewHash,
        venue_fingerprint: 'd'.repeat(64), normalized_event: normalized,
        fact_basis: { event_name: 'MANAGER_CONFIRMED', start_at: 'MANAGER_CONFIRMED',
          end_at: 'MANAGER_CONFIRMED', venue_ref: 'MANAGER_CONFIRMED' },
        source_evidence_status: 'ORIGINAL_FACTS_INCOMPLETE', missing_original_fields: ['event_name', 'start_at'],
        state: 'PREVIEW_ONLY', published: false, coverage_assigned: false, reminder_eligible: false } };
      if (name === 'custodial_held_event_confirm_v2') {
        writes++; held.event_id = eventId; held.sync_status = 'APPLIED';
        savedEvent = { ...normalized, id: eventId, revision: 1, status: 'SCHEDULED',
          location_group_id: groupId, operation_id: previewId,
          source_format: 'outlook_held_manager_correction', manually_overridden: true, needs_review: false };
        return { data: { schema: 'custodial.held-event-correction-confirmed.v2', state: 'APPLIED',
          ledger_id: ledgerId, preview_id: previewId, preview_sha256: previewHash, event_id: eventId, revision: 1 } };
      }
      throw new Error(`unexpected typed RPC ${name}`);
    } }; return chain;
  } };
  currentSnapshot = (await readHeldLedgerSnapshot({ client })).snapshot_sha256;
  const gate = async (request, _res, next) => { request.memphisAuth = {
    role: 'ops_manager', manager_id: manager.manager_id, credential_id: device.credential_id,
    device_id: device.device_id, token: 'synthetic-current-token', read_only: false,
    expires_at: new Date(Date.now() + 3600000).toISOString(),
  }; next(); };
  const mounted = new Map(); installManagerHeldEventCorrectionRoutes({ get(path, _gate, handler) { mounted.set(path, handler); },
    post(path, _gate, handler) { mounted.set(path, handler); } }, { client, requireOpsManagerWrite: gate });
  const previewReq = { body: { schema: 'custodial.held-event-correction-preview-request.v2', ledger_id: ledgerId,
    expected_review_snapshot_sha256: currentSnapshot, source_provenance_digest: digest,
    correction: { event_name: 'Synthetic Event', start_at: start, end_at: end, venue_ref: venueId },
    manager_fact_confirmation: 'MANAGER_CONFIRMED_MISSING_ORIGINAL_FACTS' } };
  await gate(previewReq, response(), () => {});
  const previewRes = response(); await mounted.get(HELD_CORRECTION_PREVIEW_ROUTE)(previewReq, previewRes);
  assert.equal(previewRes.statusCode, 200, JSON.stringify(previewRes.body));
  assert.equal(previewRes.body.data.state, 'PREVIEW_ONLY');
  assert.equal(previewRes.body.data.fact_basis.start_at, 'MANAGER_CONFIRMED');
  const confirmReq = { body: { schema: 'custodial.held-event-correction-confirm-request.v2',
    preview_id: previewId, preview_sha256: previewHash } };
  await gate(confirmReq, response(), () => {});
  const confirmed = response(); await mounted.get(HELD_CORRECTION_CONFIRM_ROUTE)(confirmReq, confirmed);
  assert.equal(confirmed.statusCode, 200);
  assert.equal(confirmed.body.data.manager_feed_verified, false);
  assert.equal(confirmed.body.data.event_id, eventId);
  assert.equal(writes, 1);
  assert.deepEqual(held.source_payload, original);
  assert.equal(held.payload_hash, digest);
  const replay = response(); await mounted.get(HELD_CORRECTION_CONFIRM_ROUTE)(confirmReq, replay);
  assert.equal(replay.statusCode, 409);
  assert.equal(writes, 1);
});

test('NEW 16 real owning HMAC/current-registry middleware + NEW GET over loopback, synthetic state only', async t => {
  const current = { ...device, manager: { ...manager } }; let queries = 0, afterRead = null;
  const store = { async find(id) { return id === current.credential_id ? current : null; } };
  const auth = makeOpsAccessMiddleware({ env, trustedDeviceStore: store });
  const fixture = ledger([row(1)], { beforeResult: async () => { queries++; if (afterRead) await afterRead(); } });
  const handler = makeBoundManagerHeldReviewHandler({ client: fixture.client, requireOpsManagerAuth: auth });
  const server = http.createServer((r, s) => {
    r.header = r.get = name => r.headers[name.toLowerCase()]; r.query = Object.fromEntries(new URL(r.url, 'http://127.0.0.1').searchParams);
    s.status = code => { s.statusCode = code; return s; }; s.json = value => { s.setHeader('Content-Type', 'application/json'); s.end(JSON.stringify(value)); return s; };
    if (r.method !== 'GET' || new URL(r.url, 'http://127.0.0.1').pathname !== HELD_REVIEW_ROUTE) { s.statusCode = 404; s.end(); return; }
    handler(r, s).catch(() => { s.statusCode = 500; s.end('source fixture failure'); });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const address = `http://127.0.0.1:${server.address().port}${HELD_REVIEW_ROUTE}`;
  const get = async (h = {}) => { const r = await fetch(address, { headers: h, signal: AbortSignal.timeout(4000) }); return { status: r.status, cache: r.headers.get('cache-control'), data: await r.json() }; };
  try {
    await t.test('NEW HTTP 1 no bearer cannot read', async () => { const n = queries, r = await get(); assert.equal(r.status, 401); assert.equal(queries, n); });
    await t.test('NEW HTTP 2 forged bearer cannot read', async () => { const n = queries, r = await get(headers('not-a-signed-token')); assert.equal(r.status, 401); assert.equal(queries, n); });
    await t.test('NEW HTTP 3 valid normal signed current manager can read unknown/held-only DTO', async () => {
      const r = await get(headers(session().token)); assert.equal(r.status, 200); assert.equal(r.cache, 'private, no-store');
      assert.equal(r.data.data.rows[0].published, false); assert.equal(r.data.data.rows[0].missing_fields.end_time, 'UNKNOWN');
      assert.equal(r.data.data.schema, 'custodial.manager-held-review.v2');
    });
    await t.test('NEW HTTP 4 revoked device before read cannot select', async () => {
      current.revoked_at = new Date().toISOString(); const n = queries, r = await get(headers(session().token));
      assert.equal(r.status, 401); assert.equal(queries, n); current.revoked_at = null;
    });
    await t.test('NEW HTTP 5 device revoked DURING read hides result', async () => {
      afterRead = () => { current.revoked_at = new Date().toISOString(); }; const r = await get(headers(session().token));
      assert.equal(r.status, 401); assert.equal(r.data.data, undefined); current.revoked_at = null; afterRead = null;
    });
    await t.test('NEW HTTP 6 manager disabled DURING read hides result', async () => {
      afterRead = () => { current.manager.active = false; }; const r = await get(headers(session().token));
      assert.equal(r.status, 403); assert.equal(r.data.data, undefined); current.manager.active = true; afterRead = null;
    });
    await t.test('NEW HTTP 7 changed named-manager association rejected before read', async () => {
      current.manager_id = row(3).id; const n = queries, r = await get(headers(session().token));
      assert.equal(r.status, 403); assert.equal(queries, n); current.manager_id = manager.manager_id;
    });
    await t.test('NEW HTTP 8 protected registry exception is fixed private error, no inner message', async () => {
      store.find = async () => { throw Error('private registry detail'); }; const r = await get(headers(session().token));
      assert.equal(r.status, 503); assert.equal(JSON.stringify(r.data).includes('private registry detail'), false);
    });
  } finally { server.closeAllConnections(); await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  assert.equal(server.listening, false);
});
