#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { canonicalJson, contentDigest } from "../src/static-weekly-schedule-model.js";
import { postgresJsonbContentDigest } from "../src/static-weekly-schedule-compiler.js";
import { createRecurringWeekCommitment, assertRecurringWeekCommitment,
  createRecurringFullNineTemplateCommitment, RECURRING_PHASE_SCOPE,
  RECURRING_FULL_NINE_SCOPE } from
  "../src/static-weekly-recurring-week-commitment.js";
import { createRecurringFinalManagerChanges } from "../src/static-weekly-recurring-preview.js";
import { assertRecurringAdmissionCandidate } from "../src/static-weekly-recurring-preview.js";

const hash = (character) => character.repeat(64);
const digestObject = (body) => ({ ...body, proofDigest: contentDigest(body) });
const descriptor = (dayOfWeek, sourceDigest) => {
  const body = { dayOfWeek, sourceDigest, selectedWorkIds: [`work-${dayOfWeek}`] };
  return { ...body, descriptorDigest: contentDigest(body) };
};
const source = { serviceDate: "2026-10-05", version: { assignments: [
  { dayOfWeek: 0, workId: "morning-0", window: { start: "05:00", end: "09:45" }, ownerSlotId: "old" },
  ...Array.from({ length: 7 }, (_, dayOfWeek) => ({ dayOfWeek, workId: `work-${dayOfWeek}`,
    window: { start: "09:45", end: "16:00" }, ownerSlotId: "old", originSlotId: "old" })),
] } };
const finalSource = structuredClone(source);
for (const row of finalSource.version.assignments.filter((item) => item.window.start === "09:45")) {
  row.ownerSlotId = "new"; row.originSlotId = "new";
}
const ownerConfig = { schema: "synthetic-owner-config", weights: { area: 1 } };
const fullOwners = { "0": { equalized: { area: "old" } } };
const compiled = { status: "FEASIBLE", publicationAuthority: "ACCEPTABLE", verifier: { ok: true },
  compilerVersion: "synthetic-compiler", weeklyAssignments: [{ planWorkId: "synthetic" }],
  certificate: { canonicalInputDigest: hash("a"), modelBasisDigest: hash("b"),
    assignmentDigest: hash("c"), finalWitness: { digest: hash("d") } } };
const snapshot = { authority_revision: 7, roster: [{ slot_id: "current" }] };
const binding = { sourceId: "registered-source", publicationId: "accepted-publication", authorityRevision: 7,
  effectiveWeek: source.serviceDate, publishedSourceDigest: postgresJsonbContentDigest(source),
  managerSnapshotDigest: postgresJsonbContentDigest(snapshot), readbackPatternDigest: hash("e"),
  fullNineSourceDigest: null };

function fakeFreshWeek(timeLimit) {
  const hard = { feasible: true, sourceDigest: contentDigest(finalSource), modelBasisDigest: hash("1"),
    hardConstraintDigest: hash("2"), hardConstraintCount: 17,
    integerWitness: [["x", 1]], witnessDigest: contentDigest([["x", 1]]), violations: [] };
  const proofs = Array.from({ length: 7 }, (_, dayOfWeek) => {
    const original = descriptor(dayOfWeek, contentDigest(source));
    const tiers = ["raw_spread", "inherited_preference", "inherited_identity_0"].map((name, index) => ({
      name, modelDigest: hash(String(index + 3)), lpDigest: hash(String(index + 6)),
      objectiveValue: index === 0 ? 1 : index === 1 ? 4 : 0,
      rawReceiptDigest: hash(["8", "9", "a"][index]), terminalReport: { raw: `run-${timeLimit}` },
      solverIdentity: { pinned: true }, solverOptions: { time_limit: timeLimit },
    }));
    const lower = digestObject({ status: "PROVEN_CANONICAL_PHASE_MINIMUM", descriptor: original,
      selectedOwnership: [{ workId: `work-${dayOfWeek}`, slotId: "new" }],
      candidateSourceDigest: hash("f"), minimumDoubledSpread: 1, preferenceCost: 4,
      stableIdentity: [0], tiers });
    const rebound = descriptor(dayOfWeek, hash(String(dayOfWeek)));
    return digestObject({ status: "PROVEN_CANONICAL_PHASE_MINIMUM", descriptor: rebound,
      lowerBoundEvidence: lower, originalLowerBoundProofDigest: lower.proofDigest,
      originalSolverSourceDigest: lower.descriptor.sourceDigest,
      candidateSourceDigest: contentDigest(finalSource), finalCanonicalWitnessDigest: hard.witnessDigest,
      freshSolverRunClaim: false,
      proofMethod: "UNCHANGED_DAY_RELAXATION_BOUND_PLUS_MATCHING_FINAL_WHOLE_WEEK_CANONICAL_WITNESS",
      minimumDoubledSpread: 1, preferenceCost: 4, stableIdentity: [0],
      freshCanonicalSourceBasisDigest: hash("b"), unchangedRelaxationDayFactsDigest: hash("c"),
      unchangedRelaxationDescriptorDigest: hash("d") });
  });
  return digestObject({ status: "UNREGISTERED_CANONICAL_RECURRING_WEEK_CANDIDATE",
    sourceDigest: contentDigest(source), configDigest: contentDigest(ownerConfig),
    fullOwnersDigest: contentDigest(fullOwners), candidateSourceDigest: contentDigest(finalSource),
    candidateSource: structuredClone(finalSource), canonicalHardWitness: hard, proofs,
    morningPreserved: true, originalPreferenceBaselinePreserved: true,
    allOtherDaysBoundToFinalCandidate: true, normalMorningOptimumClaim: false,
    datedPriorityChange: false, admitted: false, published: false });
}

const input = (week) => ({ week, source, ownerConfig, fullOwners, finalSource,
  sourceBasisDigest: hash("4"), finalPatternConfig: ownerConfig, compiled,
  implementationDigest: hash("9"), binding });
const first = createRecurringWeekCommitment(input(fakeFreshWeek(9.983)));
const second = createRecurringWeekCommitment(input(fakeFreshWeek(9.217)));
assert.equal(canonicalJson(first), canonicalJson(second),
  "fresh variable time limits must not make an identical semantic preview stale");
let checks = 1;
const basis = { source: { source_id: binding.sourceId, compiler_input: source }, snapshot,
  patternAuthority: { publicationId: binding.publicationId }, fullNineSource: null };
const candidate = { weekCommitment: first, weekOptimizationScope: RECURRING_PHASE_SCOPE,
  staffedPositions: 7, sourcePatternKind: "UNSPLIT", sourceId: binding.sourceId,
  publicationId: binding.publicationId, authorityRevision: binding.authorityRevision,
  effectiveDate: binding.effectiveWeek,
  publishedSourceDigest: binding.publishedSourceDigest, managerSnapshotDigest: binding.managerSnapshotDigest,
  readbackPatternDigest: binding.readbackPatternDigest, fullNineSourceDigest: null,
  candidateSourceDigest: first.finalSourceSqlDigest,
  patternFingerprint: contentDigest(ownerConfig), phaseSourceBasisDigest: hash("4"),
  decision: { implementationDigest: hash("9") }, compilerVersion: compiled.compilerVersion,
  modelBasisDigest: compiled.certificate.modelBasisDigest,
  finalWitnessDigest: compiled.certificate.finalWitness.digest,
  assignmentWitnessDigest: compiled.certificate.assignmentDigest,
  weeklyAssignmentsDigest: first.completeCompiler.weeklyAssignmentsDigest };
assert.equal(assertRecurringWeekCommitment(candidate, basis, 7), true); checks += 1;
function rejected(label, work) {
  assert.throws(work, undefined, label); checks += 1;
}
const clone = structuredClone;
const changed = (week, mutation) => {
  const candidateWeek = clone(week); mutation(candidateWeek);
  return candidateWeek;
};
rejected("unknown whole-week proof", () => createRecurringWeekCommitment(input(changed(fakeFreshWeek(9),
  (week) => { week.status = "UNKNOWN_CANONICAL_RECURRING_WEEK"; }))));
rejected("missing day", () => createRecurringWeekCommitment(input(changed(fakeFreshWeek(9),
  (week) => { week.proofs.pop(); }))));
rejected("forged terminal model", () => createRecurringWeekCommitment(input(changed(fakeFreshWeek(9),
  (week) => { week.proofs[0].lowerBoundEvidence.tiers[0].modelDigest = hash("0"); }))));
rejected("missing fresh terminal receipt", () => createRecurringWeekCommitment(input(changed(fakeFreshWeek(9),
  (week) => { delete week.proofs[0].lowerBoundEvidence.tiers[0].rawReceiptDigest; }))));
rejected("changed morning source", () => {
  const wrong = clone(finalSource); wrong.version.assignments[0].ownerSlotId = "new";
  createRecurringWeekCommitment({ ...input(fakeFreshWeek(9)), finalSource: wrong });
});
rejected("unrelated final source change", () => {
  const wrong = clone(finalSource); wrong.unrelated = true;
  createRecurringWeekCommitment({ ...input(fakeFreshWeek(9)), finalSource: wrong });
});
rejected("changed source binding", () => assertRecurringWeekCommitment(candidate,
  { ...basis, snapshot: { ...snapshot, authority_revision: 8 } }, 7));
rejected("changed final compiler witness", () => assertRecurringWeekCommitment(
  { ...candidate, finalWitnessDigest: hash("0") }, basis, 7));
rejected("changed final owner-pattern metadata", () => assertRecurringWeekCommitment(
  { ...candidate, patternFingerprint: hash("0") }, basis, 7));
rejected("forged component ledger", () => {
  const wrong = clone(candidate); wrong.weekCommitment.componentLedgerDigest = hash("0");
  wrong.weekCommitment.digest = contentDigest((({ digest, ...body }) => body)(wrong.weekCommitment));
  assertRecurringWeekCommitment(wrong, basis, 7);
});
// Static nine-position restoration is a separate source/compiler claim, not
// a synthetic seven-day optimum. The 313-row fixture tests this closed union
// shape only; the actual registered nine-position worker path is separate.
const nineSource = { serviceDate: source.serviceDate,
  version: { assignments: Array.from({ length: 313 }, (_, index) => ({ workId: `nine-${index}` })) } };
const nineBinding = { ...binding, registeredFullNineSourceId: "registered-nine",
  registeredFullNineSourceDigest: postgresJsonbContentDigest(nineSource) };
const nineIdentity = { baseSourceId: nineBinding.registeredFullNineSourceId,
  basePacketSha256: hash("1"), fullConfigSha256: hash("2") };
const staticCommitment = createRecurringFullNineTemplateCommitment({
  registeredFullNineSource: nineSource, finalSource: nineSource, compiled,
  implementationDigest: hash("9"), patternFingerprint: hash("3"),
  binding: nineBinding, approvedIdentity: nineIdentity });
const nineCandidate = { ...candidate, staffedPositions: 9,
  weekOptimizationScope: RECURRING_FULL_NINE_SCOPE, weekCommitment: undefined,
  staticTemplateCommitment: staticCommitment, fullNineSourceDigest: nineBinding.registeredFullNineSourceDigest,
  candidateSourceDigest: staticCommitment.finalSourceSqlDigest, patternFingerprint: hash("3") };
const nineBasis = { ...basis, fullNineSource: { source_id: nineBinding.registeredFullNineSourceId,
  compiler_input: nineSource } };
assert.equal(assertRecurringWeekCommitment(nineCandidate, nineBasis, 7), true); checks += 1;
rejected("nine-position static template never gains a phase claim", () =>
  assertRecurringWeekCommitment({ ...nineCandidate, weekOptimizationScope: RECURRING_PHASE_SCOPE }, nineBasis, 7));
rejected("six-person candidate cannot claim the static nine template", () =>
  assertRecurringWeekCommitment({ ...nineCandidate, staffedPositions: 6 }, nineBasis, 7));
rejected("full-nine candidate requires exact registered source", () =>
  assertRecurringWeekCommitment(nineCandidate,
    { ...nineBasis, fullNineSource: { ...nineBasis.fullNineSource, source_id: "other" } }, 7));
rejected("full-nine source cannot silently flatten the split historical packet", () =>
  createRecurringFullNineTemplateCommitment({ registeredFullNineSource: source,
    finalSource: nineSource, compiled, implementationDigest: hash("9"),
    patternFingerprint: hash("3"), binding: nineBinding, approvedIdentity: nineIdentity }));
const impactConfig = { slots: Object.fromEntries([
  ["OLD", { slotId: "old", vacancy: false, workDays: [0, 1, 2, 3, 4, 5, 6] }],
  ["NEW", { slotId: "new", vacancy: false, workDays: [0, 1, 2, 3, 4, 5, 6] }],
  ...Array.from({ length: 7 }, (_, index) => [`VAC${index}`, { slotId: `vac${index}`,
    vacancy: true, workDays: [] }]),
]), weights: Object.fromEntries(Array.from({ length: 7 }, (_, day) => [`area-${day}`, 1])),
  publicRestroomFamilies: ["area-0"] };
const impactSource = clone(source), impactFinal = clone(finalSource);
for (const body of [impactSource, impactFinal]) for (const row of body.version.assignments) {
  if (row.window.start === "09:45") row.locationCodeSnapshot = `area-${row.dayOfWeek}`;
}
const preliminaryChanges = Array.from({ length: 7 }, (_, day) => ["morning", "equalized"].map(phase => ({
  day, phase, employees: ["OLD", "NEW"].map(owner => ({ owner, weightedLoad: 0,
    restroomSites: 0, gained: [], released: [] })),
}))).flat();
const finalChanges = createRecurringFinalManagerChanges({ preliminaryChanges,
  phaseSource: impactSource, finalSource: impactFinal, ownerConfig: impactConfig });
assert.equal(finalChanges.length, 14);
assert.deepEqual(finalChanges[1].employees.find(row => row.owner === "OLD").released, ["area-0"]);
assert.deepEqual(finalChanges[1].employees.find(row => row.owner === "NEW").gained, ["area-0"]);
assert.equal(finalChanges[1].employees.find(row => row.owner === "NEW").restroomSites, 1);
assert.deepEqual(finalChanges[0], preliminaryChanges[0], "morning impact must not be rewritten");
checks += 1;
rejected("manager changes cannot hide final family", () => {
  const wrong = clone(impactFinal); wrong.version.assignments[1].locationCodeSnapshot = "foreign";
  createRecurringFinalManagerChanges({ preliminaryChanges, phaseSource: impactSource,
    finalSource: wrong, ownerConfig: impactConfig });
});
console.log(JSON.stringify({ status: "PASS", checks, scope: "pure synthetic semantic commitment and hostile shapes",
  solver: false, worker: false, sql: false, publication: false }));

if (process.argv.includes("--fused-ipc")) {
  const { createStaticWeeklyCompilerRuntime } = await import("../src/static-weekly-schedule-compiler-runtime.js");
  const packet = JSON.parse(readFileSync(new URL("./fixtures/static-weekly-policy-scope-receipts.json", import.meta.url)));
  const source = structuredClone(packet.cases.baseline.input);
  source.version = source.versions[0]; delete source.versions;
  assert.equal(source.version.assignments.length, 323, "exact retained current-handout source required");
  const config = JSON.parse(readFileSync(new URL("../config/custodial-six-person-static-20261005.json", import.meta.url)));
  const fresh = config.slots.OPTION1;
  fresh.vacancy = false;
  fresh.personId = "72000000-0000-4000-8000-000000000001";
  fresh.name = "Synthetic fresh OPTION1 incumbent";
  source.slots.find((slot) => slot.id === fresh.slotId).incumbencies.push({
    personId: fresh.personId, displayName: fresh.name,
    effectiveStart: "2026-10-05", effectiveEnd: null });
  for (const row of source.version.slotAvailability.filter((row) => row.slotId === fresh.slotId))
    row.status = "working";
  source.version.vacantSlotIds = source.version.vacantSlotIds.filter((id) => id !== fresh.slotId);
  const managerSnapshot = {
    week_start: "2026-10-05", authority_revision: 42,
    current_publication: { publication_id: source.version.publicationId },
    roster: Object.values(config.slots).map((slot) => ({
      slot_id: slot.slotId, contractor_capacity: false,
      incumbencies: source.slots.find((row) => row.id === slot.slotId).incumbencies.map((person) => ({
        person_id: person.personId, person_name: person.displayName,
        effective_start: person.effectiveStart, effective_end: person.effectiveEnd })),
      week_staffing: slot.vacancy === true ? [] : slot.workDays.map((day) => ({
        service_date: new Date(Date.parse("2026-10-05T12:00:00Z") + ((day + 6) % 7) * 86_400_000)
          .toISOString().slice(0, 10),
        person_id: slot.personId, employee_active: true })),
    })),
  };
  const request = { publishedSource: { source_id: "73000000-0000-4000-8000-000000000001",
    publication_id: source.version.publicationId, authority_revision: 42, compiler_input: source },
    managerSnapshot, effectiveDate: "2026-10-05", expectedRevision: 42 };
  const initial = canonicalJson(request);
  const runtime = createStaticWeeklyCompilerRuntime();
  const started = performance.now();
  try {
    const preview = await runtime.prepareRecurringCandidate(request);
    assert.equal(preview.weekOptimizationScope, RECURRING_PHASE_SCOPE);
    assert.equal(preview.staffedPositions, 7);
    assert.equal(preview.assignmentCount, 323);
    assert.equal(preview.weekCommitment.status, "PROVEN_CANDIDATE_ONLY");
    assert.equal(preview.weekCommitment.days.length, 7);
    assert.equal(preview.weekCommitment.normalMorningOptimumClaim, false);
    assert.equal(preview.weekCommitment.physicalMinuteFeasibilityClaim, false);
    const admission = await runtime.prepareRecurringAdmissionCandidate(request);
    assertRecurringAdmissionCandidate(admission);
    assert.equal(admission.candidate.weekCommitment.digest, preview.weekCommitment.digest,
      "independent fresh solver terminal timings cannot change semantic preview identity");
    assert.equal(admission.candidate.decisionDigest, preview.decisionDigest);
    assert.equal(admission.candidate.candidateSourceDigest, preview.candidateSourceDigest);
    assert.equal(postgresJsonbContentDigest(admission.canonicalSource), preview.candidateSourceDigest);
    assert.equal(canonicalJson(request), initial, "source and roster request may not be mutated");
    await assert.rejects(() => runtime.prepareRecurringCandidate({ ...request, expectedRevision: 41 }),
      /revision changed/);
    console.log(JSON.stringify({ status: "PASS", scope: "fresh isolated fused IPC preview/private admission",
      checks: 14, staffedPositions: 7, sourceAssignments: 323,
      semanticWeekDigest: preview.weekCommitment.digest,
      finalSourceDigest: preview.candidateSourceDigest,
      finalPatternDigest: preview.patternFingerprint,
      elapsedMs: Math.round(performance.now() - started),
      sql: false, publication: false, physical: false }));
  } finally {
    await runtime.shutdown();
  }
}
