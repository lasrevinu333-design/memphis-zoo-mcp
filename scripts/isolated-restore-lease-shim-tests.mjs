#!/usr/bin/env node

import assert from "node:assert/strict";
import pg from "pg";
import {
  GLOBAL_MUTATION_FENCE_MIGRATION,
  ISOLATED_LEASE_SHIM_COMMENT,
  ensureIsolatedRestoreLeaseShim,
  ledgerHasGlobalMutationFence,
  retireIsolatedRestoreLeaseShim,
  verifyIsolatedSourceLeaseState,
} from "./isolated-restore-lease-shim.mjs";

if (process.argv.includes("--isolated-cron-exact-hydration-only")) {
  const { readFileSync } = await import("node:fs");
  const { join, resolve } = await import("node:path");
  const { createHash } = await import("node:crypto");
  const { normalizedCronJobs, restoreCronJobs } = await import("./disaster-recovery-cron.mjs");
  const source = readFileSync(new URL("./prepare-isolated-restore-target.mjs", import.meta.url), "utf8");
  const start = source.indexOf("const { Client } = pg;");
  assert.ok(start > 0);
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  // Run the actual entire CLI body against in-memory files and a synthetic
  // query adapter. No environment change, real client, connection or SQL.
  const program = new AsyncFunction("pg", "createHash", "readFileSync", "join", "resolve",
    "ensureIsolatedRestoreLeaseShim", "ledgerHasGlobalMutationFence", "process", "console",
    "normalizedCronJobs", "restoreCronJobs", source.slice(start));
  const job = {
    jobid: "9223372036854775807", schedule: "0 0 1 1 *", command: "SELECT 1", nodename: "localhost",
    nodeport: 5432, database: "original_snapshot_database", username: "postgres", active: false, jobname: null,
  };
  const run = async ({ rawCron = JSON.stringify([job]), sourceDatabase = "original_snapshot_database",
    url = "postgresql://postgres@127.0.0.1/mz_schema_rebuild_cron_unit", readbackMismatch = false } = {}) => {
    const head = "20261017000000";
    const summary = { format: "memphis-zoo-disaster-recovery.v4", source_identity: { migration_head: head, release: { release_id: "synthetic-release" } },
      database_snapshot: sourceDatabase === undefined ? {} : { database_name: sourceDatabase } };
    const files = new Map([
      ["backup-summary.json", JSON.stringify(summary)],
      ["inventory/migration-ledger.json", JSON.stringify([{ version: head, name: "synthetic", statements: [] }])],
      ["inventory/cron-jobs.json", rawCron], ["inventory/extensions.json", "[]"],
    ]);
    const originalFiles = [...files];
    const state = { clients: 0, connected: 0, ended: 0, queries: [], shimOptions: [], output: [], rows: [], setval: null, error: null };
    class HydrationFixtureClient {
      constructor() { state.clients++; }
      async connect() { state.connected++; }
      async end() { state.ended++; }
      async query(sql, params = []) {
        const statement = String(sql).replace(/\s+/g, " ").trim();
        state.queries.push({ statement, params });
        if (statement === "select current_database() database_name") return { rows: [{ database_name: "mz_schema_rebuild_cron_unit" }] };
        if (statement.includes("from cron.job j order by j.jobid")) {
          assert.ok(statement.includes("'jobid', j.jobid::text"));
          return { rows: state.rows.map(row => ({ row: { ...row, ...(readbackMismatch ? { active: true } : {}) } })) };
        }
        if (statement === "truncate cron.job restart identity") { state.rows = []; return { rows: [] }; }
        if (statement.startsWith("insert into cron.job(jobid,")) {
          assert.equal(typeof params[0], "string");
          state.rows.push(Object.fromEntries(["jobid", "schedule", "command", "nodename", "nodeport", "database", "username", "active", "jobname"].map((key, index) => [key, params[index]])));
          return { rows: [] };
        }
        if (statement === "select pg_get_serial_sequence('cron.job','jobid') sequence_name") return { rows: [{ sequence_name: "cron.jobid_seq" }] };
        if (statement === "select setval($1::regclass,$2,$3)") { state.setval = [...params]; return { rows: [] }; }
        if (statement.includes("migration_head,") && statement.includes("cron_job_count")) {
          return { rows: [{ migration_head: head, migration_count: 1, cron_job_count: state.rows.length, release_count: 1 }] };
        }
        if (statement.includes("from pg_extension e join pg_namespace")) return { rows: [] };
        if (["begin", "commit", "rollback", "truncate supabase_migrations.schema_migrations", "truncate public.release_deployment_manifest cascade"].includes(statement)
          || statement.startsWith("insert into custodial_dr.restore_control(")
          || statement.startsWith("insert into supabase_migrations.schema_migrations(")
          || statement.startsWith("insert into public.release_deployment_manifest ")) return { rows: [] };
        throw new Error(`Unexpected selected synthetic hydration SQL: ${statement}`);
      }
    }
    try {
      await program({ Client: HydrationFixtureClient }, createHash, path => {
        const relative = path.slice("/synthetic-original/".length);
        assert.ok(path.startsWith("/synthetic-original/") && files.has(relative));
        return files.get(relative);
      }, join, resolve,
      async (_db, options) => { state.shimOptions.push(options); return { created: false }; },
      ledgerHasGlobalMutationFence,
      { env: { RESTORE_SOURCE_DIR: "/synthetic-original", SUPABASE_DB_URL: url } },
      { log: value => state.output.push(value) }, normalizedCronJobs, restoreCronJobs);
    } catch (error) { state.error = error; }
    assert.deepEqual([...files], originalFiles, "Original archive bytes must remain unchanged");
    return state;
  };
  let passed = 0;
  const check = async (name, test) => { await test(); passed++; console.log(`ISOLATED_CRON_HYDRATION_NEW ${name} PASS`); };
  await check("unsafe-legacy-raw-number-before-client-or-hydration", async () => {
    for (const literal of ["9223372036854775807", "9007199254740993"]) {
      const rawCron = JSON.stringify([job]).replace('"jobid":"9223372036854775807"', `"jobid":${literal}`);
      const state = await run({ rawCron });
      assert.match(state.error?.message || "", /BIGINT jobid/);
      assert.equal(state.clients, 0); assert.equal(state.connected, 0); assert.deepEqual(state.queries, []);
      assert.deepEqual(state.shimOptions, []);
    }
  });
  await check("exact-int64-legacy-safe-ordering-and-source-database-mapping", async () => {
    const jobs = [job, { ...job, jobid: 7, jobname: "safe-legacy" },
      { ...job, jobid: "9007199254740993", jobname: "adjacent-high" },
      { ...job, jobid: "9007199254740992", database: "other-original-database", jobname: "adjacent-low" }];
    const state = await run({ rawCron: JSON.stringify(jobs) });
    assert.equal(state.error, null);
    assert.deepEqual(state.rows.map(row => row.jobid), ["7", "9007199254740992", "9007199254740993", job.jobid]);
    assert.deepEqual(state.rows, normalizedCronJobs(jobs, { sourceDatabase: "original_snapshot_database", targetDatabase: "mz_schema_rebuild_cron_unit" }));
    assert.deepEqual(state.setval, ["cron.jobid_seq", job.jobid, true]);
    assert.equal(state.rows[1].database, "other-original-database");
    assert.ok(state.rows.filter(row => row.jobid !== "9007199254740992").every(row => row.database === "mz_schema_rebuild_cron_unit"));
    assert.equal(state.ended, 1); assert.ok(state.queries.some(row => row.statement === "commit"));
    assert.equal(JSON.parse(state.output[0]).cron_job_count, 4);
    assert.deepEqual(state.shimOptions, [{ sourceMigrationPresent: false }]);
  });
  await check("noncanonical-text-and-duplicate-refuse-before-hydration", async () => {
    for (const rows of [[{ ...job, jobid: "01" }], [{ ...job, jobid: "9223372036854775808" }],
      [{ ...job, jobid: "1\n" }], [{ ...job, jobid: 7 }, { ...job, jobid: "7" }]]) {
      const state = await run({ rawCron: JSON.stringify(rows) });
      assert.ok(state.error); assert.equal(state.clients, 0); assert.deepEqual(state.queries, []);
    }
  });
  await check("missing-original-database-no-guessed-mapping", async () => {
    for (const sourceDatabase of [null, "", "bad\0name", "x".repeat(64)]) {
      const state = await run({ sourceDatabase });
      assert.match(state.error?.message || "", /archived original database identity/);
      assert.equal(state.clients, 0); assert.deepEqual(state.queries, []);
    }
  });
  await check("readback-mismatch-retains-rollback-end-and-no-commit", async () => {
    const state = await run({ readbackMismatch: true });
    assert.match(state.error?.message || "", /differs from the exact archived inventory/);
    assert.ok(state.queries.some(row => row.statement === "rollback"));
    assert.equal(state.queries.some(row => row.statement === "commit"), false);
    assert.equal(state.queries.some(row => row.statement.startsWith("truncate public.release_deployment_manifest")), false);
    assert.equal(state.ended, 1);
  });
  await check("empty-inventory-and-unchanged-loopback-target-refusal", async () => {
    const empty = await run({ rawCron: "[]" });
    assert.equal(empty.error, null); assert.deepEqual(empty.setval, ["cron.jobid_seq", "1", false]);
    for (const url of ["postgresql://postgres@outside.example/mz_schema_rebuild_cron_unit", "postgresql://postgres@localhost/postgres"]) {
      const state = await run({ url });
      assert.match(state.error?.message || "", /restricted to a loopback mz_schema_rebuild/);
      assert.equal(state.clients, 0); assert.deepEqual(state.queries, []);
    }
  });
  console.log(JSON.stringify({ selector: "--isolated-cron-exact-hydration-only", passed,
    actual_source_cli_body: true, synthetic_files_and_query_adapter: true, sql_connections: 0, actual_sql: "NOT_RUN", old_groups_run: 0 }));
} else {

class FixtureDatabase {
  constructor({
    relationName = null,
    relationComment = null,
    controlPresent = true,
    migrationPresent = false,
    relationOwner = "supabase_admin",
    currentUser = "supabase_admin",
    relationKind = "r",
    relationPersistence = "p",
    leaseCounts = { total_count: 0, active_count: 0, expired_count: 0 },
    wrongShape = false,
  } = {}) {
    this.relationName = relationName;
    this.relationComment = relationComment;
    this.controlPresent = controlPresent;
    this.migrationPresent = migrationPresent;
    this.relationOwner = relationOwner;
    this.currentUser = currentUser;
    this.relationKind = relationKind;
    this.relationPersistence = relationPersistence;
    this.leaseCounts = leaseCounts;
    this.wrongShape = wrongShape;
    this.queries = [];
  }

  async query(sql, params = []) {
    const statement = String(sql).replace(/\s+/g, " ").trim();
    this.queries.push({ statement, params });
    if (statement.includes("obj_description(relation_oid,'pg_class')")) {
      return { rows: [{
        relation_name: this.relationName,
        relation_comment: this.relationComment,
        relation_owner: this.relationName ? this.relationOwner : null,
        relation_kind: this.relationName ? this.relationKind : null,
        relation_persistence: this.relationName ? this.relationPersistence : null,
        current_user: this.currentUser,
      }] };
    }
    if (statement.includes("to_regclass('custodial_dr.restore_control')")) {
      return { rows: [{ relation_name: this.controlPresent ? "custodial_dr.restore_control" : null }] };
    }
    if (statement.startsWith("select exists(select 1 from supabase_migrations.schema_migrations")) {
      assert.deepEqual(params, [GLOBAL_MUTATION_FENCE_MIGRATION]);
      return { rows: [{ migration_present: this.migrationPresent }] };
    }
    if (statement.startsWith("create table custodial_dr.application_mutation_leases")) {
      this.relationName = "custodial_dr.application_mutation_leases";
      this.relationComment = null;
      return { rows: [] };
    }
    if (statement.startsWith("comment on table custodial_dr.application_mutation_leases")) {
      this.relationComment = ISOLATED_LEASE_SHIM_COMMENT;
      return { rows: [] };
    }
    if (statement.includes("coalesce(json_agg(json_build_object(")) {
      return { rows: [{
        columns: [
          { name: "request_id", type: this.wrongShape ? "text" : "uuid", not_null: true, default: null },
          { name: "authority_generation", type: "bigint", not_null: true, default: null },
          { name: "service_name", type: "text", not_null: true, default: null },
          { name: "admitted_at", type: "timestamp with time zone", not_null: true, default: "clock_timestamp()" },
          { name: "heartbeat_at", type: "timestamp with time zone", not_null: true, default: "clock_timestamp()" },
          { name: "expires_at", type: "timestamp with time zone", not_null: true, default: "(clock_timestamp() + '00:03:00'::interval)" },
        ],
        constraints: [
          { name: "application_mutation_lease_expiry_order", type: "c", definition: "CHECK ((expires_at > admitted_at))" },
          { name: "application_mutation_leases_authority_generation_check", type: "c", definition: "CHECK ((authority_generation >= 0))" },
          { name: "application_mutation_leases_pkey", type: "p", definition: "PRIMARY KEY (request_id)" },
          { name: "application_mutation_leases_service_name_check", type: "c", definition: "CHECK (((length(btrim(service_name)) >= 1) AND (length(btrim(service_name)) <= 120)))" },
        ],
        non_owner_acl: [
          { grantee: "postgres", privilege: "DELETE", grantable: false },
          { grantee: "postgres", privilege: "INSERT", grantable: false },
          { grantee: "postgres", privilege: "SELECT", grantable: false },
        ],
      }] };
    }
    if (statement.includes("count(*)::int total_count")) return { rows: [this.leaseCounts] };
    if (statement === "drop table custodial_dr.application_mutation_leases") {
      this.relationName = null;
      this.relationComment = null;
      return { rows: [] };
    }
    if (/^(revoke|grant) /.test(statement)) return { rows: [] };
    throw new Error(`Unexpected fixture SQL: ${statement}`);
  }
}

assert.equal(ledgerHasGlobalMutationFence([]), false);
assert.equal(ledgerHasGlobalMutationFence([{ version: GLOBAL_MUTATION_FENCE_MIGRATION }]), true);

const baseline = new FixtureDatabase();
assert.deepEqual(
  await ensureIsolatedRestoreLeaseShim(baseline, { sourceMigrationPresent: false }),
  { created: true, sourceMigrationPresent: false },
);
assert.equal(baseline.relationComment, ISOLATED_LEASE_SHIM_COMMENT);
assert.deepEqual(
  await ensureIsolatedRestoreLeaseShim(baseline, { sourceMigrationPresent: false }),
  { created: false, sourceMigrationPresent: false },
  "preparation is idempotent only for the exact marked shim",
);
assert.deepEqual(
  await retireIsolatedRestoreLeaseShim(baseline),
  { retired: true, alreadyAbsent: false, sourceMigrationPresent: false },
);
assert.equal(baseline.relationName, null);

await assert.rejects(
  ensureIsolatedRestoreLeaseShim(new FixtureDatabase(), { sourceMigrationPresent: true }),
  /ledger includes the global mutation fence/,
  "an applied migration with a missing lease table is schema drift, not a compatibility case",
);
await assert.rejects(
  ensureIsolatedRestoreLeaseShim(new FixtureDatabase({
    relationName: "custodial_dr.application_mutation_leases",
    relationComment: "unmarked",
  }), { sourceMigrationPresent: false }),
  /unmarked/,
  "an unexpected pre-migration table cannot be mistaken for the disposable shim",
);
await assert.rejects(
  ensureIsolatedRestoreLeaseShim(new FixtureDatabase({ controlPresent: false }), { sourceMigrationPresent: false }),
  /signed restore control plane/,
);

const applied = new FixtureDatabase({
  relationName: "custodial_dr.application_mutation_leases",
  relationComment: "production mutation lease authority",
  migrationPresent: true,
});
assert.deepEqual(
  await ensureIsolatedRestoreLeaseShim(applied, { sourceMigrationPresent: true }),
  { created: false, sourceMigrationPresent: true },
);
assert.deepEqual(
  await retireIsolatedRestoreLeaseShim(applied),
  { retired: false, alreadyAbsent: false, sourceMigrationPresent: true },
  "a source schema that already owns the real migration table is preserved",
);

await assert.rejects(
  retireIsolatedRestoreLeaseShim(new FixtureDatabase({
    relationName: "custodial_dr.application_mutation_leases",
    relationComment: ISOLATED_LEASE_SHIM_COMMENT,
    migrationPresent: true,
  })),
  /cannot survive/,
);
await assert.rejects(
  retireIsolatedRestoreLeaseShim(new FixtureDatabase({
    relationName: "custodial_dr.application_mutation_leases",
    relationComment: ISOLATED_LEASE_SHIM_COMMENT,
    leaseCounts: { total_count: 1, active_count: 0, expired_count: 1 },
  })),
  /not empty/,
  "expired leases remain fail-closed blockers and are never discarded by rehearsal cleanup",
);
await assert.rejects(
  retireIsolatedRestoreLeaseShim(new FixtureDatabase({
    relationName: "custodial_dr.application_mutation_leases",
    relationComment: ISOLATED_LEASE_SHIM_COMMENT,
    relationOwner: "unexpected_owner",
  })),
  /not owned/,
  "only the exact isolated restore identity can own and retire the shim",
);
await assert.rejects(
  retireIsolatedRestoreLeaseShim(new FixtureDatabase({ migrationPresent: true })),
  /recorded but its application mutation lease table is missing/,
);

const liveDatabaseUrl = String(process.env.ISOLATED_LEASE_SHIM_TEST_DATABASE_URL || "").trim();
const signedFenceLedger = [{ version: GLOBAL_MUTATION_FENCE_MIGRATION }];
const permanentOptions = {
  relationName: "custodial_dr.application_mutation_leases",
  relationComment: "In-flight external API work admitted under a restore generation. Heartbeats keep live work visible; abandoned leases expire after three minutes.",
  relationOwner: "postgres",
  migrationPresent: true,
};
const permanent = new FixtureDatabase(permanentOptions);
assert.deepEqual(await verifyIsolatedSourceLeaseState(permanent, { sourceLedger: signedFenceLedger }), {
  source_global_fence_present: true, permanent_lease_table_preserved: true,
  temporary_shim_absent: true, active_mutation_leases: 0, expired_mutation_leases: 0,
});
assert.equal(permanent.queries.some(({ statement }) => /^(drop|delete|truncate|alter) /i.test(statement)), false,
  "permanent-table verification must be read-only and must never delete the real table or its leases");
assert.equal((await verifyIsolatedSourceLeaseState(new FixtureDatabase(), { sourceLedger: [] })).temporary_shim_absent, true);
for (const [override, message] of [
  [{ relationName: null }, /must be preserved/],
  [{ relationComment: ISOLATED_LEASE_SHIM_COMMENT }, /source marker/],
  [{ relationComment: null }, /source marker/],
  [{ relationOwner: "wrong_owner" }, /not owned/],
  [{ relationKind: "v" }, /ordinary persistent/],
  [{ relationPersistence: "u" }, /ordinary persistent/],
  [{ wrongShape: true }, /shape is not exact/],
  [{ leaseCounts: { total_count: 1, active_count: 1, expired_count: 0 } }, /not empty/],
  [{ leaseCounts: { total_count: 1, active_count: 0, expired_count: 1 } }, /not empty/],
  [{ migrationPresent: false }, /does not match its signed/],
]) {
  await assert.rejects(verifyIsolatedSourceLeaseState(new FixtureDatabase({ ...permanentOptions, ...override }),
    { sourceLedger: signedFenceLedger }), message);
}
await assert.rejects(verifyIsolatedSourceLeaseState(new FixtureDatabase({
  relationName: "custodial_dr.application_mutation_leases", relationComment: ISOLATED_LEASE_SHIM_COMMENT,
}), { sourceLedger: [] }), /temporary lease shim must be absent/);
await assert.rejects(verifyIsolatedSourceLeaseState(permanent, { sourceLedger: [] }), /does not match its signed/);

if (liveDatabaseUrl) {
  const { Client } = pg;
  const live = new Client({ connectionString: liveDatabaseUrl, application_name: "isolated-lease-shim-live-test" });
  await live.connect();
  try {
    await live.query("begin");
    await live.query("create schema if not exists custodial_dr");
    await live.query("create schema if not exists supabase_migrations");
    await live.query("create table if not exists custodial_dr.restore_control(singleton boolean primary key)");
    await live.query("create table if not exists supabase_migrations.schema_migrations(version text primary key)");
    await live.query("delete from supabase_migrations.schema_migrations where version=$1", [GLOBAL_MUTATION_FENCE_MIGRATION]);
    assert.equal((await ensureIsolatedRestoreLeaseShim(live, { sourceMigrationPresent: false })).created, true);
    assert.equal((await live.query("select to_regclass('custodial_dr.application_mutation_leases') is not null present")).rows[0].present, true);
    assert.equal((await retireIsolatedRestoreLeaseShim(live)).retired, true);
    assert.equal((await live.query("select to_regclass('custodial_dr.application_mutation_leases') is null absent")).rows[0].absent, true);
    await live.query("rollback");
  } catch (error) {
    await live.query("rollback").catch(() => {});
    throw error;
  } finally {
    await live.end();
  }
}

console.log("ISOLATED_RESTORE_LEASE_SHIM_TESTS_PASS");
}
