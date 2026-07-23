#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeInspectionPayload, stableFingerprint } from "../src/operational-analytics-api.js";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const migration = read("supabase/migrations/20260722233500_operational_retention_and_analytics.sql");
const api = read("src/operational-analytics-api.js");
const bootstrap = read("src/mcp-schema-bootstrap.js");

assert.match(migration, /retention_event_days','14'::jsonb/i, "event retention must be exactly 14 days");
assert.match(migration, /events_app_delete_retention_guard/i, "legacy broad event deletes need a database retention guard");
assert.match(migration, /on delete cascade/i, "event history and notification children must leave with an expired event");
assert.match(migration, /events_app_purge_expired/i, "expired events need an explicit batch purge function");
assert.match(migration, /mz-events-expired-retention-hourly/i, "expired event purge must be scheduled independently of legacy retention");
assert.match(migration, /Only messages or conversations explicitly deleted by a user/i, "message retention description must not imply active messages are age-purged");
assert.match(migration, /retention_operational_history_mode/i, "cleaning and issue history must be marked as durable");
assert.match(migration, /create table if not exists public\.cleaning_inspections/i, "quality inspections must be durable facts");
assert.match(migration, /v_cleaning_performance_comparison/i, "employee/location comparison view is required");
assert.match(migration, /v_maintenance_ticket_trends/i, "ticket recurrence view is required");
assert.doesNotMatch(migration, /delete from public\.sessions/i, "routine retention must never delete cleaning sessions");
assert.doesNotMatch(migration, /delete from public\.maintenance_tickets/i, "routine retention must never delete ticket history");

assert.match(api, /\/analytics-api\/cleaning-performance/, "cleaning comparison endpoint is required");
assert.match(api, /\/analytics-api\/ticket-trends/, "ticket trend endpoint is required");
assert.match(api, /\/analytics-api\/session-facts/, "session fact endpoint is required");
assert.match(api, /\/analytics-api\/inspections/, "inspection read/write endpoints are required");
assert.match(api, /CUSTODIAL_MANAGER/, "personnel analytics must require Custodial Manager authority");
assert.match(api, /Idempotency-Key/, "inspection writes must be idempotent");
assert.match(bootstrap, /installOperationalAnalyticsRoutes/, "analytics routes must be installed before the legacy app starts");

const ordered = stableFingerprint({ alpha: 1, beta: { y: 2, x: 1 } });
const reordered = stableFingerprint({ beta: { x: 1, y: 2 }, alpha: 1 });
assert.equal(ordered, reordered, "request fingerprint must be independent of object key order");
assert.match(ordered, /^[0-9a-f]{64}$/);

const operationId = "10000000-0000-4000-8000-000000000001";
const sessionId = "20000000-0000-4000-8000-000000000001";
const managerId = "30000000-0000-4000-8000-000000000001";
const input = {
  session_id: sessionId,
  overall_score: 94,
  appearance_score: 96,
  sanitation_score: 95,
  supplies_score: 90,
  detail_score: 92,
  safety_score: 98,
  findings: [{ category: "detail", note: "Baseboards clean" }],
  notes: "Strong inspection result.",
};
const auth = {
  manager_id: managerId,
  manager_display_name: "Test Custodial Manager",
};
const payload = normalizeInspectionPayload(input, auth, operationId);
const replayPayload = normalizeInspectionPayload(input, auth, operationId);
assert.equal(payload.operation_id, operationId);
assert.equal(payload.session_id, sessionId);
assert.equal(payload.inspector_manager_id, managerId);
assert.equal(payload.inspector_name_snapshot, "Test Custodial Manager");
assert.equal(payload.overall_score, 94);
assert.equal(payload.pass_threshold, 85);
assert.equal(payload.critical_failure, false);
assert.equal(payload.inspected_at, undefined, "unspecified inspection time must use the database default rather than a retry-changing client timestamp");
assert.equal(payload.request_fingerprint, replayPayload.request_fingerprint, "identical retries must have the same fingerprint");
assert.match(payload.request_fingerprint, /^[0-9a-f]{64}$/);

assert.throws(() => normalizeInspectionPayload({ session_id: sessionId, overall_score: 101 }, {}, operationId), /between 0 and 100/i);
assert.throws(() => normalizeInspectionPayload({ session_id: "bad", overall_score: 90 }, {}, operationId), /valid session_id/i);
assert.throws(() => normalizeInspectionPayload({ session_id: sessionId, overall_score: 90 }, {}, "bad"), /Idempotency-Key/i);
assert.throws(() => normalizeInspectionPayload({ session_id: sessionId, overall_score: 90, findings_json: "bad" }, {}, operationId), /array or object/i);
assert.throws(() => normalizeInspectionPayload({ session_id: sessionId, overall_score: 90, inspection_type: "whatever" }, {}, operationId), /inspection_type is invalid/i);

console.log("OPERATIONAL_ANALYTICS_SOURCE_CONTRACT_PASS");
