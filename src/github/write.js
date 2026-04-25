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
