import assert from 'node:assert/strict';
import { makeManagerHeldReviewHandler, projectHeldReviewRow, readHeldReviewPage, syntheticReader } from '../src/manager-held-event-review.js';

const base = (id, extra = {}) => ({
  id, event_id: null, revision: null, sync_status: 'NEEDS_REVIEW',
  payload_hash: 'a'.repeat(64), received_at: '2026-10-10T15:00:00Z', ...extra,
});
const row = base('11111111-1111-4111-8111-111111111111', {
  structured_review_code: 'MISSING_AUTHORITATIVE_END_TIME_AND_VENUE_REFERENCE',
  structured_missing_fields: { end_time: 'MISSING', venue_reference: 'MISSING' },
});
const second = base('22222222-2222-4222-8222-222222222222', { structured_missing_fields: { venue_reference: 'UNKNOWN' } });

if (process.argv.includes('--safe-fields-only')) {
  const handler = makeManagerHeldReviewHandler({
    readRows: async () => ({ state: 'current', complete: true, rows: [row], page_start: 0, consumed_count: 1, total_count: 1, next_cursor: null }),
    now: () => new Date('2026-10-10T15:02:00Z'),
  });
  const res = { statusCode: null, headers: {}, body: null, setHeader(k, v) { this.headers[k] = v; }, status(v) { this.statusCode = v; return this; }, json(v) { this.body = v; return this; } };
  await handler({ memphisAuth: { role: 'ops_manager', manager_id: '44444444-4444-4444-8444-444444444444', credential_id: 'synthetic-session-marker' }, query: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(Object.hasOwn(res.body, 'meta'), false);
  assert.deepEqual(Object.keys(res.body.data).sort(), ['consumed_count', 'coverage', 'generated_at', 'next_cursor', 'page_start', 'returned_count', 'rows', 'schema', 'source', 'total_count']);
  assert.equal(JSON.stringify(res.body).includes('synthetic-session-marker'), false);
  console.log('TAP version 13');
  console.log('1..3');
  console.log('ok 1 - manager DTO has no undocumented metadata envelope');
  console.log('ok 2 - manager DTO exposes only the pinned data fields');
  console.log('ok 3 - session markers are not serialized in the response');
  process.exit(0);
}

if (process.argv.includes('--progress-only')) {
  const emptyTerminal = await readHeldReviewPage({
    readRows: async () => ({ state: 'current', complete: true, rows: [], page_start: 0, consumed_count: 0, total_count: 0, next_cursor: null }),
    limit: 1,
  });
  assert.deepEqual(emptyTerminal, { rows: [], page_start: 0, consumed_count: 0, total_count: 0, next_cursor: null });
  await assert.rejects(() => readHeldReviewPage({
    readRows: async () => ({ state: 'current', complete: true, rows: [], page_start: 0, consumed_count: 0, total_count: 2, next_cursor: 'hr1:0' }),
    limit: 1,
  }), /cursor_no_progress/);
  await assert.rejects(() => readHeldReviewPage({
    readRows: async () => ({ state: 'current', complete: true, rows: [], page_start: 1, consumed_count: 1, total_count: 2, next_cursor: 'hr1:1' }),
    cursor: 'hr1:1',
    limit: 1,
  }), /cursor_no_progress/);
  console.log('TAP version 13');
  console.log('1..3');
  console.log('ok 1 - empty terminal page remains valid when consumed_count equals total_count');
  console.log('ok 2 - empty nonterminal self-cursor fails closed');
  console.log('ok 3 - non-empty nonterminal self-cursor fails closed');
  process.exit(0);
}

const projected = projectHeldReviewRow(row);
assert.deepEqual(projected, {
  ledger_id: '11111111-1111-4111-8111-111111111111', event_id: null, revision: null,
  status: 'NEEDS_REVIEW', source: 'events_app_outlook_sync', source_provenance_digest: 'a'.repeat(64),
  received_at: '2026-10-10T15:00:00.000Z', review_reason_code: 'MISSING_AUTHORITATIVE_END_TIME_AND_VENUE_REFERENCE',
  missing_fields: { end_time: 'MISSING', venue_reference: 'MISSING' }, published: false,
  coverage_assigned: false, reminder_eligible: false,
});
assert.deepEqual(projectHeldReviewRow(second).missing_fields, { end_time: 'UNKNOWN', venue_reference: 'UNKNOWN' });
assert.throws(() => projectHeldReviewRow({ ...row, source_payload: { raw: 'do not expose' } }), /forbidden_source_field/);
assert.throws(() => projectHeldReviewRow({ ...row, event_id: '33333333-3333-4333-8333-333333333333' }), /identity_must_be_explicit_null/);
assert.throws(() => projectHeldReviewRow({ ...row, sync_note: 'raw prose is not a safe reason' }), /forbidden_source_field/);
assert.equal(projectHeldReviewRow({ ...row, structured_review_code: 'raw prose' }).review_reason_code, 'UNCLASSIFIED_SOURCE_REVIEW');
assert.throws(() => { const { event_id, ...omitted } = row; return projectHeldReviewRow(omitted); }, /explicit_null/);
assert.throws(() => { const { revision, ...omitted } = row; return projectHeldReviewRow(omitted); }, /explicit_null/);

const page = await readHeldReviewPage({ readRows: syntheticReader([row, second]), limit: 1 });
assert.equal(page.rows.length, 1); assert.equal(page.next_cursor, 'hr1:1'); assert.equal(page.page_start, 0); assert.equal(page.consumed_count, 1); assert.equal(page.total_count, 2);
await assert.rejects(() => readHeldReviewPage({ readRows: async () => ({ state: 'current', complete: true, rows: [row], page_start: 0, consumed_count: 1, total_count: 2, next_cursor: null }), limit: 1 }), /terminal_count_contradiction/);
await assert.rejects(() => readHeldReviewPage({ readRows: async () => ({ state: 'current', complete: true, rows: [row], page_start: 0, consumed_count: 1, total_count: 2, next_cursor: 'not-safe' }), limit: 1 }), /cursor_invalid/);
await assert.rejects(() => readHeldReviewPage({ cursor: 'x'.repeat(201), readRows: syntheticReader([row]) }), /cursor_invalid/);
const canonicalInput = await readHeldReviewPage({ cursor: 'hr1:1', readRows: async ({ cursor }) => { assert.equal(cursor, 'hr1:1'); return { state: 'current', complete: true, rows: [second], page_start: 1, consumed_count: 2, total_count: 2, next_cursor: null }; }, limit: 1 });
assert.equal(canonicalInput.page_start, 1); assert.equal(canonicalInput.consumed_count, 2); assert.equal(canonicalInput.next_cursor, null);
await assert.rejects(() => readHeldReviewPage({ readRows: syntheticReader([row], { complete: false }), limit: 1 }), /source_incomplete/);
await assert.rejects(() => readHeldReviewPage({ readRows: syntheticReader([row, row]), limit: 2 }), /duplicate_ledger_id/);
await assert.rejects(() => readHeldReviewPage({ readRows: async () => { throw Error('db'); } }), /source_unavailable/);

let calls = 0;
const handler = makeManagerHeldReviewHandler({ readRows: async () => { calls += 1; return { state: 'current', complete: true, rows: [row], page_start: 0, consumed_count: 1, total_count: 1, next_cursor: null }; }, now: () => new Date('2026-10-10T15:02:00Z') });
const response = () => { const out = { statusCode: null, headers: {}, body: null, setHeader(k, v) { this.headers[k] = v; }, status(v) { this.statusCode = v; return this; }, json(v) { this.body = v; return this; } }; return out; };
const denied = response(); await handler({ memphisAuth: { role: 'ops_manager', manager_id: 'not-a-uuid', credential_id: 'x' } }, denied); assert.equal(denied.statusCode, 403); assert.equal(calls, 0);
const allowed = response(); await handler({ memphisAuth: { role: 'ops_manager', manager_id: '44444444-4444-4444-8444-444444444444', credential_id: 'credential-synthetic' }, query: {} }, allowed);
assert.equal(allowed.statusCode, 200); assert.equal(allowed.body.data.schema, 'custodial.manager-held-review.v1'); assert.equal(allowed.body.data.rows[0].event_id, null); assert.equal(allowed.headers['Cache-Control'], 'private, no-store'); assert.equal(calls, 1);
const serialized = JSON.stringify(allowed.body); for (const forbidden of ['source_payload', 'raw_mail', 'private_notes', 'recipient_identities', 'credentials', 'mailbox_address']) assert.equal(serialized.includes(forbidden), false);
console.log('TAP version 13');
console.log('1..14');
console.log('ok 1 - closed projector preserves null event identity and digest-only provenance');
console.log('ok 2 - missing end/place evidence defaults to UNKNOWN');
console.log('ok 3 - raw source fields are rejected rather than projected');
console.log('ok 4 - unapproved free-text reason cannot become a safe reason code');
console.log('ok 5 - omitted event_id/revision are rejected');
console.log('ok 6 - bounded cursor pagination and exact count are preserved');
console.log('ok 7 - contradictory terminal count fails closed');
console.log('ok 8 - arbitrary or oversized cursor fails closed');
console.log('ok 9 - cursor input/output uses the closed encoding');
console.log('ok 10 - incomplete source fails closed');
console.log('ok 11 - duplicate ledger identity fails closed');
console.log('ok 12 - source reader failure fails closed');
console.log('ok 13 - unauthorized manager request is denied without reader invocation');
console.log('ok 14 - authorized response is private, typed, and least-data');
