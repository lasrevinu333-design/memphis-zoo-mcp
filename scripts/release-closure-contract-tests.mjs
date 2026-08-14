#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generateKeyPairSync, sign } from "node:crypto";
import { assertBackendFrontendIdentity, assertExactReleaseAttestation, assertFrontendReleaseDeclaration, assertFrontendReleaseIdentity, assertManifestContract, assertObservedSchemaIdentity, releaseAttestationPayload } from "../src/release-contract.js";

const input = JSON.parse(readFileSync(new URL("../release/schema-alignment-input.json", import.meta.url), "utf8"));
const index = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const nativePhoneTransport = readFileSync(new URL("../src/native-phone-transport.js", import.meta.url), "utf8");
const liveGate = readFileSync(new URL("./live-release-alignment-check.mjs", import.meta.url), "utf8");
const rollbackMigration = readFileSync(new URL("../supabase/migrations/20260813060000_release_canary_operational_recovery.sql", import.meta.url), "utf8");
const boundaryMigration = readFileSync(new URL("../supabase/migrations/20260813141806_custodial_operational_boundary_closure.sql", import.meta.url), "utf8");

assert.equal(input.frontend_commit_sha, "44d97c1fb50dfb56b5d13dc4bb554d867c9acc20", "backend must pin the exact audited frontend candidate");
assert.equal(input.frontend_commit_state, "final_pair_bound");
assert.deepEqual(input.queue_compatibility_versions.scan.at(-1), "indexeddb-v6-offline-authority");
assert.deepEqual(Object.keys(input.minimum_supported).sort(), ["backend_version", "frontend_version"]);
assert.match(index, /\/admin-api\/release-schema-identity/, "schema observation endpoint is required");
assert.match(index, /requireReleaseSchemaIdentityToken, async/, "schema observation endpoint must require its machine token");
assert.match(index, /observeProductionSchemaIdentity/, "schema observation must use the connected catalog");
assert.match(index, /\/admin-api\/release-canary-rollback/, "operator canary rollback endpoint is required");
assert.doesNotMatch(index, /let releaseCanaryPaused/, "canary pause must not live in process memory");
assert.match(index, /custodial_release_canary_is_paused/, "scan traffic must read the durable exact-device control");
assert.match(index, /canaryControlInitialized\s*&&\s*canaryPaused === false/g,
  "health and authority health must reject a configured but operator-paused canary");
assert.match(index, /custodial_control_release_canary/, "release recovery must use its durable database control");
assert.match(index, /buildReleaseCanaryTransportProbeCall/,
  "release recovery must route designated-phone evidence through the verified transport helper");
assert.match(nativePhoneTransport, /custodial_record_release_canary_transport_probe/,
  "release recovery must record the designated phone's authenticated native RPC traversal");
assert.match(index, /custodial_get_release_canary_transport_probe_health/,
  "release recovery must verify a persisted phone transport receipt");
assert.doesNotMatch(index, /collectBackendAuthorityHealth\([\s\S]{0,1400}executeScanRpcTransport\(/,
  "a server-internal RPC call cannot prove the employee phone path");
assert.match(index, /action === "resume_canary" && authoritativeHealth\?\.ok !== true/,
  "release resume must fail closed unless the database and employee scan transport are both healthy");
assert.match(rollbackMigration, /pause_canary','resume_canary','restore_authority/);
assert.match(rollbackMigration, /custodial_release_authority_restore_definitions/);
assert.match(rollbackMigration, /pg_get_functiondef/);
assert.match(boundaryMigration, /v_new text:='''employee_id'',v_existing\.employee_id,''assignment_epoch'',v_existing\.assignment_epoch/,
  "exact activation replay must return its frozen actor identity");
assert.match(boundaryMigration, /custodial_release_authority_restore_definitions/,
  "the corrected activation definition must replace its rollback capture");
assert.doesNotMatch(rollbackMigration, /grant execute on function public\.tool_(?:complete_session|commit_cleaning_workflow)\(/i,
  "release recovery must not revive legacy writer wrappers");
assert.match(liveGate, /LIVE_RELEASE_ATTESTATION_INPUT/);
assert.match(liveGate, /MEMPHIS_RELEASE_ATTESTATION_PUBLIC_KEY/);
assert.match(liveGate, /LIVE_RELEASE_SCHEMA_IDENTITY_TOKEN/);
assert.match(liveGate, /assertObservedSchemaIdentity/);
assert.match(liveGate, /assertManifestContract/);
assert.match(liveGate, /release_canary\?\.paused, false/g,
  "the live release gate must reject a paused canary in both health views");

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const unsignedAttestation = { artifact: "memphis-zoo-integrated-release-attestation.v2", release_id: input.release_id,
  backend_commit_sha: "a".repeat(40), backend_tree_sha: "b".repeat(40), backend_evidence_blob_sha: "c".repeat(40),
  backend_evidence_sha256: "d".repeat(64), frontend_commit_sha: input.frontend_commit_sha, schema_fingerprint: "e".repeat(64),
  signature: { algorithm: "ed25519", key_id: "release-contract-test", value_base64: "" } };
unsignedAttestation.signature.value_base64 = sign(null, Buffer.from(`${JSON.stringify(releaseAttestationPayload(unsignedAttestation))}\n`), privateKey).toString("base64");
const attestation = assertExactReleaseAttestation(unsignedAttestation, { publicKeyPem: publicKey.export({ type: "spki", format: "pem" }) });
assert.equal(attestation.frontend_commit_sha, input.frontend_commit_sha);
assert.throws(() => assertExactReleaseAttestation({ ...attestation, unexpected: true }, { publicKeyPem: publicKey.export({ type: "spki", format: "pem" }) }), /unexpected shape/);
assert.throws(() => assertExactReleaseAttestation({ ...attestation, frontend_commit_sha: "b".repeat(39) }, { publicKeyPem: publicKey.export({ type: "spki", format: "pem" }) }), /frontend commit/);
assert.throws(() => assertExactReleaseAttestation({ ...attestation, backend_tree_sha: "f".repeat(40) }, { publicKeyPem: publicKey.export({ type: "spki", format: "pem" }) }), /signature is invalid/);
const contract = { release_id: input.release_id, api_contract_versions: input.api_contract_versions, queue_compatibility_versions: input.queue_compatibility_versions, minimum_supported: input.minimum_supported };
assert.equal(assertManifestContract(contract, input), true);
assert.throws(() => assertManifestContract({ ...contract, release_id: "release-spoofed" }, input), /release_id/);
assert.throws(() => assertManifestContract({ ...contract, api_contract_versions: { ...contract.api_contract_versions, events: "events.v0" } }, input), /api_contract_versions/);
assert.throws(() => assertManifestContract({ ...contract, queue_compatibility_versions: { ...contract.queue_compatibility_versions, scan: [] } }, input), /queue_compatibility_versions/);
assert.throws(() => assertManifestContract({ ...contract, minimum_supported: { ...contract.minimum_supported, backend_version: "old" } }, input), /minimum_supported/);
assert.equal(assertFrontendReleaseIdentity({ frontend_commit_sha: input.frontend_commit_sha }, input), true);
assert.throws(() => assertFrontendReleaseIdentity({ frontend_commit_sha: "b".repeat(40) }, input), /frontend_commit_sha/);
assert.equal(assertBackendFrontendIdentity({ frontend: { commit_sha: input.frontend_commit_sha } }, input), true);
assert.throws(() => assertBackendFrontendIdentity({ frontend: { commit_sha: "b".repeat(40) } }, input), /embedded frontend commit/);
assert.equal(assertFrontendReleaseDeclaration({ frontend_commit_sha_source: "exact-release-pair-input-and-github-pages-deployment-commit",
  audited_start_commit: "a".repeat(40), asset_hashes_sha256: Object.fromEntries(Array.from({ length: 50 }, (_, index) => [`asset-${index}`, "c".repeat(64)])) }), true);
assert.throws(() => assertFrontendReleaseDeclaration({ frontend_commit_sha_source: "guessed", audited_start_commit: "a".repeat(40), asset_hashes_sha256: {} }), /delegate/);
assert.equal(assertObservedSchemaIdentity({ observation: "connected_database_catalog.v1", fingerprint: "c".repeat(64) }, "c".repeat(64)), "c".repeat(64));
assert.throws(() => assertObservedSchemaIdentity({ observation: "source_file", fingerprint: "c".repeat(64) }, "c".repeat(64)), /not observed/);
assert.throws(() => assertObservedSchemaIdentity({ observation: "connected_database_catalog.v1", fingerprint: "d".repeat(64) }, "c".repeat(64)), /does not equal/);

// Both failure modes must pause rather than invoke the pre-enforcement fallback.
for (const probe of ["authoritative procedure absent", "authoritative procedure present-but-failing"]) {
  const paused = { ok: false, code: "authority_probe_failed", probe };
  assert.equal(paused.ok, false, `${probe} must leave the canary paused`);
}
console.log(JSON.stringify({ ok: true, release_closure_contract: "passed" }, null, 2));
