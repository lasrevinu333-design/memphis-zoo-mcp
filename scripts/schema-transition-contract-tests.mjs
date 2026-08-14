#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildReleaseManifest } from "../src/release-manifest.js";
import { assertSchemaAlignment } from "../src/schema-transition.js";

const input = JSON.parse(readFileSync(new URL("../release/schema-alignment-input.json", import.meta.url), "utf8"));
const frontend = JSON.parse(readFileSync(new URL("../release/frontend-release-manifest.json", import.meta.url), "utf8"));
const target = readFileSync(new URL("../supabase/canonical/schema-fingerprint.txt", import.meta.url), "utf8").trim();
const now = Date.parse("2026-08-13T00:00:00Z");

assert.equal(frontend.frontend_commit_sha, input.frontend_commit_sha, "the backend manifest must pin the exact audited frontend");
assert.equal(frontend.frontend_commit_state, "final_pair_bound");
assert.equal(frontend.schema_fingerprint, target, "the exact frontend pair must declare the canonical target schema");
assert.deepEqual(frontend.minimum_supported, input.minimum_supported);
const backend = buildReleaseManifest({ appVersion: "test-release" });
assert.deepEqual(backend.api_contract_versions, input.api_contract_versions);
assert.deepEqual(backend.queue_compatibility_versions, input.queue_compatibility_versions);
assert.deepEqual(backend.minimum_supported, input.minimum_supported);

const transition = frontend.schema_transition;
const aligned = assertSchemaAlignment({
  backendManifest: backend,
  frontendManifest: { schema_fingerprint: frontend.schema_fingerprint, schema_transition: transition },
  deploymentManifest: { schema_fingerprint: frontend.schema_fingerprint, schema_transition: transition },
  now,
});
assert.equal(aligned.mode, "declared");
assert.equal(transition.from_fingerprint, input.schema_from_fingerprint);
assert.equal(target, transition.to_fingerprint);
assert.throws(() => assertSchemaAlignment({
  backendManifest: backend,
  frontendManifest: { schema_fingerprint: "f".repeat(64), schema_transition: transition },
  deploymentManifest: { schema_fingerprint: frontend.schema_fingerprint, schema_transition: transition }, now,
}), /outside the transition/);
console.log(JSON.stringify({ ok: true, schema_transition_contract: "passed" }, null, 2));
