import "dotenv/config";
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";
import { Octokit } from "octokit";
import { createClient } from "@supabase/supabase-js";

const app = express();
app.use(express.json({ limit: "10mb" }));

function createMcpServer() {
  const server = new McpServer({
    name: process.env.APP_NAME || "Memphis Zoo MCP",
    version: "0.1.0",
  });

  const octokit = new Octokit({
    auth: process.env.GITHUB_TOKEN,
  });

  const supabase =
    process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
      ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
          auth: { persistSession: false, autoRefreshToken: false },
        })
      : null;

  function getGithubConfig() {
    const owner = process.env.GITHUB_OWNER;
    const repo = process.env.GITHUB_REPO;
    const token = process.env.GITHUB_TOKEN;

    if (!owner || !repo || !token) {
      throw new Error("GitHub is not configured. Check GITHUB_OWNER, GITHUB_REPO, and GITHUB_TOKEN in .env.");
    }

    return { owner, repo };
  }

  function getSupabaseConfig() {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY || !supabase) {
      throw new Error("Supabase is not configured. Check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.");
    }
    return supabase;
  }

  server.tool(
    "ping",
    {
      message: z.string().optional(),
    },
    async ({ message }) => {
      return {
        content: [
          {
            type: "text",
            text: `MCP server is alive. ${message || ""}`.trim(),
          },
        ],
      };
    }
  );

  server.tool(
    "github_read_file",
    {
      path: z.string().min(1),
    },
    async ({ path }) => {
      try {
        const { owner, repo } = getGithubConfig();

        const response = await octokit.rest.repos.getContent({
          owner,
          repo,
          path,
        });

        if (!("content" in response.data) || typeof response.data.content !== "string") {
          return {
            content: [
              {
                type: "text",
                text: `Path exists, but it is not a plain file: ${path}`,
              },
            ],
          };
        }

        const decoded = Buffer.from(response.data.content, "base64").toString("utf8");

        return {
          content: [
            {
              type: "text",
              text: decoded,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to read GitHub file "${path}": ${error.message}`,
            },
          ],
        };
      }
    }
  );

  server.tool(
    "github_update_file",
    {
      path: z.string().min(1),
      content: z.string(),
      commit_message: z.string().min(1),
    },
    async ({ path, content, commit_message }) => {
      try {
        const { owner, repo } = getGithubConfig();

        const existing = await octokit.rest.repos.getContent({
          owner,
          repo,
          path,
        });

        if (!("sha" in existing.data) || typeof existing.data.sha !== "string") {
          return {
            content: [
              {
                type: "text",
                text: `Cannot update "${path}" because it is not a normal file.`,
              },
            ],
          };
        }

        const encodedContent = Buffer.from(content, "utf8").toString("base64");

        const updateResponse = await octokit.rest.repos.createOrUpdateFileContents({
          owner,
          repo,
          path,
          message: commit_message,
          content: encodedContent,
          sha: existing.data.sha,
        });

        return {
          content: [
            {
              type: "text",
              text: `Updated "${path}" successfully.\nCommit: ${updateResponse.data.commit.sha}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to update GitHub file "${path}": ${error.message}`,
            },
          ],
        };
      }
    }
  );

  server.tool(
    "supabase_sql_read",
    {
      sql: z.string().min(1),
    },
    async ({ sql }) => {
      try {
        const client = getSupabaseConfig();

        const normalized = sql.trim().toLowerCase();
        if (!normalized.startsWith("select")) {
          return {
            content: [
              {
                type: "text",
                text: "Only SELECT queries are allowed in supabase_sql_read.",
              },
            ],
          };
        }

        const { data, error } = await client.rpc("run_sql_readonly", {
          p_sql: sql,
        });

        if (error) {
          return {
            content: [
              {
                type: "text",
                text: `Supabase query failed: ${error.message}`,
              },
            ],
          };
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Supabase read failed: ${error.message}`,
            },
          ],
        };
      }
    }
  );

  return server;
}

app.get("/", (_req, res) => {
  res.status(200).send("Memphis Zoo MCP server is running.");
});

app.get("/mcp", (_req, res) => {
  res.status(405).send("GET not supported on /mcp for this server.");
});

app.options("/mcp", (_req, res) => {
  res.sendStatus(200);
});

app.post("/mcp", async (req, res) => {
  try {
    const server = createMcpServer();
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

let sseTransport = null;
let sseServer = null;

app.get("/sse", async (_req, res) => {
  try {
    sseServer = createMcpServer();
    sseTransport = new SSEServerTransport("/messages", res);
    await sseServer.connect(sseTransport);
  } catch (error) {
    console.error("SSE connection failed:", error);
    if (!res.headersSent) {
      res.status(500).send("SSE connection failed");
    }
  }
});

app.post("/messages", async (req, res) => {
  try {
    if (!sseTransport) {
      res.status(400).send("No active SSE transport");
      return;
    }
    await sseTransport.handlePostMessage(req, res, req.body);
  } catch (error) {
    console.error("SSE post message failed:", error);
    if (!res.headersSent) {
      res.status(500).send("SSE post message failed");
    }
  }
});

const port = Number(process.env.PORT || 3000);

app.listen(port, () => {
  console.log("Memphis Zoo MCP server initialized.");
  console.log(`App name: ${process.env.APP_NAME || "Memphis Zoo MCP"}`);
  console.log(`Listening on http://localhost:${port}`);
  console.log("MCP endpoint: /mcp");
  console.log("Legacy SSE endpoint: /sse");
  console.log("Legacy messages endpoint: /messages");
});
