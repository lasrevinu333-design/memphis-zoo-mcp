#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = realpathSync(resolve(fileURLToPath(new URL("..", import.meta.url))));
const phaseA = "20260810143000_offline_actor_occurrence_reconciliation.sql";
const phaseB = "20260810150000_enforce_integrated_backend_authority.sql";
const phaseC = "20260810160000_close_offline_authority_integrity_gaps.sql";
const phaseD = "20260810170000_finish_offline_authority_operational_closure.sql";
const phaseE = "20260810190000_final_integrated_backend_operational_correction.sql";
const releaseInputPath = "release/integrated-backend-authority-input.json";
const releaseEvidencePath = "release/integrated-backend-authority-evidence.json";
const forbiddenGitEnvironment = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
];

function hash(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function parseArgs(argv) {
  let databaseMode = false;
  let acceptanceInput = null;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--database") {
      assert.equal(databaseMode, false, "--database may be supplied once");
      databaseMode = true;
    } else if (arg === "--acceptance-input") {
      assert.equal(acceptanceInput, null, "--acceptance-input may be supplied once");
      acceptanceInput = argv[index + 1];
      assert.ok(acceptanceInput && !acceptanceInput.startsWith("-"), "--acceptance-input requires a path");
      index += 1;
    } else {
      assert.fail("usage: integrated-backend-authority-cutover-check.mjs --acceptance-input /absolute/read-only/acceptance.json [--database]");
    }
  }
  assert.ok(acceptanceInput, "an immutable external --acceptance-input is required before release acceptance");
  return { databaseMode, acceptanceInput };
}

function cleanGitEnvironment() {
  const env = { ...process.env };
  for (const name of forbiddenGitEnvironment) delete env[name];
  return env;
}

function gitText(args) {
  return execFileSync("git", args, { cwd: root, env: cleanGitEnvironment(), encoding: "utf8" }).trim();
}

function gitBytes(args) {
  return execFileSync("git", args, { cwd: root, env: cleanGitEnvironment(), maxBuffer: 64 * 1024 * 1024 });
}

function mustBeRepositoryPath(path) {
  assert.equal(typeof path, "string");
  assert.match(path, /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]+$/, `invalid repository path: ${path}`);
  assert.equal(isAbsolute(path), false, `authority path must be repository-relative: ${path}`);
  return path;
}

function isOutside(candidate, containingDirectory) {
  const pathRelative = relative(containingDirectory, candidate);
  return pathRelative === ".." || pathRelative.startsWith(`..${sep}`) || isAbsolute(pathRelative);
}

function assertExternalReadonlyInput(acceptancePath) {
  assert.ok(isAbsolute(acceptancePath), "acceptance input must be an absolute path outside the worktree");
  const inputLstat = lstatSync(acceptancePath);
  assert.equal(inputLstat.isSymbolicLink(), false, "acceptance input must not be a symlink");
  assert.equal(inputLstat.isFile(), true, "acceptance input must be a regular file");
  assert.equal(inputLstat.mode & 0o777, 0o444, "acceptance input must be sealed mode 0444");
  const inputRealpath = realpathSync(acceptancePath);
  assert.equal(isOutside(inputRealpath, root), true, "acceptance input must remain outside the checked worktree");
  return { path: inputRealpath, bytes: readFileSync(inputRealpath) };
}

function assertRepositoryIdentity(expectedCommit, expectedTree) {
  for (const name of forbiddenGitEnvironment) {
    assert.equal(Object.hasOwn(process.env, name), false, `${name} is forbidden: use the repository's actual worktree, Git directory, and index`);
  }
  assert.equal(realpathSync(process.cwd()), root, "cutover checker must run from its own repository root");
  assert.equal(gitText(["rev-parse", "--is-inside-work-tree"]), "true");
  assert.equal(realpathSync(gitText(["rev-parse", "--show-toplevel"])), root, "wrong worktree");
  assert.equal(gitText(["rev-parse", "--show-prefix"]), "", "cutover checker must run at the repository root");

  const dotGitPath = resolve(root, ".git");
  const dotGit = lstatSync(dotGitPath);
  assert.equal(dotGit.isSymbolicLink(), false, "repository .git entry must not be a symlink");
  const gitDirectory = realpathSync(gitText(["rev-parse", "--absolute-git-dir"]));
  if (dotGit.isDirectory()) {
    assert.equal(realpathSync(dotGitPath), gitDirectory, "wrong Git directory");
  } else {
    assert.equal(dotGit.isFile(), true, "repository .git entry must be a directory or gitdir file");
    const pointer = readFileSync(dotGitPath, "utf8").match(/^gitdir:\s*(.+)\s*$/);
    assert.ok(pointer, "invalid gitdir pointer");
    assert.equal(realpathSync(resolve(root, pointer[1])), gitDirectory, "wrong Git directory");
  }
  const indexPath = gitText(["rev-parse", "--git-path", "index"]);
  const indexLstat = lstatSync(indexPath);
  assert.equal(indexLstat.isSymbolicLink(), false, "repository index must not be a symlink/substitution");
  assert.equal(indexLstat.isFile(), true, "repository index must be a regular file");

  assert.match(expectedCommit, /^[a-f0-9]{40}$/, "expected_commit must be one exact lowercase SHA-1 commit id");
  assert.match(expectedTree, /^[a-f0-9]{40}$/, "expected_tree must be one exact lowercase SHA-1 tree id");
  assert.equal(gitText(["rev-parse", "--verify", `${expectedCommit}^{commit}`]), expectedCommit, "expected commit is unavailable or not exact");
  assert.equal(gitText(["rev-parse", `${expectedCommit}^{tree}`]), expectedTree, "expected commit does not resolve to expected tree");
  assert.equal(gitText(["rev-parse", "HEAD"]), expectedCommit, "HEAD does not equal immutable expected commit");
  assert.equal(gitText(["rev-parse", "HEAD^{tree}"]), expectedTree, "HEAD tree does not equal immutable expected tree");
  assert.equal(gitText(["status", "--porcelain=v1", "--untracked-files=all", "--ignored=no"]), "", "staged, unstaged, tracked, or untracked content is forbidden before release acceptance");
  for (const args of [["diff", "--quiet", "--ignore-submodules", "--"], ["diff", "--cached", "--quiet", "--ignore-submodules", "--"]]) {
    const diff = spawnSync("git", args, { cwd: root, env: cleanGitEnvironment(), encoding: "utf8" });
    assert.equal(diff.status, 0, `wrong or dirty Git index: git ${args.join(" ")}`);
  }
}

function blobFromExpectedTree(expectedCommit, expectedTree, path) {
  mustBeRepositoryPath(path);
  const treeEntry = gitText(["ls-tree", expectedTree, "--", path]);
  const match = treeEntry.match(/^([0-7]{6})\s+blob\s+([a-f0-9]{40})\t(.+)$/);
  assert.ok(match && match[3] === path, `expected tree lacks a regular blob for ${path}`);
  assert.notEqual(match[1], "120000", `expected tree authority path must not be a symlink: ${path}`);
  const objectId = gitText(["rev-parse", `${expectedCommit}:${path}`]);
  assert.equal(objectId, match[2], `commit/tree blob mismatch for ${path}`);
  assert.equal(gitText(["cat-file", "-t", objectId]), "blob", `expected authority object is not a blob: ${path}`);
  return { path, mode: match[1], object_id: objectId, bytes: gitBytes(["cat-file", "blob", objectId]) };
}

function assertWorktreeMatchesExpectedBlob(blob) {
  const worktreePath = resolve(root, blob.path);
  const entry = lstatSync(worktreePath);
  assert.equal(entry.isSymbolicLink(), false, `authority worktree path must not be a symlink/substitution: ${blob.path}`);
  assert.equal(entry.isFile(), true, `authority worktree path must be a regular file: ${blob.path}`);
  assert.equal(realpathSync(worktreePath), worktreePath, `authority worktree path resolves outside its exact location: ${blob.path}`);
  assert.deepEqual(readFileSync(worktreePath), blob.bytes, `worktree bytes differ from expected Git tree blob: ${blob.path}`);
}

function parseJsonBlob(blob, description) {
  try {
    return JSON.parse(blob.bytes.toString("utf8"));
  } catch (error) {
    throw new Error(`${description} is not valid JSON in the expected Git tree: ${error.message}`);
  }
}

function expectedReleaseEvidence(input, schemaFingerprint, frontendManifest) {
  const migrations = [
    "20260810120000_retire_named_manager_shared_room_authority.sql",
    "20260810130000_harden_named_manager_retired_archive_and_concurrency.sql",
    "20260810140000_finalize_named_manager_messenger_retirement_integrity.sql",
    phaseA,
    phaseB,
    phaseC,
    phaseD,
    phaseE,
  ].map((name) => ({ name }));
  return {
    artifact: "integrated-backend-authority-release-evidence.v2",
    schema_fingerprint: schemaFingerprint,
    schema_transition: frontendManifest.schema_transition,
    frontend_source_fingerprint: frontendManifest.schema_fingerprint,
    backend_contract: input.backend_contract,
    compatibility_window: {
      accepted_engine: input.accepted_engine_contract,
      required_engine: input.required_engine_contract,
      additive_phase: "20260810143000 supplies explicit activation and records no state-read proof",
      enforcement_phase: "20260810150000 routes both canonical and legacy completion through one server-authenticated transaction",
      closure_phase: "20260810160000 removes direct DML and legacy-writer authority, fences terminal conflicts, and writes manager outbox evidence",
      operational_closure_phase: "20260810170000 recovers durable exact-start proofs, retires every service-role generic writer, and runs leased reconciliation notification delivery",
      final_operational_correction_phase: "20260810190000 fences reassigned proof replay, retires alternate terminal writers and purge, and records idempotent recipient delivery evidence",
    },
    rollback: input.rollback,
    cutover: input.cutover,
    authority_content_identity: {
      source: "git_tree_blobs_from_external_immutable_acceptance_input",
      authority_paths: input.cutover.source_identity.authority_content_paths,
      generated_evidence_excluded_path: releaseEvidencePath,
      binding: "The executable cutover gate requires externally supplied exact expected_commit and expected_tree, verifies this evidence file as a blob in that tree, then hashes every listed authority path from that tree and compares each worktree byte sequence with its exact tree blob.",
    },
    manager_recovery: {
      list: "GET /admin-api/custodial/offline-reconciliations?limit=1..100&before=<ISO-8601>",
      detail: "GET /admin-api/custodial/offline-reconciliations/:reconciliationId",
      disposition: "POST /admin-api/custodial/offline-reconciliations/:reconciliationId/dispositions",
      authority: "active named manager; disposition write additionally requires DIRECTOR or SECURITY_ADMIN",
    },
    migrations,
    release_boundary: "Configure a minimum-32-character CUSTODIAL_BACKEND_PROOF_SECRET and matching database digest before Phase A, retain the bridge backend artifact through Phase C, and require the executable health/restoration probes before traffic changes.",
  };
}

const { databaseMode, acceptanceInput } = parseArgs(process.argv.slice(2));
const acceptanceFile = assertExternalReadonlyInput(acceptanceInput);
const acceptance = JSON.parse(acceptanceFile.bytes.toString("utf8"));
assert.deepEqual(Object.keys(acceptance).sort(), ["artifact", "authority_paths", "expected_commit", "expected_tree"]);
assert.equal(acceptance.artifact, "integrated-backend-authority-release-acceptance.v1");
assert.ok(Array.isArray(acceptance.authority_paths) && acceptance.authority_paths.length >= 12, "acceptance input must enumerate every authority-bearing path");
assert.equal(new Set(acceptance.authority_paths).size, acceptance.authority_paths.length, "acceptance authority paths must be unique");
for (const path of acceptance.authority_paths) mustBeRepositoryPath(path);

// All repository/environment and immutable identity checks complete before any
// database handle is read or any release acceptance result is created.
assertRepositoryIdentity(acceptance.expected_commit, acceptance.expected_tree);
const expectedBlobs = acceptance.authority_paths.map((path) => blobFromExpectedTree(acceptance.expected_commit, acceptance.expected_tree, path));
for (const blob of expectedBlobs) assertWorktreeMatchesExpectedBlob(blob);
const evidenceBlob = blobFromExpectedTree(acceptance.expected_commit, acceptance.expected_tree, releaseEvidencePath);
assertWorktreeMatchesExpectedBlob(evidenceBlob);
assert.equal(acceptance.authority_paths.includes(releaseEvidencePath), false, "generated evidence is explicitly excluded from its own content identity");

const blobByPath = new Map(expectedBlobs.map((blob) => [blob.path, blob]));
for (const required of [releaseInputPath, "src/index.js", "src/offline-authority-http.js", `supabase/migrations/${phaseC}`, `supabase/migrations/${phaseD}`, `supabase/migrations/${phaseE}`]) {
  assert.ok(blobByPath.has(required), `immutable acceptance input omitted authority path ${required}`);
}
const input = parseJsonBlob(blobByPath.get(releaseInputPath), "release authority input");
const releaseEvidence = parseJsonBlob(evidenceBlob, "release evidence");
const index = blobByPath.get("src/index.js").bytes.toString("utf8");
const phaseCText = blobByPath.get(`supabase/migrations/${phaseC}`).bytes.toString("utf8");
const phaseDText = blobByPath.get(`supabase/migrations/${phaseD}`).bytes.toString("utf8");
const phaseEText = blobByPath.get(`supabase/migrations/${phaseE}`).bytes.toString("utf8");
const schemaFingerprint = blobByPath.get("supabase/canonical/schema-fingerprint.txt")?.bytes.toString("utf8").trim();
const frontendManifest = parseJsonBlob(blobByPath.get("release/frontend-release-manifest.json"), "frontend release manifest");

assert.equal(input.release_contract_version, "offline-authority.v3");
assert.deepEqual(input.cutover.phase_order.slice(1, 7), [
  `apply ${phaseA}`,
  "deploy the bridge backend; it falls back only on absent authoritative procedures",
  `apply ${phaseB}`,
  `apply ${phaseC}`,
  `apply ${phaseD}`,
  `apply ${phaseE}`,
]);
assert.equal(input.cutover.source_identity.kind, "external_immutable_acceptance_input");
assert.equal(input.cutover.source_identity.generated_evidence_path, releaseEvidencePath);
assert.equal(input.cutover.source_identity.generated_evidence_excluded_from_content_identity, true);
assert.deepEqual(input.cutover.source_identity.authority_content_paths, acceptance.authority_paths, "mutable release input must agree with the external immutable authority-path enumeration");
assert.match(index, /runPreparedScanRpc/);
assert.match(index, /\["42883", "PGRST202"\]/);
assert.match(index, /tool_complete_session_authoritative/);
assert.match(index, /fallback:/);
assert.match(phaseCText, /custodial_backend_authority_health/);
assert.match(phaseCText, /length\(coalesce\(p_execution_secret,''\)\)<32/);
assert.match(phaseDText, /issued_submission_proof/);
assert.match(phaseDText, /custodial_claim_offline_reconciliation_notifications/);
assert.match(phaseDText, /run_sql_migration\(text,text\)/);
assert.match(phaseEText, /custodial_terminal_writer_inventory/);
assert.match(phaseEText, /custodial_claim_offline_reconciliation_notification_recipients/);
assert.match(phaseEText, /assignment_fenced_proof_recovery/);
assert.match(schemaFingerprint, /^[a-f0-9]{64}$/);
assert.deepEqual(releaseEvidence, expectedReleaseEvidence(input, schemaFingerprint, frontendManifest), "generated release evidence is stale or self-referential");

const authorityContent = expectedBlobs.map(({ path, mode, object_id, bytes }) => ({ path, mode, object_id, sha256: hash(bytes) }));
const authorityContentSha256 = hash(Buffer.from(JSON.stringify(authorityContent)));
const sourceIdentity = {
  commit: acceptance.expected_commit,
  tree: acceptance.expected_tree,
  acceptance_input_sha256: hash(acceptanceFile.bytes),
  authority_content_sha256: authorityContentSha256,
  authority_path_count: authorityContent.length,
  generated_evidence_excluded_from_content_identity: releaseEvidencePath,
};

const result = {
  ok: true,
  source_identity: sourceIdentity,
  authority_content: authorityContent,
  phase_order: [phaseA, phaseB, phaseC, phaseD, phaseE],
  bridge_fallback: "only absent authoritative procedure SQLSTATE 42883/PGRST202",
  database_gate: "not-requested",
};

if (databaseMode) {
  const container = String(process.env.CUSTODIAL_CUTOVER_DOCKER_CONTAINER || "").trim();
  const database = String(process.env.CUSTODIAL_CUTOVER_DATABASE || "postgres").trim();
  const secret = String(process.env.CUSTODIAL_BACKEND_PROOF_SECRET || "").trim();
  assert.match(container, /^mz_schema_rebuild_[a-zA-Z0-9_]+$/, "database gate requires an owned disposable rebuild container");
  assert.match(database, /^(postgres|mz_schema_rebuild_[a-zA-Z0-9_]+)$/, "database gate requires a disposable rebuild database");
  assert.ok(secret.length >= 32, "database gate requires the configured minimum-length backend proof secret");
  const q = (value) => `'${String(value).replaceAll("'", "''")}'`;
  const run = (statement) => execFileSync("docker", ["exec", container, "psql", "-v", "ON_ERROR_STOP=1", "-At", "-U", "supabase_admin", "-d", database, "-c", statement], { encoding: "utf8" }).trim();
  assert.equal(run(`select public.custodial_backend_authority_health(${q(secret)})->>'ok';`).split("\n").at(-1), "true", "configured secret must pass the canonical health gate");
  assert.equal(run(`select public.custodial_backend_authority_health(${q(secret)})->>'authority';`).split("\n").at(-1), "offline-authority.v3", "Phase D health must expose durable proof and delivery authority");
  assert.equal(run(`select count(*) from information_schema.role_table_grants where table_schema='public' and grantee='service_role' and table_name in ('sessions','completion_responses','scan_events','maintenance_tickets') and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE');`).split("\n").at(-1), "0", "service role must not retain operational DML grants");
  assert.equal(run(`select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('tool_start_offline_occurrence','tool_commit_cleaning_workflow_authoritative','tool_complete_session_authoritative','custodial_backend_authority_health','custodial_close_maintenance_ticket_authoritative');`).split("\n").at(-1), "5", "bounded canonical command surface must be present");
  assert.equal(run(`select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('run_application_write','run_sql_write','run_sql_migration','force_close_session','tool_force_close_session') and has_function_privilege('service_role',p.oid,'EXECUTE');`).split("\n").at(-1), "0", "service role must not retain a generic or force-close writer");
  assert.equal(run(`select count(*) from public.custodial_terminal_writer_inventory where application_callable and (mutates_terminal_truth or delegates_alternate_terminal_authority) and proname not in ('tool_start_offline_occurrence','tool_commit_cleaning_workflow_authoritative','tool_complete_session_authoritative','custodial_close_maintenance_ticket_authoritative');`).split("\n").at(-1), "0", "service roles must not retain an alternate terminal writer by capability or wrapper delegation");
  assert.equal(run(`select (has_function_privilege('service_role','public.purge_closed_scan_history_before(timestamp with time zone,text)'::regprocedure,'EXECUTE') or has_function_privilege('service_role','public.tool_purge_closed_scan_history_before(timestamp with time zone,text)'::regprocedure,'EXECUTE'))::text;`).split("\n").at(-1), "false", "service role must not retain either purge signature");
  const directWrite = spawnSync("docker", ["exec", container, "psql", "-v", "ON_ERROR_STOP=1", "-At", "-U", "supabase_admin", "-d", database, "-c", "set role service_role; insert into public.sessions default values;"], { encoding: "utf8" });
  assert.notEqual(directWrite.status, 0, "restoration check must prove direct application DML remains denied");
  result.database_gate = "passed";
}

console.log(JSON.stringify(result, null, 2));
