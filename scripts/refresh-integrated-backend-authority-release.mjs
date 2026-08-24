#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildIntegratedBackendAuthorityReleaseEvidence } from "../src/integrated-backend-authority-release-evidence.js";

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
  .filter(({ path }) => /^supabase\/migrations\/[^/]+\.sql$/.test(path));
assert.equal(migrations.length, 108, "release authority inventory must bind every migration at this head");
const output = buildIntegratedBackendAuthorityReleaseEvidence({
  input,
  schemaFingerprint,
  frontendManifest,
  authorityInventory,
  generatedEvidencePath,
});
const rendered = `${JSON.stringify(output, null, 2)}\n`;
if (checkOnly) assert.equal(readFileSync(outputPath, "utf8"), rendered, "Integrated backend authority release evidence is stale.");
else writeFileSync(outputPath, rendered);
console.log(JSON.stringify({ ok: true, mode: checkOnly ? "check" : "refresh", source_tree: sourceTree, authority_paths: authorityInventory.length, migrations: migrations.length, schema_fingerprint: schemaFingerprint }, null, 2));
