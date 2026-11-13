import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import express from "express";
// Importing leadership must preserve the shared JSON parser identity.
const originalExpressJson = express.json;
const { installLeadershipHttpRoutes } = await import("../src/leadership-bootstrap.js");
assert.equal(express.json, originalExpressJson, "leadership import must not monkeypatch express.json");
import { assertExactFrontendPair } from './fixtures/exact-frontend-pair.mjs';

const root = new URL("../", import.meta.url);
const [bootstrap, indexSource, migration, authSource, releaseManifestSource] = await Promise.all([
  readFile(new URL("src/leadership-bootstrap.js", root), "utf8"),
  readFile(new URL("src/index.js", root), "utf8"),
  readFile(new URL("supabase/migrations/20260721190000_operations_leadership_mobile_foundation.sql", root), "utf8"),
  readFile(new URL("src/auth/shared-access-auth.js", root), "utf8"),
  readFile(new URL("release/frontend-release-manifest.json", root), "utf8"),
]);
const releaseManifest = JSON.parse(releaseManifestSource);
const releasePairInput = JSON.parse(await readFile(new URL('release/schema-alignment-input.json', root), 'utf8'));

for (const required of [
  "Jennifer Sheffield", "Director of Operations",
  "Annie Feist", "Operations Admin",
  "Brandy Gull", "Horticulture Manager",
  "Haley Lejman", "Water Quality Manager",
  "Eric McKenney", "Facilities Maintenance Manager",
  "Eric Operle", "Custodial Manager",
]) assert.ok(migration.includes(required), `migration must include ${required}`);

assert.match(migration, /Operations Leadership Chat/);
assert.match(migration, /annie_feist_operations_admin/);
assert.match(migration, /Legacy Shared Ops Manager/);
assert.match(migration, /shared_identity_quarantined_20260721/);
assert.match(migration, /public_viewer_dashboard_snapshot/);
assert.doesNotMatch(migration, /update\s+public\.msg_messages\s+set\s+sender_user_id/i, "historical senders must not be rewritten");
assert.match(bootstrap, /app\.use\("\/mobile-auth-api", retiredJavaScriptCredentialRoute\)/);
assert.doesNotMatch(bootstrap, /app\.post\("\/mobile-auth-api\/(?:enroll|session|logout)"/);
assert.doesNotMatch(bootstrap, /device_credential|X-Memphis-Device-Credential/);
assert.match(bootstrap, /\/leadership-api\/managers\/:managerId\/enrollment-code/);
assert.match(bootstrap, /\/viewer-api\/dashboard/);
assert.match(bootstrap, /capacitor:\/\/localhost/);
assert.doesNotMatch(bootstrap, /express\.json\s*=/, "leadership must not globally rewrite request JSON");
assert.doesNotMatch(bootstrap, /express\.application\.use\s*=/, "leadership routes must not revive retired browser routes through a global Express hook");
assert.doesNotMatch(bootstrap, /moxie-mobile-api|requireMoxie/);
assert.doesNotMatch(indexSource, /installAnnieMoxieRoutes|createMoxieRouter/);
assert.match(indexSource, /installLeadershipHttpRoutes\(app/);
assert.match(authSource, /app\.post\("\/auth-api\/ops\/manager-codes\/consume"/);
assert.match(authSource, /app\.use\("\/auth-api\/ops\/shared-enrollment", retireSharedManagerEnrollment\)/);
assert.doesNotMatch(authSource, /app\.use\("\/auth-api\/ops\/manager-codes"/);
assert.match(authSource, /named_manager_enrollment:\s*!config\.passwordlessManagerAccess/);
assert.match(authSource, /shared_48_hour_enrollment:\s*false/);
assert.match(indexSource, /ops-manager-auth\.v6\.http-only-boundary/);
assert.doesNotMatch(indexSource, /ops-manager-auth\.v4\.shared-48h/);
assertExactFrontendPair(releaseManifest, releasePairInput);
assert.equal(releaseManifest.api_contract_versions.ops_manager_auth, "ops-manager-auth.v6.http-only-boundary");
assert.equal(releaseManifest.api_contract_versions.operational_analytics, "operational-analytics.v1");

const echo = express();
echo.use(express.json());
echo.post("/echo", (req, res) => res.json(req.body));
const echoServer = echo.listen(0, "127.0.0.1");
await new Promise((resolve) => echoServer.once("listening", resolve));
try {
  const submitted = {
    body: "Who’s working tomorrow — and who’s off?",
    message: 'It’s “closed”—please check – and preserve  internal whitespace.',
    nested: { body: 'Don’t rewrite “original” text — at any depth.' },
    items: [{ message: 'It’s unchanged.' }],
  };
  const literalWire = JSON.stringify(submitted);
  const escapedWire = literalWire.replace(/[’‘“”–—]/g, character => "\\u" + character.charCodeAt(0).toString(16).padStart(4, "0"));
  for (const wire of [literalWire, escapedWire]) {
    const response = await fetch(`http://127.0.0.1:${echoServer.address().port}/echo`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: wire,
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), submitted, "normal JSON parsing preserves original punctuation and nested data verbatim");
  }
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
  for (const path of ["enroll", "session", "logout"]) {
    const retired = await fetch(`${base}/mobile-auth-api/${path}`, { method: "POST" });
    assert.equal(retired.status, 410, `JavaScript credential route ${path} must remain retired`);
  }
} finally {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

console.log("OPERATIONS_LEADERSHIP_MOBILE_CONTRACT_PASS");
