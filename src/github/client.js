import { Octokit } from "octokit";

export const GITHUB_CONTENT_API_HARD_MAX_BYTES = 100_000_000;
export const GITHUB_STABLE_READ_MAX_BYTES = 50_000_000;
export const GITHUB_STABLE_WRITE_MAX_BYTES = 50_000_000;

function toSafeInt(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

export function getStableLimit(envName, fallback, hardMax = GITHUB_CONTENT_API_HARD_MAX_BYTES) {
  return toSafeInt(process.env[envName], fallback, { min: 1, max: hardMax });
}

export function getAllowedRepos(defaultRepo = "") {
  return Array.from(
    new Set(
      String(process.env.GITHUB_ALLOWED_REPOS || defaultRepo || "")
        .split(",")
        .map((repoName) => repoName.trim())
        .filter(Boolean)
    )
  );
}

export function createGithubClient(options = {}) {
  const token = options.token || process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
  const owner = options.owner || process.env.GITHUB_OWNER || "";
  const defaultRepo = options.repo || process.env.GITHUB_REPO || "";
  const branch = options.branch || process.env.GITHUB_BRANCH || "main";
  const allowedRepos = options.allowedRepos || getAllowedRepos(defaultRepo);

  if (!token) throw new Error("GitHub token is not configured.");
  if (!owner) throw new Error("GITHUB_OWNER is not configured.");
  if (!defaultRepo) throw new Error("GITHUB_REPO is not configured.");

  return {
    octokit: options.octokit || new Octokit({ auth: token }),
    owner,
    defaultRepo,
    branch,
    allowedRepos,
  };
}

export function normalizeRepoInput(repoInput, github) {
  const raw = String(repoInput || "").trim();
  if (!raw) return github.defaultRepo;

  if (raw.includes("/")) {
    const [owner, repo, ...extra] = raw.split("/");
    if (!owner || !repo || extra.length > 0) {
      throw new Error(`Invalid repo "${raw}". Expected repo name or owner/repo.`);
    }

    if (github.owner && owner !== github.owner) {
      throw new Error(`Repo owner "${owner}" is not allowed. This server is configured for "${github.owner}".`);
    }

    return repo;
  }

  return raw;
}

export function assertAllowedRepo(repo, github) {
  const allowed = github.allowedRepos || [];
  if (!allowed.includes(repo)) {
    throw new Error(`Repo "${repo}" is not allowed. Allowed repos: ${allowed.join(", ")}`);
  }
}

export function resolveGithubTarget({ github, repo, branch, ref } = {}) {
  const resolvedRepo = normalizeRepoInput(repo, github);
  assertAllowedRepo(resolvedRepo, github);

  return {
    owner: github.owner,
    repo: resolvedRepo,
    branch: branch || github.branch || "main",
    ref: ref || branch || github.branch || "main",
  };
}

export function normalizeRepoPath(inputPath, { requireFilePath = false } = {}) {
  const clean = String(inputPath || "").trim().replace(/^\/+/, "");

  if (!clean && requireFilePath) {
    throw new Error("path is required.");
  }

  const parts = clean.split("/").filter(Boolean);
  if (parts.some((part) => part === "." || part === "..")) {
    throw new Error("Path cannot contain '.' or '..' segments.");
  }

  return parts.join("/");
}

export function encodeContent(content) {
  return Buffer.from(String(content), "utf8").toString("base64");
}

export function decodeContent(base64Content) {
  return Buffer.from(String(base64Content || "").replace(/\n/g, ""), "base64");
}

export function normalizeRawContentToBuffer(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (typeof value === "string") return Buffer.from(value, "utf8");
  if (value == null) return Buffer.alloc(0);
  return Buffer.from(JSON.stringify(value), "utf8");
}

export function looksBinary(buffer) {
  return Buffer.isBuffer(buffer) && buffer.includes(0);
}

export function assertFileContent(result, path) {
  if (!result) throw new Error(`File not found: ${path}`);
  if (Array.isArray(result)) throw new Error(`"${path}" is a directory, not a file.`);
  if (result.type !== "file") throw new Error(`"${path}" is not a file. GitHub type: ${result.type}`);
}

export async function getContentOrNull({ github, repo, path, ref }) {
  const target = resolveGithubTarget({ github, repo, ref });
  const normalizedPath = normalizeRepoPath(path);

  try {
    const response = await github.octokit.rest.repos.getContent({
      owner: target.owner,
      repo: target.repo,
      path: normalizedPath,
      ref: target.ref,
    });
    return response.data;
  } catch (error) {
    if (error?.status === 404) return null;
    throw error;
  }
}

export async function getRawFileBuffer({ github, repo, path, ref }) {
  const target = resolveGithubTarget({ github, repo, ref });
  const normalizedPath = normalizeRepoPath(path, { requireFilePath: true });

  const response = await github.octokit.request("GET /repos/{owner}/{repo}/contents/{path}", {
    owner: target.owner,
    repo: target.repo,
    path: normalizedPath,
    ref: target.ref,
    headers: {
      accept: "application/vnd.github.raw",
    },
  });

  return normalizeRawContentToBuffer(response.data);
}
