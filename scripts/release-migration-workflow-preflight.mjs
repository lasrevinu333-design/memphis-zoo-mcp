import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { SCHEMA_CATALOG_NAMES, fingerprintSchemaCatalog } from "./schema-fingerprint-catalog.mjs";

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
  const applied = files.filter((file) => file.slice(0, 14) <= source.ledger_head);
  const pending = files.filter((file) => file.slice(0, 14) > source.ledger_head);
  assert.ok(pending.length > 0, "A migration release requires a nonempty pending suffix");
  assert.equal(applied.length, source.source_authority_migration_count);
  assert.equal(applied.at(-1), `${source.ledger_head}_${source.source_migration_name}.sql`);
  assert.ok(Array.isArray(state.pending_migrations));
  assert.deepEqual(state.pending_migrations.map(({ file }) => file), pending, "Pending migrations must equal the complete ordered source suffix");
  for (const [index, item] of state.pending_migrations.entries()) {
    assert.equal(item.order, index + 1, "Pending migration order must be contiguous");
    assert.equal(item.source_migration_version, item.file.slice(0, 14), "Pending version must match its filename");
    assert.equal(item.file, `${item.source_migration_version}_${item.phase}.sql`, "Pending phase must match its filename");
    assert.match(String(item.sha256 || ""), /^[a-f0-9]{64}$/);
    assert.equal(createHash("sha256").update(read(`supabase/migrations/${item.file}`)).digest("hex"), item.sha256, "Pending migration bytes differ from their declared hash");
  }
  assert.equal(target.source_authority_migration_count, files.length);
  assert.equal(target.pending_migration_count, pending.length);
  assert.equal(target.production_ledger_count, source.production_ledger_count + pending.length);
  assert.equal(target.source_migration_file, pending.at(-1));
  assert.equal(target.source_migration_version, pending.at(-1).slice(0, 14));
  assert.equal(target.source_migration_name, pending.at(-1).slice(15, -4));
  assert.equal(target.production_ledger_version, null);
  assert.match(fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(fingerprintSchemaCatalog(catalog).fingerprint, fingerprint);
  assert.equal(target.canonical_source_schema_fingerprint, fingerprint);
  const counts = Object.fromEntries(Object.entries(catalog).map(([name, rows]) => {
    assert.ok(Array.isArray(rows), `Invalid canonical catalog section: ${name}`);
    return [name, rows.length];
  }));
  assert.deepEqual(Object.keys(counts).sort(), [...SCHEMA_CATALOG_NAMES].sort(), "The complete canonical catalog is required");
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
