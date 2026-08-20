import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { getToolManifest } from "../src/mcp/tool-manifest.js";

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

const port = await reservePort();
const connectorToken = "mcp-transport-authenticated-connector-token";
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

  client = new Client({ name: "mcp-tool-surface-regression", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${connectorToken}` } },
  });
  await withTimeout(client.connect(transport), 15_000, "MCP initialize");

  const listed = await withTimeout(client.listTools(), 15_000, "MCP tools/list");
  const actualNames = new Set((listed.tools || []).map((tool) => tool.name));
  const expectedNames = getToolManifest({ includePlanned: false }).tools
    .filter((tool) => tool.status === "current")
    .map((tool) => tool.name);
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
