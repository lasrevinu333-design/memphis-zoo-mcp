import { createHash, createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import argon2 from "argon2";
import { isCanonicalEmployeeKiosk, normalizeDeviceIdentifier, resolveActiveAssignedDevice, resolveCanonicalDevice } from "../device-identity.js";

const DEVICE_COOKIE_NAME = "memphis_device_credential";
const DEVICE_SECURITY_COOKIE_NAME = "memphis_device_security_session";
const DEFAULT_CREDENTIAL_TTL_DAYS = 3650;
const DEFAULT_ENROLLMENT_TTL_MINUTES = 30;
const DEVICE_SECURITY_SESSION_TTL_MS = 15 * 60 * 1000;
const DEVICE_SECURITY_LOCKOUT_MS = 15 * 60 * 1000;
const DEVICE_SECURITY_FAILURE_LIMIT = 5;
const ENROLLMENT_WINDOW_MS = 15 * 60 * 1000;
const ENROLLMENT_ATTEMPT_LIMIT = 8;
const enrollmentAttempts = new Map();
const VALID_POLICY_MODES = new Set(["observe", "enroll", "enforce-ready", "enforce"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function truthy(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function isProductionLike(env = process.env) {
  return String(env.NODE_ENV || "").toLowerCase() === "production" || Boolean(env.RENDER || env.RENDER_SERVICE_ID);
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && timingSafeEqual(a, b);
}

function secretForDeviceCredentials(env = process.env) {
  const value = String(env.DEVICE_CREDENTIAL_SECRET || "").trim();
  if (!value) {
    const error = new Error("The dedicated device credential secret is not configured.");
    error.status = 503;
    throw error;
  }
  return value;
}

function hmacHex(env, purpose, value) {
  return createHmac("sha256", secretForDeviceCredentials(env))
    .update(`${purpose}:${String(value || "")}`, "utf8")
    .digest("hex");
}

function normalizePolicyMode(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return VALID_POLICY_MODES.has(normalized) ? normalized : "enroll";
}

function credentialTtlDays(env = process.env) {
  const parsed = Number.parseInt(String(env.DEVICE_CREDENTIAL_TTL_DAYS || DEFAULT_CREDENTIAL_TTL_DAYS), 10);
  return Math.min(Math.max(Number.isFinite(parsed) ? parsed : DEFAULT_CREDENTIAL_TTL_DAYS, 1), 3650);
}

function enrollmentTtlMinutes(env = process.env) {
  const parsed = Number.parseInt(String(env.DEVICE_ENROLLMENT_CODE_TTL_MINUTES || DEFAULT_ENROLLMENT_TTL_MINUTES), 10);
  return Math.min(Math.max(Number.isFinite(parsed) ? parsed : DEFAULT_ENROLLMENT_TTL_MINUTES, 5), 120);
}

function parseCookies(req) {
  const raw = String(req?.header?.("cookie") || req?.headers?.cookie || "");
  const result = {};
  for (const part of raw.split(";")) {
    const index = part.indexOf("=");
    if (index <= 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!key) continue;
    try { result[key] = decodeURIComponent(value); } catch { result[key] = value; }
  }
  return result;
}

function authorizationDeviceToken(req) {
  const header = String(req?.header?.("authorization") || req?.headers?.authorization || "").trim();
  const match = header.match(/^Device\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function requestCredentialToken(req) {
  return String(
    authorizationDeviceToken(req)
      || req?.header?.("x-device-credential")
      || req?.headers?.["x-device-credential"]
      || parseCookies(req)[DEVICE_COOKIE_NAME]
      || ""
  ).trim();
}

function credentialTokenParts(value) {
  const raw = String(value || "").trim();
  const dot = raw.indexOf(".");
  if (dot <= 0) return null;
  const credentialId = raw.slice(0, dot);
  const secret = raw.slice(dot + 1);
  if (!UUID_PATTERN.test(credentialId) || !/^[A-Za-z0-9_-]{32,}$/.test(secret)) return null;
  return { credentialId, secret };
}

function canonicalNativeTimestamp(value) {
  const text = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(text)) return "";
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === text ? text : "";
}

function nativeAttestationCredential(req) {
  const parts = credentialTokenParts(requestCredentialToken(req));
  const authenticatedId = String(req?.memphisDeviceCredential?.credential_id || "").trim().toLowerCase();
  if (!parts || parts.credentialId.toLowerCase() !== authenticatedId) {
    throw Object.assign(new Error("Native request attestation is not bound to the authenticated credential."), {
      status: 403,
      code: "native_attestation_credential_mismatch",
    });
  }
  return { ...parts, credentialId: authenticatedId };
}

function verifyNativeHmac(secret, message, supplied, code) {
  const signature = String(supplied || "").trim().toLowerCase();
  const expected = createHmac("sha256", secret).update(message, "utf8").digest("hex");
  if (!/^[0-9a-f]{64}$/.test(signature) || !safeEqual(signature, expected)) {
    throw Object.assign(new Error("Native phone attestation could not be verified."), { status: 403, code });
  }
  return signature;
}

function nativeAttestationDevice(req) {
  const value = normalizeDeviceIdentifier(req?.memphisDevice?.canonical_device_id || req?.memphisDevice?.device_id || "");
  if (!value) throw Object.assign(new Error("Native attestation requires an authenticated canonical device."), { status: 403 });
  return value.toUpperCase();
}

export function verifyNativeDeviceRequestAttestation(req, { now = new Date(), maxAgeMs = 2 * 60 * 1000 } = {}) {
  const version = String(req?.headers?.["x-memphis-native-attestation-version"] || "").trim();
  const requestId = String(req?.headers?.["x-memphis-native-request-id"] || "").trim().toLowerCase();
  const timestamp = canonicalNativeTimestamp(req?.headers?.["x-memphis-native-request-timestamp"]);
  const edition = String(req?.headers?.["x-memphis-app-edition"] || "").trim().toLowerCase();
  if (version !== "custodial-native-request.v1"
      || !UUID_PATTERN.test(requestId)
      || !timestamp
      || edition !== "custodial") {
    throw Object.assign(new Error("Complete native request attestation is required."), { status: 403, code: "native_request_attestation_required" });
  }
  const timestampMs = Date.parse(timestamp);
  if (timestampMs > now.getTime() + 15_000 || now.getTime() - timestampMs > maxAgeMs) {
    throw Object.assign(new Error("Native request attestation is outside its accepted time window."), { status: 403, code: "native_request_attestation_expired" });
  }
  const { credentialId, secret } = nativeAttestationCredential(req);
  const deviceId = nativeAttestationDevice(req);
  const method = String(req?.method || "").trim().toUpperCase();
  const path = String(req?.originalUrl || req?.url || "").trim();
  const bodySha256 = createHash("sha256").update(req?.scanAuthorityRawBody || Buffer.alloc(0)).digest("hex");
  const message = [version, credentialId, deviceId, method, path, bodySha256, requestId, timestamp, edition].join("\n");
  const signature = verifyNativeHmac(secret, message, req?.headers?.["x-memphis-native-request-attestation"], "native_request_attestation_invalid");
  return { version, request_id: requestId, timestamp, credential_id: credentialId, device_id: deviceId, method, path, body_sha256: bodySha256, signature };
}

export function verifyNativeOfflineWorkAttestation(req, args, kind) {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    throw Object.assign(new Error("Native work attestation requires canonical arguments."), { status: 422 });
  }
  const { credentialId, secret } = nativeAttestationCredential(req);
  const deviceId = nativeAttestationDevice(req);
  const location = String(args.p_location_code || "").trim().toUpperCase();
  const sessionId = String(args.p_client_session_id || "").trim();
  if (!location || !sessionId) throw Object.assign(new Error("Native work attestation is missing occurrence identity."), { status: 422 });

  if (kind === "start") {
    const version = String(args.p_native_start_attestation_version || "").trim();
    const startedAt = canonicalNativeTimestamp(args.p_client_started_at);
    const snapshotId = String(args.p_snapshot_id || "").trim().toLowerCase();
    const employeeId = String(args.p_snapshot_employee_id || "").trim().toLowerCase();
    const epoch = Number(args.p_snapshot_assignment_epoch);
    const snapshotCredentialId = String(args.p_snapshot_credential_id || "").trim().toLowerCase();
    const nativeScanEntryId = String(args.p_native_scan_entry_id || "").trim().toLowerCase();
    if (version !== "custodial-native-start.v1" || !startedAt || !/^[0-9a-f]{64}$/.test(snapshotId)
        || !UUID_PATTERN.test(employeeId) || !Number.isSafeInteger(epoch) || epoch < 1
        || snapshotCredentialId !== credentialId || !UUID_PATTERN.test(nativeScanEntryId)) {
      throw Object.assign(new Error("Complete native start attestation is required."), { status: 403, code: "native_start_attestation_required" });
    }
    const message = [version, credentialId, deviceId, location, sessionId, snapshotId, employeeId, String(epoch), snapshotCredentialId, nativeScanEntryId, startedAt].join("\n");
    const signature = verifyNativeHmac(secret, message, args.p_native_start_attestation, "native_start_attestation_invalid");
    return { version, signature, started_at: startedAt, native_scan_entry_id: nativeScanEntryId };
  }

  if (kind === "completion") {
    const version = String(args.p_native_completion_attestation_version || "").trim();
    const completionId = String(args.p_client_completion_id || "").trim();
    const reconciliation = args.p_response_json?.__custodial_offline_reconciliation_v1;
    const contextId = String(reconciliation?.context_id || "").trim().toLowerCase();
    const nativeFinishScanEntryId = String(args.p_native_finish_scan_entry_id || "").trim().toLowerCase();
    const startedAt = canonicalNativeTimestamp(args.p_client_started_at);
    const endedAt = canonicalNativeTimestamp(args.p_client_ended_at);
    if (version !== "custodial-native-completion.v2" || !UUID_PATTERN.test(completionId)
        || !UUID_PATTERN.test(contextId) || !UUID_PATTERN.test(nativeFinishScanEntryId) || !startedAt || !endedAt) {
      throw Object.assign(new Error("Complete native completion attestation is required."), { status: 403, code: "native_completion_attestation_required" });
    }
    const message = [version, credentialId, deviceId, location, sessionId, completionId, contextId, nativeFinishScanEntryId, startedAt, endedAt].join("\n");
    const signature = verifyNativeHmac(secret, message, args.p_native_completion_attestation, "native_completion_attestation_invalid");
    return { version, signature, started_at: startedAt, ended_at: endedAt, context_id: contextId, native_finish_scan_entry_id: nativeFinishScanEntryId };
  }
  throw new Error(`Unsupported native work attestation kind: ${kind}`);
}

function requestDeviceIdentifier(req) {
  const args = req?.body?.args && typeof req.body.args === "object" ? req.body.args : {};
  return normalizeDeviceIdentifier(
    req?.body?.device_id
      || req?.body?.deviceId
      || req?.query?.device_id
      || req?.query?.device
      || req?.query?.deviceId
      || args.p_device_id
      || args.p_device_identifier
      || req?.header?.("x-device-id")
      || req?.headers?.["x-device-id"]
      || ""
  );
}

function requestHeaderDeviceIdentifier(req) {
  return normalizeDeviceIdentifier(req?.header?.("x-device-id") || req?.headers?.["x-device-id"] || "");
}

function requestIp(req) {
  return String(req?.headers?.["x-forwarded-for"] || req?.ip || req?.socket?.remoteAddress || "")
    .split(",")[0]
    .trim()
    .slice(0, 200);
}

function requestUserAgent(req) {
  return String(req?.header?.("user-agent") || req?.headers?.["user-agent"] || "").trim().slice(0, 1000);
}

function privacyHash(value, env, purpose) {
  return value ? hmacHex(env, `privacy-${purpose}`, value) : null;
}

function tokenHash(secret, env) {
  return hmacHex(env, "device-token", secret);
}

function enrollmentCodeHash(devicePk, code, env) {
  const normalized = String(code || "").replace(/\D/g, "").slice(0, 8);
  return hmacHex(env, "device-enrollment", `${devicePk}:${normalized}`);
}

function cookieSameSite(env = process.env) {
  const configured = String(env.DEVICE_CREDENTIAL_COOKIE_SAME_SITE || "").trim().toLowerCase();
  if (configured === "strict") return "Strict";
  if (configured === "lax") return "Lax";
  if (configured === "none") return "None";
  return isProductionLike(env) ? "None" : "Lax";
}

function cookieSecure(req, env = process.env) {
  if (truthy(env.DEVICE_CREDENTIAL_COOKIE_INSECURE)) return false;
  if (isProductionLike(env)) return true;
  const forwarded = String(req?.header?.("x-forwarded-proto") || "").toLowerCase();
  return Boolean(req?.secure || forwarded === "https");
}

function serializeCookie(name, value, { maxAgeSeconds = 0, sameSite = "Lax", secure = true, clear = false, partitioned = false } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, "Path=/", "HttpOnly", `SameSite=${sameSite}`, "Priority=High"];
  if (secure) parts.push("Secure");
  if (partitioned) parts.push("Partitioned");
  if (clear) parts.push("Max-Age=0", "Expires=Thu, 01 Jan 1970 00:00:00 GMT");
  else parts.push(`Max-Age=${Math.max(1, Math.floor(maxAgeSeconds))}`);
  return parts.join("; ");
}

function setCookieHeader(res, value) {
  if (typeof res.append === "function") res.append("Set-Cookie", value);
  else {
    const existing = res.getHeader?.("Set-Cookie");
    if (!existing) res.setHeader("Set-Cookie", value);
    else res.setHeader("Set-Cookie", Array.isArray(existing) ? [...existing, value] : [existing, value]);
  }
}

function setDeviceCredentialCookie(res, rawToken, req, env = process.env) {
  const sameSite = cookieSameSite(env);
  const secure = cookieSecure(req, env);
  setCookieHeader(res, serializeCookie(DEVICE_COOKIE_NAME, rawToken, {
    maxAgeSeconds: credentialTtlDays(env) * 24 * 60 * 60,
    sameSite,
    secure,
    partitioned: secure && sameSite === "None" && !truthy(env.DEVICE_CREDENTIAL_COOKIE_DISABLE_PARTITIONED),
  }));
}

function clearDeviceCredentialCookie(res, req, env = process.env) {
  const sameSite = cookieSameSite(env);
  const secure = cookieSecure(req, env);
  setCookieHeader(res, serializeCookie(DEVICE_COOKIE_NAME, "", {
    sameSite,
    secure,
    clear: true,
    partitioned: secure && sameSite === "None" && !truthy(env.DEVICE_CREDENTIAL_COOKIE_DISABLE_PARTITIONED),
  }));
}

function setDeviceSecurityCookie(res, rawToken, req, env = process.env) {
  const sameSite = cookieSameSite(env);
  const secure = cookieSecure(req, env);
  setCookieHeader(res, serializeCookie(DEVICE_SECURITY_COOKIE_NAME, rawToken, {
    maxAgeSeconds: Math.floor(DEVICE_SECURITY_SESSION_TTL_MS / 1000),
    sameSite,
    secure,
    partitioned: secure && sameSite === "None" && !truthy(env.DEVICE_CREDENTIAL_COOKIE_DISABLE_PARTITIONED),
  }));
}

function clearDeviceSecurityCookie(res, req, env = process.env) {
  const sameSite = cookieSameSite(env);
  const secure = cookieSecure(req, env);
  setCookieHeader(res, serializeCookie(DEVICE_SECURITY_COOKIE_NAME, "", {
    sameSite,
    secure,
    clear: true,
    partitioned: secure && sameSite === "None" && !truthy(env.DEVICE_CREDENTIAL_COOKIE_DISABLE_PARTITIONED),
  }));
}

function deviceSecuritySessionParts(req) {
  const raw = String(parseCookies(req)[DEVICE_SECURITY_COOKIE_NAME] || "").trim();
  const dot = raw.indexOf(".");
  if (dot <= 0) return null;
  const sessionId = raw.slice(0, dot);
  const secret = raw.slice(dot + 1);
  if (!UUID_PATTERN.test(sessionId) || !/^[A-Za-z0-9_-]{32,}$/.test(secret)) return null;
  return { sessionId, secret };
}

function deviceSecurityHash(secret, env) {
  return hmacHex(env, "device-security-session", secret);
}

function deviceSecurityCsrfHash(csrf, env) {
  return hmacHex(env, "device-security-csrf", csrf);
}

function normalizeManagerRolesForDeviceSecurity(roles) {
  const normalized = new Set();
  const list = Array.isArray(roles) ? roles : [roles];
  for (const role of list) {
    const value = String(role || "").trim().toUpperCase();
    if (["OPS_MANAGER", "DIRECTOR", "SECURITY_ADMIN"].includes(value)) normalized.add(value);
  }
  if (normalized.has("SECURITY_ADMIN")) {
    normalized.add("DIRECTOR");
    normalized.add("OPS_MANAGER");
  }
  if (normalized.has("DIRECTOR")) normalized.add("OPS_MANAGER");
  return Array.from(normalized);
}

function hasSecurityAdminRole(req) {
  return normalizeManagerRolesForDeviceSecurity(req?.memphisAuth?.roles).includes("SECURITY_ADMIN");
}

async function loadAuthoritativeManager(req, store) {
  const id = managerId(req);
  if (!id || typeof store?.getManager !== "function") return null;
  const manager = await store.getManager(id);
  if (!manager) return null;
  const active = manager.active !== false && !manager.revoked_at;
  const roles = normalizeManagerRolesForDeviceSecurity(manager.roles);
  req.memphisAuth = {
    ...(req.memphisAuth || {}),
    manager_id: manager.manager_id || id,
    manager_display_name: manager.display_name || req.memphisAuth?.manager_display_name || "",
    roles,
  };
  return { ...manager, active, roles };
}

async function hasAuthoritativeSecurityAdminRole(req, store) {
  if (managerId(req) && typeof store?.getManager === "function") {
    const manager = await loadAuthoritativeManager(req, store);
    return Boolean(manager?.active && manager.roles.includes("SECURITY_ADMIN"));
  }
  const manager = await loadAuthoritativeManager(req, store);
  if (manager) return Boolean(manager.active && manager.roles.includes("SECURITY_ADMIN"));
  return hasSecurityAdminRole(req);
}

function managerId(req) {
  return String(req?.memphisAuth?.manager_id || "").trim() || null;
}

function credentialId(req) {
  return String(req?.memphisAuth?.credential_id || "").trim() || null;
}

function enrollmentRateKey(req) {
  return `${requestIp(req) || "unknown"}|${requestDeviceIdentifier(req) || "unknown"}`;
}

function consumeEnrollmentAttempt(req, now = Date.now()) {
  const key = enrollmentRateKey(req);
  let bucket = enrollmentAttempts.get(key);
  if (!bucket || now - bucket.startedAt >= ENROLLMENT_WINDOW_MS) bucket = { startedAt: now, count: 0 };
  bucket.count += 1;
  enrollmentAttempts.set(key, bucket);
  return {
    allowed: bucket.count <= ENROLLMENT_ATTEMPT_LIMIT,
    retryAfterSeconds: Math.max(1, Math.ceil((ENROLLMENT_WINDOW_MS - (now - bucket.startedAt)) / 1000)),
  };
}

function clearEnrollmentAttempts(req) {
  enrollmentAttempts.delete(enrollmentRateKey(req));
}

export function createSupabaseDeviceCredentialStore(supabase) {
  if (!supabase) return null;
  return {
    async getManager(managerId) {
      if (!managerId) return null;
      const { data, error } = await supabase
        .from("ops_manager_managers")
        .select("manager_id,display_name,contact_label,roles,active,revoked_at,revoked_reason,created_at,last_access_at")
        .eq("manager_id", managerId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return {
        manager_id: data.manager_id,
        display_name: data.display_name,
        contact_label: data.contact_label,
        roles: normalizeManagerRolesForDeviceSecurity(data.roles),
        active: data.active !== false && !data.revoked_at,
        revoked_at: data.revoked_at || null,
        revoked_reason: data.revoked_reason || null,
        created_at: data.created_at || null,
        last_access_at: data.last_access_at || null,
      };
    },
    async getPolicy() {
      const { data, error } = await supabase.from("device_auth_policy").select("mode,updated_by,updated_at").eq("singleton", true).maybeSingle();
      if (error) throw error;
      return { mode: normalizePolicyMode(data?.mode), updated_by: data?.updated_by || null, updated_at: data?.updated_at || null };
    },
    async setPolicy(mode, updatedBy) {
      const normalized = normalizePolicyMode(mode);
      const { data, error } = await supabase
        .from("device_auth_policy")
        .upsert({ singleton: true, mode: normalized, updated_by: String(updatedBy || "ops_manager").slice(0, 160), updated_at: new Date().toISOString() })
        .select("mode,updated_by,updated_at")
        .single();
      if (error) throw error;
      return data;
    },
    async findCredential(credentialId) {
      const { data, error } = await supabase
        .from("device_auth_credentials")
        .select("credential_id,device_id,token_hash,device_label,created_at,confirmed_at,last_used_at,expires_at,revoked_at,revoked_reason,metadata_json")
        .eq("credential_id", credentialId)
        .maybeSingle();
      if (error) throw error;
      return data || null;
    },
    async touchCredential(credentialId, patch = {}) {
      const nextPatch = { ...patch };
      if (!nextPatch.last_used_at) nextPatch.last_used_at = new Date().toISOString();
      const { error } = await supabase
        .from("device_auth_credentials")
        .update(nextPatch)
        .eq("credential_id", credentialId)
        .is("revoked_at", null);
      if (error) throw error;
    },
    async issueEnrollmentCode({ devicePk, codeHash, createdBy, expiresAt, metadata = {} }) {
      const { data, error } = await supabase.rpc("device_auth_issue_enrollment_code", {
        p_device_id: devicePk,
        p_code_hash: codeHash,
        p_created_by: String(createdBy || "ops_manager"),
        p_expires_at: expiresAt,
        p_metadata_json: metadata,
      });
      if (error) throw error;
      return Array.isArray(data) ? data[0] : data;
    },
    async consumeEnrollmentCode({ devicePk, codeHash, credentialId, credentialTokenHash, deviceLabel, expiresAt, userAgentHash, ipHash, metadata = {} }) {
      const { data, error } = await supabase.rpc("device_auth_consume_enrollment_code", {
        p_device_id: devicePk,
        p_code_hash: codeHash,
        p_credential_id: credentialId,
        p_token_hash: credentialTokenHash,
        p_device_label: deviceLabel || null,
        p_expires_at: expiresAt,
        p_user_agent_hash: userAgentHash || null,
        p_ip_hash: ipHash || null,
        p_metadata_json: metadata,
      });
      if (error) throw error;
      if (!data?.ok) {
        const invalid = new Error("invalid or expired enrollment code");
        invalid.code = "invalid_enrollment_code";
        throw invalid;
      }
      return data;
    },
    async revokeCredential(credentialId, reason = "revoked_by_manager") {
      const { data, error } = await supabase
        .from("device_auth_credentials")
        .update({ revoked_at: new Date().toISOString(), revoked_reason: String(reason || "revoked_by_manager").slice(0, 160) })
        .eq("credential_id", credentialId)
        .is("revoked_at", null)
        .select("credential_id,device_id,revoked_at,revoked_reason")
        .maybeSingle();
      if (error) throw error;
      return data || null;
    },
    async revokeByTokenHash(hash, reason = "device_logout") {
      const { data, error } = await supabase
        .from("device_auth_credentials")
        .update({ revoked_at: new Date().toISOString(), revoked_reason: String(reason || "device_logout").slice(0, 160) })
        .eq("token_hash", hash)
        .is("revoked_at", null)
        .select("credential_id,device_id,revoked_at,revoked_reason")
        .maybeSingle();
      if (error) throw error;
      return data || null;
    },
    async getDeviceSecurityConfig() {
      const { data, error } = await supabase
        .from("ops_manager_device_security_config")
        .select("password_hash,password_version,rotated_at,sessions_revoked_at")
        .eq("singleton", true)
        .maybeSingle();
      if (error) throw error;
      return data || null;
    },
    async getDeviceSecurityRateLimit(keyHash) {
      const { data, error } = await supabase
        .from("ops_manager_device_security_rate_limits")
        .select("key_hash,failure_count,first_failed_at,last_failed_at,locked_until")
        .eq("key_hash", keyHash)
        .maybeSingle();
      if (error) throw error;
      return data || null;
    },
    async recordDeviceSecurityFailure(keyHash, metadata = {}) {
      const now = new Date();
      const current = await this.getDeviceSecurityRateLimit(keyHash);
      const firstFailedAt = current?.first_failed_at && Date.parse(current.first_failed_at) > now.getTime() - DEVICE_SECURITY_LOCKOUT_MS
        ? current.first_failed_at
        : now.toISOString();
      const failureCount = current?.first_failed_at && Date.parse(current.first_failed_at) > now.getTime() - DEVICE_SECURITY_LOCKOUT_MS
        ? Number(current.failure_count || 0) + 1
        : 1;
      const lockedUntil = failureCount >= DEVICE_SECURITY_FAILURE_LIMIT
        ? new Date(now.getTime() + DEVICE_SECURITY_LOCKOUT_MS).toISOString()
        : null;
      const { data, error } = await supabase
        .from("ops_manager_device_security_rate_limits")
        .upsert({
          key_hash: keyHash,
          failure_count: failureCount,
          first_failed_at: firstFailedAt,
          last_failed_at: now.toISOString(),
          locked_until: lockedUntil,
          metadata_json: metadata,
        })
        .select("key_hash,failure_count,first_failed_at,last_failed_at,locked_until")
        .single();
      if (error) throw error;
      return data;
    },
    async clearDeviceSecurityFailures(keyHash) {
      const { error } = await supabase
        .from("ops_manager_device_security_rate_limits")
        .delete()
        .eq("key_hash", keyHash);
      if (error) throw error;
    },
    async createDeviceSecuritySession(record = {}) {
      const { data, error } = await supabase
        .from("ops_manager_device_security_sessions")
        .insert(record)
        .select("session_id,manager_id,credential_id,password_version,created_at,last_used_at,expires_at,revoked_at")
        .single();
      if (error) throw error;
      return data;
    },
    async findDeviceSecuritySession(sessionId) {
      const { data, error } = await supabase
        .from("ops_manager_device_security_sessions")
        .select("session_id,manager_id,credential_id,token_hash,csrf_hash,password_version,created_at,last_used_at,expires_at,revoked_at,revoked_reason")
        .eq("session_id", sessionId)
        .maybeSingle();
      if (error) throw error;
      return data || null;
    },
    async touchDeviceSecuritySession(sessionId) {
      const { error } = await supabase
        .from("ops_manager_device_security_sessions")
        .update({ last_used_at: new Date().toISOString(), expires_at: new Date(Date.now() + DEVICE_SECURITY_SESSION_TTL_MS).toISOString() })
        .eq("session_id", sessionId)
        .is("revoked_at", null);
      if (error) throw error;
    },
    async revokeDeviceSecuritySession(sessionId, reason = "manual_lock") {
      const { error } = await supabase
        .from("ops_manager_device_security_sessions")
        .update({ revoked_at: new Date().toISOString(), revoked_reason: String(reason || "manual_lock").slice(0, 160) })
        .eq("session_id", sessionId)
        .is("revoked_at", null);
      if (error) throw error;
    },
    async revokeAllDeviceSecuritySessions(reason = "password_rotation") {
      const { data, error } = await supabase
        .from("ops_manager_device_security_sessions")
        .update({ revoked_at: new Date().toISOString(), revoked_reason: String(reason || "password_rotation").slice(0, 160) })
        .is("revoked_at", null)
        .select("session_id");
      if (error) throw error;
      return data || [];
    },
    async revokeEnrollmentCode(enrollmentId, { managerId = null, reason = "revoked_by_security_admin" } = {}) {
      const { data, error } = await supabase
        .from("device_auth_enrollment_codes")
        .update({ revoked_at: new Date().toISOString(), status: "revoked", revoked_by_manager_id: managerId, metadata_json: { revoked_reason: String(reason || "revoked_by_security_admin").slice(0, 160) } })
        .eq("enrollment_id", enrollmentId)
        .is("consumed_at", null)
        .is("revoked_at", null)
        .select("enrollment_id,device_id,expires_at,revoked_at,status")
        .maybeSingle();
      if (error) throw error;
      return data || null;
    },
    async auditSecurityCode(event = {}) {
      const { error } = await supabase.from("ops_manager_security_code_events").insert(event);
      if (error) throw error;
    },
    async audit(event) {
      const { error } = await supabase.from("device_auth_events").insert(event);
      if (error) throw error;
    },
  };
}

async function audit(store, event) {
  if (!store?.audit) return;
  try { await store.audit(event); } catch (error) { console.warn("device auth audit failed:", error?.message || error); }
}

function authEvent(req, device, { credentialId = null, eventType, success, reason = null, metadata = {}, env = process.env } = {}) {
  return {
    device_id: device?.canonical_device_pk || null,
    credential_id: credentialId || null,
    event_type: String(eventType || "device_auth").slice(0, 100),
    success: Boolean(success),
    reason: reason ? String(reason).slice(0, 500) : null,
    presented_identifier: requestDeviceIdentifier(req) || null,
    ip_hash: privacyHash(requestIp(req), env, "ip"),
    user_agent_hash: privacyHash(requestUserAgent(req), env, "ua"),
    metadata_json: metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata : {},
  };
}

const OFFLINE_RECOVERY_FUNCTIONS = new Set([
  "tool_start_offline_occurrence",
  "tool_commit_cleaning_workflow",
]);

function isOfflineRecoveryRequest(req) {
  return OFFLINE_RECOVERY_FUNCTIONS.has(String(req?.body?.fn || "").trim());
}

async function resolveDevice(req, runReadOnlySql, { allowTerminalOfflineRecovery = false } = {}) {
  const identifier = requestDeviceIdentifier(req);
  if (!identifier) return { identifier: "", device: null };
  const device = allowTerminalOfflineRecovery
    ? await resolveCanonicalDevice({ runReadOnlySql, deviceIdentifier: identifier })
    : await resolveActiveAssignedDevice({ runReadOnlySql, deviceIdentifier: identifier });
  return { identifier, device };
}

function isEligibleEmployeeDevice(device) {
  return Boolean(
    device
    && device.device_active === true
    && device.assignment_valid === true
    && device.employee_active === true
    && isCanonicalEmployeeKiosk(device.canonical_device_id || device.device_id)
    && /^EMP\d+$/i.test(String(device.employee_code || ""))
  );
}

export async function authenticateDeviceCredentialRequest(req, {
  env = process.env,
  supabase = null,
  store: suppliedStore = null,
  runReadOnlySql,
  now = new Date(),
} = {}) {
  if (typeof runReadOnlySql !== "function") throw new Error("runReadOnlySql is required.");
  const store = suppliedStore || createSupabaseDeviceCredentialStore(supabase);
  if (!store) return { ok: false, status: 503, code: "device_auth_unavailable", error: "Device authentication store is unavailable." };

  const terminalOfflineRecovery = isOfflineRecoveryRequest(req);
  const { identifier, device } = await resolveDevice(req, runReadOnlySql, { allowTerminalOfflineRecovery: terminalOfflineRecovery });
  if (!identifier) return { ok: false, status: 401, code: "device_id_required", error: "device_id is required." };
  if (!device || (!device.device_active && !terminalOfflineRecovery)) return { ok: false, status: 401, code: "device_not_registered", error: "Registered device is required." };
  if (!isEligibleEmployeeDevice(device) && !terminalOfflineRecovery) {
    return { ok: false, status: 403, code: "device_not_eligible", error: "An active canonical employee kiosk assignment is required." };
  }

  const policy = await store.getPolicy();
  const rawToken = requestCredentialToken(req);
  const parts = credentialTokenParts(rawToken);
  if (parts) {
    const row = await store.findCredential(parts.credentialId);
    const expiresAt = Date.parse(String(row?.expires_at || ""));
    const tokenMatchesDevice = Boolean(
      row
      && String(row.device_id || "") === String(device.canonical_device_pk || "")
      && row.token_hash
      && safeEqual(row.token_hash, tokenHash(parts.secret, env))
    );
    const valid = Boolean(tokenMatchesDevice && !row.revoked_at && Number.isFinite(expiresAt) && expiresAt > now.getTime());
    const normalCommitEligible = Boolean(device?.device_active && isEligibleEmployeeDevice(device));
    if (valid && normalCommitEligible) {
      const metadata = row?.metadata_json;
      const operationBound = Boolean(
        metadata
        && typeof metadata === "object"
        && !Array.isArray(metadata)
        && (
          Object.prototype.hasOwnProperty.call(metadata, "enrollment_operation_id")
          || Object.prototype.hasOwnProperty.call(metadata, "enrollment_flow")
        )
      );
      if (!row.confirmed_at && operationBound) {
        await audit(store, authEvent(req, device, {
          credentialId: row.credential_id,
          eventType: "device_auth_failed",
          success: false,
          reason: "enrollment_operation_unconfirmed",
          env,
        }));
        return {
          ok: false,
          status: 409,
          code: "device_enrollment_confirmation_required",
          error: "Secure local credential storage must be confirmed before employee services can be used.",
          device,
          policy_mode: policy.mode,
          enrollment_required: true,
        };
      }
      const nowIso = now.toISOString();
      const fingerprintPatch = {
        last_used_at: nowIso,
        last_user_agent_hash: privacyHash(requestUserAgent(req), env, "ua"),
        last_ip_hash: privacyHash(requestIp(req), env, "ip"),
      };
      let credential = row;
      if (!row.confirmed_at) {
        await store.touchCredential(row.credential_id, { ...fingerprintPatch, confirmed_at: nowIso });
        credential = { ...row, ...fingerprintPatch, confirmed_at: nowIso };
        await audit(store, authEvent(req, device, {
          credentialId: row.credential_id,
          eventType: "device_credential_confirmed",
          success: true,
          env,
        }));
      } else {
        const lastUsedMs = Date.parse(String(row.last_used_at || row.confirmed_at || row.created_at || ""));
        if (!Number.isFinite(lastUsedMs) || now.getTime() - lastUsedMs > 5 * 60 * 1000) {
          void store.touchCredential(row.credential_id, fingerprintPatch)
            .catch((error) => console.warn("device credential touch failed:", error?.message || error));
          credential = { ...row, ...fingerprintPatch };
        }
      }
      return {
        ok: true,
        device,
        credentialed: true,
        credential,
        policy_mode: policy.mode,
        enrollment_required: false,
      };
    }
    // A token that still cryptographically proves this canonical device may
    // activate or submit only work bound to its previously issued snapshot.
    // It never restores general access after revocation, expiry, deactivation,
    // or assignment loss; the database verifies that the work began while the
    // snapshot and credential were valid.
    if (terminalOfflineRecovery && tokenMatchesDevice) {
      await audit(store, authEvent(req, device, {
        credentialId: row.credential_id,
        eventType: "device_offline_recovery_submission",
        success: true,
        reason: row?.revoked_at ? "revoked_credential_recovery_only" : "expired_or_ineligible_credential_recovery_only",
        env,
      }));
      return {
        ok: true,
        device,
        credentialed: true,
        credential: row,
        offline_recovery_only: true,
        policy_mode: policy.mode,
        enrollment_required: false,
      };
    }
    await audit(store, authEvent(req, device, {
      credentialId: parts.credentialId,
      eventType: "device_auth_failed",
      success: false,
      reason: row?.revoked_at ? "revoked" : "invalid_or_expired_credential",
      env,
    }));
  }

  if (policy.mode !== "enforce") {
    return {
      ok: true,
      device,
      credentialed: false,
      credential: null,
      legacy: true,
      policy_mode: policy.mode,
      enrollment_required: policy.mode === "enroll",
    };
  }

  return {
    ok: false,
    status: 401,
    code: "device_credential_required",
    error: "This device must be enrolled before it can access employee services.",
    device,
    policy_mode: policy.mode,
    enrollment_required: true,
  };
}

export function makeDeviceCredentialMiddleware(options = {}) {
  return async function requireDeviceCredential(req, res, next) {
    try {
      const result = await authenticateDeviceCredentialRequest(req, options);
      if (!result.ok) {
        res.status(result.status || 401).json({
          ok: false,
          code: result.code || "device_auth_failed",
          error: result.error || "Device authentication failed.",
          enrollment_required: Boolean(result.enrollment_required),
          policy_mode: result.policy_mode || null,
        });
        return;
      }
      req.memphisDevice = result.device;
      req.memphisDeviceCredential = result.credential || null;
      req.memphisDeviceAuth = result;
      if (result.enrollment_required) res.setHeader("X-Device-Enrollment-Required", "true");
      next();
    } catch (error) {
      console.error("device credential authentication failed:", error);
      res.status(error?.status || 503).json({ ok: false, code: "device_auth_unavailable", error: error?.message || "Device authentication is temporarily unavailable." });
    }
  };
}

function managerIdentity(req) {
  return String(req?.memphisAuth?.manager_display_name || req?.memphisAuth?.manager_id || req?.memphisAuth?.device_id || req?.memphisAuth?.session_id || "ops_manager").slice(0, 160);
}

function deviceSecurityRateKey(req, env) {
  return hmacHex(env, "device-security-rate", `${managerId(req) || "unknown"}|${credentialId(req) || "unknown"}|${requestIp(req) || "unknown"}`);
}

async function auditDeviceSecurity(store, req, { eventType, success, reason = null, metadata = {}, env = process.env } = {}) {
  await audit(store, {
    device_id: null,
    credential_id: null,
    event_type: String(eventType || "device_security").slice(0, 100),
    success: Boolean(success),
    reason: reason ? String(reason).slice(0, 500) : null,
    presented_identifier: managerId(req) || credentialId(req) || null,
    ip_hash: privacyHash(requestIp(req), env, "ip"),
    user_agent_hash: privacyHash(requestUserAgent(req), env, "ua"),
    metadata_json: {
      manager_id: managerId(req),
      manager_credential_id: credentialId(req),
      ...metadata,
    },
  });
}

async function verifyDeviceSecuritySession(req, { store, env = process.env, requireCsrf = false } = {}) {
  if (!(await hasAuthoritativeSecurityAdminRole(req, store))) {
    return { ok: false, status: 403, error: "Security Admin access is required." };
  }
  const config = await store.getDeviceSecurityConfig?.();
  if (!config?.password_hash) return { ok: false, status: 503, error: "Device Security password is not initialized." };
  const parts = deviceSecuritySessionParts(req);
  if (!parts) return { ok: false, status: 401, error: "Device Security password is required." };
  const row = await store.findDeviceSecuritySession?.(parts.sessionId);
  const now = Date.now();
  const valid = Boolean(
    row
    && !row.revoked_at
    && row.manager_id === managerId(req)
    && row.credential_id === credentialId(req)
    && row.password_version === config.password_version
    && Date.parse(row.expires_at) > now
    && row.token_hash
    && safeEqual(row.token_hash, deviceSecurityHash(parts.secret, env))
    && (!config.sessions_revoked_at || Date.parse(row.created_at) > Date.parse(config.sessions_revoked_at))
  );
  if (!valid) return { ok: false, status: 401, error: "Device Security password is required." };
  if (requireCsrf) {
    const csrf = String(req?.header?.("x-device-security-csrf") || req?.headers?.["x-device-security-csrf"] || "").trim();
    if (!csrf || !safeEqual(row.csrf_hash, deviceSecurityCsrfHash(csrf, env))) {
      return { ok: false, status: 403, error: "Device Security request could not be verified." };
    }
  }
  await store.touchDeviceSecuritySession?.(row.session_id);
  return { ok: true, session: row };
}

function makeDeviceSecurityMiddleware({ store, env = process.env } = {}) {
  return async function requireDeviceSecuritySession(req, res, next) {
    try {
      const result = await verifyDeviceSecuritySession(req, { store, env, requireCsrf: req.method !== "GET" });
      if (!result.ok) {
        clearDeviceSecurityCookie(res, req, env);
        res.status(result.status || 401).json({ ok: false, error: result.error || "Device Security password is required.", device_security_locked: true });
        return;
      }
      req.memphisDeviceSecurity = result.session;
      await next();
    } catch (error) {
      res.status(error?.status || 500).json({ ok: false, error: error?.message || "Device Security authorization failed." });
    }
  };
}

async function activeDeviceCoverage({ supabase, now = new Date() }) {
  const expectedDeviceIds = Array.from({ length: 9 }, (_value, index) => `KIOSK_${String(index + 2).padStart(2, "0")}`);
  const { data: devices, error: deviceError } = await supabase
    .from("devices")
    .select("id,device_id,device_name,active,assigned_employee_id,employees!devices_assigned_employee_id_fkey(display_name,employee_code,active)")
    .in("device_id", expectedDeviceIds)
    .order("device_id");
  if (deviceError) throw deviceError;
  const { data: credentials, error: credentialError } = await supabase
    .from("device_auth_credentials")
    .select("credential_id,device_id,device_label,created_at,confirmed_at,last_used_at,expires_at,revoked_at,revoked_reason")
    .is("revoked_at", null)
    .gt("expires_at", now.toISOString());
  if (credentialError) throw credentialError;
  const byCanonicalId = new Map((devices || []).map((row) => [String(row.device_id || "").toUpperCase(), row]));
  const byDevicePk = new Map((credentials || []).map((row) => [String(row.device_id), row]));
  const rows = expectedDeviceIds.map((expectedId) => {
    const device = byCanonicalId.get(expectedId) || null;
    const employee = Array.isArray(device?.employees) ? device.employees[0] : device?.employees;
    const credential = device ? byDevicePk.get(String(device.id)) || null : null;
    const assignmentValid = Boolean(device?.assigned_employee_id && employee?.active === true && /^EMP\d+$/i.test(String(employee?.employee_code || "")));
    return {
      device_pk: device?.id || null,
      device_id: expectedId,
      device_name: device?.device_name || null,
      registry_present: Boolean(device),
      device_active: device?.active === true,
      employee_id: device?.assigned_employee_id || null,
      employee_name: employee?.display_name || null,
      employee_code: employee?.employee_code || null,
      employee_active: employee?.active === true,
      assignment_valid: assignmentValid,
      credential,
      enrolled: Boolean(credential),
      confirmed: Boolean(credential?.confirmed_at),
      ready: Boolean(device?.active === true && assignmentValid && credential?.confirmed_at),
    };
  });
  return {
    devices: rows,
    total: expectedDeviceIds.length,
    enrolled: rows.filter((row) => row.enrolled).length,
    ready: rows.filter((row) => row.ready).length,
    missing: rows.filter((row) => !row.ready).map((row) => row.device_id),
    ready_to_enforce: rows.length === expectedDeviceIds.length && rows.every((row) => row.ready),
  };
}

export function installDeviceCredentialRoutes(app, {
  setCors,
  env = process.env,
  supabase,
  store: suppliedStore = null,
  runReadOnlySql,
  requireOpsAuth,
  requireOpsWrite,
} = {}) {
  const applyCors = typeof setCors === "function" ? setCors : (_res) => {};
  const store = suppliedStore || createSupabaseDeviceCredentialStore(supabase);
  if (!store) throw new Error("A device credential store is required for device credential routes.");

  const deviceRouteCors = (req, res, next) => {
    applyCors(res, req);
    res.setHeader("Cache-Control", "no-store");
    if (req.method === "OPTIONS") { res.sendStatus(200); return; }
    next();
  };
  app.use("/device-auth", deviceRouteCors);
  app.use("/admin-api/device-auth", deviceRouteCors);
  app.use("/admin-api/device-security", deviceRouteCors);

  const requireDeviceSecurity = makeDeviceSecurityMiddleware({ store, env });

  app.get("/admin-api/device-security/session", requireOpsAuth, async (req, res) => {
    try {
      if (!(await hasAuthoritativeSecurityAdminRole(req, store))) {
        res.status(403).json({ ok: false, error: "Security Admin access is required.", device_security_locked: true });
        return;
      }
      const config = await store.getDeviceSecurityConfig?.();
      const unlocked = config?.password_hash
        ? (await verifyDeviceSecuritySession(req, { store, env, requireCsrf: false })).ok
        : false;
      res.status(200).json({
        ok: true,
        data: {
          configured: Boolean(config?.password_hash),
          unlocked,
          expires_at: unlocked ? new Date(Date.now() + DEVICE_SECURITY_SESSION_TTL_MS).toISOString() : null,
          manager_id: managerId(req),
          roles: req.memphisAuth?.roles || [],
        },
      });
    } catch (error) {
      res.status(500).json({ ok: false, error: error?.message || "Device Security session check failed." });
    }
  });

  app.post("/admin-api/device-security/unlock", requireOpsAuth, async (req, res) => {
    try {
      if (!(await hasAuthoritativeSecurityAdminRole(req, store))) {
        await auditDeviceSecurity(store, req, { eventType: "device_security_unlock_denied", success: false, reason: "not_security_admin", env });
        res.status(403).json({ ok: false, error: "Device Security password rejected." });
        return;
      }
      const config = await store.getDeviceSecurityConfig?.();
      if (!config?.password_hash) {
        res.status(503).json({ ok: false, error: "Device Security password is not initialized." });
        return;
      }
      const rateKey = deviceSecurityRateKey(req, env);
      const rate = await store.getDeviceSecurityRateLimit?.(rateKey);
      if (rate?.locked_until && Date.parse(rate.locked_until) > Date.now()) {
        await auditDeviceSecurity(store, req, { eventType: "device_security_unlock_locked", success: false, reason: "locked", env });
        res.setHeader("Retry-After", String(Math.ceil((Date.parse(rate.locked_until) - Date.now()) / 1000)));
        res.status(429).json({ ok: false, error: "Device Security password rejected." });
        return;
      }
      const password = String(req.body?.password || "");
      const verified = password ? await argon2.verify(config.password_hash, password, { type: argon2.argon2id }).catch(() => false) : false;
      if (!verified) {
        const nextRate = await store.recordDeviceSecurityFailure?.(rateKey, { manager_id: managerId(req) });
        await auditDeviceSecurity(store, req, { eventType: "device_security_unlock_failed", success: false, reason: "invalid_password", metadata: { failure_count: nextRate?.failure_count || null }, env });
        if (nextRate?.locked_until) res.setHeader("Retry-After", String(Math.ceil((Date.parse(nextRate.locked_until) - Date.now()) / 1000)));
        res.status(nextRate?.locked_until ? 429 : 401).json({ ok: false, error: "Device Security password rejected." });
        return;
      }
      await store.clearDeviceSecurityFailures?.(rateKey);
      const sessionId = randomUUID();
      const secret = randomBytes(32).toString("base64url");
      const csrf = randomBytes(32).toString("base64url");
      const expiresAt = new Date(Date.now() + DEVICE_SECURITY_SESSION_TTL_MS).toISOString();
      const row = await store.createDeviceSecuritySession?.({
        session_id: sessionId,
        manager_id: managerId(req),
        credential_id: credentialId(req),
        token_hash: deviceSecurityHash(secret, env),
        csrf_hash: deviceSecurityCsrfHash(csrf, env),
        password_version: config.password_version,
        expires_at: expiresAt,
        ip_hash: privacyHash(requestIp(req), env, "ip"),
        user_agent_hash: privacyHash(requestUserAgent(req), env, "ua"),
        metadata_json: { unlock: "device_security_password" },
      });
      setDeviceSecurityCookie(res, `${sessionId}.${secret}`, req, env);
      await auditDeviceSecurity(store, req, { eventType: "device_security_unlock_success", success: true, env });
      res.status(200).json({ ok: true, data: { unlocked: true, expires_at: row?.expires_at || expiresAt, csrf_token: csrf } });
    } catch (error) {
      res.status(500).json({ ok: false, error: "Device Security unlock failed." });
    }
  });

  app.post("/admin-api/device-security/lock", requireOpsAuth, async (req, res) => {
    try {
      const parts = deviceSecuritySessionParts(req);
      if (parts) await store.revokeDeviceSecuritySession?.(parts.sessionId, "manual_lock");
      clearDeviceSecurityCookie(res, req, env);
      res.status(200).json({ ok: true, data: { locked: true } });
    } catch (error) {
      clearDeviceSecurityCookie(res, req, env);
      res.status(200).json({ ok: true, data: { locked: true } });
    }
  });

  app.post("/admin-api/device-security/sessions/revoke-all", requireOpsAuth, requireDeviceSecurity, async (_req, res) => {
    try {
      const revoked = await store.revokeAllDeviceSecuritySessions?.("security_admin_revoke_all");
      res.status(200).json({ ok: true, data: { revoked_count: revoked?.length || 0 } });
    } catch (error) {
      res.status(500).json({ ok: false, error: "Device Security sessions could not be revoked." });
    }
  });

  app.get("/device-auth/status", async (req, res) => {
    try {
      const result = await authenticateDeviceCredentialRequest(req, { env, store, runReadOnlySql });
      if (!result.device) {
        res.status(result.status || 401).json({ ok: false, code: result.code || "device_auth_failed", error: result.error || "Device not found." });
        return;
      }
      const authenticated = Boolean(result.credentialed);
      res.status(200).json({
        ok: true,
        data: {
          authenticated,
          enrollment_required: Boolean(result.enrollment_required),
          policy_mode: result.policy_mode,
          requested_device_id: result.device.requested_device_id,
          canonical_device_id: result.device.canonical_device_id,
          device_name: authenticated ? result.device.device_name : null,
          employee_name: authenticated ? result.device.assigned_employee_name : null,
          credential_id: authenticated ? (result.credential?.credential_id || null) : null,
          credential_expires_at: authenticated ? (result.credential?.expires_at || null) : null,
        },
      });
    } catch (error) {
      res.status(error?.status || 503).json({ ok: false, code: "device_auth_unavailable", error: error?.message || "Device authentication is unavailable." });
    }
  });

  app.post("/device-auth/enroll", async (req, res) => {
    const attempt = consumeEnrollmentAttempt(req);
    if (!attempt.allowed) {
      res.setHeader("Retry-After", String(attempt.retryAfterSeconds));
      res.status(429).json({ ok: false, code: "device_enrollment_rate_limited", error: "Too many enrollment attempts." });
      return;
    }
    try {
      const { device } = await resolveDevice(req, runReadOnlySql);
      if (!isEligibleEmployeeDevice(device)) {
        res.status(401).json({ ok: false, code: "device_not_eligible", error: "An active canonical employee kiosk assignment is required." });
        return;
      }
      const code = String(req.body?.enrollment_code || req.body?.code || "").replace(/\D/g, "").slice(0, 8);
      if (!/^\d{8}$/.test(code)) {
        res.status(400).json({ ok: false, code: "invalid_enrollment_code", error: "Enter the eight-digit enrollment code." });
        return;
      }
      const credentialId = randomUUID();
      const secret = randomBytes(32).toString("base64url");
      const expiresAt = new Date(Date.now() + credentialTtlDays(env) * 24 * 60 * 60 * 1000).toISOString();
      const fingerprint = {
        userAgentHash: privacyHash(requestUserAgent(req), env, "ua"),
        ipHash: privacyHash(requestIp(req), env, "ip"),
      };
      const consumed = await store.consumeEnrollmentCode({
        devicePk: device.canonical_device_pk,
        codeHash: enrollmentCodeHash(device.canonical_device_pk, code, env),
        credentialId,
        credentialTokenHash: tokenHash(secret, env),
        deviceLabel: String(req.body?.device_label || device.device_name || device.canonical_device_id || "Employee device").slice(0, 160),
        expiresAt,
        userAgentHash: fingerprint.userAgentHash,
        ipHash: fingerprint.ipHash,
        metadata: { requested_device_id: device.requested_device_id, matched_by: device.matched_by },
      });
      clearEnrollmentAttempts(req);
      setDeviceCredentialCookie(res, `${credentialId}.${secret}`, req, env);
      res.status(200).json({
        ok: true,
        data: {
          enrolled: true,
          credential_id: credentialId,
          credential_expires_at: consumed?.expires_at || expiresAt,
          canonical_device_id: device.canonical_device_id,
          device_name: device.device_name,
          employee_name: device.assigned_employee_name,
        },
      });
    } catch (error) {
      console.warn("device enrollment failed:", error?.message || error);
      const invalid = error?.code === "invalid_enrollment_code" || /invalid or expired enrollment code/i.test(String(error?.message || ""));
      res.status(invalid ? 401 : 500).json({
        ok: false,
        code: invalid ? "invalid_enrollment_code" : "device_enrollment_failed",
        error: invalid ? "The enrollment code is invalid or expired." : "Device enrollment failed.",
      });
    }
  });

  app.post("/device-auth/logout", async (req, res) => {
    const deviceId = requestHeaderDeviceIdentifier(req);
    if (!deviceId) {
      res.status(400).json({ ok: false, error: "X-Device-Id is required." });
      return;
    }
    try {
      const parts = credentialTokenParts(requestCredentialToken(req));
      const row = parts ? await store.revokeByTokenHash(tokenHash(parts.secret, env), "device_logout") : null;
      await audit(store, authEvent(req, row ? { canonical_device_pk: row.device_id } : null, {
        credentialId: row?.credential_id || parts?.credentialId || null,
        eventType: "device_credential_logout",
        success: Boolean(row || !parts),
        reason: row ? "device_logout" : (parts ? "credential_not_found" : "no_credential_presented"),
        metadata: { requested_device_id: deviceId },
        env,
      }));
    } catch (error) {
      console.warn("device credential logout failed:", error?.message || error);
      res.status(503).json({ ok: false, code: "device_logout_failed", error: "Device logout could not be durably recorded." });
      return;
    }
    clearDeviceCredentialCookie(res, req, env);
    res.status(200).json({ ok: true, data: { logged_out: true } });
  });

  app.get("/admin-api/device-auth/summary", requireOpsAuth, requireDeviceSecurity, async (_req, res) => {
    try {
      const [policy, coverage] = await Promise.all([store.getPolicy(), activeDeviceCoverage({ supabase })]);
      res.status(200).json({ ok: true, data: { policy, coverage } });
    } catch (error) {
      res.status(500).json({ ok: false, error: error?.message || "Device authentication summary failed." });
    }
  });

  app.post("/admin-api/device-auth/enrollment-code", requireOpsWrite, requireDeviceSecurity, async (req, res) => {
    try {
      const identifier = normalizeDeviceIdentifier(req.body?.device_id || req.body?.deviceId || "");
      const device = await resolveActiveAssignedDevice({ runReadOnlySql, deviceIdentifier: identifier });
      if (!isEligibleEmployeeDevice(device)) {
        res.status(404).json({ ok: false, error: "Active canonical employee kiosk assignment not found." });
        return;
      }
      const code = String(randomInt(0, 100_000_000)).padStart(8, "0");
      const expiresAt = new Date(Date.now() + enrollmentTtlMinutes(env) * 60 * 1000).toISOString();
      const row = await store.issueEnrollmentCode({
        devicePk: device.canonical_device_pk,
        codeHash: enrollmentCodeHash(device.canonical_device_pk, code, env),
        createdBy: managerIdentity(req),
        expiresAt,
        metadata: { canonical_device_id: device.canonical_device_id, employee_name: device.assigned_employee_name, purpose: "employee_device_enrollment", max_uses: 1 },
      });
      await audit(store, authEvent(req, device, { eventType: "enrollment_code_issued", success: true, metadata: { enrollment_id: row?.enrollment_id, manager_id: managerId(req) }, env }));
      await store.auditSecurityCode?.({
        code_id: row?.enrollment_id || null,
        purpose: "employee_device_enrollment",
        target_device_id: device.canonical_device_pk,
        manager_id: managerId(req),
        credential_id: credentialId(req),
        event_type: "created",
        metadata_json: { canonical_device_id: device.canonical_device_id, max_uses: 1 },
      });
      res.status(200).json({
        ok: true,
        data: {
          enrollment_code: code,
          enrollment_id: row?.enrollment_id || null,
          code_id: row?.enrollment_id || null,
          purpose: "employee_device_enrollment",
          max_uses: 1,
          expires_at: row?.expires_at || expiresAt,
          canonical_device_id: device.canonical_device_id,
          device_name: device.device_name,
          employee_name: device.assigned_employee_name,
        },
      });
    } catch (error) {
      res.status(500).json({ ok: false, error: error?.message || "Could not issue enrollment code." });
    }
  });

  app.post("/admin-api/device-auth/mode", requireOpsWrite, requireDeviceSecurity, async (req, res) => {
    try {
      const requestedMode = String(req.body?.mode || "").trim().toLowerCase();
      if (!VALID_POLICY_MODES.has(requestedMode)) {
        res.status(400).json({ ok: false, error: "mode must be observe, enroll, enforce-ready, or enforce." });
        return;
      }
      const [coverage, previousPolicy] = await Promise.all([
        activeDeviceCoverage({ supabase }),
        store.getPolicy(),
      ]);
      if (["enforce-ready", "enforce"].includes(requestedMode) && !coverage.ready_to_enforce) {
        res.status(409).json({ ok: false, error: "All nine employee kiosks must be enrolled before enforcement can begin.", missing_devices: coverage.missing });
        return;
      }
      const policy = await store.setPolicy(requestedMode, managerIdentity(req));
      await audit(store, authEvent(req, null, {
        eventType: "device_auth_policy_changed",
        success: true,
        metadata: { mode: requestedMode, previous_mode: previousPolicy?.mode || null },
        env,
      }));
      res.status(200).json({ ok: true, data: { policy, coverage } });
    } catch (error) {
      res.status(500).json({ ok: false, error: error?.message || "Could not update device authentication mode." });
    }
  });

  app.post("/admin-api/device-auth/codes/:codeId/revoke", requireOpsWrite, requireDeviceSecurity, async (req, res) => {
    try {
      const codeId = String(req.params?.codeId || "").trim();
      if (!UUID_PATTERN.test(codeId)) {
        res.status(400).json({ ok: false, error: "codeId must be a UUID." });
        return;
      }
      const row = await store.revokeEnrollmentCode?.(codeId, { managerId: managerId(req), reason: req.body?.reason || "revoked_by_security_admin" });
      await store.auditSecurityCode?.({
        code_id: codeId,
        purpose: "employee_device_enrollment",
        target_device_id: row?.device_id || null,
        manager_id: managerId(req),
        credential_id: credentialId(req),
        event_type: "revoked",
        metadata_json: { revoked: Boolean(row) },
      });
      res.status(200).json({ ok: true, data: { revoked: Boolean(row), code: row } });
    } catch (error) {
      res.status(500).json({ ok: false, error: error?.message || "Could not revoke security code." });
    }
  });

  app.post("/admin-api/device-auth/credentials/:credentialId/revoke", requireOpsWrite, requireDeviceSecurity, async (req, res) => {
    try {
      const credentialId = String(req.params?.credentialId || "").trim();
      if (!UUID_PATTERN.test(credentialId)) {
        res.status(400).json({ ok: false, error: "credentialId must be a UUID." });
        return;
      }
      const reason = req.body?.reason || "revoked_by_manager";
      const row = await store.revokeCredential(credentialId, reason);
      await audit(store, authEvent(req, row ? { canonical_device_pk: row.device_id } : null, {
        credentialId,
        eventType: "device_credential_revoked",
        success: Boolean(row),
        reason: String(reason),
        env,
      }));
      res.status(200).json({ ok: true, data: { revoked: Boolean(row), credential: row } });
    } catch (error) {
      res.status(500).json({ ok: false, error: error?.message || "Could not revoke device credential." });
    }
  });

  return { store };
}

export const deviceCredentialInternals = {
  DEVICE_COOKIE_NAME,
  normalizePolicyMode,
  requestDeviceIdentifier,
  requestHeaderDeviceIdentifier,
  credentialTokenParts,
  tokenHash,
  enrollmentCodeHash,
  credentialTtlDays,
  enrollmentTtlMinutes,
  isEligibleEmployeeDevice,
  activeDeviceCoverage,
};
