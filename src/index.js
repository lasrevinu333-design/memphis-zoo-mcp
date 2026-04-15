app.get("/", (_req, res) => {
  res.status(200).send("Memphis Zoo MCP server is running.");
});

app.get("/mcp", (_req, res) => {
  res.status(200).json({
    ok: true,
    name: process.env.APP_NAME || "Memphis Zoo MCP",
    message: "MCP endpoint is live. Use POST for MCP requests."
  });
});

app.options("/mcp", (_req, res) => {
  res.sendStatus(200);
});

app.post("/mcp", async (req, res) => {
  try {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    res.on("close", () => {
      transport.close();
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("MCP request failed:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: "Internal server error",
        },
        id: null,
      });
    }
  }
});