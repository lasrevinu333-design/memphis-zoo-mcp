#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { chmodSync, copyFileSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { releaseAttestationPayload } from "../src/release-contract.js";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const checker = "scripts/integrated-backend-authority-cutover-check.mjs";
const refresher = "scripts/refresh-integrated-backend-authority-release.mjs";
const evidencePath = "release/integrated-backend-authority-evidence.json";
const omittedMigration = "supabase/migrations/20260810120000_retire_named_manager_shared_room_authority.sql";
const omittedGate = "scripts/integrated-backend-authority-suite-order-tests.mjs";
const fixtureRemovalOptions = { recursive: true, force: true, maxRetries: 8, retryDelay: 50 };

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

function createFixture({ beforeCommit = null, skipEvidenceRefresh = false } = {}) {
  const fixture = mkdtempSync(join(tmpdir(), "integrated-backend-release-provenance-"));
  const acceptanceDirectory = mkdtempSync(join(tmpdir(), "integrated-backend-release-acceptance-"));
  try {
    const trackedPaths = copyCompleteTrackedWorktree(fixture);
    const fixtureSchemaPath = join(fixture, "release/schema-alignment-input.json");
    const fixtureFrontendPath = join(fixture, "release/frontend-release-manifest.json");
    const fixtureSchema = JSON.parse(readFileSync(fixtureSchemaPath, "utf8"));
    if (fixtureSchema.frontend_commit_sha === null) {
      const syntheticFrontendCommit = "f".repeat(40);
      fixtureSchema.frontend_commit_sha = syntheticFrontendCommit;
      fixtureSchema.frontend_commit_state = "final_pair_bound";
      writeFileSync(fixtureSchemaPath, `${JSON.stringify(fixtureSchema, null, 2)}\n`);
      const fixtureFrontend = JSON.parse(readFileSync(fixtureFrontendPath, "utf8"));
      fixtureFrontend.frontend_commit_sha = syntheticFrontendCommit;
      fixtureFrontend.frontend_commit_state = "final_pair_bound";
      writeFileSync(fixtureFrontendPath, `${JSON.stringify(fixtureFrontend, null, 2)}\n`);
    }
    if (beforeCommit) beforeCommit(fixture);
    git(fixture, ["init", "-q"]);
    git(fixture, ["add", "."]);
    git(fixture, ["-c", "user.name=Release Provenance Test", "-c", "user.email=release-provenance@example.invalid", "commit", "-qm", "fixture"]);
    if (!skipEvidenceRefresh) {
      const refreshResult = spawnSync(process.execPath, [resolve(fixture, refresher)], {
        cwd: fixture,
        env: cleanEnvironment(),
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
      });
      assert.equal(refreshResult.status, 0, `${refreshResult.stderr}\n${refreshResult.stdout}`);
      git(fixture, ["add", evidencePath]);
      if (git(fixture, ["status", "--short"])) {
        git(fixture, ["-c", "user.name=Release Provenance Test", "-c", "user.email=release-provenance@example.invalid", "commit", "-qm", "refresh evidence"]);
      }
    }
    const commit = git(fixture, ["rev-parse", "HEAD"]);
    const tree = git(fixture, ["rev-parse", "HEAD^{tree}"]);
    const schemaInput = JSON.parse(readFileSync(join(fixture, "release/schema-alignment-input.json"), "utf8"));
    const schemaFingerprint = readFileSync(join(fixture, "supabase/canonical/schema-fingerprint.txt"), "utf8").trim();
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const publicKeyPem = publicKey.export({ type: "spki", format: "pem" });
    const acceptancePath = join(acceptanceDirectory, "acceptance.json");
    const writeAcceptance = ({ expectedCommit = commit, expectedTree = tree, document = null } = {}) => {
      chmodSync(acceptanceDirectory, 0o755);
      try { chmodSync(acceptancePath, 0o644); } catch { /* first write */ }
      let rendered = document;
      if (!rendered) {
        const evidenceBytes = readFileSync(join(fixture, evidencePath));
        const evidenceBlob = git(fixture, ["rev-parse", `HEAD:${evidencePath}`]);
        rendered = {
          artifact: "memphis-zoo-integrated-release-attestation.v2",
          release_id: schemaInput.release_id,
          backend_commit_sha: expectedCommit,
          backend_tree_sha: expectedTree,
          backend_evidence_blob_sha: evidenceBlob,
          backend_evidence_sha256: createHash("sha256").update(evidenceBytes).digest("hex"),
          // The branch can intentionally remain unpaired while Engine work is still
          // open. This fixture supplies a valid synthetic Engine identity so the
          // signed-attestation provenance boundary is tested independently.
          frontend_commit_sha: schemaInput.frontend_commit_sha ?? "f".repeat(40),
          schema_fingerprint: schemaFingerprint,
          signature: { algorithm: "ed25519", key_id: "test-release-key", value_base64: "" },
        };
        rendered.signature.value_base64 = sign(
          null,
          Buffer.from(`${JSON.stringify(releaseAttestationPayload(rendered))}\n`, "utf8"),
          privateKey,
        ).toString("base64");
      }
      writeFileSync(acceptancePath, `${JSON.stringify(rendered, null, 2)}\n`);
      chmodSync(acceptancePath, 0o444);
      return acceptancePath;
    };
    return { fixture, acceptanceDirectory, acceptancePath, trackedPaths, commit, tree, publicKeyPem, writeAcceptance };
  } catch (error) {
    rmSync(fixture, fixtureRemovalOptions);
    rmSync(acceptanceDirectory, fixtureRemovalOptions);
    throw error;
  }
}

function disposeFixture(fixture) {
  // Git updates several directory entries in rapid succession while each
  // provenance fixture is created. Some CI filesystems can briefly report an
  // already-drained directory as non-empty after the child process exits.
  // Node's recursive rm does not retry ENOTEMPTY unless maxRetries is set.
  rmSync(fixture.fixture, fixtureRemovalOptions);
  rmSync(fixture.acceptanceDirectory, fixtureRemovalOptions);
}

function runGate(fixture, { cwd = fixture.fixture, env = {}, database = false, acceptancePath = fixture.acceptancePath } = {}) {
  const args = [resolve(fixture.fixture, checker), "--acceptance-input", acceptancePath];
  if (database) args.push("--database");
  return spawnSync(process.execPath, args, {
    cwd,
    env: cleanEnvironment({ MEMPHIS_RELEASE_ATTESTATION_PUBLIC_KEY: fixture.publicKeyPem, ...env }),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

function runRefresh(fixture, { cwd = fixture.fixture, args = ["--check"], env = {} } = {}) {
  return spawnSync(process.execPath, [resolve(fixture.fixture, refresher), ...args], {
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

function expectRefreshRejected(name, mutate, expected) {
  const fixture = createFixture();
  try {
    const options = mutate(fixture) || {};
    const result = runRefresh(fixture, options);
    assert.notEqual(result.status, 0, `${name} unexpectedly passed release evidence refresh/check`);
    const output = `${result.stderr}\n${result.stdout}`;
    assert.match(output, expected, `${name} did not fail for the expected release-evidence provenance reason: ${output}`);
    return output;
  } finally {
    disposeFixture(fixture);
  }
}

const refreshPositive = createFixture();
try {
  const result = runRefresh(refreshPositive);
  assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.mode, "check");
  assert.equal(payload.source_tree, refreshPositive.tree);
} finally {
  disposeFixture(refreshPositive);
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
  assert.equal(payload.source_identity.migration_path_count, 115);
  assert.equal(payload.source_identity.generated_evidence_excluded_from_content_identity, evidencePath);
} finally {
  disposeFixture(positive);
}

expectRefreshRejected("refresh rejects unstaged tracked bytes", (fixture) => {
  const path = resolve(fixture.fixture, "src/index.js");
  writeFileSync(path, `${readFileSync(path, "utf8")}\n// disposable unstaged refresh mutation\n`);
}, /staged, unstaged, tracked, or untracked content is forbidden before release evidence refresh\/check/i);

expectRefreshRejected("refresh rejects staged tracked bytes", (fixture) => {
  const path = resolve(fixture.fixture, "src/index.js");
  writeFileSync(path, `${readFileSync(path, "utf8")}\n// disposable staged refresh mutation\n`);
  git(fixture.fixture, ["add", "src/index.js"]);
}, /staged, unstaged, tracked, or untracked content is forbidden before release evidence refresh\/check/i);

expectRefreshRejected("refresh rejects untracked bytes", (fixture) => {
  writeFileSync(resolve(fixture.fixture, "release/untracked-refresh-substitution.json"), "{\"substitutedAuthority\":true}\n");
}, /staged, unstaged, tracked, or untracked content is forbidden before release evidence refresh\/check/i);

expectRefreshRejected("refresh rejects skip-worktree evidence exclusion loophole", (fixture) => {
  git(fixture.fixture, ["update-index", "--skip-worktree", evidencePath]);
}, /skip-worktree index flag is forbidden: release\/integrated-backend-authority-evidence\.json/i);

expectRefreshRejected("refresh rejects assume-unchanged tracked authority bytes", (fixture) => {
  git(fixture.fixture, ["update-index", "--assume-unchanged", omittedMigration]);
  const path = resolve(fixture.fixture, omittedMigration);
  writeFileSync(path, `${readFileSync(path, "utf8")}\n-- hidden refresh authority mutation\n`);
}, /assume-unchanged index flag is forbidden: supabase\/migrations\/20260810120000_retire_named_manager_shared_room_authority\.sql/i);

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

{
  const fixture = createFixture();
  try {
    const path = resolve(fixture.fixture, evidencePath);
    const stale = JSON.parse(readFileSync(path, "utf8"));
    stale.authority_content_identity.expected_tree_inventory = stale.authority_content_identity.expected_tree_inventory.slice(0, 1);
    stale.authority_content_identity.authority_path_count = 1;
    writeFileSync(path, `${JSON.stringify(stale, null, 2)}\n`);
    git(fixture.fixture, ["add", evidencePath]);
    git(
      fixture.fixture,
      ["-c", "user.name=Release Provenance Test", "-c", "user.email=release-provenance@example.invalid", "commit", "-qm", "stale evidence"],
    );
    fixture.writeAcceptance({
      expectedCommit: git(fixture.fixture, ["rev-parse", "HEAD"]),
      expectedTree: git(fixture.fixture, ["rev-parse", "HEAD^{tree}"]),
    });
    const result = runGate(fixture, { database: true });
    assert.notEqual(result.status, 0, "stale generated complete inventory unexpectedly passed release acceptance");
    const output = `${result.stderr}\n${result.stdout}`;
    assert.match(output, /generated release evidence is stale, incomplete, or self-referential/i);
    assert.doesNotMatch(output, /database gate requires|configured secret must pass|docker/i);
  } finally {
    disposeFixture(fixture);
  }
}

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
    artifact: "memphis-zoo-integrated-release-attestation.v2",
    backend_commit_sha: fixture.commit,
    backend_tree_sha: fixture.tree,
    authority_paths: [],
  } });
}, /release attestation input has an unexpected shape/i);

expectRejected("acceptance input inside worktree", (fixture) => {
  const path = resolve(fixture.fixture, "sealed-acceptance.json");
  writeFileSync(path, `${JSON.stringify({
    artifact: "memphis-zoo-integrated-release-attestation.v2",
    backend_commit_sha: fixture.commit,
    backend_tree_sha: fixture.tree,
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
  skipEvidenceRefresh: true,
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
