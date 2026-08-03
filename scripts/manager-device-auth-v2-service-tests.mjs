#!/usr/bin/env node
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  MANAGER_DEVICE_AUTH_V2,
  MANAGER_PROOF_ALGORITHM,
  managerActionBodyDigest,
  managerAttestationChallengeBodyDigest,
  managerAuthorizedSessionBodyDigest,
  managerDeviceAuthV2CryptoInternals,
  managerEnvelopeAad,
  managerEnvelopeInfo,
  managerInitialBodyDigest,
  managerProofInput,
  managerRemovalBodyDigest,
  normalizeManagerAttestation,
  normalizeManagerKeyPair,
} from "../src/auth/manager-device-auth-v2-crypto.js";
import {
  createManagerDeviceAuthV2Service,
  managerV2CodeVerifier,
  managerV2CredentialVerifier,
  managerV2SessionTokenVerifier,
} from "../src/auth/manager-device-auth-v2-service.js";

const serverSecret = "manager-v2-service-secret-with-more-than-thirty-two-bytes";
const codeSecret = "legacy-manager-code-secret-distinct-from-v2-server-secret";
let nowMillis = Date.parse("2026-08-02T12:00:00.000Z");
const managerId = "30000000-0000-4000-8000-000000000001";
const deviceId = "ops-app-30000000-0000-4000-8000-000000000002";
const codeId = "30000000-0000-4000-8000-000000000003";
const code = "12345678";
const signing = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const wrapping = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const keys = normalizeManagerKeyPair(
  signing.publicKey.export({ format: "jwk" }),
  wrapping.publicKey.export({ format: "jwk" }),
);

assert.equal(
  managerV2CodeVerifier(codeSecret, code),
  crypto.createHmac("sha256", codeSecret).update(`ops-manager-enrollment-code:v1:${code}`).digest("hex"),
);
assert.throws(
  () => managerV2SessionTokenVerifier(serverSecret, `${"A".repeat(15)}.${"B".repeat(15)}`),
  (error) => error?.code === "manager_v2_invalid_ops_session" && error?.status === 401,
);
assert.doesNotThrow(
  () => managerV2SessionTokenVerifier(serverSecret, `${"A".repeat(15)}.${"B".repeat(16)}`),
);
assert.doesNotThrow(
  () => managerV2SessionTokenVerifier(serverSecret, `${"A".repeat(4095)}.${"B".repeat(4096)}`),
);
for (const invalidSession of [
  `${"A".repeat(4096)}.${"B".repeat(4096)}`,
  `${"A".repeat(16)}.${"B".repeat(16)}.extra`,
  `${"A".repeat(16)}.B\n${"C".repeat(15)}`,
]) {
  assert.throws(
    () => managerV2SessionTokenVerifier(serverSecret, invalidSession),
    (error) => error?.code === "manager_v2_invalid_ops_session" && error?.status === 401,
  );
}

function same(left, right) {
  return crypto.timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

class FakeRepository {
  constructor(state = null) {
    this.state = state || {
      codes: new Map(), challenges: new Map(), verifications: new Map(), operations: new Map(),
      cancellations: new Map(), credentials: new Map(), sessions: new Map(), removals: new Map(), nonces: new Map(),
    };
    if (!this.state.cancellations) this.state.cancellations = new Map();
  }

  claim(proof) {
    const key = `${proof.signingKeyId}:${proof.nonce}`;
    const existing = this.state.nonces.get(key);
    if (existing && (existing.operationId !== proof.operationId || existing.requestFingerprint !== proof.requestFingerprint
        || existing.resourceKind !== proof.resourceKind)) {
      throw Object.assign(new Error("manager_v2_nonce_replayed"), { code: "manager_v2_nonce_replayed", status: 409 });
    }
    if (!existing) this.state.nonces.set(key, structuredClone(proof));
  }

  async getChallengeByOperation(operationId) { return structuredClone(this.state.challenges.get(operationId)?.at(-1) || null); }

  async createOrRefreshChallenge({ candidate, proof }) {
    this.claim(proof);
    if (this.state.cancellations.has(candidate.operationId)) {
      throw Object.assign(new Error("cancelled"), { code: "manager_v2_operation_cancelled", status: 409 });
    }
    const versions = this.state.challenges.get(candidate.operationId) || [];
    const previous = versions.at(-1);
    if (previous) {
      if (previous.requestFingerprint !== candidate.requestFingerprint) throw Object.assign(new Error("conflict"), { code: "manager_v2_operation_conflict", status: 409 });
      if (previous.consumedAt || (!previous.supersededAt && previous.policyVersion === candidate.policyVersion
          && Date.parse(previous.expiresAt) > Date.parse(candidate.createdAt))) return structuredClone(previous);
      if (!previous.supersededAt) previous.supersededAt = candidate.createdAt;
    }
    const record = { ...structuredClone(candidate), generation: (previous?.generation || 0) + 1, consumedAt: null, supersededAt: null };
    versions.push(record);
    this.state.challenges.set(candidate.operationId, versions);
    return structuredClone(record);
  }

  async resolveEnrollmentCode({ codeHash, nowMillis }) {
    const record = this.state.codes.get(codeHash);
    return record && !record.used && Date.parse(record.expiresAt) > nowMillis ? structuredClone(record) : null;
  }

  async getAttestationVerification(challengeId, evidenceDigest) {
    return structuredClone(this.state.verifications.get(`${challengeId}:${evidenceDigest}`) || null);
  }

  async recordAttestationVerification(candidate) {
    const key = `${candidate.challengeId}:${candidate.evidenceDigest}`;
    if (!this.state.verifications.has(key)) this.state.verifications.set(key, structuredClone(candidate.result));
    return structuredClone(this.state.verifications.get(key));
  }

  async getRecoveryProofAuthority({ deviceId: requestedDevice, platform }) {
    const credential = [...this.state.credentials.values()].find((item) => (
      item.state === "active" && item.deviceId === requestedDevice && item.platform === platform
    ));
    if (!credential) return null;
    return {
      installationId: credential.installationId,
      keyGenerationId: credential.keyGenerationId,
      signingKeyId: credential.signingKeyId,
      signingPublicKeyJwk: credential.signingPublicKeyJwk,
      wrappingKeyId: credential.wrappingKeyId,
      wrappingPublicKeyJwk: credential.wrappingPublicKeyJwk,
    };
  }

  async getRecoveryInstallation({ managerId: requestedManager, deviceId: requestedDevice, platform }) {
    const credential = [...this.state.credentials.values()].find((item) => (
      item.state === "active" && item.managerId === requestedManager
      && item.deviceId === requestedDevice && item.platform === platform
    ));
    if (!credential) return null;
    return {
      installationId: credential.installationId,
      managerId: credential.managerId,
      deviceId: credential.deviceId,
      platform: credential.platform,
      signingKeyId: credential.signingKeyId,
      wrappingKeyId: credential.wrappingKeyId,
      attestation: {
        provider: credential.attestationProvider,
        appId: credential.attestationAppId,
        policyVersion: credential.attestationPolicyVersion,
        verifiedAt: credential.attestationVerifiedAt,
        assertionCounter: 0,
      },
    };
  }
  async getOperation(operationId) { return structuredClone(this.state.operations.get(operationId) || null); }
  async getCancellation(operationId) { return structuredClone(this.state.cancellations.get(operationId) || null); }

  async createOrReplayEnrollment({ candidate, proof }) {
    this.claim(proof);
    if (this.state.cancellations.has(candidate.operationId)) {
      throw Object.assign(new Error("cancelled"), { code: "manager_v2_operation_cancelled", status: 409 });
    }
    const existing = this.state.operations.get(candidate.operationId);
    if (existing) {
      if (existing.requestFingerprint !== candidate.requestFingerprint) throw Object.assign(new Error("conflict"), { code: "manager_v2_operation_conflict", status: 409 });
      return structuredClone(existing);
    }
    const codeRecord = this.state.codes.get(candidate.codeHash);
    if (!codeRecord || codeRecord.used) throw Object.assign(new Error("invalid"), { code: "manager_v2_invalid_enrollment", status: 401 });
    codeRecord.used = true;
    const challenge = this.state.challenges.get(candidate.operationId)?.at(-1);
    if (!challenge || challenge.consumedAt || challenge.supersededAt) throw Object.assign(new Error("attestation"), { code: "manager_v2_attestation_invalid", status: 401 });
    challenge.consumedAt = candidate.createdAt;
    challenge.consumedEvidenceDigest = candidate.attestationEvidenceDigest;
    const operation = {
      ...structuredClone(candidate),
      status: "pending_confirmation",
      updatedAt: candidate.createdAt,
      confirmedAt: null,
      cancelledAt: null,
      expiredAt: null,
    };
    this.state.operations.set(candidate.operationId, operation);
    this.state.credentials.set(candidate.credentialId, {
      ...structuredClone(candidate), state: "pending", authorityEpoch: 1,
    });
    return structuredClone(operation);
  }

  async recordActionProof(proof) { this.claim(proof); }

  async confirm({ operationId, credentialVerifier, at }) {
    const operation = this.state.operations.get(operationId);
    if (!operation) return null;
    if (operation.status === "confirmed") return structuredClone(operation);
    if (operation.status !== "pending_confirmation" || !same(operation.credentialVerifier, credentialVerifier)) {
      throw Object.assign(new Error("credential"), { code: "manager_v2_credential_mismatch", status: 401 });
    }
    operation.status = "confirmed";
    operation.confirmedAt = at;
    operation.updatedAt = at;
    operation.resultEnvelope = null;
    for (const candidate of this.state.credentials.values()) {
      if (candidate.state === "active" && candidate.deviceId === operation.deviceId) candidate.state = "retired";
    }
    this.state.credentials.get(operation.credentialId).state = "active";
    return structuredClone(operation);
  }

  async cancel({ operationId, at, cancellation, proof }) {
    this.claim(proof);
    const operation = this.state.operations.get(operationId);
    if (!operation) {
      const existing = this.state.cancellations.get(operationId);
      if (existing) return { ...structuredClone(existing), replayed: true };
      const challenge = this.state.challenges.get(operationId)?.at(-1);
      if (!challenge || challenge.challengeId !== cancellation.challengeId
          || challenge.generation !== cancellation.challengeGeneration
          || challenge.requestFingerprint !== cancellation.challengeRequestFingerprint
          || challenge.deviceId !== cancellation.deviceId || challenge.platform !== cancellation.platform
          || challenge.signingKeyId !== cancellation.signingKeyId
          || challenge.wrappingKeyId !== cancellation.wrappingKeyId) {
        throw Object.assign(new Error("conflict"), { code: "manager_v2_operation_conflict", status: 409 });
      }
      const tombstone = {
        ...structuredClone(cancellation), status: "cancelled", cancelledAt: at, updatedAt: at,
        preCreateCancellation: true, replayed: false,
      };
      this.state.cancellations.set(operationId, tombstone);
      return structuredClone(tombstone);
    }
    if (operation.status === "confirmed") {
      throw Object.assign(new Error("confirmed"), { code: "manager_v2_operation_confirmed", status: 409 });
    }
    if (operation.status === "pending_confirmation") {
      operation.status = "cancelled";
      operation.cancelledAt = at;
      operation.updatedAt = at;
      operation.resultEnvelope = null;
      this.state.credentials.get(operation.credentialId).state = "retired";
      operation.replayed = false;
    } else {
      operation.replayed = true;
    }
    return structuredClone(operation);
  }

  async expire({ operationId, at }) {
    const operation = this.state.operations.get(operationId);
    if (operation.status === "pending_confirmation") {
      operation.status = "expired";
      operation.expiredAt = at;
      operation.updatedAt = at;
      operation.resultEnvelope = null;
      this.state.credentials.get(operation.credentialId).state = "retired";
    }
    return structuredClone(operation);
  }

  async authenticateCredential({ credentialId, credentialVerifier, deviceId: requestedDevice }) {
    const credential = this.state.credentials.get(credentialId);
    if (!credential || credential.state !== "active" || credential.deviceId !== requestedDevice
        || !same(credential.credentialVerifier, credentialVerifier)) return null;
    return {
      credentialId,
      installationId: credential.installationId,
      keyGenerationId: credential.keyGenerationId,
      deviceId: credential.deviceId,
      managerId: credential.managerId,
      managerDisplayName: "Golden Manager",
      managerRoles: credential.managerRoles,
      maximumAccessLevel: credential.grantedAccessLevel,
      authorityEpoch: credential.authorityEpoch,
      signingKeyId: credential.signingKeyId,
      signingPublicKeyJwk: credential.signingPublicKeyJwk,
      wrappingKeyId: credential.wrappingKeyId,
      wrappingPublicKeyJwk: credential.wrappingPublicKeyJwk,
      platform: credential.platform,
      attestation: {
        provider: credential.attestationProvider,
        appId: credential.attestationAppId,
        policyVersion: credential.attestationPolicyVersion,
        verifiedAt: credential.attestationVerifiedAt,
        assertionCounter: 0,
      },
    };
  }

  async getSession(operationId) { return structuredClone(this.state.sessions.get(operationId) || null); }
  async createOrReplaySession({ candidate, proof }) {
    this.claim(proof);
    const existing = this.state.sessions.get(candidate.operationId);
    if (existing) return structuredClone(existing);
    const challenge = this.state.challenges.get(candidate.operationId)?.at(-1);
    challenge.consumedAt = candidate.createdAt;
    const record = { ...structuredClone(candidate), revokedAt: null };
    this.state.sessions.set(candidate.operationId, record);
    return structuredClone(record);
  }

  async getRemoval(operationId) { return structuredClone(this.state.removals.get(operationId) || null); }
  async removeCredential({ candidate, proof }) {
    this.claim(proof);
    const credential = this.state.credentials.get(candidate.credentialId);
    if (!credential || credential.state !== "active") throw Object.assign(new Error("credential"), { code: "manager_v2_credential_mismatch", status: 401 });
    credential.state = "retired";
    const result = {
      contract_version: MANAGER_DEVICE_AUTH_V2,
      operation_id: candidate.operationId,
      status: "removed",
      credential_id: candidate.credentialId,
      device_id: candidate.deviceId,
      manager_id: credential.managerId,
      removed_at: candidate.at,
      push_registrations_deactivated: 1,
      notification_jobs_cancelled: 2,
      sessions_revoked: 1,
    };
    this.state.removals.set(candidate.operationId, {
      operationId: candidate.operationId,
      requestFingerprint: candidate.requestFingerprint,
      credentialId: candidate.credentialId,
      credentialVerifier: candidate.credentialVerifier,
      result,
    });
    return structuredClone(result);
  }

  async sweepExpired({ at }) {
    for (const operation of this.state.operations.values()) {
      if (operation.status === "pending_confirmation" && Date.parse(operation.resumeExpiresAt) <= Date.parse(at)) {
        await this.expire({ operationId: operation.operationId, at });
      }
    }
    return {};
  }
}

const repository = new FakeRepository();
repository.state.codes.set(managerV2CodeVerifier(codeSecret, code), {
  codeId,
  managerId,
  managerRoles: ["OPS_MANAGER", "CUSTODIAL_MANAGER", "DIRECTOR", "SECURITY_ADMIN"],
  roleSnapshot: "DIRECTOR",
  expiresAt: new Date(nowMillis + 60 * 60_000).toISOString(),
  used: false,
});
const attestationVerifier = {
  policy: { policyVersion: "manager-device-attestation.v1" },
  async verify({ evidence }) {
    return {
      provider: "play_integrity",
      appId: evidence.app_id,
      maxAccessLevel: "full_access",
      policyVersion: "manager-device-attestation.v1",
      verifiedAt: new Date(nowMillis).toISOString(),
      evidenceDigest: normalizeManagerAttestation(evidence, "android", "enroll").evidenceDigest,
      assertionCounter: null,
    };
  },
};
const serviceOptions = {
  repository,
  attestationVerifier,
  serverSecret,
  enrollmentCodeSecret: codeSecret,
  sessionIssuer({ sessionId, authorityEpoch, credentialId, deviceId: requestedDevice, manager, accessLevel }) {
    assert.equal(authorityEpoch, 1);
    assert.equal(requestedDevice, deviceId);
    assert.deepEqual(manager.roles, ["OPS_MANAGER", "CUSTODIAL_MANAGER", "DIRECTOR", "SECURITY_ADMIN"]);
    return {
      token: `${Buffer.from(JSON.stringify({ sessionId, credentialId, accessLevel })).toString("base64url")}.fixture_signature`,
      expires_at: new Date(nowMillis + 15 * 60_000).toISOString(),
    };
  },
  now: () => nowMillis,
};
let service = createManagerDeviceAuthV2Service(serviceOptions);
let nonceCounter = 0;

function lowS(signature) {
  const s = BigInt(`0x${signature.subarray(32).toString("hex")}`);
  if (s <= managerDeviceAuthV2CryptoInternals.P256_HALF_ORDER) return signature;
  const canonical = managerDeviceAuthV2CryptoInternals.P256_ORDER - s;
  return Buffer.concat([signature.subarray(0, 32), Buffer.from(canonical.toString(16).padStart(64, "0"), "hex")]);
}

function proof(path, operationId, bodySha256, privateKey = signing.privateKey) {
  nonceCounter += 1;
  const bytes = Buffer.alloc(16);
  bytes.writeUInt32BE(nonceCounter, 12);
  const issuedAt = Math.floor(nowMillis / 1000);
  const nonce = bytes.toString("base64url");
  const input = managerProofInput({ method: "POST", path, operationId, issuedAt, nonce, bodySha256 });
  const signature = lowS(crypto.sign("sha256", input, { key: privateKey, dsaEncoding: "ieee-p1363" }));
  return { algorithm: MANAGER_PROOF_ALGORITHM, issued_at: issuedAt, nonce, signature: signature.toString("base64url") };
}

function challengeRequest(operationId, purpose = "enroll", requestKeys = keys, proofPrivateKey = signing.privateKey) {
  const bodyDigest = managerAttestationChallengeBodyDigest({
    operationId,
    purpose,
    deviceId,
    deviceLabel: "Manager phone",
    platform: "android",
    signingKeyId: requestKeys.signingKeyId,
    wrappingKeyId: requestKeys.wrappingKeyId,
  });
  return {
    contract_version: MANAGER_DEVICE_AUTH_V2,
    operation_id: operationId,
    purpose,
    device_id: deviceId,
    device_label: "Manager phone",
    platform: "android",
    signing_public_key_jwk: requestKeys.signing,
    wrapping_public_key_jwk: requestKeys.wrapping,
    proof: proof("/manager-device-auth/v2/attestation-challenges", operationId, bodyDigest, proofPrivateKey),
  };
}

function enrollmentRequest(operationId, challengeId, {
  flow = "enroll",
  enrollmentCode = code,
  requestKeys = keys,
  proofPrivateKey = signing.privateKey,
} = {}) {
  const attestation = {
    provider: "play_integrity",
    challenge_id: challengeId,
    app_id: "org.memphiszoo.ops",
    token: `fixture-integrity-token-${operationId}`,
  };
  const bodyDigest = managerInitialBodyDigest({
    operationId,
    flow,
    code: enrollmentCode,
    deviceId,
    deviceLabel: "Manager phone",
    platform: "android",
    requestedAccessLevel: "full_access",
    signingKeyId: requestKeys.signingKeyId,
    wrappingKeyId: requestKeys.wrappingKeyId,
    attestation,
  });
  return {
    contract_version: MANAGER_DEVICE_AUTH_V2,
    operation_id: operationId,
    flow,
    code: enrollmentCode,
    device_id: deviceId,
    device_label: "Manager phone",
    platform: "android",
    requested_access_level: "full_access",
    signing_public_key_jwk: requestKeys.signing,
    wrapping_public_key_jwk: requestKeys.wrapping,
    attestation,
    proof: proof("/manager-device-auth/v2/enrollment-operations", operationId, bodyDigest, proofPrivateKey),
  };
}

function actionRequest(operationId, action, privateKey = signing.privateKey) {
  return {
    contract_version: MANAGER_DEVICE_AUTH_V2,
    operation_id: operationId,
    action,
    proof: proof(
      `/manager-device-auth/v2/enrollment-operations/${operationId}/${action}`,
      operationId,
      managerActionBodyDigest(operationId, action),
      privateKey,
    ),
  };
}

function decryptEnrollmentResult(result, wrappingPrivateKey) {
  const operationId = result.data.operation_id;
  const envelope = result.data.result_envelope;
  const sharedSecret = crypto.diffieHellman({
    privateKey: wrappingPrivateKey,
    publicKey: crypto.createPublicKey({ key: envelope.ephemeral_public_key_jwk, format: "jwk" }),
  });
  const key = Buffer.from(crypto.hkdfSync(
    "sha256",
    sharedSecret,
    Buffer.from(envelope.salt, "base64url"),
    managerEnvelopeInfo(operationId, envelope.wrapping_key_id),
    32,
  ));
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64url"));
    decipher.setAAD(managerEnvelopeAad({
      operationId,
      credentialId: result.data.credential_id,
      deviceId,
      managerId,
      credentialExpiresAt: result.data.credential_expires_at,
      resumeExpiresAt: result.data.resume_expires_at,
      wrappingKeyId: envelope.wrapping_key_id,
      ephemeralKeyId: envelope.ephemeral_key_id,
      salt: envelope.salt,
      iv: envelope.iv,
    }));
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64url"));
    return JSON.parse(Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, "base64url")),
      decipher.final(),
    ]));
  } finally {
    sharedSecret.fill(0);
    key.fill(0);
  }
}

// Cancellation is authoritative as soon as the durable challenge exists. A
// caller that cannot prove possession of that challenge's pending signing key
// cannot reserve the UUID, while the legitimate caller receives a terminal
// result that remains replayable after a backend restart. A later create must
// fail before consuming the code or creating any credential authority.
const cancelBeforeCreateOperationId = "30000000-0000-4000-8000-000000000008";
const cancelBeforeCreateChallenge = await service.challenge(challengeRequest(cancelBeforeCreateOperationId), {
  idempotencyKey: cancelBeforeCreateOperationId,
  rateKey: "8".repeat(64),
});
const attackerSigning = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
await assert.rejects(
  () => service.cancel(actionRequest(cancelBeforeCreateOperationId, "cancel", attackerSigning.privateKey)),
  (error) => error.code === "manager_v2_invalid_signature" && error.status === 401,
  "a mismatched key must not create a cancellation tombstone",
);
assert.equal(repository.state.cancellations.has(cancelBeforeCreateOperationId), false);
const firstPreCreateCancellation = await service.cancel(actionRequest(cancelBeforeCreateOperationId, "cancel"));
assert.deepEqual(firstPreCreateCancellation, {
  ok: true,
  data: {
    contract_version: MANAGER_DEVICE_AUTH_V2,
    operation_id: cancelBeforeCreateOperationId,
    status: "cancelled",
    device_id: deviceId,
    cancelled_at: new Date(nowMillis).toISOString(),
    result_envelope: null,
    replayed: false,
  },
});
service = createManagerDeviceAuthV2Service({
  ...serviceOptions,
  repository: new FakeRepository(repository.state),
});
const replayedPreCreateCancellation = await service.cancel(actionRequest(cancelBeforeCreateOperationId, "cancel"));
assert.equal(replayedPreCreateCancellation.data.status, "cancelled");
assert.equal(replayedPreCreateCancellation.data.replayed, true);
await assert.rejects(
  () => service.create(
    enrollmentRequest(cancelBeforeCreateOperationId, cancelBeforeCreateChallenge.data.challenge_id),
    { idempotencyKey: cancelBeforeCreateOperationId, rateKey: "8".repeat(64) },
  ),
  (error) => error.code === "manager_v2_operation_cancelled" && error.status === 409,
);
assert.equal(repository.state.codes.get(managerV2CodeVerifier(codeSecret, code)).used, false);
assert.equal(repository.state.operations.has(cancelBeforeCreateOperationId), false);
assert.equal([...repository.state.credentials.values()].some((item) => item.operationId === cancelBeforeCreateOperationId), false);
await assert.rejects(
  () => service.challenge(challengeRequest(cancelBeforeCreateOperationId), {
    idempotencyKey: cancelBeforeCreateOperationId,
    rateKey: "8".repeat(64),
  }),
  (error) => error.code === "manager_v2_operation_cancelled" && error.status === 409,
);

const replacementOperationId = "30000000-0000-4000-8000-000000000010";
const firstChallenge = await service.challenge(challengeRequest(replacementOperationId), {
  idempotencyKey: replacementOperationId,
  rateKey: "1".repeat(64),
});
const exactChallengeReplay = await service.challenge(challengeRequest(replacementOperationId), {
  idempotencyKey: replacementOperationId,
  rateKey: "1".repeat(64),
});
assert.equal(exactChallengeReplay.data.challenge_id, firstChallenge.data.challenge_id);
const changedPolicyIdentity = `manager-device-attestation.v1.${"a".repeat(32)}`;
const changedPolicyVerifier = {
  ...attestationVerifier,
  policy: { ...attestationVerifier.policy, policyFingerprint: changedPolicyIdentity },
  async verify({ evidence }) {
    return {
      ...(await attestationVerifier.verify({ evidence })),
      policyVersion: changedPolicyIdentity,
    };
  },
};
const policyReplacementService = createManagerDeviceAuthV2Service({
  ...serviceOptions,
  attestationVerifier: changedPolicyVerifier,
});
const policyReplacementOperationId = "30000000-0000-4000-8000-000000000011";
const priorPolicyChallenge = await service.challenge(challengeRequest(policyReplacementOperationId), {
  idempotencyKey: policyReplacementOperationId,
  rateKey: "9".repeat(64),
});
const currentPolicyChallenge = await policyReplacementService.challenge(challengeRequest(policyReplacementOperationId), {
  idempotencyKey: policyReplacementOperationId,
  rateKey: "9".repeat(64),
});
assert.notEqual(currentPolicyChallenge.data.challenge_id, priorPolicyChallenge.data.challenge_id);
assert.equal(currentPolicyChallenge.data.policy_version, changedPolicyIdentity);
assert.ok(repository.state.challenges.get(policyReplacementOperationId)[0].supersededAt);
nowMillis += 5 * 60_000 + 1;
const replacement = await service.challenge(challengeRequest(replacementOperationId), {
  idempotencyKey: replacementOperationId,
  rateKey: "1".repeat(64),
});
assert.notEqual(replacement.data.challenge_id, firstChallenge.data.challenge_id);
assert.equal(repository.state.challenges.get(replacementOperationId).length, 2);

const operationId = "30000000-0000-4000-8000-000000000020";
const challenge = await service.challenge(challengeRequest(operationId), {
  idempotencyKey: operationId,
  rateKey: "2".repeat(64),
});
const requestA = enrollmentRequest(operationId, challenge.data.challenge_id);
const requestB = structuredClone(requestA);
requestB.proof = proof("/manager-device-auth/v2/enrollment-operations", operationId,
  managerInitialBodyDigest({
    operationId,
    flow: "enroll",
    code,
    deviceId,
    deviceLabel: "Manager phone",
    platform: "android",
    requestedAccessLevel: "full_access",
    signingKeyId: keys.signingKeyId,
    wrappingKeyId: keys.wrappingKeyId,
    attestation: requestB.attestation,
  }));
const [created, replayed] = await Promise.all([
  service.create(requestA, { idempotencyKey: operationId, rateKey: "2".repeat(64) }),
  service.create(requestB, { idempotencyKey: operationId, rateKey: "2".repeat(64) }),
]);
assert.equal(created.data.credential_id, replayed.data.credential_id);
assert.deepEqual(created.data.result_envelope, replayed.data.result_envelope);
assert.equal(repository.state.operations.size, 1);
assert.equal([...repository.state.credentials.values()].filter((item) => item.state === "pending").length, 1);
assert.equal(JSON.stringify(repository.state.operations).includes(code), false);

const policyReplay = structuredClone(requestA);
policyReplay.proof = proof("/manager-device-auth/v2/enrollment-operations", operationId,
  managerInitialBodyDigest({
    operationId,
    flow: "enroll",
    code,
    deviceId,
    deviceLabel: "Manager phone",
    platform: "android",
    requestedAccessLevel: "full_access",
    signingKeyId: keys.signingKeyId,
    wrappingKeyId: keys.wrappingKeyId,
    attestation: policyReplay.attestation,
  }));
await assert.rejects(
  () => policyReplacementService.create(policyReplay, { idempotencyKey: operationId, rateKey: "2".repeat(64) }),
  (error) => error.code === "manager_v2_attestation_policy_denied" && error.status === 403,
  "a pending operation verified under an old policy must fail closed after a policy change",
);

service = createManagerDeviceAuthV2Service({ ...serviceOptions, repository: new FakeRepository(repository.state) });
const resumed = await service.resume(actionRequest(operationId, "resume"));
assert.deepEqual(resumed.data.result_envelope, created.data.result_envelope);

const envelope = created.data.result_envelope;
const shared = crypto.diffieHellman({
  privateKey: wrapping.privateKey,
  publicKey: crypto.createPublicKey({ key: envelope.ephemeral_public_key_jwk, format: "jwk" }),
});
const aesKey = Buffer.from(crypto.hkdfSync("sha256", shared, Buffer.from(envelope.salt, "base64url"), managerEnvelopeInfo(operationId, envelope.wrapping_key_id), 32));
const decipher = crypto.createDecipheriv("aes-256-gcm", aesKey, Buffer.from(envelope.iv, "base64url"));
decipher.setAAD(managerEnvelopeAad({
  operationId,
  credentialId: created.data.credential_id,
  deviceId,
  managerId,
  credentialExpiresAt: created.data.credential_expires_at,
  resumeExpiresAt: created.data.resume_expires_at,
  wrappingKeyId: envelope.wrapping_key_id,
  ephemeralKeyId: envelope.ephemeral_key_id,
  salt: envelope.salt,
  iv: envelope.iv,
}));
decipher.setAuthTag(Buffer.from(envelope.tag, "base64url"));
const plaintext = JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "base64url")), decipher.final()]));
assert.match(plaintext.device_credential, new RegExp(`^${created.data.credential_id}\\.[A-Za-z0-9_-]{43}$`));
assert.equal(JSON.stringify(created).includes(plaintext.device_credential), false);

const confirmed = await service.confirm(actionRequest(operationId, "confirm"), plaintext.device_credential);
assert.equal(confirmed.data.status, "confirmed");
assert.equal(confirmed.data.result_envelope, null);
const confirmReplay = await service.confirm(actionRequest(operationId, "confirm"), plaintext.device_credential);
assert.equal(confirmReplay.data.status, "confirmed");
assert.equal([...repository.state.credentials.values()].filter((item) => item.state === "active").length, 1);

// Recovery is authorized by the current active transport signing key while the
// request body binds a fresh pending signing/wrapping pair. The new key proves
// possession on create; cancellation preserves the old credential, and only
// confirmation supersedes it. Exercise response-loss restart replay as well.
const recoveryRepository = new FakeRepository(structuredClone(repository.state));
let recoveryService = createManagerDeviceAuthV2Service({ ...serviceOptions, repository: recoveryRepository });
const cancelledRecoveryCode = "23456789";
recoveryRepository.state.codes.set(managerV2CodeVerifier(codeSecret, cancelledRecoveryCode), {
  codeId: "30000000-0000-4000-8000-000000000060",
  managerId,
  managerRoles: ["OPS_MANAGER", "CUSTODIAL_MANAGER", "DIRECTOR", "SECURITY_ADMIN"],
  roleSnapshot: "DIRECTOR",
  expiresAt: new Date(nowMillis + 60 * 60_000).toISOString(),
  used: false,
});
const recoverySigning = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const recoveryWrapping = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const recoveryKeys = normalizeManagerKeyPair(
  recoverySigning.publicKey.export({ format: "jwk" }),
  recoveryWrapping.publicKey.export({ format: "jwk" }),
);
const cancelledRecoveryOperationId = "30000000-0000-4000-8000-000000000061";
await assert.rejects(
  () => recoveryService.challenge(
    challengeRequest(cancelledRecoveryOperationId, "recover", recoveryKeys, recoverySigning.privateKey),
    { idempotencyKey: cancelledRecoveryOperationId, rateKey: "6".repeat(64) },
  ),
  (error) => error.code === "manager_v2_invalid_signature" && error.status === 401,
  "a self-signed fresh key must not authorize recovery",
);
const cancelledRecoveryChallenge = await recoveryService.challenge(
  challengeRequest(cancelledRecoveryOperationId, "recover", recoveryKeys, signing.privateKey),
  { idempotencyKey: cancelledRecoveryOperationId, rateKey: "6".repeat(64) },
);
const cancelledRecovery = await recoveryService.create(enrollmentRequest(
  cancelledRecoveryOperationId,
  cancelledRecoveryChallenge.data.challenge_id,
  {
    flow: "recover",
    enrollmentCode: cancelledRecoveryCode,
    requestKeys: recoveryKeys,
    proofPrivateKey: recoverySigning.privateKey,
  },
), { idempotencyKey: cancelledRecoveryOperationId, rateKey: "6".repeat(64) });
assert.equal([...recoveryRepository.state.credentials.values()].filter((item) => item.state === "active").length, 1,
  "the old credential must remain active before local recovery commit confirmation");
recoveryService = createManagerDeviceAuthV2Service({
  ...serviceOptions,
  repository: new FakeRepository(recoveryRepository.state),
});
assert.deepEqual(
  (await recoveryService.resume(actionRequest(cancelledRecoveryOperationId, "resume", recoverySigning.privateKey))).data.result_envelope,
  cancelledRecovery.data.result_envelope,
  "recovery response loss must replay the same sealed result after restart",
);
await recoveryService.cancel(actionRequest(cancelledRecoveryOperationId, "cancel", recoverySigning.privateKey));
assert.equal([...recoveryRepository.state.credentials.values()].filter((item) => item.state === "active").length, 1,
  "cancelling a failed local recovery commit must preserve old authority");

const confirmedRecoveryCode = "34567890";
recoveryRepository.state.codes.set(managerV2CodeVerifier(codeSecret, confirmedRecoveryCode), {
  codeId: "30000000-0000-4000-8000-000000000070",
  managerId,
  managerRoles: ["OPS_MANAGER", "CUSTODIAL_MANAGER", "DIRECTOR", "SECURITY_ADMIN"],
  roleSnapshot: "DIRECTOR",
  expiresAt: new Date(nowMillis + 60 * 60_000).toISOString(),
  used: false,
});
const confirmedRecoverySigning = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const confirmedRecoveryWrapping = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const confirmedRecoveryKeys = normalizeManagerKeyPair(
  confirmedRecoverySigning.publicKey.export({ format: "jwk" }),
  confirmedRecoveryWrapping.publicKey.export({ format: "jwk" }),
);
const confirmedRecoveryOperationId = "30000000-0000-4000-8000-000000000071";
const confirmedRecoveryChallenge = await recoveryService.challenge(
  challengeRequest(confirmedRecoveryOperationId, "recover", confirmedRecoveryKeys, signing.privateKey),
  { idempotencyKey: confirmedRecoveryOperationId, rateKey: "7".repeat(64) },
);
const pendingConfirmedRecovery = await recoveryService.create(enrollmentRequest(
  confirmedRecoveryOperationId,
  confirmedRecoveryChallenge.data.challenge_id,
  {
    flow: "recover",
    enrollmentCode: confirmedRecoveryCode,
    requestKeys: confirmedRecoveryKeys,
    proofPrivateKey: confirmedRecoverySigning.privateKey,
  },
), { idempotencyKey: confirmedRecoveryOperationId, rateKey: "7".repeat(64) });
const confirmedRecoveryPlaintext = decryptEnrollmentResult(pendingConfirmedRecovery, confirmedRecoveryWrapping.privateKey);
await recoveryService.confirm(
  actionRequest(confirmedRecoveryOperationId, "confirm", confirmedRecoverySigning.privateKey),
  confirmedRecoveryPlaintext.device_credential,
);
assert.equal([...recoveryRepository.state.credentials.values()].filter((item) => item.state === "active").length, 1,
  "recovery confirmation must leave exactly one active credential");
assert.equal(
  [...recoveryRepository.state.credentials.values()].find((item) => item.state === "active").signingKeyId,
  confirmedRecoveryKeys.signingKeyId,
  "the confirmed recovery must promote the fresh transport key generation",
);

const sessionOperationId = "30000000-0000-4000-8000-000000000030";
const sessionChallenge = await service.challenge(challengeRequest(sessionOperationId, "authorized_session"), {
  idempotencyKey: sessionOperationId,
  rateKey: "3".repeat(64),
  deviceCredential: plaintext.device_credential,
});
const sessionAttestation = {
  provider: "play_integrity",
  challenge_id: sessionChallenge.data.challenge_id,
  app_id: "org.memphiszoo.ops",
  token: "fixture-session-integrity-token",
};
const sessionBodyDigest = managerAuthorizedSessionBodyDigest({
  operationId: sessionOperationId,
  deviceId,
  requestedAccessLevel: "full_access",
  platform: "android",
  attestation: sessionAttestation,
});
const sessionRequest = {
  contract_version: MANAGER_DEVICE_AUTH_V2,
  operation_id: sessionOperationId,
  device_id: deviceId,
  requested_access_level: "full_access",
  attestation: sessionAttestation,
  proof: proof("/manager-device-auth/v2/authorized-sessions", sessionOperationId, sessionBodyDigest),
};
const authorized = await service.authorizedSession(sessionRequest, plaintext.device_credential, { idempotencyKey: sessionOperationId });
assert.equal(authorized.data.status, "authorized");
assert.deepEqual(authorized.data.roles, ["OPS_MANAGER", "CUSTODIAL_MANAGER", "DIRECTOR", "SECURITY_ADMIN"]);
assert.equal(Object.hasOwn(authorized.data, "expires_at"), false);
assert.ok(authorized.data.session_expires_at);
const authorizedReplay = await service.authorizedSession({
  ...structuredClone(sessionRequest),
  proof: proof("/manager-device-auth/v2/authorized-sessions", sessionOperationId, sessionBodyDigest),
}, plaintext.device_credential, { idempotencyKey: sessionOperationId });
assert.deepEqual(authorizedReplay, authorized);

const removalOperationId = "30000000-0000-4000-8000-000000000040";
const removalDigest = managerRemovalBodyDigest({ operationId: removalOperationId, deviceId });
const removalRequest = {
  contract_version: MANAGER_DEVICE_AUTH_V2,
  operation_id: removalOperationId,
  device_id: deviceId,
  action: "remove",
  proof: proof("/manager-device-auth/v2/removal-operations", removalOperationId, removalDigest),
};
const removed = await service.remove(removalRequest, plaintext.device_credential, { idempotencyKey: removalOperationId });
assert.equal(removed.data.status, "removed");
const removalReplay = await service.remove(removalRequest, plaintext.device_credential, { idempotencyKey: removalOperationId });
assert.deepEqual(removalReplay, removed, "removal must replay after the credential is revoked");
await assert.rejects(
  () => service.authorizedSession({ ...sessionRequest, operation_id: "30000000-0000-4000-8000-000000000050" }, plaintext.device_credential, { idempotencyKey: "30000000-0000-4000-8000-000000000050" }),
  (error) => error.code === "manager_v2_credential_mismatch" && error.status === 401,
);

shared.fill(0);
aesKey.fill(0);
console.log("manager device-auth v2 service lifecycle and replay tests passed");
