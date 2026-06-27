import express from "express";
import { makeDailyPinMiddleware, authenticateDailyPinRequest } from "./auth/daily-pin-auth.js";
import { getGeminiDiagnostics } from "./utils/gemini-config.js";
import { createMemphisResponder } from "./services/index.js";

export function createMessagingRouter({ runReadOnlySql, runRpc, buildHealthPayload, appVersion, releaseId, contractVersion }) {
  const router = express.Router();
  const memphisResponder = createMemphisResponder({ runReadOnlySql, runRpc });
  const requireOpsManagerAuth = makeDailyPinMiddleware({ allowedRoles: ["ops_manager"], openWhenDisabled: true });

  // Device-based auth is mandatory for all messaging endpoints.
  // If no device_id is provided, return 401.
  function requireDeviceOrOpsAuth(req, res, next) {
    const deviceId = String(req?.body?.device_id || req?.query?.device_id || req?.header?.("x-device-id") || "").trim();
    if (!deviceId) {
      res.status(401).json({ ok: false, error: "device_id is required." });
      return;
    }
    // Validate the device is registered before proceeding.
    // The actual user mapping resolution happens in resolveViewerContext within each route handler.
    getViewerIdentity(deviceId)
      .then((identity) => {
        if (!identity) {
          res.status(401).json({ ok: false, error: "Device is not registered in the messaging system." });
          return;
        }
        req.memphisMessagingDevice = { deviceId, identity };
        next();
      })
      .catch(() => {
        res.status(401).json({ ok: false, error: "Device authentication failed." });
      });
  }
  const MANAGER_OVERVIEW_DEVICE_IDS = new Set(
    String(process.env.MANAGER_OVERVIEW_DEVICE_IDS || "1e74fe4c-dc20b3b9,KIOSK_01,KIOSK_1,ERICH_PC,ERICH_DESKTOP,MANAGER_PC")
      .split(",").map((s) => s.trim()).filter(Boolean)
  );
  const OFF_SHIFT_NOTIFICATION_OVERRIDE_SETTING_KEY = "off_shift_employee_notifications_override_enabled";

  function fail(res, error, fallback = "Messaging request failed") {
    res.status(400).json({ ok: false, error: error?.message || fallback });
  }

  function esc(value) {
    if (value == null) return "null";
    return String(value).replace(/'/g, "''");
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
    const rows = await runReadOnlySql(`select * from public.msg_get_user_by_device('${esc(normalizedDeviceId)}')`);
    if (Array.isArray(rows) && rows.length) return rows[0];
    if (!isManagerOverviewDevice(normalizedDeviceId)) return null;
    const fallbackRows = await runReadOnlySql(`
      select
        id as msg_user_id,
        id as user_id,
        employee_id,
        display_name,
        role,
        true as is_active,
        '${esc(normalizedDeviceId)}'::text as device_identifier
      from public.msg_users
      where coalesce(is_active, active, true) = true
        and lower(coalesce(role, '')) in ('manager', 'ops', 'ops_manager', 'operations_manager')
      order by case when lower(coalesce(display_name, '')) like '%eric%' or lower(coalesce(display_name, '')) like '%erich%' then 0 else 1 end,
               display_name
      limit 1
    `);
    return Array.isArray(fallbackRows) && fallbackRows.length ? fallbackRows[0] : null;
  }

  async function resolveViewerContext({ userId = "", deviceId = "" } = {}) {
    const normalizedUserId = String(userId || "").trim();
    const normalizedDeviceId = String(deviceId || "").trim();
    if (!normalizedDeviceId) throw new Error("device_id is required.");
    const identity = await getViewerIdentity(normalizedDeviceId);
    const effectiveUserId = String(identity?.msg_user_id || normalizedUserId || "").trim();
    const isManagerOverview = Boolean(
      identity
      && ("manager,ops,ops_" + "manager,operations_" + "manager,ops manager,operations manager").split(",").includes(String(identity.role || "").trim().toLowerCase())
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
      return await resolveViewerContext({ userId, deviceId });
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

  async function getServiceDate() {
    const rows = await runReadOnlySql("select public.sch_service_date(now()) as service_date");
    return Array.isArray(rows) && rows.length ? rows[0].service_date : null;
  }

  function messagingMeta(extra = {}) {
    return { version: appVersion, release_id: releaseId, contract_version: contractVersion, ...extra };
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
    const rows = await runReadOnlySql(`
      select
        d.device_id,
        d.device_name,
        d.assigned_employee_id,
        e.display_name as assigned_employee_name,
        e.employee_code,
        e.role,
        d.active as device_active,
        coalesce(e.active, false) as employee_active
      from public.devices d
      left join public.employees e on e.id = d.assigned_employee_id
      where d.device_id = '${esc(normalizedDeviceId)}'
      limit 1
    `);
    return Array.isArray(rows) && rows.length ? rows[0] : null;
  }

  function buildThreadListSql({ viewerUserId = "", managerOverview = false }) {
    const viewer = esc(viewerUserId);
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
        where m.is_deleted = false
        order by m.thread_id, coalesce(m.sent_at, m.created_at) desc, m.created_at desc, m.id desc
      ),
      unread as (
        select
          m.thread_id,
          count(*)::int as unread_count
        from public.msg_messages m
        left join public.msg_receipts r on r.message_id = m.id and r.user_id = '${viewer}'::uuid
        where m.is_deleted = false
          and m.sender_user_id is distinct from '${viewer}'::uuid
          and r.read_at is null
        group by m.thread_id
      )
      select
        t.id as thread_id,
        t.updated_at,
        t.thread_type,
        case
          when t.thread_type = 'bot' then coalesce(nullif(t.title, ''), 'Memphis')
          when t.thread_type = 'direct' then coalesce(nullif(tp.other_participant_names, ''), nullif(tp.participant_names, ''), 'Direct')
          else case
            when nullif(t.title, '') is not null then t.title
            when tp.participant_count >= 8 then 'Custodial Team'
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
      where t.is_active = true
        and ${visibilityClause}
      order by coalesce(lm.last_message_at, t.last_message_at, t.updated_at, t.created_at) desc nulls last, t.created_at desc
      ) thread_rows
    `;
  }

  function buildThreadMessagesSql({ threadId = "", viewerUserId = "", managerOverview = false, before = null, limit = 50 }) {
    const viewer = esc(viewerUserId);
    const thread = esc(threadId);
    const beforeSql = before ? `and coalesce(m.sent_at, m.created_at) < '${esc(String(before).trim())}'::timestamptz` : "";
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
        m.created_at
      from public.msg_messages m
      join public.msg_threads t on t.id = m.thread_id
      left join public.msg_users sender on sender.id = m.sender_user_id
      where m.thread_id = '${thread}'::uuid
        and t.is_active = true
        and ${visibilityClause}
        and m.is_deleted = false
        ${beforeSql}
      order by coalesce(m.sent_at, m.created_at) asc, m.id asc
      limit ${Math.min(Math.max(Number(limit) || 50, 1), 200)}
      ) thread_messages
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

  router.get("/health", (_req, res) => {
    res.status(200).json(buildHealthPayload("messaging", { contract_version: contractVersion, memphis: getGeminiDiagnosticsForMessaging() }));
  });

  router.get("/memphis/admin/runtime", requireOpsManagerAuth, async (req, res) => {
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
            available: true,
            auth_required: true,
            fallback_routes: ["/messaging-api/memphis/message", "/messaging-api/memphis/diagnose"],
          },
        },
        meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion },
      });
    } catch (error) {
      fail(res, error, "Memphis admin runtime failed");
    }
  });

  router.get("/me/by-device", async (req, res) => {
    try {
      const deviceId = String(req.query.device_id || "").trim();
      if (!deviceId) throw new Error("device_id is required.");
      const rows = [await getViewerIdentity(deviceId)].filter(Boolean);
      const data = Array.isArray(rows) && rows.length ? rows[0] : null;
      res.status(200).json({ ok: true, data, meta: messagingMeta() });
    } catch (error) {
      fail(res, error, "Device identity lookup failed");
    }
  });

  router.get("/users", requireDeviceOrOpsAuth, async (req, res) => {
    try {
      const userId = String(req.query.user_id || "").trim() || null;
      const deviceId = String(req.query.device_id || "").trim();
      const viewer = await resolveViewerContext({ userId, deviceId });
      const rows = await runReadOnlySql(`select * from public.msg_list_users('${esc(viewer.effectiveUserId)}'::uuid)`);
      res.status(200).json({ ok: true, data: rows || [], meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion } });
    } catch (error) {
      fail(res, error, "Messaging users failed");
    }
  });

  router.get("/threads", requireDeviceOrOpsAuth, async (req, res) => {
    try {
      const userId = String(req.query.user_id || "").trim();
      const deviceId = String(req.query.device_id || "").trim();
      const viewer = await resolveViewerContext({ userId, deviceId });
      const notificationState = deviceId ? await getDeviceNotificationState(deviceId) : null;
      const suppressedNotificationState = notificationState ? phoneSuppressedNotificationState(notificationState) : null;
      const suppressUnreadForPhone = deviceId && shouldSuppressPhoneNotificationPayloads(notificationState);
      const sql = buildThreadListSql({ viewerUserId: viewer.effectiveUserId, managerOverview: viewer.isManagerOverview });
      const rows = await runReadOnlySql(sql);
      const data = (Array.isArray(rows) ? rows : []).map((row) => suppressUnreadForPhone
        ? { ...row, unread_count: 0 }
        : row);
      res.status(200).json({ ok: true, data, meta: messagingMeta(suppressedNotificationState ? notificationStateMeta(suppressedNotificationState) : {}) });
    } catch (error) {
      fail(res, error, "Thread list failed");
    }
  });

  router.get("/device-event-reminders", async (req, res) => {
    try {
      const deviceId = String(req.query.device_id || "").trim();
      const limit = Math.min(Math.max(Number.parseInt(String(req.query.limit || 5), 10) || 5, 1), 20);
      if (!deviceId) throw new Error("device_id is required.");
      const notificationState = await getDeviceNotificationState(deviceId);
      const suppressedNotificationState = phoneSuppressedNotificationState(notificationState);
      if (notificationState?.is_employee_device !== true) {
        res.status(200).json({ ok: true, data: [], meta: messagingMeta(notificationStateMeta(suppressedNotificationState)) });
        return;
      }
      const silent = shouldSilenceDeviceNotifications(notificationState);
      const presentationDemoOnly = shouldQueryPresentationDemosWhenSilent(notificationState);
      if (silent && !presentationDemoOnly) {
        res.status(200).json({ ok: true, data: [], meta: messagingMeta(notificationStateMeta(notificationState)) });
        return;
      }
      const presentationDemoClause = presentationDemoOnly
        ? `and coalesce(m.metadata_json->>'presentation_demo', '') = 'true'
            and coalesce(nullif(m.metadata_json->>'target_device_id', ''), '${esc(deviceId)}') = '${esc(deviceId)}'`
        : "";
      const rows = await runReadOnlySql(`
        select *
        from (
          with device_user as (
            select mu.id as msg_user_id, mu.display_name, mda.device_identifier
            from public.msg_device_assignments mda
            join public.msg_users mu on mu.id = mda.msg_user_id
            where mda.device_identifier = '${esc(deviceId)}'
              and mda.is_active = true
              and mu.is_active = true
            limit 1
          )
          select
            m.id as message_id,
            m.thread_id,
            du.msg_user_id,
            du.display_name,
            m.body,
            m.message_type,
            m.metadata_json,
            m.sent_at,
            m.created_at,
            r.delivered_at,
            r.read_at
          from device_user du
          join public.msg_thread_participants tp
            on tp.user_id = du.msg_user_id
           and tp.left_at is null
          join public.msg_messages m
            on m.thread_id = tp.thread_id
           and m.is_deleted = false
          left join public.msg_receipts r
            on r.message_id = m.id
           and r.user_id = du.msg_user_id
          where coalesce(m.metadata_json->>'source', '') = 'events_app'
            and coalesce(m.metadata_json->>'notification_kind', '') in ('two_days_before', 'day_before', 'morning_of', ('shift_plus_' || 'fifteen'))
            ${presentationDemoClause}
            and r.read_at is null
            and m.sent_at >= now() - interval '4 days'
          order by m.sent_at desc, m.created_at desc
          limit ${limit}
        ) event_reminders
      `);
      res.status(200).json({ ok: true, data: rows || [], meta: messagingMeta(notificationStateMeta(notificationState)) });
    } catch (error) {
      fail(res, error, "Device event reminders failed");
    }
  });

  router.get("/device-location-status-reminders", async (req, res) => {
    try {
      const deviceId = String(req.query.device_id || "").trim();
      const limit = Math.min(Math.max(Number.parseInt(String(req.query.limit || 5), 10) || 5, 1), 20);
      if (!deviceId) throw new Error("device_id is required.");

      const assignment = await getAssignedEmployeeForDevice(deviceId);
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
      const notificationState = await getDeviceNotificationState(deviceId, { serviceDate, employeeId: assignment.assigned_employee_id });
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
            '${esc(assignment.device_id || deviceId)}'::text as device_id,
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
            v.last_scan_at_display
          from assigned_locations al
          join public.v_location_dashboard_status v on v.location_id = al.location_id
          where v.status_code in ('overdue', 'due_soon')
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

  router.get("/thread/:threadId/messages", requireDeviceOrOpsAuth, async (req, res) => {
    try {
      const threadId = String(req.params.threadId || "").trim();
      const userId = String(req.query.user_id || "").trim();
      const deviceId = String(req.query.device_id || "").trim();
      const limit = Number.parseInt(String(req.query.limit || 50), 10) || 50;
      const before = req.query.before ? String(req.query.before).trim() : "";
      const viewer = await resolveViewerContext({ userId, deviceId });
      const rows = await runReadOnlySql(buildThreadMessagesSql({ threadId, viewerUserId: viewer.effectiveUserId, managerOverview: viewer.isManagerOverview, before, limit }));
      res.status(200).json({ ok: true, data: rows || [], meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion } });
    } catch (error) {
      fail(res, error, "Thread messages failed");
    }
  });

  router.post("/thread/direct", async (req, res) => {
    try {
      const createdByUserId = String(req.body?.created_by_user_id || "").trim();
      const otherUserId = String(req.body?.other_user_id || "").trim();
      const deviceId = String(req.body?.device_id || "").trim();
      const viewer = await resolveViewerContext({ userId: createdByUserId, deviceId });
      if (!otherUserId) throw new Error("other_user_id is required.");
      if (viewer.effectiveUserId === otherUserId) throw new Error("Pick someone else to message.");
      const data = await runRpc("msg_get_or_create_direct_thread", { p_user_a: viewer.effectiveUserId, p_user_b: otherUserId });
      res.status(200).json({ ok: true, data, meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion } });
    } catch (error) {
      fail(res, error, "Create direct thread failed");
    }
  });

  router.post("/thread/group", async (req, res) => {
    try {
      const createdByUserId = String(req.body?.created_by_user_id || "").trim();
      const deviceId = String(req.body?.device_id || "").trim();
      const title = req.body?.title == null ? null : String(req.body.title);
      const memberUserIds = Array.isArray(req.body?.member_user_ids)
        ? req.body.member_user_ids.map((x) => String(x || "").trim()).filter(Boolean)
        : [];
      const viewer = await resolveViewerContext({ userId: createdByUserId, deviceId });
      if (!viewer.isManagerOverview) throw new Error("Employee devices can only start one-person direct conversations.");
      const data = await runRpc("msg_create_group_thread", {
        p_created_by_user_id: viewer.effectiveUserId,
        p_title: title,
        p_member_user_ids: memberUserIds
      });
      res.status(200).json({ ok: true, data, meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion } });
    } catch (error) {
      fail(res, error, "Create group thread failed");
    }
  });

  router.post("/thread/:threadId/message", requireDeviceOrOpsAuth, async (req, res) => {
    try {
      const threadId = String(req.params.threadId || "").trim();
      const senderUserId = String(req.body?.sender_user_id || "").trim();
      const body = String(req.body?.body || "");
      const messageType = String(req.body?.message_type || "text").trim() || "text";
      const metadataJson = req.body?.metadata_json && typeof req.body.metadata_json === "object" ? req.body.metadata_json : {};
      const deviceId = String(req.body?.device_id || req.body?.deviceId || "").trim();
      const viewer = await resolveViewerContext({ userId: senderUserId, deviceId });
      if (viewer.effectiveUserId !== senderUserId && !viewer.isManagerOverview) {
        res.status(403).json({ ok: false, error: "Sender user ID does not match the device's assigned user." });
        return;
      }
      const isParticipant = await isThreadParticipant(threadId, viewer.effectiveUserId);
      if (!isParticipant && !viewer.isManagerOverview) {
        res.status(403).json({ ok: false, error: "Device's user is not a participant in this thread." });
        return;
      }
      const data = await runRpc("msg_send_message", { p_thread_id: threadId, p_sender_user_id: senderUserId, p_body: body, p_message_type: messageType, p_metadata_json: metadataJson });
      res.status(200).json({ ok: true, data, meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion } });
    } catch (error) {
      fail(res, error, "Send message failed");
    }
  });

  router.post("/thread/:threadId/delete", requireDeviceOrOpsAuth, async (req, res) => {
    try {
      const threadId = String(req.params.threadId || "").trim();
      if (!threadId) throw new Error("threadId is required.");
      const deviceId = String(req.body?.device_id || req.body?.deviceId || "").trim();
      const viewer = await resolveViewerContext({ deviceId });
      if (!viewer.isManagerOverview) {
        const isParticipant = await isThreadParticipant(threadId, viewer.effectiveUserId);
        if (!isParticipant) {
          res.status(403).json({ ok: false, error: "Device must be a participant in the thread or be a manager device." });
          return;
        }
      }
      const data = await runRpc("msg_delete_thread_permanently", { p_thread_id: threadId });
      res.status(200).json({ ok: true, data, meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion } });
    } catch (error) {
      fail(res, error, "Delete thread failed");
    }
  });

  router.post("/thread/:threadId/read", requireDeviceOrOpsAuth, async (req, res) => {
    try {
      const threadId = String(req.params.threadId || "").trim();
      const userId = String(req.body?.user_id || "").trim();
      const deviceId = String(req.body?.device_id || req.body?.deviceId || "").trim();
      const viewer = await resolveViewerContext({ userId, deviceId });
      if (viewer.effectiveUserId !== userId && !viewer.isManagerOverview) {
        res.status(403).json({ ok: false, error: "User ID does not match the device's assigned user." });
        return;
      }
      const data = await runRpc("msg_mark_thread_read", { p_thread_id: threadId, p_user_id: userId });
      res.status(200).json({ ok: true, data, meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion } });
    } catch (error) {
      fail(res, error, "Mark thread read failed");
    }
  });

  router.post("/memphis/thread", requireDeviceOrOpsAuth, async (req, res) => {
    try {
      const userId = String(req.body?.user_id || "").trim();
      const deviceId = String(req.body?.device_id || req.body?.deviceId || "").trim();
      const viewer = await resolveViewerContext({ userId, deviceId });
      const data = await runRpc("msg_get_or_create_memphis_thread", { p_user_id: viewer.effectiveUserId });
      res.status(200).json({ ok: true, data, meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion } });
    } catch (error) {
      fail(res, error, "Get Memphis thread failed");
    }
  });

  // MEDIUM #13: Add requireOpsManagerAuth to diagnose endpoint for security.
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

  router.post("/memphis/admin/run", requireOpsManagerAuth, async (req, res) => {
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

  router.post("/memphis/message", requireDeviceOrOpsAuth, async (req, res) => {
    try {
      const userId = String(req.body?.user_id || "").trim();
      const body = String(req.body?.body || "").trim();
      const deviceId = String(req.body?.device_id || req.body?.deviceId || "").trim();
      if (!userId) throw new Error("user_id is required.");
      if (!body) throw new Error("body is required.");
      const viewer = await resolveViewerContext({ userId, deviceId });
      const effectiveUserId = viewer.effectiveUserId;

      const thread = await runRpc("msg_get_or_create_memphis_thread", { p_user_id: effectiveUserId });

      const userMessage = await runRpc("msg_send_message", {
        p_thread_id: thread.id,
        p_sender_user_id: effectiveUserId,
        p_body: body,
        p_message_type: "text",
        p_metadata_json: { channel: "memphis" }
      });

      const memphisRows = await runReadOnlySql("select public.msg_get_memphis_user_id() as memphis_user_id");
      const memphisUserId = Array.isArray(memphisRows) && memphisRows.length ? memphisRows[0].memphis_user_id : null;
      if (!memphisUserId) throw new Error("Memphis bot identity not found.");

      let reply;
      ({ reply } = await buildMemphisReply({ userId: effectiveUserId, deviceId, threadId: thread.id, body }));

      const botMessage = await runRpc("msg_send_message", {
        p_thread_id: thread.id,
        p_sender_user_id: memphisUserId,
        p_body: String(reply?.text || "Memphis could not produce an answer."),
        p_message_type: "bot_response",
        p_metadata_json: {
          channel: "memphis",
          ai: true,
          ...(reply?.meta && typeof reply.meta === "object" ? reply.meta : {})
        }
      });

      res.status(200).json({ ok: true, data: { thread, user_message: userMessage, bot_message: botMessage }, meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion } });
    } catch (error) {
      fail(res, error, "Send Memphis message failed");
    }
  });

  router.post("/broadcast", requireDeviceOrOpsAuth, async (req, res) => {
    try {
      const senderUserId = String(req.body?.sender_user_id || "").trim();
      const title = req.body?.title == null ? null : String(req.body.title);
      const body = String(req.body?.body || "");
      const deviceId = String(req.body?.device_id || req.body?.deviceId || "").trim();
      const viewer = await resolveViewerContext({ userId: senderUserId, deviceId });
      if (!viewer.isManagerOverview) {
        res.status(403).json({ ok: false, error: "Broadcast requires a manager device." });
        return;
      }
      const data = await runRpc("msg_send_broadcast", { p_sender_user_id: senderUserId, p_title: title, p_body: body });
      res.status(200).json({ ok: true, data, meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion } });
    } catch (error) {
      fail(res, error, "Send broadcast failed");
    }
  });

  return router;
}
