#!/usr/bin/env node

import assert from "node:assert/strict";
import { makeRestoreMutationGate } from "../src/restore-mutation-gate.js";

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

async function invoke(gate, method = "POST") {
  const res = response();
  let passed = false;
  await gate({ method }, res, () => { passed = true; });
  return { res, passed };
}

let rpcCalls = 0;
const openGate = makeRestoreMutationGate({
  supabase: { async rpc(name) { rpcCalls += 1; assert.equal(name, "custodial_restore_runtime_state"); return { data: { mutations_paused: false, state: "READY", authority_generation: 4, restore_id: null }, error: null }; } },
  now: () => 1000,
});
assert.equal((await invoke(openGate, "GET")).passed, true);
assert.equal(rpcCalls, 0, "read requests do not need the mutation gate");
assert.equal((await invoke(openGate)).passed, true);
assert.equal((await invoke(openGate)).passed, true);
assert.equal(rpcCalls, 2, "an open gate is rechecked for every mutation so restore pause has no stale-open race");

const paused = await invoke(makeRestoreMutationGate({
  supabase: { async rpc() { return { data: { mutations_paused: true, state: "STORAGE_RESTORING", authority_generation: 5, restore_id: "fixture" }, error: null }; } },
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
