#!/usr/bin/env node
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import {
  MANAGER_DEVICE_AUTH_V2,
  MANAGER_ENVELOPE_ALGORITHM,
  MANAGER_PROOF_ALGORITHM,
  canonicalManagerRoles,
  managerActionBodyDigest,
  managerAttestationChallengeBodyDigest,
  managerAuthorizedSessionBodyDigest,
  managerDeviceAuthV2CryptoInternals,
  managerEnvelopeAad,
  managerEnvelopeInfo,
  managerInitialBodyDigest,
  managerJwkThumbprint,
  managerProofInput,
  managerRemovalBodyDigest,
  managerSessionEnvelopeAad,
  managerSessionEnvelopeInfo,
  normalizeManagerKeyPair,
  sealManagerAuthorizedSessionResult,
  sealManagerEnrollmentResult,
  verifyManagerProof,
} from "../src/auth/manager-device-auth-v2-crypto.js";
import { deriveManagerAttestationChallenge } from "../src/auth/manager-device-auth-v2-attestation.js";
import { managerDeviceAuthV2ServiceInternals } from "../src/auth/manager-device-auth-v2-service.js";

const FIXTURE_PATH = new URL("../contracts/manager-device-auth-v2-golden.json", import.meta.url);
const FIXED_PROOF_SIGNATURE = "8lyTSVaPaNgk52e_M_TyjqwoRptds_oeCLVYbHQWn0Yx1F5-x4OG-EoQR1kDx6I5yWH19JriGS3V5-YzfYgZQw";

function keyPairFromScalar(scalar) {
  const privateBytes = Buffer.alloc(32);
  privateBytes.writeUInt32BE(scalar, 28);
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.setPrivateKey(privateBytes);
  const point = ecdh.getPublicKey(null, "uncompressed");
  const publicJwk = {
    kty: "EC",
    crv: "P-256",
    x: point.subarray(1, 33).toString("base64url"),
    y: point.subarray(33, 65).toString("base64url"),
  };
  const privateKey = crypto.createPrivateKey({
    key: { ...publicJwk, d: privateBytes.toString("base64url") },
    format: "jwk",
  });
  return { publicJwk, privateKey, privateScalarHex: privateBytes.toString("hex") };
}

function lowS(signature) {
  const bytes = Buffer.from(signature);
  const s = BigInt(`0x${bytes.subarray(32).toString("hex")}`);
  if (s <= managerDeviceAuthV2CryptoInternals.P256_HALF_ORDER) return bytes;
  const canonical = managerDeviceAuthV2CryptoInternals.P256_ORDER - s;
  return Buffer.concat([bytes.subarray(0, 32), Buffer.from(canonical.toString(16).padStart(64, "0"), "hex")]);
}

function buildFixture() {
  const operationId = "10000000-0000-4000-8000-000000000001";
  const credentialId = "10000000-0000-4000-8000-000000000002";
  const managerId = "10000000-0000-4000-8000-000000000003";
  const deviceId = "ops-app-10000000-0000-4000-8000-000000000004";
  const sessionId = "10000000-0000-4000-8000-000000000005";
  const firstChallengeId = "10000000-0000-4000-8000-000000000006";
  const replacementChallengeId = "10000000-0000-4000-8000-000000000007";
  const credentialExpiresAt = "2030-01-02T03:04:05.000Z";
  const resumeExpiresAt = "2030-01-01T03:34:05.000Z";
  const sessionExpiresAt = "2030-01-01T03:19:05.000Z";
  const issuedAt = 1_785_661_200;
  const signing = keyPairFromScalar(1);
  const wrapping = keyPairFromScalar(2);
  const ephemeral = keyPairFromScalar(3);
  const keys = normalizeManagerKeyPair(signing.publicJwk, wrapping.publicJwk);
  const roles = canonicalManagerRoles(["SECURITY_ADMIN", "CUSTODIAL_MANAGER", "OPS_MANAGER", "DIRECTOR"]);
  const testSecret = "manager-v2-public-golden-test-secret-000000000000000000000000";
  const nonce = Buffer.alloc(16, 7).toString("base64url");
  const appleKeyId = Buffer.alloc(32, 0x41).toString("base64url");
  const attestation = {
    android: {
      provider: "play_integrity",
      challenge_id: firstChallengeId,
      app_id: "org.memphiszoo.ops",
      token: "golden-play-integrity-token",
    },
    ios_enroll: {
      provider: "apple_app_attest",
      challenge_id: firstChallengeId,
      app_id: "ABCDE12345.org.memphiszoo.ops",
      key_id: appleKeyId,
      attestation_object: Buffer.from("golden-apple-attestation-object", "utf8").toString("base64url"),
    },
    ios_assertion: {
      provider: "apple_app_attest",
      challenge_id: firstChallengeId,
      app_id: "ABCDE12345.org.memphiszoo.ops",
      key_id: appleKeyId,
      assertion: Buffer.from("golden-apple-assertion", "utf8").toString("base64url"),
      client_data_hash: Buffer.alloc(32, 0x42).toString("base64url"),
    },
  };

  const challengeInput = {
    operationId,
    deviceId,
    deviceLabel: "Operations Manager phone",
    signingKeyId: keys.signingKeyId,
    wrappingKeyId: keys.wrappingKeyId,
  };
  const enrollmentInput = {
    operationId,
    code: "12345678",
    deviceId,
    deviceLabel: "Operations Manager phone",
    requestedAccessLevel: "full_access",
    signingKeyId: keys.signingKeyId,
    wrappingKeyId: keys.wrappingKeyId,
  };
  const challengeDigests = {
    android_enroll: managerAttestationChallengeBodyDigest({ ...challengeInput, purpose: "enroll", platform: "android" }),
    android_recover: managerAttestationChallengeBodyDigest({ ...challengeInput, purpose: "recover", platform: "android" }),
    android_authorized_session: managerAttestationChallengeBodyDigest({ ...challengeInput, purpose: "authorized_session", platform: "android" }),
    ios_enroll: managerAttestationChallengeBodyDigest({ ...challengeInput, purpose: "enroll", platform: "ios" }),
    ios_recover: managerAttestationChallengeBodyDigest({ ...challengeInput, purpose: "recover", platform: "ios" }),
    ios_authorized_session: managerAttestationChallengeBodyDigest({ ...challengeInput, purpose: "authorized_session", platform: "ios" }),
  };
  const enrollmentDigests = {
    android_enroll: managerInitialBodyDigest({ ...enrollmentInput, flow: "enroll", platform: "android", attestation: attestation.android }),
    android_recover: managerInitialBodyDigest({ ...enrollmentInput, flow: "recover", platform: "android", attestation: attestation.android }),
    ios_enroll: managerInitialBodyDigest({ ...enrollmentInput, flow: "enroll", platform: "ios", attestation: attestation.ios_enroll }),
    ios_recover: managerInitialBodyDigest({ ...enrollmentInput, flow: "recover", platform: "ios", attestation: attestation.ios_assertion }),
  };
  const sessionDigests = {
    android: managerAuthorizedSessionBodyDigest({
      operationId, deviceId, requestedAccessLevel: "full_access", platform: "android", attestation: attestation.android,
    }),
    ios: managerAuthorizedSessionBodyDigest({
      operationId, deviceId, requestedAccessLevel: "full_access", platform: "ios", attestation: attestation.ios_assertion,
    }),
  };
  const path = "/manager-device-auth/v2/enrollment-operations";
  const proofInput = managerProofInput({
    method: "POST", path, operationId, issuedAt, nonce, bodySha256: enrollmentDigests.android_enroll,
  });
  const generatedSignature = lowS(crypto.sign("sha256", proofInput, {
    key: signing.privateKey,
    dsaEncoding: "ieee-p1363",
  })).toString("base64url");
  const signature = FIXED_PROOF_SIGNATURE || generatedSignature;
  const proof = { algorithm: MANAGER_PROOF_ALGORITHM, issued_at: issuedAt, nonce, signature };
  verifyManagerProof({
    proof,
    signingPublicKeyJwk: keys.signing,
    path,
    operationId,
    bodySha256: enrollmentDigests.android_enroll,
    nowSeconds: issuedAt,
  });

  const fixedRandom = (size) => Buffer.alloc(size, size);
  const ephemeralKeyPair = {
    privateKey: ephemeral.privateKey,
    publicKey: crypto.createPublicKey({ key: ephemeral.publicJwk, format: "jwk" }),
  };
  const enrollmentEnvelope = sealManagerEnrollmentResult({
    operationId,
    credentialId,
    credentialSecret: "S".repeat(43),
    deviceId,
    managerId,
    credentialExpiresAt,
    resumeExpiresAt,
    wrappingPublicKeyJwk: keys.wrapping,
    randomBytes: fixedRandom,
    ephemeralKeyPair,
  });
  const sessionEnvelope = sealManagerAuthorizedSessionResult({
    operationId,
    sessionId,
    credentialId,
    sessionToken: "ZXhhbXBsZQ.c2lnbmF0dXJl",
    deviceId,
    managerId,
    roles,
    accessLevel: "full_access",
    sessionExpiresAt,
    wrappingPublicKeyJwk: keys.wrapping,
    randomBytes: fixedRandom,
    ephemeralKeyPair,
  });
  const enrollmentAad = managerEnvelopeAad({
    operationId,
    credentialId,
    deviceId,
    managerId,
    credentialExpiresAt,
    resumeExpiresAt,
    wrappingKeyId: enrollmentEnvelope.wrapping_key_id,
    ephemeralKeyId: enrollmentEnvelope.ephemeral_key_id,
    salt: enrollmentEnvelope.salt,
    iv: enrollmentEnvelope.iv,
  });
  const sessionAad = managerSessionEnvelopeAad({
    operationId,
    sessionId,
    credentialId,
    deviceId,
    managerId,
    roles,
    accessLevel: "full_access",
    sessionExpiresAt,
    wrappingKeyId: sessionEnvelope.wrapping_key_id,
    ephemeralKeyId: sessionEnvelope.ephemeral_key_id,
    salt: sessionEnvelope.salt,
    iv: sessionEnvelope.iv,
  });

  const requestFingerprint = crypto.createHash("sha256").update("golden-request-fingerprint", "utf8").digest("hex");
  const challengeBase = {
    operationId,
    purpose: "enroll",
    requestFingerprint,
    deviceId,
    deviceLabel: "Operations Manager phone",
    platform: "android",
    provider: "play_integrity",
    signingKeyId: keys.signingKeyId,
    wrappingKeyId: keys.wrappingKeyId,
    policyVersion: "manager-device-attestation.v1",
  };
  const firstChallenge = {
    ...challengeBase,
    challengeId: firstChallengeId,
    generation: 1,
    proofNonce: nonce,
    createdAt: "2030-01-01T03:00:00.000Z",
    expiresAt: "2030-01-01T03:05:00.000Z",
    supersededAt: "2030-01-01T03:05:01.000Z",
  };
  const replacementChallenge = {
    ...challengeBase,
    challengeId: replacementChallengeId,
    generation: 2,
    proofNonce: Buffer.alloc(16, 8).toString("base64url"),
    createdAt: "2030-01-01T03:05:01.000Z",
    expiresAt: "2030-01-01T03:10:01.000Z",
    supersededAt: null,
  };
  const publicOperation = managerDeviceAuthV2ServiceInternals.publicOperation({
    operationId,
    status: "pending_confirmation",
    credentialId,
    deviceId,
    managerId,
    managerRoles: roles,
    grantedAccessLevel: "full_access",
    credentialExpiresAt,
    resumeExpiresAt,
    resultEnvelope: enrollmentEnvelope,
  });
  const publicSession = managerDeviceAuthV2ServiceInternals.publicSession({
    operationId,
    sessionId,
    credentialId,
    deviceId,
    managerId,
    managerRoles: roles,
    grantedAccessLevel: "full_access",
    expiresAt: sessionExpiresAt,
    resultEnvelope: sessionEnvelope,
  });

  return {
    fixture_version: 1,
    contract_version: MANAGER_DEVICE_AUTH_V2,
    warning: "Public deterministic test material only. Never use these keys or secrets outside tests.",
    identifiers: {
      operation_id: operationId,
      credential_id: credentialId,
      manager_id: managerId,
      device_id: deviceId,
      session_id: sessionId,
      first_challenge_id: firstChallengeId,
      replacement_challenge_id: replacementChallengeId,
    },
    test_only_key_material: {
      signing_private_scalar_hex: signing.privateScalarHex,
      wrapping_private_scalar_hex: wrapping.privateScalarHex,
      ephemeral_private_scalar_hex: ephemeral.privateScalarHex,
      signing_public_key_jwk: keys.signing,
      wrapping_public_key_jwk: keys.wrapping,
      signing_key_id: keys.signingKeyId,
      wrapping_key_id: keys.wrappingKeyId,
    },
    attestation_examples: attestation,
    semantic_body_sha256: {
      attestation_challenges: challengeDigests,
      enrollment_operations: enrollmentDigests,
      actions: {
        resume: managerActionBodyDigest(operationId, "resume"),
        confirm: managerActionBodyDigest(operationId, "confirm"),
        cancel: managerActionBodyDigest(operationId, "cancel"),
      },
      removal: managerRemovalBodyDigest({ operationId, deviceId }),
      authorized_sessions: sessionDigests,
    },
    proof: {
      method: "POST",
      path,
      issued_at: issuedAt,
      nonce,
      body_sha256: enrollmentDigests.android_enroll,
      input_hex: proofInput.toString("hex"),
      input_base64url: proofInput.toString("base64url"),
      value: proof,
    },
    envelope: {
      algorithm: MANAGER_ENVELOPE_ALGORITHM,
      enrollment_hkdf_info_hex: managerEnvelopeInfo(operationId, keys.wrappingKeyId).toString("hex"),
      enrollment_hkdf_info_base64url: managerEnvelopeInfo(operationId, keys.wrappingKeyId).toString("base64url"),
      enrollment_aad_hex: enrollmentAad.toString("hex"),
      enrollment_aad_base64url: enrollmentAad.toString("base64url"),
      session_hkdf_info_hex: managerSessionEnvelopeInfo(operationId, keys.wrappingKeyId).toString("hex"),
      session_hkdf_info_base64url: managerSessionEnvelopeInfo(operationId, keys.wrappingKeyId).toString("base64url"),
      session_aad_hex: sessionAad.toString("hex"),
      session_aad_base64url: sessionAad.toString("base64url"),
      sealed_enrollment_result: enrollmentEnvelope,
      sealed_authorized_session_result: sessionEnvelope,
    },
    exact_public_dtos: {
      pending_enrollment: publicOperation,
      authorized_session: publicSession,
    },
    canonical_roles: roles,
    challenge_expiry_replacement: {
      invariant: "Same operation and request fingerprint; an expired unconsumed generation is superseded exactly once. A consumed generation never rotates.",
      first: {
        record: firstChallenge,
        response: managerDeviceAuthV2ServiceInternals.publicChallenge(firstChallenge, testSecret),
      },
      replacement: {
        record: replacementChallenge,
        response: managerDeviceAuthV2ServiceInternals.publicChallenge(replacementChallenge, testSecret),
      },
    },
  };
}

const actual = `${JSON.stringify(buildFixture(), null, 2)}\n`;
if (process.argv.includes("--check")) {
  assert.equal(readFileSync(FIXTURE_PATH, "utf8"), actual, "manager device-auth v2 golden fixture is stale");
  console.log("manager device-auth v2 golden fixture is current");
} else if (process.argv.includes("--write")) {
  writeFileSync(FIXTURE_PATH, actual, { encoding: "utf8", mode: 0o644 });
  console.log(`wrote ${FIXTURE_PATH}`);
} else {
  process.stdout.write(actual);
}
