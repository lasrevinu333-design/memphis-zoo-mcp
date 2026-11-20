import assert from 'node:assert/strict';
import pg from 'pg';
import { stableJsonFileSha256 } from './disaster-recovery-crypto.mjs';
import { NATIVE_TEXT_PRESERVATION_SETTINGS } from './isolated-release-data-preservation.mjs';
import { captureCatalogFromSnapshot } from './schema-catalog-readonly-client.mjs';
import { fingerprintSchemaCatalog } from './schema-fingerprint-catalog.mjs';
import { readCurrent428PreservedRows, readCurrent428RecoveryDefinitions } from './current428-forward-readback.mjs';
import { readVerifiedCurrent428ForwardQualificationSource } from './current428-forward-qualification-source.mjs';
import { assertVerifiedImmutableBootstrapSource } from './immutable-private-source-bootstrap.mjs';

const { Client } = pg;
const nativeQuery = Client.prototype.query;
const sha256 = /^[a-f0-9]{64}$/;
const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const inventory = 'public.custodial_release_authority_restore_inventory';
const guard = 'trg_custodial_release_authority_restore_inventory_immutable';
const ledgerSql = 'select version::text,name::text,statements from supabase_migrations.schema_migrations order by version';
const stages = new Set([
  'SIGNED_RECONCILIATION', 'RESTORED_BASELINE', 'NORMALIZE_REGISTRY', 'VERIFY_NORMALIZED_CATALOG',
  'APPLY_FORWARD', 'VERIFY_CURRENT_WEEK', 'VERIFY_TARGET', 'ROLLBACK_READBACK',
]);

export function current428CaptureRefusal(error) {
  if (!(error instanceof Error) || error.code !== 'CURRENT428_CAPTURE_REFUSED' || !stages.has(error.stage)) return null;
  const sqlstate = typeof error.sqlstate === 'string' && /^[0-9A-Z]{5}$/.test(error.sqlstate) ? error.sqlstate : null;
  const migration = typeof error.migration === 'string' && /^[0-9]{14}$/.test(error.migration) ? error.migration : null;
  return {stage:error.stage, sqlstate, migration, rollback_readback_verified:error.rollback_readback_verified === true};
}

// The same two fields were transformed by the restore initializer. Decode the
// archived row with the existing native codec and touch only those exact rows.
export const revertCurrent428RegistrySql = `with archived as materialized (
 select row_image from json_array_elements($1::json) e(raw)
 cross join lateral custodial_dr.immutable_import_text_record(null::${inventory},e.raw::text) row_image
), previous as (
 select (row_image).inventory_id inventory_id,(row_image).object_identity identity,
        (row_image).definition_sql definition,(row_image).definition_sha256 sha
 from archived where (row_image).object_kind='function' and $2::jsonb ? ((row_image).object_identity)
)
update only ${inventory} i set definition_sql=p.definition,definition_sha256=p.sha
from previous p where i.inventory_id=p.inventory_id and i.object_kind='function' and i.object_identity=p.identity
 and i.definition_sql=$2::jsonb->p.identity->>'definition_sql'
 and i.definition_sha256=$2::jsonb->p.identity->>'definition_sha256'`;

const reconciliationSql = `select current_database() db, current_user actor, session_user login,
 (select datdba::regrole::text from pg_database where datname=current_database()) owner,
 (select rolsuper from pg_roles where rolname=current_user) superuser,
 current_setting('cron.launch_active_jobs') cron_enabled,current_setting('cron.database_name') cron_db,
 current_setting('session_replication_role') replication, c.state, c.mutations_paused,
 m.final_manifest_sha256, e.evidence_json->>'reconciliation_id' reconciliation_id,
 e.evidence_json->>'intent_sha256' intent_sha256, e.evidence_json->>'discrepancy_snapshot_sha256' discrepancy_sha256,
 (select count(*)::text from custodial_dr.restore_discrepancies d where d.restore_id=c.restore_id and d.status<>'RESOLVED') unresolved,
 (select count(*)::text from custodial_dr.application_mutation_leases) leases
 from custodial_dr.restore_control c
 join custodial_dr.restore_manifests m using(restore_id,authority_generation,archive_digest)
 join custodial_dr.restore_events e using(restore_id,authority_generation)
 where c.singleton and c.restore_id=$1::uuid and c.authority_generation=$2::bigint and c.archive_digest=$3
 and m.database_verified and m.storage_verified and m.authority_invalidated and m.post_restore_verified
 and e.phase='PRODUCTION_RECONCILIATION' and e.outcome='RESOLVED'
 and e.evidence_json->>'final_manifest_sha256'=m.final_manifest_sha256
 and e.evidence_json->>'archive_digest'=c.archive_digest`;

// The role catalog deliberately denies SET ROLE to the migration owner for
// the application reader. Observe its existing EXECUTE grants alongside the
// actual security-definer results. Only counts, statuses and hashes leave SQL.
export const currentWeekReadbackSql = `with week as (
 select (transaction_timestamp() at time zone 'America/Chicago')::date today,
        date_trunc('week',transaction_timestamp() at time zone 'America/Chicago')::date monday
), days as (
 select today,monday+i service_date from week cross join generate_series(0,6) i
), employee_days as materialized (
 select d.service_date, r.employee_id,
        public.static_weekly_v5_read_employee_day(d.service_date,r.employee_id,transaction_timestamp()) payload
 from days d
 cross join lateral (
  select distinct roster.employee_id from public.static_weekly_v6_read_roster(d.service_date) roster
  where roster.employee_id is not null
 ) r
)
select d.today::text,d.service_date::text,authority.governed,authority.projection_status,
       count(e.employee_id)::int roster_employees,
       count(e.employee_id) filter(where e.payload->>'projection_status'='current'
        and e.payload->>'governed'='true' and e.payload->>'service_date'=d.service_date::text
        and e.payload->>'employee_id'=e.employee_id::text and e.payload->>'projection_id' is not null)::int current_employees,
       encode(extensions.digest(convert_to(coalesce(string_agg(
        encode(extensions.digest(convert_to(e.payload::text,'UTF8'),'sha256'),'hex'),''
        order by e.employee_id),''),'UTF8'),'sha256'),'hex') employee_days_sha256,
       has_function_privilege('custodial_readonly_runtime_20260822',
        'public.static_weekly_v5_read_employee_day(date,uuid,timestamp with time zone)','EXECUTE') reader_execute
from days d cross join lateral public.static_weekly_v6_schedule_authority_state(d.service_date) authority
left join employee_days e on e.service_date=d.service_date
group by d.today,d.service_date,authority.governed,authority.projection_status
order by d.service_date`;

async function readCurrentWeek(query) {
  const result = await query(currentWeekReadbackSql);
  assert.equal(result.rowCount, 7, 'Schedule authority must report all seven Chicago calendar days');
  const serviceDates = result.rows.map(row => row.service_date);
  assert.equal(new Set(serviceDates).size, 7);
  for (const row of result.rows) {
    assert.match(row.today, /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/);
    assert.match(row.service_date, /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/);
    assert.equal(typeof row.governed, 'boolean');
    assert.ok(typeof row.projection_status === 'string' && /^[a-z0-9_]{1,80}$/.test(row.projection_status));
    assert.ok(Number.isSafeInteger(row.roster_employees) && row.roster_employees >= 0);
    assert.ok(Number.isSafeInteger(row.current_employees) && row.current_employees >= 0 && row.current_employees <= row.roster_employees);
    assert.match(row.employee_days_sha256, sha256);
    assert.equal(typeof row.reader_execute, 'boolean');
  }
  assert.equal(new Set(result.rows.map(row => row.today)).size, 1);
  assert.ok(serviceDates.includes(result.rows[0].today));
  return result.rows;
}

// Invoked by an owning disposable rehearsal after its existing signed
// reconciliation has committed. All catalog and SQL changes are rolled back.
// This function cannot choose an archive, start a restore, or sign anything.
export async function captureCurrent428RollbackTarget({client, archive, bootstrapSource, paused, reconciliation, verifyTarget}) {
  assert.equal(process.env.GITHUB_ACTIONS, 'true');
  assert.match(process.env.GITHUB_RUN_ID ?? '', /^[1-9][0-9]*$/);
  assert.equal(process.env.OFFICIAL_LOCAL_STORAGE_PROVIDER, 'true');
  assert.equal(process.env.REHEARSAL_SCOPE, 'backup_only');
  const database = 'mz_schema_rebuild_' + process.env.GITHUB_RUN_ID;
  const source = readVerifiedCurrent428ForwardQualificationSource(archive);
  assertVerifiedImmutableBootstrapSource(bootstrapSource, archive);
  assert.equal(paused.scope, 'original_owner_paused_restore_readback');
  assert.equal(paused.archive_digest, source.archive_digest);
  assert.match(paused.restore_id, uuid);
  assert.match(paused.final_manifest_sha256, sha256);
  assert.match(paused.discrepancy_snapshot_sha256, sha256);
  assert.ok(Number.isSafeInteger(paused.authority_generation) && paused.authority_generation > 0);
  assert.equal(reconciliation.ok, true);
  assert.equal(reconciliation.restore_id, paused.restore_id);
  assert.equal(reconciliation.idempotent_replay, false);
  assert.equal(reconciliation.resumed, true);
  assert.match(reconciliation.reconciliation_id, uuid);
  const verifyClient = () => {
    assert.equal(Object.getPrototypeOf(client), Client.prototype);
    assert.ok(!Object.hasOwn(client, 'query') && Client.prototype.query === nativeQuery);
    assert.equal(client.connectionParameters.host, '127.0.0.1');
    assert.equal(client.connectionParameters.database, database);
    assert.equal(client.connectionParameters.user, 'postgres');
  };
  const query = async (sql, params = []) => {
    verifyClient();
    const result = await Reflect.apply(nativeQuery, client, [sql, params]);
    verifyClient();
    return result;
  };
  const readReconciliation = async () => {
    const result = await query(reconciliationSql, [paused.restore_id, paused.authority_generation, source.archive_digest]);
    assert.equal(result.rowCount, 1, 'Exact signed reconciliation must have committed on this isolated copy');
    const row = result.rows[0];
    assert.match(row.intent_sha256, sha256);
    assert.deepEqual(row, {
      db: database, actor: 'postgres', login: 'postgres', owner: 'postgres', superuser: false,
      cron_enabled: 'off', cron_db: database, replication: 'origin', state: 'COMPLETE', mutations_paused: false,
      final_manifest_sha256: paused.final_manifest_sha256, reconciliation_id: reconciliation.reconciliation_id,
      intent_sha256: row.intent_sha256, discrepancy_sha256: paused.discrepancy_snapshot_sha256,
      unresolved: '0', leases: '0',
    });
  };
  const context = async () => {
    await query('set local search_path=pg_catalog');
    for (const [name, setting] of NATIVE_TEXT_PRESERVATION_SETTINGS) {
      await query('select set_config($1,$2,true)', [name, setting]);
    }
  };
  const catalog = async () => {
    const snapshot = await captureCatalogFromSnapshot(client);
    snapshot.cron_jobs = snapshot.cron_jobs.map(row => row.database === database ? {...row, database: 'postgres'} : row);
    return {
      fingerprint: fingerprintSchemaCatalog(snapshot).fingerprint,
      counts: Object.fromEntries(Object.entries(snapshot).map(([name, rows]) => [name, rows.length])),
    };
  };
  const recovery = state => readCurrent428RecoveryDefinitions({client, archive, bootstrapSource, state});
  const data = () => readCurrent428PreservedRows({client, archive});
  await verifyTarget();
  verifyClient();
  assert.equal(client._txStatus, 'I', 'The owning runner must supply an idle native session');
  let initial, target, failure, version = null, rollbackVerified = false;
  let stage = 'SIGNED_RECONCILIATION';
  try {
    await query('begin isolation level serializable');
    await context();
    await query("set local lock_timeout='5s'");
    await query("set local statement_timeout='180s'");
    await query("select pg_advisory_xact_lock(hashtextextended('memphis-zoo-release-migration-plan',0))");
    await query("select pg_advisory_xact_lock(hashtextextended('memphis-zoo-application-mutation-fence',0))");
    await readReconciliation();
    stage = 'RESTORED_BASELINE';
    await query('lock table supabase_migrations.schema_migrations in access exclusive mode');
    await query(`lock table ${inventory} in access exclusive mode`);
    const beforeLedger = (await query(ledgerSql)).rows;
    assert.equal(stableJsonFileSha256(beforeLedger), source.source_ledger_file_sha256);
    initial = {catalog: await catalog(), recovery: await recovery('restored'), data: await data()};

    stage = 'NORMALIZE_REGISTRY';
    for (const recipe of bootstrapSource.recipes) await query(recipe.before);
    await query(`alter table ${inventory} disable trigger ${guard}`);
    const restored = await query(revertCurrent428RegistrySql, [
      '[' + bootstrapSource.registryRows.join(',') + ']', JSON.stringify(bootstrapSource.registrySource),
    ]);
    assert.equal(restored.rowCount, 47);
    await query(`alter table ${inventory} enable always trigger ${guard}`);
    const normal = await recovery('original');
    assert.deepEqual(normal, initial.recovery, 'Normalization must preserve native routine attributes and registry cardinality');
    stage = 'VERIFY_NORMALIZED_CATALOG';
    assert.equal((await catalog()).fingerprint, source.source_catalog_fingerprint, 'Normalized source must equal the signed native catalog');
    assert.deepEqual(await data(), initial.data);
    source.assertCurrent();
    stage = 'VERIFY_CURRENT_WEEK';
    const weekBefore = await readCurrentWeek(query);

    stage = 'APPLY_FORWARD';
    for (const migration of source.pending) {
      version = migration.version;
      await query(migration.body);
      await query(`insert into supabase_migrations.schema_migrations(version,statements,name,created_by,idempotency_key,rollback)
        values($1,$2::text[],$3,$4,null,null)`, [
        migration.version, [migration.sql], migration.file.slice(15, -4), 'isolated-current428-target-capture',
      ]);
    }
    stage = 'VERIFY_TARGET';
    version = null;
    const afterLedger = (await query(ledgerSql)).rows;
    assert.deepEqual(afterLedger.slice(0, beforeLedger.length), beforeLedger);
    assert.deepEqual(afterLedger.slice(beforeLedger.length), source.pending.map(migration => ({
      version: migration.version, name: migration.file.slice(15, -4), statements: [migration.sql],
    })));
    assert.equal(afterLedger.length, source.expected_target_ledger_count);
    assert.equal(afterLedger.at(-1)?.version, source.expected_target_ledger_head);
    assert.deepEqual(await data(), initial.data, 'Forward migration changed original application rows');
    await readReconciliation();
    stage = 'VERIFY_CURRENT_WEEK';
    const weekAfter = await readCurrentWeek(query);
    assert.deepEqual(weekAfter, weekBefore, 'Forward definitions changed an existing current-week employee read');
    target = {
      catalog: await catalog(),
      ledger_count: afterLedger.length,
      ledger_head: afterLedger.at(-1).version,
      ledger_sha256: stableJsonFileSha256(afterLedger),
      current_chicago_week: weekAfter,
    };
    source.assertCurrent();
  } catch (error) {
    failure = {error, stage, version};
  } finally {
    assert.equal((await query('rollback')).command, 'ROLLBACK');
  }

  if (initial) {
    try {
      await query('begin isolation level serializable read only');
      await context();
      await readReconciliation();
      const rows = (await query(ledgerSql)).rows;
      assert.equal(stableJsonFileSha256(rows), source.source_ledger_file_sha256);
      assert.deepEqual({catalog: await catalog(), recovery: await recovery('restored'), data: await data()}, initial);
      source.assertCurrent();
      rollbackVerified = true;
    } catch (error) {
      failure = {error, stage:'ROLLBACK_READBACK', version:null};
    } finally {
      assert.equal((await query('rollback')).command, 'ROLLBACK');
    }
  }
  await verifyTarget();
  if (failure) {
    const sqlstate = failure.error?.code;
    throw Object.assign(new Error('Exact isolated target capture refused'), {
      code:'CURRENT428_CAPTURE_REFUSED', stage:failure.stage,
      sqlstate:typeof sqlstate === 'string' && /^[0-9A-Z]{5}$/.test(sqlstate) ? sqlstate : null,
      migration:failure.version, rollback_readback_verified:rollbackVerified,
    });
  }
  return Object.freeze({scope: 'isolated_current428_rollback_target', archive_digest: source.archive_digest,
    target: Object.freeze(target), application_tables_preserved: initial.data.tables,
    rollback_verified: true, runtime_admission: false, production_written: false});
}
