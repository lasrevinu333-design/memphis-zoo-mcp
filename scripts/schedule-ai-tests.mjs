import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const scheduleApiPath = path.resolve("src/schedule-api.js");
const source = fs.readFileSync(scheduleApiPath, "utf8");
const openOwnerContractSqlPath = path.resolve("scripts/sql/check-scheduler-open-owner-contract.sql");
const exceptionContractSqlPath = path.resolve("scripts/sql/check-scheduler-exception-contract.sql");
const myScheduleSourceContractSqlPath = path.resolve("scripts/sql/check-my-schedule-source-contract.sql");
const dailyMyScheduleMigrationPath = path.resolve("sql/2026-06-09_daily_assignment_my_schedule_page.sql");
const exceptionLunchGuardMigrationPath = path.resolve("sql/2026-06-10_scheduler_exception_lunch_guards.sql");
const responseOnlyStaleLunchRepairPath = path.resolve("sql/2026-06-10_repair_response_only_stale_lunch_rows.sql");
const restoreOpenOwnerRowsPath = path.resolve("sql/2026-06-10_restore_scheduler_open_owner_rows.sql");

function extractFunction(name) {
  const startToken = `function ${name}(`;
  const asyncStartToken = `async function ${name}(`;
  let start = source.indexOf(startToken);
  let asyncPrefix = "";
  if (start < 0) {
    start = source.indexOf(asyncStartToken);
    asyncPrefix = "async ";
  }
  if (start < 0) throw new Error(`Could not find function ${name}`);
  const signatureStart = source.indexOf("(", start);
  let cursor = signatureStart;
  let parenDepth = 0;
  while (cursor < source.length) {
    const char = source[cursor];
    if (char === "(") parenDepth += 1;
    else if (char === ")") {
      parenDepth -= 1;
      if (parenDepth === 0) {
        cursor += 1;
        break;
      }
    }
    cursor += 1;
  }
  const braceStart = source.indexOf("{", cursor);
  let depth = 1;
  let i = braceStart + 1;
  while (i < source.length && depth > 0) {
    const char = source[i];
    if (char === "{") depth += 1;
    else if (char === "}") depth -= 1;
    i += 1;
  }
  return `${asyncPrefix}function ${name}${source.slice(source.indexOf("(", start), i)}`;
}

const needed = [
  "buildDate",
  "normalizeLoose",
  "normalizePossibleDate",
  "timeToMinutes",
  "getMemphisClockParts",
  "isRestroomRebalanceDue",
  "isProtectedRestroomSource",
  "sqlQuote",
  "normalizeIdList",
  "normalizeRestroomRebalanceRow",
  "isRestroomRebalanceRosterEligible",
  "loadSpread",
  "canRosterEmployeeCoverAssignment",
  "canEmployeeReceiveRestroomAssignment",
  "buildRestroomRebalancePlan",
  "buildCoverAllRebalancePlan",
  "normalizeRestroomRebalanceCompletionRow",
  "buildRestroomRebalanceCompletionSelectSql",
  "buildRestroomRebalanceCompletionUpsertSql",
  "summarizeAssignmentDiff",
  "summarizeWeekWindow",
  "buildWeekSummaryText",
  "buildAbsenceSummaryText",
  "matchLocationGroup",
  "summarizeOpenAndOverloadedGroups",
  "buildFallbackSchedulerRecommendations",
];

const context = {
  RESTROOM_REBALANCE_TIME: "09:45:00",
  RESTROOM_REBALANCE_SOURCE: "restroom_rebalance_0945",
  RESTROOM_REBALANCE_TZ: "America/Chicago",
  MONTH_LOOKUP: {
    january: 1, jan: 1,
    february: 2, feb: 2,
    march: 3, mar: 3,
    april: 4, apr: 4,
    may: 5,
    june: 6, jun: 6,
    july: 7, jul: 7,
    august: 8, aug: 8,
    september: 9, sept: 9, sep: 9,
    october: 10, oct: 10,
    november: 11, nov: 11,
    december: 12, dec: 12,
  },
};
vm.createContext(context);
for (const name of needed) {
  vm.runInContext(extractFunction(name), context, { filename: scheduleApiPath });
}

assert.equal(context.normalizePossibleDate("May 14, 2026"), "2026-05-14");
assert.equal(context.normalizePossibleDate("May 14 2026"), "2026-05-14");
assert.equal(context.normalizePossibleDate("14 May 2026"), "2026-05-14");
assert.equal(context.normalizePossibleDate("05/14/2026"), "2026-05-14");

assert.equal(context.timeToMinutes("09:45:00"), 585);
assert.equal(context.isRestroomRebalanceDue(new Date("2026-06-02T14:44:00Z")), false, "9:44am Central is before the rebalance");
assert.equal(context.isRestroomRebalanceDue(new Date("2026-06-02T14:45:00Z")), true, "9:45am Central is due");
assert.equal(context.isRestroomRebalanceRosterEligible({ shift_start: "05:00:00", shift_end: "14:00:00", employee_code: "EMP007" }), true);
assert.equal(context.isRestroomRebalanceRosterEligible({ shift_start: "15:00:00", shift_end: "23:59:59", employee_code: "EMP002" }), false, "afternoon call coverage must not receive normal 9:45 restroom ownership");
assert.equal(context.isRestroomRebalanceRosterEligible({ shift_start: "05:00:00", shift_end: "15:00:00", employee_code: "EMP002", employee_name: "Michael McWright" }), false, "Michael must stay out of normal 9:45 restroom balancing even if a roster row overlaps 9:45");
assert.equal(context.isRestroomRebalanceRosterEligible({ shift_start: "10:00:00", shift_end: "18:00:00", employee_code: "EMP010" }), false, "employees not working at 9:45 are not active rebalance owners");

const staticRestoreSqlStart = source.indexOf("async function restoreStaticOwnersForDate");
const staticRestoreSqlEnd = source.indexOf("function addDaysToIsoDate", staticRestoreSqlStart);
const staticRestoreSql = source.slice(staticRestoreSqlStart, staticRestoreSqlEnd);
assert.match(staticRestoreSql, /coalesce\(dsa\.coverage_purpose, ''\) <> 'lunch_coverage'/, "static owner restore must never overwrite generated lunch coverage rows");
const dwrJoinBlock = (staticRestoreSql.match(/join public\.daily_work_roster dwr[\s\S]*?(?=\n\s+where dsa\.service_date)/) || [""])[0];
assert.match(staticRestoreSql, /where dsa\.service_date = '[^']+'::date\s+and dwr\.shift_start <= dsa\.coverage_start/, "static owner restore must verify the owner is on shift at the row start in WHERE, not JOIN ON");
assert.doesNotMatch(dwrJoinBlock, /on[\s\S]*?dsa\./, "Postgres UPDATE target alias dsa must not be referenced inside FROM JOIN ON clauses");
assert.match(staticRestoreSql, /ct\.coverage_start = dsa\.coverage_start/, "static owner restore must only touch unsplit original template rows");
assert.match(staticRestoreSql, /not\s+public\.sch_is_employee_location_group_restricted\(\s*ct\.assigned_employee_id,\s*ct\.location_group_id,/i, "static owner restore must not restore restricted employee/location pairings such as Kathy east of Tropical Birds");

const restroomAssignmentSqlStart = source.indexOf("async function listRestroomAssignmentsForRebalance");
const restroomAssignmentSqlEnd = source.indexOf("async function rebalanceRestroomAssignments", restroomAssignmentSqlStart);
const restroomAssignmentSql = source.slice(restroomAssignmentSqlStart, restroomAssignmentSqlEnd);
assert.match(restroomAssignmentSql, /restricted_employee_ids/, "restroom rebalance assignment query must expose restricted_employee_ids");
assert.match(restroomAssignmentSql, /sch_is_employee_location_group_restricted/, "restroom rebalance assignment query must use the DB restriction function");
assert.match(restroomAssignmentSql, /dsa\.location_group_id/, "restroom rebalance assignment query must carry location_group_id");
assert.match(restroomAssignmentSql, /coalesce\(dsa\.coverage_purpose, ''\) <> 'lunch_coverage'/, "restroom rebalance assignment query must continue excluding lunch coverage");

const restroomUpdateSqlStart = source.indexOf("async function rebalanceRestroomAssignments");
const restroomUpdateSqlEnd = source.indexOf("async function applyLunchCoverageAfterRestroomRebalance", restroomUpdateSqlStart);
const restroomUpdateSql = source.slice(restroomUpdateSqlStart, restroomUpdateSqlEnd);
assert.match(restroomUpdateSql, /not\s+public\.sch_is_employee_location_group_restricted/i, "restroom rebalance write must have a DB-side restriction guard");
assert.match(restroomUpdateSql, /dsa\.service_date\s*=\s*'\$\{esc\(serviceDate\)\}'::date/, "restroom rebalance write must be scoped to the requested service date");
assert.match(restroomUpdateSql, /dsa\.status\s*=\s*'ASSIGNED'/, "restroom rebalance write must only update currently assigned rows");
assert.match(restroomUpdateSql, /dsa\.owner_type\s*=\s*'EMPLOYEE'/, "restroom rebalance write must only update employee-owned rows");
assert.match(restroomUpdateSql, /dsa\.assigned_employee_id\s*=\s*moved\.from_employee_id/, "restroom rebalance write must not overwrite a row whose owner changed after planning");
assert.match(restroomUpdateSql, /coalesce\(dsa\.coverage_purpose, ''\) <> 'lunch_coverage'/, "restroom rebalance write must not touch lunch rows");
assert.match(restroomUpdateSql, /coalesce\(dsa\.source_type, ''\) not ilike '%manual%'/, "restroom rebalance write must not touch manual source rows");
assert.match(restroomUpdateSql, /coalesce\(dsa\.source_type, ''\) not ilike '%override%'/, "restroom rebalance write must not touch override source rows");
assert.match(restroomUpdateSql, /coalesce\(dsa\.source_type, ''\) not ilike '%manager%'/, "restroom rebalance write must not touch manager source rows");
assert.match(restroomUpdateSql, /r\.shift_start\s*<=\s*dsa\.coverage_start/, "restroom rebalance write must verify receiver shift covers row start");
assert.match(restroomUpdateSql, /r\.shift_end\s*>=\s*dsa\.coverage_end/, "restroom rebalance write must verify receiver shift covers row end");

assert.equal(fs.existsSync(openOwnerContractSqlPath), true, "open-owner SQL contract probe must exist");
const openOwnerContractSql = fs.readFileSync(openOwnerContractSqlPath, "utf8");
assert.match(openOwnerContractSql.trimStart(), /^select\s+\*/i, "open-owner contract must start with SELECT for the Memphis read-only SQL layer");
assert.match(openOwnerContractSql, /daily_schedule_assignments/i, "open-owner contract must inspect daily assignments");
assert.match(openOwnerContractSql, /status\s*=\s*'OPEN'/i, "open-owner contract must catch OPEN rows");
assert.match(openOwnerContractSql, /assigned_employee_id\s+is\s+null/i, "open-owner contract must catch missing owners");
assert.match(openOwnerContractSql, /deep_clean/i, "open-owner contract must cover normal deep-clean work");
assert.match(openOwnerContractSql, /late_coverage/i, "open-owner contract must cover active late coverage rows");

assert.equal(fs.existsSync(exceptionContractSqlPath), true, "exception SQL contract probe must exist");
const exceptionContractSql = fs.readFileSync(exceptionContractSqlPath, "utf8");
assert.match(exceptionContractSql.trimStart(), /^select\s+\*/i, "exception contract must start with SELECT for the Memphis read-only SQL layer");
assert.match(exceptionContractSql, /PRIMATE_CANYON/, "exception contract must cover Primate Canyon response-only rule");
assert.match(exceptionContractSql, /CAT_COUNTRY/, "exception contract must cover Cat Country response-only rule");
assert.match(exceptionContractSql, /GIFT_SHOP/, "exception contract must cover gift shop reminder-only rules");
assert.match(exceptionContractSql, /HERPETARIUM/, "exception contract must cover Herpetarium Wednesday rule");
assert.match(exceptionContractSql, /coalesce\(dsa\.coverage_purpose,\s*'area_owner'\)/i, "exception contract must treat null coverage_purpose as area_owner normal work");

assert.equal(fs.existsSync(exceptionLunchGuardMigrationPath), true, "exception lunch guard migration must exist");
const exceptionLunchGuardMigrationSql = fs.readFileSync(exceptionLunchGuardMigrationPath, "utf8");
assert.match(exceptionLunchGuardMigrationSql, /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.sch_apply_lunch_coverage/i, "exception lunch guard migration must replace sch_apply_lunch_coverage");
assert.match(exceptionLunchGuardMigrationSql, /coverage_purpose,\s*''\)\s+not\s+in\s*\(\s*'lunch_coverage'\s*,\s*'reminder'\s*,\s*'response_only'\s*\)/i, "lunch coverage must exclude lunch, reminder, and response-only rows before splitting");
assert.match(exceptionLunchGuardMigrationSql, /group_code\s+not\s+in\s*\(\s*'PRIMATE_CANYON'\s*,\s*'CAT_COUNTRY'\s*\)/i, "lunch coverage must exclude response-only/no-clean groups before splitting");
assert.match(exceptionLunchGuardMigrationSql, /group_code\s+not\s+like\s+'%GIFT_SHOP%'/i, "lunch coverage must exclude gift shop reminder groups before splitting");
assert.doesNotMatch(exceptionLunchGuardMigrationSql, /^\s*begin\s*;/im, "function migration must not use explicit transaction control inside run_sql_migration");
assert.doesNotMatch(exceptionLunchGuardMigrationSql, /^\s*commit\s*;/im, "function migration must not use explicit transaction control inside run_sql_migration");

assert.equal(fs.existsSync(responseOnlyStaleLunchRepairPath), true, "exact response-only stale lunch repair SQL must exist");
const responseOnlyStaleLunchRepairSql = fs.readFileSync(responseOnlyStaleLunchRepairPath, "utf8");
assert.match(responseOnlyStaleLunchRepairSql, /target\(assignment_id, service_date, group_code, segment_number, coverage_start, coverage_end, coverage_purpose, source_type, keep_row\)/i, "response-only repair must be exact-row targeted");
assert.match(responseOnlyStaleLunchRepairSql, /g\.target_count\s*=\s*12[\s\S]*g\.eligible_count\s*=\s*12[\s\S]*g\.eligible_keeper_count\s*=\s*4[\s\S]*g\.valid_group_count\s*=\s*4/i, "response-only repair must gate updates/deletes on exact expected counts");
assert.match(responseOnlyStaleLunchRepairSql, /normalized_count\s*=\s*4[\s\S]*deleted_count\s*=\s*8[\s\S]*deleted_lunch_count\s*=\s*4/i, "response-only repair must error unless exact update/delete counts match");
assert.match(responseOnlyStaleLunchRepairSql, /coverage_purpose\s*=\s*'response_only'/i, "response-only repair must normalize kept rows to response_only");
assert.doesNotMatch(responseOnlyStaleLunchRepairSql, /'late_coverage'/, "response-only repair must not target late_coverage rows");
assert.match(responseOnlyStaleLunchRepairSql, /dsa\.source_type\s+not\s+ilike\s+'%manual%'[\s\S]*dsa\.source_type\s+not\s+ilike\s+'%manager%'[\s\S]*dsa\.source_type\s+not\s+ilike\s+'%override%'/i, "response-only repair must avoid manual/manager/override rows");

for (const [label, sql] of [
  ["exception lunch guard migration", exceptionLunchGuardMigrationSql],
  ["response-only stale lunch repair", responseOnlyStaleLunchRepairSql],
]) {
  assert.doesNotMatch(sql, /^\s*begin\s*;/im, `${label} must not use explicit BEGIN inside run_sql_migration`);
  assert.doesNotMatch(sql, /^\s*commit\s*;/im, `${label} must not use explicit COMMIT inside run_sql_migration`);
}

assert.equal(fs.existsSync(restoreOpenOwnerRowsPath), true, "open-owner restore SQL must exist");
const restoreOpenOwnerRowsSql = fs.readFileSync(restoreOpenOwnerRowsPath, "utf8");
assert.match(restoreOpenOwnerRowsSql, /exact assignment IDs only/i, "open-owner restore must document exact-ID scope");
assert.match(restoreOpenOwnerRowsSql, /and \(select n from eligible_count\) = 3/i, "open-owner restore update must require exactly 3 eligible targets");
assert.match(restoreOpenOwnerRowsSql, /not public\.sch_is_employee_location_group_restricted/i, "open-owner restore must verify desired owners are not restricted");
assert.match(restoreOpenOwnerRowsSql, /else 1 \/ \(\(select n from updated_count\) - \(select n from updated_count\)\)/i, "open-owner restore must error and roll back if exactly 3 rows are not updated");

assert.equal(fs.existsSync(dailyMyScheduleMigrationPath), true, "daily-assignment-backed My Schedule migration must exist");
const dailyMyScheduleMigrationSql = fs.readFileSync(dailyMyScheduleMigrationPath, "utf8");
assert.match(dailyMyScheduleMigrationSql, /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.sch_employee_my_schedule_page/i, "My Schedule migration must replace sch_employee_my_schedule_page");
assert.match(dailyMyScheduleMigrationSql, /daily_schedule_assignments|sch_get_daily_schedule_with_purpose/i, "My Schedule migration must use daily assignments as source of truth");
assert.doesNotMatch(dailyMyScheduleMigrationSql, /from\s+public\.coverage_templates/i, "My Schedule page must not be template-backed");
assert.match(dailyMyScheduleMigrationSql, /assigned_employee_id\s*=\s*p_employee_id/i, "My Schedule migration must filter daily rows to the requested employee only");
assert.match(dailyMyScheduleMigrationSql, /lunch_coverage/i, "My Schedule migration must include lunch coverage rows");
assert.match(dailyMyScheduleMigrationSql, /late_coverage/i, "My Schedule migration must include Michael afternoon-call late coverage rows");
const myDaySummaryRouteStart = source.indexOf('router.get("/my-day-summary"');
const myDaySummaryRouteEnd = source.indexOf('router.get("/my-schedule"', myDaySummaryRouteStart);
const myDaySummaryRouteSource = source.slice(myDaySummaryRouteStart, myDaySummaryRouteEnd);
assert.match(myDaySummaryRouteSource, /sch_employee_my_schedule_page/, "/my-day-summary must use sch_employee_my_schedule_page as its source");
const myScheduleRouteStart = source.indexOf('router.get("/my-schedule"');
const myScheduleRouteEnd = source.indexOf('router.get("/settings\/close-time"', myScheduleRouteStart);
const myScheduleRouteSource = source.slice(myScheduleRouteStart, myScheduleRouteEnd);
assert.match(myScheduleRouteSource, /sch_employee_my_schedule_page/, "/my-schedule must use sch_employee_my_schedule_page as its source");
assert.equal(fs.existsSync(myScheduleSourceContractSqlPath), true, "My Schedule source-of-truth SQL contract probe must exist");
const myScheduleSourceContractSql = fs.readFileSync(myScheduleSourceContractSqlPath, "utf8");
assert.match(myScheduleSourceContractSql.trimStart(), /^select\s+\*/i, "My Schedule source contract must start with SELECT for the Memphis read-only SQL layer");
assert.match(myScheduleSourceContractSql, /sch_employee_my_schedule_page/i, "My Schedule source contract must exercise sch_employee_my_schedule_page");
assert.match(myScheduleSourceContractSql, /daily_schedule_assignments/i, "My Schedule source contract must compare against daily assignments");
assert.match(myScheduleSourceContractSql, /my_schedule_missing_michael_late_coverage/i, "My Schedule source contract must catch missing Michael late coverage");
assert.match(myScheduleSourceContractSql, /my_schedule_leaked_unowned_morning_item/i, "My Schedule source contract must catch unowned item leakage");

const manualAbsencePublishStart = source.indexOf('router.post("/manual-absences/publish"');
const manualAbsencePublishEnd = source.indexOf('router.post("/manual-absences/return"', manualAbsencePublishStart);
const manualAbsencePublishSource = source.slice(manualAbsencePublishStart, manualAbsencePublishEnd);
assert.match(manualAbsencePublishSource, /set active = \(dao\.employee_id = any\(\$\{idsSql\}::uuid\[\]\)\)/, "manual absence publish must reactivate existing selected rows instead of inserting duplicates");
assert.doesNotMatch(manualAbsencePublishSource, /and y\.active = true/, "manual absence insert existence check must include inactive rows to avoid unique-key retries");

const activeRoster = [
  { employee_id: "employee-a", employee_name: "Alex", shift_start: "05:00:00", shift_end: "15:00:00" },
  { employee_id: "employee-b", employee_name: "Blair", shift_start: "05:00:00", shift_end: "15:00:00" },
  { employee_id: "employee-c", employee_name: "Casey", shift_start: "05:00:00", shift_end: "15:00:00" },
];
const restroomPlan = context.buildRestroomRebalancePlan([
  { assignment_id: "restroom-1", assigned_employee_id: "employee-a", assigned_employee_name: "Alex", group_name: "North Restroom", coverage_start: "09:45:00", coverage_end: "15:00:00", load_points: 1, source_type: "coverage_template" },
  { assignment_id: "restroom-2", assigned_employee_id: "employee-a", assigned_employee_name: "Alex", group_name: "South Restroom", coverage_start: "09:45:00", coverage_end: "15:00:00", load_points: 1, source_type: "coverage_template" },
  { assignment_id: "restroom-3", assigned_employee_id: "employee-a", assigned_employee_name: "Alex", group_name: "East Restroom", coverage_start: "09:45:00", coverage_end: "15:00:00", load_points: 1, source_type: "coverage_template" },
], activeRoster);
assert.equal(restroomPlan.applied, true);
assert.equal(restroomPlan.moved_count, 2);
assert.deepEqual(Object.values(restroomPlan.loads).sort((a, b) => a - b), [1, 1, 1]);

const balancedRestroomPlan = context.buildRestroomRebalancePlan([
  { assignment_id: "restroom-1", assigned_employee_id: "employee-a", group_name: "North Restroom", coverage_start: "09:45:00", coverage_end: "15:00:00", load_points: 1, source_type: "coverage_template" },
  { assignment_id: "restroom-2", assigned_employee_id: "employee-b", group_name: "South Restroom", coverage_start: "09:45:00", coverage_end: "15:00:00", load_points: 1, source_type: "coverage_template" },
  { assignment_id: "restroom-3", assigned_employee_id: "employee-c", group_name: "East Restroom", coverage_start: "09:45:00", coverage_end: "15:00:00", load_points: 1, source_type: "coverage_template" },
], activeRoster);
assert.equal(balancedRestroomPlan.applied, false);
assert.equal(balancedRestroomPlan.reason, "already_balanced");

const protectedRestroomPlan = context.buildRestroomRebalancePlan([
  { assignment_id: "restroom-1", assigned_employee_id: "employee-a", group_name: "North Restroom", coverage_start: "09:45:00", coverage_end: "15:00:00", load_points: 1, source_type: "manager_override" },
  { assignment_id: "restroom-2", assigned_employee_id: "employee-a", group_name: "South Restroom", coverage_start: "09:45:00", coverage_end: "15:00:00", load_points: 1, source_type: "manager_override" },
], activeRoster);
assert.equal(protectedRestroomPlan.applied, false);
assert.equal(protectedRestroomPlan.reason, "no_safe_restroom_moves");

const shiftWindowRestroomPlan = context.buildRestroomRebalancePlan([
  { assignment_id: "restroom-1", assigned_employee_id: "employee-a", assigned_employee_name: "Alex", group_name: "North Restroom", coverage_start: "09:45:00", coverage_end: "15:00:00", load_points: 1, source_type: "coverage_template" },
  { assignment_id: "restroom-2", assigned_employee_id: "employee-a", assigned_employee_name: "Alex", group_name: "South Restroom", coverage_start: "09:45:00", coverage_end: "15:00:00", load_points: 1, source_type: "coverage_template" },
], [
  { employee_id: "employee-a", employee_name: "Alex", shift_start: "05:00:00", shift_end: "15:00:00" },
  { employee_id: "tammy", employee_name: "Tammy", shift_start: "05:00:00", shift_end: "14:00:00" },
  { employee_id: "casey", employee_name: "Casey", shift_start: "05:00:00", shift_end: "15:00:00" },
]);
assert.equal(shiftWindowRestroomPlan.applied, true);
assert.equal(shiftWindowRestroomPlan.moves.length, 1);
assert.equal(shiftWindowRestroomPlan.moves[0].to_employee_id, "casey", "restroom rebalance must not move 3pm coverage to a 2pm employee");

const normalizedRestrictedRestroomRow = context.normalizeRestroomRebalanceRow({
  assignment_id: "restricted-normalize",
  assigned_employee_id: "employee-a",
  group_name: "China",
  coverage_start: "09:45:00",
  coverage_end: "12:00:00",
  restricted_employee_ids: '["kathy", "casey"]',
});
assert.deepEqual(Array.from(normalizedRestrictedRestroomRow.restricted_employee_ids), ["kathy", "casey"], "restroom rebalance rows must preserve restricted receiver metadata");

const restrictedReceiverRestroomPlan = context.buildRestroomRebalancePlan([
  { assignment_id: "restricted-1", assigned_employee_id: "donor", assigned_employee_name: "Donor", group_name: "China", group_code: "CHINA", coverage_start: "09:45:00", coverage_end: "12:00:00", load_points: 1, source_type: "coverage_template", restricted_employee_ids: ["kathy"] },
  { assignment_id: "restricted-2", assigned_employee_id: "donor", assigned_employee_name: "Donor", group_name: "Event Center", group_code: "EVENT_CENTER", coverage_start: "09:45:00", coverage_end: "12:00:00", load_points: 1, source_type: "coverage_template", restricted_employee_ids: ["kathy"] },
  { assignment_id: "restricted-3", assigned_employee_id: "donor", assigned_employee_name: "Donor", group_name: "West Admin", group_code: "WEST_ADMIN", coverage_start: "09:45:00", coverage_end: "12:00:00", load_points: 1, source_type: "coverage_template", restricted_employee_ids: ["kathy"] },
], [
  { employee_id: "donor", employee_name: "Donor", shift_start: "05:00:00", shift_end: "15:00:00" },
  { employee_id: "kathy", employee_name: "Kathy Phelps", shift_start: "05:00:00", shift_end: "15:00:00" },
  { employee_id: "alternate", employee_name: "Alternate", shift_start: "05:00:00", shift_end: "15:00:00" },
]);
assert.equal(restrictedReceiverRestroomPlan.applied, true);
assert.equal(restrictedReceiverRestroomPlan.moves.some((move) => move.to_employee_id === "kathy"), false, "restroom rebalance must not move a row to a restricted receiver");
assert.equal(restrictedReceiverRestroomPlan.moves[0]?.to_employee_id, "alternate", "restroom rebalance should use the unrestricted alternate when one is available");

const coverAllPlan = context.buildCoverAllRebalancePlan([
  { assignment_id: "early-west", assigned_employee_id: "employee-a", assigned_employee_name: "Alex", group_name: "West Entry", coverage_start: "08:00:00", coverage_end: "09:45:00", load_points: 4, source_type: "coverage_template" },
  { assignment_id: "mid-primate", assigned_employee_id: "employee-a", assigned_employee_name: "Alex", group_name: "Primate", coverage_start: "10:00:00", coverage_end: "12:00:00", load_points: 4, source_type: "coverage_template" },
  { assignment_id: "late-route", assigned_employee_id: "employee-a", assigned_employee_name: "Alex", group_name: "South Route", coverage_start: "12:00:00", coverage_end: "15:00:00", load_points: 6, source_type: "coverage_template" },
  { assignment_id: "late-east", assigned_employee_id: "employee-b", assigned_employee_name: "Blair", group_name: "East End", coverage_start: "12:00:00", coverage_end: "15:00:00", load_points: 4, source_type: "coverage_template" },
], [
  { employee_id: "employee-a", employee_name: "Alex", shift_start: "05:00:00", shift_end: "15:00:00" },
  { employee_id: "employee-b", employee_name: "Blair", shift_start: "05:00:00", shift_end: "15:00:00" },
  { employee_id: "coverall-1", employee_name: "CoverAll 1", employee_code: "COVERALL_01", shift_start: "08:00:00", shift_end: "16:00:00" },
  { employee_id: "coverall-2", employee_name: "CoverAll 2", employee_code: "COVERALL_02", shift_start: "08:00:00", shift_end: "16:00:00" },
], ["coverall-1", "coverall-2"]);
assert.equal(coverAllPlan.applied, true);
assert.equal(coverAllPlan.reason, "coverall_rebalanced");
assert.equal(coverAllPlan.initial_loads["employee-a"], 14);
assert.equal(coverAllPlan.initial_loads["coverall-1"], 0);
assert.equal(coverAllPlan.moves.length, 2, "coverall rebalance should distribute work across added CoverAll helpers");
assert.deepEqual(Object.values(coverAllPlan.loads).sort((a, b) => a - b), [4, 4, 4, 6]);

const pre0945CoverAllPlan = context.buildCoverAllRebalancePlan([
  { assignment_id: "early-west", assigned_employee_id: "employee-a", assigned_employee_name: "Alex", group_name: "West Entry", coverage_start: "08:00:00", coverage_end: "09:45:00", load_points: 4, source_type: "coverage_template" },
  { assignment_id: "late-route", assigned_employee_id: "employee-a", assigned_employee_name: "Alex", group_name: "South Route", coverage_start: "12:00:00", coverage_end: "15:00:00", load_points: 6, source_type: "coverage_template" },
  { assignment_id: "late-east", assigned_employee_id: "employee-b", assigned_employee_name: "Blair", group_name: "East End", coverage_start: "12:00:00", coverage_end: "15:00:00", load_points: 4, source_type: "coverage_template" },
], [
  { employee_id: "employee-a", employee_name: "Alex", shift_start: "05:00:00", shift_end: "15:00:00" },
  { employee_id: "employee-b", employee_name: "Blair", shift_start: "05:00:00", shift_end: "15:00:00" },
  { employee_id: "coverall-early", employee_name: "CoverAll Early", employee_code: "COVERALL_01", shift_start: "08:00:00", shift_end: "10:00:00" },
], ["coverall-early"]);
assert.equal(pre0945CoverAllPlan.applied, true);
assert.equal(pre0945CoverAllPlan.moves.length, 1);
assert.equal(pre0945CoverAllPlan.moves[0].assignment_id, "early-west", "coverall rebalance must consider pre-09:45 non-restroom work when it fits the added helper's shift");

const protectedCoverAllPlan = context.buildCoverAllRebalancePlan([
  { assignment_id: "manager-fixed", assigned_employee_id: "employee-a", assigned_employee_name: "Alex", group_name: "VIP Route", coverage_start: "09:00:00", coverage_end: "11:00:00", load_points: 8, source_type: "manager_override" },
  { assignment_id: "regular", assigned_employee_id: "employee-a", assigned_employee_name: "Alex", group_name: "General Route", coverage_start: "11:00:00", coverage_end: "13:00:00", load_points: 4, source_type: "coverage_template" },
  { assignment_id: "support", assigned_employee_id: "employee-b", assigned_employee_name: "Blair", group_name: "Support Route", coverage_start: "11:00:00", coverage_end: "13:00:00", load_points: 2, source_type: "coverage_template" },
], [
  { employee_id: "employee-a", employee_name: "Alex", shift_start: "05:00:00", shift_end: "15:00:00" },
  { employee_id: "employee-b", employee_name: "Blair", shift_start: "05:00:00", shift_end: "15:00:00" },
  { employee_id: "coverall-1", employee_name: "CoverAll 1", employee_code: "COVERALL_01", shift_start: "08:00:00", shift_end: "16:00:00" },
], ["coverall-1"]);
assert.equal(protectedCoverAllPlan.applied, true);
assert.equal(protectedCoverAllPlan.moves.length, 1);
assert.equal(protectedCoverAllPlan.moves[0].assignment_id, "regular", "coverall rebalance must preserve manager/manual override assignments");

assert.equal(context.normalizeRestroomRebalanceCompletionRow({ status: "completed" })?.completed, true);
assert.equal(context.normalizeRestroomRebalanceCompletionRow({ status: "failed" })?.completed, false);
assert.equal(context.normalizeRestroomRebalanceCompletionRow(null), null);
const completionSelectSql = context.buildRestroomRebalanceCompletionSelectSql("2026-06-02");
assert.match(completionSelectSql, /schedule_automation_runs/);
assert.match(completionSelectSql, /restroom_rebalance_0945/);
assert.match(completionSelectSql, /2026-06-02/);
const completionUpsertSql = context.buildRestroomRebalanceCompletionUpsertSql("2026-06-02", { ok: true, moved_count: 2 });
assert.match(completionUpsertSql, /create table if not exists public\.schedule_automation_runs/);
assert.match(completionUpsertSql, /on conflict \(automation_key, service_date\)/);
assert.match(completionUpsertSql, /completed/);

const weekSummary = context.summarizeWeekWindow([
  { service_date: "2026-05-14", ready: true, assignment_count: 10, roster_count: 11 },
  { service_date: "2026-05-15", ready: false, assignment_count: 0, roster_count: 0 },
  { service_date: "2026-05-16", ready: true, assignment_count: 7, roster_count: 9 },
]);
assert.equal(weekSummary.ready_days, 2);
assert.equal(weekSummary.missing_days, 1);
assert.deepEqual(Array.from(weekSummary.missing_dates), ["2026-05-15"]);

const weekSummaryText = context.buildWeekSummaryText({
  serviceDate: "2026-05-14",
  days: 3,
  windowRows: [
    { service_date: "2026-05-14", ready: true, assignment_count: 10, roster_count: 11 },
    { service_date: "2026-05-15", ready: false, assignment_count: 0, roster_count: 0 },
    { service_date: "2026-05-16", ready: true, assignment_count: 7, roster_count: 9 },
  ],
  autoGeneration: { running: false, last_completed_at: "2026-05-14T10:00:00Z", last_window_start: "2026-05-14", generated_days: 1 },
});
assert.match(weekSummaryText, /2 of 3 visible days are ready/i);
assert.match(weekSummaryText, /Missing days: 2026-05-15/i);

const diff = context.summarizeAssignmentDiff({
  removed_assignments: [{ group_name: "West Entry", employee_name: "Alex Stone" }],
  reassigned_assignments: [{ group_name: "Primate", assigned_employee_name: "Jamie Reed", employee_id: "123e4567-e89b-12d3-a456-426614174000" }],
  open_segments: [{ group_name: "Aquarium" }],
  overload_warnings: ["High load on Jamie Reed"],
}, { absentEmployeeIds: [] });
assert.equal(diff.counts.removed_assignments, 1);
assert.equal(diff.counts.reassigned_assignments, 1);
assert.equal(diff.counts.open_segments, 1);
assert.deepEqual(Array.from(diff.changed_groups).sort(), ["Aquarium", "Primate", "West Entry"].sort());

const absenceSummaryText = context.buildAbsenceSummaryText({
  removed_assignments: [{ group_name: "West Entry", employee_name: "Alex Stone" }],
  reassigned_assignments: [{ group_name: "Primate", assigned_employee_name: "Jamie Reed", employee_id: "123e4567-e89b-12d3-a456-426614174000" }],
  open_segments: [{ group_name: "Aquarium" }],
  overload_warnings: ["High load on Jamie Reed"],
  effective_absent_employee_ids: [],
}, { generated_before_preview: true }, "2026-05-14");
assert.match(absenceSummaryText, /auto-generated before previewing absences/i);
assert.match(absenceSummaryText, /1 assignments would be removed/i);
assert.match(source, /source_type, ''\) not ilike '%manual%'/i, "manager/manual overrides must survive static owner restore");
assert.match(source, /source_type, ''\) not ilike '%override%'/i, "explicit override assignments must not be overwritten by static restore");
assert.match(source, /source_type, ''\) not ilike '%manager%'/i, "manager overrides must not be overwritten by static restore");

const matchedGroup = context.matchLocationGroup([
  { group_name: "Primate", group_code: "PRI", included_locations: ["Primate House"] },
  { group_name: "West Entry", group_code: "WEST", included_locations: ["Front Gate"] },
], "primate house");
assert.equal(matchedGroup.group_name, "Primate");

const groupSummaries = context.summarizeOpenAndOverloadedGroups([
  { location_group_id: "1", group_name: "West Entry", group_code: "WEST", assigned_employee_name: "", status: "OPEN", load_points: 20 },
  { location_group_id: "1", group_name: "West Entry", group_code: "WEST", assigned_employee_name: "Alex", status: "ASSIGNED", load_points: 10 },
  { location_group_id: "2", group_name: "Primate", group_code: "PRI", assigned_employee_name: "Jamie", status: "ASSIGNED", load_points: 19 },
]);
assert.equal(groupSummaries.length, 2);
const fallbackRecs = context.buildFallbackSchedulerRecommendations({ serviceDate: "2026-05-14", groupSummaries, userPrompt: "What should we fix first?" });
assert.equal(fallbackRecs.provider, "rule-based");
assert.equal(Array.isArray(fallbackRecs.recommendations), true);
assert.match(fallbackRecs.summary, /2026-05-14|Request considered/i);

console.log(JSON.stringify({ ok: true, schedule_ai_tests: "passed" }, null, 2));
