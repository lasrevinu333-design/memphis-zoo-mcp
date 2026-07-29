import assert from "node:assert/strict";

const frontendUrl = process.env.FRONTEND_DEPLOYMENT_MANIFEST_URL
  || "https://lasrevinu333-design.github.io/Engine/frontend-deployment-manifest.json";
const backendUrl = process.env.BACKEND_RELEASE_MANIFEST_URL
  || "https://memphis-zoo-mcp.onrender.com/release-manifest";

async function fetchJson(url, label) {
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`${label} returned HTTP ${response.status}`);
  return response.json();
}

const [frontend, backend] = await Promise.all([
  fetchJson(frontendUrl, "frontend deployment manifest"),
  fetchJson(backendUrl, "backend release manifest"),
]);

assert.match(frontend.frontend_commit_sha || "", /^[a-f0-9]{40}$/, "frontend deployment commit is invalid");
assert.match(backend.backend?.commit_sha || "", /^[a-f0-9]{40}$/, "backend deployment commit is invalid");
assert.equal(backend.frontend?.commit_sha, frontend.frontend_commit_sha, "backend advertises a stale frontend commit");
assert.equal(backend.release_id, frontend.release_id, "frontend and backend release ids differ");
assert.equal(backend.schema?.fingerprint, frontend.schema_fingerprint, "frontend and backend schema fingerprints differ");

console.log(JSON.stringify({
  ok: true,
  release_id: backend.release_id,
  backend_commit_sha: backend.backend.commit_sha,
  frontend_commit_sha: frontend.frontend_commit_sha,
  schema_fingerprint: backend.schema.fingerprint,
}, null, 2));
