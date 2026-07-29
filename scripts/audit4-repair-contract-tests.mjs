#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  attendanceSourceTimestamp,
  normalizeAttendanceRecord,
  toNullableNonNegativeInteger,
} from "../src/attendance-state.js";
import { chicagoDateStartIso, normalizeInspectionPayload } from "../src/operational-analytics-api.js";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const migration = read("supabase/migrations/20260729215914_audit4_attendance_inspection_integrity.sql");
const indexSource = read("src/index.js");
const analyticsSource = read("src/operational-analytics-api.js");

assert.equal(toNullableNonNegativeInteger(0), 0);
assert.equal(toNullableNonNegativeInteger("1087"), 1087);
for (const invalid of [-1, "-1", "12 guests", "1.5", Number.MAX_SAFE_INTEGER + 1]) {
  assert.equal(toNullableNonNegativeInteger(invalid), null, `attendance value ${String(invalid)} must be rejected`);
}

const now = Date.parse("2026-07-29T18:00:00.000Z");
const fresh = normalizeAttendanceRecord({ attendance: 1000, fetched_at: "2026-07-29T17:30:00.000Z" }, { nowMs: now, staleAfterMs: 3_600_000 });
assert.equal(fresh.stale, false);
assert.equal(fresh.source_age_minutes, 30);
assert.equal(fresh.source_timestamp, "2026-07-29T17:30:00.000Z");
const stale = normalizeAttendanceRecord({ attendance: 1000, updated_at: "2026-07-29T15:00:00.000Z" }, { nowMs: now, staleAfterMs: 3_600_000 });
assert.equal(stale.stale, true);
assert.match(stale.warning, /older than/i);
assert.equal(attendanceSourceTimestamp({ updated_at: "invalid" }), null);
assert.match(indexSource, /stored && !stored\.stale/, "fresh stored attendance should remain the preferred source");
assert.match(indexSource, /stale_stored_fallback/, "stale stored attendance must be labeled when source refresh fails");

assert.equal(chicagoDateStartIso("2026-01-15"), "2026-01-15T06:00:00.000Z", "winter boundary must use CST");
assert.equal(chicagoDateStartIso("2026-07-15"), "2026-07-15T05:00:00.000Z", "summer boundary must use CDT");
assert.throws(() => chicagoDateStartIso("2026-02-30"), /real calendar date/i);
assert.doesNotMatch(analyticsSource, /T00:00:00-06:00|T23:59:59\.999-06:00/, "analytics must not hard-code CST offsets");
assert.match(analyticsSource, /\.lt\("started_at", chicagoDateStartIso/, "date_to must use an exclusive next-day boundary");

const operationId = "10000000-0000-4000-8000-000000000001";
const sessionId = "20000000-0000-4000-8000-000000000001";
const failed = normalizeInspectionPayload({ session_id: sessionId, overall_score: 70, follow_up_required: false }, {}, operationId);
assert.equal(failed.follow_up_required, true, "failed inspections must require follow-up");
const critical = normalizeInspectionPayload({ session_id: sessionId, overall_score: 95, critical_failure: true }, {}, operationId);
assert.equal(critical.follow_up_required, true, "critical failures must require follow-up");

for (const pattern of [
  /current_attendance_state_attendance_nonnegative/i,
  /cleaning_inspections_failed_requires_follow_up/i,
  /Inspection time cannot be before the cleaning session finished/i,
  /Inspection time cannot be in the future/i,
  /create or replace view public\.v_cleaning_inspection_coverage/i,
  /with \(security_invoker=true\)/i,
  /revoke all on table public\.v_cleaning_inspection_coverage from public,anon,authenticated/i,
]) assert.match(migration, pattern);

console.log("AUDIT4_REPAIR_CONTRACT_PASS");
