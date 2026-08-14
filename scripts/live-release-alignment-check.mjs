#!/usr/bin/env node
import assert from "node:assert/strict";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { assertBackendFrontendIdentity, assertFrontendReleaseDeclaration, assertFrontendReleaseIdentity, assertManifestContract, assertExactReleaseAttestation, assertObservedSchemaIdentity } from "../src/release-contract.js";
import { assertSchemaAlignment } from "../src/schema-transition.js";

const root = realpathSync(resolve(fileURLToPath(new URL("..", import.meta.url))));
const canonicalInput = JSON.parse(readFileSync(resolve(root, "release/schema-alignment-input.json"), "utf8"));

function outsideRoot(path) {
  const value = relative(root, path);
  return value === ".." || value.startsWith(`..${sep}`) || isAbsolute(value);
}

function requiredEnv(name) {
  const value = String(process.env[name] || "").trim();
  assert.ok(value, `${name} is required; no final frontend or schema observation is guessed from source`);
  return value;
}

function readReadonlyExternalAttestation(path) {
  assert.ok(isAbsolute(path), "LIVE_RELEASE_ATTESTATION_INPUT must be an absolute external path");
  const entry = lstatSync(path);
  assert.equal(entry.isSymbolicLink(), false, "LIVE_RELEASE_ATTESTATION_INPUT must not be a symlink");
  assert.equal(entry.isFile(), true, "LIVE_RELEASE_ATTESTATION_INPUT must be a regular file");
  assert.equal(entry.mode & 0o777, 0o444, "LIVE_RELEASE_ATTESTATION_INPUT must be mode 0444");
  const real = realpathSync(path);
  assert.ok(outsideRoot(real), "LIVE_RELEASE_ATTESTATION_INPUT must be outside this worktree");
  const publicKeyPem = requiredEnv("MEMPHIS_RELEASE_ATTESTATION_PUBLIC_KEY").replaceAll("\\n", "\n");
  return assertExactReleaseAttestation(JSON.parse(readFileSync(real, "utf8")), { publicKeyPem });
}

async function fetchJson(url, label, headers = {}) {
  const response = await fetch(url, { headers: { accept: "application/json", ...headers }, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`${label} returned HTTP ${response.status}`);
  return response.json();
}

async function fetchTimedJson(url, label, headers = {}) {
  const startedAt = performance.now();
  const json = await fetchJson(url, label, headers);
  return { json, elapsed_ms: performance.now() - startedAt };
}

const attestation = readReadonlyExternalAttestation(requiredEnv("LIVE_RELEASE_ATTESTATION_INPUT"));
const backendUrl = requiredEnv("BACKEND_RELEASE_MANIFEST_URL");
const frontendReleaseUrl = requiredEnv("FRONTEND_RELEASE_MANIFEST_URL");
const frontendDeploymentUrl = requiredEnv("FRONTEND_DEPLOYMENT_MANIFEST_URL");
const schemaToken = requiredEnv("LIVE_RELEASE_SCHEMA_IDENTITY_TOKEN");
const identityUrl = String(process.env.BACKEND_SCHEMA_IDENTITY_URL || new URL("/admin-api/release-schema-identity", backendUrl).toString());
const healthUrl = String(process.env.BACKEND_HEALTH_URL || new URL("/health", backendUrl).toString());
const authorityHealthUrl = String(process.env.BACKEND_AUTHORITY_HEALTH_URL || new URL("/scan-api/authority-health", backendUrl).toString());
const schedulerReadyUrl = requiredEnv("STATIC_WEEKLY_CONTROL_PLANE_READY_URL");

const [frontend, deployment, backend, observed, healthProbe, authorityHealth, schedulerReady] = await Promise.all([
  fetchJson(frontendReleaseUrl, "frontend release manifest"),
  fetchJson(frontendDeploymentUrl, "frontend deployment manifest"),
  fetchJson(backendUrl, "backend release manifest"),
  fetchJson(identityUrl, "authenticated production schema identity", { authorization: `Bearer ${schemaToken}` }),
  fetchTimedJson(healthUrl, "backend dependency health"),
  fetchJson(authorityHealthUrl, "canonical custodial authority health"),
  fetchJson(schedulerReadyUrl, "static weekly scheduler readiness"),
]);
const health = healthProbe.json;

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
assertObservedSchemaIdentity(observed, backend.schema?.fingerprint);
const schemaAlignment = assertSchemaAlignment({ backendManifest: backend, frontendManifest: frontend, deploymentManifest: deployment });
assert.equal(health.ok, true, "backend dependency health is not green");
assert.equal(health.database_reachable, true, "backend cannot reach its database");
assert.equal(health.required_schema_present, true, "backend required schema is incomplete");
assert.equal(health.worker?.dead_letters, 0, "backend has dead operational jobs");
assert.equal(health.worker?.expired_leases, 0, "backend has expired operational-job leases");
assert.ok(healthProbe.elapsed_ms <= 4_000, `backend dependency health exceeded four seconds (${healthProbe.elapsed_ms.toFixed(0)} ms)`);
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
assert.equal(health.release_canary?.configured, true, "one-phone release canary is not configured");
assert.equal(health.release_canary?.control_initialized, true, "one-phone release canary control is not initialized");
assert.equal(health.release_canary?.paused, false, "one-phone release canary remains operator-paused");
assert.equal(authorityHealth.data?.release_canary?.configured, true, "authority health does not expose the configured canary");
assert.equal(authorityHealth.data?.release_canary?.control_initialized, true, "authority health does not prove initialized canary control");
assert.equal(authorityHealth.data?.release_canary?.paused, false, "authority health reports an operator-paused canary");
assert.equal(schedulerReady.ok, true, "static weekly scheduler readiness is not green");
assert.equal(schedulerReady.data?.ready, true, "static weekly scheduler authority is not ready");
assert.equal(schedulerReady.data?.solver?.available, true, "static weekly HiGHS solver is unavailable");
for (const field of ["release_id", "backend_commit_sha", "backend_tree_sha", "frontend_commit_sha", "schema_fingerprint"]) {
  assert.equal(schedulerReady.release_identity?.[field], attestation[field], `static weekly scheduler ${field} is not the signed exact attestation`);
}

console.log(JSON.stringify({ ok: true, release_id: attestation.release_id, backend_commit_sha: attestation.backend_commit_sha,
  backend_tree_sha: attestation.backend_tree_sha, backend_evidence_sha256: attestation.backend_evidence_sha256,
  frontend_commit_sha: attestation.frontend_commit_sha, observed_production_schema_fingerprint: observed.fingerprint,
  schema_alignment_mode: schemaAlignment.mode, schema_transition_id: schemaAlignment.transition?.transition_id || null,
  backend_health_latency_ms: Math.round(healthProbe.elapsed_ms), operational_backlog: health.worker?.backlog || 0 }, null, 2));
