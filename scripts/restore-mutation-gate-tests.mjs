#!/usr/bin/env node

import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import http from "node:http";
import { makeRestoreMutationGate, withApplicationMutationLease } from "../src/restore-mutation-gate.js";

function response() {
  return Object.assign(new EventEmitter(), {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    end() { this.writableFinished = true; this.emit("finish"); },
  });
}

async function invoke(gate, method = "POST") {
  const res = response();
  let passed = false;
  await gate({ method }, res, () => { passed = true; });
  return { res, passed };
}

const rpcCalls = [];
let requestCounter = 0;
const openGate = makeRestoreMutationGate({
  supabase: { async rpc(name, args) {
    rpcCalls.push({ name, args });
    if (name === "custodial_release_application_mutation_lease") return { data: true, error: null };
    if (name === "custodial_heartbeat_application_mutation_lease") return { data: true, error: null };
    assert.equal(name, "custodial_begin_application_mutation_lease");
    return { data: { mutations_paused: false, authority_generation: 4, request_id: args.p_request_id }, error: null };
  } },
  serviceName: "fixture-service",
  requestId: () => `00000000-0000-4000-8000-${String(++requestCounter).padStart(12, "0")}`,
});
assert.equal((await invoke(openGate, "GET")).passed, true);
assert.equal(rpcCalls.length, 0, "read requests do not need the mutation gate");
const first = await invoke(openGate);
assert.equal(first.passed, true);
first.res.emit("finish");
await new Promise((resolve) => setImmediate(resolve));
const second = await invoke(openGate);
assert.equal(second.passed, true);
second.res.emit("finish");
await new Promise((resolve) => setImmediate(resolve));
const aborted = await invoke(openGate);
assert.equal(aborted.passed, true);
aborted.res.emit("close");
await new Promise((resolve) => setImmediate(resolve));
assert.equal(rpcCalls.at(-1).name, "custodial_begin_application_mutation_lease", "disconnect aborts work but cannot release a lease before the handler finishes");
assert.equal(aborted.res.writableFinished, undefined);
aborted.res.end();
await new Promise((resolve) => setImmediate(resolve));
assert.deepEqual(rpcCalls.map((call) => call.name), [
  "custodial_begin_application_mutation_lease",
  "custodial_release_application_mutation_lease",
  "custodial_begin_application_mutation_lease",
  "custodial_release_application_mutation_lease",
  "custodial_begin_application_mutation_lease",
  "custodial_release_application_mutation_lease",
]);
assert.equal(rpcCalls[0].args.p_service_name, "fixture-service");

const disconnectCalls = [];
const disconnectGate = makeRestoreMutationGate({
  supabase: { async rpc(name) {
    disconnectCalls.push(name);
    if (name === "custodial_begin_application_mutation_lease") return { data: { mutations_paused: false, authority_generation: 6 }, error: null };
    if (name === "custodial_heartbeat_application_mutation_lease") return { data: true, error: null };
    if (name === "custodial_release_application_mutation_lease") return { data: true, error: null };
    throw new Error(`Unexpected RPC ${name}`);
  } },
  serviceName: "fixture-disconnect-server",
  requestId: () => "00000000-0000-4000-8000-000000000101",
  heartbeatMilliseconds: 5,
});
const server = http.createServer(async (req, res) => {
  await disconnectGate(req, res, () => {
    setTimeout(() => res.end("settled after disconnect"), 30);
  });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
try {
  await new Promise((resolve, reject) => {
    const clientRequest = http.request({ host: "127.0.0.1", port: server.address().port, path: "/", method: "POST" });
    clientRequest.on("error", (error) => error.code === "ECONNRESET" ? resolve() : reject(error));
    clientRequest.on("socket", () => setTimeout(() => { clientRequest.destroy(); resolve(); }, 5));
    clientRequest.end("work");
  });
  await new Promise((resolve) => setTimeout(resolve, 55));
  assert.equal(disconnectCalls.filter((name) => name === "custodial_release_application_mutation_lease").length, 1,
    "a real Node response releases exactly once when its handler settles after the client disconnects");
  const heartbeatsAtSettlement = disconnectCalls.filter((name) => name === "custodial_heartbeat_application_mutation_lease").length;
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(disconnectCalls.filter((name) => name === "custodial_heartbeat_application_mutation_lease").length, heartbeatsAtSettlement,
    "heartbeats stop after disconnected handler settlement");
} finally {
  await new Promise((resolve) => server.close(resolve));
}

const backgroundCalls = [];
const backgroundResult = await withApplicationMutationLease({
  supabase: { async rpc(name, args) {
    backgroundCalls.push({ name, args });
    if (name === "custodial_begin_application_mutation_lease") return { data: { mutations_paused: false, authority_generation: 4 }, error: null };
    if (name === "custodial_heartbeat_application_mutation_lease") return { data: true, error: null };
    if (name === "custodial_release_application_mutation_lease") return { data: true, error: null };
    throw new Error(`Unexpected RPC ${name}`);
  } },
  serviceName: "fixture-background-worker",
  requestId: () => "00000000-0000-4000-8000-000000000099",
  heartbeatMilliseconds: 5,
  operation: async () => {
    await new Promise((resolve) => setTimeout(resolve, 12));
    return "saved";
  },
});
assert.equal(backgroundResult, "saved");
assert.equal(backgroundCalls[0].name, "custodial_begin_application_mutation_lease");
assert.ok(backgroundCalls.some((call) => call.name === "custodial_heartbeat_application_mutation_lease"));
assert.equal(backgroundCalls.at(-1).name, "custodial_release_application_mutation_lease");

const lossCalls = [];
let lateStorageMutation = false;
await assert.rejects(withApplicationMutationLease({
  supabase: { async rpc(name, args) {
    lossCalls.push({ name, args });
    if (name === "custodial_begin_application_mutation_lease") return { data: { mutations_paused: false, authority_generation: 5 }, error: null };
    if (name === "custodial_heartbeat_application_mutation_lease") return { data: false, error: null };
    if (name === "custodial_release_application_mutation_lease") return { data: false, error: null };
    throw new Error(`Unexpected RPC ${name}`);
  } },
  serviceName: "fixture-storage-worker",
  requestId: () => "00000000-0000-4000-8000-000000000100",
  heartbeatMilliseconds: 5,
  operation: async ({ assertActive }) => {
    await new Promise((resolve) => setTimeout(resolve, 15));
    assertActive();
    lateStorageMutation = true;
  },
}), (error) => error?.code === "mutation_lease_lost");
assert.equal(lateStorageMutation, false, "lease loss aborts cooperative external work before its delayed side effect");
assert.ok(lossCalls.some((call) => call.name === "custodial_heartbeat_application_mutation_lease"));

const paused = await invoke(makeRestoreMutationGate({
  supabase: { async rpc() { return { data: null, error: new Error("disaster recovery is in progress; application mutations are paused") }; } },
}));
assert.equal(paused.passed, false);
assert.equal(paused.res.statusCode, 503);
assert.equal(paused.res.body.code, "disaster_restore_in_progress");
assert.equal(paused.res.body.work_saved, true);

const failed = await invoke(makeRestoreMutationGate({ supabase: { async rpc() { return { data: null, error: new Error("unavailable") }; } } }));
assert.equal(failed.passed, false);
assert.equal(failed.res.statusCode, 503);
assert.equal(failed.res.body.code, "restore_gate_unavailable");

const missing = await invoke(makeRestoreMutationGate({ supabase: null }));
assert.equal(missing.passed, false);
assert.equal(missing.res.body.code, "restore_gate_unavailable");

assert.equal((await invoke(makeRestoreMutationGate({ supabase: null, required: false }))).passed, true);

console.log("RESTORE_MUTATION_GATE_TESTS_PASS");
