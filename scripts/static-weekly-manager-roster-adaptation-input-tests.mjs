#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import { targetSlotsFromManagerRoster } from "../src/static-weekly-recurring-staffing-adaptation.js";

const six = JSON.parse(fs.readFileSync(new URL("../config/custodial-six-person-static-20260926.json", import.meta.url)));
const date = six.effectiveDate;
const snapshot = { week_start: date, authority_revision: 42, roster: Object.values(six.slots).map((slot) => ({
  slot_id: slot.slotId, contractor_capacity: false,
  incumbencies: slot.vacancy ? [] : [{ person_id: slot.personId, person_name: slot.name,
    effective_start: slot.history?.at(-1)?.start || "2020-01-01", effective_end: null }],
  week_staffing: slot.workDays.map((day) => ({ service_date: new Date(Date.parse(`${date}T00:00:00Z`)
    + ((day + 6) % 7) * 86400000).toISOString().slice(0, 10), person_id: slot.personId,
    employee_active: slot.vacancy ? null : true })),
})) };
let checks = 0;
const target = targetSlotsFromManagerRoster({ templateConfig: six, managerSnapshot: snapshot, effectiveDate: date, expectedRevision: 42 });
assert.deepEqual(Object.keys(target).sort(), Object.keys(six.slots).sort()); checks++;
assert.equal(Object.values(target).filter((slot) => slot.vacancy !== true).length, 6); checks++;
assert.notEqual(snapshot.roster.find((row) => row.slot_id === six.slots.KATHY.slotId)
  .week_staffing[0].service_date, date, "a Monday-off employee remains a current incumbent"); checks++;
assert.equal(Object.values(target).some((slot) => slot.name === "Maurice Stanton" || slot.name === "Tabitha Masterson"), false); checks++;
const hired = structuredClone(snapshot);
const newPerson = "12345678-1234-4234-8234-123456789ab1";
const option = hired.roster.find((row) => row.slot_id === six.slots.OPTION1.slotId);
option.incumbencies = [{ person_id: newPerson, person_name: "Synthetic New Hire",
  effective_start: date, effective_end: null }];
for (const row of option.week_staffing) { row.person_id = newPerson; row.employee_active = true; }
const seven = targetSlotsFromManagerRoster({ templateConfig: six, managerSnapshot: hired, effectiveDate: date, expectedRevision: 42 });
assert.equal(seven.OPTION1.personId, newPerson); checks++;
assert.equal(seven.OPTION1.history.at(-1).personId, newPerson); checks++;
assert.equal(seven.OPTION1.history[0].end, six.slots.OPTION1.history[0].end); checks++;
assert.throws(() => targetSlotsFromManagerRoster({ templateConfig: six,
  managerSnapshot: { ...hired, roster: [...hired.roster, hired.roster[0]] }, effectiveDate: date, expectedRevision: 42 }),
  /duplicate or unidentified/); checks++;
const inactive = structuredClone(hired);
inactive.roster.find((row) => row.slot_id === six.slots.OPTION1.slotId).week_staffing[0].employee_active = false;
assert.throws(() => targetSlotsFromManagerRoster({ templateConfig: six,
  managerSnapshot: inactive, effectiveDate: date, expectedRevision: 42 }), /employee authority not confirmed/); checks++;
assert.throws(() => targetSlotsFromManagerRoster({ templateConfig: six,
  managerSnapshot: { ...snapshot, week_start: "2026-10-05" }, effectiveDate: date, expectedRevision: 42 }), /week mismatch/); checks++;
assert.throws(() => targetSlotsFromManagerRoster({ templateConfig: six,
  managerSnapshot: snapshot, effectiveDate: date, expectedRevision: 41 }), /revision changed/); checks++;
const datedAbsence = structuredClone(snapshot);
datedAbsence.roster.find((row) => row.slot_id === six.slots.KAREN.slotId).week_staffing[0].availability_state = "daily_absence";
assert.equal(targetSlotsFromManagerRoster({ templateConfig: six,
  managerSnapshot: datedAbsence, effectiveDate: date, expectedRevision: 42 }).KAREN.personId,
  six.slots.KAREN.personId, "dated absence must not permanently vacate the recurring position"); checks++;
const midweekGone = structuredClone(snapshot);
midweekGone.roster.find((row) => row.slot_id === six.slots.KAREN.slotId).week_staffing[1].person_id = null;
assert.throws(() => targetSlotsFromManagerRoster({ templateConfig: six,
  managerSnapshot: midweekGone, effectiveDate: date, expectedRevision: 42 }),
  /current employee authority not confirmed/, "a Monday-only active read cannot authorize a full recurring week"); checks++;
console.log(JSON.stringify({ status: "PASS", checks, source: "synthetic manager roster",
  liveManagerProof: false, publication: "NOT IMPLEMENTED", productionWritten: false }));
