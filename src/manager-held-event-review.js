export const HELD_REVIEW_SCHEMA = 'custodial.manager-held-review.v1';
export const HELD_REVIEW_SOURCE = 'events_app_outlook_sync';
export const DEFAULT_PAGE_SIZE = 100;
export const CURSOR_MAX_LENGTH = 64;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[a-f0-9]{64}$/;
const CURSOR = /^hr1:(0|[1-9][0-9]{0,9})$/;
const ISO = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const REASONS = new Set([
  'MISSING_AUTHORITATIVE_END_TIME_AND_VENUE_REFERENCE',
  'SOURCE_CONTENT_AMBIGUOUS',
  'SOURCE_IDENTITY_UNRESOLVED',
  'UNCLASSIFIED_SOURCE_REVIEW',
]);
const MISSING_STATES = new Set(['MISSING', 'PRESENT', 'UNKNOWN']);
const forbidden = new Set(['source_payload', 'source_subject', 'outlook_message_id', 'source_event_key', 'sync_note', 'raw_mail', 'private_notes', 'recipient_identities', 'credentials', 'token', 'password', 'mailbox_address']);

const fail = (code, status = 503) => { throw Object.assign(new Error(code), { code, status }); };
const text = (value, max) => typeof value === 'string' && value.trim().length <= max ? value.trim() : null;
const checkedUuid = (value, field) => { if (!UUID.test(value || '')) fail(`held_review_${field}_invalid`, 503); return value.toLowerCase(); };
const checkedInstant = (value, field) => { if (!ISO(value)) fail(`held_review_${field}_invalid`, 503); return new Date(value).toISOString(); };
const encodeCursor = value => { if (!Number.isSafeInteger(value) || value < 0 || value > 1_000_000_000) fail('held_review_cursor_invalid', 503); return `hr1:${value}`; };
const decodeCursor = (value, status = 400) => {
  if (value === null) return 0;
  if (typeof value !== 'string' || value.length > CURSOR_MAX_LENGTH || !CURSOR.test(value)) fail('held_review_cursor_invalid', status);
  const parsed = Number(value.slice(4));
  if (!Number.isSafeInteger(parsed) || parsed > 1_000_000_000) fail('held_review_cursor_invalid', status);
  return parsed;
};

function safeMissingEvidence(row) {
  const evidence = row?.structured_missing_fields;
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    return { end_time: 'UNKNOWN', venue_reference: 'UNKNOWN' };
  }
  const value = key => MISSING_STATES.has(evidence[key]) ? evidence[key] : 'UNKNOWN';
  return { end_time: value('end_time'), venue_reference: value('venue_reference') };
}

export function projectHeldReviewRow(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) fail('held_review_row_invalid');
  for (const key of Object.keys(row)) if (forbidden.has(key)) fail('held_review_forbidden_source_field');
  const ledgerId = checkedUuid(row.ledger_id ?? row.id, 'ledger_id');
  if (!Object.hasOwn(row, 'event_id') || row.event_id !== null) fail('held_review_event_identity_must_be_explicit_null');
  if (!Object.hasOwn(row, 'revision') || row.revision !== null) fail('held_review_revision_must_be_explicit_null');
  if (row.sync_status !== 'NEEDS_REVIEW') fail('held_review_status_invalid');
  const reason = REASONS.has(row.structured_review_code) ? row.structured_review_code : 'UNCLASSIFIED_SOURCE_REVIEW';
  const digest = text(row.payload_hash ?? row.source_provenance_digest, 64);
  if (!SHA256.test(digest || '')) fail('held_review_provenance_digest_invalid');
  return Object.freeze({
    ledger_id: ledgerId,
    event_id: null,
    revision: null,
    status: 'NEEDS_REVIEW',
    source: HELD_REVIEW_SOURCE,
    source_provenance_digest: digest,
    received_at: checkedInstant(row.received_at, 'received_at'),
    review_reason_code: reason,
    missing_fields: safeMissingEvidence(row),
    published: false,
    coverage_assigned: false,
    reminder_eligible: false,
  });
}

function checkPage(result, limit, requestedStart) {
  if (!result || result.state !== 'current' || result.complete !== true || !Array.isArray(result.rows)
    || result.rows.length > limit || !Number.isSafeInteger(result.total_count) || result.total_count < result.rows.length
    || result.page_start !== requestedStart || !Number.isSafeInteger(result.consumed_count)
    || result.consumed_count !== requestedStart + result.rows.length
    || result.consumed_count > result.total_count) fail('held_review_source_incomplete');
  const seen = new Set();
  const rows = result.rows.map(projectHeldReviewRow);
  for (const row of rows) { if (seen.has(row.ledger_id)) fail('held_review_duplicate_ledger_id'); seen.add(row.ledger_id); }
  if (result.next_cursor === null) {
    if (result.consumed_count !== result.total_count) fail('held_review_terminal_count_contradiction');
  } else {
    const next = decodeCursor(result.next_cursor, 503);
    if (next !== result.consumed_count || next >= result.total_count) fail('held_review_cursor_witness_invalid');
    if (next <= requestedStart) fail('held_review_cursor_no_progress');
  }
  return { rows, page_start: requestedStart, consumed_count: result.consumed_count, total_count: result.total_count,
    next_cursor: result.next_cursor === null ? null : encodeCursor(decodeCursor(result.next_cursor, 503)) };
}

export async function readHeldReviewPage({ readRows, cursor = null, limit = DEFAULT_PAGE_SIZE } = {}) {
  if (typeof readRows !== 'function') fail('held_review_reader_required', 500);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) fail('held_review_limit_invalid', 400);
  const requestedStart = decodeCursor(cursor, 400);
  let result;
  try { result = await readRows({ cursor: cursor === null ? null : encodeCursor(requestedStart), limit }); } catch { fail('held_review_source_unavailable'); }
  return checkPage(result, limit, requestedStart);
}

export function makeManagerHeldReviewHandler({ readRows, now = () => new Date() } = {}) {
  if (typeof readRows !== 'function') throw new TypeError('held_review_reader_required');
  return async function managerHeldReview(req, res) {
    const session = req?.memphisAuth;
    if (session?.role !== 'ops_manager' || !UUID.test(session.manager_id || '') || !text(session.credential_id, 200)) {
      return res.status(403).json({ ok: false, error: 'Named manager required.' });
    }
    const cursor = req?.query?.cursor ?? null;
    const rawLimit = req?.query?.limit == null ? DEFAULT_PAGE_SIZE : Number(req.query.limit);
    try {
      const page = await readHeldReviewPage({ readRows, cursor, limit: rawLimit });
      res.setHeader('Cache-Control', 'private, no-store');
      return res.status(200).json({ ok: true, data: {
        schema: HELD_REVIEW_SCHEMA,
        source: HELD_REVIEW_SOURCE,
        generated_at: checkedInstant(now()?.toISOString?.(), 'generated_at'),
        coverage: 'held_review_only',
        rows: page.rows,
        page_start: page.page_start,
        consumed_count: page.consumed_count,
        returned_count: page.rows.length,
        total_count: page.total_count,
        next_cursor: page.next_cursor,
      } });
    } catch (error) {
      const status = error?.status === 400 ? 400 : error?.status === 403 ? 403 : 503;
      return res.status(status).json({ ok: false, code: error?.code || 'held_review_source_unavailable', error: 'Held review source unavailable.' });
    }
  };
}

export function syntheticReader(rows, { state = 'current', complete = true, total_count = rows.length } = {}) {
  return async ({ cursor = null, limit = DEFAULT_PAGE_SIZE } = {}) => {
    const start = decodeCursor(cursor, 400);
    const page = rows.slice(start, start + limit);
    const consumed = start + page.length;
    return { state, complete, rows: page, page_start: start, consumed_count: consumed, total_count,
      next_cursor: consumed < rows.length ? encodeCursor(consumed) : null };
  };
}

export const __testOnly = Object.freeze({ UUID, SHA256, CURSOR, forbidden, encodeCursor, decodeCursor });
