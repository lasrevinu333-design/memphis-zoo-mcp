import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { pingInputSchema } from "./schemas.js";
import { registerMcpTool } from "./register.js";
import { textResponse } from "./responses.js";
import { registerGithubTools } from "./github-tools.js";
import { registerSupabaseTools } from "./supabase-tools.js";
import { registerServerTools } from "./server-tools.js";

export function createMcpServer(options = {}) {
  const appInfo = {
    name: options.name || process.env.APP_NAME || "Memphis Zoo MCP",
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

  registerServerTools(server, {
    getAppInfo: () => appInfo,
  });
  registerGithubTools(server);
  registerSupabaseTools(server);

  return server;
}
