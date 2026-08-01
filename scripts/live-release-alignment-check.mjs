import assert from "node:assert/strict";
import { assertSchemaAlignment } from "../src/schema-transition.js";

const frontendReleaseUrl = process.env.FRONTEND_RELEASE_MANIFEST_URL
  || "https://lasrevinu333-design.github.io/Engine/frontend-release-manifest.json";
const frontendDeploymentUrl = process.env.FRONTEND_DEPLOYMENT_MANIFEST_URL
  || "https://lasrevinu333-design.github.io/Engine/frontend-deployment-manifest.json";
const backendUrl = process.env.BACKEND_RELEASE_MANIFEST_URL
  || "https://memphis-zoo-mcp.onrender.com/release-manifest";

async function fetchJson(url, label, extraHeaders = {}) {
  const response = await fetch(url, {
    headers: { accept: "application/json", ...extraHeaders },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`${label} returned HTTP ${response.status}`);
  return response.json();
}

async function verifyForwardFrontendRelease(baseline, deployed) {
  assert.match(baseline || "", /^[a-f0-9]{40}$/, "backend frontend baseline commit is invalid");
  assert.match(deployed || "", /^[a-f0-9]{40}$/, "frontend deployment commit is invalid");
  if (baseline === deployed) return "identical";
  const headers = { accept: "application/vnd.github+json" };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const comparison = await fetchJson(
    `https://api.github.com/repos/lasrevinu333-design/Engine/compare/${baseline}...${deployed}`,
    "frontend commit comparison",
    headers,
  );
  assert.equal(comparison.status, "ahead", "frontend deployment is not a verified descendant of the backend baseline");
  return comparison.status;
}

const [frontend, deployment, backend] = await Promise.all([
  fetchJson(frontendReleaseUrl, "frontend release manifest"),
  fetchJson(frontendDeploymentUrl, "frontend deployment manifest"),
  fetchJson(backendUrl, "backend release manifest"),
]);

assert.match(deployment.frontend_commit_sha || "", /^[a-f0-9]{40}$/, "frontend deployment commit is invalid");
assert.match(backend.backend?.commit_sha || "", /^[a-f0-9]{40}$/, "backend deployment commit is invalid");
const frontendCommitState = await verifyForwardFrontendRelease(backend.frontend?.commit_sha, deployment.frontend_commit_sha);
assert.equal(backend.release_id, frontend.release_id, "frontend and backend release ids differ");
assert.equal(deployment.release_id, frontend.release_id, "frontend release and deployment ids differ");
const schemaAlignment = assertSchemaAlignment({ backendManifest: backend, frontendManifest: frontend, deploymentManifest: deployment });

console.log(JSON.stringify({
  ok: true,
  release_id: backend.release_id,
  backend_commit_sha: backend.backend.commit_sha,
  frontend_commit_sha: deployment.frontend_commit_sha,
  frontend_commit_state: frontendCommitState,
  schema_alignment_mode: schemaAlignment.mode,
  schema_transition_id: schemaAlignment.transition?.transition_id || null,
  schema_fingerprint: backend.schema.fingerprint,
}, null, 2));
