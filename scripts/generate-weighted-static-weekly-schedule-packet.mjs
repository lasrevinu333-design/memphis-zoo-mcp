#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { compileStaticWeeklySchedule, postgresJsonbContentDigest } from "../src/static-weekly-schedule-compiler.js";
import { prepareStaticWeeklyRegistrationArtifact } from "./static-weekly-schedule-candidate-importer.mjs";

const TASK_ID = "c0118782-c0f7-4795-8367-7f0ba0855c5d";
const PROJECT_ID = "rqquvtjdmugpigbndmne";
const EFFECTIVE_DATE = process.env.STATIC_WEEKLY_EFFECTIVE_DATE || "2026-08-31";
const BACKEND = path.resolve(process.cwd());
const RESULT_DIR = "/home/eric/custodial-codex/results/production-manager-20260820";
const FIXTURE = path.join(BACKEND, "scripts/fixtures/static-weekly-scheduler/weighted-schedule-20260826.json");
const PRIOR_PACKET = path.join(RESULT_DIR, "STATIC-WEEKLY-VERIFIED-SCHEDULE-PACKET-V10-20260823.json");
const OUTPUT = process.argv[2] || path.join(RESULT_DIR, "STATIC-WEEKLY-WEIGHTED-SCHEDULE-PACKET-20260826.json");
if (fs.existsSync(OUTPUT)) throw new Error(`Refusing to replace existing schedule evidence: ${OUTPUT}`);

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const fileHash = (file) => sha256(fs.readFileSync(file));
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const minute = (value) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
const clone = (value) => JSON.parse(JSON.stringify(value));

function deterministicUuid(label) {
  const bytes = Buffer.from(sha256(`memphis-zoo-static-weekly-weighted-v1:${label}`).slice(0, 32), "hex");
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function allocateWorkload(total, segments, label) {
  assert.ok(Number.isSafeInteger(total) && total >= segments.length, `${label} needs at least one workload point per phase`);
  const durations = segments.map((segment) => minute(segment.window.end) - minute(segment.window.start));
  assert.ok(durations.every((duration) => duration > 0), `${label} has a non-positive ownership window`);
  const weights = durations.map((duration, index) => duration * Math.max(1, Number(segments[index].allocationUnits || 1)));
  const durationTotal = weights.reduce((sum, value) => sum + value, 0);
  const distributable = total - segments.length;
  const rows = weights.map((weight, index) => ({ index, points: 1 + Math.floor((distributable * weight) / durationTotal), remainder: (distributable * weight) % durationTotal }));
  let remaining = total - rows.reduce((sum, row) => sum + row.points, 0);
  for (const row of rows.slice().sort((left, right) => right.remainder - left.remainder || left.index - right.index)) {
    if (remaining <= 0) break;
    row.points += 1; remaining -= 1;
  }
  return rows.sort((left, right) => left.index - right.index).map((row) => row.points);
}

const fixture = readJson(FIXTURE);
const prior = readJson(PRIOR_PACKET);
assert.equal(fixture.schema, "memphis-zoo.weighted-static-weekly-pdf.v1");
assert.equal(fixture.source.sha256, fileHash(fixture.source.path), "attached PDF hash changed after extraction");
assert.equal(fixture.source.sha256, "e7355f7f7197688a707277e5eb5360695f9e6713ec82acddc0a37126b06a9ad5");
assert.equal(fixture.policy?.lunchAuthority?.source, "production_manager_staggered_coverage_optimization.v1");
assert.ok(fixture.roster.every((row) => row.lunchAuthority === fixture.policy.lunchAuthority.source), "every lunch must identify the separate Production Manager authority");
assert.equal(prior.packetSchema, "memphis-zoo.static-weekly.verified-schedule-packet.v1");

const priorRosterByName = new Map(prior.rosterSlots.map((row) => [row.displayName, row]));
const priorSlotsById = new Map(prior.compilerInput.slots.map((slot) => [slot.id, slot]));
const retainedNames = new Set(["Karen Robinson", "Tammy Miller", "Kathy Phelps", "Alijah Collins"]);
const newlyCreatedPositionNames = new Set(["Kaili Michaelson", "Gregory Staples", "New Employee 1", "New Employee 2", "New Employee 4"]);
const permanentlyVacantNames = new Set(["New Employee 1", "New Employee 2", "New Employee 4"]);

const rosterAuthority = new Map();
for (const row of fixture.roster) {
  if (retainedNames.has(row.displayName)) {
    const priorRoster = priorRosterByName.get(row.displayName);
    const priorSlot = priorSlotsById.get(priorRoster?.slotId);
    assert.ok(priorRoster && priorSlot, `retained production slot missing for ${row.displayName}`);
    rosterAuthority.set(row.slotKey, { ...row, sourceName: row.displayName, slotId: priorRoster.slotId, slot: clone(priorSlot), personId: priorRoster.personId, displayName: row.displayName, vacancyCapable: false, activeVacancy: false });
  } else {
    assert.ok(newlyCreatedPositionNames.has(row.displayName || `New ${row.slotLabel}`), `unexpected new roster position ${row.slotLabel}`);
    const slotId = deterministicUuid(`stable-roster-position:${row.slotKey}`);
    rosterAuthority.set(row.slotKey, {
      ...row, sourceName: row.displayName || `New ${row.slotLabel}`, slotId,
      slot: { id: slotId, label: row.slotLabel, incumbencies: [] }, personId: null, displayName: null,
      vacancyCapable: true, activeVacancy: true, remainsVacantAtPublication: permanentlyVacantNames.has(row.displayName || `New ${row.slotLabel}`),
    });
  }
}
assert.equal(rosterAuthority.size, 9);

const familyTemplates = new Map();
const familyDayPoints = new Map();
for (const assignment of prior.compilerInput.version.assignments) {
  const code = assignment.locationCodeSnapshot;
  if (!familyTemplates.has(code)) familyTemplates.set(code, {
    code, locationId: assignment.locationId, name: assignment.locationNameSnapshot, serviceMode: assignment.serviceMode,
    includedLocations: clone(assignment.includedLocations), priority: assignment.priority,
  });
  const key = `${code}\u0000${assignment.dayOfWeek}`;
  familyDayPoints.set(key, (familyDayPoints.get(key) || 0) + assignment.serviceEffortMinutes);
}
for (const [code, template] of familyTemplates) {
  const totals = [...familyDayPoints].filter(([key]) => key.startsWith(`${code}\u0000`)).map(([, value]) => value);
  assert.equal(new Set(totals).size, 1, `${code} prior workload authority changes by weekday`);
  template.workloadPoints = totals[0];
}
familyTemplates.delete("SPLASH_PAD_RESTROOMS");

for (const [code, name] of [
  ["TRADING_POST_GIFT_SHOP", "Trading Post Gift Shop"],
  ["ELEPHANT_TRUNK_GIFT_SHOP", "Elephant Trunk Gift Shop"],
  ["BAMBOO_SPRINGS_GIFT_SHOP", "Bamboo Springs Gift Shop"],
]) familyTemplates.set(code, {
  code, locationId: deterministicUuid(`nonphysical-reminder:${code}`), name, serviceMode: "reminder_only",
  includedLocations: [], priority: 1, workloadPoints: 1,
});

const rawItemToFamily = new Map();
for (const family of familyTemplates.values()) {
  for (const location of family.includedLocations) rawItemToFamily.set(location.locationNameSnapshot, family.code);
  if (family.includedLocations.length === 0) rawItemToFamily.set(family.name, family.code);
}
for (const [raw, code] of [
  ["East Admin and Restrooms", "EAST_ADMIN"],
  ["West Admin and Restrooms", "WEST_ADMIN"],
  ["Elephant Trunk Men's Restroom", "ELEPHANT_TRUNK_RESTROOMS"],
  ["Elephant Trunk Women's Restroom", "ELEPHANT_TRUNK_RESTROOMS"],
  ["8:00 AM - Trading Post Gift Shop", "TRADING_POST_GIFT_SHOP"],
  ["8:00 AM - Elephant Trunk Gift Shop", "ELEPHANT_TRUNK_GIFT_SHOP"],
  ["8:00 AM - Bamboo Springs Gift Shop", "BAMBOO_SPRINGS_GIFT_SHOP"],
]) rawItemToFamily.set(raw, code);

const rosterBySourceName = new Map([...rosterAuthority.values()].map((row) => [row.sourceName, row]));
const phaseSegments = new Map();
const rawCoverage = new Set();
for (const day of fixture.days) {
  for (const employee of day.employees) {
    const owner = rosterBySourceName.get(employee.name);
    assert.ok(owner, `PDF employee has no stable roster position: ${employee.name}`);
    for (const phase of ["morning", "equalized"]) {
      const byFamily = new Map();
      for (const item of employee[phase]) {
        const rawKey = `${day.dayOfWeek}\u0000${phase}\u0000${item}`;
        assert.equal(rawCoverage.has(rawKey), false, `${day.dayName} ${phase} item has competing owners: ${item}`);
        rawCoverage.add(rawKey);
        const code = rawItemToFamily.get(item);
        assert.ok(code, `PDF item has no reviewed operational-family mapping: ${day.dayName} / ${employee.name} / ${item}`);
        const items = byFamily.get(code) || [];
        items.push(item); byFamily.set(code, items);
      }
      for (const [code, rawItems] of byFamily) {
        const isGiftReminder = code.endsWith("_GIFT_SHOP");
        const window = isGiftReminder
          ? { start: "08:00", end: "08:30" }
          : phase === "morning" ? { start: owner.shift.start, end: "09:45" } : { start: "09:45", end: owner.shift.end };
        const key = `${day.dayOfWeek}\u0000${code}\u0000${phase}\u0000${owner.slotId}`;
        assert.equal(phaseSegments.has(key), false, `${day.dayName} ${code} ${phase} repeats one owner segment`);
        phaseSegments.set(key, { dayOfWeek: day.dayOfWeek, dayName: day.dayName, code, phase, owner, window, rawItems });
      }
    }
  }
}

const dailyExpected = [...familyTemplates.keys()].filter((code) => !code.endsWith("_GIFT_SHOP") && code !== "ELEPHANT_TRUNK_RESTROOMS").sort();
for (const day of fixture.days) {
  const actual = [...new Set([...phaseSegments.values()].filter((row) => row.dayOfWeek === day.dayOfWeek).map((row) => row.code))].sort();
  const expected = [...dailyExpected, ...(day.dayOfWeek === 1 ? ["ELEPHANT_TRUNK_RESTROOMS", "TRADING_POST_GIFT_SHOP", "ELEPHANT_TRUNK_GIFT_SHOP", "BAMBOO_SPRINGS_GIFT_SHOP"] : [])].sort();
  assert.deepEqual(actual, expected, `${day.dayName} operational-family coverage must exactly match the reviewed PDF`);
}

const assignments = [];
const groupedSegments = new Map();
for (const segment of phaseSegments.values()) {
  const key = `${segment.dayOfWeek}\u0000${segment.code}`;
  const rows = groupedSegments.get(key) || [];
  rows.push(segment); groupedSegments.set(key, rows);
}
for (const [key, segments] of [...groupedSegments].sort(([left], [right]) => left.localeCompare(right))) {
  segments.sort((left, right) => left.phase.localeCompare(right.phase) || left.owner.slotId.localeCompare(right.owner.slotId));
  const family = familyTemplates.get(segments[0].code);
  for (const segment of segments) {
    if (family.serviceMode !== "scan_tracked") {
      segment.includedLocations = [];
    } else {
      const exactByName = new Map(family.includedLocations.map((location) => [location.locationNameSnapshot, location]));
      const adminAlias = segment.rawItems.some((item) => item === "East Admin and Restrooms" || item === "West Admin and Restrooms");
      segment.includedLocations = adminAlias
        ? clone(family.includedLocations)
        : segment.rawItems.map((item) => {
          const location = exactByName.get(item);
          assert.ok(location, `${segment.dayName} ${family.code} item is not an exact production location: ${item}`);
          return clone(location);
        });
      const ids = segment.includedLocations.map((location) => location.locationId);
      assert.equal(new Set(ids).size, ids.length, `${segment.dayName} ${family.code} segment repeats a physical location`);
      assert.ok(ids.length > 0, `${segment.dayName} ${family.code} scan work needs at least one exact physical location`);
    }
    segment.allocationUnits = Math.max(1, segment.includedLocations.length);
  }
  const points = allocateWorkload(family.workloadPoints, segments, key);
  segments.forEach((segment, index) => assignments.push({
    workId: `${segment.dayOfWeek}:${family.code}:${segment.phase}:${segment.owner.slotId.slice(0, 8)}`,
    dayOfWeek: segment.dayOfWeek,
    locationId: segment.includedLocations[0]?.locationId || family.locationId,
    locationCodeSnapshot: family.code,
    locationNameSnapshot: family.name,
    serviceMode: family.serviceMode,
    includedLocations: clone(segment.includedLocations),
    window: segment.window,
    ownerSlotId: segment.owner.slotId,
    originSlotId: segment.owner.slotId,
    schedulingMode: "flexible_coverage_ownership",
    serviceEffortMinutes: points[index],
    serviceEffortProvenance: `reviewed weighted PDF ownership phase; family daily workload total retained from ${fileHash(PRIOR_PACKET)}; pdf=${fixture.source.sha256}`,
    priority: Math.max(1, Number(family.priority)),
    priorityProvenance: `accepted production family priority retained from ${fileHash(PRIOR_PACKET)}`,
    requiredQualifications: ["general"],
    qualificationProvenance: `custodial recurring ownership; pdf=${fixture.source.sha256}`,
    restrictions: [],
    restrictionProvenance: `no source restriction in reviewed PDF; pdf=${fixture.source.sha256}`,
    required: true,
  }));
}

const physicalCoverage = new Set();
for (const assignment of assignments.filter((row) => row.serviceMode === "scan_tracked")) {
  for (const location of assignment.includedLocations) {
    const key = `${assignment.dayOfWeek}\u0000${assignment.workId.split(":")[2]}\u0000${location.locationId}`;
    assert.equal(physicalCoverage.has(key), false, `one physical location has competing same-phase owners: ${key}`);
    physicalCoverage.add(key);
  }
}

function optimizeLunchPlan(rows, work) {
  const workers = [...rows].map((row, index) => ({
    ...row, index, shiftStartMinute: minute(row.shift.start),
    futureVacancy: row.remainsVacantAtPublication === true,
    loadByDay: Array.from({ length: 7 }, (_, day) => work.filter((item) => item.dayOfWeek === day && item.originSlotId === row.slotId).reduce((sum, item) => sum + item.serviceEffortMinutes, 0)),
  }));
  const dailyTotals = Array.from({ length: 7 }, (_, day) => workers.reduce((sum, row) => sum + row.loadByDay[day], 0));
  const currentNamedWorkers = workers.filter((row) => !row.futureVacancy);
  const currentNamedDailyTotals = Array.from({ length: 7 }, (_, day) => currentNamedWorkers.reduce((sum, row) => sum + row.loadByDay[day], 0));
  const options = workers.map((row) => [210, 240, 270, 300].map((offset) => row.shiftStartMinute + offset));
  const picks = Array(workers.length).fill(0);
  let checked = 0; let dualCoverageFeasible = 0; let dualWorkloadFeasible = 0; let best = null;
  const isBetter = (candidate) => {
    if (!best) return true;
    for (const field of ["offsetPenaltyMinutes", "maximumCurrentNamedOffWorkloadFraction", "maximumFutureOffWorkloadFraction", "maximumCurrentNamedOffWorkloadPoints", "maximumFutureOffWorkloadPoints", "sumFractionSquares", "overlapMoments"]) {
      if (candidate[field] < best[field] - 1e-12) return true;
      if (candidate[field] > best[field] + 1e-12) return false;
    }
    return candidate.picks.join(":") < best.picks.join(":");
  };
  const evaluate = () => {
    checked += 1;
    let maximumFutureOffWorkloadFraction = 0; let maximumCurrentNamedOffWorkloadFraction = 0;
    let maximumFutureOffWorkloadPoints = 0; let maximumCurrentNamedOffWorkloadPoints = 0;
    let sumFractionSquares = 0; let overlapMoments = 0;
    const dailyWorst = [];
    for (let day = 0; day < 7; day += 1) {
      const active = workers.filter((row) => row.workDays.includes(day));
      const currentNamed = active.filter((row) => !row.futureVacancy);
      const minimumCurrentNamedWorking = Math.min(3, currentNamed.length - 1);
      let worst = { currentNamedFraction: -1, atMinute: null, futureOffWorkloadPoints: 0, currentNamedOffWorkloadPoints: 0, futureLunching: [], currentNamedLunching: [], futurePositionsStillWorking: active.length, currentNamedEmployeesStillWorking: currentNamed.length };
      for (let at = 480; at <= 840; at += 30) {
        const lunching = active.filter((row) => picks[row.index] <= at && at < picks[row.index] + 60);
        const currentNamedLunching = currentNamed.filter((row) => picks[row.index] <= at && at < picks[row.index] + 60);
        if (lunching.length > 3 || active.length - lunching.length < 3) return;
        if (currentNamed.length - currentNamedLunching.length < minimumCurrentNamedWorking) return;
        const futureOffWorkloadPoints = lunching.reduce((sum, row) => sum + row.loadByDay[day], 0);
        const currentNamedOffWorkloadPoints = currentNamedLunching.reduce((sum, row) => sum + row.loadByDay[day], 0);
        const futureFraction = dailyTotals[day] === 0 ? 0 : futureOffWorkloadPoints / dailyTotals[day];
        const currentNamedFraction = currentNamedDailyTotals[day] === 0 ? 0 : currentNamedOffWorkloadPoints / currentNamedDailyTotals[day];
        if (lunching.length > 1) overlapMoments += 1;
        maximumFutureOffWorkloadFraction = Math.max(maximumFutureOffWorkloadFraction, futureFraction);
        maximumCurrentNamedOffWorkloadFraction = Math.max(maximumCurrentNamedOffWorkloadFraction, currentNamedFraction);
        maximumFutureOffWorkloadPoints = Math.max(maximumFutureOffWorkloadPoints, futureOffWorkloadPoints);
        maximumCurrentNamedOffWorkloadPoints = Math.max(maximumCurrentNamedOffWorkloadPoints, currentNamedOffWorkloadPoints);
        sumFractionSquares += futureFraction * futureFraction + currentNamedFraction * currentNamedFraction;
        if (currentNamedFraction > worst.currentNamedFraction) worst = {
          currentNamedFraction, futureFraction, atMinute: at, futureOffWorkloadPoints, currentNamedOffWorkloadPoints,
          futureLunching: lunching.map((row) => row.sourceName), currentNamedLunching: currentNamedLunching.map((row) => row.sourceName),
          futurePositionsStillWorking: active.length - lunching.length,
          currentNamedEmployeesStillWorking: currentNamed.length - currentNamedLunching.length,
        };
      }
      dailyWorst.push({ dayOfWeek: day, ...worst });
    }
    dualCoverageFeasible += 1;
    // Protect the currently staffed operation first while also preserving a
    // bounded future full-roster plan.  The current three-person Sunday and
    // Monday crew can never have less than one person's workload at lunch;
    // the 40% current and 45% future caps are tight against that reality.
    if (maximumCurrentNamedOffWorkloadFraction > 0.40 + 1e-12 || maximumFutureOffWorkloadFraction > 0.45 + 1e-12) return;
    dualWorkloadFeasible += 1;
    const candidate = {
      picks: [...picks], dailyWorst,
      maximumFutureOffWorkloadFraction, maximumCurrentNamedOffWorkloadFraction,
      maximumFutureOffWorkloadPoints, maximumCurrentNamedOffWorkloadPoints,
      sumFractionSquares, overlapMoments,
      offsetPenaltyMinutes: workers.reduce((sum, row) => sum + Math.abs(picks[row.index] - (row.shiftStartMinute + 240)), 0),
    };
    if (isBetter(candidate)) best = candidate;
  };
  const visit = (index) => {
    if (index === workers.length) { evaluate(); return; }
    for (const start of options[index]) { picks[index] = start; visit(index + 1); }
  };
  visit(0);
  assert.ok(best, "no staggered lunch plan satisfies the four-hour preference and weighted coverage bounds");
  const clock = (value) => `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
  const lunches = workers.map((row) => ({
    sourceName: row.sourceName, slotId: row.slotId, shift: clone(row.shift),
    lunch: { start: clock(best.picks[row.index]), end: clock(best.picks[row.index] + 60) },
    offsetMinutes: best.picks[row.index] - row.shiftStartMinute,
  }));
  for (const planned of lunches) {
    const owner = [...rosterAuthority.values()].find((row) => row.slotId === planned.slotId);
    assert.ok(owner, `optimized lunch has no stable roster position: ${planned.sourceName}`);
    assert.deepEqual(owner.lunch, planned.lunch, `${planned.sourceName} lunch must equal the deterministic coverage optimum`);
  }
  return {
    method: "exhaustive_4_to_the_9_half_hour_candidate_search",
    checkedCombinations: checked, dualCoverageFeasibleCombinations: dualCoverageFeasible, dualWorkloadFeasibleCombinations: dualWorkloadFeasible,
    hardBounds: {
      maximumFutureSimultaneousLunches: 3, minimumFuturePositionsStillWorking: 3, maximumFutureOffWorkloadPercent: 45,
      minimumCurrentNamedEmployeesStillWorking: "min(3, named employees scheduled minus 1)", maximumCurrentNamedOffWorkloadPercent: 40,
    },
    objectiveOrder: ["minimum total deviation from four hours into shift", "minimum current named-crew worst off-workload fraction", "minimum future full-roster worst off-workload fraction", "minimum current then future worst off-workload points", "minimum aggregate off-workload squares", "minimum overlap moments", "stable time identity"],
    objective: {
      offsetPenaltyMinutes: best.offsetPenaltyMinutes,
      maximumCurrentNamedOffWorkloadPercent: Number((best.maximumCurrentNamedOffWorkloadFraction * 100).toFixed(2)),
      maximumFutureOffWorkloadPercent: Number((best.maximumFutureOffWorkloadFraction * 100).toFixed(2)),
      maximumCurrentNamedOffWorkloadPoints: best.maximumCurrentNamedOffWorkloadPoints,
      maximumFutureOffWorkloadPoints: best.maximumFutureOffWorkloadPoints,
      overlapMoments: best.overlapMoments,
    },
    lunches,
    dailyWorst: best.dailyWorst.map((row) => ({
      ...row, at: clock(row.atMinute),
      currentNamedOffWorkloadPercent: Number((row.currentNamedFraction * 100).toFixed(1)),
      futureOffWorkloadPercent: Number((row.futureFraction * 100).toFixed(1)),
      currentNamedFraction: undefined, futureFraction: undefined,
    })),
  };
}

const lunchOptimization = optimizeLunchPlan([...rosterAuthority.values()], assignments);

const maximumDailyWorkloadPoints = Math.max(...Array.from({ length: 7 }, (_, day) => assignments.filter((row) => row.dayOfWeek === day).reduce((sum, row) => sum + row.serviceEffortMinutes, 0)));
const slotAvailability = [];
for (const owner of rosterAuthority.values()) {
  for (const dayOfWeek of owner.workDays) {
    const anchorWork = assignments.find((item) => item.dayOfWeek === dayOfWeek && item.originSlotId === owner.slotId && item.serviceMode === "scan_tracked");
    assert.ok(anchorWork, `no physical routing anchor exists for ${owner.sourceName} on weekday ${dayOfWeek}`);
    const productiveMinutes = minute(owner.shift.end) - minute(owner.shift.start) - (minute(owner.lunch.end) - minute(owner.lunch.start));
    assert.equal(productiveMinutes, 480, `${owner.sourceName} must retain an eight-hour productive day after lunch`);
    slotAvailability.push({
      slotId: owner.slotId, dayOfWeek, status: owner.activeVacancy ? "vacant_unfilled" : "working",
      shift: clone(owner.shift), lunch: clone(owner.lunch),
      productiveCapacityProvenance: `reviewed PDF shift plus Production Manager staggered one-hour lunch authority ${fixture.policy.lunchAuthority.source}; pdf=${fixture.source.sha256}`,
      maxDutyMinutes: productiveMinutes, maxDutyProvenance: `exact shift less protected lunch; pdf=${fixture.source.sha256}`,
      maxServiceEffortMinutes: maximumDailyWorkloadPoints,
      maxServiceEffortProvenance: `complete reviewed-day workload-point upper bound; prior=${fileHash(PRIOR_PACKET)}; pdf=${fixture.source.sha256}`,
      qualifications: ["general", "custodial"], qualificationProvenance: `custodial schedule position authority; pdf=${fixture.source.sha256}`,
      restrictions: [], restrictionProvenance: `no source restriction in reviewed PDF; pdf=${fixture.source.sha256}`,
      acceptedRouteAnchorLocationId: anchorWork.locationId,
      acceptedRouteProvenance: `first reviewed scan-tracked family is only a routing anchor; employee chooses practical route; pdf=${fixture.source.sha256}`,
    });
  }
}

const staffSlots = [...rosterAuthority.values()].map((row) => clone(row.slot));
const contractorSlots = prior.compilerInput.slots.filter((slot) => slot.contractorCapacity === true).map(clone);
assert.equal(contractorSlots.length, 8, "all eight accepted CoverAll capacity slots must remain available");
const routingAliases = new Map();
for (const family of familyTemplates.values()) {
  if (family.code.endsWith("_GIFT_SHOP")) continue;
  routingAliases.set(family.locationId, family.serviceMode === "scan_tracked"
    ? family.includedLocations.map((location) => location.locationId)
    : [family.locationId]);
}
const expandedProximity = new Map();
const addProximity = (fromLocationId, toLocationId, minutes, provenance) => {
  if (fromLocationId === toLocationId) return;
  const key = `${fromLocationId}\u0000${toLocationId}`;
  const priorEdge = expandedProximity.get(key);
  if (!priorEdge || minutes < priorEdge.minutes) expandedProximity.set(key, { fromLocationId, toLocationId, minutes, verified: true, provenance });
};
for (const edge of prior.compilerInput.proximity) {
  const fromAliases = routingAliases.get(edge.fromLocationId) || [edge.fromLocationId];
  const toAliases = routingAliases.get(edge.toLocationId) || [edge.toLocationId];
  for (const fromLocationId of fromAliases) for (const toLocationId of toAliases) addProximity(
    fromLocationId, toLocationId, edge.minutes,
    `accepted operational-family directed proximity applied to exact member locations; ${edge.provenance}`,
  );
}
for (const family of familyTemplates.values()) if (family.serviceMode === "scan_tracked") {
  const locations = family.includedLocations.map((location) => location.locationId);
  for (const fromLocationId of locations) for (const toLocationId of locations) if (fromLocationId !== toLocationId) addProximity(
    fromLocationId, toLocationId, 1,
    `conservative one-minute adjacency within accepted operational family ${family.code}; prior=${fileHash(PRIOR_PACKET)}`,
  );
}
const proximity = [...expandedProximity.values()].sort((left, right) => left.fromLocationId.localeCompare(right.fromLocationId) || left.toLocationId.localeCompare(right.toLocationId));
assert.ok(proximity.length > prior.compilerInput.proximity.length && proximity.length < 32_768, "exact-member proximity expansion must remain bounded");
const sourceId = deterministicUuid(`authority-source:${fixture.source.sha256}`);
const versionId = deterministicUuid(`recurring-version:${EFFECTIVE_DATE}:${sourceId}`);
const publicationId = deterministicUuid(`source-publication:${EFFECTIVE_DATE}:${sourceId}`);
const rawCompilerInput = {
  serviceDate: EFFECTIVE_DATE,
  timezone: "America/Chicago",
  exceptions: [],
  proximity,
  slots: [...staffSlots, ...contractorSlots],
  versions: [{
    id: versionId, publicationId, status: "published", effectiveStart: EFFECTIVE_DATE, effectiveEnd: null,
    objective: { requireVerifiedProximity: true }, namedAbsentSlotIds: [],
    vacancyCapableSlotIds: [...rosterAuthority.values()].filter((row) => row.vacancyCapable).map((row) => row.slotId),
    vacantSlotIds: [...rosterAuthority.values()].filter((row) => row.vacancyCapable).map((row) => row.slotId),
    slotAvailability, assignments,
  }],
};

const compiled = await compileStaticWeeklySchedule(rawCompilerInput);
assert.equal(compiled.status, "FEASIBLE", `weighted schedule compiler rejected: ${JSON.stringify(compiled.fatal || { reviewWork: compiled.reviewWork?.length, verifier: compiled.verifier })}`);
assert.equal(compiled.publicationAuthority, "ACCEPTABLE");
assert.equal(compiled.verifier?.ok, true);
const canonicalSource = compiled.canonicalAuthority?.compilerInput;
assert.ok(canonicalSource?.version && !canonicalSource.versions, "compiler must emit one canonical recurring source");
const activeAssignments = compiled.weeklyAssignments.filter((row) => row.status === "ASSIGNED");
const vacancyAssignments = compiled.weeklyAssignments.filter((row) => row.status === "OPEN" && rawCompilerInput.versions[0].vacantSlotIds.includes(row.baselineSlotId));
assert.ok(activeAssignments.length > 0 && vacancyAssignments.length > 0, "the source must distinguish staffed work from visible vacancy work");
assert.equal(compiled.reviewWork.length, 0, "vacant-position work is truthful OPEN work, not a false manager error");

// Prove the exact source template survives the intended roster transition.
// These deterministic identities exist only in this isolated compiler check;
// production creates fresh employee and Messenger identities in the named
// manager transaction before the draft is compiled and published.
const postFillInput = clone(canonicalSource);
postFillInput.serviceDate = EFFECTIVE_DATE;
postFillInput.versions = [postFillInput.version]; delete postFillInput.version;
const postFillNames = new Set(["Kaili Michaelson", "Gregory Staples"]);
const remainingVacantSlotIds = [...rosterAuthority.values()].filter((row) => row.remainsVacantAtPublication).map((row) => row.slotId);
for (const owner of rosterAuthority.values()) if (postFillNames.has(owner.sourceName)) {
  postFillInput.slots.find((slot) => slot.id === owner.slotId).incumbencies = [{
    personId: deterministicUuid(`post-fill-verification-person:${owner.sourceName}`),
    displayName: owner.sourceName, effectiveStart: EFFECTIVE_DATE, effectiveEnd: null,
  }];
  for (const availability of postFillInput.versions[0].slotAvailability.filter((row) => row.slotId === owner.slotId)) availability.status = "working";
}
postFillInput.versions[0].vacantSlotIds = remainingVacantSlotIds;
const postFillCompiled = await compileStaticWeeklySchedule(postFillInput);
assert.equal(postFillCompiled.status, "FEASIBLE", `post-fill schedule rejected: ${JSON.stringify(postFillCompiled.fatal || postFillCompiled.verifier)}`);
assert.equal(postFillCompiled.verifier?.ok, true);
assert.equal(postFillCompiled.reviewWork.length, 0);
const postFillSlotIds = new Set([...rosterAuthority.values()].filter((row) => postFillNames.has(row.sourceName)).map((row) => row.slotId));
assert.ok(postFillCompiled.weeklyAssignments.filter((row) => postFillSlotIds.has(row.baselineSlotId)).every((row) => row.status === "ASSIGNED"), "Kaili and Gregory work must activate after their named fills");
assert.ok(postFillCompiled.openWork.length > 0 && postFillCompiled.openWork.every((row) => remainingVacantSlotIds.includes(row.baselineSlotId)), "only Employee 1, 2, and 4 remain OPEN after the named fills");

const rosterSlots = [...rosterAuthority.values()].map((row) => ({
  slotId: row.slotId, personId: row.personId, displayName: row.displayName,
  slotLabel: row.slotLabel, availabilityState: row.activeVacancy ? "vacant_unfilled" : "working",
  shift: row.shift, lunch: row.lunch, days: row.workDays,
}));
const evidenceFiles = {
  weightedPdf: fixture.source.path,
  extractedFixture: FIXTURE,
  priorAcceptedFamilyAuthority: PRIOR_PACKET,
  parser: path.join(BACKEND, "scripts/extract-weighted-static-weekly-pdf.mjs"),
  generator: path.join(BACKEND, "scripts/generate-weighted-static-weekly-schedule-packet.mjs"),
  program: path.join(BACKEND, "src/static-weekly-schedule-program.js"),
  verifier: path.join(BACKEND, "src/static-weekly-schedule-verifier.js"),
  importer: path.join(BACKEND, "scripts/static-weekly-schedule-candidate-importer.mjs"),
};
const packet = {
  packetSchema: "memphis-zoo.static-weekly.verified-schedule-packet.v1",
  publicationAuthority: "VERIFIED_SERVER_PACKET",
  taskId: TASK_ID, projectId: PROJECT_ID, effectiveDate: EFFECTIVE_DATE, sourceId,
  compilerInput: canonicalSource, rosterSlots, directedProximity: canonicalSource.proximity,
  acceptedRoutes: canonicalSource.version.slotAvailability.map((row) => ({ slotId: row.slotId, dayOfWeek: row.dayOfWeek, status: row.status, startLocationId: row.acceptedRouteAnchorLocationId, provenance: row.acceptedRouteProvenance })),
  serviceEffort: canonicalSource.version.assignments.map((row) => ({ workId: row.workId, dayOfWeek: row.dayOfWeek, workloadPoints: row.serviceEffortMinutes, unit: "dimensionless_production_workload_points", provenance: row.serviceEffortProvenance })),
  capacity: canonicalSource.version.slotAvailability.map((row) => ({ slotId: row.slotId, dayOfWeek: row.dayOfWeek, status: row.status, shift: row.shift, lunch: row.lunch, maxDutyMinutes: row.maxDutyMinutes, maxServiceEffortMinutes: row.maxServiceEffortMinutes, provenance: row.productiveCapacityProvenance })),
  sourceDigest: postgresJsonbContentDigest(canonicalSource), verifiedAt: new Date().toISOString(), verifiedBy: `Production Manager ${TASK_ID}`,
  evidence: Object.entries(evidenceFiles).map(([kind, file]) => ({ kind, path: file, sha256: fileHash(file) })),
  verification: {
    compilerVersion: compiled.compilerVersion, verifierVersion: compiled.verifier.verifierVersion, verifierOk: true,
    replayDigest: compiled.replayDigest, sourcePdfSha256: fixture.source.sha256,
    staffedPositions: rosterSlots.filter((row) => row.availabilityState === "working").length,
    vacancyCapablePositions: rosterSlots.filter((row) => row.availabilityState === "vacant_unfilled").length,
    intendedPostCreationNamedFills: ["Kaili Michaelson", "Gregory Staples"],
    intendedRemainingVacancies: ["Employee 1", "Employee 2", "Employee 4"],
    recurringAssignments: canonicalSource.version.assignments.length,
    assignedAtSourceVerification: activeAssignments.length, openForVacancyAtSourceVerification: vacancyAssignments.length,
    assignedAfterNamedFillSimulation: postFillCompiled.weeklyAssignments.filter((row) => row.status === "ASSIGNED").length,
    openAfterNamedFillSimulation: postFillCompiled.openWork.length,
    maximumDailyWorkloadPoints, routePolicy: "EMPLOYEE_CHOOSES_PRACTICAL_ROUTE_RESTROOMS_DISPLAYED_FIRST",
    lunchPolicy: clone(fixture.policy.lunchAuthority),
    lunchCoverage: fixture.days.map((day) => ({ dayOfWeek: day.dayOfWeek, dayName: day.dayName, ...day.coverage })),
    lunchOptimization,
    sourceTransition: "CREATE_FIVE_EMPTY_STABLE_POSITIONS_THEN_FILL_KAILI_AND_GREGORY_BEFORE_DRAFT_PUBLICATION",
  },
};
assert.equal(postgresJsonbContentDigest(packet.compilerInput), packet.sourceDigest);
const registration = await prepareStaticWeeklyRegistrationArtifact(packet);
assert.equal(registration.ok, true, `verified packet registration refused: ${registration.errors.join(",")}`);
assert.equal(registration.admissibleForRegistration, true);
assert.equal(registration.registration.sourceDigest, packet.sourceDigest);
fs.writeFileSync(OUTPUT, `${JSON.stringify(packet, null, 2)}\n`, { mode: 0o600, flag: "wx" });
process.stdout.write(`${JSON.stringify({ output: OUTPUT, sha256: fileHash(OUTPUT), sourceId, sourceDigest: packet.sourceDigest, replayDigest: compiled.replayDigest, verification: packet.verification })}\n`);
