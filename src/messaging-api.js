import express from "express";
import { createMemphisResponder } from "./memphis-ai.js";

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

  router.get("/health", (_req, res) => {
    res.status(200).json(buildHealthPayload("messaging", { contract_version: contractVersion, memphis: getGeminiDiagnostics() }));
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
      const sql = deviceId
        ? `select * from public.msg_list_threads_for_device('${esc(userId)}'::uuid, '${esc(deviceId)}')`
        : `select * from public.msg_list_threads('${esc(userId)}'::uuid)`;
      const rows = await runReadOnlySql(sql);
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
      const before = req.query.before ? `'${esc(String(req.query.before).trim())}'::timestamptz` : "null::timestamptz";
      const rows = await runReadOnlySql(`select * from public.msg_list_thread_messages('${esc(threadId)}'::uuid, '${esc(userId)}'::uuid, ${Math.min(Math.max(limit, 1), 200)}, ${before})`);
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
        reply = await memphisResponder.generateReply({ userId, deviceId, threadId: thread.id, userMessage: body });
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
