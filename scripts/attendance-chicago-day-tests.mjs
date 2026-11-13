import assert from 'node:assert/strict';
import {isCurrentAttendanceTimestamp, normalizeAttendanceRecord} from '../src/attendance-state.js';

let checks = 0;
const cases = [
  ['fall midnight', '2026-11-01T04:55:00Z', '2026-11-01T05:05:00Z', false],
  ['winter midnight', '2026-12-01T05:55:00Z', '2026-12-01T06:05:00Z', false],
  ['same summer day', '2026-10-31T15:55:00Z', '2026-10-31T16:05:00Z', true],
  ['UTC midnight is not local midnight', '2026-10-31T23:55:00Z', '2026-11-01T00:05:00Z', true],
  ['fall fold remains same date', '2026-11-01T06:55:00Z', '2026-11-01T07:05:00Z', true],
  ['spring gap remains same date', '2026-03-08T07:55:00Z', '2026-03-08T08:05:00Z', true],
  ['next-day timestamp within skew', '2026-11-01T05:00:20Z', '2026-11-01T04:59:40Z', false],
  ['same-day future skew', '2026-10-31T16:00:20Z', '2026-10-31T15:59:40Z', true],
  ['old same-day timestamp', '2026-10-31T14:55:00Z', '2026-10-31T16:05:00Z', false],
];
for (const [name, fetched_at, now, current] of cases) {
  const nowMs = Date.parse(now);
  assert.equal(isCurrentAttendanceTimestamp(fetched_at, nowMs), current, name); checks++;
  const result = normalizeAttendanceRecord({attendance:0, fetched_at, updated_at:now}, {nowMs});
  assert.equal(result.stale, !current, `${name}: normalized`); checks++;
  assert.equal(result.attendance, 0, `${name}: real zero retained`); checks++;
  assert.equal(result.source_timestamp, new Date(fetched_at).toISOString(), `${name}: original source retained`); checks++;
}
const exact = '2026-11-01T04:55:00.123456Z';
const old = normalizeAttendanceRecord({attendance:123, fetched_at:exact}, {nowMs:Date.parse('2026-11-01T05:05:00Z')});
assert.equal(old.source_timestamp, exact); checks++;
assert.match(old.warning, /Chicago|service day|calendar day/i); checks++;
assert.equal(isCurrentAttendanceTimestamp('invalid', Date.now()), false); checks++;
assert.equal(isCurrentAttendanceTimestamp(exact, NaN), false); checks++;
console.log(JSON.stringify({passed:checks, scope:'pure actual attendance normalizer/currentness; no external I/O'}));
