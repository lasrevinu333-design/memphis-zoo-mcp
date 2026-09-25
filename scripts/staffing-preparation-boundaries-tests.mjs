import assert from 'node:assert/strict';
import {
  STAFFING_PREPARATION_LIMITS,
  enumerateStaffingServiceWindow,
  createStaffingPreparationMeter,
} from '../src/static-weekly-staffing-preparation.js';

let checks = 0;
const equal = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const rejects = (fn, code) => { assert.throws(fn, error => error.code === code); checks++; };
const window = enumerateStaffingServiceWindow('2026-09-24', '2026-10-05');
equal(window.dates.length, 12);
equal(window.weeks, ['2026-09-21', '2026-09-28', '2026-10-05']);
equal(window.dates[0], '2026-09-24');
equal(window.dates.at(-1), '2026-10-05');
equal(Object.isFrozen(window) && Object.isFrozen(window.dates) && Object.isFrozen(window.weeks), true);
equal(enumerateStaffingServiceWindow('2026-03-07', '2026-03-10').dates,
  ['2026-03-07', '2026-03-08', '2026-03-09', '2026-03-10']);
equal(enumerateStaffingServiceWindow('2026-10-31', '2026-11-02').dates,
  ['2026-10-31', '2026-11-01', '2026-11-02']);
equal(enumerateStaffingServiceWindow('2024-02-28', '2024-03-01').dates,
  ['2024-02-28', '2024-02-29', '2024-03-01']);
equal(enumerateStaffingServiceWindow('2012-01-01', '2012-12-31').dates.length, 366);
equal(enumerateStaffingServiceWindow('2012-01-01', '2012-12-31').weeks.length, 54);
equal(enumerateStaffingServiceWindow('0001-01-01', '0001-01-01').weeks, ['0001-01-01']);
equal(enumerateStaffingServiceWindow('9999-12-31', '9999-12-31').dates, ['9999-12-31']);
for (const bad of [undefined, null, '', 20260924, true, ['2026-09-24'], new Date(),
  ' 2026-09-24', '2026-09-24 ', '2026-9-24', '2026-02-29', '2024-02-30',
  '2026-04-31', '0000-01-01', '10000-01-01', '2026-09-24T00:00:00Z']) {
  rejects(() => enumerateStaffingServiceWindow(bad, '2026-09-24'), 'staffing_invalid_service_date');
  rejects(() => enumerateStaffingServiceWindow('2026-09-24', bad), 'staffing_invalid_service_date');
}
rejects(() => enumerateStaffingServiceWindow('2026-09-25', '2026-09-24'), 'staffing_reversed_window');
rejects(() => enumerateStaffingServiceWindow('2012-01-01', '2013-01-01'), 'staffing_date_limit');
rejects(() => enumerateStaffingServiceWindow('0001-01-01', '9999-12-31'), 'staffing_date_limit');

let instant = 20;
const meter = createStaffingPreparationMeter({ now: () => instant });
equal(meter.snapshot(), { rows: 0, canonicalBytes: 0, remainingMilliseconds: 30_000 });
equal(meter.accountCanonicalRows(['{"a":"é"}', '{}']),
  { rows: 2, canonicalBytes: Buffer.byteLength('{"a":"é"}', 'utf8') + 2, remainingMilliseconds: 30_000 });
instant = 30_019;
equal(meter.checkpoint().remainingMilliseconds, 1);
instant = 30_020;
rejects(() => meter.checkpoint(), 'staffing_preparation_deadline');
instant = 20;
rejects(() => meter.checkpoint(), 'staffing_preparation_deadline');

const rowMeter = createStaffingPreparationMeter({ now: () => 0 });
equal(rowMeter.accountCanonicalRows(Array(100_000).fill('0')).rows, 100_000);
rejects(() => rowMeter.accountCanonicalRows(['0']), 'staffing_candidate_row_limit');
rejects(() => rowMeter.accountCanonicalRows([]), 'staffing_candidate_row_limit');
const byteMeter = createStaffingPreparationMeter({ now: () => 0 });
const exact = '"' + 'x'.repeat(STAFFING_PREPARATION_LIMITS.canonicalBytes - 2) + '"';
equal(byteMeter.accountCanonicalRows([exact]).canonicalBytes, 16 * 1024 * 1024);
rejects(() => byteMeter.accountCanonicalRows(['0']), 'staffing_candidate_byte_limit');
const unicodeMeter = createStaffingPreparationMeter({ now: () => 0 });
rejects(() => unicodeMeter.accountCanonicalRows(['"' + 'é'.repeat(8 * 1024 * 1024) + '"']), 'staffing_candidate_byte_limit');
for (const bad of [null, undefined, '[]', {}, [null], [1], ['']]) {
  const invalidMeter = createStaffingPreparationMeter({ now: () => 0 });
  rejects(() => invalidMeter.accountCanonicalRows(bad), 'staffing_canonical_rows_required');
  rejects(() => invalidMeter.checkpoint(), 'staffing_canonical_rows_required');
}
let backwards = 4;
const backwardsMeter = createStaffingPreparationMeter({ now: () => backwards });
backwards = 3;
rejects(() => backwardsMeter.checkpoint(), 'staffing_monotonic_clock_required');
for (const bad of [NaN, Infinity, -1, '1']) {
  rejects(() => createStaffingPreparationMeter({ now: () => bad }), 'staffing_monotonic_clock_required');
}
let accountClock = 0;
const expiringMeter = createStaffingPreparationMeter({ now: () => accountClock++ ? 30_000 : 0 });
rejects(() => expiringMeter.accountCanonicalRows(['0']), 'staffing_preparation_deadline');
equal(STAFFING_PREPARATION_LIMITS, { dates: 366, weeks: 54, candidateRows: 100_000,
  canonicalBytes: 16 * 1024 * 1024, prepareMilliseconds: 30_000 });
console.log(JSON.stringify({ status: 'PASS', checks,
  scope: 'pure service-date/resource boundaries; no SQL, command acceptance, worker cancellation, publication or phone proof' }));
