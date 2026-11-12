import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createBackupPgDumpExecutor, isBackupAuthQueryTimeout, captureBackupExporterIdentity } from './production-backup-pg-dump-retry.mjs';
import { productionBackupPgDumpDockerArgs, productionBackupPgDumpSectionDockerArgs } from './production-backup-pg-dump-command.mjs';
const diagnostic = 'pg_dump: error: connection to server at "fixture.pooler.invalid" (192.0.2.1), port 5432 failed: FATAL:  (EAUTHQUERY) auth_query secret check timed out\n';
const transient = (change = {}) => Object.assign(new Error('PRIVATE_SENTINEL'), { code: 1, signal: null, killed: false, stderr: diagnostic, stdout: '', ...change });
function harness(t, { failures = [], inspect = 'absent', partial = false, probeFailsAt = 0, mutateAfterWait = false } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'dump-retry-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const fixture = { caPath: '/fixture-ca', databaseHost: 'fixture.pooler.invalid', databaseName: 'postgres', databasePort: '5432', databaseUsername: 'fixture', exportedSnapshot: '00000003-00000004-1', inventoryDir: directory, pgDumpImage: `supabase/postgres@sha256:${'0'.repeat(64)}`, uid: 1000, gid: 1000 };
  const args = [productionBackupPgDumpDockerArgs(fixture), ...['pre-data', 'post-data'].map(section => productionBackupPgDumpSectionDockerArgs(fixture, section))];
  const calls = [], sleeps = [], reports = [], scratch = [];
  let dumps = 0, probes = 0;
  const options = { env: { PGPASSWORD: 'PRIVATE_SENTINEL' }, maxBuffer: 10 * 1024 * 1024 };
  const execute = createBackupPgDumpExecutor({
    inventoryDir: directory,
    async run(command, actual, opts) {
      calls.push([command, actual]);
      if (actual[0] === 'inspect') {
        assert.deepEqual(actual.slice(0, 5), ['inspect', '--type', 'container', '--format', '{{.State.Status}}']);
        assert.equal(opts.timeout, 10000);
        if (inspect === 'present') return { stdout: 'running\n' };
        if (inspect === 'denied') throw transient({ stderr: 'PRIVATE_SENTINEL daemon permission denied' });
        throw transient({ stderr: `${inspect === 'daemon-absent' ? 'Error response from daemon:' : 'Error:'} No such container: ${actual.at(-1)}\n` });
      }
      assert.equal(command, 'docker');
      assert.equal(opts, options);
      assert.equal(actual[1], '--name');
      assert.match(actual[2], /^custodial-backup-[a-f0-9-]{36}$/);
      assert.equal(scratch.includes(actual[2]), false);
      scratch.push(actual[2]);
      const original = [actual[0], ...actual.slice(3)];
      assert.ok(args.some(expected => JSON.stringify(expected) === JSON.stringify(original)), 'only added unique name; original transport/guard/snapshot args unchanged');
      const path = join(directory, actual.find(arg => arg.startsWith('--file=')).split('/').at(-1));
      assert.equal(readFileSync(path, 'utf8'), '', 'only owned empty output can be used');
      const failure = failures[dumps++];
      if (failure) {
        if (partial) writeFileSync(path, 'partial schema');
        throw failure;
      }
      writeFileSync(path, 'complete schema');
      return { stdout: '', stderr: '' };
    },
    async assertExporterLive() { if (++probes === probeFailsAt) throw Error('PRIVATE_SENTINEL exporter gone'); },
    async sleep(ms) { sleeps.push(ms); if (mutateAfterWait) writeFileSync(join(directory, 'application-schema.sql'), 'unexpected'); },
    report(message) { reports.push(message); },
  });
  return { directory, args, options, execute, calls, sleeps, reports, scratch, dumps: () => dumps, probes: () => probes };
}
async function fails(f, index, code) {
  await assert.rejects(f.execute('docker', f.args[index], f.options), error => {
    assert.equal(error.code, code);
    assert.equal(error.retryable, false);
    assert.equal(error.cause, undefined);
    assert.doesNotMatch(error.stack, /PRIVATE_SENTINEL|fixture\.pooler/);
    return true;
  });
}
test('only exact historical preauth line with known ordinary exit is allowed', () => {
  assert.equal(isBackupAuthQueryTimeout(transient()), true);
  for (const change of [
    { code: 125 }, { code: 'ETIMEDOUT' }, { killed: true }, { signal: 'SIGTERM' },
    { stderr: diagnostic + 'another error\n' }, { stderr: diagnostic.replace('(EAUTHQUERY)', '(AUTH)') },
    { stderr: diagnostic.replace('secret check timed out', 'password authentication failed') },
    { stderr: diagnostic.replace('pg_dump: error: connection', 'pg_dump: error: query') },
    { stderr: 'timeout' }, { stderr: diagnostic.replace('port 5432', 'port 6543') }, { stderr: diagnostic.replace('port 5432', 'port 5433') }, { stderr: diagnostic.replace('FATAL:  ', 'FATAL: ') },
    { stderr: Buffer.from(diagnostic) }, { stderr: 'x'.repeat(4097) },
  ]) assert.equal(isBackupAuthQueryTimeout(transient(change)), false);
});
test('ordinary full/pre/post success has no probes, backoff or retries', async t => {
  const f = harness(t);
  for (const args of f.args) await f.execute('docker', args, f.options);
  assert.equal(f.dumps(), 3); assert.equal(f.probes(), 0); assert.deepEqual(f.sleeps, []);
  assert.equal(new Set(f.scratch).size, 3);
});
test('two retries share exact command and exporter, then succeed', async t => {
  const f = harness(t, { failures: [transient(), transient()] });
  await f.execute('docker', f.args[0], f.options);
  assert.equal(f.dumps(), 3); assert.equal(f.probes(), 4); assert.deepEqual(f.sleeps, [5000, 15000]);
  assert.equal(f.reports.length, 2); assert.doesNotMatch(f.reports.join('\n'), /PRIVATE_SENTINEL|fixture/);
});
test('budget shared across full/pre/post and exhausted failure never retries', async t => {
  const f = harness(t, { failures: [transient(), null, transient(), null, transient()] });
  await f.execute('docker', f.args[0], f.options);
  await f.execute('docker', f.args[1], f.options);
  await fails(f, 2, 'BACKUP_DUMP_RETRIES_EXHAUSTED');
  assert.equal(f.dumps(), 5); assert.deepEqual(f.sleeps, [5000, 15000]);
});
for (const inspect of ['present', 'denied']) test(`container ${inspect} fails closed`, async t => {
  const f = harness(t, { failures: [transient()], inspect });
  await fails(f, 0, 'BACKUP_DUMP_CONTAINER_UNKNOWN'); assert.equal(f.dumps(), 1); assert.deepEqual(f.sleeps, []);
});
test('partial schema bytes refuse retry', async t => {
  const f = harness(t, { failures: [transient()], partial: true });
  await fails(f, 0, 'BACKUP_DUMP_PARTIAL_OUTPUT'); assert.equal(f.dumps(), 1);
});
for (const probeFailsAt of [1, 2]) test(`original exporter loss at probe ${probeFailsAt} refuses retry`, async t => {
  const f = harness(t, { failures: [transient()], probeFailsAt });
  await fails(f, 0, 'BACKUP_DUMP_UNVERIFIED'); assert.equal(f.dumps(), 1);
});
test('output mutation during backoff refuses retry', async t => {
  const f = harness(t, { failures: [transient()], mutateAfterWait: true });
  await fails(f, 0, 'BACKUP_DUMP_PARTIAL_OUTPUT'); assert.equal(f.dumps(), 1);
});
for (const symlink of [false, true]) test(`preexisting ${symlink ? 'symlink' : 'file'} is untouched`, async t => {
  const f = harness(t); const target = join(f.directory, 'existing'); writeFileSync(target, 'original');
  const output = join(f.directory, 'application-schema.sql');
  if (symlink) symlinkSync(target, output); else writeFileSync(output, 'original');
  await fails(f, 0, 'BACKUP_DUMP_UNVERIFIED'); assert.equal(f.dumps(), 0); assert.equal(readFileSync(output, 'utf8'), 'original');
});
test('generic failed child is sanitized and never retried', async t => {
  const f = harness(t, { failures: [transient({ code: 'BACKUP_DUMP_FORGED', stderr: 'PRIVATE_SENTINEL' })] });
  await fails(f, 0, 'BACKUP_DUMP_FAILED'); assert.equal(f.dumps(), 1); assert.deepEqual(f.sleeps, []);
});
test('source-pinned capture prefix is unchanged and wrapper requires same transaction', () => {
  const source = readFileSync(new URL('./production-backup.mjs', import.meta.url), 'utf8');
  const capture = source.slice(source.indexOf('async function captureApplicationSchema('), source.indexOf('\nconst client ='));
  assert.equal(createHash('sha256').update(capture.slice(0, capture.indexOf('\n  const sections = [];'))).digest('hex'), '5d4af573a170c41193ef88a8a6524fbca9f4089b8e3ce36ccb9761468d9f38dd');
  assert.match(source, /row\.snapshot_id !== snapshot\.snapshot_id/);
  assert.match(source, /row\.same_transaction !== true/);
  assert.match(source, /row\.read_only !== 'on' \|\| row\.isolation !== 'repeatable read'/);
});
test('shipping exporter probe rejects different snapshot, transaction, mode or failed query', async () => {
  const source = readFileSync(new URL('./production-backup.mjs', import.meta.url), 'utf8');
  const block = source.slice(source.indexOf('const execFileAsync = createBackupPgDumpExecutor('), source.indexOf('const endBackupClient ='));
  const build = new Function('createBackupPgDumpExecutor', 'join', 'backupDir', 'rawExecFileAsync', 'client', 'snapshot', 'backupTransactionMayBeOpen', 'captureBackupExporterIdentity', 'backupExporterIdentity', block + '\nreturn execFileAsync;');
  const snapshot = { snapshot_id: '10:12:', captured_at: new Date('2026-11-10T15:40:00.123Z') };
  for (const mutation of [null, { snapshot_id: '10:13:' }, { same_transaction: false }, { read_only: 'off' }, { isolation: 'read committed' }, { error: true }, { count: 0 }, { closed: true }, { pid: 24 }, { vxid: '3/5' }]) {
    let queries = 0;
    const client = { async query(sql, values) {
      queries++;
      assert.match(sql, /date_trunc\('milliseconds', transaction_timestamp\(\)\) = \$1::timestamptz/);
      assert.deepEqual(values, [snapshot.captured_at]);
      if (mutation?.error) throw Error('fixture unavailable');
      return { rowCount: mutation?.count ?? 1, rows: [{ snapshot_id: snapshot.snapshot_id, same_transaction: true, read_only: 'on', isolation: 'repeatable read', ...mutation }] };
    } };
    const probe = build(options => options.assertExporterLive, join, '/fixture', () => {}, client, snapshot, !mutation?.closed, async () => ({ backend_pid: mutation?.pid ?? 23, virtualxid: mutation?.vxid ?? '3/4' }), { backend_pid: 23, virtualxid: '3/4' });
    if (mutation) await assert.rejects(probe()); else await probe();
    assert.equal(queries, mutation?.closed || mutation?.pid || mutation?.vxid ? 0 : 1);
  }
});
test('later command may not replace exported snapshot or recapture an already used output', async t => {
  const f = harness(t);
  await f.execute('docker', f.args[0], f.options);
  await fails(f, 0, 'BACKUP_DUMP_COMMAND_INVALID');
  f.args[1] = f.args[1].map(arg => arg.startsWith('--snapshot=') ? '--snapshot=00000003-00000005-1' : arg);
  await fails(f, 1, 'BACKUP_DUMP_COMMAND_INVALID');
  assert.equal(f.dumps(), 1);
});

test('exporter identity requires exactly one valid native PID and virtual-XID lock', async () => {
  const good = { rowCount: 1, rows: [{ backend_pid: 23, virtualxid: '3/4' }] };
  const identity = await captureBackupExporterIdentity({ query: async sql => {
    for (const fragment of ["pid = pg_backend_pid()", "locktype = 'virtualxid'", "mode = 'ExclusiveLock'", "granted = true"]) assert.ok(sql.includes(fragment));
    return good;
  } });
  assert.deepEqual(identity, good.rows[0]); assert.ok(Object.isFrozen(identity));
  for (const bad of [null, {rowCount:1}, {rowCount:1,rows:{}}, {rowCount:0,rows:[]}, {rowCount:2,rows:[...good.rows,...good.rows]}, {rowCount:1,rows:[]},
    ...[{backend_pid:0,virtualxid:'3/4'},{backend_pid:'23',virtualxid:'3/4'},{backend_pid:23,virtualxid:'0/0'},{backend_pid:23,virtualxid:'bad'}].map(row=>({rowCount:1,rows:[row]}))]) {
    await assert.rejects(captureBackupExporterIdentity({query: async()=>bad}), error=>error.code==='BACKUP_DUMP_EXPORTER_IDENTITY_INVALID');
  }
});

test('native Docker daemon exact owned-name absence framing permits bounded retry', async t => {
  const f = harness(t, { failures: [transient()], inspect: 'daemon-absent' });
  await f.execute('docker', f.args[0], f.options);
  assert.equal(f.dumps(), 2); assert.deepEqual(f.sleeps, [5000]);
});

test('initial exporter identity query rejection cannot leak native diagnostics or cause', async () => {
  const native = Object.assign(new Error('PRIVATE_SENTINEL SQL connection detail'), {
    code: 'XX000', detail: 'PRIVATE_SENTINEL', cause: new Error('PRIVATE_SENTINEL cause'),
  });
  await assert.rejects(captureBackupExporterIdentity({query: async()=>{throw native;}}), error=>{
    assert.equal(error.code,'BACKUP_DUMP_EXPORTER_IDENTITY_INVALID');
    assert.equal(error.retryable,false);
    assert.equal(error.cause,undefined);
    assert.equal(error.detail,undefined);
    assert.doesNotMatch(error.stack,/PRIVATE_SENTINEL|XX000/);
    assert.doesNotMatch(JSON.stringify(error),/PRIVATE_SENTINEL|XX000/);
    return true;
  });
});
