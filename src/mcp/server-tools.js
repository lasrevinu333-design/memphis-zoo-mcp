import { validateRuntimeEnv } from "../config/env.js";
import { serverDeepHealthInputSchema, serverToolManifestInputSchema } from "./schemas.js";
import { getToolManifest } from "./tool-manifest.js";
import { registerMcpTool } from "./register.js";
import { jsonResponse } from "./responses.js";

export function registerServerTools(server, options = {}) {
  const getAppInfo = options.getAppInfo || (() => ({}));

  registerMcpTool(
    server,
    "server_tool_manifest",
    {
      description: "Return the machine-readable MCP tool manifest.",
      inputSchema: serverToolManifestInputSchema,
    },
    async ({ include_planned = true } = {}) => {
      return jsonResponse(getToolManifest({ includePlanned: include_planned }));
    }
  );

  registerMcpTool(
    server,
    "server_deep_health",
    {
      description: "Run non-destructive server health diagnostics.",
      inputSchema: serverDeepHealthInputSchema,
    },
    async ({ strict_env = false } = {}) => {
      const env = validateRuntimeEnv({ strict: strict_env });
      return jsonResponse({
        ok: env.ok,
        app: getAppInfo(),
        env,
        generated_at: new Date().toISOString(),
      });
    }
  );
}
