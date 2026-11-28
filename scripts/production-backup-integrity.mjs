import { spawn } from 'node:child_process';
import { closeSync, lstatSync, mkdirSync, openSync, readdirSync, rmSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';

const rootControls = ['SHA256SUMS', 'archive-signature.json'];
const isPrivateOwner = state => state.uid === process.getuid() && (state.mode & 0o077) === 0;
export function productionBackupConnection(url) {
  const parsed = new URL(url);
  const settings = [...parsed.searchParams];
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || parsed.hash || settings.length > 1
      || settings.some(([name, value]) => name !== 'sslmode' || !['require', 'verify-ca', 'verify-full'].includes(value))) {
    throw Error('Backup connection URL must identify one database with pinned CA verification.');
  }
  const user = decodeURIComponent(parsed.username), password = decodeURIComponent(parsed.password);
  const host = parsed.hostname, port = Number(parsed.port || 5432);
  const database = decodeURIComponent(parsed.pathname.slice(1));
  if (!user || !password || !host || !Number.isInteger(port) || port < 1 || port > 65535 ||
      !database || database.includes('/') || [user, password, host, database].some(value => /[\u0000\r\n]/.test(value))) {
    throw Error('Backup requires an explicit PostgreSQL host, database, user and password.');
  }
  return { user, password, host, port, database };
}

export function createPrivateBackupDirectory(path) {
  mkdirSync(path, { mode: 0o700 });
  if (!isPrivateOwner(lstatSync(path))) throw Error('Backup staging directory must be exclusively owned and private.');
}

export function readBackupFiles(root) {
  const files = [];
  function walk(directory) {
    const state = lstatSync(directory);
    if (!state.isDirectory() || !isPrivateOwner(state)) throw Error('Backup includes an unowned or unsafe directory.');
    for (const name of readdirSync(directory)) {
      if (/[\u0000\r\n\\]/.test(name)) throw Error('Backup includes an unsafe path component.');
      const path = join(directory, name), entry = lstatSync(path);
      if (entry.isDirectory()) walk(path);
      else {
        if (!entry.isFile() || entry.nlink !== 1 || !isPrivateOwner(entry)) throw Error('Backup includes an unsafe, linked or nonprivate entry.');
        files.push(relative(root, path));
      }
    }
  }
  walk(root);
  return files.sort();
}

export { requireOriginalStorageResponse, requireOriginalStorageSize } from './backup-storage-object.mjs';

export async function packageVerifiedBackup(source, archive, output) {
  if (!isAbsolute(output)) throw Error('The verified backup tar output must use an absolute path.');
  const expected = [...archive.checksumPaths, ...rootControls].sort();
  if (new Set(expected).size !== expected.length) throw Error('Archive inventory contains repeated entries.');
  for (const folder of [source, archive.directory]) {
    if (JSON.stringify(readBackupFiles(folder)) !== JSON.stringify(expected))
      throw Error('Backup directory differs from its exact signed file inventory.');
  }
  const fd = openSync(resolve(output), 'wx', 0o600);
  try {
    await new Promise((done, failed) => {
      const child = spawn('tar', ['--create', '--gzip', '--file=-', '--directory='+archive.directory,
        '--no-recursion', '--null', '--verbatim-files-from', '--files-from=-'], {stdio: ['pipe', fd, 'ignore']});
      child.once('error', failed);
      child.once('close', code => code === 0 ? done() : failed(Error('Verified backup tar could not be produced.')));
      child.stdin.once('error', failed);
      child.stdin.end(expected.join('\0')+'\0');
    });
  } catch (error) {
    rmSync(output);
    throw error;
  } finally {
    closeSync(fd);
  }
}
