/* Complete, deterministic and bounded non-authoritative staffing candidates. */
import { createHash } from 'node:crypto';
import { bytewiseCompare, canonicalJson, isIsoServiceDate } from './static-weekly-schedule-model.js';
import { createStaffingPreparationMeter } from './static-weekly-staffing-preparation.js';

export const STAFFING_CANDIDATE_SET_SCHEMA = 'memphis-zoo.static-weekly-staffing-candidates.v1';
const KINDS = new Set(['projection', 'lunch', 'schedule_refresh']);
const FIELDS = new Set(['candidateKind', 'candidateKey', 'serviceDate', 'payload']);
const failure = code => Object.assign(new Error(code), { code });

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function normalize(row, allowedDates, allowedWeeks) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) throw failure('staffing_candidate_required');
  for (const field of Object.keys(row)) if (!FIELDS.has(field)) throw failure('staffing_candidate_unknown_field');
  if (!KINDS.has(row.candidateKind)) throw failure('staffing_candidate_kind_required');
  if (typeof row.candidateKey !== 'string' || row.candidateKey.length < 1 || row.candidateKey.length > 300
      || row.candidateKey.trim() !== row.candidateKey || row.candidateKey.includes('\0')) {
    throw failure('staffing_candidate_key_required');
  }
  const allowedServiceDates = row.candidateKind === 'projection' || row.candidateKind === 'lunch'
    ? allowedWeeks : allowedDates;
  if (typeof row.serviceDate !== 'string' || !isIsoServiceDate(row.serviceDate)
      || !allowedServiceDates.has(row.serviceDate)) throw failure('staffing_candidate_date_outside_command');
  if (!row.payload || typeof row.payload !== 'object' || Array.isArray(row.payload)) {
    throw failure('staffing_candidate_payload_required');
  }
  const payload = structuredClone(row.payload);
  const payloadDigest = createHash('sha256').update(canonicalJson(payload)).digest('hex');
  return { candidateKind: row.candidateKind, candidateKey: row.candidateKey,
    serviceDate: row.serviceDate, payload, payloadDigest };
}

export function createStaffingCandidateSet({ window, candidates, meter = createStaffingPreparationMeter() }) {
  if (!window || !Array.isArray(window.dates) || !Array.isArray(window.weeks)
      || !Array.isArray(candidates)) throw failure('staffing_candidate_set_required');
  const allowedDates = new Set(window.dates);
  const weekStarts = new Set(window.weeks);
  const rows = candidates.map(row => normalize(row, allowedDates, weekStarts));
  rows.sort((left, right) => bytewiseCompare(left.serviceDate, right.serviceDate)
    || bytewiseCompare(left.candidateKind, right.candidateKind)
    || bytewiseCompare(left.candidateKey, right.candidateKey));
  const identities = new Set();
  for (const row of rows) {
    const identity = `${row.candidateKind}\0${row.candidateKey}`;
    if (identities.has(identity)) throw failure('staffing_candidate_duplicate');
    identities.add(identity);
  }
  for (const kind of ['projection', 'lunch']) {
    const weekRows = rows.filter(row => row.candidateKind === kind);
    if (weekRows.length !== weekStarts.size
        || weekRows.some(row => !weekStarts.has(row.serviceDate))
        || new Set(weekRows.map(row => row.serviceDate)).size !== weekStarts.size) {
      throw failure(`staffing_candidate_${kind}_weeks_incomplete`);
    }
  }
  const canonicalRows = rows.map(row => canonicalJson(row));
  const totals = meter.accountCanonicalRows(canonicalRows);
  meter.checkpoint();
  const digest = createHash('sha256').update(canonicalJson(rows)).digest('hex');
  return freeze({
    schema: STAFFING_CANDIDATE_SET_SCHEMA,
    digest,
    rowCount: rows.length,
    canonicalBytes: totals.canonicalBytes,
    rows,
    summary: {
      weeks: window.weeks.length,
      serviceDates: window.dates.length,
      projections: rows.filter(row => row.candidateKind === 'projection').length,
      lunches: rows.filter(row => row.candidateKind === 'lunch').length,
      scheduleRefreshes: rows.filter(row => row.candidateKind === 'schedule_refresh').length,
    },
  });
}
