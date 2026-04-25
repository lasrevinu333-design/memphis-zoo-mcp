import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * Compatibility bootstrap for the Memphis Zoo MCP server.
 *
 * src/index.js already defines the advanced GitHub tool inputs, including:
 *   - ref
 *   - format
 *   - max_bytes
 *   - branch
 *   - overwrite
 *   - dry_run
 *   - expected_sha
 *
 * Some MCP clients expose a reduced schema when tools are registered through
 * the older server.tool(...) helper. This patch redirects that helper to the
 * newer server.registerTool(...) API before src/index.js creates its MCP server.
 */

const originalTool = McpServer.prototype.tool;

if (typeof originalTool === "function" && !McpServer.prototype.__memphisSchemaBootstrapApplied) {
  Object.defineProperty(McpServer.prototype, "__memphisSchemaBootstrapApplied", {
    value: true,
    enumerable: false,
    configurable: false,
  });

  McpServer.prototype.tool = function patchedTool(name, schemaOrDescription, schemaOrCallback, maybeCallback) {
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
