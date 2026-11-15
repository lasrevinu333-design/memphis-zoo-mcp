import {
  GITHUB_CONTENT_API_HARD_MAX_BYTES,
  GITHUB_STABLE_READ_MAX_BYTES,
  assertFileContent,
  decodeContent,
  getContentOrNull,
  getRawFileBuffer,
  getStableLimit,
  looksBinary,
  normalizeRepoPath,
  resolveGithubTarget,
} from "./client.js";

const TEXT_SEARCH_EXTENSIONS = new Set([
  ".js", ".mjs", ".cjs", ".json", ".md", ".txt", ".html", ".css",
  ".sql", ".yml", ".yaml", ".ts", ".tsx", ".jsx", ".py", ".sh", ".toml", ".env",
]);

const DEFAULT_READ_MAX_BYTES = GITHUB_STABLE_READ_MAX_BYTES;
const DEFAULT_LIST_MAX_ENTRIES = 50_000;
const DEFAULT_BATCH_MAX_FILES = 100;
const DEFAULT_BATCH_TOTAL_MAX_BYTES = GITHUB_STABLE_READ_MAX_BYTES;
const DEFAULT_CONTENT_SEARCH_MAX_CANDIDATES = 500;
const DEFAULT_CONTENT_SEARCH_FILE_MAX_BYTES = 1_000_000;
const DEFAULT_CONTENT_SEARCH_TOTAL_MAX_BYTES = 20_000_000;

function toSafeInt(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

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

function getContentSearchLimits() {
  return {
    max_candidates: getStableLimit("MCP_GITHUB_CONTENT_SEARCH_MAX_CANDIDATES", DEFAULT_CONTENT_SEARCH_MAX_CANDIDATES, 2_000),
    max_file_bytes: getStableLimit("MCP_GITHUB_CONTENT_SEARCH_FILE_MAX_BYTES", DEFAULT_CONTENT_SEARCH_FILE_MAX_BYTES, 5_000_000),
    max_total_bytes: getStableLimit("MCP_GITHUB_CONTENT_SEARCH_TOTAL_MAX_BYTES", DEFAULT_CONTENT_SEARCH_TOTAL_MAX_BYTES, GITHUB_STABLE_READ_MAX_BYTES),
  };
}

function canSearchFileContent(entry, limits) {
  const path = String(entry?.path || "").toLowerCase();
  const size = Number(entry?.size || 0);
  if (!path || size <= 0 || size > limits.max_file_bytes) return false;
  if (path.includes("package-lock.json") || path.includes("node_modules/") || path.includes(".git/")) return false;
  return TEXT_SEARCH_EXTENSIONS.has(textSearchExtension(path));
}

function findLineMatches(text, query, maxMatches = 10) {
  const lines = String(text || "").split("\n");
  const matches = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const hit = line.toLowerCase().indexOf(query);
    if (hit === -1) continue;
    matches.push({
      line: index + 1,
      preview: line.slice(Math.max(0, hit - 160), Math.min(line.length, hit + query.length + 160)),
    });
    if (matches.length >= maxMatches) break;
  }
  return matches;
}

async function readFileBuffer({ github, repo, path, ref, contentResult }) {
  const needsRaw = contentResult.size > 1_000_000 || contentResult.encoding === "none" || !contentResult.content;
  return needsRaw
    ? await getRawFileBuffer({ github, repo, path, ref })
    : decodeContent(contentResult.content);
}

export async function listDirectory({ github, repo, path = "", ref, recursive = false, maxEntries = 500 } = {}) {
  const target = resolveGithubTarget({ github, repo, ref });
  const searchQuery = parseSearchPath(path);
  const resolvedPath = searchQuery ? "" : normalizeRepoPath(path);
  const limit = Math.min(
    Math.max(Number.parseInt(String(maxEntries), 10) || 500, 1),
    getStableLimit("MCP_GITHUB_LIST_MAX_ENTRIES", DEFAULT_LIST_MAX_ENTRIES, 100_000)
  );

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
      .map((item) => ({ path: item.path, type: "file", match_type: "path", size: item.size ?? null, sha: item.sha, url: item.url }));

    const contentEntries = [];
    const searchLimits = getContentSearchLimits();
    let scannedCandidateCount = 0;
    let scannedBytes = 0;

    if (searchQuery.includeContent) {
      const candidates = files
        .filter((item) => canSearchFileContent(item, searchLimits))
        .slice(0, Math.min(limit, searchLimits.max_candidates));

      for (const item of candidates) {
        const size = Number(item.size || 0);
        if (scannedBytes + size > searchLimits.max_total_bytes) break;
        scannedCandidateCount += 1;
        scannedBytes += size;

        const contentResult = await getContentOrNull({ github, repo: target.repo, path: item.path, ref: target.ref });
        if (!contentResult || Array.isArray(contentResult) || contentResult.type !== "file") continue;

        const buffer = await readFileBuffer({ github, repo: target.repo, path: item.path, ref: target.ref, contentResult });
        if (looksBinary(buffer)) continue;

        const matches = findLineMatches(buffer.toString("utf8"), searchQuery.query);
        if (!matches.length) continue;
        contentEntries.push({ path: item.path, type: "file", match_type: "content", size: item.size ?? null, sha: item.sha, url: item.url, matches });
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
      truncated: searchQuery.includeContent ? scannedCandidateCount >= searchLimits.max_candidates : entries.length >= limit,
      count: entries.length,
      scanned_candidate_count: searchQuery.includeContent ? scannedCandidateCount : undefined,
      scanned_bytes: searchQuery.includeContent ? scannedBytes : undefined,
      limits: searchQuery.includeContent ? searchLimits : { max_entries: limit },
      entries,
    };
  }

  if (recursive) {
    const treeResponse = await github.octokit.rest.git.getTree({ owner: target.owner, repo: target.repo, tree_sha: target.ref, recursive: "true" });
    const prefix = resolvedPath ? `${resolvedPath}/` : "";
    const matching = treeResponse.data.tree.filter((item) => !resolvedPath || item.path === resolvedPath || String(item.path || "").startsWith(prefix));
    const entries = matching.slice(0, limit).map((item) => ({
      path: item.path,
      type: item.type === "blob" ? "file" : item.type === "tree" ? "directory" : item.type,
      size: item.size ?? null,
      sha: item.sha,
      url: item.url,
    }));
    return { ok: true, repo: `${target.owner}/${target.repo}`, ref: target.ref, path: resolvedPath, recursive: true, truncated: matching.length > entries.length, count: entries.length, total_matching: matching.length, limits: { max_entries: limit }, entries };
  }

  const response = await github.octokit.rest.repos.getContent({ owner: target.owner, repo: target.repo, path: resolvedPath, ref: target.ref });
  const result = response.data;
  if (Array.isArray(result)) {
    return { ok: true, repo: `${target.owner}/${target.repo}`, ref: target.ref, path: resolvedPath, count: result.length, truncated: result.length >= 1_000, entries: result.map((item) => ({ name: item.name, path: item.path, type: item.type, size: item.size, sha: item.sha, html_url: item.html_url })) };
  }
  return { ok: true, repo: `${target.owner}/${target.repo}`, ref: target.ref, name: result.name, path: result.path, type: result.type, size: result.size, sha: result.sha, html_url: result.html_url };
}

export async function readFile({ github, repo, path, ref, format = "json", maxBytes } = {}) {
  const target = resolveGithubTarget({ github, repo, ref });
  const resolvedPath = normalizeRepoPath(path, { requireFilePath: true });
  const limit = Math.min(
    Math.max(Number.parseInt(String(maxBytes ?? DEFAULT_READ_MAX_BYTES), 10) || DEFAULT_READ_MAX_BYTES, 1),
    GITHUB_CONTENT_API_HARD_MAX_BYTES
  );

  const contentResult = await getContentOrNull({ github, repo: target.repo, path: resolvedPath, ref: target.ref });
  assertFileContent(contentResult, resolvedPath);
  if (contentResult.size > limit) throw new Error(`File is too large to read safely. Size: ${contentResult.size} bytes. Limit: ${limit} bytes.`);

  const buffer = await readFileBuffer({ github, repo: target.repo, path: resolvedPath, ref: target.ref, contentResult });
  if (buffer.length > limit) throw new Error(`Raw file is too large to return safely. Size: ${buffer.length} bytes. Limit: ${limit} bytes.`);

  if (format === "base64") {
    return { ok: true, repo: `${target.owner}/${target.repo}`, ref: target.ref, path: contentResult.path, name: contentResult.name, sha: contentResult.sha, size: contentResult.size, actual_bytes: buffer.length, encoding: "base64", html_url: contentResult.html_url, content: buffer.toString("base64"), limits: { max_bytes: limit } };
  }
  if (looksBinary(buffer)) throw new Error("File appears to be binary. Use format: base64 if raw content is required.");
  const text = buffer.toString("utf8");
  if (format === "text") return text;
  return { ok: true, repo: `${target.owner}/${target.repo}`, ref: target.ref, path: contentResult.path, name: contentResult.name, sha: contentResult.sha, size: contentResult.size, actual_bytes: buffer.length, encoding: "utf8", html_url: contentResult.html_url, content: text, limits: { max_bytes: limit } };
}

export async function batchReadFiles({ github, repo, paths = [], ref, format = "json", maxBytes } = {}) {
  if (!Array.isArray(paths) || paths.length === 0) throw new Error("paths must be a non-empty array.");
  const maxFiles = getStableLimit("MCP_GITHUB_BATCH_MAX_FILES", DEFAULT_BATCH_MAX_FILES, 500);
  const totalMaxBytes = getStableLimit("MCP_GITHUB_BATCH_TOTAL_MAX_BYTES", DEFAULT_BATCH_TOTAL_MAX_BYTES, GITHUB_CONTENT_API_HARD_MAX_BYTES);
  if (paths.length > maxFiles) throw new Error(`At most ${maxFiles} files can be read in one batch.`);

  const results = [];
  let totalBytes = 0;
  for (const path of paths) {
    try {
      const data = await readFile({ github, repo, path, ref, format, maxBytes });
      const bytes = typeof data === "string" ? Buffer.byteLength(data, "utf8") : Number(data?.actual_bytes || data?.size || 0);
      if (totalBytes + bytes > totalMaxBytes) {
        results.push({ path, ok: false, error: `Batch total byte limit would be exceeded. Current: ${totalBytes}. Next file: ${bytes}. Limit: ${totalMaxBytes}.` });
        break;
      }
      totalBytes += bytes;
      results.push({ path, ok: true, bytes, data });
    } catch (error) {
      results.push({ path, ok: false, error: error?.message || String(error) });
    }
  }

  return { ok: results.every((result) => result.ok), count: results.length, total_bytes: totalBytes, limits: { max_files: maxFiles, total_max_bytes: totalMaxBytes, per_file_max_bytes: maxBytes ?? DEFAULT_READ_MAX_BYTES }, results };
}
