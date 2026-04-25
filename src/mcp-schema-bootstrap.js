import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerMcpTool } from "./mcp/register.js";
import { textResponse } from "./mcp/responses.js";
import { registerGithubTools } from "./mcp/github-tools.js";
import { registerSupabaseTools } from "./mcp/supabase-tools.js";
import { registerServerTools } from "./mcp/server-tools.js";

/**
 * Compatibility/bootstrap layer for the Memphis Zoo MCP server.
 *
 * This file intentionally starts before src/index.js. It keeps the existing
 * Express app, routes, /mcp transport, /sse transport, dashboard APIs, scan
 * APIs, messaging APIs, and event APIs untouched.
 *
 * The only thing it changes is MCP tool registration:
 *   - old src/index.js can keep calling server.tool(...)
 *   - this bootstrap registers the newer modular MCP tools instead
 *   - duplicate legacy tool registrations are ignored for the modular names
 *
 * This lets us migrate the MCP layer without carving up the main server body.
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
  const releaseId = "release-2026.04.23.1";
  return {
    name: process.env.APP_NAME || "Memphis Zoo MCP",
    version: releaseId,
    release_id: releaseId,
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
      inputSchema: {
        message: z.string().optional(),
      },
    },
    async ({ message } = {}) => {
      return textResponse(`MCP server is alive. ${message || ""}`.trim());
    }
  );

  registerServerTools(server, {
    getAppInfo: () => appInfo,
  });

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

    // server.tool(name, inputSchema, callback)
    if (
      canRegister &&
      arguments.length === 3 &&
      schemaOrDescription &&
      typeof schemaOrDescription === "object" &&
      typeof schemaOrCallback === "function"
    ) {
      return this.registerTool(
        name,
        {
          title: name,
          inputSchema: schemaOrDescription,
        },
        schemaOrCallback
      );
    }

    // server.tool(name, description, inputSchema, callback)
    if (
      canRegister &&
      arguments.length === 4 &&
      typeof schemaOrDescription === "string" &&
      schemaOrCallback &&
      typeof schemaOrCallback === "object" &&
      typeof maybeCallback === "function"
    ) {
      return this.registerTool(
        name,
        {
          title: name,
          description: schemaOrDescription,
          inputSchema: schemaOrCallback,
        },
        maybeCallback
      );
    }

    return originalTool.apply(this, arguments);
  };
}

await import("./index.js");
