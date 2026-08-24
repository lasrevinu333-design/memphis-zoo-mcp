import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createStaticWeeklyCompilerRuntime } from "../src/static-weekly-schedule-compiler-runtime.js";

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return readFileSync(`/proc/${pid}/stat`, "utf8").split(" ")[2] !== "Z";
  } catch {
    return false;
  }
}

async function assertReaped(pid, message) {
  const deadline = performance.now() + 2_000;
  while (processAlive(pid) && performance.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(processAlive(pid), false, message);
}

const fixture = new URL("./fixtures/static-weekly-compiler-runtime-test-worker.mjs", import.meta.url);
const resourceLimits = { maxOldGenerationSizeMb: 32, maxSemiSpaceSizeMb: 8, stackSizeKb: 2 * 1024 };
const runtime = createStaticWeeklyCompilerRuntime({ workerUrl: fixture, initializationMilliseconds: 1_000, requestMilliseconds: 1_000, resourceLimits });

await runtime.initialize();
assert.equal(runtime.getReadiness().available, true);
const firstNestedPid = runtime.getReadiness().worker.nestedPid;
assert.equal(processAlive(firstNestedPid), true, "the fixture proves its nested child exists before recovery");

let ticks = 0;
const timer = setInterval(() => { ticks += 1; }, 10);
const isolated = await runtime.compile({ value: "isolated", delay: 250 });
clearInterval(timer);
assert.deepEqual(isolated, { ok: true, value: "isolated" });
assert.equal(ticks >= 10, true, "the HTTP/main event loop remains responsive while the compiler worker is CPU-bound");

const order = [];
await Promise.all([
  runtime.compile({ value: "first", delay: 80 }).then((value) => order.push(value.value)),
  runtime.compile({ value: "second", delay: 0 }).then((value) => order.push(value.value)),
]);
assert.deepEqual(order, ["first", "second"], "overlapping compiler requests remain serialized");

const boundedRuntime = createStaticWeeklyCompilerRuntime({ workerUrl: fixture, initializationMilliseconds: 1_000, requestMilliseconds: 1_000, maxOutstandingRequests: 1, resourceLimits });
await boundedRuntime.initialize();
const boundedNestedPid = boundedRuntime.getReadiness().worker.nestedPid;
const boundedFirst = boundedRuntime.compile({ value: "bounded-first", delay: 80 });
await assert.rejects(boundedRuntime.compile({ value: "queue-overflow" }), (error) => error?.code === "static_weekly_compiler_busy");
assert.deepEqual(await boundedFirst, { ok: true, value: "bounded-first" }, "queue admission rejection does not disturb the admitted request");
await boundedRuntime.shutdown();
await assertReaped(boundedNestedPid, "bounded-admission runtime shutdown must reap its process group");

await assert.rejects(runtime.compile({ behavior: "crash" }), /test worker crash|compiler (?:worker|process) (?:crashed|exited)/i);
await assertReaped(firstNestedPid, "a crashed compiler process group must reap its nested solver child");
const recovered = await runtime.compile({ value: "recovered" });
assert.deepEqual(recovered, { ok: true, value: "recovered" }, "a crashed compiler lineage is replaced exactly once before the next request");
const recoveredNestedPid = runtime.getReadiness().worker.nestedPid;
assert.notEqual(recoveredNestedPid, firstNestedPid);

const timeoutRuntime = createStaticWeeklyCompilerRuntime({ workerUrl: fixture, initializationMilliseconds: 1_000, requestMilliseconds: 250, resourceLimits });
await timeoutRuntime.initialize();
const timeoutNestedPid = timeoutRuntime.getReadiness().worker.nestedPid;
await assert.rejects(timeoutRuntime.compile({ behavior: "hang" }), /complete request deadline/i);
await assertReaped(timeoutNestedPid, "a timed-out compiler process group must reap its nested solver child");
assert.deepEqual(await timeoutRuntime.compile({ value: "after-timeout" }), { ok: true, value: "after-timeout" }, "a timed-out worker is discarded before recovery");

const shutdownRuntime = createStaticWeeklyCompilerRuntime({ workerUrl: fixture, initializationMilliseconds: 1_000, requestMilliseconds: 5_000, resourceLimits });
await shutdownRuntime.initialize();
const shutdownNestedPid = shutdownRuntime.getReadiness().worker.nestedPid;
const interrupted = shutdownRuntime.compile({ behavior: "hang" });
const interruptedRejection = assert.rejects(interrupted, (error) => error?.code === "static_weekly_compiler_closed");
await new Promise((resolve) => setTimeout(resolve, 20));
const firstShutdown = shutdownRuntime.shutdown();
assert.equal(shutdownRuntime.shutdown(), firstShutdown, "concurrent shutdown callers share one complete process-group teardown");
await firstShutdown;
await interruptedRejection;
await assertReaped(shutdownNestedPid, "production shutdown interrupts active compiler work and reaps its process group");

await runtime.terminateForTest();
await assertReaped(recoveredNestedPid, "production shutdown must reap the active compiler process group");
const postTimeoutNestedPid = timeoutRuntime.getReadiness().worker.nestedPid;
await timeoutRuntime.terminateForTest();
await assertReaped(postTimeoutNestedPid, "shutdown after timeout recovery must reap the replacement process group");

const productionRuntime = createStaticWeeklyCompilerRuntime();
const productionInput = {
  serviceDate: "2026-08-10",
  timezone: "America/Chicago",
  exceptions: [],
  proximity: [{ from: "A", to: "B", minutes: 1, verified: true, bidirectional: true, provenance: "runtime-production-path" }],
  slots: ["a", "b"].map((id) => ({ id, label: `slot-${id}`, incumbencies: [{ personId: `person-${id}`, displayName: `Worker ${id}`, effectiveStart: "2020-01-01", effectiveEnd: null }] })),
  versions: [{
    id: "runtime-test-week",
    publicationId: "runtime-test-publication",
    status: "published",
    effectiveStart: "2026-08-03",
    effectiveEnd: null,
    objective: { requireVerifiedProximity: true },
    slotAvailability: ["a", "b"].map((slotId, index) => ({ slotId, dayOfWeek: 1, status: "working", shift: { start: "07:00", end: "16:00" }, productiveCapacityProvenance: "runtime-shift", maxServiceEffortMinutes: 300, maxServiceEffortProvenance: "runtime-capacity", qualifications: ["general"], qualificationProvenance: "runtime-qualification", restrictions: [], restrictionProvenance: "runtime-restriction", acceptedRouteAnchorLocationId: index ? "B" : "A", acceptedRouteProvenance: "runtime-route" })),
    assignments: [
      { workId: "runtime-one", dayOfWeek: 1, locationId: "A", window: { start: "08:00", end: "09:00" }, ownerSlotId: "a", serviceEffortMinutes: 20, serviceEffortProvenance: "runtime-effort", priority: 1, priorityProvenance: "runtime-priority", requiredQualifications: ["general"], qualificationProvenance: "runtime-work-qualification", restrictions: [], restrictionProvenance: "runtime-work-restriction" },
      { workId: "runtime-two", dayOfWeek: 1, locationId: "B", window: { start: "09:10", end: "10:00" }, ownerSlotId: "b", serviceEffortMinutes: 20, serviceEffortProvenance: "runtime-effort", priority: 1, priorityProvenance: "runtime-priority", requiredQualifications: ["general"], qualificationProvenance: "runtime-work-qualification", restrictions: [], restrictionProvenance: "runtime-work-restriction" },
    ],
  }],
};
let productionTicks = 0;
const productionPulse = setInterval(() => { productionTicks += 1; }, 10);
const productionResult = await productionRuntime.compileAndPrepare(productionInput, {
  kind: "draft",
  expectedRevision: 0,
  actor: {
    managerId: "10000000-0000-4000-8000-000000000001",
    managerName: "Runtime Test Manager",
    idempotencyKey: "runtime-prepared-draft",
  },
});
clearInterval(productionPulse);
assert.equal(productionResult.effectiveStart, "2026-08-10");
assert.equal(productionResult.expectedRevision, 0);
assert.equal(productionResult.actorManagerId, "10000000-0000-4000-8000-000000000001");
assert.equal(productionResult.idempotencyKey, "runtime-prepared-draft");
assert.equal(productionResult.document?.validation?.status, "FEASIBLE", "the real complete compiler, nested solver, database adapter, and advanced IPC result transport pass together");
assert.equal(productionTicks > 0, true, "the real production compiler and database-adapter process path leaves the HTTP event loop responsive");
await productionRuntime.shutdown();

console.log("static weekly complete-compiler worker isolation and recovery tests: PASS");
