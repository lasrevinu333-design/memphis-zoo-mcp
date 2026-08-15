#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const inputPath = resolve(root, "release/schema-alignment-input.json");
const fingerprintPath = resolve(root, "supabase/canonical/schema-fingerprint.txt");
const outputPath = resolve(root, "release/frontend-release-manifest.json");
const checkOnly = process.argv.slice(2).join(" ") === "--check";
assert.ok(checkOnly || process.argv.length === 2, "usage: refresh-release-schema-alignment.mjs [--check]");

const input = JSON.parse(readFileSync(inputPath, "utf8"));
const fingerprint = readFileSync(fingerprintPath, "utf8").trim();
assert.match(fingerprint, /^[a-f0-9]{64}$/, "canonical schema fingerprint is invalid");
assert.match(String(input.schema_from_fingerprint || ""), /^[a-f0-9]{64}$/, "release source fingerprint is invalid");
assert.notEqual(input.schema_from_fingerprint, fingerprint, "a release transition requires distinct fingerprints");
assert.ok(input.frontend_commit_sha === null || /^[a-f0-9]{40}$/.test(String(input.frontend_commit_sha || "")),
  "frontend commit identity must be null until final rebind or an exact commit");
assert.match(String(input.frontend_tree_sha || ""), /^[a-f0-9]{40}$/, "frontend tree identity must be exact");
assert.ok(["final_rebind_required", "final_pair_bound"].includes(input.frontend_commit_state), "frontend commit state is invalid");
assert.equal(input.frontend_candidate?.version_code, 27, "the frozen Android candidate must be Build 27");
assert.match(String(input.frontend_candidate?.build_id || ""), /^[a-f0-9]{24}$/, "candidate build identity is invalid");
assert.match(String(input.frontend_candidate?.artifact_sha256 || ""), /^[a-f0-9]{64}$/, "candidate APK digest is invalid");
assert.match(String(input.frontend_candidate?.provenance_sha256 || ""), /^[a-f0-9]{64}$/, "candidate provenance digest is invalid");
assert.equal(input.frontend_rollback_recovery?.strategy, "forward_versioned_recovery_apk");
assert.equal(input.frontend_rollback_recovery?.package_version_code, 28);
assert.ok(input.frontend_rollback_recovery.package_version_code > input.frontend_candidate.version_code,
  "the recovery APK must have a higher Android versionCode than the candidate");
assert.match(String(input.frontend_rollback_recovery?.source_commit_sha || ""), /^[a-f0-9]{40}$/, "recovery source commit is invalid");
assert.match(String(input.frontend_rollback_recovery?.source_tree_sha || ""), /^[a-f0-9]{40}$/, "recovery source tree is invalid");
assert.match(String(input.frontend_rollback_recovery?.artifact_sha256 || ""), /^[a-f0-9]{64}$/, "recovery APK digest is invalid");
assert.equal(input.frontend_rollback_recovery?.direct_version_downgrade_supported, false);
assert.equal(input.frontend_rollback_recovery?.physical_rollback_drill_complete, true);
assert.equal(input.physical_gate?.software_and_lifecycle_checks_complete, true);
assert.equal(input.physical_gate?.physical_rollback_drill_complete, true);
assert.equal(input.physical_gate?.real_nfc_workflow_complete, false);
assert.equal(input.physical_gate?.fleet_authorized, false);
assert.deepEqual(Object.keys(input.minimum_supported || {}).sort(), ["backend_version", "frontend_version"]);
assert.match(String(input.schema_transition?.transition_id || ""), /^[a-z0-9][a-z0-9.-]{1,126}[a-z0-9]$/, "release transition identity is invalid");
assert.match(String(input.schema_transition?.expires_at || ""), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/, "release transition expiry is invalid");

const manifest = {
  release_id: input.release_id,
  frontend_commit_sha: input.frontend_commit_sha,
  frontend_tree_sha: input.frontend_tree_sha,
  frontend_commit_state: input.frontend_commit_state,
  frontend_candidate: input.frontend_candidate,
  frontend_rollback_recovery: input.frontend_rollback_recovery,
  physical_gate: input.physical_gate,
  backend_minimum_version: input.backend_minimum_version,
  schema_fingerprint: fingerprint,
  schema_transition: {
    transition_id: input.schema_transition.transition_id,
    from_fingerprint: input.schema_from_fingerprint,
    to_fingerprint: fingerprint,
    expires_at: input.schema_transition.expires_at,
  },
  api_contract_versions: input.api_contract_versions,
  queue_compatibility_versions: input.queue_compatibility_versions,
  minimum_supported: input.minimum_supported,
};
const generated = `${JSON.stringify(manifest, null, 2)}\n`;

if (checkOnly) {
  assert.equal(readFileSync(outputPath, "utf8"), generated,
    "release/frontend-release-manifest.json is not generated from the canonical fingerprint and release alignment input");
} else {
  writeFileSync(outputPath, generated);
}

console.log(JSON.stringify({
  ok: true,
  mode: checkOnly ? "check" : "refresh",
  schema_from_fingerprint: input.schema_from_fingerprint,
  schema_to_fingerprint: fingerprint,
  frontend_commit_sha: input.frontend_commit_sha,
  transition_id: input.schema_transition.transition_id,
}, null, 2));
