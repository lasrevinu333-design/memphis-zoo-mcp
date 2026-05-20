import { esc } from "./memphis-ai-utils.js";

export function mergeContextJson(threadContext = {}, patch = {}) {
  return {
    ...(threadContext?.context_json && typeof threadContext.context_json === "object" ? threadContext.context_json : {}),
    ...(patch && typeof patch === "object" ? patch : {}),
  };
}

export async function fetchThreadContext(runReadOnlySql, threadId) {
  const normalized = String(threadId || "").trim();
  if (!normalized) return {};
  const rows = await runReadOnlySql(`select public.msg_get_memphis_thread_context('${esc(normalized)}'::uuid) as data`);
  return Array.isArray(rows) && rows.length && rows[0].data ? rows[0].data : {};
}

export async function fetchRecentThreadMessages(runReadOnlySql, threadId, limit = 10) {
  const normalized = String(threadId || "").trim();
  if (!normalized) return [];
  const safeLimit = Math.min(Math.max(Number.parseInt(String(limit), 10) || 10, 2), 20);
  const rows = await runReadOnlySql(`
    select message_type, body
    from (
      select sent_at, message_type, body
      from public.msg_messages
      where thread_id = '${esc(normalized)}'::uuid
        and message_type in ('text', 'bot_response')
        and body is not null
        and trim(body) <> ''
      order by sent_at desc
      limit ${safeLimit}
    ) recent
    order by sent_at asc
  `);
  return Array.isArray(rows) ? rows : [];
}

export function formatRecentThreadMessages(messages = []) {
  const lines = messages
    .map((row) => {
      const speaker = row.message_type === "bot_response" ? "Memphis" : "User";
      const body = String(row.body || "").replace(/\s+/g, " ").trim();
      return body ? `${speaker}: ${body}` : "";
    })
    .filter(Boolean)
    .slice(-10);
  return lines.length ? `Recent thread context:\n${lines.join("\n")}` : "";
}

export async function saveThreadContext(runRpc, threadId, context = {}) {
  const normalized = String(threadId || "").trim();
  if (!normalized) return null;
  return await runRpc("msg_set_memphis_thread_context", {
    p_thread_id: normalized,
    p_last_intent: context.last_intent ?? null,
    p_last_employee_name: context.last_employee_name ?? null,
    p_last_group_name: context.last_group_name ?? null,
    p_last_location_code: context.last_location_code ?? null,
    p_last_service_date: context.last_service_date ?? null,
    p_last_subject_type: context.last_subject_type ?? null,
    p_context_json: context.context_json ?? {},
  });
}
