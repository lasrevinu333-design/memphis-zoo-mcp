// Opt-in, synthetic-only native qualification. Never reads deployment secrets.
// Fixture adapter adds only resource caps and container-network namespace; all
// builder-produced pg_dump identity, TLS, snapshot and schema flags are retained.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import pg from 'pg';
import { createBackupPgDumpExecutor, captureBackupExporterIdentity } from './production-backup-pg-dump-retry.mjs';
import { productionBackupPgDumpDockerArgs, productionBackupPgDumpSectionDockerArgs } from './production-backup-pg-dump-command.mjs';
assert.equal(process.env.RUN_SYNTHETIC_BACKUP_RETRY_NATIVE, '1', 'Explicit synthetic native test selection required.');
const image = 'supabase/postgres@sha256:fbf77524fc188126c1775fd2d2e54040bde295438a3e6f07936f3c39e6f688ed';
const root = mkdtempSync(join(tmpdir(), 'custodial-timeout-native-'));
const server = `custodial-timeout-native-${randomUUID()}`;
const ownedContainers = new Set([server]);
const raw = promisify(execFile);
const baseEnv = { PATH: process.env.PATH, HOME: process.env.HOME, LANG: 'C.UTF-8' };
const run = (name, args, options = {}) => raw(name, args, { timeout: 120000, maxBuffer: 10 * 1024 * 1024, ...options, env: { ...baseEnv, ...options.env } });
const certificate = join(root, 'cert.pem');
const privateKey = join(root, 'key.pem');
const password = `synthetic-${randomUUID()}`;
let exporter, writer, result, failed = false, cleanupFailed = false, phase = 'image', failureCode = null;
const events = { injected_failures: 0, native_dumps: 0, daemon_absence_checks: 0, delays: [], exporter_probes: 0, expiry_refused: false, signing_attempted: false };
try {
  // No pull. Fail if the exact image is not already installed.
  const installed = await run('docker', ['image', 'inspect', image, '--format', '{{.Id}}']);
  assert.equal(installed.stdout.trim(), image.split('@')[1]);
  phase = 'certificate';
  await run('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1', '-keyout', privateKey, '-out', certificate]);
  chmodSync(privateKey, 0o600); chmodSync(certificate, 0o644);
  // Container root copies the ephemeral key into its own filesystem before
  // dropping to postgres. No key/password is logged or read from user sources.
  phase = 'server-start';
  await run('docker', ['run', '-d', '--name', server, '--memory', '1g', '--cpus', '1', '--pids-limit', '256',
    '--tmpfs', '/var/lib/postgresql/data:rw,size=512m', '-p', '127.0.0.1::5432',
    '-v', `${root}:/fixture:ro`, '-e', 'POSTGRES_PASSWORD', '-e', 'PGPASSWORD', '--entrypoint', '/bin/sh', image, '-c',
    'cp /fixture/key.pem /tmp/fixture-key.pem && cp /fixture/cert.pem /tmp/fixture-cert.pem && chown postgres:postgres /tmp/fixture-key.pem /tmp/fixture-cert.pem && chmod 600 /tmp/fixture-key.pem && exec docker-entrypoint.sh "$@"',
    'native-bootstrap', 'postgres', '-D', '/etc/postgresql', '-c', 'listen_addresses=*', '-c', 'ssl=on', '-c', 'ssl_cert_file=/tmp/fixture-cert.pem', '-c', 'ssl_key_file=/tmp/fixture-key.pem', '-c', 'cron.launch_active_jobs=off' ], { env: { POSTGRES_PASSWORD: password, PGPASSWORD: password } });
  phase = 'server-ready';
  let ready = false;
  for (let i = 0; i < 90; i++) {
    try { const readiness = await run('docker', ['exec', server, 'psql', '-At', '-U', 'supabase_admin', '-d', 'postgres', '-c', "select current_setting('listen_addresses') = '*' and current_setting('ssl') = 'on'"], { timeout: 3000 }); if (readiness.stdout.trim() === 't') { ready = true; break; } await sleep(1000); }
    catch { await sleep(1000); }
  }
  assert.ok(ready, 'Synthetic server readiness deadline exceeded.');
  phase = 'port';
  const mapping = await run('docker', ['port', server, '5432/tcp']);
  assert.match(mapping.stdout.trim(), /^127\.0\.0\.1:\d+$/);
  const port = Number(mapping.stdout.trim().split(':').at(-1));
  // Local socket administration is confined to the freshly owned fixture.
  phase = 'fixture-schema';
  await run('docker', ['exec', server, 'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'supabase_admin', '-d', 'postgres', '-c',
    `alter role postgres password '${password}'; create table public.retry_snapshot_old(id int primary key); insert into public.retry_snapshot_old values(1);`]);
  const connection = { host: '127.0.0.1', port, database: 'postgres', user: 'postgres', password,
    ssl: { ca: readFileSync(certificate, 'utf8'), rejectUnauthorized: true }, connectionTimeoutMillis: 10000, query_timeout: 15000 };
  exporter = new pg.Client(connection); writer = new pg.Client(connection);
  const tlsState = await run('docker', ['exec', server, 'psql', '-At', '-U', 'supabase_admin', '-d', 'postgres', '-c', 'show ssl']);
  events.fixture_server_tls = ['on', 'off'].includes(tlsState.stdout.trim()) ? tlsState.stdout.trim() : 'unknown';
  const settings = await run('docker', ['exec', server, 'psql', '-At', '-U', 'supabase_admin', '-d', 'postgres', '-c', "select json_build_object('listen_addresses',current_setting('listen_addresses'),'port',current_setting('port'),'ssl_cert_file',current_setting('ssl_cert_file'),'ssl_key_file',current_setting('ssl_key_file'))"]);
  const configured = JSON.parse(settings.stdout);
  events.fixture_listens_all = configured.listen_addresses === '*';
  events.fixture_port_5432 = configured.port === '5432';
  events.fixture_certificate_path_matches = configured.ssl_cert_file === '/tmp/fixture-cert.pem';
  events.fixture_key_path_matches = configured.ssl_key_file === '/tmp/fixture-key.pem';
  try {
    const localTls = await run('docker', ['exec', '-e', 'PGSSLMODE=verify-full', '-e', 'PGSSLROOTCERT=/tmp/fixture-cert.pem', server, 'psql', '-At', '-h', 'localhost', '-U', 'postgres', '-d', 'postgres', '-c', 'select 1'], {timeout:10000});
    events.inside_container_tls_verified = localTls.stdout.trim() === '1';
  } catch { events.inside_container_tls_verified = false; }
  phase = 'tls-connect';
  await exporter.connect(); await writer.connect();
  phase = 'snapshot';
  await exporter.query('begin isolation level repeatable read read only deferrable');
  const exported = (await exporter.query('select pg_export_snapshot() id')).rows[0].id;
  const originalIdentity = await captureBackupExporterIdentity(exporter);
  const snapshot = (await exporter.query('select transaction_timestamp() captured_at, txid_current_snapshot()::text snapshot_id')).rows[0];
  await writer.query('insert into public.retry_snapshot_old values(2); create table public.retry_snapshot_new(id int)');
  assert.equal((await exporter.query('select count(*)::int n from public.retry_snapshot_old')).rows[0].n, 1);
  assert.equal((await writer.query('select count(*)::int n from public.retry_snapshot_old')).rows[0].n, 2);
  // Execute the shipping exporter probe, not an independently invented probe.
  const source = readFileSync(new URL('./production-backup.mjs', import.meta.url), 'utf8');
  const block = source.slice(source.indexOf('const execFileAsync = createBackupPgDumpExecutor('), source.indexOf('const endBackupClient ='));
  const probe = new Function('createBackupPgDumpExecutor', 'join', 'backupDir', 'rawExecFileAsync', 'client', 'snapshot', 'backupTransactionMayBeOpen', 'captureBackupExporterIdentity', 'backupExporterIdentity', block + '\nreturn execFileAsync;')(
    options => options.assertExporterLive, join, root, run, exporter, snapshot, true, captureBackupExporterIdentity, originalIdentity);
  const inventoryDir = join(root, 'inventory'); mkdirSync(inventoryDir, { mode: 0o700 });
  const fixture = { caPath: certificate, databaseHost: 'localhost', databaseName: 'postgres', databasePort: '5432', databaseUsername: 'postgres', exportedSnapshot: exported, inventoryDir, pgDumpImage: image, uid: process.getuid(), gid: process.getgid() };
  const commands = [productionBackupPgDumpDockerArgs(fixture), ...['pre-data', 'post-data'].map(section => productionBackupPgDumpSectionDockerArgs(fixture, section))];
  let inject = true;
  async function nativeRun(command, args, options) {
    assert.equal(command, 'docker');
    if (args[0] === 'inspect') {
      events.daemon_absence_checks++;
      return run(command, args, options);
    }
    const name = args[args.indexOf('--name') + 1];
    assert.match(name, /^custodial-backup-[a-f0-9-]{36}$/); ownedContainers.add(name);
    const original = args.filter((_, index) => index !== 1 && index !== 2);
    assert.ok(commands.some(expected => JSON.stringify(expected) === JSON.stringify(original)), 'Original pg_dump args must remain exact.');
    if (inject) {
      inject = false; events.injected_failures++;
      // Real short-lived Docker process, synthetic preconnection error. This
      // does not reproduce the provider's underlying authentication outage.
      return run('docker', ['run', '--rm', '--name', name, '--memory', '128m', '--cpus', '1', '--pids-limit', '32', '--entrypoint', '/bin/sh', image, '-c',
        'printf \'pg_dump: error: connection to server at "localhost" (127.0.0.1), port 5432 failed: FATAL:  (EAUTHQUERY) auth_query secret check timed out\\n\' >&2; exit 1'], options);
    }
    events.native_dumps++;
    return run(command, [args[0], '--network', `container:${server}`, '--memory', '256m', '--cpus', '1', '--pids-limit', '64', ...args.slice(1)], options);
  }
  const executor = createBackupPgDumpExecutor({ run: nativeRun, inventoryDir,
    assertExporterLive: async () => { events.exporter_probes++; await probe(); },
    sleep: async ms => { events.delays.push(ms); await sleep(ms); }, report: () => {} });
  phase = 'native-capture';
  for (const args of commands) await executor('docker', args, { env: { PGPASSWORD: password }, maxBuffer: 10 * 1024 * 1024 });
  phase = 'snapshot-readback';
  const full = readFileSync(join(inventoryDir, 'application-schema.sql'), 'utf8');
  assert.match(full, /CREATE TABLE public\.retry_snapshot_old/);
  assert.doesNotMatch(full, /retry_snapshot_new/);
  assert.match(readFileSync(join(inventoryDir, 'application-schema-pre-data.sql'), 'utf8'), /retry_snapshot_old/);
  assert.ok(readFileSync(join(inventoryDir, 'application-schema-post-data.sql'), 'utf8').length > 0);
  assert.equal(events.daemon_absence_checks, 1); assert.deepEqual(events.delays, [5000]);
  phase = 'expiry';
  await exporter.query('rollback');
  await assert.rejects(probe());
  const expiredDir = join(root, 'expired'); mkdirSync(expiredDir, { mode: 0o700 });
  const expiredArgs = productionBackupPgDumpDockerArgs({ ...fixture, inventoryDir: expiredDir });
  const expired = createBackupPgDumpExecutor({ run: async (command, args, options) => {
    ownedContainers.add(args[args.indexOf('--name') + 1]);
    return run(command, [args[0], '--network', `container:${server}`, '--memory', '256m', '--cpus', '1', '--pids-limit', '64', ...args.slice(1)], options);
  }, inventoryDir: expiredDir, assertExporterLive: probe, sleep: () => { throw Error('Expired snapshot must never retry.'); }, report: () => {} });
  await assert.rejects(expired('docker', expiredArgs, { env: { PGPASSWORD: password } }), error => error.code === 'BACKUP_DUMP_FAILED');
  events.expiry_refused = true;
  await exporter.query('begin isolation level repeatable read read only');
  const beforeIdentity = await captureBackupExporterIdentity(exporter);
  const beforeSnapshot = (await exporter.query('select txid_current_snapshot()::text snapshot_id')).rows[0].snapshot_id;
  await exporter.query('rollback');
  await exporter.query('begin isolation level repeatable read read only');
  const collisionSnapshot = (await exporter.query('select transaction_timestamp() captured_at, txid_current_snapshot()::text snapshot_id')).rows[0];
  assert.equal(collisionSnapshot.snapshot_id, beforeSnapshot);
  const collisionProbe = new Function('createBackupPgDumpExecutor', 'join', 'backupDir', 'rawExecFileAsync', 'client', 'snapshot', 'backupTransactionMayBeOpen', 'captureBackupExporterIdentity', 'backupExporterIdentity', block + '\nreturn execFileAsync;')(
    options => options.assertExporterLive, join, root, run, exporter, collisionSnapshot, true, captureBackupExporterIdentity, beforeIdentity);
  await assert.rejects(collisionProbe());
  events.rebegin_same_snapshot_identity_refused = true;
  await exporter.query('rollback');
  result = { ok: true, scope: 'Synthetic native Docker/PostgreSQL only; provider outage injected, production untouched; no signed backup/store/restore claim', ...events };
} catch (error) { failed = true; const known = ['The server does not support SSL connections', 'There was an error establishing an SSL connection', 'Connection terminated unexpectedly', 'timeout expired', 'Connection terminated']; const knownIndex = known.indexOf(String(error?.message || '')); if (knownIndex >= 0) events.connection_failure_kind = ['TLS_UNSUPPORTED','TLS_NEGOTIATION_FAILED','CONNECTION_TERMINATED_UNEXPECTEDLY','CONNECTION_TIMEOUT','CONNECTION_TERMINATED'][knownIndex]; failureCode = /^[A-Z0-9_]{1,48}$/.test(String(error?.code || '')) ? String(error.code) : 'UNCLASSIFIED'; }
finally {
  for (const client of [exporter, writer]) if (client) { try { await client.end(); } catch { cleanupFailed = true; } }
  for (const name of ownedContainers) {
    try { await run('docker', ['rm', '-f', name], { timeout: 15000 }); }
    catch (error) {
      if (error.code !== 1 || error.killed || error.signal || ![`Error: No such container: ${name}`, `Error response from daemon: No such container: ${name}`].includes(String(error.stderr || '').trim())) cleanupFailed = true;
    }
  }
  for (const name of ownedContainers) {
    try { await run('docker', ['inspect', '--type', 'container', '--format', '{{.State.Status}}', name], { timeout: 10000 }); cleanupFailed = true; }
    catch (error) {
      if (error.code !== 1 || error.killed || error.signal || ![`Error: No such container: ${name}`, `Error: No such object: ${name}`, `Error response from daemon: No such container: ${name}`].includes(String(error.stderr || '').trim())) cleanupFailed = true;
    }
  }
  // Only files beneath the newly created owned directory are removed.
  try { rmSync(root, { recursive: true, force: true }); } catch { cleanupFailed = true; }
}
if (failed || cleanupFailed) {
  console.error(JSON.stringify({ ok: false, phase, failure_code: failureCode, failed, cleanup_failed: cleanupFailed, scope: 'Synthetic native test; details withheld to avoid credential logging', ...events }));
  process.exitCode = 1;
} else console.log(JSON.stringify({ ...result, cleanup: 'owned containers and fixture files removed' }));
