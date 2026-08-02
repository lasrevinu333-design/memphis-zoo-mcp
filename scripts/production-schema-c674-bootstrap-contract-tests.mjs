#!/usr/bin/env node

import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BOOTSTRAP,
  unwrapReviewedMigration,
  validateMigrationDirectory,
} from "./production-schema-c674-bootstrap.mjs";
import {
  BACKUP_MAX_AGE_MS,
  BACKUP_WORKFLOW_PATH,
  validateBackupEvidence,
  validateProductionEnvironment,
} from "./production-schema-c674-github-evidence.mjs";
import { fingerprintSchemaCatalog } from "./schema-fingerprint-catalog.mjs";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const migrationPath = resolve(root, "supabase", "migrations", BOOTSTRAP.migration_file);
const workflowPath = resolve(root, ".github", "workflows", "production-schema-c674-bootstrap.yml");
const migrationSql = readFileSync(migrationPath, "utf8");
const workflow = readFileSync(workflowPath, "utf8");
const runnerSource = readFileSync(resolve(root, "scripts", "production-schema-c674-bootstrap.mjs"), "utf8");
const evidenceSource = readFileSync(resolve(root, "scripts", "production-schema-c674-github-evidence.mjs"), "utf8");

assert.equal(BOOTSTRAP.migration_file, "20260801195620_custodial_device_removal_operation.sql");
assert.equal(BOOTSTRAP.migration_sha256, "f23a5cd53292af904b27d5979c5af2e05bf8c85cc1de64c361f246bb68de8166");
assert.equal(BOOTSTRAP.from_fingerprint, "544d11f47f1f4a960fcf49d13bba53c736d78fe4fe9d225c996c84311d442ad0");
assert.equal(BOOTSTRAP.to_fingerprint, "c6742e500c2a5d3767f1d886bb5937167eab42730f8271eec76b427a10c5f302");
assert.equal(BOOTSTRAP.before_ledger_count, 148);
assert.equal(BOOTSTRAP.before_ledger_max_version, "20260801173321");
assert.equal(BOOTSTRAP.base_ledger_sha256, "1a928e5ac004d6a93b5ccff66a675f931655c42389e1160722a55084346b73b3");
assert.equal(BOOTSTRAP.after_ledger_count, 149);
const migrationBody = unwrapReviewedMigration(migrationSql);
assert.doesNotMatch(migrationBody, /^begin;$/gim);
assert.doesNotMatch(migrationBody, /^commit;$/gim);
assert.match(migrationBody, /^begin$/gim, "PL/pgSQL body must be preserved while the outer transaction is removed");

const isolated = mkdtempSync(join(tmpdir(), "mz-schema-c674-contract-"));
try {
  copyFileSync(migrationPath, join(isolated, BOOTSTRAP.migration_file));
  const validated = validateMigrationDirectory(isolated);
  assert.equal(validated.migration_count, 1);
  assert.equal(validated.migrationSql, migrationSql);
  writeFileSync(join(isolated, "unexpected.sql"), "select 1;\n");
  assert.throws(() => validateMigrationDirectory(isolated), /exactly one entry/);
  rmSync(join(isolated, "unexpected.sql"));
  writeFileSync(join(isolated, BOOTSTRAP.migration_file), `${migrationSql}\n`);
  assert.throws(() => validateMigrationDirectory(isolated), /byte length|SHA-256/);
} finally {
  rmSync(isolated, { recursive: true, force: true });
}

const canonical = JSON.parse(readFileSync(resolve(root, "supabase", "canonical", "schema-fingerprint-input.json"), "utf8"));
assert.equal(fingerprintSchemaCatalog(canonical).fingerprint, BOOTSTRAP.to_fingerprint,
  "production verifier must use the canonical catalog normalization and hash");

assert.match(workflow, /^on:\n  workflow_dispatch:/m);
assert.doesNotMatch(workflow, /^\s+(?:push|pull_request|schedule):/m,
  "bootstrap must only be manually dispatchable");
assert.match(workflow, /group: production-schema-c674-bootstrap/);
assert.match(workflow, /cancel-in-progress: false/);
assert.match(workflow, /environment:\n\s+name: production/);
assert.match(workflow, /if: \$\{\{ always\(\) && steps\.apply\.outcome != 'skipped' \}\}/,
  "independent post-verification must run after any attempted apply, including ambiguous failures");
assert.match(workflow, /test "\$GITHUB_REF" = "refs\/heads\/main"/);
assert.match(workflow, /test "\$EXPECTED_MAIN_SHA" = "\$GITHUB_SHA"/);
assert.match(workflow, new RegExp(`APPLY ${BOOTSTRAP.migration_version} ${BOOTSTRAP.migration_sha256} ${BOOTSTRAP.from_fingerprint} ${BOOTSTRAP.to_fingerprint}`));
assert.match(workflow, /secrets\.PRODUCTION_SUPABASE_DB_URL/);
assert.match(workflow, /secrets\.PRODUCTION_SUPABASE_PROJECT_REF/);
assert.doesNotMatch(workflow, /secrets\.SUPABASE_DB_URL/,
  "bootstrap must require production-environment-specific database secrets");
assert.match(workflow, /npm ci --ignore-scripts/);
assert.match(workflow, /entries=\("\$ISOLATED_DIR"\/\*\)/);
assert.match(workflow, /test "\$\{#entries\[@\]\}" -eq 1/);
assert.match(workflow, new RegExp(BOOTSTRAP.migration_sha256));
const dryRunStep = workflow.indexOf("--mode dry-run");
const applyStep = workflow.indexOf("--mode apply");
const verifyStep = workflow.indexOf("--mode verify");
assert.ok(dryRunStep > 0 && applyStep > dryRunStep && verifyStep > applyStep,
  "dry-run, apply, and independent verification must remain ordered");
const preApplyGithubEvidence = workflow.indexOf("pre-apply-github-evidence.json");
assert.ok(preApplyGithubEvidence > dryRunStep && preApplyGithubEvidence < applyStep,
  "exact main tip, environment, and backup evidence must be rechecked immediately before apply");
assert.doesNotMatch(workflow, /supabase\s+db\s+push|\bpsql\b/,
  "ledger-divergent production bootstrap cannot use db push or ad hoc psql");

assert.match(runnerSource, /begin isolation level serializable/);
assert.match(runnerSource, /pg_advisory_xact_lock/);
assert.match(runnerSource, /production connection is not the migration-owning postgres identity/);
assert.match(runnerSource, /assertBeforeState\(client\)/);
assert.match(runnerSource, /insert into supabase_migrations\.schema_migrations/);
assert.match(runnerSource, /assertAfterState\(client, migration\.migrationSql, identity\.createdBy\)/);
assert.ok(runnerSource.indexOf("assertBeforeState(client)") < runnerSource.indexOf("client.query(migration.body)"));
assert.ok(runnerSource.indexOf("insert into supabase_migrations.schema_migrations") < runnerSource.lastIndexOf("assertAfterState(client"));
const transactionalPostVerify = runnerSource.indexOf("evidence.after = await assertAfterState(client");
const transactionalCommit = runnerSource.indexOf('client.query("commit")', transactionalPostVerify);
assert.ok(transactionalPostVerify > 0 && transactionalCommit > transactionalPostVerify,
  "transactional postconditions must pass before commit");
assert.match(runnerSource, /rls_enabled/);
assert.match(runnerSource, /table_grants/);
assert.match(runnerSource, /function_grants/);
assert.match(runnerSource, /indisvalid/);
assert.doesNotMatch(runnerSource, /execFile|spawn|\bpsql\b|supabase\s+db\s+push/);

const protectedEnvironment = {
  name: "production",
  protection_rules: [{
    type: "required_reviewers",
    prevent_self_review: true,
    reviewers: [{ reviewer: { login: "reviewer" } }],
  }],
  deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
};
assert.deepEqual(
  validateProductionEnvironment(protectedEnvironment, [{ name: "main", type: "branch" }], false),
  { environment: "production", required_reviewer_count: 1, deployment_policy: "main-only" },
);
assert.throws(
  () => validateProductionEnvironment({ ...protectedEnvironment, protection_rules: [] }, [{ name: "main" }], false),
  /require reviewers/,
);
assert.throws(
  () => validateProductionEnvironment({
    ...protectedEnvironment,
    protection_rules: [{ ...protectedEnvironment.protection_rules[0], prevent_self_review: false }],
  }, [{ name: "main" }], false),
  /prevent the initiator/,
);
assert.throws(
  () => validateProductionEnvironment(protectedEnvironment, [{ name: "main" }, { name: "release" }], false),
  /exactly one/,
);

const now = Date.parse("2026-08-02T07:00:00Z");
const sha = "7".repeat(40);
const repository = "lasrevinu333-design/memphis-zoo-mcp";
const backupRunId = "30735919498";
const workflowEvidence = { id: 123, path: BACKUP_WORKFLOW_PATH };
const runEvidence = {
  id: Number(backupRunId),
  workflow_id: 123,
  status: "completed",
  conclusion: "success",
  head_branch: "main",
  head_sha: sha,
  repository: { full_name: repository },
  event: "workflow_dispatch",
  updated_at: new Date(now - 60_000).toISOString(),
  run_attempt: 1,
};
const artifactEvidence = [{
  id: 456,
  name: `memphis-zoo-disaster-recovery-${backupRunId}`,
  expired: false,
  size_in_bytes: 3_473_168,
  digest: `sha256:${"a".repeat(64)}`,
  expires_at: "2026-08-16T07:00:00Z",
}];
const backup = validateBackupEvidence({
  workflow: workflowEvidence,
  run: runEvidence,
  artifacts: artifactEvidence,
  repository,
  sha,
  backupRunId,
  now,
});
assert.equal(backup.age_seconds, 60);
assert.equal(backup.artifact.size_bytes, 3_473_168);
assert.throws(() => validateBackupEvidence({
  workflow: workflowEvidence,
  run: { ...runEvidence, updated_at: new Date(now - BACKUP_MAX_AGE_MS - 1).toISOString() },
  artifacts: artifactEvidence,
  repository,
  sha,
  backupRunId,
  now,
}), /not fresh/);
assert.throws(() => validateBackupEvidence({
  workflow: workflowEvidence,
  run: { ...runEvidence, head_sha: "8".repeat(40) },
  artifacts: artifactEvidence,
  repository,
  sha,
  backupRunId,
  now,
}), /exact main commit/);
assert.match(evidenceSource, /workflow commit is no longer the exact main tip/);
assert.match(evidenceSource, /maximum age is 90 minutes/);
assert.match(evidenceSource, /sha256:\[0-9a-f\]\{64\}/);

console.log(JSON.stringify({
  ok: true,
  contract: "production-schema-c674-bootstrap",
  migration_version: BOOTSTRAP.migration_version,
  migration_sha256: BOOTSTRAP.migration_sha256,
  from_fingerprint: BOOTSTRAP.from_fingerprint,
  to_fingerprint: BOOTSTRAP.to_fingerprint,
}, null, 2));
