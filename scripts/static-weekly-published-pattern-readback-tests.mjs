#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import { currentPatternFromPublishedReadback } from "../src/static-weekly-recurring-staffing-adaptation.js";

const packetPath = process.env.STATIC_WEEKLY_TEST_SIX_PACKET;
assert.ok(packetPath, "frozen six-person authority packet required");
const input = JSON.parse(fs.readFileSync(packetPath)).compilerInput;
const templateConfig = JSON.parse(fs.readFileSync(new URL("../config/custodial-six-person-static-20260926.json", import.meta.url)));
const fullOwners = JSON.parse(fs.readFileSync(new URL("../config/custodial-full-nine-family-owners-20260926.json", import.meta.url))).owners;
const effectiveDate = templateConfig.effectiveDate;
const publicationId = "11111111-1111-4111-8111-111111111111";
const publishedSource = { source_id: "22222222-2222-4222-8222-222222222222",
  publication_id: publicationId, authority_revision: 42, compiler_input: input };
const managerSnapshot = { week_start: effectiveDate, authority_revision: 42,
  current_publication: { publication_id: publicationId },
  roster: Object.values(templateConfig.slots).map((slot) => ({
    slot_id: slot.slotId, contractor_capacity: false,
    incumbencies: slot.vacancy ? [] : [{ person_id: slot.personId, person_name: slot.name,
      effective_start: slot.history?.at(-1)?.start || "2020-01-01", effective_end: null }],
    week_staffing: slot.workDays.map((day) => ({ service_date: new Date(Date.parse(`${effectiveDate}T00:00:00Z`)
      + ((day + 6) % 7) * 86400000).toISOString().slice(0, 10),
      person_id: slot.personId, employee_active: slot.vacancy ? null : true })),
  })) };
const args = { publishedSource, managerSnapshot, templateConfig, fullOwners,
  effectiveDate, expectedRevision: 42 };
let checks = 0;
const result = currentPatternFromPublishedReadback(args);
assert.equal(result.source, "AUTHORITY_READBACK_ONLY"); checks++;
assert.deepEqual(result.currentConfig.overrides, templateConfig.overrides); checks++;
assert.deepEqual(result.currentConfig.slots.KATHY.personId, templateConfig.slots.KATHY.personId); checks++;
assert.throws(() => currentPatternFromPublishedReadback({ ...args,
  publishedSource: { ...publishedSource, authority_revision: 41 } }), /revision changed/); checks++;
assert.throws(() => currentPatternFromPublishedReadback({ ...args,
  managerSnapshot: { ...managerSnapshot, current_publication: { publication_id: "33333333-3333-4333-8333-333333333333" } } }),
  /publication changed/); checks++;
const duplicate = structuredClone(publishedSource);
duplicate.compiler_input.version.assignments.push(structuredClone(duplicate.compiler_input.version.assignments[0]));
assert.throws(() => currentPatternFromPublishedReadback({ ...args, publishedSource: duplicate }),
  /duplicate family/); checks++;
const duplicateSlot = structuredClone(publishedSource);
duplicateSlot.compiler_input.slots.push(structuredClone(duplicateSlot.compiler_input.slots[0]));
assert.throws(() => currentPatternFromPublishedReadback({ ...args, publishedSource: duplicateSlot }),
  /duplicate positions/); checks++;
const invalidDay = structuredClone(publishedSource);
invalidDay.compiler_input.version.assignments[0].dayOfWeek = 7;
assert.throws(() => currentPatternFromPublishedReadback({ ...args, publishedSource: invalidDay }),
  /assignment day invalid/); checks++;
const missing = structuredClone(publishedSource);
missing.compiler_input.version.assignments.pop();
assert.throws(() => currentPatternFromPublishedReadback({ ...args, publishedSource: missing }),
  /assignment count changed/); checks++;
const oldOwner = structuredClone(publishedSource);
const firstDay = oldOwner.compiler_input.version.assignments[0].dayOfWeek;
oldOwner.compiler_input.version.assignments[0].ownerSlotId = Object.values(templateConfig.slots)
  .find((slot) => !slot.workDays.includes(firstDay)).slotId;
assert.throws(() => currentPatternFromPublishedReadback({ ...args, publishedSource: oldOwner }),
  /published owner unavailable/); checks++;
const separated = structuredClone(managerSnapshot);
separated.roster.find((row) => row.slot_id === templateConfig.slots.KAREN.slotId).incumbencies = [];
const oldPublished = structuredClone(publishedSource);
oldPublished.compiler_input.slots.find((row) => row.id === templateConfig.slots.KAREN.slotId).incumbencies = [];
const prior = currentPatternFromPublishedReadback({ ...args,
  publishedSource: oldPublished, managerSnapshot: separated });
assert.equal(prior.currentConfig.slots.KAREN.vacancy, true);
assert.ok(Object.values(prior.currentConfig.overrides).some((day) =>
  Object.values(day).some((phase) => phase.KAREN?.length)),
"immutable old ownership remains available as prior geography, never current eligibility"); checks++;
const hired = structuredClone(managerSnapshot);
const newPerson = "12345678-1234-4234-8234-123456789ab1";
const hiredRow = hired.roster.find((row) => row.slot_id === templateConfig.slots.OPTION1.slotId);
hiredRow.incumbencies = [{ person_id: newPerson, person_name: "Synthetic New Hire",
  effective_start: effectiveDate, effective_end: null }];
for (const row of hiredRow.week_staffing) { row.person_id = newPerson; row.employee_active = true; }
assert.throws(() => currentPatternFromPublishedReadback({ ...args, managerSnapshot: hired }),
  /published roster occupancy changed/, "stale source hydration cannot be used with a new hire"); checks++;
const hydrated = structuredClone(publishedSource);
hydrated.compiler_input.slots.find((row) => row.id === templateConfig.slots.OPTION1.slotId)
  .incumbencies.push({ personId: newPerson, displayName: "Synthetic New Hire",
    effectiveStart: effectiveDate, effectiveEnd: null });
const seven = currentPatternFromPublishedReadback({ ...args, publishedSource: hydrated, managerSnapshot: hired });
assert.equal(seven.currentConfig.slots.OPTION1.personId, newPerson); checks++;
assert.equal(seven.currentConfig.overrides["1"].morning.OPTION1, undefined,
  "a new hire is current roster identity, not fabricated prior area ownership"); checks++;
console.log(JSON.stringify({ status: "PASS", checks, source: "synthetic wrapper over frozen source",
  liveReadback: false, managerPreview: "NOT IMPLEMENTED", productionWritten: false }));
