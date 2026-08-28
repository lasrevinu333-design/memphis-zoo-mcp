#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";
import pg from "pg";

const { Client } = pg;
const execFileAsync = promisify(execFile);
const adminUrl = String(process.env.RESTORE_DRILL_DATABASE_URL || "").trim();
if (!/(localhost|127\.0\.0\.1|test|ci)/i.test(adminUrl)) throw new Error("RESTORE_DRILL_DATABASE_URL must identify a disposable local/test PostgreSQL server.");
const databaseName = `mz_fence_${randomUUID().replaceAll("-", "")}`;
const databaseUrl = new URL(adminUrl);
databaseUrl.pathname = `/${databaseName}`;
const admin = new Client({ connectionString: adminUrl });
const setup = new Client({ connectionString: String(databaseUrl) });
const writer = new Client({ connectionString: String(databaseUrl) });
const restorer = new Client({ connectionString: String(databaseUrl) });
const blockedWriter = new Client({ connectionString: String(databaseUrl) });

const controlSql = readFileSync(new URL("../supabase/migrations/20260820125325_custodial_disaster_restore_generation_authority.sql", import.meta.url), "utf8");
const fenceSql = readFileSync(new URL("../supabase/migrations/20260827150000_disaster_recovery_global_mutation_fence.sql", import.meta.url), "utf8");

await admin.connect();
try {
  await admin.query(`create database ${pg.escapeIdentifier(databaseName)} template template0`);
  await setup.connect();
  await setup.query("create schema auth; create schema storage; create table public.fence_fixture(id integer primary key, body text); create table auth.fence_fixture(id integer primary key); create table storage.fence_fixture(id integer primary key)");
  await setup.query(controlSql);
  await setup.query(fenceSql);
  await setup.query("create table public.future_fence_fixture(id integer primary key)");
  const installed = await setup.query(`
    select n.nspname,c.relname
    from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
    where t.tgname='custodial_disaster_restore_mutation_fence' and not t.tgisinternal
    order by n.nspname,c.relname
  `);
  assert.deepEqual(installed.rows.map((row) => `${row.nspname}.${row.relname}`), [
    "auth.fence_fixture", "public.fence_fixture", "public.future_fence_fixture",
  ]);

  await writer.connect();
  await restorer.connect();
  await blockedWriter.connect();
  const leaseId = randomUUID();
  const lease = await setup.query("select public.custodial_begin_application_mutation_lease($1,'database-fence-test') result", [leaseId]);
  assert.equal(Number(lease.rows[0].result.authority_generation), 0);
  assert.ok(Date.parse(lease.rows[0].result.expires_at) > Date.now());
  const abandonedLeaseId = randomUUID();
  await assert.rejects(execFileAsync(process.execPath, [new URL("./restore-mutation-gate-terminated-owner-fixture.mjs", import.meta.url).pathname], {
    env: {
      ...process.env,
      RESTORE_GATE_TERMINATION_DATABASE_URL: String(databaseUrl),
      RESTORE_GATE_TERMINATION_LEASE_ID: abandonedLeaseId,
    },
  }), (error) => {
    assert.equal(error.code, 70, "the disconnected never-settling HTTP owner must terminate with the recovery-specific exit code");
    const evidence = JSON.parse(String(error.stdout || "").trim().split("\n").at(-1));
    assert.ok(evidence.calls.includes("custodial_heartbeat_application_mutation_lease"));
    assert.ok(!evidence.calls.includes("custodial_release_application_mutation_lease"),
      "process termination must retain rather than release the unsettled lease");
    return true;
  });
  await setup.query(`
    update custodial_dr.application_mutation_leases
    set admitted_at=clock_timestamp()-interval '5 minutes',
        heartbeat_at=clock_timestamp()-interval '5 minutes',
        expires_at=clock_timestamp()-interval '1 second'
    where request_id=$1
  `, [abandonedLeaseId]);
  assert.equal((await setup.query("select public.custodial_heartbeat_application_mutation_lease($1) alive", [abandonedLeaseId])).rows[0].alive, false);
  const replacementLeaseId = randomUUID();
  await setup.query("select public.custodial_begin_application_mutation_lease($1,'expired-lease-pruner')", [replacementLeaseId]);
  assert.equal(Number((await setup.query("select count(*)::int count from custodial_dr.application_mutation_leases where request_id=$1", [abandonedLeaseId])).rows[0].count), 1, "a later admission must retain an expired lease because expiry does not prove an external operation stopped");
  assert.equal((await setup.query("select public.custodial_release_application_mutation_lease($1) released", [replacementLeaseId])).rows[0].released, true);
  await writer.query("begin");
  const admittedGeneration = await writer.query("select public.custodial_begin_application_mutation() generation");
  assert.equal(Number(admittedGeneration.rows[0].generation), 0);
  await writer.query("insert into public.fence_fixture values (1,'admitted before pause')");

  await restorer.query("begin");
  let exclusiveAcquired = false;
  const pause = restorer.query("select pg_advisory_xact_lock(hashtextextended('memphis-zoo-application-mutation-fence',0))")
    .then(async () => {
      exclusiveAcquired = true;
      await restorer.query("update custodial_dr.restore_control set authority_generation=1,mutations_paused=true,state='PREPARING',restore_id=$1 where singleton=true", [randomUUID()]);
    });
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(exclusiveAcquired, false, "restore must drain a transaction admitted under the prior generation");
  await writer.query("commit");
  await pause;
  assert.equal(exclusiveAcquired, true);
  await restorer.query("commit");

  assert.equal(Number((await setup.query("select count(*)::int count from custodial_dr.application_mutation_leases")).rows[0].count), 2,
    "restore sees both the active API mutation and the expired fail-closed reconciliation blocker");
  assert.equal((await setup.query("select public.custodial_release_application_mutation_lease($1) released", [leaseId])).rows[0].released, true);

  await assert.rejects(
    blockedWriter.query("insert into public.future_fence_fixture values (1)"),
    (error) => error?.code === "55000" && /mutations are paused/i.test(error.message),
  );
  await assert.rejects(
    setup.query("select public.custodial_begin_application_mutation_lease($1,'late-request')", [randomUUID()]),
    (error) => error?.code === "55000" && /mutations are paused/i.test(error.message),
  );
  await assert.rejects(
    setup.query("create table public.ddl_after_pause(id integer primary key)"),
    (error) => error?.code === "55000" && /mutations are paused/i.test(error.message),
    "DDL must not cross the quiescent restore target-identity fence",
  );
  const retained = await setup.query("select body from public.fence_fixture where id=1");
  assert.equal(retained.rows[0].body, "admitted before pause");
  await setup.query("update custodial_dr.restore_control set state='PAUSED_FAILURE',target_project_ref='abcdefghijklmnopqrst' where singleton=true");
  const reconciliationKey = "abandoned-lease-reconciliation-fixture-key-000001";
  const reconciliationKeyId = "fixture-abandoned-lease-key-v1";
  async function createLeaseReconciliation(observedAt) {
    return execFileAsync(process.execPath, [new URL("./create-abandoned-mutation-lease-reconciliation.mjs", import.meta.url).pathname], {
      env: {
        ...process.env,
        SUPABASE_DB_URL: String(databaseUrl),
        SUPABASE_PROJECT_REF: "abcdefghijklmnopqrst",
        ABANDONED_LEASE_RECONCILIATION_NAMED_ACTOR: "disaster recovery test operator",
        ABANDONED_LEASE_RECONCILIATION_SIGNING_KEY: reconciliationKey,
        ABANDONED_LEASE_RECONCILIATION_SIGNING_KEY_ID: reconciliationKeyId,
        ABANDONED_LEASE_RECONCILIATION_EVIDENCE_JSON: JSON.stringify({
          format: "memphis-zoo.abandoned-mutation-lease-evidence.v1",
          observations: [{
            request_id: abandonedLeaseId,
            service_name: "abandoned-process-test",
            owning_process_terminated: true,
            observation: "The disposable test process is stopped and cannot issue another Storage or provider mutation.",
            observed_at: observedAt,
          }],
        }),
      },
    });
  }
  await assert.rejects(createLeaseReconciliation("2000-01-01T00:00:00.000Z"), /only after the exact lease expired/,
    "termination evidence that predates the admitted lease cannot authorize deletion");
  const createResult = await createLeaseReconciliation(new Date().toISOString());
  const reconciliation = createResult.stdout.trim();
  async function applyLeaseReconciliation(envelope) {
    return execFileAsync(process.execPath, [new URL("./apply-abandoned-mutation-lease-reconciliation.mjs", import.meta.url).pathname], {
      env: {
        ...process.env,
        SUPABASE_DB_URL: String(databaseUrl),
        SUPABASE_PROJECT_REF: "abcdefghijklmnopqrst",
        ABANDONED_LEASE_RECONCILIATION_CONFIRM_PROJECT_REF: "abcdefghijklmnopqrst",
        ABANDONED_LEASE_RECONCILIATION_APPLY: "true",
        ABANDONED_LEASE_RECONCILIATION_VERIFY_KEY: reconciliationKey,
        ABANDONED_LEASE_RECONCILIATION_VERIFY_KEY_ID: reconciliationKeyId,
        ABANDONED_LEASE_RECONCILIATION_JSON: envelope,
      },
    });
  }
  assert.match((await applyLeaseReconciliation(reconciliation)).stdout, /"reconciled_leases":1/);
  assert.match((await applyLeaseReconciliation(reconciliation)).stdout, /"idempotent_replay":true/);
  assert.equal(Number((await setup.query("select count(*)::int count from custodial_dr.application_mutation_leases")).rows[0].count), 0);
  assert.deepEqual((await setup.query("select state,mutations_paused from custodial_dr.restore_control")).rows[0],
    { state: "PAUSED_FAILURE", mutations_paused: true }, "lease reconciliation does not silently resume a failed restore");
  console.log("DISASTER_RECOVERY_MUTATION_FENCE_DATABASE_TESTS_PASS");
} finally {
  await blockedWriter.end().catch(() => {});
  await restorer.end().catch(() => {});
  await writer.end().catch(() => {});
  await setup.end().catch(() => {});
  await admin.query(`select pg_terminate_backend(pid) from pg_stat_activity where datname=$1`, [databaseName]).catch(() => {});
  await admin.query(`drop database if exists ${pg.escapeIdentifier(databaseName)}`).catch(() => {});
  await admin.end().catch(() => {});
}
