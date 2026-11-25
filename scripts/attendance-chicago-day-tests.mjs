import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
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

const index = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
const scrape = index.slice(index.indexOf('async function fetchCurrentAttendance('), index.indexOf('\nasync function runReadOnlySql('));
for (const [name, source, instant, current] of [
  ['Chicago midnight cache', '2026-11-01T04:59:50Z', '2026-11-01T05:00:10Z', false],
  ['fall fold cache', '2026-11-01T06:59:50Z', '2026-11-01T07:00:10Z', true],
  ['spring gap cache', '2026-03-08T07:59:50Z', '2026-03-08T08:00:10Z', true],
]) {
  let reads = 0;
  const at = Date.parse(instant), captured = Date.parse(source);
  class Clock extends Date { static now() { return at; } }
  const context = {
    Date: Clock, isCurrentAttendanceTimestamp, AbortController, setTimeout, clearTimeout,
    ATTENDANCE_TIMEOUT_MS: 5000, ATTENDANCE_CACHE_MS: 60_000, ATTENDANCE_CF_CLEARANCE:'',
    ATTENDANCE_SOURCE_URL:'https://fixture.invalid',
    attendanceCache: { data: { attendance: 0, fetched_at: new Date(captured).toISOString(), stale:false }, fetched_at_ms: captured },
    async fetch() { reads++; throw new Error('Synthetic source offline'); },
  };
  vm.runInNewContext(scrape+'\nthis.read=fetchCurrentAttendance;', context);
  const answer = await context.read();
  assert.equal(reads, current ? 0 : 1, name);
  assert.equal(answer.stale, !current, name);
  assert.equal(answer.attendance, 0, name);
  assert.equal(answer.fetched_at, new Date(captured).toISOString(), name);
  checks += 4;
}

let now = Date.parse('2026-11-01T04:59:50Z');
const midnight = {
  Date: class extends Date { static now() { return now; } },
  isCurrentAttendanceTimestamp, AbortController, setTimeout, clearTimeout,
  ATTENDANCE_TIMEOUT_MS: 5000, ATTENDANCE_CACHE_MS: 60_000, ATTENDANCE_CF_CLEARANCE:'',
  ATTENDANCE_SOURCE_URL:'https://fixture.invalid', attendanceCache:{data:null,fetched_at_ms:0},
  fetch: async () => {
    now += 20_000;
    return new Response('synthetic attendance');
  },
  parseAttendanceHtml: () => ({attendance:0}),
};
vm.runInNewContext(scrape+'\nthis.read=fetchCurrentAttendance;', midnight);
const across = await midnight.read();
assert.equal(across.stale,true);
assert.equal(across.fetched_at,'2026-11-01T04:59:50.000Z');
assert.equal(midnight.attendanceCache.data,null);
checks += 3;
assert.equal(isCurrentAttendanceTimestamp(exact, NaN), false); checks++;
console.log(JSON.stringify({passed:checks, scope:'pure actual attendance normalizer/currentness; no external I/O'}));
