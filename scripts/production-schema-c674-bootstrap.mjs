#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmodSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";
import {
  captureSchemaCatalog,
  fingerprintSchemaCatalog,
} from "./schema-fingerprint-catalog.mjs";

const { Client } = pg;

export const BOOTSTRAP = Object.freeze({
  migration_file: "20260801195620_custodial_device_removal_operation.sql",
  migration_version: "20260801195620",
  migration_name: "custodial_device_removal_operation",
  migration_sha256: "f23a5cd53292af904b27d5979c5af2e05bf8c85cc1de64c361f246bb68de8166",
  migration_bytes: 9218,
  from_fingerprint: "544d11f47f1f4a960fcf49d13bba53c736d78fe4fe9d225c996c84311d442ad0",
  to_fingerprint: "c6742e500c2a5d3767f1d886bb5937167eab42730f8271eec76b427a10c5f302",
  before_ledger_count: 148,
  before_ledger_max_version: "20260801173321",
  base_ledger_sha256: "1a928e5ac004d6a93b5ccff66a675f931655c42389e1160722a55084346b73b3",
  after_ledger_count: 149,
});

const FUNCTION_SIGNATURE = "public.device_auth_remove_custodial_credential(uuid,uuid,uuid,text,timestamp with time zone)";
const EXPECTED_INDEXES = Object.freeze([
  "device_auth_removal_operations_credential_id_key",
  "device_auth_removal_operations_pkey",
  "idx_device_auth_removal_operations_device_recent",
]);
const JOB_INDEX = "idx_operational_notification_jobs_employee_credential_open";
const ADVISORY_LOCK = "memphis-zoo:production-schema-c674-bootstrap:20260801195620";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function unwrapReviewedMigration(migrationSql) {
  const beginLines = migrationSql.match(/^begin;[ \t]*$/gim) || [];
  const commitLines = migrationSql.match(/^commit;[ \t]*$/gim) || [];
  assert.equal(beginLines.length, 1, "reviewed migration must contain exactly one outer BEGIN");
  assert.equal(commitLines.length, 1, "reviewed migration must contain exactly one outer COMMIT");
  assert.doesNotMatch(migrationSql, /^\s*(?:rollback|savepoint|release\s+savepoint)\b/gim,
    "reviewed migration cannot contain other transaction controls");
  const body = migrationSql
    .replace(/^begin;[ \t]*$/im, "")
    .replace(/^commit;[ \t]*$/im, "");
  assert.doesNotMatch(body, /^\s*(?:begin|commit|rollback|savepoint|release\s+savepoint)\s*;/gim,
    "migration body cannot retain transaction controls");
  return body;
}

export function validateMigrationDirectory(directoryInput) {
  const directory = resolve(String(directoryInput || "").trim());
  assert.ok(directoryInput, "--migration-dir is required");
  const entries = readdirSync(directory, { withFileTypes: true });
  assert.equal(entries.length, 1, "isolated migration directory must contain exactly one entry");
  assert.ok(entries[0].isFile() && !entries[0].isSymbolicLink(),
    "isolated migration entry must be a regular file");
  assert.equal(entries[0].name, BOOTSTRAP.migration_file,
    "isolated directory contains the wrong migration");
  const path = resolve(directory, entries[0].name);
  const migrationSql = readFileSync(path, "utf8");
  assert.equal(statSync(path).size, BOOTSTRAP.migration_bytes, "migration byte length does not match reviewed source");
  assert.equal(Buffer.byteLength(migrationSql), BOOTSTRAP.migration_bytes,
    "migration UTF-8 byte length does not match reviewed source");
  assert.equal(sha256(migrationSql), BOOTSTRAP.migration_sha256,
    "migration SHA-256 does not match reviewed source");
  const body = unwrapReviewedMigration(migrationSql);
  return { directory, path, migrationSql, body, migration_count: 1 };
}

function parseArguments(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    assert.match(String(key || ""), /^--(?:mode|migration-dir|evidence-out)$/,
      `unsupported argument: ${String(key || "")}`);
    assert.ok(value && !String(value).startsWith("--"), `${key} requires a value`);
    assert.ok(!values.has(key), `${key} can only be supplied once`);
    values.set(key, value);
  }
  assert.equal(values.size, 3, "--mode, --migration-dir, and --evidence-out are required");
  const mode = values.get("--mode");
  assert.ok(["dry-run", "apply", "verify"].includes(mode), "--mode must be dry-run, apply, or verify");
  return {
    mode,
    migrationDirectory: values.get("--migration-dir"),
    evidencePath: resolve(values.get("--evidence-out")),
  };
}

function databaseConfiguration() {
  const databaseUrl = String(process.env.PRODUCTION_SUPABASE_DB_URL || "").trim();
  const projectRef = String(process.env.PRODUCTION_SUPABASE_PROJECT_REF || "").trim();
  const caPath = resolve(String(process.env.PRODUCTION_SUPABASE_DB_CA_CERT_PATH || "").trim());
  assert.ok(databaseUrl, "PRODUCTION_SUPABASE_DB_URL is required");
  assert.match(projectRef, /^[a-z0-9]{20}$/, "PRODUCTION_SUPABASE_PROJECT_REF must be a project reference");
  assert.ok(process.env.PRODUCTION_SUPABASE_DB_CA_CERT_PATH,
    "PRODUCTION_SUPABASE_DB_CA_CERT_PATH is required");
  const parsed = new URL(databaseUrl);
  assert.ok(["postgres:", "postgresql:"].includes(parsed.protocol), "production database URL must use PostgreSQL");
  const boundIdentity = `${parsed.hostname}:${decodeURIComponent(parsed.username)}`;
  assert.ok(boundIdentity.includes(projectRef), "database URL is not bound to the configured production project");
  for (const key of ["sslmode", "sslcert", "sslkey", "sslrootcert"]) parsed.searchParams.delete(key);
  const ca = readFileSync(caPath, "utf8");
  assert.match(ca, /-----BEGIN CERTIFICATE-----/, "production database CA certificate is invalid");
  return {
    connectionString: parsed.toString(),
    ssl: { ca, rejectUnauthorized: true },
    projectRef,
  };
}

async function ledgerState(client) {
  const summary = await client.query(`
    select count(*)::integer as migration_count,
           min(version) as min_version,
           max(version) as max_version,
           count(*) filter (
             where version = $1 or name = $2
           )::integer as target_conflicts,
           (
             select encode(extensions.digest(convert_to(coalesce(
               jsonb_agg(jsonb_build_object(
                 'version', base.version,
                 'name', base.name,
                 'statements', base.statements,
                 'created_by', base.created_by,
                 'idempotency_key', base.idempotency_key,
                 'rollback', base.rollback
               ) order by base.version, base.name)::text,
               '[]'
             ), 'UTF8'), 'sha256'), 'hex')
               from supabase_migrations.schema_migrations base
              where base.version is distinct from $1
                and base.name is distinct from $2
           ) as base_ledger_sha256
      from supabase_migrations.schema_migrations
  `, [BOOTSTRAP.migration_version, BOOTSTRAP.migration_name]);
  return summary.rows[0];
}

async function physicalState(client) {
  const inventory = await captureSchemaCatalog(client);
  const { fingerprint } = fingerprintSchemaCatalog(inventory);
  return {
    fingerprint,
    counts: Object.fromEntries(Object.entries(inventory).map(([name, rows]) => [name, rows.length])),
  };
}

async function assertDatabaseIdentity(client) {
  const result = await client.query(`
    select current_user as database_role,
           current_database() as database_name,
           has_schema_privilege(current_user, 'public', 'CREATE') as can_create_public,
           has_table_privilege(
             current_user,
             'supabase_migrations.schema_migrations',
             'INSERT'
           ) as can_record_migration,
           pg_get_userbyid(c.relowner) as notification_jobs_owner
      from pg_class c
     where c.oid = 'public.operational_notification_jobs'::regclass
  `);
  assert.equal(result.rowCount, 1, "production database identity query is incomplete");
  assert.deepEqual(result.rows[0], {
    database_role: "postgres",
    database_name: "postgres",
    can_create_public: true,
    can_record_migration: true,
    notification_jobs_owner: "postgres",
  }, "production connection is not the migration-owning postgres identity");
  return result.rows[0];
}

async function assertBeforeState(client) {
  const [physical, ledger, targets] = await Promise.all([
    physicalState(client),
    ledgerState(client),
    client.query(`
      select to_regclass('public.device_auth_removal_operations')::text as operation_table,
             to_regclass('public.idx_device_auth_removal_operations_device_recent')::text as operation_index,
             to_regclass('public.idx_operational_notification_jobs_employee_credential_open')::text as job_index,
             to_regprocedure($1)::text as removal_function
    `, [FUNCTION_SIGNATURE]),
  ]);
  assert.equal(physical.fingerprint, BOOTSTRAP.from_fingerprint,
    "production physical catalog is not the reviewed 544d11 source state");
  assert.equal(ledger.migration_count, BOOTSTRAP.before_ledger_count,
    "production migration ledger cardinality changed");
  assert.equal(ledger.max_version, BOOTSTRAP.before_ledger_max_version,
    "production migration ledger tip changed");
  assert.equal(ledger.base_ledger_sha256, BOOTSTRAP.base_ledger_sha256,
    "production migration ledger contents changed");
  assert.equal(ledger.target_conflicts, 0, "target migration version or name is already present");
  assert.deepEqual(targets.rows[0], {
    operation_table: null,
    operation_index: null,
    job_index: null,
    removal_function: null,
  }, "target objects are partially present before bootstrap");
  return { physical, ledger, targets: targets.rows[0] };
}

async function assertAfterState(client, migrationSql, createdBy) {
  const [physical, ledger, targetLedger, table, tableGrants, indexes, jobIndex, fn, functionGrants] = await Promise.all([
    physicalState(client),
    ledgerState(client),
    client.query(`
      select version, name, statements, created_by, idempotency_key, rollback
        from supabase_migrations.schema_migrations
       where version = $1 or name = $2
       order by version
    `, [BOOTSTRAP.migration_version, BOOTSTRAP.migration_name]),
    client.query(`
      select c.relrowsecurity as rls_enabled,
             c.relforcerowsecurity as rls_forced,
             (select count(*)::integer from pg_policy p where p.polrelid = c.oid) as policy_count
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = 'device_auth_removal_operations'
    `),
    client.query(`
      select grantee, privilege_type
        from information_schema.role_table_grants
       where table_schema = 'public'
         and table_name = 'device_auth_removal_operations'
         and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')
       order by grantee, privilege_type
    `),
    client.query(`
      select i.relname as index_name, ix.indisvalid as is_valid, ix.indisready as is_ready
        from pg_index ix
        join pg_class i on i.oid = ix.indexrelid
        join pg_class t on t.oid = ix.indrelid
        join pg_namespace n on n.oid = t.relnamespace
       where n.nspname = 'public' and t.relname = 'device_auth_removal_operations'
       order by i.relname
    `),
    client.query(`
      select i.relname as index_name, ix.indisvalid as is_valid, ix.indisready as is_ready,
             pg_get_indexdef(i.oid) as definition
        from pg_class i
        join pg_namespace n on n.oid = i.relnamespace
        join pg_index ix on ix.indexrelid = i.oid
       where n.nspname = 'public' and i.relname = $1
    `, [JOB_INDEX]),
    client.query(`
      select p.prosecdef as security_definer,
             p.proconfig as configuration
        from pg_proc p
       where p.oid = to_regprocedure($1)
    `, [FUNCTION_SIGNATURE]),
    client.query(`
      select coalesce(r.rolname, 'PUBLIC') as grantee, x.privilege_type
        from pg_proc p
        cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
        left join pg_roles r on r.oid = x.grantee
       where p.oid = to_regprocedure($1)
         and coalesce(r.rolname, 'PUBLIC') in ('PUBLIC', 'anon', 'authenticated', 'service_role')
       order by grantee, x.privilege_type
    `, [FUNCTION_SIGNATURE]),
  ]);

  assert.equal(physical.fingerprint, BOOTSTRAP.to_fingerprint,
    "post-migration physical catalog is not the reviewed c6742e target state");
  assert.equal(ledger.migration_count, BOOTSTRAP.after_ledger_count,
    "post-migration ledger must contain exactly one additional row");
  assert.equal(ledger.max_version, BOOTSTRAP.migration_version,
    "post-migration ledger tip is not the reviewed version");
  assert.equal(ledger.target_conflicts, 1, "post-migration ledger target is not unique");
  assert.equal(ledger.base_ledger_sha256, BOOTSTRAP.base_ledger_sha256,
    "pre-existing production migration ledger contents changed");
  assert.equal(targetLedger.rowCount, 1, "target ledger row must be unique by version and name");
  const row = targetLedger.rows[0];
  assert.equal(row.version, BOOTSTRAP.migration_version);
  assert.equal(row.name, BOOTSTRAP.migration_name);
  assert.deepEqual(row.statements, [migrationSql], "ledger must retain the exact reviewed SQL as one statement");
  assert.equal(row.created_by, createdBy, "ledger creator evidence does not match this workflow run");
  assert.equal(row.idempotency_key, null);
  assert.equal(row.rollback, null);

  assert.equal(table.rowCount, 1, "operation table is missing");
  assert.deepEqual(table.rows[0], {
    rls_enabled: true,
    rls_forced: true,
    policy_count: 0,
  }, "operation table RLS or grants differ from the reviewed contract");
  assert.deepEqual(tableGrants.rows, [
    { grantee: "service_role", privilege_type: "INSERT" },
    { grantee: "service_role", privilege_type: "SELECT" },
  ], "operation table grants differ from the reviewed contract");
  assert.deepEqual(indexes.rows.map((rowValue) => rowValue.index_name), EXPECTED_INDEXES,
    "operation table index set differs from the reviewed contract");
  assert.ok(indexes.rows.every((rowValue) => rowValue.is_valid && rowValue.is_ready),
    "operation table indexes must be valid and ready");
  assert.equal(jobIndex.rowCount, 1, "notification credential index is missing");
  assert.equal(jobIndex.rows[0].is_valid, true);
  assert.equal(jobIndex.rows[0].is_ready, true);
  assert.match(jobIndex.rows[0].definition, /payload_json ->> 'credential_id'/);
  assert.match(jobIndex.rows[0].definition, /employee_event_push/);
  assert.match(jobIndex.rows[0].definition, /employee_native_push/);
  assert.match(jobIndex.rows[0].definition, /pending/);
  assert.match(jobIndex.rows[0].definition, /leased/);

  assert.equal(fn.rowCount, 1, "credential-removal function is missing");
  assert.deepEqual(fn.rows[0], {
    security_definer: true,
    configuration: ["search_path=pg_catalog, public"],
  }, "credential-removal function security or grants differ from the reviewed contract");
  assert.deepEqual(functionGrants.rows, [
    { grantee: "service_role", privilege_type: "EXECUTE" },
  ], "credential-removal function grants differ from the reviewed contract");
  return {
    physical,
    ledger,
    contract: {
      table: table.rows[0],
      table_grants: tableGrants.rows,
      indexes: indexes.rows,
      notification_index: jobIndex.rows[0],
      function: fn.rows[0],
      function_grants: functionGrants.rows,
      ledger_sql_sha256: sha256(row.statements[0]),
    },
  };
}

function workflowIdentity(mode) {
  const repository = String(process.env.GITHUB_REPOSITORY || "").trim();
  const sha = String(process.env.GITHUB_SHA || "").trim();
  if (mode !== "dry-run") {
    assert.match(repository, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, "GITHUB_REPOSITORY is required");
    assert.match(sha, /^[0-9a-f]{40}$/, "GITHUB_SHA is required");
  }
  return {
    repository: repository || null,
    sha: sha || null,
    createdBy: repository && sha ? `github-actions:${repository}@${sha}` : null,
    runId: String(process.env.GITHUB_RUN_ID || "").trim() || null,
    runAttempt: String(process.env.GITHUB_RUN_ATTEMPT || "").trim() || null,
  };
}

function writeEvidence(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}

export async function run(argv = process.argv.slice(2)) {
  const { mode, migrationDirectory, evidencePath } = parseArguments(argv);
  const migration = validateMigrationDirectory(migrationDirectory);
  const database = databaseConfiguration();
  const identity = workflowIdentity(mode);
  if (mode === "apply") {
    assert.equal(process.env.PRODUCTION_SCHEMA_BOOTSTRAP_APPLY, BOOTSTRAP.migration_version,
      "apply mode requires the exact production bootstrap confirmation environment value");
  }
  const client = new Client({
    connectionString: database.connectionString,
    ssl: database.ssl,
    application_name: `memphis-zoo-schema-c674-${mode}`,
  });
  const evidence = {
    ok: false,
    mode,
    generated_at: new Date().toISOString(),
    project_ref: database.projectRef,
    workflow: identity,
    migration: {
      path: basename(migration.path),
      version: BOOTSTRAP.migration_version,
      name: BOOTSTRAP.migration_name,
      sha256: BOOTSTRAP.migration_sha256,
      bytes: BOOTSTRAP.migration_bytes,
      migration_count: migration.migration_count,
      from_fingerprint: BOOTSTRAP.from_fingerprint,
      to_fingerprint: BOOTSTRAP.to_fingerprint,
    },
  };

  await client.connect();
  try {
    if (mode === "apply") {
      await client.query("begin isolation level serializable");
      await client.query("set local lock_timeout = '5s'");
      await client.query("set local statement_timeout = '120s'");
      await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [ADVISORY_LOCK]);
      evidence.database_identity = await assertDatabaseIdentity(client);
      evidence.before = await assertBeforeState(client);
      await client.query(migration.body);
      await client.query(`
        insert into supabase_migrations.schema_migrations(
          version, statements, name, created_by, idempotency_key, rollback
        ) values ($1, $2::text[], $3, $4, null, null)
      `, [BOOTSTRAP.migration_version, [migration.migrationSql], BOOTSTRAP.migration_name, identity.createdBy]);
      evidence.after = await assertAfterState(client, migration.migrationSql, identity.createdBy);
      await client.query("commit");
      evidence.applied = true;
    } else {
      await client.query("begin isolation level repeatable read read only");
      evidence.database_identity = await assertDatabaseIdentity(client);
      if (mode === "dry-run") {
        evidence.before = await assertBeforeState(client);
        evidence.would_apply = true;
      } else {
        evidence.after = await assertAfterState(client, migration.migrationSql, identity.createdBy);
        evidence.verified = true;
      }
      await client.query("rollback");
    }
    evidence.ok = true;
    evidence.completed_at = new Date().toISOString();
    writeEvidence(evidencePath, evidence);
    console.log(JSON.stringify({
      ok: true,
      mode,
      migration_count: migration.migration_count,
      migration_sha256: BOOTSTRAP.migration_sha256,
      from_fingerprint: BOOTSTRAP.from_fingerprint,
      to_fingerprint: BOOTSTRAP.to_fingerprint,
      applied: evidence.applied === true,
      verified: evidence.verified === true,
      evidence_path: basename(evidencePath),
    }, null, 2));
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  await run();
}
