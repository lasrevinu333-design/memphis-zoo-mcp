import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import express from "express";
import {
  createDailyPinSession,
  createOpenOpsManagerSession,
  getNextDailyReset,
  getOperationalDayKey,
  installDailyPinAuthRoutes,
  isOpsManagerAuthDisabled,
  makeDailyPinMiddleware,
  verifyDailyPinToken,
} from "../src/auth/daily-pin-auth.js";
import { makeMcpConnectorMiddleware } from "../src/auth/mcp-connector-auth.js";

const env = {
  PIN_SESSION_SECRET: "test-pin-session-secret",
  OPS_MANAGER_DAILY_PIN: "9001",
  CUSTODIAN_DAILY_PIN: "7007",
  PIN_MAX_ATTEMPTS: "3",
  MEMPHIS_OPERATIONAL_TIME_ZONE: "America/Chicago",
};
const strictEnv = { ...env, MEMPHIS_DISABLE_OPS_MANAGER_AUTH: "false" };

assert.equal(isOpsManagerAuthDisabled(env), true);
assert.equal(isOpsManagerAuthDisabled(strictEnv), true);
const openSession = createOpenOpsManagerSession({ deviceId: "ops-ipad-1", now: new Date("2026-05-26T15:00:00.000Z"), env });
assert.equal(openSession.role, "ops_manager");
assert.equal(openSession.auth_mode, "open");
assert.equal(openSession.device_id, "ops-ipad-1");

assert.equal(getOperationalDayKey(new Date("2026-05-26T08:59:00.000Z"), "America/Chicago"), "2026-05-25");
assert.equal(getOperationalDayKey(new Date("2026-05-26T09:00:00.000Z"), "America/Chicago"), "2026-05-26");
assert.equal(getNextDailyReset(new Date("2026-05-26T08:59:00.000Z"), "America/Chicago").toISOString(), "2026-05-26T09:00:00.000Z");
assert.equal(getNextDailyReset(new Date("2026-05-26T09:00:00.000Z"), "America/Chicago").toISOString(), "2026-05-27T09:00:00.000Z");

const opsSession = createDailyPinSession({ pin: strictEnv.OPS_MANAGER_DAILY_PIN, deviceId: "ops-ipad-1", now: new Date("2026-05-26T15:00:00.000Z"), env: strictEnv });
assert.equal(opsSession.role, "ops_manager");
assert.equal(opsSession.device_id, "ops-ipad-1");
assert.equal(opsSession.operational_day, "2026-05-26");
assert.equal(verifyDailyPinToken(opsSession.token, { allowedRoles: ["ops_manager"], deviceId: "ops-ipad-1", now: new Date("2026-05-26T15:01:00.000Z"), env: strictEnv }).ok, true);
assert.equal(verifyDailyPinToken(opsSession.token, { allowedRoles: ["ops_manager"], now: new Date("2026-05-26T15:01:00.000Z"), env: strictEnv }).status, 401);
assert.equal(verifyDailyPinToken(opsSession.token, { allowedRoles: ["ops_manager"], deviceId: "other-device", now: new Date("2026-05-26T15:01:00.000Z"), env: strictEnv }).status, 401);
assert.equal(verifyDailyPinToken(opsSession.token, { allowedRoles: ["custodian"], deviceId: "ops-ipad-1", now: new Date("2026-05-26T15:01:00.000Z"), env: strictEnv }).status, 403);
assert.equal(verifyDailyPinToken(opsSession.token, { allowedRoles: ["ops_manager"], deviceId: "ops-ipad-1", now: new Date("2026-05-27T09:00:01.000Z"), env: strictEnv }).status, 401);

const custodianSession = createDailyPinSession({ pin: strictEnv.CUSTODIAN_DAILY_PIN, deviceId: "custodian-tablet-a", now: new Date("2026-05-26T15:00:00.000Z"), env: strictEnv });
assert.equal(custodianSession.role, "custodian");
assert.equal(verifyDailyPinToken(`${custodianSession.token}tampered`, { now: new Date("2026-05-26T15:01:00.000Z"), env: strictEnv }).ok, false);
assert.throws(() => createDailyPinSession({ pin: "9999", deviceId: "bad", env: strictEnv }), /Invalid daily PIN/);
assert.throws(() => createDailyPinSession({ pin: strictEnv.CUSTODIAN_DAILY_PIN, deviceId: "bad", env: strictEnv, requiredRole: "ops_manager" }), /Ops manager PIN required/);

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

const app = express();
app.use(express.json());
installDailyPinAuthRoutes(app, { setCors: (res) => res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Memphis-Auth, X-Device-Id"), env, attempts: new Map() });
app.get("/ops-only", makeDailyPinMiddleware({ allowedRoles: ["ops_manager"], env, openWhenDisabled: true }), (_req, res) => res.json({ ok: true }));
app.get("/mixed-role", makeDailyPinMiddleware({ allowedRoles: ["ops_manager", "custodian"], env }), (_req, res) => res.json({ ok: true }));
app.get("/public-feedback", (_req, res) => res.json({ ok: true }));

await withServer(app, async (baseUrl) => {
  let response = await fetch(`${baseUrl}/auth-api/pin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pin: env.OPS_MANAGER_DAILY_PIN, device_id: "ops-ipad-1", role: "ops_manager" }),
  });
  assert.equal(response.status, 200);
  const login = await response.json();
  assert.equal(login.ok, true);
  assert.equal(login.data.role, "ops_manager");
  assert.ok(login.data.token);
  assert.equal(login.data.auth_mode, "open");

  response = await fetch(`${baseUrl}/ops-only`);
  assert.equal(response.status, 200, "ops manager routes should stay open when manager PIN auth is disabled");

  response = await fetch(`${baseUrl}/auth-api/session`);
  assert.equal(response.status, 401, "generic session endpoint should stay protected unless a caller presents a real session");

  response = await fetch(`${baseUrl}/mixed-role`);
  assert.equal(response.status, 401, "open manager mode must not silently bypass mixed-role routes unless they explicitly opt in");

  response = await fetch(`${baseUrl}/ops-only`, { headers: { Authorization: `Bearer ${login.data.token}`, "X-Device-Id": "ops-ipad-1" } });
  assert.equal(response.status, 200);

  response = await fetch(`${baseUrl}/ops-only`, { headers: { Authorization: `Bearer ${login.data.token}` } });
  assert.equal(response.status, 200, "device binding is intentionally bypassed when ops-manager auth is open");

  response = await fetch(`${baseUrl}/ops-only`, { headers: { Authorization: `Bearer ${login.data.token}`, "X-Device-Id": "other-device" } });
  assert.equal(response.status, 200, "open ops-manager mode should not reject device changes");

  response = await fetch(`${baseUrl}/ops-only`, { headers: { "X-Admin-Key": "deprecated-key" } });
  assert.equal(response.status, 200, "open ops-manager mode should not require any specific manager credential headers");

  response = await fetch(`${baseUrl}/public-feedback`);
  assert.equal(response.status, 200, "guest/system feedback style public routes must not require PIN");

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    response = await fetch(`${baseUrl}/auth-api/pin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin: "wrong-pin", device_id: "locked-device", role: "custodian" }),
    });
  }
  assert.equal(response.status, 429, "third bad custodian PIN attempt locks the device/IP until reset");
  response = await fetch(`${baseUrl}/auth-api/pin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pin: env.CUSTODIAN_DAILY_PIN, device_id: "locked-device", role: "custodian" }),
  });
  assert.equal(response.status, 429, "custodian lockout blocks even the right PIN until reset");
});

const mcpEnv = {
  ...strictEnv,
  MEMPHIS_DISABLE_OPS_MANAGER_AUTH: "false",
  MCP_CONNECTOR_TOKEN: "connector-secret-token",
};
const mcpApp = express();
mcpApp.use(express.json());
mcpApp.post("/mcp-protected", makeMcpConnectorMiddleware({ env: mcpEnv }), (_req, res) => res.json({ ok: true }));

await withServer(mcpApp, async (baseUrl) => {
  let response = await fetch(`${baseUrl}/mcp-protected`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ping: true }),
  });
  assert.equal(response.status, 401, "MCP routes should reject anonymous requests once MCP_CONNECTOR_TOKEN is configured");

  response = await fetch(`${baseUrl}/mcp-protected`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Memphis-Connector-Token": mcpEnv.MCP_CONNECTOR_TOKEN },
    body: JSON.stringify({ ping: true }),
  });
  assert.equal(response.status, 200, "MCP connector token should authorize /mcp requests");

  response = await fetch(`${baseUrl}/mcp-protected`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Memphis-Connector-Token": "wrong-token" },
    body: JSON.stringify({ ping: true }),
  });
  assert.equal(response.status, 401, "Wrong MCP connector token must be rejected");

  const strictSession = createDailyPinSession({
    pin: strictEnv.OPS_MANAGER_DAILY_PIN,
    deviceId: "ops-ipad-1",
    now: new Date(),
    env: strictEnv,
  });
  response = await fetch(`${baseUrl}/mcp-protected`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${strictSession.token}`,
      "X-Device-Id": "ops-ipad-1",
    },
    body: JSON.stringify({ ping: true }),
  });
  assert.equal(response.status, 200, "A real ops-manager PIN session should remain a valid MCP fallback when connector token rollout is enabled");
});

const fallbackMcpApp = express();
fallbackMcpApp.use(express.json());
fallbackMcpApp.post("/mcp-protected", makeMcpConnectorMiddleware({ env }), (_req, res) => res.json({ ok: true }));

await withServer(fallbackMcpApp, async (baseUrl) => {
  const response = await fetch(`${baseUrl}/mcp-protected`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ping: true }),
  });
  assert.equal(response.status, 200, "Without MCP_CONNECTOR_TOKEN, legacy open ops-manager rollout behavior must remain intact until the connector secret is configured");
});

const backendIndex = readFileSync(resolve("src/index.js"), "utf8");
const diagnostics = readFileSync(resolve("src/mcp-schema-bootstrap.js"), "utf8");
const eventsAdminHtml = readFileSync(resolve("../Engine/events-admin.html"), "utf8");
const eventsBoardHtml = readFileSync(resolve("../Engine/events.html"), "utf8");
const managerHubHtml = readFileSync(resolve("../Engine/admin.html"), "utf8");
const opsManagerHubHtml = readFileSync(resolve("../Engine/start_page1.html"), "utf8");
const managerChangePages = [
  ["dashboard.html", readFileSync(resolve("../Engine/dashboard.html"), "utf8")],
  ["schedule-simple.html", readFileSync(resolve("../Engine/schedule-simple.html"), "utf8")],
  ["schedule.html", readFileSync(resolve("../Engine/schedule.html"), "utf8")],
];
const messagesHtml = readFileSync(resolve("../Engine/messages.html"), "utf8");
const threadHtml = readFileSync(resolve("../Engine/thread.html"), "utf8");
const authHelper = readFileSync(resolve("../Engine/memphis-auth.js"), "utf8");

assert.doesNotMatch(backendIndex, /allowWithoutPin|function\s+requireAdminApiAuth|requireAnyStaffAuth/);
assert.match(backendIndex, /app\.use\("\/dashboard-api"[\s\S]*next\(\); \}\);/);
assert.match(backendIndex, /app\.use\("\/guest-api"[\s\S]*next\(\); \}\);/);
assert.match(backendIndex, /app\.use\("\/feedback-api"[\s\S]*next\(\); \}\);/);
assert.match(backendIndex, /createScheduleRouter\([\s\S]*requireAdminApiAuth:\s*requireOpsManagerAuth/);
assert.match(backendIndex, /createEventsAdminRouter\([\s\S]*requireAdminApiAuth:\s*requireOpsManagerAuth/);
assert.match(backendIndex, /app\.post\("\/dashboard-api\/close-ticket",\s*requireOpsManagerAuth/);
assert.match(backendIndex, /makeDailyPinMiddleware\(\{ allowedRoles: \["ops_manager"\], openWhenDisabled: true \}\)/);
assert.match(backendIndex, /makeMcpConnectorMiddleware/);
assert.match(backendIndex, /const requireMcpAuth = makeMcpConnectorMiddleware\(\)/);
assert.match(backendIndex, /MCP_CONNECTOR_TOKEN/);
assert.match(backendIndex, /app\.post\("\/mcp",\s*requireMcpAuth/);
assert.match(backendIndex, /app\.get\("\/sse",\s*requireMcpAuth/);
assert.match(backendIndex, /app\.post\("\/messages",\s*requireMcpAuth/);
assert.doesNotMatch(backendIndex, /X-Admin-Key|ADMIN_API_KEY|admin-api-key|x-admin-key/i);
assert.match(diagnostics, /makeDailyPinMiddleware\(\{ allowedRoles: \["ops_manager"\], openWhenDisabled: true \}\)/);
assert.match(diagnostics, /\/mcp-tools\.json",\s*requireOpsManagerAuth/);
assert.match(diagnostics, /\/status\/deep",\s*requireOpsManagerAuth/);

assert.match(authHelper, /requireOpsManagerSession/);
assert.match(authHelper, /OPS_MANAGER_OPEN_PAGES=new Set/);
assert.doesNotMatch(authHelper, /hub==='manager'/);
assert.match(authHelper, /DEFAULT_MANAGER_HUB='\.\/start_page1\.html'/);
assert.doesNotMatch(authHelper, /protectedPrefixes|window\.fetch\s*=/);
assert.match(opsManagerHubHtml, /requireOpsManagerSession\(\{interactive:true\}\)/);
assert.match(opsManagerHubHtml, /URLSearchParams\(window\.location\.search\)\.get\('return'\)/);
assert.doesNotMatch(managerHubHtml, /Ops Manager PIN/);
assert.doesNotMatch(managerHubHtml, /X-Admin-Key|Admin access key|Use Admin Key|mz_admin_api_key/i);
assert.match(eventsAdminHtml, /requireOpsManagerSession\(\{interactive:false,redirect:true\}\)/);
assert.match(eventsAdminHtml, /Redirecting to Manager Hub/);
assert.doesNotMatch(eventsBoardHtml, /ensureDailyPinSession|Enter today’s Memphis Zoo PIN/);
assert.doesNotMatch(eventsBoardHtml, /requireOpsManagerSession|opsManagerAuthHeaders|Authorization:`Bearer|X-Device-Id/);
assert.match(eventsBoardHtml, /fetch\(CONFIG\.EVENTS_URL,\{cache:'no-store'\}\)/);
assert.match(backendIndex, /app\.use\("\/dashboard-api\/events", createEventsPublicRouter/);
assert.doesNotMatch(backendIndex, /app\.use\("\/dashboard-api\/events",\s*requireOpsManagerAuth/);
for (const [pageName, pageHtml] of managerChangePages) {
  assert.match(pageHtml, /requireOpsManagerSession\(\{interactive:false,redirect:true\}\)/, `${pageName} should redirect to Manager Hub before operational changes`);
}
assert.match(readFileSync(resolve("../Engine/dashboard.html"), "utf8"), /opsManagerAuthHeaders\(\)/);
assert.match(readFileSync(resolve("../Engine/schedule.html"), "utf8"), /opsManagerAuthHeaders\(\)/);
assert.match(readFileSync(resolve("../Engine/schedule-simple.html"), "utf8"), /opsManagerAuthHeaders\(\)/);
assert.doesNotMatch(messagesHtml, /requireOpsManagerSession\(\{interactive:false,redirect:true\}\)/);
assert.doesNotMatch(threadHtml, /requireOpsManagerSession\(\{interactive:false,redirect:true\}\)/);
assert.match(messagesHtml, /optionalManagerAuthHeaders\(\)/);
assert.match(threadHtml, /optionalManagerAuthHeaders\(\)/);

console.log("daily pin auth contract tests passed");
