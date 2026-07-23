import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  authenticateMcpConnectorRequest,
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

assert.equal(isMcpReadOnlyNoAuthEnabled({}), true);
assert.equal(isMcpReadOnlyNoAuthEnabled({ MCP_ALLOW_READONLY_NOAUTH: "false" }), false);
assert.equal(isMcpReadOnlyNoAuthEnabled({ MCP_ALLOW_READONLY_NOAUTH: "0" }), false);

const anonymous = authenticate({});
assert.equal(anonymous.ok, true);
assert.equal(anonymous.auth_source, "noauth_readonly");
assert.equal(anonymous.session.role, "connector_readonly");
assert.equal(anonymous.session.read_only, true);

const anonymousDisabled = authenticate({}, { allowReadOnlyNoAuth: false });
assert.equal(anonymousDisabled.ok, false);
assert.equal(anonymousDisabled.status, 401);

const wrongBearer = authenticate({ authorization: "Bearer definitely-wrong" });
assert.equal(wrongBearer.ok, false);
assert.equal(wrongBearer.status, 401, "A bad credential must not downgrade to anonymous mode.");

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
  allowReadOnlyNoAuth: true,
});
assert.equal(unconfiguredAnonymous.ok, true);
assert.equal(unconfiguredAnonymous.session.read_only, true);

const unconfiguredStrict = authenticateMcpConnectorRequest(request(), {
  env: {},
  now: NOW,
  allowReadOnlyNoAuth: false,
});
assert.equal(unconfiguredStrict.ok, false);
assert.equal(unconfiguredStrict.status, 503);

const middlewareRequest = request();
let nextCalled = false;
const middleware = makeMcpConnectorMiddleware({
  env: { MCP_CONNECTOR_TOKEN: TOKEN },
  allowReadOnlyNoAuth: true,
});
middleware(
  middlewareRequest,
  {
    status() {
      throw new Error("Anonymous read-only middleware should not reject the request.");
    },
    json() {
      throw new Error("Anonymous read-only middleware should not write an error response.");
    },
  },
  () => {
    nextCalled = true;
  }
);
assert.equal(nextCalled, true);
assert.equal(middlewareRequest.memphisMcpAuth.read_only, true);
assert.equal(middlewareRequest.memphisAuth.read_only, true);

const indexSource = await readFile(new URL("../src/index.js", import.meta.url), "utf8");
assert.match(indexSource, /function createMcpServer\(\{ readOnly = false \} = \{\}\)/);
assert.match(indexSource, /createMcpServer\(\{ readOnly: Boolean\(req\.memphisMcpAuth\?\.read_only\) \}\)/);
assert.match(indexSource, /makeMcpConnectorMiddleware\(\{ allowReadOnlyNoAuth: false \}\)/);

const boundaryStart = indexSource.indexOf("if (readOnly) {");
const boundaryEnd = indexSource.indexOf('server.tool("github_debug_config"', boundaryStart);
assert.ok(boundaryStart > 0 && boundaryEnd > boundaryStart, "Read-only boundary must precede privileged tool registration.");
const boundary = indexSource.slice(boundaryStart, boundaryEnd);
assert.match(boundary, /privileged_tools_exposed: false/);
assert.match(boundary, /return server;/);

console.log("MCP connector authentication tests passed.");
