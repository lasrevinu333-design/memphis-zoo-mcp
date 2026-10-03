import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  inspectRecurringOperationGroup,
  reapRecurringOperationGroup,
  runOwnedRecurringOperation,
} from "../src/static-weekly-recurring-operation-owner.js";

const fixture = new URL("./fixtures/static-weekly-recurring-operation-owner-child.mjs", import.meta.url);
const digest = (url) => createHash("sha256").update(readFileSync(fileURLToPath(url))).digest("hex");
const sourceDigest = "a".repeat(64);
const schemas = {
  onLaunch: () => {},
  validateInput: (input) => {
    assert.equal(new Set(["synthetic", "synthetic-compiler"]).has(input?.kind), true);
    assert.deepEqual(Object.keys(input), ["kind"]);
    return { kind: input.kind };
  },
  validateReceipt: (receipt) => {
    assert.equal(typeof receipt?.operationId, "string");
    return receipt;
  },
};
const launches = [];
const launchMode = (mode) => (file) => {
  const child = fork(file, [], {
    detached: true, serialization: "advanced", stdio: ["ignore", "ignore", "ignore", "ipc"],
    env: { ...process.env, STATIC_WEEKLY_OWNER_TEST_MODE: mode },
  });
  launches.push(child.pid);
  return child;
};
const call = (mode, overrides = {}) => runOwnedRecurringOperation({
  childFile: fixture,
  childDigest: digest(fixture),
  sourceDigest,
  input: { kind: "synthetic" },
  ...schemas,
  deadlineAt: performance.now() + 3_500,
  launch: launchMode(mode),
  ...overrides,
});
await assert.rejects(call("normal", { childDigest: "0".repeat(64) }), (error) =>
  error?.code === "static_weekly_operation_child_source_changed", "changed child bytes are refused before launch");
assert.equal(launches.length, 0);
let provisional;
await assert.rejects(call("crash-before-fork", {
  observeIdentity: () => null,
  onLaunch: (identity) => { provisional = identity; },
}), (error) => {
  assert.equal(error?.code, "static_weekly_operation_identity_unproven");
  assert.equal(error.provisional, provisional);
  assert.equal(error.childClosed, true, "early exited child has an observed close before refusal");
  return true;
});
assert.equal(provisional.state, "provisional", "the launch PID is retained before any group authority exists");
let unobservedGroupSignaled = false;
await assert.rejects(call("hang", {
  observeIdentity: () => null,
  reap: async () => { unobservedGroupSignaled = true; },
}), (error) => {
  assert.equal(error?.code, "static_weekly_operation_identity_unproven");
  assert.equal(error.childClosed, true, "a child without observed PGID honors private pre-work cancellation and closes");
  return true;
});
assert.equal(unobservedGroupSignaled, false, "provisional PID never authorizes process-group signaling");
function live(pid) {
  try {
    const raw = readFileSync(`/proc/${pid}/stat`, "utf8");
    return !new Set(["Z", "X"]).has(raw.slice(raw.lastIndexOf(")") + 2).split(" ")[0]);
  } catch (error) { if (error?.code === "ENOENT") return false; throw error; }
}

let custody;
const success = await call("normal", { onCustody: (identity) => { custody = identity; } });
assert.equal(success.groupAbsent, true);
assert.equal(success.receipt.operationId, "synthetic-owned");
assert.equal(custody.pid, success.identity.pid);
assert.equal(inspectRecurringOperationGroup(custody).length, 0, "success waits for the exact leader and inherited descendant to disappear");
assert.equal(live(success.receipt.descendantPid), false);

const inheritedFixture = new URL("./fixtures/static-weekly-recurring-inherited-compiler-child.mjs", import.meta.url);
const inherited = await runOwnedRecurringOperation({
  childFile: inheritedFixture, childDigest: digest(inheritedFixture), sourceDigest, input: { kind: "synthetic-compiler" },
  ...schemas,
  deadlineAt: performance.now() + 4_000,
});
assert.equal(inherited.receipt.result, "synthetic-inherited");
assert.equal(inherited.receipt.compilerGroupId, inherited.identity.pid, "opt-in compiler inherits the operation PGID");
assert.equal(inherited.receipt.descendantGroupId, inherited.identity.pid, "the compiler's synthetic nested fork inherits the same group");
assert.equal(live(inherited.receipt.compilerPid), false);
assert.equal(live(inherited.receipt.descendantPid), false);
assert.equal(inspectRecurringOperationGroup(inherited.identity).length, 0);

const inheritedShutdown = await runOwnedRecurringOperation({
  childFile: inheritedFixture, childDigest: digest(inheritedFixture), sourceDigest, input: { kind: "synthetic-compiler" }, ...schemas,
  deadlineAt: performance.now() + 4_000,
  launch: launchMode("shutdown-before-result"),
});
assert.equal(inheritedShutdown.receipt.compilerGroupId, inheritedShutdown.identity.pid);
assert.equal(inheritedShutdown.receipt.descendantGroupId, inheritedShutdown.identity.pid);
assert.equal(inspectRecurringOperationGroup(inheritedShutdown.identity).length, 0, "inherited-worker shutdown and parent group reap together remove nested descendants");

let beforeReportIdentity;
await assert.rejects(runOwnedRecurringOperation({
  childFile: inheritedFixture, childDigest: digest(inheritedFixture), sourceDigest, input: { kind: "synthetic-compiler" },
  ...schemas,
  deadlineAt: performance.now() + 4_000,
  launch: launchMode("crash-after-compiler-fork-before-report"),
  onCustody: (identity) => { beforeReportIdentity = identity; },
}), (error) => ["static_weekly_operation_child_exited", "static_weekly_operation_reap_unproven"].includes(error?.code));
assert.equal(inspectRecurringOperationGroup(beforeReportIdentity).length, 0, "an unreported compiler lineage has no live work; a lingering zombie PGID remains unproven");

let rejectedCustody;
await assert.rejects(call("normal", { onCustody: (identity) => {
  rejectedCustody = identity;
  throw new Error("synthetic custody recorder failure");
} }), (error) => error?.code === "static_weekly_operation_custody_unrecorded");
assert.equal(inspectRecurringOperationGroup(rejectedCustody).length, 0, "a failed custody record never begins child work and reaps the group");
assert.equal(live(custody.pid), false);

for (const mode of ["crash-before-fork", "crash-after-report", "wrong-source", "duplicate-ready", "duplicate-result"]) {
  let identity;
  await assert.rejects(call(mode, { onCustody: (value) => { identity = value; } }), (error) =>
    ["static_weekly_operation_child_exited", "static_weekly_operation_protocol_invalid", "static_weekly_operation_reap_unproven"].includes(error?.code), `${mode} fails without an accepted result`);
  assert.equal(inspectRecurringOperationGroup(identity).length, 0, `${mode} leaves no live inherited work`);
}

const controller = new AbortController();
let hangingIdentity;
const hanging = call("hang", { signal: controller.signal, onCustody: (identity) => { hangingIdentity = identity; } });
await new Promise((resolve) => setTimeout(resolve, 60));
controller.abort();
await assert.rejects(hanging, (error) => error?.code === "static_weekly_operation_aborted");
assert.equal(inspectRecurringOperationGroup(hangingIdentity).length, 0, "abort reaps the owned group before settlement");

let deadlineIdentity;
await assert.rejects(call("hang", { deadlineAt: performance.now() + 100, onCustody: (identity) => { deadlineIdentity = identity; } }), (error) =>
  error?.code === "static_weekly_operation_deadline_invalid");
assert.equal(deadlineIdentity, undefined, "an attempt without its cleanup reserve is refused before launch");
let boundedIdentity;
const boundedStart = performance.now();
await assert.rejects(call("hang", {
  deadlineAt: boundedStart + 2_300,
  onCustody: (identity) => { boundedIdentity = identity; },
}), (error) => error?.code === "static_weekly_operation_deadline");
assert.equal(inspectRecurringOperationGroup(boundedIdentity).length, 0);
assert.equal(performance.now() < boundedStart + 2_300, true, "work expiry and group cleanup consume the same original deadline");

const unrelated = fork(new URL("./fixtures/static-weekly-recurring-operation-owner-child.mjs", import.meta.url), [], {
  detached: true, serialization: "advanced", stdio: ["ignore", "ignore", "ignore", "ipc"],
  env: { ...process.env, STATIC_WEEKLY_OWNER_TEST_MODE: "hang" },
});
try {
  await assert.rejects(call("crash-before-fork"), (error) => error?.code === "static_weekly_operation_child_exited");
  assert.equal(live(unrelated.pid), true, "another detached group remains untouched");
} finally {
  process.kill(-unrelated.pid, "SIGKILL");
  unrelated.disconnect();
}

assert.throws(() => inspectRecurringOperationGroup({ pid: process.pid, startTicks: "1" }), (error) =>
  error?.code === "static_weekly_operation_pid_reused", "PID start-identity mismatch refuses ownership");
let signaled = false;
await assert.rejects(reapRecurringOperationGroup({ pid: process.pid, startTicks: "1" }, {
  deadlineAt: performance.now() + 10,
  signalGroup: () => { signaled = true; },
}), (error) => error?.code === "static_weekly_operation_pid_reused");
assert.equal(signaled, false, "a reused or foreign PID is never signaled");
const cleanupDeadline = performance.now() + 3_500;
await assert.rejects(call("normal", {
  deadlineAt: cleanupDeadline,
  reap: async (identity, options) => {
    assert.equal(options.deadlineAt, cleanupDeadline, "cleanup receives the original absolute deadline, not a renewed interval");
    await reapRecurringOperationGroup(identity, options);
    throw Object.assign(new Error("synthetic unproven cleanup receipt"), { code: "static_weekly_operation_reap_unproven" });
  },
}), (error) => error?.code === "static_weekly_operation_reap_unproven", "a typed success cannot override unproven group cleanup");
assert.equal(launches.every((pid) => !live(pid)), true, "no owned operation leader remains");

console.log("static weekly recurring operation-owned custody tests: PASS");
