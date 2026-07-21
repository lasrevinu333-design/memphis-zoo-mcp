import crypto from "node:crypto";
import express from "express";
import { createClient } from "@supabase/supabase-js";
import { createOpsManagerSession, makeOpsAccessMiddleware } from "./auth/shared-access-auth.js";
import { callGemini } from "./routes/moxie.js";

const RETIRED_NAMED_ROUTES = new Set([
  "/auth-api/ops/managers",
  "/auth-api/ops/manager-codes",
  "/auth-api/ops/pairing",
  "/auth-api/ops/pairing-links",
  "/auth-api/ops/invitations",
]);

// iPhone smart punctuation previously made “Who’s working?” miss the roster
// handler even though "Who's working?" succeeded.
const originalJson = express.json;
if (typeof originalJson === "function" && !express.__memphisSmartPunctuationJsonPatched) {
  Object.defineProperty(express, "__memphisSmartPunctuationJsonPatched", { value: true });
  express.json = function memphisNormalizedJson(...args) {
    const parser = originalJson.apply(this, args);
    return function normalizedJsonMiddleware(req, res, next) {
      parser(req, res, (error) => {
        if (error) return next(error);
        if (req.body && typeof req.body === "object") {
          for (const field of ["body", "message", "userMessage", "user_message", "prompt"]) {
            if (typeof req.body[field] === "string") {
              req.body[field] = req.body[field]
                .replace(/[’‘]/g, "'")
                .replace(/[“”]/g, '"')
                .replace(/[–—]/g, "-");
            }
          }
        }
        next();
      });
    };
  };
}

// A prior release mounted a blanket 410 middleware before the still-valid
// named-manager routes. Skip only that obsolete registration.
const originalUse = express.application?.use;
if (typeof originalUse === "function" && !express.application.__memphisLeadershipUsePatched) {
  Object.defineProperty(express.application, "__memphisLeadershipUsePatched", { value: true });
  express.application.use = function leadershipAwareUse(...args) {
    const route = typeof args[0] === "string" ? args[0] : "";
    const handler = typeof args[1] === "function" ? args[1] : null;
    if (RETIRED_NAMED_ROUTES.has(route) && handler?.name === "retireLegacyManagerEnrollment") return this;
    return originalUse.apply(this, args);
  };
}

function envText(env, key) { return String(env?.[key] || "").trim(); }
function clip(value, max = 5000) { return String(value ?? "").trim().slice(0, max); }
function hmacHex(secret, value) { return crypto.createHmac("sha256", secret).update(String(value || "")).digest("hex"); }
function safeEqual(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
function sessionSecret(env = process.env) {
  return envText(env, "OPS_MANAGER_SESSION_SECRET")
    || envText(env, "GEMINI_ADMIN_SESSION_SECRET")
    || envText(env, "MOXIE_WEB_COOKIE_SECRET")
    || envText(env, "SUPABASE_SERVICE_ROLE_KEY");
}
function createSupabase(env) {
  const url = envText(env, "SUPABASE_URL");
  const key = envText(env, "SUPABASE_SERVICE_ROLE_KEY");
  return url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
}
function allowedOrigins(env = process.env) {
  return new Set([
    "https://memphis-zoo-mcp.onrender.com",
    "https://lasrevinu333-design.github.io",
    "https://localhost",
    "capacitor://localhost",
    ...envText(env, "ALLOWED_CORS_ORIGINS").split(",").map((v) => v.trim()).filter(Boolean),
  ]);
}
function setCors(req, res, env) {
  const origin = String(req.headers?.origin || "").trim();
  if (origin && allowedOrigins(env).has(origin)) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Device-Id, X-Device-Label, X-Memphis-Device-Credential, Idempotency-Key");
  res.setHeader("Vary", "Origin");
}
function normalizeCode(value) {
  const code = String(value || "").replace(/[\s-]+/g, "");
  return /^\d{8}$/.test(code) ? code : "";
}
function normalizeDeviceId(value) {
  return String(value || "").trim().replace(/[^a-zA-Z0-9_.:-]/g, "").slice(0, 96);
}
function platform(req) {
  const ua = String(req.get?.("User-Agent") || "");
  if (/iphone|ipad|ios/i.test(ua)) return "iPhone/iPad app";
  if (/android/i.test(ua)) return "Android app";
  return "Mobile app";
}
function nativeCredential(req) {
  const header = String(req.get?.("X-Memphis-Device-Credential") || "").trim();
  const authorization = String(req.get?.("Authorization") || "").trim();
  const raw = header || (/^Device\s+/i.test(authorization) ? authorization.replace(/^Device\s+/i, "").trim() : "");
  const dot = raw.indexOf(".");
  if (dot <= 0) return null;
  const credentialId = raw.slice(0, dot);
  const secret = raw.slice(dot + 1);
  return /^[0-9a-f-]{36}$/i.test(credentialId) && /^[A-Za-z0-9_-]{32,}$/.test(secret)
    ? { credentialId, secret, raw }
    : null;
}
function trustTtlMs(env) {
  const configured = Number(env?.OPS_MANAGER_TRUST_TTL_MS);
  return Number.isFinite(configured) && configured >= 86400000 ? configured : 10 * 365 * 86400000;
}
function hasRole(session, role) {
  const wanted = String(role || "").trim().toUpperCase();
  return Array.isArray(session?.roles) && session.roles.some((item) => String(item || "").trim().toUpperCase() === wanted);
}
function fail(res, error, fallback) {
  res.status(Number(error?.status) || 500).json({ ok: false, error: String(error?.message || fallback).slice(0, 1000) });
}
function moxieContext({ notes = [], reminders = [], contacts = [] } = {}) {
  return [
    "You are Moxie, Eric Operle's private Memphis Zoo work assistant. Be practical, concise, and do not invent facts.",
    `Notes:\n${notes.slice(0, 20).map((r) => `- ${clip(r.content, 500)}`).join("\n") || "none"}`,
    `Open reminders:\n${reminders.filter((r) => !r.done).slice(0, 20).map((r) => `- ${clip(r.content, 400)}${r.due ? ` (due: ${clip(r.due, 120)})` : ""}`).join("\n") || "none"}`,
    `Contacts:\n${contacts.slice(0, 30).map((r) => `- ${clip(r.name, 120)}${r.phone ? ` | ${clip(r.phone, 80)}` : ""}${r.email ? ` | ${clip(r.email, 160)}` : ""}`).join("\n") || "none"}`,
  ].join("\n\n");
}
async function workspace(db) {
  const [notes, reminders, contacts, chat] = await Promise.all([
    db.from("annie_log_notes").select("*").order("created_at", { ascending: false }).limit(200),
    db.from("annie_log_reminders").select("*").order("created_at", { ascending: false }).limit(200),
    db.from("annie_contacts").select("*").order("name", { ascending: true }).limit(500),
    db.from("annie_chat_state").select("*").eq("id", "default").maybeSingle(),
  ]);
  for (const result of [notes, reminders, contacts, chat]) if (result.error) throw result.error;
  return {
    notes: notes.data || [], reminders: reminders.data || [], contacts: contacts.data || [],
    chat: chat.data || { id: "default", history: [], saved_chats: [], revision: 1, updated_at: new Date().toISOString() },
  };
}

export function installLeadershipHttpRoutes(app, { env = process.env, supabase = null } = {}) {
  if (!app || app.__memphisLeadershipRoutesInstalled) return;
  Object.defineProperty(app, "__memphisLeadershipRoutesInstalled", { value: true });
  const db = supabase || createSupabase(env);
  const requireManager = makeOpsAccessMiddleware({ supabase: db });

  for (const prefix of ["/leadership-api", "/mobile-auth-api", "/moxie-mobile-api", "/viewer-api"]) {
    app.use(prefix, (req, res, next) => {
      setCors(req, res, env);
      if (req.method === "OPTIONS") return res.sendStatus(200);
      next();
    });
  }
  const configured = (_req, res, next) => db ? next() : res.status(503).json({ ok: false, error: "Database connection is not configured." });
  const requireCustodial = (req, res, next) => requireManager(req, res, () => hasRole(req.memphisAuth, "CUSTODIAL_MANAGER")
    ? next()
    : res.status(403).json({ ok: false, error: "Custodial Manager access is required for Moxie." }));

  async function authenticateNative(req) {
    const parts = nativeCredential(req);
    if (!parts) return { ok: false, status: 401, error: "This app installation is not enrolled." };
    const deviceResult = await db.from("ops_manager_trusted_devices")
      .select("credential_id,device_id,device_label,token_hash,max_access_level,manager_id,expires_at,revoked_at")
      .eq("credential_id", parts.credentialId).maybeSingle();
    if (deviceResult.error) throw deviceResult.error;
    const device = deviceResult.data;
    if (!device || device.revoked_at || Date.parse(String(device.expires_at || "")) <= Date.now()) return { ok: false, status: 401, error: "This app installation is no longer enrolled." };
    const secret = sessionSecret(env);
    if (!secret || !safeEqual(device.token_hash, hmacHex(secret, `trusted-device:${parts.secret}`))) return { ok: false, status: 401, error: "This app installation is not enrolled." };
    const managerResult = await db.from("ops_manager_managers")
      .select("manager_id,display_name,contact_label,job_title,department_key,roles,active,revoked_at,is_system_principal,last_access_at")
      .eq("manager_id", device.manager_id).maybeSingle();
    if (managerResult.error) throw managerResult.error;
    const manager = managerResult.data;
    if (!manager || manager.active !== true || manager.revoked_at || manager.is_system_principal) return { ok: false, status: 403, error: "This leadership identity is inactive." };
    await db.from("ops_manager_trusted_devices").update({ last_used_at: new Date().toISOString() }).eq("credential_id", device.credential_id);
    const session = createOpsManagerSession({ credentialId: device.credential_id, deviceId: device.device_id, manager, authMode: "trusted_device", accessLevel: "full_access", maximumAccessLevel: device.max_access_level || "full_access", env });
    return { ok: true, manager, device, session };
  }

  app.post("/mobile-auth-api/enroll", configured, async (req, res) => {
    try {
      const origin = String(req.headers?.origin || "").trim();
      if (origin && !allowedOrigins(env).has(origin)) return res.status(403).json({ ok: false, error: "Enrollment is not allowed from this app origin." });
      const code = normalizeCode(req.body?.code || req.body?.manager_code);
      const deviceId = normalizeDeviceId(req.body?.device_id || req.get?.("X-Device-Id"));
      const deviceLabel = clip(req.body?.device_label || req.get?.("X-Device-Label") || platform(req), 160);
      const secret = sessionSecret(env);
      if (!code || !deviceId) return res.status(400).json({ ok: false, error: "A valid eight-digit code and app installation ID are required." });
      if (!secret) return res.status(503).json({ ok: false, error: "Manager session signing is not configured." });
      const credentialId = crypto.randomUUID();
      const refreshSecret = crypto.randomBytes(32).toString("base64url");
      const expiresAt = new Date(Date.now() + trustTtlMs(env)).toISOString();
      const result = await db.rpc("ops_manager_consume_enrollment_code", {
        p_code_hash: hmacHex(secret, `ops-manager-enrollment-code:v1:${code}`),
        p_credential_id: credentialId,
        p_device_id: deviceId,
        p_device_label: deviceLabel,
        p_trust_token_hash: hmacHex(secret, `trusted-device:${refreshSecret}`),
        p_user_agent_hash: hmacHex(secret, `mobile-ua:${String(req.get?.("User-Agent") || "")}`),
        p_created_ip_hash: null,
        p_platform_summary: platform(req),
        p_expires_at: expiresAt,
        p_metadata_json: { enrolled_by: "native_manager_app", platform_summary: platform(req) },
      });
      if (result.error) throw result.error;
      const data = Array.isArray(result.data) ? result.data[0] : result.data;
      if (!data?.ok) return res.status(Number(data?.status) || 401).json({ ok: false, error: "That manager code is invalid, expired, or already used." });
      const session = createOpsManagerSession({ credentialId, deviceId, manager: data.manager || {}, authMode: "trusted_device", accessLevel: "full_access", maximumAccessLevel: "full_access", env });
      res.json({ ok: true, data: { device_credential: `${credentialId}.${refreshSecret}`, credential_expires_at: expiresAt, session, manager: data.manager || {} } });
    } catch (error) { fail(res, error, "App enrollment failed."); }
  });

  app.post("/mobile-auth-api/session", configured, async (req, res) => {
    try {
      const auth = await authenticateNative(req);
      if (!auth.ok) return res.status(auth.status).json({ ok: false, error: auth.error });
      res.json({ ok: true, data: { session: auth.session, manager: auth.manager, trusted_device: { credential_id: auth.device.credential_id, device_id: auth.device.device_id, device_label: auth.device.device_label, expires_at: auth.device.expires_at } } });
    } catch (error) { fail(res, error, "App session could not be refreshed."); }
  });

  app.post("/mobile-auth-api/logout", configured, async (req, res) => {
    try {
      const parts = nativeCredential(req);
      if (parts) await db.from("ops_manager_trusted_devices").update({ revoked_at: new Date().toISOString(), revoked_reason: "native_app_logout" }).eq("credential_id", parts.credentialId).is("revoked_at", null);
      res.json({ ok: true, data: { logged_out: true } });
    } catch (error) { fail(res, error, "App logout failed."); }
  });

  app.get("/leadership-api/health", (_req, res) => res.status(db ? 200 : 503).json({ ok: Boolean(db), area: "operations-leadership", named_manager_enrollment: true, shared_manager_enrollment: false, mobile_origins: ["https://localhost", "capacitor://localhost"] }));
  app.get("/leadership-api/roster", configured, requireManager, async (req, res) => {
    try {
      const result = await db.from("ops_manager_managers")
        .select("manager_id,display_name,job_title,department_key,leadership_sort_order,roles,active,revoked_at,system_key,last_access_at")
        .eq("active", true).is("revoked_at", null).eq("is_system_principal", false)
        .order("leadership_sort_order", { ascending: true }).order("display_name", { ascending: true });
      if (result.error) throw result.error;
      res.json({ ok: true, data: { current_manager_id: req.memphisAuth?.manager_id || null, managers: result.data || [] } });
    } catch (error) { fail(res, error, "Leadership roster could not be loaded."); }
  });

  app.get("/viewer-api/dashboard", configured, async (_req, res) => {
    try {
      const result = await db.rpc("public_viewer_dashboard_snapshot");
      if (result.error) throw result.error;
      res.setHeader("Cache-Control", "public, max-age=30, stale-while-revalidate=120");
      res.json({ ok: true, data: Array.isArray(result.data) ? result.data[0] : (result.data || {}) });
    } catch (error) { fail(res, error, "Public dashboard is temporarily unavailable."); }
  });
  app.get("/viewer-api/events", configured, async (req, res) => {
    try {
      const days = Math.max(1, Math.min(180, Number(req.query?.days) || 60));
      const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
      const until = new Date(Date.now() + days * 86400000).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
      const result = await db.from("events_app_events")
        .select("id,event_name,event_date,end_date,start_time,end_time,display_location,event_scope,status")
        .eq("status", "SCHEDULED").gte("end_date", today).lte("event_date", until)
        .order("event_date", { ascending: true }).order("start_time", { ascending: true }).limit(250);
      if (result.error) throw result.error;
      res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
      res.json({ ok: true, data: { events: result.data || [], generated_at: new Date().toISOString() } });
    } catch (error) { fail(res, error, "Events are temporarily unavailable."); }
  });

  app.get("/moxie-mobile-api/workspace", configured, requireCustodial, async (_req, res) => {
    try { res.json({ ok: true, data: await workspace(db) }); }
    catch (error) { fail(res, error, "Moxie workspace could not be loaded."); }
  });
  app.post("/moxie-mobile-api/chat", configured, requireCustodial, async (req, res) => {
    try {
      const messages = (Array.isArray(req.body?.messages) ? req.body.messages : []).slice(-20)
        .filter((m) => m && ["user", "assistant"].includes(m.role) && typeof m.content === "string")
        .map((m) => ({ role: m.role, content: clip(m.content, 20000) }));
      if (!messages.length) return res.status(400).json({ ok: false, error: "At least one message is required." });
      const result = await callGemini([{ role: "system", content: moxieContext(await workspace(db)) }, ...messages]);
      if (!result.ok) return res.status(502).json({ ok: false, error: result.error || "Moxie could not answer." });
      res.json({ ok: true, data: { content: result.content } });
    } catch (error) { fail(res, error, "Moxie chat failed."); }
  });
  app.put("/moxie-mobile-api/chat-state", configured, requireCustodial, async (req, res) => {
    try {
      const expected = Number(req.body?.expected_revision ?? req.body?.expectedRevision);
      if (!Number.isInteger(expected) || expected < 1) return res.status(422).json({ ok: false, error: "expected_revision is required." });
      const result = await db.rpc("moxie_save_chat_state", { p_expected_revision: expected, p_history: Array.isArray(req.body?.history) ? req.body.history.slice(-40) : [], p_saved_chats: Array.isArray(req.body?.saved_chats ?? req.body?.savedChats) ? (req.body.saved_chats ?? req.body.savedChats).slice(0, 30) : [] });
      if (result.error) throw result.error;
      res.json({ ok: true, data: Array.isArray(result.data) ? result.data[0] : result.data });
    } catch (error) {
      const conflict = error?.code === "40001" || /changed in another/i.test(String(error?.message || ""));
      res.status(conflict ? 409 : 500).json({ ok: false, error: conflict ? "Moxie changed on another device." : String(error?.message || "Moxie state could not be saved.") });
    }
  });

  const simpleResource = (path, table, max, requiredField) => {
    app.post(path, configured, requireCustodial, async (req, res) => {
      try {
        const row = { id: crypto.randomBytes(6).toString("hex") };
        for (const [field, limit] of Object.entries(max)) if (req.body?.[field] !== undefined) row[field] = clip(req.body[field], limit);
        if (requiredField && !row[requiredField]) return res.status(400).json({ ok: false, error: `${requiredField} is required.` });
        if (table === "annie_contacts") row.source = "manual";
        const result = await db.from(table).insert(row);
        if (result.error) throw result.error;
        res.status(201).json({ ok: true, data: row });
      } catch (error) { fail(res, error, "Moxie item could not be saved."); }
    });
    app.delete(`${path}/:id`, configured, requireCustodial, async (req, res) => {
      try {
        const result = await db.from(table).delete().eq("id", clip(req.params?.id, 80));
        if (result.error) throw result.error;
        res.json({ ok: true });
      } catch (error) { fail(res, error, "Moxie item could not be deleted."); }
    });
  };
  simpleResource("/moxie-mobile-api/notes", "annie_log_notes", { content: 5000 }, "content");
  simpleResource("/moxie-mobile-api/reminders", "annie_log_reminders", { content: 1000, due: 200, fingerprint: 200 }, "content");
  simpleResource("/moxie-mobile-api/contacts", "annie_contacts", { name: 160, phone: 80, email: 200, notes: 2000 }, "name");
}
