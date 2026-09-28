#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { adaptRegisteredRecurringSource, currentPatternFromPublishedReadback,
  deriveRecurringStaffingPattern } from "../src/static-weekly-recurring-staffing-adaptation.js";
import { compileStaticWeeklySchedule, postgresJsonbContentDigest } from "../src/static-weekly-schedule-compiler.js";

const packetPath = process.env.STATIC_WEEKLY_TEST_SIX_PACKET;
assert.ok(packetPath, "point this isolated test at the exact frozen V3 six-person packet");
const packet = JSON.parse(fs.readFileSync(packetPath));
assert.equal(packet.packetSchema, "memphis-zoo.static-weekly.verified-schedule-packet.v1");
const require = createRequire(import.meta.url);
const highs = await require("highs")({});
const six = JSON.parse(fs.readFileSync(new URL("../config/custodial-six-person-static-20260926.json", import.meta.url)));
const full = JSON.parse(fs.readFileSync(new URL("../config/custodial-recurring-schedule-20260924.json", import.meta.url)));
const owners = JSON.parse(fs.readFileSync(new URL("../config/custodial-full-nine-family-owners-20260926.json", import.meta.url))).owners;
const count = Number(process.env.STATIC_WEEKLY_ADAPT_COUNT || 7);
assert.ok([7,8,9].includes(count), "candidate staffing count must be seven, eight or nine");
const target = structuredClone(six.slots);
const choices = ["OPTION1", "OPTION2", "OPTION4"];
for (let i = 0; i < count - 6; i += 1) {
  const key = choices[i], newPerson = `12345678-1234-4234-8234-123456789ab${i + 1}`;
  target[key].vacancy = false;
  target[key].personId = newPerson;
  target[key].name = `Synthetic New Hire ${i + 1}`;
  target[key].history = [...(target[key].history || []),
    { personId: newPerson, name: target[key].name, start: six.effectiveDate, end: null }];
}
const hydrated = structuredClone(packet.compilerInput);
for (let i = 0; i < count - 6; i += 1) {
  const key = choices[i], newSlot = hydrated.slots.find((row) => row.id === target[key].slotId);
  assert.ok(newSlot);
  newSlot.incumbencies.push({ personId: target[key].personId, displayName: target[key].name,
    effectiveStart: six.effectiveDate, effectiveEnd: null });
}
const publicationId = "11111111-1111-4111-8111-111111111111";
const publishedReadback = { source_id: "22222222-2222-4222-8222-222222222222",
  publication_id: publicationId, authority_revision: 42, compiler_input: hydrated };
const managerSnapshot = { week_start: six.effectiveDate, authority_revision: 42,
  current_publication: { publication_id: publicationId },
  roster: Object.values(target).map((slot) => ({
    slot_id: slot.slotId, contractor_capacity: false,
    incumbencies: slot.vacancy ? [] : [{ person_id: slot.personId, person_name: slot.name,
      effective_start: slot.history?.at(-1)?.start || "2020-01-01", effective_end: null }],
    week_staffing: slot.workDays.map((day) => ({ service_date: new Date(Date.parse(`${six.effectiveDate}T00:00:00Z`)
      + ((day + 6) % 7) * 86400000).toISOString().slice(0, 10),
      person_id: slot.personId, employee_active: slot.vacancy ? null : true })),
  })) };
const bound = currentPatternFromPublishedReadback({ publishedSource: publishedReadback,
  managerSnapshot, templateConfig: six, fullOwners: owners,
  effectiveDate: six.effectiveDate, expectedRevision: 42 });
const pattern = deriveRecurringStaffingPattern({ currentConfig: bound.currentConfig,
  targetSlots: bound.currentConfig.slots, fullOwners: owners, fullConfig: full, highs }).config;
let fullNineSource = null;
if (count === 9) {
  fullNineSource = structuredClone(JSON.parse(fs.readFileSync(full.basePacket.path)).compilerInput);
  for (const slot of Object.values(target)) {
    const row = fullNineSource.slots.find((item) => item.id === slot.slotId);
    assert.ok(row);
    row.incumbencies = [{ personId: slot.personId, displayName: slot.name,
      effectiveStart: six.effectiveDate, effectiveEnd: null }];
  }
}
const candidate = adaptRegisteredRecurringSource({ registeredSource: hydrated,
  patternConfig: pattern, fullNineSource });
assert.equal(candidate.status, "CANDIDATE_ONLY");
assert.equal(candidate.compilerInput.version.assignments.length, count === 9
  ? 313 : hydrated.version.assignments.length);
assert.equal(candidate.compilerInput.version.vacantSlotIds.length, 9 - count);
assert.equal(candidate.compilerInput.version.assignments.some((row) => row.ownerSlotId === target.OPTION1.slotId), true);
assert.equal(hydrated.version.assignments.some((row) => row.ownerSlotId === target.OPTION1.slotId), false,
  "source must remain immutable");
const compileInput = structuredClone(candidate.compilerInput);
compileInput.versions = [compileInput.version];
delete compileInput.version;
const compiled = await compileStaticWeeklySchedule(compileInput);
assert.equal(compiled.status, "FEASIBLE", JSON.stringify(compiled.fatal || compiled.reviewWork || compiled.verifier));
assert.equal(compiled.publicationAuthority, "ACCEPTABLE");
assert.equal(compiled.verifier?.ok, true);
assert.equal(compiled.reviewWork.length, 0);
console.log(JSON.stringify({ status: "PASS", checks: 12,
  staffed: count, assignments: candidate.compilerInput.version.assignments.length,
  inputSourceDigest: packet.sourceDigest,
  candidateSourceDigest: postgresJsonbContentDigest(candidate.compilerInput),
  patternFingerprint: candidate.patternFingerprint,
  readbackPatternDigest: postgresJsonbContentDigest(bound.currentConfig),
  runtimeSourceIsRegisteredReadback: false, syntheticPublishedReadbackBoundary: true,
  candidateOnly: true, publication: "NOT IMPLEMENTED", productionWritten: false }));
