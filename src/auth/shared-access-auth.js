import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { loginGeminiAdmin, verifyGeminiAdminToken } from "./gemini-admin-auth.js";

const MEMPHIS_TIME_ZONE = "America/Chicago";
const OPS_ACCESS_TOKEN_VERSION = 2;
const DEFAULT_ACCESS_TTL_MS = 15 * 60 * 1000;
const DEFAULT_TRUST_TTL_MS = 10 * 365 * 24 * 60 * 60 * 1000;
const MIN_ACCESS_TTL_MS = 60_000;
const MAX_ACCESS_TTL_MS = 60 * 60 * 1000;
const MIN_TRUST_TTL_MS = 24 * 60 * 60 * 1000;
const OPS_TRUST_COOKIE = "memphis_ops_trust";
const ENROLLMENT_WINDOW_MS = 15 * 60 * 1000;
const ENROLLMENT_ATTEMPT_LIMIT = 5;
const PAIRING_TOKEN_MIN_TTL_SECONDS = 60;
const PAIRING_TOKEN_DEFAULT_TTL_SECONDS = 10 * 60;
const PAIRING_TOKEN_MAX_TTL_SECONDS = 15 * 60;
const enrollmentAttempts = new Map();

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function truthy(value) {
  return /^(1|true|yes|on)$/i.test(String(value || "").trim());
}

function isProductionLike(env = process.env) {
  return String(env.NODE_ENV || "").trim().toLowerCase() === "production" || truthy(env.RENDER) || truthy(env.IS_RENDER);
}

export function opsManagerAuthRequired(env = process.env) {
  const configured = String(env.OPS_MANAGER_AUTH_REQUIRED || "").trim();
  if (configured) return truthy(configured);
  return isProductionLike(env);
}

function boundedNumber(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

function getCSTDate(date = new Date()) {
  return date.toLocaleString("en-CA", {
    timeZone: MEMPHIS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

export function normalizeOpsAccessLevel(value) {
  const normalized = String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  return ["full", "write", "admin", "full_access"].includes(normalized) ? "full_access" : "read_only";
}

function requestedOpsAccessLevel(req) {
  return normalizeOpsAccessLevel(
    req?.query?.access_level
      || req?.query?.manager_access
      || req?.body?.access_level
      || req?.body?.manager_access
      || req?.header?.("x-ops-access-level")
      || "read_only"
  );
}

function clampAccessLevel(requested, maximum) {
  const wanted = normalizeOpsAccessLevel(requested);
  const ceiling = normalizeOpsAccessLevel(maximum);
  return ceiling === "full_access" ? wanted : "read_only";
}

function normalizeDeviceId(deviceId) {
  return String(deviceId || "")
    .trim()
    .replace(/[^a-zA-Z0-9_.:-]/g, "")
    .slice(0, 96);
}

function normalizeDeviceLabel(value) {
  return String(value || "").trim().replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 160);
}

function requestDeviceId(req) {
  return normalizeDeviceId(
    req?.body?.device_id
      || req?.body?.deviceId
      || req?.query?.device_id
      || req?.query?.deviceId
      || req?.header?.("x-device-id")
      || ""
  );
}

function requestDeviceLabel(req) {
  return normalizeDeviceLabel(req?.body?.device_label || req?.body?.deviceLabel || req?.header?.("x-device-label") || "");
}

function normalizePairingToken(value) {
  const token = String(value || "").trim();
  if (!/^[a-f0-9]{64}$/i.test(token)) return "";
  return token.toLowerCase();
}

function requestPairingToken(req) {
  return normalizePairingToken(
    req?.body?.pairing_token
      || req?.body?.pairingToken
      || req?.body?.token
      || req?.query?.ops_pairing_token
      || req?.query?.pairing_token
      || req?.query?.token
      || ""
  );
}

function pairingEnrollmentUrl({ token, req = null, env = process.env } = {}) {
  const base = String(req?.body?.return_url || req?.body?.returnUrl || getManagerHubUrl(env)).trim();
  const url = new URL(base || getManagerHubUrl(env));
  url.searchParams.set("ops_pairing_token", token);
  return url.toString();
}

function bearerToken(req) {
  const authorization = String(req?.header?.("authorization") || "").trim();
  if (/^bearer\s+/i.test(authorization)) return authorization.replace(/^bearer\s+/i, "").trim();
  return String(req?.header?.("x-memphis-auth") || req?.header?.("x-gemini-admin-token") || "").trim();
}

function adminApiKey(req) {
  return String(req?.header?.("x-admin-key") || req?.header?.("x-api-key") || "").trim();
}

function getSessionSecret(env = process.env) {
  return String(
    env.OPS_MANAGER_SESSION_SECRET
      || env.GEMINI_ADMIN_SESSION_SECRET
      || env.MOXIE_WEB_COOKIE_SECRET
      || env.SUPABASE_SERVICE_ROLE_KEY
      || ""
  ).trim();
}

function getPairingTtlSeconds(value) {
  return Math.floor(boundedNumber(
    value,
    PAIRING_TOKEN_DEFAULT_TTL_SECONDS,
    PAIRING_TOKEN_MIN_TTL_SECONDS,
    PAIRING_TOKEN_MAX_TTL_SECONDS,
  ));
}

function getManagerHubUrl(env = process.env) {
  return String(
    env.OPS_MANAGER_HUB_URL
      || env.MANAGER_HUB_URL
      || "https://lasrevinu333-design.github.io/Engine/start_page1.html"
  ).trim();
}

function getAccessTtlMs(env = process.env) {
  return boundedNumber(env.OPS_MANAGER_ACCESS_TTL_MS, DEFAULT_ACCESS_TTL_MS, MIN_ACCESS_TTL_MS, MAX_ACCESS_TTL_MS);
}

function getTrustTtlMs(env = process.env) {
  return boundedNumber(env.OPS_MANAGER_TRUST_TTL_MS, DEFAULT_TRUST_TTL_MS, MIN_TRUST_TTL_MS, DEFAULT_TRUST_TTL_MS);
}

function hmacHex(secret, value) {
  return createHmac("sha256", secret).update(String(value || "")).digest("hex");
}

function signOpsPayload(payload, { env = process.env } = {}) {
  const secret = getSessionSecret(env);
  if (!secret) {
    const error = new Error("Ops Manager session secret is not configured.");
    error.status = 503;
    throw error;
  }
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

function parseOpsToken(token, { env = process.env, now = new Date() } = {}) {
  const secret = getSessionSecret(env);
  if (!secret) return { ok: false, status: 503, error: "Ops Manager session secret is not configured." };
  const raw = String(token || "").trim();
  const [encoded, signature, extra] = raw.split(".");
  if (!encoded || !signature || extra !== undefined) return { ok: false, status: 401, error: "Ops Manager authentication required." };
  const expected = createHmac("sha256", secret).update(encoded).digest("base64url");
  if (!safeEqual(signature, expected)) return { ok: false, status: 401, error: "Ops Manager authentication required." };
  let payload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return { ok: false, status: 401, error: "Ops Manager authentication required." };
  }
  if (payload?.v !== OPS_ACCESS_TOKEN_VERSION || payload?.role !== "ops_manager") {
    return { ok: false, status: 401, error: "Ops Manager authentication required." };
  }
  const expiresAt = Number(payload.exp);
  if (!Number.isFinite(expiresAt) || expiresAt <= now.getTime()) {
    return { ok: false, status: 401, error: "Ops Manager access token expired." };
  }
  const accessLevel = normalizeOpsAccessLevel(payload.access_level);
  const session = {
    role: "ops_manager",
    token: raw,
    credential_id: String(payload.credential_id || ""),
    device_id: normalizeDeviceId(payload.device_id),
    operational_day: String(payload.operational_day || getCSTDate(now)),
    expires_at: new Date(expiresAt).toISOString(),
    auth_mode: String(payload.auth_mode || "trusted_device"),
    access_level: accessLevel,
    read_only: accessLevel === "read_only",
    trusted_device: payload.auth_mode === "trusted_device",
  };
  return { ok: true, session, payload };
}

export function createOpsManagerSession({
  credentialId = "",
  deviceId,
  now = new Date(),
  env = process.env,
  authMode = "trusted_device",
  accessLevel = "read_only",
  maximumAccessLevel = "full_access",
} = {}) {
  const normalizedAccessLevel = clampAccessLevel(accessLevel, maximumAccessLevel);
  const expiresAt = now.getTime() + getAccessTtlMs(env);
  const payload = {
    v: OPS_ACCESS_TOKEN_VERSION,
    role: "ops_manager",
    credential_id: String(credentialId || ""),
    device_id: normalizeDeviceId(deviceId || "manager-device"),
    operational_day: getCSTDate(now),
    auth_mode: String(authMode || "trusted_device"),
    access_level: normalizedAccessLevel,
    iat: now.getTime(),
    exp: expiresAt,
    jti: randomUUID(),
  };
  return {
    role: payload.role,
    credential_id: payload.credential_id,
    device_id: payload.device_id,
    operational_day: payload.operational_day,
    auth_mode: payload.auth_mode,
    access_level: payload.access_level,
    read_only: payload.access_level === "read_only",
    trusted_device: payload.auth_mode === "trusted_device",
    expires_at: new Date(expiresAt).toISOString(),
    token: signOpsPayload(payload, { env }),
  };
}

export function createAdminApiKeySession({ deviceId, now = new Date(), env = process.env } = {}) {
  return createOpsManagerSession({
    deviceId: deviceId || "admin-api-key",
    now,
    env,
    authMode: "admin_api_key",
    accessLevel: "full_access",
    maximumAccessLevel: "full_access",
  });
}

export function createPublicOpsManagerSession({
  deviceId = "manager-browser",
  now = new Date(),
  env = process.env,
  accessLevel = "full_access",
} = {}) {
  if (opsManagerAuthRequired(env)) {
    const error = new Error("Ops Manager authentication is required on this deployment.");
    error.status = 401;
    throw error;
  }
  return createOpsManagerSession({
    deviceId,
    now,
    env,
    authMode: "operations_first",
    accessLevel,
    maximumAccessLevel: "full_access",
  });
}

export function createOpenOpsManagerSession(options = {}) {
  return createPublicOpsManagerSession(options);
}

export function getSharedAccessConfig(env = process.env) {
  const adminApiKeyValue = String(env.ADMIN_API_KEY || "").trim();
  return {
    adminApiKey: adminApiKeyValue,
    sessionSecretConfigured: Boolean(getSessionSecret(env)),
    productionLike: isProductionLike(env),
    accessTtlMs: getAccessTtlMs(env),
    trustTtlMs: getTrustTtlMs(env),
    passwordlessManagerAccess: !opsManagerAuthRequired(env),
  };
}

export function authenticatePresentedOpsAccessRequest(req, { env = process.env, now = new Date() } = {}) {
  const configuredAdminApiKey = String(env.ADMIN_API_KEY || "").trim();
  const providedAdminApiKey = adminApiKey(req);
  if (providedAdminApiKey) {
    if (configuredAdminApiKey && safeEqual(providedAdminApiKey, configuredAdminApiKey)) {
      return { presented: true, ok: true, session: createAdminApiKeySession({ deviceId: requestDeviceId(req), now, env }) };
    }
    return { presented: true, ok: false, status: 401, error: "Unauthorized" };
  }

  const presentedBearer = bearerToken(req);
  if (presentedBearer) return { presented: true, ...parseOpsToken(presentedBearer, { env, now }) };
  return { presented: false, ok: false, status: 401, error: "Ops Manager authentication required." };
}

export function authenticateOpsAccessRequest(req, { env = process.env, now = new Date() } = {}) {
  const result = authenticatePresentedOpsAccessRequest(req, { env, now });
  if (result.presented) return result;
  return { ok: false, status: 401, error: "Ops Manager authentication required." };
}

export function makeOpsAccessMiddleware({ env = process.env, requireWrite = false, trustedDeviceStore = null, supabase = null } = {}) {
  const store = trustedDeviceStore || createSupabaseTrustedDeviceStore(supabase);
  return async function requireOpsAccess(req, res, next) {
    const result = authenticateOpsAccessRequest(req, { env });
    if (!result.ok) {
      res.status(result.status || 401).json({ ok: false, error: result.error || "Unauthorized" });
      return;
    }
    let session = result.session;
    try {
      const trustedState = await verifySessionAgainstTrustedDeviceStore(session, { store, env });
      if (!trustedState.ok) {
        res.status(trustedState.status || 401).json({ ok: false, error: trustedState.error || "Unauthorized" });
        return;
      }
      session = trustedState.session;
    } catch (error) {
      res.status(error?.status || 500).json({ ok: false, error: error?.message || "Ops Manager session verification failed." });
      return;
    }
    if (requireWrite && session?.read_only) {
      res.status(403).json({ ok: false, error: "Read-only Ops Manager session cannot make changes." });
      return;
    }
    req.memphisAuth = session;
    next();
  };
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

function trustCookieValue(req) {
  return String(parseCookies(req)[OPS_TRUST_COOKIE] || "").trim();
}

function cookieAttributes(env = process.env, { clear = false } = {}) {
  const production = isProductionLike(env);
  const sameSite = String(env.OPS_MANAGER_COOKIE_SAME_SITE || (production ? "None" : "Lax")).trim();
  const secure = production || truthy(env.OPS_MANAGER_COOKIE_SECURE);
  const attributes = ["Path=/", "HttpOnly", `SameSite=${sameSite || "Lax"}`, "Priority=High"];
  if (secure) attributes.push("Secure");
  if (production && sameSite.toLowerCase() === "none" && !truthy(env.OPS_MANAGER_COOKIE_DISABLE_PARTITIONED)) attributes.push("Partitioned");
  const domain = String(env.OPS_MANAGER_COOKIE_DOMAIN || "").trim();
  if (domain) attributes.push(`Domain=${domain}`);
  if (clear) attributes.push("Max-Age=0", "Expires=Thu, 01 Jan 1970 00:00:00 GMT");
  else attributes.push(`Max-Age=${Math.floor(getTrustTtlMs(env) / 1000)}`);
  return attributes.join("; ");
}

function setCookieHeader(res, value) {
  if (typeof res.append === "function") res.append("Set-Cookie", value);
  else if (typeof res.setHeader === "function") {
    const existing = res.getHeader?.("Set-Cookie");
    if (!existing) res.setHeader("Set-Cookie", value);
    else res.setHeader("Set-Cookie", Array.isArray(existing) ? [...existing, value] : [existing, value]);
  }
}

function setTrustCookie(res, value, env) {
  setCookieHeader(res, `${OPS_TRUST_COOKIE}=${encodeURIComponent(value)}; ${cookieAttributes(env)}`);
}

function clearTrustCookie(res, env) {
  setCookieHeader(res, `${OPS_TRUST_COOKIE}=; ${cookieAttributes(env, { clear: true })}`);
}

function trustTokenParts(value) {
  const raw = String(value || "").trim();
  const dot = raw.indexOf(".");
  if (dot <= 0) return null;
  const credentialId = raw.slice(0, dot);
  const secret = raw.slice(dot + 1);
  if (!/^[0-9a-f-]{36}$/i.test(credentialId) || !/^[A-Za-z0-9_-]{32,}$/.test(secret)) return null;
  return { credentialId, secret };
}

function trustTokenHash(secret, env) {
  const key = getSessionSecret(env);
  if (!key) throw Object.assign(new Error("Ops Manager session secret is not configured."), { status: 503 });
  return hmacHex(key, `trusted-device:${secret}`);
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

function privacyHash(value, env, prefix) {
  if (!value) return null;
  const secret = getSessionSecret(env);
  if (!secret) return null;
  return hmacHex(secret, `${prefix}:${value}`);
}

function enrollmentRateKey(req) {
  return `${requestIp(req) || "unknown"}|${requestDeviceId(req) || "unknown"}`;
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

function normalizeStoreRow(row) {
  if (!row || typeof row !== "object") return null;
  return {
    credential_id: String(row.credential_id || row.id || ""),
    device_id: normalizeDeviceId(row.device_id),
    device_label: normalizeDeviceLabel(row.device_label),
    token_hash: String(row.token_hash || ""),
    max_access_level: normalizeOpsAccessLevel(row.max_access_level),
    created_at: row.created_at || null,
    last_used_at: row.last_used_at || null,
    expires_at: row.expires_at || null,
    revoked_at: row.revoked_at || null,
    revoked_reason: row.revoked_reason || null,
  };
}

function trustedDevicePublicView(row) {
  const normalized = normalizeStoreRow(row);
  if (!normalized) return null;
  return {
    credential_id: normalized.credential_id,
    device_id: normalized.device_id,
    device_label: normalized.device_label,
    max_access_level: normalized.max_access_level,
    created_at: normalized.created_at,
    last_used_at: normalized.last_used_at,
    expires_at: normalized.expires_at,
    revoked_at: normalized.revoked_at,
    revoked_reason: normalized.revoked_reason,
    active: !normalized.revoked_at && (!normalized.expires_at || Date.parse(normalized.expires_at) > Date.now()),
  };
}

async function verifySessionAgainstTrustedDeviceStore(session, { store, env = process.env, now = new Date() } = {}) {
  if (!session?.trusted_device) return { ok: true, session };
  if (!store?.find) return { ok: true, session };
  const credentialId = String(session.credential_id || "").trim();
  if (!credentialId) return { ok: false, status: 401, error: "This manager device session is no longer trusted." };
  const row = await store.find(credentialId);
  if (!row || row.revoked_at) return { ok: false, status: 401, error: "This manager device session is no longer trusted." };
  const expiresAt = Date.parse(String(row.expires_at || ""));
  if (!Number.isFinite(expiresAt) || expiresAt <= now.getTime()) {
    return { ok: false, status: 401, error: "This manager device enrollment expired." };
  }
  if (session.device_id && normalizeDeviceId(session.device_id) !== normalizeDeviceId(row.device_id)) {
    return { ok: false, status: 401, error: "This manager device session is no longer trusted." };
  }
  const accessLevel = clampAccessLevel(session.access_level, row.max_access_level);
  return {
    ok: true,
    session: {
      ...session,
      device_id: row.device_id,
      credential_id: row.credential_id,
      access_level: accessLevel,
      read_only: accessLevel === "read_only",
    },
    row,
  };
}

export function createSupabaseTrustedDeviceStore(supabase) {
  if (!supabase) return null;
  return {
    async createPairingToken(record = {}) {
      const { data, error } = await supabase.rpc("ops_manager_create_pairing_token", {
        p_created_by_credential_id: record.created_by_credential_id || null,
        p_created_by_device_id: normalizeDeviceId(record.created_by_device_id || ""),
        p_created_by_actor: String(record.created_by_actor || "ops_manager").slice(0, 120),
        p_intended_device_label: normalizeDeviceLabel(record.intended_device_label || ""),
        p_ttl_seconds: getPairingTtlSeconds(record.ttl_seconds),
        p_metadata_json: record.metadata_json && typeof record.metadata_json === "object" && !Array.isArray(record.metadata_json)
          ? record.metadata_json
          : {},
      });
      if (error) throw error;
      return data;
    },
    async consumePairingAndEnroll(record = {}) {
      const { data, error } = await supabase.rpc("ops_manager_consume_pairing_and_enroll", {
        p_token: normalizePairingToken(record.pairing_token || record.token),
        p_credential_id: record.credential_id,
        p_device_id: normalizeDeviceId(record.device_id || ""),
        p_device_label: normalizeDeviceLabel(record.device_label || ""),
        p_trust_token_hash: String(record.token_hash || ""),
        p_max_access_level: normalizeOpsAccessLevel(record.max_access_level || "full_access"),
        p_user_agent_hash: record.user_agent_hash || null,
        p_created_ip_hash: record.created_ip_hash || null,
        p_expires_at: record.expires_at,
        p_metadata_json: record.metadata_json && typeof record.metadata_json === "object" && !Array.isArray(record.metadata_json)
          ? record.metadata_json
          : {},
      });
      if (error) throw error;
      return data;
    },
    async enroll(record) {
      const { data, error } = await supabase
        .from("ops_manager_trusted_devices")
        .insert(record)
        .select("credential_id,device_id,device_label,token_hash,max_access_level,created_at,last_used_at,expires_at,revoked_at,revoked_reason")
        .single();
      if (error) throw error;
      return normalizeStoreRow(data);
    },
    async find(credentialId) {
      const { data, error } = await supabase
        .from("ops_manager_trusted_devices")
        .select("credential_id,device_id,device_label,token_hash,max_access_level,created_at,last_used_at,expires_at,revoked_at,revoked_reason")
        .eq("credential_id", credentialId)
        .maybeSingle();
      if (error) throw error;
      return normalizeStoreRow(data);
    },
    async touch(credentialId, patch = {}) {
      const { error } = await supabase
        .from("ops_manager_trusted_devices")
        .update({ ...patch, last_used_at: new Date().toISOString() })
        .eq("credential_id", credentialId);
      if (error) throw error;
    },
    async listTrustedDevices() {
      const { data, error } = await supabase
        .from("ops_manager_trusted_devices")
        .select("credential_id,device_id,device_label,max_access_level,created_at,last_used_at,expires_at,revoked_at,revoked_reason")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []).map(trustedDevicePublicView).filter(Boolean);
    },
    async revoke(credentialId, reason = "logout") {
      const { error } = await supabase
        .from("ops_manager_trusted_devices")
        .update({ revoked_at: new Date().toISOString(), revoked_reason: String(reason || "logout").slice(0, 160) })
        .eq("credential_id", credentialId)
        .is("revoked_at", null);
      if (error) throw error;
    },
    async revokeActiveForDevice(deviceId, reason = "re-enrolled") {
      const { error } = await supabase
        .from("ops_manager_trusted_devices")
        .update({ revoked_at: new Date().toISOString(), revoked_reason: String(reason || "re-enrolled").slice(0, 160) })
        .eq("device_id", normalizeDeviceId(deviceId))
        .is("revoked_at", null);
      if (error) throw error;
    },
    async revokeAll(reason = "revoke_all") {
      const { data, error } = await supabase
        .from("ops_manager_trusted_devices")
        .update({ revoked_at: new Date().toISOString(), revoked_reason: String(reason || "revoke_all").slice(0, 160) })
        .is("revoked_at", null)
        .select("credential_id,device_id,device_label,max_access_level,created_at,last_used_at,expires_at,revoked_at,revoked_reason");
      if (error) throw error;
      return (data || []).map(trustedDevicePublicView).filter(Boolean);
    },
    async audit(event) {
      const { error } = await supabase.from("ops_manager_auth_events").insert(event);
      if (error) throw error;
    },
  };
}

function trustedDeviceStoreOrThrow(store) {
  if (store) return store;
  const error = new Error("Trusted-device authentication store is unavailable.");
  error.status = 503;
  throw error;
}

async function auditTrustedDevice(store, event) {
  if (!store?.audit) return;
  try { await store.audit(event); } catch (error) { console.error("ops auth audit failed:", error?.message || error); }
}

async function verifyTrustedDevice(req, { store, env = process.env, now = new Date() } = {}) {
  const parts = trustTokenParts(trustCookieValue(req));
  if (!parts) return { ok: false, status: 401, error: "This device is not enrolled for Ops Manager access." };
  const activeStore = trustedDeviceStoreOrThrow(store);
  const row = await activeStore.find(parts.credentialId);
  if (!row || row.revoked_at) return { ok: false, status: 401, error: "This device is not enrolled for Ops Manager access." };
  const expiresAt = Date.parse(String(row.expires_at || ""));
  if (!Number.isFinite(expiresAt) || expiresAt <= now.getTime()) {
    return { ok: false, status: 401, error: "This device enrollment expired." };
  }
  const expectedHash = trustTokenHash(parts.secret, env);
  if (!row.token_hash || !safeEqual(expectedHash, row.token_hash)) {
    return { ok: false, status: 401, error: "This device is not enrolled for Ops Manager access." };
  }
  return { ok: true, row, credentialId: parts.credentialId };
}

function authEvent(req, { credentialId = null, deviceId = null, eventType, success, detail = {}, env = process.env } = {}) {
  return {
    credential_id: credentialId || null,
    device_id: normalizeDeviceId(deviceId || requestDeviceId(req)) || null,
    event_type: String(eventType || "unknown").slice(0, 100),
    success: Boolean(success),
    ip_hash: privacyHash(requestIp(req), env, "ip"),
    user_agent_hash: privacyHash(requestUserAgent(req), env, "ua"),
    detail_json: detail && typeof detail === "object" && !Array.isArray(detail) ? detail : {},
  };
}

function sendAuthError(res, error, fallback = "Ops Manager authentication failed.") {
  res.status(error?.status || 500).json({ ok: false, error: error?.message || fallback });
}

async function authenticateTrustedManagerDevice(req, { store, env = process.env, now = new Date() } = {}) {
  const activeStore = trustedDeviceStoreOrThrow(store);
  let session = null;
  let trustedRow = null;
  let credentialId = "";

  const explicit = authenticatePresentedOpsAccessRequest(req, { env, now });
  if (explicit.presented) {
    if (!explicit.ok) return { ok: false, status: explicit.status || 401, error: explicit.error || "Unauthorized" };
    if (!explicit.session?.trusted_device) {
      return { ok: false, status: 403, error: "A trusted Ops Manager device is required." };
    }
    const trustedState = await verifySessionAgainstTrustedDeviceStore(explicit.session, { store: activeStore, env, now });
    if (!trustedState.ok) return trustedState;
    session = trustedState.session;
    trustedRow = trustedState.row;
    credentialId = session.credential_id;
  } else {
    const trusted = await verifyTrustedDevice(req, { store: activeStore, env, now });
    if (!trusted.ok) return trusted;
    trustedRow = trusted.row;
    credentialId = trusted.credentialId;
    session = createOpsManagerSession({
      credentialId,
      deviceId: trusted.row.device_id,
      accessLevel: "full_access",
      maximumAccessLevel: trusted.row.max_access_level,
      authMode: "trusted_device",
      env,
      now,
    });
  }

  if (!session || session.read_only || session.access_level !== "full_access") {
    return { ok: false, status: 403, error: "Full Ops Manager trusted-device access is required." };
  }
  if (activeStore.touch && credentialId) {
    await activeStore.touch(credentialId, {
      last_ip_hash: privacyHash(requestIp(req), env, "ip"),
      last_user_agent_hash: privacyHash(requestUserAgent(req), env, "ua"),
    });
  }
  return { ok: true, session, row: trustedRow, credentialId };
}

function sendTrustedManagerAuthFailure(res, result) {
  res.status(result?.status || 401).json({ ok: false, error: result?.error || "Trusted Ops Manager device required." });
}

export function installSharedAuthRoutes(app, { setCors, env = process.env, supabase = null, trustedDeviceStore = null } = {}) {
  const applyCors = typeof setCors === "function" ? setCors : (_res) => {};
  const store = trustedDeviceStore || createSupabaseTrustedDeviceStore(supabase);
  app.use("/auth-api", (req, res, next) => {
    applyCors(res, req);
    if (req.method === "OPTIONS") {
      res.sendStatus(200);
      return;
    }
    next();
  });

  app.post("/auth-api/gemini/login", (req, res) => {
    try {
      const session = loginGeminiAdmin({ password: req.body?.password, env });
      res.status(200).json({ ok: true, data: session });
    } catch (error) {
      res.status(error?.status || 500).json({ ok: false, error: error?.message || "Gemini login failed" });
    }
  });

  app.get("/auth-api/gemini/session", (req, res) => {
    const result = verifyGeminiAdminToken(bearerToken(req), { env });
    if (!result.ok) {
      res.status(result.status || 401).json({ ok: false, error: result.error || "Gemini password required." });
      return;
    }
    res.status(200).json({ ok: true, data: { session: result.session } });
  });

  app.post("/auth-api/ops/pairing/consume", async (req, res) => {
    const rate = consumeEnrollmentAttempt(req);
    if (!rate.allowed) {
      res.setHeader?.("Retry-After", String(rate.retryAfterSeconds));
      res.status(429).json({ ok: false, error: "Too many pairing attempts. Try again later." });
      return;
    }
    try {
      const activeStore = trustedDeviceStoreOrThrow(store);
      const pairingToken = requestPairingToken(req);
      if (!pairingToken) throw Object.assign(new Error("A valid one-time Ops Manager pairing token is required."), { status: 400 });
      const deviceId = requestDeviceId(req);
      if (!deviceId) throw Object.assign(new Error("A stable manager device ID is required."), { status: 400 });
      const deviceLabel = requestDeviceLabel(req) || deviceId;
      const credentialId = randomUUID();
      const secret = randomBytes(32).toString("base64url");
      const now = new Date();
      const expiresAt = new Date(now.getTime() + getTrustTtlMs(env)).toISOString();
      const data = await activeStore.consumePairingAndEnroll({
        pairing_token: pairingToken,
        credential_id: credentialId,
        device_id: deviceId,
        device_label: deviceLabel,
        token_hash: trustTokenHash(secret, env),
        max_access_level: "full_access",
        user_agent_hash: privacyHash(requestUserAgent(req), env, "ua"),
        created_ip_hash: privacyHash(requestIp(req), env, "ip"),
        expires_at: expiresAt,
        metadata_json: {
          enrolled_by: "one_time_pairing_link",
          user_agent_hash: privacyHash(requestUserAgent(req), env, "ua"),
          ip_hash: privacyHash(requestIp(req), env, "ip"),
        },
      });
      if (!data?.ok) {
        const status = Number(data?.status) || (["used", "expired", "revoked"].includes(data?.reason) ? 410 : 401);
        throw Object.assign(new Error("Ops Manager pairing link is invalid, expired, or already used."), { status });
      }
      const trustValue = `${credentialId}.${secret}`;
      setTrustCookie(res, trustValue, env);
      const session = createOpsManagerSession({
        credentialId,
        deviceId: data.trusted_device?.device_id || deviceId,
        accessLevel: requestedOpsAccessLevel(req),
        maximumAccessLevel: data.trusted_device?.max_access_level || "full_access",
        authMode: "trusted_device",
        env,
        now,
      });
      clearEnrollmentAttempts(req);
      await auditTrustedDevice(activeStore, authEvent(req, {
        credentialId,
        deviceId,
        eventType: "device_enrolled_by_pairing",
        success: true,
        detail: {
          pairing_id: data.pairing_id || null,
          maximum_access_level: data.trusted_device?.max_access_level || "full_access",
        },
        env,
      }));
      res.status(200).json({
        ok: true,
        data: {
          session,
          trusted_device: {
            credential_id: credentialId,
            device_id: deviceId,
            device_label: deviceLabel,
            expires_at: expiresAt,
            max_access_level: data.trusted_device?.max_access_level || "full_access",
          },
        },
      });
    } catch (error) {
      sendAuthError(res, error, "Ops Manager device pairing failed.");
    }
  });

  app.post("/auth-api/ops/pairing-links", async (req, res) => {
    try {
      const activeStore = trustedDeviceStoreOrThrow(store);
      const manager = await authenticateTrustedManagerDevice(req, { store: activeStore, env });
      if (!manager.ok) {
        sendTrustedManagerAuthFailure(res, manager);
        return;
      }
      const ttlSeconds = getPairingTtlSeconds(req.body?.ttl_seconds || req.body?.ttlSeconds);
      const data = await activeStore.createPairingToken({
        created_by_credential_id: manager.credentialId,
        created_by_device_id: manager.session.device_id,
        created_by_actor: "trusted_ops_manager_device",
        intended_device_label: requestDeviceLabel(req) || normalizeDeviceLabel(req.body?.intended_device_label || req.body?.device_label || ""),
        ttl_seconds: ttlSeconds,
        metadata_json: {
          created_from: "manager_device_admin",
          user_agent_hash: privacyHash(requestUserAgent(req), env, "ua"),
          ip_hash: privacyHash(requestIp(req), env, "ip"),
        },
      });
      if (!data?.ok || !data.pairing_token) throw Object.assign(new Error("Pairing link was not created."), { status: 500 });
      await auditTrustedDevice(activeStore, authEvent(req, {
        credentialId: manager.credentialId,
        deviceId: manager.session.device_id,
        eventType: "pairing_link_created",
        success: true,
        detail: { pairing_id: data.pairing_id || null, ttl_seconds: ttlSeconds },
        env,
      }));
      res.status(200).json({
        ok: true,
        data: {
          pairing_id: data.pairing_id,
          enrollment_url: pairingEnrollmentUrl({ token: data.pairing_token, req, env }),
          expires_at: data.expires_at,
          ttl_seconds: ttlSeconds,
        },
      });
    } catch (error) {
      sendAuthError(res, error, "Pairing link creation failed.");
    }
  });

  app.get("/auth-api/ops/trusted-devices", async (req, res) => {
    try {
      const activeStore = trustedDeviceStoreOrThrow(store);
      const manager = await authenticateTrustedManagerDevice(req, { store: activeStore, env });
      if (!manager.ok) {
        sendTrustedManagerAuthFailure(res, manager);
        return;
      }
      const devices = activeStore.listTrustedDevices ? await activeStore.listTrustedDevices() : [];
      res.status(200).json({ ok: true, data: { devices, current_credential_id: manager.credentialId } });
    } catch (error) {
      sendAuthError(res, error, "Trusted manager devices could not be listed.");
    }
  });

  app.post("/auth-api/ops/trusted-devices/revoke-all", async (req, res) => {
    try {
      const activeStore = trustedDeviceStoreOrThrow(store);
      const manager = await authenticateTrustedManagerDevice(req, { store: activeStore, env });
      if (!manager.ok) {
        sendTrustedManagerAuthFailure(res, manager);
        return;
      }
      const reason = String(req.body?.reason || "manager_revoke_all").slice(0, 160);
      const revoked = activeStore.revokeAll ? await activeStore.revokeAll(reason) : [];
      await auditTrustedDevice(activeStore, authEvent(req, {
        credentialId: manager.credentialId,
        deviceId: manager.session.device_id,
        eventType: "all_manager_devices_revoked",
        success: true,
        detail: { reason, revoked_count: revoked.length },
        env,
      }));
      clearTrustCookie(res, env);
      res.status(200).json({ ok: true, data: { revoked_count: revoked.length, revoked_devices: revoked } });
    } catch (error) {
      clearTrustCookie(res, env);
      sendAuthError(res, error, "Trusted manager devices could not be revoked.");
    }
  });

  app.post("/auth-api/ops/trusted-devices/:credentialId/revoke", async (req, res) => {
    try {
      const activeStore = trustedDeviceStoreOrThrow(store);
      const manager = await authenticateTrustedManagerDevice(req, { store: activeStore, env });
      if (!manager.ok) {
        sendTrustedManagerAuthFailure(res, manager);
        return;
      }
      const credentialId = String(req.params?.credentialId || "").trim();
      if (!/^[0-9a-f-]{36}$/i.test(credentialId)) throw Object.assign(new Error("A valid trusted-device credential ID is required."), { status: 400 });
      const reason = String(req.body?.reason || "manager_revoke_device").slice(0, 160);
      await activeStore.revoke?.(credentialId, reason);
      await auditTrustedDevice(activeStore, authEvent(req, {
        credentialId,
        deviceId: requestDeviceId(req),
        eventType: "device_revoked_by_manager",
        success: true,
        detail: { reason, revoked_by_credential_id: manager.credentialId },
        env,
      }));
      if (credentialId === manager.credentialId) clearTrustCookie(res, env);
      res.status(200).json({ ok: true, data: { revoked_credential_id: credentialId } });
    } catch (error) {
      sendAuthError(res, error, "Trusted manager device could not be revoked.");
    }
  });

  app.post("/auth-api/ops/enroll", async (req, res) => {
    await auditTrustedDevice(store, authEvent(req, {
      eventType: "legacy_enrollment_route_rejected",
      success: false,
      detail: { reason: "one_time_pairing_required" },
      env,
    }));
    res.status(410).json({ ok: false, error: "Ops Manager enrollment uses one-time trusted-device pairing links." });
  });

  app.get("/auth-api/session", async (req, res) => {
    try {
      const explicit = authenticatePresentedOpsAccessRequest(req, { env });
      if (explicit.presented) {
        if (!explicit.ok) {
          res.status(explicit.status || 401).json({ ok: false, error: explicit.error || "Invalid manager session." });
          return;
        }
        const trustedState = await verifySessionAgainstTrustedDeviceStore(explicit.session, { store, env });
        if (!trustedState.ok) {
          res.status(trustedState.status || 401).json({ ok: false, error: trustedState.error || "Invalid manager session." });
          return;
        }
        res.status(200).json({ ok: true, data: { session: trustedState.session, operational_day: getCSTDate() } });
        return;
      }
      if (!opsManagerAuthRequired(env)) {
        const session = createPublicOpsManagerSession({
          deviceId: requestDeviceId(req) || "manager-browser",
          accessLevel: requestedOpsAccessLevel(req),
          env,
        });
        res.status(200).json({
          ok: true,
          data: { session, operational_day: getCSTDate(), operations_first: true },
        });
        return;
      }

      const trusted = await verifyTrustedDevice(req, { store, env });
      if (!trusted.ok) {
        clearTrustCookie(res, env);
        res.status(trusted.status || 401).json({ ok: false, error: trusted.error, enrollment_required: true });
        return;
      }
      const requested = requestedOpsAccessLevel(req);
      const session = createOpsManagerSession({
        credentialId: trusted.credentialId,
        deviceId: trusted.row.device_id,
        accessLevel: requested,
        maximumAccessLevel: trusted.row.max_access_level,
        authMode: "trusted_device",
        env,
      });
      await store.touch?.(trusted.credentialId, {
        last_ip_hash: privacyHash(requestIp(req), env, "ip"),
        last_user_agent_hash: privacyHash(requestUserAgent(req), env, "ua"),
      });
      await auditTrustedDevice(store, authEvent(req, {
        credentialId: trusted.credentialId,
        deviceId: trusted.row.device_id,
        eventType: "session_refreshed",
        success: true,
        detail: { access_level: session.access_level },
        env,
      }));
      res.status(200).json({
        ok: true,
        data: {
          session,
          operational_day: getCSTDate(),
          trusted_device: {
            credential_id: trusted.credentialId,
            device_id: trusted.row.device_id,
            device_label: trusted.row.device_label,
            expires_at: trusted.row.expires_at,
          },
        },
      });
    } catch (error) {
      sendAuthError(res, error, "Manager session refresh failed.");
    }
  });

  app.post("/auth-api/ops/logout", async (req, res) => {
    try {
      const parts = trustTokenParts(trustCookieValue(req));
      if (parts && store) {
        await store.revoke?.(parts.credentialId, "user_logout");
        await auditTrustedDevice(store, authEvent(req, {
          credentialId: parts.credentialId,
          eventType: "device_revoked",
          success: true,
          detail: { reason: "user_logout" },
          env,
        }));
      }
      clearTrustCookie(res, env);
      res.status(200).json({ ok: true, data: { logged_out: true } });
    } catch (error) {
      clearTrustCookie(res, env);
      sendAuthError(res, error, "Logout failed.");
    }
  });

  app.get("/auth-api/config", (_req, res) => {
    const config = getSharedAccessConfig(env);
    res.status(200).json({
      ok: true,
      data: {
        passwordless_manager_access: config.passwordlessManagerAccess,
        operations_first: config.passwordlessManagerAccess,
        trusted_device_enrollment: !config.passwordlessManagerAccess && Boolean(store),
        trusted_device_pairing: !config.passwordlessManagerAccess && Boolean(store),
        access_token_ttl_seconds: Math.floor(config.accessTtlMs / 1000),
        trusted_device_ttl_days: Math.floor(config.trustTtlMs / 86_400_000),
      },
    });
  });
}
