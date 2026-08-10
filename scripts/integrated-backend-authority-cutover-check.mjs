#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const databaseMode = process.argv.includes("--database");
assert.ok(process.argv.slice(2).every((arg) => ["--database"].includes(arg)), "usage: integrated-backend-authority-cutover-check.mjs [--database]");

const input = JSON.parse(readFileSync("release/integrated-backend-authority-input.json", "utf8"));
const index = readFileSync("src/index.js", "utf8");
const phaseA = "20260810143000_offline_actor_occurrence_reconciliation.sql";
const phaseB = "20260810150000_enforce_integrated_backend_authority.sql";
const phaseC = "20260810160000_close_offline_authority_integrity_gaps.sql";

assert.equal(input.release_contract_version, "offline-authority.v3");
assert.deepEqual(input.cutover.phase_order.slice(1, 5), [
  `apply ${phaseA}`,
  "deploy the bridge backend; it falls back only on absent authoritative procedures",
  `apply ${phaseB}`,
  `apply ${phaseC}`,
]);
assert.match(index, /runPreparedScanRpc/);
assert.match(index, /\["42883", "PGRST202"\]/);
assert.match(index, /tool_complete_session_authoritative/);
assert.match(index, /fallback:/);
assert.match(readFileSync(`supabase/migrations/${phaseC}`, "utf8"), /custodial_backend_authority_health/);
assert.match(readFileSync(`supabase/migrations/${phaseC}`, "utf8"), /length\(coalesce\(p_execution_secret,''\)\)<32/);
execFileSync("git", ["merge-base", "--is-ancestor", "10e595214b3b4f6fe34132221f35aed4a32e5ccc", "HEAD"], { stdio: "ignore" });

const result = {
  ok: true,
  source_identity: input.cutover.source_identity,
  phase_order: [phaseA, phaseB, phaseC],
  bridge_fallback: "only absent authoritative procedure SQLSTATE 42883/PGRST202",
  database_gate: "not-requested",
};

if (databaseMode) {
  const container = String(process.env.CUSTODIAL_CUTOVER_DOCKER_CONTAINER || "").trim();
  const database = String(process.env.CUSTODIAL_CUTOVER_DATABASE || "postgres").trim();
  const secret = String(process.env.CUSTODIAL_BACKEND_PROOF_SECRET || "").trim();
  assert.match(container, /^mz_schema_rebuild_[a-zA-Z0-9_]+$/, "database gate requires an owned disposable rebuild container");
  assert.match(database, /^(postgres|mz_schema_rebuild_[a-zA-Z0-9_]+)$/, "database gate requires a disposable rebuild database");
  assert.ok(secret.length >= 32, "database gate requires the configured minimum-length backend proof secret");
  const q = (value) => `'${String(value).replaceAll("'", "''")}'`;
  const run = (statement) => execFileSync("docker", ["exec", container, "psql", "-v", "ON_ERROR_STOP=1", "-At", "-U", "supabase_admin", "-d", database, "-c", statement], { encoding: "utf8" }).trim();
  assert.equal(run(`select public.custodial_backend_authority_health(${q(secret)})->>'ok';`).split("\n").at(-1), "true", "configured secret must pass the canonical health gate");
  assert.equal(run(`select count(*) from information_schema.role_table_grants where table_schema='public' and grantee='service_role' and table_name in ('sessions','completion_responses','scan_events','maintenance_tickets') and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE');`).split("\n").at(-1), "0", "service role must not retain operational DML grants");
  assert.equal(run(`select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('tool_start_offline_occurrence','tool_commit_cleaning_workflow_authoritative','tool_complete_session_authoritative','custodial_backend_authority_health');`).split("\n").at(-1), "4", "bounded canonical command surface must be present");
  const directWrite = spawnSync("docker", ["exec", container, "psql", "-v", "ON_ERROR_STOP=1", "-At", "-U", "supabase_admin", "-d", database, "-c", "set role service_role; insert into public.sessions default values;"], { encoding: "utf8" });
  assert.notEqual(directWrite.status, 0, "restoration check must prove direct application DML remains denied");
  result.database_gate = "passed";
}

console.log(JSON.stringify(result, null, 2));
