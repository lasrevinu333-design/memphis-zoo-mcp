import assert from "node:assert/strict";

const FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/;
const MAX_TRANSITION_REMAINING_MS = 14 * 24 * 60 * 60 * 1000;
const TRANSITION_ID_PATTERN = /^[a-z0-9](?:[a-z0-9.-]{0,126}[a-z0-9])?$/;
const TRANSITION_KEYS = [
  "expires_at",
  "from_fingerprint",
  "to_fingerprint",
  "transition_id",
];

function validateTransition(transition, label, nowMs) {
  assert.ok(transition && typeof transition === "object" && !Array.isArray(transition), `${label} must be an object`);
  assert.deepEqual(Object.keys(transition).sort(), TRANSITION_KEYS, `${label} has an unexpected shape`);
  assert.match(transition.transition_id, TRANSITION_ID_PATTERN, `${label} transition_id is invalid`);
  assert.match(transition.from_fingerprint, FINGERPRINT_PATTERN, `${label} from_fingerprint is invalid`);
  assert.match(transition.to_fingerprint, FINGERPRINT_PATTERN, `${label} to_fingerprint is invalid`);
  assert.notEqual(transition.from_fingerprint, transition.to_fingerprint, `${label} must name two distinct fingerprints`);
  assert.match(transition.expires_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/, `${label} expires_at must be a whole-second UTC timestamp`);
  const expiresAt = Date.parse(transition.expires_at);
  assert.ok(Number.isFinite(expiresAt), `${label} expires_at is invalid`);
  assert.equal(new Date(expiresAt).toISOString().replace(".000Z", "Z"), transition.expires_at, `${label} expires_at is invalid`);
  assert.ok(expiresAt > nowMs, `${label} is expired`);
  assert.ok(expiresAt - nowMs <= MAX_TRANSITION_REMAINING_MS, `${label} exceeds the 14-day transition window`);
  return transition;
}

export function assertSchemaAlignment({ backendManifest, frontendManifest, deploymentManifest, now = Date.now() }) {
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  assert.ok(Number.isFinite(nowMs), "schema alignment time is invalid");

  const primaryFingerprints = [
    ["backend", backendManifest?.schema?.fingerprint],
    ["frontend release", frontendManifest?.schema_fingerprint],
    ["frontend deployment", deploymentManifest?.schema_fingerprint],
  ];
  for (const [label, fingerprint] of primaryFingerprints) {
    assert.match(fingerprint || "", FINGERPRINT_PATTERN, `${label} schema fingerprint is invalid`);
  }

  const distinctPrimaryFingerprints = new Set(primaryFingerprints.map(([, fingerprint]) => fingerprint));
  const transitions = [
    ["backend schema_transition", backendManifest?.schema_transition],
    ["frontend release schema_transition", frontendManifest?.schema_transition],
    ["frontend deployment schema_transition", deploymentManifest?.schema_transition],
  ];
  const declaredTransitions = transitions.filter(([, transition]) => transition != null);

  if (distinctPrimaryFingerprints.size === 1 && declaredTransitions.length === 0) {
    return { mode: "exact", fingerprint: primaryFingerprints[0][1], transition: null };
  }

  for (const [label, transition] of declaredTransitions) validateTransition(transition, label, nowMs);
  for (const [, transition] of declaredTransitions.slice(1)) {
    assert.deepEqual(transition, declaredTransitions[0][1], "declared schema_transition contracts differ");
  }

  if (distinctPrimaryFingerprints.size > 1) {
    assert.ok(declaredTransitions.length > 0, "schema fingerprints differ without a transition contract");
    assert.equal(declaredTransitions.length, transitions.length, "schema drift requires the transition contract on every manifest");
  }

  assert.ok(declaredTransitions.length > 0, "schema fingerprints differ without a transition contract");
  const transition = declaredTransitions[0][1];
  const allowedFingerprints = new Set([transition.from_fingerprint, transition.to_fingerprint]);
  assert.equal(allowedFingerprints.size, 2, "schema_transition must name exactly two fingerprints");
  for (const [label, fingerprint] of primaryFingerprints) {
    assert.ok(allowedFingerprints.has(fingerprint), `${label} schema fingerprint is outside the transition`);
  }

  return {
    mode: distinctPrimaryFingerprints.size === 1 ? "declared" : "transition",
    fingerprint: primaryFingerprints[0][1],
    transition,
  };
}
