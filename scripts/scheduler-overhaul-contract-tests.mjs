import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();

const baselineDocPath = path.resolve(repoRoot, "docs/scheduler-overhaul/baseline-2026-06-11.md");
const packageJsonPath = path.resolve(repoRoot, "package.json");
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
  ["scripts/sql/check-sch2-workload-fairness.sql", [/v_sch2_workload_audit/i, /load_points/i, /hard_violation_count/i]],
  ["scripts/sql/check-sch2-route-span.sql", [/v_sch2_route_audit/i, /route_zone/i, /route_spread/i]],
  ["scripts/sql/check-sch2-lunch-coverage.sql", [/lunch/i, /same_lunch/i, /overlap/i]],
  ["scripts/sql/check-sch2-restroom-rebalance.sql", [/09:45|0945|restroom/i, /Michael|EMP002/i, /lunch_coverage/i]],
]);

for (const [relativePath, patterns] of sch2SqlExpectations.entries()) {
  const sql = readRequired(relativePath);
  for (const pattern of patterns) {
    assert.match(sql, pattern, `${relativePath} must include ${pattern}`);
  }
}

const openOwnerContractSql = readRequired("scripts/sql/check-scheduler-open-owner-contract.sql");
assert.match(openOwnerContractSql, /public\.daily_schedule_assignments/i, "open-owner gate must inspect published daily assignments");
assert.match(openOwnerContractSql, /PRIMATE_CANYON.*CAT_COUNTRY|CAT_COUNTRY.*PRIMATE_CANYON/s, "open-owner gate must exempt response-only groups");
assert.match(openOwnerContractSql, /GIFT_SHOP/i, "open-owner gate must preserve Monday gift-shop reminder exception");

const exceptionContractSql = readRequired("scripts/sql/check-scheduler-exception-contract.sql");
assert.match(exceptionContractSql, /HERPETARIUM/i, "exception gate must check Herpetarium Wednesday rule");
assert.match(exceptionContractSql, /response_only_group_has_normal_work/i, "exception gate must catch response-only groups turned into normal work");
assert.match(exceptionContractSql, /gift_shop_not_monday_0800_reminder/i, "exception gate must catch gift shop reminder drift");

console.log("scheduler overhaul contract artifacts passed static safety checks");
