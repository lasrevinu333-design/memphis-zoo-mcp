import { createHmac, timingSafeEqual } from "crypto";

const RESET_HOUR_LOCAL = 4;
const TOKEN_VERSION = 1;
const MEMPHIS_TIME_ZONE = "America/Chicago";
const DEFAULT_MAX_PIN_ATTEMPTS = 3;

export function isOpsManagerAuthDisabled(env = process.env) {
  // Auth is enabled by default. Only disabled when OPS_MANAGER_AUTH_DISABLED is explicitly set to 'true'.
  return String(env.OPS_MANAGER_AUTH_DISABLED || "false").toLowerCase() === "true";
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

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function ymdFromParts({ year, month, day }) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function getZonedParts(date, timeZone = MEMPHIS_TIME_ZONE) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  const hour = Number(parts.hour) === 24 ? 0 : Number(parts.hour);
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour,
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

function addCivilDays({ year, month, day }, deltaDays) {
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day) + deltaDays, 12, 0, 0, 0));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function zonedCivilTimeToUtc({ year, month, day, hour = 0, minute = 0, second = 0 }, timeZone = MEMPHIS_TIME_ZONE) {
  const target = { year: Number(year), month: Number(month), day: Number(day), hour: Number(hour), minute: Number(minute), second: Number(second) };
  let utcMs = Date.UTC(target.year, target.month - 1, target.day, target.hour, target.minute, target.second, 0);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = getZonedParts(new Date(utcMs), timeZone);
    const seenMs = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second, 0);
    const wantedMs = Date.UTC(target.year, target.month - 1, target.day, target.hour, target.minute, target.second, 0);
    const diff = wantedMs - seenMs;
    if (diff === 0) break;
    utcMs += diff;
  }
  return new Date(utcMs);
}

export function getOperationalDayKey(now = new Date(), timeZone = MEMPHIS_TIME_ZONE) {
  const parts = getZonedParts(now, timeZone);
  const operationalDate = parts.hour < RESET_HOUR_LOCAL ? addCivilDays(parts, -1) : parts;
  return ymdFromParts(operationalDate);
}

export function getNextDailyReset(now = new Date(), timeZone = MEMPHIS_TIME_ZONE) {
  const parts = getZonedParts(now, timeZone);
  let resetDate = { year: parts.year, month: parts.month, day: parts.day };
  if (parts.hour >= RESET_HOUR_LOCAL) resetDate = addCivilDays(resetDate, 1);
  return zonedCivilTimeToUtc({ ...resetDate, hour: RESET_HOUR_LOCAL, minute: 0, second: 0 }, timeZone);
}

export function getDailyPinConfig(env = process.env) {
  return {
    adminApiKey: String(env.ADMIN_API_KEY || "").trim(),
    opsManagerPin: String(env.OPS_MANAGER_DAILY_PIN || env.MEMPHIS_OPS_MANAGER_PIN || "").trim(),
    custodianPin: String(env.CUSTODIAN_DAILY_PIN || env.MEMPHIS_CUSTODIAN_PIN || "").trim(),
    sessionSecret: String(env.PIN_SESSION_SECRET || env.SUPABASE_SERVICE_ROLE_KEY || "").trim(),
    maxAttempts: Math.max(1, Number(env.PIN_MAX_ATTEMPTS || DEFAULT_MAX_PIN_ATTEMPTS) || DEFAULT_MAX_PIN_ATTEMPTS),
    timeZone: String(env.MEMPHIS_OPERATIONAL_TIME_ZONE || MEMPHIS_TIME_ZONE).trim() || MEMPHIS_TIME_ZONE,
  };
}

export function resolveRoleForPin(pin, env = process.env) {
  const provided = String(pin || "").trim();
  const config = getDailyPinConfig(env);
  if (provided && config.opsManagerPin && safeEqual(provided, config.opsManagerPin)) return "ops_manager";
  if (provided && config.custodianPin && safeEqual(provided, config.custodianPin)) return "custodian";
  return "";
}

function normalizeDeviceId(deviceId) {
  const normalized = String(deviceId || "").trim().replace(/[^a-zA-Z0-9_.:-]/g, "").slice(0, 96);
  return normalized || "unassigned-device";
}

export function createOpenOpsManagerSession({ deviceId, now = new Date(), env = process.env } = {}) {
  const config = getDailyPinConfig(env);
  const expiresAt = getNextDailyReset(now, config.timeZone);
  return {
    v: TOKEN_VERSION,
    role: "ops_manager",
    token: "ops-manager-open-access",
    device_id: normalizeDeviceId(deviceId || "manager-hub-open"),
    operational_day: getOperationalDayKey(now, config.timeZone),
    exp: expiresAt.getTime(),
    expires_at: expiresAt.toISOString(),
    reset_hour_local: RESET_HOUR_LOCAL,
    time_zone: config.timeZone,
    auth_mode: "open",
  };
}

export function createAdminApiKeySession({ deviceId, now = new Date(), env = process.env } = {}) {
  return {
    ...createOpenOpsManagerSession({ deviceId: deviceId || "admin-api-key", now, env }),
    token: "admin-api-key",
    auth_mode: "admin_api_key",
  };
}

function allowOpenOpsManagerAccess(openWhenDisabled = false, env = process.env) {
  return openWhenDisabled === true && isOpsManagerAuthDisabled(env);
}

export function createDailyPinSession({ pin, deviceId, now = new Date(), env = process.env, requiredRole = "" } = {}) {
  const config = getDailyPinConfig(env);
  if (!config.sessionSecret) {
    const error = new Error("PIN_SESSION_SECRET is not configured on the server.");
    error.status = 503;
    throw error;
  }

  const role = resolveRoleForPin(pin, env);
  if (!role || (requiredRole && role !== requiredRole)) {
    const error = new Error(requiredRole === "ops_manager" ? "Ops manager PIN required." : "Invalid daily PIN.");
    error.status = 401;
    throw error;
  }

  const expiresAt = getNextDailyReset(now, config.timeZone);
  const payload = {
    v: TOKEN_VERSION,
    role,
    device_id: normalizeDeviceId(deviceId),
    operational_day: getOperationalDayKey(now, config.timeZone),
    exp: expiresAt.getTime(),
  };
  const encoded = base64UrlEncode(JSON.stringify(payload));
  const signature = hmac(config.sessionSecret, encoded);
  return {
    token: `${encoded}.${signature}`,
    role,
    device_id: payload.device_id,
    operational_day: payload.operational_day,
    expires_at: expiresAt.toISOString(),
    reset_hour_local: RESET_HOUR_LOCAL,
    time_zone: config.timeZone,
  };
}

export function verifyDailyPinToken(token, { allowedRoles = ["ops_manager", "custodian"], now = new Date(), env = process.env, deviceId = "" } = {}) {
  const config = getDailyPinConfig(env);
  if (!config.sessionSecret) return { ok: false, status: 503, error: "PIN_SESSION_SECRET is not configured on the server." };
  const raw = String(token || "").trim();
  const [encoded, signature, extra] = raw.split(".");
  if (!encoded || !signature || extra !== undefined) return { ok: false, status: 401, error: "Unauthorized" };
  const expected = hmac(config.sessionSecret, encoded);
  if (!safeEqual(signature, expected)) return { ok: false, status: 401, error: "Unauthorized" };

  let payload;
  try {
    payload = JSON.parse(base64UrlDecode(encoded));
  } catch {
    return { ok: false, status: 401, error: "Unauthorized" };
  }

  if (payload?.v !== TOKEN_VERSION) return { ok: false, status: 401, error: "Unauthorized" };
  if (!allowedRoles.includes(payload.role)) return { ok: false, status: 403, error: "Forbidden" };
  if (!Number.isFinite(Number(payload.exp)) || Number(payload.exp) <= now.getTime()) return { ok: false, status: 401, error: "Session expired" };
  if (payload.operational_day !== getOperationalDayKey(now, config.timeZone)) return { ok: false, status: 401, error: "Session expired" };
  const expectedDeviceId = normalizeDeviceId(deviceId);
  if (expectedDeviceId === "unassigned-device" || normalizeDeviceId(payload.device_id) !== expectedDeviceId) return { ok: false, status: 401, error: "Device mismatch" };
  return { ok: true, session: payload };
}

function bearerToken(req) {
  const authorization = String(req?.header?.("authorization") || "").trim();
  if (/^bearer\s+/i.test(authorization)) return authorization.replace(/^bearer\s+/i, "").trim();
  return String(req?.header?.("x-memphis-auth") || "").trim();
}

function adminApiKey(req) {
  return String(req?.header?.("x-admin-key") || req?.header?.("x-api-key") || "").trim();
}

function requestDeviceId(req) {
  return req?.body?.device_id || req?.body?.deviceId || req?.query?.device_id || req?.header?.("x-device-id") || "";
}

export function authenticateDailyPinRequest(req, { allowedRoles = ["ops_manager", "custodian"], env = process.env, openWhenDisabled = false } = {}) {
  if (allowOpenOpsManagerAccess(openWhenDisabled, env)) {
    return { ok: true, session: createOpenOpsManagerSession({ deviceId: requestDeviceId(req), env }) };
  }
  const config = getDailyPinConfig(env);
  const providedAdminApiKey = adminApiKey(req);
  if (config.adminApiKey && providedAdminApiKey && safeEqual(providedAdminApiKey, config.adminApiKey)) {
    if (!allowedRoles.includes("ops_manager")) return { ok: false, status: 403, error: "Forbidden" };
    return { ok: true, session: createAdminApiKeySession({ deviceId: requestDeviceId(req), env }) };
  }
  return verifyDailyPinToken(bearerToken(req), { allowedRoles, env, deviceId: requestDeviceId(req) });
}

export function makeDailyPinMiddleware({ allowedRoles = ["ops_manager", "custodian"], env = process.env, openWhenDisabled = false } = {}) {
  return function requireDailyPin(req, res, next) {
    const result = authenticateDailyPinRequest(req, { allowedRoles, env, openWhenDisabled });
    if (!result.ok) {
      res.status(result.status || 401).json({ ok: false, error: result.error || "Unauthorized" });
      return;
    }
    req.memphisAuth = result.session;
    next();
  };
}

function clientIp(req) {
  return String(req?.headers?.["x-forwarded-for"] || req?.ip || req?.socket?.remoteAddress || "unknown").split(",")[0].trim() || "unknown";
}

function pinAttemptKey(req, env) {
  const config = getDailyPinConfig(env);
  return `${getOperationalDayKey(new Date(), config.timeZone)}:${clientIp(req)}:${normalizeDeviceId(requestDeviceId(req))}`;
}

function lockoutResponse(res, resetAt) {
  res.status(429).json({ ok: false, error: "Too many invalid PIN attempts. Try again after the 4 AM reset.", locked: true, reset_at: resetAt.toISOString() });
}

function cleanupOldAttempts(attempts, todayKey) {
  const todayDate = todayKey.split(":")[0];
  for (const key of attempts.keys()) {
    const keyDate = key.split(":")[0];
    if (keyDate !== todayDate) {
      attempts.delete(key);
    }
  }
}

export function installDailyPinAuthRoutes(app, { setCors, env = process.env, attempts = new Map() } = {}) {
  const applyCors = typeof setCors === "function" ? setCors : (_res) => {};
  app.use("/auth-api", (req, res, next) => {
    applyCors(res, req);
    if (req.method === "OPTIONS") {
      res.sendStatus(200);
      return;
    }
    next();
  });

  app.post("/auth-api/pin/login", (req, res) => {
    const requiredRole = String(req.body?.role || req.body?.required_role || "").trim();
    if (isOpsManagerAuthDisabled(env) && requiredRole === "ops_manager") {
      res.status(200).json({ ok: true, data: createOpenOpsManagerSession({ deviceId: requestDeviceId(req), env }) });
      return;
    }
    const config = getDailyPinConfig(env);
    const key = pinAttemptKey(req, env);
    cleanupOldAttempts(attempts, key);
    const resetAt = getNextDailyReset(new Date(), config.timeZone);
    const record = attempts.get(key);
    if (record?.locked && Number(record.reset_ms || 0) > Date.now()) {
      lockoutResponse(res, new Date(record.reset_ms));
      return;
    }

    try {
      const session = createDailyPinSession({
        pin: req.body?.pin,
        deviceId: requestDeviceId(req),
        requiredRole,
        env,
      });
      attempts.delete(key);
      res.status(200).json({ ok: true, data: session });
    } catch (error) {
      const failures = Number(record?.failures || 0) + 1;
      const locked = failures >= config.maxAttempts;
      attempts.set(key, { failures, locked, reset_ms: resetAt.getTime() });
      if (locked) {
        lockoutResponse(res, resetAt);
        return;
      }
      res.status(error?.status || 500).json({ ok: false, error: error?.message || "PIN login failed", attempts_remaining: Math.max(0, config.maxAttempts - failures) });
    }
  });

  app.get("/auth-api/session", makeDailyPinMiddleware({ allowedRoles: ["ops_manager", "custodian"], env }), (req, res) => {
    const config = getDailyPinConfig(env);
    res.status(200).json({ ok: true, data: { session: req.memphisAuth, operational_day: getOperationalDayKey(new Date(), config.timeZone), expires_at: getNextDailyReset(new Date(), config.timeZone).toISOString() } });
  });
}
