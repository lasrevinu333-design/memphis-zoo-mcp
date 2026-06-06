import express from "express";
import { makeDailyPinMiddleware } from "./auth/daily-pin-auth.js";
import { getGeminiDiagnostics } from "./utils/gemini-config.js";
import { createMemphisResponder } from "./services/index.js";

export function createMessagingRouter({ runReadOnlySql, runRpc, buildHealthPayload, appVersion, releaseId, contractVersion }) {
  const router = express.Router();
  const memphisResponder = createMemphisResponder({ runReadOnlySql, runRpc });
  const requireOpsManagerAuth = makeDailyPinMiddleware({ allowedRoles: ["ops_manager"], openWhenDisabled: true });
  const MANAGER_OVERVIEW_DEVICE_IDS = new Set(["1e74fe4c-dc20b3b9", "KIOSK_01", "KIOSK_1"]);

  function fail(res, error, fallback = "Messaging request failed") {
    res.status(400).json({ ok: false, error: error?.message || fallback });
  }

  function esc(value) {
    return String(value || "").replace(/'/g, "''");
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
    return Array.isArray(rows) && rows.length ? rows[0] : null;
  }

  async function resolveViewerContext({ userId = "", deviceId = "" } = {}) {
    const normalizedUserId = String(userId || "").trim();
    const normalizedDeviceId = String(deviceId || "").trim();
    const identity = await getViewerIdentity(normalizedDeviceId);
    const effectiveUserId = String(identity?.msg_user_id || normalizedUserId || "").trim();
    const isManagerOverview = Boolean(
      identity
      && String(identity.role || "").trim().toLowerCase() === "manager"
      && isManagerOverviewDevice(normalizedDeviceId)
    );
    if (!effectiveUserId) throw new Error("user_id or a mapped device is required.");
    if (identity?.msg_user_id && normalizedUserId && normalizedUserId !== effectiveUserId && !isManagerOverview) {
      throw new Error("This device can only access its assigned messenger account.");
    }
    return { identity, effectiveUserId, deviceId: normalizedDeviceId, isManagerOverview };
  }

  function buildThreadListSql({ viewerUserId = "", managerOverview = false }) {
    const viewer = esc(viewerUserId);
    const visibilityClause = managerOverview
      ? "true"
      : "tp.viewer_is_participant = true and t.thread_type in ('direct', 'bot')";
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
          else coalesce(nullif(t.title, ''), nullif(tp.participant_names, ''), 'Group')
        end as thread_title,
        ${unreadSelect} as unread_count,
        lm.last_message_at,
        lm.last_message_id,
        lm.last_sender_name,
        lm.last_message_body,
        lm.last_message_type,
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
      : "exists (select 1 from public.msg_thread_participants tp where tp.thread_id = t.id and tp.user_id = '" + viewer + "'::uuid and tp.left_at is null) and t.thread_type in ('direct', 'bot')";
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
      const rows = await runReadOnlySql(`select * from public.msg_get_user_by_device('${esc(deviceId)}')`);
      const data = Array.isArray(rows) && rows.length ? rows[0] : null;
      res.status(200).json({ ok: true, data, meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion } });
    } catch (error) {
      fail(res, error, "Device identity lookup failed");
    }
  });

  router.get("/users", async (req, res) => {
    try {
      const userId = String(req.query.user_id || "").trim() || null;
      const rows = await runReadOnlySql(`select * from public.msg_list_users(${userId ? `'${esc(userId)}'::uuid` : "null::uuid"})`);
      res.status(200).json({ ok: true, data: rows || [], meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion } });
    } catch (error) {
      fail(res, error, "Messaging users failed");
    }
  });

  router.get("/threads", async (req, res) => {
    try {
      const userId = String(req.query.user_id || "").trim();
      const deviceId = String(req.query.device_id || "").trim();
      const viewer = await resolveViewerContext({ userId, deviceId });
      const sql = buildThreadListSql({ viewerUserId: viewer.effectiveUserId, managerOverview: viewer.isManagerOverview });
      const rows = await runReadOnlySql(sql);
      res.status(200).json({ ok: true, data: rows || [], meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion } });
    } catch (error) {
      fail(res, error, "Messaging threads failed");
    }
  });

  router.get("/device-event-reminders", async (req, res) => {
    try {
      const deviceId = String(req.query.device_id || "").trim();
      const limit = Math.min(Math.max(Number.parseInt(String(req.query.limit || 5), 10) || 5, 1), 20);
      if (!deviceId) throw new Error("device_id is required.");
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
            and coalesce(m.metadata_json->>'notification_kind', '') in ('two_days_before', 'day_before', 'morning_of')
            and r.read_at is null
            and m.sent_at >= now() - interval '4 days'
          order by m.sent_at desc, m.created_at desc
          limit ${limit}
        ) event_reminders
      `);
      res.status(200).json({ ok: true, data: rows || [], meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion } });
    } catch (error) {
      fail(res, error, "Device event reminders failed");
    }
  });

  router.get("/thread/:threadId/messages", async (req, res) => {
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

  router.post("/thread/:threadId/message", async (req, res) => {
    try {
      const threadId = String(req.params.threadId || "").trim();
      const senderUserId = String(req.body?.sender_user_id || "").trim();
      const body = String(req.body?.body || "");
      const messageType = String(req.body?.message_type || "text").trim() || "text";
      const metadataJson = req.body?.metadata_json && typeof req.body.metadata_json === "object" ? req.body.metadata_json : {};
      const data = await runRpc("msg_send_message", { p_thread_id: threadId, p_sender_user_id: senderUserId, p_body: body, p_message_type: messageType, p_metadata_json: metadataJson });
      res.status(200).json({ ok: true, data, meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion } });
    } catch (error) {
      fail(res, error, "Send message failed");
    }
  });

  router.post("/thread/:threadId/delete", async (req, res) => {
    try {
      const threadId = String(req.params.threadId || "").trim();
      if (!threadId) throw new Error("threadId is required.");
      const data = await runRpc("msg_delete_thread_permanently", { p_thread_id: threadId });
      res.status(200).json({ ok: true, data, meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion } });
    } catch (error) {
      fail(res, error, "Delete thread failed");
    }
  });

  router.post("/thread/:threadId/read", async (req, res) => {
    try {
      const threadId = String(req.params.threadId || "").trim();
      const userId = String(req.body?.user_id || "").trim();
      const data = await runRpc("msg_mark_thread_read", { p_thread_id: threadId, p_user_id: userId });
      res.status(200).json({ ok: true, data, meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion } });
    } catch (error) {
      fail(res, error, "Mark thread read failed");
    }
  });

  router.post("/memphis/thread", async (req, res) => {
    try {
      const userId = String(req.body?.user_id || "").trim();
      const data = await runRpc("msg_get_or_create_memphis_thread", { p_user_id: userId });
      res.status(200).json({ ok: true, data, meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion } });
    } catch (error) {
      fail(res, error, "Get Memphis thread failed");
    }
  });

  router.post("/memphis/diagnose", async (req, res) => {
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

  router.post("/memphis/message", async (req, res) => {
    try {
      const userId = String(req.body?.user_id || "").trim();
      const body = String(req.body?.body || "").trim();
      const deviceId = String(req.body?.device_id || "").trim();
      if (!userId) throw new Error("user_id is required.");
      if (!body) throw new Error("body is required.");

      const thread = await runRpc("msg_get_or_create_memphis_thread", { p_user_id: userId });

      const userMessage = await runRpc("msg_send_message", {
        p_thread_id: thread.id,
        p_sender_user_id: userId,
        p_body: body,
        p_message_type: "text",
        p_metadata_json: { channel: "memphis" }
      });

      const memphisRows = await runReadOnlySql("select public.msg_get_memphis_user_id() as memphis_user_id");
      const memphisUserId = Array.isArray(memphisRows) && memphisRows.length ? memphisRows[0].memphis_user_id : null;
      if (!memphisUserId) throw new Error("Memphis bot identity not found.");

      let reply;
      ({ reply } = await buildMemphisReply({ userId, deviceId, threadId: thread.id, body }));

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

  router.post("/broadcast", async (req, res) => {
    try {
      const senderUserId = String(req.body?.sender_user_id || "").trim();
      const title = req.body?.title == null ? null : String(req.body.title);
      const body = String(req.body?.body || "");
      const data = await runRpc("msg_send_broadcast", { p_sender_user_id: senderUserId, p_title: title, p_body: body });
      res.status(200).json({ ok: true, data, meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion } });
    } catch (error) {
      fail(res, error, "Send broadcast failed");
    }
  });

  return router;
}
