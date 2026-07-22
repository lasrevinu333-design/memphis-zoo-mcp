import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { makeOpsAccessMiddleware } from "./auth/shared-access-auth.js";

const NATIVE_ENROLL_ATTEMPTS = new Map();
const NATIVE_ENROLL_WINDOW_MS = 15 * 60 * 1000;
const NATIVE_ENROLL_LIMIT = 8;

function envText(env, key) { return String(env?.[key] || "").trim(); }
function clip(value, max = 1000) { return String(value ?? "").trim().slice(0, max); }
function createSupabase(env) {
  const url = envText(env, "SUPABASE_URL");
  const key = envText(env, "SUPABASE_SERVICE_ROLE_KEY");
  return url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
}
function hasRole(session, role) {
  const wanted = String(role || "").trim().toUpperCase();
  return Array.isArray(session?.roles) && session.roles.some((item) => String(item || "").trim().toUpperCase() === wanted);
}
function allowedOrigins(env) {
  return new Set([
    "https://memphis-zoo-mcp.onrender.com",
    "https://lasrevinu333-design.github.io",
    "https://localhost",
    "http://localhost",
    "capacitor://localhost",
    "ionic://localhost",
    ...envText(env, "ALLOWED_CORS_ORIGINS").split(",").map((value) => value.trim()).filter(Boolean),
  ]);
}
function setCors(req, res, env) {
  const origin = String(req.headers?.origin || "").trim();
  if (origin && allowedOrigins(env).has(origin)) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Device-Id, X-Device-Credential, X-Memphis-App-Edition, Idempotency-Key");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Vary", "Origin");
}
function fail(res, error, fallback = "Custodial employee administration failed.") {
  const status = Number(error?.status || error?.statusCode) || (/permission|access/i.test(String(error?.message || "")) ? 403 : 500);
  res.status(Math.max(400, Math.min(599, status))).json({ ok: false, error: clip(error?.message || fallback, 1000) });
}
function normalizeDeviceId(value) {
  const raw = String(value || "").trim().toUpperCase().replace(/^KIOSK[-_ ]?/, "KIOSK_");
  if (/^KIOSK_[2-9]$/.test(raw)) return `KIOSK_0${raw.slice(7)}`;
  return raw;
}
function serviceSecret(env) {
  const value = envText(env, "DEVICE_CREDENTIAL_SECRET") || envText(env, "OPS_MANAGER_SESSION_SECRET") || envText(env, "SUPABASE_SERVICE_ROLE_KEY");
  if (!value) throw Object.assign(new Error("Device credential signing is not configured."), { status: 503 });
  return value;
}
function hmacHex(env, purpose, value) {
  return crypto.createHmac("sha256", serviceSecret(env)).update(`${purpose}:${String(value || "")}`, "utf8").digest("hex");
}
function enrollmentCodeHash(env, devicePk, code) { return hmacHex(env, "device-enrollment", `${devicePk}:${code}`); }
function tokenHash(env, secret) { return hmacHex(env, "device-token", secret); }
function nativeAttemptKey(req, deviceId) {
  const ip = String(req.headers?.["x-forwarded-for"] || req.ip || req.socket?.remoteAddress || "unknown").split(",")[0].trim();
  return `${ip}|${deviceId || "unknown"}`;
}
function consumeNativeAttempt(req, deviceId) {
  const now = Date.now();
  const key = nativeAttemptKey(req, deviceId);
  let bucket = NATIVE_ENROLL_ATTEMPTS.get(key);
  if (!bucket || now - bucket.startedAt >= NATIVE_ENROLL_WINDOW_MS) bucket = { startedAt: now, count: 0 };
  bucket.count += 1;
  NATIVE_ENROLL_ATTEMPTS.set(key, bucket);
  return { allowed: bucket.count <= NATIVE_ENROLL_LIMIT, retryAfter: Math.max(1, Math.ceil((NATIVE_ENROLL_WINDOW_MS - (now - bucket.startedAt)) / 1000)), key };
}

async function loadPhoneAdminSnapshot(db) {
  const expected = Array.from({ length: 9 }, (_value, index) => `KIOSK_${String(index + 2).padStart(2, "0")}`);
  const [devicesResult, employeesResult, credentialsResult, historyResult] = await Promise.all([
    db.from("devices")
      .select("id,device_id,device_name,active,assigned_employee_id,last_seen_at,updated_at,employees!devices_assigned_employee_id_fkey(id,employee_code,display_name,active,role)")
      .in("device_id", expected).order("device_id"),
    db.from("employees").select("id,employee_code,display_name,active,role,notes,updated_at")
      .eq("role", "staff").like("employee_code", "EMP%").order("active", { ascending: false }).order("display_name"),
    db.from("device_auth_credentials").select("credential_id,device_id,device_label,confirmed_at,last_used_at,expires_at,revoked_at")
      .is("revoked_at", null).gt("expires_at", new Date().toISOString()),
    db.from("custodial_employee_device_assignment_history")
      .select("assignment_change_id,device_identifier,previous_employee_name,new_employee_name,change_reason,changed_at")
      .order("changed_at", { ascending: false }).limit(30),
  ]);
  for (const result of [devicesResult, employeesResult, credentialsResult, historyResult]) if (result.error) throw result.error;
  const credentialByDevicePk = new Map((credentialsResult.data || []).map((row) => [String(row.device_id), row]));
  const deviceById = new Map((devicesResult.data || []).map((row) => [String(row.device_id).toUpperCase(), row]));
  const phones = expected.map((deviceId) => {
    const row = deviceById.get(deviceId) || null;
    const employee = Array.isArray(row?.employees) ? row.employees[0] : row?.employees;
    const credential = row ? credentialByDevicePk.get(String(row.id)) || null : null;
    return {
      device_pk: row?.id || null,
      device_id: deviceId,
      device_name: row?.device_name || `Unregistered ${deviceId}`,
      active: row?.active === true,
      assigned_employee_id: row?.assigned_employee_id || null,
      assigned_employee: employee || null,
      last_seen_at: row?.last_seen_at || null,
      updated_at: row?.updated_at || null,
      enrolled: Boolean(credential),
      credential_confirmed: Boolean(credential?.confirmed_at),
      credential_last_used_at: credential?.last_used_at || null,
    };
  });
  return {
    phones,
    employees: employeesResult.data || [],
    recent_changes: historyResult.data || [],
    generated_at: new Date().toISOString(),
  };
}

async function resolveNativeDevice(db, identifier) {
  const normalized = normalizeDeviceId(identifier);
  if (!/^KIOSK_(0[2-9]|10)$/.test(normalized)) return null;
  const direct = await db.from("devices")
    .select("id,device_id,device_name,active,assigned_employee_id,employees!devices_assigned_employee_id_fkey(id,employee_code,display_name,active,role)")
    .eq("device_id", normalized).maybeSingle();
  if (direct.error) throw direct.error;
  return direct.data || null;
}

export function installCustodialEmployeeAdminRoutes(app, { env = process.env, supabase = null } = {}) {
  if (!app || app.__custodialEmployeeAdminRoutesInstalled) return;
  Object.defineProperty(app, "__custodialEmployeeAdminRoutesInstalled", { value: true });
  const db = supabase || createSupabase(env);
  const requireManager = makeOpsAccessMiddleware({ supabase: db });
  const configured = (_req, res, next) => db ? next() : res.status(503).json({ ok: false, error: "Database connection is not configured." });
  const requireCustodial = (req, res, next) => requireManager(req, res, () => hasRole(req.memphisAuth, "CUSTODIAL_MANAGER")
    ? next()
    : res.status(403).json({ ok: false, error: "Custodial Manager access is required." }));

  for (const prefix of ["/custodial-admin-api", "/custodial-device-auth"]) {
    app.use(prefix, (req, res, next) => {
      setCors(req, res, env);
      if (req.method === "OPTIONS") return res.sendStatus(200);
      next();
    });
  }

  app.get("/custodial-admin-api/employee-phones", configured, requireCustodial, async (_req, res) => {
    try { res.json({ ok: true, data: await loadPhoneAdminSnapshot(db) }); }
    catch (error) { fail(res, error, "Employee phones could not be loaded."); }
  });

  app.post("/custodial-admin-api/employees", configured, requireCustodial, async (req, res) => {
    try {
      const result = await db.rpc("custodial_create_employee", {
        p_display_name: clip(req.body?.display_name, 160),
        p_employee_code: clip(req.body?.employee_code, 32) || null,
        p_notes: clip(req.body?.notes, 2000) || null,
        p_changed_by_manager_id: req.memphisAuth.manager_id,
      });
      if (result.error) throw result.error;
      res.status(201).json({ ok: true, data: result.data });
    } catch (error) { fail(res, error, "Employee could not be created."); }
  });

  app.patch("/custodial-admin-api/employees/:employeeId/status", configured, requireCustodial, async (req, res) => {
    try {
      const employeeId = String(req.params?.employeeId || "").trim();
      if (!/^[0-9a-f-]{36}$/i.test(employeeId)) return res.status(400).json({ ok: false, error: "A valid employee ID is required." });
      const result = await db.rpc("custodial_set_employee_active", {
        p_employee_id: employeeId,
        p_active: req.body?.active === true,
        p_changed_by_manager_id: req.memphisAuth.manager_id,
        p_reason: clip(req.body?.reason, 500) || null,
        p_release_devices: req.body?.release_devices !== false,
      });
      if (result.error) throw result.error;
      res.json({ ok: true, data: result.data });
    } catch (error) { fail(res, error, "Employee status could not be changed."); }
  });

  app.put("/custodial-admin-api/devices/:deviceId/assignment", configured, requireCustodial, async (req, res) => {
    try {
      const deviceId = normalizeDeviceId(req.params?.deviceId || req.body?.device_id);
      const employeeId = String(req.body?.employee_id || "").trim();
      if (!/^KIOSK_(0[2-9]|10)$/.test(deviceId)) return res.status(400).json({ ok: false, error: "Choose KIOSK_02 through KIOSK_10." });
      if (employeeId && !/^[0-9a-f-]{36}$/i.test(employeeId)) return res.status(400).json({ ok: false, error: "A valid employee ID is required." });
      const result = await db.rpc("custodial_assign_employee_device", {
        p_device_identifier: deviceId,
        p_employee_id: employeeId || null,
        p_changed_by_manager_id: req.memphisAuth.manager_id,
        p_reason: clip(req.body?.reason, 500) || null,
        p_move_existing: req.body?.move_existing === true,
      });
      if (result.error) throw result.error;
      res.json({ ok: true, data: result.data });
    } catch (error) { fail(res, error, "Phone assignment could not be changed."); }
  });

  app.post("/custodial-device-auth/enroll", configured, async (req, res) => {
    const origin = String(req.headers?.origin || "").trim();
    const edition = String(req.headers?.["x-memphis-app-edition"] || "").trim().toLowerCase();
    if (!["https://localhost", "capacitor://localhost", "ionic://localhost"].includes(origin) || edition !== "custodial") {
      return res.status(403).json({ ok: false, error: "Native custodial app enrollment is required." });
    }
    const deviceId = normalizeDeviceId(req.body?.device_id || req.headers?.["x-device-id"]);
    const attempt = consumeNativeAttempt(req, deviceId);
    if (!attempt.allowed) {
      res.setHeader("Retry-After", String(attempt.retryAfter));
      return res.status(429).json({ ok: false, error: "Too many enrollment attempts." });
    }
    try {
      const device = await resolveNativeDevice(db, deviceId);
      const employee = Array.isArray(device?.employees) ? device.employees[0] : device?.employees;
      if (!device || device.active !== true || !device.assigned_employee_id || employee?.active !== true || !/^EMP\d+$/i.test(String(employee?.employee_code || ""))) {
        return res.status(401).json({ ok: false, error: "This phone must be assigned to an active employee before enrollment." });
      }
      const code = String(req.body?.enrollment_code || req.body?.code || "").replace(/\D/g, "").slice(0, 8);
      if (!/^\d{8}$/.test(code)) return res.status(400).json({ ok: false, error: "Enter the eight-digit enrollment code." });
      const credentialId = crypto.randomUUID();
      const refreshSecret = crypto.randomBytes(32).toString("base64url");
      const expiresAt = new Date(Date.now() + 3650 * 86400000).toISOString();
      const consumed = await db.rpc("device_auth_consume_enrollment_code", {
        p_device_id: device.id,
        p_code_hash: enrollmentCodeHash(env, device.id, code),
        p_credential_id: credentialId,
        p_token_hash: tokenHash(env, refreshSecret),
        p_device_label: clip(req.body?.device_label, 160) || `${device.device_id} Custodial App`,
        p_expires_at: expiresAt,
        p_user_agent_hash: hmacHex(env, "privacy-ua", String(req.headers?.["user-agent"] || "")),
        p_ip_hash: null,
        p_metadata_json: { enrolled_by: "native_custodial_app", canonical_device_id: device.device_id },
      });
      if (consumed.error) throw consumed.error;
      if (!consumed.data?.ok) return res.status(401).json({ ok: false, error: "The enrollment code is invalid or expired." });
      NATIVE_ENROLL_ATTEMPTS.delete(attempt.key);
      res.json({ ok: true, data: {
        device_credential: `${credentialId}.${refreshSecret}`,
        credential_expires_at: consumed.data?.expires_at || expiresAt,
        device_id: device.device_id,
        device_name: device.device_name,
        employee: { id: employee.id, employee_code: employee.employee_code, display_name: employee.display_name },
      } });
    } catch (error) {
      const invalid = /invalid|expired|enrollment code/i.test(String(error?.message || ""));
      fail(res, Object.assign(error, { status: invalid ? 401 : (error?.status || 500) }), "Custodial app enrollment failed.");
    }
  });
}
