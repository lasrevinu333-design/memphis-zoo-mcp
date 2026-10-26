import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, relative, sep } from 'node:path';

// Explicit scoped fresh-only construction. This is not vendor NORMAL,
// ledger adoption, production replay, or a substitute for downstream checks.
const MANIFEST_SHA = 'b9b8593a27e11a53beb81d4905d40c9a74e78e0fee5cf26403c03323ac3bf9da';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export function loadCiFreshOnlyReplay(root, image, names) {
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
  assert.equal(manifest.entries.length, 293);
  assert.deepEqual(names, manifest.entries.map(row => row.name));
  assert.deepEqual(readdirSync(resolve(root, 'supabase/migrations')).filter(name => name.endsWith('.sql')).sort(), names);
  assert.equal(manifest.overrides.length, 21);
  const actualOverrides = [];
  const entries = manifest.entries.map(row => {
    assert.equal(row.original.path, 'supabase/migrations/' + row.name);
    read(row.original.path, row.original);
    if (row.selected.path !== row.original.path) {
      assert.equal(row.selected.path, 'release/fresh-only-replay/images/' + row.name);
      actualOverrides.push(row.name);
    } else assert.deepEqual(row.selected, row.original);
    assert.ok(['psql-single-transaction', 'exact-Source-BEGIN-COMMIT'].includes(row.atomic_mode));
    return { name: row.name, sql: read(row.selected.path, row.selected).toString('utf8'), atomicMode: row.atomic_mode };
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
    receipt: { format: manifest.format, manifest_sha256: MANIFEST_SHA, migrations: 293, overrides: 21,
      full_vendor_NORMAL: false, expected_fingerprint_authority: null },
  };
}
