import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  authenticateOpsAccessRequest,
  createAdminApiKeySession,
  createPublicOpsManagerSession,
  installSharedAuthRoutes,
  makeOpsAccessMiddleware,
  normalizeOpsAccessLevel,
} from "../src/auth/shared-access-auth.js";
import { loginGeminiAdmin, verifyGeminiAdminToken } from "../src/auth/gemini-admin-auth.js";

const env = {
  ADMIN_API_KEY: "service-key",
  OPS_MANAGER_FULL_ACCESS_KEY: "legacy-ops-full-link-key",
  OPS_MANAGER_READ_ONLY_ACCESS_KEY: "legacy-ops-read-only-link-key",
  OPS_MANAGER_SESSION_SECRET: "test-ops-session-secret",
  GEMINI_ADMIN_PASSWORD: "memzoo",
  GEMINI_ADMIN_SESSION_SECRET: "test-gemini-secret",
  MOXIE_WEB_PASSWORD: "memzoo",
  MOXIE_WEB_COOKIE_SECRET: "test-moxie-cookie-secret",
};

function mockRequest({ query = {}, body = {}, headers = {} } = {}) {
  const normalizedHeaders = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [String(key).toLowerCase(), value])
  );
  return {
    query,
    body,
    header(name) {
      return normalizedHeaders[String(name || "").toLowerCase()] || "";
    },
  };
}

function captureAuthRoutes(testEnv) {
  const routes = new Map();
  const app = {
    use() {},
    get(path, handler) { routes.set(`GET ${path}`, handler); },
    post(path, handler) { routes.set(`POST ${path}`, handler); },
  };
  installSharedAuthRoutes(app, { setCors() {}, env: testEnv });
  return routes;
}

async function invokeRoute(handler, req) {
  let statusCode = 200;
  let payload = null;
  const res = {
    status(code) { statusCode = code; return this; },
    json(value) { payload = value; return this; },
    sendStatus(code) { statusCode = code; return this; },
  };
  await handler(req, res);
  return { statusCode, payload };
}

function invokeMiddleware(middleware, req) {
  let statusCode = 200;
  let payload = null;
  let nextCalled = false;
  const res = {
    status(code) { statusCode = code; return this; },
    json(value) { payload = value; return this; },
  };
  middleware(req, res, () => { nextCalled = true; });
  return { statusCode, payload, nextCalled, auth: req.memphisAuth || null };
}

assert.equal(normalizeOpsAccessLevel("read-only"), "read_only");
assert.equal(normalizeOpsAccessLevel("READONLY"), "read_only");
assert.equal(normalizeOpsAccessLevel("full"), "full_access");

const publicReadOnly = createPublicOpsManagerSession({
  deviceId: "readonly-browser",
  accessLevel: "read_only",
  now: new Date("2026-05-26T15:00:00.000Z"),
  env,
});
assert.equal(publicReadOnly.role, "ops_manager");
assert.equal(publicReadOnly.auth_mode, "public_read_only_link");
assert.equal(publicReadOnly.access_level, "read_only");
assert.equal(publicReadOnly.read_only, true);
assert.ok(publicReadOnly.token);

const adminSession = createAdminApiKeySession({
  deviceId: "attendance-pusher",
  now: new Date("2026-05-26T15:00:00.000Z"),
  env,
});
assert.equal(adminSession.auth_mode, "admin_api_key");
assert.equal(adminSession.access_level, "full_access");

const routes = captureAuthRoutes(env);
const sessionRoute = routes.get("GET /auth-api/session");
assert.equal(typeof sessionRoute, "function");

let result = await invokeRoute(sessionRoute, mockRequest({
  query: { access_level: "full_access" },
  headers: { "X-Device-Id": "manager-browser-full" },
}));
assert.equal(result.statusCode, 200, "full manager link must open without a password or key");
assert.equal(result.payload.data.session.access_level, "full_access");
assert.equal(result.payload.data.session.read_only, false);
assert.equal(result.payload.data.session.auth_mode, "public_full_access_link");
const fullAccessToken = result.payload.data.session.token;

result = await invokeRoute(sessionRoute, mockRequest({
  query: { access_level: "read_only" },
  headers: { "X-Device-Id": "manager-browser-readonly" },
}));
assert.equal(result.statusCode, 200, "read-only manager link must open without a password or key");
assert.equal(result.payload.data.session.access_level, "read_only");
assert.equal(result.payload.data.session.read_only, true);
assert.equal(result.payload.data.session.auth_mode, "public_read_only_link");
const readOnlyToken = result.payload.data.session.token;

result = await invokeRoute(sessionRoute, mockRequest({
  headers: { "X-Ops-Access-Key": "bogus" },
}));
assert.equal(result.statusCode, 401, "an explicitly presented invalid legacy key must still be rejected");

const viewMiddleware = makeOpsAccessMiddleware({ env });
const writeMiddleware = makeOpsAccessMiddleware({ env, requireWrite: true });
let guarded = invokeMiddleware(viewMiddleware, mockRequest({ headers: { Authorization: `Bearer ${readOnlyToken}` } }));
assert.equal(guarded.nextCalled, true);
assert.equal(guarded.auth.access_level, "read_only");

guarded = invokeMiddleware(writeMiddleware, mockRequest({ headers: { Authorization: `Bearer ${readOnlyToken}` } }));
assert.equal(guarded.nextCalled, false);
assert.equal(guarded.statusCode, 403, "read-only manager sessions must not authorize writes");

guarded = invokeMiddleware(writeMiddleware, mockRequest({ headers: { Authorization: `Bearer ${fullAccessToken}` } }));
assert.equal(guarded.nextCalled, true, "full manager session should authorize writes");

guarded = invokeMiddleware(writeMiddleware, mockRequest());
assert.equal(guarded.nextCalled, false, "protected endpoints still require the signed session token");
assert.equal(guarded.statusCode, 401);

const fullAuth = authenticateOpsAccessRequest(mockRequest({ headers: { Authorization: `Bearer ${fullAccessToken}` } }), { env });
assert.equal(fullAuth.ok, true);
assert.equal(fullAuth.session.access_level, "full_access");

const adminAuth = authenticateOpsAccessRequest(mockRequest({
  headers: { "X-Admin-Key": env.ADMIN_API_KEY, "X-Device-Id": "attendance-pusher" },
}), { env });
assert.equal(adminAuth.ok, true);
assert.equal(adminAuth.session.auth_mode, "admin_api_key");

assert.throws(() => loginGeminiAdmin({ password: "wrong", env }), /Gemini password required/);
const geminiSession = loginGeminiAdmin({ password: "memzoo", env, now: new Date("2026-07-15T12:00:00Z") });
assert.equal(geminiSession.auth_mode, "gemini_password");
assert.equal(verifyGeminiAdminToken(geminiSession.token, { env, now: new Date("2026-07-15T12:05:00Z") }).ok, true);

const backendIndex = readFileSync(resolve("src/index.js"), "utf8");
const sharedAccess = readFileSync(resolve("src/auth/shared-access-auth.js"), "utf8");
const geminiAuth = readFileSync(resolve("src/auth/gemini-admin-auth.js"), "utf8");
const moxieRoute = readFileSync(resolve("src/routes/moxie.js"), "utf8");

assert.match(backendIndex, /const requireOpsManagerAuth = makeOpsAccessMiddleware\(\)/);
assert.match(backendIndex, /makeOpsAccessMiddleware\(\{\s*requireWrite:\s*true\s*\}\)/);
assert.match(sharedAccess, /createPublicOpsManagerSession/);
assert.match(sharedAccess, /requestedOpsAccessLevel/);
assert.match(sharedAccess, /public_read_only_link/);
assert.match(sharedAccess, /requireWrite/);
assert.match(geminiAuth, /Gemini password required\./);
assert.match(moxieRoute, /MOXIE_WEB_PASSWORD/);
assert.match(moxieRoute, /MOXIE_WEB_COOKIE_SECRET/);
assert.match(moxieRoute, /requireAuth|redirectToLogin|moxie_session/i);

const engineRoot = [
  process.env.ENGINE_FIXTURE_ROOT,
  resolve("../Engine"),
  resolve("../engine"),
  "/home/eric/Projects/memphis-zoo/Engine",
].filter(Boolean).find((candidate) => existsSync(resolve(candidate, "memphis-auth.js")));

if (engineRoot) {
  const readEngineFile = (name) => readFileSync(resolve(engineRoot, name), "utf8");
  const authHelper = readEngineFile("memphis-auth.js");
  const managerHub = readEngineFile("start_page1.html");
  const fullEntry = readEngineFile("ops-manager-hub.html");
  const readOnlyEntry = readEngineFile("ops-manager-read-only.html");
  const geminiConsole = readEngineFile("gemini-admin.html");

  assert.match(authHelper, /const OPS_SESSION_KEY='memphisOpsManagerSession\.v2'/);
  assert.match(authHelper, /requestPublicOpsSession/);
  assert.doesNotMatch(authHelper, /OPS_ACCESS_KEY_STORAGE_KEY|X-Ops-Access-Key/);
  assert.match(authHelper, /Authorization:`Bearer \$\{session\.token\}`/);
  assert.match(authHelper, /isReadOnlySession/);
  assert.match(authHelper, /canMutateOpsManagerSurface/);
  assert.match(managerHub, /read-only/i);
  assert.match(managerHub, /Events Input Console|Program Feedback|Guest Issues/);
  assert.doesNotMatch(fullEntry, /type=["']password|manager key/i);
  assert.doesNotMatch(readOnlyEntry, /type=["']password|manager key/i);
  assert.match(fullEntry, /accessLevel:'full_access'/);
  assert.match(readOnlyEntry, /accessLevel:'read_only'/);
  assert.match(geminiConsole, /requireGeminiAdminSession/);
}

console.log("SHARED_ACCESS_AUTH_TESTS_PASS");
