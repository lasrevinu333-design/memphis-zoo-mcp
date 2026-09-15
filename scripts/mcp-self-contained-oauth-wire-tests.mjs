import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:net";
import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  McpOAuthAccessTokenError,
  buildMcpAuthorizationServerMetadata,
  buildMcpProtectedResourceMetadata,
  createSelfContainedMcpOAuthService,
  getSelfContainedMcpOAuthConfig,
  validateOpenAiRedirectUri,
  verifyMcpOAuthAccessToken,
} from "../src/auth/mcp-self-contained-oauth.js";
import { createMcpServer } from "../src/mcp/create-mcp-server.js";

const CONNECTOR_TOKEN = "mcp-self-contained-oauth-root-secret-for-wire-tests";
const OPERATOR_PASSWORD = "correct-operator-password";
const STABLE_REDIRECT = "https://chatgpt.com/connector_platform_oauth_redirect";
const CALLBACK_REDIRECT = "https://chatgpt.com/connector/oauth/callback_ID-123";

async function reservePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

function hidden(html, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return html.match(new RegExp(`name="${escaped}" value="([^"]+)"`))?.[1] || "";
}

function cookieFrom(response) {
  return String(response.headers.get("set-cookie") || "").split(";", 1)[0];
}

function form(body) {
  return {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  };
}

async function registerClient(base, overrides = {}) {
  const response = await fetch(`${base}/oauth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "ChatGPT Memphis Zoo MCP wire test",
      redirect_uris: [STABLE_REDIRECT, CALLBACK_REDIRECT],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      scope: "mcp:read mcp:write",
      ...overrides,
    }),
  });
  return { response, body: await response.json() };
}

function authorizeUrl(base, { clientId, redirectUri = STABLE_REDIRECT, resource = `${base}/mcp`, scope = "mcp:read mcp:write", verifier, state = "wire-state" }) {
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const url = new URL(`${base}/oauth/authorize`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("resource", resource);
  url.searchParams.set("scope", scope);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", state);
  return url;
}

async function beginAuthorization(url) {
  const response = await fetch(url, { redirect: "manual" });
  const html = await response.text();
  return {
    response,
    html,
    cookie: cookieFrom(response),
    request: hidden(html, "request"),
    csrf: hidden(html, "csrf"),
  };
}

async function login(base, flow, password = OPERATOR_PASSWORD) {
  const options = form({ request: flow.request, csrf: flow.csrf, password });
  options.headers.cookie = flow.cookie;
  const response = await fetch(`${base}/oauth/login`, options);
  const html = await response.text();
  return {
    response,
    html,
    cookie: cookieFrom(response),
    request: hidden(html, "request"),
    csrf: hidden(html, "csrf"),
  };
}

async function decide(base, flow, decision) {
  const options = form({ request: flow.request, csrf: flow.csrf, decision });
  options.headers.cookie = flow.cookie;
  return fetch(`${base}/oauth/decision`, options);
}

async function exchangeCode(base, { code, clientId, verifier, redirectUri = STABLE_REDIRECT, resource = `${base}/mcp` }) {
  return fetch(`${base}/oauth/token`, form({
    grant_type: "authorization_code",
    client_id: clientId,
    code,
    redirect_uri: redirectUri,
    resource,
    code_verifier: verifier,
  }));
}

async function mcpRequest(base, method, params, { id = 1, token = "", connectorToken = "" } = {}) {
  const headers = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };
  if (token) headers.authorization = `Bearer ${token}`;
  if (connectorToken) headers["x-memphis-connector-token"] = connectorToken;
  const response = await fetch(`${base}/mcp`, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  const text = await response.text();
  let body;
  if (response.headers.get("content-type")?.includes("text/event-stream")) {
    const data = text.split("\n").find((line) => line.startsWith("data: "))?.slice(6);
    body = JSON.parse(data || "{}");
  } else {
    body = JSON.parse(text || "{}");
  }
  return { response, body, text };
}

const disabled = getSelfContainedMcpOAuthConfig({});
assert.equal(disabled.enabled, false);
const explicitlyInvalid = getSelfContainedMcpOAuthConfig({ MCP_OAUTH_ENABLED: "true" });
assert.equal(explicitlyInvalid.ready, false);
assert.match(explicitlyInvalid.errors.join(" "), /MCP_CONNECTOR_TOKEN/);
const multibyteRoot = getSelfContainedMcpOAuthConfig({
  NODE_ENV: "test",
  MCP_OAUTH_ENABLED: "true",
  MCP_PUBLIC_URL: "http://127.0.0.1:3000",
  MCP_CONNECTOR_TOKEN: "é".repeat(16),
  MOXIE_WEB_PASSWORD: OPERATOR_PASSWORD,
});
assert.equal(multibyteRoot.ready, true);
assert.ok(multibyteRoot.keys);
assert.equal(validateOpenAiRedirectUri(STABLE_REDIRECT), STABLE_REDIRECT);
assert.equal(validateOpenAiRedirectUri(CALLBACK_REDIRECT), CALLBACK_REDIRECT);
assert.equal(validateOpenAiRedirectUri("https://evil.example/connector_platform_oauth_redirect"), null);
assert.equal(validateOpenAiRedirectUri("https://chatgpt.com/connector/oauth/id?leak=1"), null);

const port = await reservePort();
const base = `http://127.0.0.1:${port}`;
const env = {
  NODE_ENV: "test",
  MCP_OAUTH_ENABLED: "true",
  MCP_PUBLIC_URL: base,
  MCP_CONNECTOR_TOKEN: CONNECTOR_TOKEN,
  MOXIE_WEB_PASSWORD: OPERATOR_PASSWORD,
};
const oauth = createSelfContainedMcpOAuthService({ env });
assert.equal(oauth.enabled, true);
assert.deepEqual(buildMcpProtectedResourceMetadata(oauth.config), {
  resource: `${base}/mcp`,
  authorization_servers: [base],
  bearer_methods_supported: ["header"],
  scopes_supported: ["mcp:read", "mcp:write"],
  resource_name: "Memphis Zoo MCP",
});
assert.equal(buildMcpAuthorizationServerMetadata(oauth.config).authorization_response_iss_parameter_supported, true);

const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "32kb" }));
app.use(express.urlencoded({ extended: false, limit: "32kb" }));
app.use(oauth.router);
app.post("/mcp", oauth.middleware, async (req, res) => {
  let server;
  try {
    server = createMcpServer({
      name: "memphis-zoo-mcp-oauth-wire-test",
      version: "wire-test",
      releaseId: "wire-test",
      includePrivilegedTools: true,
      allowNoAuth: true,
      oauth: {
        enabled: true,
        scopes: oauth.config.scopes,
        challenge: `Bearer resource_metadata="${oauth.config.resourceMetadataUrl}", scope="mcp:read mcp:write"`,
      },
    });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    if (!res.headersSent) res.status(500).json({ error: String(error?.message || error) });
  }
});
const httpServer = app.listen(port, "127.0.0.1");
await new Promise((resolve, reject) => {
  httpServer.once("listening", resolve);
  httpServer.once("error", reject);
});

try {
  const resourceMetadataResponse = await fetch(`${base}/.well-known/oauth-protected-resource/mcp`);
  assert.equal(resourceMetadataResponse.status, 200);
  const resourceMetadata = await resourceMetadataResponse.json();
  assert.equal(resourceMetadata.resource, `${base}/mcp`);
  assert.deepEqual(resourceMetadata.authorization_servers, [base]);

  const rootResourceMetadata = await fetch(`${base}/.well-known/oauth-protected-resource`);
  assert.deepEqual(await rootResourceMetadata.json(), resourceMetadata);

  const asMetadataResponse = await fetch(`${base}/.well-known/oauth-authorization-server`);
  assert.equal(asMetadataResponse.status, 200);
  const asMetadata = await asMetadataResponse.json();
  assert.equal(asMetadata.issuer, base);
  assert.equal(asMetadata.authorization_endpoint, `${base}/oauth/authorize`);
  assert.equal(asMetadata.token_endpoint, `${base}/oauth/token`);
  assert.equal(asMetadata.registration_endpoint, `${base}/oauth/register`);
  assert.equal(asMetadata.authorization_response_iss_parameter_supported, true);
  assert.deepEqual(asMetadata.token_endpoint_auth_methods_supported, ["none"]);
  assert.deepEqual(asMetadata.code_challenge_methods_supported, ["S256"]);

  const invalidRegistration = await registerClient(base, {
    redirect_uris: ["https://attacker.example/callback"],
  });
  assert.equal(invalidRegistration.response.status, 400);
  assert.equal(invalidRegistration.body.error, "invalid_redirect_uri");

  const confidentialRegistration = await registerClient(base, {
    token_endpoint_auth_method: "client_secret_basic",
  });
  assert.equal(confidentialRegistration.response.status, 400);
  assert.equal(confidentialRegistration.body.error, "invalid_client_metadata");

  const registration = await registerClient(base);
  assert.equal(registration.response.status, 201);
  assert.equal(registration.body.token_endpoint_auth_method, "none");
  assert.match(registration.body.client_id, /^mzc\.v1\./);
  assert.ok(registration.body.client_id_expires_at > registration.body.client_id_issued_at);
  const clientId = registration.body.client_id;

  const defaultScopeRegistration = await registerClient(base, { scope: undefined });
  assert.equal(defaultScopeRegistration.response.status, 201);
  assert.equal(defaultScopeRegistration.body.scope, "mcp:read mcp:write");
  const defaultScopeAuthorization = await beginAuthorization(authorizeUrl(base, {
    clientId: defaultScopeRegistration.body.client_id,
    verifier: "default-scope-verifier-abcdefghijklmnopqrstuvwxyz-123456789",
  }));
  assert.equal(defaultScopeAuthorization.response.status, 200);

  const verifier = "wire-test-pkce-verifier-abcdefghijklmnopqrstuvwxyz-123456789";
  const wrongResource = authorizeUrl(base, {
    clientId,
    verifier,
    resource: `${base}/wrong-resource`,
  });
  const wrongResourceResponse = await fetch(wrongResource, { redirect: "manual" });
  assert.equal(wrongResourceResponse.status, 303);
  const wrongResourceLocation = new URL(wrongResourceResponse.headers.get("location"));
  assert.equal(wrongResourceLocation.origin + wrongResourceLocation.pathname, STABLE_REDIRECT);
  assert.equal(wrongResourceLocation.searchParams.get("error"), "invalid_target");
  assert.equal(wrongResourceLocation.searchParams.get("state"), "wire-state");
  assert.equal(wrongResourceLocation.searchParams.get("iss"), base);

  const badRedirect = new URL(authorizeUrl(base, { clientId, verifier }));
  badRedirect.searchParams.set("redirect_uri", "https://evil.example/callback");
  const badRedirectResponse = await fetch(badRedirect, { redirect: "manual" });
  assert.equal(badRedirectResponse.status, 400);
  assert.equal(badRedirectResponse.headers.get("location"), null);

  const oversizedState = authorizeUrl(base, { clientId, verifier, state: "x".repeat(2049) });
  const oversizedStateResponse = await fetch(oversizedState, { redirect: "manual" });
  assert.equal(oversizedStateResponse.status, 303);
  const oversizedStateLocation = new URL(oversizedStateResponse.headers.get("location"));
  assert.equal(oversizedStateLocation.searchParams.get("error"), "invalid_request");
  assert.equal(oversizedStateLocation.searchParams.has("state"), false);
  assert.equal(oversizedStateLocation.searchParams.get("iss"), base);

  const started = await beginAuthorization(authorizeUrl(base, { clientId, verifier }));
  assert.equal(started.response.status, 200);
  assert.match(started.html, /Sign in to Memphis Zoo MCP/);
  assert.ok(started.cookie && started.request && started.csrf);
  assert.doesNotMatch(started.html, new RegExp(OPERATOR_PASSWORD));

  const wrongPassword = await login(base, started, "wrong-operator-password");
  assert.equal(wrongPassword.response.status, 401);
  assert.match(wrongPassword.html, /password was not accepted/);

  const signedIn = await login(base, started);
  assert.equal(signedIn.response.status, 200);
  assert.match(signedIn.html, /Operator approval required/);
  assert.match(signedIn.html, /Approve access/);
  assert.equal(signedIn.response.headers.get("location"), null, "Correct password must not auto-approve OAuth access.");
  assert.ok(signedIn.cookie && signedIn.request && signedIn.csrf);

  const approval = await decide(base, signedIn, "approve");
  assert.equal(approval.status, 303);
  const approvalLocation = new URL(approval.headers.get("location"));
  assert.equal(approvalLocation.origin + approvalLocation.pathname, STABLE_REDIRECT);
  assert.equal(approvalLocation.searchParams.get("state"), "wire-state");
  assert.equal(approvalLocation.searchParams.get("iss"), base);
  const code = approvalLocation.searchParams.get("code");
  assert.match(code, /^mza\.v1\./);
  const duplicateApproval = await decide(base, signedIn, "approve");
  assert.equal(duplicateApproval.status, 403);
  assert.match(await duplicateApproval.text(), /already been used/);

  const wrongRedirectExchange = await exchangeCode(base, {
    code,
    clientId,
    verifier,
    redirectUri: CALLBACK_REDIRECT,
  });
  assert.equal(wrongRedirectExchange.status, 400);
  assert.equal((await wrongRedirectExchange.json()).error, "invalid_grant");

  const wrongResourceExchange = await exchangeCode(base, {
    code,
    clientId,
    verifier,
    resource: `${base}/wrong-resource`,
  });
  assert.equal(wrongResourceExchange.status, 400);
  assert.equal((await wrongResourceExchange.json()).error, "invalid_grant");

  const wrongVerifierExchange = await exchangeCode(base, {
    code,
    clientId,
    verifier: "wrong-pkce-verifier-abcdefghijklmnopqrstuvwxyz-123456789",
  });
  assert.equal(wrongVerifierExchange.status, 400);
  assert.equal((await wrongVerifierExchange.json()).error, "invalid_grant");

  const tokenResponse = await exchangeCode(base, { code, clientId, verifier });
  assert.equal(tokenResponse.status, 200);
  assert.equal(tokenResponse.headers.get("cache-control"), "no-store");
  const token = await tokenResponse.json();
  assert.equal(token.token_type, "Bearer");
  assert.equal(token.scope, "mcp:read mcp:write");
  assert.match(token.access_token, /^[^.]+\.[^.]+\.[^.]+$/);
  assert.match(token.refresh_token, /^mzt\.v1\./);

  const verified = verifyMcpOAuthAccessToken(oauth.config, token.access_token, {
    requiredScopes: ["mcp:read", "mcp:write"],
  });
  assert.equal(verified.clientId, clientId);
  assert.equal(verified.extra.issuer, base);
  assert.equal(verified.extra.audience, `${base}/mcp`);
  assert.deepEqual(verified.scopes, ["mcp:read", "mcp:write"]);
  const [accessHeader, accessPayload, accessSignature] = token.access_token.split(".");
  const tamperedSignature = `${accessSignature.startsWith("A") ? "B" : "A"}${accessSignature.slice(1)}`;
  assert.notDeepEqual(Buffer.from(tamperedSignature, "base64url"), Buffer.from(accessSignature, "base64url"));
  assert.throws(
    () => verifyMcpOAuthAccessToken(oauth.config, `${accessHeader}.${accessPayload}.${tamperedSignature}`),
    McpOAuthAccessTokenError,
  );

  const replay = await exchangeCode(base, { code, clientId, verifier });
  assert.equal(replay.status, 400);
  assert.equal((await replay.json()).error, "invalid_grant");

  const wrongRefreshResource = await fetch(`${base}/oauth/token`, form({
    grant_type: "refresh_token",
    client_id: clientId,
    refresh_token: token.refresh_token,
    resource: `${base}/wrong-resource`,
  }));
  assert.equal(wrongRefreshResource.status, 400);
  assert.equal((await wrongRefreshResource.json()).error, "invalid_grant");

  const refreshedResponse = await fetch(`${base}/oauth/token`, form({
    grant_type: "refresh_token",
    client_id: clientId,
    refresh_token: token.refresh_token,
    resource: `${base}/mcp`,
  }));
  assert.equal(refreshedResponse.status, 200);
  const refreshed = await refreshedResponse.json();
  assert.notEqual(refreshed.refresh_token, token.refresh_token);
  assert.notEqual(refreshed.access_token, token.access_token);

  const refreshReplay = await fetch(`${base}/oauth/token`, form({
    grant_type: "refresh_token",
    client_id: clientId,
    refresh_token: token.refresh_token,
    resource: `${base}/mcp`,
  }));
  assert.equal(refreshReplay.status, 400);
  assert.equal((await refreshReplay.json()).error, "invalid_grant");

  const denialStarted = await beginAuthorization(authorizeUrl(base, {
    clientId,
    verifier,
    redirectUri: CALLBACK_REDIRECT,
    state: "deny-state",
  }));
  const denialSignedIn = await login(base, denialStarted);
  const denial = await decide(base, denialSignedIn, "deny");
  assert.equal(denial.status, 303);
  const denialLocation = new URL(denial.headers.get("location"));
  assert.equal(denialLocation.origin + denialLocation.pathname, CALLBACK_REDIRECT);
  assert.equal(denialLocation.searchParams.get("error"), "access_denied");
  assert.equal(denialLocation.searchParams.get("state"), "deny-state");
  assert.equal(denialLocation.searchParams.get("iss"), base);

  const initialize = await mcpRequest(base, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "raw-wire-test", version: "1.0.0" },
  });
  assert.equal(initialize.response.status, 200);
  assert.equal(initialize.body.result.serverInfo.name, "memphis-zoo-mcp-oauth-wire-test");

  const listed = await mcpRequest(base, "tools/list", {});
  assert.equal(listed.response.status, 200);
  const tools = new Map(listed.body.result.tools.map((toolDefinition) => [toolDefinition.name, toolDefinition]));
  assert.deepEqual(tools.get("ping").securitySchemes, [{ type: "noauth" }]);
  assert.deepEqual(tools.get("ping")._meta.securitySchemes, [{ type: "noauth" }]);
  assert.deepEqual(tools.get("server_tool_manifest").securitySchemes, [{ type: "oauth2", scopes: ["mcp:read"] }]);
  assert.deepEqual(tools.get("server_tool_manifest")._meta.securitySchemes, [{ type: "oauth2", scopes: ["mcp:read"] }]);
  assert.deepEqual(tools.get("supabase_migration_apply").securitySchemes, [{ type: "oauth2", scopes: ["mcp:read", "mcp:write"] }]);
  assert.deepEqual(tools.get("supabase_migration_apply")._meta.securitySchemes, [{ type: "oauth2", scopes: ["mcp:read", "mcp:write"] }]);

  const anonymousPing = await mcpRequest(base, "tools/call", { name: "ping", arguments: { message: "anonymous-wire" } });
  assert.equal(anonymousPing.body.result.isError, undefined);
  assert.match(anonymousPing.body.result.content[0].text, /anonymous-wire/);

  const anonymousProtected = await mcpRequest(base, "tools/call", { name: "server_tool_manifest", arguments: { include_planned: false } });
  assert.equal(anonymousProtected.body.result.isError, true);
  assert.deepEqual(anonymousProtected.body.result._meta["mcp/www_authenticate"], [
    `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp", scope="mcp:read"`,
  ]);

  const authorizedProtected = await mcpRequest(base, "tools/call", {
    name: "server_tool_manifest",
    arguments: { include_planned: false },
  }, { token: refreshed.access_token });
  assert.equal(authorizedProtected.body.result.isError, undefined);
  assert.equal(JSON.parse(authorizedProtected.body.result.content[0].text).ok, true);

  const readRegistration = await registerClient(base, { scope: "mcp:read" });
  assert.equal(readRegistration.response.status, 201);
  const readClientId = readRegistration.body.client_id;
  const excessScopeResponse = await fetch(authorizeUrl(base, {
    clientId: readClientId,
    verifier,
    scope: "mcp:read mcp:write",
  }), { redirect: "manual" });
  assert.equal(excessScopeResponse.status, 303);
  const excessScopeLocation = new URL(excessScopeResponse.headers.get("location"));
  assert.equal(excessScopeLocation.searchParams.get("error"), "invalid_scope");
  assert.equal(excessScopeLocation.searchParams.get("iss"), base);

  const readVerifier = "read-only-pkce-verifier-abcdefghijklmnopqrstuvwxyz-123456789";
  const readStarted = await beginAuthorization(authorizeUrl(base, {
    clientId: readClientId,
    verifier: readVerifier,
    scope: "mcp:read",
    state: "read-only-state",
  }));
  const readSignedIn = await login(base, readStarted);
  const readApproval = await decide(base, readSignedIn, "approve");
  const readApprovalLocation = new URL(readApproval.headers.get("location"));
  const readTokenResponse = await exchangeCode(base, {
    code: readApprovalLocation.searchParams.get("code"),
    clientId: readClientId,
    verifier: readVerifier,
  });
  assert.equal(readTokenResponse.status, 200);
  const readToken = await readTokenResponse.json();
  assert.equal(readToken.scope, "mcp:read");
  const readTokenWriteAttempt = await mcpRequest(base, "tools/call", {
    name: "supabase_migration_apply",
    arguments: { name: "must_not_run", sql: "select 1", dry_run: true },
  }, { token: readToken.access_token });
  assert.equal(readTokenWriteAttempt.body.result.isError, true);
  assert.match(
    readTokenWriteAttempt.body.result._meta["mcp/www_authenticate"][0],
    /scope="mcp:read mcp:write"/,
  );

  const wrongBearer = await mcpRequest(base, "tools/list", {}, { token: "wrong-token" });
  assert.equal(wrongBearer.response.status, 401);
  assert.equal(
    wrongBearer.response.headers.get("www-authenticate"),
    `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp", scope="mcp:read"`,
  );

  const legacyConnector = await mcpRequest(base, "tools/call", {
    name: "server_tool_manifest",
    arguments: { include_planned: false },
  }, { connectorToken: CONNECTOR_TOKEN });
  assert.equal(legacyConnector.body.result.isError, undefined);

  const csrfFlow = await beginAuthorization(authorizeUrl(base, {
    clientId,
    verifier,
    state: "csrf-state",
  }));
  const csrfOptions = form({
    request: csrfFlow.request,
    csrf: `${csrfFlow.csrf}tampered`,
    password: OPERATOR_PASSWORD,
  });
  csrfOptions.headers.cookie = csrfFlow.cookie;
  const rejectedCsrf = await fetch(`${base}/oauth/login`, csrfOptions);
  assert.equal(rejectedCsrf.status, 403);
  assert.match(await rejectedCsrf.text(), /invalid or expired/);

  const rateLimitedFlow = await beginAuthorization(authorizeUrl(base, {
    clientId,
    verifier,
    state: "rate-limit-state",
  }));
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const rejected = await login(base, rateLimitedFlow, `wrong-password-${attempt}`);
    assert.equal(rejected.response.status, 401);
  }
  const limited = await login(base, rateLimitedFlow, "sixth-wrong-password");
  assert.equal(limited.response.status, 429);
  assert.ok(Number(limited.response.headers.get("retry-after")) >= 1);

  console.log(JSON.stringify({
    ok: true,
    oauth_provider: "self_contained",
    dcr: true,
    authorization_code_pkce_s256: true,
    refresh_rotation: true,
    login_csrf_and_rate_limit: true,
    mixed_auth_tool_count: tools.size,
    legacy_connector_preserved: true,
  }));
} finally {
  await new Promise((resolve, reject) => httpServer.close((error) => error ? reject(error) : resolve()));
}
