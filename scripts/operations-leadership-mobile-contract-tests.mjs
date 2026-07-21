import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import express from "express";
import { installLeadershipHttpRoutes } from "../src/leadership-bootstrap.js";

const root = new URL("../", import.meta.url);
const [bootstrap, schemaBootstrap, migration, authSource] = await Promise.all([
  readFile(new URL("src/leadership-bootstrap.js", root), "utf8"),
  readFile(new URL("src/mcp-schema-bootstrap.js", root), "utf8"),
  readFile(new URL("supabase/migrations/20260721190000_operations_leadership_mobile_foundation.sql", root), "utf8"),
  readFile(new URL("src/auth/shared-access-auth.js", root), "utf8"),
]);

for (const required of [
  "Brandy Gull", "Horticulture Manager",
  "Haley Lejman", "Water Quality Manager",
  "Eric McKenney", "Facilities Maintenance Manager",
  "Jennifer Sheffield", "Director of Operations",
  "Eric Operle", "Custodial Manager",
]) assert.ok(migration.includes(required), `migration must include ${required}`);

assert.match(migration, /Operations Leadership Chat/);
assert.match(migration, /Legacy Shared Ops Manager/);
assert.match(migration, /shared_identity_quarantined_20260721/);
assert.match(migration, /public_viewer_dashboard_snapshot/);
assert.doesNotMatch(migration, /update\s+public\.msg_messages\s+set\s+sender_user_id/i, "historical senders must not be rewritten");
assert.match(bootstrap, /\/mobile-auth-api\/enroll/);
assert.match(bootstrap, /\/mobile-auth-api\/session/);
assert.match(bootstrap, /\/leadership-api\/managers\/:managerId\/enrollment-code/);
assert.match(bootstrap, /\/moxie-mobile-api\/chat/);
assert.match(bootstrap, /\/viewer-api\/dashboard/);
assert.match(bootstrap, /capacitor:\/\/localhost/);
assert.match(bootstrap, /replace\(\/\[’‘\]\/g, "'"\)/);
assert.doesNotMatch(bootstrap, /express\.application\.use\s*=/, "leadership routes must not revive retired browser routes through a global Express hook");
assert.match(schemaBootstrap, /installLeadershipHttpRoutes/);
assert.match(authSource, /app\.post\("\/auth-api\/ops\/manager-codes\/consume"/);

const echo = express();
echo.use(express.json());
echo.post("/echo", (req, res) => res.json(req.body));
const echoServer = echo.listen(0, "127.0.0.1");
await new Promise((resolve) => echoServer.once("listening", resolve));
try {
  const response = await fetch(`http://127.0.0.1:${echoServer.address().port}/echo`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ body: "Who’s working tomorrow — and who’s off?" }),
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).body, "Who's working tomorrow - and who's off?");
} finally {
  await new Promise((resolve, reject) => echoServer.close((error) => error ? reject(error) : resolve()));
}

function queryResult(data) {
  return {
    data, error: null,
    select() { return this; }, eq() { return this; }, is() { return this; }, order() { return this; }, limit() { return this; },
    gte() { return this; }, lte() { return this; }, update() { return this; }, insert() { return this; }, delete() { return this; },
    maybeSingle() { return Promise.resolve({ data: Array.isArray(data) ? data[0] : data, error: null }); },
    single() { return Promise.resolve({ data: Array.isArray(data) ? data[0] : data, error: null }); },
    then(resolve) { return Promise.resolve({ data, error: null }).then(resolve); },
  };
}
const fakeSupabase = {
  rpc: async (name) => {
    assert.equal(name, "public_viewer_dashboard_snapshot");
    return { data: { operational_date: "2026-07-21", locations_total: 47, locations_current: 45 }, error: null };
  },
  from: () => queryResult([]),
};
const app = express();
installLeadershipHttpRoutes(app, { supabase: fakeSupabase, env: { OPS_MANAGER_SESSION_SECRET: "test-secret" } });
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
try {
  const base = `http://127.0.0.1:${server.address().port}`;
  const health = await fetch(`${base}/leadership-api/health`).then((r) => r.json());
  assert.equal(health.named_manager_enrollment, true);
  assert.equal(health.shared_manager_enrollment, false);
  const dashboard = await fetch(`${base}/viewer-api/dashboard`).then((r) => r.json());
  assert.equal(dashboard.ok, true);
  assert.equal(dashboard.data.locations_total, 47);
  assert.equal(JSON.stringify(dashboard).includes("employee"), false);
} finally {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

console.log("OPERATIONS_LEADERSHIP_MOBILE_CONTRACT_PASS");
