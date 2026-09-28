#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { deriveRecurringStaffingPattern } from "../src/static-weekly-recurring-staffing-adaptation.js";

const require = createRequire(import.meta.url);
const highs = await require("highs")({});
const six = JSON.parse(fs.readFileSync(new URL("../config/custodial-six-person-static-20260926.json", import.meta.url)));
const full = JSON.parse(fs.readFileSync(new URL("../config/custodial-recurring-schedule-20260924.json", import.meta.url)));
const fullOwners = JSON.parse(fs.readFileSync(new URL("../config/custodial-full-nine-family-owners-20260926.json", import.meta.url))).owners;
const options = ["OPTION1", "OPTION2", "OPTION4"];
let checks = 0;

function filled(keys) {
  const target = structuredClone(six.slots);
  for (const key of keys) {
    const number = options.indexOf(key) + 1;
    const personId = `12345678-1234-4234-8234-123456789ab${number}`;
    const name = `Synthetic New Hire ${number}`;
    target[key].vacancy = false;
    target[key].personId = personId;
    target[key].name = name;
    target[key].history = [...(target[key].history || []), { personId, name, start: "2026-09-28", end: null }];
  }
  return target;
}

function verify(current, keys, expectedCount) {
  const target = filled(keys);
  const result = deriveRecurringStaffingPattern({ currentConfig: current, targetSlots: target, fullOwners, highs });
  assert.equal(result.preview.length, 14);
  assert.equal(Object.values(result.config.slots).filter((slot) => slot.vacancy !== true).length, expectedCount);
  assert.deepEqual(Object.keys(result.config.slots).sort(), Object.keys(six.slots).sort());
  for (let day = 0; day < 7; day += 1) for (const phase of ["morning", "equalized"]) {
    const before = current.overrides[String(day)][phase];
    const after = result.config.overrides[String(day)][phase];
    assert.deepEqual(Object.values(after).flat().sort(), Object.values(before).flat().sort(), `same physical work ${day}/${phase}`);
    const active = Object.entries(target).filter(([, slot]) => slot.vacancy !== true && slot.workDays.includes(day)).map(([key]) => key);
    assert.deepEqual(Object.keys(after).sort(), active.sort(), `every working position ${day}/${phase}`);
    const loads = Object.values(after).map((families) => families.reduce((sum, family) => sum + six.weights[family], 0));
    const restroom = Object.values(after).map((families) => families.filter((family) => six.publicRestroomFamilies.includes(family)).length);
    assert.ok(Math.max(...restroom) - Math.min(...restroom) <= 1, `public-site balance ${day}/${phase}`);
    if (phase === "equalized") assert.ok(Math.max(...loads) - Math.min(...loads) <= 1.5, `weighted balance ${day}/${phase}`);
    for (const [owner, families] of Object.entries(after)) for (const family of families) {
      assert.ok(!target[owner].hardForbiddenFamilies?.includes(family), `hard restriction ${day}/${phase}/${owner}/${family}`);
    }
    checks += 1;
  }
  return result.config;
}

verify(six, [], 6);
for (const key of options) verify(six, [key], 7);
for (const missing of options) verify(six, options.filter((key) => key !== missing), 8);
const nine = deriveRecurringStaffingPattern({ currentConfig: six, targetSlots: filled(options), fullOwners,
  fullConfig: full, highs });
assert.equal(nine.preview[0].pattern, "existing-nine-position-template");
assert.throws(() => deriveRecurringStaffingPattern({ currentConfig: six,
  targetSlots: filled(options), fullOwners, highs }), /approved full nine-position source required/);
assert.deepEqual(nine.config.overrides, full.overrides, "nine staff restore exact approved position template");
assert.deepEqual(nine.config.preserveBaseDays, full.preserveBaseDays);
assert.equal(Object.values(nine.config.slots).filter((slot) => slot.vacancy !== true).length, 9);
checks += 5;
// Removing one incumbent is a NEW candidate, not resurrection of a prior
// person. The real operation must first settle protected work and close the
// incumbent's ledger entry before this pattern can be published.
const eight = verify(six, ["OPTION1", "OPTION2"], 8);
const removed = structuredClone(eight.slots);
removed.OPTION2.vacancy = true;
removed.OPTION2.name = null;
removed.OPTION2.personId = null;
removed.OPTION2.history.at(-1).end = "2026-10-05";
const backToSeven = deriveRecurringStaffingPattern({ currentConfig: eight, targetSlots: removed, fullOwners, highs });
assert.equal(Object.values(backToSeven.config.slots).filter((slot) => slot.vacancy !== true).length, 7);
assert.equal(backToSeven.preview.length, 14);
checks += 2;
const nineToEightSlots = structuredClone(nine.config.slots);
nineToEightSlots.OPTION2.vacancy = true;
nineToEightSlots.OPTION2.name = null;
nineToEightSlots.OPTION2.personId = null;
nineToEightSlots.OPTION2.history.at(-1).end = "2026-10-05";
const nineToEight = deriveRecurringStaffingPattern({ currentConfig: nine.config,
  targetSlots: nineToEightSlots, fullOwners, fullConfig: full, highs });
assert.equal(Object.values(nineToEight.config.slots).filter((slot) => slot.vacancy !== true).length, 8);
assert.equal(nineToEight.preview.length, 14);
assert.deepEqual(nineToEight.config.preserveBaseDays, []);
checks += 3;
for (let day = 0; day < 7; day += 1) for (const phase of ["morning", "equalized"]) {
  const after = nineToEight.config.overrides[String(day)][phase];
  assert.deepEqual(Object.values(after).flat().sort(), Object.keys(fullOwners[String(day)][phase]).sort(),
    `nine-to-eight physical family coverage ${day}/${phase}`);
  const loads = Object.values(after).map((families) => families.reduce((sum, family) => sum + six.weights[family], 0));
  const sites = Object.values(after).map((families) => families.filter((family) => six.publicRestroomFamilies.includes(family)).length);
  assert.ok(Math.max(...sites) - Math.min(...sites) <= 1, `nine-to-eight site balance ${day}/${phase}`);
  if (phase === "equalized") assert.ok(Math.max(...loads) - Math.min(...loads) <= 1.5,
    `nine-to-eight weighted balance ${day}/${phase}`);
  for (const [owner, families] of Object.entries(after)) for (const family of families) {
    assert.ok(!nineToEightSlots[owner].hardForbiddenFamilies?.includes(family),
      `nine-to-eight hard restriction ${day}/${phase}/${owner}/${family}`);
  }
  checks += 1;
}
assert.throws(() => deriveRecurringStaffingPattern({ currentConfig: six, targetSlots: { ...six.slots, OPTION1: undefined }, fullOwners, highs }));
checks += 1;
const duplicatePerson = filled(["OPTION1"]);
duplicatePerson.OPTION1.personId = duplicatePerson.KAREN.personId;
assert.throws(() => deriveRecurringStaffingPattern({ currentConfig: six,
  targetSlots: duplicatePerson, fullOwners, highs }), /one current employee may occupy only one position/);
checks += 1;
console.log(JSON.stringify({ status: "PASS", checks, staffingCounts: [6,7,8,9],
  transitions: ["six baseline", "three seven-person choices", "three eight-person choices", "exact full-nine pattern", "eight to seven removal", "nine to eight removal"],
  productionWritten: false, managerPublication: "NOT IMPLEMENTED", protectedWorkTransition: "NOT IMPLEMENTED" }));
