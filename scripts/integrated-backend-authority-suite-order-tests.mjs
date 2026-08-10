#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
assert.equal(args.length, 2, "usage: integrated-backend-authority-suite-order-tests.mjs --order final-first|named-first");
assert.equal(args[0], "--order", "usage: integrated-backend-authority-suite-order-tests.mjs --order final-first|named-first");
const order = args[1];
assert.ok(["final-first", "named-first"].includes(order), "order must be final-first or named-first");

const container = String(process.env.CUSTODIAL_SUITE_ORDER_DOCKER_CONTAINER || "").trim();
const database = String(process.env.CUSTODIAL_SUITE_ORDER_DATABASE || "postgres").trim();
assert.match(container, /^mz_schema_rebuild_[a-zA-Z0-9_]+$/, "suite-order proof requires an owned disposable schema-rebuild container");
assert.match(database, /^(postgres|mz_schema_rebuild_[a-zA-Z0-9_]+)$/, "suite-order proof requires a disposable database");

const env = {
  ...process.env,
  CUSTODIAL_FINAL_OPERATIONAL_TEST_DOCKER_CONTAINER: container,
  CUSTODIAL_FINAL_OPERATIONAL_TEST_DATABASE: database,
  NAMED_MANAGER_RETIREMENT_TEST_DOCKER_CONTAINER: container,
  NAMED_MANAGER_RETIREMENT_TEST_DATABASE: database,
  SCHEMA_FINGERPRINT_DOCKER_CONTAINER: container,
  SCHEMA_FINGERPRINT_DATABASE: database,
  SCHEMA_FINGERPRINT_MCP_URL: "",
};
const scripts = order === "final-first"
  ? ["scripts/final-operational-correction-database-tests.mjs", "scripts/named-manager-messenger-retirement-correction-database-tests.mjs"]
  : ["scripts/named-manager-messenger-retirement-correction-database-tests.mjs", "scripts/final-operational-correction-database-tests.mjs"];

for (const script of scripts) {
  execFileSync(process.execPath, [script], { env, stdio: "inherit" });
}
const fingerprintOutput = execFileSync(process.execPath, ["scripts/refresh-schema-fingerprint.mjs", "--check"], {
  env,
  encoding: "utf8",
});
const fingerprintResult = JSON.parse(fingerprintOutput);
const expectedFingerprint = readFileSync("supabase/canonical/schema-fingerprint.txt", "utf8").trim();
assert.equal(fingerprintResult.schema_fingerprint, expectedFingerprint, "post-suite schema fingerprint changed");
const cleanup = execFileSync("docker", [
  "exec", container, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-At", "-U", "supabase_admin", "-d", database, "-c", `
    select json_build_object(
      'barrier_absent', to_regclass('public.named_manager_test_barrier') is null,
      'claimed_final_operational', (
        select count(*)::int from public.custodial_offline_reconciliation_outbox
        where notification_key like 'final-operational:%' and state='claimed'
      ),
      'active_final_operational', (
        select count(*)::int from public.custodial_offline_reconciliation_outbox
        where notification_key like 'final-operational:%' and state in ('pending','claimed','retry')
      )
    )::text;
  `,
], { encoding: "utf8" }).trim().split("\n").at(-1);
const cleanupResult = JSON.parse(cleanup);
assert.deepEqual(cleanupResult, {
  barrier_absent: true,
  claimed_final_operational: 0,
  active_final_operational: 0,
}, "suite order left a schema fixture or active notification claim");

console.log(JSON.stringify({
  ok: true,
  order,
  schema_fingerprint: fingerprintResult.schema_fingerprint,
  cleanup: cleanupResult,
}, null, 2));
