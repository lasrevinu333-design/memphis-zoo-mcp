import { compileStaticWeeklySchedule } from "./static-weekly-schedule-compiler.js";
import { createStaticWeeklyDraftRpcInput, createStaticWeeklyProjectionRpcInput } from "./static-weekly-schedule-database-adapter.js";
import { getStaticWeeklySolverReadiness, initializeStaticWeeklySolver } from "./static-weekly-schedule-solver.js";

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
  await initializeStaticWeeklySolver();
  send({
    type: "ready",
    evidence: {
      compiler: "complete canonical compiler",
      isolation: "node child-process group",
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
