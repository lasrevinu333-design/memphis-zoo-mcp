#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  HUMAN_CONFIRMATION_REQUIREMENT,
  MANAGER_INSPECTION_QUERY,
  evaluateManagerInspectionReadiness,
} from "./manager-inspection-readiness.mjs";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const workflow = readFileSync(
  resolve(root, ".github/workflows/manager-inspection-readiness-monitor.yml"),
  "utf8",
);

const nowMs = Date.parse("2026-07-31T00:30:00.000Z");
const notBefore = "2026-07-30T23:45:00.000Z";
const ready = {
  id: "10000000-0000-4000-8000-000000000001",
  operation_id: "10000000-0000-4000-8000-000000000002",
  inspector_manager_id: "10000000-0000-4000-8000-000000000003",
  inspector_name_snapshot: "Alex Rivera",
  current_manager_name: "Alex Rivera",
  manager_active: true,
  manager_revoked_at: null,
  is_system_principal: false,
  inspection_type: "manager_spot_check",
  overall_score: 93,
  passed: true,
  follow_up_required: false,
  session_id: "10000000-0000-4000-8000-000000000004",
  session_status: "closed",
  location_id: "10000000-0000-4000-8000-000000000005",
  current_session_location_id: "10000000-0000-4000-8000-000000000005",
  employee_id: "10000000-0000-4000-8000-000000000006",
  current_session_employee_id: "10000000-0000-4000-8000-000000000006",
  session_ended_at: "2026-07-31T00:00:00.000Z",
  inspected_at: "2026-07-31T00:10:00.000Z",
  created_at: "2026-07-31T00:10:01.000Z",
};

const passing = evaluateManagerInspectionReadiness([ready], { notBefore, nowMs });
assert.equal(passing.ok, true);
assert.equal(passing.eligible_inspection_count, 1);
assert.equal(passing.accepted_inspection.inspection_id, ready.id);
assert.match(passing.human_confirmation_required, /physically performed/i);

const empty = evaluateManagerInspectionReadiness([], { notBefore, nowMs });
assert.equal(empty.ok, false);
assert.equal(empty.candidate_count, 0);

for (const invalid of [
  { inspector_manager_id: null },
  { inspector_name_snapshot: "Custodial Manager" },
  { inspector_name_snapshot: "Test Custodial Manager" },
  { manager_active: false },
  { manager_revoked_at: "2026-07-30T23:00:00.000Z" },
  { is_system_principal: true },
  { session_status: "active" },
  { current_session_location_id: "20000000-0000-4000-8000-000000000005" },
  { current_session_employee_id: "20000000-0000-4000-8000-000000000006" },
  { inspected_at: "2026-07-30T23:40:00.000Z" },
  { created_at: "2026-07-30T23:40:00.000Z" },
  { inspected_at: "2026-07-30T23:59:00.000Z" },
  { inspected_at: "2026-07-31T00:40:00.000Z" },
]) {
  const result = evaluateManagerInspectionReadiness([{ ...ready, ...invalid }], { notBefore, nowMs });
  assert.equal(result.ok, false, `invalid candidate unexpectedly passed: ${JSON.stringify(invalid)}`);
  assert.ok(result.candidates[0].gaps.length > 0);
}

assert.match(MANAGER_INSPECTION_QUERY, /from public\.cleaning_inspections/i);
assert.match(MANAGER_INSPECTION_QUERY, /left join public\.sessions/i);
assert.match(MANAGER_INSPECTION_QUERY, /left join public\.ops_manager_managers/i);
assert.doesNotMatch(MANAGER_INSPECTION_QUERY, /\binsert\b|\bupdate\b|\bdelete\b/i);
assert.match(HUMAN_CONFIRMATION_REQUIREMENT, /automation cannot independently prove/i);
assert.doesNotMatch(
  workflow,
  /continue-on-error/,
  "monitor infrastructure and query failures must fail the workflow",
);
assert.match(workflow, /MANAGER_INSPECTION_ENFORCE:/);

assert.throws(() => evaluateManagerInspectionReadiness([], { notBefore: "bad", nowMs }), /valid timestamp/i);

console.log("MANAGER_INSPECTION_READINESS_TESTS_PASS");
