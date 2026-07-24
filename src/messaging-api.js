import express from "express";
import { randomUUID } from "node:crypto";
import { makeOpsAccessMiddleware } from "./auth/shared-access-auth.js";
import { getGeminiDiagnostics } from "./utils/gemini-config.js";
import { createMemphisResponder } from "./services/index.js";
import { resolveCanonicalDevice } from "./device-identity.js";

export function createMessagingRouter({ runReadOnlySql, runRpc, buildHealthPayload, requireDeviceAccess, requireOpsManagerAuth: suppliedOpsManagerAuth, registerOperationalJobHandler, appVersion, releaseId, contractVersion }) {
  const router = express.Router();
  const memphisResponder = createMemphisResponder({ runReadOnlySql, runRpc });
  const requireOpsManagerAuth = suppliedOpsManagerAuth || makeOpsAccessMiddleware();
  const retiredGeminiAdminRoute = (_req, res) => res.status(410).json({ ok: false, error: "This diagnostic route is retired. Use /gemini-api." });

  // All employee messaging access flows through the canonical device credential
  // boundary. Manager bearer sessions may inspect the same routes, but read-only
  // sessions are never allowed to mutate threads, receipts, or messages.
  function requestDeviceId(req) {
    return String(req?.body?.device_id || req?.body?.deviceId || req?.query?.device_id || req?.query?.device || req?.header?.("x-device-id") || "").trim();
  }

  async function finishMessagingIdentity(req, res, next) {
    if (req.memphisAuth) {
      try {
        const identity = await getManagerMessagingIdentity(req.memphisAuth);
        req.memphisMessagingManager = { identity };
        next();
      } catch (error) {
        res.status(error?.status || 401).json({ ok: false, error: error?.message || "Manager messaging identity failed." });
      }
      return;
    }
    const canonicalDeviceId = String(req.memphisDevice?.canonical_device_id || req.memphisDevice?.device_id || requestDeviceId(req)).trim();
    if (!canonicalDeviceId) {
      res.status(401).json({ ok: false, error: "device_id is required." });
      return;
    }
    getViewerIdentity(canonicalDeviceId)
      .then((identity) => {
        if (!identity) {
          res.status(401).json({ ok: false, error: "Device is not registered in the messaging system." });
          return;
        }
        req.memphisMessagingDevice = { deviceId: canonicalDeviceId, identity };
        next();
      })
      .catch((error) => {
        res.status(401).json({ ok: false, error: error?.message || "Device authentication failed." });
      });
  }

  function requireDeviceOrOpsAuth(req, res, next) {
    if (typeof requireDeviceAccess === "function") {
      requireDeviceAccess(req, res, () => finishMessagingIdentity(req, res, next));
      return;
    }
    // Import-safe fallback for isolated router tests. Production always injects
    // the shared credential boundary from src/index.js.
    const deviceId = requestDeviceId(req);
    if (!deviceId) {
      res.status(401).json({ ok: false, error: "device_id is required." });
      return;
    }
    getViewerIdentity(deviceId)
      .then((identity) => {
        if (!identity) {
          res.status(401).json({ ok: false, error: "Device is not registered in the messaging system." });
          return;
        }
        req.memphisMessagingDevice = { deviceId, identity };
        next();
      })
      .catch((error) => res.status(401).json({ ok: false, error: error?.message || "Device authentication failed." }));
  }

  function requireWritableDeviceOrOpsAuth(req, res, next) {
    requireDeviceOrOpsAuth(req, res, () => {
      if (req.memphisAuth?.read_only) {
        res.status(403).json({ ok: false, error: "Read-only Ops Manager access cannot modify Messenger." });
        return;
      }
      next();
    });
  }
  const MANAGER_OVERVIEW_DEVICE_IDS = new Set(
    String(process.env.MANAGER_OVERVIEW_DEVICE_IDS || "1e74fe4c-dc20b3b9,KIOSK_01,KIOSK_1")
      .split(",").map((s) => s.trim()).filter(Boolean)
  );
  const OFF_SHIFT_NOTIFICATION_OVERRIDE_SETTING_KEY = "off_shift_employee_notifications_override_enabled";

  function fail(res, error, fallback = "Messaging request failed") {
    const requested = Number(error?.status || error?.statusCode || 400);
    const status = requested >= 400 && requested <= 599 ? requested : 400;
    res.status(status).json({ ok: false, error: error?.message || fallback });
  }

  function esc(value) {
    if (value == null) return "null";
    return String(value).replace(/'/g, "''");
  }

  function isUuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || "").trim())
      || /^00000000-0000-0000-0000-000000000000$/i.test(String(value || "").trim());
  }

  function waitFor(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  function getGeminiDiagnosticsForMessaging() {
    const model = String(process.env.MEMPHIS_GEMINI_MODEL || process.env.GEMINI_MODEL || "gemini-2.5-flash").trim();
    return getGeminiDiagnostics({ preferred: ["MEMPHIS_GEMINI_API_KEY"], model });
  }

  function isManagerOverviewDevice(deviceId = "") {
    return MANAGER_OVERVIEW_DEVICE_IDS.has(String(deviceId || "").trim());
  }

  async function getViewerIdentity(deviceId = "") {
    const normalizedDeviceId = String(deviceId || "").trim();
    if (!normalizedDeviceId) return null;
    const device = await resolveCanonicalDevice({ runReadOnlySql, deviceIdentifier: normalizedDeviceId });
    const canonicalDeviceId = String(device?.canonical_device_id || normalizedDeviceId).trim();
    let rows = await runReadOnlySql(`select * from public.msg_get_user_by_device('${esc(canonicalDeviceId)}')`);
    if ((!Array.isArray(rows) || !rows.length) && canonicalDeviceId.toLowerCase() !== normalizedDeviceId.toLowerCase()) {
      rows = await runReadOnlySql(`select * from public.msg_get_user_by_device('${esc(normalizedDeviceId)}')`);
    }
    if (!Array.isArray(rows) || !rows.length) return null;
    return {
      ...rows[0],
      requested_device_id: normalizedDeviceId,
      canonical_device_id: canonicalDeviceId,
      assignment_epoch: Number(device?.assignment_epoch || 0) || null,
      matched_by: device?.matched_by || "messenger_assignment",
    };
  }

  function messagingRoleTitle(row = {}) {
    const explicit = String(row.role_title || row.job_title || "").trim();
    if (explicit) return explicit;
    const role = String(row.role || "").trim().toLowerCase();
    if (role === "bot") return "Memphis";
    if (["manager", "ops", "ops_manager", "operations_manager", "ops manager", "operations manager"].includes(role)) return "Operations Leadership";
    return "Employee";
  }

  async function getLeadershipProfilesForMessagingUsers(userIds = []) {
    const ids = [...new Set((Array.isArray(userIds) ? userIds : []).map((value) => String(value || "").trim()).filter(isUuid))];
    if (!ids.length) return new Map();
    const rows = await runReadOnlySql(`
      select
        u.id as msg_user_id,
        m.manager_id,
        m.display_name as manager_display_name,
        m.job_title,
        m.department_key,
        m.roles as manager_roles
      from public.msg_users u
      join public.ops_manager_managers m on m.manager_id = u.ops_manager_id
      where u.id in (${ids.map((id) => `'${esc(id)}'::uuid`).join(",")})
        and u.is_active = true
        and m.active = true
        and m.revoked_at is null
        and m.is_system_principal = false
    `);
    return new Map((Array.isArray(rows) ? rows : []).map((row) => [String(row.msg_user_id || "").trim(), row]));
  }

  async function getLeadershipProfileForMessagingUser(userId = "") {
    return (await getLeadershipProfilesForMessagingUsers([userId])).get(String(userId || "").trim()) || null;
  }

  async function enrichMessagingUsers(rows = []) {
    const users = Array.isArray(rows) ? rows : [];
    const profiles = await getLeadershipProfilesForMessagingUsers(users.map((row) => row?.id));
    return users.map((row) => {
      const profile = profiles.get(String(row?.id || "").trim()) || null;
      return {
        ...row,
        role_title: messagingRoleTitle({ ...row, ...(profile || {}) }),
        job_title: String(profile?.job_title || "").trim() || null,
        department_key: String(profile?.department_key || "").trim() || null,
        manager_roles: Array.isArray(profile?.manager_roles) ? profile.manager_roles : null,
      };
    });
  }

  async function getManagerMessagingIdentity(managerSession = {}) {
    const managerId = String(managerSession?.manager_id || "").trim();
    if (!isUuid(managerId)) throw Object.assign(new Error("Authenticated manager identity is required for Messenger."), { status: 401 });
    const data = await runRpc("msg_ensure_ops_manager_user", { p_manager_id: managerId });
    const row = Array.isArray(data) ? data[0] : data;
    const userId = String(row?.msg_user_id || row?.user_id || row?.id || "").trim();
    if (!isUuid(userId)) throw Object.assign(new Error("Authenticated manager has no server messaging principal."), { status: 403 });
    const leadershipProfile = await getLeadershipProfileForMessagingUser(userId);
    const sharedThreadData = await runRpc("msg_get_or_create_ops_manager_thread", { p_manager_id: managerId });
    const sharedThread = Array.isArray(sharedThreadData) ? sharedThreadData[0] : sharedThreadData;
    const sharedThreadId = String(sharedThread?.thread_id || sharedThread?.id || "").trim();
    if (!isUuid(sharedThreadId)) throw Object.assign(new Error("The Operations Leadership chat is unavailable."), { status: 503 });
    return {
      ...row,
      msg_user_id: userId,
      user_id: userId,
      role: "manager",
      manager_id: managerId,
      display_name: String(leadershipProfile?.manager_display_name || row?.display_name || managerSession?.manager_display_name || "Operations Leadership"),
      role_title: messagingRoleTitle({ ...row, ...(leadershipProfile || {}) }),
      job_title: String(leadershipProfile?.job_title || "").trim() || null,
      department_key: String(leadershipProfile?.department_key || "").trim() || null,
      manager_roles: Array.isArray(leadershipProfile?.manager_roles) ? leadershipProfile.manager_roles : [],
      canonical_device_id: String(managerSession?.device_id || managerSession?.credential_id || "manager-session"),
      identity_source: "trusted_manager_session",
      ops_manager_thread_id: sharedThreadId,
    };
  }

  async function resolveViewerContext({ userId = "", deviceId = "", managerSession = null } = {}) {
    const normalizedUserId = String(userId || "").trim();
    const normalizedDeviceId = String(deviceId || "").trim();
    if (managerSession) {
      const identity = await getManagerMessagingIdentity(managerSession);
      const effectiveUserId = String(identity.msg_user_id).trim();
      if (normalizedUserId && normalizedUserId !== effectiveUserId) {
        throw Object.assign(new Error("A manager session cannot impersonate another Messenger user."), { status: 403 });
      }
      return {
        identity,
        effectiveUserId,
        deviceId: String(managerSession.device_id || managerSession.credential_id || "manager-session"),
        isManagerOverview: true,
        authenticatedManager: true,
      };
    }
    if (!normalizedDeviceId) throw new Error("device_id is required.");
    const identity = await getViewerIdentity(normalizedDeviceId);
    const effectiveUserId = String(identity?.msg_user_id || normalizedUserId || "").trim();
    const isManagerOverview = Boolean(
      identity
      && String(identity.role || "").trim().toLowerCase() === "manager"
      && isManagerOverviewDevice(normalizedDeviceId)
    );
    if (!effectiveUserId) throw new Error("Could not resolve user for this device. Ensure the device is assigned to a messaging user.");
    if (identity?.msg_user_id && normalizedUserId && normalizedUserId !== effectiveUserId && !isManagerOverview) {
      throw new Error("This device can only access its assigned messenger account.");
    }
    return { identity, effectiveUserId, deviceId: normalizedDeviceId, isManagerOverview };
  }

  async function requireDeviceAuth(req, res) {
    const deviceId = String(req.query?.device_id || req.body?.device_id || req.body?.deviceId || "").trim();
    const userId = String(req.query?.user_id || req.body?.user_id || req.body?.userId || req.body?.sender_user_id || "").trim();
    if (!deviceId) {
      res.status(401).json({ ok: false, error: "device_id is required." });
      return null;
    }
    try {
      return await resolveViewerContext({ userId, deviceId, managerSession: req.memphisAuth || null });
    } catch (error) {
      res.status(401).json({ ok: false, error: error?.message || "Unauthorized." });
      return null;
    }
  }

  async function isThreadParticipant(threadId, userId) {
    if (!threadId || !userId) return false;
    const rows = await runReadOnlySql(`
      select 1 from public.msg_thread_participants
      where thread_id = '${esc(threadId)}'::uuid
        and user_id = '${esc(userId)}'::uuid
        and left_at is null
      limit 1
    `);
    return Array.isArray(rows) && rows.length > 0;
  }

  async function getThreadIdentity(threadId) {
    const normalizedThreadId = String(threadId || "").trim();
    if (!normalizedThreadId) return null;
    const rows = await runReadOnlySql(`
      select
        t.id,
        t.thread_type,
        t.title,
        t.system_key,
        t.is_active,
        exists (
          select 1
          from public.msg_thread_participants tp
          join public.msg_users u on u.id = tp.user_id
          where tp.thread_id = t.id
            and tp.left_at is null
            and u.is_active = true
            and u.role = 'bot'
            and lower(btrim(u.display_name)) = 'memphis'
        ) as has_memphis_bot
      from public.msg_threads t
      where t.id = '${esc(normalizedThreadId)}'::uuid
      limit 1
    `);
    return Array.isArray(rows) && rows.length ? rows[0] : null;
  }

  function isMemphisThread(thread = {}) {
    return String(thread?.thread_type || "").trim().toLowerCase() === "bot"
      || thread?.has_memphis_bot === true
      || String(thread?.title || "").trim().toLowerCase() === "memphis";
  }

  async function getServiceDate() {
    const rows = await runReadOnlySql("select public.sch_service_date(now()) as service_date");
    return Array.isArray(rows) && rows.length ? rows[0].service_date : null;
  }

  function messagingMeta(extra = {}) {
    return { version: appVersion, release_id: releaseId, contract_version: contractVersion, ...extra };
  }

  async function auditQuery(name, sql) {
    try {
      const rows = await runReadOnlySql(sql);
      return { name, ok: true, rows: Array.isArray(rows) ? rows : [] };
    } catch (error) {
      return { name, ok: false, error: error?.message || String(error || "Query failed"), rows: [] };
    }
  }

  function auditFirst(result, fallback = {}) {
    return result?.ok && Array.isArray(result.rows) && result.rows.length ? result.rows[0] : fallback;
  }

  function numberValue(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function formatCount(value) {
    return Number(numberValue(value)).toLocaleString("en-US");
  }

  function formatAgeMinutes(minutes) {
    const value = numberValue(minutes, null);
    if (value == null) return "unknown age";
    if (value < 60) return `${Math.round(value)} min old`;
    if (value < 1440) return `${(value / 60).toFixed(1)} hr old`;
    return `${(value / 1440).toFixed(1)} days old`;
  }

  function checkStatus(condition, warnCondition = false) {
    if (condition) return "bad";
    if (warnCondition) return "warn";
    return "ok";
  }

  function summarizeAdminAudit({ prompt = "", auth = {}, queries = {}, memphis = {} } = {}) {
    const dashboard = auditFirst(queries.dashboard);
    const attendance = auditFirst(queries.attendance);
    const deviceDrift = auditFirst(queries.deviceDrift);
    const messageAging = auditFirst(queries.messageAging);
    const scheduleStats = auditFirst(queries.scheduleStats);
    const latestRuns = queries.latestScheduleRuns?.rows || [];
    const driftRows = queries.deviceDriftRows?.rows || [];
    const attentionRows = queries.attentionRows?.rows || [];
    const openSegments = queries.openSegments?.rows || [];

    const checks = [
      {
        area: "Access gate",
        status: auth?.role === "ops_manager" ? "ok" : "bad",
        summary: auth?.role === "ops_manager"
          ? "Ops Manager session verified before running the console."
          : "Console request did not resolve an Ops Manager session.",
      },
      {
        area: "Change control",
        status: "ok",
        summary: "This audit route is read-only: it only runs SELECT checks and returns recommendations. It does not publish schedules, write messages, clean data, or change configuration.",
      },
      {
        area: "Gemini/Memphis model",
        status: memphis.gemini_configured ? "ok" : "warn",
        summary: memphis.gemini_configured
          ? `${memphis.memphis_model || "Gemini"} configured via ${memphis.gemini_key_source || "configured key"}.`
          : "Gemini API key is not configured; local/read-only audit checks still run.",
      },
      {
        area: "Attendance freshness",
        status: checkStatus(numberValue(attendance.age_minutes, 99999) > 180, numberValue(attendance.age_minutes, 99999) > 60),
        summary: attendance.updated_at
          ? `Attendance is ${formatAgeMinutes(attendance.age_minutes)}; current count ${formatCount(attendance.attendance)}; source ${attendance.source || "unknown"}.`
          : "No current attendance row was found.",
      },
      {
        area: "Device / employee drift",
        status: checkStatus(numberValue(deviceDrift.employee_mismatch_count) > 0 || numberValue(deviceDrift.missing_messenger_assignment_count) > 0, numberValue(deviceDrift.inactive_or_missing_user_count) > 0),
        summary: `${formatCount(deviceDrift.active_device_count)} active devices; ${formatCount(deviceDrift.missing_messenger_assignment_count)} missing messenger assignment; ${formatCount(deviceDrift.employee_mismatch_count)} employee mismatches; ${formatCount(deviceDrift.inactive_or_missing_user_count)} inactive/missing messenger users.`,
      },
      {
        area: "Old message data",
        status: checkStatus(false, numberValue(messageAging.older_than_90d_count) > 1000),
        summary: `${formatCount(messageAging.total_message_count)} stored messages; ${formatCount(messageAging.older_than_90d_count)} older than 90 days; oldest ${messageAging.oldest_message_at || "unknown"}.`,
      },
      {
        area: "Schedule operations",
        status: checkStatus(numberValue(scheduleStats.error_run_count) > 0 || numberValue(scheduleStats.hard_violation_run_count) > 0, numberValue(scheduleStats.open_required_run_count) > 0),
        summary: `${formatCount(scheduleStats.run_count_14d)} schedule runs in 14 days; ${formatCount(scheduleStats.error_run_count)} errors; ${formatCount(scheduleStats.hard_violation_run_count)} with hard violations; ${formatCount(scheduleStats.open_required_run_count)} with open required segments.`,
      },
      {
        area: "Dashboard attention",
        status: checkStatus(numberValue(dashboard.overdue_locations) > 0, numberValue(dashboard.due_soon_locations) > 0 || numberValue(dashboard.open_ticket_count) > 0),
        summary: `Dashboard has ${formatCount(dashboard.open_ticket_count)} open tickets, ${formatCount(dashboard.overdue_locations)} overdue locations, ${formatCount(dashboard.due_soon_locations)} due soon.`,
      },
    ];

    const worst = checks.some((item) => item.status === "bad") ? "bad" : (checks.some((item) => item.status === "warn") ? "warn" : "ok");
    const recommendations = [];
    if (numberValue(deviceDrift.employee_mismatch_count) > 0 || numberValue(deviceDrift.missing_messenger_assignment_count) > 0) recommendations.push("Review the listed device drift rows before changing device assignments. Employee-specific fields may differ; everything else should be uniform by fleet policy.");
    if (numberValue(attendance.age_minutes, 0) > 60) recommendations.push("Check the attendance pusher service if the attendance row is older than one hour during operating hours.");
    if (numberValue(messageAging.older_than_90d_count) > 1000) recommendations.push("Review Messenger storage growth. Ordinary messages are retained; only explicitly deleted content is purged after 14 days.");
    if (numberValue(scheduleStats.error_run_count) > 0) recommendations.push("Inspect the latest schedule_generation_runs errors before publishing any schedule changes.");
    if (!recommendations.length) recommendations.push("No immediate admin action required from these read-only checks.");

    const lines = [
      `Read-only Gemini Console audit: ${worst.toUpperCase()}`,
      prompt ? `Prompt: ${prompt}` : "Prompt: full upkeep audit",
      "",
      ...checks.map((item) => `${item.status.toUpperCase()} · ${item.area}: ${item.summary}`),
      "",
      "Top attention rows:",
      attentionRows.length ? attentionRows.slice(0, 8).map((row) => `- ${row.location_name || row.location_code}: ${row.status_code || "status?"}, ${formatCount(row.open_ticket_count)} tickets, session ${row.open_session_status || "—"}`).join("\n") : "- None returned.",
      "",
      "Device drift examples:",
      driftRows.length ? driftRows.slice(0, 8).map((row) => `- ${row.device_id}: device employee=${row.device_employee_name || "—"}; messenger user=${row.msg_display_name || "—"}; issue=${row.issue || "review"}`).join("\n") : "- No drift examples returned.",
      "",
      "Open schedule segments:",
      openSegments.length ? openSegments.slice(0, 8).map((row) => `- ${row.group_name || row.group_code}: ${row.coverage_start || "—"}-${row.coverage_end || "—"} (${row.reason_open || "open"})`).join("\n") : "- None returned.",
      "",
      "Latest schedule runs:",
      latestRuns.length ? latestRuns.slice(0, 5).map((row) => `- ${row.service_date}: ${row.status}; hard=${formatCount(row.hard_violation_count)} open=${formatCount(row.open_required_count)}; updated=${row.updated_at || "—"}${row.error_message ? `; error=${row.error_message}` : ""}`).join("\n") : "- None returned.",
      "",
      "Recommendations:",
      ...recommendations.map((item) => `- ${item}`),
      "",
      "Change control: this console can recommend upkeep only. Any fix/apply/cleanup/publish path must require an Ops Manager/admin-approved action outside this read-only audit route."
    ];

    return { status: worst, checks, recommendations, report: lines.join("\n"), details: { dashboard, attendance, deviceDrift, messageAging, scheduleStats, attentionRows, driftRows, openSegments, latestScheduleRuns: latestRuns } };
  }

  async function runGeminiAdminAudit({ prompt = "", auth = null } = {}) {
    const memphis = getGeminiDiagnosticsForMessaging();
    const results = await Promise.all([
      auditQuery("dashboard", `select * from public.v_admin_health_snapshot order by snapshot_at desc limit 1`),
      auditQuery("attendance", `select attendance, planned, last_year, yesterday, yesterday_plan, source, fetched_at, updated_at, extract(epoch from (now() - coalesce(updated_at, fetched_at))) / 60 as age_minutes from public.current_attendance_state where id = 1 limit 1`),
      auditQuery("deviceDrift", `
        select
          count(*) as active_device_count,
          count(*) filter (where mda.id is null) as missing_messenger_assignment_count,
          count(*) filter (where mda.id is not null and mu.id is null) as inactive_or_missing_user_count,
          count(*) filter (where d.assigned_employee_id is not null and mu.employee_id is not null and d.assigned_employee_id is distinct from mu.employee_id) as employee_mismatch_count,
          count(*) filter (where d.last_seen_at is null or d.last_seen_at < now() - interval '7 days') as stale_seen_count
        from public.devices d
        left join lateral (
          select * from public.msg_device_assignments mda
          where mda.device_identifier = d.device_id and mda.is_active = true
          order by mda.updated_at desc nulls last, mda.created_at desc nulls last
          limit 1
        ) mda on true
        left join public.msg_users mu on mu.id = mda.msg_user_id and coalesce(mu.is_active, mu.active, true) = true
        where d.active = true
      `),
      auditQuery("deviceDriftRows", `
        select * from (
          select
            d.device_id,
            d.device_name,
            de.display_name as device_employee_name,
            mu.display_name as msg_display_name,
            me.display_name as msg_employee_name,
            d.last_seen_at,
            case
              when mda.id is null then 'missing_messenger_assignment'
              when mu.id is null then 'inactive_or_missing_msg_user'
              when d.assigned_employee_id is not null and mu.employee_id is not null and d.assigned_employee_id is distinct from mu.employee_id then 'employee_mismatch'
              when d.last_seen_at is null or d.last_seen_at < now() - interval '7 days' then 'stale_last_seen'
              else ''
            end as issue
          from public.devices d
          left join public.employees de on de.id = d.assigned_employee_id
          left join lateral (
            select * from public.msg_device_assignments mda
            where mda.device_identifier = d.device_id and mda.is_active = true
            order by mda.updated_at desc nulls last, mda.created_at desc nulls last
            limit 1
          ) mda on true
          left join public.msg_users mu on mu.id = mda.msg_user_id and coalesce(mu.is_active, mu.active, true) = true
          left join public.employees me on me.id = mu.employee_id
          where d.active = true
        ) q
        where issue <> ''
        order by issue, device_id
        limit 12
      `),
      auditQuery("messageAging", `select count(*) as total_message_count, count(*) filter (where created_at < now() - interval '90 days') as older_than_90d_count, count(*) filter (where is_deleted = true) as deleted_message_count, min(created_at) as oldest_message_at, max(created_at) as newest_message_at from public.msg_messages`),
      auditQuery("scheduleStats", `select count(*) as run_count_14d, count(*) filter (where status ilike '%error%' or error_message is not null) as error_run_count, count(*) filter (where coalesce(hard_violation_count,0) > 0) as hard_violation_run_count, count(*) filter (where coalesce(open_required_count,0) > 0) as open_required_run_count from public.schedule_generation_runs where created_at >= now() - interval '14 days'`),
      auditQuery("latestScheduleRuns", `select service_date, status, hard_violation_count, open_required_count, score_total, error_message, created_at, updated_at, published_at from public.schedule_generation_runs order by created_at desc limit 8`),
      auditQuery("attentionRows", `select location_code, location_name, status_code, status_color, open_ticket_count, latest_employee_name, latest_completed_at_display, open_session_status from public.v_location_dashboard_status where status_code <> 'okay' or open_ticket_count > 0 order by case status_color when 'red' then 1 when 'yellow' then 2 when 'blue' then 3 else 9 end, open_ticket_count desc, location_name limit 12`),
      auditQuery("openSegments", `select service_date, group_code, group_name, coverage_start, coverage_end, reason_open from public.v_memphis_open_segments where service_date = public.sch_service_date(now()) order by group_name, coverage_start limit 12`),
    ]);
    const queries = Object.fromEntries(results.map((result) => [result.name, result]));
    const audit = summarizeAdminAudit({ prompt, auth, queries, memphis });
    return {
      ...audit,
      memphis,
      auth: auth || null,
      query_status: Object.fromEntries(results.map((result) => [result.name, { ok: result.ok, error: result.error || null, row_count: result.rows.length }])),
      diagnostics: {
        ok: true,
        original_message: prompt,
        rewritten_message: prompt,
        route: { intent: "admin_upkeep_audit", confidence: 0.99, ambiguous: false, fallback_intents: [] },
        service_date: audit.details?.openSegments?.[0]?.service_date || null,
        likely_tool: "read_only_admin_audit",
        diagnostics_version: "gemini-admin-audit.v1",
      },
    };
  }

  function normalizeNotificationState(row, deviceId = "") {
    const data = row && typeof row === "object" ? row : {};
    return {
      requested_device_id: String(data.requested_device_id || deviceId || "").trim(),
      device_id: String(data.device_id || data.requested_device_id || deviceId || "").trim(),
      device_name: data.device_name || null,
      msg_user_id: data.msg_user_id || null,
      display_name: data.display_name || data.employee_name || null,
      role: data.role || null,
      employee_id: data.employee_id || null,
      employee_name: data.employee_name || null,
      service_date: data.service_date || null,
      local_now: data.local_now || null,
      shift_start: data.shift_start || null,
      shift_end: data.shift_end || null,
      shift_start_local: data.shift_start_local || null,
      shift_end_local: data.shift_end_local || null,
      is_employee_device: data.is_employee_device === true,
      override_enabled: data.override_enabled === true,
      notifications_silent: data.notifications_silent === true,
      silent_reason: String(data.silent_reason || "notifications_allowed"),
    };
  }

  function notificationStateMeta(notificationState) {
    return {
      notification_state: {
        notifications_silent: notificationState?.notifications_silent === true,
        silent_reason: String(notificationState?.silent_reason || "notifications_allowed"),
      },
    };
  }

  async function getDeviceNotificationState(deviceId = "", options = {}) {
    const normalizedDeviceId = String(deviceId || "").trim();
    if (!normalizedDeviceId) {
      return normalizeNotificationState({
        requested_device_id: "",
        notifications_silent: false,
        silent_reason: "missing_device_id",
      });
    }

    const requestedServiceDate = String(options.serviceDate || "").trim();
    const requestedEmployeeId = String(options.employeeId || "").trim();
    const serviceDateSql = requestedServiceDate
      ? `'${esc(requestedServiceDate)}'::date`
      : "public.sch_service_date(now())";
    const scopedEmployeeIdSql = requestedEmployeeId
      ? `'${esc(requestedEmployeeId)}'::uuid`
      : "coalesce(du.msg_employee_id, dr.assigned_employee_id)";
    const localNowSql = "(now() at time zone 'America/Chicago')";

    const rows = await runReadOnlySql(`
      select * from (
        with params as (
          select
            ${serviceDateSql} as service_date,
            ${localNowSql} as local_now
        ),
        device_user as (
          select
            mda.device_identifier,
            mu.id as msg_user_id,
            mu.employee_id as msg_employee_id,
            mu.display_name as msg_display_name,
            lower(coalesce(mu.role, '')) as msg_role
          from public.msg_device_assignments mda
          join public.msg_users mu on mu.id = mda.msg_user_id
          where mda.device_identifier = '${esc(normalizedDeviceId)}'
            and mda.is_active = true
            and mu.is_active = true
          order by mda.updated_at desc nulls last, mda.created_at desc nulls last
          limit 1
        ),
        device_row as (
          select
            d.device_id,
            d.device_name,
            d.assigned_employee_id,
            d.active as device_active
          from public.devices d
          where d.device_id = '${esc(normalizedDeviceId)}'
          order by d.updated_at desc nulls last, d.created_at desc nulls last
          limit 1
        ),
        identity as (
          select
            '${esc(normalizedDeviceId)}'::text as requested_device_id,
            coalesce(du.device_identifier, dr.device_id, '${esc(normalizedDeviceId)}') as device_id,
            dr.device_name,
            du.msg_user_id,
            du.msg_display_name,
            du.msg_role,
            ${scopedEmployeeIdSql} as employee_id,
            coalesce(dr.device_active, true) as device_active
          from params p
          left join device_user du on true
          left join device_row dr on true
        )
        select
          i.requested_device_id,
          i.device_id,
          i.device_name,
          i.msg_user_id,
          coalesce(i.msg_display_name, e.display_name) as display_name,
          i.msg_role as role,
          i.employee_id,
          e.display_name as employee_name,
          p.service_date,
          p.local_now,
          r.shift_start,
          r.shift_end,
          case when r.id is null then null else (p.service_date + r.shift_start) end as shift_start_local,
          case when r.id is null then null else (p.service_date + r.shift_end) end as shift_end_local,
          (
            coalesce(i.msg_role, '') = 'employee'
            or (
              i.employee_id is not null
              and coalesce(i.msg_role, '') not in ('manager', 'bot', 'ops', 'ops_manager', 'operations_manager')
            )
          ) as is_employee_device,
          coalesce(ss.setting_value = 'true'::jsonb, false) as override_enabled,
          case
            when not (
              coalesce(i.msg_role, '') = 'employee'
              or (
                i.employee_id is not null
                and coalesce(i.msg_role, '') not in ('manager', 'bot', 'ops', 'ops_manager', 'operations_manager')
              )
            ) then false
            when coalesce(ss.setting_value = 'true'::jsonb, false) then false
            when i.employee_id is null then true
            when r.id is null then true
            when r.shift_start is null or r.shift_end is null then true
            when p.local_now < (p.service_date + r.shift_start) then true
            when p.local_now >= (p.service_date + r.shift_end) then true
            else false
          end as notifications_silent,
          case
            when not (
              coalesce(i.msg_role, '') = 'employee'
              or (
                i.employee_id is not null
                and coalesce(i.msg_role, '') not in ('manager', 'bot', 'ops', 'ops_manager', 'operations_manager')
              )
            ) then 'not_employee_device'
            when coalesce(ss.setting_value = 'true'::jsonb, false) then 'admin_overtime_override_enabled'
            when i.employee_id is null then 'no_employee_mapping'
            when r.id is null then 'no_active_roster_shift'
            when r.shift_start is null or r.shift_end is null then 'invalid_roster_shift_window'
            when p.local_now < (p.service_date + r.shift_start) then 'scheduled_shift_not_started'
            when p.local_now >= (p.service_date + r.shift_end) then 'scheduled_shift_ended'
            else 'on_shift'
          end as silent_reason
        from params p
        left join identity i on true
        left join public.employees e on e.id = i.employee_id
        left join lateral (
          select r.*
          from public.daily_work_roster r
          where r.service_date = p.service_date
            and r.employee_id = i.employee_id
            and r.active = true
          order by r.updated_at desc nulls last, r.created_at desc nulls last
          limit 1
        ) r on true
        left join public.system_settings ss
          on ss.setting_key = '${esc(OFF_SHIFT_NOTIFICATION_OVERRIDE_SETTING_KEY)}'
        limit 1
      ) notification_state
    `);
    if (!Array.isArray(rows) || !rows.length) {
      return normalizeNotificationState({
        requested_device_id: normalizedDeviceId,
        device_id: normalizedDeviceId,
        notifications_silent: false,
        silent_reason: "state_unavailable",
      }, normalizedDeviceId);
    }
    return normalizeNotificationState(rows[0], normalizedDeviceId);
  }

  function shouldSilenceDeviceNotifications(notificationState) {
    return notificationState?.notifications_silent === true;
  }

  function shouldSuppressPhoneNotificationPayloads(notificationState) {
    return notificationState?.is_employee_device !== true || shouldSilenceDeviceNotifications(notificationState);
  }

  function phoneSuppressedNotificationState(notificationState) {
    if (notificationState?.is_employee_device === true) return notificationState;
    return forceSilentNotificationState(notificationState, String(notificationState?.silent_reason || "not_employee_device"));
  }

  function shouldQueryPresentationDemosWhenSilent(notificationState) {
    if (!shouldSilenceDeviceNotifications(notificationState)) return false;
    const reason = String(notificationState?.silent_reason || "").trim().toLowerCase();
    return !["missing_device_id", "no_employee_mapping", "device_assignment_mismatch"].includes(reason);
  }

  function idsDiffer(a, b) {
    const left = String(a || "").trim().toLowerCase();
    const right = String(b || "").trim().toLowerCase();
    return Boolean(left && right && left !== right);
  }

  function forceSilentNotificationState(notificationState, reason) {
    return {
      ...(notificationState || {}),
      notifications_silent: true,
      silent_reason: String(reason || "notifications_silenced"),
    };
  }

  async function getAssignedEmployeeForDevice(deviceId = "") {
    const normalizedDeviceId = String(deviceId || "").trim();
    if (!normalizedDeviceId) return null;
    return resolveCanonicalDevice({ runReadOnlySql, deviceIdentifier: normalizedDeviceId });
  }

  function buildThreadListSql({ viewerUserId = "", deviceIdentifier = "", managerOverview = false }) {
    const viewer = esc(viewerUserId);
    const device = esc(deviceIdentifier);
    const visibilityClause = managerOverview
      ? "true"
      : "tp.viewer_is_participant = true";
    const unreadSelect = managerOverview
      ? "case when tp.viewer_is_participant then coalesce(u.unread_count, 0) else 0 end"
      : "coalesce(u.unread_count, 0)";
    return `
      select * from (
      with thread_participants as (
        select
          tp.thread_id,
          count(*) filter (where tp.left_at is null) as participant_count,
          string_agg(mu.display_name, ', ' order by mu.display_name)
            filter (where tp.left_at is null) as participant_names,
          string_agg(case when tp.user_id <> '${viewer}'::uuid then mu.display_name end, ', ' order by mu.display_name)
            filter (where tp.left_at is null and tp.user_id <> '${viewer}'::uuid) as other_participant_names,
          bool_or(tp.user_id = '${viewer}'::uuid and tp.left_at is null) as viewer_is_participant
        from public.msg_thread_participants tp
        join public.msg_users mu on mu.id = tp.user_id and mu.is_active = true
        group by tp.thread_id
      ),
      user_visibility as (
        select v.thread_id, max(v.hidden_before) as hidden_before, max(v.updated_at) as updated_at
        from public.msg_thread_visibility v
        where v.user_id = '${viewer}'::uuid
          and v.device_identifier is null
        group by v.thread_id
      ),
      last_messages as (
        select distinct on (m.thread_id)
          m.thread_id,
          m.id as last_message_id,
          coalesce(m.sent_at, m.created_at) as last_message_at,
          m.body as last_message_body,
          m.message_type as last_message_type,
          m.metadata_json as last_message_metadata_json,
          sender.display_name as last_sender_name
        from public.msg_messages m
        left join public.msg_users sender on sender.id = m.sender_user_id
        left join user_visibility vis on vis.thread_id = m.thread_id
        where m.is_deleted = false
          and coalesce(m.sent_at,m.created_at) > coalesce(vis.hidden_before,'-infinity'::timestamptz)
        order by m.thread_id, coalesce(m.sent_at, m.created_at) desc, m.created_at desc, m.id desc
      ),
      unread as (
        select
          m.thread_id,
          count(*)::int as unread_count
        from public.msg_messages m
        left join public.msg_receipts r on r.message_id = m.id and r.user_id = '${viewer}'::uuid
        left join user_visibility vis on vis.thread_id = m.thread_id
        where m.is_deleted = false
          and coalesce(m.sent_at,m.created_at) > coalesce(vis.hidden_before,'-infinity'::timestamptz)
          and m.sender_user_id is distinct from '${viewer}'::uuid
          and r.read_at is null
        group by m.thread_id
      )
      select
        t.id as thread_id,
        t.updated_at,
        t.thread_type,
        t.system_key,
        (t.system_key = 'ops_manager_shared_chat_v1') as is_ops_manager_shared,
        false as is_custodial_team,
        case
          when t.thread_type = 'bot' then coalesce(nullif(t.title, ''), 'Memphis')
          when t.thread_type = 'direct' then coalesce(nullif(tp.other_participant_names, ''), nullif(tp.participant_names, ''), 'Direct')
          else case
            when nullif(t.title, '') is not null then t.title
            else coalesce(nullif(tp.participant_names, ''), 'Group')
          end
        end as thread_title,
        ${unreadSelect} as unread_count,
        lm.last_message_at,
        lm.last_message_id,
        lm.last_sender_name,
        lm.last_message_body,
        lm.last_message_type,
        lm.last_message_metadata_json,
        coalesce(tp.participant_names, '') as participant_names,
        tp.viewer_is_participant as viewer_can_send
      from public.msg_threads t
      join thread_participants tp on tp.thread_id = t.id
      left join last_messages lm on lm.thread_id = t.id
      left join unread u on u.thread_id = t.id
      left join user_visibility vis on vis.thread_id = t.id
      where t.is_active = true
        and ${visibilityClause}
        and (vis.hidden_before is null or lm.last_message_id is not null)
      order by
        case
          when t.system_key = 'ops_manager_shared_chat_v1' then 0
          else 1
        end,
        coalesce(lm.last_message_at, t.last_message_at, t.updated_at, t.created_at) desc nulls last,
        t.created_at desc
      ) thread_rows
    `;
  }

  function buildThreadChangesSql({ viewerUserId = "", deviceIdentifier = "", managerOverview = false, after, afterId, limit = 100 }) {
    const viewer = esc(viewerUserId);
    const device = esc(deviceIdentifier);
    const cursorTime = esc(after);
    const cursorId = esc(afterId);
    const visibilityClause = managerOverview
      ? "true"
      : `(
          exists (
            select 1 from public.msg_thread_participants tp
            where tp.thread_id = t.id
              and tp.user_id = '${viewer}'::uuid
              and tp.left_at is null
          )
          or exists (
            select 1 from public.msg_thread_visibility v
            where v.thread_id = t.id
              and v.user_id = '${viewer}'::uuid
              and v.device_identifier is null
          )
        )`;
    return `
      select thread_id, changed_at
      from (
        select
          t.id as thread_id,
          greatest(
            t.created_at,
            t.updated_at,
            coalesce(t.last_message_at, t.created_at),
            coalesce((
              select max(greatest(coalesce(r.delivered_at, r.queued_at), coalesce(r.read_at, r.queued_at), coalesce(r.acknowledged_at, r.queued_at)))
              from public.msg_receipts r
              join public.msg_messages rm on rm.id = r.message_id
              where rm.thread_id = t.id
                and r.user_id = '${viewer}'::uuid
            ), t.created_at),
            coalesce((
              select max(v.updated_at)
              from public.msg_thread_visibility v
              where v.thread_id=t.id
                and v.user_id='${viewer}'::uuid
                and v.device_identifier is null
            ),t.created_at)
          ) as changed_at
        from public.msg_threads t
        where (t.is_active = true or t.deleted_at is not null)
          and ${visibilityClause}
      ) visible_threads
      where (changed_at, thread_id) > ('${cursorTime}'::timestamptz, '${cursorId}'::uuid)
      order by changed_at asc, thread_id asc
      limit ${Math.min(Math.max(Number(limit) || 100, 1), 200)}
    `;
  }

  function buildThreadMessagesSql({ threadId = "", viewerUserId = "", managerOverview = false, before = null, beforeId = null, limit = 100 }) {
    const viewer = esc(viewerUserId);
    const thread = esc(threadId);
    const normalizedBefore = before ? esc(String(before).trim()) : "";
    const normalizedBeforeId = beforeId ? esc(String(beforeId).trim()) : "";
    const beforeSql = normalizedBefore
      ? normalizedBeforeId
        ? `and (coalesce(m.sent_at, m.created_at), m.id) < ('${normalizedBefore}'::timestamptz, '${normalizedBeforeId}'::uuid)`
        : `and coalesce(m.sent_at, m.created_at) < '${normalizedBefore}'::timestamptz`
      : "";
    const visibilityClause = managerOverview
      ? "true"
      : "exists (select 1 from public.msg_thread_participants tp where tp.thread_id = t.id and tp.user_id = '" + viewer + "'::uuid and tp.left_at is null)";
    return `
      select * from (
      select * from (
      select
        m.id,
        m.thread_id,
        m.sender_user_id,
        sender.display_name as sender_display_name,
        m.message_type,
        m.body,
        m.metadata_json,
        m.sent_at,
        m.created_at,
        m.updated_at,
        m.is_deleted
      from public.msg_messages m
      join public.msg_threads t on t.id = m.thread_id
      left join public.msg_users sender on sender.id = m.sender_user_id
      where m.thread_id = '${thread}'::uuid
        and (t.is_active = true or t.deleted_at is not null)
        and m.is_deleted is false
        and ${visibilityClause}
        and coalesce(m.sent_at,m.created_at) > coalesce((
          select max(v.hidden_before)
          from public.msg_thread_visibility v
          where v.thread_id=t.id
            and v.user_id='${viewer}'::uuid
            and v.device_identifier is null
        ),'-infinity'::timestamptz)
        ${beforeSql}
      order by coalesce(m.sent_at, m.created_at) desc, m.id desc
      limit ${Math.min(Math.max(Number(limit) || 100, 1), 200)}
      ) newest_page
      order by coalesce(sent_at, created_at) asc, id asc
      ) thread_messages
    `;
  }

  function buildThreadUpdatesSql({ threadId = "", viewerUserId = "", managerOverview = false, after, afterId, limit = 100 }) {
    const viewer = esc(viewerUserId);
    const thread = esc(threadId);
    const cursorTime = esc(after);
    const cursorId = esc(afterId);
    const visibilityClause = managerOverview
      ? "true"
      : "exists (select 1 from public.msg_thread_participants tp where tp.thread_id = t.id and tp.user_id = '" + viewer + "'::uuid and tp.left_at is null)";
    return `
      select * from (
      select
        m.id,
        m.thread_id,
        m.sender_user_id,
        sender.display_name as sender_display_name,
        m.message_type,
        m.body,
        m.metadata_json,
        m.sent_at,
        m.created_at,
        m.updated_at,
        m.is_deleted
      from public.msg_messages m
      join public.msg_threads t on t.id = m.thread_id
      left join public.msg_users sender on sender.id = m.sender_user_id
      where m.thread_id = '${thread}'::uuid
        and (t.is_active = true or t.deleted_at is not null)
        and ${visibilityClause}
        and coalesce(m.sent_at,m.created_at) > coalesce((
          select max(v.hidden_before)
          from public.msg_thread_visibility v
          where v.thread_id=t.id
            and v.user_id='${viewer}'::uuid
            and v.device_identifier is null
        ),'-infinity'::timestamptz)
        and (m.updated_at, m.id) > ('${cursorTime}'::timestamptz, '${cursorId}'::uuid)
      order by m.updated_at asc, m.id asc
      limit ${Math.min(Math.max(Number(limit) || 100, 1), 200)}
      ) thread_updates
    `;
  }

  function isDirectContactPrompt(body = "") {
    const raw = String(body || "").trim();
    const lower = raw.toLowerCase().replace(/[^a-z0-9\s']/g, " " ).replace(/\s+/g, " " ).trim();
    return /\b(phone|number|contact|call|text|reach)\b/.test(lower)
      && /\b(eric|operle|mckenneys?|mckinneys?|mcken+e+y?s?|brandy|gull|haley|lejman|jennifer|sheffield|manager|director|facilities|custodial|horticulture|water quality)\b/.test(lower);
  }

  function scoreContactPrompt(body = "", contact = {}) {
    const lower = String(body || "").toLowerCase().replace(/[^a-z0-9\s]/g, " " ).replace(/\s+/g, " " ).trim();
    const haystack = `${contact.display_name || ""} ${contact.role_title || ""} ${contact.department || ""}`.toLowerCase();
    let score = 0;
    for (const token of lower.split(/\s+/).filter((x) => x.length >= 3 && !["phone","number","contact","call","text","reach","need","please","give"].includes(x))) {
      if (haystack.includes(token)) score += 50 + token.length;
      if (/^mck/.test(token) && haystack.includes("mckenney")) score += 130;
      if (/^oper/.test(token) && haystack.includes("operle")) score += 130;
    }
    if (lower.includes("facilities") && haystack.includes("facilities")) score += 180;
    if (lower.includes("custodial") && haystack.includes("custodial")) score += 180;
    return score;
  }

  function summarizeDirectContact(contact = {}, includePhone = true) {
    const parts = [`${contact.display_name}: ${contact.role_title}`];
    if (contact.department) parts.push(contact.department);
    if (includePhone && contact.phone) parts.push(`phone ${contact.phone}`);
    else if (includePhone) parts.push("phone not listed");
    return parts.join(". " ) + ".";
  }

  async function directContactReply(body = "") {
    if (!isDirectContactPrompt(body)) return null;
    const contacts = await runReadOnlySql(`
      select display_name, role_title, department, phone, active, sort_order
      from public.internal_ops_contacts
      where active = true
      order by sort_order asc, display_name asc
    `);
    const ranked = (Array.isArray(contacts) ? contacts : [])
      .map((contact) => ({ contact, score: scoreContactPrompt(body, contact) }))
      .sort((a, b) => b.score - a.score || Number(a.contact.sort_order || 999) - Number(b.contact.sort_order || 999));
    const best = ranked[0];
    if (best && best.score >= 70) return summarizeDirectContact(best.contact, true);
    if (/\b(manager|managers|director|contact|phone|number)\b/i.test(String(body || ""))) {
      return ranked.slice(0, 6).map((row) => summarizeDirectContact(row.contact, true)).join(" " );
    }
    return null;
  }

  function isCapabilityPrompt(body) {
    const raw = String(body || "").trim().toLowerCase().replace(/[^a-z0-9\s']/g, " ").replace(/\s+/g, " ");
    return /\b(what can you do|what do you do|help|commands|features|abilities|capabilities|how can you help)\b/.test(raw);
  }

  function buildCapabilityReply() {
    return [
      "I am Memphis, the Memphis Zoo operations assistant.",
      "I can help with Memphis Zoo operations using local system data first.",
      "Ask me about staffing, schedules, who is working, where someone is assigned, your own schedule from this device, open areas, coverage candidates, upcoming events, attendance, open maintenance tickets, location details, current owner, scan state, manager schedules, and internal contacts.",
      "Try: 'Who has Aquarium today?', 'Where is Tammy assigned?', 'What is my schedule tomorrow?', 'Who can cover Aquarium?', 'Any open tickets at Teton?', or 'What events are coming up?'"
    ].join(" ");
  }

  function isZooRelatedPrompt(body) {
    return /\b(memphis zoo|zoo|animal|animals|keeper|keepers|exhibit|habitat|guest|guests|visitor|visitors|attendance|event|events|maintenance|custodial|facilities|operations|ops|aquarium|teton|zambezi|primate|pavilion|herpetarium|cat house|nocturnal|komodo|bonobo)\b/i.test(String(body || ""));
  }

  function augmentPromptForZooInfoGuardrails(body) {
    const raw = String(body || "").trim();
    if (!raw || !isZooRelatedPrompt(raw)) return raw;
    const priorYear = Math.max(2025, new Date().getFullYear() - 1);
    return `${raw}\n\nInternal Memphis instruction: This is zoo-related. Prefer local Memphis system data over general model knowledge. If answering with Gemini/general knowledge instead of local records, do not rely on web/current information newer than ${priorYear}. For anything that could have changed after ${priorYear}, say it may need verification in the local system or by a manager.`;
  }

  function normalizeMemphisPromptForLocalRouting(body) {
    const raw = String(body || "").trim();
    if (!raw) return raw;

    const alreadySelfSchedule = /\b(my schedule|what am i assigned|what am i doing today)\b/i.test(raw);
    if (alreadySelfSchedule) return raw;

    const asksSelfSchedule = /\b(when do i work|when am i working|when am i in|am i working|do i work|what'?s my shift|what is my shift|my shift|where am i|where do i go|where should i go|what area am i|which area am i|what areas am i|which areas am i|what am i doing|where am i assigned|who do i have|what do i have today)\b/i.test(raw);
    const hasDateOrScheduleContext = /\b(today|tomorrow|tonight|tonite|this morning|this afternoon|sunday|monday|tuesday|wednesday|thursday|friday|saturday|schedule|shift|assigned|assignment|area|areas|work|working)\b/i.test(raw);

    if (asksSelfSchedule || (/\b(i|me|my)\b/i.test(raw) && hasDateOrScheduleContext && /\b(work|working|shift|schedule|assigned|assignment|area|areas)\b/i.test(raw))) {
      return `my schedule: ${raw}`;
    }

    return raw;
  }

  async function buildMemphisReply({ userId = "", deviceId = "", threadId = "", body = "" } = {}) {
    try {
      const directContact = await directContactReply(body);
      if (directContact) {
        return {
          reply: { text: directContact, meta: { fallback: true, mode: "direct_internal_contact" } },
          routedBody: body,
        };
      }
      if (isCapabilityPrompt(body)) {
        return {
          reply: { text: buildCapabilityReply(), meta: { fallback: true, mode: "local_capability_reply" } },
          routedBody: body,
        };
      }
      const routedBody = normalizeMemphisPromptForLocalRouting(body);
      let reply = await memphisResponder.generateReply({ userId, deviceId, threadId, userMessage: routedBody });
      if (routedBody !== body) {
        reply = {
          ...reply,
          meta: {
            ...(reply?.meta && typeof reply.meta === "object" ? reply.meta : {}),
            routed_from: body,
            routing_hint: "self_schedule",
          },
        };
      }
      return { reply, routedBody };
    } catch (error) {
      console.error("memphis ai reply failed:", error);
      return {
        reply: {
          text: `Memphis hit an internal error while answering that. ${error?.message || "Unknown error."}`,
          meta: { fallback: true, error: error?.message || "unknown_error", diagnostics: getGeminiDiagnosticsForMessaging() },
        },
        routedBody: body,
      };
    }
  }

  async function sendMemphisConversationMessage({
    userId = "",
    deviceId = "",
    body = "",
    clientMessageId = "",
    threadId = "",
    managerId = "",
  } = {}) {
    const normalizedUserId = String(userId || "").trim();
    const normalizedDeviceId = String(deviceId || "").trim();
    const normalizedBody = String(body || "").trim();
    const normalizedClientMessageId = String(clientMessageId || "").trim();
    if (!normalizedUserId) throw new Error("user_id is required.");
    if (!normalizedDeviceId) throw new Error("device_id is required.");
    if (!normalizedBody) throw new Error("body is required.");

    const canonicalThread = await runRpc("msg_get_or_create_memphis_thread", { p_user_id: normalizedUserId });
    let thread = canonicalThread;
    const requestedThreadId = String(threadId || "").trim();
    if (requestedThreadId) {
      const requestedThread = await getThreadIdentity(requestedThreadId);
      if (!requestedThread || requestedThread.is_active === false || !isMemphisThread(requestedThread)) {
        throw new Error("The requested thread is not an active Memphis conversation.");
      }
      const isParticipant = await isThreadParticipant(requestedThreadId, normalizedUserId);
      if (!isParticipant) throw new Error("The sender is not a participant in this Memphis conversation.");
      thread = requestedThread;
    }

    const normalizedManagerId = String(managerId || "").trim();
    const messageArgs = {
      p_thread_id: thread.id,
      p_body: normalizedBody,
      p_message_type: "text",
      p_metadata_json: {
        channel: "memphis",
        device_id: normalizedDeviceId,
        ...(normalizedClientMessageId ? { client_message_id: normalizedClientMessageId } : {}),
      },
      p_client_message_id: normalizedClientMessageId || null,
    };
    const userMessage = normalizedManagerId
      ? await runRpc("msg_send_message_as_ops_manager", {
        ...messageArgs,
        p_manager_id: normalizedManagerId,
      })
      : await runRpc("msg_send_message", {
        ...messageArgs,
        p_sender_user_id: normalizedUserId,
      });

    const replyKey = `memphis-reply:${userMessage?.id || normalizedClientMessageId || thread.id}`;
    const claim = await runRpc("claim_operational_notification_job_by_key", {
      p_job_key: replyKey,
      p_worker_id: `messaging-request-${process.pid}-${randomUUID()}`,
      p_lease_seconds: 120,
    });
    const claimedJob = Array.isArray(claim) ? claim[0] : claim;
    let botMessage = null;
    let botPending = false;
    if (claimedJob?.job_id) {
      try {
        const result = await processMemphisBotReplyJob(claimedJob);
        botMessage = result?.bot_message || null;
        await runRpc("finish_operational_notification_job", {
          p_job_id: claimedJob.job_id,
          p_lease_token: claimedJob.lease_token,
          p_succeeded: true,
          p_error: null,
          p_retry_seconds: 30,
        });
      } catch (error) {
        await runRpc("finish_operational_notification_job", {
          p_job_id: claimedJob.job_id,
          p_lease_token: claimedJob.lease_token,
          p_succeeded: false,
          p_error: String(error?.message || "Memphis reply failed").slice(0, 2000),
          p_retry_seconds: 30,
        }).catch(() => {});
        botPending = true;
      }
    } else {
      botMessage = await findMemphisBotMessage(replyKey);
      botPending = !botMessage;
    }

    return { thread, user_message: userMessage, bot_message: botMessage, bot_pending: botPending };
  }

  async function findMemphisBotMessage(replyKey) {
    const rows = await runReadOnlySql(`
      select id, thread_id, sender_user_id, message_type, body, metadata_json,
             client_message_id, sent_at, created_at
      from public.msg_messages
      where client_message_id = '${esc(replyKey)}'
        and is_deleted is false
      limit 1
    `);
    return Array.isArray(rows) && rows.length ? rows[0] : null;
  }

  async function processMemphisBotReplyJob(job = {}) {
    const sourceMessageId = String(job.source_id || job.payload_json?.message_id || "").trim();
    if (!isUuid(sourceMessageId)) throw new Error("Memphis background job is missing its source message.");
    const sourceRows = await runReadOnlySql(`
      select m.id, m.thread_id, m.sender_user_id, m.body, m.metadata_json,
             coalesce(m.metadata_json->>'device_id','') as device_id
      from public.msg_messages m
      where m.id = '${esc(sourceMessageId)}'::uuid
        and m.is_deleted is false
      limit 1
    `);
    const source = Array.isArray(sourceRows) && sourceRows.length ? sourceRows[0] : null;
    if (!source) throw new Error("Memphis source message no longer exists.");
    const replyKey = `memphis-reply:${source.id}`;
    const existing = await findMemphisBotMessage(replyKey);
    if (existing) return { bot_message: existing, replayed: true };

    const memphisRows = await runReadOnlySql("select public.msg_get_memphis_user_id() as memphis_user_id");
    const memphisUserId = Array.isArray(memphisRows) && memphisRows.length ? memphisRows[0].memphis_user_id : null;
    if (!isUuid(memphisUserId)) throw new Error("Memphis bot identity not found.");
    const { reply } = await buildMemphisReply({
      userId: source.sender_user_id,
      deviceId: source.device_id,
      threadId: source.thread_id,
      body: source.body,
    });
    const botMessage = await runRpc("msg_send_message", {
      p_thread_id: source.thread_id,
      p_sender_user_id: memphisUserId,
      p_body: String(reply?.text || "Memphis could not produce an answer."),
      p_message_type: "bot_response",
      p_metadata_json: {
        channel: "memphis",
        ai: true,
        client_message_id: replyKey,
        reply_to_message_id: source.id,
        ...(reply?.meta && typeof reply.meta === "object" ? reply.meta : {}),
      },
      p_client_message_id: replyKey,
    });
    return { bot_message: botMessage, replayed: false };
  }

  if (typeof registerOperationalJobHandler === "function") {
    registerOperationalJobHandler("memphis_bot_reply", processMemphisBotReplyJob);
  }

  router.get("/health", (_req, res) => {
    res.status(200).json(buildHealthPayload("messaging", { contract_version: contractVersion, memphis: getGeminiDiagnosticsForMessaging() }));
  });

  router.get("/memphis/admin/runtime", retiredGeminiAdminRoute, async (req, res) => {
    try {
      res.status(200).json({
        ok: true,
        data: {
          runtime: buildHealthPayload("messaging_admin_runtime", {
            authenticated: true,
            contract_version: contractVersion,
            memphis: getGeminiDiagnosticsForMessaging(),
          }),
          auth: req.memphisAuth || null,
          admin_route: {
            path: "/messaging-api/memphis/admin/run",
            audit_path: "/messaging-api/memphis/admin/audit",
            diagnose_path: "/messaging-api/memphis/admin/diagnose",
            available: true,
            auth_required: true,
            read_only_default: true,
            fallback_routes: ["/messaging-api/memphis/message", "/messaging-api/memphis/diagnose"],
          },
        },
        meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion },
      });
    } catch (error) {
      fail(res, error, "Memphis admin runtime failed");
    }
  });

  router.get("/me/by-device", requireDeviceOrOpsAuth, async (req, res) => {
    try {
      const deviceId = String(req.query.device_id || "").trim();
      if (!deviceId && !req.memphisAuth) throw new Error("device_id is required.");
      const data = req.memphisMessagingManager?.identity || req.memphisMessagingDevice?.identity || await getViewerIdentity(deviceId);
      res.status(200).json({ ok: true, data, meta: messagingMeta() });
    } catch (error) {
      fail(res, error, "Device identity lookup failed");
    }
  });

  router.get("/users", requireDeviceOrOpsAuth, async (req, res) => {
    try {
      const requestedUserId = String(req.query.user_id || "").trim();
      const deviceId = String(req.query.device_id || req.header("x-device-id") || "").trim();
      const viewer = await resolveViewerContext({ userId: requestedUserId, deviceId, managerSession: req.memphisAuth || null });
      const baseRows = await runReadOnlySql(`select * from public.msg_list_users('${esc(viewer.effectiveUserId)}'::uuid)`);
      const rows = await enrichMessagingUsers(baseRows);
      res.status(200).json({ ok: true, data: rows, meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion } });
    } catch (error) {
      fail(res, error, "Messaging users failed");
    }
  });

  router.get("/threads", requireDeviceOrOpsAuth, async (req, res) => {
    try {
      const userId = String(req.query.user_id || "").trim();
      const deviceId = String(req.query.device_id || "").trim();
      const viewer = await resolveViewerContext({ userId, deviceId, managerSession: req.memphisAuth || null });
      const notificationState = deviceId && !req.memphisAuth ? await getDeviceNotificationState(deviceId) : null;
      const suppressedNotificationState = notificationState ? phoneSuppressedNotificationState(notificationState) : null;
      const suppressUnreadForPhone = deviceId && !req.memphisAuth && shouldSuppressPhoneNotificationPayloads(notificationState);
      const canonicalViewerDevice = String(viewer.identity?.canonical_device_id || viewer.deviceId || deviceId).trim();
      const sql = buildThreadListSql({
        viewerUserId: viewer.effectiveUserId,
        deviceIdentifier: canonicalViewerDevice,
        managerOverview: viewer.isManagerOverview,
      });
      const rows = await runReadOnlySql(sql);
      const data = (Array.isArray(rows) ? rows : []).map((row) => suppressUnreadForPhone
        ? { ...row, unread_count: 0 }
        : row);
      res.status(200).json({ ok: true, data, meta: messagingMeta(suppressedNotificationState ? notificationStateMeta(suppressedNotificationState) : {}) });
    } catch (error) {
      fail(res, error, "Thread list failed");
    }
  });

  router.get("/threads/updates", requireDeviceOrOpsAuth, async (req, res) => {
    const startedAt = Date.now();
    let clientGone = false;
    const markGone = () => { clientGone = true; };
    req.once("aborted", markGone);
    res.once("close", markGone);
    try {
      const userId = String(req.query.user_id || "").trim();
      const deviceId = String(req.query.device_id || "").trim();
      const after = String(req.query.after || "").trim();
      const afterId = String(req.query.after_id || "").trim();
      const requestSequence = Math.max(0, Number.parseInt(String(req.query.request_seq || "0"), 10) || 0);
      const waitMs = Math.min(Math.max(Number.parseInt(String(req.query.wait_ms || "20000"), 10) || 20000, 0), 25000);
      const limit = Math.min(Math.max(Number.parseInt(String(req.query.limit || "100"), 10) || 100, 1), 200);
      if (!after || Number.isNaN(Date.parse(after))) throw Object.assign(new Error("A valid server thread cursor is required."), { status: 422 });
      if (!isUuid(afterId)) throw Object.assign(new Error("A valid cursor thread id is required."), { status: 422 });
      const viewer = await resolveViewerContext({ userId, deviceId, managerSession: req.memphisAuth || null });
      const canonicalViewerDevice = String(viewer.identity?.canonical_device_id || viewer.deviceId || deviceId).trim();
      let rows = [];
      do {
        rows = await runReadOnlySql(buildThreadChangesSql({
          viewerUserId: viewer.effectiveUserId,
          deviceIdentifier: canonicalViewerDevice,
          managerOverview: viewer.isManagerOverview,
          after,
          afterId,
          limit,
        }));
        if ((Array.isArray(rows) && rows.length) || clientGone || Date.now() - startedAt >= waitMs) break;
        await waitFor(Math.min(1000, Math.max(100, waitMs - (Date.now() - startedAt))));
      } while (!clientGone);
      if (clientGone || res.headersSent) return;
      const data = Array.isArray(rows) ? rows : [];
      const last = data[data.length - 1] || null;
      res.status(200).json({
        ok: true,
        data,
        meta: messagingMeta({
          transport: "cursor_long_poll",
          request_sequence: requestSequence,
          waited_ms: Date.now() - startedAt,
          has_more: data.length >= limit,
          next_cursor: last
            ? { after: last.changed_at, after_id: last.thread_id }
            : { after, after_id: afterId },
        }),
      });
    } catch (error) {
      if (clientGone || res.headersSent) return;
      res.status(error?.status || 400).json({ ok: false, error: error?.message || "Thread updates failed" });
    } finally {
      req.off("aborted", markGone);
      res.off("close", markGone);
    }
  });

  router.get("/device-event-reminders", requireDeviceOrOpsAuth, async (_req, res) => {
    res.status(200).json({
      ok: true,
      data: [],
      meta: messagingMeta({
        retired: true,
        delivery: "native_employee_push_only",
        messenger_coupling: false,
      }),
    });
  });

  router.get("/device-location-status-reminders", requireDeviceOrOpsAuth, async (req, res) => {
    try {
      const deviceId = String(req.query.device_id || "").trim();
      const limit = Math.min(Math.max(Number.parseInt(String(req.query.limit || 5), 10) || 5, 1), 20);
      if (!deviceId) throw new Error("device_id is required.");

      const assignment = await getAssignedEmployeeForDevice(deviceId);
      const canonicalDeviceId = String(assignment?.canonical_device_id || assignment?.device_id || deviceId).trim();
      if (!assignment || !assignment.device_active) {
        res.status(404).json({ ok: false, error: "Active device assignment not found." });
        return;
      }
      if (!assignment.assigned_employee_id || !assignment.employee_active) {
        res.status(404).json({ ok: false, error: "This device is not assigned to an active employee." });
        return;
      }

      const serviceDate = String(req.query.service_date || req.query.date || "").trim() || await getServiceDate();
      if (!serviceDate) throw new Error("service_date could not be resolved.");
      const notificationState = await getDeviceNotificationState(canonicalDeviceId, { serviceDate, employeeId: assignment.assigned_employee_id });
      if (idsDiffer(notificationState?.employee_id, assignment.assigned_employee_id)) {
        const mismatchState = forceSilentNotificationState(notificationState, "device_assignment_mismatch");
        res.status(200).json({ ok: true, data: [], meta: messagingMeta(notificationStateMeta(mismatchState)) });
        return;
      }
      if (shouldSilenceDeviceNotifications(notificationState)) {
        res.status(200).json({ ok: true, data: [], meta: messagingMeta(notificationStateMeta(notificationState)) });
        return;
      }

      const rows = await runReadOnlySql(`
        select * from (
          with assigned_groups as (
            select distinct
              s.location_group_id,
              s.group_code,
              s.group_name,
              coalesce(s.coverage_purpose, 'area_owner') as coverage_purpose
            from public.sch_get_daily_schedule_with_purpose('${esc(serviceDate)}'::date) s
            where s.assigned_employee_id = '${esc(assignment.assigned_employee_id)}'::uuid
              and coalesce(s.coverage_purpose, 'area_owner') <> 'reminder'
          ),
          assigned_locations as (
            select distinct on (l.id)
              ag.location_group_id,
              ag.group_code,
              ag.group_name,
              ag.coverage_purpose,
              l.id as location_id,
              l.location_code,
              l.location_name,
              l.form_type
            from assigned_groups ag
            join public.location_group_memberships lgm
              on lgm.location_group_id = ag.location_group_id
             and lgm.active = true
            join public.locations l
              on l.id = lgm.location_id
             and l.active = true
            order by l.id, ag.group_name, ag.group_code
          )
          select
            '${esc(serviceDate)}'::date as service_date,
            '${esc(canonicalDeviceId)}'::text as device_id,
            ${assignment.device_name ? `'${esc(assignment.device_name)}'::text` : 'null::text'} as device_name,
            '${esc(assignment.assigned_employee_id)}'::uuid as employee_id,
            ${assignment.assigned_employee_name ? `'${esc(assignment.assigned_employee_name)}'::text` : 'null::text'} as employee_name,
            ${assignment.employee_code ? `'${esc(assignment.employee_code)}'::text` : 'null::text'} as employee_code,
            al.location_group_id,
            al.group_code,
            al.group_name,
            al.coverage_purpose,
            al.location_id,
            al.location_code,
            al.location_name,
            al.form_type,
            v.status_code,
            v.status_color,
            v.latest_completed_at,
            v.latest_completed_at_display,
            v.open_session_status,
            v.open_session_started_at,
            v.open_session_started_at_display,
            v.open_session_employee_name,
            v.duration_display,
            v.services_performed,
            v.open_ticket_count,
            v.last_scan_at,
            v.last_scan_at_display,
            ('location-status:' || '${esc(serviceDate)}' || ':' || al.location_id::text || ':' || v.status_code || ':' || coalesce(to_char(v.latest_completed_at at time zone 'UTC','YYYYMMDDHH24MISSUS'),'never')) as notification_key
          from assigned_locations al
          join public.v_location_dashboard_status v on v.location_id = al.location_id
          where v.status_code in ('overdue', 'due_soon')
            and not exists (
              select 1
              from public.device_notification_acknowledgements a
              where upper(btrim(a.device_identifier)) = upper(btrim('${esc(canonicalDeviceId)}'))
                and a.notification_key = ('location-status:' || '${esc(serviceDate)}' || ':' || al.location_id::text || ':' || v.status_code || ':' || coalesce(to_char(v.latest_completed_at at time zone 'UTC','YYYYMMDDHH24MISSUS'),'never'))
                and a.acknowledged_at is not null
            )
          order by
            case when v.status_code = 'overdue' then 0 else 1 end,
            case when al.form_type = 'restroom' then 0 else 1 end,
            al.location_name asc
          limit ${limit}
        ) reminder_rows
      `);
      res.status(200).json({ ok: true, data: rows || [], meta: messagingMeta(notificationStateMeta(notificationState)) });
    } catch (error) {
      fail(res, error, "Device location status reminders failed");
    }
  });

  router.post("/device-notifications/ack", requireWritableDeviceOrOpsAuth, async (req, res) => {
    try {
      if (req.memphisAuth) {
        res.status(403).json({ ok: false, error: "Manager sessions cannot acknowledge an employee device notification." });
        return;
      }
      const requestedDeviceId = String(req.body?.device_id || req.body?.deviceId || req.header("x-device-id") || "").trim();
      const notificationKey = String(req.body?.notification_key || req.body?.notificationKey || "").trim();
      const notificationType = String(req.body?.notification_type || req.body?.notificationType || "notification").trim().toLowerCase();
      const action = String(req.body?.action || "dismissed").trim().toLowerCase();
      if (!requestedDeviceId) throw new Error("device_id is required.");
      if (!notificationKey || notificationKey.length > 500) throw new Error("notification_key is required and must be at most 500 characters.");
      if (!['displayed','dismissed','opened','acknowledged'].includes(action)) throw new Error("action must be displayed, dismissed, opened, or acknowledged.");
      const device = await getAssignedEmployeeForDevice(requestedDeviceId);
      if (!device || !device.device_active) throw new Error("Active device assignment not found.");
      const canonicalDeviceId = String(device.canonical_device_id || device.device_id).trim();
      const metadata = req.body?.metadata && typeof req.body.metadata === 'object' && !Array.isArray(req.body.metadata)
        ? req.body.metadata
        : {};
      const data = await runRpc("ack_device_notification", {
        p_device_identifier: canonicalDeviceId,
        p_notification_key: notificationKey,
        p_notification_type: notificationType,
        p_action: action,
        p_metadata_json: metadata,
      });
      if (notificationType === 'event' && req.body?.message_id && device.assigned_employee_id) {
        const viewer = await getViewerIdentity(canonicalDeviceId);
        if (viewer?.msg_user_id) {
          await runRpc("msg_acknowledge_message", {
            p_message_id: String(req.body.message_id),
            p_user_id: viewer.msg_user_id,
            p_device_identifier: canonicalDeviceId,
          });
        }
      }
      res.status(200).json({ ok: true, data, meta: messagingMeta() });
    } catch (error) {
      fail(res, error, "Device notification acknowledgement failed");
    }
  });

  // Cursor-based incremental reconciliation is the authoritative live-update
  // path. It uses the same authenticated viewer boundary as the full message
  // page, returns stable (created_at, id) ordering, and holds an empty request
  // briefly so clients do not need blind two-second polling.
  router.get("/thread/:threadId/updates", requireDeviceOrOpsAuth, async (req, res) => {
    const startedAt = Date.now();
    let clientGone = false;
    const markGone = () => { clientGone = true; };
    req.once("aborted", markGone);
    res.once("close", markGone);
    try {
      const threadId = String(req.params.threadId || "").trim();
      const userId = String(req.query.user_id || "").trim();
      const deviceId = String(req.query.device_id || "").trim();
      const after = String(req.query.after || "").trim();
      const afterId = String(req.query.after_id || "").trim();
      const requestSequence = Math.max(0, Number.parseInt(String(req.query.request_seq || "0"), 10) || 0);
      const waitMs = Math.min(Math.max(Number.parseInt(String(req.query.wait_ms || "20000"), 10) || 20000, 0), 25000);
      const limit = Math.min(Math.max(Number.parseInt(String(req.query.limit || "100"), 10) || 100, 1), 200);
      if (!isUuid(threadId)) throw Object.assign(new Error("A valid thread id is required."), { status: 422 });
      if (!after || Number.isNaN(Date.parse(after))) throw Object.assign(new Error("A valid server message cursor is required."), { status: 422 });
      if (!isUuid(afterId)) throw Object.assign(new Error("A valid cursor message id is required."), { status: 422 });
      const viewer = await resolveViewerContext({ userId, deviceId, managerSession: req.memphisAuth || null });
      let rows = [];
      do {
        rows = await runReadOnlySql(buildThreadUpdatesSql({
          threadId,
          viewerUserId: viewer.effectiveUserId,
          managerOverview: viewer.isManagerOverview,
          after,
          afterId,
          limit,
        }));
        if ((Array.isArray(rows) && rows.length) || clientGone || Date.now() - startedAt >= waitMs) break;
        await waitFor(Math.min(1000, Math.max(100, waitMs - (Date.now() - startedAt))));
      } while (!clientGone);
      if (clientGone || res.headersSent) return;
      const data = Array.isArray(rows) ? rows : [];
      const last = data[data.length - 1] || null;
      res.status(200).json({
        ok: true,
        data,
        meta: messagingMeta({
          transport: "cursor_long_poll",
          request_sequence: requestSequence,
          waited_ms: Date.now() - startedAt,
          has_more: data.length >= limit,
          next_cursor: last ? {
            after: last.updated_at || last.sent_at || last.created_at,
            after_id: last.id,
          } : { after, after_id: afterId },
        }),
      });
    } catch (error) {
      if (clientGone || res.headersSent) return;
      res.status(error?.status || 400).json({ ok: false, error: error?.message || "Thread updates failed" });
    } finally {
      req.off("aborted", markGone);
      res.off("close", markGone);
    }
  });

  router.get("/thread/:threadId/messages", requireDeviceOrOpsAuth, async (req, res) => {
    try {
      const threadId = String(req.params.threadId || "").trim();
      const userId = String(req.query.user_id || "").trim();
      const deviceId = String(req.query.device_id || "").trim();
      const limit = Number.parseInt(String(req.query.limit || 100), 10) || 100;
      const before = req.query.before ? String(req.query.before).trim() : "";
      const beforeId = req.query.before_id ? String(req.query.before_id).trim() : "";
      const viewer = await resolveViewerContext({ userId, deviceId, managerSession: req.memphisAuth || null });
      const rows = await runReadOnlySql(buildThreadMessagesSql({ threadId, viewerUserId: viewer.effectiveUserId, managerOverview: viewer.isManagerOverview, before, beforeId, limit }));
      res.status(200).json({ ok: true, data: rows || [], meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion } });
    } catch (error) {
      fail(res, error, "Thread messages failed");
    }
  });

  router.post("/thread/direct", requireWritableDeviceOrOpsAuth, async (req, res) => {
    try {
      const createdByUserId = String(req.body?.created_by_user_id || "").trim();
      const otherUserId = String(req.body?.other_user_id || "").trim();
      const deviceId = String(req.body?.device_id || "").trim();
      const viewer = await resolveViewerContext({ userId: createdByUserId, deviceId, managerSession: req.memphisAuth || null });
      if (!otherUserId) throw new Error("other_user_id is required.");
      if (viewer.effectiveUserId === otherUserId) throw new Error("Pick someone else to message.");
      const data = await runRpc("msg_get_or_create_direct_thread", { p_user_a: viewer.effectiveUserId, p_user_b: otherUserId });
      const thread = Array.isArray(data) ? data[0] : data;
      const threadId = String(thread?.id || thread?.thread_id || "").trim();
      if (!isUuid(threadId)) throw Object.assign(new Error("Direct conversation could not be resolved."), { status: 502 });
      res.status(200).json({ ok: true, data, meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion } });
    } catch (error) {
      fail(res, error, "Create direct thread failed");
    }
  });

  router.post("/thread/group", requireWritableDeviceOrOpsAuth, async (req, res) => {
    try {
      const createdByUserId = String(req.body?.created_by_user_id || "").trim();
      const deviceId = String(req.body?.device_id || "").trim();
      const title = req.body?.title == null ? null : String(req.body.title);
      const clientThreadId = String(req.body?.client_thread_id || req.body?.clientThreadId || "").trim();
      const memberUserIds = Array.isArray(req.body?.member_user_ids)
        ? req.body.member_user_ids.map((x) => String(x || "").trim()).filter(Boolean)
        : [];
      const viewer = await resolveViewerContext({ userId: createdByUserId, deviceId, managerSession: req.memphisAuth || null });
      const uniqueMembers = [...new Set(memberUserIds)];
      if (uniqueMembers.length < 2) throw Object.assign(new Error("Choose at least two people for a group conversation."), { status: 422 });
      if (uniqueMembers.length > 100) throw Object.assign(new Error("A group may contain at most 100 recipients."), { status: 422 });
      if (uniqueMembers.some((memberId) => !isUuid(memberId))) throw Object.assign(new Error("Every selected recipient must be valid."), { status: 422 });
      if (!clientThreadId || clientThreadId.length > 200) throw Object.assign(new Error("A stable group operation id is required."), { status: 422 });
      const data = await runRpc("msg_create_group_thread_v2", {
        p_created_by_user_id: viewer.effectiveUserId,
        p_title: title,
        p_member_user_ids: uniqueMembers,
        p_client_thread_id: clientThreadId,
      });
      res.status(200).json({ ok: true, data, meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion } });
    } catch (error) {
      fail(res, error, "Create group thread failed");
    }
  });

  router.post("/thread/team", requireWritableDeviceOrOpsAuth, async (req, res) => {
    res.status(410).json({
      ok: false,
      error: "The automatic Custodial Team room is retired. Select Everyone now creates an ordinary deletable group conversation.",
    });
  });

  router.post("/thread/:threadId/message", requireWritableDeviceOrOpsAuth, async (req, res) => {
    try {
      const threadId = String(req.params.threadId || "").trim();
      const senderUserId = String(req.body?.sender_user_id || "").trim();
      const body = String(req.body?.body || "");
      const messageType = String(req.body?.message_type || "text").trim() || "text";
      const metadataJson = req.body?.metadata_json && typeof req.body.metadata_json === "object" ? req.body.metadata_json : {};
      const clientMessageId = String(req.body?.client_message_id || req.body?.clientMessageId || metadataJson.client_message_id || "").trim();
      const deviceId = String(req.body?.device_id || req.body?.deviceId || "").trim();
      const viewer = await resolveViewerContext({ userId: senderUserId, deviceId, managerSession: req.memphisAuth || null });
      if (senderUserId && viewer.effectiveUserId !== senderUserId) {
        res.status(403).json({ ok: false, error: "Sender user ID must match the authenticated viewer." });
        return;
      }
      const isParticipant = await isThreadParticipant(threadId, viewer.effectiveUserId);
      if (!isParticipant && !viewer.isManagerOverview) {
        res.status(403).json({ ok: false, error: "Device's user is not a participant in this thread." });
        return;
      }
      const thread = await getThreadIdentity(threadId);
      if (!thread || thread.is_active === false) throw new Error("Active thread not found.");
      if (isMemphisThread(thread)) {
        const canonicalDeviceId = String(viewer.identity?.canonical_device_id || deviceId).trim();
        const data = await sendMemphisConversationMessage({
          userId: viewer.effectiveUserId,
          deviceId: canonicalDeviceId,
          body,
          clientMessageId,
          threadId,
          managerId: String(req.memphisAuth?.manager_id || "").trim(),
        });
        res.status(200).json({ ok: true, data, meta: messagingMeta({ responder: "memphis" }) });
        return;
      }
      const authoritativeMetadata = {
        ...metadataJson,
        ...(clientMessageId ? { client_message_id: clientMessageId } : {}),
      };
      delete authoritativeMetadata.authenticated_ops_manager_id;
      const data = req.memphisAuth
        ? await runRpc("msg_send_message_as_ops_manager", {
          p_manager_id: String(req.memphisAuth.manager_id || "").trim(),
          p_thread_id: threadId,
          p_body: body,
          p_message_type: messageType,
          p_metadata_json: authoritativeMetadata,
          p_client_message_id: clientMessageId || null,
        })
        : await runRpc("msg_send_message", {
          p_thread_id: threadId,
          p_sender_user_id: viewer.effectiveUserId,
          p_body: body,
          p_message_type: messageType,
          p_metadata_json: authoritativeMetadata,
          p_client_message_id: clientMessageId || null,
        });
      res.status(200).json({ ok: true, data, meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion } });
    } catch (error) {
      fail(res, error, "Send message failed");
    }
  });

  router.post("/thread/:threadId/message/:messageId/delete", requireWritableDeviceOrOpsAuth, async (_req, res) => {
    res.status(410).json({
      ok: false,
      error: "Individual-message deletion is retired. Delete the conversation instead.",
    });
  });

  router.post("/thread/:threadId/delete", requireWritableDeviceOrOpsAuth, async (req, res) => {
    try {
      const threadId = String(req.params.threadId || "").trim();
      const operationId = String(req.body?.operation_id || req.body?.operationId || "").trim();
      if (!isUuid(threadId) || !isUuid(operationId)) {
        res.status(422).json({ ok: false, error: "Valid thread and deletion operation ids are required." });
        return;
      }
      const deviceId = String(req.body?.device_id || req.body?.deviceId || "").trim();
      const viewer = await resolveViewerContext({ deviceId, managerSession: req.memphisAuth || null });
      const thread = await getThreadIdentity(threadId);
      if (!thread) {
        res.status(404).json({ ok: false, error: "Conversation was not found." });
        return;
      }
      if (String(thread.system_key || "") === "ops_manager_shared_chat_v1") {
        res.status(409).json({ ok: false, error: "The shared Ops Manager conversation stays available to authorized manager devices." });
        return;
      }
      if (!viewer.isManagerOverview) {
        const isParticipant = await isThreadParticipant(threadId, viewer.effectiveUserId);
        if (!isParticipant) {
          res.status(403).json({ ok: false, error: "Device must be a participant in the thread or be a manager device." });
          return;
        }
      }
      const data = await runRpc("msg_delete_thread", {
        p_thread_id: threadId,
        p_request_user_id: viewer.effectiveUserId,
        p_operation_id: operationId,
      });
      const deleted = Array.isArray(data) ? data[0] : data;
      if (!deleted
          || deleted.deleted !== true
          || String(deleted.thread_id || "") !== threadId
          || deleted.deletion_scope !== "user"
          || !deleted.deleted_at
          || !deleted.deleted_through) {
        res.status(502).json({ ok: false, error: "The database did not confirm user-scoped conversation removal." });
        return;
      }
      res.status(200).json({
        ok: true,
        data: deleted,
        meta: messagingMeta({
          deletion: "current_user_only",
          authoritative: true,
          old_history_restores: false,
          memphis_starts_clean: deleted.memphis_generation_ended === true,
        }),
      });
    } catch (error) {
      if (/operation id was already used/i.test(String(error?.message || ""))) {
        res.status(409).json({ ok: false, error: error.message });
        return;
      }
      fail(res, error, "Delete thread failed");
    }
  });

  router.post("/thread/:threadId/admin-tombstone", requireWritableDeviceOrOpsAuth, async (req, res) => {
    try {
      if (!req.memphisAuth) {
        res.status(403).json({ ok: false, error: "A named admin session is required." });
        return;
      }
      const threadId = String(req.params.threadId || "").trim();
      const operationId = String(req.body?.operation_id || req.body?.operationId || "").trim();
      if (!isUuid(threadId) || !isUuid(operationId)) {
        res.status(422).json({ ok: false, error: "Valid thread and deletion operation ids are required." });
        return;
      }
      const viewer = await resolveViewerContext({ managerSession: req.memphisAuth });
      const data = await runRpc("msg_admin_tombstone_thread", {
        p_thread_id: threadId,
        p_request_user_id: viewer.effectiveUserId,
        p_operation_id: operationId,
      });
      const deleted = Array.isArray(data) ? data[0] : data;
      if (!deleted
          || deleted.deleted !== true
          || String(deleted.thread_id || "") !== threadId
          || deleted.deletion_scope !== "global"
          || !deleted.deleted_at
          || !deleted.purge_after) {
        res.status(502).json({ ok: false, error: "The database did not confirm the admin tombstone." });
        return;
      }
      res.status(200).json({
        ok: true,
        data: deleted,
        meta: messagingMeta({
          deletion: "admin_global_tombstone",
          retention_days: 14,
          authoritative: true,
        }),
      });
    } catch (error) {
      if (/operation id was already used/i.test(String(error?.message || ""))) {
        res.status(409).json({ ok: false, error: error.message });
        return;
      }
      fail(res, error, "Admin tombstone failed");
    }
  });

  router.post("/thread/:threadId/read", requireWritableDeviceOrOpsAuth, async (req, res) => {
    try {
      const threadId = String(req.params.threadId || "").trim();
      const userId = String(req.body?.user_id || "").trim();
      const deviceId = String(req.body?.device_id || req.body?.deviceId || "").trim();
      const viewer = await resolveViewerContext({ userId, deviceId, managerSession: req.memphisAuth || null });
      if (userId && viewer.effectiveUserId !== userId) {
        res.status(403).json({ ok: false, error: "Read acknowledgement user ID must match the authenticated viewer." });
        return;
      }
      const data = await runRpc("msg_mark_thread_read", { p_thread_id: threadId, p_user_id: viewer.effectiveUserId });
      res.status(200).json({ ok: true, data, meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion } });
    } catch (error) {
      fail(res, error, "Mark thread read failed");
    }
  });

  router.post("/memphis/thread", requireWritableDeviceOrOpsAuth, async (req, res) => {
    try {
      const requestedUserId = String(req.body?.user_id || "").trim();
      const deviceId = String(req.body?.device_id || req.body?.deviceId || req.header("x-device-id") || "").trim();
      const viewer = await resolveViewerContext({ userId: requestedUserId, deviceId, managerSession: req.memphisAuth || null });
      const data = await runRpc("msg_get_or_create_memphis_thread", { p_user_id: viewer.effectiveUserId });
      res.status(200).json({ ok: true, data, meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion } });
    } catch (error) {
      fail(res, error, "Get Memphis thread failed");
    }
  });

  // MEDIUM #13: Use requireOpsManagerAuth on diagnose endpoint.
  router.post("/memphis/diagnose", requireOpsManagerAuth, async (req, res) => {
    try {
      const body = String(req.body?.body || req.body?.message || "").trim();
      const deviceId = String(req.body?.device_id || "").trim();
      const threadId = String(req.body?.thread_id || "").trim();
      const userId = String(req.body?.user_id || "").trim();
      let resolvedThreadId = threadId;
      if (!resolvedThreadId && userId) {
        const thread = await runRpc("msg_get_or_create_memphis_thread", { p_user_id: userId });
        resolvedThreadId = String(thread?.id || "").trim();
      }
      if (!body) throw new Error("body is required.");
      const data = await memphisResponder.diagnoseMessage({ deviceId, threadId: resolvedThreadId, userMessage: body });
      res.status(200).json({ ok: true, data, meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion } });
    } catch (error) {
      fail(res, error, "Diagnose Memphis message failed");
    }
  });

  router.post("/memphis/admin/diagnose", retiredGeminiAdminRoute, async (req, res) => {
    try {
      const body = String(req.body?.body || req.body?.message || "").trim();
      const deviceId = String(req.body?.device_id || req.memphisAuth?.device_id || "").trim();
      const threadId = String(req.body?.thread_id || "").trim();
      if (!body) throw new Error("body is required.");
      const data = await memphisResponder.diagnoseMessage({ deviceId, threadId, userMessage: body });
      res.status(200).json({ ok: true, data: { ...data, auth: req.memphisAuth || null, read_only: true }, meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion, read_only: true } });
    } catch (error) {
      fail(res, error, "Diagnose Memphis admin message failed");
    }
  });

  router.post("/memphis/admin/audit", retiredGeminiAdminRoute, async (req, res) => {
    try {
      const body = String(req.body?.body || req.body?.message || "").trim();
      const audit = await runGeminiAdminAudit({ prompt: body, auth: req.memphisAuth || null });
      res.status(200).json({ ok: true, data: audit, meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion, read_only: true } });
    } catch (error) {
      fail(res, error, "Run Gemini admin audit failed");
    }
  });

  router.post("/memphis/admin/run", retiredGeminiAdminRoute, async (req, res) => {
    try {
      const body = String(req.body?.body || req.body?.message || "").trim();
      const deviceId = String(req.body?.device_id || req.memphisAuth?.device_id || "").trim();
      const threadId = String(req.body?.thread_id || "").trim();
      const userId = String(req.body?.user_id || "").trim();
      if (!body) throw new Error("body is required.");
      let resolvedThreadId = threadId;
      if (!resolvedThreadId && userId) {
        const thread = await runRpc("msg_get_or_create_memphis_thread", { p_user_id: userId });
        resolvedThreadId = String(thread?.id || "").trim();
      }
      const { reply, routedBody } = await buildMemphisReply({ userId, deviceId, threadId: resolvedThreadId, body });
      const diagnostics = await memphisResponder.diagnoseMessage({ deviceId, threadId: resolvedThreadId, userMessage: routedBody });
      res.status(200).json({
        ok: true,
        data: {
          reply,
          diagnostics,
          thread_id: resolvedThreadId || null,
          auth: req.memphisAuth || null,
        },
        meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion },
      });
    } catch (error) {
      fail(res, error, "Run Memphis admin console failed");
    }
  });

  router.post("/memphis/message", requireWritableDeviceOrOpsAuth, async (req, res) => {
    try {
      const requestedUserId = String(req.body?.user_id || "").trim();
      const body = String(req.body?.body || "").trim();
      const deviceId = String(req.body?.device_id || req.body?.deviceId || req.header("x-device-id") || "").trim();
      const clientMessageId = String(req.body?.client_message_id || req.body?.clientMessageId || "").trim();
      if (!body) throw new Error("body is required.");

      const viewer = await resolveViewerContext({ userId: requestedUserId, deviceId, managerSession: req.memphisAuth || null });
      const canonicalDeviceId = String(viewer.identity?.canonical_device_id || deviceId).trim();
      const data = await sendMemphisConversationMessage({
        userId: viewer.effectiveUserId,
        deviceId: canonicalDeviceId,
        body,
        clientMessageId,
        managerId: String(req.memphisAuth?.manager_id || "").trim(),
      });

      res.status(200).json({ ok: true, data, meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion } });
    } catch (error) {
      fail(res, error, "Send Memphis message failed");
    }
  });

  router.post("/broadcast", requireWritableDeviceOrOpsAuth, async (req, res) => {
    try {
      const senderUserId = String(req.body?.sender_user_id || "").trim();
      const title = req.body?.title == null ? null : String(req.body.title);
      const body = String(req.body?.body || "");
      const deviceId = String(req.body?.device_id || req.body?.deviceId || "").trim();
      const viewer = await resolveViewerContext({ userId: senderUserId, deviceId, managerSession: req.memphisAuth || null });
      if (!viewer.isManagerOverview) {
        res.status(403).json({ ok: false, error: "Broadcast requires a manager device." });
        return;
      }
      const data = await runRpc("msg_send_broadcast", { p_sender_user_id: viewer.effectiveUserId, p_title: title, p_body: body });
      res.status(200).json({ ok: true, data, meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion } });
    } catch (error) {
      fail(res, error, "Send broadcast failed");
    }
  });

  return router;
}
