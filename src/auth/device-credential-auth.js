import { createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { isCanonicalEmployeeKiosk, normalizeDeviceIdentifier, resolveActiveAssignedDevice } from "../device-identity.js";

const DEVICE_COOKIE_NAME = "memphis_device_credential";
const DEFAULT_CREDENTIAL_TTL_DAYS = 3650;
const DEFAULT_ENROLLMENT_TTL_MINUTES = 30;
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
  const value = String(
    env.DEVICE_CREDENTIAL_SECRET
      || env.OPS_MANAGER_SESSION_SECRET
      || env.SUPABASE_SERVICE_ROLE_KEY
      || ""
  ).trim();
  if (!value) {
    const error = new Error("Device credential secret is not configured.");
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
        .select("credential_id,device_id,token_hash,device_label,created_at,confirmed_at,last_used_at,expires_at,revoked_at,revoked_reason")
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

async function resolveDevice(req, runReadOnlySql) {
  const identifier = requestDeviceIdentifier(req);
  if (!identifier) return { identifier: "", device: null };
  const device = await resolveActiveAssignedDevice({ runReadOnlySql, deviceIdentifier: identifier });
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

  const { identifier, device } = await resolveDevice(req, runReadOnlySql);
  if (!identifier) return { ok: false, status: 401, code: "device_id_required", error: "device_id is required." };
  if (!device || !device.device_active) return { ok: false, status: 401, code: "device_not_registered", error: "Registered device is required." };
  if (!isEligibleEmployeeDevice(device)) {
    return { ok: false, status: 403, code: "device_not_eligible", error: "An active canonical employee kiosk assignment is required." };
  }

  const policy = await store.getPolicy();
  const rawToken = requestCredentialToken(req);
  const parts = credentialTokenParts(rawToken);
  if (parts) {
    const row = await store.findCredential(parts.credentialId);
    const expiresAt = Date.parse(String(row?.expires_at || ""));
    const valid = Boolean(
      row
      && !row.revoked_at
      && Number.isFinite(expiresAt)
      && expiresAt > now.getTime()
      && String(row.device_id || "") === String(device.canonical_device_pk || "")
      && row.token_hash
      && safeEqual(row.token_hash, tokenHash(parts.secret, env))
    );
    if (valid) {
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
  return String(req?.memphisAuth?.device_id || req?.memphisAuth?.session_id || "ops_manager").slice(0, 160);
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
    }
    clearDeviceCredentialCookie(res, req, env);
    res.status(200).json({ ok: true, data: { logged_out: true } });
  });

  app.get("/admin-api/device-auth/summary", requireOpsAuth, async (_req, res) => {
    try {
      const [policy, coverage] = await Promise.all([store.getPolicy(), activeDeviceCoverage({ supabase })]);
      res.status(200).json({ ok: true, data: { policy, coverage } });
    } catch (error) {
      res.status(500).json({ ok: false, error: error?.message || "Device authentication summary failed." });
    }
  });

  app.post("/admin-api/device-auth/enrollment-code", requireOpsWrite, async (req, res) => {
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
        metadata: { canonical_device_id: device.canonical_device_id, employee_name: device.assigned_employee_name },
      });
      await audit(store, authEvent(req, device, { eventType: "enrollment_code_issued", success: true, metadata: { enrollment_id: row?.enrollment_id }, env }));
      res.status(200).json({
        ok: true,
        data: {
          enrollment_code: code,
          enrollment_id: row?.enrollment_id || null,
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

  app.post("/admin-api/device-auth/mode", requireOpsWrite, async (req, res) => {
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

  app.post("/admin-api/device-auth/credentials/:credentialId/revoke", requireOpsWrite, async (req, res) => {
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
