import { z } from "zod";
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerMcpTool } from "./mcp/register.js";
import { textResponse } from "./mcp/responses.js";
import { registerGithubTools } from "./mcp/github-tools.js";
import { registerSupabaseTools } from "./mcp/supabase-tools.js";
import { registerServerTools } from "./mcp/server-tools.js";
import { validateRuntimeEnv } from "./config/env.js";
import { getToolManifest } from "./mcp/tool-manifest.js";
import { normalizeMcpServerName } from "./mcp/create-mcp-server.js";
import { RELEASE_ID } from "./app-version.js";
import { makeOpsAccessMiddleware } from "./auth/shared-access-auth.js";
import { installAnnieMoxieRoutes } from "./annie-moxie-bootstrap.js";
import { installLeadershipHttpRoutes } from "./leadership-bootstrap.js";
import { installCustodialEmployeeAdminRoutes } from "./custodial-employee-admin.js";
import { installManagerNotificationRoutes } from "./manager-notifications.js";
import { installEmployeeNotificationRoutes } from "./employee-notifications.js";
import { installOperationalAnalyticsRoutes } from "./operational-analytics-api.js";

/**
 * Compatibility/bootstrap layer for the Memphis Zoo MCP server.
 *
 * This file intentionally starts before src/index.js. It keeps the existing
 * Express app, routes, /mcp transport, /sse transport, dashboard APIs, scan
 * APIs, messaging APIs, and event APIs untouched.
 */

const MODULAR_TOOL_NAMES = new Set([
  "ping",
  "server_tool_manifest",
  "server_deep_health",
  "github_debug_config",
  "github_list_directory",
  "github_repo_tree",
  "github_read_file",
  "github_batch_read",
  "github_write_file",
  "github_update_file",
  "github_replace_text",
  "supabase_sql_read",
  "supabase_migration_apply",
]);

function getAppInfo() {
  return {
    name: normalizeMcpServerName(process.env.APP_NAME),
    version: RELEASE_ID,
    release_id: RELEASE_ID,
  };
}

function installHttpDiagnostics(app) {
  if (!app || app.__memphisHttpDiagnosticsInstalled) return;
  const requireOpsManagerAuth = makeOpsAccessMiddleware();
  Object.defineProperty(app, "__memphisHttpDiagnosticsInstalled", {
    value: true,
    enumerable: false,
    configurable: false,
  });
  // Install narrower role-specific routes first so they remain authoritative
  // before the generic leadership compatibility layer and legacy app routes.
  installAnnieMoxieRoutes(app);
  installLeadershipHttpRoutes(app);
  installCustodialEmployeeAdminRoutes(app);
  installManagerNotificationRoutes(app);
  installOperationalAnalyticsRoutes(app);
  app.get("/mcp-tools.json", requireOpsManagerAuth, (_req, res) => {
    res.status(200).json(getToolManifest({ includePlanned: true }));
  });
  app.get("/status/deep", requireOpsManagerAuth, (_req, res) => {
    const env = validateRuntimeEnv({ strict: false });
    res.status(env.ok ? 200 : 503).json({
      ok: env.ok,
      app: getAppInfo(),
      env,
      tools: getToolManifest({ includePlanned: true }),
      generated_at: new Date().toISOString(),
    });
  });
}

const originalListen = express.application?.listen;
if (typeof originalListen === "function" && !express.application.__memphisDiagnosticsListenPatched) {
  Object.defineProperty(express.application, "__memphisDiagnosticsListenPatched", {
    value: true,
    enumerable: false,
    configurable: false,
  });
  express.application.listen = function patchedListen(...args) {
    installHttpDiagnostics(this);
    return originalListen.apply(this, args);
  };
}

function ensureModularTools(server) {
  if (server.__memphisModularToolsRegistered) return;
  Object.defineProperty(server, "__memphisModularToolsRegistered", {
    value: true,
    enumerable: false,
    configurable: false,
  });
  const appInfo = getAppInfo();
  registerMcpTool(
    server,
    "ping",
    {
      description: "Basic MCP liveness check.",
      inputSchema: { message: z.string().optional() },
    },
    async ({ message } = {}) => textResponse(`MCP server is alive. ${message || ""}`.trim())
  );

  // src/index.js marks each request-scoped server before the first tool is
  // registered. Anonymous sessions stop here; privileged adapters are never
  // constructed and their credentials cannot be reached through MCP.
  if (server.__memphisReadOnly) return;

  registerServerTools(server, { getAppInfo: () => appInfo });
  registerGithubTools(server);
  registerSupabaseTools(server);
}

const originalTool = McpServer.prototype.tool;
if (typeof originalTool === "function" && !McpServer.prototype.__memphisSchemaBootstrapApplied) {
  Object.defineProperty(McpServer.prototype, "__memphisSchemaBootstrapApplied", {
    value: true,
    enumerable: false,
    configurable: false,
  });
  McpServer.prototype.tool = function patchedTool(name, schemaOrDescription, schemaOrCallback, maybeCallback) {
    if (MODULAR_TOOL_NAMES.has(name)) {
      ensureModularTools(this);
      return undefined;
    }
    const canRegister = typeof this.registerTool === "function";
    if (canRegister && arguments.length === 3 && schemaOrDescription && typeof schemaOrDescription === "object" && typeof schemaOrCallback === "function") {
      return this.registerTool(name, { title: name, inputSchema: schemaOrDescription }, schemaOrCallback);
    }
    if (canRegister && arguments.length === 4 && typeof schemaOrDescription === "string" && schemaOrCallback && typeof schemaOrCallback === "object" && typeof maybeCallback === "function") {
      return this.registerTool(name, { title: name, description: schemaOrDescription, inputSchema: schemaOrCallback }, maybeCallback);
    }
    return originalTool.apply(this, arguments);
  };
}

await import("./index.js");
