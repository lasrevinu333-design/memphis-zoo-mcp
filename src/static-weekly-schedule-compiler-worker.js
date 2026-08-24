import { createHash } from "node:crypto";
import { compileStaticWeeklySchedule } from "./static-weekly-schedule-compiler.js";
import { createStaticWeeklyDraftRpcInput, createStaticWeeklyProjectionRpcInput } from "./static-weekly-schedule-database-adapter.js";
import { installStaticWeeklySha256HexAccelerator } from "./static-weekly-schedule-model.js";
import {
  getStaticWeeklySolverReadiness,
  initializeStaticWeeklySolver,
  installStaticWeeklySolverRuntimeForIsolatedCompiler,
} from "./static-weekly-schedule-solver.js";
import { initializeStaticWeeklySolverEngine } from "./static-weekly-schedule-solver-worker.js";
import { STATIC_WEEKLY_FUSED_COMPILER_RESOURCE_LIMITS } from "./static-weekly-schedule-runtime-policy.js";

installStaticWeeklySha256HexAccelerator((text) => createHash("sha256").update(text, "utf8").digest("hex"));

function serializedError(error) {
  return {
    code: String(error?.code || "static_weekly_compiler_worker_failed"),
    message: String(error?.message || "The isolated static weekly compiler failed."),
  };
}

function send(message) {
  if (typeof process.send !== "function") throw new Error("The static weekly compiler requires a private IPC parent.");
  process.send(message);
}

function prepareResult(result, preparation) {
  if (!preparation) return result;
  if (result?.status !== "FEASIBLE" || result?.publicationAuthority !== "ACCEPTABLE" || result?.verifier?.ok !== true) {
    const error = new Error("Canonical source did not produce a publishable verified schedule.");
    error.code = "static_weekly_control_plane_compiler_rejected";
    throw error;
  }
  if (preparation.kind === "draft") {
    return createStaticWeeklyDraftRpcInput({
      result,
      expectedRevision: preparation.expectedRevision,
      actor: preparation.actor,
    });
  }
  if (preparation.kind === "projection") {
    return createStaticWeeklyProjectionRpcInput({
      result,
      publicationId: preparation.publicationId,
      expectedRevision: preparation.expectedRevision,
      actor: preparation.actor,
    });
  }
  const error = new Error("The isolated compiler preparation kind is invalid.");
  error.code = "static_weekly_compiler_preparation_invalid";
  throw error;
}

try {
  if (process.env.MEMPHIS_STATIC_WEEKLY_COMPILER_WORKER !== "1") throw new Error("The complete compiler requires its isolated compiler-worker role.");
  const solverEngine = await initializeStaticWeeklySolverEngine({
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
  if (!message || message.type !== "compile") return;
  if (active) {
    send({ type: "result", id: message.id, error: { code: "static_weekly_compiler_worker_busy", message: "The isolated compiler accepts one serialized request at a time." } });
    return;
  }
  active = true;
  try {
    const result = await compileStaticWeeklySchedule(message.input);
    send({ type: "result", id: message.id, result: prepareResult(result, message.preparation) });
  } catch (error) {
    send({ type: "result", id: message.id, error: serializedError(error) });
  } finally {
    active = false;
  }
});
