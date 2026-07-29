import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const indexSource = readFileSync("src/index.js", "utf8");
const messagingSource = readFileSync("src/messaging-api.js", "utf8");
const sharedAuthSource = readFileSync("src/auth/shared-access-auth.js", "utf8");
const deviceAuthSource = readFileSync("src/auth/device-credential-auth.js", "utf8");
const releaseManifestSource = readFileSync("src/release-manifest.js", "utf8");
const frontendReleaseManifest = JSON.parse(readFileSync("release/frontend-release-manifest.json", "utf8"));
const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const migration = readFileSync("supabase/migrations/20260717161000_custodial_foundation_repair_delta.sql", "utf8");

assert.match(indexSource, /tool_start_session_v2/);
assert.match(indexSource, /p_client_session_id is required for scan start idempotency/);
assert.match(indexSource, /p_client_completion_id are required for idempotent completion/);
assert.match(indexSource, /prepareScanRpcCall/);
assert.match(indexSource, /error\?\.status/);
assert.doesNotMatch(indexSource, /create table if not exists public\.guest_cleanliness_reports/i);
assert.doesNotMatch(indexSource, /create table if not exists public\.system_feedback_items/i);
assert.match(indexSource, /storage_bucket/);
assert.match(indexSource, /supabaseAdmin\.storage/);
assert.match(indexSource, /\/release-manifest/);
assert.match(indexSource, /app\.use\(\["\/version", "\/release-manifest", "\/health\/dependencies"\]/);
assert.match(indexSource, /req\.method === "OPTIONS"/);
assert.match(indexSource, /\/health\/dependencies/);
assert.match(indexSource, /required_schema_present/);
assert.match(indexSource, /expired_worker_leases/);
assert.match(indexSource, /release_manifest/);
assert.match(indexSource, /OPERATIONAL_ANALYTICS_CONTRACT_VERSION = "operational-analytics\.v1"/);
assert.match(indexSource, /operational_analytics: OPERATIONAL_ANALYTICS_CONTRACT_VERSION/);

assert.match(releaseManifestSource, /schema-fingerprint\.txt/);
assert.match(releaseManifestSource, /supabase\/migrations/);
assert.match(releaseManifestSource, /queue_compatibility_versions/);
assert.match(releaseManifestSource, /minimum_supported/);
assert.match(frontendReleaseManifest.frontend_commit_sha, /^[a-f0-9]{40}$/);
assert.equal(frontendReleaseManifest.frontend_commit_state, "github_pages_production_verified");
assert.equal(frontendReleaseManifest.api_contract_versions.operational_analytics, "operational-analytics.v1");
assert.equal(packageJson.scripts["test:schema-fingerprint"], "node scripts/schema-fingerprint-check.mjs");
assert.equal(packageJson.scripts["test:empty-db-rebuild"], "node scripts/empty-database-rebuild-check.mjs");

assert.match(sharedAuthSource, /return isProductionLike\(env\)/);

assert.match(deviceAuthSource, /"enforce-ready"/);
assert.match(deviceAuthSource, /\["enforce-ready", "enforce"\]\.includes\(requestedMode\)/);
assert.match(migration, /'enforce-ready'::text/);
assert.match(migration, /requires_physical_acceptance/);
assert.match(migration, /storage\.buckets/);

assert.match(messagingSource, /order by coalesce\(m\.sent_at, m\.created_at\) desc, m\.id desc/);
assert.match(messagingSource, /order by coalesce\(sent_at, created_at\) asc, id asc/);
assert.match(messagingSource, /p_client_message_id: clientMessageId \|\| null/);
assert.match(messagingSource, /Sender user ID must match the authenticated viewer/);
assert.match(messagingSource, /Read acknowledgement user ID must match the authenticated viewer/);
assert.match(messagingSource, /p_user_id: viewer\.effectiveUserId/);

console.log("CUSTODIAL_REPAIR_CONTRACT_TESTS_PASS");
