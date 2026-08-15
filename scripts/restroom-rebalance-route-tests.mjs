import assert from "node:assert/strict";
import express from "express";
import { createScheduleRouter } from "../src/schedule-api.js";

const SERVICE_DATE = "2026-07-20";
const EMPLOYEE_A = "00000000-0000-4000-8000-00000000a001";
const EMPLOYEE_B = "00000000-0000-4000-8000-00000000a002";
const EMPLOYEE_C = "00000000-0000-4000-8000-00000000a003";
const GROUPS = [
  "00000000-0000-4000-8000-00000000b001",
  "00000000-0000-4000-8000-00000000b002",
  "00000000-0000-4000-8000-00000000b003",
];
const ASSIGNMENTS = [
  "00000000-0000-4000-8000-00000000c001",
  "00000000-0000-4000-8000-00000000c002",
  "00000000-0000-4000-8000-00000000c003",
];

const roster = [
  { employee_id: EMPLOYEE_A, employee_name: "Alex", employee_code: "EMP-A", shift_start: "05:00:00", shift_end: "15:00:00", zone_codes: ["NORTH"], current_group_count: 3 },
  { employee_id: EMPLOYEE_B, employee_name: "Blair", employee_code: "EMP-B", shift_start: "05:00:00", shift_end: "15:00:00", zone_codes: [], current_group_count: 0 },
  { employee_id: EMPLOYEE_C, employee_name: "Casey", employee_code: "EMP-C", shift_start: "05:00:00", shift_end: "15:00:00", zone_codes: [], current_group_count: 0 },
];
const assignments = ASSIGNMENTS.map((assignmentId, index) => ({
  assignment_id: assignmentId,
  assigned_employee_id: EMPLOYEE_A,
  assigned_employee_name: "Alex",
  employee_code: "EMP-A",
  location_group_id: GROUPS[index],
  group_name: `Restroom ${index + 1}`,
  group_code: `RESTROOM_${index + 1}`,
  zone_code: "NORTH",
  segment_number: 1,
  source_type: "coverage_template",
  coverage_start: "09:45:00",
  coverage_end: "15:00:00",
  load_points: 1,
  restricted_employee_ids: [],
}));

function buildApp({ readCalls, writeCalls, rpcCalls }) {
  const app = express();
  app.use(express.json());
  app.use("/schedule-api", createScheduleRouter({
    runReadOnlySql: async (sql) => {
      const query = String(sql || "");
      readCalls.push(query);
      if (query.includes("select public.sch_service_date(now()) as service_date")) {
        return [{ service_date: SERVICE_DATE }];
      }
      if (query.includes("as roster_count") && query.includes("as assignment_count")) {
        return [{ roster_count: roster.length, assignment_count: assignments.length }];
      }
      if (query.includes("coalesce(route.zone_codes") && query.includes("route_anchor_zone_code")) return roster;
      if (query.includes("restricted_employee_ids") && query.includes("greatest(coalesce(dsa.load_points")) return assignments;
      if (query.includes("with target(location_group_id)") && query.includes("route_context")) {
        return roster.flatMap((employee) => GROUPS.map((locationGroupId) => ({
          employee_id: employee.employee_id,
          location_group_id: locationGroupId,
          current_group_count: employee.current_group_count,
          same_group: employee.employee_id === EMPLOYEE_A,
          same_zone: employee.employee_id === EMPLOYEE_A,
          walking_minutes: employee.employee_id === EMPLOYEE_A ? 0 : 6,
          route_context: employee.employee_id === EMPLOYEE_A ? "same_group" : "flex_helper_no_current_route",
        })));
      }
      return [];
    },
    runRpc: async (functionName, args) => {
      rpcCalls.push({ functionName, args });
      if (functionName === "sch_apply_lunch_coverage") return { ok: true, applied: false };
      throw new Error(`Unexpected RPC: ${functionName}`);
    },
    runCommand: async (namePrefix, payload) => {
      writeCalls.push({ namePrefix, payload });
      if (namePrefix !== "restroom_rebalance_0945") return [];
      return [
        { assignment_id: ASSIGNMENTS[0], assigned_employee_id: EMPLOYEE_B, status: "ASSIGNED", owner_type: "EMPLOYEE", source_type: "restroom_rebalance_0945" },
        { assignment_id: ASSIGNMENTS[1], assigned_employee_id: EMPLOYEE_C, status: "ASSIGNED", owner_type: "EMPLOYEE", source_type: "restroom_rebalance_0945" },
      ];
    },
    buildHealthPayload: () => ({ ok: true }),
    requireAdminApiAuth: (_req, _res, next) => next(),
    appVersion: "route-test",
    releaseId: "route-test",
    contractVersion: "schedule.route-test",
  }));
  return app;
}

async function withServer(app, fn) {
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  try {
    await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

const readCalls = [];
const writeCalls = [];
const rpcCalls = [];
await withServer(buildApp({ readCalls, writeCalls, rpcCalls }), async (baseUrl) => {
  const response = await fetch(`${baseUrl}/schedule-api/restroom-rebalance/run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ service_date: SERVICE_DATE }),
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.data.implementation_mode, "dynamic_route_fit_load_balancing");
  assert.equal(payload.data.balance.applied, true);
  assert.equal(payload.data.balance.moved_count, 2);
  assert.deepEqual(payload.data.balance.loads, {
    [EMPLOYEE_A]: 1,
    [EMPLOYEE_B]: 1,
    [EMPLOYEE_C]: 1,
  });
  assert.equal(payload.data.balance.skipped_moves.length, 0);

  const statusResponse = await fetch(`${baseUrl}/schedule-api/restroom-rebalance/status`);
  assert.equal(statusResponse.status, 200);
  const statusPayload = await statusResponse.json();
  assert.deepEqual(statusPayload.data.scheduler, {
    enabled: false,
    sweep_ms: 0,
    owner: "disabled",
    source: "disabled_by_default",
  });
});

const rebalanceWrite = writeCalls.find((call) => call.namePrefix === "restroom_rebalance_0945");
assert.ok(rebalanceWrite, "the HTTP route must execute the planner's guarded write");
assert.equal(rebalanceWrite.payload.service_date, SERVICE_DATE);
assert.equal(rebalanceWrite.payload.moves.length, 2);
assert.equal(rebalanceWrite.payload.source, "restroom_rebalance_0945");
assert.ok(readCalls.some((sql) => sql.includes("coalesce(route.zone_codes")), "the route must load active route context");
assert.ok(readCalls.some((sql) => sql.includes("with target(location_group_id)")), "the route must load configured proximity data");
assert.equal(rpcCalls.filter((call) => call.functionName === "sch_apply_lunch_coverage").length, 1);
assert.equal(rpcCalls.some((call) => call.functionName === "sch_generate_daily_schedule"), false, "a ready schedule must not be regenerated");

console.log(JSON.stringify({
  ok: true,
  classification: "HTTP route integration with deterministic database doubles",
  implementation_mode: "dynamic_route_fit_load_balancing",
  initial_loads: [3, 0, 0],
  final_loads: [1, 1, 1],
  persisted_moves: 2,
}));
