#!/usr/bin/env node

import http from "node:http";
import pg from "pg";
import { makeRestoreMutationGate } from "../src/restore-mutation-gate.js";

const { Client } = pg;
const databaseUrl = String(process.env.RESTORE_GATE_TERMINATION_DATABASE_URL || "").trim();
const leaseId = String(process.env.RESTORE_GATE_TERMINATION_LEASE_ID || "").trim();
if (!/(localhost|127\.0\.0\.1|test|ci)/i.test(databaseUrl) || !/^[0-9a-f-]{36}$/i.test(leaseId)) {
  throw new Error("The terminated-owner fixture requires a disposable database URL and exact lease UUID.");
}

const db = new Client({ connectionString: databaseUrl });
await db.connect();
const calls = [];
process.on("exit", (code) => {
  process.stdout.write(`${JSON.stringify({ code, calls })}\n`);
});

const supabase = {
  async rpc(name, args) {
    calls.push(name);
    if (name === "custodial_begin_application_mutation_lease") {
      const result = await db.query("select public.custodial_begin_application_mutation_lease($1,$2) data", [args.p_request_id, args.p_service_name]);
      return { data: result.rows[0].data, error: null };
    }
    if (name === "custodial_heartbeat_application_mutation_lease") {
      const result = await db.query("select public.custodial_heartbeat_application_mutation_lease($1) data", [args.p_request_id]);
      return { data: result.rows[0].data, error: null };
    }
    if (name === "custodial_release_application_mutation_lease") {
      const result = await db.query("select public.custodial_release_application_mutation_lease($1) data", [args.p_request_id]);
      return { data: result.rows[0].data, error: null };
    }
    throw new Error(`Unexpected RPC ${name}`);
  },
};
const gate = makeRestoreMutationGate({
  supabase,
  serviceName: "abandoned-process-test",
  requestId: () => leaseId,
  heartbeatMilliseconds: 5,
  disconnectTerminationMilliseconds: 35,
  logger: { error() {} },
});
const server = http.createServer(async (req, res) => {
  await gate(req, res, () => {
    // This deliberately non-cooperative handler never settles.
  });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const request = http.request({ host: "127.0.0.1", port: server.address().port, path: "/", method: "POST" });
request.on("error", () => {});
request.on("socket", () => setTimeout(() => request.destroy(), 10));
request.end("work");
setTimeout(() => process.exit(99), 2_000).unref();
