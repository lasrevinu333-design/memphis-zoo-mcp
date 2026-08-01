#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildReleaseManifest } from "../src/release-manifest.js";
import { assertSchemaAlignment } from "../src/schema-transition.js";

const OLD = "52b53bf279e67cb71f85a652cc669d44350716146603132f7e8be5c7de5e30cf";
const NEW = "ce9466f03953076840ff4e35d998713cced8f22c791fb8b11dacdc8c070c4caf";
const THIRD = "3".repeat(64);
const NOW = Date.parse("2026-08-01T00:00:00Z");
const TRANSITION = {
  transition_id: "custodial-atomic-offline-completion-20260801",
  from_fingerprint: OLD,
  to_fingerprint: NEW,
  expires_at: "2026-08-08T23:59:59Z",
};

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function fixtures({ backendFingerprint = OLD, frontendFingerprint = OLD, deploymentFingerprint = OLD,
  backendTransition = TRANSITION, frontendTransition = TRANSITION, deploymentTransition = TRANSITION } = {}) {
  return {
    backendManifest: { schema: { fingerprint: backendFingerprint }, schema_transition: clone(backendTransition) },
    frontendManifest: { schema_fingerprint: frontendFingerprint, schema_transition: clone(frontendTransition) },
    deploymentManifest: { schema_fingerprint: deploymentFingerprint, schema_transition: clone(deploymentTransition) },
    now: NOW,
  };
}

const sourceManifest = JSON.parse(readFileSync(new URL("../release/frontend-release-manifest.json", import.meta.url), "utf8"));
assert.equal(sourceManifest.schema_fingerprint, OLD, "the bridge must not advance the frontend primary fingerprint");
assert.deepEqual(sourceManifest.schema_transition, TRANSITION, "the bridge transition contract changed");
assert.deepEqual(Object.keys(sourceManifest.schema_transition), [
  "transition_id", "from_fingerprint", "to_fingerprint", "expires_at",
]);

const backendRelease = buildReleaseManifest({ appVersion: "test-release" });
assert.equal(backendRelease.schema.fingerprint, OLD, "the bridge must not advance the backend primary fingerprint");
assert.equal(backendRelease.frontend.manifest.schema_fingerprint, OLD);
assert.deepEqual(backendRelease.schema_transition, TRANSITION, "the backend must publish the source-controlled transition contract");

const exact = assertSchemaAlignment(fixtures({ backendTransition: null, frontendTransition: null, deploymentTransition: null }));
assert.equal(exact.mode, "exact");

for (const declaration of ["backendTransition", "frontendTransition", "deploymentTransition"]) {
  const oneSided = fixtures({ backendTransition: null, frontendTransition: null, deploymentTransition: null });
  oneSided.backendManifest.schema_transition = declaration === "backendTransition" ? clone(TRANSITION) : null;
  oneSided.frontendManifest.schema_transition = declaration === "frontendTransition" ? clone(TRANSITION) : null;
  oneSided.deploymentManifest.schema_transition = declaration === "deploymentTransition" ? clone(TRANSITION) : null;
  assert.equal(assertSchemaAlignment(oneSided).mode, "declared", `${declaration} must be safe while primaries remain identical`);
}

assert.equal(assertSchemaAlignment(fixtures()).mode, "declared");
assert.equal(assertSchemaAlignment(fixtures({ backendFingerprint: NEW })).mode, "transition");
assert.equal(assertSchemaAlignment(fixtures({ frontendFingerprint: NEW, deploymentFingerprint: NEW })).mode, "transition");

assert.throws(() => assertSchemaAlignment(fixtures({
  backendFingerprint: NEW,
  deploymentTransition: null,
})), /every manifest/);
assert.throws(() => assertSchemaAlignment(fixtures({
  backendFingerprint: THIRD,
})), /outside the transition/);
assert.throws(() => assertSchemaAlignment(fixtures({
  frontendTransition: { ...TRANSITION, transition_id: "different-transition" },
})), /contracts differ/);
assert.throws(() => assertSchemaAlignment(fixtures({
  backendTransition: { ...TRANSITION, unexpected: true },
  frontendTransition: { ...TRANSITION, unexpected: true },
  deploymentTransition: { ...TRANSITION, unexpected: true },
})), /unexpected shape/);
assert.throws(() => assertSchemaAlignment(fixtures({
  backendTransition: { ...TRANSITION, expires_at: "2026-07-31T23:59:59Z" },
  frontendTransition: { ...TRANSITION, expires_at: "2026-07-31T23:59:59Z" },
  deploymentTransition: { ...TRANSITION, expires_at: "2026-07-31T23:59:59Z" },
})), /expired/);
assert.throws(() => assertSchemaAlignment(fixtures({
  backendTransition: { ...TRANSITION, expires_at: "2026-08-16T00:00:01Z" },
  frontendTransition: { ...TRANSITION, expires_at: "2026-08-16T00:00:01Z" },
  deploymentTransition: { ...TRANSITION, expires_at: "2026-08-16T00:00:01Z" },
})), /14-day transition window/);
assert.throws(() => assertSchemaAlignment(fixtures({
  backendTransition: { ...TRANSITION, to_fingerprint: OLD },
  frontendTransition: { ...TRANSITION, to_fingerprint: OLD },
  deploymentTransition: { ...TRANSITION, to_fingerprint: OLD },
})), /distinct fingerprints/);
assert.throws(() => assertSchemaAlignment(fixtures({
  backendTransition: null,
  frontendTransition: null,
  deploymentTransition: null,
  deploymentFingerprint: NEW,
})), /without a transition contract/);

const liveCheckSource = readFileSync(new URL("./live-release-alignment-check.mjs", import.meta.url), "utf8");
const monitorSource = readFileSync(new URL("../.github/workflows/production-availability-monitor.yml", import.meta.url), "utf8");
assert.match(liveCheckSource, /assertSchemaAlignment/);
assert.match(liveCheckSource, /FRONTEND_RELEASE_MANIFEST_URL/);
assert.match(liveCheckSource, /FRONTEND_DEPLOYMENT_MANIFEST_URL/);
assert.match(monitorSource, /len\(declared\) == len\(transitions\)/,
  "live drift must require all three transition declarations");
assert.match(monitorSource, /remaining_seconds <= 14 \* 24 \* 60 \* 60/,
  "live transitions must have an intrinsic maximum remaining lifetime");
assert.match(monitorSource, /all\(fingerprint in allowed_fingerprints/,
  "live primary fingerprints must remain inside the declared pair");

console.log(JSON.stringify({ ok: true, schema_transition_contract: "passed" }, null, 2));
