import assert from "node:assert/strict";
import express from "express";
import { createEventsAdminRouter } from "../src/events-api.js";

const TEST_GROUP_ID = "00000000-0000-4000-8000-000000000001";

function buildApp({ writeCalls = [] } = {}) {
  const app = express();
  app.use(express.json());
  app.use("/admin-api/events", createEventsAdminRouter({
    runReadOnlySql: async () => [
      {
        location_group_id: TEST_GROUP_ID,
        group_code: "EC",
        group_name: "Event Center",
        included_locations: ["Event Center", "EC"],
      },
    ],
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

console.log("events api contract tests passed");
