#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const inputPath = resolve(root, "release/integrated-backend-authority-input.json");
const outputPath = resolve(root, "release/integrated-backend-authority-evidence.json");
const fingerprintPath = resolve(root, "supabase/canonical/schema-fingerprint.txt");
const releaseManifestPath = resolve(root, "release/frontend-release-manifest.json");
const checkOnly = process.argv.slice(2).join(" ") === "--check";
assert.ok(checkOnly || process.argv.length === 2, "usage: refresh-integrated-backend-authority-release.mjs [--check]");

function gitText(args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function gitBytes(args) {
  return execFileSync("git", args, { cwd: root, maxBuffer: 64 * 1024 * 1024 });
}

function assertNoForbiddenIndexFlags() {
  const records = gitBytes(["ls-files", "-v", "-z"]).toString("utf8").split("\0").filter(Boolean);
  for (const record of records) {
    const marker = record.slice(0, 1);
    const path = record.slice(2);
    assert.equal(record.slice(1, 2), " ", `invalid index flag record: ${record}`);
    assert.equal(marker === "S", false, `skip-worktree index flag is forbidden: ${path}`);
    assert.equal(/[a-z]/.test(marker), false, `assume-unchanged index flag is forbidden: ${path}`);
  }
}

function assertExactHeadWorktree() {
  assertNoForbiddenIndexFlags();
  assert.equal(
    gitText(["status", "--porcelain=v1", "--untracked-files=all", "--ignored=no"]),
    "",
    "staged, unstaged, tracked, or untracked content is forbidden before release evidence refresh/check",
  );
  for (const args of [["diff", "--quiet", "--ignore-submodules", "--"], ["diff", "--cached", "--quiet", "--ignore-submodules", "--"]]) {
    try {
      execFileSync("git", args, { cwd: root, stdio: ["ignore", "ignore", "ignore"] });
    } catch {
      assert.fail(`wrong or dirty Git index: git ${args.join(" ")}`);
    }
  }
}

function assertRepositoryPath(path) {
  assert.match(path, /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]+$/, `invalid tracked path: ${path}`);
  return path;
}

function inventoryFromExactTree(tree) {
  const entries = gitBytes(["ls-tree", "-r", "-z", tree]).toString("utf8").split("\0").filter(Boolean).map((record) => {
    const match = record.match(/^([0-7]{6})\s+(blob)\s+([a-f0-9]{40})\t(.+)$/);
    assert.ok(match, `expected tree contains a non-regular tracked entry: ${record}`);
    const [, mode, type, objectId, rawPath] = match;
    const path = assertRepositoryPath(rawPath);
    assert.equal(type, "blob");
    assert.ok(["100644", "100755"].includes(mode), `tracked authority path must be a regular non-symlink file: ${path}`);
    return { path, mode, object_id: objectId };
  });
  assert.ok(entries.length > 0, "expected release tree must contain tracked paths");
  return entries;
}

const input = JSON.parse(readFileSync(inputPath, "utf8"));
const schemaFingerprint = readFileSync(fingerprintPath, "utf8").trim();
const frontendManifest = JSON.parse(readFileSync(releaseManifestPath, "utf8"));
assert.match(schemaFingerprint, /^[a-f0-9]{64}$/);
assert.equal(input.release_contract_version, "offline-authority.v5");
assert.equal(input.accepted_engine_contract.scan, "scan.v2");
assert.equal(input.required_engine_contract.scan, "scan.v4.snapshot-bound-authority");
assert.equal(input.backend_contract.execution_boundary, "CUSTODIAL_BACKEND_PROOF_SECRET");
assert.equal(input.backend_contract.bridge_backend_source, "src/scan-authority-cutover.js:runCanonicalScanRpc");
assert.ok(Array.isArray(input.cutover?.phase_order) && input.cutover.phase_order.length >= 6);
assert.ok(Array.isArray(input.cutover?.rollback?.restoration_checks) && input.cutover.rollback.restoration_checks.length >= 4);
assert.equal(input.cutover?.source_identity?.kind, "external_signed_release_attestation");
assert.equal(input.cutover?.source_identity?.generated_evidence_path, "release/integrated-backend-authority-evidence.json");
assert.equal(input.cutover?.source_identity?.generated_evidence_excluded_from_content_identity, true);
assert.equal(Object.hasOwn(input.cutover.source_identity, "authority_content_paths"), false, "manual authority inventory is forbidden");
assert.deepEqual(input.cutover?.source_identity?.authority_inventory?.exclude, [outputPath.slice(root.length + 1)]);
assert.equal(input.cutover?.source_identity?.authority_inventory?.source, "all-tracked-paths-in-external-expected-tree");
const generatedEvidencePath = outputPath.slice(root.length + 1);
assertExactHeadWorktree();
const sourceTree = gitText(["rev-parse", "HEAD^{tree}"]);
const trackedInventory = inventoryFromExactTree(sourceTree);
const authorityInventory = trackedInventory.filter(({ path }) => path !== generatedEvidencePath);
const migrations = authorityInventory
  .filter(({ path }) => /^supabase\/migrations\/[^/]+\.sql$/.test(path))
  .map(({ path }) => ({ name: path.slice("supabase/migrations/".length) }));
assert.equal(migrations.length, 92, "release authority inventory must bind every migration at this head");
const output = {
  artifact: "integrated-backend-authority-release-evidence.v2",
  release_id: frontendManifest.release_id,
  frontend_commit_sha: frontendManifest.frontend_commit_sha,
  frontend_commit_state: frontendManifest.frontend_commit_state,
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
    scan_snapshot_phase: "20260813035530 exposes bounded offline scan authority and enforces exact provenance evidence shape",
    snapshot_rebind_closure_phase: "20260813050000 binds activation to an issued snapshot and derives current operational-day truth",
    canary_operational_recovery_phase: "20260813060000 adds durable exact-device pause and known-good forward restoration of canonical authority functions",
    operational_service_date_phase: "20260813070000 unifies schedules, turnover, occurrences, dashboard truth, and recovery probes at the 04:00 Central service date",
    operational_boundary_closure_phase: "20260813141806 aligns notification service dates, exact activation replay identity, and the captured rollback definition",
    device_sync_actor_groups_phase: "20260813173000 stores verified pending work groups by issued snapshot, employee, and assignment epoch while retaining the Build 22 aggregate reporter",
    release_phone_transport_and_offline_activation_phase: "20260813190000 requires a fresh immutable receipt from the designated phone's native-vault /scan-api/rpc path before resume and permits delayed activation only for work begun while snapshot, credential, and assignment authority were valid",
    u4_ops_closure_phase: "20260813210000 canonicalizes native wire timestamps, records immutable activation boundaries, enforces UUID completion identities, installs two-phase employee notification dispatch ledgers, durable manager dispatch preparation with terminal outcome-unknown restart recovery, complete notification recovery authority, and terminal notification retries, and restores the catalog-derived authority set",
    atomic_day_change_reconciliation_phase: "20260814224034 converges both preserved U4 migration histories and recognizes the existing complete child/projection receipt chain before mutable Weekly Schedule authority is reread",
    managed_schema_authority_normalization_phase: "20260815160613 removes broad future-object defaults; 20260815163346 preserves application and scheduler access through explicit role grants while keeping PUBLIC revoked, and managed postgres/supabase_admin deployment authority remains comparable without hiding application grants or role memberships",
  },
  rollback: input.rollback,
  cutover: input.cutover,
  authority_content_identity: {
    source: "complete_tracked_git_tree_from_external_signed_release_attestation",
    expected_tree_inventory: authorityInventory.map(({ path, mode, object_id }) => ({ path, mode, object_id })),
    authority_path_count: authorityInventory.length,
    migration_path_count: migrations.length,
    generated_evidence_excluded_path: generatedEvidencePath,
    binding: "The executable cutover gate verifies one external Ed25519-signed release attestation, deterministically enumerates every tracked entry in its exact backend tree, rejects non-regular or symlink authority entries and forbidden index flags, compares every worktree byte sequence and mode with its exact tree blob and mode, and separately verifies this generated evidence file against the signed digest and exact tree blob.",
  },
  manager_recovery: {
    list: "GET /admin-api/custodial/offline-reconciliations?limit=1..100&before=<ISO-8601>",
    detail: "GET /admin-api/custodial/offline-reconciliations/:reconciliationId",
    disposition: "POST /admin-api/custodial/offline-reconciliations/:reconciliationId/dispositions",
    authority: "active named manager; disposition write additionally requires DIRECTOR or SECURITY_ADMIN",
  },
  migrations,
  release_boundary: "Prepare distinct minimum-32-character backend and native-route secrets before cutover; configure their database digests immediately after the migrations that create each configuration function, retain the bridge backend artifact through the scan-snapshot phase, and require the executable health/restoration probes before traffic changes.",
};
const rendered = `${JSON.stringify(output, null, 2)}\n`;
if (checkOnly) assert.equal(readFileSync(outputPath, "utf8"), rendered, "Integrated backend authority release evidence is stale.");
else writeFileSync(outputPath, rendered);
console.log(JSON.stringify({ ok: true, mode: checkOnly ? "check" : "refresh", source_tree: sourceTree, authority_paths: authorityInventory.length, migrations: migrations.length, schema_fingerprint: schemaFingerprint }, null, 2));
