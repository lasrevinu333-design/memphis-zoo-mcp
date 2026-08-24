#!/usr/bin/env node
import assert from "node:assert/strict";
import express from "express";
import { createScheduleRouter } from "../src/schedule-api.js";

const employeeId = "30000000-0000-4000-8000-000000000099";
const serviceDate = "2027-02-15";

function employeeDay(projectionStatus = "current") {
  const item = {
    id: "90000000-0000-4000-8000-000000000001",
    occurrence_id: "90000000-0000-4000-8000-000000000001",
    service_date: serviceDate,
    group_code: "TETON_RESTROOM",
    group_name: "Teton Restroom",
    location_name: "Teton Restroom",
    included_locations: ["Teton Restroom"],
    coverage_start: "08:00",
    coverage_end: "10:00",
    coverage_purpose: "area_owner",
    status: "ASSIGNED",
  };
  const laterItem = {
    ...item,
    id: "90000000-0000-4000-8000-000000000002",
    occurrence_id: "90000000-0000-4000-8000-000000000002",
    coverage_start: "14:00",
    coverage_end: "15:00",
  };
  return {
    ok: true,
    governed: true,
    source: "static_weekly_projection",
    projection_status: projectionStatus,
    publication_id: "70000000-0000-4000-8000-000000000009",
    projection_id: "71000000-0000-4000-8000-000000000009",
    service_date: serviceDate,
    employee_id: employeeId,
    employee_name: "Taylor New",
    employee: { id: employeeId, display_name: "Taylor New", employee_code: "EMP901" },
    shift: { start: "07:00 AM", end: "04:00 PM", active: true },
    phase: "assigned_areas",
    notice: "Your assigned areas are shown below. Choose the practical cleaning order.",
    current_items: [item],
    all_items: [item, laterItem],
    items: [item],
  };
}

function buildApp(read, requireDeviceAccess) {
  const app = express();
  app.use("/schedule-api", createScheduleRouter({
    runReadOnlySql: read,
    runRpc: async () => ({}),
    runCommand: async () => ({}),
    buildHealthPayload: () => ({ ok: true }),
    requireAdminApiAuth: (_req, _res, next) => next(),
    requireOpsManagerAuth: (_req, _res, next) => next(),
    requireDeviceAccess,
    appVersion: "route-test",
    releaseId: "route-test",
    contractVersion: "schedule.route-test",
  }));
  return app;
}

async function withServer(app, test) {
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  try { await test(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

const currentCalls = [];
await withServer(buildApp(async (sql) => {
  currentCalls.push(sql);
  if (sql.includes("static_weekly_v5_read_employee_day")) return [{ data: employeeDay() }];
  throw new Error(`legacy schedule read was reached: ${sql}`);
}), async (origin) => {
  const summary = await fetch(`${origin}/schedule-api/my-day-summary?employee_id=${employeeId}&service_date=${serviceDate}`);
  assert.equal(summary.status, 200);
  const summaryPayload = await summary.json();
  assert.equal(summaryPayload.data.source, "static_weekly_projection");
  assert.equal(summaryPayload.data.employee_name, "Taylor New");
  assert.equal(summaryPayload.data.items.length, 2, "canonical occurrences at the same location and purpose must remain separate");
  assert.equal(summaryPayload.data.items[0].name, "Teton Restroom");
  assert.deepEqual(summaryPayload.data.items.map((item) => item.occurrence_id), [
    "90000000-0000-4000-8000-000000000001",
    "90000000-0000-4000-8000-000000000002",
  ]);

  const html = await fetch(`${origin}/schedule-api/my-schedule?employee_id=${employeeId}&service_date=${serviceDate}`);
  assert.equal(html.status, 200);
  assert.match(await html.text(), /Taylor New[\s\S]*Teton Restroom/);
});
assert.equal(currentCalls.every((sql) => sql.includes("static_weekly_v5_read_employee_day")), true, "governed dates must not read the legacy scheduler");

const conflictingEmployeeId = "30000000-0000-4000-8000-000000000088";
let authenticatedDeviceMiddlewareCalls = 0;
const authenticatedCalls = [];
await withServer(buildApp(async (sql) => {
  authenticatedCalls.push(sql);
  if (sql.includes("from public.device_aliases")) {
    return [{
      requested_device_id: "KIOSK_08",
      matched_by: "canonical",
      canonical_device_pk: "80000000-0000-4000-8000-000000000008",
      canonical_device_id: "KIOSK_08",
      device_id: "KIOSK_08",
      device_name: "Employee Phone 8",
      device_active: true,
      assigned_employee_id: employeeId,
      assigned_employee_name: "Taylor New",
      employee_code: "EMP901",
      role: "CUSTODIAL_EMPLOYEE",
      employee_active: true,
    }];
  }
  if (sql.includes("static_weekly_v5_read_employee_day")) {
    assert.match(sql, new RegExp(employeeId));
    assert.doesNotMatch(sql, new RegExp(conflictingEmployeeId));
    return [{ data: employeeDay() }];
  }
  throw new Error(`unexpected authenticated employee-day query: ${sql}`);
}, (req, _res, next) => {
  authenticatedDeviceMiddlewareCalls += 1;
  req.memphisDevice = { canonical_device_id: "KIOSK_08", device_id: "KIOSK_08" };
  next();
}), async (origin) => {
  const response = await fetch(
    `${origin}/schedule-api/my-day-summary?employee_id=${conflictingEmployeeId}&service_date=${serviceDate}`,
    { headers: { "x-device-id": "KIOSK_08" } },
  );
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.data.employee_id, employeeId);
  assert.equal(payload.data.employee_name, "Taylor New");
  assert.equal(payload.data.canonical_device_id, "KIOSK_08");
});
assert.equal(authenticatedDeviceMiddlewareCalls, 1, "device-addressed employee reads must authenticate the phone");
assert.ok(authenticatedCalls.some((sql) => sql.includes("from public.device_aliases")));

const staleCalls = [];
await withServer(buildApp(async (sql) => {
  staleCalls.push(sql);
  if (sql.includes("static_weekly_v5_read_employee_day")) return [{ data: employeeDay("stale_staffing_change") }];
  throw new Error("legacy fallback must not run for stale weekly authority");
}), async (origin) => {
  const response = await fetch(`${origin}/schedule-api/my-day-summary?employee_id=${employeeId}&service_date=${serviceDate}`);
  assert.equal(response.status, 503);
  const payload = await response.json();
  assert.equal(payload.code, "weekly_schedule_rebuild_required");
  assert.equal(payload.readiness.projection_status, "stale_staffing_change");
});
assert.equal(staleCalls.length, 1);

const invalidCalls = [];
await withServer(buildApp(async (sql) => {
  invalidCalls.push(sql);
  if (sql.includes("static_weekly_v5_read_employee_day")) return [{ data: null }];
  throw new Error("legacy fallback must not run for an invalid weekly-authority response");
}), async (origin) => {
  const response = await fetch(`${origin}/schedule-api/my-day-summary?employee_id=${employeeId}&service_date=${serviceDate}`);
  assert.equal(response.status, 503);
  const payload = await response.json();
  assert.equal(payload.code, "weekly_schedule_read_invalid");
});
assert.equal(invalidCalls.length, 1);

const fallbackCalls = [];
await withServer(buildApp(async (sql) => {
  fallbackCalls.push(sql);
  if (sql.includes("static_weekly_v5_read_employee_day")) return [{ data: { governed: false, source: "legacy_daily_schedule" } }];
  if (sql.includes("static_weekly_v6_schedule_authority_state")) return [{ governed: false, authority_source: "legacy_daily_schedule", projection_status: "legacy_ungoverned" }];
  if (sql.includes("as roster_count") && sql.includes("as assignment_count")) return [{ current_service_date: serviceDate, roster_count: 1, assignment_count: 1 }];
  if (sql.includes("sch_employee_my_schedule_page")) return [{ data: { ok: true, employee_name: "Legacy Employee", employee: { display_name: "Legacy Employee" }, shift: { start: "07:00 AM", end: "04:00 PM", active: true }, current_items: [] } }];
  if (sql.includes("sch_get_daily_schedule_with_purpose")) return [{ group_code: "LEGACY", group_name: "Legacy Area", included_locations: ["Legacy Area"], coverage_start: "08:00 AM", coverage_end: "09:00 AM", status: "ASSIGNED" }];
  throw new Error(`unexpected fallback query: ${sql}`);
}), async (origin) => {
  const response = await fetch(`${origin}/schedule-api/my-day-summary?employee_id=${employeeId}&service_date=${serviceDate}`);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.data.employee_name, "Legacy Employee");
  assert.equal(payload.data.items[0].name, "Legacy Area");
});
assert.ok(fallbackCalls.some((sql) => sql.includes("sch_employee_my_schedule_page")), "non-governed dates retain bounded compatibility");

const missingFunctionCalls = [];
await withServer(buildApp(async (sql) => {
  missingFunctionCalls.push(sql);
  if (sql.includes("static_weekly_v5_read_employee_day")) throw new Error("function public.static_weekly_v5_read_employee_day(date, uuid, timestamp with time zone) does not exist");
  if (sql.includes("static_weekly_v6_schedule_authority_state")) throw new Error("function public.static_weekly_v6_schedule_authority_state(date) does not exist");
  throw new Error(`unexpected rollout query: ${sql}`);
}), async (origin) => {
  const response = await fetch(`${origin}/schedule-api/my-day-summary?employee_id=${employeeId}&service_date=${serviceDate}`);
  assert.equal(response.status, 503);
  const payload = await response.json();
  assert.equal(payload.code, "schedule_authority_unavailable");
});
assert.ok(!missingFunctionCalls.some((sql) => sql.includes("sch_employee_my_schedule_page")), "missing canonical authority fails closed instead of reaching a legacy writer or reader");

console.log("STATIC_WEEKLY_EMPLOYEE_DAY_ROUTE_PASS");
