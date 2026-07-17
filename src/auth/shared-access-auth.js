import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
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
const MANAGER_INVITE_DEFAULT_TTL_SECONDS = 24 * 60 * 60;
const MANAGER_INVITE_MIN_TTL_SECONDS = 5 * 60;
const MANAGER_INVITE_MAX_TTL_SECONDS = 7 * 24 * 60 * 60;
const MANAGER_ROLES = new Set(["OPS_MANAGER", "DIRECTOR", "SECURITY_ADMIN"]);
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

function normalizeManagerRole(value) {
  const normalized = String(value || "").trim().toUpperCase().replace(/[\s-]+/g, "_");
  return MANAGER_ROLES.has(normalized) ? normalized : "OPS_MANAGER";
}

function normalizeManagerRoles(value) {
  const raw = Array.isArray(value) ? value : [value];
  const roles = new Set();
  for (const item of raw) {
    const role = normalizeManagerRole(item);
    if (MANAGER_ROLES.has(role)) roles.add(role);
  }
  if (!roles.size) roles.add("OPS_MANAGER");
  if (roles.has("SECURITY_ADMIN")) {
    roles.add("DIRECTOR");
    roles.add("OPS_MANAGER");
  }
  if (roles.has("DIRECTOR")) roles.add("OPS_MANAGER");
  return Array.from(roles);
}

function hasManagerRole(managerOrSession, role) {
  const wanted = normalizeManagerRole(role);
  const roles = normalizeManagerRoles(managerOrSession?.roles || managerOrSession?.manager_roles || []);
  return roles.includes(wanted);
}

function requireManagerAdminRole(managerOrSession) {
  return hasManagerRole(managerOrSession, "DIRECTOR") || hasManagerRole(managerOrSession, "SECURITY_ADMIN");
}

function managerPublicView(row, devices = []) {
  if (!row) return null;
  const roles = normalizeManagerRoles(row.roles);
  return {
    manager_id: String(row.manager_id || ""),
    display_name: String(row.display_name || ""),
    contact_label: row.contact_label || null,
    roles,
    role: roles.includes("SECURITY_ADMIN") ? "SECURITY_ADMIN" : (roles.includes("DIRECTOR") ? "DIRECTOR" : "OPS_MANAGER"),
    active: row.active !== false && !row.revoked_at,
    revoked_at: row.revoked_at || null,
    revoked_reason: row.revoked_reason || null,
    created_at: row.created_at || null,
    last_access_at: row.last_access_at || null,
    devices,
  };
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

function getManagerInviteTtlSeconds(value) {
  return Math.floor(boundedNumber(
    value,
    MANAGER_INVITE_DEFAULT_TTL_SECONDS,
    MANAGER_INVITE_MIN_TTL_SECONDS,
    MANAGER_INVITE_MAX_TTL_SECONDS,
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

function sha256Hex(value) {
  return createHash("sha256").update(String(value || "")).digest("hex");
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
  const roles = normalizeManagerRoles(payload.roles || payload.manager_roles || []);
  const session = {
    role: "ops_manager",
    manager_id: String(payload.manager_id || ""),
    manager_display_name: String(payload.manager_display_name || ""),
    roles,
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
  manager = null,
  now = new Date(),
  env = process.env,
  authMode = "trusted_device",
  accessLevel = "read_only",
  maximumAccessLevel = "full_access",
} = {}) {
  const normalizedAccessLevel = clampAccessLevel(accessLevel, maximumAccessLevel);
  const roles = normalizeManagerRoles(manager?.roles || []);
  const expiresAt = now.getTime() + getAccessTtlMs(env);
  const payload = {
    v: OPS_ACCESS_TOKEN_VERSION,
    role: "ops_manager",
    manager_id: String(manager?.manager_id || ""),
    manager_display_name: String(manager?.display_name || ""),
    roles,
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
    manager_id: payload.manager_id,
    manager_display_name: payload.manager_display_name,
    roles: payload.roles,
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

function requestOrigin(req) {
  return String(req?.headers?.origin || req?.header?.("origin") || "").trim();
}

function isAllowedManagerInviteOrigin(req, env = process.env) {
  const origin = requestOrigin(req);
  if (!origin) return true;
  const configured = String(env.OPS_MANAGER_INVITE_ALLOWED_ORIGINS || env.ALLOWED_CORS_ORIGINS || "")
    .split(",").map((value) => value.trim()).filter(Boolean);
  const allowed = new Set([
    "https://lasrevinu333-design.github.io",
    "https://memphis-zoo-mcp.onrender.com",
    ...configured,
  ]);
  return allowed.has(origin);
}

function platformSummary(req) {
  const ua = requestUserAgent(req);
  if (/iphone|ipad|ios/i.test(ua)) return "iPhone/iPad Safari";
  if (/android/i.test(ua)) return "Android browser";
  if (/edg\//i.test(ua)) return "Desktop Edge";
  if (/chrome|chromium/i.test(ua)) return "Desktop Chrome";
  if (/safari/i.test(ua)) return "Safari";
  if (/firefox/i.test(ua)) return "Firefox";
  return "Browser";
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
  const manager = row.manager && typeof row.manager === "object" ? managerPublicView(row.manager) : null;
  return {
    credential_id: String(row.credential_id || row.id || ""),
    device_id: normalizeDeviceId(row.device_id),
    device_label: normalizeDeviceLabel(row.device_label),
    token_hash: String(row.token_hash || ""),
    max_access_level: normalizeOpsAccessLevel(row.max_access_level),
    manager_id: row.manager_id || manager?.manager_id || null,
    manager,
    platform_summary: row.platform_summary || row.metadata_json?.platform_summary || null,
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
    manager_id: normalized.manager_id,
    manager: normalized.manager,
    platform_summary: normalized.platform_summary,
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
  if (row.manager_id && !row.manager) {
    return { ok: false, status: 403, error: "This manager record is unavailable." };
  }
  if (row.manager && (!row.manager.active || row.manager.revoked_at)) {
    return { ok: false, status: 403, error: "This manager is no longer active." };
  }
  const accessLevel = clampAccessLevel(session.access_level, row.max_access_level);
  return {
    ok: true,
    session: {
      ...session,
      manager_id: row.manager?.manager_id || row.manager_id || session.manager_id || "",
      manager_display_name: row.manager?.display_name || session.manager_display_name || "",
      roles: normalizeManagerRoles(row.manager?.roles || session.roles || []),
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
  async function getManager(managerId) {
    if (!managerId) return null;
    const { data, error } = await supabase
      .from("ops_manager_managers")
      .select("manager_id,display_name,contact_label,roles,active,revoked_at,revoked_reason,created_at,last_access_at")
      .eq("manager_id", managerId)
      .maybeSingle();
    if (error) throw error;
    return managerPublicView(data);
  }
  async function hydrateTrustedRow(row) {
    const normalized = normalizeStoreRow(row);
    if (!normalized) return null;
    if (normalized.manager_id && !normalized.manager) normalized.manager = await getManager(normalized.manager_id);
    return normalized;
  }
  return {
    getManager,
    async createManager(record = {}) {
      const roles = normalizeManagerRoles(record.roles || record.role);
      const insert = {
        display_name: String(record.display_name || record.displayName || "").trim().slice(0, 160),
        contact_label: String(record.contact_label || record.contactLabel || "").trim().slice(0, 240) || null,
        roles,
        active: record.active !== false,
        created_by_manager_id: record.created_by_manager_id || null,
        created_by_credential_id: record.created_by_credential_id || null,
        metadata_json: record.metadata_json && typeof record.metadata_json === "object" && !Array.isArray(record.metadata_json) ? record.metadata_json : {},
      };
      if (!insert.display_name) throw Object.assign(new Error("Manager display name is required."), { status: 400 });
      const { data, error } = await supabase
        .from("ops_manager_managers")
        .insert(insert)
        .select("manager_id,display_name,contact_label,roles,active,revoked_at,revoked_reason,created_at,last_access_at")
        .single();
      if (error) throw error;
      return managerPublicView(data);
    },
    async updateManager(managerId, patch = {}) {
      const update = {};
      if (patch.display_name !== undefined || patch.displayName !== undefined) update.display_name = String(patch.display_name || patch.displayName || "").trim().slice(0, 160);
      if (patch.contact_label !== undefined || patch.contactLabel !== undefined) update.contact_label = String(patch.contact_label || patch.contactLabel || "").trim().slice(0, 240) || null;
      if (patch.roles !== undefined || patch.role !== undefined) update.roles = normalizeManagerRoles(patch.roles || patch.role);
      if (patch.active !== undefined) update.active = patch.active !== false;
      const { data, error } = await supabase
        .from("ops_manager_managers")
        .update(update)
        .eq("manager_id", managerId)
        .select("manager_id,display_name,contact_label,roles,active,revoked_at,revoked_reason,created_at,last_access_at")
        .maybeSingle();
      if (error) throw error;
      return managerPublicView(data);
    },
    async revokeManager(managerId, { revokedByManagerId = null, reason = "manager_revoked" } = {}) {
      const { data, error } = await supabase
        .from("ops_manager_managers")
        .update({ active: false, revoked_at: new Date().toISOString(), revoked_by_manager_id: revokedByManagerId, revoked_reason: String(reason || "manager_revoked").slice(0, 160) })
        .eq("manager_id", managerId)
        .select("manager_id,display_name,contact_label,roles,active,revoked_at,revoked_reason,created_at,last_access_at")
        .maybeSingle();
      if (error) throw error;
      return managerPublicView(data);
    },
    async listManagers() {
      const { data: managers, error } = await supabase
        .from("ops_manager_managers")
        .select("manager_id,display_name,contact_label,roles,active,revoked_at,revoked_reason,created_at,last_access_at")
        .order("display_name", { ascending: true });
      if (error) throw error;
      const devices = await this.listTrustedDevices();
      const devicesByManager = new Map();
      for (const device of devices) {
        if (!device.manager_id) continue;
        if (!devicesByManager.has(device.manager_id)) devicesByManager.set(device.manager_id, []);
        devicesByManager.get(device.manager_id).push(device);
      }
      return (managers || []).map((row) => managerPublicView(row, devicesByManager.get(String(row.manager_id)) || []));
    },
    async createManagerInvitation(record = {}) {
      const token = randomBytes(32).toString("hex");
      const ttlSeconds = getManagerInviteTtlSeconds(record.ttl_seconds || record.ttlSeconds);
      const managerId = String(record.manager_id || record.managerId || "");
      const manager = await getManager(managerId);
      if (!manager?.active) throw Object.assign(new Error("Active manager record is required for invitations."), { status: 404 });
      const role = normalizeManagerRole(record.intended_role || record.role || manager.role);
      if (!manager.roles.includes(role)) throw Object.assign(new Error("Invitation role must match the named manager."), { status: 400 });
      const insert = {
        token_hash: sha256Hex(token),
        created_by_credential_id: record.created_by_credential_id || null,
        created_by_device_id: normalizeDeviceId(record.created_by_device_id || ""),
        created_by_actor: String(record.created_by_actor || "trusted_manager_device").slice(0, 120),
        intended_device_label: normalizeDeviceLabel(record.intended_device_label || ""),
        max_access_level: "full_access",
        manager_id: managerId,
        intended_role: role,
        invitation_kind: String(record.invitation_kind || "pc").trim().toLowerCase().replace(/[^a-z_]/g, "_").slice(0, 40) || "pc",
        max_uses: Math.min(5, Math.max(1, Number.parseInt(String(record.max_uses || record.maxUses || 1), 10) || 1)),
        expires_at: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
        metadata_json: record.metadata_json && typeof record.metadata_json === "object" && !Array.isArray(record.metadata_json) ? record.metadata_json : {},
      };
      const { data, error } = await supabase
        .from("ops_manager_pairing_tokens")
        .insert(insert)
        .select("pairing_id,manager_id,intended_role,invitation_kind,expires_at,max_uses,use_count,revoked_at")
        .single();
      if (error) throw error;
      return { ok: true, ...data, pairing_token: token, ttl_seconds: ttlSeconds, manager };
    },
    async revokeInvitation(pairingId, { reason = "invitation_revoked" } = {}) {
      const { data, error } = await supabase
        .from("ops_manager_pairing_tokens")
        .update({ revoked_at: new Date().toISOString(), revoked_reason: String(reason || "invitation_revoked").slice(0, 160) })
        .eq("pairing_id", pairingId)
        .is("revoked_at", null)
        .select("pairing_id,manager_id,revoked_at,revoked_reason")
        .maybeSingle();
      if (error) throw error;
      return data || null;
    },
    async consumeManagerInvitation(record = {}) {
      const { data, error } = await supabase.rpc("ops_manager_consume_manager_invitation", {
        p_token: normalizePairingToken(record.pairing_token || record.token),
        p_credential_id: record.credential_id,
        p_device_id: normalizeDeviceId(record.device_id || ""),
        p_device_label: normalizeDeviceLabel(record.device_label || ""),
        p_trust_token_hash: String(record.token_hash || ""),
        p_user_agent_hash: record.user_agent_hash || null,
        p_created_ip_hash: record.created_ip_hash || null,
        p_platform_summary: String(record.platform_summary || "").slice(0, 160) || null,
        p_expires_at: record.expires_at,
        p_metadata_json: record.metadata_json && typeof record.metadata_json === "object" && !Array.isArray(record.metadata_json)
          ? record.metadata_json
          : {},
      });
      if (error) throw error;
      return data;
    },
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
        .select("credential_id,device_id,device_label,token_hash,max_access_level,manager_id,platform_summary,created_at,last_used_at,expires_at,revoked_at,revoked_reason")
        .eq("credential_id", credentialId)
        .maybeSingle();
      if (error) throw error;
      return hydrateTrustedRow(data);
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
        .select("credential_id,device_id,device_label,max_access_level,manager_id,platform_summary,created_at,last_used_at,expires_at,revoked_at,revoked_reason")
        .order("created_at", { ascending: false });
      if (error) throw error;
      const result = [];
      for (const row of data || []) result.push(trustedDevicePublicView(await hydrateTrustedRow(row)));
      return result.filter(Boolean);
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
        .select("credential_id,device_id,device_label,max_access_level,manager_id,platform_summary,created_at,last_used_at,expires_at,revoked_at,revoked_reason");
      if (error) throw error;
      return (data || []).map(trustedDevicePublicView).filter(Boolean);
    },
    async revokeManagerDevices(managerId, reason = "manager_sessions_revoked") {
      const { data, error } = await supabase
        .from("ops_manager_trusted_devices")
        .update({ revoked_at: new Date().toISOString(), revoked_reason: String(reason || "manager_sessions_revoked").slice(0, 160) })
        .eq("manager_id", managerId)
        .is("revoked_at", null)
        .select("credential_id,device_id,device_label,max_access_level,manager_id,platform_summary,created_at,last_used_at,expires_at,revoked_at,revoked_reason");
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
      manager: trusted.row.manager,
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
  if (!session.manager_id || !trustedRow?.manager?.active) {
    return { ok: false, status: 403, error: "Named active manager identity is required." };
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

  app.get("/auth-api/ops/managers", async (req, res) => {
    try {
      const activeStore = trustedDeviceStoreOrThrow(store);
      const manager = await authenticateTrustedManagerDevice(req, { store: activeStore, env });
      if (!manager.ok) { sendTrustedManagerAuthFailure(res, manager); return; }
      if (!requireManagerAdminRole(manager.session)) {
        res.status(403).json({ ok: false, error: "Director or Security Admin manager access is required." });
        return;
      }
      const managers = activeStore.listManagers ? await activeStore.listManagers() : [];
      res.status(200).json({ ok: true, data: { managers, current_manager_id: manager.session.manager_id } });
    } catch (error) {
      sendAuthError(res, error, "Managers could not be listed.");
    }
  });

  app.post("/auth-api/ops/managers", async (req, res) => {
    try {
      const activeStore = trustedDeviceStoreOrThrow(store);
      const creator = await authenticateTrustedManagerDevice(req, { store: activeStore, env });
      if (!creator.ok) { sendTrustedManagerAuthFailure(res, creator); return; }
      if (!requireManagerAdminRole(creator.session)) {
        res.status(403).json({ ok: false, error: "Director or Security Admin manager access is required." });
        return;
      }
      const created = await activeStore.createManager({
        display_name: req.body?.display_name || req.body?.displayName,
        contact_label: req.body?.contact_label || req.body?.contactLabel,
        roles: req.body?.roles || req.body?.role || "OPS_MANAGER",
        created_by_manager_id: creator.session.manager_id,
        created_by_credential_id: creator.credentialId,
        metadata_json: { created_from: "manager_access_ui" },
      });
      await auditTrustedDevice(activeStore, authEvent(req, {
        credentialId: creator.credentialId,
        deviceId: creator.session.device_id,
        eventType: "manager_created",
        success: true,
        detail: { manager_id: created.manager_id, roles: created.roles },
        env,
      }));
      res.status(200).json({ ok: true, data: { manager: created } });
    } catch (error) {
      sendAuthError(res, error, "Manager could not be created.");
    }
  });

  const updateManagerHandler = async (req, res) => {
    try {
      const activeStore = trustedDeviceStoreOrThrow(store);
      const actor = await authenticateTrustedManagerDevice(req, { store: activeStore, env });
      if (!actor.ok) { sendTrustedManagerAuthFailure(res, actor); return; }
      if (!requireManagerAdminRole(actor.session)) {
        res.status(403).json({ ok: false, error: "Director or Security Admin manager access is required." });
        return;
      }
      const managerId = String(req.params?.managerId || "");
      if (!/^[0-9a-f-]{36}$/i.test(managerId)) throw Object.assign(new Error("managerId must be a UUID."), { status: 400 });
      const updated = await activeStore.updateManager(managerId, req.body || {});
      if (!updated) throw Object.assign(new Error("Manager not found."), { status: 404 });
      await auditTrustedDevice(activeStore, authEvent(req, {
        credentialId: actor.credentialId,
        deviceId: actor.session.device_id,
        eventType: "manager_updated",
        success: true,
        detail: { manager_id: managerId, roles: updated.roles },
        env,
      }));
      res.status(200).json({ ok: true, data: { manager: updated } });
    } catch (error) {
      sendAuthError(res, error, "Manager could not be updated.");
    }
  };
  if (typeof app.patch === "function") app.patch("/auth-api/ops/managers/:managerId", updateManagerHandler);
  app.post("/auth-api/ops/managers/:managerId/update", updateManagerHandler);

  app.post("/auth-api/ops/managers/:managerId/revoke", async (req, res) => {
    try {
      const activeStore = trustedDeviceStoreOrThrow(store);
      const actor = await authenticateTrustedManagerDevice(req, { store: activeStore, env });
      if (!actor.ok) { sendTrustedManagerAuthFailure(res, actor); return; }
      if (!requireManagerAdminRole(actor.session)) {
        res.status(403).json({ ok: false, error: "Director or Security Admin manager access is required." });
        return;
      }
      const managerId = String(req.params?.managerId || "");
      if (!/^[0-9a-f-]{36}$/i.test(managerId)) throw Object.assign(new Error("managerId must be a UUID."), { status: 400 });
      const reason = String(req.body?.reason || "manager_deactivated").slice(0, 160);
      const revoked = await activeStore.revokeManager(managerId, { revokedByManagerId: actor.session.manager_id, reason });
      const revokedDevices = activeStore.revokeManagerDevices ? await activeStore.revokeManagerDevices(managerId, "manager_deactivated") : [];
      await auditTrustedDevice(activeStore, authEvent(req, {
        credentialId: actor.credentialId,
        deviceId: actor.session.device_id,
        eventType: "manager_revoked",
        success: true,
        detail: { manager_id: managerId, revoked_devices: revokedDevices.length },
        env,
      }));
      res.status(200).json({ ok: true, data: { manager: revoked, revoked_devices: revokedDevices } });
    } catch (error) {
      sendAuthError(res, error, "Manager could not be revoked.");
    }
  });

  app.post("/auth-api/ops/managers/:managerId/revoke-sessions", async (req, res) => {
    try {
      const activeStore = trustedDeviceStoreOrThrow(store);
      const actor = await authenticateTrustedManagerDevice(req, { store: activeStore, env });
      if (!actor.ok) { sendTrustedManagerAuthFailure(res, actor); return; }
      if (!requireManagerAdminRole(actor.session)) {
        res.status(403).json({ ok: false, error: "Director or Security Admin manager access is required." });
        return;
      }
      const managerId = String(req.params?.managerId || "");
      if (!/^[0-9a-f-]{36}$/i.test(managerId)) throw Object.assign(new Error("managerId must be a UUID."), { status: 400 });
      const revoked = activeStore.revokeManagerDevices ? await activeStore.revokeManagerDevices(managerId, String(req.body?.reason || "manager_sessions_revoked")) : [];
      if (managerId === actor.session.manager_id) clearTrustCookie(res, env);
      res.status(200).json({ ok: true, data: { revoked_count: revoked.length, revoked_devices: revoked } });
    } catch (error) {
      sendAuthError(res, error, "Manager sessions could not be revoked.");
    }
  });

  app.post("/auth-api/ops/managers/:managerId/invitations", async (req, res) => {
    try {
      const activeStore = trustedDeviceStoreOrThrow(store);
      const actor = await authenticateTrustedManagerDevice(req, { store: activeStore, env });
      if (!actor.ok) { sendTrustedManagerAuthFailure(res, actor); return; }
      if (!requireManagerAdminRole(actor.session)) {
        res.status(403).json({ ok: false, error: "Director or Security Admin manager access is required." });
        return;
      }
      const managerId = String(req.params?.managerId || "");
      if (!/^[0-9a-f-]{36}$/i.test(managerId)) throw Object.assign(new Error("managerId must be a UUID."), { status: 400 });
      const invite = await activeStore.createManagerInvitation({
        manager_id: managerId,
        role: req.body?.role || req.body?.intended_role,
        invitation_kind: req.body?.invitation_kind || req.body?.kind || "pc",
        ttl_seconds: req.body?.ttl_seconds || req.body?.ttlSeconds || MANAGER_INVITE_DEFAULT_TTL_SECONDS,
        max_uses: req.body?.max_uses || req.body?.maxUses || 1,
        created_by_credential_id: actor.credentialId,
        created_by_device_id: actor.session.device_id,
        created_by_actor: actor.session.manager_display_name || actor.session.manager_id || "trusted_manager_device",
        intended_device_label: requestDeviceLabel(req) || normalizeDeviceLabel(req.body?.intended_device_label || req.body?.device_label || ""),
        metadata_json: {
          created_from: "manager_access_ui",
          created_by_manager_id: actor.session.manager_id,
          user_agent_hash: privacyHash(requestUserAgent(req), env, "ua"),
          ip_hash: privacyHash(requestIp(req), env, "ip"),
        },
      });
      await auditTrustedDevice(activeStore, authEvent(req, {
        credentialId: actor.credentialId,
        deviceId: actor.session.device_id,
        eventType: "manager_invitation_created",
        success: true,
        detail: { pairing_id: invite.pairing_id, manager_id: managerId, role: invite.intended_role, kind: invite.invitation_kind },
        env,
      }));
      res.status(200).json({
        ok: true,
        data: {
          invitation_id: invite.pairing_id,
          enrollment_url: pairingEnrollmentUrl({ token: invite.pairing_token, req, env }),
          expires_at: invite.expires_at,
          ttl_seconds: invite.ttl_seconds,
          invitation_kind: invite.invitation_kind,
          max_uses: invite.max_uses,
          manager: invite.manager,
        },
      });
    } catch (error) {
      sendAuthError(res, error, "Manager invitation could not be created.");
    }
  });

  app.post("/auth-api/ops/invitations/:invitationId/revoke", async (req, res) => {
    try {
      const activeStore = trustedDeviceStoreOrThrow(store);
      const actor = await authenticateTrustedManagerDevice(req, { store: activeStore, env });
      if (!actor.ok) { sendTrustedManagerAuthFailure(res, actor); return; }
      if (!requireManagerAdminRole(actor.session)) {
        res.status(403).json({ ok: false, error: "Director or Security Admin manager access is required." });
        return;
      }
      const invitationId = String(req.params?.invitationId || "");
      if (!/^[0-9a-f-]{36}$/i.test(invitationId)) throw Object.assign(new Error("invitationId must be a UUID."), { status: 400 });
      const revoked = activeStore.revokeInvitation ? await activeStore.revokeInvitation(invitationId, { reason: req.body?.reason || "manager_cancelled_invitation" }) : null;
      res.status(200).json({ ok: true, data: { revoked: Boolean(revoked), invitation: revoked } });
    } catch (error) {
      sendAuthError(res, error, "Manager invitation could not be revoked.");
    }
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
      if (!isAllowedManagerInviteOrigin(req, env)) throw Object.assign(new Error("Ops Manager invitations cannot be consumed from this origin."), { status: 403 });
      const deviceId = requestDeviceId(req);
      if (!deviceId) throw Object.assign(new Error("A stable manager device ID is required."), { status: 400 });
      const deviceLabel = requestDeviceLabel(req) || deviceId;
      const credentialId = randomUUID();
      const secret = randomBytes(32).toString("base64url");
      const now = new Date();
      const expiresAt = new Date(now.getTime() + getTrustTtlMs(env)).toISOString();
      let data = activeStore.consumeManagerInvitation ? await activeStore.consumeManagerInvitation({
        pairing_token: pairingToken,
        credential_id: credentialId,
        device_id: deviceId,
        device_label: deviceLabel,
        token_hash: trustTokenHash(secret, env),
        user_agent_hash: privacyHash(requestUserAgent(req), env, "ua"),
        created_ip_hash: privacyHash(requestIp(req), env, "ip"),
        platform_summary: platformSummary(req),
        expires_at: expiresAt,
        metadata_json: {
          enrolled_by: "named_manager_invitation",
          user_agent_hash: privacyHash(requestUserAgent(req), env, "ua"),
          ip_hash: privacyHash(requestIp(req), env, "ip"),
          platform_summary: platformSummary(req),
        },
      }) : null;
      if ((!data || (!data.ok && data.reason === "manager_required")) && activeStore.consumePairingAndEnroll) {
        data = await activeStore.consumePairingAndEnroll({
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
      }
      if (!data?.ok) {
        const status = Number(data?.status) || (["used", "expired", "revoked"].includes(data?.reason) ? 410 : 401);
        throw Object.assign(new Error("Ops Manager pairing link is invalid, expired, or already used."), { status });
      }
      const trustValue = `${credentialId}.${secret}`;
      setTrustCookie(res, trustValue, env);
      const session = createOpsManagerSession({
        credentialId,
        deviceId: data.trusted_device?.device_id || deviceId,
        manager: data.manager || data.trusted_device?.manager || null,
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
          manager_id: data.manager?.manager_id || data.trusted_device?.manager_id || null,
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
            manager_id: data.manager?.manager_id || data.trusted_device?.manager_id || null,
          },
          manager: data.manager || null,
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
      if (!requireManagerAdminRole(manager.session)) {
        res.status(403).json({ ok: false, error: "Director or Security Admin manager access is required." });
        return;
      }
      const ttlSeconds = getPairingTtlSeconds(req.body?.ttl_seconds || req.body?.ttlSeconds);
      const managerId = String(req.body?.manager_id || req.body?.managerId || manager.session.manager_id || "");
      const data = activeStore.createManagerInvitation ? await activeStore.createManagerInvitation({
        manager_id: managerId,
        role: req.body?.role || req.body?.intended_role || "OPS_MANAGER",
        invitation_kind: req.body?.invitation_kind || req.body?.kind || "additional_device",
        ttl_seconds: getManagerInviteTtlSeconds(req.body?.ttl_seconds || req.body?.ttlSeconds || MANAGER_INVITE_DEFAULT_TTL_SECONDS),
        created_by_credential_id: manager.credentialId,
        created_by_device_id: manager.session.device_id,
        created_by_actor: manager.session.manager_display_name || "trusted_manager_device",
        intended_device_label: requestDeviceLabel(req) || normalizeDeviceLabel(req.body?.intended_device_label || req.body?.device_label || ""),
        metadata_json: {
          created_from: "manager_device_admin",
          user_agent_hash: privacyHash(requestUserAgent(req), env, "ua"),
          ip_hash: privacyHash(requestIp(req), env, "ip"),
        },
      }) : await activeStore.createPairingToken({
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
        detail: { pairing_id: data.pairing_id || null, ttl_seconds: data.ttl_seconds || ttlSeconds, manager_id: data.manager?.manager_id || managerId || null },
        env,
      }));
      res.status(200).json({
        ok: true,
        data: {
          pairing_id: data.pairing_id,
          enrollment_url: pairingEnrollmentUrl({ token: data.pairing_token, req, env }),
          expires_at: data.expires_at,
          ttl_seconds: data.ttl_seconds || ttlSeconds,
          manager: data.manager || null,
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
      if (!requireManagerAdminRole(manager.session)) {
        res.status(403).json({ ok: false, error: "Director or Security Admin manager access is required." });
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
      if (!requireManagerAdminRole(manager.session)) {
        res.status(403).json({ ok: false, error: "Director or Security Admin manager access is required." });
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
      if (!requireManagerAdminRole(manager.session)) {
        res.status(403).json({ ok: false, error: "Director or Security Admin manager access is required." });
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
        manager: trusted.row.manager,
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
