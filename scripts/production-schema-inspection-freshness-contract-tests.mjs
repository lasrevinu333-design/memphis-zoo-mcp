#!/usr/bin/env node

import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import {
  INSPECTION_FRESHNESS_MIGRATION,
  INSPECTION_TRIGGER_DEFINITION_PATTERN,
  validateMigrationDirectory,
} from "./production-schema-inspection-freshness.mjs";

const root = resolve(new URL("..", import.meta.url).pathname);
const read = (path) => readFileSync(resolve(root, path), "utf8");
const workflow = read(".github/workflows/production-schema-inspection-freshness.yml");
const runner = read("scripts/production-schema-inspection-freshness.mjs");
const migrationPath = resolve(root, "release/reviewed-migrations", INSPECTION_FRESHNESS_MIGRATION.file);

assert.deepEqual(INSPECTION_FRESHNESS_MIGRATION, {
  file: "20260809125735_cleaning_inspection_24_hour_freshness.sql",
  version: "20260809125735",
  name: "cleaning_inspection_24_hour_freshness",
  sha256: "5629870fc9bfece9cec6f8a8182cca579c4070a8e9552039d4a1bb3035ae2052",
  bytes: 4134,
  from_fingerprint: "c6742e500c2a5d3767f1d886bb5937167eab42730f8271eec76b427a10c5f302",
  to_fingerprint: "333ddfc8008ea0b85916de7d491b98c9b8d6a7d45d3a2947d99b4b3bb836ea00",
  before_ledger_count: 149,
  before_ledger_max_version: "20260801195620",
  base_ledger_sha256: "a0389e8548bfafb9cf7792c17d2be250842e2fcbdcb0c46a27ec6317909792d5",
  after_ledger_count: 150,
});

const temporaryRoot = mkdtempSync(join(tmpdir(), "inspection-freshness-migration-"));
try {
  const isolated = join(temporaryRoot, "migrations");
  mkdirSync(isolated, { mode: 0o700 });
  copyFileSync(migrationPath, join(isolated, basename(migrationPath)));
  const reviewed = validateMigrationDirectory(isolated);
  assert.equal(reviewed.migration_count, 1);
  assert.match(reviewed.body, /statement_timestamp\(\)/);
  assert.match(reviewed.body, /completion_responses/);
  assert.match(reviewed.body, /interval '24 hours'/);
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}

assert.match(workflow, /^on:\n  workflow_dispatch:/m);
assert.match(workflow, /group: production-schema-inspection-freshness/);
assert.match(workflow, /cancel-in-progress: false/);
assert.match(workflow, /test "\$GITHUB_REF" = "refs\/heads\/main"/);
assert.match(workflow, /test "\$EXPECTED_MAIN_SHA" = "\$GITHUB_SHA"/);
assert.match(workflow, /APPLY 20260809125735 5629870fc9bfece9cec6f8a8182cca579c4070a8e9552039d4a1bb3035ae2052 c6742e500c2a5d3767f1d886bb5937167eab42730f8271eec76b427a10c5f302 333ddfc8008ea0b85916de7d491b98c9b8d6a7d45d3a2947d99b4b3bb836ea00/);
assert.equal((workflow.match(/production-schema-c674-github-evidence\.mjs/g) || []).length, 3,
  "backup and exact-main evidence must be checked at guard, preflight, and pre-apply");
assert.match(workflow, /Build isolated single-file migration directory/);
assert.match(workflow, /Read-only preflight of exact migration and production state/);
assert.match(workflow, /Apply exactly one reviewed migration atomically/);
assert.match(workflow, /Independently post-verify catalog, ledger, trigger, ACL, and compatibility/);
assert.match(workflow, /if: \$\{\{ always\(\) && steps\.apply\.outcome != 'skipped' \}\}/);
assert.match(workflow, /retention-days: 14/);

assert.match(runner, /begin isolation level serializable/);
assert.match(runner, /pg_advisory_xact_lock/);
assert.match(runner, /lock_timeout='5s'/);
assert.match(runner, /statement_timeout='120s'/);
assert.match(runner, /insert into supabase_migrations\.schema_migrations/);
assert.match(runner, /begin isolation level repeatable read read only/);
assert.match(runner, /finished sessions without completion evidence must be repaired before migration/);
assert.match(runner, /existing inspections violate the 24-hour completion contract/);
assert.match(runner, /post-migration physical catalog is not the reviewed 333ddfc8 target state/);
assert.match(
  "CREATE TRIGGER x BEFORE INSERT OR UPDATE ON cleaning_inspections FOR EACH ROW EXECUTE FUNCTION cleaning_inspections_set_snapshot()",
  INSPECTION_TRIGGER_DEFINITION_PATTERN,
);
assert.match(
  "CREATE TRIGGER x BEFORE INSERT OR UPDATE ON public.cleaning_inspections FOR EACH ROW EXECUTE FUNCTION public.cleaning_inspections_set_snapshot()",
  INSPECTION_TRIGGER_DEFINITION_PATTERN,
);

console.log(JSON.stringify({
  ok: true,
  contract: "production-schema-inspection-freshness",
  migration_sha256: INSPECTION_FRESHNESS_MIGRATION.sha256,
  from_fingerprint: INSPECTION_FRESHNESS_MIGRATION.from_fingerprint,
  to_fingerprint: INSPECTION_FRESHNESS_MIGRATION.to_fingerprint,
}, null, 2));
