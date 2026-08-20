import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  authenticateMcpConnectorRequest,
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
middleware(
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
middleware(
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
readOnlyMiddleware(
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
