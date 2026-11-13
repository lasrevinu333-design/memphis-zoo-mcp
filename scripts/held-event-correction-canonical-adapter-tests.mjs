import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createCanonicalHeldCorrectionAdapter,
  HELD_CANONICAL_PREVIEW_REQUEST, HELD_CANONICAL_PREVIEW,
  HELD_CANONICAL_CONFIRM_REQUEST, HELD_CANONICAL_CONFIRMED,
  HELD_CANONICAL_STATUS_REQUEST,
} from '../src/held-event-correction-canonical-adapter.js';
import { postgresJsonbContentDigest } from '../src/static-weekly-schedule-program.js';
import { HELD_REVIEW_BOUND_SCHEMA } from '../src/manager-held-event-review-reader.js';
import { projectHeldReviewRow } from '../src/manager-held-event-review.js';

// Synthetic, source-only recording store. No Supabase client, manager session,
// mailbox, SQL transaction, or published manager feed is used here.
const LEDGER_ID = '11111111-1111-4111-8111-111111111111';
const VENUE_ID = '22222222-2222-4222-8222-222222222222';
const GROUP_ID = '33333333-3333-4333-8333-333333333333';
const MANAGER_ID = '44444444-4444-4444-8444-444444444444';
const EVENT_ID = '55555555-5555-4555-8555-555555555555';
const PREVIEW_ID = '66666666-6666-4666-8666-666666666666';
const SOURCE_PAYLOAD = { source: { mailbox: 'eoperle@memphiszoo.org',
  message_id: 'synthetic-message-123', content_sha256: 'd'.repeat(64),
  evidence_kind: 'original_event_notice', source_at: '2026-10-07T21:39:35.000Z',
  received_at: '2026-10-07T21:39:36.000Z', subject: 'Synthetic operational event' },
  source_event_key: 'notice-1', reason: 'Missing end and venue' };
const HASH = postgresJsonbContentDigest({ action: 'review', observation: SOURCE_PAYLOAD });
const PREVIEW_HASH = 'b'.repeat(64);
const VENUE_HASH = 'c'.repeat(64);
const START = '2026-10-12T15:00:00.000Z';
const END = '2026-10-12T17:00:00.000Z';
const sha = value => createHash('sha256').update(value).digest('hex');

function fixture() {
  const state = {
    auth: { role: 'ops_manager', manager_id: MANAGER_ID, credential_id: '77777777-7777-4777-8777-777777777777',
      device_id: 'test-device', token: 'synthetic-current-token',
      expires_at: '2099-01-01T00:00:00.000Z' },
    ledger: { id: LEDGER_ID, event_id: null, received_at: '2026-10-07T21:39:36.000Z',
      payload_hash: HASH, sync_status: 'NEEDS_REVIEW', outlook_message_id: 'synthetic-message-123',
      source_subject: 'Synthetic operational event', sync_note: 'Original facts incomplete',
      created_at: '2026-10-07T21:40:00.000Z', updated_at: '2026-10-07T21:40:00.000Z',
      source_event_key: 'custodial-outlook-events-v1/event/notice-1',
      source_payload: structuredClone(SOURCE_PAYLOAD) },
    venue: { id: VENUE_ID, display_name: 'Synthetic Eligible Venue', location_group_id: GROUP_ID,
      event_scope: 'SINGLE_VENUE',
      active: true, eligible_event_venue: true, updated_at: '2026-10-01T00:00:00.123456+00:00' },
    event: null, preview: null, loseConfirmResponse: false,
    reads: [], calls: [], writeCount: 0, onRead: null, onRpc: null,
  };
  const snapshot = () => {
    const row = { id: state.ledger.id, event_id: state.ledger.event_id,
      received_at: state.ledger.received_at,
      payload_hash: state.ledger.payload_hash, sync_status: state.ledger.sync_status };
    const safe = state.ledger.sync_status === 'NEEDS_REVIEW' && state.ledger.event_id === null
      ? [projectHeldReviewRow({ ...row, revision: null })] : [];
    return { rows: safe.length ? [row] : [], count: safe.length,
      hash: sha(JSON.stringify({ schema: HELD_REVIEW_BOUND_SCHEMA,
        source: 'events_app_outlook_sync', rows: safe })) };
  };
  const query = (table, columns, options) => {
    const chain = {
      like() { return chain; }, eq() { return chain; }, order() { return chain; },
      range() { return chain; }, abortSignal() { return chain; }, retry() { return chain; },
      single() { return Promise.resolve().then(() => {
        state.reads.push(`${table}:${columns}`);
        state.onRead?.(table, state);
        const row = table === 'events_app_outlook_sync' ? state.ledger
          : table === 'event_venues' ? state.venue
            : table === 'custodial_held_event_previews_v2' ? state.preview : state.event;
        return { data: row ? Object.fromEntries(columns.split(',').map(key => [key, structuredClone(row[key])]))
          : null, error: row ? null : { message: 'missing' } };
      }); },
      then(resolve, reject) { return Promise.resolve().then(() => {
        state.reads.push(`${table}:${columns}`);
        state.onRead?.(table, state);
        if (options?.count === 'exact') {
          const s = snapshot(); return { data: s.rows, count: s.count, error: null };
        }
        throw new Error('unexpected collection read');
      }).then(resolve, reject); },
    };
    return chain;
  };
  const normalized_event = () => ({ event_name: 'Synthetic Zoo Event', event_date: '2026-10-12',
    start_time: '10:00:00', start_instant_utc: START, end_date: '2026-10-12',
    end_time: '12:00:00', end_instant_utc: END,
    primary_venue_id: VENUE_ID, display_location: state.venue.display_name });
  const client = {
    from(table) { return { select(columns, options) { return query(table, columns, options); } }; },
    rpc(name, args) {
      const operation = Promise.resolve().then(() => {
        state.calls.push(name);
        if (state.onRpc) { const override = state.onRpc(name, args, state); if (override !== undefined) return override; }
        if (name === 'custodial_held_event_preview_v2') {
          state.preview = { preview_id: PREVIEW_ID, preview_sha256: PREVIEW_HASH,
            ledger_id: LEDGER_ID, source_provenance_digest: HASH,
            original_payload_sha256: postgresJsonbContentDigest(state.ledger.source_payload),
            original_message_id: state.ledger.outlook_message_id,
            original_event_key: state.ledger.source_event_key,
            original_received_at: state.ledger.received_at,
            original_subject: state.ledger.source_subject,
            original_created_at: state.ledger.created_at,
            original_updated_at: state.ledger.updated_at,
            venue_id: VENUE_ID, normalized_event: normalized_event(),
            manager_id: MANAGER_ID, credential_id: state.auth.credential_id,
            device_id: state.auth.device_id,
            session_fingerprint: sha(state.auth.token), state: 'PREVIEW_ONLY',
            event_id: null, applied_at: null };
          return { data: {
          schema: HELD_CANONICAL_PREVIEW, state: 'PREVIEW_ONLY', preview_id: PREVIEW_ID,
          preview_sha256: PREVIEW_HASH, ledger_id: LEDGER_ID,
          expected_review_snapshot_sha256: args.p_expected_review_snapshot_sha256,
          source_provenance_digest: HASH, venue_fingerprint: VENUE_HASH,
          source_evidence_status: 'ORIGINAL_FACTS_INCOMPLETE',
          missing_original_fields: ['event_name', 'start_at'],
          fact_basis: { event_name: 'MANAGER_CONFIRMED', start_at: 'MANAGER_CONFIRMED',
            end_at: 'MANAGER_CONFIRMED', venue_ref: 'MANAGER_CONFIRMED' },
          normalized_event: normalized_event(), published: false,
          coverage_assigned: false, reminder_eligible: false } };
        }
        if (name === 'custodial_held_event_confirm_v2') {
          state.writeCount++;
          state.ledger.event_id = EVENT_ID; state.ledger.sync_status = 'APPLIED';
          state.ledger.sync_note = 'Manager-confirmed held event; original facts incomplete';
          state.ledger.updated_at = '2026-10-07T21:41:00.000Z';
          state.preview.state = 'APPLIED'; state.preview.event_id = EVENT_ID;
          state.preview.applied_at = '2026-10-07T21:41:00.000Z';
          state.event = { id: EVENT_ID, revision: 1, status: 'SCHEDULED',
            ...normalized_event(), location_group_id: GROUP_ID, operation_id: PREVIEW_ID,
            source_format: 'outlook_held_manager_correction', manually_overridden: true,
            needs_review: false, created_by_manager_id: MANAGER_ID,
            updated_by_manager_id: MANAGER_ID, created_by: 'Synthetic Manager',
            overridden_by: 'Synthetic Manager', event_timezone: 'America/Chicago' };
          if (state.loseConfirmResponse) throw new Error('synthetic lost response after commit');
          return { data: { schema: HELD_CANONICAL_CONFIRMED, state: 'APPLIED',
            preview_id: PREVIEW_ID, preview_sha256: PREVIEW_HASH,
            ledger_id: LEDGER_ID, event_id: EVENT_ID, revision: 1 } };
        }
        throw new Error(`unexpected RPC ${name}`);
      });
      return { abortSignal() { return this; }, retry() { return operation; } };
    },
  };
  const requireOpsManagerWrite = (req, _res, next) => {
    if (!state.auth) throw new Error('normal gate denied');
    req.memphisAuth = structuredClone(state.auth);
    next();
  };
  const adapter = createCanonicalHeldCorrectionAdapter({ client, requireOpsManagerWrite });
  const restart = () => createCanonicalHeldCorrectionAdapter({ client, requireOpsManagerWrite });
  const request = () => ({ schema: HELD_CANONICAL_PREVIEW_REQUEST, ledger_id: LEDGER_ID,
    expected_review_snapshot_sha256: snapshot().hash, source_provenance_digest: HASH,
    correction: { event_name: 'Synthetic Zoo Event', start_at: START, end_at: END,
      venue_ref: VENUE_ID }, manager_fact_confirmation: 'MANAGER_CONFIRMED_MISSING_ORIGINAL_FACTS' });
  const confirm = () => ({ schema: HELD_CANONICAL_CONFIRM_REQUEST,
    preview_id: PREVIEW_ID, preview_sha256: PREVIEW_HASH });
  const status = () => ({ schema: HELD_CANONICAL_STATUS_REQUEST,
    preview_id: PREVIEW_ID, preview_sha256: PREVIEW_HASH });
  return { state, adapter, restart, request, confirm, status, snapshot };
}

const rejects = (promise, code) => assert.rejects(promise, error => error?.code === code);

test('V2 manager-entered missing facts preview and one canonical confirmation keep original ledger provenance', async () => {
  const f = fixture(), original = structuredClone(f.state.ledger);
  const preview = await f.adapter.preview({}, f.request());
  assert.equal(preview.state, 'PREVIEW_ONLY');
  assert.equal(preview.normalized_event.event_name, 'Synthetic Zoo Event');
  assert.equal(preview.fact_basis.start_at, 'MANAGER_CONFIRMED');
  assert.equal(preview.source_evidence_status, 'ORIGINAL_FACTS_INCOMPLETE');
  assert.equal(preview.published, false);
  const result = await f.adapter.confirm({}, f.confirm());
  assert.equal(result.state, 'ACCEPTED');
  assert.equal(result.manager_feed_verified, false);
  assert.equal(f.state.writeCount, 1);
  assert.deepEqual(f.state.ledger.source_payload, original.source_payload);
  assert.equal(f.state.ledger.payload_hash, original.payload_hash);
  assert.equal(f.state.ledger.received_at, original.received_at);
  assert.equal(f.state.ledger.outlook_message_id, original.outlook_message_id);
  assert.equal(f.state.ledger.source_event_key, original.source_event_key);
});

test('closed request refuses absent title/start and caller-supplied auth or publication flags before reads', async () => {
  const f = fixture();
  for (const mutation of [
    x => { delete x.correction.event_name; }, x => { delete x.correction.start_at; },
    x => { x.authenticated = true; }, x => { x.published = true; },
  ]) { const request = f.request(); mutation(request); await rejects(f.adapter.preview({}, request), 'held_canonical_preview_request_invalid'); }
  assert.equal(f.state.reads.length, 0);
});

test('stale review snapshot and original provenance reject before typed preview', async () => {
  const f = fixture(), stale = f.request(); stale.expected_review_snapshot_sha256 = 'e'.repeat(64);
  await rejects(f.adapter.preview({}, stale), 'held_canonical_snapshot_changed');
  f.state.ledger.source_payload.source.message_id = 'changed-original';
  await rejects(f.adapter.preview({}, f.request()), 'held_canonical_original_ledger_unverified');
  assert.equal(f.state.calls.length, 0);
});

test('changed current manager during preview rejects without returning handle', async () => {
  const f = fixture(); let changed = false;
  f.state.onRead = (_table, state) => { if (!changed) { changed = true; state.auth.token = 'revoked-other-token'; } };
  await rejects(f.adapter.preview({}, f.request()), 'held_canonical_manager_changed');
  assert.equal(f.state.calls.length, 0);
});

test('changed venue fingerprint before confirm refuses writer; uneligible venue refuses preview', async () => {
  const f = fixture(); await f.adapter.preview({}, f.request());
  f.state.venue.updated_at = '2026-10-02T00:00:00.000Z';
  await rejects(f.adapter.confirm({}, f.confirm()), 'held_canonical_venue_changed');
  assert.equal(f.state.writeCount, 0);
  const g = fixture(); g.state.venue.eligible_event_venue = false;
  await rejects(g.adapter.preview({}, g.request()), 'held_canonical_venue_unavailable');
  assert.equal(g.state.calls.length, 0);
});

test('duplicate confirmation is one-use, including after an ambiguous writer response', async () => {
  const f = fixture(); await f.adapter.preview({}, f.request());
  assert.equal((await f.adapter.confirm({}, f.confirm())).state, 'ACCEPTED');
  await rejects(f.adapter.confirm({}, f.confirm()), 'held_canonical_preview_missing_or_consumed');
  const g = fixture(); await g.adapter.preview({}, g.request());
  g.state.onRpc = name => { if (name === 'custodial_held_event_confirm_v2') throw new Error('synthetic timeout after possible commit'); };
  assert.equal((await g.adapter.confirm({}, g.confirm())).state, 'OUTCOME_UNKNOWN');
  await rejects(g.adapter.confirm({}, g.confirm()), 'held_canonical_preview_missing_or_consumed');
});

test('revoked auth before confirm and wrong receipt both refuse the writer', async () => {
  const f = fixture(); await f.adapter.preview({}, f.request());
  await rejects(f.adapter.confirm({}, { ...f.confirm(), preview_sha256: 'f'.repeat(64) }),
    'held_canonical_preview_missing_or_consumed');
  f.state.auth = null;
  await rejects(f.adapter.confirm({}, f.confirm()), 'held_canonical_current_manager_required');
  assert.equal(f.state.writeCount, 0);
});

test('partial commit or wrong canonical readback cannot be called accepted', async () => {
  const f = fixture(); await f.adapter.preview({}, f.request());
  f.state.onRpc = name => name === 'custodial_held_event_confirm_v2'
    ? { data: { schema: HELD_CANONICAL_CONFIRMED, state: 'APPLIED', preview_id: PREVIEW_ID,
      preview_sha256: PREVIEW_HASH, ledger_id: LEDGER_ID, event_id: EVENT_ID, revision: 1 } } : undefined;
  assert.equal((await f.adapter.confirm({}, f.confirm())).state, 'READBACK_UNCONFIRMED');
  const g = fixture(); await g.adapter.preview({}, g.request());
  g.state.onRead = (table, state) => {
    if (table === 'events_app_events' && state.event) state.event.event_name = 'Wrong persisted title';
  };
  assert.equal((await g.adapter.confirm({}, g.confirm())).state, 'READBACK_UNCONFIRMED');
});

test('changed original ledger metadata during preview or before confirm refuses write', async () => {
  const f = fixture(), before = f.request();
  f.state.onRpc = name => { if (name === 'custodial_held_event_preview_v2') f.state.ledger.source_payload.reason = 'altered'; };
  await rejects(f.adapter.preview({}, before), 'held_canonical_original_ledger_changed');
  const g = fixture(); await g.adapter.preview({}, g.request());
  g.state.ledger.received_at = '2026-10-07T21:39:37.000Z';
  await rejects(g.adapter.confirm({}, g.confirm()), 'held_canonical_snapshot_changed');
  assert.equal(g.state.writeCount, 0);
});

test('wrong local time projection and changed manager after confirm write cannot prove acceptance', async () => {
  const f = fixture();
  f.state.onRpc = name => {
    if (name !== 'custodial_held_event_preview_v2') return undefined;
    return { data: { schema: HELD_CANONICAL_PREVIEW, state: 'PREVIEW_ONLY',
      preview_id: PREVIEW_ID, preview_sha256: PREVIEW_HASH, ledger_id: LEDGER_ID,
      expected_review_snapshot_sha256: f.request().expected_review_snapshot_sha256,
      source_provenance_digest: HASH, venue_fingerprint: VENUE_HASH,
      source_evidence_status: 'ORIGINAL_FACTS_INCOMPLETE',
      missing_original_fields: ['event_name', 'start_at'],
      fact_basis: { event_name: 'MANAGER_CONFIRMED', start_at: 'MANAGER_CONFIRMED',
        end_at: 'MANAGER_CONFIRMED', venue_ref: 'MANAGER_CONFIRMED' },
      normalized_event: { event_name: 'Synthetic Zoo Event', event_date: '2026-10-12',
        start_time: '11:00:00', start_instant_utc: START, end_date: '2026-10-12',
        end_time: '12:00:00', end_instant_utc: END,
        primary_venue_id: VENUE_ID, display_location: f.state.venue.display_name },
      published: false, coverage_assigned: false, reminder_eligible: false } };
  };
  await rejects(f.adapter.preview({}, f.request()), 'held_canonical_preview_projection_invalid');
  const g = fixture(); await g.adapter.preview({}, g.request());
  g.state.onRead = (table, state) => {
    if (table === 'events_app_events' && state.event) state.auth = null;
  };
  const result = await g.adapter.confirm({}, g.confirm());
  assert.equal(result.state, 'READBACK_UNCONFIRMED');
  assert.equal(result.published, false);
});

test('lost confirm response reconciles the exact applied preview and event without another write', async () => {
  const f = fixture();
  await f.adapter.preview({}, f.request());
  f.state.loseConfirmResponse = true;
  assert.equal((await f.adapter.confirm({}, f.confirm())).state, 'OUTCOME_UNKNOWN');
  const calls = f.state.calls.length;
  const result = await f.restart().status({}, f.status());
  assert.equal(result.schema, HELD_CANONICAL_CONFIRMED);
  assert.equal(result.state, 'ACCEPTED');
  assert.equal(result.event_id, EVENT_ID);
  assert.equal(result.revision, 1);
  assert.equal(result.manager_feed_verified, false);
  assert.equal(result.normalized_event.event_name, 'Synthetic Zoo Event');
  assert.equal(f.state.calls.length, calls);
  assert.equal(f.state.writeCount, 1);
  assert.ok(f.state.reads.some(read => read.startsWith('custodial_held_event_previews_v2:')));
});

test('status keeps pending, absent, changed source, changed actor and stale event uncertain', async () => {
  const pending = fixture(); await pending.adapter.preview({}, pending.request());
  assert.deepEqual(await pending.adapter.status({}, pending.status()), {
    state: 'HELD', published: false, manager_feed_verified: false, retry_safe: false });
  assert.equal(pending.state.writeCount, 0);
  pending.state.preview = null;
  assert.equal((await pending.adapter.status({}, pending.status())).state, 'READBACK_UNCONFIRMED');
  const transitioning = fixture(); await transitioning.adapter.preview({}, transitioning.request());
  let previewReads = 0;
  transitioning.state.onRead = table => {
    if (table === 'custodial_held_event_previews_v2' && ++previewReads === 2)
      transitioning.state.preview.state = 'APPLIED';
  };
  assert.equal((await transitioning.adapter.status({}, transitioning.status())).state, 'READBACK_UNCONFIRMED');
  const changed = fixture(); await changed.adapter.preview({}, changed.request());
  changed.state.loseConfirmResponse = true;
  await changed.adapter.confirm({}, changed.confirm());
  changed.state.ledger.source_payload.reason = 'silently changed';
  assert.equal((await changed.adapter.status({}, changed.status())).state, 'READBACK_UNCONFIRMED');
  changed.state.ledger.source_payload = structuredClone(SOURCE_PAYLOAD);
  changed.state.event.revision = 2;
  assert.equal((await changed.adapter.status({}, changed.status())).state, 'READBACK_UNCONFIRMED');
  changed.state.event.revision = 1;
  changed.state.auth.token = 'different-current-session';
  await rejects(changed.adapter.status({}, changed.status()), 'held_canonical_manager_changed');
  assert.equal(changed.state.writeCount, 1);
  await rejects(changed.adapter.status({}, { ...changed.status(), published: true }),
    'held_canonical_status_request_invalid');
});
