import assert from "node:assert/strict";
import express from "express";
import { createEventMaintenanceController, createEventsAdminRouter } from "../src/events-api.js";

const TEST_GROUP_ID = "00000000-0000-4000-8000-000000000001";

function buildApp({ writeCalls = [], readCalls = [] } = {}) {
  const app = express();
  app.use(express.json());
  app.use("/admin-api/events", createEventsAdminRouter({
    runReadOnlySql: async (sql) => {
      readCalls.push(String(sql || ""));
      return [
        {
          location_group_id: TEST_GROUP_ID,
          group_code: "EC",
          group_name: "Event Center",
          included_locations: ["Event Center", "EC"],
        },
      ];
    },
    runWriteSql: async (name, sql) => {
      writeCalls.push({ name, sql });
      return [];
    },
    buildHealthPayload: (area, extra) => ({ ok: true, area, ...extra }),
    appVersion: "test",
    releaseId: "test",
    maintenanceController: { kick() {} },
    requireAdminApiAuth: (_req, _res, next) => next(),
  }));
  return app;
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

await withServer(buildApp(), async (baseUrl) => {
  const response = await fetch(`${baseUrl}/admin-api/events/parse-test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ include_rows: false }),
  });
  assert.equal(response.status, 404, "debug parser-test route must not be exposed by admin API");
});

const writeCalls = [];
await withServer(buildApp({ writeCalls }), async (baseUrl) => {
  const response = await fetch(`${baseUrl}/admin-api/events/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      event_name: "Donor Dinner",
      location_group_id: TEST_GROUP_ID,
      event_date: "2026-06-12",
      start_time: "17:30",
      end_time: "20:00",
      attendee_count: "85",
      notes: "Catering, extra trash, restroom check before dinner and after dessert",
      created_by: "contract test",
    }),
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.data.notes, "Catering, extra trash, restroom check before dinner and after dessert");
});

const createCall = writeCalls.find((call) => call.name === "events_app_create");
assert.ok(createCall, "event creation SQL should run");
assert.match(createCall.sql, /insert into public\.events_app_events/i);
assert.match(createCall.sql, /Catering, extra trash, restroom check before dinner and after dessert/);
assert.doesNotMatch(createCall.sql, /Operational flags/i);

const numericNotesWriteCalls = [];
await withServer(buildApp({ writeCalls: numericNotesWriteCalls }), async (baseUrl) => {
  const response = await fetch(`${baseUrl}/admin-api/events/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      event_name: "Camp Day",
      location_group_id: TEST_GROUP_ID,
      event_date: "2026-06-13",
      start_time: "09:00",
      end_time: "15:00",
      attendee_count: "85",
      notes: "85",
      created_by: "contract test",
    }),
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.data.attendee_count, 85);
  assert.equal(payload.data.notes, null, "numeric-only notes matching attendee_count should be removed before save");
});
const numericNotesCreateCall = numericNotesWriteCalls.find((call) => call.name === "events_app_create");
assert.ok(numericNotesCreateCall, "numeric-notes event creation SQL should run");
assert.match(numericNotesCreateCall.sql, /85,\s*\n\s*null,\s*\n\s*'contract test'/, "numeric-only notes matching attendee_count should be written as SQL null");

const overnightWriteCalls = [];
await withServer(buildApp({ writeCalls: overnightWriteCalls }), async (baseUrl) => {
  const response = await fetch(`${baseUrl}/admin-api/events/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      event_name: "ARP Zoo Snooze",
      location_group_id: TEST_GROUP_ID,
      event_date: "2026-06-19",
      start_time: "22:00",
      end_time: "08:00",
      attendee_count: "75",
      notes: "Overnight event ends on June 20.",
      created_by: "contract test",
    }),
  });
  assert.equal(response.status, 200, "overnight Zoo Snooze should not be rejected by start/end chronology validation");
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.data.event_date, "2026-06-19");
  assert.equal(payload.data.end_date, "2026-06-20");
  assert.equal(payload.data.start_time, "22:00:00");
  assert.equal(payload.data.end_time, "08:00:00");
  assert.equal(payload.data.spans_overnight, true);
  assert.equal(payload.data.overnight_split, undefined, "overnight events must remain one logical event, not split into fake day rows");
});
const overnightCreateCall = overnightWriteCalls.find((call) => call.name === "events_app_create");
assert.ok(overnightCreateCall, "overnight event creation SQL should run");
assert.match(overnightCreateCall.sql, /event_date,[\s\S]*end_date,[\s\S]*start_time,[\s\S]*end_time/i, "creation SQL should persist both start date and end date");
assert.match(overnightCreateCall.sql, /'2026-06-19'::date[\s\S]*'2026-06-20'::date[\s\S]*'22:00:00'::time[\s\S]*'08:00:00'::time/, "overnight event should be inserted as one row with next-day end_date");
assert.doesNotMatch(overnightCreateCall.sql, /'23:59:00'::time|\('ARP Zoo Snooze'[\s\S]*'2026-06-20'::date[\s\S]*'00:00:00'::time/, "overnight insert should not use the old two-row split workaround");

await withServer(buildApp(), async (baseUrl) => {
  const response = await fetch(`${baseUrl}/admin-api/events/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      event_name: "Bad Date",
      location_group_id: TEST_GROUP_ID,
      event_date: "2026-99-99",
      start_time: "09:00",
      end_time: "10:00",
      attendee_count: "10",
      notes: "invalid date should fail",
      created_by: "contract test",
    }),
  });
  assert.equal(response.status, 400, "invalid calendar dates must be rejected before SQL insert");
  const payload = await response.json();
  assert.equal(payload.ok, false);
  assert.match(payload.error, /event_date/i);
});

const listReadCalls = [];
await withServer(buildApp({ readCalls: listReadCalls }), async (baseUrl) => {
  const response = await fetch(`${baseUrl}/admin-api/events/`);
  assert.equal(response.status, 200);
});
const listSql = listReadCalls.find((sql) => /from public\.events_app_events/i.test(sql));
assert.ok(listSql, "published event list SQL should run");
assert.match(listSql, /then 'SPLASH_PAD'/, "published event group_code should omit restroom suffix for Splash Pad");
assert.match(listSql, /then 'COURTYARD'/, "published event group_code should omit restroom suffix for Courtyard");
assert.match(listSql, /then 'Splash Pad'/, "published event group_name should omit restroom suffix for Splash Pad");
assert.match(listSql, /then 'Courtyard'/, "published event group_name should omit restroom suffix for Courtyard");
assert.match(listSql, /nullif\(btrim\(e\.notes\), ''\)/i, "published event list should normalize blank notes");
assert.match(listSql, /btrim\(e\.notes\) = e\.attendee_count::text/i, "published event list should hide legacy numeric notes that duplicate attendee_count");

const notificationReadCalls = [];
const notificationWriteCalls = [];
const rpcCalls = [];
const maintenance = createEventMaintenanceController({
  runReadOnlySql: async (sql) => {
    notificationReadCalls.push(String(sql || ""));
    return [];
  },
  runWriteSql: async (name, sql) => {
    notificationWriteCalls.push({ name, sql: String(sql || "") });
    return [];
  },
  runRpc: async (name, params) => {
    rpcCalls.push({ name, params });
    return null;
  },
});
await maintenance.runMaintenance("contract_test");
const notificationSql = notificationReadCalls.find((sql) => /candidate_notifications/i.test(sql));
assert.ok(notificationSql, "event maintenance should query pending event reminders");
assert.match(notificationSql, /three_days_out/, "event reminders should include three-days-out notices");
assert.match(notificationSql, /two_days_out/, "event reminders should include two-days-out notices");
assert.match(notificationSql, /day_of_event/, "event reminders should include day-of notices");
assert.doesNotMatch(notificationSql, /day_before|morning_of|shift_plus_fifteen/, "legacy reminder kinds should not remain in the reminder query");
assert.match(notificationSql, /interval '15 minutes'/, "event reminders should be scheduled 15 minutes after owner clock-in\/coverage start");
assert.match(notificationSql, /oa\.assignment_date = p\.local_now::date/, "event reminders should use the final owner assignment for today, not the future event date owner");
assert.match(notificationSql, /e\.event_date = \(p\.local_now::date \+ \(td\.day_offset \* interval '1 day'\)\)::date/, "event reminders should target events that are today, two days out, or three days out from the current workday");
assert.match(notificationSql, /log\.notification_kind = td\.notification_kind/, "notification dedupe should be keyed to the transcript-approved reminder cadence");
assert.match(notificationSql, /coalesce\(dsa\.coverage_purpose, 'area_owner'\) = 'area_owner'/, "event reminders should stay tied to area-owner rows after PTO\/absence\/CoverAll adjustments");
const scanAlertRpc = rpcCalls.find((call) => call.name === "sch_queue_due_scan_alerts");
assert.ok(scanAlertRpc, "event maintenance should queue due scan alerts");
assert.deepEqual(scanAlertRpc.params, {
  p_limit: 50,
  p_dry_run: false,
  p_cooldown_minutes: 30,
  p_manager_escalation_grace_minutes: 30,
}, "scan alert RPC should pass the manager escalation argument to avoid overloaded Supabase RPC ambiguity");

console.log("events api contract tests passed");
