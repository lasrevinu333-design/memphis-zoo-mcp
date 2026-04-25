import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Octokit } from "octokit";

const PATCH_MARKER = Symbol.for("memphis-zoo-mcp.github-readonly-tools-patched");
const INSTALLED_SERVERS = new WeakSet();

function normalizeGithubPath(path) {
  return String(path || "").trim().replace(/^\/+/, "");
}

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
  const repo = String(targetRepo || defaultRepo).trim();

  if (!allowedRepos.includes(repo)) {
    throw new Error(`Repo \"${repo}\" is not allowed. Allowed repos: ${allowedRepos.join(", ")}`);
  }

  return { owner, repo, defaultRepo, allowedRepos };
}

function getGithubErrorDetail(error) {
  if (error?.status) return `status=${error.status} ${error.message}`;
  return error?.message || "Unknown GitHub error";
}

function textPayload(value) {
  return {
    content: [
      {
        type: "text",
        text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
      },
    ],
  };
}

function decodeGithubContent(file) {
  if (!file || typeof file.content !== "string") return "";
  return Buffer.from(file.content.replace(/\n/g, ""), "base64").toString("utf8");
}

function installReadOnlyGithubTools(server, originalTool) {
  if (INSTALLED_SERVERS.has(server)) return;
  INSTALLED_SERVERS.add(server);

  const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

  originalTool.call(server, "github_debug_config", {}, async () => {
    const defaultRepo = process.env.GITHUB_REPO || null;
    return textPayload({
      owner: process.env.GITHUB_OWNER || null,
      defaultRepo,
      allowedRepos: getAllowedGithubRepos(defaultRepo || ""),
      hasToken: !!process.env.GITHUB_TOKEN,
      mode: "read_only",
    });
  });

  originalTool.call(
    server,
    "github_check_connection",
    {
      repo: z.string().optional(),
    },
    async ({ repo: targetRepo }) => {
      try {
        const { owner, repo, defaultRepo, allowedRepos } = getGithubConfig(targetRepo);
        const response = await octokit.rest.repos.get({ owner, repo });
        return textPayload({
          ok: true,
          owner,
          repo,
          defaultRepo,
          allowedRepos,
          private: response.data.private,
          default_branch: response.data.default_branch,
          pushed_at: response.data.pushed_at || null,
          mode: "read_only",
        });
      } catch (error) {
        return textPayload({ ok: false, error: getGithubErrorDetail(error) });
      }
    }
  );

  originalTool.call(
    server,
    "github_list_directory",
    {
      repo: z.string().optional(),
      path: z.string().optional(),
      ref: z.string().optional(),
    },
    async ({ repo: targetRepo, path, ref }) => {
      try {
        const { owner, repo } = getGithubConfig(targetRepo);
        const normalizedPath = normalizeGithubPath(path || "");
        const response = await octokit.rest.repos.getContent({
          owner,
          repo,
          path: normalizedPath,
          ...(ref ? { ref } : {}),
        });

        if (!Array.isArray(response.data)) {
          return textPayload(`Path is not a directory: ${owner}/${repo}/${normalizedPath || "<repo-root>"}`);
        }

        return textPayload({
          owner,
          repo,
          path: normalizedPath || "<repo-root>",
          ref: ref || null,
          items: response.data.map((item) => ({
            name: item.name,
            path: item.path,
            type: item.type,
            sha: item.sha,
            size: item.size ?? null,
          })),
        });
      } catch (error) {
        return textPayload(`Failed to list GitHub directory \"${path || "/"}\"${targetRepo ? ` in repo \"${targetRepo}\"` : ""}: ${getGithubErrorDetail(error)}`);
      }
    }
  );

  originalTool.call(
    server,
    "github_read_file",
    {
      repo: z.string().optional(),
      path: z.string().min(1),
      ref: z.string().optional(),
    },
    async ({ repo: targetRepo, path, ref }) => {
      try {
        const { owner, repo } = getGithubConfig(targetRepo);
        const normalizedPath = normalizeGithubPath(path);
        const response = await octokit.rest.repos.getContent({
          owner,
          repo,
          path: normalizedPath,
          ...(ref ? { ref } : {}),
        });

        if (Array.isArray(response.data) || typeof response.data.content !== "string") {
          return textPayload(`Path exists, but it is not a plain file: ${owner}/${repo}/${normalizedPath}`);
        }

        return textPayload({
          owner,
          repo,
          path: normalizedPath,
          ref: ref || null,
          sha: response.data.sha,
          encoding: response.data.encoding,
          content: decodeGithubContent(response.data),
        });
      } catch (error) {
        return textPayload(`Failed to read GitHub file \"${path}\"${targetRepo ? ` in repo \"${targetRepo}\"` : ""}: ${getGithubErrorDetail(error)}`);
      }
    }
  );
}

function installPatch() {
  if (McpServer.prototype[PATCH_MARKER]) return;
  const originalTool = McpServer.prototype.tool;

  McpServer.prototype.tool = function patchedTool(name, ...args) {
    const result = originalTool.call(this, name, ...args);
    installReadOnlyGithubTools(this, originalTool);
    return result;
  };

  Object.defineProperty(McpServer.prototype, PATCH_MARKER, {
    value: true,
    enumerable: false,
    configurable: false,
  });
}

installPatch();
await import("./index.js");
