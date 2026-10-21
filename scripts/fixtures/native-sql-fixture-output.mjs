import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, fchmodSync, lstatSync, openSync, readFileSync, realpathSync, writeFileSync, constants } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const git = args => execFileSync('git', args, { encoding: 'utf8', timeout: 10_000 }).trim();

export function writeNativeSqlFixture({ envName, fileName, payload, manifest, owningMigration, scriptPath, env = process.env }) {
  if (!env[envName]) return null;
  const directory = env.NATIVE_SQL_FIXTURE_OUTPUT_DIR;
  assert.ok(directory && isAbsolute(directory) && resolve(directory) === directory, 'caller-owned absolute fixture directory required');
  const info = lstatSync(directory);
  assert.ok(info.isDirectory() && !info.isSymbolicLink(), 'fixture directory must be a real directory');
  assert.equal(realpathSync(directory), directory, 'fixture directory may not traverse a symlink');
  assert.equal(info.uid, process.getuid(), 'fixture directory must be owned by this process');
  assert.equal(info.mode & 0o077, 0, 'fixture directory must be private');
  assert.match(fileName, /^[a-z0-9-]+\.json$/);
  const target = join(directory, fileName);
  assert.equal(env[envName], target, `${envName} must name the fixed output inside caller-owned directory`);
  const owned = manifest.find(item => item.file === owningMigration);
  assert.ok(owned && manifest.length > 0, `owning migration missing from complete replay: ${owningMigration}`);
  const scriptBytes = readFileSync(scriptPath);
  const migrationBytes = readFileSync(join('supabase/migrations', owningMigration));
  assert.equal(owned.sha256, digest(migrationBytes), 'owning migration differs from replayed bytes');
  const provenance = {
    schema: 'custodial.native-actual-sql-fixture-provenance.v1',
    synthetic: true,
    production: false,
    backend_commit: git(['rev-parse', 'HEAD']),
    backend_tree: git(['rev-parse', 'HEAD^{tree}']),
    source_script: { path: scriptPath, sha256: digest(scriptBytes) },
    owning_migration: owned,
    migration_manifest: manifest,
    migration_manifest_sha256: digest(Buffer.from(`${JSON.stringify(manifest)}\n`)),
    automatic_grants_absent_before_and_after_each: true,
  };
  const bytes = Buffer.from(`${JSON.stringify({ ...payload, sql_fixture_provenance: provenance }, null, 2)}\n`);
  let fd;
  try {
    fd = openSync(target, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    fchmodSync(fd, 0o600);
    writeFileSync(fd, bytes);
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
  assert.equal(lstatSync(target).mode & 0o777, 0o600, 'fixture permission must be 0600');
  return { path: target, sha256: digest(bytes), provenance };
}
