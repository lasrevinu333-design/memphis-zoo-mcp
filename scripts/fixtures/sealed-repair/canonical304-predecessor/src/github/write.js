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
import { previewFullReplacement } from "./patch.js";
import { summarizeTextDiff } from "../utils/diff.js";

const DEFAULT_WRITE_MAX_BYTES = GITHUB_STABLE_WRITE_MAX_BYTES;
const DEFAULT_PREVIEW_MAX_BYTES = 250_000;
const DEFAULT_DIFF_MAX_CHARS = 20_000;
const DEFAULT_REPLACE_MANY_MAX_PATCHES = 500;
function coalesceBoolean(primary, alias, fallback = true) {
  if (primary != null) return Boolean(primary);
  if (alias != null) return Boolean(alias);
  return fallback;
}

function coalesceText(primary, alias) {
  return primary != null ? primary : alias;
}

function writeMaxBytes() {
  return getStableLimit(
    "MCP_GITHUB_WRITE_MAX_BYTES",
    DEFAULT_WRITE_MAX_BYTES,
    GITHUB_CONTENT_API_HARD_MAX_BYTES
  );
}

function previewMaxBytes() {
  return getStableLimit(
    "MCP_GITHUB_PREVIEW_MAX_BYTES",
    DEFAULT_PREVIEW_MAX_BYTES,
    5_000_000
  );
}

function diffMaxChars() {
  return getStableLimit(
    "MCP_GITHUB_DIFF_MAX_CHARS",
    DEFAULT_DIFF_MAX_CHARS,
    200_000
  );
}

function replaceManyMaxPatches() {
  return getStableLimit(
    "MCP_GITHUB_REPLACE_MANY_MAX_PATCHES",
    DEFAULT_REPLACE_MANY_MAX_PATCHES,
    5_000
  );
}

function assertWriteSize(content, path) {
  const bytes = Buffer.byteLength(String(content ?? ""), "utf8");
  const limit = writeMaxBytes();

  if (bytes > limit) {
    throw new Error(
      `File write is too large for stable operation. Path: ${path}. Size: ${bytes} bytes. Limit: ${limit} bytes.`
    );
  }

  return { bytes, limit };
}

function resolveExpectedSha(expectedSha, existing, path) {
  if (!existing?.sha) {
    throw new Error(`Current file SHA could not be resolved for ${path}.`);
  }

  const expected = String(expectedSha || "").trim();

  if (expected) {
    if (existing.sha !== expected) {
      throw new Error(
        [
          "Refusing to update because expectedSha does not match current file SHA.",
          `Path: ${path}`,
          `Expected: ${expected}`,
          `Current:  ${existing.sha}`,
        ].join("\n")
      );
    }

    return expected;
  }

  throw new Error(
    "expectedSha is required for every mutation of an existing GitHub file."
  );
}

function trimDiff(diff) {
  const max = diffMaxChars();
  const text = String(diff || "");

  if (text.length <= max) {
    return { diff: text, truncated: false };
  }

  return {
    diff: `${text.slice(0, max)}\n... diff truncated at ${max} characters ...\n`,
    truncated: true,
  };
}

function compactPreview(preview, extra = {}) {
  const trimmed = trimDiff(preview?.diff);

  return {
    ...preview,
    ...extra,
    diff: trimmed.diff,
    diff_truncated: trimmed.truncated || Boolean(preview?.diff_truncated),
    newText: undefined,
  };
}

function stableFullPreview({ oldText, newText, path, extra = {} }) {
  const oldBytes = Buffer.byteLength(String(oldText ?? ""), "utf8");
  const newBytes = Buffer.byteLength(String(newText ?? ""), "utf8");
  const maxPreview = previewMaxBytes();

  if (oldBytes + newBytes > maxPreview) {
    return {
      ok: true,
      changed: String(oldText ?? "") !== String(newText ?? ""),
      path,
      ...extra,
      summary: summarizeTextDiff(String(oldText ?? ""), String(newText ?? "")),
      diff: "Diff omitted because preview input exceeds stable preview byte limit.",
      diff_truncated: true,
      preview_bytes: {
        old_bytes: oldBytes,
        new_bytes: newBytes,
        max_preview_bytes: maxPreview,
      },
      newText: undefined,
    };
  }

  return compactPreview(previewFullReplacement({ oldText, newText, path }), extra);
}

async function existingTextForWrite({ github, repo, path, ref, existing }) {
  if (!existing?.content || existing.size > 1_000_000 || existing.encoding === "none") {
    const buffer = await getRawFileBuffer({ github, repo, path, ref });
    return buffer.toString("utf8");
  }

  return decodeContent(existing.content).toString("utf8");
}

export async function writeFile({
  github,
  repo,
  path,
  content,
  commitMessage,
  commit_message,
  branch,
  overwrite = false,
  expectedSha,
  expected_sha,
  dryRun,
  dry_run,
} = {}) {
  const target = resolveGithubTarget({ github, repo, branch });
  const resolvedPath = normalizeRepoPath(path, { requireFilePath: true });
  const targetBranch = target.branch;
  const finalContent = String(content ?? "");
  const finalCommitMessage = String(coalesceText(commitMessage, commit_message) || "").trim();
  const effectiveDryRun = coalesceBoolean(dryRun, dry_run, true);
  const size = assertWriteSize(finalContent, resolvedPath);

  if (!finalCommitMessage) {
    throw new Error("commitMessage is required.");
  }

  const existing = await getContentOrNull({
    github,
    repo: target.repo,
    path: resolvedPath,
    ref: targetBranch,
  });

  if (existing && Array.isArray(existing)) {
    throw new Error(`"${resolvedPath}" is a directory, not a file.`);
  }

  if (existing && !overwrite) {
    throw new Error(`File already exists: ${resolvedPath}. Use updateFile or set overwrite: true.`);
  }

  const shaForOverwrite = existing
    ? resolveExpectedSha(coalesceText(expectedSha, expected_sha), existing, resolvedPath)
    : null;

  const oldContent = existing
    ? await existingTextForWrite({
        github,
        repo: target.repo,
        path: resolvedPath,
        ref: targetBranch,
        existing,
      })
    : "";

  const preview = stableFullPreview({
    oldText: oldContent,
    newText: finalContent,
    path: resolvedPath,
  });

  if (effectiveDryRun) {
    return {
      ok: true,
      dry_run: true,
      action: existing ? "would_overwrite" : "would_create",
      repo: `${target.owner}/${target.repo}`,
      branch: targetBranch,
      path: resolvedPath,
      previous_sha: existing?.sha || null,
      new_content_bytes: size.bytes,
      commit_message: finalCommitMessage,
      limits: { max_write_bytes: size.limit },
      preview,
    };
  }

  const request = {
    owner: target.owner,
    repo: target.repo,
    path: resolvedPath,
    message: finalCommitMessage,
    content: encodeContent(finalContent),
    branch: targetBranch,
  };

  if (shaForOverwrite) {
    request.sha = shaForOverwrite;
  }

  const response = await github.octokit.rest.repos.createOrUpdateFileContents(request);

  return {
    ok: true,
    message: existing ? "File overwritten." : "File created.",
    action: existing ? "overwrite" : "create",
    repo: `${target.owner}/${target.repo}`,
    branch: targetBranch,
    path: resolvedPath,
    previous_sha: existing?.sha || null,
    new_sha: response.data.content?.sha || null,
    commit_url: response.data.commit?.html_url || null,
    file_url: response.data.content?.html_url || null,
    limits: { max_write_bytes: size.limit },
    preview,
  };
}

export async function updateFile({
  github,
  repo,
  path,
  content,
  commitMessage,
  commit_message,
  branch,
  expectedSha,
  expected_sha,
  dryRun,
  dry_run,
} = {}) {
  const target = resolveGithubTarget({ github, repo, branch });
  const resolvedPath = normalizeRepoPath(path, { requireFilePath: true });
  const targetBranch = target.branch;
  const finalContent = String(content ?? "");
  const finalCommitMessage = String(coalesceText(commitMessage, commit_message) || "").trim();
  const effectiveDryRun = coalesceBoolean(dryRun, dry_run, true);
  const size = assertWriteSize(finalContent, resolvedPath);

  if (!finalCommitMessage) {
    throw new Error("commitMessage is required.");
  }

  // Integration #3: Wrap the main write operation with SHA retry logic for 409 conflicts.
  return await withShaRetry(async (attempt) => {
    const existing = await getContentOrNull({
      github,
      repo: target.repo,
      path: resolvedPath,
      ref: targetBranch,
    });

    assertFileContent(existing, resolvedPath);
    const suppliedExpectedSha = coalesceText(expectedSha, expected_sha);
    const shaForUpdate = attempt > 0
      ? existing.sha
      : resolveExpectedSha(
          suppliedExpectedSha,
          existing,
          resolvedPath
        );

    const oldContent = await existingTextForWrite({
      github,
      repo: target.repo,
      path: resolvedPath,
      ref: targetBranch,
      existing,
    });

    const preview = stableFullPreview({
      oldText: oldContent,
      newText: finalContent,
      path: resolvedPath,
    });

    if (!preview.changed) {
      return {
        ok: true,
        message: "No update needed. Content is unchanged.",
        repo: `${target.owner}/${target.repo}`,
        branch: targetBranch,
        path: resolvedPath,
        sha: existing.sha,
        file_url: existing.html_url,
        preview,
      };
    }

    if (effectiveDryRun) {
      return {
        ok: true,
        dry_run: true,
        action: "would_update",
        repo: `${target.owner}/${target.repo}`,
        branch: targetBranch,
        path: resolvedPath,
        current_sha: existing.sha,
        commit_message: finalCommitMessage,
        limits: { max_write_bytes: size.limit },
        preview,
      };
    }

    const response = await github.octokit.rest.repos.createOrUpdateFileContents({
      owner: target.owner,
      repo: target.repo,
      path: resolvedPath,
      message: finalCommitMessage,
      content: encodeContent(finalContent),
      sha: shaForUpdate,
      branch: targetBranch,
    });

    return {
      ok: true,
      message: "File updated.",
      action: "update",
      repo: `${target.owner}/${target.repo}`,
      branch: targetBranch,
      path: resolvedPath,
      previous_sha: existing.sha,
      new_sha: response.data.content?.sha || null,
      commit_url: response.data.commit?.html_url || null,
      file_url: response.data.content?.html_url || null,
      limits: { max_write_bytes: size.limit },
      preview,
    };
  }, 3, { expectedSha: coalesceText(expectedSha, expected_sha) });
}

function countOccurrences(text, find) {
  if (!find) return 0;
  return String(text).split(String(find)).length - 1;
}

// Integration #4: Escape regex special characters in the needle for safe use in replace.
function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Integration #3: Retry wrapper for GitHub write operations that may fail with 409 (SHA mismatch).
 * Retries up to 3 times by re-fetching the latest SHA and retrying the operation.
 */
async function withShaRetry(operation, maxRetries = 3, options = {}) {
  let lastError = null;
  const expectedShaWasProvided = Boolean(String(options.expectedSha || "").trim());
  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      const status = error?.status || error?.response?.status;
      const is409 = status === 409 || /409|conflict|sha.*mismatch/i.test(String(error?.message || ""));
      if (!is409 || attempt === maxRetries - 1) throw error;
      if (expectedShaWasProvided) {
        throw new Error("Refusing automatic retry because expected_sha was supplied and the remote file changed. Re-read the file, inspect the current content, then retry with the new SHA.");
      }
      // Wait a short delay before retrying when the caller did not request SHA pinning.
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
  throw lastError;
}

function applyTextPatch(source, patch, index) {
  const find = String(patch?.find ?? "");
  const replace = String(patch?.replace ?? "");
  const occurrence = patch?.occurrence || "first";
  const expectedMatches = patch?.expected_matches ?? patch?.expectedMatches;

  if (!find) {
    throw new Error(`Patch ${index + 1}: find text is required.`);
  }

  if (!["first", "all"].includes(occurrence)) {
    throw new Error(`Patch ${index + 1}: occurrence must be "first" or "all".`);
  }

  const matches = countOccurrences(source, find);

  if (matches === 0) {
    throw new Error(`Patch ${index + 1}: find text was not found.`);
  }

  if (expectedMatches != null && Number(expectedMatches) !== matches) {
    throw new Error(`Patch ${index + 1}: expected ${expectedMatches} match(es), found ${matches}.`);
  }

  // Integration #4: String.split/join is literal-safe (no regex interpretation).
  // The escapeRegExp utility is available if regex-based replacement is ever needed.
  const nextText = occurrence === "all"
    ? source.split(find).join(replace)
    : source.replace(find, replace);

  return {
    nextText,
    metadata: {
      index: index + 1,
      occurrence,
      matches,
      applied_matches: occurrence === "all" ? matches : 1,
    },
  };
}

export async function replaceManyInFile({
  github,
  repo,
  path,
  replacements,
  commitMessage,
  commit_message,
  branch,
  expectedSha,
  expected_sha,
  dryRun,
  dry_run,
} = {}) {
  const target = resolveGithubTarget({ github, repo, branch });
  const resolvedPath = normalizeRepoPath(path, { requireFilePath: true });
  const targetBranch = target.branch;
  const finalCommitMessage = String(coalesceText(commitMessage, commit_message) || "").trim();
  const effectiveDryRun = coalesceBoolean(dryRun, dry_run, true);
  const maxPatches = replaceManyMaxPatches();

  if (!finalCommitMessage) {
    throw new Error("commitMessage is required.");
  }

  if (!Array.isArray(replacements) || replacements.length === 0) {
    throw new Error("replacements must be a non-empty array.");
  }

  if (replacements.length > maxPatches) {
    throw new Error(`Too many replacements. Count: ${replacements.length}. Limit: ${maxPatches}.`);
  }

  // Integration #3: Wrap the main write operation with SHA retry logic for 409 conflicts.
  return await withShaRetry(async (attempt) => {
    const existing = await getContentOrNull({
      github,
      repo: target.repo,
      path: resolvedPath,
      ref: targetBranch,
    });

    assertFileContent(existing, resolvedPath);
    const shaForUpdate = attempt > 0
      ? existing.sha
      : resolveExpectedSha(
          coalesceText(expectedSha, expected_sha),
          existing,
          resolvedPath
        );

    const oldContent = await existingTextForWrite({
      github,
      repo: target.repo,
      path: resolvedPath,
      ref: targetBranch,
      existing,
    });

    let nextText = oldContent;
    const applied = [];

    for (let index = 0; index < replacements.length; index += 1) {
      const result = applyTextPatch(nextText, replacements[index], index);
      nextText = result.nextText;
      applied.push(result.metadata);
    }

    const size = assertWriteSize(nextText, resolvedPath);
    const preview = stableFullPreview({
      oldText: oldContent,
      newText: nextText,
      path: resolvedPath,
    });

    if (!preview.changed) {
      return {
        ok: true,
        message: "No update needed. Content is unchanged.",
        repo: `${target.owner}/${target.repo}`,
        branch: targetBranch,
        path: resolvedPath,
        sha: existing.sha,
        file_url: existing.html_url,
        applied,
        preview,
      };
    }

    if (effectiveDryRun) {
      return {
        ok: true,
        dry_run: true,
        action: "would_replace_many",
        repo: `${target.owner}/${target.repo}`,
        branch: targetBranch,
        path: resolvedPath,
        current_sha: existing.sha,
        commit_message: finalCommitMessage,
        applied,
        limits: {
          max_write_bytes: size.limit,
          max_patches: maxPatches,
        },
        preview,
      };
    }

    const response = await github.octokit.rest.repos.createOrUpdateFileContents({
      owner: target.owner,
      repo: target.repo,
      path: resolvedPath,
      message: finalCommitMessage,
      content: encodeContent(nextText),
      sha: shaForUpdate,
      branch: targetBranch,
    });

    return {
      ok: true,
      message: "Multiple text replacements applied.",
      action: "replace_many",
      repo: `${target.owner}/${target.repo}`,
      branch: targetBranch,
      path: resolvedPath,
      previous_sha: existing.sha,
      new_sha: response.data.content?.sha || null,
      commit_url: response.data.commit?.html_url || null,
      file_url: response.data.content?.html_url || null,
      applied,
      limits: {
        max_write_bytes: size.limit,
        max_patches: maxPatches,
      },
      preview,
    };
  }, 3, { expectedSha: coalesceText(expectedSha, expected_sha) });
}

export async function replaceTextInFile({
  github,
  repo,
  path,
  find,
  replace,
  commitMessage,
  commit_message,
  branch,
  expectedSha,
  expected_sha,
  occurrence = "first",
  expectedMatches,
  expected_matches,
  dryRun,
  dry_run,
} = {}) {
  const target = resolveGithubTarget({ github, repo, branch });
  const resolvedPath = normalizeRepoPath(path, { requireFilePath: true });
  const targetBranch = target.branch;
  // Integration #4: Escape regex special characters in the needle for safe literal replacement.
  const needle = String(find ?? "");
  const replacement = String(replace ?? "");
  const finalCommitMessage = String(coalesceText(commitMessage, commit_message) || "").trim();
  const effectiveDryRun = coalesceBoolean(dryRun, dry_run, true);
  const effectiveExpectedMatches = expectedMatches ?? expected_matches;

  if (!finalCommitMessage) {
    throw new Error("commitMessage is required.");
  }

  if (!needle) {
    throw new Error("find text is required.");
  }

  if (!["first", "all"].includes(occurrence)) {
    throw new Error('occurrence must be "first" or "all".');
  }

  // Integration #3: Wrap the main write operation with SHA retry logic for 409 conflicts.
  return await withShaRetry(async (attempt) => {
    const existing = await getContentOrNull({
      github,
      repo: target.repo,
      path: resolvedPath,
      ref: targetBranch,
    });

    assertFileContent(existing, resolvedPath);
    const suppliedExpectedSha = coalesceText(expectedSha, expected_sha);
    const shaForUpdate = attempt > 0
      ? existing.sha
      : resolveExpectedSha(
          suppliedExpectedSha,
          existing,
          resolvedPath
        );

    const oldContent = await existingTextForWrite({
      github,
      repo: target.repo,
      path: resolvedPath,
      ref: targetBranch,
      existing,
    });

    const matches = countOccurrences(oldContent, needle);

    if (matches === 0) {
      throw new Error("find text was not found.");
    }

    if (effectiveExpectedMatches != null && Number(effectiveExpectedMatches) !== matches) {
      throw new Error(`Expected ${effectiveExpectedMatches} match(es), found ${matches}.`);
    }

    // Integration #4: Use escaped needle for safe replacement (String.replace treats first arg as literal string,
    // but String.split + join is already safe. We keep the existing split/join approach which is literal-safe.)
    const nextText = occurrence === "all"
      ? oldContent.split(needle).join(replacement)
      : oldContent.replace(needle, replacement);

    const size = assertWriteSize(nextText, resolvedPath);
    const preview = stableFullPreview({
      oldText: oldContent,
      newText: nextText,
      path: resolvedPath,
      extra: {
        occurrence,
        matches,
        applied_matches: occurrence === "all" ? matches : 1,
      },
    });

    if (!preview.changed) {
      return {
        ok: true,
        message: "No update needed. Content is unchanged.",
        repo: `${target.owner}/${target.repo}`,
        branch: targetBranch,
        path: resolvedPath,
        sha: existing.sha,
        file_url: existing.html_url,
        preview,
      };
    }

    if (effectiveDryRun) {
      return {
        ok: true,
        dry_run: true,
        action: "would_replace_text",
        repo: `${target.owner}/${target.repo}`,
        branch: targetBranch,
        path: resolvedPath,
        current_sha: existing.sha,
        commit_message: finalCommitMessage,
        limits: {
          max_write_bytes: size.limit,
        },
        preview,
      };
    }

    const response = await github.octokit.rest.repos.createOrUpdateFileContents({
      owner: target.owner,
      repo: target.repo,
      path: resolvedPath,
      message: finalCommitMessage,
      content: encodeContent(nextText),
      sha: shaForUpdate,
      branch: targetBranch,
    });

    return {
      ok: true,
      message: "Text replacement applied.",
      action: "replace_text",
      repo: `${target.owner}/${target.repo}`,
      branch: targetBranch,
      path: resolvedPath,
      previous_sha: existing.sha,
      new_sha: response.data.content?.sha || null,
      commit_url: response.data.commit?.html_url || null,
      file_url: response.data.content?.html_url || null,
      limits: {
        max_write_bytes: size.limit,
      },
      preview,
    };
  }, 3, { expectedSha: coalesceText(expectedSha, expected_sha) });
}

export async function restoreFileFromRef({
  github,
  repo,
  path,
  sourceRef,
  source_ref,
  commitMessage,
  commit_message,
  branch,
  expectedSha,
  expected_sha,
  dryRun,
  dry_run,
} = {}) {
  const target = resolveGithubTarget({ github, repo, branch });
  const resolvedPath = normalizeRepoPath(path, { requireFilePath: true });
  const targetBranch = target.branch;
  const source = String(coalesceText(sourceRef, source_ref) || "").trim();
  const finalCommitMessage = String(coalesceText(commitMessage, commit_message) || "").trim();
  const effectiveDryRun = coalesceBoolean(dryRun, dry_run, true);

  if (!finalCommitMessage) {
    throw new Error("commitMessage is required.");
  }

  if (!source) {
    throw new Error("sourceRef is required.");
  }

  const existing = await getContentOrNull({
    github,
    repo: target.repo,
    path: resolvedPath,
    ref: targetBranch,
  });

  assertFileContent(existing, resolvedPath);
  const shaForUpdate = resolveExpectedSha(
    coalesceText(expectedSha, expected_sha),
    existing,
    resolvedPath
  );

  const sourceBuffer = await getRawFileBuffer({
    github,
    repo: target.repo,
    path: resolvedPath,
    ref: source,
  });

  const oldContent = await existingTextForWrite({
    github,
    repo: target.repo,
    path: resolvedPath,
    ref: targetBranch,
    existing,
  });

  const restoredContent = sourceBuffer.toString("utf8");
  const size = assertWriteSize(restoredContent, resolvedPath);
  const preview = stableFullPreview({
    oldText: oldContent,
    newText: restoredContent,
    path: resolvedPath,
    extra: {
      source_ref: source,
    },
  });

  if (!preview.changed) {
    return {
      ok: true,
      message: "No restore needed. Target already matches source ref.",
      repo: `${target.owner}/${target.repo}`,
      branch: targetBranch,
      path: resolvedPath,
      sha: existing.sha,
      source_ref: source,
      file_url: existing.html_url,
      preview,
    };
  }

  if (effectiveDryRun) {
    return {
      ok: true,
      dry_run: true,
      action: "would_restore_file_from_ref",
      repo: `${target.owner}/${target.repo}`,
      branch: targetBranch,
      path: resolvedPath,
      source_ref: source,
      current_sha: existing.sha,
      commit_message: finalCommitMessage,
      limits: {
        max_write_bytes: size.limit,
      },
      preview,
    };
  }

  const response = await github.octokit.rest.repos.createOrUpdateFileContents({
    owner: target.owner,
    repo: target.repo,
    path: resolvedPath,
    message: finalCommitMessage,
    content: encodeContent(restoredContent),
    sha: shaForUpdate,
    branch: targetBranch,
  });

  return {
    ok: true,
    message: "File restored from source ref.",
    action: "restore_file_from_ref",
    repo: `${target.owner}/${target.repo}`,
    branch: targetBranch,
    path: resolvedPath,
    source_ref: source,
    previous_sha: existing.sha,
    new_sha: response.data.content?.sha || null,
    commit_url: response.data.commit?.html_url || null,
    file_url: response.data.content?.html_url || null,
    limits: {
      max_write_bytes: size.limit,
    },
    preview,
  };
}
