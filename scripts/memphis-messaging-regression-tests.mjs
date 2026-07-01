import assert from "node:assert/strict";
import express from "express";
import { createMemphisResponder } from "../src/memphis-ai.js";
import { createMessagingRouter } from "../src/messaging-api.js";
import { findLocationCode, hasLocationKeyword } from "../src/ai/memphis-ai-intent.js";
import { createDailyPinSession } from "../src/auth/daily-pin-auth.js";
import { createGeminiAdminSession } from "../src/auth/gemini-admin-auth.js";

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

const threadMetadataReadCalls = [];
const threadMetadataApp = express();
threadMetadataApp.use(express.json());
threadMetadataApp.use('/messaging-api', createMessagingRouter({
  runReadOnlySql: async (sql) => {
    const query = String(sql || '');
    threadMetadataReadCalls.push(query);
    if (/msg_get_user_by_device/i.test(query)) {
      return [{
        msg_user_id: '00000000-0000-0000-0000-000000000088',
        display_name: 'Event Owner',
        role: 'employee'
      }];
    }
    if (/thread_rows/i.test(query)) {
      assert.match(query, /last_message_metadata_json/, 'Thread list SQL must select last-message metadata for notification presentation fallback');
      return [{
        thread_id: THREAD_ID,
        thread_type: 'direct',
        thread_title: 'Ops Manager',
        unread_count: 1,
        last_message_id: '00000000-0000-0000-0000-000000000099',
        last_sender_name: 'Ops Manager',
        last_message_body: "Jennifer, demo assigned location alert: East Admin Women's Restroom is overdue on your route.",
        last_message_type: 'bot_response',
        last_message_metadata_json: {
          source: 'events_app',
          notification_kind: 'morning_of',
          presentation_demo: true,
          demo_alert_kind: 'location_status',
        },
        participant_names: 'Event Owner, Ops Manager',
        viewer_can_send: true,
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

await withServer(threadMetadataApp, async (baseUrl) => {
  const response = await fetch(`${baseUrl}/messaging-api/threads?device_id=device-123`);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.data.length, 1);
  assert.equal(payload.data[0].last_message_metadata_json.presentation_demo, true, 'Thread summary must expose presentation metadata so the phone can avoid generic Ops Manager TTS');
});
assert.ok(threadMetadataReadCalls.some((sql) => /last_message_metadata_json/i.test(sql)), 'Thread metadata fallback should be covered by thread SQL');

const reminderReadCalls = [];
const reminderApp = express();
reminderApp.use(express.json());
reminderApp.use('/messaging-api', createMessagingRouter({
  runReadOnlySql: async (sql) => {
    const query = String(sql || '');
    reminderReadCalls.push(query);
    if (/notification_state/i.test(query)) {
      return [{
        requested_device_id: 'device-123',
        device_id: 'device-123',
        msg_user_id: '00000000-0000-0000-0000-000000000088',
        display_name: 'Event Owner',
        role: 'employee',
        employee_id: '30000000-0000-0000-0000-000000000088',
        is_employee_device: true,
        notifications_silent: false,
        silent_reason: 'on_shift',
      }];
    }
    if (/from public\.msg_device_assignments/i.test(query) && /metadata_json->>'source'/i.test(query)) {
      return [{
        message_id: '00000000-0000-0000-0000-000000000099',
        thread_id: THREAD_ID,
        msg_user_id: '00000000-0000-0000-0000-000000000088',
        display_name: 'Event Owner',
        body: 'Two-day event reminder: Donor Dinner is scheduled in Event Center.',
        message_type: 'bot_response',
        metadata_json: { source: 'events_app', notification_kind: 'two_days_out' },
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
  assert.equal(payload.data[0].metadata_json.notification_kind, 'two_days_out');
});
const reminderSql = reminderReadCalls.find((sql) => /metadata_json->>'source'/i.test(sql));
assert.ok(reminderSql, 'device event reminder route should query reminders by mapped device after notification-state check');
assert.match(reminderSql, /msg_device_assignments/, 'device reminder route should resolve the active device assignment');
assert.match(reminderSql, /metadata_json->>'source'.*= 'events_app'/s, 'device reminder route should only return event-app messages');
assert.match(reminderSql, /metadata_json->>'notification_kind'.*day_of_event.*two_days_out.*three_days_out/s, 'device reminder route should return the current event reminder kinds');
assert.match(reminderSql, /metadata_json->>'notification_kind'.*two_days_before.*day_before.*morning_of/s, 'device reminder route should still honor legacy reminder kinds until old payloads age out');
assert.match(reminderSql, /r\.read_at is null/, 'device reminder route should only return unread reminders');

const notificationGuardReadCalls = [];
let notificationGuardQueriedMessages = false;
const notificationGuardApp = express();
notificationGuardApp.use(express.json());
notificationGuardApp.use('/messaging-api', createMessagingRouter({
  runReadOnlySql: async (sql) => {
    const query = String(sql || '');
    notificationGuardReadCalls.push(query);
    if (/notification_state/i.test(query)) {
      return [{
        requested_device_id: 'KIOSK_99',
        device_id: 'KIOSK_99',
        device_name: 'Off Shift Employee',
        msg_user_id: '00000000-0000-0000-0000-000000000077',
        display_name: 'Off Shift Employee',
        role: 'employee',
        employee_id: '30000000-0000-0000-0000-000000000099',
        employee_name: 'Off Shift Employee',
        service_date: SERVICE_DATE,
        local_now: `${SERVICE_DATE}T07:30:00`,
        shift_start: '08:30:00',
        shift_end: '17:30:00',
        shift_start_local: `${SERVICE_DATE}T08:30:00`,
        shift_end_local: `${SERVICE_DATE}T17:30:00`,
        is_employee_device: true,
        override_enabled: false,
        notifications_silent: true,
        silent_reason: 'scheduled_shift_not_started',
      }];
    }
    if (/metadata_json->>'source'/i.test(query) || /v_location_dashboard_status/i.test(query)) {
      notificationGuardQueriedMessages = true;
    }
    return [];
  },
  runRpc: async () => null,
  buildHealthPayload: (area, extra) => ({ ok: true, area, ...extra }),
  appVersion: 'test',
  releaseId: 'test',
  contractVersion: 'messaging.v1',
}));

await withServer(notificationGuardApp, async (baseUrl) => {
  const response = await fetch(`${baseUrl}/messaging-api/device-event-reminders?device_id=KIOSK_99&limit=2`);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.data, [], 'Off-shift employee devices should receive no event reminder payloads');
  assert.equal(payload.meta.notification_state.notifications_silent, true);
  assert.equal(payload.meta.notification_state.silent_reason, 'scheduled_shift_not_started');
  assert.equal(Object.prototype.hasOwnProperty.call(payload.meta.notification_state, 'employee_name'), false, 'Public reminder metadata must not expose employee identity');
  assert.equal(Object.prototype.hasOwnProperty.call(payload.meta.notification_state, 'shift_start'), false, 'Public reminder metadata must not expose shift times');

  const publicStateResponse = await fetch(`${baseUrl}/messaging-api/device-notification-state?device_id=KIOSK_99&local_now=${encodeURIComponent(`${SERVICE_DATE}T07:30:00`)}`);
  assert.equal(publicStateResponse.status, 404, 'Raw device notification state must not be exposed as a public unauthenticated route');
});
assert.equal(notificationGuardQueriedMessages, true, 'Off-shift notification guard may query only presentation-demo reminders so staged tests still play after hours');
const offShiftReminderSql = notificationGuardReadCalls.find((sql) => /metadata_json->>'source'/i.test(sql));
assert.ok(offShiftReminderSql, 'Off-shift devices should still check for explicitly targeted presentation demo payloads');
assert.match(offShiftReminderSql, /metadata_json->>'presentation_demo'/, 'Off-shift reminder query must be constrained to presentation demo payloads');
assert.match(offShiftReminderSql, /metadata_json->>'target_device_id'/, 'Presentation demo bypass must stay scoped to the target device');
const notificationStateSql = notificationGuardReadCalls.find((sql) => /notification_state/i.test(sql));
assert.ok(notificationStateSql, 'Notification guard should query device notification state');
assert.match(notificationStateSql, /p\.local_now < \(p\.service_date \+ r\.shift_start\)/, 'Notification guard should silence employee devices before shift start');
assert.match(notificationStateSql, /p\.local_now >= \(p\.service_date \+ r\.shift_end\)/, 'Notification guard should silence employee devices after shift end');
assert.match(notificationStateSql, /when r\.id is null then true/, 'Notification guard should silence employee devices with no active roster shift');
assert.match(notificationStateSql, /when r\.shift_start is null or r\.shift_end is null then true/, 'Notification guard should silence employee devices with invalid roster shift windows');
assert.match(notificationStateSql, /invalid_roster_shift_window/, 'Notification guard should report invalid roster shift windows');
assert.match(notificationStateSql, /when i\.employee_id is null then true/, 'Notification guard should fail closed for employee devices with no employee mapping');
assert.match(notificationStateSql, /not in \('manager', 'bot', 'ops', 'ops_manager', 'operations_manager'\)/, 'Notification guard should not silence manager/bot/ops devices by shift state');
assert.match(notificationStateSql, /scheduled_shift_not_started/, 'Notification guard should report before-shift silence reason');

const managerDeviceReminderReadCalls = [];
let managerDeviceReminderQueriedMessages = false;
const managerDeviceReminderApp = express();
managerDeviceReminderApp.use(express.json());
managerDeviceReminderApp.use('/messaging-api', createMessagingRouter({
  runReadOnlySql: async (sql) => {
    const query = String(sql || '');
    managerDeviceReminderReadCalls.push(query);
    if (/notification_state/i.test(query)) {
      return [{
        requested_device_id: 'KIOSK_01',
        device_id: 'KIOSK_01',
        device_name: 'Ops Manager phone',
        msg_user_id: '00000000-0000-0000-0000-000000000001',
        display_name: 'Ops Manager',
        role: 'manager',
        employee_id: null,
        is_employee_device: false,
        notifications_silent: false,
        silent_reason: 'not_employee_device',
      }];
    }
    if (/metadata_json->>'source'/i.test(query)) {
      managerDeviceReminderQueriedMessages = true;
      return [{
        message_id: '00000000-0000-0000-0000-000000000099',
        thread_id: THREAD_ID,
        msg_user_id: '00000000-0000-0000-0000-000000000001',
        display_name: 'Ops Manager',
        body: 'Demo event reminder should not ring the manager overview phone.',
        message_type: 'bot_response',
        metadata_json: { source: 'events_app', notification_kind: 'morning_of', presentation_demo: true },
        sent_at: '2026-06-11T03:55:00Z',
        created_at: '2026-06-11T03:55:00Z',
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

await withServer(managerDeviceReminderApp, async (baseUrl) => {
  const response = await fetch(`${baseUrl}/messaging-api/device-event-reminders?device_id=KIOSK_01&limit=5`);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.data, [], 'Manager/ops overview devices should never receive phone event-reminder payloads');
  assert.equal(payload.meta.notification_state.silent_reason, 'not_employee_device');
});
assert.equal(managerDeviceReminderQueriedMessages, false, 'Manager/ops overview reminder guard must stop before querying reminder payloads');
assert.ok(managerDeviceReminderReadCalls.find((sql) => /notification_state/i.test(sql)), 'Manager/ops reminder guard should query notification state');

const presentationDemoOffShiftReadCalls = [];
const presentationDemoOffShiftApp = express();
presentationDemoOffShiftApp.use(express.json());
presentationDemoOffShiftApp.use('/messaging-api', createMessagingRouter({
  runReadOnlySql: async (sql) => {
    const query = String(sql || '');
    presentationDemoOffShiftReadCalls.push(query);
    if (/notification_state/i.test(query)) {
      return [{
        requested_device_id: 'KIOSK_03',
        device_id: 'KIOSK_03',
        device_name: 'Leadership demo phone',
        msg_user_id: '00000000-0000-0000-0000-000000000033',
        display_name: 'Jennifer Sheffield',
        role: 'admin',
        employee_id: '30000000-0000-0000-0000-000000000033',
        employee_name: 'Jennifer Sheffield',
        is_employee_device: true,
        notifications_silent: true,
        silent_reason: 'no_active_roster_shift',
      }];
    }
    if (/metadata_json->>'source'/i.test(query)) {
      assert.match(query, /metadata_json->>'presentation_demo'/, 'Silent demo query must only fetch presentation demos');
      return [{
        message_id: '00000000-0000-0000-0000-000000000033',
        thread_id: THREAD_ID,
        msg_user_id: '00000000-0000-0000-0000-000000000033',
        display_name: 'Jennifer Sheffield',
        body: "Jennifer, demo assigned location alert: East Admin Women's Restroom is overdue on your route.",
        message_type: 'bot_response',
        metadata_json: {
          source: 'events_app',
          notification_kind: 'morning_of',
          presentation_demo: true,
          demo_alert_kind: 'location_status',
          target_device_id: 'KIOSK_03',
          location_name: "East Admin Women's Restroom",
          status_code: 'overdue'
        },
        sent_at: '2026-06-11T03:37:45Z',
        created_at: '2026-06-11T03:37:45Z',
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

await withServer(presentationDemoOffShiftApp, async (baseUrl) => {
  const response = await fetch(`${baseUrl}/messaging-api/device-event-reminders?device_id=KIOSK_03&limit=2`);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.meta.notification_state.notifications_silent, true);
  assert.equal(payload.meta.notification_state.silent_reason, 'no_active_roster_shift');
  assert.equal(payload.data.length, 1, 'Explicit presentation demo reminders must still be returned after hours/no roster so demo phones play the real alert body');
  assert.equal(payload.data[0].metadata_json.presentation_demo, true);
  assert.equal(payload.data[0].metadata_json.demo_alert_kind, 'location_status');
});
assert.ok(presentationDemoOffShiftReadCalls.some((sql) => /metadata_json->>'presentation_demo'/i.test(sql)), 'Presentation demo bypass should be covered by SQL guard');

const missingEmployeeMappingReadCalls = [];
let missingEmployeeMappingQueriedMessages = false;
const missingEmployeeMappingApp = express();
missingEmployeeMappingApp.use(express.json());
missingEmployeeMappingApp.use('/messaging-api', createMessagingRouter({
  runReadOnlySql: async (sql) => {
    const query = String(sql || '');
    missingEmployeeMappingReadCalls.push(query);
    if (/notification_state/i.test(query)) {
      return [{
        requested_device_id: 'KIOSK_UNMAPPED',
        device_id: 'KIOSK_UNMAPPED',
        role: 'employee',
        employee_id: null,
        is_employee_device: true,
        notifications_silent: true,
        silent_reason: 'no_employee_mapping',
      }];
    }
    if (/metadata_json->>'source'/i.test(query)) missingEmployeeMappingQueriedMessages = true;
    return [];
  },
  runRpc: async () => null,
  buildHealthPayload: (area, extra) => ({ ok: true, area, ...extra }),
  appVersion: 'test',
  releaseId: 'test',
  contractVersion: 'messaging.v1',
}));

await withServer(missingEmployeeMappingApp, async (baseUrl) => {
  const response = await fetch(`${baseUrl}/messaging-api/device-event-reminders?device_id=KIOSK_UNMAPPED&limit=2`);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(payload.data, [], 'Employee devices with no employee mapping should fail closed');
  assert.equal(payload.meta.notification_state.notifications_silent, true);
  assert.equal(payload.meta.notification_state.silent_reason, 'no_employee_mapping');
});
assert.equal(missingEmployeeMappingQueriedMessages, false, 'Unmapped employee devices must not query reminder payloads');

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
    if (/notification_state/i.test(query)) {
      return [{
        requested_device_id: 'KIOSK_02',
        device_id: 'KIOSK_02',
        role: 'employee',
        employee_id: '30000000-0000-0000-0000-000000000001',
        is_employee_device: true,
        notifications_silent: false,
        silent_reason: 'on_shift',
      }];
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
  assert.equal(payload.meta.notification_state.notifications_silent, false);
  assert.equal(Object.prototype.hasOwnProperty.call(payload.meta.notification_state, 'employee_name'), false, 'Location reminder metadata must not expose employee identity');
  assert.equal(Object.prototype.hasOwnProperty.call(payload.meta.notification_state, 'shift_start'), false, 'Location reminder metadata must not expose shift times');
});
const locationStatusSql = locationStatusReadCalls.find((sql) => /with assigned_groups as/i.test(sql));
assert.ok(locationStatusSql, 'device location status reminder route should query assigned group location statuses');
assert.match(locationStatusSql.trimStart(), /^select\s+\*/i, 'device location status reminder SQL must begin with SELECT because the live read-only RPC rejects top-level WITH queries');
assert.match(locationStatusSql, /sch_get_daily_schedule_with_purpose\('2026-04-25'::date\)/, 'location status reminder route should resolve the active service date');
assert.match(locationStatusSql, /coalesce\(s\.coverage_purpose, 'area_owner'\) <> 'reminder'/, 'location status reminder route should exclude reminder-only schedule groups');
assert.match(locationStatusSql, /location_group_memberships/, 'device location status reminder route should resolve real locations from group memberships');
assert.match(locationStatusSql, /status_code in \('overdue', 'due_soon'\)/, 'device location status reminder route should only return due soon or overdue locations');
const locationNotificationStateSql = locationStatusReadCalls.find((sql) => /notification_state/i.test(sql));
assert.ok(locationNotificationStateSql, 'location status reminder route should query notification state before payload rows');
assert.match(locationNotificationStateSql, /'30000000-0000-0000-0000-000000000001'::uuid as employee_id/, 'location notification guard must be scoped to the same device-assigned employee used for payload rows');

const locationGuardReadCalls = [];
let locationGuardQueriedStatuses = false;
const locationGuardApp = express();
locationGuardApp.use(express.json());
locationGuardApp.use('/messaging-api', createMessagingRouter({
  runReadOnlySql: async (sql) => {
    const query = String(sql || '');
    locationGuardReadCalls.push(query);
    if (/from public\.devices d/i.test(query) && /where d\.device_id = 'KIOSK_99'/i.test(query) && !/notification_state/i.test(query)) {
      return [{
        device_id: 'KIOSK_99',
        device_name: 'Off Shift Employee phone',
        assigned_employee_id: '30000000-0000-0000-0000-000000000099',
        assigned_employee_name: 'Off Shift Employee',
        employee_code: 'EMP099',
        role: 'employee',
        device_active: true,
        employee_active: true,
      }];
    }
    if (/notification_state/i.test(query)) {
      return [{
        requested_device_id: 'KIOSK_99',
        device_id: 'KIOSK_99',
        role: 'employee',
        employee_id: '30000000-0000-0000-0000-000000000099',
        is_employee_device: true,
        notifications_silent: true,
        silent_reason: 'scheduled_shift_ended',
      }];
    }
    if (/v_location_dashboard_status/i.test(query)) locationGuardQueriedStatuses = true;
    return [];
  },
  runRpc: async () => null,
  buildHealthPayload: (area, extra) => ({ ok: true, area, ...extra }),
  appVersion: 'test',
  releaseId: 'test',
  contractVersion: 'messaging.v1',
}));

await withServer(locationGuardApp, async (baseUrl) => {
  const response = await fetch(`${baseUrl}/messaging-api/device-location-status-reminders?device_id=KIOSK_99&service_date=${SERVICE_DATE}&limit=2`);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(payload.data, [], 'Off-shift employee devices should receive no location reminder payloads');
  assert.equal(payload.meta.notification_state.notifications_silent, true);
  assert.equal(payload.meta.notification_state.silent_reason, 'scheduled_shift_ended');
});
assert.equal(locationGuardQueriedStatuses, false, 'Off-shift location reminder guard must stop before querying location statuses');
assert.ok(locationGuardReadCalls.find((sql) => /notification_state/i.test(sql)), 'Location reminder guard should query notification state');

const locationMismatchReadCalls = [];
let locationMismatchQueriedStatuses = false;
const locationMismatchApp = express();
locationMismatchApp.use(express.json());
locationMismatchApp.use('/messaging-api', createMessagingRouter({
  runReadOnlySql: async (sql) => {
    const query = String(sql || '');
    locationMismatchReadCalls.push(query);
    if (/from public\.devices d/i.test(query) && /where d\.device_id = 'KIOSK_MISMATCH'/i.test(query) && !/notification_state/i.test(query)) {
      return [{
        device_id: 'KIOSK_MISMATCH',
        device_name: 'Mismatched Employee phone',
        assigned_employee_id: '30000000-0000-0000-0000-000000000010',
        assigned_employee_name: 'Payload Employee',
        employee_code: 'EMP010',
        role: 'employee',
        device_active: true,
        employee_active: true,
      }];
    }
    if (/notification_state/i.test(query)) {
      return [{
        requested_device_id: 'KIOSK_MISMATCH',
        device_id: 'KIOSK_MISMATCH',
        role: 'employee',
        employee_id: '30000000-0000-0000-0000-000000000099',
        is_employee_device: true,
        notifications_silent: false,
        silent_reason: 'on_shift',
      }];
    }
    if (/v_location_dashboard_status/i.test(query)) locationMismatchQueriedStatuses = true;
    return [];
  },
  runRpc: async () => null,
  buildHealthPayload: (area, extra) => ({ ok: true, area, ...extra }),
  appVersion: 'test',
  releaseId: 'test',
  contractVersion: 'messaging.v1',
}));

await withServer(locationMismatchApp, async (baseUrl) => {
  const response = await fetch(`${baseUrl}/messaging-api/device-location-status-reminders?device_id=KIOSK_MISMATCH&service_date=${SERVICE_DATE}&limit=2`);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(payload.data, [], 'Location reminders should fail closed if notification-state employee differs from payload employee');
  assert.equal(payload.meta.notification_state.notifications_silent, true);
  assert.equal(payload.meta.notification_state.silent_reason, 'device_assignment_mismatch');
});
assert.equal(locationMismatchQueriedStatuses, false, 'Mismatched location reminder guard must stop before querying location statuses');
assert.ok(locationMismatchReadCalls.find((sql) => /'30000000-0000-0000-0000-000000000010'::uuid as employee_id/i.test(sql)), 'Mismatch guard should ask notification state for the payload employee id');

const offShiftThreadReadCalls = [];
const offShiftThreadsApp = express();
offShiftThreadsApp.use(express.json());
offShiftThreadsApp.use('/messaging-api', createMessagingRouter({
  runReadOnlySql: async (sql) => {
    const query = String(sql || '');
    offShiftThreadReadCalls.push(query);
    if (/msg_get_user_by_device\('KIOSK_99'\)/i.test(query)) {
      return [{ msg_user_id: '10000000-0000-0000-0000-000000009999', display_name: 'Off Shift Employee', role: 'employee' }];
    }
    if (/msg_get_user_by_device\('KIOSK_ON'\)/i.test(query)) {
      return [{ msg_user_id: '10000000-0000-0000-0000-000000009998', display_name: 'On Shift Employee', role: 'employee' }];
    }
    if (/msg_get_user_by_device\('KIOSK_01'\)/i.test(query)) {
      return [{ msg_user_id: '10000000-0000-0000-0000-000000000002', display_name: 'Ops Manager', role: 'manager' }];
    }
    if (/notification_state/i.test(query)) {
      if (/KIOSK_ON/i.test(query)) {
        return [{
          requested_device_id: 'KIOSK_ON',
          device_id: 'KIOSK_ON',
          role: 'employee',
          employee_id: '30000000-0000-0000-0000-000000000098',
          is_employee_device: true,
          notifications_silent: false,
          silent_reason: 'on_shift',
        }];
      }
      if (/KIOSK_01/i.test(query)) {
        return [{
          requested_device_id: 'KIOSK_01',
          device_id: 'KIOSK_01',
          role: 'manager',
          employee_id: null,
          is_employee_device: false,
          notifications_silent: false,
          silent_reason: 'not_employee_device',
        }];
      }
      return [{
        requested_device_id: 'KIOSK_99',
        device_id: 'KIOSK_99',
        role: 'employee',
        employee_id: '30000000-0000-0000-0000-000000000099',
        is_employee_device: true,
        notifications_silent: true,
        silent_reason: 'scheduled_shift_ended',
      }];
    }
    if (/from public\.msg_threads t/i.test(query)) {
      return [{
        thread_id: '20000000-0000-0000-0000-000000009999',
        updated_at: '2026-06-11T04:00:00Z',
        thread_type: 'group',
        thread_title: 'Custodial Team',
        unread_count: 2,
        last_message_at: '2026-06-11T04:00:00Z',
        last_message_id: '30000000-0000-0000-0000-000000009999',
        last_sender_name: 'Ops Manager',
        last_message_body: 'Test',
        last_message_type: 'text',
        participant_names: 'Custodial Team',
        viewer_can_send: true,
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

await withServer(offShiftThreadsApp, async (baseUrl) => {
  const onShiftResponse = await fetch(`${baseUrl}/messaging-api/threads?user_id=10000000-0000-0000-0000-000000009998&device_id=KIOSK_ON`);
  assert.equal(onShiftResponse.status, 200);
  const onShiftPayload = await onShiftResponse.json();
  assert.equal(onShiftPayload.ok, true);
  assert.equal(onShiftPayload.data[0].unread_count, 2, 'On-shift employee devices should preserve unread counts so live phone alerts can work');
  assert.equal(onShiftPayload.meta.notification_state.notifications_silent, false);

  const response = await fetch(`${baseUrl}/messaging-api/threads?user_id=10000000-0000-0000-0000-000000009999&device_id=KIOSK_99`);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.data.length, 1, 'Off-shift devices should still be able to load their thread list');
  assert.equal(payload.data[0].thread_title, 'Custodial Team');
  assert.equal(payload.data[0].unread_count, 0, 'Off-shift phone notification polling must not expose unread counts that trigger TTS alerts');
  assert.equal(payload.meta.notification_state.notifications_silent, true);
  assert.equal(payload.meta.notification_state.silent_reason, 'scheduled_shift_ended');

  const managerResponse = await fetch(`${baseUrl}/messaging-api/threads?user_id=10000000-0000-0000-0000-000000000002&device_id=KIOSK_01`);
  assert.equal(managerResponse.status, 200);
  const managerPayload = await managerResponse.json();
  assert.equal(managerPayload.ok, true);
  assert.equal(managerPayload.data[0].unread_count, 0, 'Manager/ops overview devices should not expose phone-alert unread counts through the polling thread route');
  assert.equal(managerPayload.meta.notification_state.notifications_silent, true);
  assert.equal(managerPayload.meta.notification_state.silent_reason, 'not_employee_device');
});
assert.ok(offShiftThreadReadCalls.find((sql) => /notification_state/i.test(sql)), 'Thread list should query notification state before returning unread counts to device pollers');

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

let deleteThreadRpcCall = null;
let permanentDeleteTriggered = false;
const deleteThreadApp = express();
deleteThreadApp.use(express.json());
deleteThreadApp.use('/messaging-api', createMessagingRouter({
  runReadOnlySql: async (sql) => {
    const query = String(sql || '');
    if (/msg_get_user_by_device\('KIOSK_04'\)/i.test(query)) {
      return [{ msg_user_id: EMPLOYEE_USER_ID, display_name: 'Tammy Miller', role: 'employee' }];
    }
    if (/from public\.msg_thread_participants/i.test(query)) {
      return [{ '?column?': 1 }];
    }
    return [];
  },
  runRpc: async (name, params) => {
    if (name === 'msg_delete_thread_permanently') permanentDeleteTriggered = true;
    if (name === 'msg_mark_thread_deleted') {
      deleteThreadRpcCall = { name, params };
      return { ok: true };
    }
    return null;
  },
  buildHealthPayload: (area, extra) => ({ ok: true, area, ...extra }),
  appVersion: 'test',
  releaseId: 'test',
  contractVersion: 'messaging.v1',
}));

await withServer(deleteThreadApp, async (baseUrl) => {
  const response = await fetch(`${baseUrl}/messaging-api/thread/${DIRECT_THREAD_ID}/delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device_id: 'KIOSK_04' }),
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.ok, true);
});

assert.equal(permanentDeleteTriggered, false, 'Device thread delete must not permanently erase shared message history');
assert.deepEqual(deleteThreadRpcCall, {
  name: 'msg_mark_thread_deleted',
  params: {
    p_thread_id: DIRECT_THREAD_ID,
    p_user_id: EMPLOYEE_USER_ID,
    p_device_identifier: 'KIOSK_04',
  },
}, 'Device thread delete should mark the thread deleted for the viewer/device only');

const originalAuthEnv = {
  OPS_MANAGER_AUTH_DISABLED: process.env.OPS_MANAGER_AUTH_DISABLED,
  OPS_MANAGER_DAILY_PIN: process.env.OPS_MANAGER_DAILY_PIN,
  CUSTODIAN_DAILY_PIN: process.env.CUSTODIAN_DAILY_PIN,
  PIN_SESSION_SECRET: process.env.PIN_SESSION_SECRET,
  MOXIE_WEB_PASSWORD: process.env.MOXIE_WEB_PASSWORD,
  MOXIE_COOKIE_SECRET: process.env.MOXIE_COOKIE_SECRET,
};
process.env.OPS_MANAGER_AUTH_DISABLED = 'false';
process.env.OPS_MANAGER_DAILY_PIN = '1234';
process.env.CUSTODIAN_DAILY_PIN = '9999';
process.env.PIN_SESSION_SECRET = 'memphis-test-secret';
process.env.MOXIE_WEB_PASSWORD = 'memzoo';
process.env.MOXIE_COOKIE_SECRET = 'memphis-test-cookie-secret';

const adminAuditReadCalls = [];
const adminAuditRpcCalls = [];
const adminAuditApp = express();
adminAuditApp.use(express.json());
adminAuditApp.use('/messaging-api', createMessagingRouter({
  runReadOnlySql: async (sql) => {
    const query = String(sql || '');
    adminAuditReadCalls.push(query);
    if (/v_admin_health_snapshot/i.test(query)) return [{ snapshot_at: '2026-07-01T15:00:00Z', open_ticket_count: 2, overdue_locations: 1, due_soon_locations: 3, in_progress_locations: 4 }];
    if (/current_attendance_state/i.test(query)) return [{ attendance: 1234, source: 'test', updated_at: '2026-07-01T15:00:00Z', age_minutes: 12 }];
    if (/active_device_count/i.test(query)) return [{ active_device_count: 10, missing_messenger_assignment_count: 0, inactive_or_missing_user_count: 0, employee_mismatch_count: 1, stale_seen_count: 2 }];
    if (/as issue/i.test(query) && /public\.devices/i.test(query)) return [{ device_id: 'KIOSK_05', device_employee_name: 'Daniel', msg_display_name: 'Someone Else', issue: 'employee_mismatch' }];
    if (/total_message_count/i.test(query)) return [{ total_message_count: 2200, older_than_90d_count: 1300, deleted_message_count: 0, oldest_message_at: '2026-01-01T00:00:00Z', newest_message_at: '2026-07-01T15:00:00Z' }];
    if (/run_count_14d/i.test(query)) return [{ run_count_14d: 8, error_run_count: 0, hard_violation_run_count: 0, open_required_run_count: 1 }];
    if (/from public\.schedule_generation_runs/i.test(query)) return [{ service_date: '2026-07-01', status: 'published', hard_violation_count: 0, open_required_count: 1, updated_at: '2026-07-01T14:00:00Z' }];
    if (/v_location_dashboard_status/i.test(query)) return [{ location_code: 'AQU', location_name: 'Aquarium', status_code: 'overdue', status_color: 'red', open_ticket_count: 2, open_session_status: 'none' }];
    if (/v_memphis_open_segments/i.test(query)) return [{ service_date: '2026-07-01', group_code: 'TETON', group_name: 'Teton', coverage_start: '12:00', coverage_end: '15:00', reason_open: 'absence' }];
    return [];
  },
  runRpc: async (name, params) => {
    adminAuditRpcCalls.push({ name, params });
    return null;
  },
  buildHealthPayload: (area, extra) => ({ ok: true, area, ...extra }),
  appVersion: 'test',
  releaseId: 'test',
  contractVersion: 'messaging.v1',
}));

const opsAuditSession = createDailyPinSession({ pin: '1234', deviceId: 'OPS_DEVICE', requiredRole: 'ops_manager' });
const custodianAuditSession = createDailyPinSession({ pin: '9999', deviceId: 'OPS_DEVICE' });
const geminiAuditSession = createGeminiAdminSession();

await withServer(adminAuditApp, async (baseUrl) => {
  const noAuth = await fetch(`${baseUrl}/messaging-api/memphis/admin/audit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body: 'audit everything', device_id: 'OPS_DEVICE' }),
  });
  assert.equal(noAuth.status, 401, 'Gemini admin audit must require the Gemini password token');

  const custodianAuth = await fetch(`${baseUrl}/messaging-api/memphis/admin/audit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${custodianAuditSession.token}`, 'X-Device-Id': 'OPS_DEVICE' },
    body: JSON.stringify({ body: 'audit everything', device_id: 'OPS_DEVICE' }),
  });
  assert.equal(custodianAuth.status, 401, 'Custodian daily PIN sessions must not access Gemini admin audit');

  const opsAuth = await fetch(`${baseUrl}/messaging-api/memphis/admin/audit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opsAuditSession.token}`, 'X-Device-Id': 'OPS_DEVICE' },
    body: JSON.stringify({ body: 'Run audits, drift checks, stale-data checks, and ops-efficiency recommendations.', device_id: 'OPS_DEVICE' }),
  });
  assert.equal(opsAuth.status, 401, 'Ops-manager PIN sessions must not bypass the Gemini password gate');

  const geminiAuth = await fetch(`${baseUrl}/messaging-api/memphis/admin/audit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${geminiAuditSession.token}`, 'X-Device-Id': 'OPS_DEVICE' },
    body: JSON.stringify({ body: 'Run audits, drift checks, stale-data checks, and ops-efficiency recommendations.', device_id: 'OPS_DEVICE' }),
  });
  assert.equal(geminiAuth.status, 200, 'Gemini password session should access read-only Gemini admin audit');
  const payload = await geminiAuth.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.meta.read_only, true);
  assert.equal(payload.data.diagnostics.route.intent, 'admin_upkeep_audit');
  assert.match(payload.data.report, /Device \/ employee drift/i);
  assert.match(payload.data.report, /Old message data/i);
  assert.match(payload.data.report, /Schedule operations/i);
  assert.match(payload.data.report, /Dashboard attention/i);
  assert.match(payload.data.report, /Change control: this console can recommend upkeep only/i);
});

assert.equal(adminAuditRpcCalls.length, 0, 'Read-only Gemini admin audit must not call write-capable RPC helpers');
assert.ok(adminAuditReadCalls.some((sql) => /v_admin_health_snapshot/i.test(sql)), 'Admin audit should inspect dashboard health snapshot');
assert.ok(adminAuditReadCalls.some((sql) => /current_attendance_state/i.test(sql)), 'Admin audit should inspect attendance freshness');
assert.ok(adminAuditReadCalls.some((sql) => /msg_messages/i.test(sql) && /older_than_90d/i.test(sql)), 'Admin audit should inspect stale Messenger data');
assert.ok(adminAuditReadCalls.some((sql) => /schedule_generation_runs/i.test(sql)), 'Admin audit should inspect schedule run health');

for (const [key, value] of Object.entries(originalAuthEnv)) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

console.log(JSON.stringify({ ok: true, route_cases: routeCases.length, reply_cases: replyCases.length, false_location_code_cases: falseLocationCodeCases.length, device_event_reminder_contract: true, off_shift_notification_guard_contract: true, off_shift_location_notification_guard_contract: true, location_identity_mismatch_guard_contract: true, device_location_status_reminder_contract: true, thread_visibility_contract: true, admin_audit_contract: true }, null, 2));
