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
    version: "0.2.0",
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

  function getAllowedGithubRepos(defaultRepo) {
    const raw = process.env.GITHUB_ALLOWED_REPOS || defaultRepo;
    return Array.from(
      new Set(
        String(raw || "")
          .split(",")
          .map((repoName) => repoName.trim())
          .filter(Boolean)
      )
    );
  }

  function getGithubConfig(targetRepo) {
    const owner = process.env.GITHUB_OWNER;
    const defaultRepo = process.env.GITHUB_REPO;
    const token = process.env.GITHUB_TOKEN;

    if (!owner || !defaultRepo || !token) {
      throw new Error("GitHub is not configured. Check GITHUB_OWNER, GITHUB_REPO, and GITHUB_TOKEN in .env.");
    }

    const allowedRepos = getAllowedGithubRepos(defaultRepo);
    const repo = (targetRepo || defaultRepo).trim();

    if (!allowedRepos.includes(repo)) {
      throw new Error(
        `Repo \"${repo}\" is not allowed. Allowed repos: ${allowedRepos.join(", ")}`
      );
    }

    return {
      owner,
      repo,
      defaultRepo,
      allowedRepos,
    };
  }

  function getSupabaseConfig() {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY || !supabase) {
      throw new Error("Supabase is not configured. Check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.");
    }
    return supabase;
  }

  function normalizeGithubPath(path) {
    return String(path || "").trim().replace(/^\/+/, "");
  }

  function getGithubErrorDetail(error) {
    if (error?.status) {
      return `status=${error.status} ${error.message}`;
    }
    return error?.message || "Unknown GitHub error";
  }

  function sanitizeReadOnlySql(sql) {
    const trimmed = String(sql || "").trim();
    const withoutTrailingSemicolons = trimmed.replace(/;\s*$/, "");
    const normalized = withoutTrailingSemicolons.toLowerCase();

    return {
      sql: withoutTrailingSemicolons,
      normalized,
    };
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
    "github_debug_config",
    {},
    async () => {
      const defaultRepo = process.env.GITHUB_REPO || null;
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                owner: process.env.GITHUB_OWNER || null,
                defaultRepo,
                allowedRepos: getAllowedGithubRepos(defaultRepo || ""),
                hasToken: !!process.env.GITHUB_TOKEN,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  server.tool(
    "github_list_directory",
    {
      repo: z.string().optional(),
      path: z.string().optional(),
    },
    async ({ repo: targetRepo, path }) => {
      try {
        const { owner, repo } = getGithubConfig(targetRepo);
        const normalizedPath = normalizeGithubPath(path || "");

        const response = await octokit.rest.repos.getContent({
          owner,
          repo,
          path: normalizedPath,
        });

        if (!Array.isArray(response.data)) {
          return {
            content: [
              {
                type: "text",
                text: `Path is not a directory: ${owner}/${repo}/${normalizedPath || "<repo-root>"}`,
              },
            ],
          };
        }

        const items = response.data.map((item) => ({
          name: item.name,
          path: item.path,
          type: item.type,
        }));

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  owner,
                  repo,
                  path: normalizedPath || "<repo-root>",
                  items,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to list GitHub directory \"${path || "/"}\"${targetRepo ? ` in repo \"${targetRepo}\"` : ""}: ${getGithubErrorDetail(error)}`,
            },
          ],
        };
      }
    }
  );

  server.tool(
    "github_read_file",
    {
      repo: z.string().optional(),
      path: z.string().min(1),
    },
    async ({ repo: targetRepo, path }) => {
      try {
        const { owner, repo } = getGithubConfig(targetRepo);
        const normalizedPath = normalizeGithubPath(path);

        const response = await octokit.rest.repos.getContent({
          owner,
          repo,
          path: normalizedPath,
        });

        if (!("content" in response.data) || typeof response.data.content !== "string") {
          return {
            content: [
              {
                type: "text",
                text: `Path exists, but it is not a plain file: ${owner}/${repo}/${normalizedPath}`,
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
              text: `Failed to read GitHub file \"${path}\"${targetRepo ? ` in repo \"${targetRepo}\"` : ""}: ${getGithubErrorDetail(error)}`,
            },
          ],
        };
      }
    }
  );

  server.tool(
    "github_write_file",
    {
      repo: z.string().optional(),
      path: z.string().min(1),
      content: z.string(),
      commit_message: z.string().min(1),
    },
    async ({ repo: targetRepo, path, content, commit_message }) => {
      try {
        const { owner, repo } = getGithubConfig(targetRepo);
        const normalizedPath = normalizeGithubPath(path);
        let sha;
        let mode = "created";

        try {
          const existing = await octokit.rest.repos.getContent({
            owner,
            repo,
            path: normalizedPath,
          });

          if (Array.isArray(existing.data)) {
            return {
              content: [
                {
                  type: "text",
                  text: `Cannot write to \"${normalizedPath}\" because it is a directory in ${owner}/${repo}.`,
                },
              ],
            };
          }

          if ("sha" in existing.data && typeof existing.data.sha === "string") {
            sha = existing.data.sha;
            mode = "updated";
          }
        } catch (error) {
          if (error?.status !== 404) {
            throw error;
          }
        }

        const encodedContent = Buffer.from(content, "utf8").toString("base64");

        const writeResponse = await octokit.rest.repos.createOrUpdateFileContents({
          owner,
          repo,
          path: normalizedPath,
          message: commit_message,
          content: encodedContent,
          ...(sha ? { sha } : {}),
        });

        return {
          content: [
            {
              type: "text",
              text: `${mode === "created" ? "Created" : "Updated"} \"${normalizedPath}\" successfully in ${owner}/${repo}.\nCommit: ${writeResponse.data.commit.sha}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to write GitHub file \"${path}\"${targetRepo ? ` in repo \"${targetRepo}\"` : ""}: ${getGithubErrorDetail(error)}`,
            },
          ],
        };
      }
    }
  );

  server.tool(
    "github_update_file",
    {
      repo: z.string().optional(),
      path: z.string().min(1),
      content: z.string(),
      commit_message: z.string().min(1),
    },
    async ({ repo: targetRepo, path, content, commit_message }) => {
      try {
        const { owner, repo } = getGithubConfig(targetRepo);
        const normalizedPath = normalizeGithubPath(path);

        const existing = await octokit.rest.repos.getContent({
          owner,
          repo,
          path: normalizedPath,
        });

        if (Array.isArray(existing.data) || !("sha" in existing.data) || typeof existing.data.sha !== "string") {
          return {
            content: [
              {
                type: "text",
                text: `Cannot update \"${normalizedPath}\" because it is not a normal file in ${owner}/${repo}.`,
              },
            ],
          };
        }

        const encodedContent = Buffer.from(content, "utf8").toString("base64");

        const updateResponse = await octokit.rest.repos.createOrUpdateFileContents({
          owner,
          repo,
          path: normalizedPath,
          message: commit_message,
          content: encodedContent,
          sha: existing.data.sha,
        });

        return {
          content: [
            {
              type: "text",
              text: `Updated \"${normalizedPath}\" successfully in ${owner}/${repo}.\nCommit: ${updateResponse.data.commit.sha}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to update GitHub file \"${path}\"${targetRepo ? ` in repo \"${targetRepo}\"` : ""}: ${getGithubErrorDetail(error)}`,
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
        const sanitized = sanitizeReadOnlySql(sql);

        if (!(sanitized.normalized.startsWith("select") || sanitized.normalized.startsWith("with"))) {
          return {
            content: [
              {
                type: "text",
                text: "Only read-only SELECT/CTE queries are allowed in supabase_sql_read.",
              },
            ],
          };
        }

        const { data, error } = await client.rpc("run_sql_readonly", {
          p_sql: sanitized.sql,
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

  server.tool(
    "supabase_migration_apply",
    {
      name: z.string().min(1),
      sql: z.string().min(1),
    },
    async ({ name, sql }) => {
      try {
        const client = getSupabaseConfig();

        const normalized = sql.trim().toLowerCase();

        if (!normalized) {
          return {
            content: [
              {
                type: "text",
                text: "Migration SQL cannot be empty.",
              },
            ],
          };
        }

        if (normalized.startsWith("begin") || normalized.includes("commit")) {
          return {
            content: [
              {
                type: "text",
                text: "Do not include BEGIN/COMMIT. Submit the migration body only.",
              },
            ],
          };
        }

        const { data, error } = await client.rpc("run_sql_migration", {
          p_name: name,
          p_sql: sql,
        });

        if (error) {
          return {
            content: [
              {
                type: "text",
                text: `Supabase migration failed: ${error.message}`,
              },
            ],
          };
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  ok: true,
                  name,
                  result: data,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Supabase migration apply failed: ${error.message}`,
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
