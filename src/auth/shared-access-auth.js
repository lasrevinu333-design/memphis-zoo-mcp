import { timingSafeEqual } from "crypto";
import { loginGeminiAdmin, verifyGeminiAdminToken } from "./gemini-admin-auth.js";

const MEMPHIS_TIME_ZONE = "America/Chicago";
const OPEN_SESSION_TTL_MS = 8 * 60 * 60 * 1000;

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

function normalizeDeviceId(deviceId) {
  const normalized = String(deviceId || "").trim().replace(/[^a-zA-Z0-9_.:-]/g, "").slice(0, 96);
  return normalized || "unassigned-device";
}

function requestDeviceId(req) {
  return req?.body?.device_id || req?.body?.deviceId || req?.query?.device_id || req?.header?.("x-device-id") || "";
}

function bearerToken(req) {
  const authorization = String(req?.header?.("authorization") || "").trim();
  if (/^bearer\s+/i.test(authorization)) return authorization.replace(/^bearer\s+/i, "").trim();
  return String(req?.header?.("x-gemini-admin-token") || "").trim();
}

function adminApiKey(req) {
  return String(req?.header?.("x-admin-key") || req?.header?.("x-api-key") || "").trim();
}

export function getSharedAccessConfig(env = process.env) {
  return {
    adminApiKey: String(env.ADMIN_API_KEY || "").trim(),
  };
}

export function createOpenOpsManagerSession({ deviceId, now = new Date() } = {}) {
  return {
    role: "ops_manager",
    token: "ops-manager-open-access",
    device_id: normalizeDeviceId(deviceId || "manager-hub-open"),
    operational_day: getCSTDate(now),
    expires_at: new Date(now.getTime() + OPEN_SESSION_TTL_MS).toISOString(),
    auth_mode: "open",
  };
}

export function createAdminApiKeySession({ deviceId, now = new Date() } = {}) {
  return {
    ...createOpenOpsManagerSession({ deviceId: deviceId || "admin-api-key", now }),
    token: "admin-api-key",
    auth_mode: "admin_api_key",
  };
}

export function authenticateOpsAccessRequest(req, { env = process.env, now = new Date() } = {}) {
  const config = getSharedAccessConfig(env);
  const providedAdminApiKey = adminApiKey(req);
  if (config.adminApiKey && providedAdminApiKey && safeEqual(providedAdminApiKey, config.adminApiKey)) {
    return { ok: true, session: createAdminApiKeySession({ deviceId: requestDeviceId(req), now }) };
  }
  return { ok: true, session: createOpenOpsManagerSession({ deviceId: requestDeviceId(req), now }) };
}

export function makeOpsAccessMiddleware({ env = process.env } = {}) {
  return function requireOpsAccess(req, res, next) {
    const result = authenticateOpsAccessRequest(req, { env });
    if (!result.ok) {
      res.status(result.status || 401).json({ ok: false, error: result.error || "Unauthorized" });
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
    const result = authenticateOpsAccessRequest(req, { env });
    res.status(200).json({ ok: true, data: { session: result.session, operational_day: getCSTDate(), expires_at: result.session.expires_at } });
  });
}
