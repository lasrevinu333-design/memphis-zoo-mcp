import crypto from "node:crypto";
import { MANAGER_DEVICE_AUTH_V2, encodeFields, normalizeManagerAttestation, sha256Hex } from "./manager-device-auth-v2-crypto.js";
import { createAppleAppAttestVerifier } from "./manager-device-auth-v2-apple-app-attest.js";

const GOOGLE_SCOPE = "https://www.googleapis.com/auth/playintegrity";
const GOOGLE_TOKEN_AUDIENCE = "https://oauth2.googleapis.com/token";
const DEFAULT_POLICY_VERSION = "manager-device-attestation.v1";
const GOOGLE_HTTP_TIMEOUT_MILLIS = 10_000;

function failure(code, status = 400, message = code) {
  return Object.assign(new Error(message), { code, status });
}

function safeJson(value, code) {
  if (!value) return null;
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("object required");
    return parsed;
  } catch {
    throw failure(code, 503);
  }
}

function accessLevel(value) {
  if (!new Set(["read_only", "full_access"]).has(value)) {
    throw failure("manager_v2_attestation_policy_invalid", 503);
  }
  return value;
}

function rejectUnknownKeys(value, allowed) {
  if (!value || typeof value !== "object" || Array.isArray(value)
      || Object.keys(value).some((key) => !allowed.has(key))) {
    throw failure("manager_v2_attestation_policy_invalid", 503);
  }
  return value;
}

function uniqueExact(values, normalize) {
  if (!Array.isArray(values)) throw failure("manager_v2_attestation_policy_invalid", 503);
  const normalized = values.map(normalize);
  if (new Set(normalized).size !== normalized.length) {
    throw failure("manager_v2_attestation_policy_invalid", 503);
  }
  return normalized;
}

function normalizeDigest(value) {
  const normalized = String(value || "").trim().replaceAll(":", "");
  if (/^[a-fA-F0-9]{64}$/.test(normalized)) return normalized.toLowerCase();
  try {
    const bytes = Buffer.from(normalized, "base64");
    if (bytes.length === 32) return bytes.toString("hex");
  } catch {
    // The caller receives one generic policy error below.
  }
  return "";
}

export function parseManagerAttestationPolicy(env = process.env) {
  const configured = safeJson(env.MANAGER_V2_ATTESTATION_POLICY_JSON, "manager_v2_attestation_policy_invalid");
  if (!configured) throw failure("manager_v2_attestation_unavailable", 503);
  rejectUnknownKeys(configured, new Set([
    "policy_version", "require_strong_integrity", "require_licensed", "maximum_evidence_age_millis",
    "android_apps", "ios_apps",
  ]));
  const version = String(configured.policy_version || "").trim();
  if (version !== DEFAULT_POLICY_VERSION) throw failure("manager_v2_attestation_policy_invalid", 503);
  if (configured.require_strong_integrity !== undefined && typeof configured.require_strong_integrity !== "boolean") {
    throw failure("manager_v2_attestation_policy_invalid", 503);
  }
  if (configured.require_licensed !== undefined && typeof configured.require_licensed !== "boolean") {
    throw failure("manager_v2_attestation_policy_invalid", 503);
  }
  if (configured.maximum_evidence_age_millis !== undefined
      && (!Number.isSafeInteger(configured.maximum_evidence_age_millis)
        || configured.maximum_evidence_age_millis < 30_000
        || configured.maximum_evidence_age_millis > 300_000)) {
    throw failure("manager_v2_attestation_policy_invalid", 503);
  }
  if (configured.android_apps !== undefined && !Array.isArray(configured.android_apps)) {
    throw failure("manager_v2_attestation_policy_invalid", 503);
  }
  if (configured.ios_apps !== undefined && !Array.isArray(configured.ios_apps)) {
    throw failure("manager_v2_attestation_policy_invalid", 503);
  }
  const androidApps = configured.android_apps || [];
  const iosApps = configured.ios_apps || [];
  const normalizedAndroid = androidApps.map((entry) => {
    rejectUnknownKeys(entry, new Set([
      "package_name", "certificate_sha256_digests", "minimum_version_code", "allowed_version_codes", "max_access_level",
    ]));
    const packageName = String(entry?.package_name || "").trim();
    const digests = uniqueExact(entry.certificate_sha256_digests, (value) => {
      const digest = normalizeDigest(value);
      if (!digest) throw failure("manager_v2_attestation_policy_invalid", 503);
      return digest;
    }).sort();
    const minimumVersionCode = entry?.minimum_version_code;
    const allowedVersionCodes = uniqueExact(entry.allowed_version_codes ?? [], (value) => {
      if (!Number.isSafeInteger(value) || value < 1) throw failure("manager_v2_attestation_policy_invalid", 503);
      return value;
    }).sort((left, right) => left - right);
    if (!/^[A-Za-z][A-Za-z0-9_.]{2,199}$/.test(packageName) || digests.length < 1
        || !Number.isSafeInteger(minimumVersionCode) || minimumVersionCode < 1) {
      throw failure("manager_v2_attestation_policy_invalid", 503);
    }
    return Object.freeze({
      packageName,
      certificateDigests: Object.freeze(digests),
      minimumVersionCode,
      allowedVersionCodes: Object.freeze(allowedVersionCodes),
      maxAccessLevel: accessLevel(entry.max_access_level),
    });
  }).sort((left, right) => left.packageName === right.packageName ? 0 : left.packageName < right.packageName ? -1 : 1);
  const normalizedIos = iosApps.map((entry) => {
    rejectUnknownKeys(entry, new Set([
      "app_id", "environment", "validation_categories", "bundle_versions", "max_access_level",
    ]));
    const appId = String(entry?.app_id || "").trim();
    const environment = String(entry?.environment || "production").trim();
    const categories = uniqueExact(entry.validation_categories, (value) => {
      if (!Number.isSafeInteger(value)) throw failure("manager_v2_attestation_policy_invalid", 503);
      return value;
    }).sort((left, right) => left - right);
    const bundleVersions = uniqueExact(entry.bundle_versions, (value) => {
      if (typeof value !== "string" || !/^[A-Za-z0-9._-]{1,64}$/.test(value)) {
        throw failure("manager_v2_attestation_policy_invalid", 503);
      }
      return value;
    }).sort();
    if (!/^[A-Z0-9]{10}\.[A-Za-z0-9.-]{3,220}$/.test(appId) || !new Set(["production", "development"]).has(environment)
        || categories.length < 1 || bundleVersions.length < 1
        || categories.some((category) => environment === "production" ? !new Set([2, 4]).has(category) : category !== 3)) {
      throw failure("manager_v2_attestation_policy_invalid", 503);
    }
    return Object.freeze({
      appId,
      environment,
      maxAccessLevel: accessLevel(entry.max_access_level),
      validationCategories: Object.freeze(categories),
      bundleVersions: Object.freeze(bundleVersions),
    });
  }).sort((left, right) => left.appId === right.appId ? 0 : left.appId < right.appId ? -1 : 1);
  if (new Set(normalizedAndroid.map((entry) => entry.packageName)).size !== normalizedAndroid.length
      || new Set(normalizedIos.map((entry) => entry.appId)).size !== normalizedIos.length) {
    throw failure("manager_v2_attestation_policy_invalid", 503);
  }
  if (normalizedAndroid.length < 1 && normalizedIos.length < 1) throw failure("manager_v2_attestation_unavailable", 503);
  const requireStrongIntegrity = configured.require_strong_integrity === true;
  const requireLicensed = configured.require_licensed !== false;
  const maximumEvidenceAgeMillis = configured.maximum_evidence_age_millis ?? 120_000;
  const policyFingerprint = `${version}.${crypto.createHash("sha256").update(JSON.stringify({
    version,
    androidApps: normalizedAndroid,
    iosApps: normalizedIos,
    requireStrongIntegrity,
    requireLicensed,
    maximumEvidenceAgeMillis,
  }), "utf8").digest("hex").slice(0, 32)}`;
  return Object.freeze({
    policyVersion: version,
    policyFingerprint,
    androidApps: Object.freeze(normalizedAndroid),
    iosApps: Object.freeze(normalizedIos),
    requireStrongIntegrity,
    requireLicensed,
    maximumEvidenceAgeMillis,
  });
}

function base64urlJson(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function createServiceAccountTokenProvider({ env, fetchImpl, now }) {
  let cached = null;
  return async () => {
    const current = now();
    if (cached && cached.expiresAt > current + 60_000) return cached.token;
    const account = safeJson(env.GOOGLE_PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON, "manager_v2_attestation_unavailable");
    const clientEmail = String(account?.client_email || "").trim();
    const privateKey = String(account?.private_key || "");
    const tokenUri = String(account?.token_uri || GOOGLE_TOKEN_AUDIENCE).trim();
    if (!clientEmail || !privateKey || tokenUri !== GOOGLE_TOKEN_AUDIENCE) throw failure("manager_v2_attestation_unavailable", 503);
    const issuedAt = Math.floor(current / 1000);
    const header = base64urlJson({ alg: "RS256", typ: "JWT" });
    const claims = base64urlJson({ iss: clientEmail, scope: GOOGLE_SCOPE, aud: tokenUri, iat: issuedAt, exp: issuedAt + 3600 });
    let signature;
    try {
      signature = crypto.sign("RSA-SHA256", Buffer.from(`${header}.${claims}`, "ascii"), privateKey).toString("base64url");
    } catch {
      throw failure("manager_v2_attestation_unavailable", 503);
    }
    const response = await fetchImpl(tokenUri, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      signal: AbortSignal.timeout(GOOGLE_HTTP_TIMEOUT_MILLIS),
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: `${header}.${claims}.${signature}`,
      }),
    }).catch(() => null);
    if (!response?.ok) throw failure("manager_v2_attestation_unavailable", 503);
    const payload = await response.json().catch(() => null);
    const token = String(payload?.access_token || "");
    const expiresIn = Number(payload?.expires_in);
    if (!token || token.length > 8192 || !Number.isFinite(expiresIn) || expiresIn < 60) {
      throw failure("manager_v2_attestation_unavailable", 503);
    }
    cached = { token, expiresAt: current + Math.min(expiresIn, 3600) * 1000 };
    return token;
  };
}

export function deriveManagerAttestationChallenge(serverSecret, record) {
  const secret = Buffer.from(String(serverSecret || ""), "utf8");
  if (secret.length < 32) throw failure("manager_v2_server_secret_required", 503);
  const binding = [
    MANAGER_DEVICE_AUTH_V2,
    record.operationId,
    record.challengeId,
    record.purpose,
    record.deviceId,
    record.platform,
    record.signingKeyId,
    record.wrappingKeyId,
    record.requestFingerprint,
  ].join("\u0000");
  return crypto.createHmac("sha256", secret)
    .update("manager-device-auth-v2-attestation-challenge\u0000", "utf8")
    .update(binding, "utf8")
    .digest("base64url");
}

export function createManagerDeviceAttestationVerifier({
  env = process.env,
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
  googleAccessTokenProvider = null,
  appleVerifier = null,
  policy = null,
} = {}) {
  const activePolicy = policy || parseManagerAttestationPolicy(env);
  if (typeof fetchImpl !== "function") throw failure("manager_v2_attestation_unavailable", 503);
  const accessToken = googleAccessTokenProvider || createServiceAccountTokenProvider({ env, fetchImpl, now });
  if (appleVerifier && env.NODE_ENV !== "test") throw failure("manager_v2_attestation_policy_invalid", 503);
  const activeAppleVerifier = appleVerifier || createAppleAppAttestVerifier({ now });

  async function verifyPlayIntegrity({ evidence, challenge }) {
    const token = String(evidence?.token || "");
    if (!token || token.length > 32_768) throw failure("manager_v2_attestation_invalid", 401);
    const decodedPackageHint = String(evidence?.app_id || "");
    const requestedApp = activePolicy.androidApps.find((candidate) => candidate.packageName === decodedPackageHint);
    if (!requestedApp) throw failure("manager_v2_attestation_policy_denied", 403);
    const bearer = await accessToken();
    const endpoint = `https://playintegrity.googleapis.com/v1/${encodeURIComponent(decodedPackageHint)}:decodeIntegrityToken`;
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" },
      signal: AbortSignal.timeout(GOOGLE_HTTP_TIMEOUT_MILLIS),
      body: JSON.stringify({ integrity_token: token }),
    }).catch(() => null);
    if (!response?.ok) throw failure("manager_v2_attestation_invalid", 401);
    const decoded = await response.json().catch(() => null);
    const payload = decoded?.tokenPayloadExternal;
    const requestDetails = payload?.requestDetails;
    const appIntegrity = payload?.appIntegrity;
    const deviceIntegrity = payload?.deviceIntegrity;
    const accountDetails = payload?.accountDetails;
    const packageName = String(requestDetails?.requestPackageName || "");
    const app = activePolicy.androidApps.find((candidate) => candidate.packageName === packageName);
    if (!app || String(appIntegrity?.packageName || "") !== packageName
        || requestDetails?.requestHash !== challenge || appIntegrity?.appRecognitionVerdict !== "PLAY_RECOGNIZED") {
      throw failure("manager_v2_attestation_policy_denied", 403);
    }
    const tokenTime = Number(requestDetails?.timestampMillis);
    if (!Number.isFinite(tokenTime) || Math.abs(now() - tokenTime) > activePolicy.maximumEvidenceAgeMillis) {
      throw failure("manager_v2_attestation_invalid", 401);
    }
    const observedDigests = (Array.isArray(appIntegrity?.certificateSha256Digest) ? appIntegrity.certificateSha256Digest : [])
      .map(normalizeDigest).filter(Boolean);
    if (!observedDigests.some((digest) => app.certificateDigests.includes(digest))) {
      throw failure("manager_v2_attestation_policy_denied", 403);
    }
    const versionCode = Number(appIntegrity?.versionCode);
    if (!Number.isSafeInteger(versionCode) || versionCode < app.minimumVersionCode
        || (app.allowedVersionCodes.length > 0 && !app.allowedVersionCodes.includes(versionCode))) {
      throw failure("manager_v2_attestation_policy_denied", 403);
    }
    const verdicts = new Set(Array.isArray(deviceIntegrity?.deviceRecognitionVerdict) ? deviceIntegrity.deviceRecognitionVerdict : []);
    if (!verdicts.has("MEETS_DEVICE_INTEGRITY") || (activePolicy.requireStrongIntegrity && !verdicts.has("MEETS_STRONG_INTEGRITY"))) {
      throw failure("manager_v2_attestation_policy_denied", 403);
    }
    if (activePolicy.requireLicensed && accountDetails?.appLicensingVerdict !== "LICENSED") {
      throw failure("manager_v2_attestation_policy_denied", 403);
    }
    return Object.freeze({
      provider: "play_integrity",
      appId: packageName,
      maxAccessLevel: app.maxAccessLevel,
      policyVersion: activePolicy.policyFingerprint || activePolicy.policyVersion,
      verifiedAt: new Date(now()).toISOString(),
      evidenceDigest: sha256Hex(encodeFields([["app_id", packageName], ["token", token]])),
      keyId: null,
      assertionCounter: null,
    });
  }

  async function verifyApple({ evidence, challenge, purpose, storedAttestation = null }) {
    const expectedClientDataHash = crypto.createHash("sha256").update(challenge, "utf8").digest("base64url");
    if (purpose !== "enroll" && evidence?.client_data_hash !== expectedClientDataHash) {
      throw failure("manager_v2_attestation_invalid", 401);
    }
    const selected = activePolicy.iosApps.find((candidate) => candidate.appId === String(evidence?.app_id || ""));
    if (!selected) throw failure("manager_v2_attestation_policy_denied", 403);
    const result = await activeAppleVerifier.verify({
      evidence: structuredClone(evidence),
      challenge,
      purpose,
      storedAttestation,
      policy: selected,
    });
    if (result?.verified !== true || result.appId !== selected.appId || result.environment !== selected.environment) {
      throw failure("manager_v2_attestation_policy_denied", 403);
    }
    const appId = selected.appId;
    const app = selected;
    return Object.freeze({
      provider: "apple_app_attest",
      appId,
      maxAccessLevel: app.maxAccessLevel,
      policyVersion: activePolicy.policyFingerprint || activePolicy.policyVersion,
      verifiedAt: new Date(now()).toISOString(),
      evidenceDigest: String(result.evidenceDigest || ""),
      keyId: String(result.keyId || evidence?.key_id || ""),
      publicKeySpki: result.publicKeySpki ? String(result.publicKeySpki) : null,
      receipt: result.receipt ? String(result.receipt) : null,
      assertionCounter: Number.isSafeInteger(result.assertionCounter) ? result.assertionCounter : 0,
      previousAssertionCounter: Number.isSafeInteger(result.previousAssertionCounter) ? result.previousAssertionCounter : undefined,
      validationCategory: Number.isSafeInteger(result.validationCategory) ? result.validationCategory : null,
      bundleVersion: result.bundleVersion ? String(result.bundleVersion) : null,
    });
  }

  async function verify({ platform, purpose, evidence, challenge, storedAttestation = null }) {
    const semanticDigest = normalizeManagerAttestation(evidence, platform, purpose).evidenceDigest;
    if (platform === "android") {
      const result = await verifyPlayIntegrity({ evidence, challenge });
      return Object.freeze({ ...result, evidenceDigest: semanticDigest });
    }
    if (platform === "ios") {
      const result = await verifyApple({ evidence, challenge, purpose, storedAttestation });
      return Object.freeze({ ...result, evidenceDigest: semanticDigest });
    }
    throw failure("manager_v2_attestation_policy_denied", 403);
  }

  return Object.freeze({ policy: activePolicy, verify });
}

export const managerDeviceAuthV2AttestationInternals = Object.freeze({ normalizeDigest });
