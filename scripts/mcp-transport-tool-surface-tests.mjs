import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { z } from "zod";
import { createMcpServer } from "../src/mcp/create-mcp-server.js";
import { getToolManifest, TOOL_SAFETY } from "../src/mcp/tool-manifest.js";

async function reservePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  if (!port) throw new Error("Could not reserve a local test port.");
  return port;
}

async function waitForServer(url, child, logs) {
  // The canonical entry point imports the complete application graph; allow headroom on a
  // loaded workstation and slower CI runners before classifying startup as dead.
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (child.exitCode != null) {
      throw new Error(`MCP test server exited early with code ${child.exitCode}.\n${logs()}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Startup is still in progress.
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for MCP test server.\n${logs()}`);
}

async function withTimeout(promise, milliseconds, label) {
  return Promise.race([
    promise,
    delay(milliseconds).then(() => {
      throw new Error(`${label} timed out after ${milliseconds}ms.`);
    }),
  ]);
}

const rawToolListSchema = z.object({
  tools: z.array(z.object({
    name: z.string(),
    securitySchemes: z.array(z.object({
      type: z.string(),
      scopes: z.array(z.string()).optional(),
    }).passthrough()).optional(),
    _meta: z.record(z.string(), z.unknown()).optional(),
  }).passthrough()),
}).passthrough();

async function listToolsOnWire(client, label) {
  return withTimeout(
    client.request({ method: "tools/list", params: {} }, rawToolListSchema),
    15_000,
    label,
  );
}

function normalizedSchemes(schemes) {
  return (schemes || []).map((scheme) => Array.isArray(scheme.scopes)
    ? { type: scheme.type, scopes: scheme.scopes }
    : { type: scheme.type });
}

const currentManifest = getToolManifest({ includePlanned: false }).tools;
const directManifest = currentManifest.filter((tool) => tool.status === "current");
const expectedNames = directManifest.map((tool) => tool.name);
const expectedReadNames = directManifest
  .filter((tool) => tool.safety === TOOL_SAFETY.READ)
  .map((tool) => tool.name);
const safetyByName = new Map(directManifest.map((tool) => [tool.name, tool.safety]));

const port = await reservePort();
const connectorToken = "mcp-transport-authenticated-connector-token";
const oauthSubject = "22222222-2222-4222-8222-222222222222";
const oauthClientId = "11111111-1111-4111-8111-111111111111";
let stdout = "";
let stderr = "";
const child = spawn(process.execPath, ["src/index.js"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    NODE_ENV: "test",
    PORT: String(port),
    MCP_CONNECTOR_TOKEN: connectorToken,
    MCP_ALLOW_FULL_NOAUTH: "false",
    MCP_ALLOW_READONLY_NOAUTH: "false",
    MCP_OAUTH_ENABLED: "true",
    MCP_PUBLIC_URL: `http://127.0.0.1:${port}`,
    SUPABASE_PUBLISHABLE_KEY: "sb_publishable_transport_contract_key",
    MCP_OAUTH_COOKIE_SECRET: "mcp-transport-oauth-cookie-secret-32-bytes-minimum",
    MCP_OAUTH_ALLOWED_SUBJECTS: oauthSubject,
    MCP_OAUTH_ALLOWED_CLIENT_IDS: oauthClientId,
    MCP_OAUTH_SCOPES: "email",
    SUPABASE_URL: "http://127.0.0.1:9",
    SUPABASE_SERVICE_ROLE_KEY: "mcp-transport-test-service-role",
    EVENT_MAINTENANCE_SWEEP_MS: "0",
    FEEDBACK_REMINDER_SWEEP_MS: "0",
    OPERATIONAL_NOTIFICATION_SWEEP_MS: "0",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
child.stdout.setEncoding("utf8");
child.stderr.setEncoding("utf8");
child.stdout.on("data", (chunk) => { stdout = (stdout + chunk).slice(-50_000); });
child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-50_000); });
const logs = () => `stdout:\n${stdout}\nstderr:\n${stderr}`;

let client;
try {
  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForServer(`${baseUrl}/`, child, logs);

  for (const metadataPath of [
    "/.well-known/oauth-protected-resource",
    "/.well-known/oauth-protected-resource/mcp",
  ]) {
    const response = await fetch(`${baseUrl}${metadataPath}`);
    assert.equal(response.status, 200);
    const metadata = await response.json();
    assert.equal(metadata.resource, `${baseUrl}/mcp`);
    assert.deepEqual(metadata.authorization_servers, ["http://127.0.0.1:9/auth/v1"]);
    assert.deepEqual(metadata.bearer_methods_supported, ["header"]);
  }

  const unauthorized = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "unauthorized-probe", version: "1" } },
    }),
  });
  assert.equal(unauthorized.status, 401);
  const unauthorizedChallenge = unauthorized.headers.get("www-authenticate") || "";
  assert.match(unauthorizedChallenge, new RegExp(`resource_metadata="${baseUrl.replaceAll(".", "\\.")}\\/\\.well-known\\/oauth-protected-resource\\/mcp"`));
  assert.match(unauthorizedChallenge, /scope="email"/);
  const unauthorizedBody = await unauthorized.json();
  assert.deepEqual(unauthorizedBody?._meta?.["mcp/www_authenticate"], [unauthorizedChallenge]);

  client = new Client({ name: "mcp-tool-surface-regression", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${connectorToken}` } },
  });
  await withTimeout(client.connect(transport), 15_000, "MCP initialize");

  const listed = await listToolsOnWire(client, "MCP tools/list");
  const actualNames = new Set((listed.tools || []).map((tool) => tool.name));
  const missing = expectedNames.filter((name) => !actualNames.has(name));
  assert.deepEqual(missing, [], `MCP tools/list omitted current tools: ${missing.join(", ")}`);

  for (const required of [
    "ping",
    "server_tool_manifest",
    "server_deep_health",
    "github_read_file",
    "github_write_file",
    "github_update_file",
    "supabase_sql_read",
    "supabase_migration_apply",
  ]) {
    assert.equal(actualNames.has(required), true, `MCP tools/list must expose ${required}`);
  }

  const expectedSecuritySchemes = [{
    type: "oauth2",
    scopes: ["email"],
  }];
  for (const descriptor of listed.tools) {
    assert.deepEqual(normalizedSchemes(descriptor.securitySchemes), expectedSecuritySchemes,
      `${descriptor.name} must publish top-level OAuth securitySchemes on the raw tools/list wire response.`);
    assert.deepEqual(normalizedSchemes(descriptor._meta?.securitySchemes), expectedSecuritySchemes,
      `${descriptor.name} must publish the _meta.securitySchemes compatibility mirror.`);
  }

  const ping = await withTimeout(
    client.callTool({ name: "ping", arguments: { message: "transport-regression" } }),
    15_000,
    "ping tool call"
  );
  assert.equal(ping.isError, undefined);
  assert.match(String(ping.content?.[0]?.text || ""), /transport-regression/);

  const manifestResult = await withTimeout(
    client.callTool({ name: "server_tool_manifest", arguments: { include_planned: false } }),
    15_000,
    "manifest tool call"
  );
  assert.equal(manifestResult.isError, undefined);
  const manifestPayload = JSON.parse(String(manifestResult.content?.[0]?.text || "{}"));
  assert.equal(manifestPayload.ok, true);

  const migrationPreview = await withTimeout(
    client.callTool({
      name: "supabase_migration_apply",
      arguments: {
        name: "mcp_transport_surface_probe",
        sql: "select 1;",
        dry_run: true,
      },
    }),
    15_000,
    "migration dry-run tool call"
  );
  assert.equal(migrationPreview.isError, undefined);
  const migrationPayload = JSON.parse(String(migrationPreview.content?.[0]?.text || "{}"));
  assert.equal(migrationPayload.audit?.action, "would_apply_migration");

  console.log(JSON.stringify({
    ok: true,
    direct_tool_count: actualNames.size,
    expected_current_tool_count: expectedNames.length,
    migration_dry_run: true,
  }));
} finally {
  if (client) {
    try { await client.close(); } catch {}
  }
  if (child.exitCode == null) child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    delay(5_000).then(() => {
      if (child.exitCode == null) child.kill("SIGKILL");
    }),
  ]);
}

const oauthScheme = {
  type: "oauth2",
  scopes: ["email"],
};
const mixedChallenge = "Bearer resource_metadata=\"https://memphis-zoo-mcp.onrender.com/.well-known/oauth-protected-resource/mcp\", error=\"invalid_token\", error_description=\"Authentication is required.\"";
const mixedServer = createMcpServer({
  name: "mcp-mixed-tool-surface-contract",
  version: "test",
  includePrivilegedTools: true,
  allowNoAuth: true,
  oauth: { enabled: true, scopes: oauthScheme.scopes, challenge: mixedChallenge },
});
const mixedClient = new Client({ name: "mcp-mixed-tool-client", version: "test" });
const [mixedClientTransport, mixedServerTransport] = InMemoryTransport.createLinkedPair();
try {
  await mixedServer.connect(mixedServerTransport);
  await mixedClient.connect(mixedClientTransport);
  const mixedTools = await listToolsOnWire(mixedClient, "mixed MCP tools/list");
  assert.deepEqual(mixedTools.tools.map((tool) => tool.name).sort(), [...expectedNames].sort());
  for (const descriptor of mixedTools.tools) {
    const expected = safetyByName.get(descriptor.name) === TOOL_SAFETY.READ
      ? [{ type: "noauth" }, oauthScheme]
      : [oauthScheme];
    assert.deepEqual(normalizedSchemes(descriptor.securitySchemes), expected,
      `${descriptor.name} must publish its exact mixed-session top-level auth policy.`);
    assert.deepEqual(normalizedSchemes(descriptor._meta?.securitySchemes), expected,
      `${descriptor.name} must mirror its exact mixed-session auth policy in _meta.`);
  }
  const anonymousPing = await mixedClient.callTool({ name: "ping", arguments: {} });
  assert.equal(anonymousPing.isError, undefined, "Manifest read tools must execute anonymously in mixed mode.");
  const guardedMigration = await mixedClient.callTool({
    name: "supabase_migration_apply",
    arguments: { name: "anonymous_write_must_not_run", sql: "select 1;", dry_run: true },
  });
  assert.equal(guardedMigration.isError, true);
  assert.deepEqual(guardedMigration._meta?.["mcp/www_authenticate"], [mixedChallenge]);
} finally {
  await mixedClient.close().catch(() => {});
  await mixedServer.close().catch(() => {});
}

const anonymousReadServer = createMcpServer({
  name: "mcp-anonymous-read-surface-contract",
  version: "test",
  includePrivilegedTools: false,
  allowNoAuth: true,
  oauth: { enabled: false },
});
const anonymousReadClient = new Client({ name: "mcp-anonymous-read-client", version: "test" });
const [anonymousClientTransport, anonymousServerTransport] = InMemoryTransport.createLinkedPair();
try {
  await anonymousReadServer.connect(anonymousServerTransport);
  await anonymousReadClient.connect(anonymousClientTransport);
  const anonymousTools = await listToolsOnWire(anonymousReadClient, "anonymous read-only MCP tools/list");
  assert.deepEqual(anonymousTools.tools.map((tool) => tool.name).sort(), [...expectedReadNames].sort());
  for (const descriptor of anonymousTools.tools) {
    assert.deepEqual(normalizedSchemes(descriptor.securitySchemes), [{ type: "noauth" }]);
    assert.deepEqual(normalizedSchemes(descriptor._meta?.securitySchemes), [{ type: "noauth" }]);
  }
  const searchAlias = currentManifest.find((tool) => tool.name === "github_search_files");
  assert.equal(searchAlias?.alias_tool, "github_list_directory");
  assert.equal(anonymousTools.tools.some((tool) => tool.name === searchAlias.alias_tool), true,
    "Anonymous read-only discovery must expose the manifest's GitHub search compatibility tool.");
} finally {
  await anonymousReadClient.close().catch(() => {});
  await anonymousReadServer.close().catch(() => {});
}

console.log(JSON.stringify({
  ok: true,
  strict_authenticated_tool_count: expectedNames.length,
  anonymous_read_tool_count: expectedReadNames.length,
  mixed_write_challenge: true,
}));
