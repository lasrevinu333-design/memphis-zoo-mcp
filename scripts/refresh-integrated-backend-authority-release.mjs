#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const inputPath = resolve(root, "release/integrated-backend-authority-input.json");
const outputPath = resolve(root, "release/integrated-backend-authority-evidence.json");
const fingerprintPath = resolve(root, "supabase/canonical/schema-fingerprint.txt");
const releaseManifestPath = resolve(root, "release/frontend-release-manifest.json");
const checkOnly = process.argv.slice(2).join(" ") === "--check";
assert.ok(checkOnly || process.argv.length === 2, "usage: refresh-integrated-backend-authority-release.mjs [--check]");

const input = JSON.parse(readFileSync(inputPath, "utf8"));
const schemaFingerprint = readFileSync(fingerprintPath, "utf8").trim();
const frontendManifest = JSON.parse(readFileSync(releaseManifestPath, "utf8"));
assert.match(schemaFingerprint, /^[a-f0-9]{64}$/);
assert.equal(input.release_contract_version, "offline-authority.v3");
assert.equal(input.accepted_engine_contract.scan, "scan.v2");
assert.equal(input.required_engine_contract.scan, "scan.v3.offline-authority");
assert.equal(input.backend_contract.execution_boundary, "CUSTODIAL_BACKEND_PROOF_SECRET");
assert.equal(input.backend_contract.bridge_backend_source, "src/index.js:runPreparedScanRpc");
assert.ok(Array.isArray(input.cutover?.phase_order) && input.cutover.phase_order.length >= 6);
assert.ok(Array.isArray(input.cutover?.rollback?.restoration_checks) && input.cutover.rollback.restoration_checks.length >= 4);
assert.equal(input.cutover?.source_identity?.kind, "external_immutable_acceptance_input");
assert.equal(input.cutover?.source_identity?.generated_evidence_path, "release/integrated-backend-authority-evidence.json");
assert.equal(input.cutover?.source_identity?.generated_evidence_excluded_from_content_identity, true);
assert.ok(Array.isArray(input.cutover?.source_identity?.authority_content_paths) && input.cutover.source_identity.authority_content_paths.length >= 12);
assert.equal(new Set(input.cutover.source_identity.authority_content_paths).size, input.cutover.source_identity.authority_content_paths.length);
for (const path of input.cutover.source_identity.authority_content_paths) {
  assert.match(path, /^(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]+$/);
  assert.ok(!path.startsWith("/"));
}
const migrations = [
  "20260810120000_retire_named_manager_shared_room_authority.sql",
  "20260810130000_harden_named_manager_retired_archive_and_concurrency.sql",
  "20260810140000_finalize_named_manager_messenger_retirement_integrity.sql",
  "20260810143000_offline_actor_occurrence_reconciliation.sql",
  "20260810150000_enforce_integrated_backend_authority.sql",
  "20260810160000_close_offline_authority_integrity_gaps.sql",
  "20260810170000_finish_offline_authority_operational_closure.sql",
  "20260810190000_final_integrated_backend_operational_correction.sql",
].map((name) => ({ name }));
const output = {
  artifact: "integrated-backend-authority-release-evidence.v2",
  schema_fingerprint: schemaFingerprint,
  schema_transition: frontendManifest.schema_transition,
  frontend_source_fingerprint: frontendManifest.schema_fingerprint,
  backend_contract: input.backend_contract,
  compatibility_window: {
    accepted_engine: input.accepted_engine_contract,
    required_engine: input.required_engine_contract,
    additive_phase: "20260810143000 supplies explicit activation and records no state-read proof",
    enforcement_phase: "20260810150000 routes both canonical and legacy completion through one server-authenticated transaction",
    closure_phase: "20260810160000 removes direct DML and legacy-writer authority, fences terminal conflicts, and writes manager outbox evidence",
    operational_closure_phase: "20260810170000 recovers durable exact-start proofs, retires every service-role generic writer, and runs leased reconciliation notification delivery",
    final_operational_correction_phase: "20260810190000 fences reassigned proof replay, retires alternate terminal writers and purge, and records idempotent recipient delivery evidence",
  },
  rollback: input.rollback,
  cutover: input.cutover,
  authority_content_identity: {
    source: "git_tree_blobs_from_external_immutable_acceptance_input",
    authority_paths: input.cutover.source_identity.authority_content_paths,
    generated_evidence_excluded_path: "release/integrated-backend-authority-evidence.json",
    binding: "The executable cutover gate requires externally supplied exact expected_commit and expected_tree, verifies this evidence file as a blob in that tree, then hashes every listed authority path from that tree and compares each worktree byte sequence with its exact tree blob.",
  },
  manager_recovery: {
    list: "GET /admin-api/custodial/offline-reconciliations?limit=1..100&before=<ISO-8601>",
    detail: "GET /admin-api/custodial/offline-reconciliations/:reconciliationId",
    disposition: "POST /admin-api/custodial/offline-reconciliations/:reconciliationId/dispositions",
    authority: "active named manager; disposition write additionally requires DIRECTOR or SECURITY_ADMIN",
  },
  migrations,
  release_boundary: "Configure a minimum-32-character CUSTODIAL_BACKEND_PROOF_SECRET and matching database digest before Phase A, retain the bridge backend artifact through Phase C, and require the executable health/restoration probes before traffic changes.",
};
const rendered = `${JSON.stringify(output, null, 2)}\n`;
if (checkOnly) assert.equal(readFileSync(outputPath, "utf8"), rendered, "Integrated backend authority release evidence is stale.");
else writeFileSync(outputPath, rendered);
console.log(JSON.stringify({ ok: true, mode: checkOnly ? "check" : "refresh", schema_fingerprint: schemaFingerprint, migrations: migrations.length }, null, 2));
