import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeNativeSqlFixture } from './fixtures/native-sql-fixture-output.mjs';

const migration = '20261002180000_native_provider_location_reservation.sql';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const root = mkdtempSync(join(tmpdir(), 'native-sql-fixture-output-test-'));
const directory = join(root, 'private');
mkdirSync(directory, { mode: 0o700 });
let checks = 0;
const check = (label, run) => { run(); checks++; console.log('PASS', label); };
const input = (dir = directory) => ({
  envName: 'NATIVE_LOCATION_WIRE_FIXTURE', fileName: 'native-location-wire.json',
  payload: { synthetic: true },
  manifest: [{ file: migration, sha256: sha(readFileSync(join('supabase/migrations', migration))) }],
  owningMigration: migration, scriptPath: 'scripts/native-location-reservation-database-tests.mjs',
  env: { NATIVE_SQL_FIXTURE_OUTPUT_DIR: dir, NATIVE_LOCATION_WIRE_FIXTURE: join(dir, 'native-location-wire.json') },
});
try {
  const receipt = writeNativeSqlFixture(input());
  check('fixed 0600 regular output and exact hash', () => {
    assert.equal(lstatSync(receipt.path).mode & 0o777, 0o600);
    assert.equal(sha(readFileSync(receipt.path)), receipt.sha256);
    assert.equal(JSON.parse(readFileSync(receipt.path)).sql_fixture_provenance.owning_migration.file, migration);
  });
  const original = readFileSync(receipt.path);
  check('existing fixture never overwritten', () => assert.throws(() => writeNativeSqlFixture(input()), /EEXIST/));
  check('original bytes remain after refused overwrite', () => assert.deepEqual(readFileSync(receipt.path), original));
  const publicDir = join(root, 'public');
  mkdirSync(publicDir, { mode: 0o755 });
  check('nonprivate directory refused', () => assert.throws(() => writeNativeSqlFixture(input(publicDir)), /private/));
  const alias = join(root, 'alias');
  symlinkSync(directory, alias);
  check('symlink directory refused', () => assert.throws(() => writeNativeSqlFixture(input(alias)), /real directory/));
  const wrong = input(); wrong.env.NATIVE_LOCATION_WIRE_FIXTURE = join(root, 'escape.json');
  check('output escape refused', () => assert.throws(() => writeNativeSqlFixture(wrong), /fixed output/));
  const absent = input(); absent.manifest = [];
  check('missing owning migration refused', () => assert.throws(() => writeNativeSqlFixture(absent), /owning migration missing/));
  const changed = input(); changed.manifest[0].sha256 = '0'.repeat(64);
  check('wrong replay migration hash refused', () => assert.throws(() => writeNativeSqlFixture(changed), /differs from replayed bytes/));
  check('disabled emission has no side effect', () => assert.equal(writeNativeSqlFixture({ ...input(), env: {} }), null));
  assert.ok(existsSync(receipt.path));
  console.log(JSON.stringify({ status: 'PASS', checks, synthetic: true, database: false }));
} finally {
  rmSync(root, { recursive: true, force: true });
}
