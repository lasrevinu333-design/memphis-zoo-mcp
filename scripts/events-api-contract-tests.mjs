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
  assert.equal(payload.data.overnight_split, true);
  assert.equal(payload.data.created_records.length, 2);
  assert.equal(payload.data.created_records[0].event_date, "2026-06-19");
  assert.equal(payload.data.created_records[0].start_time, "22:00:00");
  assert.equal(payload.data.created_records[0].end_time, "23:59:00");
  assert.equal(payload.data.created_records[1].event_date, "2026-06-20");
  assert.equal(payload.data.created_records[1].start_time, "00:00:00");
  assert.equal(payload.data.created_records[1].end_time, "08:00:00");
});
const overnightCreateCall = overnightWriteCalls.find((call) => call.name === "events_app_create");
assert.ok(overnightCreateCall, "overnight event creation SQL should run");
assert.match(overnightCreateCall.sql, /'2026-06-19'::date[\s\S]*'22:00:00'::time[\s\S]*'23:59:00'::time/);
assert.match(overnightCreateCall.sql, /'2026-06-20'::date[\s\S]*'00:00:00'::time[\s\S]*'08:00:00'::time/);

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
assert.match(notificationSql, /two_days_before/, "event reminders should include two-days-before notices");
assert.match(notificationSql, /day_before/, "event reminders should include one-day-before notices");
assert.match(notificationSql, /morning_of/, "event reminders should include morning-of notices");
assert.match(notificationSql, /interval '15 minutes'/, "event reminders should be scheduled 15 minutes after owner clock-in/coverage start");
assert.match(notificationSql, /coalesce\(eoc\.coverage_start, time '08:00:00'\)/, "event reminders should use chosen owner coverage start with 8 AM fallback");
assert.match(notificationSql, /coalesce\(oa\.coverage_start, time '00:00:00'\)\s*<\s*e\.end_time/s, "event owner candidates should only include coverage windows that overlap event end time");
assert.match(notificationSql, /coalesce\(oa\.coverage_end, time '23:59:59'\)\s*>\s*e\.start_time/s, "event owner candidates should only include coverage windows that overlap event start time");
assert.match(notificationSql, /coalesce\(dsa\.coverage_purpose, 'area_owner'\) in \('area_owner', 'late_coverage'\)/, "event reminders should consider Michael-style late coverage rows as valid owners");
assert.match(notificationSql, /when coalesce\(dsa\.coverage_purpose, 'area_owner'\) = 'late_coverage' then 2/s, "late coverage rows should outrank ordinary daytime area owners when they overlap an event");
assert.match(notificationSql, /min\(eoc\.assignment_priority\) over \(partition by eoc\.id, eoc\.notification_kind\)/s, "event reminders should choose the highest-priority overlapping owner per event/reminder kind");
assert.doesNotMatch(notificationSql, /not exists \(\s*select 1\s*from public\.daily_group_assignments dga\s*where dga\.assignment_date = dsa\.service_date\s*and dga\.location_group_id = dsa\.location_group_id\s*and dga\.active = true\s*and dga\.assigned_employee_id is not null\s*\)/s, "manual/takeover rows must not suppress generated schedule owners for the whole day without event-time overlap");
const scanAlertRpc = rpcCalls.find((call) => call.name === "sch_queue_due_scan_alerts");
assert.ok(scanAlertRpc, "event maintenance should queue due scan alerts");
assert.deepEqual(scanAlertRpc.params, {
  p_limit: 50,
  p_dry_run: false,
  p_cooldown_minutes: 30,
  p_manager_escalation_grace_minutes: 30,
}, "scan alert RPC should pass the manager escalation argument to avoid overloaded Supabase RPC ambiguity");

console.log("events api contract tests passed");
