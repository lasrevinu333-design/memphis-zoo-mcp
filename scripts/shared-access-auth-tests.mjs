import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import express from "express";
import {
  authenticateOpsAccessRequest,
  createAdminApiKeySession,
  createOpenOpsManagerSession,
  installSharedAuthRoutes,
  makeOpsAccessMiddleware,
} from "../src/auth/shared-access-auth.js";
import { makeMcpConnectorMiddleware } from "../src/auth/mcp-connector-auth.js";

const env = {
  ADMIN_API_KEY: "service-key",
  MOXIE_WEB_PASSWORD: "memzoo",
  MOXIE_COOKIE_SECRET: "test-moxie-cookie-secret",
  GEMINI_ADMIN_SESSION_SECRET: "test-gemini-secret",
};

const openSession = createOpenOpsManagerSession({ deviceId: "ops-ipad-1", now: new Date("2026-05-26T15:00:00.000Z") });
assert.equal(openSession.role, "ops_manager");
assert.equal(openSession.auth_mode, "open");
assert.equal(openSession.device_id, "ops-ipad-1");
assert.ok(openSession.expires_at);

const apiSession = createAdminApiKeySession({ deviceId: "attendance-pusher", now: new Date("2026-05-26T15:00:00.000Z") });
assert.equal(apiSession.role, "ops_manager");
assert.equal(apiSession.auth_mode, "admin_api_key");

async function withServer(app, fn) {
  const server = await new Promise((resolveServer) => {
    const listener = app.listen(0, () => resolveServer(listener));
  });
  try {
    const { port } = server.address();
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  }
}

const app = express();
app.use(express.json());
installSharedAuthRoutes(app, { setCors: (res) => res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Device-Id"), env });
app.get("/ops-only", makeOpsAccessMiddleware({ env }), (req, res) => res.json({ ok: true, auth_mode: req.memphisAuth?.auth_mode }));
app.get("/public-feedback", (_req, res) => res.json({ ok: true }));

await withServer(app, async (baseUrl) => {
  let response = await fetch(`${baseUrl}/ops-only`);
  assert.equal(response.status, 200, "Ops Manager routes must be open without credentials");
  let payload = await response.json();
  assert.equal(payload.auth_mode, "open");

  response = await fetch(`${baseUrl}/ops-only`, { headers: { "X-Admin-Key": env.ADMIN_API_KEY, "X-Device-Id": "attendance-pusher" } });
  assert.equal(response.status, 200, "service automation key remains accepted for server-to-server jobs");
  payload = await response.json();
  assert.equal(payload.auth_mode, "admin_api_key");

  response = await fetch(`${baseUrl}/auth-api/session`);
  assert.equal(response.status, 200, "session route should expose open Ops Manager access without prompting");
  payload = await response.json();
  assert.equal(payload.data.session.role, "ops_manager");
  assert.equal(payload.data.session.auth_mode, "open");

  response = await fetch(`${baseUrl}/public-feedback`);
  assert.equal(response.status, 200, "public feedback remains public");

  response = await fetch(`${baseUrl}/auth-api/gemini/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "wrong" }),
  });
  assert.equal(response.status, 401, "Gemini console must reject the wrong password");

  response = await fetch(`${baseUrl}/auth-api/gemini/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "memzoo" }),
  });
  assert.equal(response.status, 200, "Gemini console should accept the configured password");
  const geminiLogin = await response.json();
  assert.equal(geminiLogin.data.role, "gemini_admin");
  assert.equal(geminiLogin.data.auth_mode, "gemini_password");

  response = await fetch(`${baseUrl}/auth-api/gemini/session`, { headers: { Authorization: `Bearer ${geminiLogin.data.token}` } });
  assert.equal(response.status, 200, "Gemini token should verify through the dedicated Gemini session route");

  response = await fetch(`${baseUrl}/auth-api/gemini/session`);
  assert.equal(response.status, 401, "Gemini session route remains protected without a Gemini token");
});

const directReq = {
  body: {},
  query: {},
  header(name) {
    const headers = { "x-device-id": "direct-check" };
    return headers[String(name).toLowerCase()] || "";
  },
};
assert.equal(authenticateOpsAccessRequest(directReq, { env }).ok, true);
assert.equal(authenticateOpsAccessRequest(directReq, { env }).session.auth_mode, "open");

const mcpEnv = { ...env, MCP_CONNECTOR_TOKEN: "connector-secret-token" };
const mcpApp = express();
mcpApp.use(express.json());
mcpApp.post("/mcp-protected", makeMcpConnectorMiddleware({ env: mcpEnv }), (_req, res) => res.json({ ok: true }));

await withServer(mcpApp, async (baseUrl) => {
  let response = await fetch(`${baseUrl}/mcp-protected`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ping: true }),
  });
  assert.equal(response.status, 401, "MCP routes reject anonymous requests once MCP_CONNECTOR_TOKEN is configured");

  response = await fetch(`${baseUrl}/mcp-protected`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Memphis-Connector-Token": mcpEnv.MCP_CONNECTOR_TOKEN },
    body: JSON.stringify({ ping: true }),
  });
  assert.equal(response.status, 200, "MCP connector token authorizes /mcp requests");

  response = await fetch(`${baseUrl}/mcp-protected`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Memphis-Connector-Token": "wrong-token" },
    body: JSON.stringify({ ping: true }),
  });
  assert.equal(response.status, 401, "Wrong MCP connector token must be rejected");
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
  assert.equal(response.status, 200, "Without MCP_CONNECTOR_TOKEN, open Ops Manager behavior remains available");
});

const backendIndex = readFileSync(resolve("src/index.js"), "utf8");
const diagnostics = readFileSync(resolve("src/mcp-schema-bootstrap.js"), "utf8");
const sharedAccess = readFileSync(resolve("src/auth/shared-access-auth.js"), "utf8");
const geminiAuth = readFileSync(resolve("src/auth/gemini-admin-auth.js"), "utf8");
const connectorAuth = readFileSync(resolve("src/auth/mcp-connector-auth.js"), "utf8");
const engineRoot = [resolve("../Engine"), "/home/eric/Projects/memphis-zoo/Engine"].find((candidate) => existsSync(resolve(candidate, "memphis-auth.js")));
assert.ok(engineRoot, "Engine HTML fixture directory should exist next to the repo or in the Memphis Zoo project mirror");
const readEngineFile = (name) => readFileSync(resolve(engineRoot, name), "utf8");
const authHelper = readEngineFile("memphis-auth.js");
const opsManagerHubHtml = readEngineFile("start_page1.html");
const geminiConsoleHtml = readEngineFile("gemini-admin.html");

assert.match(backendIndex, /installSharedAuthRoutes\(app/);
assert.match(backendIndex, /const requireOpsManagerAuth = makeOpsAccessMiddleware\(\)/);
assert.match(diagnostics, /makeOpsAccessMiddleware\(\)/);
assert.match(authHelper, /requireOpsManagerSession/);
assert.match(authHelper, /async function requireOpsManagerSession\(\)\{ return buildOpenOpsSession/);
assert.match(authHelper, /async function opsManagerAuthHeaders\(\)\{ return \{'X-Device-Id':getDeviceId\(\)\}; \}/);
assert.match(authHelper, /requireGeminiAdminSession/);
assert.match(authHelper, /geminiAdminAuthHeaders/);
assert.match(authHelper, /const GEMINI_SESSION_KEY='memphisGeminiAdminSession\.v1'/);
assert.match(geminiConsoleHtml, /requireGeminiAdminSession/);

console.log("shared access auth tests passed");
