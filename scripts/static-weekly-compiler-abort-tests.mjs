import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createStaticWeeklyCompilerRuntime, STATIC_WEEKLY_COMPILER_RUNTIME_LIMITS } from "../src/static-weekly-schedule-compiler-runtime.js";

let checks = 0;
const fixture = new URL("./fixtures/static-weekly-compiler-runtime-test-worker.mjs", import.meta.url);
const resourceLimits = { maxOldGenerationSizeMb: 32, maxSemiSpaceSizeMb: 8, maxWasmMemoryMb: 32, stackSizeKb: 2 * 1024 };
assert.equal(STATIC_WEEKLY_COMPILER_RUNTIME_LIMITS.requestMilliseconds <= 60_000, true); checks++;
assert.throws(() => createStaticWeeklyCompilerRuntime({ requestMilliseconds: 60_001 }), /one-minute operation cap/); checks++;
const runtime = createStaticWeeklyCompilerRuntime({ workerUrl: fixture, initializationMilliseconds: 1_000,
  requestMilliseconds: 1_000, resourceLimits });
function alive(pid) {
  try { process.kill(pid, 0); return readFileSync(`/proc/${pid}/stat`, "utf8").split(" ")[2] !== "Z"; }
  catch { return false; }
}
async function reaped(pid) {
  const deadline = performance.now() + 2_000;
  while (alive(pid) && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(alive(pid), false, "aborted request reaps the exact compiler and nested solver group"); checks++;
}
try {
  await runtime.initialize();
  const pid = runtime.getReadiness().worker.nestedPid;
  const controller = new AbortController();
  const pending = runtime.compile({ behavior: "hang" }, { signal: controller.signal });
  await new Promise(resolve => setTimeout(resolve, 20));
  controller.abort(new Error("synthetic restore cancellation"));
  await assert.rejects(pending, error => error?.code === "static_weekly_compiler_request_aborted"
    && error?.cause?.message === "synthetic restore cancellation"); checks++;
  await reaped(pid);
  assert.deepEqual(await runtime.compile({ value: "after-abort" }), { ok: true, value: "after-abort" }); checks++;
  const first = runtime.compile({ value: "first", delay: 200 });
  const queued = runtime.compile({ value: "never-queued", delay: 0 }, { deadlineMilliseconds: 30 });
  await assert.rejects(queued, error => error?.code === "static_weekly_compiler_queue_timeout"); checks++;
  assert.deepEqual(await first, { ok: true, value: "first" }); checks++;
  const already = new AbortController(); already.abort();
  await assert.rejects(runtime.compile({ value: "never-start" }, { signal: already.signal }),
    error => error?.code === "static_weekly_compiler_request_aborted"); checks++;
  await assert.rejects(runtime.compile({ value: "bad-signal" }, { signal: {} }),
    error => error?.code === "static_weekly_compiler_abort_signal_invalid"); checks++;
} finally {
  await runtime.shutdown();
}
const initialization = createStaticWeeklyCompilerRuntime({ workerUrl: fixture, initializationMilliseconds: 1_000,
  requestMilliseconds: 1_000, resourceLimits });
try {
  await assert.rejects(initialization.compile({ value: "not-after-short-init" }, { deadlineMilliseconds: 1 }),
    error => error?.code === "static_weekly_compiler_queue_timeout"); checks++;
  assert.deepEqual(await initialization.compile({ value: "fresh-after-init-timeout" }),
    { ok: true, value: "fresh-after-init-timeout" }); checks++;
} finally {
  await initialization.shutdown();
}
console.log(JSON.stringify({ status: "PASS", checks, scope: "fixture compiler abort and exact child-group teardown; no production solver or SQL" }));
