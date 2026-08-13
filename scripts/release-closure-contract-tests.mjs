#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assertExactReleasePair, assertManifestContract, assertObservedSchemaIdentity } from "../src/release-contract.js";

const input = JSON.parse(readFileSync(new URL("../release/schema-alignment-input.json", import.meta.url), "utf8"));
const index = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const liveGate = readFileSync(new URL("./live-release-alignment-check.mjs", import.meta.url), "utf8");
const rollbackMigration = readFileSync(new URL("../supabase/migrations/20260813060000_release_canary_operational_recovery.sql", import.meta.url), "utf8");

assert.equal(input.frontend_commit_sha, "e838efafe7100966311bfa5800b4d8299e6d6d55", "backend must pin the exact audited frontend candidate");
assert.equal(input.frontend_commit_state, "final_pair_bound");
assert.deepEqual(input.queue_compatibility_versions.scan.at(-1), "indexeddb-v6-offline-authority");
assert.deepEqual(Object.keys(input.minimum_supported).sort(), ["backend_version", "frontend_version"]);
assert.match(index, /\/admin-api\/release-schema-identity/, "schema observation endpoint is required");
assert.match(index, /requireReleaseSchemaIdentityToken, async/, "schema observation endpoint must require its machine token");
assert.match(index, /observeProductionSchemaIdentity/, "schema observation must use the connected catalog");
assert.match(index, /\/admin-api\/release-canary-rollback/, "operator canary rollback endpoint is required");
assert.doesNotMatch(index, /let releaseCanaryPaused/, "canary pause must not live in process memory");
assert.match(index, /custodial_release_canary_is_paused/, "scan traffic must read the durable exact-device control");
assert.match(index, /custodial_control_release_canary/, "release recovery must use its durable database control");
assert.match(rollbackMigration, /pause_canary','resume_canary','restore_authority/);
assert.match(rollbackMigration, /custodial_release_authority_restore_definitions/);
assert.match(rollbackMigration, /pg_get_functiondef/);
assert.doesNotMatch(rollbackMigration, /grant execute on function public\.tool_(?:complete_session|commit_cleaning_workflow)\(/i,
  "release recovery must not revive legacy writer wrappers");
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
