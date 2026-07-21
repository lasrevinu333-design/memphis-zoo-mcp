import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { makeOpsAccessMiddleware } from "./auth/shared-access-auth.js";
import { callGemini } from "./routes/moxie.js";

function envText(env, key) { return String(env?.[key] || "").trim(); }
function clip(value, max = 5000) { return String(value ?? "").trim().slice(0, max); }
function hasRole(session, role) {
  const wanted = String(role || "").trim().toUpperCase();
  return Array.isArray(session?.roles) && session.roles.some((item) => String(item || "").trim().toUpperCase() === wanted);
}
function createSupabase(env) {
  const url = envText(env, "SUPABASE_URL");
  const key = envText(env, "SUPABASE_SERVICE_ROLE_KEY");
  return url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
}
function allowedOrigins(env) {
  return new Set([
    "https://memphis-zoo-mcp.onrender.com",
    "https://lasrevinu333-design.github.io",
    "https://localhost",
    "capacitor://localhost",
    ...envText(env, "ALLOWED_CORS_ORIGINS").split(",").map((value) => value.trim()).filter(Boolean),
  ]);
}
function setCors(req, res, env) {
  const origin = String(req.headers?.origin || "").trim();
  if (origin && allowedOrigins(env).has(origin)) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Device-Id, X-Memphis-Device-Credential");
  res.setHeader("Vary", "Origin");
}
function fail(res, error, fallback) {
  res.status(Number(error?.status) || 500).json({ ok: false, error: String(error?.message || fallback).slice(0, 1000) });
}
function moxieContext({ notes = [], reminders = [], contacts = [] } = {}) {
  return [
    "You are Moxie, the private Memphis Zoo operations administrative assistant designed for Annie Feist. Eric Operle is also authorized to use this shared work workspace. Be practical, concise, and never invent internal facts.",
    `Notes:\n${notes.slice(0, 20).map((row) => `- ${clip(row.content, 500)}`).join("\n") || "none"}`,
    `Open reminders:\n${reminders.filter((row) => !row.done).slice(0, 20).map((row) => `- ${clip(row.content, 400)}${row.due ? ` (due: ${clip(row.due, 120)})` : ""}`).join("\n") || "none"}`,
    `Contacts:\n${contacts.slice(0, 30).map((row) => `- ${clip(row.name, 120)}${row.phone ? ` | ${clip(row.phone, 80)}` : ""}${row.email ? ` | ${clip(row.email, 160)}` : ""}`).join("\n") || "none"}`,
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

export function installAnnieMoxieRoutes(app, { env = process.env, supabase = null } = {}) {
  if (!app || app.__annieMoxieRoutesInstalled) return;
  Object.defineProperty(app, "__annieMoxieRoutesInstalled", { value: true });
  const db = supabase || createSupabase(env);
  const requireManager = makeOpsAccessMiddleware({ supabase: db });
  const configured = (_req, res, next) => db ? next() : res.status(503).json({ ok: false, error: "Database connection is not configured." });

  app.use("/moxie-mobile-api", (req, res, next) => {
    setCors(req, res, env);
    if (req.method === "OPTIONS") return res.sendStatus(200);
    next();
  });

  const requireMoxie = (req, res, next) => requireManager(req, res, async () => {
    try {
      if (hasRole(req.memphisAuth, "CUSTODIAL_MANAGER")) return next();
      const result = await db.from("ops_manager_managers")
        .select("manager_id,system_key,active,revoked_at,is_system_principal")
        .eq("manager_id", req.memphisAuth?.manager_id || "").maybeSingle();
      if (result.error) throw result.error;
      const manager = result.data;
      if (manager?.active === true && !manager.revoked_at && !manager.is_system_principal && manager.system_key === "annie_feist_operations_admin") return next();
      return res.status(403).json({ ok: false, error: "Moxie access is limited to Annie Feist and Eric Operle." });
    } catch (error) { fail(res, error, "Moxie authorization failed."); }
  });

  app.get("/moxie-mobile-api/workspace", configured, requireMoxie, async (_req, res) => {
    try { res.json({ ok: true, data: await workspace(db) }); }
    catch (error) { fail(res, error, "Moxie workspace could not be loaded."); }
  });

  app.post("/moxie-mobile-api/chat", configured, requireMoxie, async (req, res) => {
    try {
      const messages = (Array.isArray(req.body?.messages) ? req.body.messages : []).slice(-20)
        .filter((message) => message && ["user", "assistant"].includes(message.role) && typeof message.content === "string")
        .map((message) => ({ role: message.role, content: clip(message.content, 20000) }));
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

  const registerResource = (path, table, fields, requiredField) => {
    app.post(path, configured, requireMoxie, async (req, res) => {
      try {
        const row = { id: crypto.randomBytes(6).toString("hex") };
        for (const [field, limit] of Object.entries(fields)) if (req.body?.[field] !== undefined) row[field] = clip(req.body[field], limit);
        if (!row[requiredField]) return res.status(400).json({ ok: false, error: `${requiredField} is required.` });
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

  registerResource("/moxie-mobile-api/notes", "annie_log_notes", { content: 5000 }, "content");
  registerResource("/moxie-mobile-api/reminders", "annie_log_reminders", { content: 1000, due: 200, fingerprint: 200 }, "content");
  registerResource("/moxie-mobile-api/contacts", "annie_contacts", { name: 160, phone: 80, email: 200, notes: 2000 }, "name");
}
