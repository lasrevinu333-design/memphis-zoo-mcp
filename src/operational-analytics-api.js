import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { makeOpsAccessMiddleware } from "./auth/shared-access-auth.js";

const CONTRACT_VERSION = "operational-analytics.v1";
const INSPECTION_TYPES = new Set(["manager_spot_check", "formal", "follow_up", "complaint_response", "training_coaching"]);
const OPERATIONAL_TIME_ZONE = "America/Chicago";
export const INSPECTION_FRESHNESS_WINDOW_HOURS = 24;
export const INSPECTION_FRESHNESS_WINDOW_MS = INSPECTION_FRESHNESS_WINDOW_HOURS * 60 * 60 * 1000;

function envText(env, key) { return String(env?.[key] || "").trim(); }
function clip(value, max = 2000) { return String(value ?? "").trim().slice(0, max); }
function validUuid(value) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || "").trim()); }
function validIsoDate(value) { return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "").trim()); }
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
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Device-Id, X-Memphis-Device-Credential, Idempotency-Key");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Vary", "Origin");
}
function fail(res, error, fallback = "Operational analytics request failed.") {
  const message = clip(error?.message || fallback, 1000);
  const status = Number(error?.status || error?.statusCode)
    || (/not found/i.test(message) ? 404 : /required|invalid|must be|between|cannot|only a finished/i.test(message) ? 422 : /access|permission/i.test(message) ? 403 : 500);
  res.status(Math.max(400, Math.min(599, status))).json({ ok: false, error: message });
}
function boundedInt(value, { min = 0, max = 100, required = false, name = "value" } = {}) {
  if (value == null || value === "") {
    if (required) throw Object.assign(new Error(`${name} is required.`), { status: 422 });
    return null;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw Object.assign(new Error(`${name} must be a whole number between ${min} and ${max}.`), { status: 422 });
  }
  return parsed;
}
function normalizeLimit(value, fallback = 100, max = 1000) {
  const parsed = Number.parseInt(String(value || fallback), 10);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(max, parsed)) : fallback;
}

function calendarDateParts(value) {
  if (!validIsoDate(value)) throw Object.assign(new Error("Date must be YYYY-MM-DD."), { status: 422 });
  const [year, month, day] = String(value).split("-").map(Number);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    throw Object.assign(new Error("Date must be a real calendar date."), { status: 422 });
  }
  return { year, month, day };
}

function addCalendarDays(value, days) {
  const { year, month, day } = calendarDateParts(value);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
}

export function chicagoDateStartIso(value) {
  const desiredParts = calendarDateParts(value);
  const desired = Date.UTC(desiredParts.year, desiredParts.month - 1, desiredParts.day);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: OPERATIONAL_TIME_ZONE,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  let guess = desired;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(guess)).filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
    const represented = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    guess += desired - represented;
  }
  return new Date(guess).toISOString();
}
function stableJson(value) {
  if (Array.isArray(value)) return value.map(stableJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, stableJson(item)]));
  }
  return value;
}
export function stableFingerprint(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stableJson(value))).digest("hex");
}

export function inspectionEligibility(session = {}, { nowMs = Date.now() } = {}) {
  const status = String(session.status || "").trim().toLowerCase();
  const completedAt = Date.parse(String(session.ended_at || session.completion_submitted_at || ""));
  const eligibleUntilMs = completedAt + INSPECTION_FRESHNESS_WINDOW_MS;
  const eligible = ["pending_submit", "closed"].includes(status)
    && Number.isFinite(completedAt)
    && Number.isFinite(nowMs)
    && nowMs >= completedAt
    && nowMs <= eligibleUntilMs;
  return {
    inspection_eligible: eligible,
    inspection_eligible_until: Number.isFinite(eligibleUntilMs) ? new Date(eligibleUntilMs).toISOString() : null,
    inspection_freshness_window_hours: INSPECTION_FRESHNESS_WINDOW_HOURS,
  };
}

export function normalizeInspectionPayload(values = {}, auth = {}, idempotencyKey = "") {
  const sessionId = String(values.session_id || values.sessionId || "").trim();
  const operationId = String(idempotencyKey || values.operation_id || values.operationId || "").trim();
  if (!validUuid(sessionId)) throw Object.assign(new Error("A valid session_id is required."), { status: 422 });
  if (!validUuid(operationId)) throw Object.assign(new Error("A stable UUID Idempotency-Key or operation_id is required."), { status: 422 });

  const findings = values.findings_json ?? values.findings ?? [];
  if (!Array.isArray(findings) && (!findings || typeof findings !== "object")) {
    throw Object.assign(new Error("findings_json must be an array or object."), { status: 422 });
  }
  const inspectionType = clip(values.inspection_type || "manager_spot_check", 80);
  if (!INSPECTION_TYPES.has(inspectionType)) {
    throw Object.assign(new Error("inspection_type is invalid."), { status: 422 });
  }
  const providedInspectedAt = values.inspected_at ?? values.inspectedAt ?? null;
  if (providedInspectedAt != null) {
    throw Object.assign(new Error("inspected_at is assigned by the server and must not be provided."), { status: 422 });
  }

  const overallScore = boundedInt(values.overall_score ?? values.overallScore, { required: true, name: "overall_score" });
  const passThreshold = boundedInt(values.pass_threshold ?? values.passThreshold ?? 85, { required: true, name: "pass_threshold" });
  const criticalFailure = values.critical_failure === true || values.criticalFailure === true;
  const normalized = {
    operation_id: operationId,
    session_id: sessionId,
    inspector_manager_id: validUuid(auth.manager_id) ? auth.manager_id : null,
    inspector_name_snapshot: clip(auth.manager_display_name || auth.display_name || values.inspector_name || "Custodial Manager", 200) || "Custodial Manager",
    inspection_type: inspectionType,
    rubric_version: clip(values.rubric_version || "custodial-v1", 80),
    overall_score: overallScore,
    appearance_score: boundedInt(values.appearance_score ?? values.appearanceScore, { name: "appearance_score" }),
    sanitation_score: boundedInt(values.sanitation_score ?? values.sanitationScore, { name: "sanitation_score" }),
    supplies_score: boundedInt(values.supplies_score ?? values.suppliesScore, { name: "supplies_score" }),
    detail_score: boundedInt(values.detail_score ?? values.detailScore, { name: "detail_score" }),
    safety_score: boundedInt(values.safety_score ?? values.safetyScore, { name: "safety_score" }),
    pass_threshold: passThreshold,
    critical_failure: criticalFailure,
    follow_up_required: values.follow_up_required === true || values.followUpRequired === true || criticalFailure || overallScore < passThreshold,
    findings_json: findings,
    notes: clip(values.notes, 8000) || null,
  };
  normalized.request_fingerprint = stableFingerprint({
    ...normalized,
    inspector_name_snapshot: undefined,
    request_fingerprint: undefined,
  });
  return normalized;
}

async function loadExistingInspection(db, operationId) {
  const result = await db.from("cleaning_inspections").select("*").eq("operation_id", operationId).maybeSingle();
  if (result.error) throw result.error;
  return result.data || null;
}

export function installOperationalAnalyticsRoutes(app, { env = process.env, supabase = null } = {}) {
  if (!app || app.__operationalAnalyticsRoutesInstalled) return;
  Object.defineProperty(app, "__operationalAnalyticsRoutesInstalled", { value: true });
  const db = supabase || createSupabase(env);
  const requireManager = makeOpsAccessMiddleware({ supabase: db });
  const configured = (_req, res, next) => db ? next() : res.status(503).json({ ok: false, error: "Database connection is not configured." });
  const requireCustodial = (req, res, next) => requireManager(req, res, () => hasRole(req.memphisAuth, "CUSTODIAL_MANAGER")
    ? next()
    : res.status(403).json({ ok: false, error: "Custodial Manager access is required." }));

  app.use("/analytics-api", (req, res, next) => {
    setCors(req, res, env);
    if (req.method === "OPTIONS") return res.sendStatus(200);
    next();
  });

  app.get("/analytics-api/health", (_req, res) => res.status(db ? 200 : 503).json({
    ok: Boolean(db),
    area: "custodial-operational-analytics",
    contract_version: CONTRACT_VERSION,
    event_retention_days: 14,
    deleted_message_retention_days: 14,
    cleaning_history: "preserved",
    maintenance_ticket_history: "preserved",
  }));

  app.get("/analytics-api/cleaning-performance", configured, requireCustodial, async (req, res) => {
    try {
      let query = db.from("v_cleaning_performance_comparison").select("*");
      if (validUuid(req.query?.employee_id)) query = query.eq("employee_id", String(req.query.employee_id));
      if (validUuid(req.query?.location_id)) query = query.eq("location_id", String(req.query.location_id));
      if (req.query?.location_code) query = query.eq("location_code", clip(req.query.location_code, 80).toUpperCase());
      const minimum = boundedInt(req.query?.minimum_cleanings ?? 1, { min: 1, max: 100000, required: true, name: "minimum_cleanings" });
      query = query.gte("cleaning_count", minimum).order("latest_cleaning_at", { ascending: false }).limit(normalizeLimit(req.query?.limit, 250, 1000));
      const result = await query;
      if (result.error) throw result.error;
      res.json({ ok: true, data: result.data || [], meta: { contract_version: CONTRACT_VERSION, generated_at: new Date().toISOString() } });
    } catch (error) { fail(res, error, "Cleaning performance could not be loaded."); }
  });

  app.get("/analytics-api/ticket-trends", configured, requireCustodial, async (req, res) => {
    try {
      const windowDays = [7, 30, 90].includes(Number(req.query?.window_days)) ? Number(req.query.window_days) : 30;
      const countColumn = `ticket_count_last_${windowDays}_days`;
      const minimum = boundedInt(req.query?.minimum_count ?? 1, { min: 1, max: 100000, required: true, name: "minimum_count" });
      let query = db.from("v_maintenance_ticket_trends").select("*").gte(countColumn, minimum);
      if (validUuid(req.query?.location_id)) query = query.eq("location_id", String(req.query.location_id));
      if (req.query?.location_code) query = query.eq("location_code", clip(req.query.location_code, 80).toUpperCase());
      if (req.query?.recurrence_status) query = query.eq("recurrence_status", clip(req.query.recurrence_status, 40).toLowerCase());
      query = query.order(countColumn, { ascending: false }).order("latest_reported_at", { ascending: false }).limit(normalizeLimit(req.query?.limit, 250, 1000));
      const result = await query;
      if (result.error) throw result.error;
      res.json({ ok: true, data: result.data || [], meta: { contract_version: CONTRACT_VERSION, window_days: windowDays, generated_at: new Date().toISOString() } });
    } catch (error) { fail(res, error, "Maintenance ticket trends could not be loaded."); }
  });

  app.get("/analytics-api/session-facts", configured, requireCustodial, async (req, res) => {
    try {
      let query = db.from("v_cleaning_session_facts").select("*");
      if (validUuid(req.query?.employee_id)) query = query.eq("employee_id", String(req.query.employee_id));
      if (validUuid(req.query?.location_id)) query = query.eq("location_id", String(req.query.location_id));
      if (req.query?.location_code) query = query.eq("location_code", clip(req.query.location_code, 80).toUpperCase());
      if (req.query?.date_from) {
        if (!validIsoDate(req.query.date_from)) throw Object.assign(new Error("date_from must be YYYY-MM-DD."), { status: 422 });
        query = query.gte("started_at", chicagoDateStartIso(req.query.date_from));
      }
      if (req.query?.date_to) {
        if (!validIsoDate(req.query.date_to)) throw Object.assign(new Error("date_to must be YYYY-MM-DD."), { status: 422 });
        query = query.lt("started_at", chicagoDateStartIso(addCalendarDays(req.query.date_to, 1)));
      }
      query = query.order("started_at", { ascending: false }).limit(normalizeLimit(req.query?.limit, 250, 1000));
      const result = await query;
      if (result.error) throw result.error;
      const generatedAt = new Date();
      const rows = (result.data || []).map((row) => ({
        ...row,
        ...inspectionEligibility(row, { nowMs: generatedAt.getTime() }),
      }));
      res.json({
        ok: true,
        data: rows,
        meta: {
          contract_version: CONTRACT_VERSION,
          generated_at: generatedAt.toISOString(),
          inspection_freshness_window_hours: INSPECTION_FRESHNESS_WINDOW_HOURS,
        },
      });
    } catch (error) { fail(res, error, "Cleaning session facts could not be loaded."); }
  });

  app.get("/analytics-api/inspections", configured, requireCustodial, async (req, res) => {
    try {
      let query = db.from("cleaning_inspections").select("*");
      if (validUuid(req.query?.session_id)) query = query.eq("session_id", String(req.query.session_id));
      if (validUuid(req.query?.employee_id)) query = query.eq("employee_id", String(req.query.employee_id));
      if (validUuid(req.query?.location_id)) query = query.eq("location_id", String(req.query.location_id));
      query = query.order("inspected_at", { ascending: false }).limit(normalizeLimit(req.query?.limit, 100, 500));
      const result = await query;
      if (result.error) throw result.error;
      res.json({ ok: true, data: result.data || [], meta: { contract_version: CONTRACT_VERSION } });
    } catch (error) { fail(res, error, "Cleaning inspections could not be loaded."); }
  });

  app.get("/analytics-api/inspection-coverage", configured, requireCustodial, async (_req, res) => {
    try {
      const result = await db.from("v_cleaning_inspection_coverage").select("*").single();
      if (result.error) throw result.error;
      res.json({ ok: true, data: result.data, meta: { contract_version: CONTRACT_VERSION, timezone: OPERATIONAL_TIME_ZONE } });
    } catch (error) { fail(res, error, "Inspection coverage could not be loaded."); }
  });

  app.post("/analytics-api/inspections", configured, requireCustodial, async (req, res) => {
    try {
      const payload = normalizeInspectionPayload(req.body || {}, req.memphisAuth || {}, req.get?.("Idempotency-Key") || "");
      const existing = await loadExistingInspection(db, payload.operation_id);
      if (existing) {
        if (existing.request_fingerprint !== payload.request_fingerprint) {
          throw Object.assign(new Error("Idempotency key was already used for a different inspection."), { status: 409 });
        }
        return res.status(200).json({ ok: true, data: existing, meta: { contract_version: CONTRACT_VERSION, replayed: true } });
      }

      const inserted = await db.from("cleaning_inspections").insert(payload).select("*").single();
      if (inserted.error) {
        if (String(inserted.error.code || "") === "23505") {
          const raced = await loadExistingInspection(db, payload.operation_id);
          if (raced?.request_fingerprint === payload.request_fingerprint) {
            return res.status(200).json({ ok: true, data: raced, meta: { contract_version: CONTRACT_VERSION, replayed: true } });
          }
        }
        throw inserted.error;
      }
      res.status(201).json({ ok: true, data: inserted.data, meta: { contract_version: CONTRACT_VERSION, replayed: false } });
    } catch (error) { fail(res, error, "Cleaning inspection could not be saved."); }
  });
}

export { CONTRACT_VERSION as OPERATIONAL_ANALYTICS_CONTRACT_VERSION };
