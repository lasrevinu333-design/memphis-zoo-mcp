import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { compileStaticWeeklySchedule } from "./static-weekly-schedule-compiler.js";
import { postgresJsonbContentDigest } from "./static-weekly-schedule-compiler.js";
import { adaptRegisteredRecurringSource, currentPatternFromPublishedReadback,
  deriveRecurringStaffingPattern } from "./static-weekly-recurring-staffing-adaptation.js";
import { createStaticWeeklyDraftRpcInput } from "./static-weekly-schedule-database-adapter.js";
import { createStaticWeeklyProjectionWithLunchRpcInput, createStaticWeeklyLunchPreviewDocument } from "./static-weekly-lunch-publication.js";
import { createRecurringManagerDecision } from "./static-weekly-recurring-preview.js";
import { createOpeningCoverageReport, sanitizeOpeningCoverageDiagnostic } from './static-weekly-opening-coverage-report.js';
import { installStaticWeeklySha256HexAccelerator } from "./static-weekly-schedule-model.js";
import {
  getStaticWeeklySolverReadiness,
  initializeStaticWeeklySolver,
  installStaticWeeklySolverRuntimeForIsolatedCompiler,
} from "./static-weekly-schedule-solver.js";
import { initializeStaticWeeklySolverEngine } from "./static-weekly-schedule-solver-worker.js";
import { STATIC_WEEKLY_FUSED_COMPILER_RESOURCE_LIMITS } from "./static-weekly-schedule-runtime-policy.js";

installStaticWeeklySha256HexAccelerator((text) => createHash("sha256").update(text, "utf8").digest("hex"));

const recurringTemplate = JSON.parse(readFileSync(new URL("../config/custodial-six-person-static-20260926.json", import.meta.url)));
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
      const bound = currentPatternFromPublishedReadback({
        publishedSource: request.publishedSource,
        managerSnapshot: request.managerSnapshot,
        templateConfig: recurringTemplate,
        fullConfig: fullNineTemplate,
        fullOwners: fullNineOwners,
        effectiveDate: request.effectiveDate,
        expectedRevision: request.expectedRevision,
      });
      const solved = deriveRecurringStaffingPattern({
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
      const candidate = adaptRegisteredRecurringSource({
        registeredSource: request.publishedSource.compiler_input,
        patternConfig: solved.config,
        fullNineSource: request.fullNineSource?.compiler_input || null,
        allowSplitSource: bound.sourcePatternKind === "FULL_NINE",
      });
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
        compiled, lunch, changes: solved.preview });
      const decisionDigest = postgresJsonbContentDigest(decision);
      const openingCoverageReport = createOpeningCoverageReport({source:candidate.compilerInput,
        assignments:compiled.weeklyAssignments,lunch,decisionDigest,
        context:{publicationId:bound.publicationId,authorityRevision:bound.authorityRevision}});
      const publicCandidate = {
        status: "CANDIDATE_ONLY", sourceId: bound.sourceId,
        publicationId: bound.publicationId, authorityRevision: bound.authorityRevision,
        ...(bound.repairContext ? {patternPublicationId:bound.patternPublicationId,
          repairContext:bound.repairContext,repairContextDigest:bound.repairContextDigest} : {}),
        sourcePatternKind: bound.sourcePatternKind,
        publishedSourceDigest: postgresJsonbContentDigest(request.publishedSource.compiler_input),
        managerSnapshotDigest: postgresJsonbContentDigest(request.managerSnapshot),
        fullNineSourceDigest: request.fullNineSource?.compiler_input
          ? postgresJsonbContentDigest(request.fullNineSource.compiler_input) : null,
        readbackPatternDigest: postgresJsonbContentDigest(bound.currentConfig),
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
        changes: solved.preview, registrationRequired: true, managerConfirmationRequired: true,
      };
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
