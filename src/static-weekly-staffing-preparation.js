/*
 * Local preparation bounds for the reviewed staffing-command plan. These
 * primitives do not authorize a manager, create a command, certify compiler
 * output, persist staging, publish a schedule, or mark anything PREPARED.
 * The future authority adapter must independently verify completeness/digests
 * and enforce these same bounds in its one commit transaction.
 */
import { performance } from 'node:perf_hooks';
import { isIsoServiceDate } from './static-weekly-schedule-model.js';

export const STAFFING_PREPARATION_LIMITS = Object.freeze({
  dates: 366,
  weeks: 54,
  candidateRows: 100_000,
  canonicalBytes: 16 * 1024 * 1024,
  prepareMilliseconds: 30_000,
});
const DAY_MILLISECONDS = 86_400_000;
const failure = code => Object.assign(new Error(code), { code });

function epochForDate(value) {
  // No coercion, whitespace repair, time-of-day, or JS rollover. PostgreSQL
  // has no Gregorian year zero, even though JavaScript's ISO parser does.
  if (typeof value !== 'string' || !isIsoServiceDate(value) || value.startsWith('0000-')) {
    throw failure('staffing_invalid_service_date');
  }
  return Date.parse(`${value}T00:00:00.000Z`);
}

export function enumerateStaffingServiceWindow(startDate, endDate) {
  const start = epochForDate(startDate);
  const end = epochForDate(endDate);
  const count = (end - start) / DAY_MILLISECONDS + 1;
  if (count < 1) throw failure('staffing_reversed_window');
  if (count > STAFFING_PREPARATION_LIMITS.dates) throw failure('staffing_date_limit');
  const dates = [];
  const weeks = new Set();
  // UTC arithmetic represents calendar labels only, never a Memphis instant.
  // It therefore neither skips nor repeats a service date at DST transitions.
  for (let offset = 0; offset < count; offset++) {
    const date = new Date(start + offset * DAY_MILLISECONDS);
    dates.push(date.toISOString().slice(0, 10));
    date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
    weeks.add(date.toISOString().slice(0, 10));
  }
  if (weeks.size > STAFFING_PREPARATION_LIMITS.weeks) throw failure('staffing_week_limit');
  return Object.freeze({ dates: Object.freeze(dates), weeks: Object.freeze([...weeks]) });
}

export function createStaffingPreparationMeter({ now = () => performance.now() } = {}) {
  let last = -1;
  let terminalError = null;
  let rows = 0;
  let canonicalBytes = 0;
  const reject = code => {
    terminalError ||= failure(code);
    throw terminalError;
  };
  const clock = () => {
    if (terminalError) throw terminalError;
    const value = now();
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value < last) {
      reject('staffing_monotonic_clock_required');
    }
    last = value;
    return value;
  };
  const started = clock();
  const snapshot = () => {
    const elapsed = clock() - started;
    if (elapsed >= STAFFING_PREPARATION_LIMITS.prepareMilliseconds) reject('staffing_preparation_deadline');
    return Object.freeze({ rows, canonicalBytes,
      remainingMilliseconds: STAFFING_PREPARATION_LIMITS.prepareMilliseconds - elapsed });
  };
  return Object.freeze({
    snapshot,
    checkpoint: snapshot,
    accountCanonicalRows(canonicalRows) {
      snapshot();
      if (!Array.isArray(canonicalRows)) reject('staffing_canonical_rows_required');
      if (rows + canonicalRows.length > STAFFING_PREPARATION_LIMITS.candidateRows) reject('staffing_candidate_row_limit');
      let addedBytes = 0;
      for (const row of canonicalRows) {
        // These are complete canonical staged-row strings produced by the
        // trusted serializer, including metadata. This counts actual UTF-8;
        // it is NOT a replacement for JSON/semantic/digest validation.
        if (typeof row !== 'string' || row.length === 0) reject('staffing_canonical_rows_required');
        addedBytes += Buffer.byteLength(row, 'utf8');
        if (canonicalBytes + addedBytes > STAFFING_PREPARATION_LIMITS.canonicalBytes) reject('staffing_candidate_byte_limit');
      }
      snapshot();
      // Account each batch all-or-none. Any failure permanently poisons this
      // meter, so a caller cannot catch an oversize error and accept a prefix.
      rows += canonicalRows.length;
      canonicalBytes += addedBytes;
      return snapshot();
    },
  });
}

// Checkpoints do not preempt an uncooperative compiler or a blocked event loop.
// The owning async adapter must pass remainingMilliseconds to the existing
// isolated compiler's deadline/cancellation mechanism and clean up that worker.
