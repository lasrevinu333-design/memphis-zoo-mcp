import crypto from "node:crypto";
import express from "express";
import { createClient } from "@supabase/supabase-js";
import { makeOpsAccessMiddleware } from "./auth/shared-access-auth.js";
import { callGemini } from "./routes/moxie.js";

// iPhone smart punctuation previously made “Who’s working?” miss the roster
// handler even though "Who's working?" succeeded. Normalize only common
// user-entered prompt fields at JSON parsing time.
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

function envText(env, key) { return String(env?.[key] || "").trim(); }
function clip(value, max = 5000) { return String(value ?? "").trim().slice(0, max); }
function hmacHex(secret, value) { return crypto.createHmac("sha256", secret).update(String(value || "")).digest("hex"); }
function sessionSecret(env = process.env) {
  return envText(env, "OPS_MANAGER_SESSION_SECRET");
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
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Device-Id, X-Device-Label, Idempotency-Key");
  res.setHeader("Vary", "Origin");
}
function hasRole(session, role) {
  const wanted = String(role || "").trim().toUpperCase();
  return Array.isArray(session?.roles) && session.roles.some((item) => String(item || "").trim().toUpperCase() === wanted);
}
function enrollmentRole(manager = {}) {
  const roles = Array.isArray(manager.roles) ? manager.roles.map((role) => String(role).toUpperCase()) : [];
  if (roles.includes("DIRECTOR")) return "DIRECTOR";
  if (roles.includes("SECURITY_ADMIN")) return "SECURITY_ADMIN";
  return "OPS_MANAGER";
}
function generateManagerCode() { return String(crypto.randomInt(0, 100_000_000)).padStart(8, "0"); }
function formatManagerCode(code) { return `${code.slice(0, 4)} ${code.slice(4)}`; }
function fail(res, error, fallback) {
  res.status(Number(error?.status) || 500).json({ ok: false, error: String(error?.message || fallback).slice(0, 1000) });
}
function moxieContext({ notes = [], reminders = [], contacts = [] } = {}) {
  return [
    "You are Moxie, the private Memphis Zoo operations work assistant for Eric Operle and Annie Feist. Be practical, concise, and do not invent facts.",
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
    notes: notes.data || [],
    reminders: reminders.data || [],
    contacts: contacts.data || [],
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
    : res.status(403).json({ ok: false, error: "Custodial Manager access is required." }));
  const requireMoxie = (req, res, next) => requireManager(req, res, async () => {
    try {
      if (hasRole(req.memphisAuth, "CUSTODIAL_MANAGER")) return next();
      const result = await db.from("ops_manager_managers")
        .select("manager_id,system_key,metadata_json,active,revoked_at,is_system_principal")
        .eq("manager_id", req.memphisAuth?.manager_id || "").maybeSingle();
      if (result.error) throw result.error;
      const manager = result.data;
      if (manager?.active === true && !manager.revoked_at && !manager.is_system_principal
          && (manager.system_key === "annie_feist_operations_admin" || manager.metadata_json?.moxie_access === true)) return next();
      res.status(403).json({ ok: false, error: "Moxie access is limited to Annie Feist and the Custodial Manager." });
    } catch (error) { fail(res, error, "Moxie authorization failed."); }
  });

  const retiredJavaScriptCredentialRoute = (_req, res) => res.status(410).json({
    ok: false,
    error: "This manager credential route is retired. Update the Memphis Zoo Ops app.",
  });
  app.use("/mobile-auth-api", retiredJavaScriptCredentialRoute);

  app.get("/leadership-api/health", (_req, res) => res.status(db ? 200 : 503).json({
    ok: Boolean(db),
    area: "operations-leadership",
    named_manager_enrollment: true,
    shared_manager_enrollment: false,
    mobile_origins: ["https://localhost", "capacitor://localhost"],
  }));

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

  app.post("/leadership-api/managers/:managerId/enrollment-code", configured, requireCustodial, async (req, res) => {
    try {
      const managerId = String(req.params?.managerId || "").trim();
      if (!/^[0-9a-f-]{36}$/i.test(managerId)) return res.status(400).json({ ok: false, error: "A valid leadership manager ID is required." });
      const targetResult = await db.from("ops_manager_managers")
        .select("manager_id,display_name,job_title,contact_label,roles,active,revoked_at,is_system_principal")
        .eq("manager_id", managerId).maybeSingle();
      if (targetResult.error) throw targetResult.error;
      const manager = targetResult.data;
      if (!manager || manager.active !== true || manager.revoked_at || manager.is_system_principal) return res.status(404).json({ ok: false, error: "Active leadership identity not found." });
      const secret = sessionSecret(env);
      if (!secret) return res.status(503).json({ ok: false, error: "Manager session signing is not configured." });
      const ttlSeconds = Math.max(60, Math.min(3600, Number(req.body?.ttl_seconds) || 900));
      const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
      const roleSnapshot = enrollmentRole(manager);
      await db.from("ops_manager_enrollment_codes")
        .update({ status: "revoked", revoked_at: new Date().toISOString(), revoked_reason: "replaced_by_new_personal_code" })
        .eq("manager_id", managerId).eq("status", "active").is("consumed_at", null).is("revoked_at", null);
      let inserted = null;
      let code = "";
      for (let attempt = 0; attempt < 12 && !inserted; attempt += 1) {
        code = generateManagerCode();
        const result = await db.from("ops_manager_enrollment_codes").insert({
          manager_id: managerId,
          code_hash: hmacHex(secret, `ops-manager-enrollment-code:v1:${code}`),
          role_snapshot: roleSnapshot,
          created_by_manager_id: req.memphisAuth.manager_id,
          created_by_credential_id: req.memphisAuth.credential_id || null,
          expires_at: expiresAt,
          max_attempts: 5,
          metadata_json: { created_from: "operations_leadership_mobile_app", intended_for: manager.display_name },
        }).select("id,manager_id,role_snapshot,created_at,expires_at,max_attempts").single();
        if (!result.error) inserted = result.data;
        else if (String(result.error.code || "") !== "23505") throw result.error;
      }
      if (!inserted) throw Object.assign(new Error("A unique personal enrollment code could not be generated."), { status: 500 });
      res.json({ ok: true, data: {
        code_id: inserted.id,
        one_time_code: code,
        display_code: formatManagerCode(code),
        expires_at: inserted.expires_at,
        ttl_seconds: ttlSeconds,
        max_attempts: inserted.max_attempts,
        role_snapshot: inserted.role_snapshot,
        manager,
      } });
    } catch (error) { fail(res, error, "Personal manager code could not be generated."); }
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

  app.get("/moxie-mobile-api/workspace", configured, requireMoxie, async (_req, res) => {
    try { res.json({ ok: true, data: await workspace(db) }); }
    catch (error) { fail(res, error, "Moxie workspace could not be loaded."); }
  });

  app.post("/moxie-mobile-api/chat", configured, requireMoxie, async (req, res) => {
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

  app.put("/moxie-mobile-api/chat-state", configured, requireMoxie, async (req, res) => {
    try {
      const expected = Number(req.body?.expected_revision ?? req.body?.expectedRevision);
      if (!Number.isInteger(expected) || expected < 1) return res.status(422).json({ ok: false, error: "expected_revision is required." });
      const result = await db.rpc("moxie_save_chat_state", {
        p_expected_revision: expected,
        p_history: Array.isArray(req.body?.history) ? req.body.history.slice(-40) : [],
        p_saved_chats: Array.isArray(req.body?.saved_chats ?? req.body?.savedChats) ? (req.body.saved_chats ?? req.body.savedChats).slice(0, 30) : [],
      });
      if (result.error) throw result.error;
      res.json({ ok: true, data: Array.isArray(result.data) ? result.data[0] : result.data });
    } catch (error) {
      const conflict = error?.code === "40001" || /changed in another/i.test(String(error?.message || ""));
      res.status(conflict ? 409 : 500).json({ ok: false, error: conflict ? "Moxie changed on another device." : String(error?.message || "Moxie state could not be saved.") });
    }
  });

  const simpleResource = (path, table, max, requiredField) => {
    app.post(path, configured, requireMoxie, async (req, res) => {
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
    app.delete(`${path}/:id`, configured, requireMoxie, async (req, res) => {
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
