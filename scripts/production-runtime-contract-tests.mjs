#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const releaseManifestSource = readFileSync(new URL("../src/release-manifest.js", import.meta.url), "utf8");
const monitor = readFileSync(new URL("../.github/workflows/production-availability-monitor.yml", import.meta.url), "utf8");
const operationalLiveMonitor = readFileSync(new URL("../.github/workflows/operational-recovery-live.yml", import.meta.url), "utf8");
const warmBridgeCreateMigration = readFileSync(new URL("../supabase/migrations/20260730221607_production_availability_warm_bridge.sql", import.meta.url), "utf8");
const warmBridgeRetirementMigration = readFileSync(new URL("../supabase/migrations/20260731003221_deactivate_render_free_tier_warm_bridge.sql", import.meta.url), "utf8");
const packageManifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

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
assert.equal(packageManifest.scripts.start, "node src/index.js",
  "production must start the canonical application directly");
assert.equal(existsSync(new URL("../src/mcp-schema-bootstrap.js", import.meta.url)), false,
  "prototype-interception schema bootstrap must not return");
assert.equal(existsSync(new URL("../src/mcp-readonly-bootstrap.js", import.meta.url)), false,
  "prototype-interception read-only bootstrap must not return");
assert.doesNotMatch(source, /prototype\.(?:tool|listen)\s*=/,
  "canonical production startup must not alter framework prototypes");
assert.match(releaseManifestSource, /final_rebind_required/,
  "source must not guess a final frontend identity");

assert.match(monitor, /cron: "\*\/10 \* \* \* \*"/,
  "the independent availability monitor must probe every ten minutes");
assert.match(monitor, /LIVE_RELEASE_PAIR_INPUT/,
  "availability monitor must require an exact final frontend/backend pair");
assert.match(monitor, /LIVE_RELEASE_SCHEMA_IDENTITY_TOKEN/,
  "availability monitor must authenticate the connected-schema observation");
assert.match(monitor, /release:live:check/,
  "availability monitor must run the fail-closed release gate");
assert.match(operationalLiveMonitor, /rollout_attempt=\$rollout_attempt/,
  "live operational acceptance must bypass caches while Render revisions converge");
assert.match(operationalLiveMonitor, /all_endpoints_current=false[\s\S]*for rollout_attempt in \$\(seq 1 60\)/,
  "live operational acceptance must tolerate rolling-deployment routing");
assert.match(operationalLiveMonitor, /test "\$all_endpoints_current" = true/,
  "live operational acceptance must still reject endpoints that never reach the expected commit");
assert.match(warmBridgeCreateMigration, /mz-render-availability-warm-bridge/,
  "the historical Render warm bridge must retain a stable cron identity");
assert.match(warmBridgeCreateMigration, /'\*\/10 \* \* \* \*'/,
  "the historical warm bridge must document its original schedule");
assert.match(warmBridgeRetirementMigration, /cron\.alter_job/,
  "Render Starter must retire the Free-tier bridge through pg_cron's supported API");
assert.match(warmBridgeRetirementMigration, /active\s*:=\s*false/,
  "the Free-tier warm bridge must be inactive on Render Starter");
assert.doesNotMatch(warmBridgeRetirementMigration, /cron\.schedule/,
  "the retirement migration must not recreate the Free-tier bridge");

console.log(JSON.stringify({ ok: true, production_runtime_contract: "passed" }, null, 2));
