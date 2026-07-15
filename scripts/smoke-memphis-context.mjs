import assert from "node:assert/strict";
import { createMemphisResponder } from "../src/services/index.js";

const contexts = new Map();
const saves = [];

function setContext(threadId, context) {
  contexts.set(threadId, context);
}

const runReadOnlySql = async (sql) => {
  if (sql.includes("msg_get_memphis_thread_context")) {
    const match = sql.match(/msg_get_memphis_thread_context\('([^']+)'::uuid\)/);
    return [{ data: match ? (contexts.get(match[1]) || {}) : {} }];
  }
  if (sql.includes("select public.sch_service_date(now()) as service_date")) return [{ service_date: "2026-05-11" }];
  if (sql.includes("select public.sch_service_date(now() + interval '1 day') as service_date")) return [{ service_date: "2026-05-12" }];
  if (sql.includes("from public.location_groups lg")) {
    return [{ location_group_id: "11111111-1111-4111-8111-111111111111", group_name: "Komodos", group_code: "KOM", aliases: ["lomodos"] }];
  }
  if (sql.includes("from public.v_memphis_area_schedule") && sql.includes("'2026-05-12'::date")) {
    return [{ employee_name: "Tester Tomorrow", coverage_start: "06:00", coverage_end: "15:00", group_name: "Komodos" }];
  }
  if (sql.includes("from public.v_memphis_area_schedule") && sql.includes("'2026-05-11'::date")) {
    return [{ employee_name: "Tester Today", coverage_start: "06:00", coverage_end: "15:00", group_name: "Komodos" }];
  }
  if (sql.includes("from public.v_memphis_employee_schedule") && sql.includes("'2026-05-12'::date")) {
    return [{ group_name: "Aquarium", coverage_start: "06:00", coverage_end: "15:00", employee_name: "Tammy" }];
  }
  if (sql.includes("from public.v_memphis_employee_schedule") && sql.includes("'2026-05-11'::date")) {
    return [{ group_name: "Teton", coverage_start: "06:00", coverage_end: "15:00", employee_name: "Tammy" }];
  }
  if (sql.includes("public.sch_get_employee_work_status") && sql.includes("'2026-05-12'::date")) {
    return [{ data: {
      ok: true,
      employee_id: "22222222-2222-4222-8222-222222222222",
      employee_name: "Tammy",
      service_date: "2026-05-12",
      weekday: "Tuesday",
      work_status: "working_assigned",
      shift: { shift_start: "06:00", shift_end: "15:00", lunch: "10:00-10:30" },
      assignments: [{ group_name: "Aquarium", coverage_start: "06:00", coverage_end: "15:00" }],
    } }];
  }
  if (sql.includes("public.sch_resolve_employee_ref") && sql.includes("Tammy")) {
    return [{ data: {
      ok: true,
      employee_id: "22222222-2222-4222-8222-222222222222",
      employee_name: "Tammy",
      employee_code: "EMP003",
      role: "staff",
      match_source: "display_name",
      matched_text: "Tammy",
      score: 100,
    } }];
  }
  if (sql.includes("from public.msg_messages")) return [];
  if (sql.includes("from public.devices d")) return [];
  if (sql.includes("select * from public.msg_get_user_by_device")) return [];
  if (sql.includes("from public.employees") && sql.includes("Tammy")) {
    return [{ id: "22222222-2222-4222-8222-222222222222", display_name: "Tammy" }];
  }
  return [];
};

const runRpc = async (name, args = {}) => {
  if (name === "msg_set_memphis_thread_context") {
    saves.push({ name, args });
    contexts.set(args.p_thread_id, {
      last_intent: args.p_last_intent,
      last_employee_name: args.p_last_employee_name,
      last_group_name: args.p_last_group_name,
      last_location_code: args.p_last_location_code,
      last_service_date: args.p_last_service_date,
      last_subject_type: args.p_last_subject_type,
      context_json: args.p_context_json,
    });
    return { ok: true };
  }
  if (name === "sch_generate_daily_schedule") return { ok: true };
  if (name === "tool_list_active_employees") return [{ display_name: "Tammy" }];
  return { ok: true };
};

const responder = createMemphisResponder({ runReadOnlySql, runRpc });

const identityReply = await responder.generateReply({ threadId: "t-identity", userMessage: "what's your name" });
assert.equal(identityReply.meta?.mode, "local_memphis_identity");
assert.match(identityReply.text, /I am Memphis/i);

setContext("t-owner", {
  last_intent: "current_owner",
  last_group_name: "Komodos",
  last_service_date: "2026-05-11",
  last_subject_type: "group",
  context_json: { last_question_shape: "current_owner" },
});
const ownerFirstReply = await responder.generateReply({ threadId: "t-owner-live-flow", userMessage: "Who has lomodos today?" });
assert.equal(ownerFirstReply.meta?.mode, "local_owner");
assert.equal(contexts.get("t-owner-live-flow")?.last_group_name, "Komodos");
assert.equal(contexts.get("t-owner-live-flow")?.last_subject_type, "group");
assert.equal(contexts.get("t-owner-live-flow")?.last_location_code ?? null, null);
const ownerFollowUpReply = await responder.generateReply({ threadId: "t-owner-live-flow", userMessage: "what about tomorrow?" });
assert.equal(ownerFollowUpReply.meta?.mode, "local_owner");
assert.match(ownerFollowUpReply.text, /Komodos: Tester Tomorrow/i);

setContext("t-employee", {
  last_intent: "employee_schedule",
  last_employee_name: "Tammy",
  last_service_date: "2026-05-11",
  last_subject_type: "employee",
  context_json: { last_question_shape: "employee_schedule" },
});
const employeeFollowUpReply = await responder.generateReply({ threadId: "t-employee", userMessage: "what about tomorrow?" });
assert.equal(employeeFollowUpReply.meta?.mode, "local_employee_work_status");
assert.match(employeeFollowUpReply.text, /Tammy is working on Tuesday, 2026-05-12/i);

assert.ok(saves.length >= 3);

console.log(JSON.stringify({ ok: true, smoke: "memphis-context passed" }, null, 2));
