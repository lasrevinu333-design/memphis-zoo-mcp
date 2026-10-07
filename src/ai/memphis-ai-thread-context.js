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

export async function fetchRecentThreadMessages(runReadOnlySql, threadId, limit = 10, userId = "", sourceMessageId = "") {
  const normalized = String(threadId || "").trim();
  const viewer = String(userId || "").trim();
  const source = String(sourceMessageId || "").trim();
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(normalized) || !uuid.test(viewer) || (source && !uuid.test(source))) return [];
  const safeLimit = Math.min(Math.max(Number.parseInt(String(limit), 10) || 10, 2), 20);
  const rows = await runReadOnlySql(`
    select id, message_type, body
    from (
      select m.id, coalesce(m.sent_at,m.created_at) as sent_at, m.message_type, m.body
      from public.msg_messages m
      join public.msg_threads t on t.id=m.thread_id
      where m.thread_id = '${esc(normalized)}'::uuid
        and t.is_active=true and m.is_deleted is false
        and exists(select 1 from public.msg_thread_participants p
          where p.thread_id=t.id and p.user_id='${esc(viewer)}'::uuid and p.left_at is null)
        and coalesce(m.sent_at,m.created_at)>coalesce((
          select max(v.hidden_before) from public.msg_thread_visibility v
          where v.thread_id=t.id and v.user_id='${esc(viewer)}'::uuid
            and v.device_identifier is null),'-infinity'::timestamptz)
        and m.message_type in ('text', 'bot_response') and m.body is not null and trim(m.body) <> ''
        ${source ? `and (coalesce(m.sent_at,m.created_at),m.id)<(
          select coalesce(original.sent_at,original.created_at),original.id from public.msg_messages original
          where original.id='${esc(source)}'::uuid and original.thread_id=t.id
            and original.sender_user_id='${esc(viewer)}'::uuid and original.is_deleted is false)` : ''}
      order by coalesce(m.sent_at,m.created_at) desc,m.id desc limit ${safeLimit}
    ) recent order by sent_at asc,id asc
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

export async function saveThreadContext(runRpc, threadId, context = {}, existingContext = {}) {
  const normalized = String(threadId || "").trim();
  if (!normalized) return null;
  // S3.1: Preserve previously saved fields — use existingContext values as defaults
  // for fields not explicitly provided in the current context patch. This prevents
  // one code path from nulling out fields saved by a different code path.
  return await runRpc("msg_set_memphis_thread_context", {
    p_thread_id: normalized,
    p_last_intent: context.last_intent ?? existingContext.last_intent ?? null,
    p_last_employee_name: context.last_employee_name ?? existingContext.last_employee_name ?? null,
    p_last_group_name: context.last_group_name ?? existingContext.last_group_name ?? null,
    p_last_location_code: context.last_location_code ?? existingContext.last_location_code ?? null,
    p_last_service_date: context.last_service_date ?? existingContext.last_service_date ?? null,
    p_last_subject_type: context.last_subject_type ?? existingContext.last_subject_type ?? null,
    p_context_json: context.context_json ?? existingContext.context_json ?? {},
  });
}
