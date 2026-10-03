// Executed only as the private detached child of the recurring HTTP owner.
// No database/compiler work is initialized before nonce and source agreement.
import { assertClosedRecurringOperationInput, assertClosedRecurringOperationReceipt } from "./static-weekly-recurring-operation-envelope.js";
import { recurringOperationSourceManifest } from "./static-weekly-recurring-operation-source.js";

const HEX = /^[a-f0-9]{64}$/;
const NONCE = /^[a-f0-9]{48}$/;

function privateError(code) { return Object.assign(new Error(code), { code }); }

export async function executeRecurringOperationInChild(input, { signal, remainingMilliseconds } = {}) {
  const request = assertClosedRecurringOperationInput(input);
  if (!Number.isSafeInteger(remainingMilliseconds) || remainingMilliseconds < 1 || remainingMilliseconds > 60_000) {
    throw privateError("static_weekly_operation_deadline_invalid");
  }
  const deadlineAt = performance.now() + remainingMilliseconds;
  // Lazy imports keep the pre-work source/nonce gate before any CP, database,
  // solver or provider initialization. The isolated runtime inherits this
  // exact child process group; the HTTP parent owns group reaping.
  const [{ createStaticWeeklyControlPlane, createStaticWeeklyControlPlaneDatabase },
    { createStaticWeeklyCompilerRuntime }] = await Promise.all([
    import("./static-weekly-control-plane.js"),
    import("./static-weekly-schedule-compiler-runtime.js"),
  ]);
  if (signal?.aborted) throw privateError("static_weekly_operation_aborted");
  const compiler = createStaticWeeklyCompilerRuntime({ workerDetached: false });
  const database = createStaticWeeklyControlPlaneDatabase({ maxConnections: 1 });
  const controlPlane = createStaticWeeklyControlPlane({ database,
    compiler: compiler.compile,
    compilerPreparer: compiler.compileAndPrepare,
    recurringCandidatePreparer: compiler.prepareRecurringCandidate,
    recurringAdmissionPreparer: compiler.prepareRecurringAdmissionCandidate,
    initializeSolver: compiler.initialize,
    getSolverReadiness: compiler.getReadiness,
    shutdownCompiler: compiler.shutdown,
    transactionConcurrency: 1,
    maxQueuedTransactions: 1,
  });
  let result;
  let operationError = null;
  try {
    const common = { manager: request.manager, effectiveStart: request.body.effective_start,
      expectedRevision: request.body.expected_revision, fullNineSourceId: request.body.full_nine_source_id ?? null,
      signal, deadlineAt };
    result = request.kind === "preview"
      ? await controlPlane.previewRecurringStaffing(common)
      : await controlPlane.confirmRecurringStaffing({ ...common,
        confirmationKey: request.body.confirmation_key, previewDigest: request.body.preview_digest });
  } catch (error) { operationError = error; }
  // An unsettled pg client or compiler shutdown is not success. The parent
  // retains custody and kills/reaps this exact group by its original deadline.
  try { await controlPlane.close(); } catch (error) { operationError ||= error; }
  if (operationError) throw operationError;
  if (signal?.aborted || performance.now() >= deadlineAt) throw privateError("static_weekly_operation_outcome_unknown");
  return assertClosedRecurringOperationReceipt({ kind: request.kind, data: result }, request);
}

export function createRecurringOperationChildProtocol({
  sourceManifest = recurringOperationSourceManifest,
  execute = executeRecurringOperationInChild,
  send,
  close,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  if (typeof send !== "function" || typeof close !== "function") throw new TypeError("Private child IPC and close callbacks are required.");
  let state = "new";
  let nonce = null;
  let sourceDigest = null;
  let timer = null;
  let controller = null;
  const finish = async (message) => {
    if (state === "closed") return;
    state = "closed";
    clearTimer(timer);
    try { if (message) await send(message); } finally { await close(); }
  };
  return async function receive(message) {
    if (state === "closed") return;
    if (message?.type === "cancel-before-work" && state !== "running") {
      await finish(null);
      return;
    }
    if (state === "new") {
      if (message?.type !== "init" || !NONCE.test(message.nonce || "") || !HEX.test(message.sourceDigest || "")) {
        await finish(null); return;
      }
      nonce = message.nonce;
      sourceDigest = message.sourceDigest;
      let current;
      try { current = sourceManifest(); } catch { await finish(null); return; }
      if (current?.digest !== sourceDigest) { await finish(null); return; }
      state = "ready";
      await send({ type: "ready", nonce, sourceDigest });
      return;
    }
    if (state !== "ready" || message?.type !== "run" || message.nonce !== nonce
      || message.sourceDigest !== sourceDigest || !Number.isSafeInteger(message.remainingMilliseconds)
      || message.remainingMilliseconds < 1 || message.remainingMilliseconds > 60_000) {
      await finish(null); return;
    }
    let input;
    try { input = assertClosedRecurringOperationInput(message.input); }
    catch { await finish(null); return; }
    try { if (sourceManifest()?.digest !== sourceDigest) { await finish(null); return; } }
    catch { await finish(null); return; }
    state = "running";
    controller = new AbortController();
    const childDeadlineAt = performance.now() + message.remainingMilliseconds;
    timer = setTimer(() => controller.abort(privateError("static_weekly_operation_deadline")), message.remainingMilliseconds);
    timer?.unref?.();
    let response;
    try {
      const receipt = await execute(input, { signal: controller.signal, remainingMilliseconds: message.remainingMilliseconds });
      if (sourceManifest()?.digest !== sourceDigest) throw privateError("static_weekly_operation_source_changed");
      const closedReceipt = assertClosedRecurringOperationReceipt(receipt, input);
      if (controller.signal.aborted || performance.now() >= childDeadlineAt) throw privateError("static_weekly_operation_deadline");
      response = { type: "result", nonce, sourceDigest, status: "ok",
        receipt: closedReceipt };
    } catch (error) {
      const failureCode = typeof error?.code === "string" && /^static_weekly_[a-z0-9_]{1,100}$/.test(error.code)
        ? error.code : null;
      response = { type: "result", nonce, sourceDigest,
        status: controller.signal.aborted || error?.code === "static_weekly_recurring_confirmation_outcome_unknown"
          || error?.code === "static_weekly_operation_outcome_unknown"
          || error?.code === "static_weekly_operation_deadline" ? "unknown" : "failed",
        ...(failureCode ? { failureCode } : {}) };
    }
    await finish(response);
  };
}

if (typeof process.send === "function" && process.env.STATIC_WEEKLY_RECURRING_OPERATION_CHILD === "1") {
  const receive = createRecurringOperationChildProtocol({
    send: (message) => new Promise((resolve, reject) => process.send(message, (error) => error ? reject(error) : resolve())),
    close: () => { process.disconnect(); },
  });
  process.on("message", (message) => { void receive(message).catch(() => { process.exitCode = 70; process.disconnect(); }); });
}
