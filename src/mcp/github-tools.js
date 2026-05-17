import { createGithubClient } from "../github/client.js";
import {
  githubBatchReadInputSchema,
  githubDebugConfigInputSchema,
  githubListDirectoryInputSchema,
  githubReadFileInputSchema,
  githubReplaceTextInputSchema,
  githubRepoTreeInputSchema,
  githubRestoreFileFromRefInputSchema,
  githubUpdateFileInputSchema,
  githubWriteFileInputSchema,
} from "./schemas.js";
import { batchReadFiles, listDirectory, readFile } from "../github/read.js";
import {
  replaceManyInFile,
  replaceTextInFile,
  restoreFileFromRef,
  updateFile,
  writeFile,
} from "../github/write.js";
import { createBranch, openPullRequest } from "../github/branch.js";
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

function parseSearchPath(path) {
  const text = String(path || "").trim();

  if (text.startsWith("search-content:")) {
    return {
      query: text.slice("search-content:".length).trim(),
      includeContent: true,
    };
  }

  if (text.startsWith("search:")) {
    return {
      query: text.slice("search:".length).trim(),
      includeContent: false,
    };
  }

  return null;
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
      inputSchema: githubDebugConfigInputSchema,
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
          github_update_file: [
            "full_file_update",
            "replace_text_when_find_and_replace_are_supplied",
            "restore_file_from_ref_when_json_command_is_supplied",
          ],
          github_write_file: ["create_file", "overwrite_when_overwrite_true", "dry_run_preview"],
          github_restore_file_from_ref: ["restore_file_from_ref", "emergency_file_restore"],
        },
        added_tools: [
          "github_restore_file_from_ref",
        ],
        tool_manifest: include_manifest ? getToolManifest({ includePlanned: true }) : undefined,
      });
    }
  );

  registerMcpTool(
    server,
    "github_list_directory",
    {
      description: "List files and directories in an allowed GitHub repository. Use recursive:true for repo-tree behavior.",
      inputSchema: githubListDirectoryInputSchema,
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
      inputSchema: githubRepoTreeInputSchema,
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
      inputSchema: githubReadFileInputSchema,
    },
    async ({ repo, path, paths, ref, format = "json", max_bytes = 1_000_000 }) => {
      if (path === "__manifest__" || path === "manifest:tools") {
        return jsonResponse(getToolManifest({ includePlanned: true }));
      }

      const searchPath = parseSearchPath(path);
      if (searchPath) {
        throw new Error("Search path commands are not enabled in this connector build.");
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
      inputSchema: githubBatchReadInputSchema,
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
      inputSchema: githubWriteFileInputSchema,
    },
    async ({ repo, path, content, commit_message, branch, overwrite = false, dry_run = true }) => {
      const command = parseJsonCommand(content);

      if (command?.op === "create_branch") {
        const result = await createBranch({
          github: github(),
          repo,
          newBranch: command.new_branch || command.newBranch || path,
          fromBranch: command.from_branch || command.fromBranch || branch,
          fromSha: command.from_sha || command.fromSha,
          dryRun: command.dry_run ?? dry_run,
        });
        return jsonResponse(result);
      }

      if (command?.op === "open_pr") {
        const result = await openPullRequest({
          github: github(),
          repo,
          title: command.title || commit_message,
          head: command.head || path,
          base: command.base || branch,
          body: command.body || "",
          draft: Boolean(command.draft),
          dryRun: command.dry_run ?? dry_run,
        });
        return jsonResponse(result);
      }

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
      description: "Update an existing file, replace exact text when find and replace are supplied, or restore from ref using a JSON command.",
      inputSchema: githubUpdateFileInputSchema,
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

      if (command?.op === "restore_file_from_ref" || command?.op === "restore_from_ref") {
        const result = await restoreFileFromRef({
          github: github(),
          repo,
          path,
          sourceRef: command.source_ref || command.sourceRef,
          commitMessage: commitMessage(commit_message, "Restore file from ref via MCP"),
          branch,
          expectedSha: command.expected_sha || command.expectedSha || expected_sha,
          dryRun: command.dry_run ?? command.dryRun ?? dry_run,
        });
        return jsonResponse(result);
      }

      if (command?.op === "replace_many") {
        const result = await replaceManyInFile({
          github: github(),
          repo,
          path,
          replacements: command.replacements,
          commitMessage: commitMessage(commit_message, "Replace multiple text blocks via MCP"),
          branch,
          expectedSha: command.expected_sha || command.expectedSha || expected_sha,
          dryRun: command.dry_run ?? command.dryRun ?? dry_run,
        });
        return jsonResponse(result);
      }

      if (command?.op === "replace_text") {
        find = command.find;
        replace = command.replace;
        expected_sha = command.expected_sha || command.expectedSha || expected_sha;
        occurrence = command.occurrence || occurrence;
        expected_matches = command.expected_matches || command.expectedMatches || expected_matches;
        dry_run = command.dry_run ?? command.dryRun ?? dry_run;
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
      description: "Replace exact text in an existing file with optional SHA protection and diff preview.",
      inputSchema: githubReplaceTextInputSchema,
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

  registerMcpTool(
    server,
    "github_restore_file_from_ref",
    {
      description: "Restore a file on the target branch from the same file path at a commit, branch, or tag.",
      inputSchema: githubRestoreFileFromRefInputSchema,
    },
    async ({
      repo,
      path,
      source_ref,
      commit_message,
      branch,
      expected_sha,
      dry_run = true,
    }) => {
      const result = await restoreFileFromRef({
        github: github(),
        repo,
        path,
        sourceRef: source_ref,
        commitMessage: commitMessage(commit_message, "Restore file from ref via MCP"),
        branch,
        expectedSha: expected_sha,
        dryRun: dry_run,
      });

      return jsonResponse(result);
    }
  );
}
