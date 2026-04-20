import express from "express";

export function createMessagingRouter({ runReadOnlySql, runRpc, buildHealthPayload, appVersion, releaseId, contractVersion }) {
  const router = express.Router();

  function fail(res, error, fallback = "Messaging request failed") {
    res.status(400).json({ ok: false, error: error?.message || fallback });
  }

  router.get("/health", (_req, res) => {
    res.status(200).json(buildHealthPayload("messaging", { contract_version: contractVersion }));
  });

  router.get("/users", async (req, res) => {
    try {
      const userId = String(req.query.user_id || "").trim() || null;
      const rows = await runReadOnlySql(`select * from public.msg_list_users(${userId ? `'${userId}'::uuid` : "null::uuid"})`);
      res.status(200).json({ ok: true, data: rows || [], meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion } });
    } catch (error) {
      fail(res, error, "Messaging users failed");
    }
  });

  router.get("/threads", async (req, res) => {
    try {
      const userId = String(req.query.user_id || "").trim();
      const rows = await runReadOnlySql(`select * from public.msg_list_threads('${userId}'::uuid)`);
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
      const before = req.query.before ? `'${String(req.query.before).trim()}'::timestamptz` : "null::timestamptz";
      const rows = await runReadOnlySql(`select * from public.msg_list_thread_messages('${threadId}'::uuid, '${userId}'::uuid, ${Math.min(Math.max(limit, 1), 200)}, ${before})`);
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
      const botMessage = await runRpc("msg_send_message", {
        p_thread_id: thread.id,
        p_sender_user_id: memphisUserId,
        p_body: "Memphis is online. AI-linked operational answers are coming soon.",
        p_message_type: "bot_response",
        p_metadata_json: { channel: "memphis", placeholder: true }
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
