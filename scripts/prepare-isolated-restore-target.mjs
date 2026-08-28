#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import pg from "pg";

const { Client } = pg;
const sourceDir = resolve(String(process.env.RESTORE_SOURCE_DIR || ""));
const databaseUrl = String(process.env.SUPABASE_DB_URL || "").trim();

if (!sourceDir || !databaseUrl) throw new Error("RESTORE_SOURCE_DIR and SUPABASE_DB_URL are required.");
const target = new URL(databaseUrl);
if (!/^(127\.0\.0\.1|localhost)$/.test(target.hostname)
    || !/^\/mz_schema_rebuild_[a-zA-Z0-9_]+$/.test(target.pathname)) {
  throw new Error("Isolated restore preparation is restricted to a loopback mz_schema_rebuild_* database.");
}

const summary = JSON.parse(readFileSync(join(sourceDir, "backup-summary.json"), "utf8"));
if (summary.format !== "memphis-zoo-disaster-recovery.v4") {
  throw new Error("Independent restore rehearsal requires a v4 archive with signed schema and control inventories.");
}
const ledger = JSON.parse(readFileSync(join(sourceDir, "inventory", "migration-ledger.json"), "utf8"));
const cronJobs = JSON.parse(readFileSync(join(sourceDir, "inventory", "cron-jobs.json"), "utf8"));
const extensions = JSON.parse(readFileSync(join(sourceDir, "inventory", "extensions.json"), "utf8"));
if (!Array.isArray(ledger) || !ledger.length || String(ledger.at(-1)?.version || "") !== summary.source_identity.migration_head) {
  throw new Error("The signed migration inventory does not terminate at the archived head.");
}
if (!Array.isArray(cronJobs) || !Array.isArray(extensions)) throw new Error("Signed control inventories are malformed.");

const db = new Client({ connectionString: databaseUrl, application_name: "memphis-zoo-isolated-restore-preparation" });
await db.connect();
try {
  await db.query("begin");
  await db.query("insert into custodial_dr.restore_control(singleton) values (true) on conflict (singleton) do nothing");
  await db.query("truncate supabase_migrations.schema_migrations");
  for (const row of ledger) {
    if (!/^\d{14}$/.test(String(row.version || "")) || !String(row.name || "").trim() || !Array.isArray(row.statements)) {
      throw new Error("Signed migration inventory contains a malformed row.");
    }
    await db.query(
      "insert into supabase_migrations.schema_migrations(version,name,statements) values ($1,$2,$3::text[])",
      [row.version, row.name, row.statements],
    );
  }
  await db.query("truncate cron.job restart identity");
  for (const row of cronJobs) {
    await db.query("insert into cron.job select * from json_populate_record(null::cron.job,$1::json)", [JSON.stringify(row)]);
  }
  if (cronJobs.length) {
    await db.query("select setval(pg_get_serial_sequence('cron.job','jobid'),(select max(jobid) from cron.job),true)");
  }
  const release = summary.source_identity.release;
  if (!release || typeof release !== "object") throw new Error("Signed release identity is unavailable.");
  await db.query("truncate public.release_deployment_manifest cascade");
  await db.query(
    "insert into public.release_deployment_manifest select * from json_populate_record(null::public.release_deployment_manifest,$1::json)",
    [JSON.stringify(release)],
  );
  await db.query("commit");

  const state = await db.query(`
    select
      (select max(version)::text from supabase_migrations.schema_migrations) migration_head,
      (select count(*)::int from supabase_migrations.schema_migrations) migration_count,
      (select count(*)::int from cron.job) cron_job_count,
      (select count(*)::int from public.release_deployment_manifest) release_count
  `);
  const actualExtensions = await db.query(`
    select e.extname, e.extversion, n.nspname schema_name
    from pg_extension e join pg_namespace n on n.oid=e.extnamespace
    order by e.extname
  `);
  const expectedExtensionDigest = createHash("sha256").update(JSON.stringify(extensions)).digest("hex");
  const actualExtensionDigest = createHash("sha256").update(JSON.stringify(actualExtensions.rows)).digest("hex");
  const row = state.rows[0];
  if (row.migration_head !== summary.source_identity.migration_head
      || row.migration_count !== ledger.length
      || row.cron_job_count !== cronJobs.length
      || row.release_count !== 1
      || actualExtensionDigest !== expectedExtensionDigest) {
    throw new Error(`Isolated recovery-control hydration mismatch: ${JSON.stringify({ ...row, actualExtensionDigest, expectedExtensionDigest })}`);
  }
  console.log(JSON.stringify({
    ok: true,
    stage: "signed_recovery_control_hydrated",
    migration_head: row.migration_head,
    migration_count: row.migration_count,
    cron_job_count: row.cron_job_count,
    release_count: row.release_count,
    extensions_sha256: actualExtensionDigest,
  }));
} catch (error) {
  await db.query("rollback").catch(() => {});
  throw error;
} finally {
  await db.end();
}
