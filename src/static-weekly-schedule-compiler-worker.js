import { compileStaticWeeklySchedule } from "./static-weekly-schedule-compiler.js";
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
    send({ type: "result", id: message.id, result });
  } catch (error) {
    send({ type: "result", id: message.id, error: serializedError(error) });
  } finally {
    active = false;
  }
});
