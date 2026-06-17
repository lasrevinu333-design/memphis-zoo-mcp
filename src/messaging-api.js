import express from "express";
import { createMemphisResponder } from "./services/index.js";

export function createMessagingRouter({ runReadOnlySql, runRpc, buildHealthPayload, appVersion, releaseId, contractVersion }) {
  const router = express.Router();
  const memphisResponder = createMemphisResponder({ runReadOnlySql, runRpc });

  function fail(res, error, fallback = "Messaging request failed") {
    res.status(400).json({ ok: false, error: error?.message || fallback });
  }

  function esc(value) {
    return String(value || "").replace(/'/g, "''");
  }

  function getGeminiDiagnostics() {
    const geminiApiKey = String(process.env.GEMINI_API_KEY || "").trim();
    const googleApiKey = String(process.env.GOOGLE_API_KEY || "").trim();
    const model = String(process.env.MEMPHIS_GEMINI_MODEL || process.env.GEMINI_MODEL || "gemini-2.5-flash").trim();
    return {
      gemini_configured: Boolean(geminiApiKey || googleApiKey),
      gemini_key_source: geminiApiKey ? "GEMINI_API_KEY" : (googleApiKey ? "GOOGLE_API_KEY" : null),
      memphis_model: model || null,
    };
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

  router.get("/health", (_req, res) => {
    res.status(200).json(buildHealthPayload("messaging", { contract_version: contractVersion, memphis: getGeminiDiagnostics() }));
  });

  router.get("/me/by-device", async (req, res) => {
    try {
      const deviceId = String(req.query.device_id || "").trim();
      if (!deviceId) throw new Error("device_id is required.");
      const rows = await runRpc("msg_get_user_by_device", { p_device_id: deviceId });
      const data = Array.isArray(rows) && rows.length ? rows[0] : null;
      res.status(200).json({ ok: true, data, meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion } });
    } catch (error) {
      fail(res, error, "Device identity lookup failed");
    }
  });

  router.get("/users", async (req, res) => {
    try {
      const userId = String(req.query.user_id || "").trim() || null;
      const rows = await runRpc("msg_list_users", userId ? { p_user_id: userId } : {});
      res.status(200).json({ ok: true, data: rows || [], meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion } });
    } catch (error) {
      fail(res, error, "Messaging users failed");
    }
  });

  router.get("/threads", async (req, res) => {
    try {
      const userId = String(req.query.user_id || "").trim();
      const deviceId = String(req.query.device_id || "").trim();
      const rows = deviceId
        ? await runRpc("msg_list_threads_for_device", { p_user_id: userId, p_device_id: deviceId })
        : await runRpc("msg_list_threads", { p_user_id: userId });
      res.status(200).json({ ok: true, data: rows || [], meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion } });
    } catch (error) {
      fail(res, error, "Messaging threads failed");
    }
  });

  router.get("/thread/:threadId/messages", async (req, res) => {
    try {
      const threadId = String(req.params.threadId || "").trim();
      const userId = String(req.query.user_id || "").trim();
      const limit = Number.parseInt(String(req.query.limit || 50), 10) || 50;
      const rows = await runRpc("msg_list_thread_messages", {
        p_thread_id: threadId,
        p_user_id: userId,
        p_limit: Math.min(Math.max(limit, 1), 200),
        p_before: req.query.before ? String(req.query.before).trim() : null,
      });
      res.status(200).json({ ok: true, data: rows || [], meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion } });
    } catch (error) {
      fail(res, error, "Thread messages failed");
    }
  });

  router.post("/thread/direct", async (req, res) => {
    try {
      const createdByUserId = String(req.body?.created_by_user_id || "").trim();
      const otherUserId = String(req.body?.other_user_id || "").trim();
      const data = await runRpc("msg_get_or_create_direct_thread", { p_user_a: createdByUserId, p_user_b: otherUserId });
      res.status(200).json({ ok: true, data, meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion } });
    } catch (error) {
      fail(res, error, "Create direct thread failed");
    }
  });

  router.post("/thread/group", async (req, res) => {
    try {
      const createdByUserId = String(req.body?.created_by_user_id || "").trim();
      const title = req.body?.title == null ? null : String(req.body.title);
      const memberUserIds = Array.isArray(req.body?.member_user_ids)
        ? req.body.member_user_ids.map((x) => String(x || "").trim()).filter(Boolean)
        : [];
      const data = await runRpc("msg_create_group_thread", {
        p_created_by_user_id: createdByUserId,
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
      try {
        const directContact = await directContactReply(body);
        if (directContact) {
          reply = { text: directContact, meta: { fallback: true, mode: "direct_internal_contact" } };
        } else if (isCapabilityPrompt(body)) {
          reply = { text: buildCapabilityReply(), meta: { fallback: true, mode: "local_capability_reply" } };
        } else {
          const routedBody = normalizeMemphisPromptForLocalRouting(body);
          reply = await memphisResponder.generateReply({ userId, deviceId, threadId: thread.id, userMessage: routedBody });
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
        }
      } catch (error) {
        console.error("memphis ai reply failed:", error);
        reply = {
          text: `Memphis hit an internal error while answering that. ${error?.message || "Unknown error."}`,
          meta: { fallback: true, error: error?.message || "unknown_error", diagnostics: getGeminiDiagnostics() }
        };
      }

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
