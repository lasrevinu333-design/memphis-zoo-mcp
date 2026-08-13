#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

const output = execFileSync(process.execPath, ["scripts/empty-database-rebuild-check.mjs"], {
  env: {
    ...process.env,
    SCHEMA_REBUILD_DOCKER_IMAGE: process.env.SCHEMA_REBUILD_DOCKER_IMAGE || "supabase/postgres:17.6.1.143",
    SCHEMA_REBUILD_KEEP_DATABASE: "1",
  },
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
});
process.stdout.write(output);
const match = output.match(/\{"retained_test_container":"([^"]+)","retained_test_database":"([^"]+)"\}/);
assert.ok(match, "clean rebuild did not return its retained disposable database identity");
const [container, database] = match.slice(1);
assert.match(container, /^mz_schema_rebuild_[A-Za-z0-9_]+$/);

try {
  execFileSync(process.execPath, ["scripts/release-canary-recovery-database-tests.mjs"], {
    env: { ...process.env, RELEASE_CANARY_TEST_DOCKER_CONTAINER: container, RELEASE_CANARY_TEST_DATABASE: database },
    stdio: "inherit",
  });
  execFileSync(process.execPath, ["scripts/final-uncertainty-closure-database-tests.mjs"], {
    env: { ...process.env, FINAL_UNCERTAINTY_TEST_DOCKER_CONTAINER: container, FINAL_UNCERTAINTY_TEST_DATABASE: database },
    stdio: "inherit",
  });
} finally {
  execFileSync("docker", ["rm", "-f", container], { stdio: "ignore" });
}

console.log(JSON.stringify({ ok: true, clean_rebuild: true, release_canary_recovery: true, final_uncertainty_closure: true }, null, 2));
