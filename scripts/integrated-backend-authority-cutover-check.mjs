#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { buildIntegratedBackendAuthorityReleaseEvidence } from "../src/integrated-backend-authority-release-evidence.js";
import { assertExactReleaseAttestation } from "../src/release-contract.js";

const root = realpathSync(resolve(fileURLToPath(new URL("..", import.meta.url))));
const retirementA = "20260810120000_retire_named_manager_shared_room_authority.sql";
const retirementB = "20260810130000_harden_named_manager_retired_archive_and_concurrency.sql";
const retirementC = "20260810140000_finalize_named_manager_messenger_retirement_integrity.sql";
const phaseA = "20260810143000_offline_actor_occurrence_reconciliation.sql";
const phaseB = "20260810150000_enforce_integrated_backend_authority.sql";
const phaseC = "20260810160000_close_offline_authority_integrity_gaps.sql";
const phaseD = "20260810170000_finish_offline_authority_operational_closure.sql";
const phaseE = "20260810190000_final_integrated_backend_operational_correction.sql";
const schedulerA = "20260810200000_static_weekly_scheduler_authority_integrated.sql";
const schedulerB = "20260810210000_static_weekly_scheduler_three_high_foundation_correction.sql";
const schedulerC = "20260810220000_static_weekly_scheduler_complete_authority_correction.sql";
const schedulerD = "20260810230000_static_weekly_scheduler_authority_closure_correction.sql";
const schedulerE = "20260812032055_static_weekly_manager_snapshot.sql";
const schedulerF = "20260812130000_static_weekly_employee_turnover.sql";
const phaseF = "20260813035530_offline_scan_authority_snapshot.sql";
const phaseG = "20260813050000_offline_snapshot_operational_truth_closure.sql";
const phaseH = "20260813060000_release_canary_operational_recovery.sql";
const phaseI = "20260813070000_operational_service_date_foundation.sql";
const phaseJ = "20260813141806_custodial_operational_boundary_closure.sql";
const phaseK = "20260813173000_device_sync_actor_groups.sql";
const phaseL = "20260813190000_release_phone_transport_and_offline_activation_closure.sql";
const phaseM = "20260813210000_custodial_u4_ops_closure.sql";
const phaseN = "20260814224034_reconcile_static_weekly_day_change_receipts.sql";
const restoreGeneration = "20260820125325_custodial_disaster_restore_generation_authority.sql";
const applicationReadAuthority = "20260820133000_create_application_read_authority.sql";
const ownerSqlProxyRetirement = "20260820133100_retire_owner_sql_proxy.sql";
const managerTrustBoundary = "20260820143000_bound_ops_manager_device_trust.sql";
const functionAuthorityRecovery = "20260820143200_finalize_function_authority_recovery.sql";
const phaseO = "20260820153000_append_only_cleaning_identity_corrections.sql";
const phaseP = "20260820154000_late_gps_is_advisory_only.sql";
const terminalWriterDetection = "20260820154500_precise_terminal_writer_detection.sql";
const releaseRecoveryRebind = "20260820155000_rebind_release_recovery_inventory_to_current_authority.sql";
const staticWeeklyRegisteredRosterBootstrap = "20260823143000_static_weekly_registered_roster_bootstrap.sql";
const releaseInputPath = "release/integrated-backend-authority-input.json";
const releaseEvidencePath = "release/integrated-backend-authority-evidence.json";
const pendingMigrationPlanPath = "release/pending-production-migration-plan.json";
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

function releaseAttestationPublicKey() {
  const value = String(process.env.MEMPHIS_RELEASE_ATTESTATION_PUBLIC_KEY || "").replaceAll("\\n", "\n").trim();
  assert.ok(value, "MEMPHIS_RELEASE_ATTESTATION_PUBLIC_KEY is required");
  return `${value}\n`;
}

function assertNoForbiddenIndexFlags() {
  const records = gitBytes(["ls-files", "-v", "-z"]).toString("utf8").split("\0").filter(Boolean);
  for (const record of records) {
    const marker = record.slice(0, 1);
    const path = record.slice(2);
    assert.equal(record.slice(1, 2), " ", `invalid index flag record: ${record}`);
    assert.equal(marker === "S", false, `skip-worktree index flag is forbidden: ${path}`);
    assert.equal(/[a-z]/.test(marker), false, `assume-unchanged index flag is forbidden: ${path}`);
  }
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
  assertNoForbiddenIndexFlags();

  assert.match(expectedCommit, /^[a-f0-9]{40}$/, "expected_commit must be one exact lowercase SHA-1 commit id");
  assert.match(expectedTree, /^[a-f0-9]{40}$/, "expected_tree must be one exact lowercase SHA-1 tree id");
  const expectedCommitCheck = spawnSync("git", ["rev-parse", "--verify", `${expectedCommit}^{commit}`], { cwd: root, env: cleanGitEnvironment(), encoding: "utf8" });
  assert.equal(expectedCommitCheck.status, 0, "expected commit is unavailable or not exact");
  assert.equal(expectedCommitCheck.stdout.trim(), expectedCommit, "expected commit is unavailable or not exact");
  assert.equal(gitText(["rev-parse", `${expectedCommit}^{tree}`]), expectedTree, "expected commit does not resolve to expected tree");
  assert.equal(gitText(["rev-parse", "HEAD"]), expectedCommit, "HEAD does not equal immutable expected commit");
  assert.equal(gitText(["rev-parse", "HEAD^{tree}"]), expectedTree, "HEAD tree does not equal immutable expected tree");
  assert.equal(gitText(["status", "--porcelain=v1", "--untracked-files=all", "--ignored=no"]), "", "staged, unstaged, tracked, or untracked content is forbidden before release acceptance");
  for (const args of [["diff", "--quiet", "--ignore-submodules", "--"], ["diff", "--cached", "--quiet", "--ignore-submodules", "--"]]) {
    const diff = spawnSync("git", args, { cwd: root, env: cleanGitEnvironment(), encoding: "utf8" });
    assert.equal(diff.status, 0, `wrong or dirty Git index: git ${args.join(" ")}`);
  }
}

function trackedEntriesFromExpectedTree(expectedCommit, expectedTree) {
  const entries = gitBytes(["ls-tree", "-r", "-z", expectedTree]).toString("utf8").split("\0").filter(Boolean).map((record) => {
    const match = record.match(/^([0-7]{6})\s+(blob)\s+([a-f0-9]{40})\t(.+)$/);
    assert.ok(match, `expected tree contains a non-regular tracked entry: ${record}`);
    const [, mode, type, objectId, rawPath] = match;
    const path = mustBeRepositoryPath(rawPath);
    assert.equal(type, "blob", `expected tracked entry is not a blob: ${path}`);
    assert.ok(["100644", "100755"].includes(mode), `expected tracked entry must be a regular non-symlink file: ${path}`);
    assert.equal(gitText(["rev-parse", `${expectedCommit}:${path}`]), objectId, `commit/tree blob mismatch for ${path}`);
    assert.equal(gitText(["cat-file", "-t", objectId]), "blob", `expected tracked object is not a blob: ${path}`);
    return { path, mode, object_id: objectId, bytes: gitBytes(["cat-file", "blob", objectId]) };
  });
  assert.ok(entries.length > 0, "expected tree must contain tracked paths");
  return entries;
}

function assertWorktreeMatchesExpectedBlob(blob) {
  const worktreePath = resolve(root, blob.path);
  const entry = lstatSync(worktreePath);
  assert.equal(entry.isSymbolicLink(), false, `authority worktree path must not be a symlink/substitution: ${blob.path}`);
  assert.equal(entry.isFile(), true, `authority worktree path must be a regular file: ${blob.path}`);
  assert.equal(realpathSync(worktreePath), worktreePath, `authority worktree path resolves outside its exact location: ${blob.path}`);
  const worktreeGitMode = (entry.mode & 0o111) === 0 ? "100644" : "100755";
  assert.equal(worktreeGitMode, blob.mode, `worktree mode differs from expected Git tree mode: ${blob.path}`);
  assert.deepEqual(readFileSync(worktreePath), blob.bytes, `worktree bytes differ from expected Git tree blob: ${blob.path}`);
}

function parseJsonBlob(blob, description) {
  try {
    return JSON.parse(blob.bytes.toString("utf8"));
  } catch (error) {
    throw new Error(`${description} is not valid JSON in the expected Git tree: ${error.message}`);
  }
}

function expectedReleaseEvidence(input, schemaFingerprint, frontendManifest, authorityInventory) {
  return buildIntegratedBackendAuthorityReleaseEvidence({
    input,
    schemaFingerprint,
    frontendManifest,
    authorityInventory,
    generatedEvidencePath: releaseEvidencePath,
  });
}

const { databaseMode, acceptanceInput } = parseArgs(process.argv.slice(2));
const acceptanceFile = assertExternalReadonlyInput(acceptanceInput);
const acceptance = assertExactReleaseAttestation(JSON.parse(acceptanceFile.bytes.toString("utf8")), {
  publicKeyPem: releaseAttestationPublicKey(),
});

// All repository/environment and immutable identity checks complete before any
// database handle is read or any release acceptance result is created.
assertRepositoryIdentity(acceptance.backend_commit_sha, acceptance.backend_tree_sha);
const expectedEntries = trackedEntriesFromExpectedTree(acceptance.backend_commit_sha, acceptance.backend_tree_sha);
const evidenceBlob = expectedEntries.find(({ path }) => path === releaseEvidencePath);
assert.ok(evidenceBlob, "expected tree omits generated release evidence");
const expectedBlobs = expectedEntries.filter(({ path }) => path !== releaseEvidencePath);
assert.ok(expectedBlobs.length > 0, "release authority inventory is empty");
assert.equal(expectedBlobs.filter(({ path }) => /^supabase\/migrations\/[^/]+\.sql$/.test(path)).length, 106, "release authority inventory must bind all 106 migrations");
for (const blob of [...expectedBlobs, evidenceBlob]) assertWorktreeMatchesExpectedBlob(blob);
assert.equal(evidenceBlob.object_id, acceptance.backend_evidence_blob_sha, "signed release attestation names the wrong evidence blob");
assert.equal(hash(evidenceBlob.bytes), acceptance.backend_evidence_sha256, "signed release attestation names the wrong evidence digest");

const blobByPath = new Map(expectedBlobs.map((blob) => [blob.path, blob]));
for (const required of [releaseInputPath, pendingMigrationPlanPath, "scripts/refresh-integrated-backend-authority-release.mjs", "scripts/integrated-backend-authority-cutover-check.mjs", "scripts/integrated-backend-authority-release-provenance-tests.mjs", "scripts/integrated-backend-authority-suite-order-tests.mjs", "scripts/final-operational-correction-database-tests.mjs", "scripts/named-manager-messenger-retirement-correction-database-tests.mjs", "scripts/empty-database-rebuild-check.mjs", "scripts/refresh-schema-fingerprint.mjs", "src/index.js", "src/offline-authority-http.js", "src/scan-evidence.js"]) {
  assert.ok(blobByPath.has(required), `immutable acceptance input omitted authority path ${required}`);
}
const input = parseJsonBlob(blobByPath.get(releaseInputPath), "release authority input");
const pendingMigrationPlan = parseJsonBlob(blobByPath.get(pendingMigrationPlanPath), "pending production migration plan");
assert.ok(Array.isArray(pendingMigrationPlan.migrations) && pendingMigrationPlan.migrations.length > 0, "pending production migration plan must contain at least one migration");
const pendingProductionMigrations = pendingMigrationPlan.migrations.map(({ file }) => file);
assert.equal(new Set(pendingProductionMigrations).size, pendingProductionMigrations.length, "pending production migrations must be unique");
for (const migration of pendingProductionMigrations) {
  assert.match(String(migration || ""), /^[0-9]{14}_[a-z][a-z0-9_]*\.sql$/, `invalid pending migration file: ${migration}`);
  assert.ok(blobByPath.has(`supabase/migrations/${migration}`), `immutable acceptance input omitted pending migration supabase/migrations/${migration}`);
}
const releaseEvidence = parseJsonBlob(evidenceBlob, "release evidence");
const index = blobByPath.get("src/index.js").bytes.toString("utf8");
const phaseCText = blobByPath.get(`supabase/migrations/${phaseC}`).bytes.toString("utf8");
const phaseDText = blobByPath.get(`supabase/migrations/${phaseD}`).bytes.toString("utf8");
const phaseEText = blobByPath.get(`supabase/migrations/${phaseE}`).bytes.toString("utf8");
const phaseFText = blobByPath.get(`supabase/migrations/${phaseF}`).bytes.toString("utf8");
const phaseGText = blobByPath.get(`supabase/migrations/${phaseG}`).bytes.toString("utf8");
const phaseHText = blobByPath.get(`supabase/migrations/${phaseH}`).bytes.toString("utf8");
const phaseIText = blobByPath.get(`supabase/migrations/${phaseI}`).bytes.toString("utf8");
const phaseJText = blobByPath.get(`supabase/migrations/${phaseJ}`).bytes.toString("utf8");
const phaseKText = blobByPath.get(`supabase/migrations/${phaseK}`).bytes.toString("utf8");
const phaseLText = blobByPath.get(`supabase/migrations/${phaseL}`).bytes.toString("utf8");
const phaseMText = blobByPath.get(`supabase/migrations/${phaseM}`).bytes.toString("utf8");
const phaseNText = blobByPath.get(`supabase/migrations/${phaseN}`).bytes.toString("utf8");
const phaseOText = blobByPath.get(`supabase/migrations/${phaseO}`).bytes.toString("utf8");
const phasePText = blobByPath.get(`supabase/migrations/${phaseP}`).bytes.toString("utf8");
const schemaFingerprint = blobByPath.get("supabase/canonical/schema-fingerprint.txt")?.bytes.toString("utf8").trim();
const frontendManifest = parseJsonBlob(blobByPath.get("release/frontend-release-manifest.json"), "frontend release manifest");

assert.equal(input.release_contract_version, "offline-authority.v5");
const migrationInstruction = pendingProductionMigrations.length === 1
  ? `apply only the single hash-bound migration in ${pendingMigrationPlanPath}, stopping after any failed preflight or postcheck`
  : `apply only the ordered hash-bound migrations in ${pendingMigrationPlanPath}, stopping after any failed preflight or postcheck`;
assert.deepEqual(input.cutover.phase_order, [
  "prepare distinct CUSTODIAL_BACKEND_PROOF_SECRET and CUSTODIAL_NATIVE_ROUTE_PROOF_SECRET values (minimum 32 characters each) without exposing either value",
  "run npm run release:populated-schema:preflight through the read-only production MCP and preserve its exact source-fingerprint receipt before any migration",
  `verify production project, migration head, catalog/privilege fingerprint, backup receipt, and exact source attestation against ${pendingMigrationPlanPath}`,
  migrationInstruction,
  "deploy the canonical-only backend only after all authoritative procedures above are present and verified; missing canonical writers fail closed",
  "require a green authority health gate and direct-DML denial probes before routing traffic",
]);
assert.equal(input.cutover.production_migration_plan, pendingMigrationPlanPath);
assert.equal(pendingMigrationPlan.artifact, "pending-production-migration-plan.v2");
assert.equal(pendingMigrationPlan.project_ref, "rqquvtjdmugpigbndmne");
assert.match(String(pendingMigrationPlan.observed_production?.ledger_head || ""), /^[0-9]{14}$/);
assert.match(String(pendingMigrationPlan.observed_production?.source_migration_name || ""), /^[a-z][a-z0-9_]*$/);
assert.match(String(pendingMigrationPlan.observed_production?.catalog_privilege_fingerprint || ""), /^[a-f0-9]{64}$/);
assert.equal(pendingMigrationPlan.target?.source_migration_file, staticWeeklyRegisteredRosterBootstrap);
assert.equal(pendingMigrationPlan.target?.source_migration_file, pendingProductionMigrations.at(-1));
assert.equal(pendingMigrationPlan.target?.source_migration_name, "static_weekly_registered_roster_bootstrap");
assert.equal(pendingMigrationPlan.target?.ledger_version_policy, "runner_assigned_and_postverified");
assert.equal(pendingMigrationPlan.target?.canonical_schema_fingerprint, schemaFingerprint);
assert.equal(pendingMigrationPlan.source_binding?.kind, "external_exact_head_release_attestation");
assert.equal(pendingMigrationPlan.authorization?.production_apply_authorized, true);
assert.equal(
  pendingMigrationPlan.authorization?.sequence_policy,
  pendingProductionMigrations.length === 1
    ? "single_migration_stop_on_failed_preflight_or_postcheck"
    : "ordered_migrations_stop_on_failed_preflight_or_postcheck",
);
for (const [index, migration] of pendingMigrationPlan.migrations.entries()) {
  assert.equal(migration.order, index + 1, `pending migration order is not contiguous at ${migration.file}`);
  assert.match(String(migration.phase || ""), /^[a-z][a-z0-9_]+$/, `pending migration phase is invalid at ${migration.file}`);
  assert.match(String(migration.sha256 || ""), /^[a-f0-9]{64}$/, `pending migration digest is invalid at ${migration.file}`);
  const blob = blobByPath.get(`supabase/migrations/${migration.file}`);
  assert.ok(blob, `pending migration is absent from the exact backend tree: ${migration.file}`);
  assert.equal(hash(blob.bytes), migration.sha256, `pending migration digest mismatch: ${migration.file}`);
}
assert.equal(input.cutover.source_identity.kind, "external_signed_release_attestation");
assert.equal(input.cutover.source_identity.generated_evidence_path, releaseEvidencePath);
assert.equal(input.cutover.source_identity.generated_evidence_excluded_from_content_identity, true);
assert.equal(Object.hasOwn(input.cutover.source_identity, "authority_content_paths"), false, "manual authority inventory is forbidden");
assert.equal(input.cutover.source_identity.authority_inventory?.source, "all-tracked-paths-in-external-expected-tree");
assert.deepEqual(input.cutover.source_identity.authority_inventory?.exclude, [releaseEvidencePath]);
assert.match(index, /runCanonicalScanRpc/);
assert.doesNotMatch(index, /runPreparedScanRpc|prepared\?\.fallback|accepted legacy writer/);
assert.match(index, /tool_complete_session_authoritative/);
assert.match(phaseCText, /custodial_backend_authority_health/);
assert.match(phaseCText, /length\(coalesce\(p_execution_secret,''\)\)<32/);
assert.match(phaseDText, /issued_submission_proof/);
assert.match(phaseDText, /custodial_claim_offline_reconciliation_notifications/);
assert.match(phaseDText, /run_sql_migration\(text,text\)/);
assert.match(phaseEText, /custodial_terminal_writer_inventory/);
assert.match(phaseEText, /custodial_claim_offline_reconciliation_notification_recipients/);
assert.match(phaseEText, /assignment_fenced_proof_recovery/);
assert.match(phaseFText, /tool_get_offline_scan_authority_snapshot/);
assert.match(phaseFText, /custodial_scan_evidence_is_canonical/);
assert.match(phaseGText, /custodial_offline_scan_authority_snapshots/);
assert.match(phaseHText, /custodial_control_release_canary/);
assert.match(phaseHText, /custodial_release_authority_restore_definitions/);
assert.match(phaseIText, /custodial_run_release_canary_recovery_probe/);
assert.match(phaseIText, /operational_service_date_boundary/);
assert.match(phaseJText, /v_service_date date:=public\.sch_service_date\(p_now\)/);
assert.match(phaseJText, /v_local_date date:=public\.sch_service_date\(p_now\)/);
assert.match(phaseJText, /v_new text:='''employee_id'',v_existing\.employee_id,''assignment_epoch'',v_existing\.assignment_epoch/);
assert.match(phaseJText, /custodial_release_authority_restore_definitions/);
assert.match(phaseKText, /queue_authority_groups/);
assert.match(phaseKText, /custodial_offline_scan_authority_snapshots/);
assert.match(phaseKText, /tool_report_device_sync_status_v2/);
assert.match(phaseLText, /custodial_release_canary_transport_probes/);
assert.match(phaseLText, /custodial_record_release_canary_transport_probe/);
assert.match(phaseLText, /v_device\.confirmed_at>v_snapshot\.generated_at/);
assert.match(phaseLText, /v_started_at>=v_device\.expires_at or \(v_device\.revoked_at is not null and v_started_at>=v_device\.revoked_at\)/);
assert.match(phaseMText, /custodial_canonical_utc_millis/);
assert.match(phaseMText, /custodial_offline_authority_activation_events/);
assert.match(phaseMText, /custodial_release_authority_restore_inventory/);
assert.match(phaseMText, /custodial_release_authority_current_grant_definition/);
assert.match(phaseNText, /static_weekly_v4_begin_day_changes/);
assert.match(phaseNText, /deterministic_child_projection_chain\.v1/);
assert.match(phaseOText, /custodial_append_session_correction/);
assert.match(phaseOText, /Original cleaning identity is immutable/);
assert.match(phaseOText, /Inspection actor, cleaning identity, and snapshots are immutable/);
assert.match(phasePText, /post_session_advisory/);
assert.match(phasePText, /v_session_state not in \('active','pending_submit'\)/);
assert.match(schemaFingerprint, /^[a-f0-9]{64}$/);
assert.equal(frontendManifest.frontend_commit_sha, acceptance.frontend_commit_sha, "signed release attestation names the wrong frontend commit");
assert.equal(frontendManifest.release_id, acceptance.release_id, "signed release attestation names the wrong semantic release");
assert.equal(schemaFingerprint, acceptance.schema_fingerprint, "signed release attestation names the wrong schema fingerprint");
assert.deepEqual(releaseEvidence, expectedReleaseEvidence(input, schemaFingerprint, frontendManifest, expectedBlobs), "generated release evidence is stale, incomplete, or self-referential");

const authorityContent = expectedBlobs.map(({ path, mode, object_id, bytes }) => ({ path, mode, object_id, sha256: hash(bytes) }));
const authorityContentSha256 = hash(Buffer.from(JSON.stringify(authorityContent)));
const sourceIdentity = {
  commit: acceptance.backend_commit_sha,
  tree: acceptance.backend_tree_sha,
  acceptance_input_sha256: hash(acceptanceFile.bytes),
  release_attestation_key_id: acceptance.signature.key_id,
  authority_content_sha256: authorityContentSha256,
  authority_path_count: authorityContent.length,
  tracked_path_count: expectedEntries.length,
  migration_path_count: expectedBlobs.filter(({ path }) => /^supabase\/migrations\/[^/]+\.sql$/.test(path)).length,
  inventory_source: "all tracked paths from caller-supplied expected tree in git ls-tree -r -z order",
  generated_evidence_excluded_from_content_identity: releaseEvidencePath,
};

const result = {
  ok: true,
  source_identity: sourceIdentity,
  authority_content: authorityContent,
  phase_order: pendingProductionMigrations,
  canonical_writer_policy: "missing authoritative procedures fail closed without invoking legacy writers",
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
  assert.equal(run(`select public.custodial_backend_authority_health(${q(secret)})->>'authority';`).split("\n").at(-1), "offline-authority.v5", "final health must expose the complete U4 authority closure");
  assert.equal(run(`select count(*) from information_schema.role_table_grants where table_schema='public' and grantee='service_role' and table_name in ('sessions','completion_responses','scan_events','maintenance_tickets') and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE');`).split("\n").at(-1), "0", "service role must not retain operational DML grants");
  assert.equal(run(`select count(*) from unnest(array[
    to_regprocedure('public.tool_get_offline_scan_authority_snapshot(text,text,text)'),
    to_regprocedure('public.tool_start_offline_occurrence(text,text,text,text,text,text,integer,text,text,text,text,text,text,text)'),
    to_regprocedure('public.tool_commit_cleaning_workflow_authoritative(text,text,text,text,text,text,jsonb,jsonb,text,text,text,text,text,text,text,text,text)'),
    to_regprocedure('public.tool_complete_session_authoritative(text,jsonb,text,text,text,text)'),
    to_regprocedure('public.custodial_close_maintenance_ticket_authoritative(uuid,text,text,text)'),
    to_regprocedure('public.custodial_finish_historical_session_authoritative(text,text,uuid,timestamptz,text)'),
    to_regprocedure('public.custodial_backend_authority_health(text)')
  ]) p(oid) where oid is not null;`).split("\n").at(-1), "7", "the exact bounded canonical command, historical-finish, snapshot, and health surface must be present");
  assert.equal(run(`select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('run_application_write','run_sql_write','run_sql_migration','force_close_session','tool_force_close_session') and has_function_privilege('service_role',p.oid,'EXECUTE');`).split("\n").at(-1), "0", "service role must not retain a generic or force-close writer");
  assert.equal(run(`select count(*) from public.custodial_terminal_writer_inventory i where application_callable and (mutates_terminal_truth or delegates_alternate_terminal_authority)
    and i.oid is distinct from to_regprocedure('public.tool_start_offline_occurrence(text,text,text,text,text,text,integer,text,text,text,text,text,text,text)')
    and i.oid is distinct from to_regprocedure('public.tool_commit_cleaning_workflow_authoritative(text,text,text,text,text,text,jsonb,jsonb,text,text,text,text,text,text,text,text,text)')
    and i.oid is distinct from to_regprocedure('public.tool_complete_session_authoritative(text,jsonb,text,text,text,text)')
    and i.oid is distinct from to_regprocedure('public.custodial_close_maintenance_ticket_authoritative(uuid,text,text,text)')
    and i.oid is distinct from to_regprocedure('public.custodial_finish_historical_session_authoritative(text,text,uuid,timestamptz,text)');`).split("\n").at(-1), "0", "service roles must not retain an alternate terminal writer by exact procedure identity");
  assert.equal(run(`select (has_function_privilege('service_role','public.purge_closed_scan_history_before(timestamp with time zone,text)'::regprocedure,'EXECUTE') or has_function_privilege('service_role','public.tool_purge_closed_scan_history_before(timestamp with time zone,text)'::regprocedure,'EXECUTE'))::text;`).split("\n").at(-1), "false", "service role must not retain either purge signature");
  const directWrite = spawnSync("docker", ["exec", container, "psql", "-v", "ON_ERROR_STOP=1", "-At", "-U", "supabase_admin", "-d", database, "-c", "set role service_role; insert into public.sessions default values;"], { encoding: "utf8" });
  assert.notEqual(directWrite.status, 0, "restoration check must prove direct application DML remains denied");
  result.database_gate = "passed";
}

console.log(JSON.stringify(result, null, 2));
