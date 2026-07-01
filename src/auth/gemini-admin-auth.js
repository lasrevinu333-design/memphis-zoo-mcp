import { createHmac, timingSafeEqual, randomUUID } from "crypto";

const TOKEN_VERSION = 1;
const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function base64UrlEncode(value) {
  return Buffer.from(String(value), "utf8").toString("base64url");
}

function base64UrlDecode(value) {
  return Buffer.from(String(value || ""), "base64url").toString("utf8");
}

function hmac(secret, value) {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

export function getGeminiAdminConfig(env = process.env) {
  return {
    password: String(env.GEMINI_ADMIN_PASSWORD || env.MOXIE_WEB_PASSWORD || "").trim(),
    sessionSecret: String(env.GEMINI_ADMIN_SESSION_SECRET || env.MOXIE_COOKIE_SECRET || env.MOXIE_WEB_COOKIE_SECRET || env.PIN_SESSION_SECRET || env.SUPABASE_SERVICE_ROLE_KEY || "").trim(),
    ttlMs: Math.max(60_000, Number(env.GEMINI_ADMIN_SESSION_TTL_MS || SESSION_TTL_MS) || SESSION_TTL_MS),
  };
}

export function createGeminiAdminSession({ now = new Date(), env = process.env } = {}) {
  const config = getGeminiAdminConfig(env);
  if (!config.sessionSecret) {
    const error = new Error("Gemini admin session secret is not configured.");
    error.status = 503;
    throw error;
  }
  const exp = now.getTime() + config.ttlMs;
  const payload = {
    v: TOKEN_VERSION,
    role: "gemini_admin",
    auth_mode: "gemini_password",
    jti: randomUUID(),
    iat: now.getTime(),
    exp,
  };
  const encoded = base64UrlEncode(JSON.stringify(payload));
  const signature = hmac(config.sessionSecret, encoded);
  return {
    token: `${encoded}.${signature}`,
    role: payload.role,
    auth_mode: payload.auth_mode,
    expires_at: new Date(exp).toISOString(),
  };
}

export function verifyGeminiAdminToken(token, { now = new Date(), env = process.env } = {}) {
  const config = getGeminiAdminConfig(env);
  if (!config.sessionSecret) return { ok: false, status: 503, error: "Gemini admin session secret is not configured." };
  const raw = String(token || "").trim();
  const [encoded, signature, extra] = raw.split(".");
  if (!encoded || !signature || extra !== undefined) return { ok: false, status: 401, error: "Gemini password required." };
  const expected = hmac(config.sessionSecret, encoded);
  if (!safeEqual(signature, expected)) return { ok: false, status: 401, error: "Gemini password required." };
  let payload;
  try {
    payload = JSON.parse(base64UrlDecode(encoded));
  } catch {
    return { ok: false, status: 401, error: "Gemini password required." };
  }
  if (payload?.v !== TOKEN_VERSION || payload?.role !== "gemini_admin") return { ok: false, status: 403, error: "Forbidden" };
  if (!Number.isFinite(Number(payload.exp)) || Number(payload.exp) <= now.getTime()) return { ok: false, status: 401, error: "Gemini session expired." };
  return { ok: true, session: payload };
}

function bearerToken(req) {
  const authorization = String(req?.header?.("authorization") || "").trim();
  if (/^bearer\s+/i.test(authorization)) return authorization.replace(/^bearer\s+/i, "").trim();
  return String(req?.header?.("x-gemini-admin-token") || "").trim();
}

export function loginGeminiAdmin({ password, now = new Date(), env = process.env } = {}) {
  const config = getGeminiAdminConfig(env);
  if (!config.password) {
    const error = new Error("Gemini admin password is not configured.");
    error.status = 503;
    throw error;
  }
  if (!password || !safeEqual(String(password).trim(), config.password)) {
    const error = new Error("Gemini password required.");
    error.status = 401;
    throw error;
  }
  return createGeminiAdminSession({ now, env });
}

export function makeGeminiAdminMiddleware({ env = process.env } = {}) {
  return function requireGeminiAdmin(req, res, next) {
    const result = verifyGeminiAdminToken(bearerToken(req), { env });
    if (!result.ok) {
      res.status(result.status || 401).json({ ok: false, error: result.error || "Gemini password required." });
      return;
    }
    req.geminiAdminAuth = result.session;
    req.memphisAuth = result.session;
    next();
  };
}
