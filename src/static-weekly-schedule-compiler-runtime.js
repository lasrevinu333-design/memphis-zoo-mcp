/*
 * The canonical compiler performs substantial deterministic JavaScript work
 * around the already-isolated HiGHS child process. Running that work on the
 * HTTP thread can starve health checks even though the compiler is healthy.
 *
 * The complete compiler and pinned HiGHS engine therefore run together in one
 * serialized child-process group. Group ownership lets the HTTP process reap
 * the complete compute boundary atomically after a timeout, crash, or shutdown
 * without paying for a redundant nested V8 runtime.
 */
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { REQUEST_DEADLINE_MILLISECONDS } from "./static-weekly-schedule-program.js";
import { STATIC_WEEKLY_FUSED_COMPILER_RESOURCE_LIMITS } from "./static-weekly-schedule-runtime-policy.js";

export const STATIC_WEEKLY_COMPILER_RUNTIME_LIMITS = Object.freeze({
  initializationMilliseconds: 30_000,
  requestMilliseconds: REQUEST_DEADLINE_MILLISECONDS + 15_000,
  maxOutstandingRequests: 8,
  // The production service is a 512 MiB Render Starter instance. The original
  // Earlier three-process envelopes either exceeded the Starter instance or
  // forced the compiler below its deterministic production-packet lower bound.
  // Fusing compiler and HiGHS removes one V8/IPC process and permits the
  // previously proven 128 MiB compiler heap while retaining a conservative
  // hard-cap margin under the approved 512 MiB service.
  ...STATIC_WEEKLY_FUSED_COMPILER_RESOURCE_LIMITS,
});

function runtimeError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function workerFailure(message, fallbackCode = "static_weekly_compiler_worker_failed") {
  return runtimeError(message?.code || fallbackCode, message?.message || "The isolated static weekly compiler failed.");
}

function productionWorkerUrl() {
  return new URL("./static-weekly-schedule-compiler-worker.js", import.meta.url);
}

function monotonicNowMilliseconds() {
  return typeof performance?.now === "function" ? performance.now() : Number(process.hrtime.bigint() / 1_000_000n);
}

function refWorkerProcess(candidate) { candidate?.ref?.(); candidate?.channel?.ref?.(); }
function unrefWorkerProcess(candidate) { candidate?.channel?.unref?.(); candidate?.unref?.(); }

function compilerExecArgv(resourceLimits) {
  return [
    `--max-old-space-size=${resourceLimits.maxOldGenerationSizeMb}`,
    `--max-semi-space-size=${resourceLimits.maxSemiSpaceSizeMb}`,
    `--wasm-max-mem-pages=${(resourceLimits.maxWasmMemoryMb * 1024 * 1024) / 65_536}`,
    `--stack-size=${resourceLimits.stackSizeKb}`,
  ];
}

const MAX_DIAGNOSTIC_STDERR_BYTES = 8 * 1024;
function appendDiagnosticStderr(current, chunk) {
  const combined = Buffer.concat([Buffer.from(current || "", "utf8"), Buffer.from(chunk)]);
  return combined.subarray(Math.max(0, combined.length - MAX_DIAGNOSTIC_STDERR_BYTES)).toString("utf8");
}

function terminateProcessGroup(candidate) {
  if (!candidate) return Promise.resolve();
  const pid = Number(candidate.pid);
  if (!Number.isSafeInteger(pid) || pid <= 1) return Promise.reject(runtimeError("static_weekly_compiler_worker_identity_invalid", "The isolated compiler process identity was invalid."));
  refWorkerProcess(candidate);
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      candidate.removeListener("exit", finish);
      unrefWorkerProcess(candidate);
      resolve();
    };
    const timer = setTimeout(finish, 2_000);
    timer.unref?.();
    candidate.once("exit", finish);
    try {
      // The compiler is a detached group leader, so one exact kill owns the
      // complete fused compiler/solver boundary and any unexpected descendant.
      process.kill(-pid, "SIGKILL");
    } catch {
      try { candidate.kill("SIGKILL"); } catch { finish(); }
    }
    if (candidate.exitCode != null || candidate.signalCode != null) finish();
  });
}

export function createStaticWeeklyCompilerRuntime({
  workerUrl = productionWorkerUrl(),
  initializationMilliseconds = STATIC_WEEKLY_COMPILER_RUNTIME_LIMITS.initializationMilliseconds,
  requestMilliseconds = STATIC_WEEKLY_COMPILER_RUNTIME_LIMITS.requestMilliseconds,
  maxOutstandingRequests = STATIC_WEEKLY_COMPILER_RUNTIME_LIMITS.maxOutstandingRequests,
  exposeProcessIdentityForTest = false,
  resourceLimits = {
    maxOldGenerationSizeMb: STATIC_WEEKLY_COMPILER_RUNTIME_LIMITS.maxOldGenerationSizeMb,
    maxSemiSpaceSizeMb: STATIC_WEEKLY_COMPILER_RUNTIME_LIMITS.maxSemiSpaceSizeMb,
    maxWasmMemoryMb: STATIC_WEEKLY_COMPILER_RUNTIME_LIMITS.maxWasmMemoryMb,
    stackSizeKb: STATIC_WEEKLY_COMPILER_RUNTIME_LIMITS.stackSizeKb,
  },
} = {}) {
  if (!Number.isSafeInteger(initializationMilliseconds) || initializationMilliseconds < 1) throw new Error("Compiler process initialization timeout must be a positive integer.");
  if (!Number.isSafeInteger(requestMilliseconds) || requestMilliseconds < 1) throw new Error("Compiler process request timeout must be a positive integer.");
  if (!Number.isSafeInteger(maxOutstandingRequests) || maxOutstandingRequests < 1) throw new Error("Compiler process outstanding-request limit must be a positive integer.");
  for (const [name, value] of Object.entries(resourceLimits)) {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Compiler process ${name} must be a positive integer.`);
  }
  if (typeof exposeProcessIdentityForTest !== "boolean") throw new Error("Compiler process identity exposure must be a boolean test option.");

  let state = "uninitialized";
  let worker = null;
  let generation = 0;
  let initialization = null;
  let pending = null;
  let sequence = 0;
  let tail = Promise.resolve();
  let outstanding = 0;
  let lastError = null;
  let workerEvidence = null;
  let closed = false;
  let shutdownPromise = null;
  let teardownCandidate = null;
  let teardown = Promise.resolve();

  function readiness() {
    return {
      state,
      available: state === "ready" && Boolean(worker && workerEvidence) && !closed,
      runtime: "node child-process group / complete canonical compiler",
      serialized: true,
      maxOutstandingRequests,
      resourceLimits,
      worker: workerEvidence,
      error: lastError ? String(lastError.message || lastError) : null,
    };
  }

  function clearPending(record, settle, value) {
    if (!record || record.settled) return;
    record.settled = true;
    if (record.timer) clearTimeout(record.timer);
    if (pending === record) pending = null;
    unrefWorkerProcess(record.candidate);
    settle(value);
  }

  function detach(candidate) {
    candidate?.removeAllListeners?.("message");
    candidate?.removeAllListeners?.("error");
    candidate?.removeAllListeners?.("exit");
  }

  function discard(candidate, cause) {
    if (!candidate) return Promise.resolve();
    if (teardownCandidate === candidate) return teardown;
    if (worker === candidate) worker = null;
    workerEvidence = null;
    state = closed ? "closed" : "unavailable";
    lastError = cause;
    detach(candidate);
    teardownCandidate = candidate;
    teardown = terminateProcessGroup(candidate).finally(() => {
      if (teardownCandidate === candidate) teardownCandidate = null;
    });
    return teardown;
  }

  function failActive(candidate, cause) {
    if (initialization?.candidate === candidate && !initialization.settled) {
      const active = initialization;
      active.settled = true;
      clearTimeout(active.timer);
      initialization = null;
      active.reject(cause);
    }
    if (pending?.candidate === candidate) clearPending(pending, pending.reject, cause);
    void discard(candidate, cause);
  }

  async function start() {
    await teardown;
    if (closed) throw runtimeError("static_weekly_compiler_closed", "The isolated compiler is closed.");
    if (state === "ready" && worker && workerEvidence) return readiness();
    if (initialization) return initialization.promise;

    state = "initializing";
    lastError = null;
    workerEvidence = null;
    const candidateGeneration = ++generation;
    const candidate = fork(fileURLToPath(workerUrl), [], {
      detached: true,
      execArgv: compilerExecArgv(resourceLimits),
      env: { ...process.env, MEMPHIS_STATIC_WEEKLY_COMPILER_WORKER: "1" },
      serialization: "advanced",
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    });
    let diagnosticStderr = "";
    candidate.stderr?.on("data", (chunk) => { diagnosticStderr = appendDiagnosticStderr(diagnosticStderr, chunk); });
    refWorkerProcess(candidate);
    let resolveInitialization; let rejectInitialization;
    const record = {
      candidate,
      generation: candidateGeneration,
      settled: false,
      timer: null,
      promise: new Promise((resolve, reject) => { resolveInitialization = resolve; rejectInitialization = reject; }),
      resolve: resolveInitialization,
      reject: rejectInitialization,
    };
    initialization = record;
    worker = candidate;
    record.timer = setTimeout(() => {
      failActive(candidate, runtimeError("static_weekly_compiler_worker_timeout", "The isolated compiler did not become ready before its initialization deadline."));
    }, initializationMilliseconds);
    record.timer.unref?.();

    candidate.on("message", (message) => {
      if (!message || typeof message !== "object" || candidateGeneration !== generation) return;
      if (message.type === "ready" && initialization === record && !record.settled) {
        record.settled = true;
        clearTimeout(record.timer);
        initialization = null;
        state = "ready";
        workerEvidence = {
          ...(message.evidence || { compiler: "canonical" }),
          ...(exposeProcessIdentityForTest ? { processId: candidate.pid } : {}),
        };
        unrefWorkerProcess(candidate);
        record.resolve(readiness());
        return;
      }
      if (message.type === "init_error" && initialization === record && !record.settled) {
        failActive(candidate, workerFailure(message.error, "static_weekly_compiler_worker_unavailable"));
        return;
      }
      if (message.type !== "result" || !pending || pending.candidate !== candidate || pending.id !== message.id) return;
      const active = pending;
      if (message.error) clearPending(active, active.reject, workerFailure(message.error));
      else clearPending(active, active.resolve, message.result);
    });
    candidate.on("error", (error) => failActive(candidate, runtimeError("static_weekly_compiler_worker_crashed", error?.message || "The isolated compiler process crashed.")));
    candidate.on("exit", (code, signal) => {
      if (candidateGeneration !== generation || worker !== candidate) return;
      const cause = runtimeError(
        "static_weekly_compiler_worker_exited",
        `The isolated compiler process exited unexpectedly (${signal || code || "unknown"}).`,
      );
      cause.diagnostic = Object.freeze({ exitCode: code ?? null, signal: signal || null, stderrTail: diagnosticStderr });
      failActive(candidate, cause);
    });
    return record.promise;
  }

  async function send(input, preparation, deadline) {
    await start();
    const remainingMilliseconds = Math.floor(deadline - monotonicNowMilliseconds());
    if (remainingMilliseconds <= 0) throw runtimeError("static_weekly_compiler_queue_timeout", "The isolated compiler request expired while waiting for its serialized execution slot.");
    const candidate = worker;
    if (!candidate || state !== "ready") throw runtimeError("static_weekly_compiler_worker_unavailable", "The isolated compiler process is unavailable.");
    refWorkerProcess(candidate);
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const record = { id, candidate, settled: false, timer: null, resolve, reject };
      pending = record;
      record.timer = setTimeout(() => {
        const cause = runtimeError("static_weekly_compiler_worker_timeout", "The isolated compiler exceeded the complete request deadline.");
        clearPending(record, reject, cause);
        void discard(candidate, cause);
      }, remainingMilliseconds);
      record.timer.unref?.();
      try {
        candidate.send({ type: "compile", id, input, preparation }, (error) => {
          if (!error || record.settled) return;
          const cause = runtimeError("static_weekly_compiler_worker_unavailable", error.message || "The compiler request could not be sent to its process.");
          clearPending(record, reject, cause);
          void discard(candidate, cause);
        });
      } catch (error) {
        const cause = runtimeError("static_weekly_compiler_worker_unavailable", error?.message || "The compiler request could not be sent to its process.");
        clearPending(record, reject, cause);
        void discard(candidate, cause);
      }
    });
  }

  function enqueue(input = {}, preparation = null) {
    if (closed) return Promise.reject(runtimeError("static_weekly_compiler_closed", "The isolated compiler is closed."));
    if (outstanding >= maxOutstandingRequests) return Promise.reject(runtimeError("static_weekly_compiler_busy", "The isolated compiler already has its maximum bounded request queue."));
    outstanding += 1;
    const deadline = monotonicNowMilliseconds() + requestMilliseconds;
    const run = () => send(input, preparation, deadline);
    const queued = tail.then(run, run);
    tail = queued.then(() => undefined, () => undefined);
    return queued.finally(() => { outstanding -= 1; });
  }

  function compile(input = {}) {
    return enqueue(input, null);
  }

  function compileAndPrepare(input = {}, preparation = {}) {
    const kind = String(preparation?.kind || "");
    if (!new Set(["draft", "projection"]).has(kind)) {
      return Promise.reject(runtimeError("static_weekly_compiler_preparation_invalid", "The isolated compiler preparation kind is invalid."));
    }
    return enqueue(input, preparation);
  }

  function shutdown() {
    if (shutdownPromise) return shutdownPromise;
    shutdownPromise = (async () => {
      closed = true;
      state = "closed";
      const cause = runtimeError("static_weekly_compiler_closed", "The isolated compiler was closed by the production runtime.");
      const candidate = worker;
      if (initialization?.candidate === candidate && !initialization.settled) {
        const active = initialization;
        active.settled = true;
        clearTimeout(active.timer);
        initialization = null;
        active.reject(cause);
      }
      if (pending?.candidate === candidate) clearPending(pending, pending.reject, cause);
      await discard(candidate, cause);
      await tail;
      state = "closed";
    })();
    return shutdownPromise;
  }

  return { compile, compileAndPrepare, initialize: start, getReadiness: readiness, shutdown, terminateForTest: shutdown };
}

const productionRuntime = createStaticWeeklyCompilerRuntime();

export const compileStaticWeeklyScheduleIsolated = productionRuntime.compile;
export const compileAndPrepareStaticWeeklyScheduleIsolated = productionRuntime.compileAndPrepare;
export const initializeStaticWeeklyCompiler = productionRuntime.initialize;
export const getStaticWeeklyCompilerReadiness = productionRuntime.getReadiness;
export const shutdownStaticWeeklyCompiler = productionRuntime.shutdown;
export const terminateStaticWeeklyCompilerForTest = productionRuntime.terminateForTest;
