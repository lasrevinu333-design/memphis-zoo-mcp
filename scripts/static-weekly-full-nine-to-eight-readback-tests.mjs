#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { adaptRegisteredRecurringSource, currentPatternFromPublishedReadback,
  deriveRecurringStaffingPattern } from "../src/static-weekly-recurring-staffing-adaptation.js";
import { compileStaticWeeklySchedule, postgresJsonbContentDigest } from "../src/static-weekly-schedule-compiler.js";
import { createStaticWeeklyLunchPreviewDocument } from "../src/static-weekly-lunch-publication.js";
import { assertRecurringManagerDecision, assertRecurringAdmissionCandidate, createRecurringManagerDecision } from "../src/static-weekly-recurring-preview.js";
import { createStaticWeeklyCompilerRuntime } from "../src/static-weekly-schedule-compiler-runtime.js";

const require = createRequire(import.meta.url);
const highs = await require("highs")({});
const six = JSON.parse(fs.readFileSync(new URL("../config/custodial-six-person-static-20260926.json", import.meta.url)));
const full = JSON.parse(fs.readFileSync(new URL("../config/custodial-recurring-schedule-20260924.json", import.meta.url)));
const owners = JSON.parse(fs.readFileSync(new URL("../config/custodial-full-nine-family-owners-20260926.json", import.meta.url))).owners;
const fullSource = structuredClone(JSON.parse(fs.readFileSync(full.basePacket.path)).compilerInput);
const target = structuredClone(six.slots);
for (const [index, key] of ["OPTION1", "OPTION2", "OPTION4"].entries()) {
  const slot = target[key];
  slot.vacancy = false;
  slot.personId = `12345678-1234-4234-8234-123456789ab${index + 1}`;
  slot.name = `Synthetic New Hire ${index + 1}`;
  slot.history = [...(slot.history || []),
    { personId: slot.personId, name: slot.name, start: six.effectiveDate, end: null }];
}
for (const slot of Object.values(target)) {
  const sourceSlot = fullSource.slots.find((row) => row.id === slot.slotId);
  assert.ok(sourceSlot, `source position ${slot.slotId}`);
  sourceSlot.incumbencies = [{ personId: slot.personId, displayName: slot.name,
    effectiveStart: six.effectiveDate, effectiveEnd: null }];
}
const ninePattern = deriveRecurringStaffingPattern({ currentConfig: six,
  targetSlots: target, fullOwners: owners, fullConfig: full, highs }).config;
const nine = adaptRegisteredRecurringSource({ registeredSource: fullSource,
  patternConfig: ninePattern, fullNineSource: fullSource }).compilerInput;
assert.equal(nine.version.assignments.length, 313);
assert.equal(nine.version.assignments.filter((row) => row.locationCodeSnapshot === "PRIMATE_CANYON").length > 0, true);
const separated = structuredClone(target);
separated.OPTION2.vacancy = true;
separated.OPTION2.personId = null;
separated.OPTION2.name = null;
const sourceAfterSeparation = structuredClone(nine);
sourceAfterSeparation.slots.find((row) => row.id === separated.OPTION2.slotId).incumbencies = [];
const publicationId = "11111111-1111-4111-8111-111111111111";
const publishedSource = { source_id: "22222222-2222-4222-8222-222222222222",
  publication_id: publicationId, authority_revision: 42, compiler_input: sourceAfterSeparation };
const managerSnapshot = { week_start: six.effectiveDate, authority_revision: 42,
  current_publication: { publication_id: publicationId },
  roster: Object.values(separated).map((slot) => ({
    slot_id: slot.slotId, contractor_capacity: false,
    incumbencies: slot.vacancy ? [] : [{ person_id: slot.personId, person_name: slot.name,
      effective_start: slot.history?.at(-1)?.start || "2020-01-01", effective_end: null }],
    week_staffing: slot.workDays.map((day) => ({ service_date: new Date(Date.parse(`${six.effectiveDate}T00:00:00Z`)
      + ((day + 6) % 7) * 86400000).toISOString().slice(0, 10),
      person_id: slot.personId, employee_active: slot.vacancy ? null : true })),
  })) };
const bound = currentPatternFromPublishedReadback({ publishedSource, managerSnapshot,
  templateConfig: six, fullConfig: full, fullOwners: owners,
  effectiveDate: six.effectiveDate, expectedRevision: 42 });
assert.equal(bound.sourcePatternKind, "FULL_NINE");
assert.equal(bound.currentConfig.slots.OPTION2.vacancy, true);
assert.deepEqual(bound.currentConfig.overrides, full.overrides);
const eightSolved = deriveRecurringStaffingPattern({ currentConfig: bound.currentConfig,
  targetSlots: bound.currentConfig.slots, fullOwners: owners, fullConfig: full, highs });
const eightPattern = eightSolved.config;
assert.throws(() => adaptRegisteredRecurringSource({ registeredSource: sourceAfterSeparation,
  patternConfig: eightPattern }), /source splits one family/);
const eight = adaptRegisteredRecurringSource({ registeredSource: sourceAfterSeparation,
  patternConfig: eightPattern, allowSplitSource: true }).compilerInput;
assert.equal(eight.version.assignments.length, 312);
assert.equal(eight.version.assignments.some((row) => row.ownerSlotId === separated.OPTION2.slotId), false);
assert.equal(sourceAfterSeparation.version.assignments.some((row) => row.ownerSlotId === separated.OPTION2.slotId), true,
  "old published work must remain as immutable historical source");
const compilerInput = structuredClone(eight);
compilerInput.versions = [compilerInput.version];
delete compilerInput.version;
const compiled = await compileStaticWeeklySchedule(compilerInput);
assert.equal(compiled.status, "FEASIBLE", JSON.stringify(compiled.fatal || compiled.reviewWork || compiled.verifier));
assert.equal(compiled.publicationAuthority, "ACCEPTABLE");
assert.equal(compiled.verifier?.ok, true);
assert.equal(compiled.reviewWork.length, 0);
let sevenDigest = null;
if (process.env.STATIC_WEEKLY_TEST_CHAIN_EIGHT_TO_SEVEN === "1") {
  const sevenSlots = structuredClone(separated);
  sevenSlots.OPTION4.vacancy = true;
  sevenSlots.OPTION4.personId = null;
  sevenSlots.OPTION4.name = null;
  const publishedEight = structuredClone(eight);
  publishedEight.slots.find((row) => row.id === sevenSlots.OPTION4.slotId).incumbencies = [];
  const snapshotSeven = structuredClone(managerSnapshot);
  const departed = snapshotSeven.roster.find((row) => row.slot_id === sevenSlots.OPTION4.slotId);
  departed.incumbencies = [];
  for (const day of departed.week_staffing) { day.person_id = null; day.employee_active = null; }
  const boundEight = currentPatternFromPublishedReadback({
    publishedSource: { ...publishedSource, compiler_input: publishedEight },
    managerSnapshot: snapshotSeven, templateConfig: six, fullConfig: full,
    fullOwners: owners, effectiveDate: six.effectiveDate, expectedRevision: 42,
  });
  assert.equal(boundEight.sourcePatternKind, "UNSPLIT");
  assert.equal(boundEight.currentConfig.slots.OPTION4.vacancy, true);
  const sevenPattern = deriveRecurringStaffingPattern({ currentConfig: boundEight.currentConfig,
    targetSlots: boundEight.currentConfig.slots, fullOwners: owners, fullConfig: full, highs }).config;
  const seven = adaptRegisteredRecurringSource({ registeredSource: publishedEight,
    patternConfig: sevenPattern }).compilerInput;
  assert.equal(seven.version.assignments.length, 312);
  assert.equal(seven.version.assignments.some((row) => row.ownerSlotId === sevenSlots.OPTION4.slotId), false);
  const compileSeven = structuredClone(seven);
  compileSeven.versions = [compileSeven.version];
  delete compileSeven.version;
  const acceptedSeven = await compileStaticWeeklySchedule(compileSeven);
  assert.equal(acceptedSeven.status, "FEASIBLE", JSON.stringify(acceptedSeven.fatal || acceptedSeven.reviewWork));
  assert.equal(acceptedSeven.publicationAuthority, "ACCEPTABLE");
  assert.equal(acceptedSeven.verifier?.ok, true);
  assert.equal(acceptedSeven.reviewWork.length, 0);
  sevenDigest = postgresJsonbContentDigest(seven);
}
const runtime = createStaticWeeklyCompilerRuntime();
let admissionChecks = 0;
try {
  const isolated = await runtime.prepareRecurringCandidate({ publishedSource, managerSnapshot,
    effectiveDate: six.effectiveDate, expectedRevision: 42 });
  assert.equal(isolated.status, "CANDIDATE_ONLY");
  assert.equal(isolated.candidateSourceDigest, postgresJsonbContentDigest(eight),
    "isolated production worker must match the direct source-bound candidate");
  assert.equal(isolated.modelBasisDigest, compiled.certificate.modelBasisDigest);
  assert.equal(isolated.assignmentWitnessDigest, compiled.certificate.assignmentDigest);
  assert.equal(isolated.finalWitnessDigest, compiled.certificate.finalWitness.digest);
  assert.equal(isolated.weeklyAssignmentsDigest, postgresJsonbContentDigest(compiled.weeklyAssignments));
  assert.equal(isolated.metricsDigest, postgresJsonbContentDigest(compiled.metrics));
  const directLunch = createStaticWeeklyLunchPreviewDocument(compiled);
  assert.equal(isolated.lunchFactsDigest, postgresJsonbContentDigest({
    loans: directLunch.loans, responsibilities: directLunch.responsibilities,
    notificationIntents: directLunch.notification_intents,
  }), "manager preview lunch facts must equal the direct verified compiler result");
  assert.equal(isolated.lunchLoanCount, directLunch.loans.length);
  assert.equal(isolated.openWorkDigest, postgresJsonbContentDigest(compiled.openWork));
  assert.equal(isolated.openWorkCount, compiled.openWork.length);
  assert.equal(isolated.shiftEndDerivationDigest,
    postgresJsonbContentDigest(compiled.canonicalAuthority.shiftEndDerivation || null));
  assertRecurringManagerDecision(isolated);
  const directDecision = createRecurringManagerDecision({ candidateInput: eight, compiled,
    lunch: directLunch, changes: eightSolved.preview });
  assert.deepEqual(isolated.decision, directDecision,
    "opening/09:45/closing ownership, gaps and lunch must match across runtime boundaries");
  assert.equal(isolated.decisionDigest, postgresJsonbContentDigest(directDecision));
  assert.equal(isolated.staffedPositions, 8);
  assert.equal(isolated.assignmentCount, 312);
  assert.equal(Object.hasOwn(isolated, 'canonicalSource'), false); admissionChecks++;
  const privateReply = await runtime.prepareRecurringAdmissionCandidate({ publishedSource, managerSnapshot,
    effectiveDate: six.effectiveDate, expectedRevision: 42 });
  assertRecurringAdmissionCandidate(privateReply); admissionChecks++;
  assert.deepEqual(privateReply.candidate, isolated,
    'private admission uses exactly the manager-visible verified candidate'); admissionChecks++;
  assert.deepEqual(privateReply.canonicalSource, eight,
    'server insertion bytes equal the source-bound canonical candidate'); admissionChecks++;
  const before = postgresJsonbContentDigest(privateReply);
  for (const mutate of [
    r => { r.canonicalSource.version.assignments[0].ownerSlotId = 'forged'; },
    r => { r.canonicalSource.serviceDate = '2026-10-12'; },
    r => { r.canonicalSource.version.effectiveStart = '2026-10-12'; },
    r => { r.canonicalSource.version.effectiveEnd = '2026-10-12'; },
    r => { r.canonicalSource.exceptions = [{type:'daily_absence'}]; },
    r => { r.canonicalSource.version.namedAbsentSlotIds = ['forged']; },
    r => { r.candidate.registrationRequired = false; },
    r => { r.candidate.managerConfirmationRequired = false; },
  ]) {
    const hostile = structuredClone(privateReply); mutate(hostile);
    assert.throws(() => assertRecurringAdmissionCandidate(hostile)); admissionChecks++;
  }
  assert.equal(postgresJsonbContentDigest(privateReply), before,
    'hostile proof preserves the accepted private candidate'); admissionChecks++;
} finally {
  await runtime.shutdown();
}
console.log(JSON.stringify({ status: "PASS", checks: sevenDigest ? 38 : 30,
  admissionChecks,
  transition: sevenDigest ? "nine-to-eight-to-seven" : "nine-to-eight",
  sourcePatternKind: bound.sourcePatternKind, assignments: eight.version.assignments.length,
  candidateDigest: postgresJsonbContentDigest(eight), sevenDigest,
  syntheticReadback: true,
  productionWritten: false, managerConfirmation: "NOT IMPLEMENTED" }));
