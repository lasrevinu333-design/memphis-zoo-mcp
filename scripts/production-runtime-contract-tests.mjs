#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const releaseManifestSource = readFileSync(new URL("../src/release-manifest.js", import.meta.url), "utf8");
const monitor = readFileSync(new URL("../.github/workflows/production-availability-monitor.yml", import.meta.url), "utf8");

assert.match(source, /app\.get\(\["\/health", "\/health\/dependencies"\]/,
  "canonical /health must execute the dependency-aware readiness check");
assert.match(source, /const httpServer = app\.listen/,
  "the HTTP server handle must be retained for graceful draining");
assert.match(source, /process\.once\("SIGTERM"/,
  "Render SIGTERM must initiate graceful shutdown");
assert.match(source, /geminiControlledRepairWorker\.stop\(\)/,
  "background repair work must stop during shutdown");
assert.match(source, /httpServer\.close/,
  "active HTTP work must drain during shutdown");
assert.match(releaseManifestSource, /frontendManifest\?\.frontend_commit_sha \|\| process\.env\.FRONTEND_COMMIT_SHA/,
  "the coordinated source manifest must outrank stale hosting metadata");

assert.match(monitor, /cron: "\*\/10 \* \* \* \*"/,
  "the availability bridge must probe inside Render's idle interval");
assert.match(monitor, /--max-time 4/,
  "availability probes must enforce the four-second response budget");
assert.match(monitor, /database_reachable/);
assert.match(monitor, /required_schema_present/);
assert.match(monitor, /dead_letters/);
assert.match(monitor, /expired_leases/);
assert.match(monitor, /version\['version'\] == frontend\['release_id'\]/,
  "the monitor must reject frontend/backend release drift");
assert.match(monitor, /frontend-deployment-manifest\.json/,
  "the monitor must load the live Pages deployment identity");
assert.match(monitor, /version\['release_manifest'\]\['frontend'\]\['commit_sha'\] == deployment\['frontend_commit_sha'\]/,
  "the monitor must reject exact frontend deployment commit drift");
assert.match(monitor, /deployment\['schema_fingerprint'\] == frontend\['schema_fingerprint'\]/,
  "the monitor must reject deployment schema drift");

console.log(JSON.stringify({ ok: true, production_runtime_contract: "passed" }, null, 2));
