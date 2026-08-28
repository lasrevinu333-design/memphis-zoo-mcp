#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import pg from "pg";
import {
  releaseMigrationAuthorizationBinding,
  requireSigningKey,
  stableJson,
  stableJsonFileSha256,
  verifyBinding,
} from "./disaster-recovery-crypto.mjs";
import { captureSchemaCatalog, fingerprintSchemaCatalog } from "./schema-fingerprint-catalog.mjs";

const { Client } = pg;
const root = resolve(new URL("..", import.meta.url).pathname);
const state = JSON.parse(readFileSync(resolve(root, "release/production-migration-state.json"), "utf8"));
const databaseUrl = String(process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || "").trim();
const databaseCaCertPath = String(process.env.SUPABASE_DB_CA_CERT_PATH || "").trim();
const projectRef = String(process.env.SUPABASE_PROJECT_REF || "").trim();
const confirmedRef = String(process.env.RELEASE_MIGRATION_CONFIRM_PROJECT_REF || "").trim();
const actor = String(process.env.RELEASE_MIGRATION_NAMED_ACTOR || "").trim();
const apply = String(process.env.RELEASE_MIGRATION_APPLY || "false").toLowerCase() === "true";
const rehearsal = String(process.env.RELEASE_MIGRATION_REHEARSAL || "false").toLowerCase() === "true";
const candidateCommit = String(process.env.RELEASE_MIGRATION_CANDIDATE_COMMIT || "").trim().toLowerCase();
const candidateTree = String(process.env.RELEASE_MIGRATION_CANDIDATE_TREE || "").trim().toLowerCase();

if (!apply) throw new Error("RELEASE_MIGRATION_APPLY=true is required.");
if (!databaseUrl || projectRef !== state.project_ref || confirmedRef !== projectRef) {
  throw new Error("SUPABASE_DB_URL and exact project/confirmation identity from production-migration-state.json are required.");
}
if (!actor || !/^[a-zA-Z0-9 ._@:-]{2,160}$/.test(actor)) throw new Error("RELEASE_MIGRATION_NAMED_ACTOR must identify the applying operator.");
if (!/^[0-9a-f]{40}$/.test(candidateCommit) || !/^[0-9a-f]{40}$/.test(candidateTree)) throw new Error("Exact release migration candidate commit and tree are required.");
if (!Array.isArray(state.pending_migrations) || state.pending_migrations.length !== state.target.pending_migration_count) {
  throw new Error("Pending migration inventory is incomplete.");
}

function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function ledgerFileSha256(rows) { return stableJsonFileSha256(rows); }
function catalogCounts(catalog) { return Object.fromEntries(Object.entries(catalog).map(([name, rows]) => [name, rows.length])); }
function normalizeCatalog(catalog, databaseName) {
  return {
    ...catalog,
    cron_jobs: catalog.cron_jobs.map((row) => row.database === databaseName ? { ...row, database: "postgres" } : row),
  };
}
function transactionBody(sql, file) {
  const match = sql.match(/^([\s\S]*?\n)?begin;\s*\n([\s\S]*)\ncommit;\s*$/i);
  if (!match) return sql;
  const prefix = match[1] || "";
  if (/\bbegin;|\bcommit;/i.test(prefix)) throw new Error(`${file} has an ambiguous transaction envelope.`);
  return `${prefix}${match[2]}`;
}
function migrationPlan() {
  return state.pending_migrations.map((item, index) => {
    if (item.order !== index + 1 || item.source_migration_version !== item.file.slice(0, 14)
        || !item.file.endsWith(`_${item.phase}.sql`)) throw new Error("Pending migration order, version, phase, or filename is inconsistent.");
    const path = resolve(root, "supabase/migrations", item.file);
    const sql = readFileSync(path, "utf8");
    if (sha256(sql) !== item.sha256) throw new Error(`Pending migration hash mismatch for ${item.file}.`);
    return { ...item, sql, body: transactionBody(sql, item.file) };
  });
}
async function outlookSnapshot(db) {
  const present = await db.query("select to_regclass('public.events_app_outlook_sync') is not null present");
  if (!present.rows[0].present) return { present: false, rows: 0, sha256: null };
  const rows = await db.query("select row_to_json(t) row from public.events_app_outlook_sync t order by id");
  return { present: true, rows: rows.rowCount, sha256: sha256(stableJson(rows.rows.map((item) => item.row))) };
}

const plan = migrationPlan();
const planIdentity = plan.map(({ order, source_migration_version, file, sha256: digest }) => ({ order, source_migration_version, file, sha256: digest }));
const planSha256 = sha256(stableJson(planIdentity));
const targetUrl = new URL(databaseUrl);
const allowFailureProbe = /^(127\.0\.0\.1|localhost)$/.test(targetUrl.hostname)
  && /^\/mz_schema_rebuild_[a-zA-Z0-9_]+$/.test(targetUrl.pathname);
const testSourceCatalogFingerprint = String(process.env.RELEASE_MIGRATION_TEST_SOURCE_CATALOG_FINGERPRINT || "").trim();
const testSourceCatalogCounts = JSON.parse(String(process.env.RELEASE_MIGRATION_TEST_SOURCE_CATALOG_COUNTS_JSON || "null"));
if ((testSourceCatalogFingerprint || testSourceCatalogCounts) && (!allowFailureProbe
    || !/^[0-9a-f]{64}$/.test(testSourceCatalogFingerprint) || !testSourceCatalogCounts || typeof testSourceCatalogCounts !== "object")) {
  throw new Error("Source-catalog fixture overrides are restricted to an explicit disposable loopback database.");
}
const expectedSourceCatalogFingerprint = testSourceCatalogFingerprint || state.observed_production.catalog_privilege_fingerprint;
const expectedSourceCatalogCounts = testSourceCatalogCounts || state.observed_production.catalog_counts;
let sourceLedgerSha256 = String(process.env.RELEASE_MIGRATION_SOURCE_LEDGER_SHA256 || "").trim();
let authorizationId = null;
if (rehearsal) {
  if (!allowFailureProbe || !/^[0-9a-f]{64}$/.test(sourceLedgerSha256)) {
    throw new Error("Release migration rehearsal is restricted to a disposable loopback database and requires the exact signed source ledger digest.");
  }
} else {
  const key = requireSigningKey(process.env.RELEASE_MIGRATION_AUTHORIZATION_VERIFY_KEY, "RELEASE_MIGRATION_AUTHORIZATION_VERIFY_KEY");
  const keyId = String(process.env.RELEASE_MIGRATION_AUTHORIZATION_VERIFY_KEY_ID || "").trim();
  const envelope = JSON.parse(String(process.env.RELEASE_MIGRATION_AUTHORIZATION_JSON || "null"));
  if (!envelope || envelope.format !== "memphis-zoo-release-migration-authorization.v1"
      || envelope.algorithm !== "hmac-sha256" || envelope.key_id !== keyId
      || !verifyBinding(releaseMigrationAuthorizationBinding(envelope.intent || {}), envelope.signature, key)) {
    throw new Error("Release migration authorization signature verification failed.");
  }
  const intent = envelope.intent || {};
  const expiresAt = Date.parse(String(intent.expires_at || ""));
  const approvedAt = Date.parse(String(intent.approved_at || ""));
  const backupCompletedAt = Date.parse(String(intent.backup?.completed_at || ""));
  const rehearsalCompletedAt = Date.parse(String(intent.rehearsal?.completed_at || ""));
  const observedProductionAt = Date.parse(String(state.observed_production.captured_at || ""));
  if (!/^[0-9a-f-]{36}$/i.test(String(intent.authorization_id || ""))
      || intent.project_ref !== projectRef || intent.candidate_commit !== candidateCommit || intent.candidate_tree !== candidateTree
      || intent.pending_migration_plan_sha256 !== planSha256
      || intent.source_catalog_fingerprint !== state.observed_production.catalog_privilege_fingerprint
      || intent.source_migration_head !== state.observed_production.ledger_head
      || Number(intent.source_migration_count) !== Number(state.observed_production.production_ledger_count)
      || !/^[0-9a-f]{64}$/.test(String(intent.source_migration_ledger_sha256 || ""))
      || intent.target_catalog_fingerprint !== state.target.canonical_source_schema_fingerprint
      || intent.target_migration_head !== state.target.source_migration_version
      || Number(intent.target_migration_count) !== Number(state.target.production_ledger_count)
      || intent.backup?.source_commit !== candidateCommit || intent.backup?.source_tree !== candidateTree
      || !/^[0-9a-f]{64}$/.test(String(intent.backup?.archive_digest || ""))
      || !/^[0-9a-f]{64}$/.test(String(intent.rehearsal?.receipt_sha256 || ""))
      || !/^[0-9a-f]{64}$/.test(String(intent.rehearsal?.attestation_sha256 || ""))
      || !/^[a-zA-Z0-9._:-]{1,120}$/.test(String(intent.rehearsal?.attestation_key_id || ""))
      || intent.rehearsal?.repository !== "lasrevinu333-design/memphis-zoo-mcp"
      || !String(intent.rehearsal?.workflow_ref || "").startsWith("lasrevinu333-design/memphis-zoo-mcp/.github/workflows/production-backup-migration-rehearsal.yml@")
      || intent.rehearsal?.workflow_sha !== candidateCommit
      || !/^[1-9][0-9]*$/.test(String(intent.rehearsal?.run_id || ""))
      || !/^[1-9][0-9]*$/.test(String(intent.rehearsal?.run_attempt || ""))
      || Number(intent.rehearsal?.active_mutation_leases) !== 0 || Number(intent.rehearsal?.expired_mutation_leases) !== 0
      || !Number.isFinite(expiresAt) || expiresAt <= Date.now() || expiresAt > Date.now() + 24 * 60 * 60 * 1000
      || !Number.isFinite(approvedAt) || approvedAt < rehearsalCompletedAt || approvedAt > Date.now()
      || !Number.isFinite(backupCompletedAt) || !Number.isFinite(rehearsalCompletedAt) || !Number.isFinite(observedProductionAt)
      || backupCompletedAt < observedProductionAt || rehearsalCompletedAt < backupCompletedAt
      || Date.now() - rehearsalCompletedAt > 24 * 60 * 60 * 1000) {
    throw new Error("Release migration authorization is stale or does not bind the exact candidate, backup, rehearsal, source, and target identities.");
  }
  sourceLedgerSha256 = intent.source_migration_ledger_sha256;
  authorizationId = intent.authorization_id;
}
const failAfterOrder = Number(process.env.RELEASE_MIGRATION_TEST_FAIL_AFTER_ORDER || 0);
const db = new Client({
  connectionString: databaseUrl,
  application_name: "memphis-zoo-release-migration-plan",
  ...(databaseCaCertPath ? { ssl: { ca: readFileSync(resolve(databaseCaCertPath), "utf8"), rejectUnauthorized: true } } : {}),
});
await db.connect();
try {
  await db.query("begin isolation level serializable");
  await db.query("set local lock_timeout='5s'");
  await db.query("set local statement_timeout='180s'");
  await db.query("select pg_advisory_xact_lock(hashtextextended('memphis-zoo-release-migration-plan',0))");
  await db.query("select pg_advisory_xact_lock(hashtextextended('memphis-zoo-application-mutation-fence',0))");
  await db.query("lock table supabase_migrations.schema_migrations in access exclusive mode");
  const applicationTables = await db.query(`
    select format('%I.%I',n.nspname,c.relname) table_name
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname in ('public','auth') and c.relkind in ('r','p')
    order by n.nspname,c.relname
  `);
  if (applicationTables.rowCount) await db.query(`lock table ${applicationTables.rows.map((row) => row.table_name).join(",")} in access exclusive mode`);
  const currentDatabase = String((await db.query("select current_database() database_name")).rows[0].database_name);
  const beforeCatalog = normalizeCatalog(await captureSchemaCatalog({ query: (sql) => db.query(sql) }), currentDatabase);
  const beforeCatalogIdentity = fingerprintSchemaCatalog(beforeCatalog);
  if (beforeCatalogIdentity.fingerprint !== expectedSourceCatalogFingerprint
      || stableJson(catalogCounts(beforeCatalog)) !== stableJson(expectedSourceCatalogCounts)) {
    throw new Error("Locked source catalog does not equal the exact admitted production catalog and privilege state.");
  }
  const beforeLedger = await db.query("select version::text,name::text,statements from supabase_migrations.schema_migrations order by version");
  const beforeHead = beforeLedger.rows.at(-1);
  if (beforeLedger.rowCount !== Number(state.observed_production.production_ledger_count)
      || beforeHead?.version !== state.observed_production.ledger_head
      || beforeHead?.name !== state.observed_production.source_migration_name) {
    throw new Error("Restored migration ledger does not equal the admitted pre-migration production state.");
  }
  if (ledgerFileSha256(beforeLedger.rows) !== sourceLedgerSha256) throw new Error("Locked source migration ledger digest does not equal the fresh signed backup.");
  if (beforeLedger.rows.some((row) => plan.some((item) => item.source_migration_version === row.version))) {
    throw new Error("One or more pending release migrations are already present; refusing a partial or replayed plan.");
  }
  const outlookBefore = await outlookSnapshot(db);
  if (outlookBefore.present !== state.observed_production.outlook_event_sync_table_present) {
    throw new Error("Restored Outlook event-sync authority presence differs from the admitted production state.");
  }
  const applied = [];
  for (const migration of plan) {
    await db.query(migration.body);
    await db.query(`
      insert into supabase_migrations.schema_migrations(
        version,statements,name,created_by,idempotency_key,rollback
      ) values($1,$2::text[],$3,$4,null,null)
    `, [migration.source_migration_version, [migration.sql], migration.phase, actor]);
    applied.push({ order: migration.order, version: migration.source_migration_version, file: basename(migration.file), sha256: migration.sha256 });
    if (failAfterOrder === migration.order) {
      if (!allowFailureProbe) throw new Error("Release migration failure injection is restricted to a disposable loopback database.");
      throw new Error(`Isolated release migration failure probe after order ${migration.order}.`);
    }
  }
  const afterLedger = await db.query("select version::text,name::text,statements from supabase_migrations.schema_migrations order by version");
  if (afterLedger.rowCount !== Number(state.target.production_ledger_count)
      || afterLedger.rows.at(-1)?.version !== state.target.source_migration_version
      || stableJson(afterLedger.rows.slice(-plan.length).map((row) => row.version)) !== stableJson(plan.map((item) => item.source_migration_version))) {
    throw new Error("Release migration ledger did not advance by the exact ordered plan.");
  }
  const outlookAfter = await outlookSnapshot(db);
  if (stableJson(outlookAfter) !== stableJson(outlookBefore)) {
    throw new Error("Outlook event-sync rows changed while adopting their source authority.");
  }
  if (stableJson(afterLedger.rows.slice(0, beforeLedger.rowCount)) !== stableJson(beforeLedger.rows)) {
    throw new Error("An earlier migration-ledger entry changed while applying the release plan.");
  }
  const afterCatalog = normalizeCatalog(await captureSchemaCatalog({ query: (sql) => db.query(sql) }), currentDatabase);
  const afterCatalogIdentity = fingerprintSchemaCatalog(afterCatalog);
  if (afterCatalogIdentity.fingerprint !== state.target.canonical_source_schema_fingerprint
      || stableJson(catalogCounts(afterCatalog)) !== stableJson(state.target.expected_catalog_counts)) {
    throw new Error("Locked post-migration catalog does not equal the exact reviewed target catalog and privilege state.");
  }
  await db.query("commit");
  console.log(JSON.stringify({
    ok: true,
    project_ref: projectRef,
    actor,
    authorization_id: authorizationId,
    rehearsal,
    candidate_commit: candidateCommit,
    candidate_tree: candidateTree,
    source_catalog_fingerprint: beforeCatalogIdentity.fingerprint,
    target_catalog_fingerprint: afterCatalogIdentity.fingerprint,
    source_migration_ledger_sha256: sourceLedgerSha256,
    before_ledger_count: beforeLedger.rowCount,
    before_ledger_head: beforeHead.version,
    after_ledger_count: afterLedger.rowCount,
    after_ledger_head: afterLedger.rows.at(-1).version,
    applied,
    outlook_rows_preserved: outlookAfter.rows,
    outlook_rows_sha256: outlookAfter.sha256,
  }, null, 2));
} catch (error) {
  await db.query("rollback").catch(() => {});
  throw error;
} finally {
  await db.end().catch(() => {});
}
