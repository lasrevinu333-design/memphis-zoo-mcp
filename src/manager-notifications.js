import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { makeOpsAccessMiddleware } from "./auth/shared-access-auth.js";

const DEFAULT_TIME_ZONE = "America/Chicago";
const DEFAULT_SWEEP_MS = 15_000;
const PUSH_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const FIREBASE_READ_SCOPE = "https://www.googleapis.com/auth/firebase.readonly";
const TOKEN_AUDIENCE = "https://oauth2.googleapis.com/token";
const FIREBASE_MANAGEMENT_BASE = "https://firebase.googleapis.com/v1beta1";
const DEFAULT_ANDROID_PACKAGE = "org.memphiszoo.ops";
const DEFAULT_IOS_BUNDLE = "org.memphiszoo.ops";
const runtimeByApp = new WeakMap();

function envText(env, key) { return String(env?.[key] || "").trim(); }
function clip(value, max = 1000) { return String(value ?? "").trim().slice(0, max); }
function bool(value, fallback = false) { return typeof value === "boolean" ? value : fallback; }
function int(value, fallback, minimum, maximum) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, Math.trunc(number))) : fallback;
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
function fail(res, error, fallback = "Manager notification request failed.") {
  res.status(Number(error?.status) || 500).json({ ok: false, error: clip(error?.message || fallback, 1000) });
}
function base64Url(input) {
  return Buffer.from(typeof input === "string" ? input : JSON.stringify(input), "utf8").toString("base64url");
}
function parseServiceAccount(env = process.env) {
  const raw = envText(env, "FIREBASE_SERVICE_ACCOUNT_JSON") || envText(env, "GOOGLE_SERVICE_ACCOUNT_JSON");
  if (!raw) return null;
  const candidates = [raw];
  try { candidates.push(Buffer.from(raw, "base64").toString("utf8")); } catch {}
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed?.client_email && parsed?.private_key && (parsed?.project_id || envText(env, "FIREBASE_PROJECT_ID"))) {
        return { ...parsed, project_id: parsed.project_id || envText(env, "FIREBASE_PROJECT_ID") };
      }
    } catch {}
  }
  return null;
}
function createGoogleAssertion(account, scope = PUSH_SCOPE, now = Date.now()) {
  const issued = Math.floor(now / 1000);
  const header = base64Url({ alg: "RS256", typ: "JWT" });
  const claims = base64Url({
    iss: account.client_email,
    scope,
    aud: TOKEN_AUDIENCE,
    iat: issued,
    exp: issued + 3600,
  });
  const unsigned = `${header}.${claims}`;
  const signature = crypto.sign("RSA-SHA256", Buffer.from(unsigned), account.private_key).toString("base64url");
  return `${unsigned}.${signature}`;
}
function stringifyData(data = {}) {
  const output = {};
  for (const [key, value] of Object.entries(data && typeof data === "object" ? data : {})) {
    if (value === undefined || value === null) continue;
    output[key] = typeof value === "string" ? value : JSON.stringify(value);
  }
  return output;
}
function eventReminderIsCurrent(job, now = Date.now()) {
  if (String(job?.notification_type || "") !== "event_digest") return true;
  const startsAt = Date.parse(String(job?.data_json?.next_event_starts_at || ""));
  return Number.isFinite(startsAt) && startsAt > now;
}
function preferenceView(row = {}) {
  return {
    messages_enabled: row.messages_enabled !== false,
    event_reminders_enabled: row.event_reminders_enabled === true,
    event_reminder_weekdays: Array.isArray(row.event_reminder_weekdays) && row.event_reminder_weekdays.length
      ? row.event_reminder_weekdays.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
      : [0, 1, 2, 3, 4, 5, 6],
    event_reminder_time: String(row.event_reminder_time || "08:00").slice(0, 5),
    event_lookahead_days: int(row.event_lookahead_days, 7, 1, 30),
    due_soon_enabled: row.due_soon_enabled === true,
    overdue_enabled: row.overdue_enabled === true,
    location_repeat_minutes: int(row.location_repeat_minutes, 240, 15, 1440),
    timezone: String(row.timezone || DEFAULT_TIME_ZONE),
  };
}
function normalizePreferencePatch(body = {}, current = {}) {
  const weekdays = Array.isArray(body.event_reminder_weekdays)
    ? [...new Set(body.event_reminder_weekdays.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))].sort((a, b) => a - b)
    : preferenceView(current).event_reminder_weekdays;
  if (!weekdays.length) throw Object.assign(new Error("Choose at least one event-reminder day."), { status: 422 });
  const time = String(body.event_reminder_time ?? current.event_reminder_time ?? "08:00").trim();
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw Object.assign(new Error("Event reminder time must be HH:MM."), { status: 422 });
  return {
    messages_enabled: bool(body.messages_enabled, current.messages_enabled !== false),
    event_reminders_enabled: bool(body.event_reminders_enabled, current.event_reminders_enabled === true),
    event_reminder_weekdays: weekdays,
    event_reminder_time: `${time}:00`,
    event_lookahead_days: int(body.event_lookahead_days, int(current.event_lookahead_days, 7, 1, 30), 1, 30),
    due_soon_enabled: bool(body.due_soon_enabled, current.due_soon_enabled === true),
    overdue_enabled: bool(body.overdue_enabled, current.overdue_enabled === true),
    location_repeat_minutes: int(body.location_repeat_minutes, int(current.location_repeat_minutes, 240, 15, 1440), 15, 1440),
    timezone: DEFAULT_TIME_ZONE,
  };
}
function currentIdentity(req) {
  const managerId = String(req.memphisAuth?.manager_id || "").trim();
  const credentialId = String(req.memphisAuth?.credential_id || "").trim();
  const deviceId = String(req.memphisAuth?.device_id || req.get?.("X-Device-Id") || "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(managerId) || !/^[0-9a-f-]{36}$/i.test(credentialId)) {
    throw Object.assign(new Error("A named trusted manager app installation is required."), { status: 403 });
  }
  return { managerId, credentialId, deviceId };
}

export function createPushRuntime({ db, env }) {
  const account = parseServiceAccount(env);
  const workerId = `manager-push-${process.pid}-${crypto.randomUUID()}`;
  const oauthByScope = new Map();
  const clientConfigCache = new Map();
  let inFlight = false;

  async function accessToken(scope = PUSH_SCOPE) {
    if (!account) throw Object.assign(new Error("Firebase services are not configured."), { status: 503 });
    const cached = oauthByScope.get(scope);
    if (cached?.token && cached.expiresAt > Date.now() + 60_000) return cached.token;
    const response = await fetch(TOKEN_AUDIENCE, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: createGoogleAssertion(account, scope) }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.access_token) throw new Error(payload?.error_description || `Google OAuth returned HTTP ${response.status}.`);
    const value = { token: payload.access_token, expiresAt: Date.now() + int(payload.expires_in, 3600, 60, 7200) * 1000 };
    oauthByScope.set(scope, value);
    return value.token;
  }

  async function firebaseManagementRequest(pathname) {
    const token = await accessToken(FIREBASE_READ_SCOPE);
    const target = `${FIREBASE_MANAGEMENT_BASE}${pathname.startsWith("/") ? pathname : "/" + pathname}`;
    const response = await fetch(target, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(payload?.error?.message || `Firebase Management API returned HTTP ${response.status}.`);
      error.status = response.status === 404 ? 404 : 502;
      throw error;
    }
    return payload || {};
  }

  async function getClientConfig(platform, appIdentifier = null) {
    if (!account) throw Object.assign(new Error("Firebase client configuration is unavailable."), { status: 503 });
    const normalized = String(platform || "").trim().toLowerCase();
    if (!['android','ios'].includes(normalized)) throw Object.assign(new Error("Firebase client platform must be android or ios."), { status: 400 });
    const android = normalized === 'android';
    const requested = String(appIdentifier || '').trim();
    const allowedIdentifiers = new Set([android ? DEFAULT_ANDROID_PACKAGE : DEFAULT_IOS_BUNDLE, 'org.memphiszoo.custodial']);
    if (requested && !allowedIdentifiers.has(requested)) throw Object.assign(new Error(`Firebase app identifier is not allowed: ${requested}.`), { status: 400 });
    const cacheKey = `${normalized}:${requested || 'default'}`;
    const cached = clientConfigCache.get(cacheKey);
    if (cached?.expiresAt > Date.now()) return cached.value;
    const collection = android ? 'androidApps' : 'iosApps';
    const matchField = android ? 'packageName' : 'bundleId';
    const expected = requested || envText(env, android ? 'FIREBASE_ANDROID_PACKAGE' : 'FIREBASE_IOS_BUNDLE') || (android ? DEFAULT_ANDROID_PACKAGE : DEFAULT_IOS_BUNDLE);
    const list = await firebaseManagementRequest(`/projects/${encodeURIComponent(account.project_id)}/${collection}?pageSize=100`);
    const apps = Array.isArray(list.apps) ? list.apps : [];
    const firebaseApp = apps.find((item) => item?.state !== 'DELETED' && String(item?.[matchField] || '').trim() === expected);
    if (!firebaseApp?.name || !firebaseApp?.appId) throw Object.assign(new Error(`No Firebase ${normalized} app is registered for ${expected}.`), { status: 404 });
    const artifact = await firebaseManagementRequest(`/${firebaseApp.name}/config`);
    const contentsBase64 = String(artifact?.configFileContents || '').trim();
    if (!contentsBase64) throw Object.assign(new Error(`Firebase returned an empty ${normalized} client configuration.`), { status: 502 });
    const value = {
      platform: normalized,
      project_id: account.project_id,
      app_id: firebaseApp.appId,
      app_resource: firebaseApp.name,
      package_or_bundle: expected,
      filename: String(artifact.configFilename || (android ? 'google-services.json' : 'GoogleService-Info.plist')),
      contents_base64: contentsBase64,
    };
    clientConfigCache.set(cacheKey, { value, expiresAt: Date.now() + 60 * 60 * 1000 });
    return value;
  }

  async function send(job, pushDevice, { channelId = "operations" } = {}) {
    if (!eventReminderIsCurrent(job)) {
      const error = new Error("The event occurrence is no longer upcoming.");
      error.expired = true;
      throw error;
    }
    const token = await accessToken(PUSH_SCOPE);
    const collapseKey = `memphis-${clip(channelId, 48).toLowerCase().replace(/[^a-z0-9_-]+/g, "-") || "operations"}`;
    const response = await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(account.project_id)}/messages:send`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: {
          token: pushDevice.fcm_token,
          notification: { title: clip(job.title, 180), body: clip(job.body, 1000) },
          data: stringifyData(job.data_json),
          android: {
            priority: "high",
            collapse_key: collapseKey,
            notification: { channel_id: channelId, sound: "default", default_vibrate_timings: true },
          },
          apns: {
            headers: { "apns-priority": "10" },
            payload: { aps: { sound: "default", badge: 1 } },
          },
        },
      }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.name) {
      const message = payload?.error?.message || `FCM returned HTTP ${response.status}.`;
      const code = String(payload?.error?.details?.[0]?.errorCode || payload?.error?.status || "");
      const error = new Error(message);
      error.permanent = response.status === 404 || /UNREGISTERED|INVALID_ARGUMENT/i.test(`${code} ${message}`);
      throw error;
    }
    return payload.name;
  }

  async function sweep({ limit = 25 } = {}) {
    if (!db) return { ok: false, skipped: "database_not_configured" };
    if (!account) return { ok: false, skipped: "firebase_not_configured" };
    if (inFlight) return { ok: true, skipped: "in_flight" };
    inFlight = true;
    try {
      const scheduled = await db.rpc("ops_manager_enqueue_scheduled_notifications", { p_now: new Date().toISOString() });
      if (scheduled.error) throw scheduled.error;
      const claimed = await db.rpc("ops_manager_claim_notification_jobs", {
        p_worker_id: workerId,
        p_limit: int(limit, 25, 1, 100),
        p_lease_seconds: 120,
      });
      if (claimed.error) throw claimed.error;
      const jobs = Array.isArray(claimed.data) ? claimed.data : (claimed.data ? [claimed.data] : []);
      const results = [];
      for (const job of jobs) {
        let succeeded = false;
        let providerMessageId = null;
        let errorMessage = null;
        try {
          if (!eventReminderIsCurrent(job)) throw Object.assign(new Error("The event occurrence is no longer upcoming."), { expired: true });
          const deviceResult = await db.from("ops_manager_push_devices")
            .select("push_device_id,credential_id,manager_id,fcm_token,platform,enabled,revoked_at")
            .eq("credential_id", job.credential_id).eq("enabled", true).is("revoked_at", null).maybeSingle();
          if (deviceResult.error) throw deviceResult.error;
          if (!deviceResult.data?.fcm_token) throw Object.assign(new Error("No active push registration exists for this manager app installation."), { permanent: true });
          providerMessageId = await send(job, deviceResult.data);
          succeeded = true;
          await db.from("ops_manager_push_devices").update({ last_seen_at: new Date().toISOString(), last_error: null })
            .eq("credential_id", job.credential_id);
        } catch (error) {
          errorMessage = clip(error?.message || "Push delivery failed.", 2000);
          if (error?.permanent) {
            await db.from("ops_manager_push_devices").update({ enabled: false, revoked_at: new Date().toISOString(), last_error: errorMessage })
              .eq("credential_id", job.credential_id);
          } else if (!error?.expired) {
            await db.from("ops_manager_push_devices").update({ last_error: errorMessage }).eq("credential_id", job.credential_id);
          }
        }
        const finished = await db.rpc("ops_manager_finish_notification_job", {
          p_queue_id: job.queue_id,
          p_lease_token: job.lease_token,
          p_succeeded: succeeded,
          p_provider_message_id: providerMessageId,
          p_error: errorMessage,
          p_retry_seconds: succeeded ? 30 : (errorMessage ? 120 : 30),
        });
        if (finished.error) throw finished.error;
        results.push({ queue_id: job.queue_id, succeeded, error: errorMessage });
      }
      return { ok: true, claimed: jobs.length, sent: results.filter((row) => row.succeeded).length, results };
    } finally {
      inFlight = false;
    }
  }

  return { configured: Boolean(account), projectId: account?.project_id || null, getClientConfig, send, sweep };
}

export function installManagerNotificationRoutes(app, { env = process.env, supabase = null } = {}) {
  if (!app || runtimeByApp.has(app)) return runtimeByApp.get(app) || null;
  const db = supabase || createSupabase(env);
  const requireManager = makeOpsAccessMiddleware({ supabase: db });
  const runtime = createPushRuntime({ db, env });
  runtimeByApp.set(app, runtime);

  app.use("/manager-notifications-api", (req, res, next) => {
    setCors(req, res, env);
    if (req.method === "OPTIONS") return res.sendStatus(200);
    next();
  });
  const configured = (_req, res, next) => db ? next() : res.status(503).json({ ok: false, error: "Database connection is not configured." });

  async function loadPreferences(identity) {
    const result = await db.from("ops_manager_notification_preferences")
      .select("*").eq("credential_id", identity.credentialId).maybeSingle();
    if (result.error) throw result.error;
    if (result.data) return result.data;
    const created = await db.from("ops_manager_notification_preferences").insert({
      credential_id: identity.credentialId,
      manager_id: identity.managerId,
    }).select("*").single();
    if (created.error) throw created.error;
    return created.data;
  }

  app.get("/manager-notifications-api/health", (_req, res) => {
    res.status(db ? 200 : 503).json({
      ok: Boolean(db),
      manager_only: true,
      employee_kiosk_notifications: false,
      provider: "fcm",
      provider_configured: runtime.configured,
      project_id: runtime.projectId,
      client_config_artifacts: runtime.configured ? {
        android: "/manager-notifications-api/client-config/android",
        ios: "/manager-notifications-api/client-config/ios",
      } : null,
      defaults: { messages_enabled: true, event_reminders_enabled: false, due_soon_enabled: false, overdue_enabled: false },
    });
  });

  app.get("/manager-notifications-api/client-config/:platform", async (req, res) => {
    try {
      const config = await runtime.getClientConfig(req.params?.platform, req.query?.app_identifier);
      const raw = Buffer.from(config.contents_base64, "base64");
      if (!raw.length) throw Object.assign(new Error("Firebase client configuration was empty."), { status: 502 });
      if (String(req.query?.format || "").toLowerCase() === "json") {
        res.setHeader("Cache-Control", "public, max-age=3600");
        res.json({ ok: true, data: config });
        return;
      }
      res.setHeader("Content-Type", config.platform === "android" ? "application/json; charset=utf-8" : "application/x-plist; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${config.filename.replace(/[^a-zA-Z0-9._-]/g, "_")}"`);
      res.setHeader("Cache-Control", "public, max-age=3600");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.status(200).send(raw);
    } catch (error) { fail(res, error, "Firebase client configuration could not be downloaded."); }
  });

  app.get("/manager-notifications-api/preferences", configured, requireManager, async (req, res) => {
    try {
      const identity = currentIdentity(req);
      const [preferences, deviceResult] = await Promise.all([
        loadPreferences(identity),
        db.from("ops_manager_push_devices").select("push_device_id,platform,enabled,last_registered_at,last_seen_at,revoked_at,last_error")
          .eq("credential_id", identity.credentialId).maybeSingle(),
      ]);
      if (deviceResult.error) throw deviceResult.error;
      res.json({ ok: true, data: { preferences: preferenceView(preferences), push_device: deviceResult.data || null, provider_configured: runtime.configured } });
    } catch (error) { fail(res, error); }
  });

  app.put("/manager-notifications-api/preferences", configured, requireManager, async (req, res) => {
    try {
      const identity = currentIdentity(req);
      const current = await loadPreferences(identity);
      const patch = normalizePreferencePatch(req.body || {}, current);
      const result = await db.from("ops_manager_notification_preferences").update({ ...patch, manager_id: identity.managerId })
        .eq("credential_id", identity.credentialId).select("*").single();
      if (result.error) throw result.error;
      await runtime.sweep({ limit: 10 }).catch(() => {});
      res.json({ ok: true, data: { preferences: preferenceView(result.data) } });
    } catch (error) { fail(res, error, "Notification preferences could not be saved."); }
  });

  app.post("/manager-notifications-api/register", configured, requireManager, async (req, res) => {
    try {
      const identity = currentIdentity(req);
      const token = clip(req.body?.token || req.body?.fcm_token, 4096);
      const platform = String(req.body?.platform || "").trim().toLowerCase();
      if (token.length < 20) throw Object.assign(new Error("A valid FCM registration token is required."), { status: 422 });
      if (!['ios','android'].includes(platform)) throw Object.assign(new Error("Push platform must be ios or android."), { status: 422 });
      await loadPreferences(identity);
      await db.from("ops_manager_push_devices").update({ enabled: false, revoked_at: new Date().toISOString(), last_error: "token_reassigned" })
        .eq("fcm_token", token).neq("credential_id", identity.credentialId);
      const now = new Date().toISOString();
      const result = await db.from("ops_manager_push_devices").upsert({
        credential_id: identity.credentialId,
        manager_id: identity.managerId,
        device_id: identity.deviceId || `manager-app-${identity.credentialId}`,
        provider: "fcm",
        platform,
        fcm_token: token,
        enabled: true,
        app_version: clip(req.body?.app_version, 80) || null,
        app_build: clip(req.body?.app_build, 80) || null,
        last_registered_at: now,
        last_seen_at: now,
        revoked_at: null,
        last_error: null,
        metadata_json: { registered_by: "manager_app", notification_defaults: "messages_on_events_locations_off" },
      }, { onConflict: "credential_id" }).select("push_device_id,credential_id,manager_id,device_id,platform,enabled,last_registered_at,last_seen_at").single();
      if (result.error) throw result.error;
      res.json({ ok: true, data: { push_device: result.data, provider_configured: runtime.configured } });
    } catch (error) { fail(res, error, "Push registration failed."); }
  });

  app.delete("/manager-notifications-api/register", configured, requireManager, async (req, res) => {
    try {
      const identity = currentIdentity(req);
      const result = await db.from("ops_manager_push_devices").update({
        enabled: false, revoked_at: new Date().toISOString(), last_error: "unregistered_by_manager",
      }).eq("credential_id", identity.credentialId).select("push_device_id").maybeSingle();
      if (result.error) throw result.error;
      res.json({ ok: true, data: { unregistered: Boolean(result.data) } });
    } catch (error) { fail(res, error, "Push registration could not be removed."); }
  });

  app.post("/manager-notifications-api/test", configured, requireManager, async (req, res) => {
    try {
      const identity = currentIdentity(req);
      const push = await db.from("ops_manager_push_devices").select("push_device_id").eq("credential_id", identity.credentialId)
        .eq("enabled", true).is("revoked_at", null).maybeSingle();
      if (push.error) throw push.error;
      if (!push.data) throw Object.assign(new Error("Enable notifications on this phone first."), { status: 409 });
      const queue = await db.from("ops_manager_notification_queue").insert({
        job_key: `manager-test:${identity.credentialId}:${crypto.randomUUID()}`,
        credential_id: identity.credentialId,
        manager_id: identity.managerId,
        notification_type: "test",
        title: "Memphis Zoo Ops",
        body: "Manager notifications are working on this phone.",
        data_json: { kind: "test", route: "index.html" },
      }).select("queue_id,status").single();
      if (queue.error) throw queue.error;
      const delivery = await runtime.sweep({ limit: 10 });
      res.status(runtime.configured ? 202 : 503).json({ ok: runtime.configured, data: { queue: queue.data, delivery }, error: runtime.configured ? undefined : "Firebase push delivery is not configured on the backend." });
    } catch (error) { fail(res, error, "Test notification could not be queued."); }
  });

  const sweepMs = int(env?.MANAGER_NOTIFICATION_SWEEP_MS, DEFAULT_SWEEP_MS, 5_000, 300_000);
  if (db && sweepMs > 0) {
    setInterval(() => runtime.sweep().catch((error) => console.error("manager push sweep failed:", error?.message || error)), sweepMs).unref?.();
    runtime.sweep().catch((error) => console.error("manager push startup sweep failed:", error?.message || error));
  }
  return runtime;
}
