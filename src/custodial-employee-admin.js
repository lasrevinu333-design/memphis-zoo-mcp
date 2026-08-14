import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { makeOpsAccessMiddleware } from "./auth/shared-access-auth.js";

const NATIVE_ENROLL_ATTEMPTS = new Map();
const NATIVE_ENROLL_WINDOW_MS = 15 * 60 * 1000;
const NATIVE_ENROLL_LIMIT = 8;
const EMPLOYEE_ENROLLMENT_TTL_MS = 30 * 60 * 1000;
const ENROLLMENT_RESULT_TTL_MS = 30 * 60 * 1000;
const ENROLLMENT_RESULT_ENCRYPTION = "aes-256-gcm.v1";

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
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Device-Id, X-Device-Credential, X-Memphis-Device-Credential, X-Memphis-App-Edition, Idempotency-Key");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Vary", "Origin");
}
function fail(res, error, fallback = "Custodial employee administration failed.") {
  const status = Number(error?.status || error?.statusCode) || (/permission|access/i.test(String(error?.message || "")) ? 403 : 500);
  res.status(Math.max(400, Math.min(599, status))).json({ ok: false, error: clip(error?.message || fallback, 1000) });
}
function missingRelation(error, relation) {
  const code = String(error?.code || "").toUpperCase();
  const message = [error?.message, error?.details, error?.hint, error]
    .map((value) => String(value || ""))
    .join(" ");
  return ["42P01", "PGRST205"].includes(code)
    && (!relation || message.toLowerCase().includes(String(relation).toLowerCase()));
}
function normalizeDeviceId(value) {
  const raw = String(value || "").trim().toUpperCase().replace(/^KIOSK[-_ ]?/, "KIOSK_");
  if (/^KIOSK_[2-9]$/.test(raw)) return `KIOSK_0${raw.slice(7)}`;
  return raw;
}
function validKioskId(value) { return /^KIOSK_(0[2-9]|10)$/.test(normalizeDeviceId(value)); }
function validUuid(value) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || "").trim()); }
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
function isNativeCustodialRequest(req) {
  const origin = String(req.headers?.origin || "").trim();
  const edition = String(req.headers?.["x-memphis-app-edition"] || "").trim().toLowerCase();
  return ["https://localhost", "http://localhost", "capacitor://localhost", "ionic://localhost"].includes(origin)
    && edition === "custodial";
}
function enrollmentOperationId(req) {
  const bodyValue = String(req.body?.operation_id || req.body?.operationId || "").trim();
  const headerValue = String(req.headers?.["idempotency-key"] || "").trim();
  if (bodyValue && headerValue && bodyValue !== headerValue) {
    throw Object.assign(new Error("operation_id and Idempotency-Key must match."), { status: 409, code: "enrollment_operation_conflict" });
  }
  const value = bodyValue || headerValue;
  if (!validUuid(value)) {
    throw Object.assign(new Error("A stable UUID operation_id or Idempotency-Key is required."), { status: 400, code: "enrollment_operation_id_required" });
  }
  return value;
}
function removalOperationId(req) {
  const bodyValue = String(req.body?.operation_id || req.body?.operationId || "").trim();
  const headerValue = String(req.headers?.["idempotency-key"] || "").trim();
  if (bodyValue && headerValue && bodyValue !== headerValue) {
    throw Object.assign(new Error("operation_id and Idempotency-Key must match."), { status: 409, code: "removal_operation_conflict" });
  }
  const value = bodyValue || headerValue;
  if (!validUuid(value)) {
    throw Object.assign(new Error("A stable UUID operation_id or Idempotency-Key is required."), { status: 400, code: "removal_operation_id_required" });
  }
  return value;
}
function enrollmentResultKey(env) {
  return Buffer.from(crypto.hkdfSync(
    "sha256",
    Buffer.from(serviceSecret(env), "utf8"),
    Buffer.from("memphis-zoo-custodial-enrollment-result", "utf8"),
    Buffer.from(ENROLLMENT_RESULT_ENCRYPTION, "utf8"),
    32,
  ));
}
function enrollmentResultAad(operationId) {
  return Buffer.from(`memphis-zoo:custodial-enrollment:${operationId}:${ENROLLMENT_RESULT_ENCRYPTION}`, "utf8");
}
function encryptEnrollmentResult(env, operationId, value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", enrollmentResultKey(env), iv);
  cipher.setAAD(enrollmentResultAad(operationId));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return {
    encryptionVersion: ENROLLMENT_RESULT_ENCRYPTION,
    ciphertext: ciphertext.toString("base64url"),
    iv: iv.toString("base64url"),
    authTag: cipher.getAuthTag().toString("base64url"),
  };
}
function decryptEnrollmentResult(env, operationId, value = {}) {
  if (String(value.encryption_version || "") !== ENROLLMENT_RESULT_ENCRYPTION) {
    throw Object.assign(new Error("The resumable enrollment result uses an unsupported encryption version."), { status: 503, code: "enrollment_result_unavailable" });
  }
  try {
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      enrollmentResultKey(env),
      Buffer.from(String(value.result_iv || ""), "base64url"),
    );
    decipher.setAAD(enrollmentResultAad(operationId));
    decipher.setAuthTag(Buffer.from(String(value.result_auth_tag || ""), "base64url"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(String(value.result_ciphertext || ""), "base64url")),
      decipher.final(),
    ]).toString("utf8");
    const parsed = JSON.parse(plaintext);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid enrollment result");
    return parsed;
  } catch (error) {
    throw Object.assign(new Error("The resumable enrollment result could not be authenticated."), {
      status: 503,
      code: "enrollment_result_unavailable",
      cause: error,
    });
  }
}
function nativeCredentialParts(req) {
  const authorization = String(req.headers?.authorization || "").trim();
  const match = authorization.match(/^Device\s+(.+)$/i);
  const raw = String(
    match?.[1]
      || req.headers?.["x-device-credential"]
      || req.headers?.["x-memphis-device-credential"]
      || "",
  ).trim();
  const dot = raw.indexOf(".");
  if (dot <= 0) return null;
  const credentialId = raw.slice(0, dot);
  const secret = raw.slice(dot + 1);
  return validUuid(credentialId) && /^[A-Za-z0-9_-]{32,}$/.test(secret)
    ? { credentialId, secret }
    : null;
}
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
  const [devicesResult, employeesResult, credentialsResult, historyResult, syncResult] = await Promise.all([
    db.from("devices")
      .select("id,device_id,device_name,active,assigned_employee_id,assignment_epoch,last_seen_at,updated_at,employees!devices_assigned_employee_id_fkey(id,employee_code,display_name,active,role)")
      .in("device_id", expected).order("device_id"),
    db.from("employees").select("id,employee_code,display_name,active,role,notes,updated_at")
      .eq("role", "staff").like("employee_code", "EMP%").order("active", { ascending: false }).order("display_name"),
    db.from("device_auth_credentials").select("credential_id,device_id,device_label,confirmed_at,last_used_at,expires_at,revoked_at")
      .is("revoked_at", null).gt("expires_at", new Date().toISOString()),
    db.from("custodial_employee_device_assignment_history")
      .select("assignment_change_id,device_identifier,previous_employee_name,new_employee_name,change_reason,changed_at")
      .order("changed_at", { ascending: false }).limit(30),
    db.from("device_sync_status")
      .select("device_id,queue_count,oldest_item_at,retry_count,last_error,queue_authority_groups,updated_at"),
  ]);
  for (const result of [devicesResult, employeesResult, credentialsResult, historyResult, syncResult]) if (result.error) throw result.error;
  const snapshotEntries = await Promise.all((devicesResult.data || []).map(async (deviceRow) => {
    const result = await db.from("custodial_offline_scan_authority_snapshots")
      .select("device_id,employee_id,assignment_epoch,generated_at,expires_at")
      .eq("device_id", deviceRow.id)
      .gt("expires_at", new Date().toISOString())
      .order("generated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (result.error) {
      if (missingRelation(result.error, "custodial_offline_scan_authority_snapshots")) return [String(deviceRow.id), null];
      throw result.error;
    }
    return [String(deviceRow.id), result.data || null];
  }));
  const credentialByDevicePk = new Map((credentialsResult.data || []).map((row) => [String(row.device_id), row]));
  const syncByDevicePk = new Map((syncResult.data || []).map((row) => [String(row.device_id), row]));
  const snapshotByDevicePk = new Map(snapshotEntries);
  const employeeById = new Map((employeesResult.data || []).map((row) => [String(row.id), row]));
  const deviceById = new Map((devicesResult.data || []).map((row) => [String(row.device_id).toUpperCase(), row]));
  const phones = expected.map((deviceId) => {
    const row = deviceById.get(deviceId) || null;
    const employee = Array.isArray(row?.employees) ? row.employees[0] : row?.employees;
    const credential = row ? credentialByDevicePk.get(String(row.id)) || null : null;
    const sync = row ? syncByDevicePk.get(String(row.id)) || null : null;
    const snapshot = row ? snapshotByDevicePk.get(String(row.id)) || null : null;
    const syncReportedAt = Date.parse(String(sync?.updated_at || ""));
    const pendingWorkStatus = !sync
      ? "unavailable"
      : (!Number.isFinite(syncReportedAt) || Date.now() - syncReportedAt > 5 * 60 * 1000 ? "stale" : "current");
    const pendingWorkGroups = (Array.isArray(sync?.queue_authority_groups) ? sync.queue_authority_groups : []).map((group) => ({
      employee_id: group.employee_id || null,
      employee_name: employeeById.get(String(group.employee_id || ""))?.display_name || null,
      assignment_epoch: Number(group.assignment_epoch),
      snapshot_id: group.snapshot_id || null,
      queue_count: Math.max(0, Number(group.queue_count || 0)),
      oldest_item_at: group.oldest_item_at || null,
    })).filter((group) => group.employee_id && Number.isSafeInteger(group.assignment_epoch) && group.assignment_epoch >= 1 && group.queue_count > 0);
    return {
      device_pk: row?.id || null,
      device_id: deviceId,
      device_name: row?.device_name || `Unregistered ${deviceId}`,
      active: row?.active === true,
      assigned_employee_id: row?.assigned_employee_id || null,
      assignment_epoch: row?.assignment_epoch == null ? null : Number(row.assignment_epoch),
      assigned_employee: employee || null,
      last_seen_at: row?.last_seen_at || null,
      updated_at: row?.updated_at || null,
      enrolled: Boolean(credential),
      credential_confirmed: Boolean(credential?.confirmed_at),
      credential_last_used_at: credential?.last_used_at || null,
      pending_work_count: Math.max(0, Number(sync?.queue_count || 0)),
      pending_work_status: pendingWorkStatus,
      pending_work_oldest_at: sync?.oldest_item_at || null,
      pending_work_retry_count: Math.max(0, Number(sync?.retry_count || 0)),
      pending_work_last_error: sync?.last_error || null,
      pending_work_reported_at: sync?.updated_at || null,
      pending_work_groups: pendingWorkGroups,
      pending_work_unbound_count: Math.max(0, Number(sync?.queue_count || 0) - pendingWorkGroups.reduce((total, group) => total + group.queue_count, 0)),
      offline_authority_expires_at: snapshot?.expires_at || null,
      offline_authority_generated_at: snapshot?.generated_at || null,
      offline_authority_employee_id: snapshot?.employee_id || null,
      offline_authority_employee_name: employeeById.get(String(snapshot?.employee_id || ""))?.display_name || null,
      offline_authority_assignment_epoch: snapshot?.assignment_epoch == null ? null : Number(snapshot.assignment_epoch),
    };
  });
  return {
    phones,
    employees: employeesResult.data || [],
    recent_changes: historyResult.data || [],
    generated_at: new Date().toISOString(),
  };
}

function legacySnapshot(snapshot) {
  const assignedByEmployee = new Map((snapshot.phones || []).filter((phone) => phone.assigned_employee_id).map((phone) => [phone.assigned_employee_id, phone.device_id]));
  return {
    devices: (snapshot.phones || []).map((phone) => ({
      ...phone,
      employee_name: phone.assigned_employee?.display_name || null,
      employee_code: phone.assigned_employee?.employee_code || null,
      employee_active: phone.assigned_employee?.active === true,
    })),
    employees: (snapshot.employees || []).filter((employee) => employee.active === true).map((employee) => ({
      ...employee,
      assigned_device_id: assignedByEmployee.get(employee.id) || null,
    })),
    recent_changes: snapshot.recent_changes || [],
    generated_at: snapshot.generated_at,
  };
}

async function resolveNativeDevice(db, identifier) {
  const normalized = normalizeDeviceId(identifier);
  if (!validKioskId(normalized)) return null;
  const direct = await db.from("devices")
    .select("id,device_id,device_name,active,assigned_employee_id,employees!devices_assigned_employee_id_fkey(id,employee_code,display_name,active,role)")
    .eq("device_id", normalized).maybeSingle();
  if (direct.error) throw direct.error;
  return direct.data || null;
}

async function assignDevice(db, req, deviceId, employeeId, values = {}) {
  const expectedOwnerProvided = Object.prototype.hasOwnProperty.call(values, "expected_current_employee_id");
  const expectedOwner = expectedOwnerProvided && values.expected_current_employee_id != null
    ? String(values.expected_current_employee_id).trim()
    : null;
  if (expectedOwner && !validUuid(expectedOwner)) {
    throw Object.assign(new Error("expected_current_employee_id must be a valid employee ID or null."), { status: 400 });
  }
  const result = await db.rpc("custodial_assign_employee_device", {
    p_device_identifier: normalizeDeviceId(deviceId),
    p_employee_id: employeeId || null,
    p_changed_by_manager_id: req.memphisAuth.manager_id,
    p_reason: clip(values.reason, 500) || null,
    p_move_existing: values.move_existing === true,
    p_expected_owner_provided: expectedOwnerProvided,
    p_expected_current_employee_id: expectedOwner,
  });
  if (result.error) {
    if (String(result.error.code || "") === "40001") result.error.status = 409;
    throw result.error;
  }
  return result.data;
}

async function issueEmployeeEnrollmentCode(db, env, req, deviceId) {
  const device = await resolveNativeDevice(db, deviceId);
  const employee = Array.isArray(device?.employees) ? device.employees[0] : device?.employees;
  if (!device || device.active !== true || !device.assigned_employee_id || employee?.active !== true || !/^EMP\d+$/i.test(String(employee?.employee_code || ""))) {
    throw Object.assign(new Error("Assign this phone to an active employee before generating an app code."), { status: 409 });
  }
  const code = String(crypto.randomInt(0, 100_000_000)).padStart(8, "0");
  const expiresAt = new Date(Date.now() + EMPLOYEE_ENROLLMENT_TTL_MS).toISOString();
  const result = await db.rpc("device_auth_issue_enrollment_code", {
    p_device_id: device.id,
    p_code_hash: enrollmentCodeHash(env, device.id, code),
    p_created_by: String(req.memphisAuth.manager_id || req.memphisAuth.manager_display_name || "custodial_manager"),
    p_expires_at: expiresAt,
    p_metadata_json: {
      purpose: "native_custodial_app_enrollment",
      canonical_device_id: device.device_id,
      employee_id: employee.id,
      employee_name: employee.display_name,
      max_uses: 1,
    },
  });
  if (result.error) throw result.error;
  return {
    enrollment_code: code,
    display_code: `${code.slice(0, 4)} ${code.slice(4)}`,
    enrollment_id: result.data?.enrollment_id || null,
    expires_at: result.data?.expires_at || expiresAt,
    max_uses: 1,
    device_id: device.device_id,
    device_name: device.device_name,
    employee: { id: employee.id, employee_code: employee.employee_code, display_name: employee.display_name },
  };
}

export function installCustodialEmployeeAdminRoutes(app, { env = process.env, supabase = null } = {}) {
  if (!app || app.__custodialEmployeeAdminRoutesInstalled) return;
  Object.defineProperty(app, "__custodialEmployeeAdminRoutesInstalled", { value: true });
  const db = supabase || createSupabase(env);
  const requireManagerRead = makeOpsAccessMiddleware({ env, supabase: db });
  const requireManagerWrite = makeOpsAccessMiddleware({ env, supabase: db, requireWrite: true });
  const configured = (_req, res, next) => db ? next() : res.status(503).json({ ok: false, error: "Database connection is not configured." });
  const requireCustodialRole = (requireManager) => (req, res, next) => requireManager(req, res, () => (
    hasRole(req.memphisAuth, "CUSTODIAL_MANAGER")
      ? next()
      : res.status(403).json({ ok: false, error: "Custodial Manager access is required." })
  ));
  const requireCustodialRead = requireCustodialRole(requireManagerRead);
  const requireCustodialWrite = requireCustodialRole(requireManagerWrite);

  for (const prefix of ["/custodial-admin-api", "/custodial-device-auth", "/leadership-api/phone-assignments"]) {
    app.use(prefix, (req, res, next) => {
      setCors(req, res, env);
      if (req.method === "OPTIONS") return res.sendStatus(200);
      next();
    });
  }

  app.get("/custodial-admin-api/employee-phones", configured, requireCustodialRead, async (_req, res) => {
    try { res.json({ ok: true, data: await loadPhoneAdminSnapshot(db) }); }
    catch (error) { fail(res, error, "Employee phones could not be loaded."); }
  });

  app.post("/custodial-admin-api/employees", configured, requireCustodialWrite, async (req, res) => {
    res.status(409).json({ ok: false, error: "Employee roster changes must be made from Weekly Schedule." });
  });

  app.patch("/custodial-admin-api/employees/:employeeId/status", configured, requireCustodialWrite, async (req, res) => {
    res.status(409).json({ ok: false, error: "Employee roster changes must be made from Weekly Schedule." });
  });

  app.put("/custodial-admin-api/devices/:deviceId/assignment", configured, requireCustodialWrite, async (req, res) => {
    try {
      const deviceId = normalizeDeviceId(req.params?.deviceId || req.body?.device_id);
      const employeeId = String(req.body?.employee_id || "").trim();
      if (req.body?.deactivate_previous === true) return res.status(409).json({ ok: false, error: "Employee departures must be recorded from Weekly Schedule before reassigning a phone." });
      if (!validKioskId(deviceId)) return res.status(400).json({ ok: false, error: "Choose KIOSK_02 through KIOSK_10." });
      if (employeeId && !validUuid(employeeId)) return res.status(400).json({ ok: false, error: "A valid employee ID is required." });
      const assignment = await assignDevice(db, req, deviceId, employeeId || null, req.body || {});
      res.json({ ok: true, data: assignment });
    } catch (error) { fail(res, error, "Phone assignment could not be changed."); }
  });

  app.post("/custodial-admin-api/devices/:deviceId/enrollment-code", configured, requireCustodialWrite, async (req, res) => {
    try { res.json({ ok: true, data: await issueEmployeeEnrollmentCode(db, env, req, req.params?.deviceId) }); }
    catch (error) { fail(res, error, "Employee app enrollment code could not be generated."); }
  });

  // Compatibility routes keep already-installed manager test builds working while
  // the unified Phone Assignments screen rolls out.
  app.get("/leadership-api/phone-assignments", configured, requireCustodialRead, async (_req, res) => {
    try { res.json({ ok: true, data: legacySnapshot(await loadPhoneAdminSnapshot(db)) }); }
    catch (error) { fail(res, error, "Employee phones could not be loaded."); }
  });

  app.post("/leadership-api/phone-assignments/:deviceId", configured, requireCustodialWrite, async (req, res) => {
    try {
      const requestedDevice = normalizeDeviceId(req.params?.deviceId);
      const createsOnly = String(req.params?.deviceId || "").trim().toLowerCase() === "unassigned";
      if (createsOnly || clip(req.body?.new_employee_name, 160) || req.body?.deactivate_previous === true) {
        return res.status(409).json({ ok: false, error: "Employee roster changes must be made from Weekly Schedule." });
      }
      let employee = null;
      let employeeId = String(req.body?.employee_id || "").trim() || null;
      if (employeeId && !validUuid(employeeId)) return res.status(400).json({ ok: false, error: "A valid employee ID is required." });
      if (!validKioskId(requestedDevice)) return res.status(400).json({ ok: false, error: "Choose KIOSK_02 through KIOSK_10." });
      const assignment = await assignDevice(db, req, requestedDevice, employeeId, {
        reason: "Phone assignment updated",
        move_existing: false,
        ...(Object.prototype.hasOwnProperty.call(req.body || {}, "expected_current_employee_id")
          ? { expected_current_employee_id: req.body.expected_current_employee_id }
          : {}),
      });
      if (!employee && employeeId) {
        const employeeResult = await db.from("employees").select("id,employee_code,display_name,active,role").eq("id", employeeId).maybeSingle();
        if (employeeResult.error) throw employeeResult.error;
        employee = employeeResult.data;
      }
      res.json({ ok: true, data: { employee: employee || null, device: assignment?.device || assignment, assignment } });
    } catch (error) { fail(res, error, "Phone assignment could not be changed."); }
  });

  app.post("/leadership-api/phone-assignments/:deviceId/enrollment-code", configured, requireCustodialWrite, async (req, res) => {
    try { res.json({ ok: true, data: await issueEmployeeEnrollmentCode(db, env, req, req.params?.deviceId) }); }
    catch (error) { fail(res, error, "Employee app enrollment code could not be generated."); }
  });

  const nativeEnrollment = (expectedFlow) => async (req, res) => {
    if (!isNativeCustodialRequest(req)) {
      return res.status(403).json({ ok: false, code: "native_custodial_app_required", error: "Native custodial app enrollment is required." });
    }
    const deviceId = normalizeDeviceId(req.body?.device_id || req.headers?.["x-device-id"]);
    const attempt = consumeNativeAttempt(req, deviceId);
    if (!attempt.allowed) {
      res.setHeader("Retry-After", String(attempt.retryAfter));
      return res.status(429).json({ ok: false, code: "device_enrollment_rate_limited", error: "Too many enrollment attempts." });
    }
    try {
      const operationId = enrollmentOperationId(req);
      const requestedFlow = String(req.body?.flow || expectedFlow).trim().toLowerCase();
      if (requestedFlow !== expectedFlow) {
        throw Object.assign(new Error(`Use /${expectedFlow === "recovery" ? "recover" : "enroll"} for the ${expectedFlow} flow.`), {
          status: 409,
          code: "enrollment_operation_conflict",
        });
      }
      const device = await resolveNativeDevice(db, deviceId);
      const employee = Array.isArray(device?.employees) ? device.employees[0] : device?.employees;
      if (!device || device.active !== true || !device.assigned_employee_id || employee?.active !== true || !/^EMP\d+$/i.test(String(employee?.employee_code || ""))) {
        return res.status(401).json({ ok: false, code: "device_not_eligible", error: "This phone must be assigned to an active employee before enrollment." });
      }
      const code = String(req.body?.enrollment_code || req.body?.code || "").replace(/\D/g, "").slice(0, 8);
      if (!/^\d{8}$/.test(code)) {
        return res.status(400).json({ ok: false, code: "invalid_enrollment_code", error: "Enter the eight-digit enrollment code." });
      }

      const expired = await db.rpc("device_auth_expire_custodial_enrollment_operations", {
        p_now: new Date().toISOString(),
        p_limit: 100,
      });
      if (expired.error) throw expired.error;

      const credentialId = crypto.randomUUID();
      const refreshSecret = crypto.randomBytes(32).toString("base64url");
      const expiresAt = new Date(Date.now() + 3650 * 86400000).toISOString();
      const resumeExpiresAt = new Date(Date.now() + ENROLLMENT_RESULT_TTL_MS).toISOString();
      const candidateResult = {
        device_credential: `${credentialId}.${refreshSecret}`,
        credential_id: credentialId,
        credential_expires_at: expiresAt,
        device_id: device.device_id,
        device_name: device.device_name,
        employee: { id: employee.id, employee_code: employee.employee_code, display_name: employee.display_name },
      };
      const encrypted = encryptEnrollmentResult(env, operationId, candidateResult);
      const consumed = await db.rpc("device_auth_consume_enrollment_operation", {
        p_operation_id: operationId,
        p_flow: expectedFlow,
        p_device_id: device.id,
        p_code_hash: enrollmentCodeHash(env, device.id, code),
        p_request_fingerprint: hmacHex(env, "custodial-enrollment-operation-request", `${expectedFlow}:${device.id}:${code}`),
        p_credential_id: credentialId,
        p_token_hash: tokenHash(env, refreshSecret),
        p_device_label: clip(req.body?.device_label, 160) || `${device.device_id} Custodial App`,
        p_expires_at: expiresAt,
        p_result_ciphertext: encrypted.ciphertext,
        p_result_iv: encrypted.iv,
        p_result_auth_tag: encrypted.authTag,
        p_result_expires_at: resumeExpiresAt,
        p_encryption_version: encrypted.encryptionVersion,
        p_user_agent_hash: hmacHex(env, "privacy-ua", String(req.headers?.["user-agent"] || "")),
        p_ip_hash: null,
        p_metadata_json: {
          enrolled_by: "native_custodial_app",
          canonical_device_id: device.device_id,
          enrollment_flow: expectedFlow,
        },
      });
      if (consumed.error) throw consumed.error;
      if (!consumed.data?.ok) {
        const reason = String(consumed.data?.reason || "invalid_or_expired");
        const conflict = reason === "operation_conflict";
        const unavailable = ["operation_confirmed", "operation_cancelled", "operation_expired", "credential_unavailable"].includes(reason);
        return res.status(conflict || unavailable ? 409 : 401).json({
          ok: false,
          code: conflict ? "enrollment_operation_conflict" : (unavailable ? reason : "invalid_enrollment_code"),
          error: conflict
            ? "This operation ID belongs to a different enrollment request."
            : (unavailable ? "This enrollment operation is no longer resumable." : "The enrollment code is invalid or expired."),
        });
      }
      const result = decryptEnrollmentResult(env, operationId, consumed.data);
      const resultParts = String(result.device_credential || "").split(".", 2);
      if (result.credential_id !== consumed.data.credential_id || resultParts[0] !== consumed.data.credential_id) {
        throw Object.assign(new Error("The enrollment operation result did not match its authoritative credential."), {
          status: 503,
          code: "enrollment_result_unavailable",
        });
      }
      NATIVE_ENROLL_ATTEMPTS.delete(attempt.key);
      res.json({ ok: true, data: {
        operation_id: operationId,
        flow: expectedFlow,
        replayed: consumed.data.replayed === true,
        resume_expires_at: consumed.data.resume_expires_at,
        ...result,
        credential_expires_at: consumed.data.credential_expires_at || result.credential_expires_at,
      } });
    } catch (error) {
      const invalid = /invalid|expired|enrollment code/i.test(String(error?.message || ""));
      const status = invalid ? 401 : (error?.status || 500);
      res.status(status).json({
        ok: false,
        code: error?.code || (invalid ? "invalid_enrollment_code" : "custodial_enrollment_failed"),
        error: invalid ? "The enrollment code is invalid or expired." : clip(error?.message || "Custodial app enrollment failed.", 1000),
      });
    }
  };

  app.post("/custodial-device-auth/enroll", configured, nativeEnrollment("enrollment"));
  app.post("/custodial-device-auth/recover", configured, nativeEnrollment("recovery"));

  const completeEnrollmentOperation = (action) => async (req, res) => {
    if (!isNativeCustodialRequest(req)) {
      return res.status(403).json({ ok: false, code: "native_custodial_app_required", error: "Native custodial app authorization is required." });
    }
    try {
      const operationId = String(req.params?.operationId || "").trim();
      if (!validUuid(operationId)) {
        return res.status(400).json({ ok: false, code: "invalid_operation_id", error: "A valid enrollment operation ID is required." });
      }
      const deviceId = normalizeDeviceId(req.body?.device_id || req.headers?.["x-device-id"]);
      const device = await resolveNativeDevice(db, deviceId);
      const credential = nativeCredentialParts(req);
      if (!device || !credential) {
        return res.status(401).json({ ok: false, code: "credential_required", error: "The enrollment operation credential is required." });
      }
      const rpcName = action === "confirm"
        ? "device_auth_confirm_enrollment_operation"
        : "device_auth_cancel_enrollment_operation";
      const result = await db.rpc(rpcName, {
        p_operation_id: operationId,
        p_device_id: device.id,
        p_credential_id: credential.credentialId,
        p_token_hash: tokenHash(env, credential.secret),
      });
      if (result.error) throw result.error;
      if (!result.data?.ok) {
        const reason = String(result.data?.reason || "operation_not_found");
        const conflict = reason === "operation_confirmed";
        return res.status(conflict ? 409 : 401).json({
          ok: false,
          code: reason,
          error: conflict ? "A confirmed enrollment operation must be removed through device logout." : "The enrollment operation could not be authenticated.",
        });
      }
      return res.json({ ok: true, data: result.data });
    } catch (error) {
      return res.status(error?.status || 503).json({
        ok: false,
        code: error?.code || `enrollment_operation_${action}_failed`,
        error: clip(error?.message || `Enrollment operation ${action} failed.`, 1000),
      });
    }
  };

  app.post("/custodial-device-auth/enrollment-operations/:operationId/confirm", configured, completeEnrollmentOperation("confirm"));
  app.post("/custodial-device-auth/enrollment-operations/:operationId/cancel", configured, completeEnrollmentOperation("cancel"));

  app.post("/custodial-device-auth/remove", configured, async (req, res) => {
    if (!isNativeCustodialRequest(req)) {
      return res.status(403).json({ ok: false, code: "native_custodial_app_required", error: "Native custodial app authorization is required." });
    }
    try {
      const operationId = removalOperationId(req);
      const deviceId = normalizeDeviceId(req.body?.device_id || req.headers?.["x-device-id"]);
      const device = await resolveNativeDevice(db, deviceId);
      const credential = nativeCredentialParts(req);
      if (!device || !credential) {
        return res.status(401).json({ ok: false, code: "credential_required", error: "An enrolled custodial device credential is required." });
      }

      const result = await db.rpc("device_auth_remove_custodial_credential", {
        p_operation_id: operationId,
        p_device_id: device.id,
        p_credential_id: credential.credentialId,
        p_token_hash: tokenHash(env, credential.secret),
      });
      if (result.error) throw result.error;
      if (!result.data?.ok) {
        const reason = String(result.data?.reason || "credential_mismatch");
        const conflict = reason === "operation_conflict";
        return res.status(conflict ? 409 : 401).json({
          ok: false,
          code: conflict ? "removal_operation_conflict" : reason,
          error: conflict
            ? "This operation ID belongs to another credential or device."
            : "The custodial device removal request could not be authenticated.",
        });
      }
      return res.json({ ok: true, data: result.data });
    } catch (error) {
      const status = Number(error?.status) || 503;
      if (status >= 500) console.warn("custodial device removal failed:", error?.message || error);
      return res.status(status).json({
        ok: false,
        code: error?.code || "custodial_device_removal_failed",
        error: status >= 500
          ? "Custodial device removal failed."
          : clip(error?.message || "Custodial device removal failed.", 1000),
      });
    }
  });
}

export const custodialEmployeeAdminInternals = Object.freeze({
  normalizeDeviceId,
  validKioskId,
  enrollmentOperationId,
  removalOperationId,
  encryptEnrollmentResult,
  decryptEnrollmentResult,
  nativeCredentialParts,
});
