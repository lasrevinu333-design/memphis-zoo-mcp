import assert from "node:assert/strict";
import express from "express";
import { createScheduleRouter } from "../src/schedule-api.js";

function buildApp(readCalls = []) {
  const app = express();
  app.use(express.json());
  app.use("/schedule-api", createScheduleRouter({
    runReadOnlySql: async (sql) => {
      const query = String(sql || "");
      readCalls.push(query);
      if (query.includes("sch_service_date(now())")) return [{ service_date: "2026-06-10" }];
      if (/from\s+public\.employees/i.test(query) && /Clayton Jones/i.test(query)) {
        return [{ employee_id: "85170562-5f48-4e3d-9df6-760d0e3ff5f0" }];
      }
      if (/from\s+public\.employees/i.test(query) && /Jennifer Sheffield/i.test(query)) {
        return [{ employee_id: "f982df75-54fb-4547-a5c6-e8845d54a171" }];
      }
      if (query.includes("sch_employee_my_schedule_page") && query.includes("85170562-5f48-4e3d-9df6-760d0e3ff5f0")) {
        return [{ data: {
          ok: true,
          items: [],
          phase: "current",
          shift: null,
          notice: null,
          employee: {
            role: "admin",
            employee_id: "85170562-5f48-4e3d-9df6-760d0e3ff5f0",
            display_name: "Clayton Jones - Chief Operating Officer",
            employee_code: "DEMO_CLAYTON"
          },
          service_date: "2026-06-10"
        } }];
      }
      if (query.includes("sch_employee_my_schedule_page") && query.includes("f982df75-54fb-4547-a5c6-e8845d54a171")) {
        return [{ data: {
          ok: true,
          items: [],
          phase: "current",
          shift: null,
          notice: null,
          employee: {
            role: "admin",
            employee_id: "f982df75-54fb-4547-a5c6-e8845d54a171",
            display_name: "Jennifer Sheffield - Director of Operations",
            employee_code: "DEMO_JENNIFER"
          },
          service_date: "2026-06-10"
        } }];
      }
      return [];
    },
    runRpc: async () => null,
    runCommand: async () => null,
    buildHealthPayload: async () => ({ ok: true }),
    requireAdminApiAuth: (_req, _res, next) => next(),
    appVersion: "test",
    releaseId: "test",
    contractVersion: "schedule.v1",
  }));
  return app;
}

async function withServer(app, fn) {
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, () => resolve(listener));
  });
  try {
    const { port } = server.address();
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

const readCalls = [];
await withServer(buildApp(readCalls), async (baseUrl) => {
  for (const employeeName of ["Clayton Jones", "Jennifer Sheffield"]) {
    const response = await fetch(`${baseUrl}/schedule-api/my-day-summary?employee_name=${encodeURIComponent(employeeName)}`);
    assert.equal(response.status, 200, `${employeeName} short-name lookup should resolve to demo employee`);
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.data.ok, true);
    assert.deepEqual(payload.data.items, [], `${employeeName} schedule should remain blank/no assignments`);
    assert.match(payload.data.employee.display_name, new RegExp(employeeName));
  }
});

assert.ok(readCalls.some((query) => /display_name\s+ilike\s+'Clayton Jones%'/i.test(query)), "short-name lookup should allow matching titled demo display names");
assert.ok(readCalls.some((query) => /display_name\s+ilike\s+'Jennifer Sheffield%'/i.test(query)), "short-name lookup should allow matching titled demo display names");

console.log("demo-leadership-blank-schedule-tests passed");
