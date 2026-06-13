import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();

const baselineDocPath = path.resolve(repoRoot, "docs/scheduler-overhaul/baseline-2026-06-11.md");
const packageJsonPath = path.resolve(repoRoot, "package.json");
const scheduleApiPath = path.resolve(repoRoot, "src/schedule-api.js");
const sch2MigrationPath = "sql/2026-06-11_sch2_preview_scheduler.sql";
const sch2HardeningMigrationPath = "sql/2026-06-12_sch2_api_security_and_zero_guard.sql";
const mandatoryReadOnlySqlFiles = [
  "scripts/sql/check-scheduler-open-owner-contract.sql",
  "scripts/sql/check-scheduler-exception-contract.sql",
  "scripts/sql/check-my-schedule-source-contract.sql",
  "scripts/sql/missing-assignments-report.sql",
  "scripts/sql/check-sch2-hard-constraints.sql",
  "scripts/sql/check-sch2-publish-compatibility.sql",
  "scripts/sql/check-sch2-workload-fairness.sql",
  "scripts/sql/check-sch2-route-span.sql",
  "scripts/sql/check-sch2-lunch-coverage.sql",
  "scripts/sql/check-sch2-restroom-rebalance.sql",
  "scripts/sql/check-sch2-monday-balanced-preview.sql",
];

const mutatingSqlPattern = /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|comment|vacuum|analyze|call|do|execute|merge)\b/i;
const transactionControlPattern = /^\s*(begin|commit|rollback)\s*;/im;

function readRequired(relativePath) {
  const absolutePath = path.resolve(repoRoot, relativePath);
  assert.equal(fs.existsSync(absolutePath), true, `${relativePath} must exist`);
  return fs.readFileSync(absolutePath, "utf8");
}

function stripLeadingSqlComments(sql) {
  let text = String(sql || "").trimStart();
  let changed = true;

  while (changed) {
    changed = false;
    if (text.startsWith("--")) {
      const newlineIndex = text.indexOf("\n");
      text = newlineIndex >= 0 ? text.slice(newlineIndex + 1).trimStart() : "";
      changed = true;
    } else if (text.startsWith("/*")) {
      const closeIndex = text.indexOf("*/");
      assert.notEqual(closeIndex, -1, "SQL block comment must be closed");
      text = text.slice(closeIndex + 2).trimStart();
      changed = true;
    }
  }

  return text;
}

function assertReadOnlySql(relativePath) {
  const sql = readRequired(relativePath);
  const executableStart = stripLeadingSqlComments(sql);
  assert.match(executableStart, /^(select|with)\b/i, `${relativePath} must start with SELECT/WITH after leading comments for the approved read-only SQL layer`);
  assert.doesNotMatch(sql, mutatingSqlPattern, `${relativePath} must not contain mutating SQL keywords`);
  assert.doesNotMatch(sql, transactionControlPattern, `${relativePath} must not contain transaction control`);
  assert.doesNotMatch(sql, /\bfrom\s+public\.migration_log\b/i, `${relativePath} should not depend on migration side effects`);
  assert.match(sql, /violation|report|missing|audit|contract|readiness/i, `${relativePath} must make failure rows self-explanatory`);
  return sql;
}

function extractSqlFunction(sql, functionName) {
  const marker = new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${functionName}\\s*\\(`, "i");
  const match = marker.exec(sql);
  assert.ok(match, `SQL must define public.${functionName}`);
  const start = match.index;
  const endMarker = "$function$;";
  const end = sql.indexOf(endMarker, start);
  assert.notEqual(end, -1, `public.${functionName} must close with ${endMarker}`);
  return sql.slice(start, end + endMarker.length);
}

function assertSch2PreviewUsesDynamicSolutionLoadOnly(sql, label) {
  const previewFunction = extractSqlFunction(sql, "sch2_generate_preview");
  assert.doesNotMatch(
    previewFunction,
    /load_summary\s+as\s*\([\s\S]*?public\.daily_schedule_assignments/i,
    `${label} must not seed candidate workload from stale published daily_schedule_assignments`
  );
  assert.match(
    previewFunction,
    /current_solution_load\s+as\s*\([\s\S]*?public\.schedule_solution_assignments/i,
    `${label} must compute candidate workload from assignments already placed in the in-progress SCH2 preview solution`
  );
  assert.match(
    previewFunction,
    /score_breakdown[\s\S]*'current_solution_load'[\s\S]*v_final_current_solution_load/i,
    `${label} must persist dynamic preview-load evidence in each solution assignment score_breakdown`
  );
  assert.match(
    previewFunction,
    /row_number\(\)\s+over\s*\([\s\S]*?order\s+by[\s\S]*?route_fit_score\s*\*\s*0\.75[\s\S]*?dynamic_workload_score\s*\*\s*0\.25[\s\S]*?target_load_gap_after[\s\S]*?current_required_location_count[\s\S]*?current_solution_load[\s\S]*?case\s+when\s+cb\.employee_id\s*=\s*v_item\.original_assigned_employee_id\s+then\s+0\s+else\s+1\s+end/i,
    `${label} must rank by balanced fairness first and use original/static owner only after dynamic workload tie-breaks`
  );
  assert.doesNotMatch(
    previewFunction,
    /order\s+by[\s\S]{0,600}?original_assigned_employee_id[\s\S]{0,600}?balanced_total_score/i,
    `${label} must not order by original/static owner before the balanced 75/25 score`
  );
}

assert.equal(fs.existsSync(baselineDocPath), true, "scheduler overhaul baseline doc must exist before DB writes");
const baselineDoc = fs.readFileSync(baselineDocPath, "utf8");
assert.match(baselineDoc, /preview-first/i, "baseline doc must state preview-first behavior");
assert.match(baselineDoc, /No production scheduler writes/i, "baseline doc must state no production scheduler writes in this phase");
assert.match(baselineDoc, /rollback/i, "baseline doc must capture rollback posture");
assert.match(baselineDoc, /read-only DB gate/i, "baseline doc must document the read-only DB gate");

const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
assert.equal(
  packageJson.scripts?.["test:scheduler-overhaul"],
  "node scripts/scheduler-overhaul-contract-tests.mjs",
  "package.json must expose npm run test:scheduler-overhaul"
);

for (const relativePath of mandatoryReadOnlySqlFiles) {
  assertReadOnlySql(relativePath);
}

const sch2SqlExpectations = new Map([
  ["scripts/sql/check-sch2-hard-constraints.sql", [/schedule_generation_runs/i, /schedule_work_items/i, /schedule_candidate_scores/i, /schedule_solution_assignments/i, /sch2_build_work_items/i, /sch2_generate_preview/i]],
  ["scripts/sql/check-sch2-publish-compatibility.sql", [/schedule_publish_audit/i, /sch2_publish_solution/i, /sch2_rollback_publish/i, /v_sch2_publish_diff/i, /daily_schedule_assignments/i]],
  ["scripts/sql/check-sch2-workload-fairness.sql", [/v_sch2_workload_audit/i, /load_points/i, /hard_violation_count/i, /recent_runs/i, /target_required_location_count/i, /location_count_spread/i]],
  ["scripts/sql/check-sch2-route-span.sql", [/v_sch2_route_audit/i, /route_zone/i, /route_spread/i]],
  ["scripts/sql/check-sch2-lunch-coverage.sql", [/lunch/i, /same_lunch/i, /overlap/i]],
  ["scripts/sql/check-sch2-restroom-rebalance.sql", [/09:45|0945|restroom/i, /Michael|EMP002/i, /lunch_coverage/i]],
  ["scripts/sql/check-sch2-monday-balanced-preview.sql", [/Markiesha\s+Warren/i, /TRADING_POST|GIFT_SHOP/i, /location_count_spread/i, /target_required_location_count/i, /v_sch2_workload_audit/i, /lower\(trim\([^)]*employee_name[^)]*\)\)\s*=\s*'markiesha warren'/i]],
]);

for (const [relativePath, patterns] of sch2SqlExpectations.entries()) {
  const sql = readRequired(relativePath);
  for (const pattern of patterns) {
    assert.match(sql, pattern, `${relativePath} must include ${pattern}`);
  }
}

const openOwnerContractSql = readRequired("scripts/sql/check-scheduler-open-owner-contract.sql");
const mondayBalancedPreviewSql = readRequired("scripts/sql/check-sch2-monday-balanced-preview.sql");
assert.match(mondayBalancedPreviewSql, /lower\(trim\([^)]*employee_name[^)]*\)\)\s*=\s*'markiesha warren'/i, "Monday balanced-preview guard must match Markiesha Warren by normalized exact name");
assert.doesNotMatch(mondayBalancedPreviewSql, /ilike\s+'Mark%i(?:e)?sha Warren'/i, "Monday balanced-preview guard must not use fragile wildcard Markiesha patterns");
assert.match(mondayBalancedPreviewSql, /markiesha_only_gift_shop/i, "Monday balanced-preview guard must flag Markiesha when she only has reminder/gift-shop work");
assert.match(mondayBalancedPreviewSql, /markiesha_under_target_required_locations/i, "Monday balanced-preview guard must flag Markiesha below required-location target");
assert.match(openOwnerContractSql, /public\.daily_schedule_assignments/i, "open-owner gate must inspect published daily assignments");
assert.match(openOwnerContractSql, /PRIMATE_CANYON.*CAT_COUNTRY|CAT_COUNTRY.*PRIMATE_CANYON/s, "open-owner gate must exempt response-only groups");
assert.match(openOwnerContractSql, /GIFT_SHOP/i, "open-owner gate must preserve Monday gift-shop reminder exception");

const exceptionContractSql = readRequired("scripts/sql/check-scheduler-exception-contract.sql");
assert.match(exceptionContractSql, /HERPETARIUM/i, "exception gate must check Herpetarium Wednesday rule");
assert.match(exceptionContractSql, /response_only_group_has_normal_work/i, "exception gate must catch response-only groups turned into normal work");
assert.match(exceptionContractSql, /gift_shop_not_monday_0800_reminder/i, "exception gate must catch gift shop reminder drift");

const sch2MigrationSql = readRequired(sch2MigrationPath);
for (const pattern of [
  /create\s+table\s+if\s+not\s+exists\s+public\.schedule_generation_runs/i,
  /create\s+table\s+if\s+not\s+exists\s+public\.schedule_work_items/i,
  /create\s+table\s+if\s+not\s+exists\s+public\.schedule_candidate_scores/i,
  /create\s+table\s+if\s+not\s+exists\s+public\.schedule_solution_assignments/i,
  /create\s+table\s+if\s+not\s+exists\s+public\.schedule_manual_locks/i,
  /create\s+table\s+if\s+not\s+exists\s+public\.schedule_publish_audit/i,
  /create\s+or\s+replace\s+view\s+public\.v_sch2_constraint_violations/i,
  /create\s+or\s+replace\s+view\s+public\.v_sch2_workload_audit/i,
  /create\s+or\s+replace\s+view\s+public\.v_sch2_route_audit/i,
  /create\s+or\s+replace\s+view\s+public\.v_sch2_publish_diff/i,
  /create\s+or\s+replace\s+function\s+public\.sch2_generate_preview\s*\(\s*p_service_date\s+date,\s*p_force\s+boolean/i,
  /create\s+or\s+replace\s+function\s+public\.sch2_publish_solution\s*\(\s*p_run_id\s+uuid,\s*p_confirm\s+boolean/i,
  /create\s+or\s+replace\s+function\s+public\.sch2_rollback_publish\s*\(\s*p_publish_audit_id\s+uuid/i,
]) {
  assert.match(sch2MigrationSql, pattern, `${sch2MigrationPath} must include ${pattern}`);
}
assert.doesNotMatch(sch2MigrationSql, /drop\s+table\s+public\.daily_schedule_assignments/i, "SCH2 migration must not drop live schedule table");
assert.doesNotMatch(sch2MigrationSql, /truncate\s+public\.daily_schedule_assignments/i, "SCH2 migration must not truncate live schedule table");
assert.match(sch2MigrationSql, /advisory|pg_advisory/i, "SCH2 publish must use an advisory lock to avoid legacy writer races");
assert.match(sch2MigrationSql, /previous_rows/i, "SCH2 publish must preserve previous rows for rollback");
assert.match(sch2MigrationSql, /input_hash/i, "SCH2 preview must record an input hash for staleness detection");
assert.match(
  sch2MigrationSql,
  /idx_coverage_templates_employee_day_purpose_active/i,
  "SCH2 migration must add the candidate route-scoring coverage-template index"
);
assert.match(
  sch2MigrationSql,
  /base\s+as\s+materialized/i,
  "SCH2 candidate scoring must materialize expensive base helper-function results"
);
assert.match(
  sch2MigrationSql,
  /scored\s+as\s+materialized/i,
  "SCH2 candidate scoring must materialize derived score rows before insert"
);
assert.match(
  sch2MigrationSql,
  /sch_group_adjusted_load_points\s*\(\s*ct\.location_group_id\s*\)/i,
  "SCH2 migration must call the live one-argument sch_group_adjusted_load_points(uuid) signature"
);
assert.doesNotMatch(
  sch2MigrationSql,
  /sch_group_adjusted_load_points\s*\(\s*ct\.location_group_id\s*,/i,
  "SCH2 migration must not call non-existent sch_group_adjusted_load_points(uuid, text)"
);
assert.match(
  sch2MigrationSql,
  /target_required_load/i,
  "SCH2 selector must compute a per-day target_required_load from required work and active regular employees"
);
assert.match(
  sch2MigrationSql,
  /current_solution_load/i,
  "SCH2 selector must rank candidates against load already assigned in the preview solution, not only stale template load"
);
assert.match(
  sch2MigrationSql,
  /balanced_total_score/i,
  "SCH2 selector must compute a dynamic 75/25 route/workload balanced score from current preview load before original-owner tie-breaks"
);
assert.match(
  sch2MigrationSql,
  /route_fit_score\s*\*\s*0\.75[\s\S]*dynamic_workload_score\s*\*\s*0\.25/i,
  "SCH2 selector must preserve the 75% route/proximity + 25% workload balancing rule"
);
assert.doesNotMatch(
  sch2MigrationSql,
  /case\s+when\s+c\.employee_id\s*=\s*wi\.original_assigned_employee_id\s+then\s+1\s+else\s+0\s+end\s+desc\s*,\s*c\.total_score\s+desc/i,
  "SCH2 selector must not keep the original owner ahead of workload fairness; static owners are tie-breakers only"
);
assert.match(
  sch2MigrationSql,
  /required_location_count/i,
  "SCH2 workload audit must count distinct required locations per employee, not duplicated segments only"
);
assert.match(
  sch2MigrationSql,
  /location_count_spread/i,
  "SCH2 workload audit must expose location_count_spread so uneven location distribution is visible"
);
assertSch2PreviewUsesDynamicSolutionLoadOnly(
  sch2MigrationSql,
  "SCH2 base migration preview function"
);

const sch2HardeningSql = readRequired(sch2HardeningMigrationPath);
for (const pattern of [
  /security\s+definer/i,
  /set\s+search_path\s*=\s*public\s*,\s*pg_temp/i,
  /zero\s+work\s+items/i,
  /work_item_count/i,
  /solution_assignment_count/i,
  /current_setting\s*\(\s*['"]request\.jwt\.claim\.role['"]/i,
  /service_role\s+backend\s+execution/i,
  /revoke\s+execute\s+on\s+function\s+public\.sch2_build_work_items/i,
  /revoke\s+execute\s+on\s+function\s+public\.sch2_publish_solution/i,
  /grant\s+execute\s+on\s+function\s+public\.sch2_publish_solution\(uuid,\s*boolean\)\s+to\s+service_role/i,
]) {
  assert.match(sch2HardeningSql, pattern, `${sch2HardeningMigrationPath} must include ${pattern}`);
}
assert.doesNotMatch(sch2HardeningSql, /drop\s+table\s+public\.daily_schedule_assignments/i, "SCH2 hardening migration must not drop live schedule table");
assert.doesNotMatch(sch2HardeningSql, /truncate\s+public\.daily_schedule_assignments/i, "SCH2 hardening migration must not truncate live schedule table");
assert.match(
  sch2HardeningSql,
  /target_required_load/i,
  "Final effective SCH2 preview function must preserve fairness-first target_required_load after API hardening overrides"
);
assert.match(
  sch2HardeningSql,
  /current_solution_load/i,
  "Final effective SCH2 preview function must rank against the preview solution's live assigned load, not stale template load"
);
assert.match(
  sch2HardeningSql,
  /balanced_total_score/i,
  "Final effective SCH2 preview function must compute a dynamic 75/25 route/workload balanced score before original-owner tie-breaks"
);
assert.match(
  sch2HardeningSql,
  /route_fit_score\s*\*\s*0\.75[\s\S]*dynamic_workload_score\s*\*\s*0\.25/i,
  "Final effective SCH2 preview function must preserve the 75% route/proximity + 25% workload balancing rule"
);
assert.doesNotMatch(
  sch2HardeningSql,
  /case\s+when\s+c\.employee_id\s*=\s*wi\.original_assigned_employee_id\s+then\s+1\s+else\s+0\s+end\s+desc\s*,\s*c\.total_score\s+desc/i,
  "Final effective SCH2 preview function must not restore original-owner-first ranking after API hardening"
);

const scheduleApiSource = fs.readFileSync(scheduleApiPath, "utf8");
assert.match(
  scheduleApiSource,
  /function\s+requireUuid[\s\S]*\[89ab\]\[0-9a-f\]\{3\}-\[0-9a-f\]\{12\}/i,
  "requireUuid must validate RFC-style UUIDs with the variant-group hyphen before the final 12 hex chars"
);
assert.match(scheduleApiSource, /router\.post\(\s*["']\/sch2\/preview["']\s*,\s*requireSchedulePin/s, "SCH2 preview route must be protected");
assert.match(scheduleApiSource, /router\.post\(\s*["']\/sch2\/publish["']\s*,\s*requireSchedulePin/s, "SCH2 publish route must be protected");
assert.match(scheduleApiSource, /router\.post\(\s*["']\/sch2\/rollback["']\s*,\s*requireSchedulePin/s, "SCH2 rollback route must be protected");
assert.match(scheduleApiSource, /sch2_generate_preview/i, "SCH2 preview route must call sch2_generate_preview");
assert.match(scheduleApiSource, /sch2_audit_solution/i, "SCH2 preview route must return sch2_audit_solution output");
assert.match(scheduleApiSource, /sch2_compare_current_vs_preview/i, "SCH2 preview route must return current-vs-preview diff");
assert.match(scheduleApiSource, /sch2_publish_solution/i, "SCH2 publish route must call sch2_publish_solution");
assert.match(scheduleApiSource, /sch2_rollback_publish/i, "SCH2 rollback route must call sch2_rollback_publish");

console.log("scheduler overhaul contract artifacts passed static safety checks");
