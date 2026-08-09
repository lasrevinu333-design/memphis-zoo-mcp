import crypto from "node:crypto";

export const MANAGER_DEVICE_AUTH_V2 = "manager-device-auth.v2";
export const MANAGER_PROOF_ALGORITHM = "ES256-P1363";
export const MANAGER_ENVELOPE_ALGORITHM = "ECDH-P256-HKDF-SHA256+A256GCM";
export const MANAGER_PROOF_PREFIX = "MEMPHIS-MANAGER-DEVICE-AUTH-PROOF-V2";
export const MANAGER_RESULT_AAD_PREFIX = "MEMPHIS-MANAGER-DEVICE-AUTH-RESULT-AAD-V2";
export const MANAGER_SESSION_AAD_PREFIX = "MEMPHIS-MANAGER-DEVICE-AUTH-SESSION-AAD-V2";
export const MANAGER_OPS_SESSION_MIN_BYTES = 32;
export const MANAGER_OPS_SESSION_MAX_BYTES = 8192;

const P256_ORDER = BigInt("0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551");
const P256_HALF_ORDER = P256_ORDER >> 1n;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DEVICE_PATTERN = /^ops-app-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HEX_64_PATTERN = /^[0-9a-f]{64}$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const OPS_SESSION_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
export const MANAGER_V2_ROLE_ORDER = Object.freeze([
  "OPS_MANAGER",
  "CUSTODIAL_MANAGER",
  "DIRECTOR",
  "SECURITY_ADMIN",
]);

function contractError(code, message = code, status = 400) {
  return Object.assign(new Error(message), { code, status });
}

function exactObject(value, names, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw contractError(code);
  const actual = Object.keys(value).sort();
  const expected = [...names].sort();
  if (actual.length !== expected.length || actual.some((name, index) => name !== expected[index])) {
    throw contractError(code);
  }
  return value;
}

function nfc(value, field, maximum = 512) {
  if (typeof value !== "string") throw contractError(`manager_v2_invalid_${field}`);
  const normalized = value.normalize("NFC");
  if (normalized !== value || Buffer.byteLength(normalized, "utf8") < 1 || Buffer.byteLength(normalized, "utf8") > maximum) {
    throw contractError(`manager_v2_invalid_${field}`);
  }
  if (/\p{Cc}/u.test(normalized)) throw contractError(`manager_v2_invalid_${field}`);
  return normalized;
}

function accessLevel(value, field = "requested_access_level") {
  const normalized = nfc(value, field, 16);
  if (!new Set(["read_only", "full_access"]).has(normalized)) {
    throw contractError(`manager_v2_invalid_${field}`);
  }
  return normalized;
}

function platformValue(value) {
  const normalized = nfc(value, "platform", 7);
  if (!new Set(["android", "ios"]).has(normalized)) throw contractError("manager_v2_invalid_platform");
  return normalized;
}

function purpose(value) {
  const normalized = nfc(value, "purpose", 18);
  if (!new Set(["enroll", "recover", "authorized_session"]).has(normalized)) {
    throw contractError("manager_v2_invalid_purpose");
  }
  return normalized;
}

function canonicalUuid(value, field = "operation_id") {
  const normalized = nfc(value, field, 36);
  if (!UUID_PATTERN.test(normalized)) throw contractError(`manager_v2_invalid_${field}`);
  return normalized;
}

function canonicalDeviceId(value) {
  const normalized = nfc(value, "device_id", 44);
  if (!DEVICE_PATTERN.test(normalized)) throw contractError("manager_v2_invalid_device_id");
  return normalized;
}

function canonicalHex(value, field) {
  const normalized = nfc(value, field, 64);
  if (!HEX_64_PATTERN.test(normalized)) throw contractError(`manager_v2_invalid_${field}`);
  return normalized;
}

function canonicalBase64url(value, bytes, field) {
  const normalized = nfc(value, field, Math.ceil(bytes * 4 / 3) + 2);
  if (!BASE64URL_PATTERN.test(normalized) || normalized.includes("=")) {
    throw contractError(`manager_v2_invalid_${field}`);
  }
  let decoded;
  try {
    decoded = Buffer.from(normalized, "base64url");
  } catch {
    throw contractError(`manager_v2_invalid_${field}`);
  }
  if (decoded.length !== bytes || decoded.toString("base64url") !== normalized) {
    throw contractError(`manager_v2_invalid_${field}`);
  }
  return { encoded: normalized, decoded };
}

function canonicalBinaryBase64(value, field, { bytes = null, maximum = 65_536 } = {}) {
  const raw = nfc(value, field, maximum);
  let decoded;
  if (BASE64URL_PATTERN.test(raw) && !raw.includes("=")) {
    decoded = Buffer.from(raw, "base64url");
    if (!decoded.length || decoded.toString("base64url") !== raw) throw contractError(`manager_v2_invalid_${field}`);
  } else if (/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(raw)) {
    decoded = Buffer.from(raw, "base64");
    if (!decoded.length || decoded.toString("base64") !== raw) throw contractError(`manager_v2_invalid_${field}`);
  } else {
    throw contractError(`manager_v2_invalid_${field}`);
  }
  if (bytes !== null && decoded.length !== bytes) throw contractError(`manager_v2_invalid_${field}`);
  return Object.freeze({ encoded: decoded.toString("base64url"), decoded });
}

export function canonicalManagerRoles(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MANAGER_V2_ROLE_ORDER.length) {
    throw contractError("manager_v2_invalid_roles");
  }
  const supplied = new Set(value.map((role) => nfc(role, "role", 32)));
  if (supplied.size !== value.length || [...supplied].some((role) => !MANAGER_V2_ROLE_ORDER.includes(role))) {
    throw contractError("manager_v2_invalid_roles");
  }
  if (["CUSTODIAL_MANAGER", "DIRECTOR", "SECURITY_ADMIN"].some((role) => supplied.has(role))) {
    supplied.add("OPS_MANAGER");
  }
  return Object.freeze(MANAGER_V2_ROLE_ORDER.filter((role) => supplied.has(role)));
}

function isoInstant(value, field) {
  const normalized = nfc(value, field, 40);
  const parsed = new Date(normalized);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== normalized) {
    throw contractError(`manager_v2_invalid_${field}`);
  }
  return normalized;
}

function unsignedSeconds(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw contractError("manager_v2_invalid_issued_at");
  return String(value);
}

function bigEndianInteger(bytes) {
  return BigInt(`0x${Buffer.from(bytes).toString("hex")}`);
}

export function lp(name, value) {
  const canonicalName = nfc(name, "field_name", 128);
  const canonicalValue = nfc(value, canonicalName, 16_384);
  return Buffer.concat([
    Buffer.from(`${Buffer.byteLength(canonicalName, "utf8")}:${canonicalName}${Buffer.byteLength(canonicalValue, "utf8")}:`, "utf8"),
    Buffer.from(canonicalValue, "utf8"),
  ]);
}

export function encodeFields(fields) {
  if (!Array.isArray(fields) || fields.length < 1) throw contractError("manager_v2_invalid_fields");
  return Buffer.concat(fields.map(([name, value]) => lp(name, value)));
}

export function sha256Hex(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function isCanonicalManagerOpsSession(value) {
  if (typeof value !== "string" || !OPS_SESSION_PATTERN.test(value)) return false;
  const bytes = Buffer.byteLength(value, "utf8");
  return bytes >= MANAGER_OPS_SESSION_MIN_BYTES && bytes <= MANAGER_OPS_SESSION_MAX_BYTES;
}

export function normalizeManagerPublicJwk(value, field = "public_key") {
  const jwk = exactObject(value, ["kty", "crv", "x", "y"], `manager_v2_invalid_${field}`);
  if (jwk.kty !== "EC" || jwk.crv !== "P-256") throw contractError(`manager_v2_invalid_${field}`);
  const x = canonicalBase64url(jwk.x, 32, `${field}_x`).encoded;
  const y = canonicalBase64url(jwk.y, 32, `${field}_y`).encoded;
  const canonical = { kty: "EC", crv: "P-256", x, y };
  try {
    const key = crypto.createPublicKey({ key: canonical, format: "jwk" });
    const exported = key.export({ format: "jwk" });
    if (exported.kty !== "EC" || exported.crv !== "P-256" || exported.x !== x || exported.y !== y) {
      throw new Error("key export mismatch");
    }
  } catch {
    throw contractError(`manager_v2_invalid_${field}`);
  }
  return Object.freeze(canonical);
}

export function managerJwkThumbprint(value) {
  const jwk = normalizeManagerPublicJwk(value);
  const canonicalJson = JSON.stringify({ crv: "P-256", kty: "EC", x: jwk.x, y: jwk.y });
  return crypto.createHash("sha256").update(canonicalJson, "utf8").digest("base64url");
}

export function normalizeManagerKeyPair(signingPublicKeyJwk, wrappingPublicKeyJwk) {
  const signing = normalizeManagerPublicJwk(signingPublicKeyJwk, "signing_public_key");
  const wrapping = normalizeManagerPublicJwk(wrappingPublicKeyJwk, "wrapping_public_key");
  const signingKeyId = managerJwkThumbprint(signing);
  const wrappingKeyId = managerJwkThumbprint(wrapping);
  if (signingKeyId === wrappingKeyId) throw contractError("manager_v2_key_role_reuse");
  return Object.freeze({ signing, wrapping, signingKeyId, wrappingKeyId });
}

export function normalizeManagerAttestation(value, expectedPlatform, expectedPurpose) {
  const normalizedPlatform = platformValue(expectedPlatform);
  const normalizedPurpose = purpose(expectedPurpose);
  if (normalizedPlatform === "android") {
    const evidence = exactObject(value, ["provider", "challenge_id", "app_id", "token"], "manager_v2_invalid_attestation");
    if (evidence.provider !== "play_integrity") throw contractError("manager_v2_invalid_attestation_provider");
    const appId = nfc(evidence.app_id, "attestation_app_id", 200);
    if (!/^[A-Za-z][A-Za-z0-9_.]{2,199}$/.test(appId)) throw contractError("manager_v2_invalid_attestation_app_id");
    const token = nfc(evidence.token, "attestation_token", 32_768);
    return Object.freeze({
      provider: evidence.provider,
      challengeId: canonicalUuid(evidence.challenge_id, "attestation_challenge_id"),
      evidenceDigest: sha256Hex(encodeFields([["app_id", appId], ["token", token]])),
      normalized: Object.freeze({ provider: evidence.provider, challenge_id: evidence.challenge_id, app_id: appId, token }),
    });
  }
  if (normalizedPurpose === "enroll") {
    const evidence = exactObject(value, ["provider", "challenge_id", "app_id", "key_id", "attestation_object"], "manager_v2_invalid_attestation");
    if (evidence.provider !== "apple_app_attest") throw contractError("manager_v2_invalid_attestation_provider");
    const challengeId = canonicalUuid(evidence.challenge_id, "attestation_challenge_id");
    const appId = nfc(evidence.app_id, "attestation_app_id", 240);
    if (!/^[A-Z0-9]{10}\.[A-Za-z0-9.-]{3,220}$/.test(appId)) throw contractError("manager_v2_invalid_attestation_app_id");
    const keyId = canonicalBinaryBase64(evidence.key_id, "app_attest_key_id", { bytes: 32, maximum: 64 }).encoded;
    const attestationObject = canonicalBinaryBase64(evidence.attestation_object, "attestation_object", { maximum: 32_768 }).encoded;
    const normalized = Object.freeze({ provider: evidence.provider, challenge_id: challengeId, app_id: appId, key_id: keyId, attestation_object: attestationObject });
    return Object.freeze({
      provider: evidence.provider,
      challengeId,
      evidenceDigest: sha256Hex(encodeFields([
        ["provider", normalized.provider],
        ["challenge_id", normalized.challenge_id],
        ["app_id", normalized.app_id],
        ["key_id", normalized.key_id],
        ["attestation_object", normalized.attestation_object],
      ])),
      normalized,
    });
  }
  const evidence = exactObject(value, ["provider", "challenge_id", "app_id", "key_id", "assertion", "client_data_hash"], "manager_v2_invalid_attestation");
  if (evidence.provider !== "apple_app_attest") throw contractError("manager_v2_invalid_attestation_provider");
  const challengeId = canonicalUuid(evidence.challenge_id, "attestation_challenge_id");
  const appId = nfc(evidence.app_id, "attestation_app_id", 240);
  if (!/^[A-Z0-9]{10}\.[A-Za-z0-9.-]{3,220}$/.test(appId)) throw contractError("manager_v2_invalid_attestation_app_id");
  const keyId = canonicalBinaryBase64(evidence.key_id, "app_attest_key_id", { bytes: 32, maximum: 64 }).encoded;
  const assertion = canonicalBinaryBase64(evidence.assertion, "app_attest_assertion", { maximum: 32_768 }).encoded;
  const clientDataHash = canonicalBase64url(evidence.client_data_hash, 32, "client_data_hash").encoded;
  const normalized = Object.freeze({
    provider: evidence.provider,
    challenge_id: challengeId,
    app_id: appId,
    key_id: keyId,
    assertion,
    client_data_hash: clientDataHash,
  });
  return Object.freeze({
    provider: evidence.provider,
    challengeId,
    evidenceDigest: sha256Hex(encodeFields([
      ["provider", normalized.provider],
      ["challenge_id", normalized.challenge_id],
      ["app_id", normalized.app_id],
      ["key_id", normalized.key_id],
      ["assertion", normalized.assertion],
      ["client_data_hash", normalized.client_data_hash],
    ])),
    normalized,
  });
}

export function managerAttestationChallengeBodyDigest({
  operationId,
  purpose: requestPurpose,
  deviceId,
  deviceLabel,
  platform: requestPlatform,
  signingKeyId,
  wrappingKeyId,
}) {
  return sha256Hex(encodeFields([
    ["contract_version", MANAGER_DEVICE_AUTH_V2],
    ["operation_id", canonicalUuid(operationId)],
    ["purpose", purpose(requestPurpose)],
    ["device_id", canonicalDeviceId(deviceId)],
    ["device_label", nfc(deviceLabel, "device_label", 160)],
    ["platform", platformValue(requestPlatform)],
    ["signing_key_id", canonicalBase64url(signingKeyId, 32, "signing_key_id").encoded],
    ["wrapping_key_id", canonicalBase64url(wrappingKeyId, 32, "wrapping_key_id").encoded],
  ]));
}

export function managerInitialBodyDigest({
  operationId,
  flow,
  code,
  deviceId,
  deviceLabel,
  platform,
  requestedAccessLevel,
  signingKeyId,
  wrappingKeyId,
  attestation,
}) {
  const normalizedOperationId = canonicalUuid(operationId);
  const normalizedFlow = nfc(flow, "flow", 7);
  if (!new Set(["enroll", "recover"]).has(normalizedFlow)) throw contractError("manager_v2_invalid_flow");
  const normalizedCode = nfc(code, "code", 8);
  if (!/^\d{8}$/.test(normalizedCode)) throw contractError("manager_v2_invalid_code");
  const normalizedLabel = nfc(deviceLabel, "device_label", 160);
  const normalizedPlatform = platformValue(platform);
  const signingId = canonicalBase64url(signingKeyId, 32, "signing_key_id").encoded;
  const wrappingId = canonicalBase64url(wrappingKeyId, 32, "wrapping_key_id").encoded;
  const normalizedAttestation = normalizeManagerAttestation(attestation, normalizedPlatform, normalizedFlow);
  return sha256Hex(encodeFields([
    ["contract_version", MANAGER_DEVICE_AUTH_V2],
    ["operation_id", normalizedOperationId],
    ["flow", normalizedFlow],
    ["code_sha256", sha256Hex(Buffer.from(normalizedCode, "utf8"))],
    ["device_id", canonicalDeviceId(deviceId)],
    ["device_label", normalizedLabel],
    ["platform", normalizedPlatform],
    ["requested_access_level", accessLevel(requestedAccessLevel)],
    ["signing_key_id", signingId],
    ["wrapping_key_id", wrappingId],
    ["attestation_provider", normalizedAttestation.provider],
    ["attestation_challenge_id", normalizedAttestation.challengeId],
    ["attestation_evidence_sha256", normalizedAttestation.evidenceDigest],
  ]));
}

export function managerActionBodyDigest(operationId, action) {
  const normalizedAction = nfc(action, "action", 7);
  if (!new Set(["resume", "confirm", "cancel"]).has(normalizedAction)) {
    throw contractError("manager_v2_invalid_action");
  }
  return sha256Hex(encodeFields([
    ["contract_version", MANAGER_DEVICE_AUTH_V2],
    ["operation_id", canonicalUuid(operationId)],
    ["action", normalizedAction],
  ]));
}

export function managerRemovalBodyDigest({ operationId, deviceId, action = "remove" }) {
  const normalizedAction = nfc(action, "action", 7);
  if (normalizedAction !== "remove") throw contractError("manager_v2_invalid_action");
  return sha256Hex(encodeFields([
    ["contract_version", MANAGER_DEVICE_AUTH_V2],
    ["operation_id", canonicalUuid(operationId)],
    ["device_id", canonicalDeviceId(deviceId)],
    ["action", normalizedAction],
  ]));
}

export function managerAuthorizedSessionBodyDigest({
  operationId,
  deviceId,
  requestedAccessLevel,
  platform: requestPlatform,
  attestation,
}) {
  const normalizedPlatform = platformValue(requestPlatform);
  const normalizedAttestation = normalizeManagerAttestation(attestation, normalizedPlatform, "authorized_session");
  return sha256Hex(encodeFields([
    ["contract_version", MANAGER_DEVICE_AUTH_V2],
    ["operation_id", canonicalUuid(operationId)],
    ["device_id", canonicalDeviceId(deviceId)],
    ["requested_access_level", accessLevel(requestedAccessLevel)],
    ["attestation_provider", normalizedAttestation.provider],
    ["attestation_challenge_id", normalizedAttestation.challengeId],
    ["attestation_evidence_sha256", normalizedAttestation.evidenceDigest],
  ]));
}

export function managerProofInput({ method, path, operationId, issuedAt, nonce, bodySha256 }) {
  const normalizedMethod = nfc(method, "method", 8);
  if (normalizedMethod !== normalizedMethod.toUpperCase() || normalizedMethod !== "POST") {
    throw contractError("manager_v2_invalid_method");
  }
  const normalizedPath = nfc(path, "path", 256);
  const fixedPaths = new Set([
    "/manager-device-auth/v2/attestation-challenges",
    "/manager-device-auth/v2/enrollment-operations",
    "/manager-device-auth/v2/removal-operations",
    "/manager-device-auth/v2/authorized-sessions",
  ]);
  const actionPath = /^\/manager-device-auth\/v2\/enrollment-operations\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/(?:resume|confirm|cancel)$/;
  if (!fixedPaths.has(normalizedPath) && !actionPath.test(normalizedPath)) {
    throw contractError("manager_v2_invalid_path");
  }
  return Buffer.concat([
    Buffer.from(MANAGER_PROOF_PREFIX, "utf8"),
    encodeFields([
      ["method", normalizedMethod],
      ["path", normalizedPath],
      ["operation_id", canonicalUuid(operationId)],
      ["issued_at", unsignedSeconds(issuedAt)],
      ["nonce", canonicalBase64url(nonce, 16, "nonce").encoded],
      ["body_sha256", canonicalHex(bodySha256, "body_sha256")],
    ]),
  ]);
}

export function verifyManagerProof({ proof, signingPublicKeyJwk, method = "POST", path, operationId, bodySha256, nowSeconds }) {
  const value = exactObject(proof, ["algorithm", "issued_at", "nonce", "signature"], "manager_v2_invalid_proof");
  if (value.algorithm !== MANAGER_PROOF_ALGORITHM) throw contractError("manager_v2_invalid_proof_algorithm");
  const current = nowSeconds === undefined ? Math.floor(Date.now() / 1000) : nowSeconds;
  if (!Number.isSafeInteger(current) || current < 0 || !Number.isSafeInteger(value.issued_at) || Math.abs(current - value.issued_at) > 300) {
    throw contractError("manager_v2_proof_expired", undefined, 401);
  }
  const signature = canonicalBase64url(value.signature, 64, "signature").decoded;
  const r = bigEndianInteger(signature.subarray(0, 32));
  const s = bigEndianInteger(signature.subarray(32));
  if (r < 1n || r >= P256_ORDER || s < 1n || s > P256_HALF_ORDER) {
    throw contractError("manager_v2_invalid_signature", undefined, 401);
  }
  const jwk = normalizeManagerPublicJwk(signingPublicKeyJwk, "signing_public_key");
  const input = managerProofInput({ method, path, operationId, issuedAt: value.issued_at, nonce: value.nonce, bodySha256 });
  const publicKey = crypto.createPublicKey({ key: jwk, format: "jwk" });
  if (!crypto.verify("sha256", input, { key: publicKey, dsaEncoding: "ieee-p1363" }, signature)) {
    throw contractError("manager_v2_invalid_signature", undefined, 401);
  }
  return Object.freeze({
    signingKeyId: managerJwkThumbprint(jwk),
    nonce: value.nonce,
    issuedAt: value.issued_at,
    bodySha256: canonicalHex(bodySha256, "body_sha256"),
  });
}

export function managerEnvelopeInfo(operationId, wrappingKeyId) {
  return encodeFields([
    ["contract_version", MANAGER_DEVICE_AUTH_V2],
    ["operation_id", canonicalUuid(operationId)],
    ["wrapping_key_id", canonicalBase64url(wrappingKeyId, 32, "wrapping_key_id").encoded],
  ]);
}

export function managerSessionEnvelopeInfo(operationId, wrappingKeyId) {
  return encodeFields([
    ["contract_version", MANAGER_DEVICE_AUTH_V2],
    ["purpose", "authorized_session"],
    ["operation_id", canonicalUuid(operationId)],
    ["wrapping_key_id", canonicalBase64url(wrappingKeyId, 32, "wrapping_key_id").encoded],
  ]);
}

export function managerEnvelopeAad({
  operationId,
  credentialId,
  deviceId,
  managerId,
  credentialExpiresAt,
  resumeExpiresAt,
  wrappingKeyId,
  ephemeralKeyId,
  salt,
  iv,
}) {
  return Buffer.concat([
    Buffer.from(MANAGER_RESULT_AAD_PREFIX, "utf8"),
    encodeFields([
      ["operation_id", canonicalUuid(operationId)],
      ["credential_id", canonicalUuid(credentialId, "credential_id")],
      ["device_id", canonicalDeviceId(deviceId)],
      ["manager_id", canonicalUuid(managerId, "manager_id")],
      ["credential_expires_at", isoInstant(credentialExpiresAt, "credential_expires_at")],
      ["resume_expires_at", isoInstant(resumeExpiresAt, "resume_expires_at")],
      ["wrapping_key_id", canonicalBase64url(wrappingKeyId, 32, "wrapping_key_id").encoded],
      ["ephemeral_key_id", canonicalBase64url(ephemeralKeyId, 32, "ephemeral_key_id").encoded],
      ["salt", canonicalBase64url(salt, 32, "salt").encoded],
      ["iv", canonicalBase64url(iv, 12, "iv").encoded],
    ]),
  ]);
}

export function managerSessionEnvelopeAad({
  operationId,
  sessionId,
  credentialId,
  deviceId,
  managerId,
  roles,
  accessLevel: grantedAccessLevel,
  sessionExpiresAt,
  wrappingKeyId,
  ephemeralKeyId,
  salt,
  iv,
}) {
  return Buffer.concat([
    Buffer.from(MANAGER_SESSION_AAD_PREFIX, "utf8"),
    encodeFields([
      ["operation_id", canonicalUuid(operationId)],
      ["session_id", canonicalUuid(sessionId, "session_id")],
      ["credential_id", canonicalUuid(credentialId, "credential_id")],
      ["device_id", canonicalDeviceId(deviceId)],
      ["manager_id", canonicalUuid(managerId, "manager_id")],
      ["roles", canonicalManagerRoles(roles).join(",")],
      ["access_level", accessLevel(grantedAccessLevel, "access_level")],
      ["session_expires_at", isoInstant(sessionExpiresAt, "session_expires_at")],
      ["wrapping_key_id", canonicalBase64url(wrappingKeyId, 32, "wrapping_key_id").encoded],
      ["ephemeral_key_id", canonicalBase64url(ephemeralKeyId, 32, "ephemeral_key_id").encoded],
      ["salt", canonicalBase64url(salt, 32, "salt").encoded],
      ["iv", canonicalBase64url(iv, 12, "iv").encoded],
    ]),
  ]);
}

function sealToManagerWrappingKey({
  wrappingPublicKeyJwk,
  operationId,
  info,
  aadBuilder,
  plaintextValue,
  randomBytes = crypto.randomBytes,
  ephemeralKeyPair = null,
}) {
  const wrapping = normalizeManagerPublicJwk(wrappingPublicKeyJwk, "wrapping_public_key");
  const wrappingKeyId = managerJwkThumbprint(wrapping);
  const pair = ephemeralKeyPair || crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  if (!pair.privateKey || !pair.publicKey) throw contractError("manager_v2_envelope_key_generation_failed");
  const ephemeralJwk = normalizeManagerPublicJwk(pair.publicKey.export({ format: "jwk" }), "ephemeral_public_key");
  const ephemeralKeyId = managerJwkThumbprint(ephemeralJwk);
  const saltBytes = Buffer.from(randomBytes(32));
  const ivBytes = Buffer.from(randomBytes(12));
  if (saltBytes.length !== 32 || ivBytes.length !== 12) throw contractError("manager_v2_envelope_randomness_failed");
  const salt = saltBytes.toString("base64url");
  const iv = ivBytes.toString("base64url");
  const sharedSecret = crypto.diffieHellman({
    privateKey: pair.privateKey,
    publicKey: crypto.createPublicKey({ key: wrapping, format: "jwk" }),
  });
  const aesKey = Buffer.from(crypto.hkdfSync("sha256", sharedSecret, saltBytes, info(wrappingKeyId), 32));
  const aad = aadBuilder({ wrappingKeyId, ephemeralKeyId, salt, iv });
  const plaintext = Buffer.from(JSON.stringify(plaintextValue), "utf8");
  try {
    const cipher = crypto.createCipheriv("aes-256-gcm", aesKey, ivBytes, { authTagLength: 16 });
    cipher.setAAD(aad);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return Object.freeze({
      algorithm: MANAGER_ENVELOPE_ALGORITHM,
      ephemeral_public_key_jwk: ephemeralJwk,
      ephemeral_key_id: ephemeralKeyId,
      wrapping_key_id: wrappingKeyId,
      salt,
      iv,
      ciphertext: ciphertext.toString("base64url"),
      tag: cipher.getAuthTag().toString("base64url"),
    });
  } finally {
    sharedSecret.fill(0);
    aesKey.fill(0);
    plaintext.fill(0);
  }
}

export function sealManagerEnrollmentResult({
  operationId,
  credentialId,
  credentialSecret,
  deviceId,
  managerId,
  credentialExpiresAt,
  resumeExpiresAt,
  wrappingPublicKeyJwk,
  randomBytes = crypto.randomBytes,
  ephemeralKeyPair = null,
}) {
  const wrapping = normalizeManagerPublicJwk(wrappingPublicKeyJwk, "wrapping_public_key");
  const wrappingKeyId = managerJwkThumbprint(wrapping);
  const secret = nfc(credentialSecret, "credential_secret", 512);
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(secret)) throw contractError("manager_v2_invalid_credential_secret");
  const normalizedOperation = canonicalUuid(operationId);
  const normalizedCredential = canonicalUuid(credentialId, "credential_id");
  const normalizedDevice = canonicalDeviceId(deviceId);
  const normalizedManager = canonicalUuid(managerId, "manager_id");
  const normalizedCredentialExpiry = isoInstant(credentialExpiresAt, "credential_expires_at");
  const normalizedResumeExpiry = isoInstant(resumeExpiresAt, "resume_expires_at");
  const pair = ephemeralKeyPair || crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  if (!pair.privateKey || !pair.publicKey) throw contractError("manager_v2_envelope_key_generation_failed");
  const ephemeralJwk = normalizeManagerPublicJwk(pair.publicKey.export({ format: "jwk" }), "ephemeral_public_key");
  const ephemeralKeyId = managerJwkThumbprint(ephemeralJwk);
  const saltBytes = Buffer.from(randomBytes(32));
  const ivBytes = Buffer.from(randomBytes(12));
  if (saltBytes.length !== 32 || ivBytes.length !== 12) throw contractError("manager_v2_envelope_randomness_failed");
  const salt = saltBytes.toString("base64url");
  const iv = ivBytes.toString("base64url");
  const sharedSecret = crypto.diffieHellman({
    privateKey: pair.privateKey,
    publicKey: crypto.createPublicKey({ key: wrapping, format: "jwk" }),
  });
  const aesKey = Buffer.from(crypto.hkdfSync("sha256", sharedSecret, saltBytes, managerEnvelopeInfo(normalizedOperation, wrappingKeyId), 32));
  const aad = managerEnvelopeAad({
    operationId: normalizedOperation,
    credentialId: normalizedCredential,
    deviceId: normalizedDevice,
    managerId: normalizedManager,
    credentialExpiresAt: normalizedCredentialExpiry,
    resumeExpiresAt: normalizedResumeExpiry,
    wrappingKeyId,
    ephemeralKeyId,
    salt,
    iv,
  });
  const plaintext = Buffer.from(JSON.stringify({
    contract_version: MANAGER_DEVICE_AUTH_V2,
    operation_id: normalizedOperation,
    credential_id: normalizedCredential,
    device_credential: `${normalizedCredential}.${secret}`,
    device_id: normalizedDevice,
    manager_id: normalizedManager,
    credential_expires_at: normalizedCredentialExpiry,
  }), "utf8");
  try {
    const cipher = crypto.createCipheriv("aes-256-gcm", aesKey, ivBytes, { authTagLength: 16 });
    cipher.setAAD(aad);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Object.freeze({
      algorithm: MANAGER_ENVELOPE_ALGORITHM,
      ephemeral_public_key_jwk: ephemeralJwk,
      ephemeral_key_id: ephemeralKeyId,
      wrapping_key_id: wrappingKeyId,
      salt,
      iv,
      ciphertext: ciphertext.toString("base64url"),
      tag: tag.toString("base64url"),
    });
  } finally {
    sharedSecret.fill(0);
    aesKey.fill(0);
    plaintext.fill(0);
  }
}

export function sealManagerAuthorizedSessionResult({
  operationId,
  sessionId,
  credentialId,
  sessionToken,
  deviceId,
  managerId,
  roles,
  accessLevel: grantedAccessLevel,
  sessionExpiresAt,
  wrappingPublicKeyJwk,
  randomBytes = crypto.randomBytes,
  ephemeralKeyPair = null,
}) {
  const normalizedOperation = canonicalUuid(operationId);
  const normalizedSession = canonicalUuid(sessionId, "session_id");
  const normalizedCredential = canonicalUuid(credentialId, "credential_id");
  const normalizedDevice = canonicalDeviceId(deviceId);
  const normalizedManager = canonicalUuid(managerId, "manager_id");
  const normalizedRoles = canonicalManagerRoles(roles);
  const normalizedAccess = accessLevel(grantedAccessLevel, "access_level");
  const normalizedExpiry = isoInstant(sessionExpiresAt, "session_expires_at");
  const token = nfc(sessionToken, "ops_session", MANAGER_OPS_SESSION_MAX_BYTES);
  if (!isCanonicalManagerOpsSession(token)) {
    throw contractError("manager_v2_invalid_ops_session");
  }
  return sealToManagerWrappingKey({
    wrappingPublicKeyJwk,
    operationId: normalizedOperation,
    info: (wrappingKeyId) => managerSessionEnvelopeInfo(normalizedOperation, wrappingKeyId),
    aadBuilder: ({ wrappingKeyId, ephemeralKeyId, salt, iv }) => managerSessionEnvelopeAad({
      operationId: normalizedOperation,
      sessionId: normalizedSession,
      credentialId: normalizedCredential,
      deviceId: normalizedDevice,
      managerId: normalizedManager,
      roles: normalizedRoles,
      accessLevel: normalizedAccess,
      sessionExpiresAt: normalizedExpiry,
      wrappingKeyId,
      ephemeralKeyId,
      salt,
      iv,
    }),
    plaintextValue: {
      contract_version: MANAGER_DEVICE_AUTH_V2,
      operation_id: normalizedOperation,
      session_id: normalizedSession,
      ops_session: token,
      device_id: normalizedDevice,
      manager_id: normalizedManager,
      roles: normalizedRoles,
      access_level: normalizedAccess,
      expires_at: normalizedExpiry,
    },
    randomBytes,
    ephemeralKeyPair,
  });
}

export const managerDeviceAuthV2CryptoInternals = Object.freeze({
  P256_ORDER,
  P256_HALF_ORDER,
  canonicalBase64url,
  canonicalBinaryBase64,
  canonicalRoles: canonicalManagerRoles,
  canonicalDeviceId,
  canonicalUuid,
  accessLevel,
  exactObject,
  isoInstant,
  platform: platformValue,
  purpose,
});
