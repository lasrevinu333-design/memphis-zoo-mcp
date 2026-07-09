import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import express from "express";
import {
  createAdminApiKeySession,
  installSharedAuthRoutes,
  makeOpsAccessMiddleware,
} from "../src/auth/shared-access-auth.js";

const env = {
  ADMIN_API_KEY: "service-key",
  OPS_MANAGER_FULL_ACCESS_KEY: "ops-full-link-key",
  OPS_MANAGER_READ_ONLY_ACCESS_KEY: "ops-read-only-link-key",
  OPS_MANAGER_SESSION_SECRET: "test-ops-session-secret",
  GEMINI_ADMIN_PASSWORD: "memzoo",
  GEMINI_ADMIN_SESSION_SECRET: "test-gemini-secret",
  MOXIE_WEB_PASSWORD: "memzoo",
  MOXIE_WEB_COOKIE_SECRET: "test-moxie-cookie-secret",
};

const apiSession = createAdminApiKeySession({ deviceId: "attendance-pusher", now: new Date("2026-05-26T15:00:00.000Z"), env });
assert.equal(apiSession.role, "ops_manager");
assert.equal(apiSession.auth_mode, "admin_api_key");
assert.equal(apiSession.access_level, "full_access");
assert.equal(apiSession.read_only, false);
assert.ok(apiSession.token, "admin API key session should mint a signed bearer token");

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

function createOpsTestApp(testEnv) {
  const app = express();
  app.use(express.json());
  installSharedAuthRoutes(app, {
    setCors: (res) => res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Device-Id, X-Admin-Key, X-Ops-Access-Key, X-Memphis-Auth"),
    env: testEnv,
  });
  app.get("/ops-view", makeOpsAccessMiddleware({ env: testEnv }), (req, res) => res.json({ ok: true, session: req.memphisAuth }));
  app.post("/ops-write", makeOpsAccessMiddleware({ env: testEnv, requireWrite: true }), (req, res) => res.json({ ok: true, session: req.memphisAuth }));
  return app;
}

await withServer(createOpsTestApp({ NODE_ENV: "production" }), async (baseUrl) => {
  let response = await fetch(`${baseUrl}/auth-api/session`);
  assert.equal(response.status, 503, "production Ops Manager session route must fail closed when no auth keys are configured");

  response = await fetch(`${baseUrl}/ops-write`, { method: "POST", body: JSON.stringify({}) });
  assert.equal(response.status, 503, "production protected write routes must fail closed before validation when no auth keys are configured");

  response = await fetch(`${baseUrl}/ops-write`, {
    method: "POST",
    headers: { "X-Ops-Access-Key": "bogus" },
    body: JSON.stringify({}),
  });
  assert.equal(response.status, 401, "bogus Ops access key must not authorize a write route when no matching key is configured");

  response = await fetch(`${baseUrl}/ops-write`, {
    method: "POST",
    headers: { "X-Admin-Key": "bogus" },
    body: JSON.stringify({}),
  });
  assert.equal(response.status, 401, "bogus admin key must not authorize a write route when no matching key is configured");
});

await withServer(createOpsTestApp({ NODE_ENV: "production", RENDER: "true", OPS_AUTH_OPEN_MODE: "true" }), async (baseUrl) => {
  const response = await fetch(`${baseUrl}/auth-api/session`);
  assert.equal(response.status, 503, "OPS_AUTH_OPEN_MODE must not enable public open auth on Render/production");
});

await withServer(createOpsTestApp({ OPS_AUTH_OPEN_MODE: "true" }), async (baseUrl) => {
  const response = await fetch(`${baseUrl}/ops-write`, { method: "POST", body: JSON.stringify({}) });
  assert.equal(response.status, 200, "explicit local OPS_AUTH_OPEN_MODE may allow local/dev write probes only");
  const payload = await response.json();
  assert.equal(payload.session.auth_mode, "open", "explicit local open mode should be labeled as open");
});

await withServer(createOpsTestApp(env), async (baseUrl) => {
  let response = await fetch(`${baseUrl}/auth-api/session`, {
    method: "OPTIONS",
    headers: {
      Origin: "https://lasrevinu333-design.github.io",
      "Access-Control-Request-Method": "GET",
      "Access-Control-Request-Headers": "Authorization, Content-Type, X-Ops-Access-Key, X-Admin-Key",
    },
  });
  assert.equal(response.status, 200, "auth preflight should succeed");
  const allowHeaders = response.headers.get("access-control-allow-headers") || "";
  assert.match(allowHeaders, /Authorization/i, "auth preflight must allow Authorization");
  assert.match(allowHeaders, /Content-Type/i, "auth preflight must allow Content-Type");
  assert.match(allowHeaders, /X-Ops-Access-Key/i, "auth preflight must allow X-Ops-Access-Key");
  assert.match(allowHeaders, /X-Admin-Key/i, "auth preflight must allow X-Admin-Key");

  response = await fetch(`${baseUrl}/auth-api/session`);
  assert.equal(response.status, 401, "Ops Manager session route must reject anonymous requests once public link keys are configured");

  response = await fetch(`${baseUrl}/ops-view`);
  assert.equal(response.status, 401, "Ops Manager routes must reject anonymous requests once public link keys are configured");

  response = await fetch(`${baseUrl}/auth-api/session`, {
    headers: {
      "X-Ops-Access-Key": env.OPS_MANAGER_READ_ONLY_ACCESS_KEY,
      "X-Device-Id": "ops-ipad-1",
    },
  });
  assert.equal(response.status, 200, "read-only public link should mint an Ops Manager session");
  let payload = await response.json();
  assert.equal(payload.data.session.role, "ops_manager");
  assert.equal(payload.data.session.auth_mode, "public_read_only_link");
  assert.equal(payload.data.session.access_level, "read_only");
  assert.equal(payload.data.session.read_only, true);
  assert.ok(payload.data.session.token, "read-only public link should return a signed bearer session token");
  const readOnlyToken = payload.data.session.token;

  response = await fetch(`${baseUrl}/ops-view`, {
    headers: { Authorization: `Bearer ${readOnlyToken}` },
  });
  assert.equal(response.status, 200, "read-only bearer token should allow read-only Ops Manager routes");
  payload = await response.json();
  assert.equal(payload.session.access_level, "read_only");

  response = await fetch(`${baseUrl}/ops-write`, {
    method: "POST",
    headers: { Authorization: `Bearer ${readOnlyToken}` },
  });
  assert.equal(response.status, 403, "read-only bearer token must not authorize write routes");

  response = await fetch(`${baseUrl}/auth-api/session`, {
    headers: {
      "X-Ops-Access-Key": env.OPS_MANAGER_FULL_ACCESS_KEY,
      "X-Device-Id": "ops-ipad-2",
    },
  });
  assert.equal(response.status, 200, "full-access public link should mint an Ops Manager session");
  payload = await response.json();
  assert.equal(payload.data.session.auth_mode, "public_full_access_link");
  assert.equal(payload.data.session.access_level, "full_access");
  assert.equal(payload.data.session.read_only, false);
  const fullAccessToken = payload.data.session.token;

  response = await fetch(`${baseUrl}/ops-write`, {
    method: "POST",
    headers: { Authorization: `Bearer ${fullAccessToken}` },
  });
  assert.equal(response.status, 200, "full-access bearer token must authorize write routes");
  payload = await response.json();
  assert.equal(payload.session.access_level, "full_access");

  response = await fetch(`${baseUrl}/ops-write`, {
    method: "POST",
    headers: { "X-Admin-Key": env.ADMIN_API_KEY, "X-Device-Id": "attendance-pusher" },
  });
  assert.equal(response.status, 200, "service automation key remains accepted for server-to-server jobs");
  payload = await response.json();
  assert.equal(payload.session.auth_mode, "admin_api_key");
  assert.equal(payload.session.access_level, "full_access");

  response = await fetch(`${baseUrl}/auth-api/gemini/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "wrong" }),
  });
  assert.equal(response.status, 401, "Gemini console must reject the wrong password");

  response = await fetch(`${baseUrl}/auth-api/gemini/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: env.GEMINI_ADMIN_PASSWORD }),
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

const backendIndex = readFileSync(resolve("src/index.js"), "utf8");
const sharedAccess = readFileSync(resolve("src/auth/shared-access-auth.js"), "utf8");
const geminiAuth = readFileSync(resolve("src/auth/gemini-admin-auth.js"), "utf8");
const moxieRoute = readFileSync(resolve("src/routes/moxie.js"), "utf8");
const engineRoot = [resolve("../Engine"), "/home/eric/Projects/memphis-zoo/Engine"].find((candidate) => existsSync(resolve(candidate, "memphis-auth.js")));
assert.ok(engineRoot, "Engine HTML fixture directory should exist next to the repo or in the Memphis Zoo project mirror");
const readEngineFile = (name) => readFileSync(resolve(engineRoot, name), "utf8");
const authHelper = readEngineFile("memphis-auth.js");
const opsManagerHubHtml = readEngineFile("start_page1.html");
const geminiConsoleHtml = readEngineFile("gemini-admin.html");

assert.match(backendIndex, /const requireOpsManagerAuth = makeOpsAccessMiddleware\(\)/, "backend should keep a read-capable Ops middleware for protected non-mutating routes");
assert.match(backendIndex, /makeOpsAccessMiddleware\(\{\s*requireWrite:\s*true\s*\}\)/, "backend should mint a distinct write-capable Ops middleware for mutating routes");
assert.match(sharedAccess, /OPS_MANAGER_FULL_ACCESS_KEY/, "shared auth should support a dedicated full-access public-link key");
assert.match(sharedAccess, /OPS_MANAGER_READ_ONLY_ACCESS_KEY/, "shared auth should support a dedicated read-only public-link key");
assert.match(sharedAccess, /access_level/, "shared auth should stamp sessions with an access level");
assert.match(sharedAccess, /read_only/, "shared auth should expose an explicit read_only flag");
assert.match(sharedAccess, /Ops Manager link required\./, "shared auth should reject anonymous requests when link keys are configured");
assert.match(sharedAccess, /requireWrite/, "shared auth middleware should be able to enforce write-only access");
assert.match(geminiAuth, /Gemini password required\./, "Gemini auth must stay password-protected");
assert.match(moxieRoute, /MOXIE_WEB_PASSWORD/, "Moxie must stay wired to its password config");
assert.match(moxieRoute, /MOXIE_WEB_COOKIE_SECRET/, "Moxie must stay wired to its cookie secret");
assert.match(moxieRoute, /requireAuth|redirectToLogin|moxie_session/i, "Moxie routes must remain session-protected");
assert.match(authHelper, /const OPS_SESSION_KEY='memphisOpsManagerSession\.v2'/, "frontend auth helper should persist signed Ops Manager sessions separately from Gemini sessions");
assert.match(authHelper, /const OPS_ACCESS_KEY_STORAGE_KEY='memphisOpsAccessKey\.v1'/, "frontend auth helper should preserve the public link access key so sessions can be refreshed without reopening the link");
assert.match(authHelper, /auth-api\/session/, "frontend auth helper should talk to the backend session endpoint instead of forging local open sessions");
assert.match(authHelper, /X-Ops-Access-Key/, "frontend auth helper should exchange public-link keys via a dedicated header");
assert.match(authHelper, /Authorization:`Bearer \$\{session\.token\}`/, "frontend auth helper should send the signed Ops Manager bearer token on protected requests");
assert.match(authHelper, /isReadOnlySession/, "frontend auth helper should expose a read-only detector");
assert.match(authHelper, /canMutateOpsManagerSurface/, "frontend auth helper should expose a write-capability helper for UI gating");
assert.match(opsManagerHubHtml, /read-only/i, "Ops Manager hub should visibly communicate when the public link is read-only");
assert.match(opsManagerHubHtml, /Events Input Console|Program Feedback|Guest Issues/, "Ops Manager hub fixture should still carry the write-capable modules that need to be gated");
assert.match(geminiConsoleHtml, /requireGeminiAdminSession/, "Gemini console must still require Gemini admin auth on the frontend");

console.log("shared access auth tests passed");
