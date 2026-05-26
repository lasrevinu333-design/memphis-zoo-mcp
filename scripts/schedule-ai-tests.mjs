import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const scheduleApiPath = path.resolve("src/schedule-api.js");
const source = fs.readFileSync(scheduleApiPath, "utf8");

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
  "summarizeAssignmentDiff",
  "summarizeWeekWindow",
  "buildWeekSummaryText",
  "buildAbsenceSummaryText",
  "matchLocationGroup",
  "summarizeOpenAndOverloadedGroups",
  "buildFallbackSchedulerRecommendations",
];

const context = {
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
