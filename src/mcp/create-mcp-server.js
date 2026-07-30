import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { pingInputSchema } from "./schemas.js";
import { registerMcpTool } from "./register.js";
import { jsonResponse, textResponse } from "./responses.js";
import { registerGithubTools } from "./github-tools.js";
import { registerSupabaseTools } from "./supabase-tools.js";
import { registerServerTools } from "./server-tools.js";

const DEFAULT_MCP_SERVER_NAME = "memphis-zoo-mcp";

export function normalizeMcpServerName(value) {
  const name = String(value || DEFAULT_MCP_SERVER_NAME).trim() || DEFAULT_MCP_SERVER_NAME;
  return name
    .replace(/memphis-zoo-mpc/gi, DEFAULT_MCP_SERVER_NAME)
    .replace(/memphis zoo mpc/gi, "Memphis Zoo MCP");
}

export function createMcpServer(options = {}) {
  const appInfo = {
    name: normalizeMcpServerName(options.name || process.env.APP_NAME),
    version: options.version || "development",
    release_id: options.releaseId || options.version || "development",
  };

  const server = new McpServer({
    name: appInfo.name,
    version: appInfo.version,
  });

  registerMcpTool(
    server,
    "ping",
    {
      description: "Basic MCP liveness check.",
      inputSchema: pingInputSchema,
    },
    async ({ message } = {}) => {
      return textResponse(`MCP server is alive. ${message || ""}`.trim());
    }
  );

  if (options.readOnly === true) {
    registerMcpTool(
      server,
      "server_connection_diagnostic",
      {
        description: "Describe the restricted MCP connection without exposing privileged adapters.",
        inputSchema: {},
      },
      async () => jsonResponse({
        ok: true,
        access: "read_only",
        privileged_tools_exposed: false,
        app: appInfo,
      }),
    );
    return server;
  }

  registerServerTools(server, {
    getAppInfo: () => appInfo,
  });
  registerGithubTools(server);
  registerSupabaseTools(server);

  return server;
}
