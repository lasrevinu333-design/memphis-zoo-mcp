#!/usr/bin/env node
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import {
  MANAGER_DEVICE_AUTH_V2,
  canonicalManagerRoles,
  managerDeviceAuthV2CryptoInternals,
  managerEnvelopeAad,
  managerEnvelopeInfo,
  managerInitialBodyDigest,
  managerJwkThumbprint,
  managerProofInput,
  managerSessionEnvelopeAad,
  managerSessionEnvelopeInfo,
  normalizeManagerAttestation,
  normalizeManagerKeyPair,
  normalizeManagerPublicJwk,
  verifyManagerProof,
} from "../src/auth/manager-device-auth-v2-crypto.js";

const fixture = JSON.parse(readFileSync(new URL("../contracts/manager-device-auth-v2-golden.json", import.meta.url), "utf8"));
const ids = fixture.identifiers;
const material = fixture.test_only_key_material;
const keys = normalizeManagerKeyPair(material.signing_public_key_jwk, material.wrapping_public_key_jwk);

assert.equal(fixture.contract_version, MANAGER_DEVICE_AUTH_V2);
assert.equal(managerJwkThumbprint(keys.signing), material.signing_key_id);
assert.equal(managerJwkThumbprint(keys.wrapping), material.wrapping_key_id);
assert.notEqual(keys.signingKeyId, keys.wrappingKeyId);
assert.deepEqual(canonicalManagerRoles(["SECURITY_ADMIN", "CUSTODIAL_MANAGER", "OPS_MANAGER", "DIRECTOR"]), fixture.canonical_roles);
assert.deepEqual(canonicalManagerRoles(["CUSTODIAL_MANAGER"]), ["OPS_MANAGER", "CUSTODIAL_MANAGER"]);
assert.deepEqual(canonicalManagerRoles(["DIRECTOR"]), ["OPS_MANAGER", "DIRECTOR"]);
assert.throws(() => canonicalManagerRoles(["OPS_MANAGER", "OPS_MANAGER"]), /manager_v2_invalid_roles/);
assert.throws(() => normalizeManagerPublicJwk({ ...keys.signing, d: "forbidden" }), /manager_v2_invalid_public_key/);
assert.throws(() => normalizeManagerPublicJwk({ ...keys.signing, x: keys.signing.x.slice(1) }), /manager_v2_invalid_public_key_x/);
assert.throws(() => normalizeManagerKeyPair(keys.signing, keys.signing), /manager_v2_key_role_reuse/);

const proofInput = managerProofInput({
  method: fixture.proof.method,
  path: fixture.proof.path,
  operationId: ids.operation_id,
  issuedAt: fixture.proof.issued_at,
  nonce: fixture.proof.nonce,
  bodySha256: fixture.proof.body_sha256,
});
assert.equal(proofInput.toString("hex"), fixture.proof.input_hex);
assert.equal(proofInput.toString("base64url"), fixture.proof.input_base64url);
assert.deepEqual(verifyManagerProof({
  proof: fixture.proof.value,
  signingPublicKeyJwk: keys.signing,
  path: fixture.proof.path,
  operationId: ids.operation_id,
  bodySha256: fixture.proof.body_sha256,
  nowSeconds: fixture.proof.issued_at,
}), {
  signingKeyId: material.signing_key_id,
  nonce: fixture.proof.nonce,
  issuedAt: fixture.proof.issued_at,
  bodySha256: fixture.proof.body_sha256,
});
assert.throws(() => verifyManagerProof({
  proof: fixture.proof.value,
  signingPublicKeyJwk: keys.signing,
  path: fixture.proof.path,
  operationId: ids.operation_id,
  bodySha256: fixture.proof.body_sha256,
  nowSeconds: fixture.proof.issued_at + 301,
}), /manager_v2_proof_expired/);

for (const path of [
  "/manager-device-auth/v2/../admin-api/session",
  "/manager-device-auth/v2/%2e%2e/admin-api/session",
  "/manager-device-auth/v2/%2Fadmin-api/session",
  "/manager-device-auth/v2//evil.example/path",
  "/manager-device-auth/v2/session#fragment",
  "/manager-device-auth/v2/session?query=true",
  "//manager-device-auth/v2/session",
  "https://example.test/manager-device-auth/v2/session",
]) {
  assert.throws(() => managerProofInput({
    method: "POST",
    path,
    operationId: ids.operation_id,
    issuedAt: fixture.proof.issued_at,
    nonce: fixture.proof.nonce,
    bodySha256: fixture.proof.body_sha256,
  }), /manager_v2_invalid_path/, path);
}

const signature = Buffer.from(fixture.proof.value.signature, "base64url");
const lowS = BigInt(`0x${signature.subarray(32).toString("hex")}`);
const highS = managerDeviceAuthV2CryptoInternals.P256_ORDER - lowS;
const highSignature = Buffer.concat([signature.subarray(0, 32), Buffer.from(highS.toString(16).padStart(64, "0"), "hex")]);
assert.throws(() => verifyManagerProof({
  proof: { ...fixture.proof.value, signature: highSignature.toString("base64url") },
  signingPublicKeyJwk: keys.signing,
  path: fixture.proof.path,
  operationId: ids.operation_id,
  bodySha256: fixture.proof.body_sha256,
  nowSeconds: fixture.proof.issued_at,
}), (error) => error?.code === "manager_v2_invalid_signature" && error?.status === 401);

const androidDigest = managerInitialBodyDigest({
  operationId: ids.operation_id,
  flow: "enroll",
  code: "12345678",
  deviceId: ids.device_id,
  deviceLabel: "Operations Manager phone",
  platform: "android",
  requestedAccessLevel: "full_access",
  signingKeyId: material.signing_key_id,
  wrappingKeyId: material.wrapping_key_id,
  attestation: fixture.attestation_examples.android,
});
assert.equal(androidDigest, fixture.semantic_body_sha256.enrollment_operations.android_enroll);
assert.throws(() => managerInitialBodyDigest({
  operationId: ids.operation_id,
  flow: "enroll",
  code: "12345678",
  deviceId: ids.device_id,
  deviceLabel: "Cafe\u0301 phone",
  platform: "android",
  requestedAccessLevel: "full_access",
  signingKeyId: material.signing_key_id,
  wrappingKeyId: material.wrapping_key_id,
  attestation: fixture.attestation_examples.android,
}), (error) => error?.code === "manager_v2_invalid_device_label" && error?.status === 400);

const standardAppleKeyId = Buffer.from(fixture.attestation_examples.ios_enroll.key_id, "base64url").toString("base64");
const normalizedApple = normalizeManagerAttestation({
  ...fixture.attestation_examples.ios_enroll,
  key_id: standardAppleKeyId,
}, "ios", "enroll");
assert.equal(normalizedApple.normalized.key_id, fixture.attestation_examples.ios_enroll.key_id);
assert.equal(normalizedApple.normalized.key_id.length, 43);
assert.throws(() => normalizeManagerAttestation({
  ...fixture.attestation_examples.ios_enroll,
  key_id: `${standardAppleKeyId}A`,
}, "ios", "enroll"), /manager_v2_invalid_app_attest_key_id/);

function privateKeyFromScalar(hex, publicJwk) {
  return crypto.createPrivateKey({
    key: { ...publicJwk, d: Buffer.from(hex, "hex").toString("base64url") },
    format: "jwk",
  });
}

function decryptEnvelope({ envelope, info, aad }) {
  const privateKey = privateKeyFromScalar(material.wrapping_private_scalar_hex, material.wrapping_public_key_jwk);
  const shared = crypto.diffieHellman({
    privateKey,
    publicKey: crypto.createPublicKey({ key: envelope.ephemeral_public_key_jwk, format: "jwk" }),
  });
  const aesKey = Buffer.from(crypto.hkdfSync("sha256", shared, Buffer.from(envelope.salt, "base64url"), info, 32));
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", aesKey, Buffer.from(envelope.iv, "base64url"), { authTagLength: 16 });
    decipher.setAAD(aad);
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "base64url")), decipher.final()]).toString("utf8");
  } finally {
    shared.fill(0);
    aesKey.fill(0);
  }
}

const enrollment = fixture.envelope.sealed_enrollment_result;
const enrollmentAad = managerEnvelopeAad({
  operationId: ids.operation_id,
  credentialId: ids.credential_id,
  deviceId: ids.device_id,
  managerId: ids.manager_id,
  credentialExpiresAt: "2030-01-02T03:04:05.000Z",
  resumeExpiresAt: "2030-01-01T03:34:05.000Z",
  wrappingKeyId: enrollment.wrapping_key_id,
  ephemeralKeyId: enrollment.ephemeral_key_id,
  salt: enrollment.salt,
  iv: enrollment.iv,
});
assert.equal(enrollmentAad.toString("hex"), fixture.envelope.enrollment_aad_hex);
assert.equal(managerEnvelopeInfo(ids.operation_id, enrollment.wrapping_key_id).toString("hex"), fixture.envelope.enrollment_hkdf_info_hex);
assert.deepEqual(JSON.parse(decryptEnvelope({
  envelope: enrollment,
  info: managerEnvelopeInfo(ids.operation_id, enrollment.wrapping_key_id),
  aad: enrollmentAad,
})), {
  contract_version: MANAGER_DEVICE_AUTH_V2,
  operation_id: ids.operation_id,
  credential_id: ids.credential_id,
  device_credential: `${ids.credential_id}.${"S".repeat(43)}`,
  device_id: ids.device_id,
  manager_id: ids.manager_id,
  credential_expires_at: "2030-01-02T03:04:05.000Z",
});

const session = fixture.envelope.sealed_authorized_session_result;
const sessionAad = managerSessionEnvelopeAad({
  operationId: ids.operation_id,
  sessionId: ids.session_id,
  credentialId: ids.credential_id,
  deviceId: ids.device_id,
  managerId: ids.manager_id,
  roles: fixture.canonical_roles,
  accessLevel: "full_access",
  sessionExpiresAt: "2030-01-01T03:19:05.000Z",
  wrappingKeyId: session.wrapping_key_id,
  ephemeralKeyId: session.ephemeral_key_id,
  salt: session.salt,
  iv: session.iv,
});
assert.equal(sessionAad.toString("hex"), fixture.envelope.session_aad_hex);
assert.equal(managerSessionEnvelopeInfo(ids.operation_id, session.wrapping_key_id).toString("hex"), fixture.envelope.session_hkdf_info_hex);
assert.deepEqual(JSON.parse(decryptEnvelope({
  envelope: session,
  info: managerSessionEnvelopeInfo(ids.operation_id, session.wrapping_key_id),
  aad: sessionAad,
})), {
  contract_version: MANAGER_DEVICE_AUTH_V2,
  operation_id: ids.operation_id,
  session_id: ids.session_id,
  ops_session: "ZXhhbXBsZQ.c2lnbmF0dXJl",
  device_id: ids.device_id,
  manager_id: ids.manager_id,
  roles: fixture.canonical_roles,
  access_level: "full_access",
  expires_at: "2030-01-01T03:19:05.000Z",
});
assert.equal(Object.hasOwn(fixture.exact_public_dtos.authorized_session.data, "expires_at"), false);
assert.equal(fixture.exact_public_dtos.authorized_session.data.session_expires_at, "2030-01-01T03:19:05.000Z");
assert.equal(fixture.challenge_expiry_replacement.first.record.operationId, fixture.challenge_expiry_replacement.replacement.record.operationId);
assert.equal(fixture.challenge_expiry_replacement.first.record.requestFingerprint, fixture.challenge_expiry_replacement.replacement.record.requestFingerprint);
assert.equal(fixture.challenge_expiry_replacement.replacement.record.generation, 2);

console.log("manager device-auth v2 crypto and golden-vector tests passed");
