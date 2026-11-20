import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { stableJsonFileSha256 } from './disaster-recovery-crypto.mjs';
import { current428CaptureRefusal } from './current428-rollback-target.mjs';

const sourceText = readFileSync(new URL('./current428-rollback-target.mjs', import.meta.url), 'utf8')
  .replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
const database = 'mz_schema_rebuild_1234';
const baseLedger = [{ version: '20261115000000', name: 'fixture', statements: ['select 1'] }];
const pending = [
  { file: '20261115000001_schedule.sql', version: '20261115000001', body: 'fixture schedule', sql: 'select 2' },
  { file: '20261115000002_open.sql', version: '20261115000002', body: 'fixture intent', sql: 'select 3' },
  { file: '20261115000003_cleanup.sql', version: '20261115000003', body: 'fixture cleanup', sql: 'select 4' },
];
const archiveDigest = 'a'.repeat(64);
const restoreId = '10000000-0000-4000-8000-000000000001';
const reconciliationId = '10000000-0000-4000-8000-000000000002';
const paused = {
  scope: 'original_owner_paused_restore_readback', archive_digest: archiveDigest, restore_id: restoreId,
  authority_generation: 1, final_manifest_sha256: 'b'.repeat(64), discrepancy_snapshot_sha256: 'c'.repeat(64),
};
const reconciliation = { ok: true, idempotent_replay: false, resumed: true, restore_id: restoreId, reconciliation_id: reconciliationId };
const originalProof = Object.freeze({ recipes: 51, registryRows: 7791, attributesSha256: 'e'.repeat(64) });
const data = Object.freeze({ tables: 200, rows_sha256: 'f'.repeat(64) });
const source = {
  archive_digest: archiveDigest, source_ledger_file_sha256: stableJsonFileSha256(baseLedger),
  source_catalog_fingerprint: 'original', expected_target_ledger_count: 4, expected_target_ledger_head: pending[2].version,
  pending, assertCurrent() {},
};

function fixture(options = {}) {
  const calls = [];
  class Client {
    connectionParameters = { host: '127.0.0.1', database, user: 'postgres', ...options.connection };
    _txStatus = 'I';
    ledger = [...baseLedger];
    normal = false;
    changes = 0;
    disabled = false;
    async query(sql, args) {
      calls.push(sql);
      if (sql.startsWith('begin isolation level ')) { this._txStatus = 'T'; return {}; }
      if (sql === 'rollback') {
        this.ledger = [...baseLedger]; this.normal = false; this.changes = 0; this.disabled = false; this._txStatus = 'I';
        return { command: 'ROLLBACK' };
      }
      assert.equal(this._txStatus, 'T');
      if (sql.includes("e.phase='PRODUCTION_RECONCILIATION'")) {
        const row = {
          db: database, actor: 'postgres', login: 'postgres', owner: 'postgres', superuser: false,
          cron_enabled: 'off', cron_db: database, replication: 'origin', state: 'COMPLETE', mutations_paused: false,
          final_manifest_sha256: paused.final_manifest_sha256, reconciliation_id: reconciliationId,
          intent_sha256: 'd'.repeat(64), discrepancy_sha256: paused.discrepancy_snapshot_sha256,
          unresolved: '0', leases: '0', ...options.record,
        };
        return { rowCount: 1, rows: [row] };
      }
      if (sql.startsWith('select version::text')) return { rows: [...this.ledger] };
      if (sql === 'fixture before' || /^(set local |select set_config|select pg_advisory_xact_lock|lock table)/.test(sql)) return {};
      if (sql.includes('disable trigger')) { this.disabled = true; return {}; }
      if (sql.includes('enable always trigger')) { this.disabled = false; return {}; }
      if (sql.startsWith('with archived')) {
        assert.equal(this.disabled, true);
        this.normal = true;
        return { rowCount: options.reversalCount ?? 47 };
      }
      if (pending.some(migration => migration.body === sql)) {
        assert.equal(this.disabled, false);
        assert.equal(this.normal, true);
        this.changes++;
        if (options.refuse === sql) throw Object.assign(new Error('private fixture error details'), {code:'23514'});
        return {};
      }
      if (sql.startsWith('insert into supabase_migrations.schema_migrations')) {
        const [version, statements, name] = args;
        this.ledger.push({ version, name, statements });
        return {};
      }
      assert.fail('Unexpected test SQL: ' + sql);
    }
  }
  const execute = new Function('assert', 'pg', 'stableJsonFileSha256', 'NATIVE_TEXT_PRESERVATION_SETTINGS',
    'captureCatalogFromSnapshot', 'fingerprintSchemaCatalog', 'readCurrent428PreservedRows',
    'readCurrent428RecoveryDefinitions', 'readVerifiedCurrent428ForwardQualificationSource',
    'assertVerifiedImmutableBootstrapSource', 'process', sourceText + '\nreturn captureCurrent428RollbackTarget;')(
    assert, { Client }, stableJsonFileSha256, [['row_security','off']],
    async client => ({ cron_jobs: [], footprint: [client.changes ? 'target' : client.normal ? options.original ?? 'original' : 'restored'] }),
    catalog => ({ fingerprint: catalog.footprint[0] }),
    async ({client}) => client.changes && options.dataChanged ? { ...data, rows_sha256: 'changed' } : data,
    async ({client, state}) => {
      assert.equal(client.disabled, false);
      assert.equal(client.normal, state === 'original');
      return originalProof;
    },
    () => source, () => {}, { env: { GITHUB_ACTIONS:'true', GITHUB_RUN_ID:'1234', OFFICIAL_LOCAL_STORAGE_PROVIDER:'true', REHEARSAL_SCOPE:'backup_only' } });
  const client = new Client();
  return { calls, client, run: () => execute({
    client, archive: {}, bootstrapSource: { recipes: [{ before:'fixture before' }], registryRows: [], registrySource: {} },
    paused, reconciliation, verifyTarget: async () => calls.push('inspect fixture'),
  }) };
}

test('the original three forwards run only after signed-state and exact baseline checks, then roll back', async () => {
  const unit = fixture();
  const receipt = await unit.run();
  assert.equal(receipt.rollback_verified, true);
  assert.equal(receipt.target.catalog.fingerprint, 'target');
  assert.equal(receipt.target.ledger_count, 4);
  assert.deepEqual(unit.calls.filter(sql => sql.startsWith('fixture ') && sql !== 'fixture before'), pending.map(row => row.body));
  assert.deepEqual(unit.calls.filter(sql => /^(commit|rollback)/i.test(sql)), ['rollback','rollback']);
  assert.deepEqual(unit.client.ledger, baseLedger);
});

test('foreign host, unresolved reconciliation, changed restore registry and incorrect original schema refuse before forward SQL', async () => {
  for (const options of [
    { connection: { host: 'foreign.invalid' } }, { record: { unresolved: '1' } },
    { record: { discrepancy_sha256: '0'.repeat(64) } }, { reversalCount: 46 }, { original:'incorrect' },
  ]) {
    const unit = fixture(options);
    await assert.rejects(unit.run);
    assert.ok(unit.calls.every(sql => !pending.some(row => sql === row.body)));
    assert.equal(unit.client.disabled, false);
  }
});

test('mid-batch SQL refusal and changed data take the same rollback and independent readback', async () => {
  for (const options of [{refuse: pending[1].body}, {dataChanged:true}]) {
    const unit = fixture(options);
    await assert.rejects(unit.run, error => {
      const proof = current428CaptureRefusal(error);
      assert.deepEqual(proof, options.refuse ? {
        stage:'APPLY_FORWARD', sqlstate:'23514', migration:pending[1].version, rollback_readback_verified:true,
      } : {
        stage:'VERIFY_TARGET', sqlstate:null, migration:null, rollback_readback_verified:true,
      });
      return true;
    });
    assert.deepEqual(unit.calls.filter(sql => /^(commit|rollback)/i.test(sql)), ['rollback','rollback']);
    assert.deepEqual(unit.client.ledger, baseLedger);
    assert.equal(unit.client.disabled, false);
  }
});

test('the existing disposable runner uses the original signed reconciler once, only for an exact empty discrepancy set', async () => {
  const runner = readFileSync(new URL('./run-private-backup-only-rehearsal.mjs', import.meta.url), 'utf8');
  const from = runner.indexOf("    if(current428Capture){\n      phase='current428_signed_isolated_reconciliation';");
  const to = runner.indexOf("    phase='verified_waiting_cleanup';", from);
  assert.ok(from > 0 && to > from);
  const body = new Function('ports', `const { assert, pg, source, secretEnv, baseEnv, run, verifyTarget,
   current428Baseline, result, randomBytes, process, archive, bootstrapSource,
   captureCurrent428RollbackTarget }=ports;
   let current428Capture=true, current428Target=null, isolatedReconciliation=null, phase;
   return async()=>{${runner.slice(from,to)}return {current428Target,isolatedReconciliation,phase};};`);
  const commit = 'c'.repeat(40), tree = 'd'.repeat(40);
  for (const scenario of ['verified', 'open', 'manifest changed']) {
    const calls = [];
    const opened = scenario === 'open' ? [{ category:'storage_state' }] : [];
    const run = async (command, args, options) => {
      calls.push(args.at(-1));
      if (command === 'git') return args.at(-1) === 'HEAD' ? commit : tree;
      assert.equal(options.env.SUPABASE_DB_URL, 'postgresql://fixture-loopback');
      if (args[0] === 'scripts/create-production-restore-reconciliation.mjs') {
        assert.equal(options.env.RESTORE_RECONCILIATION_RESOLUTIONS_JSON, '[]');
        return JSON.stringify({intent: {...paused, resolutions:[],
          final_manifest_sha256: scenario === 'manifest changed' ? '0'.repeat(64) : paused.final_manifest_sha256 }});
      }
      assert.equal(args[0], 'scripts/apply-production-restore-reconciliation.mjs');
      assert.equal(options.env.RESTORE_RECONCILIATION_APPLY, 'true');
      assert.equal(JSON.parse(options.env.RESTORE_RECONCILIATION_JSON).intent.restore_id, restoreId);
      return JSON.stringify(reconciliation);
    };
    const execute = body({
      assert, pg: { Client: class { async connect() {} async end() { calls.push('close'); } } },
      source: {sourceBinding: {project_ref:'fixture-project'}}, secretEnv:{SUPABASE_DB_URL:'postgresql://fixture-loopback'},
      baseEnv: {}, run, verifyTarget: async () => true,
      current428Baseline:{...paused, open_discrepancies:opened}, result:{resume_eligible:true},
      randomBytes: () => Buffer.alloc(32), process:{execPath:'node',env:{GITHUB_SHA:commit,GITHUB_RUN_ID:'1234'}},
      archive: {}, bootstrapSource:{}, captureCurrent428RollbackTarget: async ({reconciliation: applied}) => {
        assert.deepEqual(applied,reconciliation);
        calls.push('capture');
        return {rollback_verified:true};
      },
    });
    if (scenario === 'verified') {
      const receipt = await execute();
      assert.deepEqual(receipt.current428Target, {rollback_verified:true,candidate_commit:commit,candidate_tree:tree});
      assert.deepEqual(calls.slice(-4), [
        'scripts/create-production-restore-reconciliation.mjs', 'scripts/apply-production-restore-reconciliation.mjs', 'capture', 'close',
      ]);
    } else {
      await assert.rejects(execute);
      assert.ok(!calls.includes('scripts/apply-production-restore-reconciliation.mjs'));
      assert.ok(!calls.includes('capture'));
    }
  }
});
