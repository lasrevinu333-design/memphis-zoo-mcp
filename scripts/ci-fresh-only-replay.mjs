import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, realpathSync, mkdtempSync, mkdirSync, chmodSync, rmdirSync, unlinkSync, existsSync, openSync, closeSync, fsyncSync, writeFileSync, writeSync, fstatSync, constants as fsConstants } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { resolve, relative, sep } from 'node:path';

// Explicit scoped fresh-only construction. This is not vendor NORMAL,
// ledger adoption, production replay, or a substitute for downstream checks.
const MANIFEST_SHA = 'dbe83c4be6e5cbcf1a13ca0359dd9da7596821d39b6a34578499ae8b63c8a95d';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export function loadCiFreshOnlyReplay(root, image, names, options = {}) {
  assert.ok(options && typeof options === 'object' && !Array.isArray(options));
  assert.deepEqual(Object.keys(options).filter(key => key !== 'noAutoTableGrants'), []);
  const noAutoTableGrants = options.noAutoTableGrants ?? false; assert.equal(typeof noAutoTableGrants, 'boolean');
  const frozen = new Map();
  const read = (name, expected) => {
    assert.equal(typeof name, 'string');
    const path = resolve(root, name);
    assert.ok(relative(root, path) && !relative(root, path).startsWith('..' + sep) && !relative(root, path).startsWith(sep));
    for (let part = path; part !== root; part = resolve(part, '..')) assert.equal(lstatSync(part).isSymbolicLink(), false);
    const stat = lstatSync(path); assert.ok(stat.isFile());
    const bytes = readFileSync(path); assert.equal(bytes.length, stat.size);
    if (expected) { assert.equal(bytes.length, expected.bytes); assert.equal(sha(bytes), expected.sha256); }
    if (frozen.has(path)) assert.deepEqual(bytes, frozen.get(path)); else frozen.set(path, Buffer.from(bytes));
    return bytes;
  };
  const manifestBytes = read('release/fresh-only-replay/MANIFEST.json');
  assert.equal(sha(manifestBytes), MANIFEST_SHA);
  const manifest = JSON.parse(manifestBytes);
  assert.equal(manifest.format, 'custodial.ci-fresh-only-selected-replay.v1');
  assert.equal(manifest.full_vendor_NORMAL, false); assert.equal(manifest.expected_fingerprint_authority, null);
  assert.equal(image, manifest.image);
  assert.equal(manifest.entries.length, 294);
  assert.deepEqual(names, manifest.entries.map(row => row.name));
  assert.deepEqual(readdirSync(resolve(root, 'supabase/migrations')).filter(name => name.endsWith('.sql')).sort(), names);
  assert.equal(manifest.overrides.length, 21);
  let noAutoProfile = null; const noAutoOverrides = new Map();
  if (noAutoTableGrants) {
    noAutoProfile = manifest.no_auto_profile;
    assert.equal(noAutoProfile.format, 'custodial.ci-fresh-only-no-auto-profile.v1');
    assert.equal(noAutoProfile.scope, 'NONCANONICAL_NO_AUTO');
    assert.equal(noAutoProfile.reference.path, 'release/fresh-only-replay/no-auto/REFERENCE_PREFIX226.json');
    const reference = JSON.parse(read(noAutoProfile.reference.path, noAutoProfile.reference));
    assert.equal(reference.schema, 'custodial.fresh-only.no-auto-prefix226-reference.DRAFT.v1');
    assert.equal(reference.profile, 'NONCANONICAL_NO_AUTO_GRANTS_TEST_FIXTURE');
    assert.equal(reference.canonical_catalog_authority, false); assert.equal(reference.source_admission, null);
    assert.equal(reference.inventory_count, 6503); assert.equal(reference.full_expected_inventory.length, 6503);
    const aclContract = reference.current294_public_r_S_acl_contract;
    assert.equal(aclContract.profile, 'NONCANONICAL_NO_AUTO_GRANTS_TEST_FIXTURE');
    assert.equal(aclContract.canonical_catalog_authority, false);
    assert.equal(aclContract.expected_public_r_S_relations.length, 274);
    assert.equal(aclContract.expected_public_r_S_nonowner_grants.length, 1139);
    const historical = aclContract.historical153_source_context;
    assert.equal(historical.status, 'UNVERIFIED_HISTORICAL_SOURCE_CLAIM');
    assert.equal(historical.actual_historical153_PASS_or_raw_rows, null);
    assert.equal(historical.current_profile_reproduces_historical_runtime, false);
    assert.equal(historical.historical_expected_raw_md5, '72df064663cf70bcbe58d49822723930');
    assert.equal(historical.historical_runtime_context.image, 'supabase/postgres@sha256:fbf77524fc188126c1775fd2d2e54040bde295438a3e6f07936f3c39e6f688ed');
    assert.equal(historical.current_profile_context.image, manifest.image);
    assert.deepEqual(historical.current_profile_context.bootstrap, manifest.bootstrap);
    assert.deepEqual(historical.current_profile_context.profile, manifest.profile);
    for (const [key, expectedSHA] of [['historical153_source', '5a50fe6192507d92bcf41fcd7e2067b2bd7ea6638e0ee083394539de2577a05d'], ['historical176_source', 'dc209c79fa13422d085004a3ffb52314abbd888ab16f06243683868dcbbc1b79']]) {
      const source = historical[key]; assert.equal(source.sha256, expectedSHA);
      assert.equal(Buffer.byteLength(source.full_source, 'utf8'), source.bytes);
      assert.equal(sha(source.full_source), expectedSHA);
      assert.ok(source.full_source.includes(historical.historical_expected_raw_md5));
    }
    assert.equal(reference.comparison_semantic_sha256, noAutoProfile.comparison_sha256);
    assert.deepEqual(reference.downstream_exact_source_vectors.map(row => row.boundary), ['before253', 'before254']);
    for (const [index, vector] of reference.downstream_exact_source_vectors.entries()) {
      const count = [6884, 6968][index];
      assert.equal(vector.normal_count, count);
      assert.equal(vector.normal_full_core_vector.length, count);
      assert.equal(vector.no_auto_full_core_vector.length, count);
      assert.equal(vector.exact17_source_bound_grant_substitutions.length, 17);
      assert.equal(vector.all_other_rows_literal, count - 17);
      assert.equal(vector.SQL_observed_no_auto252, null); assert.equal(vector.source_acceptance, null);
    }
    assert.equal(noAutoProfile.overrides.length, 4);
    assert.deepEqual(noAutoProfile.overrides.map(row => row.name), [226, 227, 252, 253].map(index => manifest.entries[index].name));
    for (const row of noAutoProfile.overrides) {
      assert.equal(row.selected.path, 'release/fresh-only-replay/no-auto/images/' + row.name);
      assert.equal(noAutoOverrides.has(row.name), false); read(row.selected.path, row.selected);
      noAutoOverrides.set(row.name, row.selected);
    }
  }
  const actualOverrides = [];
  const entries = manifest.entries.map(row => {
    assert.equal(row.original.path, 'supabase/migrations/' + row.name);
    read(row.original.path, row.original);
    if (row.selected.path !== row.original.path) {
      assert.equal(row.selected.path, 'release/fresh-only-replay/images/' + row.name);
      actualOverrides.push(row.name);
    } else assert.deepEqual(row.selected, row.original);
    assert.ok(['psql-single-transaction', 'exact-Source-BEGIN-COMMIT'].includes(row.atomic_mode));
    read(row.selected.path, row.selected);
    const selected = noAutoOverrides.get(row.name) || row.selected;
    return { name: row.name, sql: read(selected.path, selected).toString('utf8'), atomicMode: row.atomic_mode, selected: { ...selected } };
  });
  assert.deepEqual(actualOverrides.sort(), manifest.overrides);
  const bootstrap = read(manifest.bootstrap.path, manifest.bootstrap).toString('utf8');
  const profile = JSON.parse(read(manifest.profile.path, manifest.profile));
  return {
    entries, bootstrap,
    assertBootstrap(output) {
      const observed = JSON.parse(output.trim());
      assert.equal(observed.schema, 'custodial.fresh291.scoped-pinned-function-bootstrap04.v1');
      assert.equal(observed.state, 'OBSERVED_SELECTED_FUNCTION_PLATFORM_PROFILE04_ONLY_NOT_NORMAL_REFERENCE');
      assert.equal(observed.Root_selected_profile.sha256, manifest.profile.sha256);
      assert.equal(observed.Root_selected_profile.bytes, manifest.profile.bytes);
      assert.equal(observed.session_user, 'supabase_admin'); assert.equal(observed.current_user, 'supabase_admin');
      assert.equal(observed.database_owner, 'supabase_admin'); assert.equal(Math.floor(observed.server_version_num / 10000), 17);
      assert.equal(observed.catalog_assertions_completed, true);
      assert.equal(observed.global_native_PUBLIC_function_default_not_overridden, true);
      assert.equal(observed.full_vendor_NORMAL, false); assert.equal(observed.expected_fingerprint_authority, null);
      assert.equal(observed.application_function_called, false);
      // The unchanged bootstrap itself asserts every role/ACL/default/profile value.
      assert.ok(profile && typeof profile === 'object');
    },
    assertPreserved() { for (const [path, bytes] of frozen) assert.deepEqual(readFileSync(path), bytes); },
    receipt: { format: manifest.format, manifest_sha256: MANIFEST_SHA, migrations: 294, overrides: 21,
      ...(noAutoTableGrants ? { no_auto_profile: { reference: { ...noAutoProfile.reference }, comparison_sha256: noAutoProfile.comparison_sha256, overrides: noAutoProfile.overrides } } : {}),
      full_vendor_NORMAL: false, expected_fingerprint_authority: null },
  };
}

// Explicit disposable construction capability. Importing this module never
// constructs a database. Existing loadCiFreshOnlyReplay remains the selector.
export async function createCiFreshOnlyFixture(options) {
  assert.ok(options && typeof options === 'object' && !Array.isArray(options));
  assert.deepEqual(Object.keys(options).filter(key => !['name', 'hostSocket', 'noAutoTableGrants'].includes(key)), []);
  const { name, hostSocket = false, noAutoTableGrants = false } = options;
  assert.match(name, /^mz_schema_rebuild_[A-Za-z0-9_]{1,100}$/);
  assert.equal(typeof hostSocket, 'boolean'); assert.equal(typeof noAutoTableGrants, 'boolean');
  if (noAutoTableGrants) {
    assert.match(name, /^mz_schema_rebuild_roster_[A-Za-z0-9_]+$/);
    assert.equal(hostSocket, false, 'No-auto profile is the non-networked vacate fixture only');
    assert.notEqual(process.env.VACANCY_REFRESH_CATALOG, '1', 'Noncanonical no-auto fixture cannot refresh canonical catalog authority');
  }
  for (const key of ['SCHEMA_REBUILD_ADMIN_URL', 'DATABASE_URL', 'SCHEMA_REBUILD_DOCKER_CONTAINER', 'SCHEMA_REBUILD_USE_EMPTY_CONTAINER_POSTGRES'])
    assert.ok(!process.env[key], 'Existing target/alternate installer refused: ' + key);
  const root = fixtureFileRoot;
  const names = readdirSync(resolve(root, 'supabase/migrations')).filter(file => file.endsWith('.sql')).sort();
  const manifest = JSON.parse(readFileSync(resolve(root, 'release/fresh-only-replay/MANIFEST.json'), 'utf8'));
  const selection = loadCiFreshOnlyReplay(root, manifest.image, names, { noAutoTableGrants });
  const canonicalFingerprintBytes = readFileSync(resolve(root, 'supabase/canonical/schema-fingerprint.txt'));
  const canonicalFingerprintSHA = sha(canonicalFingerprintBytes);
  assert.match(canonicalFingerprintBytes.toString('utf8').trim(), /^[a-f0-9]{64}$/);
  const directory = mkdtempSync(resolve(tmpdir(), 'custodial-ci-fixture-'));
  chmodSync(directory, 0o700);
  let socketParent = null;
  if (hostSocket) {
    const runtime = '/run/user/' + process.getuid();
    if (existsSync(runtime)) {
      fixtureDirectoryIdentity(runtime, 0o700);
      socketParent = mkdtempSync(resolve(runtime, 'custodial-s27-'));
    } else {
      const temp = lstatSync('/tmp'); assert.ok(temp.isDirectory() && !temp.isSymbolicLink());
      assert.equal(realpathSync('/tmp'), '/tmp'); assert.equal(temp.uid, 0); assert.equal(temp.mode & 0o7777, 0o1777);
      socketParent = mkdtempSync('/tmp/custodial-s27-sock-');
    }
    chmodSync(socketParent, 0o700);
  }
  const socketDirectory = socketParent ? resolve(socketParent, 'socket') : null;
  if (socketDirectory) { mkdirSync(socketDirectory, { mode: 0o777 }); chmodSync(socketDirectory, 0o777);
    assert.ok(Buffer.byteLength(socketDirectory + '/.s.PGSQL.5432') < 108, 'Unix socket path exceeds Linux sockaddr_un bound'); }
  const shortParentIdentity = socketParent ? fixtureDirectoryIdentity(socketParent, 0o700) : null;
  const namespace = fixtureDirectoryIdentity(directory, 0o700);
  const socketIdentity = socketDirectory ? fixtureDirectoryIdentity(socketDirectory, 0o777) : null;
  const intent = { schema: 'custodial.ci-fresh-fixture-parent-intent.v1', name, hostSocket, noAutoTableGrants,
    directory, socketParent, shortParentIdentity, socketDirectory, image: manifest.image, source_selection: selection.receipt,
    full_suite_PASS: false, production: false };
  fixtureWrite(directory, 'PARENT_CONSTRUCTION_INTENT.json', intent);
  let prebirth = null, cid = null, construction = null, constructionRaw = null, cleaned = false;
  let childFence = null, verifiedMigrationWitnesses = null;

  const inspect = target => {
    const result = spawnSync('docker', ['inspect', '--format', '{{json .}}', target], {
      encoding: 'utf8', timeout: 20_000, maxBuffer: 2 * 1024 * 1024,
    });
    if (result.error) throw result.error;
    if (result.status === 0) return JSON.parse(result.stdout);
    if (result.status === 1 && !result.stdout.trim() &&
      ['Error: No such object: ', 'Error: No such container: ', 'error: no such object: '].some(prefix => result.stderr === prefix + target + '\n')) return null;
    throw new Error('Exact fixture inspect unresolved: ' + target);
  };
  const assertNamespace = () => {
    assert.deepEqual(fixtureDirectoryIdentity(directory, 0o700), namespace);
    if (socketDirectory && cleaned) { assert.equal(existsSync(socketDirectory), false); assert.equal(existsSync(socketParent), false); }
    if (socketDirectory && !cleaned) {
      assert.deepEqual(fixtureDirectoryIdentity(socketParent, 0o700), shortParentIdentity);
      assert.deepEqual(readdirSync(socketParent), ['socket']);
      assert.deepEqual(fixtureDirectoryIdentity(socketDirectory, 0o777), socketIdentity);
      for (const file of readdirSync(socketDirectory)) {
        assert.ok(['.s.PGSQL.5432', '.s.PGSQL.5432.lock'].includes(file), 'Unexpected private socket entry');
        const entry = lstatSync(resolve(socketDirectory, file));
        assert.equal(entry.isSymbolicLink(), false);
        assert.ok(file.endsWith('.lock') ? entry.isFile() && entry.nlink === 1 : entry.isSocket());
      }
    }
  };
  const discoverCustody = () => {
    assertNamespace();
    const custodyNames = readdirSync(directory).filter(file => file.startsWith('custodial-ci-fresh-custody-'));
    assert.ok(custodyNames.length <= 1, 'Ambiguous child-private custody');
    if (!custodyNames.length) return null;
    const custody = resolve(directory, custodyNames[0]); fixtureDirectoryIdentity(custody, 0o700);
    const before = fixtureRead(custody, 'PREBIRTH_ORIGINAL_CONTAINER.json');
    const born = JSON.parse(before);
    assert.equal(born.schema, 'custodial.ci-fresh-original-container-custody.v1');
    assert.equal(born.directory, custody); assert.equal(born.name, name); assert.equal(born.image, manifest.image);
    assert.equal(born.cidfile, resolve(custody, 'original-container.cid'));
    assert.equal(born.construction_only, true); assert.equal(born.host_socket_directory, socketDirectory);
    assert.equal(born.max_connections, hostSocket ? 32 : 10); assert.equal(born.no_auto_table_grants, noAutoTableGrants);
    assert.match(born.owner, /^[a-f0-9-]{36}$/);
    if (prebirth) assert.deepEqual(born, prebirth); else prebirth = born;
    if (existsSync(born.cidfile)) {
      const value = fixtureRead(custody, 'original-container.cid', false).trim(); assert.match(value, /^[a-f0-9]{64}$/);
      if (cid) assert.equal(cid, value); else cid = value;
    }
    return custody;
  };
  const assertIdentity = (allowAbsent = false) => {
    const custody = discoverCustody();
    if (!custody) { assert.ok(allowAbsent, 'Child custody missing'); return null; }
    const observed = inspect(cid || name);
    if (!observed) {
      if (cid) assert.equal(inspect(name), null, 'Original ID absent but name now bound to another object');
      assert.ok(allowAbsent, 'Owned constructed fixture disappeared'); return null;
    }
    assert.match(observed.Id, /^[a-f0-9]{64}$/);
    assert.equal(observed.Name, '/' + name); if (cid) assert.equal(observed.Id, cid); else cid = observed.Id;
    assert.equal(observed.Config.Labels?.['custodial.owner'], prebirth.owner);
    assert.equal(observed.Config.Image, manifest.image);
    const image = spawnSync('docker', ['image', 'inspect', '--format', '{{.Id}}', manifest.image], { encoding: 'utf8', timeout: 20_000, maxBuffer: 1024 * 1024 });
    assert.equal(image.status, 0); assert.match(image.stdout.trim(), /^sha256:[a-f0-9]{64}$/); assert.equal(observed.Image, image.stdout.trim());
    assert.equal(observed.HostConfig.NetworkMode, 'none'); assert.equal(observed.HostConfig.ReadonlyRootfs, true);
    assert.equal(Object.keys(observed.HostConfig.PortBindings || {}).length, 0);
    assert.equal(observed.HostConfig.Memory, 512 * 1024 * 1024); assert.equal(observed.HostConfig.MemorySwap, 512 * 1024 * 1024);
    assert.equal(observed.HostConfig.NanoCpus, 1_000_000_000); assert.equal(observed.HostConfig.PidsLimit, 64);
    assert.equal(observed.HostConfig.LogConfig.Type, 'local');
    assert.equal(observed.HostConfig.LogConfig.Config['max-size'], '1m'); assert.equal(observed.HostConfig.LogConfig.Config['max-file'], '2');
    assert.ok(observed.Config.Cmd.includes('listen_addresses='));
    assert.ok(observed.Config.Cmd.includes(hostSocket ? 'max_connections=32' : 'max_connections=10'));
    assert.deepEqual(observed.Config.Cmd.filter(value => value.startsWith('lock_timeout=')), [hostSocket ? 'lock_timeout=0' : 'lock_timeout=5000']);
    const bindings = observed.Mounts.filter(mount => mount.Type === 'bind');
    assert.equal(bindings.length, hostSocket ? 2 : 1);
    assert.ok(bindings.some(mount => mount.Destination === '/docker-entrypoint-initdb.d' && mount.Source === prebirth.empty_init_directory && mount.RW === false));
    assert.equal(observed.HostConfig.Tmpfs['/var/run/postgresql'], 'rw,size=8m');
    if (hostSocket) {
      assert.ok(bindings.some(mount => mount.Destination === '/custodial-fixture-socket' && mount.Source === socketDirectory && mount.RW === true));
      assert.ok(observed.Config.Cmd.includes('unix_socket_directories=/var/run/postgresql,/custodial-fixture-socket'));
    } else assert.equal(observed.Config.Cmd.some(value => value.startsWith('unix_socket_directories=')), false);
    if (constructionRaw) assert.equal(fixtureRead(custody, 'MIGRATIONS_ONLY_CONSTRUCTION.json'), constructionRaw);
    return observed;
  };
  const cleanup = async () => {
    if (cleaned) { assertNamespace(); assert.equal(inspect(cid || name), null); return; }
    assertNamespace();
    if (existsSync(resolve(directory, 'PARENT_ORIGINAL_CHILD_OWNER.json'))) {
      const fence = JSON.parse(fixtureRead(directory, 'PARENT_ORIGINAL_CHILD_WAIT_AND_STREAMS.json'));
      assert.equal(fence.actual_wait_returned, true); assert.equal(fence.fresh_PID_PGID_proc_absent, true,
        'Original child is not closed; no custody adoption/cleanup yet');
    }
    const observed = assertIdentity(true);
    if (observed) {
      const result = spawnSync('docker', ['rm', '-f', observed.Id], { encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024 });
      assert.equal(result.status, 0, 'Exact owned fixture removal failed'); assert.equal(result.stdout.trim(), observed.Id);
      assert.equal(inspect(observed.Id), null); assert.equal(inspect(name), null);
    }
    assertNamespace();
    if (socketDirectory) {
      // SIGKILL container removal may leave its exact socket/lock directory entries.
      // The private namespace/type checks above precede unlink; no foreign tree scan.
      for (const file of readdirSync(socketDirectory)) unlinkSync(resolve(socketDirectory, file));
      rmdirSync(socketDirectory); rmdirSync(socketParent);
    }
    fixtureWrite(directory, 'PARENT_EXACT_FIXTURE_ABSENT.json', { id: cid, name, owner: prebirth?.owner || null,
      original_child: childFence, exact_absence: true, socket_directory_removed: !!socketDirectory });
    cleaned = true;
    // Preserve original child streams/wait/custody receipts for the owning test.
  };
  try {
    childFence = await fixtureRunConstruction(directory, root, {
      ...process.env, TMPDIR: directory, SCHEMA_REBUILD_FRESH_ONLY: '1', SCHEMA_REBUILD_MIGRATIONS_ONLY: '1',
      SCHEMA_REBUILD_FIXTURE_NAME: name, SCHEMA_REBUILD_FIXTURE_SOCKET_DIRECTORY: socketDirectory || '',
      SCHEMA_REBUILD_NO_AUTO_TABLE_GRANTS: noAutoTableGrants ? '1' : undefined,
      SCHEMA_REBUILD_DOCKER_IMAGE: manifest.image, SCHEMA_REBUILD_DOCKER_USER: 'supabase_admin', SCHEMA_REBUILD_KEEP_DATABASE: '1',
    });
    assert.equal(childFence.exit, 0, 'Fixture construction child failed; original streams retained');
    assert.equal(childFence.timed_out, false); assert.equal(childFence.stream_limit_exceeded, false);
    const custody = discoverCustody(); assert.ok(custody, 'Construction custody required');
    constructionRaw = fixtureRead(custody, 'MIGRATIONS_ONLY_CONSTRUCTION.json'); construction = JSON.parse(constructionRaw);
    assert.equal(construction.schema, 'custodial.ci-fresh-only-migrations-construction.v1');
    assert.equal(construction.container, cid); assert.equal(construction.name, name); assert.equal(construction.owner, prebirth.owner);
    assert.equal(construction.image, manifest.image); assert.equal(construction.database, 'postgres');
    assert.equal(construction.custody_directory, custody); assert.equal(construction.socket_directory, socketDirectory);
    assert.equal(construction.max_connections, hostSocket ? 32 : 10); assert.equal(construction.no_auto_table_grants, noAutoTableGrants);
    assert.equal(construction.full_suite_PASS, false); assert.equal(construction.synthetic_fixture_checks_executed, false);
    assert.deepEqual(construction.selected_replay, selection.receipt); assert.equal(construction.fingerprint_file_sha256, canonicalFingerprintSHA);
    if (noAutoTableGrants) {
      assert.equal(construction.state, 'NONCANONICAL_NO_AUTO_GRANTS_TEST_FIXTURE');
      assert.equal(construction.fingerprint_check, 'NOT_CANONICAL_PROFILE_MEASURED_ONLY');
      const measured = JSON.parse(fixtureRead(custody, 'NO_AUTO_TABLE_GRANTS_MEASURED_CATALOG.json'));
      assert.deepEqual(measured, construction.measured_no_auto_catalog); assert.equal(measured.canonical_fingerprint_PASS, false); assert.equal(measured.new_authority, false);
      assert.match(measured.measured_fingerprint, /^[a-f0-9]{64}$/);
      const fullReference = measured.full_catalog;
      assert.equal(fullReference.path, resolve(custody, 'NO_AUTO_TABLE_GRANTS_FULL_MEASURED_CATALOG.json'));
      const fullBytes = fixtureRead(custody, 'NO_AUTO_TABLE_GRANTS_FULL_MEASURED_CATALOG.json');
      assert.equal(Buffer.byteLength(fullBytes, 'utf8'), fullReference.bytes); assert.equal(sha(fullBytes), fullReference.sha256);
      const full = JSON.parse(fullBytes); assert.equal(full.profile, construction.state);
      assert.equal(full.canonical_fingerprint_PASS, false); assert.equal(full.new_authority, false);
      assert.equal(full.measured_fingerprint, measured.measured_fingerprint); assert.deepEqual(full.counts, measured.counts);
      assert.ok(full.catalog && typeof full.catalog === 'object'); assert.ok(Array.isArray(full.raw_public_table_sequence_acl.rows));
      assert.match(full.raw_public_table_sequence_acl.md5, /^[a-f0-9]{32}$/);
      assert.deepEqual(full.prefix226_inventory, measured.prefix226_inventory);
      const prefixReference = measured.prefix226_inventory;
      assert.equal(prefixReference.path, resolve(custody, 'NO_AUTO_PREFIX226_FULL_INVENTORY.json'));
      const prefixBytes = fixtureRead(custody, 'NO_AUTO_PREFIX226_FULL_INVENTORY.json');
      assert.equal(Buffer.byteLength(prefixBytes, 'utf8'), prefixReference.bytes); assert.equal(sha(prefixBytes), prefixReference.sha256);
      const prefix = JSON.parse(prefixBytes); assert.equal(prefix.rows.length, 6503);
      assert.equal(prefix.canonical_catalog_authority, false); assert.equal(prefix.new_authority, false);
      const witnesses = JSON.parse(fixtureRead(custody, 'NO_AUTO_TABLE_GRANTS_MIGRATION_WITNESSES.json'));
      verifiedMigrationWitnesses = witnesses.witnesses;
      assert.equal(witnesses.profile, construction.state); assert.equal(witnesses.witnesses.length, 294);
      for (const [index, witness] of witnesses.witnesses.entries()) {
        const row = manifest.entries[index]; assert.equal(witness.order, index + 1); assert.equal(witness.name, row.name);
        assert.equal(witness.original_sha256, row.original.sha256); assert.equal(witness.selected_sha256, selection.entries[index].selected.sha256);
        assert.equal(witness.atomic_mode, row.atomic_mode); assert.equal(witness.exit, 0);
        assert.equal(witness.before_default_grants, 0); assert.equal(witness.after_default_grants, 0);
        assert.equal(typeof witness.normalization_removed, 'boolean');
        if (index + 1 === 153) {
          assert.equal(witness.name, '20260925190000_gps_exact_location_authority_boundary.sql');
          assert.match(witness.current_profile_153_raw_public_r_S_acl_md5, /^[a-f0-9]{32}$/);
        } else assert.equal(Object.hasOwn(witness, 'current_profile_153_raw_public_r_S_acl_md5'), false);
        if (witness.normalization_removed) {
          assert.ok(['20260718083100_reconstruct_public_grant_hardening.sql','20260729150527_audit_defense_in_depth_hardening.sql','20260815160613_normalize_managed_production_schema_security.sql'].includes(row.name));
          assert.doesNotMatch(selection.entries[index].sql, /create\s+(?:unlogged\s+)?table|create\s+sequence/i);
        }
      }
    } else {
      assert.equal(construction.state, 'CONSTRUCTED_NOT_FUNCTIONALLY_QUALIFIED');
      assert.equal(construction.fingerprint_check, 'PASS_COMMITTED_CANONICAL_FILE'); assert.equal(construction.measured_no_auto_catalog, null);
    }
    selection.assertPreserved(); assert.equal(sha(readFileSync(resolve(root, 'supabase/canonical/schema-fingerprint.txt'))), canonicalFingerprintSHA);
    const observed = assertIdentity(); assert.equal(construction.image_id, observed.Image); assert.equal(observed.State.Running, true);
    const receipt = Object.freeze({ ...JSON.parse(constructionRaw), migration_witnesses: verifiedMigrationWitnesses, original_child: childFence, parent_custody_directory: directory });
    return { container: cid, name, socketDirectory, receipt, assertOwned: async () => { const value = assertIdentity(); assert.equal(value.State.Running, true); return true; }, cleanup };
  } catch (error) {
    let cleanupError;
    try { await cleanup(); } catch (failure) { cleanupError = failure; }
    try { exportCiFreshOnlyFailureEvidence(directory); }
    catch { process.stderr.write('Bounded fixture failure evidence export refused; original error and private custody retained.\n'); }
    if (cleanupError) throw new AggregateError([error, cleanupError], 'Fixture failed; exact custody reconciliation unresolved; no foreign cleanup permitted');
    throw error;
  }
}

const fixtureFileRoot = resolve(new URL('..', import.meta.url).pathname);
function fixtureDirectoryIdentity(directory, mode) {
  const stat = lstatSync(directory);
  assert.ok(stat.isDirectory() && !stat.isSymbolicLink()); assert.equal(realpathSync(directory), directory);
  assert.equal(stat.uid, process.getuid()); assert.equal(stat.mode & 0o777, mode);
  return [stat.dev, stat.ino, stat.uid, stat.mode & 0o777];
}
function fixtureWrite(directory, name, value) {
  const fd = openSync(resolve(directory, name), 'wx', 0o600);
  try { writeFileSync(fd, JSON.stringify(value, null, 2) + '\n'); fsyncSync(fd); } finally { closeSync(fd); }
  const parent = openSync(directory, 'r'); try { fsyncSync(parent); } finally { closeSync(parent); }
}
function fixtureRead(directory, name, receipt = true) {
  const file = resolve(directory, name); assert.equal(realpathSync(file), file);
  const stat = lstatSync(file); assert.ok(stat.isFile() && !stat.isSymbolicLink()); assert.equal(stat.uid, process.getuid()); assert.equal(stat.nlink, 1);
  assert.ok(stat.size <= 16 * 1024 * 1024); if (receipt) assert.equal(stat.mode & 0o777, 0o600);
  const fd = openSync(file, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const before = fstatSync(fd); assert.equal(before.ino, stat.ino); assert.equal(before.dev, stat.dev);
    const raw = readFileSync(fd, 'utf8'); const after = fstatSync(fd);
    assert.deepEqual([after.ino, after.dev, after.size, after.mtimeMs, after.ctimeMs], [stat.ino, stat.dev, stat.size, stat.mtimeMs, stat.ctimeMs]);
    const final = lstatSync(file); assert.deepEqual([final.ino, final.dev, final.size, final.mtimeMs, final.ctimeMs], [stat.ino, stat.dev, stat.size, stat.mtimeMs, stat.ctimeMs]);
    return raw;
  } finally { closeSync(fd); }
}
// Failure-only GitHub artifact transport. No environment, keys, DATA catalogs,
// arbitrary path inputs, recursive directory copies, or success credit.
export function exportCiFreshOnlyFailureEvidence(directory) {
  if (process.env.GITHUB_ACTIONS !== 'true') return null;
  assert.match(process.env.GITHUB_RUN_ID || '', /^[0-9]+$/);
  fixtureDirectoryIdentity(directory, 0o700);
  const intent = JSON.parse(fixtureRead(directory, 'PARENT_CONSTRUCTION_INTENT.json'));
  assert.equal(intent.schema, 'custodial.ci-fresh-fixture-parent-intent.v1');
  assert.equal(intent.directory, directory); assert.equal(intent.production, false);
  assert.match(intent.name, /^mz_schema_rebuild_[A-Za-z0-9_]{1,100}$/);
  const base = process.env.RUNNER_TEMP; assert.ok(base && resolve(base) === base);
  const parent = lstatSync(base); assert.ok(parent.isDirectory() && !parent.isSymbolicLink());
  assert.equal(parent.uid, process.getuid()); assert.equal(realpathSync(base), base);
  const destinationRoot = resolve(base, 'ci-fresh-only-failure-evidence');
  if (!existsSync(destinationRoot)) mkdirSync(destinationRoot, { mode: 0o700 });
  fixtureDirectoryIdentity(destinationRoot, 0o700);
  const destination = mkdtempSync(resolve(destinationRoot, intent.name + '-')); chmodSync(destination, 0o700);
  const entries = [];
  const copy = (from, name, target = name, expected) => {
    const file = resolve(from, name); const stat = lstatSync(file);
    assert.ok(stat.isFile() && !stat.isSymbolicLink()); assert.equal(realpathSync(file), file);
    assert.equal(stat.uid, process.getuid()); assert.equal(stat.nlink, 1); assert.equal(stat.mode & 0o777, 0o600);
    assert.ok(stat.size <= 1024 * 1024);
    const source = openSync(file, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW); let bytes;
    try { const before = fstatSync(source); assert.equal(before.dev, stat.dev); assert.equal(before.ino, stat.ino);
      bytes = readFileSync(source); const after = fstatSync(source), final = lstatSync(file);
      for (const value of [after, final]) assert.deepEqual([value.dev,value.ino,value.size,value.mtimeMs,value.ctimeMs], [stat.dev,stat.ino,stat.size,stat.mtimeMs,stat.ctimeMs]);
    } finally { closeSync(source); }
    if (expected) { assert.equal(bytes.length, expected.bytes); assert.equal(sha(bytes), expected.sha256); }
    const fd = openSync(resolve(destination, target), 'wx', 0o600);
    try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
    entries.push({ name: target, bytes: bytes.length, sha256: sha(bytes) });
  };
  copy(directory, 'PARENT_CONSTRUCTION_INTENT.json');
  for (const name of ['PARENT_ORIGINAL_CHILD_INTENT.json', 'PARENT_ORIGINAL_CHILD_OWNER.json', 'PARENT_EXACT_FIXTURE_ABSENT.json'])
    if (existsSync(resolve(directory, name))) copy(directory, name);
  let fence = null;
  if (existsSync(resolve(directory, 'PARENT_ORIGINAL_CHILD_WAIT_AND_STREAMS.json'))) {
    fence = JSON.parse(fixtureRead(directory, 'PARENT_ORIGINAL_CHILD_WAIT_AND_STREAMS.json'));
    assert.equal(fence.schema, 'custodial.ci-fixture.original-child-closed.v1');
    assert.equal(fence.actual_wait_returned, true); assert.equal(fence.fresh_PID_PGID_proc_absent, true);
    copy(directory, 'PARENT_ORIGINAL_CHILD_WAIT_AND_STREAMS.json');
    for (const stream of ['stdout', 'stderr']) {
      assert.equal(fence[stream + '_path'], resolve(directory, 'PARENT_ORIGINAL_CHILD.' + stream));
      copy(directory, 'PARENT_ORIGINAL_CHILD.' + stream, 'PARENT_ORIGINAL_CHILD.' + stream,
        { bytes: fence[stream + '_bytes'], sha256: fence[stream + '_sha256'] });
    }
  }
  const children = readdirSync(directory).filter(name => name.startsWith('custodial-ci-fresh-custody-'));
  assert.ok(children.length <= 1);
  if (children.length) {
    const child = resolve(directory, children[0]); fixtureDirectoryIdentity(child, 0o700);
    for (const name of ['PREBIRTH_ORIGINAL_CONTAINER.json', 'BOUND_ORIGINAL_IMAGE_ID.json', 'BOUND_ORIGINAL_CID.json', 'RETURNED_ORIGINAL_CID.json', 'EXACT_CONTAINER_ABSENT.json'])
      if (existsSync(resolve(child, name))) copy(child, name, 'CHILD_' + name);
  }
  fixtureWrite(destination, 'FAILURE_EVIDENCE_INDEX.json', {
    schema: 'custodial.ci-fresh-fixture-failure-evidence.v1', run_id: process.env.GITHUB_RUN_ID,
    fixture_name: intent.name, original_closed_fence: fence, files: entries,
    environment_exported: false, recursive_copy: false, source_or_runtime_PASS: false
  });
  return destination;
}

async function fixtureRunConstruction(directory, root, env) {
  const argv = [process.execPath, '--max-old-space-size=128', resolve(root, 'scripts/empty-database-rebuild-check.mjs')];
  fixtureWrite(directory, 'PARENT_ORIGINAL_CHILD_INTENT.json', { argv, cwd: root, timeout_seconds: 600, cleanup_seconds: 5, stream_cap_bytes: 1024 * 1024 });
  const out = openSync(resolve(directory, 'PARENT_ORIGINAL_CHILD.stdout'), 'wx', 0o600);
  const err = openSync(resolve(directory, 'PARENT_ORIGINAL_CHILD.stderr'), 'wx', 0o600);
  const started = Date.now(); let timed = false, over = false, childError = null, terminateTimer = null;
  const child = spawn(argv[0], argv.slice(1), { cwd: root, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const stop = () => { if (child.pid) { try { process.kill(-child.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') childError ||= error; }
    terminateTimer ||= setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') childError ||= error; } }, 3_000); } };
  const timer = setTimeout(() => { timed = true; stop(); }, 600_000);
  const counts = [0, 0];
  for (const [index, stream, fd] of [[0, child.stdout, out], [1, child.stderr, err]]) stream.on('data', block => {
    counts[index] += block.length;
    if (counts[index] > 1024 * 1024) { over = true; stop(); return; }
    try { let offset = 0; while (offset < block.length) offset += writeSync(fd, block, offset, block.length - offset); } catch (error) { childError ||= error; stop(); }
  });
  child.on('error', error => { childError ||= error; });
  if (child.pid) { try {
    const rawStat = readFileSync('/proc/' + child.pid + '/stat', 'utf8');
    const fields = rawStat.slice(rawStat.lastIndexOf(') ') + 2).trim().split(/\s+/);
    assert.equal(Number(fields[1]), process.pid); assert.equal(Number(fields[2]), child.pid); assert.match(fields[19], /^[0-9]+$/);
    fixtureWrite(directory, 'PARENT_ORIGINAL_CHILD_OWNER.json', { pid: child.pid, ppid: Number(fields[1]), pgid: Number(fields[2]), proc_start_ticks: fields[19], argv, cwd: root }); } catch (error) { childError ||= error; stop(); } }
  const closed = await new Promise(resolveClosed => child.on('close', (code, signal) => resolveClosed({ code, signal })));
  clearTimeout(timer); if (terminateTimer) clearTimeout(terminateTimer); fsyncSync(out); fsyncSync(err); closeSync(out); closeSync(err);
  let groupAbsent = !child.pid;
  if (child.pid) {
    try { process.kill(-child.pid, 0); } catch (error) { if (error.code !== 'ESRCH') throw error; groupAbsent = true; }
  }
  const procAbsent = !child.pid || !existsSync('/proc/' + child.pid);
  const result = { schema: 'custodial.ci-fixture.original-child-closed.v1', pid: child.pid || null, pgid: child.pid || null,
    actual_wait_returned: true, exit: closed.code, signal: closed.signal, timed_out: timed, stream_limit_exceeded: over,
    child_error: childError ? String(childError.message) : null, fresh_PID_PGID_proc_absent: groupAbsent && procAbsent,
    seconds: (Date.now() - started) / 1000, stdout_bytes: counts[0], stderr_bytes: counts[1],
    stdout_sha256: sha(readFileSync(resolve(directory, 'PARENT_ORIGINAL_CHILD.stdout'))),
    stderr_sha256: sha(readFileSync(resolve(directory, 'PARENT_ORIGINAL_CHILD.stderr'))),
    stdout_path: resolve(directory, 'PARENT_ORIGINAL_CHILD.stdout'), stderr_path: resolve(directory, 'PARENT_ORIGINAL_CHILD.stderr') };
  fixtureWrite(directory, 'PARENT_ORIGINAL_CHILD_WAIT_AND_STREAMS.json', result);
  assert.equal(groupAbsent && procAbsent, true, 'Original constructor child/group remains live; no custody payload adoption');
  if (childError) throw childError;
  return result;
}

// Functional adoption requires the private FULL receipt. Cleanup is a separate
// exact-ownership operation and may close a failed child that never wrote FULL.
export async function assertCiFreshOnlyRetainedFixture(options) {
  assert.ok(options && typeof options === 'object' && !Array.isArray(options));
  assert.deepEqual(Object.keys(options).filter(key => !['name', 'container', 'custodyDirectory', 'remove'].includes(key)), []);
  const { name, custodyDirectory, remove = false } = options;
  let container = options.container;
  assert.match(name, /^mz_schema_rebuild_[A-Za-z0-9_]{1,100}$/);
  assert.equal(typeof remove, 'boolean');
  if (container === null) assert.equal(remove, true, 'Null CID is cleanup-only, never functional adoption');
  else assert.match(container, /^[a-f0-9]{64}$/); assert.equal(typeof custodyDirectory, 'string');
  assert.equal(resolve(custodyDirectory), custodyDirectory); fixtureDirectoryIdentity(custodyDirectory, 0o700);
  const birthRaw = fixtureRead(custodyDirectory, 'PREBIRTH_ORIGINAL_CONTAINER.json');
  const birth = JSON.parse(birthRaw);
  const manifestBytes = readFileSync(resolve(fixtureFileRoot, 'release/fresh-only-replay/MANIFEST.json'));
  assert.equal(sha(manifestBytes), MANIFEST_SHA); const manifest = JSON.parse(manifestBytes);
  assert.equal(birth.schema, 'custodial.ci-fresh-original-container-custody.v1');
  assert.equal(birth.directory, custodyDirectory); assert.equal(birth.name, name); assert.equal(birth.image, manifest.image);
  assert.match(birth.owner, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  assert.equal(birth.cidfile, resolve(custodyDirectory, 'original-container.cid'));
  // A durable original CID remains authoritative even when a caller failed
  // before parsing stdout. Never turn name absence into original-ID absence.
  if (existsSync(birth.cidfile)) {
    const recordedCID = fixtureRead(custodyDirectory, 'original-container.cid', false).trim();
    assert.match(recordedCID, /^[a-f0-9]{64}$/);
    if (container === null) container = recordedCID;
    else assert.equal(recordedCID, container);
  } else assert.equal(remove, true, 'Functional adoption requires the original Docker CID file');
  const image = spawnSync('docker', ['image', 'inspect', '--format', '{{.Id}}', manifest.image], { encoding: 'utf8', timeout: 20_000, maxBuffer: 1024 * 1024 });
  assert.equal(image.status, 0); const imageID = image.stdout.trim(); assert.match(imageID, /^sha256:[a-f0-9]{64}$/);
  let selection = null;
  if (!remove) {
    assert.notEqual(birth.construction_only, true, 'Migrations-only construction is not full functional completion');
    const returned = JSON.parse(fixtureRead(custodyDirectory, 'RETURNED_ORIGINAL_CID.json'));
    const imageBound = JSON.parse(fixtureRead(custodyDirectory, 'BOUND_ORIGINAL_IMAGE_ID.json'));
    const complete = JSON.parse(fixtureRead(custodyDirectory, 'FULL_REBUILD_FUNCTIONAL_COMPLETE.json'));
    assert.equal(returned.id, container); assert.equal(returned.name, name); assert.equal(returned.owner, birth.owner);
    assert.equal(returned.image, manifest.image); assert.equal(imageBound.image, manifest.image);
    assert.equal(returned.image_id, imageID); assert.equal(imageBound.image_id, imageID);
    assert.equal(complete.schema, 'custodial.ci-fresh-full-rebuild-functional-complete.v1');
    assert.equal(complete.container, container); assert.equal(complete.name, name); assert.equal(complete.owner, birth.owner);
    assert.equal(complete.image, manifest.image); assert.equal(complete.image_id, imageID);
    assert.equal(complete.database, 'postgres'); assert.equal(complete.custody_directory, custodyDirectory);
    assert.equal(complete.full_suite_PASS, true); assert.equal(complete.synthetic_fixture_checks_executed, true);
    assert.equal(complete.fingerprint_check, 'PASS_COMMITTED_CANONICAL_FILE');
    const names = readdirSync(resolve(fixtureFileRoot, 'supabase/migrations')).filter(file => file.endsWith('.sql')).sort();
    selection = loadCiFreshOnlyReplay(fixtureFileRoot, manifest.image, names);
    assert.deepEqual(complete.selected_replay, selection.receipt);
    assert.equal(complete.fingerprint_file_sha256, sha(readFileSync(resolve(fixtureFileRoot, 'supabase/canonical/schema-fingerprint.txt'))));
  }
  const inspect = target => {
    const result = spawnSync('docker', ['inspect', '--format', '{{json .}}', target], { encoding: 'utf8', timeout: 20_000, maxBuffer: 2 * 1024 * 1024 });
    if (result.error) throw result.error;
    if (result.status === 0) return JSON.parse(result.stdout);
    if (result.status === 1 && !result.stdout.trim() &&
      ['Error: No such object: ', 'Error: No such container: ', 'error: no such object: '].some(prefix => result.stderr === prefix + target + '\n')) return null;
    throw new Error('Retained fixture exact inspect unresolved: ' + target);
  };
  let observed;
  if (container === null) {
    observed = inspect(name);
    assert.equal(fixtureRead(custodyDirectory, 'PREBIRTH_ORIGINAL_CONTAINER.json'), birthRaw);
    if (!observed) return { container: null, name, no_owned_resource_born: true, exact_absence: true, removed_by_this_call: false, functional_adoption: false };
    // A name is only a discovery hint. Bind an actual CID only after exact
    // private birth owner/image agreement; never remove a foreign collision.
    assert.match(observed.Id, /^[a-f0-9]{64}$/); assert.equal(observed.Name, '/' + name);
    assert.equal(observed.Config.Labels?.['custodial.owner'], birth.owner);
    assert.equal(observed.Config.Image, manifest.image); assert.equal(observed.Image, imageID);
    container = observed.Id;
    if (existsSync(birth.cidfile)) assert.equal(fixtureRead(custodyDirectory, 'original-container.cid', false).trim(), container);
  } else observed = inspect(container);
  if (!observed) {
    assert.equal(inspect(name), null, 'Original CID absent but alias points to another object; no cleanup');
    assert.equal(remove, true, 'Full functional fixture no longer present');
    return { container, name, exact_absence: true, removed_by_this_call: false, functional_adoption: false };
  }
  assert.equal(observed.Id, container); assert.equal(observed.Name, '/' + name);
  assert.equal(observed.Config.Labels?.['custodial.owner'], birth.owner);
  assert.equal(observed.Config.Image, manifest.image); assert.equal(observed.Image, imageID);
  assert.equal(fixtureRead(custodyDirectory, 'PREBIRTH_ORIGINAL_CONTAINER.json'), birthRaw);
  if (!remove) {
    assert.equal(observed.HostConfig.NetworkMode, 'none'); assert.equal(observed.HostConfig.ReadonlyRootfs, true);
    assert.equal(Object.keys(observed.HostConfig.PortBindings || {}).length, 0);
    assert.ok(observed.Config.Cmd.includes('listen_addresses=')); assert.ok(observed.Config.Cmd.includes('max_connections=10'));
    selection.assertPreserved(); assert.equal(observed.State.Running, true);
    return { container, name, owner: birth.owner, image: manifest.image, image_id: imageID, full_suite_PASS: true, functional_adoption: true };
  }
  const result = spawnSync('docker', ['rm', '-f', container], { encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024 });
  assert.equal(result.status, 0, 'Exact retained fixture removal failed'); assert.equal(result.stdout.trim(), container);
  assert.equal(inspect(container), null); assert.equal(inspect(name), null);
  const removal = { container, name, owner: birth.owner, exact_absence: true, removed_by_this_call: true, functional_adoption: false };
  fixtureWrite(custodyDirectory, 'FULL_REBUILD_RETAINED_EXACT_ABSENCE.json', removal);
  return removal;
}
