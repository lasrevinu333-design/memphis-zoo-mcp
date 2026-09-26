#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const start = source.indexOf("function canonicalizeScanArguments(fn, args, device) {");
const end = source.indexOf("\nfunction offlineAuthoritySecret() {", start);
assert.ok(start >= 0 && end > start, "the authenticated scan transport must own concrete GPS timestamp validation");
const transportStart = source.indexOf("async function executeScanRpcTransport(fn, args, device, credential, req) {");
const transportEnd = source.indexOf("\nasync function collectBackendAuthorityHealth() {", transportStart);
assert.ok(transportStart >= 0 && transportEnd > transportStart, "the authenticated transport must remain testable");
const forwarded = [];
const scope = vm.createContext({
  Date,
  SCAN_RPC_ALLOWLIST: new Set(["tool_evaluate_location_proximity_v2"]),
  isNativeCustodialScanRequest: () => false,
  bindOfflineActorProof: (fn, args) => ({ fn, args }),
  runRpc: () => { throw new Error("Unexpected direct RPC call"); },
  runCanonicalScanRpc: async (_runRpc, call) => {
    forwarded.push(call);
    return { ok: true, result: call.args.p_observed_at === null ? "gps_timestamp_unavailable" : "near", authoritative: call.args.p_observed_at !== null };
  },
  scanRpcHttpOutcome: (_fn, data) => data,
});
vm.runInContext(`${source.slice(start, end)}\n${source.slice(transportStart, transportEnd)}\nthis.prepareScanRpcCall = prepareScanRpcCall; this.executeScanRpcTransport = executeScanRpcTransport;`, scope);
const prepare = (observedAt) => scope.prepareScanRpcCall("tool_evaluate_location_proximity_v2", {
  p_location_code: "GPSAUTH",
  p_device_identifier: "GPS_AUTH_DEVICE",
  p_session_uuid: "gps-auth-near",
  p_observed_at: observedAt,
});

for (const valid of [
  "2026-09-25T12:34:56.123Z",
  "2026-09-25T07:34:56.123456-05:00",
  "2024-02-29T23:59:59+14:00",
]) {
  const call = prepare(valid);
  assert.equal(call.fn, "tool_evaluate_location_proximity_v2");
  assert.equal(call.args.p_observed_at, valid, `a concrete captured instant is preserved: ${valid}`);
}

const invalidValues = [
  null, undefined, "", "now", "today", "tomorrow", "yesterday", "epoch", "infinity",
  "2026-09-25 12:34:56Z", "2026-09-25T12:34:56", "2026-02-30T12:34:56Z",
  "2025-02-29T12:34:56Z", "2026-09-25T24:00:00Z", "2026-09-25T12:60:00Z",
  "2026-09-25T12:34:60Z", "2026-09-25T12:34:56+14:01", "2026-09-25T12:34:56+15:00",
  1790339696123, true, [], {},
];
for (const invalid of invalidValues) {
  const call = prepare(invalid);
  assert.equal(call.args.p_observed_at, null, `unproven capture time must settle as unavailable: ${String(invalid)}`);
  assert.equal(call.args.p_session_uuid, "gps-auth-near", "timestamp quarantine must not change the cleaning session identity");
  const outcome = await scope.executeScanRpcTransport("tool_evaluate_location_proximity_v2", {
    p_location_code: "GPSAUTH", p_device_identifier: "spoofed", p_session_uuid: "gps-auth-near", p_observed_at: invalid,
  }, { canonical_device_id: "GPS_AUTH_DEVICE" }, null, { headers: {} });
  assert.equal(outcome.ok, true, "invalid capture time must settle, not fail/retry forever");
  assert.equal(outcome.result, "gps_timestamp_unavailable");
  assert.equal(outcome.authoritative, false);
  assert.equal(forwarded.at(-1).args.p_observed_at, null, "the RPC must never receive a relative or malformed time");
  assert.equal(forwarded.at(-1).args.p_device_identifier, "GPS_AUTH_DEVICE", "canonical device identity is preserved");
}

for (const valid of ["2026-09-25T12:34:56.123Z", "2026-09-25T07:34:56.123456-05:00"]) {
  const outcome = await scope.executeScanRpcTransport("tool_evaluate_location_proximity_v2", {
    p_location_code: "GPSAUTH", p_device_identifier: "spoofed", p_session_uuid: "gps-auth-near", p_observed_at: valid,
  }, { canonical_device_id: "GPS_AUTH_DEVICE" }, null, { headers: {} });
  assert.equal(outcome.ok, true);
  assert.equal(forwarded.at(-1).args.p_observed_at, valid, "concrete capture time must reach the canonical RPC");
}

assert.match(source, /const canonicalArgs = canonicalizeScanArguments\(normalizedFn, args, device\);\s*const preparedBase = prepareScanRpcCall\(normalizedFn, canonicalArgs\);/);
assert.match(source, /const data = await runCanonicalScanRpc\(runRpc, prepared\);/);
console.log("GPS_CAPTURE_TIME_TRANSPORT_PASS", { concrete: 3, unavailable: invalidValues.length, canonical_route_bound: true });
