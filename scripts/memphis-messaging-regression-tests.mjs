import assert from "node:assert/strict";
import { createMemphisResponder } from "../src/memphis-ai.js";
import { findLocationCode, hasLocationKeyword } from "../src/ai/memphis-ai-intent.js";

process.env.GEMINI_API_KEY = "";
process.env.MEMPHIS_GEMINI_API_KEY = "";
process.env.GOOGLE_API_KEY = "";
process.env.GOOGLE_GENAI_API_KEY = "";
process.env.EVENTS_GEMINI_API_KEY = "";

const THREAD_ID = "00000000-0000-0000-0000-000000000001";
const SERVICE_DATE = "2026-04-25";

const responder = createMemphisResponder({
  runReadOnlySql: async (sql) => {
    const query = String(sql || "");
    if (query.includes("msg_get_memphis_thread_context")) return [];
    if (query.includes("from public.msg_messages")) return [];
    if (query.includes("sch_service_date")) return [{ service_date: SERVICE_DATE }];
    return [];
  },
  runRpc: async (name) => {
    if (name === "tool_list_active_employees") {
      return [
        { display_name: "Tammy Example" },
        { display_name: "Brandon Example" },
        { display_name: "Haley Lejman" },
        { display_name: "Jennifer Sheffield" },
      ];
    }
    return null;
  },
});

async function diagnose(prompt) {
  return responder.diagnoseMessage({ userMessage: prompt, threadId: THREAD_ID });
}

const routeCases = [
  // Area ownership / location routing.
  { prompt: "Who has Aquarium today?", intent: "area_schedule" },
  { prompt: "Who covers Aquarium today?", intent: "area_schedule" },
  { prompt: "Aquarium today?", intent: "area_schedule" },
  { prompt: "Who has TETM right now?", intent: "area_schedule" },
  { prompt: "Current owner for Aquarium", intent: "area_schedule" },
  { prompt: "who got aquarium today", intent: "area_schedule" },

  // Employee/self/ops schedule routing.
  { prompt: "What is my schedule today?", intent: "my_schedule" },
  { prompt: "What do I have today?", intent: "my_schedule" },
  { prompt: "Where is Tammy assigned today?", intent: "employee_work_status" },
  { prompt: "What does Tammy have tomorrow?", intent: "employee_work_status" },
  { prompt: "Who does Brandon cover today?", intent: "employee_work_status" },
  { prompt: "Which ops managers work today?", intent: "ops_manager_schedule" },
  { prompt: "What days does Jennifer work?", intent: "ops_manager_schedule" },
  { prompt: "Is Haley working today?", intent: "ops_manager_schedule" },
  { prompt: "Which manager is on today?", intent: "ops_manager_schedule" },

  // Contact lookup: explicit contact/role lookup routes to contacts, schedule questions do not.
  { prompt: "What is Haley's number?", intent: "contacts" },
  { prompt: "Give me Jennifer Sheffield's phone number", intent: "contacts" },
  { prompt: "How do I reach Eric McKenney?", intent: "contacts" },
  { prompt: "Contact for facilities manager", intent: "contacts" },
  { prompt: "Who is the water quality manager?", intent: "contacts" },

  // Coverage, tickets, events, conversation.
  { prompt: "What is open today?", intent: "open_segments" },
  { prompt: "Any open segments at Aquarium?", intent: "open_segments" },
  { prompt: "Who can cover Teton?", intent: "coverage_candidates" },
  { prompt: "Best backup for Aquarium", intent: "coverage_candidates" },
  { prompt: "Why is Aquarium open?", intent: "open_segments" },
  { prompt: "Any open tickets at Teton?", intent: "tickets" },
  { prompt: "Open tickets for Aquarium", intent: "tickets" },
  { prompt: "What events are coming up?", intent: "events" },
  { prompt: "Anything at Event Center today?", intent: "events" },
  { prompt: "Anything open today?", intent: "open_segments" },
  { prompt: "Anything open at Aquarium?", intent: "open_segments" },
  { prompt: "Anything else?", intent: "generic" },
  { prompt: "Hey", intent: "generic" },
  { prompt: "You connected?", intent: "generic" },
];

for (const testCase of routeCases) {
  const diagnostic = await diagnose(testCase.prompt);
  assert.equal(
    diagnostic.route.intent,
    testCase.intent,
    `${testCase.prompt} should route to ${testCase.intent}, got ${diagnostic.route.intent}`
  );
}

const replyCases = [
  { prompt: "Anything at Event Center today?", intent: "events", mode: "local_events" },
  { prompt: "Anything open today?", intent: "open_segments", mode: "local_open_segments" },
  { prompt: "Anything open at Aquarium?", intent: "open_segments", mode: "local_open_segments" },
  { prompt: "Anything else?", intent: "generic", mode: "local_generic" },
];

for (const testCase of replyCases) {
  const reply = await responder.generateReply({ userMessage: testCase.prompt, threadId: THREAD_ID });
  assert.equal(
    reply.meta?.intent,
    testCase.intent,
    `${testCase.prompt} reply should annotate intent ${testCase.intent}, got ${reply.meta?.intent}`
  );
  assert.equal(
    reply.meta?.mode,
    testCase.mode,
    `${testCase.prompt} reply should use ${testCase.mode}, got ${reply.meta?.mode}`
  );
}

const eventCenterThreadId = "00000000-0000-0000-0000-000000000002";
const eventCenterResponder = createMemphisResponder({
  runReadOnlySql: async (sql) => {
    const query = String(sql || "");
    if (query.includes("msg_get_memphis_thread_context")) return [];
    if (query.includes("from public.msg_messages")) return [];
    if (query.includes("sch_service_date")) return [{ service_date: SERVICE_DATE }];
    if (query.includes("from public.location_groups")) {
      return [
        { location_group_id: "11111111-1111-1111-1111-111111111111", group_name: "Aquarium", group_code: "AQU", aliases: ["aquarium"] },
        { location_group_id: "22222222-2222-2222-2222-222222222222", group_name: "Event Center", group_code: "EC", aliases: ["event center", "ec"] },
      ];
    }
    if (query.includes("from public.v_memphis_area_schedule")) {
      const dateMatch = query.match(/service_date = '([^']+)'::date/);
      const serviceDate = dateMatch?.[1] || SERVICE_DATE;
      const eventCenterOnly = query.includes("22222222-2222-2222-2222-222222222222") || query.includes("Event Center") || query.includes("EC");
      const rows = [
        { service_date: serviceDate, location_group_id: "11111111-1111-1111-1111-111111111111", employee_name: "Aquarium Keeper", group_name: "Aquarium", group_code: "AQU", coverage_start: "07:00:00", coverage_end: "15:00:00", segment_number: 1 },
        { service_date: serviceDate, location_group_id: "22222222-2222-2222-2222-222222222222", employee_name: "Karen Robinson", group_name: "Event Center", group_code: "EC", coverage_start: "07:00:00", coverage_end: "15:00:00", segment_number: 1 },
        { service_date: serviceDate, location_group_id: "22222222-2222-2222-2222-222222222222", employee_name: "Karen Robinson", group_name: "Event Center", group_code: "EC", coverage_start: "07:00:00", coverage_end: "15:00:00", segment_number: 2 },
        { service_date: serviceDate, location_group_id: "22222222-2222-2222-2222-222222222222", employee_name: "Karen Robinson", group_name: "Event Center", group_code: "EC", coverage_start: "10:00:00", coverage_end: "12:00:00", segment_number: 3 },
        { service_date: serviceDate, location_group_id: "22222222-2222-2222-2222-222222222222", employee_name: "Michael McWright", group_name: "Event Center", group_code: "EC", coverage_start: "15:00:00", coverage_end: "21:00:00", segment_number: 4 },
      ];
      return eventCenterOnly ? rows.filter((row) => row.group_name === "Event Center") : rows;
    }
    if (query.includes("from public.events_app_events")) return [];
    return [];
  },
  runRpc: async () => null,
});

const eventCenterWeekly = await eventCenterResponder.generateReply({
  userMessage: "What custodians are assigned to event center each week?",
  threadId: eventCenterThreadId,
});
assert.equal(eventCenterWeekly.meta?.mode, "local_weekly_area_schedule", "Event Center weekly assignment questions should use area-filtered weekly schedule mode");
assert.ok(eventCenterWeekly.text.includes("Event Center"), "Event Center weekly answer should name Event Center");
assert.ok(eventCenterWeekly.text.includes("Karen Robinson"), "Event Center weekly answer should include assigned custodians");
assert.ok(!eventCenterWeekly.text.includes("Aquarium Keeper"), "Event Center weekly answer should not include unrelated areas");
assert.equal((eventCenterWeekly.text.match(/Karen Robinson 07:00-15:00/g) || []).length, 7, "Event Center weekly answer should collapse exact duplicate person/time segments per day");
assert.equal((eventCenterWeekly.text.match(/Karen Robinson 10:00-12:00/g) || []).length, 7, "Event Center weekly answer should preserve distinct time blocks for the same person");
assert.ok(eventCenterWeekly.text.length <= 1900, `Event Center weekly answer should fit message body limits, got ${eventCenterWeekly.text.length}`);
assert.match(eventCenterWeekly.text, /unless absence, PTO, or Coverall/i, "Event Center weekly answer should state normal schedule exception policy");

const eventCenterToday = await eventCenterResponder.generateReply({
  userMessage: "What custodians are assigned to event center today?",
  threadId: eventCenterThreadId,
});
assert.equal(eventCenterToday.meta?.mode, "local_area_schedule", "Event Center assignment questions should not be routed to upcoming events");
assert.ok(eventCenterToday.text.includes("Karen Robinson") || eventCenterToday.text.includes("Michael McWright"), "Event Center daily answer should include assignments");

const falseLocationCodeCases = [
  "What is Haley's number?",
  "Who is the water quality manager?",
  "Contact for facilities manager",
  "Which ops managers work today?",
];

for (const prompt of falseLocationCodeCases) {
  assert.equal(findLocationCode(prompt), "", `${prompt} should not produce a false location code`);
  assert.equal(hasLocationKeyword(prompt), false, `${prompt} should not match a location keyword`);
}

console.log(JSON.stringify({ ok: true, route_cases: routeCases.length, reply_cases: replyCases.length, false_location_code_cases: falseLocationCodeCases.length }, null, 2));
