import assert from "node:assert/strict";
import express from "express";
import { createScheduleRouter } from "../src/schedule-api.js";

const RUN_ID = "01af3c79-167b-4352-abc1-b145aa3a042f";

function buildApp({ readCalls, writeCalls, rpcCalls }) {
  const app = express();
  app.use(express.json());
  app.use(
    "/schedule-api",
    createScheduleRouter({
      runReadOnlySql: async (sql) => {
        const query = String(sql || "");
        readCalls.push(query);
        if (query.includes("left join public.schedule_publish_audit")) {
          return [
            {
              run_id: RUN_ID,
              service_date: "2026-06-12",
              status: "published",
              published_at: "2026-06-12T16:11:09.499193+00:00",
              published_by: "schedule_api_guarded_sql_publish",
              publish_audit_id: "11111111-1111-4111-8111-111111111111",
              inserted_rows: 140,
              audit: {
                hard_violation_count: 0,
                open_required_count: 0,
                work_item_count: 140,
                solution_assignment_count: 140,
              },
              diff: { diff_count: 2 },
            },
          ];
        }
        if (query.includes("from public.schedule_generation_runs") && query.includes("r.audit_summary as audit")) {
          return [
            {
              run_id: RUN_ID,
              service_date: "2026-06-12",
              audit: {
                hard_violation_count: 0,
                open_required_count: 0,
                work_item_count: 140,
                solution_assignment_count: 140,
              },
              diff: { diff_count: 2 },
            },
          ];
        }
        return [];
      },
      runRpc: async (functionName, args) => {
        rpcCalls.push({ functionName, args });
        if (functionName === "sch2_publish_solution") {
          throw new Error("permission denied for function sch2_publish_solution");
        }
        return null;
      },
      runCommand: async (namePrefix, payload) => { writeCalls.push({ namePrefix, payload }); return { ok: true }; },
      buildHealthPayload: () => ({ ok: true }),
      requireAdminApiAuth: (_req, _res, next) => next(),
      appVersion: "test-version",
      releaseId: "test-release",
      contractVersion: "schedule.test",
    }),
  );
  return app;
}

async function withServer(app, fn) {
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  try {
    const { port } = server.address();
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

{
  const readCalls = [];
  const writeCalls = [];
  const rpcCalls = [];
  await withServer(buildApp({ readCalls, writeCalls, rpcCalls }), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/schedule-api/sch2/publish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ run_id: RUN_ID, confirm: false }),
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.data.publish_result.dry_run, true);
    assert.equal(payload.data.publish_result.fallback, "read_only_guarded_sql");
    assert.equal(writeCalls.length, 0, "dry-run privilege fallback must not write");
    assert.equal(rpcCalls[0].functionName, "sch2_publish_solution");
  });
}

{
  const readCalls = [];
  const writeCalls = [];
  const rpcCalls = [];
  await withServer(buildApp({ readCalls, writeCalls, rpcCalls }), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/schedule-api/sch2/publish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ run_id: RUN_ID, confirm: true }),
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.data.publish_result.fallback, "bounded_command");
    assert.deepEqual(writeCalls, [{ namePrefix: "sch2_guarded_publish", payload: { run_id: RUN_ID } }], "confirmed publish uses its one typed bounded command fallback");
    assert.equal(rpcCalls[0].functionName, "sch2_publish_solution");
  });
}

console.log("SCH2 publish route bounded authority tests passed");
