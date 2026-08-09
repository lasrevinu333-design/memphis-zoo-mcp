#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildReleaseManifest, schemaTransitionFields } from "../src/release-manifest.js";
import { assertSchemaAlignment } from "../src/schema-transition.js";

const PREVIOUS = "544d11f47f1f4a960fcf49d13bba53c736d78fe4fe9d225c996c84311d442ad0";
const CURRENT = "c6742e500c2a5d3767f1d886bb5937167eab42730f8271eec76b427a10c5f302";
const BACKEND_TARGET = "45c8e505f2fd5ce553923ce64ed46a49914abe7d2d1fa80aa2f6f866e1d00d7d";
const FUTURE = "2".repeat(64);
const OUTSIDE = "3".repeat(64);
const ENGINE_MAIN_SHA = "7bc61e39a5ae2fda52c777c8a222f138ee36c5af";
const NOW = Date.parse("2026-08-09T00:00:00Z");
const RETIRED_TRANSITION = {
  transition_id: "custodial-native-vault-removal-build11-20260801",
  from_fingerprint: PREVIOUS,
  to_fingerprint: CURRENT,
  expires_at: "2026-08-14T23:59:59Z",
};
const FUTURE_TRANSITION = {
  transition_id: "future-schema-transition-test",
  from_fingerprint: CURRENT,
  to_fingerprint: FUTURE,
  expires_at: "2026-08-14T23:59:59Z",
};
const ACTIVE_TRANSITION = {
  transition_id: "cleaning-inspection-freshness-24h-20260809",
  from_fingerprint: CURRENT,
  to_fingerprint: BACKEND_TARGET,
  expires_at: "2026-08-22T23:59:59Z",
};

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function fixtures({ backendFingerprint = CURRENT, frontendFingerprint = CURRENT, deploymentFingerprint = CURRENT,
  backendTransition = FUTURE_TRANSITION, frontendTransition = FUTURE_TRANSITION,
  deploymentTransition = FUTURE_TRANSITION } = {}) {
  return {
    backendManifest: { schema: { fingerprint: backendFingerprint }, schema_transition: clone(backendTransition) },
    frontendManifest: { schema_fingerprint: frontendFingerprint, schema_transition: clone(frontendTransition) },
    deploymentManifest: { schema_fingerprint: deploymentFingerprint, schema_transition: clone(deploymentTransition) },
    now: NOW,
  };
}

const sourceManifest = JSON.parse(readFileSync(new URL("../release/frontend-release-manifest.json", import.meta.url), "utf8"));
assert.equal(sourceManifest.frontend_commit_sha, ENGINE_MAIN_SHA,
  "the backend copy must pin the exact verified Engine main commit");
assert.equal(sourceManifest.schema_fingerprint, CURRENT,
  "the backend copy must retain the deployed frontend primary while staging the transition");
assert.equal(Object.hasOwn(sourceManifest, "schema_transition"), true,
  "the backend copy must retain the active transition key");
assert.deepEqual(sourceManifest.schema_transition, ACTIVE_TRANSITION,
  "the backend copy must declare the coordinated inspection-freshness transition exactly");

const backendRelease = buildReleaseManifest({ appVersion: "test-release" });
assert.equal(backendRelease.frontend.commit_sha, ENGINE_MAIN_SHA);
assert.equal(backendRelease.schema.fingerprint, CURRENT,
  "the bridge-only backend release must retain the current production fingerprint");
assert.equal(backendRelease.frontend.manifest.schema_fingerprint, CURRENT);
assert.equal(Object.hasOwn(backendRelease, "schema_transition"), true,
  "the backend runtime manifest must publish the active transition key");
assert.deepEqual(backendRelease.schema_transition, ACTIVE_TRANSITION,
  "the backend runtime manifest must publish the coordinated inspection-freshness transition exactly");
assert.deepEqual(schemaTransitionFields({ schema_transition: FUTURE_TRANSITION }), { schema_transition: FUTURE_TRANSITION },
  "an active future transition must still be forwarded exactly");
const inactiveTransitionFields = schemaTransitionFields({ schema_transition: null });
assert.equal(Object.hasOwn(inactiveTransitionFields, "schema_transition"), false,
  "an inactive transition key must not be serialized as null or undefined");

const engineStagedTransition = assertSchemaAlignment(fixtures({
  backendTransition: null,
  frontendTransition: ACTIVE_TRANSITION,
  deploymentTransition: ACTIVE_TRANSITION,
}));
assert.equal(engineStagedTransition.mode, "declared",
  "Engine may stage the active transition while all deployed primary fingerprints remain identical");

const backendRemovalTransition = assertSchemaAlignment(fixtures({
  backendFingerprint: BACKEND_TARGET,
  frontendFingerprint: CURRENT,
  deploymentFingerprint: CURRENT,
  backendTransition: ACTIVE_TRANSITION,
  frontendTransition: ACTIVE_TRANSITION,
  deploymentTransition: ACTIVE_TRANSITION,
}));
assert.equal(backendRemovalTransition.mode, "transition",
  "the backend removal migration must remain aligned with the staged Engine transition");
assert.deepEqual(backendRemovalTransition.transition, ACTIVE_TRANSITION,
  "the post-backend alignment must preserve the exact active transition contract");

const exact = assertSchemaAlignment(fixtures({ backendTransition: null, frontendTransition: null, deploymentTransition: null }));
assert.deepEqual(exact, { mode: "exact", fingerprint: CURRENT, transition: null });

for (let declarationMask = 1; declarationMask < 8; declarationMask += 1) {
  const declarations = {
    backendTransition: declarationMask & 1 ? FUTURE_TRANSITION : null,
    frontendTransition: declarationMask & 2 ? FUTURE_TRANSITION : null,
    deploymentTransition: declarationMask & 4 ? FUTURE_TRANSITION : null,
  };
  assert.equal(assertSchemaAlignment(fixtures(declarations)).mode, "declared",
    `matching primaries must permit transition declaration mask ${declarationMask}`);
}

assert.equal(assertSchemaAlignment(fixtures({ backendFingerprint: FUTURE })).mode, "transition");
assert.equal(assertSchemaAlignment(fixtures({ frontendFingerprint: FUTURE, deploymentFingerprint: FUTURE })).mode, "transition");

const liveBeforeEngineAdvance = assertSchemaAlignment(fixtures({
  backendFingerprint: CURRENT,
  frontendFingerprint: PREVIOUS,
  deploymentFingerprint: PREVIOUS,
  backendTransition: RETIRED_TRANSITION,
  frontendTransition: RETIRED_TRANSITION,
  deploymentTransition: RETIRED_TRANSITION,
}));
assert.equal(liveBeforeEngineAdvance.mode, "transition");

const engineAdvance = assertSchemaAlignment(fixtures({
  backendFingerprint: CURRENT,
  frontendFingerprint: CURRENT,
  deploymentFingerprint: CURRENT,
  backendTransition: RETIRED_TRANSITION,
  frontendTransition: RETIRED_TRANSITION,
  deploymentTransition: RETIRED_TRANSITION,
}));
assert.equal(engineAdvance.mode, "declared",
  "Engine may advance all primaries while retaining the coordinated retired bridge");

const backendRetiresFirst = assertSchemaAlignment(fixtures({
  backendTransition: null,
  frontendTransition: RETIRED_TRANSITION,
  deploymentTransition: RETIRED_TRANSITION,
}));
assert.equal(backendRetiresFirst.mode, "declared",
  "backend cleanup must stay green while Engine still declares the retired bridge");

const frontendRetiresFirst = assertSchemaAlignment(fixtures({
  backendTransition: RETIRED_TRANSITION,
  frontendTransition: null,
  deploymentTransition: null,
}));
assert.equal(frontendRetiresFirst.mode, "declared",
  "frontend cleanup must stay green while the backend still declares the retired bridge");

const backendCleanup = assertSchemaAlignment(fixtures({
  backendTransition: null,
  frontendTransition: null,
  deploymentTransition: null,
}));
assert.deepEqual(backendCleanup, { mode: "exact", fingerprint: CURRENT, transition: null },
  "backend cleanup must restore exact alignment without changing the canonical fingerprint");

for (const [missingLabel, missingTransition] of [
  ["backend", { backendTransition: null }],
  ["frontend", { frontendTransition: null }],
  ["deployment", { deploymentTransition: null }],
]) {
  assert.throws(() => assertSchemaAlignment(fixtures({ backendFingerprint: FUTURE, ...missingTransition })),
    /every manifest/, `schema drift must reject a missing ${missingLabel} declaration`);
}
assert.throws(() => assertSchemaAlignment(fixtures({
  backendFingerprint: OUTSIDE,
})), /outside the transition/);
assert.throws(() => assertSchemaAlignment(fixtures({
  frontendTransition: { ...FUTURE_TRANSITION, transition_id: "different-transition" },
})), /contracts differ/);
assert.throws(() => assertSchemaAlignment(fixtures({
  backendTransition: { ...FUTURE_TRANSITION, unexpected: true },
  frontendTransition: { ...FUTURE_TRANSITION, unexpected: true },
  deploymentTransition: { ...FUTURE_TRANSITION, unexpected: true },
})), /unexpected shape/);
assert.throws(() => assertSchemaAlignment(fixtures({
  backendTransition: { ...FUTURE_TRANSITION, expires_at: "2026-07-31T23:59:59Z" },
  frontendTransition: { ...FUTURE_TRANSITION, expires_at: "2026-07-31T23:59:59Z" },
  deploymentTransition: { ...FUTURE_TRANSITION, expires_at: "2026-07-31T23:59:59Z" },
})), /expired/);
assert.throws(() => assertSchemaAlignment(fixtures({
  backendTransition: { ...FUTURE_TRANSITION, expires_at: "2026-08-23T00:00:01Z" },
  frontendTransition: { ...FUTURE_TRANSITION, expires_at: "2026-08-23T00:00:01Z" },
  deploymentTransition: { ...FUTURE_TRANSITION, expires_at: "2026-08-23T00:00:01Z" },
})), /14-day transition window/);
assert.throws(() => assertSchemaAlignment(fixtures({
  backendTransition: { ...FUTURE_TRANSITION, to_fingerprint: CURRENT },
  frontendTransition: { ...FUTURE_TRANSITION, to_fingerprint: CURRENT },
  deploymentTransition: { ...FUTURE_TRANSITION, to_fingerprint: CURRENT },
})), /distinct fingerprints/);
assert.throws(() => assertSchemaAlignment(fixtures({
  backendTransition: null,
  frontendTransition: null,
  deploymentTransition: null,
  deploymentFingerprint: FUTURE,
})), /without a transition contract/);

const liveCheckSource = readFileSync(new URL("./live-release-alignment-check.mjs", import.meta.url), "utf8");
const monitorSource = readFileSync(new URL("../.github/workflows/production-availability-monitor.yml", import.meta.url), "utf8");
assert.match(liveCheckSource, /assertSchemaAlignment/);
assert.match(liveCheckSource, /FRONTEND_RELEASE_MANIFEST_URL/);
assert.match(liveCheckSource, /FRONTEND_DEPLOYMENT_MANIFEST_URL/);
assert.match(monitorSource,
  /if len\(distinct_primary\) > 1:\s+assert len\(declared\) == len\(transitions\), transitions/,
  "only live drift must require all three transition declarations");
assert.match(monitorSource,
  /schema_alignment_mode = 'declared' if len\(distinct_primary\) == 1 else 'transition'/,
  "the monitor must preserve one-sided cleanup while all primary fingerprints match");
assert.match(monitorSource, /remaining_seconds <= 14 \* 24 \* 60 \* 60/,
  "live transitions must have an intrinsic maximum remaining lifetime");
assert.match(monitorSource, /all\(fingerprint in allowed_fingerprints/,
  "live primary fingerprints must remain inside the declared pair");

console.log(JSON.stringify({ ok: true, schema_transition_contract: "passed" }, null, 2));
