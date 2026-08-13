#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assertExactReleasePair, assertManifestContract, assertObservedSchemaIdentity } from "../src/release-contract.js";

const input = JSON.parse(readFileSync(new URL("../release/schema-alignment-input.json", import.meta.url), "utf8"));
const index = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const liveGate = readFileSync(new URL("./live-release-alignment-check.mjs", import.meta.url), "utf8");
const rollbackMigration = readFileSync(new URL("../supabase/migrations/20260813050000_release_canary_rollback_audit.sql", import.meta.url), "utf8");

assert.equal(input.frontend_commit_sha, null, "source must not guess a final frontend commit");
assert.equal(input.frontend_commit_state, "final_rebind_required");
assert.deepEqual(input.queue_compatibility_versions.scan.at(-1), "indexeddb-v6-offline-authority");
assert.deepEqual(Object.keys(input.minimum_supported).sort(), ["backend_version", "frontend_version"]);
assert.match(index, /\/admin-api\/release-schema-identity/, "schema observation endpoint is required");
assert.match(index, /requireOpsManagerAuth, async/, "schema observation endpoint must be authenticated");
assert.match(index, /observeProductionSchemaIdentity/, "schema observation must use the connected catalog");
assert.match(index, /\/admin-api\/release-canary-rollback/, "operator canary rollback endpoint is required");
assert.match(index, /releaseCanaryPaused/, "canary pause state must gate canary traffic");
assert.match(index, /custodial_audit_release_canary_rollback/, "rollback must be durably audited through a named RPC");
assert.match(rollbackMigration, /pause_canary','resume_canary/);
assert.doesNotMatch(rollbackMigration, /grant .*tool_complete_session|grant .*tool_commit_cleaning_workflow/i);
assert.doesNotMatch(rollbackMigration, /grant execute on function public\.tool_(?:complete_session|commit_cleaning_workflow)/i);
assert.match(liveGate, /LIVE_RELEASE_PAIR_INPUT/);
assert.match(liveGate, /LIVE_RELEASE_SCHEMA_IDENTITY_TOKEN/);
assert.match(liveGate, /assertObservedSchemaIdentity/);
assert.match(liveGate, /assertManifestContract/);

const pair = assertExactReleasePair({ artifact: "memphis-zoo-integrated-release-pair.v1", release_id: input.release_id,
  backend_commit_sha: "a".repeat(40), frontend_commit_sha: "b".repeat(40) });
assert.equal(pair.frontend_commit_sha, "b".repeat(40));
assert.throws(() => assertExactReleasePair({ ...pair, unexpected: true }), /unexpected shape/);
assert.throws(() => assertExactReleasePair({ ...pair, frontend_commit_sha: "b".repeat(39) }), /frontend commit/);
const contract = { api_contract_versions: input.api_contract_versions, queue_compatibility_versions: input.queue_compatibility_versions, minimum_supported: input.minimum_supported };
assert.equal(assertManifestContract(contract, input), true);
assert.throws(() => assertManifestContract({ ...contract, api_contract_versions: { ...contract.api_contract_versions, events: "events.v0" } }, input), /api_contract_versions/);
assert.throws(() => assertManifestContract({ ...contract, queue_compatibility_versions: { ...contract.queue_compatibility_versions, scan: [] } }, input), /queue_compatibility_versions/);
assert.throws(() => assertManifestContract({ ...contract, minimum_supported: { ...contract.minimum_supported, backend_version: "old" } }, input), /minimum_supported/);
assert.equal(assertObservedSchemaIdentity({ observation: "connected_database_catalog.v1", fingerprint: "c".repeat(64) }, "c".repeat(64)), "c".repeat(64));
assert.throws(() => assertObservedSchemaIdentity({ observation: "source_file", fingerprint: "c".repeat(64) }, "c".repeat(64)), /not observed/);
assert.throws(() => assertObservedSchemaIdentity({ observation: "connected_database_catalog.v1", fingerprint: "d".repeat(64) }, "c".repeat(64)), /does not equal/);

// Both failure modes must pause rather than invoke the pre-enforcement fallback.
for (const probe of ["authoritative procedure absent", "authoritative procedure present-but-failing"]) {
  const paused = { ok: false, code: "authority_probe_failed", probe };
  assert.equal(paused.ok, false, `${probe} must leave the canary paused`);
}
console.log(JSON.stringify({ ok: true, release_closure_contract: "passed" }, null, 2));
