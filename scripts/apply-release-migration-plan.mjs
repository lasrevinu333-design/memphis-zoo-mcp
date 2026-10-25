#!/usr/bin/env node
import {assertReleaseWorkflowSource} from './release-migration-workflow-preflight.mjs';
import {openIsolatedPreservationArchive} from './release-migration-isolated-preservation-archive.mjs';
import {prepareIsolatedReleaseDataPreservation} from './isolated-release-data-preservation.mjs';
import {runTargetCaptureStep,writeTargetCaptureRefusal} from './release-migration-target-refusal.mjs';
import {prepareTargetCapture,writeTargetCapture} from './release-migration-target-capture.mjs';
import {resolveReleaseMigrationSource,releaseMigrationPlanIdentity} from './production-forward-source.mjs';

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
import { fingerprintSchemaCatalog } from "./schema-fingerprint-catalog.mjs";
import {captureCatalogFromSnapshot} from "./schema-catalog-readonly-client.mjs";
import {
  TASK_LOCAL_PROVENANCE_KIND,
  TASK_LOCAL_RUNNER_PATH,
  validateAuthorizationRehearsalProvenance,
} from "./release-migration-rehearsal-provenance.mjs";

const { Client } = pg;
const root = resolve(new URL("..", import.meta.url).pathname);
let state = JSON.parse(readFileSync(resolve(root, "release/production-migration-state.json"), "utf8"));
const databaseUrl = String(process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || "").trim();
const databaseCaCertPath = String(process.env.SUPABASE_DB_CA_CERT_PATH || "").trim();
const projectRef = String(process.env.SUPABASE_PROJECT_REF || "").trim();
const confirmedRef = String(process.env.RELEASE_MIGRATION_CONFIRM_PROJECT_REF || "").trim();
const actor = String(process.env.RELEASE_MIGRATION_NAMED_ACTOR || "").trim();
const apply = String(process.env.RELEASE_MIGRATION_APPLY || "false").toLowerCase() === "true";
const rehearsal = String(process.env.RELEASE_MIGRATION_REHEARSAL || "false").toLowerCase() === "true";
const candidateCommit = String(process.env.RELEASE_MIGRATION_CANDIDATE_COMMIT || "").trim().toLowerCase();
const candidateTree = String(process.env.RELEASE_MIGRATION_CANDIDATE_TREE || "").trim().toLowerCase();

const targetCapture = String(process.env.RELEASE_MIGRATION_TARGET_CAPTURE || 'false') === 'true';
let captureContext = null;
// A normal apply must have a complete current target before opening a DB.
// The existing targetCapture route separately enforces signed archive + owned
// loopback postgres-only rollback, and is the producer of these missing facts.
if (!targetCapture) assertReleaseWorkflowSource(root);

if (!apply) throw new Error("RELEASE_MIGRATION_APPLY=true is required.");
if (!databaseUrl || projectRef !== state.project_ref || confirmedRef !== projectRef) {
  throw new Error("SUPABASE_DB_URL and exact project/confirmation identity from production-migration-state.json are required.");
}
if (!actor || !/^[a-zA-Z0-9 ._@:-]{2,160}$/.test(actor)) throw new Error("RELEASE_MIGRATION_NAMED_ACTOR must identify the applying operator.");
if (!/^[0-9a-f]{40}$/.test(candidateCommit) || !/^[0-9a-f]{40}$/.test(candidateTree)) throw new Error("Exact release migration candidate commit and tree are required.");
if (targetCapture) {
  captureContext = prepareTargetCapture({backendRoot:root,state,databaseUrl,rehearsal,apply,candidateCommit,candidateTree,env:process.env});
  state = captureContext.state;
}
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
    const {sql} = resolveReleaseMigrationSource(root,item);
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
const planIdentity = releaseMigrationPlanIdentity(plan);
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
if (captureContext && sourceLedgerSha256 !== captureContext.source_ledger_sha256) {
  captureContext.archive.cleanup();
  throw new Error('Target capture must bind the exact authenticated populated archive ledger.');
}
let authorizationId = null;
let authorizationProvenanceKind = rehearsal ? "isolated-rehearsal" : null;
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
  const rehearsalProvenanceKind = validateAuthorizationRehearsalProvenance(intent.rehearsal, {
    candidateCommit,
    candidateTree,
    archiveDigest: intent.backup?.archive_digest,
    resultSha256: intent.rehearsal?.result_sha256,
    runnerSha256: sha256(readFileSync(resolve(root, TASK_LOCAL_RUNNER_PATH))),
  });
  const expiresAt = Date.parse(String(intent.expires_at || ""));
  const approvedAt = Date.parse(String(intent.approved_at || ""));
  const backupCompletedAt = Date.parse(String(intent.backup?.completed_at || ""));
  const rehearsalCompletedAt = Date.parse(String(intent.rehearsal?.completed_at || ""));
  const rehearsalAttestedAt = rehearsalProvenanceKind === TASK_LOCAL_PROVENANCE_KIND
    ? Date.parse(String(intent.rehearsal?.attested_at || ""))
    : rehearsalCompletedAt;
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
      || intent.actor !== actor
      || intent.backup?.source_commit !== candidateCommit || intent.backup?.source_tree !== candidateTree
      || !/^[0-9a-f]{64}$/.test(String(intent.backup?.archive_digest || ""))
      || !/^[0-9a-f]{64}$/.test(String(intent.rehearsal?.receipt_sha256 || ""))
      || !/^[0-9a-f]{64}$/.test(String(intent.rehearsal?.attestation_sha256 || ""))
      || !/^[a-zA-Z0-9._:-]{1,120}$/.test(String(intent.rehearsal?.attestation_key_id || ""))
      || Number(intent.rehearsal?.active_mutation_leases) !== 0 || Number(intent.rehearsal?.expired_mutation_leases) !== 0
      || !Number.isFinite(expiresAt) || expiresAt <= Date.now() || expiresAt > Date.now() + 24 * 60 * 60 * 1000
      || !Number.isFinite(approvedAt) || approvedAt < rehearsalCompletedAt || approvedAt > Date.now()
      || !Number.isFinite(backupCompletedAt) || !Number.isFinite(rehearsalCompletedAt)
      || !Number.isFinite(rehearsalAttestedAt) || !Number.isFinite(observedProductionAt)
      || backupCompletedAt < observedProductionAt || rehearsalCompletedAt < backupCompletedAt
      || rehearsalAttestedAt < rehearsalCompletedAt || rehearsalAttestedAt > approvedAt
      || Date.now() - rehearsalCompletedAt > 24 * 60 * 60 * 1000) {
    throw new Error("Release migration authorization is stale or does not bind the exact candidate, backup, rehearsal, source, and target identities.");
  }
  sourceLedgerSha256 = intent.source_migration_ledger_sha256;
  authorizationId = intent.authorization_id;
  authorizationProvenanceKind = rehearsalProvenanceKind;
}
const failAfterOrder = Number(process.env.RELEASE_MIGRATION_TEST_FAIL_AFTER_ORDER || 0);
const db = new Client({
  connectionString: databaseUrl,
  application_name: "memphis-zoo-release-migration-plan",
  ...(databaseCaCertPath ? { ssl: { ca: readFileSync(resolve(databaseCaCertPath), "utf8"), rejectUnauthorized: true } } : {}),
});
let isolatedPreservationArchive=null;
let transactionStarted=false;
try {
// BEGIN ISOLATED PRESERVATION ARCHIVE
isolatedPreservationArchive=rehearsal&&plan.length===159
 ?openIsolatedPreservationArchive({backendRoot:root,databaseUrl,rehearsal,apply,targetCapture,candidateCommit,candidateTree,
   sourceLedgerSha256,captureContext,env:process.env}):null;
// END ISOLATED PRESERVATION ARCHIVE
  await db.connect();
  if (targetCapture) {
    const profile = (await db.query(`select current_user actor,session_user original_actor,
      (select datdba::regrole::text from pg_database where datname=current_database()) database_owner,
      (select rolsuper from pg_roles where rolname=current_user) superuser,
      (select rolbypassrls from pg_roles where rolname=current_user) bypassrls,
      current_setting('cron.launch_active_jobs') cron_active,
      current_setting('cron.database_name') cron_database,current_database() database_name,
      inet_server_addr()::text server_address`)).rows[0];
    if (profile.actor!=='postgres'||profile.original_actor!=='postgres'||profile.database_owner!=='postgres'
      ||profile.superuser!==false||profile.bypassrls!==true||profile.cron_active!=='off'
      ||profile.cron_database!==profile.database_name) {
      throw new Error('Target capture requires the unchanged postgres owner on its isolated cron-disabled loopback target.');
    }
    captureContext.actor_profile=profile;
    captureContext.assertSourceCurrent();
  }
  await db.query("begin isolation level serializable");
  transactionStarted=true;
  await db.query("set local lock_timeout='5s'");
  await db.query("set local statement_timeout='180s'");
  await db.query("select pg_advisory_xact_lock(hashtextextended('memphis-zoo-release-migration-plan',0))");
  await db.query("select pg_advisory_xact_lock(hashtextextended('memphis-zoo-application-mutation-fence',0))");
  await db.query("lock table supabase_migrations.schema_migrations in access exclusive mode");
  const applicationTables = await db.query(`
    select format('%I.%I',n.nspname,c.relname) table_name
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('r','p')
    order by n.nspname,c.relname
  `);
  if (applicationTables.rowCount) await db.query(`lock table ${applicationTables.rows.map((row) => row.table_name).join(",")} in access exclusive mode`);
  const currentDatabase = String((await db.query("select current_database() database_name")).rows[0].database_name);
  const beforeCatalog = normalizeCatalog(await captureCatalogFromSnapshot(db), currentDatabase);
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
  if (targetCapture) captureContext.locked_source={fingerprint:beforeCatalogIdentity.fingerprint,
    counts:catalogCounts(beforeCatalog),ledger:beforeLedger.rows,database:currentDatabase};
  const outlookBefore = await outlookSnapshot(db);
  if (outlookBefore.present !== state.observed_production.outlook_event_sync_table_present) {
    throw new Error("Restored Outlook event-sync authority presence differs from the admitted production state.");
  }
  // Only after locked source/ledger admission; the finite SQL variants also
  // require their exact project + unchanged postgres session owner internally.
  await db.query("select set_config('custodial.deployment_project_ref',$1,true)",[projectRef]);
  // BEGIN ISOLATED PRESERVATION SNAPSHOT
  const originalDataPreservation=isolatedPreservationArchive
   ?await prepareIsolatedReleaseDataPreservation({client:db,backendRoot:root,sourceCatalog:beforeCatalog,plan,verifiedArchive:isolatedPreservationArchive.archive}):null;
  // END ISOLATED PRESERVATION SNAPSHOT
  const applied = [];
  for (const migration of plan) {
    try {
      await runTargetCaptureStep({db,migration,targetCapture,
        onRefusal:diagnostic=>{captureContext.refusal=diagnostic;},
        run:async()=>{
          await db.query(migration.body);
          await db.query(`
            insert into supabase_migrations.schema_migrations(
              version,statements,name,created_by,idempotency_key,rollback
            ) values($1,$2::text[],$3,$4,null,null)
          `,[migration.source_migration_version,[migration.sql],migration.phase,actor]);
        },
      });
    } catch (error) {
      if (!targetCapture) throw error;
      const refusal = new Error(`Target preparation migration ${migration.order} ${migration.file} refused (${String(error.code || 'SQL_ERROR')}): ${String(error.message || '').slice(0, 1200)}`);
      refusal.code = error.code;
      throw refusal;
    }
    applied.push({ order: migration.order, version: migration.source_migration_version, file: basename(migration.file), sha256: migration.sha256 });
    if (failAfterOrder === migration.order) {
      if (!allowFailureProbe) throw new Error("Release migration failure injection is restricted to a disposable loopback database.");
      throw new Error(`Isolated release migration failure probe after order ${migration.order}.`);
    }
  }
  const afterLedger = await db.query("select version::text,name::text,statements from supabase_migrations.schema_migrations order by version");
  const expectedVersions = new Set([
    ...beforeLedger.rows.map((row) => row.version),
    ...plan.map((item) => item.source_migration_version),
  ]);
  const afterByVersion = new Map(afterLedger.rows.map((row) => [row.version, row]));
  const plannedRowsAreExact = plan.every((item) => {
    const row = afterByVersion.get(item.source_migration_version);
    return row?.name === item.phase && stableJson(row.statements) === stableJson([item.sql]);
  });
  if (afterLedger.rowCount !== Number(state.target.production_ledger_count)
      || afterLedger.rows.at(-1)?.version !== state.target.source_migration_version
      || afterByVersion.size !== afterLedger.rowCount
      || expectedVersions.size !== afterLedger.rowCount
      || afterLedger.rows.some((row) => !expectedVersions.has(row.version))
      || !plannedRowsAreExact) {
    throw new Error("Release migration ledger did not advance by the exact ordered plan.");
  }
  const outlookAfter = await outlookSnapshot(db);
  if (stableJson(outlookAfter) !== stableJson(outlookBefore)) {
    throw new Error("Outlook event-sync rows changed while adopting their source authority.");
  }
  if (beforeLedger.rows.some((row) => stableJson(afterByVersion.get(row.version)) !== stableJson(row))) {
    throw new Error("An earlier migration-ledger entry changed while applying the release plan.");
  }
  // BEGIN ISOLATED PRESERVATION VERIFY
  const originalDataPreservationReceipt=originalDataPreservation?await originalDataPreservation.verify():null;
  // END ISOLATED PRESERVATION VERIFY
  const afterCatalog = normalizeCatalog(await captureCatalogFromSnapshot(db), currentDatabase);
  const afterCatalogIdentity = fingerprintSchemaCatalog(afterCatalog);
  if (!targetCapture && (afterCatalogIdentity.fingerprint !== state.target.canonical_source_schema_fingerprint
      || stableJson(catalogCounts(afterCatalog)) !== stableJson(state.target.expected_catalog_counts))) {
    throw new Error("Locked post-migration catalog does not equal the exact reviewed target catalog and privilege state.");
  }
  if (targetCapture) {
    // Target DATA is retained only after the whole transaction has rolled back
    // and both original catalog and ledger have been independently read back.
    const readerOwners=(await db.query(`
      select n.nspname schema_name,p.proname function_name,
        pg_get_function_identity_arguments(p.oid) identity_arguments,
        p.proowner::regrole::text owner_name,md5(p.prosrc) body_md5,
        md5(pg_get_functiondef(p.oid)) definition_md5,p.prosecdef,p.provolatile,p.proconfig,
        (select jsonb_agg(jsonb_build_object('grantee',coalesce(r.rolname,'PUBLIC'),
          'privilege',a.privilege_type,'grantable',a.is_grantable)
          order by coalesce(r.rolname,'PUBLIC'),a.privilege_type,a.is_grantable)
         from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
         left join pg_roles r on r.oid=a.grantee) acl
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where (n.nspname='custodial_release_identity' and p.proname in
        ('read_current_original_dashboard_completions_v1','read_current_verified_dashboard_checks_v1'))
        or n.nspname='custodial_recovery'
      order by n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)
    `)).rows;
    const recoveryGuard=(await db.query(`
      select n.nspname schema_name,c.relname table_name,c.relowner::regrole::text owner_name,
        t.tgname,t.tgenabled,md5(pg_get_triggerdef(t.oid,true)) definition_md5
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      join pg_trigger t on t.tgrelid=c.oid
      where n.nspname='public' and c.relname='custodial_release_authority_restore_inventory'
        and t.tgname='trg_custodial_release_authority_restore_inventory_immutable'
    `)).rows;
    const privateSchemaOwners=(await db.query(`
      select nspname schema_name,nspowner::regrole::text owner_name from pg_namespace
      where nspname in('custodial_release_identity','custodial_recovery') order by nspname
    `)).rows;
    captureContext.assertSourceCurrent();
    await db.query('rollback');
    await db.query('begin isolation level repeatable read read only');
    const rolledCatalog=normalizeCatalog(await captureCatalogFromSnapshot(db),currentDatabase);
    const rolledLedger=await db.query('select version::text,name::text,statements from supabase_migrations.schema_migrations order by version');
    const rollbackVerified=fingerprintSchemaCatalog(rolledCatalog).fingerprint===beforeCatalogIdentity.fingerprint
      &&stableJson(catalogCounts(rolledCatalog))===stableJson(catalogCounts(beforeCatalog))
      &&stableJson(rolledLedger.rows)===stableJson(beforeLedger.rows);
    await db.query('rollback');
    if(!rollbackVerified)throw new Error('Target preparation rollback did not preserve the exact original catalog and ledger.');
    captureContext.assertSourceCurrent();
    writeTargetCapture(captureContext.output,{
      schema:'custodial.production-migration-target-preparation.v1',scope:'target_preparation',
      committed:false,rollback_verified:true,production_authorized:false,candidate_migration_admission:false,
      runtime_admission:false,full_rehearsal_attestation:false,project_ref:projectRef,
      candidate_commit:candidateCommit,candidate_tree:candidateTree,archive_digest:captureContext.archive_digest,
      owned_target:captureContext.target,actor_profile:captureContext.actor_profile,
      actual_private_routine_metadata:readerOwners,actual_recovery_inventory_guard:recoveryGuard,
      actual_private_schema_owners:privateSchemaOwners,source_data_preservation:originalDataPreservationReceipt,
      source_catalog_fingerprint:beforeCatalogIdentity.fingerprint,source_ledger_sha256:sourceLedgerSha256,
      source_ledger_count:beforeLedger.rowCount,source_ledger_head:beforeHead.version,
      source_authority_migration_count:134,canonical_source_count:293,
      canonical_replay_manifest_sha256:'ff3bc79c2576eb4e3a72295ea92d08a74c8ac6b42a2cf3fee41c97642aa3c539',
      plan_sha256:planSha256,applied,target_catalog_fingerprint:afterCatalogIdentity.fingerprint,
      target_catalog_counts:catalogCounts(afterCatalog),target_ledger_count:afterLedger.rowCount,
      target_ledger_head:afterLedger.rows.at(-1).version,target_ledger_sha256:ledgerFileSha256(afterLedger.rows),
      catalog:afterCatalog,ledger:afterLedger.rows,completed_at:new Date().toISOString(),
    });
    console.log(JSON.stringify({stage:'isolated_target_metadata_captured_then_rolled_back',scope:'target_preparation',
      committed:false,rollback_verified:true,candidate_migration_admission:false,runtime_admission:false,
      source_catalog_fingerprint:beforeCatalogIdentity.fingerprint,target_catalog_fingerprint:afterCatalogIdentity.fingerprint,
      applied_count:applied.length,output:captureContext.output}));
  } else {
  await db.query("commit");
  console.log(JSON.stringify({
    ok: true,
    project_ref: projectRef,
    actor,
    authorization_id: authorizationId,
    authorization_provenance_kind: authorizationProvenanceKind,
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
    ...(originalDataPreservationReceipt?{source_data_preservation:originalDataPreservationReceipt}:{}),
    outlook_rows_preserved: outlookAfter.rows,
    outlook_rows_sha256: outlookAfter.sha256,
  }, null, 2));
  }
} catch (error) {
  // Archive/profile admission can fail before a connection or transaction exists.
  // pg queues queries before connect; never queue a rollback on that path.
  if (!transactionStarted) throw error;
  if (!targetCapture) {
    await db.query("rollback").catch(() => {});
    throw error;
  }
  await db.query("rollback");
  if (targetCapture && captureContext.locked_source) {
    // Never emit a success capture or continue the plan. This receipt exists
    // only after whole rollback and independent exact Source readback.
    const original=captureContext.locked_source;
    await db.query('begin isolation level repeatable read read only');
    const sourceCatalog=normalizeCatalog(await captureCatalogFromSnapshot(db),original.database);
    const sourceLedger=await db.query('select version::text,name::text,statements from supabase_migrations.schema_migrations order by version');
    const preserved=fingerprintSchemaCatalog(sourceCatalog).fingerprint===original.fingerprint
      &&stableJson(catalogCounts(sourceCatalog))===stableJson(original.counts)
      &&stableJson(sourceLedger.rows)===stableJson(original.ledger);
    await db.query('rollback');
    if(!preserved)throw new Error('Target-refusal whole rollback failed exact original catalog/ledger readback.');
    captureContext.assertSourceCurrent();
    if(captureContext.refusal)writeTargetCaptureRefusal(resolve(process.env.RUNNER_TEMP,'production-migration-target-capture-refusal.json'),{
      schema:'custodial.production-migration-target-refusal.v1',scope:'target_preparation_failure',
      committed:false,rollback_verified:true,production_authorized:false,candidate_migration_admission:false,
      runtime_admission:false,full_rehearsal_attestation:false,project_ref:projectRef,
      candidate_commit:candidateCommit,candidate_tree:candidateTree,archive_digest:captureContext.archive_digest,
      source_catalog_fingerprint:original.fingerprint,source_ledger_sha256:sourceLedgerSha256,
      source_ledger_count:original.ledger.length,owned_target:captureContext.target,actor_profile:captureContext.actor_profile,
      plan_sha256:planSha256,refusal:captureContext.refusal,completed_at:new Date().toISOString(),
    });
  }
  throw error;
} finally {
  await db.end().catch(() => {});
  isolatedPreservationArchive?.close();
  captureContext?.archive.cleanup();
}
