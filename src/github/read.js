import {
  assertFileContent,
  decodeContent,
  getContentOrNull,
  looksBinary,
  normalizeRepoPath,
  resolveGithubTarget,
} from "./client.js";

const TEXT_SEARCH_EXTENSIONS = new Set([
  ".js",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".txt",
  ".html",
  ".css",
  ".sql",
  ".yml",
  ".yaml",
]);

function parseSearchPath(path) {
  const text = String(path || "").trim();

  if (text.startsWith("search-content:")) {
    const query = text.slice("search-content:".length).trim().toLowerCase();
    if (!query) throw new Error("search query is required after search-content:.");
    return { query, includeContent: true };
  }

  if (text.startsWith("search:")) {
    const query = text.slice("search:".length).trim().toLowerCase();
    if (!query) throw new Error("search query is required after search:.");
    return { query, includeContent: false };
  }

  return null;
}

function textSearchExtension(path) {
  const lower = String(path || "").toLowerCase();
  const match = lower.match(/(\.[a-z0-9_-]+)$/);
  return match ? match[1] : "";
}

function canSearchFileContent(entry) {
  const path = String(entry?.path || "").toLowerCase();
  const size = Number(entry?.size || 0);

  if (!path || size <= 0 || size > 250_000) return false;
  if (path.includes("package-lock.json") || path.includes("node_modules/") || path.includes(".git/")) return false;

  return TEXT_SEARCH_EXTENSIONS.has(textSearchExtension(path));
}

function findLineMatches(text, query, maxMatches = 5) {
  const lines = String(text || "").split("\n");
  const matches = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const hit = line.toLowerCase().indexOf(query);
    if (hit === -1) continue;

    matches.push({
      line: index + 1,
      preview: line.slice(Math.max(0, hit - 100), Math.min(line.length, hit + query.length + 100)),
    });

    if (matches.length >= maxMatches) break;
  }

  return matches;
}

export async function listDirectory({ github, repo, path = "", ref, recursive = false, maxEntries = 500 } = {}) {
  const target = resolveGithubTarget({ github, repo, ref });
  const searchQuery = parseSearchPath(path);
  const resolvedPath = searchQuery ? "" : normalizeRepoPath(path);
  const limit = Math.min(Math.max(Number.parseInt(String(maxEntries), 10) || 500, 1), 10000);

  if (searchQuery) {
    const treeResponse = await github.octokit.rest.git.getTree({
      owner: target.owner,
      repo: target.repo,
      tree_sha: target.ref,
      recursive: "true",
    });

    const files = treeResponse.data.tree.filter((item) => item.type === "blob");
    const pathEntries = files
      .filter((item) => String(item.path || "").toLowerCase().includes(searchQuery.query))
      .slice(0, limit)
      .map((item) => ({
        path: item.path,
        type: "file",
        match_type: "path",
        size: item.size ?? null,
        sha: item.sha,
        url: item.url,
      }));

    const contentEntries = [];

    if (searchQuery.includeContent) {
      const candidates = files.filter(canSearchFileContent).slice(0, Math.min(limit, 50));

      for (const item of candidates) {
        const contentResult = await getContentOrNull({
          github,
          repo: target.repo,
          path: item.path,
          ref: target.ref,
        });

        if (!contentResult || Array.isArray(contentResult) || contentResult.type !== "file" || !contentResult.content) {
          continue;
        }

        const buffer = decodeContent(contentResult.content);
        if (looksBinary(buffer)) continue;

        const matches = findLineMatches(buffer.toString("utf8"), searchQuery.query);
        if (!matches.length) continue;

        contentEntries.push({
          path: item.path,
          type: "file",
          match_type: "content",
          size: item.size ?? null,
          sha: item.sha,
          url: item.url,
          matches,
        });
      }
    }

    const entries = searchQuery.includeContent ? contentEntries : pathEntries;

    return {
      ok: true,
      repo: `${target.owner}/${target.repo}`,
      ref: target.ref,
      path: "",
      search: searchQuery.query,
      include_content: searchQuery.includeContent,
      recursive: true,
      truncated: entries.length >= limit,
      count: entries.length,
      entries,
    };
  }

  if (recursive) {
    const treeResponse = await github.octokit.rest.git.getTree({
      owner: target.owner,
      repo: target.repo,
      tree_sha: target.ref,
      recursive: "true",
    });

    const prefix = resolvedPath ? `${resolvedPath}/` : "";
    const entries = treeResponse.data.tree
      .filter((item) => {
        if (!resolvedPath) return true;
        return item.path === resolvedPath || String(item.path || "").startsWith(prefix);
      })
      .slice(0, limit)
      .map((item) => ({
        path: item.path,
        type: item.type === "blob" ? "file" : item.type === "tree" ? "directory" : item.type,
        size: item.size ?? null,
        sha: item.sha,
        url: item.url,
      }));

    return {
      ok: true,
      repo: `${target.owner}/${target.repo}`,
      ref: target.ref,
      path: resolvedPath,
      recursive: true,
      truncated: entries.length >= limit,
      count: entries.length,
      entries,
    };
  }

  const response = await github.octokit.rest.repos.getContent({
    owner: target.owner,
    repo: target.repo,
    path: resolvedPath,
    ref: target.ref,
  });

  const result = response.data;

  if (Array.isArray(result)) {
    return {
      ok: true,
      repo: `${target.owner}/${target.repo}`,
      ref: target.ref,
      path: resolvedPath,
      count: result.length,
      entries: result.map((item) => ({
        name: item.name,
        path: item.path,
        type: item.type,
        size: item.size,
        sha: item.sha,
        html_url: item.html_url,
      })),
    };
  }

  return {
    ok: true,
    repo: `${target.owner}/${target.repo}`,
    ref: target.ref,
    name: result.name,
    path: result.path,
    type: result.type,
    size: result.size,
    sha: result.sha,
    html_url: result.html_url,
  };
}

export async function readFile({ github, repo, path, ref, format = "json", maxBytes = 1_000_000 } = {}) {
  const target = resolveGithubTarget({ github, repo, ref });
  const resolvedPath = normalizeRepoPath(path, { requireFilePath: true });
  const limit = Math.min(Math.max(Number.parseInt(String(maxBytes), 10) || 1_000_000, 1), 10_000_000);

  const contentResult = await getContentOrNull({
    github,
    repo: target.repo,
    path: resolvedPath,
    ref: target.ref,
  });

  assertFileContent(contentResult, resolvedPath);

  if (contentResult.size > limit) {
    throw new Error(`File is too large to read safely. Size: ${contentResult.size} bytes. Limit: ${limit} bytes.`);
  }

  if (format === "base64") {
    return {
      ok: true,
      repo: `${target.owner}/${target.repo}`,
      ref: target.ref,
      path: contentResult.path,
      name: contentResult.name,
      sha: contentResult.sha,
      size: contentResult.size,
      encoding: "base64",
      html_url: contentResult.html_url,
      content: contentResult.content,
    };
  }

  const buffer = decodeContent(contentResult.content);
  if (looksBinary(buffer)) {
    throw new Error("File appears to be binary. Use format: base64 if raw content is required.");
  }

  const text = buffer.toString("utf8");

  if (format === "text") return text;

  return {
    ok: true,
    repo: `${target.owner}/${target.repo}`,
    ref: target.ref,
    path: contentResult.path,
    name: contentResult.name,
    sha: contentResult.sha,
    size: contentResult.size,
    encoding: "utf8",
    html_url: contentResult.html_url,
    content: text,
  };
}

export async function batchReadFiles({ github, repo, paths = [], ref, format = "json", maxBytes = 1_000_000 } = {}) {
  if (!Array.isArray(paths) || paths.length === 0) {
    throw new Error("paths must be a non-empty array.");
  }

  if (paths.length > 25) {
    throw new Error("At most 25 files can be read in one batch.");
  }

  const results = [];
  for (const path of paths) {
    try {
      const data = await readFile({ github, repo, path, ref, format, maxBytes });
      results.push({ path, ok: true, data });
    } catch (error) {
      results.push({ path, ok: false, error: error?.message || String(error) });
    }
  }

  return {
    ok: results.every((result) => result.ok),
    count: results.length,
    results,
  };
}
