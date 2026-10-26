#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { assertBackendFrontendIdentity, assertExactReleaseAttestation, assertFrontendReleaseDeclaration, assertFrontendReleaseIdentity, assertManifestContract, assertObservedSchemaIdentity, releaseAttestationPayload } from "../src/release-contract.js";

const input = JSON.parse(readFileSync(new URL("../release/schema-alignment-input.json", import.meta.url), "utf8"));
const pairedFrontend = JSON.parse(readFileSync(new URL("../release/frontend-release-manifest.json", import.meta.url), "utf8"));
const index = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const nativePhoneTransport = readFileSync(new URL("../src/native-phone-transport.js", import.meta.url), "utf8");
const liveGate = readFileSync(new URL("./live-release-alignment-check.mjs", import.meta.url), "utf8");
const rollbackMigration = readFileSync(new URL("../supabase/migrations/20260813060000_release_canary_operational_recovery.sql", import.meta.url), "utf8");
const boundaryMigration = readFileSync(new URL("../supabase/migrations/20260813141806_custodial_operational_boundary_closure.sql", import.meta.url), "utf8");

assert.match(input.frontend_commit_sha || '', /^[0-9a-f]{40}$/, "backend must bind a real exact frontend commit before release closure");
assert.equal(input.frontend_commit_sha, pairedFrontend.frontend_commit_sha, "closure input must match the immutable paired frontend declaration, not a stale test-only commit literal");
assert.equal(input.frontend_commit_state, "final_pair_bound");
assert.equal(pairedFrontend.frontend_commit_state, "final_pair_bound");
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
assert.match(liveGate, /canonical_objects_expected/);
assert.match(liveGate, /missing_objects/);
assert.match(liveGate, /mismatched_objects/);
assert.doesNotMatch(liveGate, /canonical_functions_verified/,
  "the live gate must consume the current catalog-derived authority contract");
assert.match(liveGate, /release_canary\?\.paused, false/g,
  "the live release gate must reject a paused canary in both health views");

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const publicKeyPem = publicKey.export({ type: "spki", format: "pem" });
const trustRoot = { keyId: "release-contract-test",
  publicKeySpkiSha256: createHash("sha256").update(publicKey.export({ type: "spki", format: "der" })).digest("hex") };
const unsignedAttestation = { artifact: "memphis-zoo-integrated-release-attestation.v2", release_id: input.release_id,
  backend_commit_sha: "a".repeat(40), backend_tree_sha: "b".repeat(40), backend_evidence_blob_sha: "c".repeat(40),
  backend_evidence_sha256: "d".repeat(64), frontend_commit_sha: input.frontend_commit_sha, schema_fingerprint: "e".repeat(64),
  signature: { algorithm: "ed25519", key_id: "release-contract-test", value_base64: "" } };
unsignedAttestation.signature.value_base64 = sign(null, Buffer.from(`${JSON.stringify(releaseAttestationPayload(unsignedAttestation))}\n`), privateKey).toString("base64");
const attestation = assertExactReleaseAttestation(unsignedAttestation, { publicKeyPem, trustRoot });
assert.equal(attestation.frontend_commit_sha, input.frontend_commit_sha);
assert.throws(() => assertExactReleaseAttestation({ ...attestation, unexpected: true }, { publicKeyPem, trustRoot }), /unexpected shape/);
assert.throws(() => assertExactReleaseAttestation({ ...attestation, frontend_commit_sha: "b".repeat(39) }, { publicKeyPem, trustRoot }), /frontend commit/);
assert.throws(() => assertExactReleaseAttestation({ ...attestation, backend_tree_sha: "f".repeat(40) }, { publicKeyPem, trustRoot }), /signature is invalid/);
const { privateKey: ecPrivateKey, publicKey: ecPublicKey } = generateKeyPairSync("ec", { namedCurve: "secp224r1" });
const ecTrustRoot = { keyId: "release-contract-test",
  publicKeySpkiSha256: createHash("sha256").update(ecPublicKey.export({ type: "spki", format: "der" })).digest("hex") };
const hostileEc = structuredClone(unsignedAttestation);
for (let attempt = 0; attempt < 512; attempt += 1) {
  const candidate = sign(null, Buffer.from(`${JSON.stringify(releaseAttestationPayload(hostileEc))}\n`), ecPrivateKey);
  if (candidate.length === 64) { hostileEc.signature.value_base64 = candidate.toString("base64"); break; }
}
assert.equal(Buffer.from(hostileEc.signature.value_base64, "base64").length, 64,
  "reviewer EC reproduction must produce a 64-byte DER signature");
assert.throws(() => assertExactReleaseAttestation(hostileEc,
  { publicKeyPem: ecPublicKey.export({ type: "spki", format: "pem" }), trustRoot: ecTrustRoot }), /must be an Ed25519 public key/);
const contract = { release_id: input.release_id, api_contract_versions: input.api_contract_versions, queue_compatibility_versions: input.queue_compatibility_versions, minimum_supported: input.minimum_supported };
assert.equal(assertManifestContract(contract, input), true);
assert.throws(() => assertManifestContract({ ...contract, release_id: "release-spoofed" }, input), /release_id/);
assert.throws(() => assertManifestContract({ ...contract, api_contract_versions: { ...contract.api_contract_versions, events: "events.v0" } }, input), /api_contract_versions/);
assert.throws(() => assertManifestContract({ ...contract, queue_compatibility_versions: { ...contract.queue_compatibility_versions, scan: [] } }, input), /queue_compatibility_versions/);
assert.throws(() => assertManifestContract({ ...contract, minimum_supported: { ...contract.minimum_supported, backend_version: "old" } }, input), /minimum_supported/);
assert.equal(assertFrontendReleaseIdentity({ frontend_commit_sha: input.frontend_commit_sha }, input), true);
assert.throws(() => assertFrontendReleaseIdentity({ frontend_commit_sha: "6fae503111ef21c40a309913965c3b963043aa01" }, input), /frontend_commit_sha/, "the superseded frontend must not satisfy current candidate admission");
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

// Genuine historical application-release signatures: public DATA only.
// Default trust preserves the old Build52 signer and admits the existing
// durable August signer; it does not admit the frontend-only recovery root.
const genuineReleaseTrustFixtures = {"old":{"attestation":{"artifact":"memphis-zoo-integrated-release-attestation.v2","release_id":"release-2026.07.19.custodial-v3.12","backend_commit_sha":"24af9e4c0e30edab9a3d6b0ea4b3785c8e0bc7c8","backend_tree_sha":"37d2e89ae98d33ba4b0dae94a99f4ff58fa43d19","backend_evidence_blob_sha":"5c5c7bfd8d92cb6a1433ff4dff3adb001878e41d","backend_evidence_sha256":"bf8c5a506b56309beb841b9179652cf618117e53eda71392482db2195515e0ba","frontend_commit_sha":"6fae503111ef21c40a309913965c3b963043aa01","schema_fingerprint":"750e7f040519f6d4555836cbd4d172a22f98911d5bab9918fa370238fff3f822","signature":{"algorithm":"ed25519","key_id":"custodial-build52-20260915-v1","value_base64":"YbPXrrdAuYWcU8vOj9PXjsRr9hz853m8zBaCcsfJayzJ47ZCcHOf35fQZowC1u2m5FyK5IbHX4WCdPJ2lst7DA=="}},"publicKeyPem":"-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAt7kIjFyJfyDY4l/TdMKBJgFSfe4IzjGmV+fHXRlKekc=\n-----END PUBLIC KEY-----\n"},"recovery":{"attestation":{"artifact":"memphis-zoo-integrated-release-attestation.v2","release_id":"release-2026.07.19.custodial-v3.12","backend_commit_sha":"fc2b989d19246ffd447c4c7cfb2590ac19bbcd27","backend_tree_sha":"31014fa5b629d2fbe225aed2b45b7af9044a3a01","backend_evidence_blob_sha":"7bf447cb12c3d93b4162649d82a816c008d91ec3","backend_evidence_sha256":"cef93332f9cdc182cb47ac6eca1bfb55ec93539cb81b7af73dbd8b074ee23757","frontend_commit_sha":"6fae503111ef21c40a309913965c3b963043aa01","schema_fingerprint":"750e7f040519f6d4555836cbd4d172a22f98911d5bab9918fa370238fff3f822","signature":{"algorithm":"ed25519","key_id":"memphis-release-recovery-20260928-v1","value_base64":"B8NMl2f17D1pBdIB+OxvYOWYJsBt/Te892Jv8NorooI+JJ13iwkAVN8k6qYuIP16Vz3l4+88QRXAYbkKogMAAg=="}},"publicKeyPem":"-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAJtYkcvTMKQiFULIcSFzyD/mybD5GY9YYm9UKthIbGDQ=\n-----END PUBLIC KEY-----\n"},"august":{"attestation":{"artifact":"memphis-zoo-integrated-release-attestation.v2","release_id":"release-2026.07.19.custodial-v3.12","backend_commit_sha":"2e0e64b98ea4fe5c4a6081dd996138680608d08b","backend_tree_sha":"20b644596f00970701d9377b6ef15a0dae2d3d7f","backend_evidence_blob_sha":"b0591456d7293881fdeb2ff2e6a28ae5aaea1848","backend_evidence_sha256":"5e3c6a39b5382a9835f396e81db43fb11210b08151be8fb34f6b99fbec216bf8","frontend_commit_sha":"57032deeed5b2e396fd79cf10453e33210b54b9b","schema_fingerprint":"5b123634dd48e0d9bbf88cd572d2d52bafb8b1aaf96c9f9c2811d6f749f30ac6","signature":{"algorithm":"ed25519","key_id":"memphis-zoo-release-2026-08-13","value_base64":"p+YTxrITTSmVGyoxIe0h7prH3qFTWD50x6Kid3GlsHXPmKNzibNi3L7tKpxYqm9UTVtJWdOvnHMnSDgHm354AA=="}},"publicKeyPem":"-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAQA3iBTQLSlp+QJU55P7VTGLP/dDFB9yd4zh6BD4gM0g=\n-----END PUBLIC KEY-----\n"}};
for (const name of ["old", "august"]) {
  const row=genuineReleaseTrustFixtures[name];
  assert.equal(assertExactReleaseAttestation(row.attestation,{publicKeyPem:row.publicKeyPem}).signature.key_id,row.attestation.signature.key_id);
  assert.throws(()=>assertExactReleaseAttestation({...row.attestation,backend_tree_sha:"f".repeat(40)},{publicKeyPem:row.publicKeyPem}));
}
assert.throws(()=>assertExactReleaseAttestation(genuineReleaseTrustFixtures.august.attestation,{publicKeyPem:genuineReleaseTrustFixtures.old.publicKeyPem}));
assert.throws(()=>assertExactReleaseAttestation({...genuineReleaseTrustFixtures.august.attestation,signature:{...genuineReleaseTrustFixtures.august.attestation.signature,key_id:"unknown-release-key"}},{publicKeyPem:genuineReleaseTrustFixtures.august.publicKeyPem}));
assert.throws(()=>assertExactReleaseAttestation(genuineReleaseTrustFixtures.recovery.attestation,{publicKeyPem:genuineReleaseTrustFixtures.recovery.publicKeyPem}));
