import assert from "node:assert/strict";
import express from "express";
import { createEventMaintenanceController, createEventsAdminRouter, createEventsPublicRouter } from "../src/events-api.js";

const TEST_GROUP_ID = "00000000-0000-4000-8000-000000000001";
const TEST_VENUE_ID = "10000000-0000-4000-8000-000000000001";
const TEST_ZOO_GROUP_ID = "20000000-0000-4000-8000-000000000000";
const TEST_ZOO_VENUE_ID = "10000000-0000-4000-8000-000000000000";
const TEST_RESTROOM_GROUP_ID = "30000000-0000-4000-8000-000000000001";
const TEST_MANAGER_ID = "90000000-0000-4000-8000-000000000001";
const TEST_MANAGER_NAME = "Authenticated Event Manager";

function buildApp({ writeCalls = [], readCalls = [], writeResults = {}, eventRows = [] } = {}) {
  const app = express();
  app.use(express.json());
  app.use("/admin-api/events", createEventsAdminRouter({
    runReadOnlySql: async (sql) => {
      readCalls.push(String(sql || ""));
      if (/from public\.event_venues/i.test(sql)) {
        return [
          {
            venue_id: TEST_ZOO_VENUE_ID,
            venue_code: "ZOO_FOOTPRINT",
            display_name: "Zoo Footprint",
            event_scope: "ZOO_WIDE",
            location_group_id: TEST_ZOO_GROUP_ID,
            group_code: "ZOO_FOOTPRINT",
            group_name: "Zoo Footprint",
            eligible_event_venue: false,
            eligible_event_scope: true,
            aliases: ["Zoo Footprint", "zoo wide"],
            active: true,
          },
          {
            venue_id: TEST_VENUE_ID,
            venue_code: "EVENT_CENTER",
            display_name: "Event Center",
            event_scope: "SINGLE_VENUE",
            location_group_id: TEST_GROUP_ID,
            group_code: "EC",
            group_name: "Event Center",
            eligible_event_venue: true,
            eligible_event_scope: false,
            aliases: ["Event Center", "EC"],
            active: true,
          },
        ];
      }
      if (/from public\.event_default_rules/i.test(sql)) {
        return [
          {
            id: "40000000-0000-4000-8000-000000000001",
            match_text: "Members Night",
            normalized_match: "members night",
            event_scope: "ZOO_WIDE",
            primary_venue_id: TEST_ZOO_VENUE_ID,
            display_name: "Zoo Footprint",
            venue_code: "ZOO_FOOTPRINT",
            location_group_id: TEST_ZOO_GROUP_ID,
            active: true,
          },
        ];
      }
      if (/from public\.events_app_events/i.test(sql)) {
        return eventRows;
      }
      return [
        {
          location_group_id: TEST_GROUP_ID,
          group_code: "EC",
          group_name: "Event Center",
          included_locations: ["Event Center", "EC"],
          eligible_event_venue: true,
          eligible_event_scope: false,
          eligible_custodial_coverage: true,
          eligible_staffing_assignment: true,
          public_restroom: false,
          staff_restroom: false,
        },
        {
          location_group_id: TEST_ZOO_GROUP_ID,
          group_code: "ZOO_FOOTPRINT",
          group_name: "Zoo Footprint",
          included_locations: ["Zoo Footprint"],
          eligible_event_venue: false,
          eligible_event_scope: true,
          eligible_custodial_coverage: false,
          eligible_staffing_assignment: false,
          public_restroom: false,
          staff_restroom: false,
        },
        {
          location_group_id: TEST_RESTROOM_GROUP_ID,
          group_code: "MEMMEX_RESTROOMS",
          group_name: "MemMex Restrooms",
          included_locations: ["MemMex Restrooms"],
          eligible_event_venue: false,
          eligible_event_scope: false,
          eligible_custodial_coverage: true,
          eligible_staffing_assignment: true,
          public_restroom: true,
          staff_restroom: false,
        },
      ];
    },
    runCommand: async (name, payload) => {
      writeCalls.push({ name, payload });
      const legacyName = { event_create: "events_app_create", event_update: "events_app_update", event_cancel: "events_app_cancel" }[name];
      return Object.prototype.hasOwnProperty.call(writeResults, legacyName) ? writeResults[legacyName] : [];
    },
    buildHealthPayload: (area, extra) => ({ ok: true, area, ...extra }),
    appVersion: "test",
    releaseId: "test",
    maintenanceController: { kick() {} },
    requireAdminApiAuth: (req, _res, next) => {
      req.memphisAuth = { manager_id: TEST_MANAGER_ID, manager_display_name: TEST_MANAGER_NAME };
      next();
    },
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

function buildPublicApp(eventRows = []) {
  const app = express();
  app.use("/dashboard-api/events", createEventsPublicRouter({
    runReadOnlySql: async (sql) => /from public\.events_app_events/i.test(sql) ? eventRows : [],
    runCommand: async () => [],
    buildHealthPayload: (area, extra) => ({ ok: true, area, ...extra }),
    appVersion: "test",
    releaseId: "test",
    maintenanceController: { getStatus: () => null },
  }));
  return app;
}

await withServer(buildPublicApp([{
  id: "80000000-0000-4000-8000-000000000001",
  event_name: "Public Event",
  event_title: "Public Event",
  event_date: "2026-08-01",
  end_date: "2026-08-01",
  start_time: "10:00:00",
  end_time: "12:00:00",
  spans_overnight: false,
  attendee_count: 100,
  display_location: "Event Center",
  venue_name: "Event Center",
  status: "SCHEDULED",
  event_timezone: "America/Chicago",
  notes: "Internal staffing note",
  created_by: "Private Manager",
  overridden_by: "Private Editor",
  parse_reason: "Internal parser reason",
  parser_confidence: "high",
  coverage_location_ids: [TEST_RESTROOM_GROUP_ID],
  staffing_area_ids: [TEST_GROUP_ID],
  source_location_text: "source payload",
}]), async (baseUrl) => {
  const response = await fetch(`${baseUrl}/dashboard-api/events`);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(Object.keys(payload.data[0]).sort(), [
    "attendee_count", "display_location", "end_date", "end_time", "event_date", "event_name",
    "event_timezone", "event_title", "id", "spans_overnight", "start_time", "status", "venue_name",
  ]);
  for (const privateField of [
    "notes", "created_by", "overridden_by", "parse_reason", "parser_confidence",
    "coverage_location_ids", "staffing_area_ids", "source_location_text",
  ]) assert.equal(privateField in payload.data[0], false, `public event leaked ${privateField}`);
});

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

const createCall = writeCalls.find((call) => call.name === "event_create");
assert.ok(createCall, "typed event creation command should run");
assert.equal(createCall.name, "event_create");
assert.equal(createCall.payload.record.event_scope, "SINGLE_VENUE", "legacy location_group_id should resolve to the canonical event scope");
assert.equal(createCall.payload.record.primary_venue_id, TEST_VENUE_ID, "legacy event-group input should resolve to the event venue id");
assert.deepEqual(createCall.payload.record.coverage_location_ids, [], "coverage remains separate from event venue");
assert.equal(createCall.payload.record.notes, "Catering, extra trash, restroom check before dinner and after dessert");
assert.equal(createCall.payload.record.actor_manager_id, TEST_MANAGER_ID);
assert.equal(createCall.payload.record.created_by, TEST_MANAGER_NAME, "client created_by must be replaced by the authenticated manager snapshot");
assert.equal(createCall.payload.actor, TEST_MANAGER_NAME);
assert.doesNotMatch(JSON.stringify(createCall.payload), /Operational flags/i);
assert.doesNotMatch(JSON.stringify(createCall.payload), /contract test/i, "client actor fields must not reach event mutation authority");

await withServer(buildApp({
  writeResults: {
    events_app_create: {
      id: "70000000-0000-4000-8000-000000000001",
      event_name: "Object Return Event",
      event_scope: "SINGLE_VENUE",
      display_location: "Event Center",
      operation_id: "70000000-0000-4000-8000-000000000002",
    },
  },
}), async (baseUrl) => {
  const response = await fetch(`${baseUrl}/admin-api/events/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      operation_id: "70000000-0000-4000-8000-000000000002",
      event_name: "Object Return Event",
      location_group_id: TEST_GROUP_ID,
      event_date: "2026-06-12",
      start_time: "17:30",
      end_time: "20:00",
      created_by: "contract test",
    }),
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.data.id, "70000000-0000-4000-8000-000000000001", "create response must include the server-issued event id when write RPC returns a single row object");
  assert.equal(payload.data.operation_id, "70000000-0000-4000-8000-000000000002", "create response must preserve the idempotency operation id from the authoritative row");
});

await withServer(buildApp({
  writeResults: {
    events_app_create: {
      ok: true,
      name: "events_app_create",
      executed_at: "2026-07-18T03:00:00Z",
    },
  },
  eventRows: [
    {
      id: "70000000-0000-4000-8000-000000000011",
      event_name: "Envelope Return Event",
      event_scope: "SINGLE_VENUE",
      display_location: "Event Center",
      operation_id: "70000000-0000-4000-8000-000000000012",
    },
  ],
}), async (baseUrl) => {
  const response = await fetch(`${baseUrl}/admin-api/events/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      operation_id: "70000000-0000-4000-8000-000000000012",
      event_name: "Envelope Return Event",
      location_group_id: TEST_GROUP_ID,
      event_date: "2026-06-12",
      start_time: "17:30",
      end_time: "20:00",
      created_by: "contract test",
    }),
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.data.id, "70000000-0000-4000-8000-000000000011", "create response must read back the authoritative event row when the write executor returns only an execution envelope");
  assert.equal(payload.data.operation_id, "70000000-0000-4000-8000-000000000012");
});

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
const numericNotesCreateCall = numericNotesWriteCalls.find((call) => call.name === "event_create");
assert.ok(numericNotesCreateCall, "numeric-notes typed event creation should run");
assert.equal(numericNotesCreateCall.payload.record.attendee_count, 85);
assert.equal(numericNotesCreateCall.payload.record.notes, null, "numeric-only notes matching attendee_count should be canonical null");

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
const overnightCreateCall = overnightWriteCalls.find((call) => call.name === "event_create");
assert.ok(overnightCreateCall, "overnight typed event creation should run");
assert.deepEqual(
  { event_date: overnightCreateCall.payload.record.event_date, end_date: overnightCreateCall.payload.record.end_date, start_time: overnightCreateCall.payload.record.start_time, end_time: overnightCreateCall.payload.record.end_time },
  { event_date: "2026-06-19", end_date: "2026-06-20", start_time: "22:00:00", end_time: "08:00:00" },
  "overnight event remains one canonical row with next-day end_date",
);

const zooWideWriteCalls = [];
await withServer(buildApp({ writeCalls: zooWideWriteCalls }), async (baseUrl) => {
  const response = await fetch(`${baseUrl}/admin-api/events/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      event_name: "Members Night",
      event_scope: "ZOO_WIDE",
      display_location: "MemMex Restrooms",
      coverage_location_ids: [TEST_RESTROOM_GROUP_ID],
      event_date: "2026-07-17",
      start_time: "18:00",
      end_time: "20:30",
      attendee_count: "",
      notes: "",
      created_by: "contract test",
      operation_id: "50000000-0000-4000-8000-000000000001",
    }),
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.data.event_scope, "ZOO_WIDE");
  assert.equal(payload.data.display_location, "Zoo Footprint");
  assert.equal(payload.data.location_group_id, TEST_ZOO_GROUP_ID);
  assert.deepEqual(payload.data.coverage_location_ids, [TEST_RESTROOM_GROUP_ID]);
});
const zooWideCreateCall = zooWideWriteCalls.find((call) => call.name === "event_create");
assert.ok(zooWideCreateCall, "zoo-wide typed event creation should run");
assert.equal(zooWideCreateCall.payload.record.event_scope, "ZOO_WIDE");
assert.equal(zooWideCreateCall.payload.record.display_location, "Zoo Footprint");
assert.equal(zooWideCreateCall.payload.record.operation_id, "50000000-0000-4000-8000-000000000001", "operation identity is explicit in the typed command");

await withServer(buildApp(), async (baseUrl) => {
  const response = await fetch(`${baseUrl}/admin-api/events/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      event_name: "Bad Venue",
      location_group_id: TEST_RESTROOM_GROUP_ID,
      event_date: "2026-07-17",
      start_time: "18:00",
      end_time: "20:00",
      created_by: "contract test",
    }),
  });
  assert.equal(response.status, 400, "restrooms must not be accepted as primary event venues");
  const payload = await response.json();
  assert.equal(payload.ok, false);
  assert.match(payload.error, /review|eligible|venue|coverage/i);
});

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
assert.match(listSql, /e\.display_location/i, "published events should expose the canonical display location");
assert.match(listSql, /e\.event_scope/i, "published events should expose canonical event scope");
assert.match(listSql, /e\.primary_venue_id/i, "published events should expose canonical venue id");
assert.match(listSql, /e\.coverage_location_ids/i, "published events should expose coverage locations separately");
assert.match(listSql, /left join public\.event_venues ev on ev\.id = e\.primary_venue_id/i, "published events should join canonical event venues");
assert.doesNotMatch(listSql, /then 'SPLASH_PAD'/, "published events must not hard-code old restroom-name display rewrites");
assert.doesNotMatch(listSql, /then 'COURTYARD'/, "published events must not hard-code old restroom-name display rewrites");
assert.match(listSql, /nullif\(btrim\(e\.notes\), ''\)/i, "published event list should normalize blank notes");
assert.match(listSql, /btrim\(e\.notes\) = e\.attendee_count::text/i, "published event list should hide legacy numeric notes that duplicate attendee_count");

await withServer(buildApp(), async (baseUrl) => {
  const venuesResponse = await fetch(`${baseUrl}/admin-api/events/event-venues`);
  assert.equal(venuesResponse.status, 200);
  const venuesPayload = await venuesResponse.json();
  assert.equal(venuesPayload.ok, true);
  assert.equal(venuesPayload.meta.contract_version, "events.v3");
  assert.equal(venuesPayload.data[0].display_name, "Zoo Footprint");

  const coverageResponse = await fetch(`${baseUrl}/admin-api/events/coverage-locations`);
  assert.equal(coverageResponse.status, 200);
  const coveragePayload = await coverageResponse.json();
  assert.equal(coveragePayload.ok, true);
  assert.ok(coveragePayload.data.some((row) => row.group_name === "MemMex Restrooms"), "coverage selector should retain restroom groups");
});

const updateWriteCalls = [];
await withServer(buildApp({ writeCalls: updateWriteCalls }), async (baseUrl) => {
  const response = await fetch(`${baseUrl}/admin-api/events/60000000-0000-4000-8000-000000000001`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      event_name: "Updated Members Night",
      event_scope: "ZOO_WIDE",
      event_date: "2026-07-17",
      start_time: "18:00",
      end_time: "20:30",
      created_by: "contract test",
      overridden_by: "contract editor",
      actor_manager_id: "60000000-0000-4000-8000-000000000099",
    }),
  });
  assert.equal(response.status, 400, "mock write returning no updated rows should surface not found rather than false success");
  const payload = await response.json();
  assert.equal(payload.ok, false);
  assert.match(payload.error, /not found/i);
});
const updateCall = updateWriteCalls.find((call) => call.name === "event_update");
assert.ok(updateCall, "typed event update should run");
assert.equal(updateCall.payload.event_id, "60000000-0000-4000-8000-000000000001");
assert.equal(updateCall.payload.record.event_scope, "ZOO_WIDE", "event update should write canonical event scope");
assert.equal(updateCall.payload.record.actor_manager_id, TEST_MANAGER_ID);
assert.equal(updateCall.payload.record.overridden_by, TEST_MANAGER_NAME);
assert.equal(updateCall.payload.actor, TEST_MANAGER_NAME);
assert.doesNotMatch(JSON.stringify(updateCall.payload), /contract editor|000000000099/i,
  "client update actor fields must not reach event mutation authority");
assert.ok(updateCall.payload.reason, "event correction history reason is explicit in the bounded command");

await withServer(buildApp({
  writeResults: {
    events_app_update: {
      id: "60000000-0000-4000-8000-000000000001",
      event_name: "Updated Members Night",
      event_scope: "ZOO_WIDE",
      display_location: "Zoo Footprint",
      notes: "Updated through single-row write RPC return.",
      revision: 2,
    },
  },
}), async (baseUrl) => {
  const response = await fetch(`${baseUrl}/admin-api/events/60000000-0000-4000-8000-000000000001`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      event_name: "Updated Members Night",
      event_scope: "ZOO_WIDE",
      event_date: "2026-07-17",
      start_time: "18:00",
      end_time: "20:30",
      notes: "Updated through single-row write RPC return.",
      created_by: "contract test",
      overridden_by: "contract editor",
    }),
  });
  assert.equal(response.status, 200, "single-row write RPC update result should be treated as the updated row");
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.data.id, "60000000-0000-4000-8000-000000000001");
  assert.equal(payload.data.revision, 2);
  assert.equal(payload.data.notes, "Updated through single-row write RPC return.");
});

await withServer(buildApp({
  writeResults: {
    events_app_update: {
      ok: true,
      name: "events_app_update",
      executed_at: "2026-07-18T03:00:00Z",
    },
  },
  eventRows: [
    {
      id: "60000000-0000-4000-8000-000000000002",
      event_name: "Updated Members Night",
      event_scope: "ZOO_WIDE",
      display_location: "Zoo Footprint",
      notes: "Updated through authoritative readback.",
      revision: 3,
    },
  ],
}), async (baseUrl) => {
  const response = await fetch(`${baseUrl}/admin-api/events/60000000-0000-4000-8000-000000000002`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      event_name: "Updated Members Night",
      event_scope: "ZOO_WIDE",
      event_date: "2026-07-17",
      start_time: "18:00",
      end_time: "20:30",
      notes: "Updated through authoritative readback.",
      created_by: "contract test",
      overridden_by: "contract editor",
    }),
  });
  assert.equal(response.status, 200, "write envelope update result should be followed by an authoritative readback");
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.data.id, "60000000-0000-4000-8000-000000000002");
  assert.equal(payload.data.revision, 3);
  assert.equal(payload.data.notes, "Updated through authoritative readback.");
});

const cancelWriteCalls = [];
await withServer(buildApp({
  writeCalls: cancelWriteCalls,
  writeResults: {
    events_app_cancel: {
      id: "60000000-0000-4000-8000-000000000003",
      status: "CANCELLED",
      cancelled_by: TEST_MANAGER_NAME,
      cancelled_by_manager_id: TEST_MANAGER_ID,
    },
  },
}), async (baseUrl) => {
  const response = await fetch(`${baseUrl}/admin-api/events/60000000-0000-4000-8000-000000000003`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      cancelled_by: "Forged Canceller",
      actor: "Forged Actor",
      actor_manager_id: "60000000-0000-4000-8000-000000000099",
      reason: "Verified cancellation reason",
    }),
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).data.cancelled_by_manager_id, TEST_MANAGER_ID);
});
const cancelCall = cancelWriteCalls.find((call) => call.name === "event_cancel");
assert.deepEqual(cancelCall.payload.record, { actor_manager_id: TEST_MANAGER_ID });
assert.equal(cancelCall.payload.actor, TEST_MANAGER_NAME);
assert.equal(cancelCall.payload.reason, "Verified cancellation reason");
assert.doesNotMatch(JSON.stringify(cancelCall.payload), /Forged|000000000099/,
  "client cancellation actor fields must not reach event mutation authority");

const notificationReadCalls = [];
const notificationWriteCalls = [];
const rpcCalls = [];
const maintenance = createEventMaintenanceController({
  runReadOnlySql: async (sql) => {
    notificationReadCalls.push(String(sql || ""));
    return [];
  },
  runCommand: async (name, payload) => {
    notificationWriteCalls.push({ name, payload });
    return [];
  },
  runRpc: async (name, params) => {
    rpcCalls.push({ name, params });
    if (name === "mz_enqueue_employee_event_pushes") {
      return { ok: true, enqueued: 2 };
    }
    return null;
  },
});
const maintenanceResult = await maintenance.runMaintenance("contract_test");
const nativePushRpc = rpcCalls.find((call) => call.name === "mz_enqueue_employee_event_pushes");
assert.ok(nativePushRpc, "event maintenance should enqueue native employee push notifications");
assert.ok(nativePushRpc.params.p_now, "native employee enqueue should receive one authoritative timestamp");
assert.equal(maintenanceResult.delivery, "native_employee_push_only");
assert.equal(maintenanceResult.messenger_coupling, false);
assert.equal(maintenanceResult.processed, 2);
assert.equal(notificationReadCalls.some((sql) => /candidate_notifications/i.test(sql)), false,
  "event maintenance must not query the legacy Messenger reminder candidate path");
assert.equal(rpcCalls.some((call) => call.name.startsWith("msg_")), false,
  "event maintenance must not call Messenger RPCs");
const scanAlertRpc = rpcCalls.find((call) => call.name === "sch_queue_due_scan_alerts");
assert.ok(scanAlertRpc, "event maintenance should queue due scan alerts");
assert.deepEqual(scanAlertRpc.params, {
  p_limit: 50,
  p_dry_run: false,
  p_cooldown_minutes: 30,
  p_manager_escalation_grace_minutes: 30,
}, "scan alert RPC should pass the manager escalation argument to avoid overloaded Supabase RPC ambiguity");

console.log("events api contract tests passed");
