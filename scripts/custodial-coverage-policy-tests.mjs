#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { COVERALL_STARTS_AT_ABSENCE_NUMBER, partitionCustodialAbsences } from "../src/custodial-coverage-policy.js";

assert.equal(COVERALL_STARTS_AT_ABSENCE_NUMBER, 2);
assert.deepEqual(partitionCustodialAbsences([]), {
  triggered: false, absentCount: 0, orderedAbsentEmployeeIds: [],
  internallyRedistributedEmployeeIds: [], coverAllEmployeeIds: [],
});
assert.deepEqual(partitionCustodialAbsences(["employee-a"]), {
  triggered: false, absentCount: 1, orderedAbsentEmployeeIds: ["employee-a"],
  internallyRedistributedEmployeeIds: ["employee-a"], coverAllEmployeeIds: [],
});
assert.deepEqual(partitionCustodialAbsences(["employee-a", "employee-b"]), {
  triggered: true, absentCount: 2, orderedAbsentEmployeeIds: ["employee-a", "employee-b"],
  internallyRedistributedEmployeeIds: ["employee-a"], coverAllEmployeeIds: ["employee-b"],
});
assert.deepEqual(partitionCustodialAbsences([" employee-a ", "employee-b", "employee-a", "employee-c"]), {
  triggered: true, absentCount: 3, orderedAbsentEmployeeIds: ["employee-a", "employee-b", "employee-c"],
  internallyRedistributedEmployeeIds: ["employee-a"], coverAllEmployeeIds: ["employee-b", "employee-c"],
});

const scheduleApi = readFileSync(new URL("../src/schedule-api.js", import.meta.url), "utf8");
const migration = readFileSync(new URL("../supabase/migrations/20260822222500_correct_coverall_second_absence_policy.sql", import.meta.url), "utf8");
assert.match(scheduleApi, /partitionCustodialAbsences/);
assert.match(scheduleApi, /app_apply_coverall_assignment_policy_v2/);
assert.match(scheduleApi, /coverall_capacity_insufficient/);
assert.match(scheduleApi, /absent_employee_id:[\s\S]*coverall_capacity_employee_id:[\s\S]*assignments:/);
assert.match(scheduleApi, /immutable_coverage_template_owner/);
assert.match(scheduleApi, /segment_number: assignment\.segment_number/);
assert.match(scheduleApi, /from public\.coverage_templates ct[\s\S]*ct\.assigned_employee_id = any/);
const absencePublishRoute = scheduleApi.slice(scheduleApi.indexOf('router.post("/absence-publish"'), scheduleApi.indexOf('router.post("/absence-return"'));
assert.ok(absencePublishRoute.indexOf("buildCoverAllPlan") < absencePublishRoute.indexOf('runRpc("sch_absence_publish"'));
assert.ok(absencePublishRoute.indexOf('runRpc("sch_absence_publish"') < absencePublishRoute.indexOf("applyCoverAllPlan"));
assert.doesNotMatch(scheduleApi.slice(scheduleApi.indexOf("async function buildCoverAllPlan"), scheduleApi.indexOf("async function applyCoverAllPlan")), /firstTwoIds|slice\(2\)|3rd absence|third absence/i);
assert.match(migration, /cardinality\(v_internal_ids\) <> 1/);
assert.match(migration, /cardinality\(v_coverall_absent_ids\) < 1/);
assert.match(migration, /jsonb_array_length\(v_coverage\) <> cardinality\(v_coverall_absent_ids\)/);
assert.match(migration, /v_coverall_capacity_employee_id = any\(v_capacity_employee_ids\)/);
assert.match(migration, /original_employee_id[\s\S]*v_absent_employee_id/);
assert.match(migration, /coverage_templates[\s\S]*ct\.assigned_employee_id=v_absent_employee_id/);
assert.match(migration, /segment_number[\s\S]*v_current_source_type[\s\S]*ilike '%manual%'[\s\S]*ilike '%manager%'[\s\S]*ilike '%override%'/);
assert.match(migration, /revoke all on function public\.app_apply_coverall_assignment_policy_v2\(jsonb\) from public,anon,authenticated/);
assert.match(migration, /grant execute on function public\.app_apply_coverall_assignment_policy_v2\(jsonb\) to service_role/);

console.log("custodial coverage policy tests: PASS");
