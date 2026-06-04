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
const maintenance = createEventMaintenanceController({
  runReadOnlySql: async (sql) => {
    notificationReadCalls.push(String(sql || ""));
    return [];
  },
  runWriteSql: async (name, sql) => {
    notificationWriteCalls.push({ name, sql: String(sql || "") });
    return [];
  },
  runRpc: async () => null,
});
await maintenance.runMaintenance("contract_test");
const notificationSql = notificationReadCalls.find((sql) => /candidate_notifications/i.test(sql));
assert.ok(notificationSql, "event maintenance should query pending event reminders");
assert.match(notificationSql, /two_days_before/, "event reminders should include two-days-before notices");
assert.match(notificationSql, /day_before/, "event reminders should include one-day-before notices");
assert.match(notificationSql, /morning_of/, "event reminders should include morning-of notices");
assert.match(notificationSql, /interval '15 minutes'/, "event reminders should be scheduled 15 minutes after owner clock-in/coverage start");
assert.match(notificationSql, /coalesce\(oa\.coverage_start, time '08:00:00'\)/, "event reminders should use owner coverage start with 8 AM fallback");

console.log("events api contract tests passed");
