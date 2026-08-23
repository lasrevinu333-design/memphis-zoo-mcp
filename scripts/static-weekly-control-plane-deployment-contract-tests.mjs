#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const deployment = readFileSync(new URL("../deploy/static-weekly-control-plane.render.yaml", import.meta.url), "utf8");
const runtime = readFileSync(new URL("../src/static-weekly-control-plane-runtime.js", import.meta.url), "utf8");
const runtimeIdentity = readFileSync(new URL("../supabase/migrations/20260823024500_provision_static_weekly_runtime_identity.sql", import.meta.url), "utf8");
const packageManifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

assert.match(deployment, /^services:\n  - type: web\n    name: memphis-zoo-static-weekly-control-plane\n/m);
assert.match(deployment, /\n    plan: starter\n/, "the explicitly approved production scheduler uses exactly one Starter service");
assert.match(deployment, /\n    region: virginia\n/, "the scheduler must remain co-located with the existing Virginia backend");
assert.match(deployment, /\n    branch: main\n/, "production deployment must consume only the accepted main branch");
assert.match(deployment, /\n    autoDeployTrigger: off\n/, "source changes must not silently deploy the scheduler authority");
assert.match(deployment, /\n    healthCheckPath: \/healthz\n/);
assert.match(deployment, /\n    maxShutdownDelaySeconds: 30\n/);
assert.match(deployment, /\n      - key: NODE_VERSION\n        value: 22\.23\.1\n/);
assert.match(deployment, /\n      - key: STATIC_WEEKLY_CONTROL_PLANE_DATABASE_URL\n        sync: false\n/);
assert.match(deployment, /\n      - key: STATIC_WEEKLY_CONTROL_PLANE_DATABASE_CA_PEM\n        sync: false\n/);
assert.match(deployment, /\n      - key: SUPABASE_SERVICE_ROLE_KEY\n        sync: false\n/);
assert.match(deployment, /\n      - key: OPS_MANAGER_SESSION_SECRET\n        sync: false\n/);
assert.match(deployment, /\n      - key: MEMPHIS_RELEASE_ATTESTATION_JSON\n        sync: false\n/);
assert.match(deployment, /\n      - key: MEMPHIS_RELEASE_ATTESTATION_PUBLIC_KEY\n        sync: false\n/);
assert.doesNotMatch(deployment, /(?:postgres(?:ql)?:\/\/|eyJ[A-Za-z0-9_-]+\.|service_role[^\n]*value:)/i, "deployment source must not contain credentials");
assert.equal(packageManifest.scripts["start:static-weekly-control-plane"], "node src/static-weekly-control-plane-runtime.js");
assert.match(runtime, /app\.get\("\/healthz", liveness\)/);
assert.match(runtime, /app\.get\(\["\/health", "\/ready"\], readiness\)/);
assert.match(runtime, /assertConfiguredReleaseIdentity/);
assert.match(runtime, /assertOpsManagerSessionSecret/);
assert.match(runtime, /backend_tree_sha: releaseIdentity\.backend_tree_sha/);
assert.match(runtime, /caPem: env\?\.STATIC_WEEKLY_CONTROL_PLANE_DATABASE_CA_PEM/);
assert.match(runtime, /processTarget\.once\("SIGTERM", onSignal\)/);
assert.doesNotMatch(runtime, /server\.once\("SIGTERM"/);
assert.match(runtimeIdentity, /create role static_weekly_runtime_20260823[\s\S]*login[\s\S]*password null[\s\S]*noinherit/i);
assert.match(runtimeIdentity, /grant static_weekly_control_plane to static_weekly_runtime_20260823/i);
assert.match(runtimeIdentity, /revoke static_weekly_release_operator from static_weekly_runtime_20260823/i);
assert.match(runtimeIdentity, /unexpected authority membership/i);
assert.doesNotMatch(runtimeIdentity, /password\s+'[^']+'/i, "source must not contain a reusable runtime password");

console.log("static weekly control-plane deployment contract tests: PASS");
