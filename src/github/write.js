import {
  GITHUB_CONTENT_API_HARD_MAX_BYTES,
  GITHUB_STABLE_WRITE_MAX_BYTES,
  assertFileContent,
  decodeContent,
  encodeContent,
  getContentOrNull,
  getRawFileBuffer,
  getStableLimit,
  normalizeRepoPath,
  resolveGithubTarget,
} from "./client.js";
import { previewFullReplacement, previewTextReplacement } from "./patch.js";
import { summarizeTextDiff } from "../utils/diff.js";

const DEFAULT_WRITE_MAX_BYTES = GITHUB_STABLE_WRITE_MAX_BYTES;
const DEFAULT_PREVIEW_MAX_BYTES = 250_000;
const DEFAULT_DIFF_MAX_CHARS = 20_000;
const DEFAULT_REPLACE_MANY_MAX_PATCHES = 500;

function writeMaxBytes() {
  return getStableLimit("MCP_GITHUB_WRITE_MAX_BYTES", DEFAULT_WRITE_MAX_BYTES, GITHUB_CONTENT_API_HARD_MAX_BYTES);
}

function previewMaxBytes() {
  return getStableLimit("MCP_GITHUB_PREVIEW_MAX_BYTES", DEFAULT_PREVIEW_MAX_BYTES, 5_000_000);
}

function diffMaxChars() {
  return getStableLimit("MCP_GITHUB_DIFF_MAX_CHARS", DEFAULT_DIFF_MAX_CHARS, 200_000);
}

function assertWriteSize(content, path) {
  const bytes = Buffer.byteLength(String(content ?? ""), "utf8");
  const limit = writeMaxBytes();
  if (bytes > limit) {
    throw new Error(`File write is too large for stable operation. Path: ${path}. Size: ${bytes} bytes. Limit: ${limit} bytes.`);
  }
  return { bytes, limit };
}

function trimDiff(diff) {
  const max = diffMaxChars();
  const text = String(diff || "");
  if (text.length <= max) return { diff: text, truncated: false };
  return { diff: `${text.slice(0, max)}\n... diff truncated at ${max} characters ...\n`, truncated: true };
}

function compactPreview(preview, { includeNewText = false } = {}) {
  const trimmed = trimDiff(preview?.diff);
  return {
    ...preview,
    diff: trimmed.diff,
    diff_truncated: trimmed.truncated,
    newText: includeNewText ? preview?.newText : undefined,
  };
}

function stableFullPreview({ oldText, newText, path }) {
  const oldBytes = Buffer.byteLength(String(oldText ?? ""), "utf8");
  const newBytes = Buffer.byteLength(String(newText ?? ""), "utf8");
  const maxPreview = previewMaxBytes();

  if (oldBytes + newBytes > maxPreview) {
    return {
      ok: true,
      changed: String(oldText ?? "") !== String(newText ?? ""),
      path,
      summary: summarizeTextDiff(String(oldText ?? ""), String(newText ?? "")),
      diff: "Diff omitted because preview input exceeds stable preview byte limit.",
      diff_truncated: true,
      preview_bytes: { old_bytes: oldBytes, new_bytes: newBytes, max_preview_bytes: maxPreview },
      newText: undefined,
    };
  }

  return compactPreview(previewFullReplacement({ oldText, newText, path }));
}

async function existingTextForWrite({ github, repo, path, ref, existing }) {
  if (!existing?.content || existing.size > 1_000_000 || existing.encoding === "none") {
    const buffer = await getRawFileBuffer({ github, repo, path, ref });
    return buffer.toString("utf8");
  }
  return decodeContent(existing.content).toString("utf8");
}

function compactTextReplacementPreview(args) {
  const maxPreview = previewMaxBytes();
  const oldBytes = Buffer.byteLength(String(args.oldText ?? ""), "utf8");
  const replaceBytes = Buffer.byteLength(String(args.replace ?? ""), "utf8");
  const findBytes = Buffer.byteLength(String(args.find ?? ""), "utf8");

  if (oldBytes + replaceBytes + findBytes > maxPreview) {
    const find = String(args.find ?? "");
    const source = String(args.oldText ?? "");
    const matches = find ? source.split(find).length - 1 : 0;
    if (!find) throw new Error("find text is required.");
    if (matches === 0) throw new Error("find text was not found.");
    if (args.expectedMatches != null && Number(args.expectedMatches) !== matches) {
      throw new Error(`Expected ${args.expectedMatches} match(es), found ${matches}.`);
    }
    return {
      ok: true,
      changed: true,
      path: args.path,
      occurrence: args.occurrence || "first",
      matches,
      applied_matches: args.occurrence === "all" ? matches : 1,
      summary: { changed: true, old_line_count: source.split("\n").length, new_line_count: null, same_prefix_lines: null, same_suffix_lines: null, lines_removed: null, lines_added: null },
      diff: "Diff omitted because replacement preview exceeds stable preview byte limit.",
      diff_truncated: true,
      newText: undefined,
    };
  }

  return compactPreview(previewTextReplacement(args));
}

export async function writeFile({ github, repo, path, content, commitMessage, branch, overwrite = false, dryRun = true } = {}) {
  const target = resolveGithubTarget({ github, repo, branch });
  const resolvedPath = normalizeRepoPath(path, { requireFilePath: true });
  const targetBranch = target.branch;
  const finalContent = String(content ?? "");
  const size = assertWriteSize(finalContent, resolvedPath);

  if (!commitMessage) throw new Error("commitMessage is required.");

  const existing = await getContentOrNull({ github, repo: target.repo, path: resolvedPath, ref: targetBranch });
  if (existing && Array.isArray(existing)) throw new Error(`"${resolvedPath}" is a directory, not a file.`);
  if (existing && !overwrite) throw new Error(`File already exists: ${resolvedPath}. Use updateFile or set overwrite: true.`);

  const oldContent = existing ? await existingTextForWrite({ github, repo: target.repo, path: resolvedPath, ref: targetBranch, existing }) : "";
  const preview = stableFullPreview({ oldText: oldContent, newText: finalContent, path: resolvedPath });

  if (dryRun) {
    return { ok: true, dry_run: true, action: existing ? "would_overwrite" : "would_create", repo: `${target.owner}/${target.repo}`, branch: targetBranch, path: resolvedPath, previous_sha: existing?.sha || null, new_content_bytes: size.bytes, commit_message: commitMessage, limits: { max_write_bytes: size.limit }, preview };
  }

  const request = { owner: target.owner, repo: target.repo, path: resolvedPath, message: commitMessage, content: encodeContent(finalContent), branch: targetBranch };
  if (existing?.sha) request.sha = existing.sha;
  const response = await github.octokit.rest.repos.createOrUpdateFileContents(request);

  return { ok: true, message: existing ? "File overwritten." : "File created.", action: existing ? "overwrite" : "create", repo: `${target.owner}/${target.repo}`, branch: targetBranch, path: resolvedPath, previous_sha: existing?.sha || null, new_sha: response.data.content?.sha || null, commit_url: response.data.commit?.html_url || null, file_url: response.data.content?.html_url || null, limits: { max_write_bytes: size.limit }, preview };
}

export async function updateFile({ github, repo, path, content, commitMessage, branch, expectedSha, dryRun = true } = {}) {
  const target = resolveGithubTarget({ github, repo, branch });
  const resolvedPath = normalizeRepoPath(path, { requireFilePath: true });
  const targetBranch = target.branch;
  const finalContent = String(content ?? "");
  const size = assertWriteSize(finalContent, resolvedPath);

  if (!commitMessage) throw new Error("commitMessage is required.");
  if (!expectedSha) throw new Error("expectedSha is required for updateFile.");

  const existing = await getContentOrNull({ github, repo: target.repo, path: resolvedPath, ref: targetBranch });
  assertFileContent(existing, resolvedPath);
  if (existing.sha !== expectedSha) throw new Error(["Refusing to update because expectedSha does not match current file SHA.", `Path: ${resolvedPath}`, `Expected: ${expectedSha}`, `Current:  ${existing.sha}`].join("\n"));

  const oldContent = await existingTextForWrite({ github, repo: target.repo, path: resolvedPath, ref: targetBranch, existing });
  const preview = stableFullPreview({ oldText: oldContent, newText: finalContent, path: resolvedPath });

  if (!preview.changed) return { ok: true, message: "No update needed. Content is unchanged.", repo: `${target.owner}/${target.repo}`, branch: targetBranch, path: resolvedPath, sha: existing.sha, file_url: existing.html_url, preview };

  if (dryRun) return { ok: true, dry_run: true, action: "would_update", repo: `${target.owner}/${target.repo}`, branch: targetBranch, path: resolvedPath, current_sha: existing.sha, commit_message: commitMessage, limits: { max_write_bytes: size.limit }, preview };

  const response = await github.octokit.rest.repos.createOrUpdateFileContents({ owner: target.owner, repo: target.repo, path: resolvedPath, message: commitMessage, content: encodeContent(finalContent), sha: existing.sha, branch: targetBranch });
  return { ok: true, message: "File updated.", action: "update", repo: `${target.owner}/${target.repo}`, branch: targetBranch, path: resolvedPath, previous_sha: existing.sha, new_sha: response.data.content?.sha || null, commit_url: response.data.commit?.html_url || null, file_url: response.data.content?.html_url || null, limits: { max_write_bytes: size.limit }, preview };
}

function countOccurrences(text, find) {
  if (!find) return 0;
  return String(text).split(String(find)).length - 1;
}

function applyTextPatch(source, patch, index) {
  const find = String(patch?.find ?? "");
  const replace = String(patch?.replace ?? "");
  const occurrence = patch?.occurrence || "first";
  const expectedMatches = patch?.expected_matches ?? patch?.expectedMatches;
  if (!find) throw new Error(`Patch ${index + 1}: find text is required.`);
  if (!["first", "all"].includes(occurrence)) throw new Error(`Patch ${index + 1}: occurrence must be "first" or "all".`);
  const matches = countOccurrences(source, find);
  if (matches === 0) throw new Error(`Patch ${index + 1}: find text was not found.`);
  if (expectedMatches != null && Number(expectedMatches) !== matches) throw new Error(`Patch ${index + 1}: expected ${expectedMatches} match(es), found ${matches}.`);
  const nextText = occurrence === "all" ? source.split(find).join(replace) : source.replace(find, replace);
  return { nextText, metadata: { index: index + 1, occurrence, matches, applied_matches: occurrence === "all" ? matches : 1 } };
}

export async function replaceManyInFile({ github, repo, path, replacements, commitMessage, branch, expectedSha, dryRun = true } = {}) {
  const target = resolveGithubTarget({ github, repo, branch });
  const resolvedPath = normalizeRepoPath(path, { requireFilePath: true });
  const targetBranch = target.branch;
  const maxPatches = getStableLimit("MCP_GITHUB_REPLACE_MANY_MAX_PATCHES", DEFAULT_REPLACE_MANY_MAX_PATCHES, 5_000);

  if (!commitMessage) throw new Error("commitMessage is required.");
  if (!expectedSha) throw new Error("expectedSha is required for replaceManyInFile.");
  if (!Array.isArray(replacements) || replacements.length === 0) throw new Error("replacements must be a non-empty array.");
  if (replacements.length > maxPatches) throw new Error(`Too many replacements. Count: ${replacements.length}. Limit: ${maxPatches}.`);

  const existing = await getContentOrNull({ github, repo: target.repo, path: resolvedPath, ref: targetBranch });
  assertFileContent(existing, resolvedPath);
  if (existing.sha !== expectedSha) throw new Error(`SHA mismatch for ${resolvedPath}. Expected ${expectedSha}, current ${existing.sha}.`);

  const oldContent = await existingTextForWrite({ github, repo: target.repo, path: resolvedPath, ref: targetBranch, existing });
  let nextText = oldContent;
  const applied = [];
  for (let index = 0; index < replacements.length; index += 1) {
    const result = applyTextPatch(nextText, replacements[index], index);
    nextText = result.nextText;
    applied.push(result.metadata);
  }

  const size = assertWriteSize(nextText, resolvedPath);
  const preview = stableFullPreview({ oldText: oldContent, newText: nextText, path: resolvedPath });
  if (!preview.changed) return { ok: true, message: "No update needed. Content is unchanged.", repo: `${target.owner}/${target.repo}`, branch: targetBranch, path: resolvedPath, sha: existing.sha, file_url: existing.html_url, applied, preview };
  if (dryRun) return { ok: true, dry_run: true, action: "would_replace_many", repo: `${target.owner}/${target.repo}`, branch: targetBranch, path: resolvedPath, current_sha: existing.sha, commit_message: commitMessage, applied, limits: { max_write_bytes: size.limit, max_patches: maxPatches }, preview };

  const response = await github.octokit.rest.repos.createOrUpdateFileContents({ owner: target.owner, repo: target.repo, path: resolvedPath, message: commitMessage, content: encodeContent(nextText), sha: existing.sha, branch: targetBranch });
  return { ok: true, message: "Multiple text replacements applied.", action: "replace_many", repo: `${target.owner}/${target.repo}`, branch: targetBranch, path: resolvedPath, previous_sha: existing.sha, new_sha: response.data.content?.sha || null, commit_url: response.data.commit?.html_url || null, file_url: response.data.content?.html_url || null, applied, limits: { max_write_bytes: size.limit, max_patches: maxPatches }, preview };
}

export async function replaceTextInFile({ github, repo, path, find, replace, commitMessage, branch, expectedSha, occurrence = "first", expectedMatches, dryRun = true } = {}) {
  const target = resolveGithubTarget({ github, repo, branch });
  const resolvedPath = normalizeRepoPath(path, { requireFilePath: true });
  const targetBranch = target.branch;
  if (!commitMessage) throw new Error("commitMessage is required.");
  if (!expectedSha) throw new Error("expectedSha is required for replaceTextInFile.");

  const existing = await getContentOrNull({ github, repo: target.repo, path: resolvedPath, ref: targetBranch });
  assertFileContent(existing, resolvedPath);
  if (existing.sha !== expectedSha) throw new Error(`SHA mismatch for ${resolvedPath}. Expected ${expectedSha}, current ${existing.sha}.`);

  const oldContent = await existingTextForWrite({ github, repo: target.repo, path: resolvedPath, ref: targetBranch, existing });
  const fullPreview = previewTextReplacement({ oldText: oldContent, find, replace, path: resolvedPath, occurrence, expectedMatches });
  const size = assertWriteSize(fullPreview.newText, resolvedPath);
  const preview = compactPreview(fullPreview);

  if (!preview.changed) return { ok: true, message: "No update needed. Content is unchanged.", repo: `${target.owner}/${target.repo}`, branch: targetBranch, path: resolvedPath, sha: existing.sha, file_url: existing.html_url, preview };
  if (dryRun) return { ok: true, dry_run: true, action: "would_replace_text", repo: `${target.owner}/${target.repo}`, branch: targetBranch, path: resolvedPath, current_sha: existing.sha, commit_message: commitMessage, limits: { max_write_bytes: size.limit }, preview };

  const response = await github.octokit.rest.repos.createOrUpdateFileContents({ owner: target.owner, repo: target.repo, path: resolvedPath, message: commitMessage, content: encodeContent(fullPreview.newText), sha: existing.sha, branch: targetBranch });
  return { ok: true, message: "Text replacement applied.", action: "replace_text", repo: `${target.owner}/${target.repo}`, branch: targetBranch, path: resolvedPath, previous_sha: existing.sha, new_sha: response.data.content?.sha || null, commit_url: response.data.commit?.html_url || null, file_url: response.data.content?.html_url || null, limits: { max_write_bytes: size.limit }, preview };
}
