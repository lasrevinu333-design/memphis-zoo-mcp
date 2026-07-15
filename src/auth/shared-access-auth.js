import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { loginGeminiAdmin, verifyGeminiAdminToken } from "./gemini-admin-auth.js";

const MEMPHIS_TIME_ZONE = "America/Chicago";
const OPS_SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const OPS_SESSION_VERSION = 1;
const EPHEMERAL_OPS_SESSION_SECRET = randomBytes(32).toString("hex");

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function getCSTDate(date = new Date()) {
  return date.toLocaleString("en-CA", {
    timeZone: MEMPHIS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

function truthy(value) {
  return /^(1|true|yes|on)$/i.test(String(value || "").trim());
}

function isProductionLike(env = process.env) {
  return String(env.NODE_ENV || "").trim().toLowerCase() === "production" || truthy(env.RENDER) || truthy(env.IS_RENDER);
}

function allowExplicitLocalOpenMode(env = process.env) {
  return truthy(env.OPS_AUTH_OPEN_MODE) && !isProductionLike(env);
}

export function normalizeOpsAccessLevel(value) {
  const normalized = String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  return ["read", "readonly", "read_only"].includes(normalized) ? "read_only" : "full_access";
}

function requestedOpsAccessLevel(req) {
  return normalizeOpsAccessLevel(
    req?.query?.access_level
      || req?.query?.manager_access
      || req?.body?.access_level
      || req?.body?.manager_access
      || req?.header?.("x-ops-access-level")
      || "full_access"
  );
}

function normalizeDeviceId(deviceId) {
  const normalized = String(deviceId || "").trim().replace(/[^a-zA-Z0-9_.:-]/g, "").slice(0, 96);
  return normalized || "unassigned-device";
}

function requestDeviceId(req) {
  return req?.body?.device_id || req?.body?.deviceId || req?.query?.device_id || req?.query?.deviceId || req?.header?.("x-device-id") || "";
}

function bearerToken(req) {
  const authorization = String(req?.header?.("authorization") || "").trim();
  if (/^bearer\s+/i.test(authorization)) return authorization.replace(/^bearer\s+/i, "").trim();
  return String(req?.header?.("x-memphis-auth") || "").trim() || String(req?.header?.("x-gemini-admin-token") || "").trim();
}

function adminApiKey(req) {
  return String(req?.header?.("x-admin-key") || req?.header?.("x-api-key") || "").trim();
}

function accessKey(req) {
  return String(
    req?.header?.("x-ops-access-key")
      || req?.header?.("x-memphis-access-key")
      || req?.query?.access_key
      || req?.query?.ops_access_key
      || req?.body?.access_key
      || req?.body?.ops_access_key
      || ""
  ).trim();
}

function getSessionSecret(env = process.env) {
  return String(
    env.OPS_MANAGER_SESSION_SECRET
      || env.GEMINI_ADMIN_SESSION_SECRET
      || env.MOXIE_WEB_COOKIE_SECRET
      || env.SUPABASE_SERVICE_ROLE_KEY
      || env.ADMIN_API_KEY
      || EPHEMERAL_OPS_SESSION_SECRET
  ).trim() || EPHEMERAL_OPS_SESSION_SECRET;
}

function signOpsPayload(payload, { env = process.env } = {}) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", getSessionSecret(env)).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

function verifyOpsToken(token, { env = process.env, now = new Date() } = {}) {
  const raw = String(token || "").trim();
  if (!raw) return { ok: false, status: 401, error: "Ops Manager link required." };
  const dot = raw.lastIndexOf(".");
  if (dot === -1) return { ok: false, status: 401, error: "Ops Manager link required." };
  const encoded = raw.slice(0, dot);
  const providedSignature = raw.slice(dot + 1);
  const expectedSignature = createHmac("sha256", getSessionSecret(env)).update(encoded).digest("base64url");
  if (!safeEqual(providedSignature, expectedSignature)) return { ok: false, status: 401, error: "Ops Manager link required." };
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (payload?.v !== OPS_SESSION_VERSION || payload?.role !== "ops_manager") {
      return { ok: false, status: 401, error: "Ops Manager link required." };
    }
    const expiresAt = Date.parse(String(payload.expires_at || ""));
    if (!Number.isFinite(expiresAt) || expiresAt <= now.getTime()) {
      return { ok: false, status: 401, error: "Ops Manager session expired." };
    }
    const session = {
      role: "ops_manager",
      token: raw,
      device_id: normalizeDeviceId(payload.device_id),
      operational_day: String(payload.operational_day || getCSTDate(now)),
      expires_at: new Date(expiresAt).toISOString(),
      auth_mode: String(payload.auth_mode || "public_full_access_link"),
      access_level: payload.access_level === "read_only" ? "read_only" : "full_access",
      read_only: payload.access_level === "read_only",
    };
    return { ok: true, session };
  } catch {
    return { ok: false, status: 401, error: "Ops Manager link required." };
  }
}

export function getSharedAccessConfig(env = process.env) {
  const adminApiKey = String(env.ADMIN_API_KEY || "").trim();
  const fullAccessKey = String(env.OPS_MANAGER_FULL_ACCESS_KEY || env.OPS_MANAGER_ACCESS_KEY || "").trim();
  const readOnlyAccessKey = String(env.OPS_MANAGER_READ_ONLY_ACCESS_KEY || "").trim();
  const hasConfiguredCredential = Boolean(adminApiKey || fullAccessKey || readOnlyAccessKey);
  const allowOpenAccess = allowExplicitLocalOpenMode(env);

return {
    adminApiKey,
    fullAccessKey,
    readOnlyAccessKey,
    hasConfiguredCredential,
    allowOpenAccess,
    productionLike: isProductionLike(env),
  };
}

export function createOpsManagerSession({ deviceId, now = new Date(), env = process.env, authMode = "public_full_access_link", accessLevel = "full_access" } = {}) {
  const normalizedAccessLevel = accessLevel === "read_only" ? "read_only" : "full_access";
  const payload = {
    v: OPS_SESSION_VERSION,
    role: "ops_manager",
    device_id: normalizeDeviceId(deviceId || "manager-hub"),
    operational_day: getCSTDate(now),
    expires_at: new Date(now.getTime() + OPS_SESSION_TTL_MS).toISOString(),
    auth_mode: String(authMode || "public_full_access_link"),
    access_level: normalizedAccessLevel,
  };
  return {
    ...payload,
    token: signOpsPayload(payload, { env }),
    read_only: normalizedAccessLevel === "read_only",
  };
}

export function createOpenOpsManagerSession({ deviceId, now = new Date(), env = process.env } = {}) {
  return createOpsManagerSession({ deviceId: deviceId || "manager-hub-open", now, env, authMode: "open", accessLevel: "full_access" });
}

export function createPublicOpsManagerSession({ deviceId, accessLevel = "full_access", now = new Date(), env = process.env } = {}) {
  const normalizedAccessLevel = normalizeOpsAccessLevel(accessLevel);
  return createOpsManagerSession({
    deviceId: deviceId || (normalizedAccessLevel === "read_only" ? "manager-read-only" : "manager-hub"),
    now,
    env,
    authMode: normalizedAccessLevel === "read_only" ? "public_read_only_link" : "public_full_access_link",
    accessLevel: normalizedAccessLevel,
  });
}

export function createAdminApiKeySession({ deviceId, now = new Date(), env = process.env } = {}) {
  return createOpsManagerSession({ deviceId: deviceId || "admin-api-key", now, env, authMode: "admin_api_key", accessLevel: "full_access" });
}

export function authenticatePresentedOpsAccessRequest(req, { env = process.env, now = new Date() } = {}) {
  const config = getSharedAccessConfig(env);
  const providedAdminApiKey = adminApiKey(req);
  if (providedAdminApiKey) {
    if (config.adminApiKey && safeEqual(providedAdminApiKey, config.adminApiKey)) {
      return { presented: true, ok: true, session: createAdminApiKeySession({ deviceId: requestDeviceId(req), now, env }) };
    }
    return { presented: true, ok: false, status: 401, error: "Ops Manager link required." };
  }

  const presentedBearer = bearerToken(req);
  if (presentedBearer) {
    return { presented: true, ...verifyOpsToken(presentedBearer, { env, now }) };
  }

  const presentedAccessKey = accessKey(req);
  if (presentedAccessKey) {
    if (config.readOnlyAccessKey && safeEqual(presentedAccessKey, config.readOnlyAccessKey)) {
      return { presented: true, ok: true, session: createOpsManagerSession({ deviceId: requestDeviceId(req), now, env, authMode: "public_read_only_link", accessLevel: "read_only" }) };
    }
    if (config.fullAccessKey && safeEqual(presentedAccessKey, config.fullAccessKey)) {
      return { presented: true, ok: true, session: createOpsManagerSession({ deviceId: requestDeviceId(req), now, env, authMode: "public_full_access_link", accessLevel: "full_access" }) };
    }
    return { presented: true, ok: false, status: 401, error: "Ops Manager link required." };
  }

  return { presented: false, ok: false, status: 401, error: "Ops Manager link required." };
}

export function authenticateOpsAccessRequest(req, { env = process.env, now = new Date() } = {}) {
  const explicit = authenticatePresentedOpsAccessRequest(req, { env, now });
  if (explicit.presented) return explicit;
  const config = getSharedAccessConfig(env);
  if (config.allowOpenAccess) {
    return { ok: true, session: createOpenOpsManagerSession({ deviceId: requestDeviceId(req), now, env }) };
  }
  if (!config.hasConfiguredCredential) {
    return { ok: false, status: 503, error: "Ops Manager auth is not configured." };
  }
  return { ok: false, status: 401, error: "Ops Manager link required." };
}

export function makeOpsAccessMiddleware({ env = process.env, requireWrite = false } = {}) {
  return function requireOpsAccess(req, res, next) {
    const result = authenticateOpsAccessRequest(req, { env });
    if (!result.ok) {
      res.status(result.status || 401).json({ ok: false, error: result.error || "Unauthorized" });
      return;
    }
    if (requireWrite && result.session?.read_only) {
      res.status(403).json({ ok: false, error: "Read-only Ops Manager link cannot make changes." });
      return;
    }
    req.memphisAuth = result.session;
    next();
  };
}

export function installSharedAuthRoutes(app, { setCors, env = process.env } = {}) {
  const applyCors = typeof setCors === "function" ? setCors : (_res) => {};
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

  app.get("/auth-api/session", (req, res) => {
    const explicit = authenticatePresentedOpsAccessRequest(req, { env });
    if (explicit.presented && !explicit.ok) {
      res.status(explicit.status || 401).json({ ok: false, error: explicit.error || "Invalid manager session." });
      return;
    }
    const session = explicit.presented
      ? explicit.session
      : createPublicOpsManagerSession({
          deviceId: requestDeviceId(req),
          accessLevel: requestedOpsAccessLevel(req),
          env,
        });
    res.status(200).json({
      ok: true,
      data: {
        session,
        operational_day: getCSTDate(),
        expires_at: session.expires_at,
      },
    });
  });
}
