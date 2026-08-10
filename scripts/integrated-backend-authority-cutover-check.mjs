#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const databaseMode = process.argv.includes("--database");
assert.ok(process.argv.slice(2).every((arg) => ["--database"].includes(arg)), "usage: integrated-backend-authority-cutover-check.mjs [--database]");

const input = JSON.parse(readFileSync("release/integrated-backend-authority-input.json", "utf8"));
const releaseEvidence = JSON.parse(readFileSync("release/integrated-backend-authority-evidence.json", "utf8"));
const index = readFileSync("src/index.js", "utf8");
const phaseA = "20260810143000_offline_actor_occurrence_reconciliation.sql";
const phaseB = "20260810150000_enforce_integrated_backend_authority.sql";
const phaseC = "20260810160000_close_offline_authority_integrity_gaps.sql";
const phaseD = "20260810170000_finish_offline_authority_operational_closure.sql";
const phaseE = "20260810190000_final_integrated_backend_operational_correction.sql";

assert.equal(input.release_contract_version, "offline-authority.v3");
assert.deepEqual(input.cutover.phase_order.slice(1, 7), [
  `apply ${phaseA}`,
  "deploy the bridge backend; it falls back only on absent authoritative procedures",
  `apply ${phaseB}`,
  `apply ${phaseC}`,
  `apply ${phaseD}`,
  `apply ${phaseE}`,
]);
assert.equal(input.cutover.source_identity.kind, "runtime_git_identity");
assert.equal(input.cutover.source_identity.commit_ref, "HEAD");
assert.equal(input.cutover.source_identity.tree_ref, "HEAD^{tree}");
assert.match(index, /runPreparedScanRpc/);
assert.match(index, /\["42883", "PGRST202"\]/);
assert.match(index, /tool_complete_session_authoritative/);
assert.match(index, /fallback:/);
assert.match(readFileSync(`supabase/migrations/${phaseC}`, "utf8"), /custodial_backend_authority_health/);
assert.match(readFileSync(`supabase/migrations/${phaseC}`, "utf8"), /length\(coalesce\(p_execution_secret,''\)\)<32/);
assert.match(readFileSync(`supabase/migrations/${phaseD}`, "utf8"), /issued_submission_proof/);
assert.match(readFileSync(`supabase/migrations/${phaseD}`, "utf8"), /custodial_claim_offline_reconciliation_notifications/);
assert.match(readFileSync(`supabase/migrations/${phaseD}`, "utf8"), /run_sql_migration\(text,text\)/);
assert.match(readFileSync(`supabase/migrations/${phaseE}`, "utf8"), /custodial_terminal_writer_inventory/);
assert.match(readFileSync(`supabase/migrations/${phaseE}`, "utf8"), /custodial_claim_offline_reconciliation_notification_recipients/);
assert.match(readFileSync(`supabase/migrations/${phaseE}`, "utf8"), /assignment_fenced_proof_recovery/);
const authorityContent = input.cutover.source_identity.authority_content_paths.map((path) => ({
  path,
  sha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
}));
const authorityContentSha256 = createHash("sha256").update(JSON.stringify(authorityContent)).digest("hex");
assert.equal(releaseEvidence.authority_content_identity.value, authorityContentSha256, "release evidence must bind exact authority content");
const sourceIdentity = {
  commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  tree: execFileSync("git", ["rev-parse", "HEAD^{tree}"], { encoding: "utf8" }).trim(),
  authority_content_sha256: authorityContentSha256,
};

const result = {
  ok: true,
  source_identity: sourceIdentity,
  phase_order: [phaseA, phaseB, phaseC, phaseD, phaseE],
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
  assert.equal(run(`select public.custodial_backend_authority_health(${q(secret)})->>'authority';`).split("\n").at(-1), "offline-authority.v3", "Phase D health must expose durable proof and delivery authority");
  assert.equal(run(`select count(*) from information_schema.role_table_grants where table_schema='public' and grantee='service_role' and table_name in ('sessions','completion_responses','scan_events','maintenance_tickets') and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE');`).split("\n").at(-1), "0", "service role must not retain operational DML grants");
  assert.equal(run(`select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('tool_start_offline_occurrence','tool_commit_cleaning_workflow_authoritative','tool_complete_session_authoritative','custodial_backend_authority_health','custodial_close_maintenance_ticket_authoritative');`).split("\n").at(-1), "5", "bounded canonical command surface must be present");
  assert.equal(run(`select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('run_application_write','run_sql_write','run_sql_migration','force_close_session','tool_force_close_session') and has_function_privilege('service_role',p.oid,'EXECUTE');`).split("\n").at(-1), "0", "service role must not retain a generic or force-close writer");
  assert.equal(run(`select count(*) from public.custodial_terminal_writer_inventory where application_callable and (mutates_terminal_truth or delegates_alternate_terminal_authority) and proname not in ('tool_start_offline_occurrence','tool_commit_cleaning_workflow_authoritative','tool_complete_session_authoritative','custodial_close_maintenance_ticket_authoritative');`).split("\n").at(-1), "0", "service roles must not retain an alternate terminal writer by capability or wrapper delegation");
  assert.equal(run(`select (has_function_privilege('service_role','public.purge_closed_scan_history_before(timestamp with time zone,text)'::regprocedure,'EXECUTE') or has_function_privilege('service_role','public.tool_purge_closed_scan_history_before(timestamp with time zone,text)'::regprocedure,'EXECUTE'))::text;`).split("\n").at(-1), "false", "service role must not retain either purge signature");
  const directWrite = spawnSync("docker", ["exec", container, "psql", "-v", "ON_ERROR_STOP=1", "-At", "-U", "supabase_admin", "-d", database, "-c", "set role service_role; insert into public.sessions default values;"], { encoding: "utf8" });
  assert.notEqual(directWrite.status, 0, "restoration check must prove direct application DML remains denied");
  result.database_gate = "passed";
}

console.log(JSON.stringify(result, null, 2));
