import {assertObservedSourcePrefix} from './release-migration-observed-prefix.mjs';
import {resolveReleaseMigrationSource} from './production-forward-source.mjs';
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { SCHEMA_CATALOG_NAMES, fingerprintSchemaCatalog } from "./schema-fingerprint-catalog.mjs";
import { readMigrationReplayPlan } from "./migration-replay-order.mjs";

// This reads checked-out source only. It has no database or provider client.
// Run before authorization or mutation so an incompatible target fails early.
export function assertReleaseWorkflowSource(root) {
  const read = (path) => {
    const absolute = resolve(root, path);
    const metadata = lstatSync(absolute);
    assert.ok(metadata.isFile() && !metadata.isSymbolicLink(), `Release source must be a regular file: ${path}`);
    return readFileSync(absolute);
  };
  const state = JSON.parse(read("release/production-migration-state.json").toString("utf8"));
  const catalog = JSON.parse(read("supabase/canonical/schema-fingerprint-input.json").toString("utf8"));
  const fingerprint = read("supabase/canonical/schema-fingerprint.txt").toString("utf8").trim();
  const source = state.observed_production;
  const target = state.target;
  assert.equal(state.artifact, "production-migration-state.v2");
  assert.equal(state.mode, "migration_required");
  assert.match(String(source?.ledger_head || ""), /^[0-9]{14}$/);
  assert.match(String(source?.source_migration_name || ""), /^[a-z][a-z0-9_]*$/);
  assert.match(String(source?.catalog_privilege_fingerprint || ""), /^[a-f0-9]{64}$/);
  assert.ok(Number.isSafeInteger(source.production_ledger_count) && source.production_ledger_count > 0);
  const files = readdirSync(resolve(root, "supabase/migrations")).filter((file) => file.endsWith(".sql")).sort();
  for (const file of files) assert.match(file, /^[0-9]{14}_[a-z][a-z0-9_]*\.sql$/);
  assert.equal(new Set(files.map((file) => file.slice(0, 14))).size, files.length, "Migration versions must be unique");
  // Independently developed migrations can predate the current live ledger
  // head. Only the byte-bound complete source prefix establishes their phase;
  // sorting timestamps is never proof that a migration was installed.
  const plan = readMigrationReplayPlan(root);
  assert.equal(state.source_binding?.source_replay_manifest, "supabase/canonical/migration-replay-order.json");
  assert.equal(state.source_binding?.source_replay_manifest_sha256, plan.manifestSha256,
    "The release must bind the exact reviewed migration phases");
  assert.equal(plan.baseSourceCommit, state.source_binding?.source_prefix_commit,
    "The installed source prefix must have an explicit immutable commit");
  const applied = plan.files.slice(0, plan.baseCount);
  const pending = plan.files.slice(plan.baseCount);
  assert.deepEqual([...plan.files].sort(), files, "Replay phases must cover the exact migration source");
  assert.ok(pending.length > 0, "A migration release requires a nonempty pending phase");
  assert.equal(pending.length, plan.forwardCount);
  assert.equal(applied.length, source.source_authority_migration_count);
  assertObservedSourcePrefix(root,state,applied);
  assert.ok(Array.isArray(state.pending_migrations));
  assert.deepEqual(state.pending_migrations.map(({ file }) => file), pending, "Pending migrations must equal the complete ordered unapplied phase");
  for (const [index, item] of state.pending_migrations.entries()) {
    assert.equal(item.order, index + 1, "Pending migration order must be contiguous");
    assert.equal(item.source_migration_version, item.file.slice(0, 14), "Pending version must match its filename");
    assert.equal(item.file, `${item.source_migration_version}_${item.phase}.sql`, "Pending phase must match its filename");
    assert.match(String(item.sha256 || ""), /^[a-f0-9]{64}$/);
    resolveReleaseMigrationSource(root,item);
  }
  assert.equal(target.source_authority_migration_count, files.length);
  assert.equal(target.pending_migration_count, pending.length);
  assert.equal(target.production_ledger_count, source.production_ledger_count + pending.length);
  assert.equal(target.source_migration_file, pending.at(-1));
  assert.equal(target.source_migration_version, pending.at(-1).slice(0, 14));
  assert.equal(target.source_migration_name, pending.at(-1).slice(15, -4));
  assert.equal(target.production_ledger_version, null);
  // Legacy sections remain required. The only optional section is the fixed
  // namespace-owner DATA captured by captureSchemaCatalog; it is neither an
  // ACL marker nor permission to reinterpret an old catalog/restore target.
  const sections = [...SCHEMA_CATALOG_NAMES];
  const ownerSection = Object.getOwnPropertyDescriptor(catalog, "recovery_schema_owners");
  if (ownerSection) {
    const message = "Invalid recovery_schema_owners canonical metadata";
    assert.ok(Object.hasOwn(ownerSection, "value") && ownerSection.enumerable, message);
    const owners = ownerSection.value;
    assert.ok(Array.isArray(owners) && Object.getPrototypeOf(owners) === Array.prototype && owners.length === 1, message);
    assert.deepEqual(Reflect.ownKeys(owners).sort(), ["0", "length"], message);
    const entry = Object.getOwnPropertyDescriptor(owners, "0");
    assert.ok(Object.hasOwn(entry, "value") && entry.enumerable, message);
    const row = entry.value;
    assert.ok(row && Object.getPrototypeOf(row) === Object.prototype && Reflect.ownKeys(row).length === 2, message);
    const fields = Object.getOwnPropertyDescriptors(row);
    assert.ok(Object.hasOwn(fields.schema_name ?? {}, "value") && fields.schema_name.enumerable
      && Object.hasOwn(fields.owner_name ?? {}, "value") && fields.owner_name.enumerable, message);
    const schema = fields.schema_name.value, owner = fields.owner_name.value;
    assert.ok(schema === "custodial_recovery" && typeof owner === "string" && owner.length > 0
      && !owner.includes("\0") && Buffer.from(owner, "utf8").toString("utf8") === owner, message);
    sections.push("recovery_schema_owners");
  }
  // Check keys/closed owner descriptors BEFORE hashing can read any optional
  // property. No unknown section or getter is ignored/adopted as metadata.
  assert.deepEqual(Reflect.ownKeys(catalog).sort(), sections.sort(), "The complete canonical catalog is required");
  assert.match(fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(fingerprintSchemaCatalog(catalog).fingerprint, fingerprint);
  assert.equal(target.canonical_source_schema_fingerprint, fingerprint);
  const counts = Object.fromEntries(Object.entries(catalog).map(([name, rows]) => {
    assert.ok(Array.isArray(rows), `Invalid canonical catalog section: ${name}`);
    return [name, rows.length];
  }));
  assert.deepEqual(Object.keys(counts).sort(), sections, "The complete canonical catalog is required");
  assert.deepEqual(target.expected_catalog_counts, counts);
  assert.equal(target.public_function_count, counts.functions);
  const manifest = JSON.parse(read("release/frontend-release-manifest.json").toString("utf8"));
  assert.equal(manifest.schema_fingerprint, fingerprint);
  assert.equal(manifest.schema_transition.to_fingerprint, fingerprint);
  assert.equal(manifest.schema_transition.from_fingerprint, source.catalog_privilege_fingerprint);
  return { sourceCount: source.production_ledger_count, sourceHead: source.ledger_head,
    targetCount: target.production_ledger_count, targetHead: target.source_migration_version,
    pendingCount: pending.length, targetFingerprint: fingerprint };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  assert.equal(process.argv.length, 2, "This source preflight accepts no environment or command overrides");
  const root = resolve(new URL("..", import.meta.url).pathname);
  const target = assertReleaseWorkflowSource(root);
  console.log(JSON.stringify({ ok: true, source_preflight: true, database_contacted: false, ...target }));
}
