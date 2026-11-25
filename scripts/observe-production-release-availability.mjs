#!/usr/bin/env node
import {resolveReleaseSchemaTarget} from './production-target-schema-profile.mjs';
import {createHash} from 'node:crypto';
import assert from "node:assert/strict";
import { lstatSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { assertBackendFrontendIdentity, assertFrontendReleaseDeclaration, assertFrontendReleaseIdentity, assertManifestContract, assertExactReleaseAttestation, assertObservedSchemaIdentity } from "../src/release-contract.js";
import { assertSchemaAlignment } from "../src/schema-transition.js";
import { assertDashboardReleaseCompatibility } from "../src/dashboard-release-compatibility.js";
import { assertSchedulerObservation,observeReleaseEndpoints,releaseMonitorEndpointPlan } from "./release-monitor-observations.mjs";

const root = realpathSync(resolve(fileURLToPath(new URL("..", import.meta.url))));
const canonicalInput = JSON.parse(readFileSync(resolve(root, "release/schema-alignment-input.json"), "utf8"));
const schemaTarget = resolveReleaseSchemaTarget(root);
const profileSha256 = schemaTarget.profile ? createHash("sha256").update(readFileSync(resolve(root,"release/production-target-schema-profile.json"))).digest("hex") : null;

function outsideRoot(path) {
  const value = relative(root, path);
  return value === ".." || value.startsWith(`..${sep}`) || isAbsolute(value);
}

function requiredEnv(name) {
  const value = String(process.env[name] || "").trim();
  assert.ok(value, `${name} is required; no final frontend or schema observation is guessed from source`);
  return value;
}

// The installed recovery key can attest an observed operational revision.
// The integrated release keeps the standard, stricter trust roots.
const observationRecoveryRoot = Object.freeze({
  keyId: 'memphis-release-recovery-20260928-v1',
  publicKeySpkiSha256: 'a0af17f2aabc006af0a5ea3d80e2ccbab0650c1689f7ed828ec7aeb1075c5190',
});
function readReadonlyExternalAttestation(path, {integrated = false} = {}) {
  assert.ok(isAbsolute(path), "LIVE_RELEASE_ATTESTATION_INPUT must be an absolute external path");
  const entry = lstatSync(path);
  assert.equal(entry.isSymbolicLink(), false, "LIVE_RELEASE_ATTESTATION_INPUT must not be a symlink");
  assert.equal(entry.isFile(), true, "LIVE_RELEASE_ATTESTATION_INPUT must be a regular file");
  assert.equal(entry.mode & 0o777, 0o444, "LIVE_RELEASE_ATTESTATION_INPUT must be mode 0444");
  const real = realpathSync(path);
  assert.ok(outsideRoot(real), "LIVE_RELEASE_ATTESTATION_INPUT must be outside this worktree");
  const publicKeyPem = requiredEnv("MEMPHIS_RELEASE_ATTESTATION_PUBLIC_KEY").replaceAll("\\n", "\n");
  const record = JSON.parse(readFileSync(real, "utf8"));
  const trustRoot = !integrated && record.signature?.key_id === observationRecoveryRoot.keyId
    ? observationRecoveryRoot : undefined;
  return assertExactReleaseAttestation(record, { publicKeyPem, trustRoot });
}

const reportPath = String(process.env.LIVE_RELEASE_OBSERVATION_REPORT || '').trim();
const runNumber = value => /^\d{1,24}$/.test(value || '') ? value : null;
const report = { schema:'custodial.availability-observation.v1',started_at:new Date().toISOString(),
  run_id:runNumber(process.env.GITHUB_RUN_ID),run_attempt:runNumber(process.env.GITHUB_RUN_ATTEMPT),
  release_target:null,probes:[],integrated_release:'unverified',failed_check:null };
let check = 'configuration';
try {
const attestation = readReadonlyExternalAttestation(requiredEnv("LIVE_RELEASE_ATTESTATION_INPUT"));
const schedulerInput = String(process.env.STATIC_WEEKLY_RELEASE_ATTESTATION_INPUT || '').trim();
const schedulerAttestation = schedulerInput ? readReadonlyExternalAttestation(schedulerInput) : attestation;
report.release_target={release_id:attestation.release_id,backend_commit_sha:attestation.backend_commit_sha,
  scheduler_commit_sha:schedulerAttestation.backend_commit_sha,frontend_commit_sha:attestation.frontend_commit_sha,
  deployment_schema_fingerprint:schemaTarget.deploymentFingerprint};
const plan = releaseMonitorEndpointPlan({
  backendUrl:requiredEnv('BACKEND_RELEASE_MANIFEST_URL'), frontendReleaseUrl:requiredEnv('FRONTEND_RELEASE_MANIFEST_URL'),
  frontendDeploymentUrl:requiredEnv('FRONTEND_DEPLOYMENT_MANIFEST_URL'), schedulerReadyUrl:requiredEnv('STATIC_WEEKLY_CONTROL_PLANE_READY_URL'),
  schemaToken:requiredEnv('LIVE_RELEASE_SCHEMA_IDENTITY_TOKEN'), identityUrl:process.env.BACKEND_SCHEMA_IDENTITY_URL,
  healthUrl:process.env.BACKEND_HEALTH_URL,authorityHealthUrl:process.env.BACKEND_AUTHORITY_HEALTH_URL,
});
check='endpoint_responses';
const batch = await observeReleaseEndpoints(plan);
report.probes = batch.map(item => item.observed);
assert.ok(report.probes.every(item=>item.state==='received'),'A required endpoint response was unavailable.');
const [frontend,deployment,backend,observed,health,authorityHealth,schedulerReady,dashboardCanary]=batch.map(item=>item.json);
const healthProbe = batch.find(item=>item.observed.id==='backend_dependencies');
check='dashboard_application_reader';
assertDashboardReleaseCompatibility({ canary: dashboardCanary, health, releaseId: attestation.release_id, appVersion: backend.backend?.app_version, backendCommitSha: attestation.backend_commit_sha });

check='signed_application_and_frontend';
assert.equal(backend.release_id, attestation.release_id, "backend release is not the signed exact attestation");
assert.equal(frontend.release_id, attestation.release_id, "frontend release is not the signed exact attestation");
assert.equal(deployment.release_id, attestation.release_id, "frontend deployment is not the signed exact attestation");
assert.equal(backend.backend?.commit_sha, attestation.backend_commit_sha, "backend commit is not the signed exact attestation");
assert.equal(backend.backend?.tree_sha, attestation.backend_tree_sha, "backend tree is not the signed exact attestation");
assert.equal(backend.backend?.evidence?.git_blob_sha, attestation.backend_evidence_blob_sha, "backend evidence blob is not the signed exact attestation");
assert.equal(backend.backend?.evidence?.sha256, attestation.backend_evidence_sha256, "backend evidence digest is not the signed exact attestation");
assert.equal(backend.schema?.fingerprint, attestation.schema_fingerprint, "backend schema source is not the signed exact attestation");
assert.equal(deployment.frontend_commit_sha, attestation.frontend_commit_sha, "frontend deployment commit is not the signed exact attestation");
assertManifestContract(backend, canonicalInput);
assertManifestContract(frontend, canonicalInput);
assertBackendFrontendIdentity(backend, canonicalInput);
assertFrontendReleaseDeclaration(frontend);
assertFrontendReleaseIdentity(deployment, canonicalInput);
assert.equal(backend.schema?.fingerprint, schemaTarget.canonicalFingerprint, "backend application schema is not the source canonical identity");
assert.equal(backend.schema?.deployment_fingerprint, schemaTarget.deploymentFingerprint, "backend raw target is not the closed declared production profile");
assert.equal(backend.schema?.deployment_profile_sha256, profileSha256, "backend production profile source bytes differ");
check='observed_production_schema';
assertObservedSchemaIdentity(observed, schemaTarget.deploymentFingerprint);
const schemaAlignment = assertSchemaAlignment({ backendManifest: backend, frontendManifest: frontend, deploymentManifest: deployment });
check='backend_dependencies_and_worker';
assert.equal(health.ok, true, "backend dependency health is not green");
assert.equal(health.database_reachable, true, "backend cannot reach its database");
assert.equal(health.required_schema_present, true, "backend required schema is incomplete");
assert.equal(health.worker?.dead_letters, 0, "backend has dead operational jobs");
assert.equal(health.worker?.expired_leases, 0, "backend has expired operational-job leases");
assert.ok(healthProbe.elapsedMs <= 4_000, `backend dependency health exceeded four seconds (${healthProbe.elapsedMs.toFixed(0)} ms)`);
check='custodial_authority';
assert.equal(authorityHealth.ok, true, "canonical custodial authority health endpoint failed");
assert.equal(authorityHealth.data?.ok, true, "canonical custodial authority inventory is not green");
assert.equal(authorityHealth.data?.authority, "offline-authority.v5", "canonical custodial authority contract is unexpected");
assert.ok(Number.isSafeInteger(authorityHealth.data?.canonical_objects_expected)
  && authorityHealth.data.canonical_objects_expected > 40, "canonical custodial authority inventory is incomplete");
assert.deepEqual(authorityHealth.data?.missing_objects, [], "canonical custodial authority inventory has missing objects");
assert.deepEqual(authorityHealth.data?.mismatched_objects, [], "canonical custodial authority inventory has mismatched objects");
assert.ok(authorityHealth.data?.checks && typeof authorityHealth.data.checks === "object"
  && Object.values(authorityHealth.data.checks).length > 0
  && Object.values(authorityHealth.data.checks).every((value) => value === true),
"canonical custodial authority checks are incomplete");
check='physical_release_canary';
assert.equal(health.release_canary?.configured, true, "one-phone release canary is not configured");
assert.equal(health.release_canary?.control_initialized, true, "one-phone release canary control is not initialized");
assert.equal(health.release_canary?.paused, false, "one-phone release canary remains operator-paused");
assert.equal(authorityHealth.data?.release_canary?.configured, true, "authority health does not expose the configured canary");
assert.equal(authorityHealth.data?.release_canary?.control_initialized, true, "authority health does not prove initialized canary control");
assert.equal(authorityHealth.data?.release_canary?.paused, false, "authority health reports an operator-paused canary");
check='signed_scheduler_readiness';
assertSchedulerObservation(schedulerReady,schedulerAttestation,attestation);
check='integrated_release_signer';
readReadonlyExternalAttestation(requiredEnv('LIVE_RELEASE_ATTESTATION_INPUT'), {integrated:true});
if (schedulerInput) readReadonlyExternalAttestation(schedulerInput, {integrated:true});
report.integrated_release='verified';
console.log(JSON.stringify({ ok: true, release_id: attestation.release_id, backend_commit_sha: attestation.backend_commit_sha,
  backend_tree_sha: attestation.backend_tree_sha, backend_evidence_sha256: attestation.backend_evidence_sha256,
  frontend_commit_sha: attestation.frontend_commit_sha, observed_production_schema_fingerprint: observed.fingerprint,
  schema_alignment_mode: schemaAlignment.mode, schema_transition_id: schemaAlignment.transition?.transition_id || null,
  canonical_application_schema_fingerprint: schemaTarget.canonicalFingerprint,
  expected_deployment_schema_fingerprint: schemaTarget.deploymentFingerprint, production_catalog_profile_sha256: profileSha256,
  backend_health_latency_ms: Math.round(healthProbe.elapsedMs), operational_backlog: health.worker?.backlog || 0 }, null, 2));

} catch (error) {
  report.failed_check = check;
  if (!reportPath) throw error;
  // Scheduled evidence carries fixed labels only, never endpoint credentials,
  // response bodies or database contents.
  console.error(`Release readiness is unverified at ${check}. See the endpoint observation artifact.`);
  process.exitCode = 1;
} finally {
  report.completed_at = new Date().toISOString();
  if (reportPath) writeFileSync(reportPath, JSON.stringify(report,null,2)+'\n', {flag:'wx',mode:0o600});
}
