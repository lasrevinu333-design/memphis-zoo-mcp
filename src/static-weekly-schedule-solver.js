/*
 * The optimizer owns a single, serial bounded child-process runtime.  HiGHS itself is
 * synchronous WebAssembly, so keeping a promise queue in this process is not
 * sufficient: the actual solve and LP expansion must be outside the backend
 * event loop.  The parent owns the deadline and replaces the worker after a
 * timeout or crash; no result from a replaced worker is ever accepted.
 */
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";

const HIGHS_PACKAGE = "highs@1.15.2";
const HIGHS_OPTIONS = Object.freeze({
  threads: 1,
  random_seed: 0,
  mip_rel_gap: 0,
  mip_abs_gap: 0,
  mip_feasibility_tolerance: 1e-9,
  presolve: "on",
  parallel: "off",
  output_flag: true,
});
export const STATIC_WEEKLY_WORKER_LIMITS = Object.freeze({
  // HiGHS requires the separately enforced 96 MiB WebAssembly ceiling for the
  // accepted production packet. Reduce only V8's old-generation allowance so
  // the three-process group retains empirical Render Starter headroom.
  maxOldGenerationSizeMb: 32,
  // V8 exposes this bound as a semi-space size, not a fictional aggregate
  // "young generation" switch.  The child verifies the exact flag at boot.
  maxSemiSpaceSizeMb: 4,
  maxWasmMemoryMb: 96,
  maxWallClockMilliseconds: 30_000,
});

let state = "uninitialized";
let initialization = null;
let identity = null;
let initializationError = null;
let worker = null;
let requestSequence = 0;
let tail = Promise.resolve();
let pending = null;
let testOverride = null;
let replacement = null;
let testChildInterceptor = null;

function error(code, message) {
  const value = new Error(message);
  value.code = code;
  return value;
}

function publicIdentity(value) {
  if (!value) return null;
  const { solver: _solver, ...result } = value;
  return result;
}

function workerUrl() {
  return new URL("./static-weekly-schedule-solver-worker.js", import.meta.url);
}
function refWorkerProcess(value) { value?.ref?.(); value?.channel?.ref?.(); }
function unrefWorkerProcess(value) { value?.channel?.unref?.(); value?.unref?.(); }
function releaseWorkerIfIdle(value) {
  // Promise consumers resume in microtasks before this callback. A solve can
  // therefore claim and ref the initialized child without a one-shot process
  // exiting in the handoff between readiness and its first request.
  setImmediate(() => {
    if (worker === value && pending?.worker !== value) unrefWorkerProcess(value);
  });
}
function solverError(code, message) { return error(code, message); }
function monotonicNowMilliseconds() {
  return typeof performance?.now === "function" ? performance.now() : Number(process.hrtime.bigint() / 1_000_000n);
}
function assertDeadline(deadline, signal) {
  if (signal?.aborted) throw solverError("solver_aborted", "The static weekly solver request was aborted.");
  const remaining = Math.floor(deadline - monotonicNowMilliseconds());
  if (!Number.isFinite(remaining) || remaining <= 0) throw solverError("solver_timeout", "The static weekly solver time budget expired before the tier began.");
  return remaining;
}

function workerExited(candidate) {
  return !candidate || candidate.exitCode != null || candidate.signalCode != null;
}

function terminateAndReapWorker(candidate) {
  if (!candidate) return Promise.resolve();
  if (workerExited(candidate)) { unrefWorkerProcess(candidate); return Promise.resolve(); }
  // Keep the owned child referenced until its exit callback has been observed.
  // Otherwise Node may exit with a top-level initialization await still pending
  // between SIGKILL and child-process reaping.
  refWorkerProcess(candidate);
  return new Promise((resolve) => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      candidate.removeListener("exit", finish);
      unrefWorkerProcess(candidate);
      resolve();
    };
    candidate.once("exit", finish);
    try { candidate.kill("SIGKILL"); } catch { finish(); }
  });
}

async function failInitialization(record, cause) {
  if (!record || record.settled) return;
  // Mark this record superseded before awaiting child exit.  Late IPC, error,
  // and exit callbacks then cannot revive or replace the stopped child.
  record.settled = true;
  if (record.timer) clearTimeout(record.timer);
  if (initialization === record) initialization = null;
  if (worker === record.candidate) worker = null;
  if (pending?.worker === record.candidate) pending.reject(cause);
  identity = null;
  initializationError = cause;
  state = "unavailable";
  await terminateAndReapWorker(record.candidate);
  record.reject(cause);
}

function completeInitialization(record, readyIdentity) {
  if (!record || record.settled || initialization !== record) return;
  record.settled = true;
  if (record.timer) clearTimeout(record.timer);
  worker = record.candidate;
  identity = Object.freeze({ ...readyIdentity, options: HIGHS_OPTIONS, runtime: "Node child process / local WebAssembly" });
  state = "ready";
  initialization = null;
  record.resolve(identity);
  // Idle readiness must never keep an initialize-only CLI alive. Defer the
  // release until awaiting solve callers have had a chance to claim the child.
  releaseWorkerIfIdle(record.candidate);
}

function startWorker() {
  if (worker) return Promise.resolve(identity);
  if (initialization) return initialization.promise;
  state = state === "recovering" ? "recovering" : "initializing";
  initializationError = null;
  identity = null;
  let resolveInitialization; let rejectInitialization;
  const record = {
    candidate: null,
    settled: false,
    timer: null,
    promise: new Promise((resolve, reject) => { resolveInitialization = resolve; rejectInitialization = reject; }),
    resolve: (value) => resolveInitialization(value),
    reject: (cause) => rejectInitialization(cause),
  };
  initialization = record;
  let candidate;
  try {
    candidate = fork(fileURLToPath(workerUrl()), [], {
      // This V8 flag applies a hard maximum to every WebAssembly linear-memory
      // grow in the worker.  It is a real allocation bound, unlike measuring
      // the heap after allocation; worker initialization fails closed if V8
      // rejects it or the pinned module needs more than this limit.
      execArgv: [
        `--max-old-space-size=${STATIC_WEEKLY_WORKER_LIMITS.maxOldGenerationSizeMb}`,
        `--max-semi-space-size=${STATIC_WEEKLY_WORKER_LIMITS.maxSemiSpaceSizeMb}`,
        `--wasm-max-mem-pages=${(STATIC_WEEKLY_WORKER_LIMITS.maxWasmMemoryMb * 1024 * 1024) / 65_536}`,
      ],
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    });
  } catch (cause) {
    void failInitialization(record, error("solver_unavailable", cause?.message || "Could not start static weekly solver worker."));
    return record.promise;
  }
  record.candidate = candidate;
  // Standalone initialization is bounded by the same worker wall-clock limit
  // as a solve request, so it cannot retain a stopped child forever.
  record.timer = setTimeout(() => {
    void failInitialization(record, solverError("solver_timeout", "Static weekly solver worker initialization exceeded the parent wall-clock deadline."));
  }, STATIC_WEEKLY_WORKER_LIMITS.maxWallClockMilliseconds);
  candidate.on("message", (message) => {
    if (!message || typeof message !== "object") return;
    if (message.type === "init_error") {
      if (!record.settled) void failInitialization(record, error(message.error?.code || "solver_unavailable", message.error?.message || "Static weekly solver worker failed to initialize."));
      return;
    }
    if (message.type === "ready") {
      completeInitialization(record, message.identity);
      return;
    }
    if (message.type !== "result" || !pending || pending.worker !== candidate || pending.id !== message.id) return;
    const active = pending;
    if (message.error) active.reject(error(message.error.code || "solver_unavailable", message.error.message || "Static weekly solver worker failed."));
    else {
      if (message.identity && typeof message.identity === "object") identity = Object.freeze({ ...message.identity, options: HIGHS_OPTIONS, runtime: "Node child process / local WebAssembly" });
      active.resolve({ result: message.result, evidence: message.evidence || null, modelAttestation: message.modelAttestation || null, identity: publicIdentity(identity), options: message.options || { ...HIGHS_OPTIONS } });
    }
  });
  candidate.on("error", (cause) => {
    if (!record.settled) { void failInitialization(record, cause); return; }
    if (worker !== candidate) return;
    if (pending?.worker === candidate) {
      const active = pending;
      active.reject(error("solver_unavailable", "Static weekly solver worker crashed."));
    }
    void replaceWorker(cause);
  });
  candidate.on("exit", (code) => {
    if (!record.settled) {
      void failInitialization(record, error("solver_unavailable", `Static weekly solver worker exited during initialization (${code}).`));
      return;
    }
    if (worker !== candidate) return;
    if (pending?.worker === candidate) {
      const active = pending;
      active.reject(error("solver_unavailable", `Static weekly solver worker exited (${code}).`));
    }
    void replaceWorker(error("solver_unavailable", `Static weekly solver worker exited (${code}).`));
  });
  try { testChildInterceptor?.(candidate); } catch (cause) { void failInitialization(record, error("solver_unavailable", cause?.message || "Static weekly solver test worker interception failed.")); }
  return record.promise;
}

async function replaceWorker(cause) {
  if (replacement) return replacement;
  const prior = worker;
  const priorInitialization = initialization;
  worker = null;
  identity = null;
  initializationError = cause;
  state = "recovering";
  replacement = (async () => {
    if (priorInitialization) await failInitialization(priorInitialization, cause);
    await terminateAndReapWorker(prior);
    // Recreate deterministically now, rather than leaving the next request to
    // reuse a possibly poisoned runtime.  Readiness tells the truth meanwhile.
    return startWorker().catch(() => null);
  })();
  try { return await replacement; } finally { replacement = null; }
}

export function getStaticWeeklySolverReadiness() {
  return {
    state,
    available: state === "ready" && Boolean(worker && identity),
    package: HIGHS_PACKAGE,
    identity: publicIdentity(identity),
    worker: {
      runtime: "node child process",
      serialized: true,
      resourceLimits: STATIC_WEEKLY_WORKER_LIMITS,
    },
    error: initializationError ? String(initializationError.message || initializationError) : null,
  };
}

function awaitInitialization(record, deadline, signal) {
  const remaining = assertDeadline(deadline, signal);
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      signal?.removeEventListener?.("abort", abort);
      fn(value);
    };
    const abandon = (cause) => {
      void failInitialization(record, cause).finally(() => finish(reject, cause));
    };
    const abort = () => abandon(solverError("solver_aborted", "The static weekly solver request was aborted."));
    timer = setTimeout(() => abandon(solverError("solver_timeout", "Static weekly solver worker initialization exceeded the request deadline.")), remaining);
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener?.("abort", abort, { once: true });
    record.promise.then((value) => {
      try { assertDeadline(deadline, signal); finish(resolve, value); } catch (cause) { abandon(cause); }
    }, (cause) => finish(reject, cause));
  });
}

export async function initializeStaticWeeklySolver({ deadline: suppliedDeadline = null, signal } = {}) {
  const deadline = Number.isFinite(suppliedDeadline) ? suppliedDeadline : monotonicNowMilliseconds() + STATIC_WEEKLY_WORKER_LIMITS.maxWallClockMilliseconds;
  assertDeadline(deadline, signal);
  if (state === "ready" && worker && identity) return identity;
  const started = startWorker();
  const record = initialization;
  // A synchronous fork/interceptor failure clears the shared record before
  // startWorker returns. Consume its promise so the rejection remains observed.
  if (!record) return started;
  return awaitInitialization(record, deadline, signal);
}

async function sendToWorker(lp, deadline, signal, modelAttestation) {
  // Validate before initialization and again before ref().  A queued or
  // pre-expired request must never retain an idle child process.
  assertDeadline(deadline, signal);
  const ready = await initializeStaticWeeklySolver({ deadline, signal });
  const remainingMilliseconds = assertDeadline(deadline, signal);
  const activeWorker = worker;
  if (!activeWorker || !ready) throw error("solver_unavailable", "Static weekly solver worker is not ready.");
  refWorkerProcess(activeWorker);
  const wallClockMilliseconds = Math.min(remainingMilliseconds, STATIC_WEEKLY_WORKER_LIMITS.maxWallClockMilliseconds);
  const id = ++requestSequence;
  return new Promise((resolve, reject) => {
    let settled = false; let timer = null;
    const release = () => unrefWorkerProcess(activeWorker);
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      if (pending?.id === id) pending = null;
      if (timer) clearTimeout(timer);
      signal?.removeEventListener?.("abort", abort);
      release();
      fn(value);
    };
    const abort = () => {
      const aborted = solverError("solver_aborted", "The static weekly solver request was aborted.");
      finish(reject, aborted);
      void replaceWorker(aborted);
    };
    timer = setTimeout(() => {
      const timeout = error("solver_timeout", "Static weekly solver exceeded the parent wall-clock deadline.");
      finish(reject, timeout);
      void replaceWorker(timeout);
    }, wallClockMilliseconds);
    pending = { id, worker: activeWorker, timer, resolve: (value) => finish(resolve, value), reject: (cause) => finish(reject, cause) };
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener?.("abort", abort, { once: true });
    try {
      activeWorker.send({
        type: "solve", id, lp, timeLimitSeconds: wallClockMilliseconds / 1000, modelAttestation,
        behavior: testOverride === "hang" || testOverride === "crash" || testOverride === "non_optimal" || testOverride === "malformed" || testOverride === "tolerance_edge" ? testOverride : null,
      });
    } catch (cause) {
      finish(reject, error("solver_unavailable", cause.message || "Could not send solve request to worker."));
      void replaceWorker(cause);
    }
  });
}

export async function solveStaticWeeklyMip(lp, { deadline: suppliedDeadline = null, timeLimitSeconds, signal, attestation = null } = {}) {
  const milliseconds = Math.floor(Number(timeLimitSeconds) * 1000);
  // A compiler-supplied absolute monotonic deadline owns queue wait and worker
  // initialization as well as the actual solve.  The relative value remains a
  // compatibility fallback for direct local lifecycle probes.
  const deadline = Number.isFinite(suppliedDeadline) ? suppliedDeadline : (Number.isFinite(milliseconds) ? monotonicNowMilliseconds() + milliseconds : Number.NaN);
  const run = async () => {
    assertDeadline(deadline, signal);
    if (testOverride === "unavailable") throw error("solver_unavailable", "Test-only simulated unavailable static weekly solver.");
    if (testOverride === "timeout") throw error("solver_timeout", "Test-only simulated static weekly solver timeout.");
    return sendToWorker(lp, deadline, signal, attestation);
  };
  const queued = tail.then(run, run);
  tail = queued.then(() => undefined, () => undefined);
  return queued;
}

// Not reachable from HTTP/API inputs.  It lets local tests prove fail-closed
// behavior for unavailable, non-returning, crashing, and malformed workers.
export function setStaticWeeklySolverTestOverride(value = null) {
  if (![null, "unavailable", "timeout", "hang", "crash", "non_optimal", "malformed", "tolerance_edge"].includes(value)) throw new Error("Unknown static weekly solver test override.");
  testOverride = value;
}

// Not reachable from HTTP/API inputs.  Lifecycle tests use this to suspend the
// exact child they own before its ready IPC can be delivered.
export function setStaticWeeklySolverTestChildInterceptor(value = null) {
  if (value != null && typeof value !== "function") throw new Error("Static weekly solver child interceptor must be a function or null.");
  testChildInterceptor = value;
}

export const STATIC_WEEKLY_HIGHS_OPTIONS = HIGHS_OPTIONS;
