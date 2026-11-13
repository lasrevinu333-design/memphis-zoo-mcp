#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { postgresJsonbContentDigest } from "../src/static-weekly-schedule-program.js";

const root = path.resolve(import.meta.dirname, "..");
const config = JSON.parse(fs.readFileSync(path.join(root, "config/custodial-six-person-static-20260926.json"), "utf8"));
const handout = JSON.parse(fs.readFileSync(path.join(root, "config/custodial-six-person-handout-20260926.json"), "utf8"));
const packetPath = process.env.STATIC_WEEKLY_SIX_PERSON_PACKET;
assert.ok(packetPath, "explicit generated candidate packet required");
const packet = JSON.parse(fs.readFileSync(packetPath, "utf8"));
const source = packet.compilerInput;
let passed = 0;
const check = (name, actual, expected) => { assert.deepEqual(actual, expected, name); passed += 1; };
const vacancyIds = new Set(Object.values(config.slots).filter((slot) => slot.vacancy).map((slot) => slot.slotId));
const bySlot = new Map(Object.entries(config.slots).map(([key, slot]) => [slot.slotId, { key, ...slot }]));
const phaseOf = (row) => row.window.start === "09:45" ? "equalized" : "morning";
check("exact corrected handout SHA", handout.sourceSha256,
  "a1f1dbb6826ba09ff3a81332632c0ba433ed6770e9fb48efc009382eccdfdeb1");
check("candidate source digest", postgresJsonbContentDigest(source), packet.sourceDigest);
check("new publication effective Monday", source.serviceDate, "2026-09-28");
check("nine stable positions", packet.rosterSlots.length, 9);
check("six real incumbents", packet.rosterSlots.filter((slot) => slot.personId).length, 6);
check("three vacant positions", packet.rosterSlots.filter((slot) => !slot.personId).length, 3);
check("all stable employee positions may later become vacant", [...source.version.vacancyCapableSlotIds].sort(),
  Object.values(config.slots).map((slot) => slot.slotId).sort());
check("vacancy identities retained", [...vacancyIds].sort(), [...source.version.vacantSlotIds].sort());
check("vacancies have no recurring cleaning area", source.version.assignments.filter((row) => vacancyIds.has(row.originSlotId)).length, 0);
check("no inspection rows", source.version.assignments.filter((row) => /inspection/i.test(row.locationCodeSnapshot)).length, 0);
check("all seven days replaced", Object.keys(config.overrides).sort(), ["0", "1", "2", "3", "4", "5", "6"]);
check("Monday gift shops only", source.version.assignments.filter((row) => config.mondayOnlyFamilies.includes(row.locationCodeSnapshot))
  .every((row) => row.dayOfWeek === 1 && phaseOf(row) === "morning"), true);
check("Alijah never owns Herpetarium", source.version.assignments.filter((row) => row.locationCodeSnapshot === "HERPETARIUM")
  .some((row) => row.ownerSlotId === config.slots.ALIJAH.slotId), false);
check("Karen's corrected workdays", config.slots.KAREN.workDays, [1, 2, 3, 5, 6]);
check("Gregory's later fixed lunch", config.slots.GREGORY.lunch, ["12:00", "13:00"]);
const publicRestrooms = new Set(config.publicRestroomFamilies);
for (let day = 0; day < 7; day += 1) for (const phase of ["morning", "equalized"]) {
  const rows = source.version.assignments.filter((row) => row.dayOfWeek === day && phaseOf(row) === phase);
  const expected = Object.values(handout.days[String(day)][phase]).flat();
  const actual = rows.map((row) => row.locationCodeSnapshot);
  check(`${day}/${phase} same physical families as handout`, actual.sort(), expected.sort());
  check(`${day}/${phase} exactly one area owner`, new Set(actual).size, actual.length);
  const owners = Object.entries(config.slots).filter(([, slot]) => slot.vacancy !== true && slot.workDays.includes(day));
  const loads = owners.map(([, slot]) => rows.filter((row) => row.ownerSlotId === slot.slotId)
    .reduce((sum, row) => sum + config.weights[row.locationCodeSnapshot], 0));
  const restroomSites = owners.map(([, slot]) => rows.filter((row) => row.ownerSlotId === slot.slotId
    && publicRestrooms.has(row.locationCodeSnapshot)).length);
  check(`${day}/${phase} balanced public restroom sites`, Math.max(...restroomSites) - Math.min(...restroomSites) <= 1, true);
  if (phase === "equalized") check(`${day}/${phase} weighted spread`, Math.max(...loads) - Math.min(...loads) <= 1.5, true);
  for (const row of rows) {
    const owner = bySlot.get(row.ownerSlotId);
    assert.ok(owner && owner.vacancy !== true && owner.workDays.includes(day));
    assert.ok(!owner.hardForbiddenFamilies?.includes(row.locationCodeSnapshot));
  }
  passed += 1;
}
const open = packet.verification.shiftEndDerivation.parentChains.flatMap((chain) => chain.segments)
  .filter((segment) => segment.kind === "open");
check("one honest no-employee closing gap", open.length, 1);
check("Friday Herpetarium gap", open[0].workId.includes("5:HERPETARIUM:equalized:"), true);
check("gap is 15:00-16:00 only", open[0].window, { start: "15:00", end: "16:00" });
check("gap retains vacant position without a fake employee", vacancyIds.has(open[0].ownerSlotId), true);
check("Thursday and Friday end at last real custodian", [4, 5].map((day) => packet.verification.continuityVerification.staffedDepartureByDay[day]), ["16:00", "16:00"]);
check("compiler verifier passed", packet.verification.verifierOk, true);
check("candidate is not production proof", packet.verification.productionWritten, false);
console.log(JSON.stringify({ passed, packetPath, sourceDigest: packet.sourceDigest,
  sourceRows: source.version.assignments.length, vacancySourceRows: 0,
  openGap: open[0].workId, productionWritten: false }));
