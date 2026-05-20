export function registerMcpTool(server, name, definition, handler) {
  const title = definition?.title || name;
  const description = definition?.description || "";
  const inputSchema = definition?.inputSchema || {};

  if (typeof server.registerTool === "function") {
    return server.registerTool(
      name,
      {
        title,
        description,
        inputSchema,
      },
      handler
    );
  }

  if (typeof server.tool === "function") {
    if (description) return server.tool(name, description, inputSchema, handler);
    return server.tool(name, inputSchema, handler);
  }

  throw new Error("MCP server does not support registerTool or tool.");
}
