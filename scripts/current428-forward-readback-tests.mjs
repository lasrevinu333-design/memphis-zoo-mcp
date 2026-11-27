import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { stableJson, stableJsonFileSha256 } from './disaster-recovery-crypto.mjs';
import { preservedRowsSql } from './current428-forward-readback.mjs';
import { nativeTextColumnProjection } from './isolated-release-data-preservation.mjs';
import { quoteIdentifier } from './isolated-event-owner-schema.mjs';

const source = readFileSync(new URL('./current428-forward-readback.mjs', import.meta.url), 'utf8')
  .replace(/^import .*;\n/gm, '')
  .replace(/^export /gm, '');
const archive = Object.freeze({});
const digest428 = 'a'.repeat(64);
const digest429 = 'c'.repeat(64);
const manifestDigest = 'b'.repeat(64);
const restoreId = '12345678-1234-1234-1234-123456789abc';
const projectRef = 'rqquvtjdmugpigbndmne';
const database = 'mz_schema_rebuild_5481';
const digest = s => createHash('sha256').update(s).digest('hex');
const ledger = [
  { version: '20261115155201', name: 'first', statements: ['select 1;'] },
  { version: '20261115162648', name: 'tail', statements: ['select 2;'] },
];
const result = rows => ({ rows, rowCount: rows.length });
const discrepancy = {
  category: 'release_identity', status: 'OPEN', authority_generation: '1',
  before_sha256: digest('before row projection'), restored_sha256: digest('after row projection'),
  before_count: '0', restored_count: '10', details_json: { identity: 'synthetic private data' },
};
const sourceInventory = Object.freeze({
  source_files: 322, historical_files: 311, installed: Object.freeze([]),
  pending: Object.freeze(['synthetic.sql']),
});

function fixture(options = {}) {
  const archiveDigest = options.archiveDigest ?? digest428;
  const calls = [];
  const profile = {
    database_name: database, database_owner: 'postgres', actor: 'postgres', original_actor: 'postgres',
    superuser: false, read_only: 'on', isolation: 'serializable', replication: 'origin',
    row_security: 'off', search_path: 'pg_catalog', cron_active: 'off', cron_database: database,
    snapshot: '80:81:', backend_pid: 42, ...options.profile,
  };
  const state = {
    state: 'PAUSED_RECONCILIATION', mutations_paused: true, restore_id: restoreId, authority_generation: '1',
    archive_digest: archiveDigest, target_project_ref: projectRef, database_verified: true, storage_verified: true,
    authority_invalidated: true, post_restore_verified: true, final_manifest_sha256: manifestDigest,
    mutation_leases: '0', ...options.state,
  };
  const guards = Array.from({ length: options.recipes ?? 51 }, (_, i) => ({
    identity: 'public.fixture' + i + '()', owner: 'postgres', definition: 'after ' + i, body: 'body ' + i,
    attributes: { oid: 10000 + i, proacl: null, prosecdef: false },
  }));
  const bootstrapSource = {
    recipes: guards.map(g => ({ identity: g.identity, afterHash: digest(g.definition), afterBodyHash: digest(g.body) })),
    registryRows: ['{"object_kind":"function","object_identity":"public.fixture0()","definition_sql":"before 0"}'],
    registrySource: { 'public.fixture0()': { definition_sql: 'after 0', definition_sha256: digest('after 0') } },
  };
  class Client {
    connectionParameters = { host: '127.0.0.1', database, user: 'postgres', ...options.connection };
    _txStatus = 'T';
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('pg_current_snapshot()')) {
        return result([calls.length > 1 && options.lastProfile ? { ...profile, ...options.lastProfile } : profile]);
      }
      if (sql.includes('restore_manifests m')) return result([state]);
      if (sql.includes('schema_migrations')) return result(options.ledger ?? ledger);
      if (sql.includes('pg_get_functiondef')) {
        assert.deepEqual(params, [guards.map(g => g.identity)]);
        return result(guards.map((row, index) => index === 3 && options.guard ? { ...row, ...options.guard } : row));
      }
      if (sql.includes('immutable_import_text_record')) {
        assert.deepEqual(params, ['[' + bootstrapSource.registryRows.join(',') + ']', JSON.stringify(bootstrapSource.registrySource)]);
        return result([{ expected_rows: '1', actual_rows: '1', different_rows: '0', always_guard_count: '1', ...options.registry }]);
      }
      if (sql.includes('restore_discrepancies')) {
        assert.deepEqual(params, [restoreId]);
        return result(options.discrepancies ?? [discrepancy]);
      }
      if (sql.startsWith('with source_rows')) {
        assert.match(sql, /from only "public"\."msg_thread_visibility"/);
        return result([{ row_count: '12', rows_sha256: digest('archive-original columns'), ...options.preservedRow }]);
      }
      assert.fail('Unexpected query');
    }
  }
  let sourceReads = 0;
  const selection = { databaseTables: [
    { schema_name: 'public', table_name: 'custodial_release_authority_restore_inventory' },
    { schema_name: 'public', table_name: 'msg_thread_visibility', columns: [{ name: 'deleted_through' }] },
    { schema_name: 'auth', table_name: 'users', columns: [{ name: 'id' }] },
    { schema_name: 'storage', table_name: 'objects', columns: [{ name: 'id' }] },
  ] };
  const binding = { archive_digest: archiveDigest };
  const ports = new Function('assert', 'createHash', 'pg', 'stableJson', 'stableJsonFileSha256', 'assertVerifiedImmutableBootstrapSource',
    'readPrivateForwardQualificationSource', 'process', 'CURRENT428_ARCHIVE_DIGEST', 'current429',
    'readVerifiedArchiveSourceBinding', 'readVerifiedRestoreTableSelection', 'nativeTextColumnProjection', 'quoteIdentifier',
    source + '\nreturn { readCurrent428RestoredBaseline, readCurrent428PreservedRows };')(
    assert, createHash, { Client }, stableJson, stableJsonFileSha256,
    (actual, original) => {
      assert.equal(actual, bootstrapSource);
      assert.equal(original, archive);
      if (++sourceReads > 1 && options.sourceChanged) throw new Error('source no longer current');
    },
    actual => {
      assert.equal(actual, archive);
      return {
        assertCurrent() {}, archive_digest: archiveDigest, source_ledger_count: ledger.length,
        source_ledger_head: ledger.at(-1).version, source_ledger_file_sha256: stableJsonFileSha256(ledger),
        source_inventory: sourceInventory,
      };
    }, { env: { GITHUB_ACTIONS: 'true', GITHUB_RUN_ID: '5481' } }, digest428, { archiveDigest: digest429 },
    original => { assert.equal(original, archive); return binding; },
    (original, scope) => { assert.equal(original, archive); assert.deepEqual(scope, { databaseOnly: true }); return selection; },
    nativeTextColumnProjection, quoteIdentifier);
  const restore = {
    ok: true, database_only: true, state: 'PAUSED_RECONCILIATION', archive_digest: archiveDigest,
    storage: { provider_verified: true, scope: 'OFFICIAL_LOCAL_FILE_BACKEND_SAME_ORIGINAL' },
    authority_observation: { outcome: 'AUTHORITY_COMPLETION_OBSERVED' }, mutations_paused: true,
    resume_allowed: false, remaining_phases: ['SIGNED_RECONCILIATION'],
    target_project_ref: projectRef, restore_id: restoreId, authority_generation: 1,
    final_manifest_sha256: manifestDigest, unresolved_discrepancies: 1, ...options.restore,
  };
  return {
    calls,
    run: () => ports.readCurrent428RestoredBaseline({ client: new Client(), archive, bootstrapSource, restore }),
    preserve: () => ports.readCurrent428PreservedRows({ client: new Client(), archive }),
  };
}

test('the verified archive selects the exact recovery definitions for its own baseline', async () => {
  for (const [archiveDigest, count, otherCount] of [[digest428, 51, 52], [digest429, 52, 51]]) {
    const result = await fixture({ archiveDigest, recipes: count }).run();
    assert.equal(result.restored_recipes, count);
    await assert.rejects(fixture({ archiveDigest, recipes: otherCount }).run, /Recovery recipe count/);
  }
  await assert.rejects(fixture({ archiveDigest: 'd'.repeat(64) }).run, /Unknown readback archive/);
});

test('observes only the owning paused, verified copy and reports exact reconciliation categories', async () => {
  const unit = fixture();
  const evidence = await unit.run();
  assert.equal(evidence.restored_recipes, 51);
  assert.equal(evidence.registry_rows, 1);
  assert.equal(evidence.source_inventory, sourceInventory);
  assert.deepEqual(evidence.open_categories, ['release_identity']);
  const { authority_generation, details_json, ...publicFields } = discrepancy;
  const snapshot = [{ ...publicFields, details_sha256: digest(stableJson(details_json)) }];
  assert.deepEqual(evidence.open_discrepancies, snapshot);
  assert.equal(evidence.discrepancy_snapshot_sha256, digest(stableJson(snapshot)));
  assert.equal(JSON.stringify(evidence).includes('synthetic private data'), false);
  assert.equal(evidence.reconciliation_required, true);
  assert.equal(evidence.forwards_applied, false);
  assert.ok(unit.calls.every(({ sql }) => /^(select|with archived)/.test(sql)), 'no DDL, writes, reconciliation or commit');
});

test('rejects foreign connections and unverified receipts before invoking native SQL', async () => {
  for (const options of [
    { connection: { host: 'production.example' } }, { connection: { user: 'supabase_admin' } },
    { connection: { database: 'mz_schema_rebuild_42' } }, { restore: { state: 'COMPLETE' } },
    { restore: { storage: { provider_verified: false } } }, { restore: { archive_digest: 'c'.repeat(64) } },
  ]) {
    const unit = fixture(options);
    await assert.rejects(unit.run);
    assert.deepEqual(unit.calls, []);
  }
});

test('rejects restore, registry, ledger, source and transaction drift without issuing effects', async () => {
  for (const options of [
    { profile: { read_only: 'off' } }, { profile: { cron_active: 'on' } },
    { state: { mutation_leases: '1' } }, { state: { final_manifest_sha256: 'd'.repeat(64) } },
    { state: { archive_digest: 'c'.repeat(64) } }, { state: { storage_verified: false } },
    { guard: { owner: 'supabase_admin' } }, { guard: { body: 'different' } }, { guard: { definition: 'different' } },
    { registry: { different_rows: '1' } }, { registry: { always_guard_count: '0' } },
    { ledger: [ledger[0], { ...ledger[1], statements: ['select 3;'] }] },
    { discrepancies: [] }, { discrepancies: [{ ...discrepancy, category: 'space in category' }] },
    { discrepancies: [{ ...discrepancy, authority_generation: '2' }] },
    { discrepancies: [{ ...discrepancy, status: 'RESOLVED' }] },
    { discrepancies: [{ ...discrepancy, before_count: '01' }] },
    { discrepancies: [{ ...discrepancy, restored_sha256: 'bad' }] },
    { lastProfile: { snapshot: '81:82:' } }, { sourceChanged: true },
  ]) {
    const unit = fixture(options);
    await assert.rejects(unit.run, undefined, JSON.stringify(options));
    assert.ok(unit.calls.every(({ sql }) => /^(select|with archived)/.test(sql)));
  }
});

test('the owning runner reads the exact archive only after its temporary privilege leases are retired', () => {
  const runner = readFileSync(new URL('./run-private-backup-only-rehearsal.mjs', import.meta.url), 'utf8');
  const start = runner.indexOf('if(result&&(source.sourceBinding.archive_digest===CURRENT428_ARCHIVE_DIGEST||current429Capture))');
  const end = runner.indexOf("phase='verified_waiting_cleanup';", start);
  assert.ok(start > 0 && end > start);
  const readback = runner.slice(start, end);
  for (const lease of ['vendorPrivileges', 'catalogPrivileges']) {
    assert.ok(readback.indexOf(lease + '?.retirement_verified') < readback.indexOf('await reader.connect()'));
    assert.ok(readback.includes(lease + '?.retirement_verified'));
  }
  assert.match(readback, /reader\.query\('begin isolation level serializable read only'\)[\s\S]*readCurrent428RestoredBaseline\(\{client:reader,archive,bootstrapSource,restore:result\}\)/);
  assert.match(readback, /reader\.query\('rollback'\)[\s\S]*finally\{await reader\.end\(\);\}/);
  assert.ok(readback.indexOf('readCurrent428PreservedRows({client:reader,archive})') < readback.indexOf("reader.query('rollback')"));
});

test('preservation reads the exact archived columns and preserves multiset cardinality', () => {
  const sql = preservedRowsSql({
    schema_name: 'public', table_name: 'msg_thread_visibility',
    columns: [{ name: 'thread_id' }, { name: 'deleted_through' }],
  });
  assert.match(sql, /from only "public"\."msg_thread_visibility" r/);
  assert.match(sql, /ARRAY\[r\."thread_id"::pg_catalog\.text,r\."deleted_through"::pg_catalog\.text\]/);
  assert.match(sql, /count\(\*\)::text row_count/);
  assert.match(sql, /string_agg\(row_sha256,'' order by row_sha256 collate pg_catalog\."C"\)/);
  assert.doesNotMatch(sql, /list_reopened|distinct row_sha256/);
});

test('the preservation result binds original rows to the same serializable owner snapshot', async () => {
  const profile = {
    read_only: 'off', isolation: 'serializable', float_digits: '3', date_style: 'ISO, YMD',
    timezone: 'UTC', interval_style: 'postgres', bytea_output: 'hex',
  };
  const unit = fixture({ profile });
  const proof = await unit.preserve();
  const readOnlyProof = await fixture({ profile: { ...profile, read_only: 'on' } }).preserve();
  assert.deepEqual(readOnlyProof, proof);
  assert.equal(proof.tables, 1);
  assert.deepEqual(proof.table_fingerprints, [{
    relation: 'public.msg_thread_visibility', row_count: '12', rows_sha256: digest('archive-original columns'),
  }]);
  assert.equal(proof.rows_sha256, digest(stableJson(proof.table_fingerprints)));
  await assert.rejects(fixture({ profile: { ...profile, timezone: 'America/Chicago' } }).preserve);
  await assert.rejects(fixture({ profile, lastProfile: { snapshot: '81:82:' } }).preserve);
  await assert.rejects(fixture({ profile, preservedRow: { row_count: 'unknown' } }).preserve);
});
