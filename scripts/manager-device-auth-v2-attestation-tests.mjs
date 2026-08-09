#!/usr/bin/env node
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { createAppleAppAttestVerifier } from "../src/auth/manager-device-auth-v2-apple-app-attest.js";
import {
  createManagerDeviceAttestationVerifier,
  parseManagerAttestationPolicy,
} from "../src/auth/manager-device-auth-v2-attestation.js";
import { normalizeManagerAttestation } from "../src/auth/manager-device-auth-v2-crypto.js";

const official = JSON.parse(readFileSync(new URL("./fixtures/apple-app-attest-official-2026.json", import.meta.url), "utf8"));
const officialPolicy = {
  appId: official.app_id,
  environment: official.environment,
  validationCategories: [official.validation_category],
  bundleVersions: [official.bundle_version],
};
const officialEvidence = { key_id: official.key_id, attestation_object: official.attestation_object };

const policyInput = {
  policy_version: "manager-device-attestation.v1",
  require_strong_integrity: true,
  require_licensed: true,
  maximum_evidence_age_millis: 120_000,
  android_apps: [{
    package_name: "org.memphiszoo.ops",
    certificate_sha256_digests: [Buffer.alloc(32, 2).toString("hex"), Buffer.alloc(32, 1).toString("hex")],
    minimum_version_code: 11,
    allowed_version_codes: [12, 11],
    max_access_level: "full_access",
  }],
  ios_apps: [{
    app_id: "ABCDEFGHIJ.org.memphiszoo.ops",
    environment: "production",
    validation_categories: [4, 2],
    bundle_versions: ["12", "11"],
    max_access_level: "full_access",
  }],
};
const parsedPolicy = parseManagerAttestationPolicy({
  MANAGER_V2_ATTESTATION_POLICY_JSON: JSON.stringify(policyInput),
});
const reorderedPolicy = parseManagerAttestationPolicy({
  MANAGER_V2_ATTESTATION_POLICY_JSON: JSON.stringify({
    ...policyInput,
    android_apps: [{
      ...policyInput.android_apps[0],
      certificate_sha256_digests: [...policyInput.android_apps[0].certificate_sha256_digests].reverse(),
      allowed_version_codes: [...policyInput.android_apps[0].allowed_version_codes].reverse(),
    }],
    ios_apps: [{
      ...policyInput.ios_apps[0],
      validation_categories: [...policyInput.ios_apps[0].validation_categories].reverse(),
      bundle_versions: [...policyInput.ios_apps[0].bundle_versions].reverse(),
    }],
  }),
});
assert.match(parsedPolicy.policyFingerprint, /^manager-device-attestation\.v1\.[a-f0-9]{32}$/);
assert.equal(reorderedPolicy.policyFingerprint, parsedPolicy.policyFingerprint);
assert.notEqual(parseManagerAttestationPolicy({
  MANAGER_V2_ATTESTATION_POLICY_JSON: JSON.stringify({
    ...policyInput,
    android_apps: [{ ...policyInput.android_apps[0], minimum_version_code: 12 }],
  }),
}).policyFingerprint, parsedPolicy.policyFingerprint, "an attestation policy change must invalidate outstanding challenges and cached verdicts");
for (const malformedPolicy of [
  { ...policyInput, require_strong_integrty: true },
  { ...policyInput, maximum_evidence_age_millis: 300_001 },
  { ...policyInput, android_apps: [...policyInput.android_apps, { ...policyInput.android_apps[0] }] },
  { ...policyInput, android_apps: [{ ...policyInput.android_apps[0], minimum_version_code: "11" }] },
  { ...policyInput, android_apps: [{ ...policyInput.android_apps[0], certificate_sha256_digests: ["invalid", ...policyInput.android_apps[0].certificate_sha256_digests] }] },
  { ...policyInput, android_apps: [{ ...policyInput.android_apps[0], allowed_version_codes: [11, 11] }] },
  { ...policyInput, ios_apps: [{ ...policyInput.ios_apps[0], validation_categories: [2, "4"] }] },
  { ...policyInput, ios_apps: [{ ...policyInput.ios_apps[0], max_access_level: "full-access" }] },
]) {
  assert.throws(() => parseManagerAttestationPolicy({
    MANAGER_V2_ATTESTATION_POLICY_JSON: JSON.stringify(malformedPolicy),
  }), /manager_v2_attestation_policy_invalid/, "ambiguous or malformed policy input must fail closed");
}

assert.throws(() => createAppleAppAttestVerifier({
  env: { NODE_ENV: "production" },
  testOnlyAttestationClientDataHash: (challenge) => Buffer.from(challenge),
}), /manager_v2_attestation_policy_invalid/, "production must never accept the official fixture's raw challenge accommodation");

const productionApple = createAppleAppAttestVerifier({
  now: () => Date.parse("2026-04-21T18:13:12.153Z"),
});
assert.throws(() => productionApple.verify({
  purpose: "enroll",
  challenge: official.challenge,
  evidence: officialEvidence,
  policy: officialPolicy,
}), /manager_v2_attestation_invalid/, "production always hashes the server challenge before nonce validation");

const officialFixtureVerifier = createAppleAppAttestVerifier({
  env: { NODE_ENV: "test" },
  now: () => Date.parse("2026-04-21T18:13:12.153Z"),
  testOnlyAttestationClientDataHash: (challenge) => Buffer.from(challenge, "utf8"),
});
const officialResult = officialFixtureVerifier.verify({
  purpose: "enroll",
  challenge: official.challenge,
  evidence: officialEvidence,
  policy: officialPolicy,
});
assert.equal(officialResult.verified, true);
assert.equal(officialResult.appId, official.app_id);
assert.equal(officialResult.environment, "production");
assert.equal(officialResult.keyId, Buffer.from(official.key_id, "base64").toString("base64url"));
assert.equal(officialResult.validationCategory, official.validation_category);
assert.equal(officialResult.bundleVersion, official.bundle_version);
assert.match(officialResult.publicKeySpki, /^[A-Za-z0-9_-]+$/);
assert.ok(officialResult.receipt.length > 1000);
assert.throws(() => officialFixtureVerifier.verify({
  purpose: "enroll",
  challenge: official.challenge,
  evidence: { ...officialEvidence, attestation_object: `${official.attestation_object.slice(0, -1)}A` },
  policy: officialPolicy,
}), /manager_v2_attestation_invalid/);
assert.throws(() => officialFixtureVerifier.verify({
  purpose: "enroll",
  challenge: official.challenge,
  evidence: officialEvidence,
  policy: { ...officialPolicy, appId: "1234567890.com.example.other" },
}), /manager_v2_attestation_invalid/);

function cborHead(major, length) {
  if (length < 24) return Buffer.from([(major << 5) | length]);
  if (length <= 0xff) return Buffer.from([(major << 5) | 24, length]);
  if (length <= 0xffff) {
    const result = Buffer.alloc(3);
    result[0] = (major << 5) | 25;
    result.writeUInt16BE(length, 1);
    return result;
  }
  throw new Error("test CBOR value is too large");
}

function cbor(value) {
  if (Buffer.isBuffer(value)) return Buffer.concat([cborHead(2, value.length), value]);
  if (typeof value === "string") {
    const bytes = Buffer.from(value, "utf8");
    return Buffer.concat([cborHead(3, bytes.length), bytes]);
  }
  if (Number.isSafeInteger(value) && value >= 0) return cborHead(0, value);
  if (Array.isArray(value)) return Buffer.concat([cborHead(4, value.length), ...value.map(cbor)]);
  if (value instanceof Map) {
    const entries = [...value.entries()];
    return Buffer.concat([cborHead(5, entries.length), ...entries.flatMap(([key, item]) => [cbor(key), cbor(item)])]);
  }
  throw new Error("unsupported test CBOR type");
}

const assertionPair = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const assertionChallenge = "apple-assertion-test-challenge";
const assertionClientDataHash = crypto.createHash("sha256").update(assertionChallenge, "utf8").digest();
const assertionKeyId = Buffer.alloc(32, 0x51);
const assertionRpId = "ABCDE12345.org.memphiszoo.ops";
const assertionCounter = 5;
const counterBytes = Buffer.alloc(4);
counterBytes.writeUInt32BE(assertionCounter);
const extensions = cbor(new Map([
  ["apple_bundle_version_01", "11"],
  ["apple_validation_category_01", 2],
]));
const authData = Buffer.concat([
  crypto.createHash("sha256").update(assertionRpId, "utf8").digest(),
  Buffer.from([0]),
  counterBytes,
  extensions,
]);
const assertionSignature = crypto.sign("sha256", Buffer.concat([authData, assertionClientDataHash]), assertionPair.privateKey);
const assertionObject = cbor(new Map([
  ["signature", assertionSignature],
  ["authenticatorData", authData],
]));
const assertionVerifier = createAppleAppAttestVerifier();
const assertionStored = {
  keyId: assertionKeyId.toString("base64url"),
  publicKeySpki: assertionPair.publicKey.export({ format: "der", type: "spki" }).toString("base64url"),
  receipt: "retained-receipt",
  assertionCounter: 4,
};
const assertionEvidence = {
  key_id: assertionKeyId.toString("base64"),
  assertion: assertionObject.toString("base64url"),
  client_data_hash: assertionClientDataHash.toString("base64url"),
};
const assertionResult = assertionVerifier.verify({
  purpose: "recover",
  challenge: assertionChallenge,
  evidence: assertionEvidence,
  storedAttestation: assertionStored,
  policy: {
    appId: assertionRpId,
    environment: "production",
    validationCategories: [2],
    bundleVersions: ["11"],
  },
});
assert.equal(assertionResult.assertionCounter, 5);
assert.equal(assertionResult.previousAssertionCounter, 4);
assert.equal(assertionResult.keyId, assertionKeyId.toString("base64url"));
assert.throws(() => assertionVerifier.verify({
  purpose: "authorized_session",
  challenge: assertionChallenge,
  evidence: assertionEvidence,
  storedAttestation: { ...assertionStored, assertionCounter: 5 },
  policy: { appId: assertionRpId, environment: "production", validationCategories: [2], bundleVersions: ["11"] },
}), /manager_v2_attestation_invalid/, "App Attest counters must advance monotonically");

const nowMillis = Date.parse("2026-08-02T12:00:00.000Z");
const packageName = "org.memphiszoo.ops";
const certificateBytes = Buffer.alloc(32, 0x61);
const certificateDigest = certificateBytes.toString("hex");
let playVersionCode = 11;
let playLicensed = true;
let playRequestHash = "play-challenge";
let playAttestedPackageName = packageName;
const playPolicy = Object.freeze({
  policyVersion: "manager-device-attestation.v1",
  androidApps: Object.freeze([Object.freeze({
    packageName,
    certificateDigests: Object.freeze([certificateDigest]),
    minimumVersionCode: 11,
    allowedVersionCodes: Object.freeze([]),
    maxAccessLevel: "full_access",
  })]),
  iosApps: Object.freeze([]),
  requireStrongIntegrity: true,
  requireLicensed: true,
  maximumEvidenceAgeMillis: 120_000,
});
const playVerifier = createManagerDeviceAttestationVerifier({
  policy: playPolicy,
  now: () => nowMillis,
  googleAccessTokenProvider: async () => "test-only-google-access-token",
  fetchImpl: async (url, options) => {
    assert.equal(url, `https://playintegrity.googleapis.com/v1/${packageName}:decodeIntegrityToken`);
    assert.equal(options.headers.authorization, "Bearer test-only-google-access-token");
    assert.ok(options.signal instanceof AbortSignal, "Play Integrity calls must have a bounded network deadline");
    return {
      ok: true,
      async json() {
        return {
          tokenPayloadExternal: {
            requestDetails: {
              requestPackageName: packageName,
              requestHash: playRequestHash,
              timestampMillis: String(nowMillis),
            },
            appIntegrity: {
              packageName: playAttestedPackageName,
              appRecognitionVerdict: "PLAY_RECOGNIZED",
              certificateSha256Digest: [certificateBytes.toString("base64")],
              versionCode: String(playVersionCode),
            },
            deviceIntegrity: { deviceRecognitionVerdict: ["MEETS_DEVICE_INTEGRITY", "MEETS_STRONG_INTEGRITY"] },
            accountDetails: { appLicensingVerdict: playLicensed ? "LICENSED" : "UNLICENSED" },
          },
        };
      },
    };
  },
});
const playEvidence = { provider: "play_integrity", challenge_id: "40000000-0000-4000-8000-000000000001", app_id: packageName, token: "play-token" };
const playResult = await playVerifier.verify({ platform: "android", purpose: "enroll", evidence: playEvidence, challenge: "play-challenge" });
assert.equal(playResult.maxAccessLevel, "full_access");
assert.equal(playResult.evidenceDigest, normalizeManagerAttestation(playEvidence, "android", "enroll").evidenceDigest);
playVersionCode = 10;
await assert.rejects(
  () => playVerifier.verify({ platform: "android", purpose: "enroll", evidence: playEvidence, challenge: "play-challenge" }),
  (error) => error.code === "manager_v2_attestation_policy_denied" && error.status === 403,
  "a signed but downgraded Android build must fail closed",
);
playVersionCode = 11;
playLicensed = false;
await assert.rejects(
  () => playVerifier.verify({ platform: "android", purpose: "enroll", evidence: playEvidence, challenge: "play-challenge" }),
  (error) => error.code === "manager_v2_attestation_policy_denied" && error.status === 403,
);
playLicensed = true;
playAttestedPackageName = "org.attacker.substitute";
await assert.rejects(
  () => playVerifier.verify({ platform: "android", purpose: "enroll", evidence: playEvidence, challenge: "play-challenge" }),
  (error) => error.code === "manager_v2_attestation_policy_denied" && error.status === 403,
  "the decoded Play app identity must match the request package identity",
);
playAttestedPackageName = packageName;
playRequestHash = "wrong-challenge";
await assert.rejects(
  () => playVerifier.verify({ platform: "android", purpose: "enroll", evidence: playEvidence, challenge: "play-challenge" }),
  (error) => error.code === "manager_v2_attestation_policy_denied" && error.status === 403,
);

console.log("manager device-auth v2 Play Integrity and Apple App Attest tests passed");
