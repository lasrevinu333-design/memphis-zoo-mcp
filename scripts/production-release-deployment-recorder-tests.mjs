import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { archivedReleaseId, buildRecordingPlan, migrationManifestSha256, sameReleaseIdentity } from "../src/production-release-deployment-recorder.js";

const prior = {
  release_id: "release-2026.07.19.custodial-v3.12",
  backend_commit: "a".repeat(40), frontend_commit: "b".repeat(40),
  migration_head: "20260920010000", migration_manifest_sha256: "c".repeat(64),
  environment_contract_version: "memphis-zoo.disaster-recovery-runtime-contract.v1", status: "deployed",
  details_json: { provenance: { run_id: 'A1', actor: 'synthetic-manager' } },
  created_at: '2026-09-23T00:00:00.123456Z', deployed_at: '2026-09-23T01:00:00.654321Z',
};
const target = {
  ...prior, backend_commit: "d".repeat(40), frontend_commit: "e".repeat(40),
  migration_head: "20260922090000", migration_manifest_sha256: "f".repeat(64),
};
assert.equal(sameReleaseIdentity(prior, { ...prior }), true);
assert.equal(sameReleaseIdentity(prior, target), false);
assert.notEqual(archivedReleaseId(prior), archivedReleaseId({ ...prior, details_json: { provenance: { run_id: 'A2' } } }), 'archive must bind occurrence provenance');
assert.notEqual(archivedReleaseId(prior), archivedReleaseId({ ...prior, deployed_at: '2026-09-23T01:00:00.654322Z' }), 'archive must preserve sub-millisecond deployment times');
assert.match(archivedReleaseId(prior), /^release-2026\.07\.19\.custodial-v3\.12-history-v2-[0-9a-f]{64}$/);
assert.equal(archivedReleaseId(prior), archivedReleaseId({ ...prior }), "archive identity must be deterministic");

const migrations = [
  { file: "supabase/migrations/20260922050000_lunch.sql", sha256: "1".repeat(64) },
  { file: "supabase/migrations/20260922090000_visit.sql", sha256: "2".repeat(64) },
];
assert.match(migrationManifestSha256(migrations), /^[0-9a-f]{64}$/);
assert.notEqual(migrationManifestSha256(migrations), migrationManifestSha256([...migrations].reverse()),
  "migration manifest digest must bind exact order");
assert.throws(() => migrationManifestSha256([]), /required/);
assert.throws(() => migrationManifestSha256([{ file: "wrong.sql", sha256: "1".repeat(64) }]), /malformed/);

const liveCheck = { ok: true, release_id: target.release_id, backend_commit_sha: target.backend_commit,
 frontend_commit_sha: target.frontend_commit, backend_tree_sha: "1".repeat(40), backend_evidence_sha256: "2".repeat(64),
 observed_production_schema_fingerprint: "3".repeat(64), schema_alignment_mode: "exact", schema_transition_id: null };
const provenance = { kind: "github-actions", repository: "owner/repo", run_id: "123", run_attempt: "1", workflow_sha: target.backend_commit, actor: "operator" };
const other = { ...prior, release_id: `${prior.release_id}-live-old`, backend_commit: "9".repeat(40) };
const plan = buildRecordingPlan({
  currentBase: prior, otherDeployed: [other], target, liveCheck, provenance,
  runtimeConfigurationSha256: "8".repeat(64),
});
assert.equal(plan.archive_release_id, archivedReleaseId(prior));
assert.deepEqual(plan.prior_deployed_release_ids, [other.release_id]);
assert.equal(plan.prior_deployed_releases[0].archive_release_id, archivedReleaseId(other));
assert.equal(sameReleaseIdentity(plan.prior_deployed_releases[0].identity, other), true);
assert.deepEqual(plan.prior_deployed_releases[0].occurrence, other);
assert.equal(plan.target.backend_commit, target.backend_commit);
assert.match(plan.plan_sha256, /^[0-9a-f]{64}$/);
assert.equal(plan.plan_sha256, buildRecordingPlan({
  currentBase: { ...prior }, otherDeployed: [{ ...other }], target: { ...target }, liveCheck: { ...liveCheck }, provenance: { ...provenance },
  runtimeConfigurationSha256: "8".repeat(64),
}).plan_sha256, "recording plan identity must be deterministic");
const replay = buildRecordingPlan({ currentBase: target, otherDeployed: [other], target,
  liveCheck, provenance, runtimeConfigurationSha256: "8".repeat(64) });
assert.equal(replay.archive_release_id, archivedReleaseId(target), "recording another deployment must retain the previous complete occurrence, even for identical code");
const recorderSource = readFileSync(new URL("./record-production-release-deployment.mjs", import.meta.url), "utf8");
assert.match(recorderSource, /PRODUCTION_RELEASE_RECORD_APPLY/);
assert.match(recorderSource, /GITHUB_ACTIONS/);
assert.match(recorderSource, /workflow is not executing the signed release commit/);
assert.match(recorderSource, /PRODUCTION_RELEASE_RECORD_EXPECTED_PLAN_SHA256/);
assert.match(recorderSource, /begin read only/);
assert.match(recorderSource, /live-release-alignment-check\.mjs/);
assert.match(recorderSource, /custodial_begin_application_mutation/);
assert.match(recorderSource, /Production migration ledger is not the exact admitted target/);
assert.match(recorderSource, /release_validation_runs/);
assert.doesNotMatch(recorderSource, /SUPABASE_SERVICE_ROLE_KEY/,
  "deployment recorder must not introduce a service-role-key shortcut");
assert.doesNotMatch(recorderSource, /delete from public\.release_deployment_manifest/i,
  "deployment recorder must preserve release history");
assert.match(recorderSource, /prior_deployed_releases/);
assert.match(recorderSource, /Superseded deployed release .* was not retired exactly once/);
assert.doesNotMatch(recorderSource, /update public\.release_deployment_manifest set status='retired'[^;]*where status='deployed'(?![^;]*release_id=\$1)/s,
  "deployment recorder must not mass-retire prior deployed history rows");
console.log("PRODUCTION_RELEASE_DEPLOYMENT_RECORDER_TESTS_PASS");
