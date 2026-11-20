// Read-only proof for the next phase of the original-owner isolated restore.
// The restore controller owns the client and transaction. This module cannot
// reconcile, retire restore recipes, apply forwards, or authorize a release.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import pg from 'pg';
import { stableJson, stableJsonFileSha256 } from './disaster-recovery-crypto.mjs';
import { assertVerifiedImmutableBootstrapSource } from './immutable-private-source-bootstrap.mjs';
import { readVerifiedCurrent428ForwardQualificationSource } from './current428-forward-qualification-source.mjs';

const { Client } = pg;
const originalQuery = Client.prototype.query;
const digest = data => createHash('sha256').update(data).digest('hex');
const sha256 = /^[a-f0-9]{64}$/;
const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const registryRelation = 'public.custodial_release_authority_restore_inventory';
const projectRef = 'rqquvtjdmugpigbndmne';

const nativeProfileSql = `select current_database() database_name, current_user actor,
 session_user original_actor, pg_backend_pid() backend_pid,
 (select datdba::regrole::text from pg_database where datname=current_database()) database_owner,
 (select rolsuper from pg_roles where rolname=current_user) superuser,
 current_setting('transaction_read_only') read_only,
 current_setting('transaction_isolation') isolation,
 current_setting('session_replication_role') replication,
 current_setting('row_security') row_security,
 current_setting('search_path') search_path,
 current_setting('cron.launch_active_jobs') cron_active,
 current_setting('cron.database_name') cron_database,
 pg_current_snapshot()::text snapshot
`;

const manifestSql = `select c.state, c.mutations_paused, c.restore_id::text,
 c.authority_generation::text, c.archive_digest, c.target_project_ref,
 m.database_verified, m.storage_verified, m.authority_invalidated,
 m.post_restore_verified, m.final_manifest_sha256,
 (select count(*)::text from custodial_dr.application_mutation_leases) mutation_leases
 from custodial_dr.restore_control c
 join custodial_dr.restore_manifests m using (restore_id,authority_generation,archive_digest)
 where c.singleton`;

const recipeSql = `select r.identity, p.proowner::regrole::text owner,
 pg_get_functiondef(p.oid) definition, p.prosrc body
 from unnest($1::text[]) with ordinality r(identity,position)
 left join pg_proc p on p.oid=to_regprocedure(r.identity)
 order by r.position`;

// Compare the signed row images inside PostgreSQL. Only counts leave the
// query, including on refusal. This keeps private registry text out of CI.
const registrySql = `with archived as (
 select row_image from json_array_elements($1::json) entry(raw)
 cross join lateral custodial_dr.immutable_import_text_record(
   null::public.custodial_release_authority_restore_inventory,entry.raw::text
 ) row_image
), expected as (
 select (a.row_image).inventory_id inventory_id,
 case when (a.row_image).object_kind='function'
      and $2::jsonb ? ((a.row_image).object_identity)
 then to_jsonb(a.row_image) || ($2::jsonb -> ((a.row_image).object_identity))
 else to_jsonb(a.row_image) end image
 from archived a
), actual as (
 select r.inventory_id,to_jsonb(r) image from only ${registryRelation} r
)
select
 (select count(*)::text from expected) expected_rows,
 (select count(*)::text from actual) actual_rows,
 (select count(*)::text from expected e full join actual a using(inventory_id)
  where a.image is distinct from e.image) different_rows,
 (select count(*)::text from pg_trigger t
  where t.tgrelid='${registryRelation}'::regclass
  and t.tgname='trg_custodial_release_authority_restore_inventory_immutable'
  and not t.tgisinternal and t.tgenabled='A') always_guard_count`;

function one(result, label) {
  assert.equal(result.rowCount, 1, label);
  return result.rows[0];
}

function assertProfile(profile, databaseName) {
  assert.equal(profile.database_name, databaseName);
  assert.equal(profile.database_owner, 'postgres');
  assert.equal(profile.actor, 'postgres');
  assert.equal(profile.original_actor, 'postgres');
  assert.equal(profile.superuser, false);
  assert.equal(profile.read_only, 'on');
  assert.equal(profile.isolation, 'repeatable read');
  assert.equal(profile.replication, 'origin');
  assert.equal(profile.row_security, 'off');
  assert.equal(profile.search_path, 'pg_catalog');
  assert.equal(profile.cron_active, 'off');
  assert.equal(profile.cron_database, databaseName);
  assert.equal(typeof profile.snapshot, 'string');
  assert.match(profile.snapshot, /^[0-9]+:[0-9]+:[0-9,]*$/);
  assert.ok(Number.isSafeInteger(profile.backend_pid) && profile.backend_pid > 0);
}

export async function readCurrent428RestoredBaseline({ client, archive, bootstrapSource, restore }) {
  const forward = readVerifiedCurrent428ForwardQualificationSource(archive);
  const sourceCurrent = () => {
    assertVerifiedImmutableBootstrapSource(bootstrapSource, archive);
    forward.assertCurrent();
  };
  sourceCurrent();
  const runId = process.env.GITHUB_RUN_ID;
  assert.equal(process.env.GITHUB_ACTIONS, 'true');
  assert.match(runId ?? '', /^[1-9][0-9]*$/);
  const databaseName = 'mz_schema_rebuild_' + runId;
  const native = () => {
    assert.ok(client && Object.getPrototypeOf(client) === Client.prototype
      && !Object.hasOwn(client, 'query') && Client.prototype.query === originalQuery);
    assert.equal(client.connectionParameters.host, '127.0.0.1');
    assert.equal(client.connectionParameters.database, databaseName);
    assert.equal(client.connectionParameters.user, 'postgres');
    assert.equal(client._txStatus, 'T');
  };
  const query = async (sql, params = []) => {
    native();
    const result = await Reflect.apply(originalQuery, client, [sql, params]);
    native();
    return result;
  };
  assert.equal(restore.ok, true);
  assert.equal(restore.database_only, true);
  assert.equal(restore.storage?.provider_verified, true);
  assert.equal(restore.storage?.scope, 'OFFICIAL_LOCAL_FILE_BACKEND_SAME_ORIGINAL');
  assert.equal(restore.authority_observation?.outcome, 'AUTHORITY_COMPLETION_OBSERVED');
  assert.equal(restore.mutations_paused, true);
  assert.equal(restore.resume_allowed, false);
  assert.deepEqual(restore.remaining_phases, ['SIGNED_RECONCILIATION']);
  assert.equal(restore.state, 'PAUSED_RECONCILIATION');
  assert.equal(restore.archive_digest, forward.archive_digest);
  assert.equal(restore.target_project_ref, projectRef);
  assert.match(restore.restore_id, uuid);
  assert.match(restore.final_manifest_sha256, sha256);
  assert.ok(Number.isSafeInteger(restore.authority_generation) && restore.authority_generation > 0);
  assert.ok(Number.isSafeInteger(restore.unresolved_discrepancies) && restore.unresolved_discrepancies >= 0);

  const profile = one(await query(nativeProfileSql), 'one native owner profile');
  assertProfile(profile, databaseName);
  const state = one(await query(manifestSql), 'one original restore manifest');
  assert.deepEqual(state, {
    state: 'PAUSED_RECONCILIATION',
    mutations_paused: true,
    restore_id: restore.restore_id,
    authority_generation: String(restore.authority_generation),
    archive_digest: forward.archive_digest,
    target_project_ref: projectRef,
    database_verified: true,
    storage_verified: true,
    authority_invalidated: true,
    post_restore_verified: true,
    final_manifest_sha256: restore.final_manifest_sha256,
    mutation_leases: '0',
  }, 'Live manifest, authority, Storage and paused state must match the owning restore');

  const ledger = await query('select version::text,name::text,statements from supabase_migrations.schema_migrations order by version');
  assert.equal(ledger.rowCount, forward.source_ledger_count);
  assert.equal(ledger.rows.at(-1)?.version, forward.source_ledger_head);
  assert.equal(stableJsonFileSha256(ledger.rows), forward.source_ledger_file_sha256);

  const recipes = bootstrapSource.recipes;
  assert.equal(recipes.length, 51);
  const guards = await query(recipeSql, [recipes.map(recipe => recipe.identity)]);
  assert.equal(guards.rowCount, recipes.length);
  for (const [index, recipe] of recipes.entries()) {
    const row = guards.rows[index];
    assert.equal(row.identity, recipe.identity);
    assert.equal(row.owner, 'postgres');
    assert.equal(digest(row.definition), recipe.afterHash, 'Installed restore recipe definition changed');
    assert.equal(digest(row.body), recipe.afterBodyHash, 'Installed restore recipe body changed');
  }

  const registry = one(await query(registrySql, [
    '[' + bootstrapSource.registryRows.join(',') + ']',
    JSON.stringify(bootstrapSource.registrySource),
  ]), 'one registry comparison');
  const registryRows = String(bootstrapSource.registryRows.length);
  assert.deepEqual(registry, {
    expected_rows: registryRows,
    actual_rows: registryRows,
    different_rows: '0',
    always_guard_count: '1',
  }, 'Recovery inventory must match the archived rows plus the installed restore recipes');

  const open = await query(`select category,status,authority_generation::text,before_sha256,restored_sha256,
    before_count::text,restored_count::text,details_json
    from custodial_dr.restore_discrepancies where restore_id=$1::uuid order by category`, [restore.restore_id]);
  assert.equal(open.rowCount, restore.unresolved_discrepancies);
  const openDiscrepancies = open.rows.map(row => {
    assert.equal(row.authority_generation, String(restore.authority_generation));
    assert.equal(row.status, 'OPEN');
    assert.match(row.category, /^[a-z0-9_]{1,120}$/);
    for (const value of [row.before_sha256, row.restored_sha256]) {
      assert.ok(value === null || typeof value === 'string' && sha256.test(value));
    }
    for (const value of [row.before_count, row.restored_count]) {
      assert.ok(value === null || typeof value === 'string' && /^(0|[1-9][0-9]{0,18})$/.test(value));
    }
    // Match the existing reconciliation creator's signed snapshot shape.
    // Keep the underlying restore details and private identities out of CI receipts.
    return Object.freeze({
      category: row.category,
      status: row.status,
      before_sha256: row.before_sha256,
      restored_sha256: row.restored_sha256,
      before_count: row.before_count,
      restored_count: row.restored_count,
      details_sha256: digest(stableJson(row.details_json || {})),
    });
  });
  const openCategories = openDiscrepancies.map(row => row.category);
  assert.equal(new Set(openCategories).size, openCategories.length);
  assert.deepEqual(one(await query(nativeProfileSql), 'same native owner profile'), profile);
  sourceCurrent();
  return Object.freeze({
    scope: 'original_owner_paused_restore_readback',
    archive_digest: forward.archive_digest,
    final_manifest_sha256: restore.final_manifest_sha256,
    restore_id: restore.restore_id,
    authority_generation: restore.authority_generation,
    registry_rows: Number(registryRows),
    restored_recipes: recipes.length,
    ledger_count: forward.source_ledger_count,
    ledger_head: forward.source_ledger_head,
    open_categories: Object.freeze(openCategories),
    open_discrepancies: Object.freeze(openDiscrepancies),
    discrepancy_snapshot_sha256: digest(stableJson(openDiscrepancies)),
    reconciliation_required: true,
    forwards_applied: false,
  });
}
