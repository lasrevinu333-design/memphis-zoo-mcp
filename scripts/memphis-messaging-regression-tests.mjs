import assert from "node:assert/strict";
import express from "express";
import { createMemphisResponder } from "../src/memphis-ai.js";
import { createMessagingRouter } from "../src/messaging-api.js";
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

async function withServer(app, fn) {
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, () => resolve(listener));
  });
  try {
    const { port } = server.address();
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

const reminderReadCalls = [];
const reminderApp = express();
reminderApp.use(express.json());
reminderApp.use('/messaging-api', createMessagingRouter({
  runReadOnlySql: async (sql) => {
    reminderReadCalls.push(String(sql || ''));
    if (/from public\.msg_device_assignments/i.test(String(sql || '')) && /metadata_json->>'source'/i.test(String(sql || ''))) {
      return [{
        message_id: '00000000-0000-0000-0000-000000000099',
        thread_id: THREAD_ID,
        msg_user_id: '00000000-0000-0000-0000-000000000088',
        display_name: 'Event Owner',
        body: 'Two-day event reminder: Donor Dinner is scheduled in Event Center.',
        message_type: 'bot_response',
        metadata_json: { source: 'events_app', notification_kind: 'two_days_before' },
        sent_at: '2026-06-04T13:15:00Z',
        created_at: '2026-06-04T13:15:00Z',
        delivered_at: null,
        read_at: null,
      }];
    }
    return [];
  },
  runRpc: async () => null,
  buildHealthPayload: (area, extra) => ({ ok: true, area, ...extra }),
  appVersion: 'test',
  releaseId: 'test',
  contractVersion: 'messaging.v1',
}));

await withServer(reminderApp, async (baseUrl) => {
  const response = await fetch(`${baseUrl}/messaging-api/device-event-reminders?device_id=device-123&limit=2`);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.data.length, 1);
  assert.equal(payload.data[0].metadata_json.notification_kind, 'two_days_before');
});
const reminderSql = reminderReadCalls.find((sql) => /device_user/i.test(sql));
assert.ok(reminderSql, 'device event reminder route should query reminders by mapped device');
assert.match(reminderSql, /msg_device_assignments/, 'device reminder route should resolve the active device assignment');
assert.match(reminderSql, /metadata_json->>'source'.*= 'events_app'/s, 'device reminder route should only return event-app messages');
assert.match(reminderSql, /metadata_json->>'notification_kind'.*two_days_before.*day_before.*morning_of/s, 'device reminder route should only return the three event reminder kinds');
assert.match(reminderSql, /r\.read_at is null/, 'device reminder route should only return unread reminders');

const locationStatusReadCalls = [];
const locationStatusApp = express();
locationStatusApp.use(express.json());
locationStatusApp.use('/messaging-api', createMessagingRouter({
  runReadOnlySql: async (sql) => {
    const query = String(sql || '');
    locationStatusReadCalls.push(query);
    if (/select public\.sch_service_date\(now\(\)\) as service_date/i.test(query)) {
      return [{ service_date: SERVICE_DATE }];
    }
    if (/from public\.devices d/i.test(query) && /where d\.device_id = 'KIOSK_02'/i.test(query)) {
      return [{
        device_id: 'KIOSK_02',
        device_name: 'Alijah Collins phone',
        assigned_employee_id: '30000000-0000-0000-0000-000000000001',
        assigned_employee_name: 'Alijah Collins',
        employee_code: 'EMP001',
        role: 'employee',
        device_active: true,
        employee_active: true,
      }];
    }
    if (/with assigned_groups as/i.test(query) && /v_location_dashboard_status/i.test(query)) {
      return [{
        service_date: SERVICE_DATE,
        device_id: 'KIOSK_02',
        device_name: 'Alijah Collins phone',
        employee_id: '30000000-0000-0000-0000-000000000001',
        employee_name: 'Alijah Collins',
        employee_code: 'EMP001',
        location_group_id: '40000000-0000-0000-0000-000000000001',
        group_code: 'AQUARIUM',
        group_name: 'Aquarium',
        coverage_purpose: 'area_owner',
        location_id: '50000000-0000-0000-0000-000000000001',
        location_code: 'AQUA1',
        location_name: 'Aquarium Restroom',
        form_type: 'restroom',
        status_code: 'overdue',
        status_color: 'red',
        latest_completed_at: '2026-04-25T12:00:00Z',
        latest_completed_at_display: '04/25/2026 07:00 AM Central',
        open_session_status: null,
        open_session_started_at: null,
        open_session_started_at_display: null,
        last_scan_at: '2026-04-25T12:00:00Z',
        last_scan_at_display: '04/25/2026 07:00 AM Central',
      }];
    }
    return [];
  },
  runRpc: async () => null,
  buildHealthPayload: (area, extra) => ({ ok: true, area, ...extra }),
  appVersion: 'test',
  releaseId: 'test',
  contractVersion: 'messaging.v1',
}));

await withServer(locationStatusApp, async (baseUrl) => {
  const response = await fetch(`${baseUrl}/messaging-api/device-location-status-reminders?device_id=KIOSK_02&limit=2`);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.data.length, 1);
  assert.equal(payload.data[0].status_code, 'overdue');
  assert.equal(payload.data[0].location_code, 'AQUA1');
});
const locationStatusSql = locationStatusReadCalls.find((sql) => /with assigned_groups as/i.test(sql));
assert.ok(locationStatusSql, 'device location status reminder route should query assigned group location statuses');
assert.match(locationStatusSql, /sch_get_daily_schedule_with_purpose\('2026-04-25'::date\)/, 'location status reminder route should resolve the active service date');
assert.match(locationStatusSql, /coalesce\(s\.coverage_purpose, 'area_owner'\) <> 'reminder'/, 'location status reminder route should exclude reminder-only schedule groups');
assert.match(locationStatusSql, /location_group_memberships/, 'device location status reminder route should resolve real locations from group memberships');
assert.match(locationStatusSql, /status_code in \('overdue', 'due_soon'\)/, 'device location status reminder route should only return due soon or overdue locations');

const EMPLOYEE_USER_ID = '10000000-0000-0000-0000-000000000001';
const MANAGER_USER_ID = '10000000-0000-0000-0000-000000000002';
const DIRECT_THREAD_ID = '20000000-0000-0000-0000-000000000001';
const GROUP_THREAD_ID = '20000000-0000-0000-0000-000000000002';
const FOREIGN_DIRECT_THREAD_ID = '20000000-0000-0000-0000-000000000003';
const visibilityReadCalls = [];
let unexpectedGroupRpc = false;
const visibilityApp = express();
visibilityApp.use(express.json());
visibilityApp.use('/messaging-api', createMessagingRouter({
  runReadOnlySql: async (sql) => {
    const query = String(sql || '');
    visibilityReadCalls.push(query);
    if (query.includes("msg_get_user_by_device('KIOSK_04')")) {
      return [{ msg_user_id: EMPLOYEE_USER_ID, display_name: 'Tammy Miller', role: 'employee' }];
    }
    if (query.includes("msg_get_user_by_device('KIOSK_01')")) {
      return [{ msg_user_id: MANAGER_USER_ID, display_name: 'Ops Manager', role: 'manager' }];
    }
    if (query.includes('from public.msg_threads t') && query.includes('and tp.viewer_is_participant = true')) {
      return [{
        thread_id: DIRECT_THREAD_ID,
        updated_at: '2026-06-06T18:00:00Z',
        thread_type: 'direct',
        thread_title: 'Sherita Wilbon',
        unread_count: 1,
        last_message_at: '2026-06-06T18:00:00Z',
        last_message_id: '30000000-0000-0000-0000-000000000001',
        last_sender_name: 'Sherita Wilbon',
        last_message_body: 'Need cover at Aquarium?',
        last_message_type: 'text',
        participant_names: 'Sherita Wilbon, Tammy Miller',
        viewer_can_send: true,
      }, {
        thread_id: GROUP_THREAD_ID,
        updated_at: '2026-06-06T18:01:00Z',
        thread_type: 'group',
        thread_title: 'Custodial Team',
        unread_count: 1,
        last_message_at: '2026-06-06T18:01:00Z',
        last_message_id: '30000000-0000-0000-0000-000000000002',
        last_sender_name: 'Ops Manager',
        last_message_body: 'Broadcast test',
        last_message_type: 'text',
        participant_names: 'Kinnaye Peete, Sherita Wilbon, Tammy Miller',
        viewer_can_send: true,
      }];
    }
    if (query.includes('from public.msg_threads t')) {
      return [{
        thread_id: GROUP_THREAD_ID,
        updated_at: '2026-06-06T18:01:00Z',
        thread_type: 'group',
        thread_title: 'Everyone',
        unread_count: 0,
        last_message_at: '2026-06-06T18:01:00Z',
        last_message_id: '30000000-0000-0000-0000-000000000002',
        last_sender_name: 'Ops Manager',
        last_message_body: 'Broadcast test',
        last_message_type: 'text',
        participant_names: 'Kinnaye Peete, Sherita Wilbon, Tammy Miller',
        viewer_can_send: true,
      }, {
        thread_id: FOREIGN_DIRECT_THREAD_ID,
        updated_at: '2026-06-06T18:02:00Z',
        thread_type: 'direct',
        thread_title: 'Sherita Wilbon, Kinnaye Peete',
        unread_count: 0,
        last_message_at: '2026-06-06T18:02:00Z',
        last_message_id: '30000000-0000-0000-0000-000000000003',
        last_sender_name: 'Sherita Wilbon',
        last_message_body: 'Between Sherita and Kinnaye only',
        last_message_type: 'text',
        participant_names: 'Kinnaye Peete, Sherita Wilbon',
        viewer_can_send: false,
      }];
    }
    if (query.includes('from public.msg_messages m') && query.includes(GROUP_THREAD_ID)) {
      return [{
        id: '40000000-0000-0000-0000-000000000002',
        thread_id: GROUP_THREAD_ID,
        sender_user_id: MANAGER_USER_ID,
        sender_display_name: 'Ops Manager',
        message_type: 'text',
        body: 'Broadcast test',
        metadata_json: {},
        sent_at: '2026-06-06T18:01:00Z',
        created_at: '2026-06-06T18:01:00Z',
      }];
    }
    if (query.includes('from public.msg_messages m') && query.includes(FOREIGN_DIRECT_THREAD_ID)) {
      return [{
        id: '40000000-0000-0000-0000-000000000001',
        thread_id: FOREIGN_DIRECT_THREAD_ID,
        sender_user_id: '50000000-0000-0000-0000-000000000001',
        sender_display_name: 'Sherita Wilbon',
        message_type: 'text',
        body: 'Manager can audit this thread.',
        metadata_json: {},
        sent_at: '2026-06-06T18:02:00Z',
        created_at: '2026-06-06T18:02:00Z',
      }];
    }
    return [];
  },
  runRpc: async (name) => {
    if (name === 'msg_create_group_thread') unexpectedGroupRpc = true;
    return null;
  },
  buildHealthPayload: (area, extra) => ({ ok: true, area, ...extra }),
  appVersion: 'test',
  releaseId: 'test',
  contractVersion: 'messaging.v1',
}));

await withServer(visibilityApp, async (baseUrl) => {
  const employeeThreads = await fetch(`${baseUrl}/messaging-api/threads?user_id=${EMPLOYEE_USER_ID}&device_id=KIOSK_04`).then((r) => r.json());
  assert.equal(employeeThreads.ok, true);
  assert.equal(employeeThreads.data.length, 2, 'Employee devices should receive every thread they actually participate in, including group chats');
  assert.equal(employeeThreads.data[0].thread_type, 'direct');
  assert.equal(employeeThreads.data[0].thread_title, 'Sherita Wilbon');
  assert.equal(employeeThreads.data[1].thread_type, 'group');
  assert.equal(employeeThreads.data[1].thread_title, 'Custodial Team');

  const employeeGroupMessages = await fetch(`${baseUrl}/messaging-api/thread/${GROUP_THREAD_ID}/messages?user_id=${EMPLOYEE_USER_ID}&device_id=KIOSK_04&limit=50`).then((r) => r.json());
  assert.equal(employeeGroupMessages.ok, true);
  assert.equal(employeeGroupMessages.data.length, 1, 'Employee participants should be able to open their group thread messages');

  const managerThreads = await fetch(`${baseUrl}/messaging-api/threads?user_id=${MANAGER_USER_ID}&device_id=KIOSK_01`).then((r) => r.json());
  assert.equal(managerThreads.ok, true);
  assert.equal(managerThreads.data.length, 2, 'Manager overview devices should receive all visible threads');
  assert.equal(managerThreads.data[1].viewer_can_send, false, 'Foreign manager-audit threads must be read-only');

  const foreignMessages = await fetch(`${baseUrl}/messaging-api/thread/${FOREIGN_DIRECT_THREAD_ID}/messages?user_id=${MANAGER_USER_ID}&device_id=KIOSK_01&limit=50`).then((r) => r.json());
  assert.equal(foreignMessages.ok, true);
  assert.equal(foreignMessages.data.length, 1, 'Manager overview devices should be able to inspect foreign threads');

  const blockedGroup = await fetch(`${baseUrl}/messaging-api/thread/group`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      created_by_user_id: EMPLOYEE_USER_ID,
      device_id: 'KIOSK_04',
      title: 'Everyone',
      member_user_ids: ['50000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000002'],
    }),
  });
  assert.equal(blockedGroup.status, 400, 'Employee devices must be blocked from creating multi-person group threads');
});

assert.equal(unexpectedGroupRpc, false, 'Blocked employee group-thread attempts must not hit the create-group RPC');
const employeeThreadSql = visibilityReadCalls.find((sql) => sql.includes('from public.msg_threads t') && sql.includes('and tp.viewer_is_participant = true'));
assert.ok(employeeThreadSql, 'Employee thread list should stay participant-scoped at the API layer');
assert.doesNotMatch(employeeThreadSql, /t\.thread_type in \('direct', 'bot'\)/, 'Employee thread list must not hide participant group threads anymore');
const managerThreadSql = visibilityReadCalls.find((sql) => sql.includes('from public.msg_threads t') && !sql.includes('and tp.viewer_is_participant = true'));
assert.ok(managerThreadSql, 'Manager overview thread list should be allowed to inspect all threads');
const employeeGroupMessageSql = visibilityReadCalls.find((sql) => sql.includes(GROUP_THREAD_ID) && sql.includes('from public.msg_messages m'));
assert.ok(employeeGroupMessageSql, 'Employee participant group-message fetch should use the shared participant visibility query');
assert.doesNotMatch(employeeGroupMessageSql, /t\.thread_type in \('direct', 'bot'\)/, 'Employee participant message fetch must not hide group threads anymore');
const managerMessageSql = visibilityReadCalls.find((sql) => sql.includes(FOREIGN_DIRECT_THREAD_ID) && sql.includes('from public.msg_messages m'));
assert.ok(managerMessageSql, 'Manager overview message fetch should use the raw thread message visibility query');

console.log(JSON.stringify({ ok: true, route_cases: routeCases.length, reply_cases: replyCases.length, false_location_code_cases: falseLocationCodeCases.length, device_event_reminder_contract: true, device_location_status_reminder_contract: true, thread_visibility_contract: true }, null, 2));
