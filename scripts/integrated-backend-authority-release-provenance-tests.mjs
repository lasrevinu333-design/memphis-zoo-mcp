#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const checker = "scripts/integrated-backend-authority-cutover-check.mjs";
const evidencePath = "release/integrated-backend-authority-evidence.json";
const omittedMigration = "supabase/migrations/20260810120000_retire_named_manager_shared_room_authority.sql";
const omittedGate = "scripts/integrated-backend-authority-suite-order-tests.mjs";

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function gitBytes(cwd, args) {
  return execFileSync("git", args, { cwd, maxBuffer: 64 * 1024 * 1024 });
}

function cleanEnvironment(extra = {}) {
  const env = { ...process.env, ...extra };
  for (const name of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES"]) {
    if (!Object.hasOwn(extra, name)) delete env[name];
  }
  return env;
}

function copyCompleteTrackedWorktree(destination) {
  const paths = gitBytes(root, ["ls-files", "-z"]).toString("utf8").split("\0").filter(Boolean);
  assert.ok(paths.length > 0, "source fixture must contain tracked paths");
  for (const path of paths) {
    const source = resolve(root, path);
    const target = resolve(destination, path);
    const entry = lstatSync(source);
    mkdirSync(dirname(target), { recursive: true });
    if (entry.isSymbolicLink()) {
      symlinkSync(readlinkSync(source), target);
    } else {
      assert.equal(entry.isFile(), true, `tracked fixture source must be a file or symlink: ${path}`);
      copyFileSync(source, target);
      chmodSync(target, entry.mode & 0o777);
    }
  }
  return paths;
}

function createFixture({ beforeCommit = null } = {}) {
  const fixture = mkdtempSync(join(tmpdir(), "integrated-backend-release-provenance-"));
  const acceptanceDirectory = mkdtempSync(join(tmpdir(), "integrated-backend-release-acceptance-"));
  try {
    const trackedPaths = copyCompleteTrackedWorktree(fixture);
    if (beforeCommit) beforeCommit(fixture);
    git(fixture, ["init", "-q"]);
    git(fixture, ["add", "."]);
    git(fixture, ["-c", "user.name=Release Provenance Test", "-c", "user.email=release-provenance@example.invalid", "commit", "-qm", "fixture"]);
    const commit = git(fixture, ["rev-parse", "HEAD"]);
    const tree = git(fixture, ["rev-parse", "HEAD^{tree}"]);
    const acceptancePath = join(acceptanceDirectory, "acceptance.json");
    const writeAcceptance = ({ expectedCommit = commit, expectedTree = tree, document = null } = {}) => {
      chmodSync(acceptanceDirectory, 0o755);
      try { chmodSync(acceptancePath, 0o644); } catch { /* first write */ }
      writeFileSync(acceptancePath, `${JSON.stringify(document || {
        artifact: "integrated-backend-authority-release-acceptance.v1",
        expected_commit: expectedCommit,
        expected_tree: expectedTree,
      }, null, 2)}\n`);
      chmodSync(acceptancePath, 0o444);
      return acceptancePath;
    };
    return { fixture, acceptanceDirectory, acceptancePath, trackedPaths, commit, tree, writeAcceptance };
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

function runGate(fixture, { cwd = fixture.fixture, env = {}, database = false, acceptancePath = fixture.acceptancePath } = {}) {
  const args = [resolve(fixture.fixture, checker), "--acceptance-input", acceptancePath];
  if (database) args.push("--database");
  return spawnSync(process.execPath, args, {
    cwd,
    env: cleanEnvironment(env),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
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

function expectCommittedRejected(name, beforeCommit, expected) {
  const fixture = createFixture({ beforeCommit });
  try {
    fixture.writeAcceptance();
    const result = runGate(fixture, { database: true });
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
  assert.equal(payload.source_identity.tracked_path_count, positive.trackedPaths.length);
  assert.equal(payload.source_identity.authority_path_count, positive.trackedPaths.length - 1);
  assert.equal(payload.source_identity.migration_path_count, 70);
  assert.equal(payload.source_identity.generated_evidence_excluded_from_content_identity, evidencePath);
} finally {
  disposeFixture(positive);
}

expectRejected("modified tracked runtime bytes", (fixture) => {
  const path = resolve(fixture.fixture, "src/index.js");
  writeFileSync(path, `${readFileSync(path, "utf8")}\n// disposable tracked mutation\n`);
}, /staged, unstaged, tracked, or untracked content is forbidden/i);

expectRejected("staged tracked runtime bytes", (fixture) => {
  const path = resolve(fixture.fixture, "src/index.js");
  writeFileSync(path, `${readFileSync(path, "utf8")}\n// disposable staged mutation\n`);
  git(fixture.fixture, ["add", "src/index.js"]);
}, /staged, unstaged, tracked, or untracked content is forbidden/i);

expectRejected("untracked bytes", (fixture) => {
  writeFileSync(resolve(fixture.fixture, "release/authority-untracked-substitution.json"), "{\"substitutedAuthority\":true}\n");
}, /staged, unstaged, tracked, or untracked content is forbidden/i);

for (const [flag, message] of [["--assume-unchanged", /assume-unchanged index flag is forbidden/i], ["--skip-worktree", /skip-worktree index flag is forbidden/i]]) {
  expectRejected(`${flag} hidden omitted migration bytes`, (fixture) => {
    const path = resolve(fixture.fixture, omittedMigration);
    git(fixture.fixture, ["update-index", flag, omittedMigration]);
    writeFileSync(path, `${readFileSync(path, "utf8")}\n-- hidden omitted migration mutation\n`);
  }, message);

  expectRejected(`${flag} hidden omitted suite-order gate bytes`, (fixture) => {
    const path = resolve(fixture.fixture, omittedGate);
    git(fixture.fixture, ["update-index", flag, omittedGate]);
    writeFileSync(path, `${readFileSync(path, "utf8")}\n// hidden omitted suite-order gate mutation\n`);
  }, message);
}

expectRejected("assume-unchanged hidden arbitrary tracked bytes", (fixture) => {
  const path = resolve(fixture.fixture, "README.md");
  git(fixture.fixture, ["update-index", "--assume-unchanged", "README.md"]);
  writeFileSync(path, `${readFileSync(path, "utf8")}\nhidden arbitrary tracked mutation\n`);
}, /assume-unchanged index flag is forbidden: README\.md/i);

expectRejected("skip-worktree hidden index flag without byte mutation", (fixture) => {
  git(fixture.fixture, ["update-index", "--skip-worktree", "README.md"]);
}, /skip-worktree index flag is forbidden: README\.md/i);

expectRejected("missing tracked file", (fixture) => {
  unlinkSync(resolve(fixture.fixture, "src/offline-authority-http.js"));
}, /staged, unstaged, tracked, or untracked content is forbidden/i);

expectRejected("tracked mode change", (fixture) => {
  chmodSync(resolve(fixture.fixture, "README.md"), 0o755);
}, /staged, unstaged, tracked, or untracked content is forbidden/i);

expectRejected("worktree symlink replacement", (fixture) => {
  const path = resolve(fixture.fixture, "src/index.js");
  unlinkSync(path);
  symlinkSync("offline-authority-http.js", path);
}, /staged, unstaged, tracked, or untracked content is forbidden/i);

expectCommittedRejected("stale generated complete inventory", (fixture) => {
  const path = resolve(fixture, evidencePath);
  const stale = JSON.parse(readFileSync(path, "utf8"));
  stale.authority_content_identity.expected_tree_inventory = stale.authority_content_identity.expected_tree_inventory.slice(0, 1);
  stale.authority_content_identity.authority_path_count = 1;
  writeFileSync(path, `${JSON.stringify(stale, null, 2)}\n`);
}, /generated release evidence is stale, incomplete, or self-referential/i);

expectRejected("wrong expected commit", (fixture) => {
  fixture.writeAcceptance({ expectedCommit: "0000000000000000000000000000000000000000" });
}, /expected commit is unavailable or not exact/i);

expectRejected("wrong expected tree", (fixture) => {
  fixture.writeAcceptance({ expectedTree: "0000000000000000000000000000000000000000" });
}, /expected commit does not resolve to expected tree/i);

for (const [name, value] of [
  ["GIT_DIR", join(tmpdir(), "alternate-git-dir")],
  ["GIT_WORK_TREE", tmpdir()],
  ["GIT_INDEX_FILE", join(tmpdir(), "alternate-index")],
  ["GIT_OBJECT_DIRECTORY", join(tmpdir(), "alternate-objects")],
  ["GIT_ALTERNATE_OBJECT_DIRECTORIES", join(tmpdir(), "alternate-object-directory")],
]) {
  expectRejected(`alternate ${name}`, () => ({ env: { [name]: value } }), new RegExp(`${name} is forbidden`));
}

expectRejected("wrong process worktree", (fixture) => ({ cwd: fixture.acceptanceDirectory }), /cutover checker must run from its own repository root/i);

expectRejected("mutable external acceptance input", (fixture) => {
  chmodSync(fixture.acceptancePath, 0o644);
}, /acceptance input must be sealed mode 0444/i);

expectRejected("structurally inexact external acceptance input", (fixture) => {
  fixture.writeAcceptance({ document: {
    artifact: "integrated-backend-authority-release-acceptance.v1",
    expected_commit: fixture.commit,
    expected_tree: fixture.tree,
    authority_paths: [],
  } });
}, /Expected values to be strictly deep-equal/i);

expectRejected("acceptance input inside worktree", (fixture) => {
  const path = resolve(fixture.fixture, "sealed-acceptance.json");
  writeFileSync(path, `${JSON.stringify({
    artifact: "integrated-backend-authority-release-acceptance.v1",
    expected_commit: fixture.commit,
    expected_tree: fixture.tree,
  }, null, 2)}\n`);
  chmodSync(path, 0o444);
  return { acceptancePath: path };
}, /acceptance input must remain outside the checked worktree/i);

expectRejected("symlink external acceptance input", (fixture) => {
  const path = join(fixture.acceptanceDirectory, "acceptance-link.json");
  symlinkSync("acceptance.json", path);
  return { acceptancePath: path };
}, /acceptance input must not be a symlink/i);

const symlinkTreeFixture = createFixture({
  beforeCommit(fixture) {
    const path = resolve(fixture, "src/index.js");
    const substitute = resolve(fixture, "src/index-substitute.js");
    copyFileSync(path, substitute);
    unlinkSync(path);
    symlinkSync("index-substitute.js", path);
  },
});
try {
  symlinkTreeFixture.writeAcceptance();
  const result = runGate(symlinkTreeFixture, { database: true });
  assert.notEqual(result.status, 0, "expected-tree symlink substitution unexpectedly passed release acceptance");
  const output = `${result.stderr}\n${result.stdout}`;
  assert.match(output, /expected tracked entry must be a regular non-symlink file/i);
  assert.doesNotMatch(output, /database gate requires|configured secret must pass|docker/i);
} finally {
  disposeFixture(symlinkTreeFixture);
}

console.log("INTEGRATED_BACKEND_AUTHORITY_RELEASE_PROVENANCE_PASS");
