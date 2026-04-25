import { decodeContent, getContentOrNull, looksBinary, normalizeRepoPath, resolveGithubTarget } from "./client.js";
import { listDirectory } from "./read.js";

const TEXT_EXTENSIONS = new Set([
  ".js",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".jsx",
  ".json",
  ".md",
  ".txt",
  ".html",
  ".css",
  ".sql",
  ".yml",
  ".yaml",
  ".xml",
  ".csv",
  ".env",
  ".example",
]);

function normalizeQuery(query) {
  const value = String(query || "").trim();
  if (!value) throw new Error("query is required.");
  return value;
}

function extensionOf(path) {
  const match = String(path || "").toLowerCase().match(/(\.[a-z0-9._-]+)$/);
  return match ? match[1] : "";
}

function looksTextPath(path) {
  const lower = String(path || "").toLowerCase();
  if (lower.includes("package-lock.json")) return false;
  if (lower.includes("node_modules/")) return false;
  if (lower.includes(".git/")) return false;
  if (lower.endsWith("dockerfile")) return true;
  if (lower.endsWith("makefile")) return true;
  return TEXT_EXTENSIONS.has(extensionOf(lower));
}

function lineSnippets({ text, query, maxMatches = 5, contextChars = 120 }) {
  const lowerQuery = query.toLowerCase();
  const lines = String(text || "").split("\n");
  const matches = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const hitAt = line.toLowerCase().indexOf(lowerQuery);
    if (hitAt === -1) continue;

    const start = Math.max(0, hitAt - contextChars);
    const end = Math.min(line.length, hitAt + query.length + contextChars);

    matches.push({
      line: index + 1,
      preview: line.slice(start, end),
    });

    if (matches.length >= maxMatches) break;
  }

  return matches;
}

export async function searchFiles({
  github,
  repo,
  query,
  path = "",
  ref,
  includeContent = false,
  maxEntries = 500,
  maxFileBytes = 250_000,
  maxContentFiles = 50,
  maxMatchesPerFile = 5,
} = {}) {
  const searchQuery = normalizeQuery(query);
  const target = resolveGithubTarget({ github, repo, ref });
  const rootPath = normalizeRepoPath(path);
  const limit = Math.min(Math.max(Number.parseInt(String(maxEntries), 10) || 500, 1), 5000);
  const fileLimit = Math.min(Math.max(Number.parseInt(String(maxContentFiles), 10) || 50, 1), 200);

  const tree = await listDirectory({
    github,
    repo: target.repo,
    path: rootPath,
    ref: target.ref,
    recursive: true,
    maxEntries: limit,
  });

  const lowerQuery = searchQuery.toLowerCase();
  const files = (tree.entries || []).filter((entry) => entry.type === "file");

  const pathMatches = files
    .filter((entry) => String(entry.path || "").toLowerCase().includes(lowerQuery))
    .map((entry) => ({
      type: "path",
      path: entry.path,
      size: entry.size ?? null,
      sha: entry.sha,
    }));

  const contentMatches = [];

  if (includeContent) {
    const candidates = files
      .filter((entry) => looksTextPath(entry.path))
      .filter((entry) => Number(entry.size || 0) <= maxFileBytes)
      .slice(0, fileLimit);

    for (const entry of candidates) {
      const content = await getContentOrNull({
        github,
        repo: target.repo,
        path: entry.path,
        ref: target.ref,
      });

      if (!content || Array.isArray(content) || content.type !== "file" || !content.content) continue;

      const buffer = decodeContent(content.content);
      if (looksBinary(buffer)) continue;

      const text = buffer.toString("utf8");
      const snippets = lineSnippets({
        text,
        query: searchQuery,
        maxMatches: maxMatchesPerFile,
      });

      if (snippets.length) {
        contentMatches.push({
          type: "content",
          path: entry.path,
          size: entry.size ?? null,
          sha: entry.sha,
          matches: snippets,
        });
      }
    }
  }

  return {
    ok: true,
    repo: `${target.owner}/${target.repo}`,
    ref: target.ref,
    path: rootPath,
    query: searchQuery,
    include_content: Boolean(includeContent),
    searched_files: files.length,
    path_match_count: pathMatches.length,
    content_match_count: contentMatches.length,
    truncated_tree: Boolean(tree.truncated),
    limits: {
      max_entries: limit,
      max_file_bytes: maxFileBytes,
      max_content_files: fileLimit,
      max_matches_per_file: maxMatchesPerFile,
    },
    path_matches: pathMatches,
    content_matches: contentMatches,
  };
}
