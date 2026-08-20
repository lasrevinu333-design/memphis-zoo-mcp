#!/usr/bin/env node

import assert from "node:assert/strict";
import { runCanonicalScanRpc } from "../src/scan-authority-cutover.js";

const canonical = {
  fn: "tool_commit_cleaning_workflow_authoritative",
  args: { p_client_session_id: "11111111-1111-4111-8111-111111111111" },
};

const successfulCalls = [];
const result = await runCanonicalScanRpc(async (fn, args) => {
  successfulCalls.push({ fn, args });
  return { ok: true, completion_id: "22222222-2222-4222-8222-222222222222" };
}, canonical);
assert.equal(result.ok, true);
assert.deepEqual(successfulCalls, [canonical], "the canonical command must execute exactly once");

for (const code of ["42883", "PGRST202"]) {
  const calls = [];
  await assert.rejects(
    () => runCanonicalScanRpc(async (fn, args) => {
      calls.push({ fn, args });
      throw Object.assign(new Error("canonical function unavailable"), { code });
    }, {
      ...canonical,
      fallback: { fn: "tool_commit_cleaning_workflow", args: { weaker: true } },
    }),
    (error) => error?.code === code,
    `missing canonical authority (${code}) must fail closed`,
  );
  assert.deepEqual(calls, [canonical], "an unavailable canonical writer must never invoke the supplied legacy fallback");
}

await assert.rejects(
  () => runCanonicalScanRpc(async () => ({ ok: true }), { fn: "", args: {} }),
  (error) => error?.code === "canonical_scan_command_incomplete",
);

console.log("CANONICAL_SCAN_AUTHORITY_CUTOVER_PASS");
