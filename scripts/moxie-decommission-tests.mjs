import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import express from "express";
import { installLeadershipHttpRoutes } from "../src/leadership-bootstrap.js";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const index = read("../src/index.js");
const barrel = read("../src/routes/index.js");
const messaging = read("../src/messaging-api.js");
const oauth = read("../src/auth/mcp-self-contained-oauth.js");
const workflow = (name) => read(`../.github/workflows/${name}`);

assert.doesNotMatch(index, /createMoxieRouter|installAnnieMoxieRoutes|MOXIE_MOUNT_PATH|\/moxie-mobile-api/);
assert.doesNotMatch(barrel, /createMoxieRouter/);
assert.match(index, /installLeadershipHttpRoutes\(app/);
assert.match(index, /createMessagingRouter\(/);
assert.match(messaging, /router\.post\("\/memphis\/thread"/);
assert.match(oauth, /env\.MOXIE_WEB_PASSWORD/, "existing OAuth credential remains untouched");

const app = express();
installLeadershipHttpRoutes(app, { supabase: {} });
const routes = app.router.stack.filter((layer) => layer.route).map((layer) => layer.route.path);
assert.ok(routes.includes("/leadership-api/health"));
assert.ok(routes.includes("/leadership-api/roster"));
assert.ok(routes.includes("/viewer-api/events"));
assert.ok(routes.every((path) => !path.startsWith("/moxie-mobile-api/")));

for (const name of [
  "foundation-security-gate.yml",
  "custodial-production-repair.yml",
  "device-credential-foundation.yml",
  "operations-leadership-mobile-foundation.yml",
  "operational-recovery-live.yml",
]) {
  const source = workflow(name);
  assert.doesNotMatch(source, /test:moxie-route|moxie-route-tests\.mjs|annie-moxie-bootstrap\.js/,
    `${name} must not run a deleted source or test`);
  assert.doesNotMatch(source, /\$root\/moxie(?:\/|\b)|moxie_health|moxie_mobile_api/,
    `${name} must not require a live retired MOXIE route`);
}
assert.match(workflow("operational-recovery-live.yml"), /retired_status.*404/s);
assert.match(workflow("foundation-security-gate.yml"), /test:moxie-decommission/);

console.log("MOXIE_DECOMMISSION_BACKEND_PASS");
