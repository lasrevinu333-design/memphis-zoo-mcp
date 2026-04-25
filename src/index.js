#!/usr/bin/env node

/**
 * Memphis Zoo MPC / MCP Replacement Server
 *
 * Save this file as:
 *   server.mjs
 *
 * Or keep your current entry filename and replace its contents with this script.
 *
 * Required install:
 *   npm install @modelcontextprotocol/sdk pg zod
 *
 * Required env for GitHub tools:
 *   GITHUB_TOKEN=your_github_token
 *
 * Optional env for GitHub tools:
 *   GITHUB_DEFAULT_REPO=owner/repo
 *   GITHUB_BRANCH=main
 *
 * Required env for Supabase tools:
 *   SUPABASE_DB_URL=postgresql://...
 *
 * Alternative Supabase env names also accepted:
 *   DATABASE_URL
 *   POSTGRES_URL
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import pg from "pg";

const { Pool } = pg;

// ---------------------------------------------------------
// Server
// ---------------------------------------------------------

const server = new McpServer({
  name: "memphis-zoo-mpc",
  version: "1.1.0",
});

// ---------------------------------------------------------
// Environment
// ---------------------------------------------------------

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";

const GITHUB_DEFAULT_REPO =
  process.env.GITHUB_DEFAULT_REPO || process.env.GITHUB_REPO || "";

const GITHUB_BRANCH = process.env.GITHUB_BRANCH || "main";

const SUPABASE_DB_URL =
  process.env.SUPABASE_DB_URL ||
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  "";

let pool = null;

// ---------------------------------------------------------
// Response helpers
// ---------------------------------------------------------

function textResponse(text) {
  return {
    content: [
      {
        type: "text",
        text: String(text),
      },
    ],
  };
}

function jsonResponse(value) {
  return textResponse(JSON.stringify(value, null, 2));
}

// ---------------------------------------------------------
// GitHub helpers
// ---------------------------------------------------------

function requireGithubToken() {
  if (!GITHUB_TOKEN) {
    throw new Error(
      "Missing GITHUB_TOKEN or GH_TOKEN environment variable. GitHub tools cannot run without it."
    );
  }
}

function resolveRepo(repo) {
  const resolved = repo || GITHUB_DEFAULT_REPO;

  if (!resolved) {
    throw new Error(
      "Missing repo. Provide repo as 'owner/repo' or set GITHUB_DEFAULT_REPO."
    );
  }

  if (!/^[^/\s]+\/[^/\s]+$/.test(resolved)) {
    throw new Error(`Invalid repo '${resolved}'. Expected format: owner/repo`);
  }

  return resolved;
}

function resolveRef(ref) {
  return ref || GITHUB_BRANCH || "main";
}

function normalizeRepoPath(inputPath) {
  const clean = String(inputPath || "").trim().replace(/^\/+/, "");

  if (!clean) {
    return "";
  }

  const parts = clean.split("/").filter(Boolean);

  if (parts.some((part) => part === "." || part === "..")) {
    throw new Error("Path cannot contain '.' or '..' segments.");
  }

  return parts.join("/");
}

function encodeRepoPath(path) {
  return normalizeRepoPath(path)
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");
}

function encodeContent(content) {
  return Buffer.from(String(content), "utf8").toString("base64");
}

function decodeBase64Content(base64Content) {
  return Buffer.from(String(base64Content).replace(/\n/g, ""), "base64");
}

function looksBinary(buffer) {
  return buffer.includes(0);
}

async function githubRequest(method, apiPath, body = undefined) {
  requireGithubToken();

  const response = await fetch(`https://api.github.com${apiPath}`, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "memphis-zoo-mpc",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const raw = await response.text();

  let parsed;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    parsed = raw;
  }

  if (!response.ok) {
    const error = new Error(
      `GitHub API error ${response.status}: ${
        typeof parsed === "string" ? parsed : JSON.stringify(parsed, null, 2)
      }`
    );

    error.status = response.status;
    error.details = parsed;

    throw error;
  }

  return parsed;
}

async function githubGetContentOrNull({ repo, path, ref }) {
  const resolvedRepo = resolveRepo(repo);
  const resolvedPath = normalizeRepoPath(path);
  const resolvedRef = resolveRef(ref);
  const encodedPath = encodeRepoPath(resolvedPath);

  try {
    return await githubRequest(
      "GET",
      `/repos/${resolvedRepo}/contents/${encodedPath}?ref=${encodeURIComponent(
        resolvedRef
      )}`
    );
  } catch (error) {
    if (error.status === 404) {
      return null;
    }

    throw error;
  }
}

function assertGithubFileResult(result, path) {
  if (!result) {
    throw new Error(`File not found: ${path}`);
  }

  if (Array.isArray(result)) {
    throw new Error(`'${path}' is a directory, not a file.`);
  }

  if (result.type !== "file") {
    throw new Error(`'${path}' is not a file. GitHub type: ${result.type}`);
  }
}

// ---------------------------------------------------------
// Supabase helpers
// ---------------------------------------------------------

function getPool() {
  if (!SUPABASE_DB_URL) {
    throw new Error(
      "Missing SUPABASE_DB_URL, DATABASE_URL, or POSTGRES_URL environment variable."
    );
  }

  if (!pool) {
    pool = new Pool({
      connectionString: SUPABASE_DB_URL,
      ssl:
        SUPABASE_DB_URL.includes("localhost") ||
        SUPABASE_DB_URL.includes("127.0.0.1")
          ? false
          : { rejectUnauthorized: false },
    });
  }

  return pool;
}

function assertReadOnlySql(sql) {
  const trimmed = String(sql || "").trim();

  if (!trimmed) {
    throw new Error("SQL cannot be empty.");
  }

  const withoutTrailingSemicolon = trimmed.replace(/;\s*$/, "");

  if (withoutTrailingSemicolon.includes(";")) {
    throw new Error("Only one SQL statement is allowed.");
  }

  const startsReadOnly =
    /^(select|with|explain)\b/i.test(withoutTrailingSemicolon);

  if (!startsReadOnly) {
    throw new Error(
      "Only read-only SQL is allowed. Query must start with SELECT, WITH, or EXPLAIN."
    );
  }

  const forbidden =
    /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|comment|vacuum|analyze|call|do|execute|merge)\b/i;

  if (forbidden.test(withoutTrailingSemicolon)) {
    throw new Error("Mutating SQL is not allowed in supabase_sql_read.");
  }

  return withoutTrailingSemicolon;
}

// ---------------------------------------------------------
// Tool: ping
// ---------------------------------------------------------

server.tool(
  "ping",
  {
    message: z.string().optional(),
  },
  async ({ message }) => {
    return textResponse(message ? `pong: ${message}` : "pong");
  }
);

// ---------------------------------------------------------
// Tool: github_debug_config
// ---------------------------------------------------------

server.tool("github_debug_config", {}, async () => {
  return jsonResponse({
    github_token_present: Boolean(GITHUB_TOKEN),
    github_default_repo: GITHUB_DEFAULT_REPO || null,
    github_branch: GITHUB_BRANCH,
    supabase_db_url_present: Boolean(SUPABASE_DB_URL),
    node_version: process.version,
  });
});

// ---------------------------------------------------------
// Tool: github_list_directory
// ---------------------------------------------------------

server.tool(
  "github_list_directory",
  {
    repo: z.string().optional(),
    path: z.string().optional(),
    ref: z.string().optional(),
    recursive: z.boolean().optional(),
    max_entries: z.number().int().positive().max(10000).optional(),
  },
  async ({ repo, path = "", ref, recursive = false, max_entries = 500 }) => {
    const resolvedRepo = resolveRepo(repo);
    const resolvedPath = normalizeRepoPath(path);
    const resolvedRef = resolveRef(ref);

    if (recursive) {
      const tree = await githubRequest(
        "GET",
        `/repos/${resolvedRepo}/git/trees/${encodeURIComponent(
          resolvedRef
        )}?recursive=1`
      );

      const prefix = resolvedPath ? `${resolvedPath}/` : "";

      const entries = tree.tree
        .filter((item) => {
          if (!resolvedPath) return true;
          return item.path === resolvedPath || item.path.startsWith(prefix);
        })
        .slice(0, max_entries)
        .map((item) => ({
          path: item.path,
          type: item.type,
          size: item.size ?? null,
          sha: item.sha,
          url: item.url,
        }));

      return jsonResponse({
        repo: resolvedRepo,
        ref: resolvedRef,
        path: resolvedPath,
        recursive: true,
        truncated: entries.length >= max_entries,
        count: entries.length,
        entries,
      });
    }

    const encodedPath = encodeRepoPath(resolvedPath);

    const apiPath =
      `/repos/${resolvedRepo}/contents` +
      (encodedPath ? `/${encodedPath}` : "") +
      `?ref=${encodeURIComponent(resolvedRef)}`;

    const result = await githubRequest("GET", apiPath);

    if (Array.isArray(result)) {
      return jsonResponse({
        repo: resolvedRepo,
        ref: resolvedRef,
        path: resolvedPath,
        count: result.length,
        entries: result.map((item) => ({
          name: item.name,
          path: item.path,
          type: item.type,
          size: item.size,
          sha: item.sha,
          url: item.html_url,
        })),
      });
    }

    return jsonResponse({
      repo: resolvedRepo,
      ref: resolvedRef,
      name: result.name,
      path: result.path,
      type: result.type,
      size: result.size,
      sha: result.sha,
      url: result.html_url,
    });
  }
);

// ---------------------------------------------------------
// Tool: github_read_file
// ---------------------------------------------------------

server.tool(
  "github_read_file",
  {
    repo: z.string().optional(),
    path: z.string().min(1),
    ref: z.string().optional(),
    format: z.enum(["text", "json", "base64"]).optional(),
    max_bytes: z.number().int().positive().max(10_000_000).optional(),
  },
  async ({ repo, path, ref, format = "json", max_bytes = 1_000_000 }) => {
    const resolvedRepo = resolveRepo(repo);
    const resolvedPath = normalizeRepoPath(path);
    const resolvedRef = resolveRef(ref);

    const result = await githubGetContentOrNull({
      repo: resolvedRepo,
      path: resolvedPath,
      ref: resolvedRef,
    });

    assertGithubFileResult(result, resolvedPath);

    if (result.size > max_bytes) {
      throw new Error(
        `File is too large to read safely. Size: ${result.size} bytes. Limit: ${max_bytes} bytes.`
      );
    }

    const buffer = decodeBase64Content(result.content);

    if (format === "base64") {
      return jsonResponse({
        repo: resolvedRepo,
        ref: resolvedRef,
        path: result.path,
        name: result.name,
        sha: result.sha,
        size: result.size,
        encoding: "base64",
        html_url: result.html_url,
        content: result.content,
      });
    }

    if (looksBinary(buffer)) {
      throw new Error(
        `File appears to be binary. Use format: "base64" if you really need it.`
      );
    }

    const content = buffer.toString("utf8");

    if (format === "text") {
      return textResponse(content);
    }

    return jsonResponse({
      repo: resolvedRepo,
      ref: resolvedRef,
      path: result.path,
      name: result.name,
      sha: result.sha,
      size: result.size,
      encoding: "utf8",
      html_url: result.html_url,
      content,
    });
  }
);

// ---------------------------------------------------------
// Tool: github_write_file
// Creates a new file by default.
// Can overwrite only when overwrite is true.
// Supports dry_run.
// ---------------------------------------------------------

server.tool(
  "github_write_file",
  {
    repo: z.string().optional(),
    path: z.string().min(1),
    content: z.string(),
    commit_message: z.string().min(1),
    branch: z.string().optional(),
    overwrite: z.boolean().optional(),
    dry_run: z.boolean().optional(),
  },
  async ({
    repo,
    path,
    content,
    commit_message,
    branch,
    overwrite = false,
    dry_run = false,
  }) => {
    const resolvedRepo = resolveRepo(repo);
    const resolvedPath = normalizeRepoPath(path);
    const targetBranch = branch || GITHUB_BRANCH;
    const encodedPath = encodeRepoPath(resolvedPath);

    const existing = await githubGetContentOrNull({
      repo: resolvedRepo,
      path: resolvedPath,
      ref: targetBranch,
    });

    if (existing && Array.isArray(existing)) {
      throw new Error(`'${resolvedPath}' is a directory, not a file.`);
    }

    if (existing && !overwrite) {
      throw new Error(
        `File already exists: ${resolvedPath}. Use github_update_file, or set overwrite: true.`
      );
    }

    if (dry_run) {
      return jsonResponse({
        dry_run: true,
        action: existing ? "would_overwrite" : "would_create",
        repo: resolvedRepo,
        branch: targetBranch,
        path: resolvedPath,
        previous_sha: existing?.sha || null,
        new_content_bytes: Buffer.byteLength(content, "utf8"),
        commit_message,
      });
    }

    const body = {
      message: commit_message,
      content: encodeContent(content),
      branch: targetBranch,
    };

    if (existing?.sha) {
      body.sha = existing.sha;
    }

    const result = await githubRequest(
      "PUT",
      `/repos/${resolvedRepo}/contents/${encodedPath}`,
      body
    );

    return jsonResponse({
      message: existing ? "File overwritten." : "File created.",
      action: existing ? "overwrite" : "create",
      repo: resolvedRepo,
      branch: targetBranch,
      path: resolvedPath,
      previous_sha: existing?.sha || null,
      new_sha: result.content?.sha || null,
      commit_url: result.commit?.html_url || null,
      file_url: result.content?.html_url || null,
    });
  }
);

// ---------------------------------------------------------
// Tool: github_update_file
// Safely updates an existing file.
// expected_sha prevents accidental overwrite if file changed.
// Supports dry_run.
// ---------------------------------------------------------

server.tool(
  "github_update_file",
  {
    repo: z.string().optional(),
    path: z.string().min(1),
    content: z.string(),
    commit_message: z.string().min(1),
    branch: z.string().optional(),
    expected_sha: z.string().optional(),
    dry_run: z.boolean().optional(),
  },
  async ({
    repo,
    path,
    content,
    commit_message,
    branch,
    expected_sha,
    dry_run = false,
  }) => {
    const resolvedRepo = resolveRepo(repo);
    const resolvedPath = normalizeRepoPath(path);
    const targetBranch = branch || GITHUB_BRANCH;
    const encodedPath = encodeRepoPath(resolvedPath);

    const existing = await githubGetContentOrNull({
      repo: resolvedRepo,
      path: resolvedPath,
      ref: targetBranch,
    });

    assertGithubFileResult(existing, resolvedPath);

    if (expected_sha && existing.sha !== expected_sha) {
      throw new Error(
        [
          "Refusing to update because expected_sha does not match current file SHA.",
          `Path: ${resolvedPath}`,
          `Expected: ${expected_sha}`,
          `Current:  ${existing.sha}`,
          "Read the file again, inspect the current content, then retry with the current SHA.",
        ].join("\n")
      );
    }

    const oldBuffer = decodeBase64Content(existing.content);
    const oldContent = oldBuffer.toString("utf8");

    if (oldContent === content) {
      return jsonResponse({
        message: "No update needed. Content is unchanged.",
        repo: resolvedRepo,
        branch: targetBranch,
        path: resolvedPath,
        sha: existing.sha,
        file_url: existing.html_url,
      });
    }

    if (dry_run) {
      return jsonResponse({
        dry_run: true,
        action: "would_update",
        repo: resolvedRepo,
        branch: targetBranch,
        path: resolvedPath,
        current_sha: existing.sha,
        old_content_bytes: Buffer.byteLength(oldContent, "utf8"),
        new_content_bytes: Buffer.byteLength(content, "utf8"),
        old_line_count: oldContent.split("\n").length,
        new_line_count: content.split("\n").length,
        commit_message,
      });
    }

    const result = await githubRequest(
      "PUT",
      `/repos/${resolvedRepo}/contents/${encodedPath}`,
      {
        message: commit_message,
        content: encodeContent(content),
        sha: existing.sha,
        branch: targetBranch,
      }
    );

    return jsonResponse({
      message: "File updated.",
      action: "update",
      repo: resolvedRepo,
      branch: targetBranch,
      path: resolvedPath,
      previous_sha: existing.sha,
      new_sha: result.content?.sha || null,
      commit_url: result.commit?.html_url || null,
      file_url: result.content?.html_url || null,
    });
  }
);

// ---------------------------------------------------------
// Tool: supabase_sql_read
// Read-only SQL only.
// ---------------------------------------------------------

server.tool(
  "supabase_sql_read",
  {
    sql: z.string().min(1),
  },
  async ({ sql }) => {
    const safeSql = assertReadOnlySql(sql);
    const db = getPool();

    const result = await db.query(safeSql);

    return jsonResponse({
      rowCount: result.rowCount,
      rows: result.rows,
    });
  }
);

// ---------------------------------------------------------
// Tool: supabase_migration_apply
// Applies SQL migration once by name.
// ---------------------------------------------------------

server.tool(
  "supabase_migration_apply",
  {
    name: z.string().min(1),
    sql: z.string().min(1),
  },
  async ({ name, sql }) => {
    const db = getPool();
    const client = await db.connect();

    try {
      await client.query("BEGIN");

      await client.query(`
        create table if not exists public.mcp_migrations (
          id bigserial primary key,
          name text not null unique,
          applied_at timestamptz not null default now()
        )
      `);

      const existing = await client.query(
        "select id, name, applied_at from public.mcp_migrations where name = $1",
        [name]
      );

      if (existing.rowCount > 0) {
        await client.query("ROLLBACK");

        return jsonResponse({
          message: "Migration already applied.",
          migration: existing.rows[0],
        });
      }

      await client.query(sql);

      const inserted = await client.query(
        "insert into public.mcp_migrations (name) values ($1) returning id, name, applied_at",
        [name]
      );

      await client.query("COMMIT");

      return jsonResponse({
        message: "Migration applied.",
        migration: inserted.rows[0],
      });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
);

// ---------------------------------------------------------
// Start MCP server
// ---------------------------------------------------------

const transport = new StdioServerTransport();
await server.connect(transport);



PACKAGE.JSON OPTION

If you need a package.json for this script, use:

{
  "name": "memphis-zoo-mpc",
  "version": "1.1.0",
  "type": "module",
  "main": "server.mjs",
  "scripts": {
    "start": "node server.mjs"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "pg": "^8.13.0",
    "zod": "^3.23.8"
  },
  "engines": {
    "node": ">=20"
  }
}

INSTALL

npm install
node server.mjs

ENVIRONMENT

GitHub:

export GITHUB_TOKEN="your_github_token"
export GITHUB_DEFAULT_REPO="owner/repo"
export GITHUB_BRANCH="main"

Supabase:

export SUPABASE_DB_URL="postgresql://..."

SAFER EDIT FLOW

1. Read the file:

{
  "repo": "owner/repo",
  "path": "README.md",
  "format": "json"
}

2. Copy the returned sha.

3. Dry-run the update:

{
  "repo": "owner/repo",
  "path": "README.md",
  "content": "new full file content",
  "commit_message": "Update README",
  "expected_sha": "sha_from_read_result",
  "dry_run": true
}

4. Run the same update with dry_run false.
