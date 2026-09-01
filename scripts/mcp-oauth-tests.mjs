import assert from "node:assert/strict";
import { createServer } from "node:net";
import express from "express";
import {
  McpOAuthTokenError,
  assertMcpOAuthConfig,
  buildMcpProtectedResourceMetadata,
  createMcpOAuthRouter,
  createMcpOAuthVerifier,
  getMcpOAuthConfig,
  openMcpOAuthSession,
  sealMcpOAuthSession,
} from "../src/auth/mcp-oauth.js";

const SUBJECT = "22222222-2222-4222-8222-222222222222";
const CLIENT_ID = "11111111-1111-4111-8111-111111111111";
const COOKIE_SECRET = "mcp-oauth-contract-cookie-secret-32-bytes-minimum";
const BASE_ENV = {
  MCP_OAUTH_ENABLED: "true",
  MCP_PUBLIC_URL: "https://memphis-zoo-mcp.onrender.com",
  SUPABASE_URL: "https://example-project.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_contract_key",
  MCP_OAUTH_COOKIE_SECRET: COOKIE_SECRET,
  MCP_OAUTH_ALLOWED_SUBJECTS: SUBJECT,
  MCP_OAUTH_ALLOWED_CLIENT_IDS: CLIENT_ID,
  MCP_OAUTH_SCOPES: "openid email profile",
};

assert.equal(getMcpOAuthConfig({}).enabled, false);
const invalid = getMcpOAuthConfig({ MCP_OAUTH_ENABLED: "true" });
assert.equal(invalid.ready, false);
assert.ok(invalid.errors.length >= 5);

const config = assertMcpOAuthConfig(BASE_ENV);
assert.equal(config.ready, true);
assert.equal(config.issuer, "https://example-project.supabase.co/auth/v1");
assert.equal(config.resource, "https://memphis-zoo-mcp.onrender.com/mcp");
assert.deepEqual(buildMcpProtectedResourceMetadata(config), {
  resource: "https://memphis-zoo-mcp.onrender.com/mcp",
  authorization_servers: ["https://example-project.supabase.co/auth/v1"],
  scopes_supported: ["openid", "email", "profile"],
  resource_name: "Memphis Zoo MCP",
});
assert.throws(
  () => assertMcpOAuthConfig({ ...BASE_ENV, MCP_OAUTH_ALLOWED_SUBJECTS: "not-a-uuid" }),
  /invalid UUID/,
);
assert.throws(
  () => assertMcpOAuthConfig({ ...BASE_ENV, MCP_PUBLIC_URL: "http://public.example.com" }),
  /must use HTTPS/,
);

const sealed = sealMcpOAuthSession(
  { access_token: "access", refresh_token: "refresh", expires_at: 2_000_000_000, user_id: SUBJECT },
  COOKIE_SECRET,
  () => Buffer.alloc(12, 7),
);
assert.deepEqual(openMcpOAuthSession(sealed, COOKIE_SECRET), {
  access_token: "access",
  refresh_token: "refresh",
  expires_at: 2_000_000_000,
  user_id: SUBJECT,
});
assert.equal(openMcpOAuthSession(`${sealed.slice(0, -1)}x`, COOKIE_SECRET), null);
assert.equal(openMcpOAuthSession(sealed, `${COOKIE_SECRET}-wrong`), null);

function jwt(payload) {
  return [
    Buffer.from(JSON.stringify({ alg: "ES256", typ: "JWT" })).toString("base64url"),
    Buffer.from(JSON.stringify(payload)).toString("base64url"),
    "contract-signature",
  ].join(".");
}

let getUserCalls = 0;
const verifier = createMcpOAuthVerifier({
  env: BASE_ENV,
  supabaseClient: {
    auth: {
      async getUser() {
        getUserCalls += 1;
        return { data: { user: { id: SUBJECT } }, error: null };
      },
    },
  },
});
const validToken = jwt({
  iss: config.issuer,
  sub: SUBJECT,
  client_id: CLIENT_ID,
  exp: Math.floor(Date.now() / 1000) + 3600,
  scope: "openid email profile",
});
const verified = await verifier.verifyAccessToken(validToken);
assert.equal(verified.clientId, CLIENT_ID);
assert.equal(verified.extra.subject, SUBJECT);
assert.deepEqual(verified.scopes, ["openid", "email", "profile"]);
assert.equal(getUserCalls, 1);

await assert.rejects(
  verifier.verifyAccessToken(jwt({
    iss: config.issuer,
    sub: SUBJECT,
    client_id: "33333333-3333-4333-8333-333333333333",
    exp: Math.floor(Date.now() / 1000) + 3600,
  })),
  McpOAuthTokenError,
);
assert.equal(getUserCalls, 1, "Unallowlisted claims must be rejected before a network lookup.");
await assert.rejects(
  verifier.verifyAccessToken(jwt({
    iss: config.issuer,
    sub: SUBJECT,
    client_id: CLIENT_ID,
    exp: Math.floor(Date.now() / 1000) - 1,
  })),
  McpOAuthTokenError,
);

async function reservePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

const port = await reservePort();
const localEnv = {
  ...BASE_ENV,
  MCP_PUBLIC_URL: `http://127.0.0.1:${port}`,
  SUPABASE_URL: "http://127.0.0.1:54321",
};
const session = {
  access_token: "ui-access-token",
  refresh_token: "ui-refresh-token",
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { id: SUBJECT, email: "owner@example.test" },
};
let activeClientId = CLIENT_ID;
let approved = 0;
let denied = 0;
const details = () => ({
  authorization_id: "authorization-contract-id",
  redirect_uri: "https://chatgpt.com/connector_platform_oauth_redirect",
  client: {
    id: activeClientId,
    name: "ChatGPT",
    uri: "https://chatgpt.com",
    logo_uri: "",
  },
  user: { id: SUBJECT, email: "owner@example.test" },
  scope: "openid email profile",
});
const fakeClientFactory = () => ({
  auth: {
    async signInWithPassword({ email, password }) {
      if (email !== "owner@example.test" || password !== "correct-password") {
        return { data: { session: null }, error: new Error("bad credentials") };
      }
      return { data: { session }, error: null };
    },
    async setSession() { return { data: { session }, error: null }; },
    async getUser() { return { data: { user: session.user }, error: null }; },
    async signOut() { return { error: null }; },
    oauth: {
      async getAuthorizationDetails() { return { data: details(), error: null }; },
      async approveAuthorization() {
        approved += 1;
        return {
          data: { redirect_url: "https://chatgpt.com/connector_platform_oauth_redirect?code=approved-code&state=state-1" },
          error: null,
        };
      },
      async denyAuthorization() {
        denied += 1;
        return {
          data: { redirect_url: "https://chatgpt.com/connector_platform_oauth_redirect?error=access_denied&state=state-1" },
          error: null,
        };
      },
    },
  },
});

const app = express();
app.set("trust proxy", 1);
app.use(express.urlencoded({ extended: false, limit: "32kb" }));
app.use(createMcpOAuthRouter({ env: localEnv, clientFactory: fakeClientFactory }));
const httpServer = app.listen(port, "127.0.0.1");
await new Promise((resolve, reject) => {
  httpServer.once("listening", resolve);
  httpServer.once("error", reject);
});

try {
  const base = `http://127.0.0.1:${port}`;
  const metadataResponse = await fetch(`${base}/.well-known/oauth-protected-resource/mcp`);
  assert.equal(metadataResponse.status, 200);
  const metadata = await metadataResponse.json();
  assert.equal(metadata.resource, `${base}/mcp`);
  assert.deepEqual(metadata.authorization_servers, ["http://127.0.0.1:54321/auth/v1"]);

  const consentWithoutSession = await fetch(`${base}/oauth/consent?authorization_id=authorization-contract-id`);
  assert.equal(consentWithoutSession.status, 200);
  assert.match(await consentWithoutSession.text(), /Sign in to Memphis Zoo MCP/);

  const loginResponse = await fetch(`${base}/oauth/login`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      authorization_id: "authorization-contract-id",
      email: "owner@example.test",
      password: "correct-password",
    }),
  });
  assert.equal(loginResponse.status, 303);
  assert.equal(loginResponse.headers.get("location"), "/oauth/consent?authorization_id=authorization-contract-id");
  const cookie = String(loginResponse.headers.get("set-cookie") || "").split(";", 1)[0];
  assert.match(cookie, /^memphis_mcp_oauth=/);
  assert.doesNotMatch(cookie, /ui-access-token|ui-refresh-token/);

  const consentResponse = await fetch(`${base}/oauth/consent?authorization_id=authorization-contract-id`, {
    headers: { cookie },
  });
  assert.equal(consentResponse.status, 200);
  const consentHtml = await consentResponse.text();
  assert.match(consentHtml, /Complete access/);
  assert.match(consentHtml, new RegExp(CLIENT_ID));
  const csrf = consentHtml.match(/name="csrf" value="([^"]+)"/)?.[1];
  assert.ok(csrf);

  const approvalResponse = await fetch(`${base}/oauth/decision`, {
    method: "POST",
    redirect: "manual",
    headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      authorization_id: "authorization-contract-id",
      csrf,
      decision: "approve",
    }),
  });
  assert.equal(approvalResponse.status, 303);
  assert.equal(
    approvalResponse.headers.get("location"),
    "https://chatgpt.com/connector_platform_oauth_redirect?code=approved-code&state=state-1",
  );
  assert.equal(approved, 1);
  assert.equal(denied, 0);

  activeClientId = "33333333-3333-4333-8333-333333333333";
  const disallowed = await fetch(`${base}/oauth/consent?authorization_id=authorization-contract-id`, {
    headers: { cookie },
  });
  assert.equal(disallowed.status, 403);
  assert.match(await disallowed.text(), /not authorized/);
} finally {
  await new Promise((resolve, reject) => httpServer.close((error) => error ? reject(error) : resolve()));
}

console.log("MCP OAuth tests passed.");
