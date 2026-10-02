import assert from "node:assert/strict";
import { canonicalJson, contentDigest } from "./static-weekly-schedule-model.js";
import { postgresJsonbContentDigest } from "./static-weekly-schedule-compiler.js";
import { COMPONENT_WEIGHT_LEDGER_DIGEST } from "./schedule-component-weight-authority.js";

export const RECURRING_WEEK_COMMITMENT_SCHEMA = "custodial.recurring-week-semantic-commitment.v1";
export const RECURRING_FULL_NINE_TEMPLATE_COMMITMENT_SCHEMA =
  "custodial.recurring-full-nine-static-template-commitment.v1";
export const RECURRING_PHASE_SCOPE = "PROVEN_CANONICAL_7_DAY_PHASE";
export const RECURRING_FULL_NINE_SCOPE = "HISTORICAL_FULL_NINE_STATIC_TEMPLATE_ONLY";
const hex = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const version = (source) => source?.version || (source?.versions?.length === 1 ? source.versions[0] : null);
const withoutDigest = ({ digest, ...body }) => body;
const exactProofDigest = (proof) => {
  assert.ok(proof && hex(proof.proofDigest), "exact fresh week proof required");
  const { proofDigest, ...body } = proof;
  assert.equal(proofDigest, contentDigest(body), "week proof bytes changed");
};

function assertOnlyEqualizedOwnershipChanged(source, finalSource) {
  const original = version(source)?.assignments;
  const final = version(finalSource)?.assignments;
  assert.ok(Array.isArray(original) && Array.isArray(final) && original.length === final.length,
    "exact recurring source assignment multiplicity required");
  const restored = structuredClone(finalSource);
  const rows = version(restored).assignments;
  for (let index = 0; index < original.length; index += 1) {
    if (original[index]?.window?.start === "09:45") {
      assert.equal(final[index]?.dayOfWeek, original[index].dayOfWeek,
        "phase witness moved a selected day");
      rows[index] = structuredClone(original[index]);
    } else {
      assert.equal(canonicalJson(final[index]), canonicalJson(original[index]),
        "phase witness changed morning or unrelated work");
    }
  }
  assert.equal(canonicalJson(restored), canonicalJson(source),
    "phase witness changed nonselected canonical source facts");
}

function stableDay(proof, dayOfWeek, finalDigest, finalWitnessDigest) {
  exactProofDigest(proof);
  const lower = proof.lowerBoundEvidence;
  exactProofDigest(lower);
  assert.equal(proof.status, "PROVEN_CANONICAL_PHASE_MINIMUM");
  assert.equal(lower.status, "PROVEN_CANONICAL_PHASE_MINIMUM");
  assert.equal(proof.descriptor?.dayOfWeek, dayOfWeek);
  assert.equal(lower.descriptor?.dayOfWeek, dayOfWeek);
  assert.equal(proof.descriptor.descriptorDigest,
    contentDigest((( { descriptorDigest, ...body }) => body)(proof.descriptor)));
  assert.equal(lower.descriptor.descriptorDigest,
    contentDigest((( { descriptorDigest, ...body }) => body)(lower.descriptor)));
  assert.equal(proof.originalLowerBoundProofDigest, lower.proofDigest);
  assert.equal(proof.originalSolverSourceDigest, lower.descriptor.sourceDigest);
  assert.equal(proof.candidateSourceDigest, finalDigest);
  assert.equal(proof.finalCanonicalWitnessDigest, finalWitnessDigest);
  assert.equal(proof.minimumDoubledSpread, lower.minimumDoubledSpread);
  assert.equal(proof.preferenceCost, lower.preferenceCost);
  assert.deepEqual(proof.stableIdentity, lower.stableIdentity);
  assert.equal(proof.freshSolverRunClaim, false);
  assert.equal(proof.proofMethod,
    "UNCHANGED_DAY_RELAXATION_BOUND_PLUS_MATCHING_FINAL_WHOLE_WEEK_CANONICAL_WITNESS");
  assert.ok(Number.isSafeInteger(proof.minimumDoubledSpread) && proof.minimumDoubledSpread >= 0);
  assert.ok(Number.isSafeInteger(proof.preferenceCost) && proof.preferenceCost >= 0);
  assert.ok(Array.isArray(proof.stableIdentity) && Array.isArray(lower.selectedOwnership));
  assert.ok(Array.isArray(lower.tiers) && lower.tiers.length >= 3);
  const tiers = lower.tiers.map((tier) => {
    assert.ok(typeof tier.name === "string" && tier.name);
    assert.ok(hex(tier.modelDigest) && hex(tier.lpDigest) && hex(tier.rawReceiptDigest));
    assert.ok(Number.isSafeInteger(tier.objectiveValue));
    assert.ok(tier.terminalReport && tier.solverIdentity && tier.solverOptions,
      "fresh exact terminal evidence required");
    // Time-limit options and raw terminal bytes are checked by the fresh
    // phase solver, but vary across independent bounded executions. Never put
    // them in a preview/confirmation equality commitment.
    return { name: tier.name, modelDigest: tier.modelDigest, lpDigest: tier.lpDigest,
      objectiveValue: tier.objectiveValue };
  });
  assert.equal(tiers[0].name, "raw_spread");
  assert.equal(tiers[1].name, "inherited_preference");
  assert.ok(tiers.slice(2).every((tier) => tier.name.startsWith("inherited_identity_")));
  assert.equal(tiers[0].objectiveValue, proof.minimumDoubledSpread);
  assert.equal(tiers[1].objectiveValue, proof.preferenceCost);
  return {
    dayOfWeek,
    descriptorDigest: proof.descriptor.descriptorDigest,
    originalLowerBoundDescriptorDigest: lower.descriptor.descriptorDigest,
    originalSolverSourceDigest: proof.originalSolverSourceDigest,
    freshCanonicalSourceBasisDigest: proof.freshCanonicalSourceBasisDigest,
    unchangedRelaxationDayFactsDigest: proof.unchangedRelaxationDayFactsDigest,
    unchangedRelaxationDescriptorDigest: proof.unchangedRelaxationDescriptorDigest,
    minimumDoubledSpread: proof.minimumDoubledSpread,
    preferenceCost: proof.preferenceCost,
    stableIdentity: structuredClone(proof.stableIdentity),
    selectedOwnership: structuredClone(lower.selectedOwnership),
    terminalOptima: tiers,
    finalCanonicalWitnessDigest: proof.finalCanonicalWitnessDigest,
  };
}

// Constructed inside the private compiler ONLY after the existing phase helper
// has freshly checked all seven exact terminal receipts and its final complete
// canonical hard-row witness. This does not assert physical-duration evidence.
export function createRecurringWeekCommitment({ week, source, ownerConfig, fullOwners,
  sourceBasisDigest, finalSource, finalPatternConfig, compiled, implementationDigest, binding }) {
  assert.ok(week && source && ownerConfig && fullOwners && finalSource
    && finalPatternConfig && compiled && binding);
  exactProofDigest(week);
  assert.equal(week.status, "UNREGISTERED_CANONICAL_RECURRING_WEEK_CANDIDATE");
  assert.equal(week.sourceDigest, contentDigest(source));
  assert.equal(week.configDigest, contentDigest(ownerConfig));
  assert.equal(week.fullOwnersDigest, contentDigest(fullOwners));
  assert.ok(hex(sourceBasisDigest));
  assert.equal(week.candidateSourceDigest, contentDigest(finalSource));
  assert.equal(canonicalJson(week.candidateSource), canonicalJson(finalSource));
  assert.equal(week.morningPreserved, true);
  assert.equal(week.originalPreferenceBaselinePreserved, true);
  assert.equal(week.allOtherDaysBoundToFinalCandidate, true);
  assert.equal(week.normalMorningOptimumClaim, false);
  assert.equal(week.datedPriorityChange, false);
  assert.equal(week.admitted, false);
  assert.equal(week.published, false);
  assertOnlyEqualizedOwnershipChanged(source, finalSource);
  const hard = week.canonicalHardWitness;
  assert.equal(hard?.feasible, true);
  assert.equal(hard.sourceDigest, week.candidateSourceDigest);
  assert.ok(hex(hard.modelBasisDigest) && hex(hard.hardConstraintDigest) && hex(hard.witnessDigest));
  assert.ok(Number.isSafeInteger(hard.hardConstraintCount) && hard.hardConstraintCount > 0);
  assert.ok(Array.isArray(hard.integerWitness));
  assert.equal(hard.witnessDigest, contentDigest(hard.integerWitness));
  assert.deepEqual(hard.violations, []);
  assert.ok(Array.isArray(week.proofs) && week.proofs.length === 7);
  const days = week.proofs.map((proof, index) => stableDay(proof, index,
    week.candidateSourceDigest, hard.witnessDigest));
  assert.equal(compiled.status, "FEASIBLE");
  assert.equal(compiled.publicationAuthority, "ACCEPTABLE");
  assert.equal(compiled.verifier?.ok, true);
  assert.ok(hex(compiled.certificate?.canonicalInputDigest));
  assert.ok(hex(compiled.certificate?.modelBasisDigest));
  assert.ok(hex(compiled.certificate?.finalWitness?.digest));
  assert.ok(hex(compiled.certificate?.assignmentDigest));
  assert.ok(hex(implementationDigest));
  assert.ok(typeof binding.sourceId === "string" && binding.sourceId);
  assert.ok(typeof binding.publicationId === "string" && binding.publicationId);
  assert.ok(Number.isSafeInteger(binding.authorityRevision) && binding.authorityRevision >= 0);
  assert.ok(typeof binding.effectiveWeek === "string" && binding.effectiveWeek === finalSource.serviceDate);
  for (const value of [binding.publishedSourceDigest, binding.managerSnapshotDigest,
    binding.readbackPatternDigest]) assert.ok(hex(value));
  assert.ok(binding.fullNineSourceDigest === null || hex(binding.fullNineSourceDigest));
  const body = {
    schema: RECURRING_WEEK_COMMITMENT_SCHEMA,
    status: "PROVEN_CANDIDATE_ONLY",
    scope: "EXACT_SELECTED_POST0945_NORMAL_WEEK_MORNING_FROM_BOUND_INPUT_FIXED",
    sourceId: binding.sourceId,
    publicationId: binding.publicationId,
    authorityRevision: binding.authorityRevision,
    effectiveWeek: binding.effectiveWeek,
    publishedSourceDigest: binding.publishedSourceDigest,
    managerSnapshotDigest: binding.managerSnapshotDigest,
    readbackPatternDigest: binding.readbackPatternDigest,
    fullNineSourceDigest: binding.fullNineSourceDigest,
    sourceDigest: week.sourceDigest,
    sourceBasisDigest,
    sourceSqlDigest: postgresJsonbContentDigest(source),
    configDigest: week.configDigest,
    finalPatternDigest: contentDigest(finalPatternConfig),
    fullOwnersDigest: week.fullOwnersDigest,
    componentLedgerDigest: COMPONENT_WEIGHT_LEDGER_DIGEST,
    implementationDigest,
    finalSourceDigest: week.candidateSourceDigest,
    finalSourceSqlDigest: postgresJsonbContentDigest(finalSource),
    days,
    canonicalHard: { modelBasisDigest: hard.modelBasisDigest,
      hardConstraintDigest: hard.hardConstraintDigest,
      hardConstraintCount: hard.hardConstraintCount,
      witnessDigest: hard.witnessDigest },
    completeCompiler: { compilerVersion: compiled.compilerVersion,
      canonicalInputDigest: compiled.certificate.canonicalInputDigest,
      modelBasisDigest: compiled.certificate.modelBasisDigest,
      finalWitnessDigest: compiled.certificate.finalWitness.digest,
      assignmentDigest: compiled.certificate.assignmentDigest,
      weeklyAssignmentsDigest: postgresJsonbContentDigest(compiled.weeklyAssignments) },
    normalMorningOptimumClaim: false,
    datedPriorityChange: false,
    physicalMinuteFeasibilityClaim: false,
    admitted: false,
    published: false,
  };
  return { ...body, digest: contentDigest(body) };
}

// The accepted nine-position historical template contains a split family and
// is intentionally outside the selected unsplit 09:45 phase model. Preserve
// its existing exact registered-source/current-roster/compiler path; never
// relabel this as a newly optimized seven-day minimum.
export function createRecurringFullNineTemplateCommitment({ registeredFullNineSource,
  finalSource, compiled, implementationDigest, patternFingerprint, binding,
  approvedIdentity }) {
  assert.ok(registeredFullNineSource && finalSource && compiled && binding && approvedIdentity);
  assert.equal(approvedIdentity.baseSourceId, binding.registeredFullNineSourceId);
  assert.equal(version(registeredFullNineSource)?.assignments?.length, 313,
    "exact original full-nine assignment multiplicity required");
  assert.equal(version(finalSource)?.assignments?.length, 313,
    "restored full-nine candidate must retain the historical split source");
  for (const value of [approvedIdentity.basePacketSha256, approvedIdentity.fullConfigSha256,
    implementationDigest, patternFingerprint]) assert.ok(hex(value));
  assert.equal(compiled.status, "FEASIBLE");
  assert.equal(compiled.publicationAuthority, "ACCEPTABLE");
  assert.equal(compiled.verifier?.ok, true);
  assert.ok(hex(compiled.certificate?.canonicalInputDigest));
  assert.ok(hex(compiled.certificate?.modelBasisDigest));
  assert.ok(hex(compiled.certificate?.finalWitness?.digest));
  assert.ok(hex(compiled.certificate?.assignmentDigest));
  assert.ok(typeof binding.sourceId === "string" && binding.sourceId);
  assert.ok(typeof binding.publicationId === "string" && binding.publicationId);
  assert.ok(Number.isSafeInteger(binding.authorityRevision) && binding.authorityRevision >= 0);
  assert.equal(binding.effectiveWeek, finalSource.serviceDate);
  for (const value of [binding.publishedSourceDigest, binding.managerSnapshotDigest,
    binding.readbackPatternDigest]) assert.ok(hex(value));
  const registeredDigest = postgresJsonbContentDigest(registeredFullNineSource);
  assert.equal(binding.registeredFullNineSourceDigest, registeredDigest);
  const body = {
    schema: RECURRING_FULL_NINE_TEMPLATE_COMMITMENT_SCHEMA,
    status: "VERIFIED_STATIC_TEMPLATE_CANDIDATE_ONLY",
    scope: RECURRING_FULL_NINE_SCOPE,
    sourceId: binding.sourceId,
    publicationId: binding.publicationId,
    authorityRevision: binding.authorityRevision,
    effectiveWeek: binding.effectiveWeek,
    publishedSourceDigest: binding.publishedSourceDigest,
    managerSnapshotDigest: binding.managerSnapshotDigest,
    readbackPatternDigest: binding.readbackPatternDigest,
    registeredFullNineSourceId: binding.registeredFullNineSourceId,
    registeredFullNineSourceDigest: registeredDigest,
    approvedBasePacketDigest: approvedIdentity.basePacketSha256,
    approvedFullConfigDigest: approvedIdentity.fullConfigSha256,
    componentLedgerDigest: COMPONENT_WEIGHT_LEDGER_DIGEST,
    implementationDigest,
    patternFingerprint,
    finalSourceDigest: contentDigest(finalSource),
    finalSourceSqlDigest: postgresJsonbContentDigest(finalSource),
    completeCompiler: { compilerVersion: compiled.compilerVersion,
      canonicalInputDigest: compiled.certificate.canonicalInputDigest,
      modelBasisDigest: compiled.certificate.modelBasisDigest,
      finalWitnessDigest: compiled.certificate.finalWitness.digest,
      assignmentDigest: compiled.certificate.assignmentDigest,
      weeklyAssignmentsDigest: postgresJsonbContentDigest(compiled.weeklyAssignments) },
    phaseMinimumClaim: false,
    historicalIncumbencyRestoreClaim: false,
    admitted: false,
    published: false,
  };
  return { ...body, digest: contentDigest(body) };
}

export function assertRecurringWeekCommitmentCandidate(candidate) {
  assert.equal(candidate?.weekOptimizationScope, RECURRING_PHASE_SCOPE);
  assert.ok(Number.isInteger(candidate.staffedPositions)
    && candidate.staffedPositions >= 6 && candidate.staffedPositions <= 8,
  "phase commitment requires six to eight current employees");
  assert.equal(candidate.sourcePatternKind, "UNSPLIT");
  assert.equal(candidate.staticTemplateCommitment, undefined);
  const commitment = candidate?.weekCommitment;
  assert.ok(commitment && commitment.schema === RECURRING_WEEK_COMMITMENT_SCHEMA);
  assert.equal(commitment.digest, contentDigest(withoutDigest(commitment)));
  assert.equal(commitment.status, "PROVEN_CANDIDATE_ONLY");
  assert.equal(commitment.scope, "EXACT_SELECTED_POST0945_NORMAL_WEEK_MORNING_FROM_BOUND_INPUT_FIXED");
  assert.equal(commitment.sourceId, candidate.sourceId);
  assert.equal(commitment.publicationId, candidate.publicationId);
  assert.equal(commitment.authorityRevision, candidate.authorityRevision);
  assert.equal(commitment.effectiveWeek, candidate.effectiveDate);
  assert.equal(commitment.publishedSourceDigest, candidate.publishedSourceDigest);
  assert.equal(commitment.managerSnapshotDigest, candidate.managerSnapshotDigest);
  assert.equal(commitment.readbackPatternDigest, candidate.readbackPatternDigest);
  assert.equal(commitment.fullNineSourceDigest, candidate.fullNineSourceDigest);
  assert.equal(commitment.finalSourceSqlDigest, candidate.candidateSourceDigest);
  assert.equal(commitment.componentLedgerDigest, COMPONENT_WEIGHT_LEDGER_DIGEST);
  assert.equal(commitment.implementationDigest, candidate.decision?.implementationDigest);
  assert.equal(commitment.finalPatternDigest, candidate.patternFingerprint);
  assert.equal(commitment.sourceBasisDigest, candidate.phaseSourceBasisDigest);
  assert.equal(commitment.completeCompiler.compilerVersion, candidate.compilerVersion);
  assert.equal(commitment.completeCompiler.modelBasisDigest, candidate.modelBasisDigest);
  assert.equal(commitment.completeCompiler.finalWitnessDigest, candidate.finalWitnessDigest);
  assert.equal(commitment.completeCompiler.assignmentDigest, candidate.assignmentWitnessDigest);
  assert.equal(commitment.completeCompiler.weeklyAssignmentsDigest, candidate.weeklyAssignmentsDigest);
  for (const value of [commitment.sourceDigest, commitment.sourceBasisDigest,
    commitment.sourceSqlDigest, commitment.configDigest, commitment.finalPatternDigest,
    commitment.fullOwnersDigest, commitment.componentLedgerDigest,
    commitment.implementationDigest, commitment.finalSourceDigest,
    commitment.finalSourceSqlDigest, commitment.canonicalHard?.modelBasisDigest,
    commitment.canonicalHard?.hardConstraintDigest,
    commitment.canonicalHard?.witnessDigest,
    commitment.completeCompiler?.canonicalInputDigest]) assert.ok(hex(value));
  assert.ok(Number.isSafeInteger(commitment.canonicalHard.hardConstraintCount)
    && commitment.canonicalHard.hardConstraintCount > 0);
  assert.ok(Array.isArray(commitment.days) && commitment.days.length === 7);
  assert.ok(commitment.days.every((day, index) => day.dayOfWeek === index
    && [day.descriptorDigest, day.originalLowerBoundDescriptorDigest,
      day.originalSolverSourceDigest, day.freshCanonicalSourceBasisDigest,
      day.unchangedRelaxationDayFactsDigest, day.unchangedRelaxationDescriptorDigest,
      day.finalCanonicalWitnessDigest].every(hex)
    && day.finalCanonicalWitnessDigest === commitment.canonicalHard.witnessDigest
    && Number.isSafeInteger(day.minimumDoubledSpread) && day.minimumDoubledSpread >= 0
    && Number.isSafeInteger(day.preferenceCost) && day.preferenceCost >= 0
    && Array.isArray(day.stableIdentity) && Array.isArray(day.selectedOwnership)
    && Array.isArray(day.terminalOptima) && day.terminalOptima.length >= 3
    && day.terminalOptima[0].name === "raw_spread"
    && day.terminalOptima[1].name === "inherited_preference"
    && day.terminalOptima.slice(2).every((tier) => tier.name.startsWith("inherited_identity_"))
    && day.terminalOptima.every((tier) => hex(tier.modelDigest) && hex(tier.lpDigest)
      && Number.isSafeInteger(tier.objectiveValue))));
  assert.ok(commitment.normalMorningOptimumClaim === false
    && commitment.datedPriorityChange === false
    && commitment.physicalMinuteFeasibilityClaim === false
    && commitment.admitted === false && commitment.published === false);
  return true;
}

export function assertRecurringFullNineTemplateCommitmentCandidate(candidate, basis) {
  assert.equal(candidate?.weekOptimizationScope, RECURRING_FULL_NINE_SCOPE);
  assert.equal(candidate?.staffedPositions, 9);
  assert.equal(candidate.weekCommitment, undefined);
  assert.ok(basis?.fullNineSource?.compiler_input);
  const commitment = candidate.staticTemplateCommitment;
  assert.equal(commitment?.schema, RECURRING_FULL_NINE_TEMPLATE_COMMITMENT_SCHEMA);
  assert.equal(commitment.digest, contentDigest(withoutDigest(commitment)));
  assert.equal(commitment.status, "VERIFIED_STATIC_TEMPLATE_CANDIDATE_ONLY");
  assert.equal(commitment.scope, RECURRING_FULL_NINE_SCOPE);
  assert.equal(commitment.sourceId, candidate.sourceId);
  assert.equal(commitment.publicationId, candidate.publicationId);
  assert.equal(commitment.authorityRevision, candidate.authorityRevision);
  assert.equal(commitment.effectiveWeek, candidate.effectiveDate);
  assert.equal(commitment.publishedSourceDigest, candidate.publishedSourceDigest);
  assert.equal(commitment.managerSnapshotDigest, candidate.managerSnapshotDigest);
  assert.equal(commitment.readbackPatternDigest, candidate.readbackPatternDigest);
  assert.equal(commitment.registeredFullNineSourceId, basis.fullNineSource.source_id);
  assert.equal(commitment.registeredFullNineSourceDigest, candidate.fullNineSourceDigest);
  assert.equal(commitment.registeredFullNineSourceDigest,
    postgresJsonbContentDigest(basis.fullNineSource.compiler_input));
  for (const value of [commitment.approvedBasePacketDigest, commitment.approvedFullConfigDigest,
    commitment.finalSourceDigest, commitment.finalSourceSqlDigest,
    commitment.patternFingerprint, commitment.completeCompiler?.canonicalInputDigest]) assert.ok(hex(value));
  assert.equal(commitment.componentLedgerDigest, COMPONENT_WEIGHT_LEDGER_DIGEST);
  assert.equal(commitment.implementationDigest, candidate.decision?.implementationDigest);
  assert.equal(commitment.patternFingerprint, candidate.patternFingerprint);
  assert.equal(commitment.finalSourceSqlDigest, candidate.candidateSourceDigest);
  assert.equal(commitment.completeCompiler.compilerVersion, candidate.compilerVersion);
  assert.equal(commitment.completeCompiler.modelBasisDigest, candidate.modelBasisDigest);
  assert.equal(commitment.completeCompiler.finalWitnessDigest, candidate.finalWitnessDigest);
  assert.equal(commitment.completeCompiler.assignmentDigest, candidate.assignmentWitnessDigest);
  assert.equal(commitment.completeCompiler.weeklyAssignmentsDigest, candidate.weeklyAssignmentsDigest);
  assert.ok(commitment.phaseMinimumClaim === false
    && commitment.historicalIncumbencyRestoreClaim === false
    && commitment.admitted === false && commitment.published === false);
  return true;
}

export function assertRecurringWeekCommitment(candidate, basis, revision) {
  if (candidate?.weekOptimizationScope === RECURRING_FULL_NINE_SCOPE) {
    assertRecurringFullNineTemplateCommitmentCandidate(candidate, basis);
  } else {
    assertRecurringWeekCommitmentCandidate(candidate);
  }
  const commitment = candidate.weekOptimizationScope === RECURRING_FULL_NINE_SCOPE
    ? candidate.staticTemplateCommitment : candidate.weekCommitment;
  assert.equal(commitment.sourceId, basis.source.source_id);
  assert.equal(commitment.publicationId, basis.patternAuthority.publicationId);
  assert.equal(commitment.authorityRevision, revision);
  assert.equal(commitment.publishedSourceDigest,
    postgresJsonbContentDigest(basis.source.compiler_input));
  assert.equal(commitment.managerSnapshotDigest, postgresJsonbContentDigest(basis.snapshot));
  if (candidate.weekOptimizationScope === RECURRING_PHASE_SCOPE) {
    assert.equal(commitment.fullNineSourceDigest, basis.fullNineSource
      ? postgresJsonbContentDigest(basis.fullNineSource.compiler_input) : null);
  }
  return true;
}
