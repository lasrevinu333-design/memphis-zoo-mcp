import {
  assertFileContent,
  decodeContent,
  encodeContent,
  getContentOrNull,
  normalizeRepoPath,
  resolveGithubTarget,
} from "./client.js";
import { previewFullReplacement, previewTextReplacement } from "./patch.js";

export async function writeFile({
  github,
  repo,
  path,
  content,
  commitMessage,
  branch,
  overwrite = false,
  dryRun = true,
} = {}) {
  const target = resolveGithubTarget({ github, repo, branch });
  const resolvedPath = normalizeRepoPath(path, { requireFilePath: true });
  const targetBranch = target.branch;
  const finalContent = String(content ?? "");

  if (!commitMessage) throw new Error("commitMessage is required.");

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

  const oldContent = existing?.content ? decodeContent(existing.content).toString("utf8") : "";
  const preview = previewFullReplacement({
    oldText: oldContent,
    newText: finalContent,
    path: resolvedPath,
  });

  if (dryRun) {
    return {
      ok: true,
      dry_run: true,
      action: existing ? "would_overwrite" : "would_create",
      repo: `${target.owner}/${target.repo}`,
      branch: targetBranch,
      path: resolvedPath,
      previous_sha: existing?.sha || null,
      new_content_bytes: Buffer.byteLength(finalContent, "utf8"),
      commit_message: commitMessage,
      preview,
    };
  }

  const request = {
    owner: target.owner,
    repo: target.repo,
    path: resolvedPath,
    message: commitMessage,
    content: encodeContent(finalContent),
    branch: targetBranch,
  };

  if (existing?.sha) request.sha = existing.sha;

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
    preview,
  };
}

export async function updateFile({
  github,
  repo,
  path,
  content,
  commitMessage,
  branch,
  expectedSha,
  dryRun = true,
} = {}) {
  const target = resolveGithubTarget({ github, repo, branch });
  const resolvedPath = normalizeRepoPath(path, { requireFilePath: true });
  const targetBranch = target.branch;
  const finalContent = String(content ?? "");

  if (!commitMessage) throw new Error("commitMessage is required.");
  if (!expectedSha) throw new Error("expectedSha is required for updateFile.");

  const existing = await getContentOrNull({
    github,
    repo: target.repo,
    path: resolvedPath,
    ref: targetBranch,
  });

  assertFileContent(existing, resolvedPath);

  if (existing.sha !== expectedSha) {
    throw new Error(
      [
        "Refusing to update because expectedSha does not match current file SHA.",
        `Path: ${resolvedPath}`,
        `Expected: ${expectedSha}`,
        `Current:  ${existing.sha}`,
      ].join("\n")
    );
  }

  const oldContent = decodeContent(existing.content).toString("utf8");
  const preview = previewFullReplacement({
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

  if (dryRun) {
    return {
      ok: true,
      dry_run: true,
      action: "would_update",
      repo: `${target.owner}/${target.repo}`,
      branch: targetBranch,
      path: resolvedPath,
      current_sha: existing.sha,
      commit_message: commitMessage,
      preview,
    };
  }

  const response = await github.octokit.rest.repos.createOrUpdateFileContents({
    owner: target.owner,
    repo: target.repo,
    path: resolvedPath,
    message: commitMessage,
    content: encodeContent(finalContent),
    sha: existing.sha,
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
    preview,
  };
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
  if (!["first", "all"].includes(occurrence)) {
    throw new Error(`Patch ${index + 1}: occurrence must be "first" or "all".`);
  }

  const matches = countOccurrences(source, find);
  if (matches === 0) throw new Error(`Patch ${index + 1}: find text was not found.`);
  if (expectedMatches != null && Number(expectedMatches) !== matches) {
    throw new Error(`Patch ${index + 1}: expected ${expectedMatches} match(es), found ${matches}.`);
  }

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
  branch,
  expectedSha,
  dryRun = true,
} = {}) {
  const target = resolveGithubTarget({ github, repo, branch });
  const resolvedPath = normalizeRepoPath(path, { requireFilePath: true });
  const targetBranch = target.branch;

  if (!commitMessage) throw new Error("commitMessage is required.");
  if (!expectedSha) throw new Error("expectedSha is required for replaceManyInFile.");
  if (!Array.isArray(replacements) || replacements.length === 0) {
    throw new Error("replacements must be a non-empty array.");
  }

  const existing = await getContentOrNull({
    github,
    repo: target.repo,
    path: resolvedPath,
    ref: targetBranch,
  });

  assertFileContent(existing, resolvedPath);

  if (existing.sha !== expectedSha) {
    throw new Error(`SHA mismatch for ${resolvedPath}. Expected ${expectedSha}, current ${existing.sha}.`);
  }

  const oldContent = decodeContent(existing.content).toString("utf8");
  let nextText = oldContent;
  const applied = [];

  for (let index = 0; index < replacements.length; index += 1) {
    const result = applyTextPatch(nextText, replacements[index], index);
    nextText = result.nextText;
    applied.push(result.metadata);
  }

  const preview = previewFullReplacement({
    oldText: oldContent,
    newText: nextText,
    path: resolvedPath,
  });

  const responsePreview = { ...preview, newText: undefined };

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
      preview: responsePreview,
    };
  }

  if (dryRun) {
    return {
      ok: true,
      dry_run: true,
      action: "would_replace_many",
      repo: `${target.owner}/${target.repo}`,
      branch: targetBranch,
      path: resolvedPath,
      current_sha: existing.sha,
      commit_message: commitMessage,
      applied,
      preview: responsePreview,
    };
  }

  const response = await github.octokit.rest.repos.createOrUpdateFileContents({
    owner: target.owner,
    repo: target.repo,
    path: resolvedPath,
    message: commitMessage,
    content: encodeContent(nextText),
    sha: existing.sha,
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
    preview: responsePreview,
  };
}

export async function replaceTextInFile({
  github,
  repo,
  path,
  find,
  replace,
  commitMessage,
  branch,
  expectedSha,
  occurrence = "first",
  expectedMatches,
  dryRun = true,
} = {}) {
  const target = resolveGithubTarget({ github, repo, branch });
  const resolvedPath = normalizeRepoPath(path, { requireFilePath: true });
  const targetBranch = target.branch;

  if (!commitMessage) throw new Error("commitMessage is required.");
  if (!expectedSha) throw new Error("expectedSha is required for replaceTextInFile.");

  const existing = await getContentOrNull({
    github,
    repo: target.repo,
    path: resolvedPath,
    ref: targetBranch,
  });

  assertFileContent(existing, resolvedPath);

  if (existing.sha !== expectedSha) {
    throw new Error(`SHA mismatch for ${resolvedPath}. Expected ${expectedSha}, current ${existing.sha}.`);
  }

  const oldContent = decodeContent(existing.content).toString("utf8");
  const preview = previewTextReplacement({
    oldText: oldContent,
    find,
    replace,
    path: resolvedPath,
    occurrence,
    expectedMatches,
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

  if (dryRun) {
    return {
      ok: true,
      dry_run: true,
      action: "would_replace_text",
      repo: `${target.owner}/${target.repo}`,
      branch: targetBranch,
      path: resolvedPath,
      current_sha: existing.sha,
      commit_message: commitMessage,
      preview: { ...preview, newText: undefined },
    };
  }

  const response = await github.octokit.rest.repos.createOrUpdateFileContents({
    owner: target.owner,
    repo: target.repo,
    path: resolvedPath,
    message: commitMessage,
    content: encodeContent(preview.newText),
    sha: existing.sha,
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
    preview: { ...preview, newText: undefined },
  };
}
