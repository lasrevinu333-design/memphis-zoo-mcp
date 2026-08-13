#!/usr/bin/env node
import assert from "node:assert/strict";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { assertManifestContract, assertExactReleasePair, assertObservedSchemaIdentity } from "../src/release-contract.js";
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

function readReadonlyExternalPair(path) {
  assert.ok(isAbsolute(path), "LIVE_RELEASE_PAIR_INPUT must be an absolute external path");
  const entry = lstatSync(path);
  assert.equal(entry.isSymbolicLink(), false, "LIVE_RELEASE_PAIR_INPUT must not be a symlink");
  assert.equal(entry.isFile(), true, "LIVE_RELEASE_PAIR_INPUT must be a regular file");
  assert.equal(entry.mode & 0o777, 0o444, "LIVE_RELEASE_PAIR_INPUT must be mode 0444");
  const real = realpathSync(path);
  assert.ok(outsideRoot(real), "LIVE_RELEASE_PAIR_INPUT must be outside this worktree");
  return assertExactReleasePair(JSON.parse(readFileSync(real, "utf8")));
}

async function fetchJson(url, label, headers = {}) {
  const response = await fetch(url, { headers: { accept: "application/json", ...headers }, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`${label} returned HTTP ${response.status}`);
  return response.json();
}

const pair = readReadonlyExternalPair(requiredEnv("LIVE_RELEASE_PAIR_INPUT"));
const backendUrl = requiredEnv("BACKEND_RELEASE_MANIFEST_URL");
const frontendReleaseUrl = requiredEnv("FRONTEND_RELEASE_MANIFEST_URL");
const frontendDeploymentUrl = requiredEnv("FRONTEND_DEPLOYMENT_MANIFEST_URL");
const schemaToken = requiredEnv("LIVE_RELEASE_SCHEMA_IDENTITY_TOKEN");
const identityUrl = String(process.env.BACKEND_SCHEMA_IDENTITY_URL || new URL("/admin-api/release-schema-identity", backendUrl).toString());

const [frontend, deployment, backend, observed] = await Promise.all([
  fetchJson(frontendReleaseUrl, "frontend release manifest"),
  fetchJson(frontendDeploymentUrl, "frontend deployment manifest"),
  fetchJson(backendUrl, "backend release manifest"),
  fetchJson(identityUrl, "authenticated production schema identity", { authorization: `Bearer ${schemaToken}` }),
]);

assert.equal(backend.release_id, pair.release_id, "backend release is not the supplied exact pair");
assert.equal(frontend.release_id, pair.release_id, "frontend release is not the supplied exact pair");
assert.equal(deployment.release_id, pair.release_id, "frontend deployment is not the supplied exact pair");
assert.equal(backend.backend?.commit_sha, pair.backend_commit_sha, "backend commit is not the supplied exact pair");
assert.equal(frontend.frontend_commit_sha, pair.frontend_commit_sha, "frontend release commit is not the supplied exact pair");
assert.equal(deployment.frontend_commit_sha, pair.frontend_commit_sha, "frontend deployment commit is not the supplied exact pair");
assertManifestContract(backend, canonicalInput);
assertManifestContract(frontend, canonicalInput);
assertObservedSchemaIdentity(observed, backend.schema?.fingerprint);
const schemaAlignment = assertSchemaAlignment({ backendManifest: backend, frontendManifest: frontend, deploymentManifest: deployment });

console.log(JSON.stringify({ ok: true, release_id: pair.release_id, backend_commit_sha: pair.backend_commit_sha,
  frontend_commit_sha: pair.frontend_commit_sha, observed_production_schema_fingerprint: observed.fingerprint,
  schema_alignment_mode: schemaAlignment.mode, schema_transition_id: schemaAlignment.transition?.transition_id || null }, null, 2));
