import { resolveGithubTarget } from "./client.js";

function normalizeBranchName(name) {
  const branch = String(name || "").trim();

  if (!branch) throw new Error("branch name is required.");
  if (branch.startsWith("/") || branch.endsWith("/")) {
    throw new Error("branch name cannot start or end with '/'.");
  }
  if (branch.includes("..")) throw new Error("branch name cannot contain '..'.");
  if (/\s/.test(branch)) throw new Error("branch name cannot contain whitespace.");
  if (!/^[A-Za-z0-9._\/-]+$/.test(branch)) {
    throw new Error("branch name contains unsupported characters.");
  }

  return branch;
}

export async function getBranchSha({ github, repo, branch } = {}) {
  const target = resolveGithubTarget({ github, repo, branch });

  const response = await github.octokit.rest.git.getRef({
    owner: target.owner,
    repo: target.repo,
    ref: `heads/${target.branch}`,
  });

  return {
    ok: true,
    repo: `${target.owner}/${target.repo}`,
    branch: target.branch,
    sha: response.data.object?.sha || null,
    ref: response.data.ref,
    url: response.data.url,
  };
}

export async function createBranch({
  github,
  repo,
  newBranch,
  fromBranch,
  fromSha,
  dryRun = true,
} = {}) {
  const target = resolveGithubTarget({ github, repo, branch: fromBranch });
  const branch = normalizeBranchName(newBranch);

  let baseSha = String(fromSha || "").trim();

  if (!baseSha) {
    const base = await getBranchSha({
      github,
      repo: target.repo,
      branch: target.branch,
    });
    baseSha = base.sha;
  }

  if (!baseSha) throw new Error("Could not resolve base SHA for branch creation.");

  const payload = {
    ok: true,
    dry_run: Boolean(dryRun),
    action: dryRun ? "would_create_branch" : "branch_created",
    repo: `${target.owner}/${target.repo}`,
    from_branch: target.branch,
    from_sha: baseSha,
    new_branch: branch,
  };

  if (dryRun) return payload;

  const response = await github.octokit.rest.git.createRef({
    owner: target.owner,
    repo: target.repo,
    ref: `refs/heads/${branch}`,
    sha: baseSha,
  });

  return {
    ...payload,
    dry_run: false,
    ref: response.data.ref,
    url: response.data.url,
  };
}

export async function openPullRequest({
  github,
  repo,
  title,
  head,
  base,
  body = "",
  draft = false,
  dryRun = true,
} = {}) {
  const target = resolveGithubTarget({ github, repo, branch: base });
  const prTitle = String(title || "").trim();
  const headBranch = normalizeBranchName(head);
  const baseBranch = normalizeBranchName(target.branch);

  if (!prTitle) throw new Error("title is required.");

  const payload = {
    ok: true,
    dry_run: Boolean(dryRun),
    action: dryRun ? "would_open_pull_request" : "pull_request_opened",
    repo: `${target.owner}/${target.repo}`,
    title: prTitle,
    head: headBranch,
    base: baseBranch,
    draft: Boolean(draft),
    body_bytes: Buffer.byteLength(String(body || ""), "utf8"),
  };

  if (dryRun) return payload;

  const response = await github.octokit.rest.pulls.create({
    owner: target.owner,
    repo: target.repo,
    title: prTitle,
    head: headBranch,
    base: baseBranch,
    body: String(body || ""),
    draft: Boolean(draft),
  });

  return {
    ...payload,
    dry_run: false,
    number: response.data.number,
    html_url: response.data.html_url,
    state: response.data.state,
  };
}
