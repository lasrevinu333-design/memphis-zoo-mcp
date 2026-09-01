import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  authenticateMcpConnectorRequest,
  authenticateMcpConnectorRequestWithOAuth,
  isMcpFullNoAuthEnabled,
  isMcpReadOnlyNoAuthEnabled,
  makeMcpConnectorMiddleware,
} from "../src/auth/mcp-connector-auth.js";

const NOW = new Date("2026-07-23T17:30:00.000Z");
const TOKEN = "unit-test-connector-token";

function request(headers = {}) {
  const normalized = Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [String(name).toLowerCase(), value])
  );
  return {
    header(name) {
      return normalized[String(name).toLowerCase()] || "";
    },
  };
}

function authenticate(headers, options = {}) {
  return authenticateMcpConnectorRequest(request(headers), {
    env: { MCP_CONNECTOR_TOKEN: TOKEN },
    now: NOW,
    ...options,
  });
}

assert.equal(isMcpFullNoAuthEnabled({}), false);
assert.equal(isMcpFullNoAuthEnabled({ MCP_ALLOW_FULL_NOAUTH: "true" }), false);
assert.equal(isMcpFullNoAuthEnabled({ MCP_ALLOW_FULL_NOAUTH: "false" }), false);
assert.equal(isMcpFullNoAuthEnabled({ MCP_ALLOW_FULL_NOAUTH: "0" }), false);
assert.equal(isMcpReadOnlyNoAuthEnabled({}), false);
assert.equal(isMcpReadOnlyNoAuthEnabled({ MCP_ALLOW_READONLY_NOAUTH: "true" }), true);
assert.equal(isMcpReadOnlyNoAuthEnabled({ MCP_ALLOW_READONLY_NOAUTH: "false" }), false);
assert.equal(isMcpReadOnlyNoAuthEnabled({ MCP_ALLOW_READONLY_NOAUTH: "0" }), false);

const anonymousDefault = authenticate({});
assert.equal(anonymousDefault.ok, false);
assert.equal(anonymousDefault.status, 401);

const anonymousReadOnly = authenticate({}, { allowReadOnlyNoAuth: true });
assert.equal(anonymousReadOnly.ok, true);
assert.equal(anonymousReadOnly.auth_source, "noauth_readonly");
assert.equal(anonymousReadOnly.session.role, "connector_readonly");
assert.equal(anonymousReadOnly.session.read_only, true);

const anonymousDisabled = authenticate({}, {
  allowReadOnlyNoAuth: false,
});
assert.equal(anonymousDisabled.ok, false);
assert.equal(anonymousDisabled.status, 401);

const wrongBearer = authenticate({ authorization: "Bearer definitely-wrong" });
assert.equal(wrongBearer.ok, false);
assert.equal(wrongBearer.status, 401, "A bad credential must not downgrade to tokenless access.");

const correctBearer = authenticate({ authorization: `Bearer ${TOKEN}` });
assert.equal(correctBearer.ok, true);
assert.equal(correctBearer.auth_source, "connector_token");
assert.equal(correctBearer.session.read_only, false);

const correctCustomHeader = authenticate({ "x-memphis-connector-token": TOKEN });
assert.equal(correctCustomHeader.ok, true);
assert.equal(correctCustomHeader.session.role, "connector_service");

const unconfiguredAnonymous = authenticateMcpConnectorRequest(request(), {
  env: {},
  now: NOW,
});
assert.equal(unconfiguredAnonymous.ok, false);
assert.equal(unconfiguredAnonymous.status, 503);

const unconfiguredReadOnly = authenticateMcpConnectorRequest(request(), {
  env: {},
  now: NOW,
  allowReadOnlyNoAuth: true,
});
assert.equal(unconfiguredReadOnly.ok, true);
assert.equal(unconfiguredReadOnly.session.read_only, true);

const unconfiguredStrict = authenticateMcpConnectorRequest(request(), {
  env: {},
  now: NOW,
  allowReadOnlyNoAuth: false,
});
assert.equal(unconfiguredStrict.ok, false);
assert.equal(unconfiguredStrict.status, 503);

const middlewareRequest = request();
let nextCalled = false;
let middlewareStatus = 0;
let middlewareBody = null;
const middleware = makeMcpConnectorMiddleware({
  env: { MCP_CONNECTOR_TOKEN: TOKEN },
});
await middleware(
  middlewareRequest,
  {
    status(value) {
      middlewareStatus = value;
      return this;
    },
    json(value) {
      middlewareBody = value;
    },
  },
  () => {
    nextCalled = true;
  }
);
assert.equal(nextCalled, false);
assert.equal(middlewareStatus, 401);
assert.equal(middlewareBody?.error, "Unauthorized");

const authenticatedMiddlewareRequest = request({ authorization: `Bearer ${TOKEN}` });
let authenticatedNextCalled = false;
await middleware(
  authenticatedMiddlewareRequest,
  {
    status() { throw new Error("A valid connector token must not be rejected."); },
    json() { throw new Error("A valid connector token must not receive an error body."); },
  },
  () => { authenticatedNextCalled = true; },
);
assert.equal(authenticatedNextCalled, true);
assert.equal(authenticatedMiddlewareRequest.memphisMcpAuth.read_only, false);
assert.equal(authenticatedMiddlewareRequest.memphisMcpAuth.source, "connector_token");

const readOnlyMiddlewareRequest = request();
let readOnlyNextCalled = false;
const readOnlyMiddleware = makeMcpConnectorMiddleware({
  env: { MCP_CONNECTOR_TOKEN: TOKEN },
  allowReadOnlyNoAuth: true,
});
await readOnlyMiddleware(
  readOnlyMiddlewareRequest,
  {
    status() {
      throw new Error("Explicit read-only middleware should not reject the request.");
    },
    json() {
      throw new Error("Explicit read-only middleware should not write an error response.");
    },
  },
  () => {
    readOnlyNextCalled = true;
  }
);
assert.equal(readOnlyNextCalled, true);
assert.equal(readOnlyMiddlewareRequest.memphisMcpAuth.read_only, true);
assert.equal(readOnlyMiddlewareRequest.memphisAuth.read_only, true);

let oauthVerificationCalls = 0;
const oauthVerifier = {
  async verifyAccessToken(token) {
    oauthVerificationCalls += 1;
    assert.equal(token, "supabase-oauth-token");
    return {
      token,
      clientId: "11111111-1111-4111-8111-111111111111",
      scopes: ["openid", "email"],
      expiresAt: 2_000_000_000,
      extra: { subject: "22222222-2222-4222-8222-222222222222" },
    };
  },
};
const oauthResult = await authenticateMcpConnectorRequestWithOAuth(
  request({ authorization: "Bearer supabase-oauth-token" }),
  { env: { MCP_CONNECTOR_TOKEN: TOKEN }, now: NOW, oauthVerifier },
);
assert.equal(oauthResult.ok, true);
assert.equal(oauthResult.auth_source, "supabase_oauth");
assert.equal(oauthResult.session.role, "connector_service");
assert.equal(oauthResult.session.read_only, false);
assert.equal(oauthResult.session.client_id, "11111111-1111-4111-8111-111111111111");
assert.equal(oauthResult.session.subject, "22222222-2222-4222-8222-222222222222");
assert.equal(oauthVerificationCalls, 1);

const oauthOnlyMissing = await authenticateMcpConnectorRequestWithOAuth(
  request(),
  { env: {}, now: NOW, oauthVerifier },
);
assert.equal(oauthOnlyMissing.ok, false);
assert.equal(oauthOnlyMissing.status, 401, "OAuth-only deployments must challenge missing credentials, not report missing static auth.");

const wrongCustomResult = await authenticateMcpConnectorRequestWithOAuth(
  request({ "x-memphis-connector-token": "wrong", authorization: "Bearer supabase-oauth-token" }),
  { env: { MCP_CONNECTOR_TOKEN: TOKEN }, now: NOW, oauthVerifier },
);
assert.equal(wrongCustomResult.ok, false);
assert.equal(wrongCustomResult.status, 401);
assert.equal(oauthVerificationCalls, 1, "A wrong custom service token must never enter the OAuth lane.");

const rejectedOAuthMiddleware = makeMcpConnectorMiddleware({
  env: { MCP_CONNECTOR_TOKEN: TOKEN },
  oauthVerifier: { async verifyAccessToken() { throw new Error("invalid"); } },
  resourceMetadataUrl: "https://memphis-zoo-mcp.onrender.com/.well-known/oauth-protected-resource/mcp",
});
let rejectedStatus = 0;
let rejectedBody = null;
const rejectedHeaders = {};
await rejectedOAuthMiddleware(
  request({ authorization: "Bearer invalid-oauth-token" }),
  {
    setHeader(name, value) { rejectedHeaders[String(name).toLowerCase()] = value; },
    status(value) { rejectedStatus = value; return this; },
    json(value) { rejectedBody = value; },
  },
  () => { throw new Error("Invalid OAuth must not call next."); },
);
assert.equal(rejectedStatus, 401);
assert.equal(rejectedBody?.code, "invalid_token");
assert.match(rejectedHeaders["www-authenticate"], /resource_metadata="https:\/\/memphis-zoo-mcp\.onrender\.com\/\.well-known\/oauth-protected-resource\/mcp"/);

const indexSource = await readFile(new URL("../src/index.js", import.meta.url), "utf8");
assert.match(indexSource, /function createMcpServer\(\{ readOnly = false \} = \{\}\)/);
assert.match(indexSource, /createMcpServer\(\{ readOnly: Boolean\(req\.memphisMcpAuth\?\.read_only\) \}\)/);
assert.match(indexSource, /makeMcpConnectorMiddleware\(\{\s*allowFullNoAuth: false,\s*allowReadOnlyNoAuth: false,\s*\}\)/);

const factorySource = await readFile(new URL("../src/mcp/create-mcp-server.js", import.meta.url), "utf8");
const boundaryStart = factorySource.indexOf("if (options.readOnly === true)");
const boundaryEnd = factorySource.indexOf("registerServerTools(server", boundaryStart);
assert.ok(boundaryStart > 0 && boundaryEnd > boundaryStart, "Read-only boundary must precede privileged tool registration.");
const boundary = factorySource.slice(boundaryStart, boundaryEnd);
assert.match(boundary, /privileged_tools_exposed: false/);
assert.match(boundary, /return server;/);
assert.ok(factorySource.indexOf("registerGithubTools(server);", boundaryEnd) > boundaryEnd, "GitHub tools must be registered after the read-only boundary.");
assert.ok(factorySource.indexOf("registerSupabaseTools(server);", boundaryEnd) > boundaryEnd, "Supabase tools must be registered after the read-only boundary.");
assert.doesNotMatch(indexSource + factorySource, /prototype\.tool\s*=/, "MCP registration must not depend on prototype interception.");

console.log("MCP connector authentication tests passed.");
