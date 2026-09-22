#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { assertExactReleaseAttestation } from "../src/release-contract.js";
import { buildRecordingPlan, migrationManifestSha256, sameReleaseIdentity } from "../src/production-release-deployment-recorder.js";
import { stableJson } from "./disaster-recovery-crypto.mjs";
import { loadRecoveryRuntimeContract, validateRecoveryRuntimeConfiguration } from "./disaster-recovery-runtime-contract.mjs";

const { Client } = pg;
const root = realpathSync(resolve(fileURLToPath(new URL("..", import.meta.url))));
const apply = process.argv.includes("--apply");
const requiredEnv = (name) => {
  const value = String(process.env[name] || "").trim();
  assert.ok(value, `${name} is required.`);
  return value;
};
const outsideRoot = (path) => {
  const value = relative(root, path);
  return value === ".." || value.startsWith(`..${sep}`) || isAbsolute(value);
};
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
function readExternalAttestation() {
  const inputPath = requiredEnv("LIVE_RELEASE_ATTESTATION_INPUT");
  assert.equal(isAbsolute(inputPath), true, "LIVE_RELEASE_ATTESTATION_INPUT must be absolute.");
  const entry = lstatSync(inputPath);
  assert.equal(entry.isSymbolicLink(), false, "Release attestation must not be a symlink.");
  assert.equal(entry.isFile(), true, "Release attestation must be a regular file.");
  assert.equal(entry.mode & 0o777, 0o444, "Release attestation must be mode 0444.");
  const real = realpathSync(inputPath);
  assert.equal(outsideRoot(real), true, "Release attestation must remain outside this worktree.");
  const publicKeyPem = requiredEnv("MEMPHIS_RELEASE_ATTESTATION_PUBLIC_KEY").replaceAll("\\n", "\n");
  return assertExactReleaseAttestation(JSON.parse(readFileSync(real, "utf8")), { publicKeyPem });
}

function migrationManifest() {
  return readdirSync(resolve(root, "supabase/migrations"))
    .filter((name) => name.endsWith(".sql")).sort().map((name) => ({
      file: `supabase/migrations/${name}`,
      sha256: sha256(readFileSync(resolve(root, "supabase/migrations", name))),
    }));
}

function git(args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}
if (apply) {
  assert.equal(String(process.env.PRODUCTION_RELEASE_RECORD_APPLY || "").trim(), "true",
    "--apply additionally requires PRODUCTION_RELEASE_RECORD_APPLY=true.");
}
assert.equal(git(["status", "--porcelain=v1", "--untracked-files=all"]), "",
  "Release deployment recording requires a clean exact source worktree.");
const attestation = readExternalAttestation();
assert.equal(git(["rev-parse", "HEAD"]), attestation.backend_commit_sha,
  "Local backend HEAD is not the signed live release candidate.");
assert.equal(git(["rev-parse", "HEAD^{tree}"]), attestation.backend_tree_sha,
  "Local backend tree is not the signed live release candidate.");
const liveCheck = JSON.parse(execFileSync(process.execPath, ["scripts/live-release-alignment-check.mjs"], {
  cwd: root, env: process.env, encoding: "utf8", maxBuffer: 4 * 1024 * 1024,
}));
assert.equal(liveCheck.ok, true, "Live integrated release alignment is not green.");

const state = JSON.parse(readFileSync(resolve(root, "release/production-migration-state.json"), "utf8"));
assert.equal(attestation.schema_fingerprint, state.target.canonical_source_schema_fingerprint,
  "Signed release schema does not equal the reviewed target schema.");
const githubActions = String(process.env.GITHUB_ACTIONS || "").trim().toLowerCase() === "true";
assert.equal(githubActions, true, "Production release recording is restricted to the gated GitHub Actions workflow.");
const provenance = {
  kind: "github-actions",
  repository: requiredEnv("GITHUB_REPOSITORY"),
  run_id: requiredEnv("GITHUB_RUN_ID"),
  run_attempt: requiredEnv("GITHUB_RUN_ATTEMPT"),
  workflow_sha: requiredEnv("GITHUB_SHA").toLowerCase(),
  actor: requiredEnv("GITHUB_ACTOR"),
};
assert.equal(provenance.workflow_sha, attestation.backend_commit_sha,
  "Recorder workflow is not executing the signed release commit.");
const migrations = migrationManifest();
assert.equal(migrations.length, state.target.source_authority_migration_count,
  "Migration source count differs from the reviewed release target.");
const migrationManifestDigest = migrationManifestSha256(migrations);
const runtimeContractPath = resolve(root, "release/disaster-recovery-runtime-contract.json");
const runtimeContract = loadRecoveryRuntimeContract(runtimeContractPath);
const runtimeConfigurationText = requiredEnv("BACKUP_RUNTIME_CONFIGURATION_JSON");
const runtimeConfiguration = JSON.parse(runtimeConfigurationText);
const projectRef = requiredEnv("SUPABASE_PROJECT_REF");
assert.equal(projectRef, state.project_ref, "Recorder targets a different Supabase project.");
const target = {
  release_id: attestation.release_id,
  backend_commit: attestation.backend_commit_sha,
  frontend_commit: attestation.frontend_commit_sha,
  migration_head: state.target.source_migration_version,
  migration_manifest_sha256: migrationManifestDigest,
  environment_contract_version: runtimeContract.format,
  status: "deployed",
};
validateRecoveryRuntimeConfiguration({ contract: runtimeContract, configuration: runtimeConfiguration,
  releaseIdentity: target, projectRef });
const runtimeConfigurationSha256 = sha256(stableJson(runtimeConfiguration));
const databaseUrl = String(process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || "").trim();
assert.ok(databaseUrl, "SUPABASE_DB_URL or DATABASE_URL is required.");
const databaseCaCertPath = requiredEnv("SUPABASE_DB_CA_CERT_PATH");
const client = new Client({ connectionString: databaseUrl,
  application_name: "memphis-zoo-production-release-recorder",
  ssl: { ca: readFileSync(resolve(databaseCaCertPath), "utf8"), rejectUnauthorized: true } });
await client.connect();
try {
  await client.query(apply ? "begin" : "begin read only");
  if (apply) await client.query("select public.custodial_begin_application_mutation()");
  const ledger = await client.query(`select count(*)::int ledger_count,max(version)::text ledger_head
    from supabase_migrations.schema_migrations`);
  assert.deepEqual(ledger.rows[0], {
    ledger_count: state.target.production_ledger_count,
    ledger_head: state.target.source_migration_version,
  }, "Production migration ledger is not the exact admitted target.");
  const current = await client.query(`select release_id,backend_commit,frontend_commit,migration_head,
    migration_manifest_sha256,environment_contract_version,status,details_json,created_at,deployed_at
    from public.release_deployment_manifest where release_id=$1 ${apply ? "for update" : ""}`,
  [target.release_id]);
  const deployed = await client.query(`select release_id,backend_commit,frontend_commit,migration_head,
    migration_manifest_sha256,environment_contract_version,status,details_json,created_at,deployed_at
    from public.release_deployment_manifest where status='deployed' order by release_id ${apply ? "for update" : ""}`);
  const currentBase = current.rows[0] || null;
  const otherDeployed = deployed.rows.filter((row) => row.release_id !== target.release_id);
  const plan = buildRecordingPlan({ currentBase, otherDeployed, target, liveCheck, provenance, runtimeConfigurationSha256 });
  if (!apply) {
    await client.query("rollback");
    console.log(JSON.stringify({ ok: true, apply: false, plan }, null, 2));
  } else {
    assert.equal(requiredEnv("PRODUCTION_RELEASE_RECORD_EXPECTED_PLAN_SHA256"), plan.plan_sha256,
      "Recording plan changed after operator review.");
    const recordedAt = new Date().toISOString();
    if (currentBase && !sameReleaseIdentity(currentBase, target)) {
      const archiveDetails = { ...(currentBase.details_json || {}), archived_at: recordedAt,
        archived_from_release_id: target.release_id, archived_by: "production-release-recorder.v1" };
      await client.query(`insert into public.release_deployment_manifest(
        release_id,backend_commit,frontend_commit,migration_head,migration_manifest_sha256,
        environment_contract_version,status,details_json,created_at,deployed_at)
        values($1,$2,$3,$4,$5,$6,'retired',$7::jsonb,$8,$9) on conflict (release_id) do nothing`, [
        plan.archive_release_id,currentBase.backend_commit,currentBase.frontend_commit,currentBase.migration_head,
        currentBase.migration_manifest_sha256,currentBase.environment_contract_version,JSON.stringify(archiveDetails),
        currentBase.created_at,currentBase.deployed_at,
      ]);
      const archive = await client.query(`select release_id,backend_commit,frontend_commit,migration_head,
        migration_manifest_sha256,environment_contract_version,status from public.release_deployment_manifest where release_id=$1`,
      [plan.archive_release_id]);
      assert.equal(archive.rowCount, 1, "Previous base release identity was not archived.");
      assert.equal(archive.rows[0].backend_commit, currentBase.backend_commit, "Archived backend identity conflicts.");
      assert.equal(archive.rows[0].frontend_commit, currentBase.frontend_commit, "Archived frontend identity conflicts.");
      assert.equal(archive.rows[0].migration_head, currentBase.migration_head, "Archived migration identity conflicts.");
      assert.equal(archive.rows[0].migration_manifest_sha256, currentBase.migration_manifest_sha256, "Archived migration manifest conflicts.");
      assert.equal(archive.rows[0].environment_contract_version, currentBase.environment_contract_version, "Archived environment contract conflicts.");
      assert.equal(archive.rows[0].status, "retired", "Archived release must be retained as history, not selected as live.");
    }
    const otherDeployedById = new Map(otherDeployed.map((row) => [row.release_id, row]));
    for (const retirement of plan.prior_deployed_releases) {
      const original = otherDeployedById.get(retirement.identity.release_id);
      assert.ok(original, `Superseded deployed release ${retirement.identity.release_id} disappeared after planning.`);
      assert.equal(sameReleaseIdentity(original, retirement.identity), true,
        `Superseded deployed release ${retirement.identity.release_id} changed after planning.`);
      const archiveDetails = { ...(original.details_json || {}), archived_at: recordedAt,
        archived_from_release_id: original.release_id, archived_by: "production-release-recorder.v1",
        superseded_by_release_id: target.release_id };
      await client.query(`insert into public.release_deployment_manifest(
        release_id,backend_commit,frontend_commit,migration_head,migration_manifest_sha256,
        environment_contract_version,status,details_json,created_at,deployed_at)
        values($1,$2,$3,$4,$5,$6,'retired',$7::jsonb,$8,$9) on conflict (release_id) do nothing`, [
        retirement.archive_release_id,original.backend_commit,original.frontend_commit,original.migration_head,
        original.migration_manifest_sha256,original.environment_contract_version,JSON.stringify(archiveDetails),
        original.created_at,original.deployed_at,
      ]);
      const archive = await client.query(`select release_id,backend_commit,frontend_commit,migration_head,
        migration_manifest_sha256,environment_contract_version,status from public.release_deployment_manifest where release_id=$1`,
      [retirement.archive_release_id]);
      assert.equal(archive.rowCount, 1, `Superseded deployed release ${original.release_id} was not archived.`);
      for (const field of ["backend_commit","frontend_commit","migration_head","migration_manifest_sha256","environment_contract_version"]) {
        assert.equal(archive.rows[0][field], original[field], `Archived superseded release ${original.release_id} conflicts on ${field}.`);
      }
      assert.equal(archive.rows[0].status, "retired", "Archived superseded release must be retained as history.");
      const retiredDetails = { ...(original.details_json || {}), retired_at: recordedAt,
        retired_by: "production-release-recorder.v1", archived_as_release_id: retirement.archive_release_id,
        superseded_by_release_id: target.release_id };
      const retired = await client.query(`update public.release_deployment_manifest set status='retired',details_json=$8::jsonb
        where release_id=$1 and backend_commit=$2 and frontend_commit=$3 and migration_head=$4
          and migration_manifest_sha256=$5 and environment_contract_version=$6 and status=$7`, [
        original.release_id,original.backend_commit,original.frontend_commit,original.migration_head,
        original.migration_manifest_sha256,original.environment_contract_version,"deployed",JSON.stringify(retiredDetails),
      ]);
      assert.equal(retired.rowCount, 1, `Superseded deployed release ${original.release_id} was not retired exactly once.`);
    }
    const details = {
      recorder: "production-release-recorder.v1", recorded_at: recordedAt, provenance,
      plan_sha256: plan.plan_sha256, schema_fingerprint: attestation.schema_fingerprint,
      backend_tree_sha: attestation.backend_tree_sha,
      backend_evidence_sha256: attestation.backend_evidence_sha256,
      runtime_configuration_sha256: runtimeConfigurationSha256,
      migration_manifest_digest_format: "sha256(stableJson(live_release_manifest.schema.migrations))",
      backend_service_id: runtimeConfiguration.services.backend.service_id,
      backend_deployment_id: runtimeConfiguration.services.backend.deployment_id,
      static_weekly_service_id: runtimeConfiguration.services.static_weekly_control_plane.service_id,
      static_weekly_deployment_id: runtimeConfiguration.services.static_weekly_control_plane.deployment_id,
      archived_previous_base_release_id: plan.archive_release_id,
      prior_deployed_release_ids: plan.prior_deployed_release_ids,
    };
    await client.query(`insert into public.release_deployment_manifest(
      release_id,backend_commit,frontend_commit,migration_head,migration_manifest_sha256,
      environment_contract_version,status,details_json,created_at,deployed_at)
      values($1,$2,$3,$4,$5,$6,'deployed',$7::jsonb,clock_timestamp(),clock_timestamp())
      on conflict (release_id) do update set backend_commit=excluded.backend_commit,
      frontend_commit=excluded.frontend_commit,migration_head=excluded.migration_head,
      migration_manifest_sha256=excluded.migration_manifest_sha256,
      environment_contract_version=excluded.environment_contract_version,status='deployed',
      details_json=excluded.details_json,deployed_at=excluded.deployed_at`, [
      target.release_id,target.backend_commit,target.frontend_commit,target.migration_head,
      target.migration_manifest_sha256,target.environment_contract_version,JSON.stringify(details),
    ]);
    await client.query(`insert into public.release_validation_runs(release_id,area,status,details_json)
      values($1,'production_release_deployment_recording','pass',$2::jsonb)`, [target.release_id,
      JSON.stringify({ plan_sha256: plan.plan_sha256, target, live_check: liveCheck,
        runtime_configuration_sha256: runtimeConfigurationSha256,
        archive_release_id: plan.archive_release_id, prior_deployed_release_ids: plan.prior_deployed_release_ids })]);
    const selected = await client.query(`select release_id,backend_commit,frontend_commit,migration_head,
      migration_manifest_sha256,environment_contract_version,status from public.release_deployment_manifest
      where status='deployed' order by deployed_at desc nulls last,created_at desc,release_id`);
    assert.equal(selected.rowCount, 1, "Recording must leave exactly one deployed release identity.");
    assert.equal(sameReleaseIdentity(selected.rows[0], target), true,
      "The newly selected deployed release does not equal the signed target.");
    await client.query("commit");
    console.log(JSON.stringify({ ok: true, apply: true, plan_sha256: plan.plan_sha256,
      release_id: target.release_id, archived_release_id: plan.archive_release_id,
      prior_deployed_release_ids: plan.prior_deployed_release_ids, runtime_configuration_sha256: runtimeConfigurationSha256 }, null, 2));
  }
} catch (error) {
  try { await client.query("rollback"); } catch {}
  throw error;
} finally {
  await client.end();
}
