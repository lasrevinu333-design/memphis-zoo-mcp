import { closeSync, lstatSync, openSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const outputs = new Set(['application-schema.sql', 'application-schema-pre-data.sql', 'application-schema-post-data.sql']);
const ownFailures = new WeakSet();
const fatal = code => {
  const error = Object.assign(new Error(`Backup schema capture refused (${code}).`), { code, retryable: false });
  ownFailures.add(error);
  return error;
};
const exited = error => error && error.code === 1 && !error.killed && !error.signal;

// Deliberately not a generic auth/timeout/network classifier. No raw diagnostic
// leaves this module. The PostgreSQL failure must be on the connection line.
export function isBackupAuthQueryTimeout(error) {
  if (!exited(error) || typeof error.stderr !== 'string' || error.stderr.length > 4096) return false;
  return /^pg_dump: error: connection to server at "[^"\r\n]+" \([^()\r\n]+\), port 5432 failed: FATAL:  \(EAUTHQUERY\) auth_query secret check timed out\n?$/.test(error.stderr)
    && error.stderr.trim().split(/\r?\n/).length === 1;
}

// Backend PID plus its live owned virtual-XID lock identifies the exporter
// transaction independently of snapshot contents or rounded wall-clock time.
export async function captureBackupExporterIdentity(client) {
  let result;
  try {
    result = await client.query(`select pg_backend_pid() backend_pid, virtualxid
    from pg_catalog.pg_locks
    where pid = pg_backend_pid() and locktype = 'virtualxid'
      and mode = 'ExclusiveLock' and granted = true`);
  } catch {
    throw fatal('BACKUP_DUMP_EXPORTER_IDENTITY_INVALID');
  }
  const row = result?.rows?.[0];
  if (result?.rowCount !== 1 || !Array.isArray(result.rows) || result.rows.length !== 1
      || !Number.isSafeInteger(row?.backend_pid) || row.backend_pid <= 0
      || typeof row.virtualxid !== 'string' || !/^[1-9][0-9]*\/[1-9][0-9]*$/.test(row.virtualxid)) {
    throw fatal('BACKUP_DUMP_EXPORTER_IDENTITY_INVALID');
  }
  return Object.freeze({ backend_pid: row.backend_pid, virtualxid: row.virtualxid });
}

// One instance per backup; the budget is shared by full/pre/post-data captures.
// run is the ordinary execFile promise. A normal Docker CLI exit alone does
// not prove container termination: retry additionally requires the owned unique name
// to be absent from the daemon. Unknown outcome is never a retry permission.
export function createBackupPgDumpExecutor({ run, inventoryDir, assertExporterLive, sleep = delay, report = console.warn }) {
  let retries = 0;
  let exporterSnapshot;
  const used = new Set();
  return async function execute(command, args, options) {
    try {
      const fileArgs = args.filter(value => value.startsWith('--file='));
      const snapshots = args.filter(value => value.startsWith('--snapshot='));
      const name = fileArgs[0]?.slice('--file=/backup/'.length);
      if (command !== 'docker' || args[0] !== 'run' || args[1] !== '--rm'
          || args[2] !== '--entrypoint' || args[3] !== 'pg_dump'
          || args.includes('--cidfile') || args.includes('--name') || fileArgs.length !== 1 || !fileArgs[0].startsWith('--file=/backup/')
          || !outputs.has(name) || used.has(name) || snapshots.length !== 1
          || !/^--snapshot=[0-9A-F]+-[0-9A-F]+-[0-9]+$/i.test(snapshots[0])
          || (exporterSnapshot && exporterSnapshot !== snapshots[0])) throw fatal('BACKUP_DUMP_COMMAND_INVALID');
      exporterSnapshot = snapshots[0];
      used.add(name);
      const path = join(inventoryDir, name);
      // Refuse preexisting output, including symlinks. pg_dump may truncate only
      // this newly owned empty file. Never erase an unknown previous archive.
      closeSync(openSync(path, 'wx', 0o600));
      const owned = lstatSync(path);
      const ownsOutput = () => {
        const state = lstatSync(path);
        if (!state.isFile() || state.dev !== owned.dev || state.ino !== owned.ino) throw fatal('BACKUP_DUMP_OUTPUT_CHANGED');
        return state;
      };
      for (;;) {
        const containerName = `custodial-backup-${randomUUID()}`;
        let failure;
        try {
          const result = await run(command, [args[0], '--name', containerName, ...args.slice(1)], options);
          ownsOutput();
          return result;
        } catch (error) { failure = error; }
        if (!isBackupAuthQueryTimeout(failure)) throw fatal('BACKUP_DUMP_FAILED');
        if (retries === 2) throw fatal('BACKUP_DUMP_RETRIES_EXHAUSTED');
        // An auth-startup refusal should not contain any captured schema bytes.
        if (ownsOutput().size !== 0) throw fatal('BACKUP_DUMP_PARTIAL_OUTPUT');
        let absent = false;
        try {
          await run('docker', ['inspect', '--type', 'container', '--format', '{{.State.Status}}', containerName], {
            encoding: 'utf8', timeout: 10000, maxBuffer: 4096,
          });
        } catch (error) {
          absent = exited(error) && ['', '[]'].includes(String(error.stdout || '').trim())
            && [`Error: No such container: ${containerName}`, `Error: No such object: ${containerName}`, `Error response from daemon: No such container: ${containerName}`].includes(String(error.stderr || '').trim());
        }
        if (!absent) throw fatal('BACKUP_DUMP_CONTAINER_UNKNOWN');
        // Fail before and after backoff if the original exporter is no longer
        // in precisely the transaction whose guard/catalog checks already ran.
        await assertExporterLive();
        const milliseconds = [5000, 15000][retries++];
        report(`Backup schema capture transient auth-query timeout; retry ${retries}/2 after ${milliseconds / 1000}s.`);
        await sleep(milliseconds);
        await assertExporterLive();
        if (ownsOutput().size !== 0) throw fatal('BACKUP_DUMP_PARTIAL_OUTPUT');
      }
    } catch (error) {
      // Never attach raw errors as cause: Docker/fs/provider messages can carry
      // hostnames, command arguments, SQL or credentials in stack properties.
      if (error && ownFailures.has(error)) throw error;
      throw fatal('BACKUP_DUMP_UNVERIFIED');

    }
  };
}
