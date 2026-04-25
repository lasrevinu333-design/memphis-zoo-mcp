import { z } from "zod";
import { createGithubClient } from "../github/client.js";
import { batchReadFiles, listDirectory, readFile } from "../github/read.js";
import { writeFile, updateFile, replaceTextInFile } from "../github/write.js";
import { registerMcpTool } from "./register.js";
import { jsonResponse, textResponse } from "./responses.js";
import { getToolManifest } from "./tool-manifest.js";

function github() {
  return createGithubClient();
}

function commitMessage(value, fallback) {
  return String(value || fallback || "Update file via MCP").trim();
}

function hasBatchPaths(paths) {
  return Array.isArray(paths) && paths.length > 0;
}

function parseBatchPath(path) {
  const text = String(path || "").trim();
  if (!text.startsWith("batch:")) return null;

  const paths = text
    .slice("batch:".length)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  return paths.length ? paths : null;
}

function parseJsonCommand(content) {
  const raw = String(content || "").trim();
  if (!raw.startsWith("{")) return null;

  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch (_error) {
    return null;
  }
}

export function registerGithubTools(server) {
  registerMcpTool(
    server,
    "github_debug_config",
    {
      description: "Return redacted GitHub runtime configuration and modular MCP status.",
      inputSchema: {
        include_manifest: z.boolean().optional(),
      },
    },
    async ({ include_manifest = false } = {}) => {
      const client = github();
      return jsonResponse({
        ok: true,
        modular_layer: true,
        github_token_present: true,
        github_owner: client.owner,
        github_repo: client.defaultRepo,
        github_allowed_repos: client.allowedRepos,
        github_branch: client.branch,
        node_version: process.version,
        compatibility_aliases: {
          github_read_file: ["single_file_read", "batch_read_when_paths_is_supplied"],
          github_list_directory: ["directory_list", "repo_tree_when_recursive_true"],
          github_update_file: ["full_file_update", "replace_text_when_find_and_replace_are_supplied"],
          github_write_file: ["create_file", "overwrite_when_overwrite_true", "dry_run_preview"],
        },
        tool_manifest: include_manifest ? getToolManifest({ includePlanned: true }) : undefined,
      });
    }
  );

  registerMcpTool(
    server,
    "github_list_directory",
    {
      description: "List files and directories in an allowed GitHub repository. Use recursive:true for repo-tree behavior.",
      inputSchema: {
        repo: z.string().optional(),
        path: z.string().optional(),
        ref: z.string().optional(),
        recursive: z.boolean().optional(),
        max_entries: z.number().int().positive().max(10000).optional(),
      },
    },
    async ({ repo, path = "", ref, recursive = false, max_entries = 500 }) => {
      const result = await listDirectory({
        github: github(),
        repo,
        path,
        ref,
        recursive,
        maxEntries: max_entries,
      });
      return jsonResponse(result);
    }
  );

  registerMcpTool(
    server,
    "github_repo_tree",
    {
      description: "Return a recursive repository tree for an allowed repo.",
      inputSchema: {
        repo: z.string().optional(),
        path: z.string().optional(),
        ref: z.string().optional(),
        max_entries: z.number().int().positive().max(10000).optional(),
      },
    },
    async ({ repo, path = "", ref, max_entries = 1000 }) => {
      const result = await listDirectory({
        github: github(),
        repo,
        path,
        ref,
        recursive: true,
        maxEntries: max_entries,
      });
      return jsonResponse(result);
    }
  );

  registerMcpTool(
    server,
    "github_read_file",
    {
      description: "Read one file, or read several files when paths is supplied.",
      inputSchema: {
        repo: z.string().optional(),
        path: z.string().optional(),
        paths: z.array(z.string().min(1)).min(1).max(25).optional(),
        ref: z.string().optional(),
        format: z.enum(["text", "json", "base64"]).optional(),
        max_bytes: z.number().int().positive().max(10_000_000).optional(),
      },
    },
    async ({ repo, path, paths, ref, format = "json", max_bytes = 1_000_000 }) => {
      if (path === "__manifest__" || path === "manifest:tools") {
        return jsonResponse(getToolManifest({ includePlanned: true }));
      }

      const batchPaths = hasBatchPaths(paths) ? paths : parseBatchPath(path);

      if (hasBatchPaths(batchPaths)) {
        const result = await batchReadFiles({
          github: github(),
          repo,
          paths: batchPaths,
          ref,
          format,
          maxBytes: max_bytes,
        });
        return jsonResponse(result);
      }

      if (!path) {
        throw new Error("path is required unless paths or batch:path1,path2 is supplied for batch read.");
      }

      const result = await readFile({
        github: github(),
        repo,
        path,
        ref,
        format,
        maxBytes: max_bytes,
      });
      return format === "text" ? textResponse(result) : jsonResponse(result);
    }
  );

  registerMcpTool(
    server,
    "github_batch_read",
    {
      description: "Read several files from an allowed GitHub repository in one request.",
      inputSchema: {
        repo: z.string().optional(),
        paths: z.array(z.string().min(1)).min(1).max(25),
        ref: z.string().optional(),
        format: z.enum(["json", "text", "base64"]).optional(),
        max_bytes: z.number().int().positive().max(10_000_000).optional(),
      },
    },
    async ({ repo, paths, ref, format = "json", max_bytes = 1_000_000 }) => {
      const result = await batchReadFiles({
        github: github(),
        repo,
        paths,
        ref,
        format,
        maxBytes: max_bytes,
      });
      return jsonResponse(result);
    }
  );

  registerMcpTool(
    server,
    "github_write_file",
    {
      description: "Create a file, or overwrite only when explicitly allowed. Dry-run defaults to true in the modular layer.",
      inputSchema: {
        repo: z.string().optional(),
        path: z.string().min(1),
        content: z.string(),
        commit_message: z.string().min(1),
        branch: z.string().optional(),
        overwrite: z.boolean().optional(),
        dry_run: z.boolean().optional(),
      },
    },
    async ({ repo, path, content, commit_message, branch, overwrite = false, dry_run = true }) => {
      const result = await writeFile({
        github: github(),
        repo,
        path,
        content,
        commitMessage: commitMessage(commit_message, "Create file via MCP"),
        branch,
        overwrite,
        dryRun: dry_run,
      });
      return jsonResponse(result);
    }
  );

  registerMcpTool(
    server,
    "github_update_file",
    {
      description: "Update an existing file, or replace exact text when find and replace are supplied. Requires expected_sha.",
      inputSchema: {
        repo: z.string().optional(),
        path: z.string().min(1),
        content: z.string().optional(),
        find: z.string().optional(),
        replace: z.string().optional(),
        commit_message: z.string().min(1),
        branch: z.string().optional(),
        expected_sha: z.string().optional(),
        occurrence: z.enum(["first", "all"]).optional(),
        expected_matches: z.number().int().positive().optional(),
        dry_run: z.boolean().optional(),
      },
    },
    async ({
      repo,
      path,
      content,
      find,
      replace,
      commit_message,
      branch,
      expected_sha,
      occurrence = "first",
      expected_matches,
      dry_run = true,
    }) => {
      const command = parseJsonCommand(content);

      if (command?.op === "replace_text") {
        find = command.find;
        replace = command.replace;
        expected_sha = command.expected_sha || expected_sha;
        occurrence = command.occurrence || occurrence;
        expected_matches = command.expected_matches || expected_matches;
        dry_run = command.dry_run ?? dry_run;
      }

      if (find != null) {
        if (replace == null) {
          throw new Error("replace is required when find is supplied.");
        }

        const result = await replaceTextInFile({
          github: github(),
          repo,
          path,
          find,
          replace,
          commitMessage: commitMessage(commit_message, "Replace text via MCP"),
          branch,
          expectedSha: expected_sha,
          occurrence,
          expectedMatches: expected_matches,
          dryRun: dry_run,
        });
        return jsonResponse(result);
      }

      if (content == null) {
        throw new Error("content is required for full-file update. For text replacement, supply find and replace.");
      }

      const result = await updateFile({
        github: github(),
        repo,
        path,
        content,
        commitMessage: commitMessage(commit_message, "Update file via MCP"),
        branch,
        expectedSha: expected_sha,
        dryRun: dry_run,
      });
      return jsonResponse(result);
    }
  );

  registerMcpTool(
    server,
    "github_replace_text",
    {
      description: "Replace exact text in an existing file with SHA protection and diff preview.",
      inputSchema: {
        repo: z.string().optional(),
        path: z.string().min(1),
        find: z.string().min(1),
        replace: z.string(),
        commit_message: z.string().min(1),
        branch: z.string().optional(),
        expected_sha: z.string().min(1),
        occurrence: z.enum(["first", "all"]).optional(),
        expected_matches: z.number().int().positive().optional(),
        dry_run: z.boolean().optional(),
      },
    },
    async ({
      repo,
      path,
      find,
      replace,
      commit_message,
      branch,
      expected_sha,
      occurrence = "first",
      expected_matches,
      dry_run = true,
    }) => {
      const result = await replaceTextInFile({
        github: github(),
        repo,
        path,
        find,
        replace,
        commitMessage: commitMessage(commit_message, "Replace text via MCP"),
        branch,
        expectedSha: expected_sha,
        occurrence,
        expectedMatches: expected_matches,
        dryRun: dry_run,
      });
      return jsonResponse(result);
    }
  );
}
