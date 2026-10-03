import { createHash } from "node:crypto";
import { types as nativeTypes } from "node:util";
import { readFileSync } from "node:fs";
import { compileStaticWeeklySchedule } from "./static-weekly-schedule-compiler.js";
import { postgresJsonbContentDigest } from "./static-weekly-schedule-compiler.js";
import { adaptRegisteredRecurringSource, currentPatternFromPublishedReadback,
  deriveRecurringStaffingPattern, targetSlotsFromManagerRoster, createRecurringPhaseSourceBasis,
  recurringPatternFromFinalPhaseSource,
  createRecurringMorningWeekSourceBasis,deriveVerifiedRecurringMorningWeekCandidate,recurringManagerChangesFromSources,
  deriveScalableCanonicalRecurringWeekCandidate } from "./static-weekly-recurring-staffing-adaptation.js";
import { createStaticWeeklyDraftRpcInput } from "./static-weekly-schedule-database-adapter.js";
import { createStaticWeeklyProjectionWithLunchRpcInput, createStaticWeeklyLunchPreviewDocument } from "./static-weekly-lunch-publication.js";
import { createRecurringManagerDecision, createRecurringFinalManagerChanges,
  RECURRING_IMPLEMENTATION_DIGEST } from "./static-weekly-recurring-preview.js";
import { createRecurringWeekCommitment, createRecurringFullNineTemplateCommitment,
  createRecurringMorningCommitment,assertRecurringMorningCommitmentCandidate,RECURRING_MORNING_SCOPE,
  RECURRING_PHASE_SCOPE, RECURRING_FULL_NINE_SCOPE } from "./static-weekly-recurring-week-commitment.js";
import { createOpeningCoverageReport, sanitizeOpeningCoverageDiagnostic } from './static-weekly-opening-coverage-report.js';
import { installStaticWeeklySha256HexAccelerator } from "./static-weekly-schedule-model.js";
import {
  getStaticWeeklySolverReadiness,
  initializeStaticWeeklySolver,
  installStaticWeeklySolverRuntimeForIsolatedCompiler,
} from "./static-weekly-schedule-solver.js";
import { initializeStaticWeeklySolverEngine } from "./static-weekly-schedule-solver-worker.js";
import { STATIC_WEEKLY_FUSED_COMPILER_RESOURCE_LIMITS } from "./static-weekly-schedule-runtime-policy.js";

installStaticWeeklySha256HexAccelerator((text) => createHash("sha256").update(text, "utf8").digest("hex"), {
  schema:'memphis-zoo.sha256-incremental-native.v1',isProxy:nativeTypes.isProxy,
  create() { const hash=createHash('sha256');let finished=false;return {
    writeUtf8(text) { if(finished)throw new Error('sha256_sink_finished');hash.update(text,'utf8'); },
    finishHex() { if(finished)throw new Error('sha256_sink_finished');finished=true;return hash.digest('hex'); },
  }; },
});

const historicalRecurringTemplate = JSON.parse(readFileSync(new URL("../config/custodial-six-person-static-20260926.json", import.meta.url)));
const currentHandoutRecurringTemplate = JSON.parse(readFileSync(new URL("../config/custodial-six-person-static-20261005.json", import.meta.url)));
const fullNineTemplate = JSON.parse(readFileSync(new URL("../config/custodial-recurring-schedule-20260924.json", import.meta.url)));
const fullNineIdentity = JSON.parse(readFileSync(new URL("../config/custodial-full-nine-family-owners-20260926.json", import.meta.url)));
const fullNineOwners = fullNineIdentity.owners;

function serializedError(error) {
  return {
    code: String(error?.code || "static_weekly_compiler_worker_failed"),
    message: String(error?.message || "The isolated static weekly compiler failed."),
    ...(sanitizeOpeningCoverageDiagnostic(error?.openingCoverageDiagnostic)
      ? {openingCoverageDiagnostic:sanitizeOpeningCoverageDiagnostic(error.openingCoverageDiagnostic)} : {}),
  };
}

function send(message) {
  if (typeof process.send !== "function") throw new Error("The static weekly compiler requires a private IPC parent.");
  process.send(message);
}

function prepareResult(result, preparation, source) {
  if (!preparation) return result;
  if (result?.status !== "FEASIBLE" || result?.publicationAuthority !== "ACCEPTABLE" || result?.verifier?.ok !== true) {
    const error = new Error("Canonical source did not produce a publishable verified schedule.");
    error.code = "static_weekly_control_plane_compiler_rejected";
    throw error;
  }
  if (preparation.kind === "draft") {
    const prepared = createStaticWeeklyDraftRpcInput({
      result,
      expectedRevision: preparation.expectedRevision,
      actor: preparation.actor,
    });
    return {...prepared,openingCoverageReport:createOpeningCoverageReport({source,assignments:result.weeklyAssignments,
      lunch:createStaticWeeklyLunchPreviewDocument(result),context:{publicationId:source.version?.publicationId||source.versions?.[0]?.publicationId||null,
        authorityRevision:preparation.expectedRevision}})};
  }
  if (preparation.kind === "projection") {
    const prepared = createStaticWeeklyProjectionWithLunchRpcInput({
      result,
      publicationId: preparation.publicationId,
      expectedRevision: preparation.expectedRevision,
      actor: preparation.actor,
    });
    return {...prepared,openingCoverageReport:createOpeningCoverageReport({source,assignments:result.weeklyAssignments,
      lunch:prepared.lunchDocument,context:{publicationId:preparation.publicationId,authorityRevision:preparation.expectedRevision}})};
  }
  const error = new Error("The isolated compiler preparation kind is invalid.");
  error.code = "static_weekly_compiler_preparation_invalid";
  throw error;
}

let solverEngine;
try {
  if (process.env.MEMPHIS_STATIC_WEEKLY_COMPILER_WORKER !== "1") throw new Error("The complete compiler requires its isolated compiler-worker role.");
  solverEngine = await initializeStaticWeeklySolverEngine({
    maxOldGenerationSizeMb: STATIC_WEEKLY_FUSED_COMPILER_RESOURCE_LIMITS.maxOldGenerationSizeMb,
    maxSemiSpaceSizeMb: STATIC_WEEKLY_FUSED_COMPILER_RESOURCE_LIMITS.maxSemiSpaceSizeMb,
    maxWasmMemoryPages: (STATIC_WEEKLY_FUSED_COMPILER_RESOURCE_LIMITS.maxWasmMemoryMb * 1024 * 1024) / 65_536,
  });
  installStaticWeeklySolverRuntimeForIsolatedCompiler({
    get identity() { return solverEngine.identity; },
    resourceLimits: STATIC_WEEKLY_FUSED_COMPILER_RESOURCE_LIMITS,
    solve: (lp, options) => solverEngine.solve(lp, options),
  });
  await initializeStaticWeeklySolver();
  send({
    type: "ready",
    evidence: {
      compiler: "complete canonical compiler",
      isolation: "one node child-process group",
      processTopology: "HTTP parent -> one child process containing fused compiler plus pinned HiGHS",
      nestedSolverProcess: false,
      solver: getStaticWeeklySolverReadiness(),
    },
  });
} catch (error) {
  send({ type: "init_error", error: serializedError(error) });
}

let active = false;
process.on("disconnect", () => process.exit(0));
process.on("message", async (message) => {
  if (!message || !new Set(["compile", "recurring-candidate", "recurring-admission-candidate"]).has(message.type)) return;
  if (active) {
    send({ type: "result", id: message.id, error: { code: "static_weekly_compiler_worker_busy", message: "The isolated compiler accepts one serialized request at a time." } });
    return;
  }
  active = true;
  try {
    if (message.type === "compile") {
      const result = await compileStaticWeeklySchedule(message.input);
      send({ type: "result", id: message.id, result: prepareResult(result, message.preparation, message.input) });
    } else {
      const request = message.input || {};
      // The current 323-row handout and retained 312/313 historical packet
      // have separate exact source lineages. Their own adapters validate every
      // tuple; count only selects which closed template to attempt, never a
      // permissive fallback when either lineage is altered.
      const publishedAssignmentCount = request.publishedSource?.compiler_input?.version?.assignments?.length;
      const datedTargetSlots = publishedAssignmentCount === 313
        ? targetSlotsFromManagerRoster({templateConfig:currentHandoutRecurringTemplate,
          managerSnapshot:request.managerSnapshot,effectiveDate:request.effectiveDate,
          expectedRevision:request.expectedRevision}) : null;
      const reducingHistoricalNine = datedTargetSlots && Object.values(datedTargetSlots)
        .filter(slot => slot.vacancy !== true).length < 9;
      const recurringTemplate = publishedAssignmentCount === 323 || reducingHistoricalNine
        ? currentHandoutRecurringTemplate : historicalRecurringTemplate;
      const bound = currentPatternFromPublishedReadback({
        publishedSource: request.publishedSource,
        managerSnapshot: request.managerSnapshot,
        templateConfig: recurringTemplate,
        fullConfig: fullNineTemplate,
        fullOwners: fullNineOwners,
        fullNineSource: request.fullNineSource || null,
        correctionSource:request.correctionSource||null,
        correctionWitness:request.correctionWitness||null,
        effectiveDate: request.effectiveDate,
        expectedRevision: request.expectedRevision,
      });
      const solveHistoricalPattern = () => deriveRecurringStaffingPattern({
        currentConfig: bound.currentConfig,
        targetSlots: bound.currentConfig.slots,
        fullOwners: fullNineOwners,
        fullConfig: fullNineTemplate,
        highs: { solve: (lp, options) => solverEngine.solve(lp, {
          timeLimitSeconds: options?.time_limit || 30,
        }).result },
      });
      const staffedPositions = Object.values(bound.currentConfig.slots)
        .filter((slot) => slot.vacancy !== true).length;
      if (staffedPositions === 9 && request.fullNineSource?.source_id !== fullNineIdentity.baseSourceId) {
        throw Object.assign(new Error("The exact approved nine-position source is not registered for this preview."),
          { code: "static_weekly_recurring_full_source_not_approved" });
      }
      let candidate, changes, phaseSourceBasis = null, finalPattern = null;
      let weekProof = null,morningBasis=null,morningWeek=null;
      if (staffedPositions === 9) {
        const solved=solveHistoricalPattern();
        // The exact historical full-nine source retains its split-family
        // template. It is not a seven-day ordinary-phase minimum.
        candidate = adaptRegisteredRecurringSource({
          registeredSource: request.publishedSource.compiler_input,
          patternConfig: solved.config,
          fullNineSource: request.fullNineSource?.compiler_input || null,
          allowSplitSource: bound.sourcePatternKind === "FULL_NINE",
        });
        changes = solved.preview;
      } else {
        if (bound.sourcePatternKind !== "UNSPLIT"
          && !(bound.sourcePatternKind === "FULL_NINE" && bound.reductionContext)) {
          throw Object.assign(new Error("The accepted recurring source has no complete canonical phase transition basis."),
            { code: "static_weekly_recurring_phase_source_unsupported" });
        }
        if(bound.sourcePatternKind==='FULL_NINE'&&(!request.correctionSource||!request.correctionWitness
          || bound.reductionContext?.correctionWitness?.digest!==request.correctionWitness.digest))
          throw Object.assign(new Error('The distinct registered current correction source is unavailable for this historical transition.'),
            {code:'static_weekly_recurring_correction_binding_required'});
        morningBasis=createRecurringMorningWeekSourceBasis({registeredSource:request.publishedSource.compiler_input,currentConfig:bound.currentConfig,
          reductionContext:bound.reductionContext||null,targetEffectiveDate:request.effectiveDate});
        morningWeek=deriveVerifiedRecurringMorningWeekCandidate({basis:morningBasis,fullOwners:fullNineOwners,solver:solverEngine});
        if(morningWeek.status!=='UNREGISTERED_VERIFIED_RECURRING_MORNING_WEEK')throw Object.assign(
          new Error(`The complete original-source morning proof is unavailable at ${morningWeek.stage} day ${morningWeek.dayOfWeek}.`),
          {code:'static_weekly_recurring_morning_proof_unavailable'});
        phaseSourceBasis = createRecurringPhaseSourceBasis({
          registeredSource: request.publishedSource.compiler_input,
          patternConfig: bound.currentConfig,
          reductionContext:bound.reductionContext||null,
          morningWeek,morningBasis,fullOwners:fullNineOwners,
        });
        weekProof = deriveScalableCanonicalRecurringWeekCandidate({
          source: phaseSourceBasis.source,
          currentConfig: phaseSourceBasis.ownerConfig,
          fullOwners: fullNineOwners,
          phaseSourceBasis,
          solver: { solve: (lp, options) => solverEngine.solve(lp, {
            ...options,
            timeLimitSeconds: options?.timeLimitSeconds || options?.time_limit || 30,
          }) },
        });
        if (weekProof?.status !== "UNREGISTERED_CANONICAL_RECURRING_WEEK_CANDIDATE") {
          const failedDay = Number.isInteger(weekProof?.dayOfWeek) ? ` day ${weekProof.dayOfWeek}` : "";
          throw Object.assign(new Error(`The complete seven-day recurring phase proof is unavailable at ${weekProof?.stage || "source"}${failedDay}.`),
            { code: "static_weekly_recurring_week_proof_unavailable" });
        }
        finalPattern = recurringPatternFromFinalPhaseSource({
          phaseSourceBasis, finalSource: weekProof.candidateSource,
        });
        candidate = { compilerInput: weekProof.candidateSource,
          patternFingerprint: finalPattern.configDigest };
        changes = createRecurringFinalManagerChanges({
          preliminaryChanges: recurringManagerChangesFromSources({originalSource:morningBasis.source,finalSource:candidate.compilerInput,currentConfig:finalPattern.config}),
          phaseSource: phaseSourceBasis.source,
          finalSource: candidate.compilerInput,
          ownerConfig: finalPattern.config,
        });
      }
      const compileInput = structuredClone(candidate.compilerInput);
      compileInput.versions = [compileInput.version];
      delete compileInput.version;
      const compiled = await compileStaticWeeklySchedule(compileInput);
      if (compiled?.status !== "FEASIBLE" || compiled?.publicationAuthority !== "ACCEPTABLE"
        || compiled?.verifier?.ok !== true || compiled.reviewWork?.length !== 0) {
        throw Object.assign(new Error("Recurring staffing candidate failed the canonical compiler."),
          { code: "static_weekly_recurring_candidate_rejected" });
      }
      const lunch = createStaticWeeklyLunchPreviewDocument(compiled);
      const lunchFacts = { loans: lunch.loans, responsibilities: lunch.responsibilities,
        notificationIntents: lunch.notification_intents };
      const decision = createRecurringManagerDecision({ candidateInput: candidate.compilerInput,
        compiled, lunch, changes });
      const decisionDigest = postgresJsonbContentDigest(decision);
      const openingCoverageReport = createOpeningCoverageReport({source:candidate.compilerInput,
        assignments:compiled.weeklyAssignments,lunch,decisionDigest,
        context:{publicationId:bound.publicationId,authorityRevision:bound.authorityRevision}});
      const publishedSourceDigest = postgresJsonbContentDigest(request.publishedSource.compiler_input);
      const managerSnapshotDigest = postgresJsonbContentDigest(request.managerSnapshot);
      const fullNineSourceDigest = request.fullNineSource?.compiler_input
        ? postgresJsonbContentDigest(request.fullNineSource.compiler_input) : null;
      const correctionSourceDigest=request.correctionSource?.compiler_input
        ?postgresJsonbContentDigest(request.correctionSource.compiler_input):null;
      const correctionWitnessDigest=request.correctionWitness?.digest||null;
      const readbackPatternDigest = postgresJsonbContentDigest(bound.currentConfig);
      const binding = { sourceId: bound.sourceId, publicationId: bound.publicationId,
        authorityRevision: bound.authorityRevision, effectiveWeek: request.effectiveDate,
        publishedSourceDigest, managerSnapshotDigest, readbackPatternDigest,
        fullNineSourceDigest, fullNineSourceId:request.fullNineSource?.source_id || null,
        sourcePatternKind:bound.sourcePatternKind,correctionSourceDigest,correctionWitnessDigest };
      const weekCommitment = weekProof && createRecurringWeekCommitment({
        week: weekProof, source: phaseSourceBasis.source,
        ownerConfig: phaseSourceBasis.ownerConfig, fullOwners: fullNineOwners,
        phaseSourceBasis,
        sourceBasisDigest: phaseSourceBasis.basisDigest,
        finalSource: candidate.compilerInput, finalPatternConfig: finalPattern.config,
        compiled, implementationDigest: RECURRING_IMPLEMENTATION_DIGEST,
        binding,
      });
      const morningCommitment=morningWeek&&createRecurringMorningCommitment({morningWeek,morningBasis,phaseSourceBasis,fullOwners:fullNineOwners,
        finalSource:candidate.compilerInput,lateCommitment:weekCommitment,binding});
      const staticTemplateCommitment = staffedPositions === 9
        ? createRecurringFullNineTemplateCommitment({
          registeredFullNineSource: request.fullNineSource.compiler_input,
          finalSource: candidate.compilerInput, compiled,
          implementationDigest: RECURRING_IMPLEMENTATION_DIGEST,
          patternFingerprint: candidate.patternFingerprint,
          binding: { ...binding, registeredFullNineSourceId: request.fullNineSource.source_id,
            registeredFullNineSourceDigest: fullNineSourceDigest },
          approvedIdentity: fullNineIdentity,
        }) : undefined;
      const publicCandidate = {
        status: "CANDIDATE_ONLY", sourceId: bound.sourceId,
        publicationId: bound.publicationId, authorityRevision: bound.authorityRevision,
        ...(bound.repairContext ? {patternPublicationId:bound.patternPublicationId,
          repairContext:bound.repairContext,repairContextDigest:bound.repairContextDigest} : {}),
        sourcePatternKind: bound.sourcePatternKind,
        weekOptimizationScope: staffedPositions === 9 ? RECURRING_FULL_NINE_SCOPE : RECURRING_PHASE_SCOPE,
        ...(weekCommitment ? { weekCommitment,
          morningCommitment,morningOptimizationScope:RECURRING_MORNING_SCOPE,morningSourceBasisDigest:morningBasis.basisDigest,
          phaseSourceBasisDigest: phaseSourceBasis.basisDigest,
          ...(phaseSourceBasis.reductionContext
            ? {reductionContextDigest:phaseSourceBasis.reductionContext.contextDigest} : {})
        } : { staticTemplateCommitment }),
        publishedSourceDigest, managerSnapshotDigest,
        fullNineSourceDigest,
        ...(correctionWitnessDigest?{correctionSourceDigest,correctionWitnessDigest}:{}),
        readbackPatternDigest,
        effectiveDate: request.effectiveDate, staffedPositions,
        candidateSourceDigest: postgresJsonbContentDigest(candidate.compilerInput),
        patternFingerprint: candidate.patternFingerprint,
        assignmentCount: candidate.compilerInput.version.assignments.length,
        compilerVersion: compiled.compilerVersion,
        modelBasisDigest: compiled.certificate?.modelBasisDigest,
        assignmentWitnessDigest: compiled.certificate?.assignmentDigest,
        finalWitnessDigest: compiled.certificate?.finalWitness?.digest,
        weeklyAssignmentsDigest: postgresJsonbContentDigest(compiled.weeklyAssignments),
        metricsDigest: postgresJsonbContentDigest(compiled.metrics),
        lunchFactsDigest: postgresJsonbContentDigest(lunchFacts),
        lunchLoanCount: lunch.loans.length,
        openWorkDigest: postgresJsonbContentDigest(compiled.openWork),
        openWorkCount: compiled.openWork.length,
        shiftEndDerivationDigest: postgresJsonbContentDigest(compiled.canonicalAuthority.shiftEndDerivation || null),
        decision, decisionDigest, openingCoverageReport,
        compilerStatus: compiled.status, publicationAuthority: compiled.publicationAuthority,
        verifierOk: compiled.verifier.ok, reviewWorkCount: compiled.reviewWork.length,
        changes, registrationRequired: true, managerConfirmationRequired: true,
      };
      if(morningCommitment)assertRecurringMorningCommitmentCandidate(publicCandidate);
      send({ type: "result", id: message.id, result: message.type === "recurring-admission-candidate"
        ? { schema: "static-weekly.recurring-admission-candidate.v1",
          candidate: publicCandidate, canonicalSource: candidate.compilerInput }
        : publicCandidate });
    }
  } catch (error) {
    send({ type: "result", id: message.id, error: serializedError(error) });
  } finally {
    active = false;
  }
});
