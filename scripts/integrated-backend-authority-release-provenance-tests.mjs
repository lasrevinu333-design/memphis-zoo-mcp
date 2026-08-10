#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const checker = "scripts/integrated-backend-authority-cutover-check.mjs";
const evidencePath = "release/integrated-backend-authority-evidence.json";
const releaseInput = JSON.parse(readFileSync(resolve(root, "release/integrated-backend-authority-input.json"), "utf8"));
const authorityPaths = releaseInput.cutover.source_identity.authority_content_paths;

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function cleanEnvironment(extra = {}) {
  const env = { ...process.env, ...extra };
  for (const name of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES"]) {
    if (!Object.hasOwn(extra, name)) delete env[name];
  }
  return env;
}

function createFixture({ beforeCommit = null } = {}) {
  const fixture = mkdtempSync(join(tmpdir(), "integrated-backend-release-provenance-"));
  const acceptanceDirectory = mkdtempSync(join(tmpdir(), "integrated-backend-release-acceptance-"));
  try {
    for (const path of [...authorityPaths, evidencePath]) {
      const destination = resolve(fixture, path);
      mkdirSync(dirname(destination), { recursive: true });
      copyFileSync(resolve(root, path), destination);
    }
    if (beforeCommit) beforeCommit(fixture);
    git(fixture, ["init", "-q"]);
    git(fixture, ["add", "."]);
    git(fixture, ["-c", "user.name=Release Provenance Test", "-c", "user.email=release-provenance@example.invalid", "commit", "-qm", "fixture"]);
    const commit = git(fixture, ["rev-parse", "HEAD"]);
    const tree = git(fixture, ["rev-parse", "HEAD^{tree}"]);
    const acceptancePath = join(acceptanceDirectory, "acceptance.json");
    const writeAcceptance = ({ expectedCommit = commit, expectedTree = tree } = {}) => {
      chmodSync(acceptanceDirectory, 0o755);
      try { chmodSync(acceptancePath, 0o644); } catch { /* first write */ }
      writeFileSync(acceptancePath, `${JSON.stringify({
        artifact: "integrated-backend-authority-release-acceptance.v1",
        expected_commit: expectedCommit,
        expected_tree: expectedTree,
        authority_paths: authorityPaths,
      }, null, 2)}\n`);
      chmodSync(acceptancePath, 0o444);
      return acceptancePath;
    };
    return { fixture, acceptanceDirectory, acceptancePath, commit, tree, writeAcceptance };
  } catch (error) {
    rmSync(fixture, { recursive: true, force: true });
    rmSync(acceptanceDirectory, { recursive: true, force: true });
    throw error;
  }
}

function disposeFixture(fixture) {
  rmSync(fixture.fixture, { recursive: true, force: true });
  rmSync(fixture.acceptanceDirectory, { recursive: true, force: true });
}

function runGate(fixture, { cwd = fixture.fixture, env = {}, database = false } = {}) {
  const args = [resolve(fixture.fixture, checker), "--acceptance-input", fixture.acceptancePath];
  if (database) args.push("--database");
  return spawnSync(process.execPath, args, {
    cwd,
    env: cleanEnvironment(env),
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
}

function expectRejected(name, mutate, expected) {
  const fixture = createFixture();
  try {
    fixture.writeAcceptance();
    const options = mutate(fixture) || {};
    const result = runGate(fixture, { database: true, ...options });
    assert.notEqual(result.status, 0, `${name} unexpectedly passed release acceptance`);
    const output = `${result.stderr}\n${result.stdout}`;
    assert.match(output, expected, `${name} did not fail for the expected provenance reason: ${output}`);
    assert.doesNotMatch(output, /database gate requires|configured secret must pass|docker/i, `${name} reached a database gate before provenance rejection`);
    return output;
  } finally {
    disposeFixture(fixture);
  }
}

const positive = createFixture();
try {
  positive.writeAcceptance();
  const result = runGate(positive);
  assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.source_identity.commit, positive.commit);
  assert.equal(payload.source_identity.tree, positive.tree);
  assert.equal(payload.source_identity.authority_path_count, authorityPaths.length);
  assert.equal(payload.source_identity.generated_evidence_excluded_from_content_identity, evidencePath);
} finally {
  disposeFixture(positive);
}

expectRejected("modified src/index.js", (fixture) => {
  const indexPath = resolve(fixture.fixture, "src/index.js");
  writeFileSync(indexPath, `${readFileSync(indexPath, "utf8")}\n// disposable auditor mutation\n`);
}, /staged, unstaged, tracked, or untracked content is forbidden/i);

expectRejected("staged authority path", (fixture) => {
  const indexPath = resolve(fixture.fixture, "src/index.js");
  writeFileSync(indexPath, `${readFileSync(indexPath, "utf8")}\n// disposable staged authority mutation\n`);
  git(fixture.fixture, ["add", "src/index.js"]);
}, /staged, unstaged, tracked, or untracked content is forbidden/i);

expectRejected("worktree versus HEAD authority blob", (fixture) => {
  const indexPath = resolve(fixture.fixture, "src/index.js");
  git(fixture.fixture, ["update-index", "--assume-unchanged", "src/index.js"]);
  writeFileSync(indexPath, `${readFileSync(indexPath, "utf8")}\n// disposable assume-unchanged authority mutation\n`);
}, /worktree bytes differ from expected Git tree blob: src\/index\.js/i);

expectRejected("untracked authority file", (fixture) => {
  writeFileSync(resolve(fixture.fixture, "release/authority-untracked-substitution.json"), "{\"substitutedAuthority\":true}\n");
}, /staged, unstaged, tracked, or untracked content is forbidden/i);

expectRejected("wrong expected tree", (fixture) => {
  fixture.writeAcceptance({ expectedTree: "0000000000000000000000000000000000000000" });
}, /expected commit does not resolve to expected tree/i);

expectRejected("alternate GIT_DIR", () => ({ env: { GIT_DIR: join(tmpdir(), "alternate-git-dir") } }), /GIT_DIR is forbidden/i);
expectRejected("alternate GIT_WORK_TREE", () => ({ env: { GIT_WORK_TREE: tmpdir() } }), /GIT_WORK_TREE is forbidden/i);
expectRejected("alternate GIT_INDEX_FILE", () => ({ env: { GIT_INDEX_FILE: join(tmpdir(), "alternate-index") } }), /GIT_INDEX_FILE is forbidden/i);
expectRejected("wrong process worktree", (fixture) => ({ cwd: fixture.acceptanceDirectory }), /cutover checker must run from its own repository root/i);

const symlinkFixture = createFixture({
  beforeCommit(fixture) {
    const indexPath = resolve(fixture, "src/index.js");
    const substitutePath = resolve(fixture, "src/index-substitute.js");
    copyFileSync(indexPath, substitutePath);
    unlinkSync(indexPath);
    symlinkSync("index-substitute.js", indexPath);
  },
});
try {
  symlinkFixture.writeAcceptance();
  const result = runGate(symlinkFixture, { database: true });
  assert.notEqual(result.status, 0, "symlink authority substitution unexpectedly passed release acceptance");
  const output = `${result.stderr}\n${result.stdout}`;
  assert.match(output, /expected tree authority path must not be a symlink/i);
  assert.doesNotMatch(output, /database gate requires|configured secret must pass|docker/i);
} finally {
  disposeFixture(symlinkFixture);
}

console.log("INTEGRATED_BACKEND_AUTHORITY_RELEASE_PROVENANCE_PASS");
