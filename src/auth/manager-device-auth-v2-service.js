import crypto from "node:crypto";
import {
  MANAGER_DEVICE_AUTH_V2,
  isCanonicalManagerOpsSession,
  canonicalManagerRoles,
  managerActionBodyDigest,
  managerAttestationChallengeBodyDigest,
  managerAuthorizedSessionBodyDigest,
  managerInitialBodyDigest,
  managerRemovalBodyDigest,
  normalizeManagerAttestation,
  normalizeManagerKeyPair,
  sealManagerAuthorizedSessionResult,
  sealManagerEnrollmentResult,
  verifyManagerProof,
  managerDeviceAuthV2CryptoInternals,
} from "./manager-device-auth-v2-crypto.js";
import { deriveManagerAttestationChallenge } from "./manager-device-auth-v2-attestation.js";

const PENDING = "pending_confirmation";
const TERMINAL = new Set(["confirmed", "cancelled", "expired"]);
const RETENTION_MILLIS = 90 * 24 * 60 * 60 * 1000;

function failure(code, status = 400, message = code) {
  return Object.assign(new Error(message), { code, status });
}

function exactObject(value, names, code) {
  return managerDeviceAuthV2CryptoInternals.exactObject(value, names, code);
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""), "utf8");
  const b = Buffer.from(String(right || ""), "utf8");
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

function requireServerSecret(value) {
  const secret = Buffer.isBuffer(value) ? Buffer.from(value) : Buffer.from(String(value || ""), "utf8");
  if (secret.length < 32) throw failure("manager_v2_server_secret_required", 503);
  return secret;
}

function keyedFingerprint(serverSecret, domain, digest) {
  return crypto.createHmac("sha256", serverSecret)
    .update(`manager-device-auth-v2:${domain}:`, "utf8")
    .update(String(digest), "utf8")
    .digest("hex");
}

function clampAccess(requested, maximum) {
  const wanted = managerDeviceAuthV2CryptoInternals.accessLevel(requested);
  const ceiling = managerDeviceAuthV2CryptoInternals.accessLevel(maximum, "maximum_access_level");
  return ceiling === "full_access" ? wanted : "read_only";
}

function publicOperation(operation) {
  if (!operation || typeof operation !== "object") throw failure("manager_v2_operation_unavailable", 503);
  const data = {
    contract_version: MANAGER_DEVICE_AUTH_V2,
    operation_id: operation.operationId,
    status: operation.status,
    credential_id: operation.credentialId,
    device_id: operation.deviceId,
    manager_id: operation.managerId,
    roles: canonicalManagerRoles(operation.managerRoles),
    access_level: operation.grantedAccessLevel,
  };
  if (operation.status === PENDING) {
    data.credential_expires_at = operation.credentialExpiresAt;
    data.resume_expires_at = operation.resumeExpiresAt;
    data.result_envelope = structuredClone(operation.resultEnvelope);
  } else {
    data[`${operation.status}_at`] = operation[`${operation.status}At`] || operation.updatedAt;
    data.result_envelope = null;
  }
  return { ok: true, data };
}

function publicChallenge(challenge, serverSecret) {
  return {
    ok: true,
    data: {
      contract_version: MANAGER_DEVICE_AUTH_V2,
      operation_id: challenge.operationId,
      challenge_id: challenge.challengeId,
      provider: challenge.provider,
      challenge: deriveManagerAttestationChallenge(serverSecret, challenge),
      expires_at: challenge.expiresAt,
      policy_version: challenge.policyVersion,
    },
  };
}

function publicSession(session) {
  return {
    ok: true,
    data: {
      contract_version: MANAGER_DEVICE_AUTH_V2,
      operation_id: session.operationId,
      status: "authorized",
      session_id: session.sessionId,
      credential_id: session.credentialId,
      device_id: session.deviceId,
      manager_id: session.managerId,
      roles: canonicalManagerRoles(session.managerRoles),
      access_level: session.grantedAccessLevel,
      session_expires_at: session.expiresAt,
      result_envelope: structuredClone(session.resultEnvelope),
    },
  };
}

function challengeRequest(value) {
  const request = exactObject(value, [
    "contract_version", "operation_id", "purpose", "device_id", "device_label", "platform",
    "signing_public_key_jwk", "wrapping_public_key_jwk", "proof",
  ], "manager_v2_invalid_challenge_request");
  if (request.contract_version !== MANAGER_DEVICE_AUTH_V2) throw failure("manager_v2_contract_version_required", 426);
  managerDeviceAuthV2CryptoInternals.purpose(request.purpose);
  managerDeviceAuthV2CryptoInternals.platform(request.platform);
  return request;
}

function initialRequest(value) {
  const request = exactObject(value, [
    "contract_version", "operation_id", "flow", "code", "device_id", "device_label", "platform",
    "requested_access_level", "signing_public_key_jwk", "wrapping_public_key_jwk", "attestation", "proof",
  ], "manager_v2_invalid_enrollment_request");
  if (request.contract_version !== MANAGER_DEVICE_AUTH_V2) throw failure("manager_v2_contract_version_required", 426);
  return request;
}

function actionRequest(value, action) {
  const request = exactObject(value, ["contract_version", "operation_id", "action", "proof"], `manager_v2_invalid_${action}_request`);
  if (request.contract_version !== MANAGER_DEVICE_AUTH_V2 || request.action !== action) throw failure(`manager_v2_invalid_${action}_request`);
  return request;
}

function removalRequest(value) {
  const request = exactObject(value, ["contract_version", "operation_id", "device_id", "action", "proof"], "manager_v2_invalid_removal_request");
  if (request.contract_version !== MANAGER_DEVICE_AUTH_V2 || request.action !== "remove") throw failure("manager_v2_invalid_removal_request");
  return request;
}

function sessionRequest(value) {
  const request = exactObject(value, [
    "contract_version", "operation_id", "device_id", "requested_access_level", "attestation", "proof",
  ], "manager_v2_invalid_session_request");
  if (request.contract_version !== MANAGER_DEVICE_AUTH_V2) throw failure("manager_v2_contract_version_required", 426);
  return request;
}

function requireRepository(repository) {
  const methods = [
    "getChallengeByOperation", "createOrRefreshChallenge", "resolveEnrollmentCode",
    "getAttestationVerification", "recordAttestationVerification", "getRecoveryProofAuthority", "getRecoveryInstallation",
    "getOperation", "createOrReplayEnrollment", "recordActionProof", "confirm", "cancel", "expire",
    "authenticateCredential", "getSession", "createOrReplaySession", "getRemoval", "removeCredential", "sweepExpired",
  ];
  for (const method of methods) if (typeof repository?.[method] !== "function") throw failure("manager_v2_repository_required", 503);
  return repository;
}

export function managerV2CodeVerifier(serverSecret, code) {
  if (!/^\d{8}$/.test(String(code || ""))) throw failure("manager_v2_invalid_code");
  return crypto.createHmac("sha256", requireServerSecret(serverSecret))
    .update(`ops-manager-enrollment-code:v1:${String(code)}`, "utf8")
    .digest("hex");
}

export function managerV2CredentialVerifier(serverSecret, credentialId, credentialSecret) {
  managerDeviceAuthV2CryptoInternals.canonicalUuid(credentialId, "credential_id");
  if (!/^[A-Za-z0-9_-]{43}$/.test(String(credentialSecret || ""))) throw failure("manager_v2_invalid_device_credential", 401);
  return crypto.createHmac("sha256", requireServerSecret(serverSecret))
    .update(`trusted-device:${String(credentialSecret)}`, "utf8")
    .digest("hex");
}

export function managerV2SessionTokenVerifier(serverSecret, token) {
  const value = String(token || "");
  if (!isCanonicalManagerOpsSession(value)) {
    throw failure("manager_v2_invalid_ops_session", 401);
  }
  return keyedFingerprint(requireServerSecret(serverSecret), "authorized-session-token", value);
}

export function parseManagerV2Credential(value) {
  const raw = String(value || "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.[A-Za-z0-9_-]{43}$/.test(raw)) {
    throw failure("manager_v2_invalid_device_credential", 401);
  }
  return {
    credentialId: managerDeviceAuthV2CryptoInternals.canonicalUuid(raw.slice(0, 36), "credential_id"),
    credentialSecret: raw.slice(37),
  };
}

export function createManagerDeviceAuthV2Service({
  repository,
  attestationVerifier,
  sessionIssuer,
  serverSecret,
  enrollmentCodeSecret = serverSecret,
  now = () => Date.now(),
  randomBytes = crypto.randomBytes,
  randomUuid = crypto.randomUUID,
  credentialTtlMillis = 365 * 24 * 60 * 60 * 1000,
  resumeTtlMillis = 30 * 60 * 1000,
  challengeTtlMillis = 5 * 60 * 1000,
  activeChallengeLimit = 10_000,
} = {}) {
  const store = requireRepository(repository);
  const secretKey = requireServerSecret(serverSecret);
  const codeSecretKey = requireServerSecret(enrollmentCodeSecret);
  if (!attestationVerifier || typeof attestationVerifier.verify !== "function" || !attestationVerifier.policy) {
    throw failure("manager_v2_attestation_unavailable", 503);
  }
  const attestationPolicyIdentity = String(
    attestationVerifier.policy.policyFingerprint || attestationVerifier.policy.policyVersion || "",
  );
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(attestationPolicyIdentity)) {
    throw failure("manager_v2_attestation_unavailable", 503);
  }
  if (typeof sessionIssuer !== "function") throw failure("manager_v2_session_issuer_required", 503);
  if (!Number.isSafeInteger(credentialTtlMillis) || credentialTtlMillis < 86_400_000) throw failure("manager_v2_invalid_credential_ttl");
  if (!Number.isSafeInteger(resumeTtlMillis) || resumeTtlMillis < 60_000 || resumeTtlMillis > 3_600_000) throw failure("manager_v2_invalid_resume_ttl");
  if (!Number.isSafeInteger(challengeTtlMillis) || challengeTtlMillis < 30_000 || challengeTtlMillis > 600_000) throw failure("manager_v2_invalid_challenge_ttl");
  if (!Number.isSafeInteger(activeChallengeLimit) || activeChallengeLimit < 100 || activeChallengeLimit > 100_000) throw failure("manager_v2_invalid_challenge_limit");

  function verifyProof({ request, keys, path, operationId, bodyDigest }) {
    const verified = verifyManagerProof({
      proof: request.proof,
      signingPublicKeyJwk: keys.signing,
      path,
      operationId,
      bodySha256: bodyDigest,
      nowSeconds: Math.floor(now() / 1000),
    });
    if (verified.signingKeyId !== keys.signingKeyId) throw failure("manager_v2_operation_key_mismatch", 409);
    return verified;
  }

  function proofClaim({ verified, operationId, requestFingerprint, resourceKind, current }) {
    return {
      signingKeyId: verified.signingKeyId,
      nonce: verified.nonce,
      operationId,
      requestFingerprint,
      resourceKind,
      createdAt: new Date(current).toISOString(),
      expiresAt: new Date(current + 301_000).toISOString(),
    };
  }

  async function authenticate(deviceCredential, deviceId) {
    const credential = parseManagerV2Credential(deviceCredential);
    const verifier = managerV2CredentialVerifier(secretKey, credential.credentialId, credential.credentialSecret);
    const authority = await store.authenticateCredential({ credentialId: credential.credentialId, credentialVerifier: verifier, deviceId });
    if (!authority) throw failure("manager_v2_credential_mismatch", 401);
    return { credential, verifier, authority };
  }

  async function verifiedAttestation({ challengeRecord, normalized, platform, purpose, storedAttestation = null }) {
    if (challengeRecord.policyVersion !== attestationPolicyIdentity) {
      throw failure("manager_v2_attestation_policy_denied", 403);
    }
    const cached = await store.getAttestationVerification(challengeRecord.challengeId, normalized.evidenceDigest);
    if (cached) {
      if (cached.policyVersion !== attestationPolicyIdentity) throw failure("manager_v2_attestation_policy_denied", 403);
      return cached;
    }
    let result;
    try {
      result = await attestationVerifier.verify({
        platform,
        purpose,
        evidence: normalized.normalized,
        challenge: deriveManagerAttestationChallenge(secretKey, challengeRecord),
        storedAttestation,
      });
    } catch (error) {
      const recovered = await store.getAttestationVerification(challengeRecord.challengeId, normalized.evidenceDigest);
      if (recovered) return recovered;
      throw error;
    }
    if (!safeEqual(result?.evidenceDigest, normalized.evidenceDigest)
        || result?.policyVersion !== attestationPolicyIdentity) throw failure("manager_v2_attestation_invalid", 401);
    const current = now();
    return store.recordAttestationVerification({
      verificationId: randomUuid(),
      challengeId: challengeRecord.challengeId,
      evidenceDigest: normalized.evidenceDigest,
      provider: result.provider,
      appId: result.appId,
      result,
      verifiedAt: result.verifiedAt || new Date(current).toISOString(),
      retainUntil: new Date(current + RETENTION_MILLIS).toISOString(),
    });
  }

  async function challenge(requestValue, { idempotencyKey, rateKey, deviceCredential = "" } = {}) {
    const request = challengeRequest(requestValue);
    const operationId = managerDeviceAuthV2CryptoInternals.canonicalUuid(request.operation_id);
    if (idempotencyKey !== operationId) throw failure("manager_v2_idempotency_conflict", 409);
    if (!/^[a-f0-9]{64}$/.test(String(rateKey || ""))) throw failure("manager_v2_rate_key_required", 503);
    const keys = normalizeManagerKeyPair(request.signing_public_key_jwk, request.wrapping_public_key_jwk);
    const bodyDigest = managerAttestationChallengeBodyDigest({
      operationId,
      purpose: request.purpose,
      deviceId: request.device_id,
      deviceLabel: request.device_label,
      platform: request.platform,
      signingKeyId: keys.signingKeyId,
      wrappingKeyId: keys.wrappingKeyId,
    });
    const requestFingerprint = keyedFingerprint(secretKey, "attestation-challenge", bodyDigest);
    let proofKeys = keys;
    if (request.purpose === "recover") {
      const authority = await store.getRecoveryProofAuthority({
        deviceId: request.device_id,
        platform: request.platform,
        at: new Date(now()).toISOString(),
      });
      if (!authority) throw failure("manager_v2_invalid_enrollment", 401);
      proofKeys = normalizeManagerKeyPair(authority.signingPublicKeyJwk, authority.wrappingPublicKeyJwk);
      if (proofKeys.signingKeyId !== authority.signingKeyId || proofKeys.wrappingKeyId !== authority.wrappingKeyId) {
        throw failure("manager_v2_authority_revoked", 403);
      }
      const currentKeyIds = new Set([proofKeys.signingKeyId, proofKeys.wrappingKeyId]);
      if (currentKeyIds.has(keys.signingKeyId) || currentKeyIds.has(keys.wrappingKeyId)) {
        throw failure("manager_v2_operation_key_mismatch", 409);
      }
    }
    const verified = verifyProof({ request, keys: proofKeys, path: "/manager-device-auth/v2/attestation-challenges", operationId, bodyDigest });
    if (request.purpose === "authorized_session") {
      const { authority } = await authenticate(deviceCredential, request.device_id);
      if (authority.platform !== request.platform || authority.signingKeyId !== keys.signingKeyId
          || authority.wrappingKeyId !== keys.wrappingKeyId) throw failure("manager_v2_credential_mismatch", 401);
    }
    const current = now();
    const challengeRecord = await store.createOrRefreshChallenge({
      candidate: {
        challengeId: randomUuid(),
        operationId,
        purpose: request.purpose,
        requestFingerprint,
        rateKey,
        deviceId: request.device_id,
        deviceLabel: request.device_label,
        platform: request.platform,
        provider: request.platform === "android" ? "play_integrity" : "apple_app_attest",
        signingKeyId: keys.signingKeyId,
        signingPublicKeyJwk: keys.signing,
        wrappingKeyId: keys.wrappingKeyId,
        wrappingPublicKeyJwk: keys.wrapping,
        proofNonce: verified.nonce,
        policyVersion: attestationPolicyIdentity,
        createdAt: new Date(current).toISOString(),
        expiresAt: new Date(current + challengeTtlMillis).toISOString(),
      },
      proof: proofClaim({ verified, operationId, requestFingerprint, resourceKind: "challenge", current }),
      rateKey,
      activeChallengeLimit,
    });
    return publicChallenge(challengeRecord, secretKey);
  }

  async function create(requestValue, { idempotencyKey, rateKey } = {}) {
    const request = initialRequest(requestValue);
    const operationId = managerDeviceAuthV2CryptoInternals.canonicalUuid(request.operation_id);
    if (idempotencyKey !== operationId) throw failure("manager_v2_idempotency_conflict", 409);
    if (!/^[a-f0-9]{64}$/.test(String(rateKey || ""))) throw failure("manager_v2_rate_key_required", 503);
    const keys = normalizeManagerKeyPair(request.signing_public_key_jwk, request.wrapping_public_key_jwk);
    const normalizedAttestation = normalizeManagerAttestation(request.attestation, request.platform, request.flow);
    const bodyDigest = managerInitialBodyDigest({
      operationId,
      flow: request.flow,
      code: request.code,
      deviceId: request.device_id,
      deviceLabel: request.device_label,
      platform: request.platform,
      requestedAccessLevel: request.requested_access_level,
      signingKeyId: keys.signingKeyId,
      wrappingKeyId: keys.wrappingKeyId,
      attestation: request.attestation,
    });
    const requestFingerprint = keyedFingerprint(secretKey, "enrollment-operation", bodyDigest);
    const verified = verifyProof({ request, keys, path: "/manager-device-auth/v2/enrollment-operations", operationId, bodyDigest });
    const existing = await store.getOperation(operationId);
    if (existing) {
      if (!safeEqual(existing.requestFingerprint, requestFingerprint) || existing.deviceId !== request.device_id
          || existing.signingKeyId !== keys.signingKeyId || existing.wrappingKeyId !== keys.wrappingKeyId
          || existing.attestationEvidenceDigest !== normalizedAttestation.evidenceDigest) throw failure("manager_v2_operation_conflict", 409);
      if (existing.attestationPolicyVersion !== attestationPolicyIdentity) {
        throw failure("manager_v2_attestation_policy_denied", 403);
      }
      const current = now();
      await store.recordActionProof(proofClaim({ verified, operationId, requestFingerprint, resourceKind: "enrollment", current }));
      return publicOperation(existing);
    }
    const current = now();
    const challengeRecord = await store.getChallengeByOperation(operationId);
    if (!challengeRecord || challengeRecord.challengeId !== normalizedAttestation.challengeId
        || challengeRecord.purpose !== request.flow || challengeRecord.deviceId !== request.device_id
        || challengeRecord.platform !== request.platform || challengeRecord.signingKeyId !== keys.signingKeyId
        || challengeRecord.wrappingKeyId !== keys.wrappingKeyId || challengeRecord.consumedAt
        || Date.parse(challengeRecord.expiresAt) <= current) throw failure("manager_v2_attestation_invalid", 401);
    const codeHash = managerV2CodeVerifier(codeSecretKey, request.code);
    const codeRecord = await store.resolveEnrollmentCode({ codeHash, nowMillis: current, rateKey });
    if (!codeRecord) throw failure("manager_v2_invalid_enrollment", 401);
    const managerId = managerDeviceAuthV2CryptoInternals.canonicalUuid(codeRecord.managerId, "manager_id");
    let installation = null;
    if (request.flow === "recover") {
      installation = await store.getRecoveryInstallation({
        managerId,
        deviceId: request.device_id,
        platform: request.platform,
        provider: normalizedAttestation.provider,
        appId: normalizedAttestation.normalized.app_id,
        keyId: normalizedAttestation.normalized.key_id || null,
        at: new Date(current).toISOString(),
      });
      if (!installation) throw failure("manager_v2_invalid_enrollment", 401);
    }
    const attestation = await verifiedAttestation({
      challengeRecord,
      normalized: normalizedAttestation,
      platform: request.platform,
      purpose: request.flow,
      storedAttestation: installation?.attestation || null,
    });
    const requestedAccessLevel = managerDeviceAuthV2CryptoInternals.accessLevel(request.requested_access_level);
    const grantedAccessLevel = clampAccess(requestedAccessLevel, attestation.maxAccessLevel);
    const credentialId = randomUuid();
    const credentialSecretBytes = Buffer.from(randomBytes(32));
    if (credentialSecretBytes.length !== 32) throw failure("manager_v2_randomness_failed", 503);
    const credentialSecret = credentialSecretBytes.toString("base64url");
    const credentialExpiresAt = new Date(current + credentialTtlMillis).toISOString();
    const resumeExpiresAt = new Date(current + resumeTtlMillis).toISOString();
    try {
      const resultEnvelope = sealManagerEnrollmentResult({
        operationId,
        credentialId,
        credentialSecret,
        deviceId: request.device_id,
        managerId,
        credentialExpiresAt,
        resumeExpiresAt,
        wrappingPublicKeyJwk: keys.wrapping,
        randomBytes,
      });
      const candidate = {
        operationId,
        flow: request.flow,
        requestFingerprint,
        proofNonce: verified.nonce,
        deviceId: request.device_id,
        deviceLabel: request.device_label,
        platform: request.platform,
        managerId,
        managerRoles: canonicalManagerRoles(codeRecord.managerRoles),
        roleSnapshot: codeRecord.roleSnapshot,
        codeId: codeRecord.codeId,
        codeHash,
        installationId: installation?.installationId || randomUuid(),
        keyGenerationId: randomUuid(),
        credentialId,
        credentialVerifier: managerV2CredentialVerifier(secretKey, credentialId, credentialSecret),
        credentialExpiresAt,
        resumeExpiresAt,
        signingKeyId: keys.signingKeyId,
        signingPublicKeyJwk: keys.signing,
        wrappingKeyId: keys.wrappingKeyId,
        wrappingPublicKeyJwk: keys.wrapping,
        requestedAccessLevel,
        grantedAccessLevel,
        attestationChallengeId: normalizedAttestation.challengeId,
        attestationProvider: attestation.provider,
        attestationAppId: attestation.appId,
        attestationPolicyVersion: attestation.policyVersion,
        attestationEvidenceDigest: normalizedAttestation.evidenceDigest,
        attestationVerifiedAt: attestation.verifiedAt,
        attestationKeyId: attestation.keyId || null,
        attestationPublicKeySpki: attestation.publicKeySpki || null,
        attestationReceipt: attestation.receipt || null,
        attestationAssertionCounter: attestation.assertionCounter || 0,
        attestationValidationCategory: attestation.validationCategory ?? null,
        attestationBundleVersion: attestation.bundleVersion || null,
        resultEnvelope,
        createdAt: new Date(current).toISOString(),
        retainUntil: new Date(current + RETENTION_MILLIS).toISOString(),
      };
      return publicOperation(await store.createOrReplayEnrollment({
        candidate,
        proof: proofClaim({ verified, operationId, requestFingerprint, resourceKind: "enrollment", current }),
      }));
    } finally {
      credentialSecretBytes.fill(0);
    }
  }

  async function loadAndVerifyAction(requestValue, action) {
    const request = actionRequest(requestValue, action);
    const operationId = managerDeviceAuthV2CryptoInternals.canonicalUuid(request.operation_id);
    let operation = await store.getOperation(operationId);
    if (!operation) throw failure("manager_v2_operation_not_found", 404);
    const keys = normalizeManagerKeyPair(operation.signingPublicKeyJwk, operation.wrappingPublicKeyJwk);
    const bodyDigest = managerActionBodyDigest(operationId, action);
    const requestFingerprint = keyedFingerprint(secretKey, `enrollment-${action}`, bodyDigest);
    const verified = verifyProof({ request, keys, path: `/manager-device-auth/v2/enrollment-operations/${operationId}/${action}`, operationId, bodyDigest });
    if (operation.status === PENDING && Date.parse(operation.resumeExpiresAt) <= now()) {
      operation = await store.expire({ operationId, at: new Date(now()).toISOString() });
    }
    const current = now();
    await store.recordActionProof(proofClaim({ verified, operationId, requestFingerprint, resourceKind: action, current }));
    if (TERMINAL.has(operation.status)) return { operation, replayed: true };
    return { operation, replayed: false };
  }

  async function resume(request) {
    const { operation } = await loadAndVerifyAction(request, "resume");
    return publicOperation(await store.getOperation(operation.operationId));
  }

  async function confirm(request, deviceCredential) {
    const { operation } = await loadAndVerifyAction(request, "confirm");
    const credential = parseManagerV2Credential(deviceCredential);
    if (credential.credentialId !== operation.credentialId) throw failure("manager_v2_credential_mismatch", 401);
    const verifier = managerV2CredentialVerifier(secretKey, credential.credentialId, credential.credentialSecret);
    if (operation.credentialVerifier && !safeEqual(verifier, operation.credentialVerifier)) throw failure("manager_v2_credential_mismatch", 401);
    return publicOperation(await store.confirm({ operationId: operation.operationId, credentialVerifier: verifier, at: new Date(now()).toISOString() }));
  }

  async function cancel(request) {
    const { operation, replayed } = await loadAndVerifyAction(request, "cancel");
    if (operation.status === "confirmed") throw failure("manager_v2_operation_confirmed", 409);
    if (replayed) return publicOperation(operation);
    return publicOperation(await store.cancel({ operationId: operation.operationId, at: new Date(now()).toISOString() }));
  }

  async function remove(requestValue, deviceCredential, { idempotencyKey } = {}) {
    const request = removalRequest(requestValue);
    const operationId = managerDeviceAuthV2CryptoInternals.canonicalUuid(request.operation_id);
    if (idempotencyKey !== operationId) throw failure("manager_v2_idempotency_conflict", 409);
    const credential = parseManagerV2Credential(deviceCredential);
    const credentialVerifier = managerV2CredentialVerifier(secretKey, credential.credentialId, credential.credentialSecret);
    const bodyDigest = managerRemovalBodyDigest({ operationId, deviceId: request.device_id, action: request.action });
    const requestFingerprint = keyedFingerprint(secretKey, "removal-operation", bodyDigest);
    const replay = await store.getRemoval(operationId);
    if (replay) {
      if (!safeEqual(replay.requestFingerprint, requestFingerprint) || replay.credentialId !== credential.credentialId
          || !safeEqual(replay.credentialVerifier, credentialVerifier)) throw failure("manager_v2_operation_conflict", 409);
      return { ok: true, data: structuredClone(replay.result) };
    }
    const authority = await store.authenticateCredential({ credentialId: credential.credentialId, credentialVerifier, deviceId: request.device_id });
    if (!authority) throw failure("manager_v2_credential_mismatch", 401);
    const keys = normalizeManagerKeyPair(authority.signingPublicKeyJwk, authority.wrappingPublicKeyJwk);
    const verified = verifyProof({ request, keys, path: "/manager-device-auth/v2/removal-operations", operationId, bodyDigest });
    const current = now();
    const result = await store.removeCredential({
      candidate: {
        operationId,
        requestFingerprint,
        proofNonce: verified.nonce,
        credentialId: credential.credentialId,
        credentialVerifier,
        installationId: authority.installationId,
        deviceId: request.device_id,
        at: new Date(current).toISOString(),
        retainUntil: new Date(current + RETENTION_MILLIS).toISOString(),
      },
      proof: proofClaim({ verified, operationId, requestFingerprint, resourceKind: "removal", current }),
    });
    return { ok: true, data: result };
  }

  async function authorizedSession(requestValue, deviceCredential, { idempotencyKey } = {}) {
    const request = sessionRequest(requestValue);
    const operationId = managerDeviceAuthV2CryptoInternals.canonicalUuid(request.operation_id);
    if (idempotencyKey !== operationId) throw failure("manager_v2_idempotency_conflict", 409);
    const { credential, verifier: credentialVerifier, authority } = await authenticate(deviceCredential, request.device_id);
    const normalizedAttestation = normalizeManagerAttestation(request.attestation, authority.platform, "authorized_session");
    const bodyDigest = managerAuthorizedSessionBodyDigest({
      operationId,
      deviceId: request.device_id,
      requestedAccessLevel: request.requested_access_level,
      platform: authority.platform,
      attestation: request.attestation,
    });
    const requestFingerprint = keyedFingerprint(secretKey, "authorized-session", bodyDigest);
    const keys = normalizeManagerKeyPair(authority.signingPublicKeyJwk, authority.wrappingPublicKeyJwk);
    const verified = verifyProof({ request, keys, path: "/manager-device-auth/v2/authorized-sessions", operationId, bodyDigest });
    const existing = await store.getSession(operationId);
    if (existing) {
      if (!safeEqual(existing.requestFingerprint, requestFingerprint) || existing.credentialId !== credential.credentialId
          || existing.attestationEvidenceDigest !== normalizedAttestation.evidenceDigest
          || existing.authorityEpoch !== authority.authorityEpoch) throw failure("manager_v2_operation_conflict", 409);
      const current = now();
      await store.recordActionProof(proofClaim({ verified, operationId, requestFingerprint, resourceKind: "session", current }));
      return publicSession(existing);
    }
    const current = now();
    const challengeRecord = await store.getChallengeByOperation(operationId);
    if (!challengeRecord || challengeRecord.challengeId !== normalizedAttestation.challengeId
        || challengeRecord.purpose !== "authorized_session" || challengeRecord.deviceId !== request.device_id
        || challengeRecord.platform !== authority.platform || challengeRecord.signingKeyId !== authority.signingKeyId
        || challengeRecord.wrappingKeyId !== authority.wrappingKeyId || challengeRecord.consumedAt
        || Date.parse(challengeRecord.expiresAt) <= current) throw failure("manager_v2_attestation_invalid", 401);
    const attestation = await verifiedAttestation({
      challengeRecord,
      normalized: normalizedAttestation,
      platform: authority.platform,
      purpose: "authorized_session",
      storedAttestation: authority.attestation,
    });
    const requestedAccessLevel = managerDeviceAuthV2CryptoInternals.accessLevel(request.requested_access_level);
    const grantedAccessLevel = clampAccess(clampAccess(requestedAccessLevel, authority.maximumAccessLevel), attestation.maxAccessLevel);
    const roles = canonicalManagerRoles(authority.managerRoles);
    const sessionId = randomUuid();
    const issued = sessionIssuer({
      sessionId,
      authorityEpoch: authority.authorityEpoch,
      credentialId: authority.credentialId,
      deviceId: authority.deviceId,
      manager: { manager_id: authority.managerId, display_name: authority.managerDisplayName, roles },
      authMode: "manager_device_auth_v2",
      accessLevel: grantedAccessLevel,
      maximumAccessLevel: grantedAccessLevel,
      now: new Date(current),
    });
    const resultEnvelope = sealManagerAuthorizedSessionResult({
      operationId,
      sessionId,
      credentialId: authority.credentialId,
      sessionToken: issued.token,
      deviceId: authority.deviceId,
      managerId: authority.managerId,
      roles,
      accessLevel: grantedAccessLevel,
      sessionExpiresAt: issued.expires_at,
      wrappingPublicKeyJwk: authority.wrappingPublicKeyJwk,
      randomBytes,
    });
    const session = await store.createOrReplaySession({
      candidate: {
        operationId,
        sessionId,
        requestFingerprint,
        proofNonce: verified.nonce,
        credentialId: authority.credentialId,
        credentialVerifier,
        installationId: authority.installationId,
        keyGenerationId: authority.keyGenerationId,
        managerId: authority.managerId,
        managerRoles: roles,
        deviceId: authority.deviceId,
        authorityEpoch: authority.authorityEpoch,
        signingKeyId: authority.signingKeyId,
        wrappingKeyId: authority.wrappingKeyId,
        requestedAccessLevel,
        grantedAccessLevel,
        tokenHash: managerV2SessionTokenVerifier(secretKey, issued.token),
        attestationChallengeId: normalizedAttestation.challengeId,
        attestationEvidenceDigest: normalizedAttestation.evidenceDigest,
        attestationProvider: attestation.provider,
        attestationPolicyVersion: attestation.policyVersion,
        attestationKeyId: attestation.keyId,
        assertionCounter: attestation.assertionCounter ?? authority.attestation.assertionCounter,
        attestationValidationCategory: attestation.validationCategory ?? authority.attestation.validationCategory,
        attestationBundleVersion: attestation.bundleVersion || authority.attestation.bundleVersion,
        attestationVerifiedAt: attestation.verifiedAt,
        resultEnvelope,
        createdAt: new Date(current).toISOString(),
        expiresAt: issued.expires_at,
        retainUntil: new Date(current + RETENTION_MILLIS).toISOString(),
      },
      proof: proofClaim({ verified, operationId, requestFingerprint, resourceKind: "session", current }),
    });
    return publicSession(session);
  }

  async function sweepExpired() {
    return store.sweepExpired({ at: new Date(now()).toISOString() });
  }

  return Object.freeze({ challenge, create, resume, confirm, cancel, remove, authorizedSession, sweepExpired });
}

export const managerDeviceAuthV2ServiceInternals = Object.freeze({ keyedFingerprint, safeEqual, publicChallenge, publicOperation, publicSession });
