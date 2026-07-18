import assert from "node:assert/strict";
import express from "express";
import { createEventMaintenanceController, createEventsAdminRouter } from "../src/events-api.js";

const TEST_GROUP_ID = "00000000-0000-4000-8000-000000000001";
const TEST_VENUE_ID = "10000000-0000-4000-8000-000000000001";
const TEST_ZOO_GROUP_ID = "20000000-0000-4000-8000-000000000000";
const TEST_ZOO_VENUE_ID = "10000000-0000-4000-8000-000000000000";
const TEST_RESTROOM_GROUP_ID = "30000000-0000-4000-8000-000000000001";

function buildApp({ writeCalls = [], readCalls = [], writeResults = {} } = {}) {
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
    runWriteSql: async (name, sql) => {
      writeCalls.push({ name, sql });
      return Object.prototype.hasOwnProperty.call(writeResults, name) ? writeResults[name] : [];
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
assert.match(createCall.sql, /event_scope/i, "event creation SQL should persist canonical event scope");
assert.match(createCall.sql, /primary_venue_id/i, "event creation SQL should persist canonical event venue");
assert.match(createCall.sql, /coverage_location_ids/i, "event creation SQL should persist coverage separately from venue");
assert.match(createCall.sql, /'SINGLE_VENUE'/, "legacy location_group_id should resolve to SINGLE_VENUE when it maps to an eligible venue");
assert.match(createCall.sql, new RegExp(`${TEST_VENUE_ID.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}'::uuid`), "legacy event-group input should resolve to the event venue id");
assert.match(createCall.sql, /Catering, extra trash, restroom check before dinner and after dessert/);
assert.doesNotMatch(createCall.sql, /Operational flags/i);

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
const zooWideCreateCall = zooWideWriteCalls.find((call) => call.name === "events_app_create");
assert.ok(zooWideCreateCall, "zoo-wide event creation SQL should run");
assert.match(zooWideCreateCall.sql, /'ZOO_WIDE'/, "zoo-wide SQL should persist ZOO_WIDE");
assert.match(zooWideCreateCall.sql, /'Zoo Footprint'/, "zoo-wide SQL should normalize display location to Zoo Footprint");
assert.match(zooWideCreateCall.sql, /on conflict \(operation_id\) where operation_id is not null/i, "event creation should dedupe retries by operation_id");

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
    }),
  });
  assert.equal(response.status, 400, "mock write returning no updated rows should surface not found rather than false success");
  const payload = await response.json();
  assert.equal(payload.ok, false);
  assert.match(payload.error, /not found/i);
});
const updateCall = updateWriteCalls.find((call) => call.name === "events_app_update");
assert.ok(updateCall, "event update SQL should run");
assert.match(updateCall.sql, /for update/i, "event update should lock the intended event row");
assert.match(updateCall.sql, /insert into public\.events_app_event_history/i, "event update should append correction history");
assert.match(updateCall.sql, /event_scope = 'ZOO_WIDE'/i, "event update should write canonical event scope");

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
assert.match(notificationSql, /'event_reminder'::text as notification_kind/, "event maintenance should create one canonical reminder kind per event");
assert.doesNotMatch(notificationSql, /three_days_out|two_days_out|day_of_event|day_before|morning_of|shift_plus_fifteen/, "legacy multi-cadence event reminder kinds must not remain in the pending query");
assert.match(notificationSql, /interval '15 minutes'/, "event reminders should become eligible 15 minutes after owner clock-in\/coverage start");
assert.match(notificationSql, /oa\.assignment_date = p\.local_now::date/, "event reminders should use the final owner assignment for today, not the future event-date owner");
assert.match(notificationSql, /e\.event_date between p\.local_now::date and \(p\.local_now::date \+ 3\)/, "one event reminder may be delivered during the three-day operating look-ahead");
assert.match(notificationSql, /log\.notification_kind = 'event_reminder'/, "event reminder dedupe must use the one canonical reminder kind");
assert.match(notificationSql, /coalesce\(dsa\.coverage_purpose, 'area_owner'\) = 'area_owner'/, "event reminders should stay tied to area-owner rows after PTO\/absence\/CoverAll adjustments");
assert.match(notificationSql, /e\.coverage_location_ids/i, "event reminders should target explicit coverage locations");
assert.match(notificationSql, /cross join lateral unnest/i, "event reminders should expand coverage target locations explicitly");
assert.match(notificationSql, /array_length\(e\.coverage_location_ids, 1\)/i, "event reminders should prefer coverage locations when present");
assert.match(notificationSql, /coalesce\(e\.event_scope, 'UNKNOWN'\) = 'ZOO_WIDE' then '\{\}'::uuid\[\]/i, "zoo-wide events without coverage must not notify every legacy area owner");
assert.doesNotMatch(notificationSql, /oa\.location_group_id\s*=\s*e\.location_group_id/i, "event reminders must not reconstruct the venue from the legacy location_group_id");
const scanAlertRpc = rpcCalls.find((call) => call.name === "sch_queue_due_scan_alerts");
assert.ok(scanAlertRpc, "event maintenance should queue due scan alerts");
assert.deepEqual(scanAlertRpc.params, {
  p_limit: 50,
  p_dry_run: false,
  p_cooldown_minutes: 30,
  p_manager_escalation_grace_minutes: 30,
}, "scan alert RPC should pass the manager escalation argument to avoid overloaded Supabase RPC ambiguity");

console.log("events api contract tests passed");
