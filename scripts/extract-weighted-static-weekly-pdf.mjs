#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const PDF = process.argv[2];
assert.ok(PDF, "usage: extract-weighted-static-weekly-pdf.mjs SCHEDULE.pdf");

const PEOPLE = [
  "Karen Robinson",
  "Tammy Miller",
  "Kathy Phelps",
  "New Employee 2",
  "New Employee 4",
  "Kaili Michaelson",
  "Alijah Collins",
  "New Employee 1",
  "Gregory Staples",
];
const EXPECTED = new Map([
  ["Karen Robinson", { shift: ["05:00", "14:00"], lunch: ["09:30", "10:30"], days: [2, 3, 4, 5, 6] }],
  ["Tammy Miller", { shift: ["05:00", "14:00"], lunch: ["08:30", "09:30"], days: [2, 3, 4, 5, 6] }],
  ["Kathy Phelps", { shift: ["06:00", "15:00"], lunch: ["10:30", "11:30"], days: [2, 3, 4, 5, 6] }],
  ["New Employee 2", { shift: ["06:00", "15:00"], lunch: ["10:00", "11:00"], days: [0, 1, 2, 5, 6] }],
  ["New Employee 4", { shift: ["06:00", "15:00"], lunch: ["10:00", "11:00"], days: [0, 1, 2, 3, 4] }],
  ["Kaili Michaelson", { shift: ["07:00", "16:00"], lunch: ["11:00", "12:00"], days: [0, 1, 2, 3, 4] }],
  ["Alijah Collins", { shift: ["07:00", "16:00"], lunch: ["12:00", "13:00"], days: [0, 1, 4, 5, 6] }],
  ["New Employee 1", { shift: ["08:00", "17:00"], lunch: ["12:00", "13:00"], days: [0, 1, 4, 5, 6] }],
  ["Gregory Staples", { shift: ["08:00", "17:00"], lunch: ["13:00", "14:00"], days: [0, 1, 2, 3, 6] }],
]);
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const VACANT = new Set(["New Employee 1", "New Employee 2", "New Employee 4"]);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const minute = (value) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));

function normalizeClock(hourText, minuteText, meridiem) {
  const hour = (Number(hourText) % 12) + (meridiem.toUpperCase() === "PM" ? 12 : 0);
  return `${String(hour).padStart(2, "0")}:${minuteText}`;
}

function parseShift(lines, name) {
  for (const line of lines) {
    const match = /^(\d{1,2}):(\d{2}) (AM|PM) - (\d{1,2}):(\d{2}) (AM|PM)$/.exec(line);
    if (match) return [normalizeClock(match[1], match[2], match[3]), normalizeClock(match[4], match[5], match[6])];
  }
  assert.fail(`shift not found for ${name}`);
}

function lineRecords(page) {
  const tsv = execFileSync("pdftotext", ["-f", String(page), "-l", String(page), "-tsv", PDF, "-"], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  const rows = tsv.trimEnd().split("\n").slice(1).map((row) => row.split("\t"));
  const grouped = new Map();
  for (const columns of rows) {
    if (columns[0] !== "5") continue;
    const key = `${columns[2]}:${columns[3]}:${columns[4]}`;
    const record = grouped.get(key) || { paragraph: Number(columns[2]), block: Number(columns[3]), left: Number(columns[6]), top: Number(columns[7]), words: [] };
    record.left = Math.min(record.left, Number(columns[6]));
    record.top = Math.min(record.top, Number(columns[7]));
    record.words.push({ index: Number(columns[5]), text: columns.slice(11).join("\t") });
    grouped.set(key, record);
  }
  return [...grouped.values()].map((record) => ({
    paragraph: record.paragraph,
    block: record.block,
    left: record.left,
    top: record.top,
    text: record.words.sort((left, right) => left.index - right.index).map((word) => word.text).join(" ").trim(),
  })).filter((record) => record.text).sort((left, right) => left.top - right.top || left.left - right.left);
}

function parsePage(page) {
  const records = lineRecords(page);
  const title = records.find((record) => record.text.startsWith("Memphis Zoo Custodial Schedule - "))?.text;
  assert.equal(title, `Memphis Zoo Custodial Schedule - ${DAY_NAMES[page - 1]}`);
  const employeeStarts = records.filter((record) => record.left < 180 && PEOPLE.includes(record.text));
  const declared = Number(records.find((record) => /employees working\./.test(record.text))?.text.match(/^(\d+)/)?.[1]);
  assert.equal(employeeStarts.length, declared, `${DAY_NAMES[page - 1]} employee block count`);
  return {
    dayOfWeek: page - 1,
    dayName: DAY_NAMES[page - 1],
    employees: employeeStarts.map((start, index) => {
      const nextEmployeeTop = employeeStarts[index + 1]?.top ?? 570;
      const left = records.filter((record) => record.left < 180 && record.top >= start.top - 0.5 && record.top < nextEmployeeTop - 0.5).map((record) => record.text);
      const scheduleBlocks = new Map();
      for (const record of records.filter((entry) => entry.left >= 180 && entry.top > 120 && entry.top < 570)) {
        const key = `${record.paragraph}:${record.block}`;
        const group = scheduleBlocks.get(key) || [];
        group.push(record);
        scheduleBlocks.set(key, group);
      }
      const ownedBlocks = [...scheduleBlocks.values()].filter((group) => {
        const firstTop = Math.min(...group.map((record) => record.top));
        const closest = employeeStarts.slice().sort((leftStart, rightStart) => Math.abs(leftStart.top - firstTop) - Math.abs(rightStart.top - firstTop) || leftStart.top - rightStart.top)[0];
        return closest === start;
      }).flat();
      const morning = ownedBlocks.filter((record) => record.left < 465).map((record) => record.text);
      const equalized = ownedBlocks.filter((record) => record.left >= 465).map((record) => record.text);
      assert.ok(morning.length && equalized.length, `${start.text} ${DAY_NAMES[page - 1]} requires both schedule phases`);
      return { name: start.text, shift: parseShift(left, start.text), morning, equalized };
    }),
  };
}

const days = Array.from({ length: 7 }, (_, index) => parsePage(index + 1));
const roster = PEOPLE.map((name) => {
  const expected = EXPECTED.get(name);
  const appearances = days.flatMap((day) => day.employees.filter((employee) => employee.name === name).map((employee) => ({ dayOfWeek: day.dayOfWeek, shift: employee.shift })));
  assert.deepEqual(appearances.map((entry) => entry.dayOfWeek), expected.days, `${name} workdays`);
  assert.ok(appearances.every((entry) => JSON.stringify(entry.shift) === JSON.stringify(expected.shift)), `${name} shift is stable`);
  assert.equal(minute(expected.lunch[1]) - minute(expected.lunch[0]), 60, `${name} lunch is one hour`);
  const offset = minute(expected.lunch[0]) - minute(expected.shift[0]);
  assert.ok(offset >= 210 && offset <= 300, `${name} lunch is near four hours into the shift`);
  return {
    slotKey: name.toUpperCase().replaceAll(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, ""),
    displayName: VACANT.has(name) ? null : name,
    slotLabel: VACANT.has(name) ? name.replace("New ", "") : `${name} schedule position`,
    vacancy: VACANT.has(name),
    shift: { start: expected.shift[0], end: expected.shift[1] },
    lunch: { start: expected.lunch[0], end: expected.lunch[1] },
    lunchAuthority: "production_manager_staggered_coverage_optimization.v1",
    workDays: expected.days,
  };
});

for (const day of days) {
  const lunchRows = day.employees.map((employee) => ({ name: employee.name, ...EXPECTED.get(employee.name) }));
  let maximumOverlap = 0;
  let minimumWorking = lunchRows.length;
  for (let at = 0; at < 1440; at += 30) {
    const overlap = lunchRows.filter((row) => minute(row.lunch[0]) <= at && at < minute(row.lunch[1])).length;
    maximumOverlap = Math.max(maximumOverlap, overlap);
    minimumWorking = Math.min(minimumWorking, lunchRows.length - overlap);
  }
  const namedLunchRows = lunchRows.filter((row) => !VACANT.has(row.name));
  let maximumNamedOverlap = 0;
  let minimumNamedWorking = namedLunchRows.length;
  for (let at = 0; at < 1440; at += 30) {
    const overlap = namedLunchRows.filter((row) => minute(row.lunch[0]) <= at && at < minute(row.lunch[1])).length;
    maximumNamedOverlap = Math.max(maximumNamedOverlap, overlap);
    minimumNamedWorking = Math.min(minimumNamedWorking, namedLunchRows.length - overlap);
  }
  day.coverage = {
    scheduledPositions: lunchRows.length,
    maximumFutureLunchOverlap: maximumOverlap,
    minimumFuturePositionsWorkingDuringLunches: minimumWorking,
    scheduledNamedEmployees: namedLunchRows.length,
    maximumCurrentNamedLunchOverlap: maximumNamedOverlap,
    minimumCurrentNamedEmployeesWorkingDuringLunches: minimumNamedWorking,
  };
  assert.ok(maximumOverlap <= 3 && minimumWorking >= 3, `${day.dayName} future full-roster lunch coverage`);
  assert.ok(minimumNamedWorking >= Math.min(3, namedLunchRows.length - 1), `${day.dayName} current named-employee lunch coverage`);
  assert.ok(day.employees.every((employee) => ![...employee.morning, ...employee.equalized].includes("Splash Pad")), `${day.dayName} excludes inactive Splash Pad`);
  const alijah = day.employees.find((employee) => employee.name === "Alijah Collins");
  if (alijah) assert.ok(![...alijah.morning, ...alijah.equalized].includes("Herpetarium"), `${day.dayName} keeps Alijah out of Herpetarium`);
  const morningItems = day.employees.flatMap((employee) => employee.morning);
  const equalizedItems = day.employees.flatMap((employee) => employee.equalized);
  assert.ok(!morningItems.some((item) => /Admin/.test(item)), `${day.dayName} has no morning Admin assignment`);
  assert.ok(equalizedItems.some((item) => /East Admin/.test(item)) && equalizedItems.some((item) => /West Admin/.test(item)), `${day.dayName} includes both 9:45 Admin assignments`);
  const giftItems = [...morningItems, ...equalizedItems].filter((item) => /Gift Shop/.test(item));
  assert.equal(giftItems.length, day.dayOfWeek === 1 ? 3 : 0, `${day.dayName} gift-shop reminder count`);
  if (day.dayOfWeek === 1) assert.ok(giftItems.every((item) => /^8:00 AM - /.test(item) && morningItems.includes(item)), "Monday gift shops are 8:00 AM morning reminders only");
}

const result = {
  schema: "memphis-zoo.weighted-static-weekly-pdf.v1",
  source: { path: PDF, sha256: sha256(readFileSync(PDF)), pages: 7 },
  policy: {
    phases: [{ name: "morning", starts: "employee_shift_start", ends: "09:45" }, { name: "equalized", starts: "09:45", ends: "employee_shift_end" }],
    employeeRoute: "employee_chooses_practical_route",
    restroomsFirst: "display_priority_only",
    splashPad: "inactive",
    mondayGiftShops: "08:00_morning_reminder_only",
    lunchAuthority: {
      source: "production_manager_staggered_coverage_optimization.v1",
      preference: "one_hour_lunch_near_four_hours_into_shift",
      constraints: ["protect_current_named_coverage", "bound_future_full_roster_overlap", "minimize_weighted_workload_off_floor"],
      note: "The PDF supplies shifts, workdays, and area ownership. Lunch times are Production Manager authority derived from Eric's coverage request, not text extracted from the PDF."
    }
  },
  roster,
  days,
};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
