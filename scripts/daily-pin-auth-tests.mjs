import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";
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
  OPS_MANAGER_AUTH_DISABLED: "true",
  MOXIE_WEB_PASSWORD: "memzoo",
  MOXIE_COOKIE_SECRET: "test-moxie-cookie-secret",
};
const strictEnv = { ...env, OPS_MANAGER_AUTH_DISABLED: "false" };

assert.equal(isOpsManagerAuthDisabled(env), true);
assert.equal(isOpsManagerAuthDisabled(strictEnv), false);
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

  response = await fetch(`${baseUrl}/auth-api/gemini/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "wrong" }),
  });
  assert.equal(response.status, 401, "Gemini console must reject the wrong password even while ops manager is public");

  response = await fetch(`${baseUrl}/auth-api/gemini/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "memzoo" }),
  });
  assert.equal(response.status, 200, "Gemini console should accept the shared Moxie/memzoo password fallback");
  const geminiLogin = await response.json();
  assert.equal(geminiLogin.data.role, "gemini_admin");
  assert.equal(geminiLogin.data.auth_mode, "gemini_password");

  response = await fetch(`${baseUrl}/auth-api/gemini/session`, { headers: { Authorization: `Bearer ${geminiLogin.data.token}` } });
  assert.equal(response.status, 200, "Gemini token should verify through the dedicated Gemini session route");

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
  OPS_MANAGER_AUTH_DISABLED: "false",
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
const engineRoot = [resolve("../Engine"), "/home/eric/Projects/memphis-zoo/Engine"].find((candidate) => existsSync(resolve(candidate, "memphis-auth.js")));
assert.ok(engineRoot, "Engine HTML fixture directory should exist next to the repo or in the Memphis Zoo project mirror");
const readEngineFile = (name) => readFileSync(resolve(engineRoot, name), "utf8");
const eventsAdminHtml = readEngineFile("events-admin.html");
const eventsBoardHtml = readEngineFile("events.html");
const managerHubHtml = readEngineFile("admin.html");
const opsManagerHubHtml = readEngineFile("start_page1.html");
const managerChangePages = [
  ["dashboard.html", readEngineFile("dashboard.html")],
  ["schedule-simple.html", readEngineFile("schedule-simple.html")],
  ["schedule.html", readEngineFile("schedule.html")],
];
const messagesHtml = readEngineFile("messages.html");
const threadHtml = readEngineFile("thread.html");
const authHelper = readEngineFile("memphis-auth.js");

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
assert.match(diagnostics, /makeDailyPinMiddleware\(\{ allowedRoles: \["ops_manager"\], openWhenDisabled: true \}\)/);
assert.match(diagnostics, /\/mcp-tools\.json",\s*requireOpsManagerAuth/);
assert.match(diagnostics, /\/status\/deep",\s*requireOpsManagerAuth/);

assert.match(authHelper, /requireOpsManagerSession/);
assert.match(authHelper, /OPS_MANAGER_AUTH_DISABLED=isOpsManagerOpenSurface\(\)/);
assert.match(authHelper, /requireGeminiAdminSession/);
assert.match(authHelper, /geminiAdminAuthHeaders/);
assert.match(authHelper, /const GEMINI_SESSION_KEY='memphisGeminiAdminSession\.v1'/);
assert.match(authHelper, /function readGeminiSession\(\)/);
assert.match(authHelper, /function clearGeminiSession\(\)/);

const geminiAuthStorage = new Map();
const geminiAuthContext = {
  URL,
  console,
  localStorage: {
    getItem: (key) => geminiAuthStorage.has(key) ? geminiAuthStorage.get(key) : null,
    setItem: (key, value) => geminiAuthStorage.set(key, String(value)),
    removeItem: (key) => geminiAuthStorage.delete(key),
  },
  window: {
    location: { href: "https://lasrevinu333-design.github.io/Engine/gemini-admin.html?device=KIOSK_01", hostname: "lasrevinu333-design.github.io", pathname: "/Engine/gemini-admin.html", search: "?device=KIOSK_01", hash: "" },
    prompt: () => "memzoo",
    alert: () => {},
  },
  fetch: async (url, options = {}) => {
    assert.match(String(url), /\/auth-api\/gemini\/login$/);
    assert.equal(options.method, "POST");
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true, data: { token: "gemini-test-token", role: "gemini_admin", auth_mode: "gemini_password", expires_at: "2099-01-01T00:00:00.000Z" } }),
    };
  },
};
geminiAuthContext.window.window = geminiAuthContext.window;
geminiAuthContext.window.localStorage = geminiAuthContext.localStorage;
geminiAuthContext.window.fetch = geminiAuthContext.fetch;
vm.createContext(geminiAuthContext);
vm.runInContext(authHelper, geminiAuthContext, { filename: "memphis-auth.js" });
assert.equal(typeof geminiAuthContext.window.MemphisAuth.readGeminiSession, "function", "Gemini session reader should be exported");
assert.equal(geminiAuthContext.window.MemphisAuth.readGeminiSession(), null, "empty Gemini storage should read as no session");
const frontendGeminiSession = await geminiAuthContext.window.MemphisAuth.loginGeminiAdmin("memzoo");
assert.equal(frontendGeminiSession.role, "gemini_admin");
assert.equal(JSON.stringify(geminiAuthContext.window.MemphisAuth.readGeminiSession()), JSON.stringify(frontendGeminiSession), "Gemini login should persist in dedicated Gemini storage");
geminiAuthContext.window.MemphisAuth.clearGeminiSession();
assert.equal(geminiAuthContext.window.MemphisAuth.readGeminiSession(), null, "Gemini clear should remove only the dedicated Gemini session");
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
assert.match(readEngineFile("dashboard.html"), /opsManagerAuthHeaders\(\)/);
assert.match(readEngineFile("schedule.html"), /opsManagerAuthHeaders\(\)/);
assert.match(readEngineFile("schedule-simple.html"), /opsManagerAuthHeaders\(\)/);
assert.doesNotMatch(messagesHtml, /requireOpsManagerSession\(\{interactive:false,redirect:true\}\)/);
assert.doesNotMatch(threadHtml, /requireOpsManagerSession\(\{interactive:false,redirect:true\}\)/);
assert.match(messagesHtml, /optionalManagerAuthHeaders\(\)/);
assert.match(threadHtml, /optionalManagerAuthHeaders\(\)/);
const geminiAdminHtml = readEngineFile("gemini-admin.html");
assert.match(geminiAdminHtml, /requireGeminiAdminSession\(\{ interactive: true \}\)/);
assert.match(geminiAdminHtml, /geminiAdminAuthHeaders\(\)/);
assert.doesNotMatch(geminiAdminHtml, /requireOpsManagerSession\(\{ interactive: true \}\)/);

console.log("daily pin auth contract tests passed");
