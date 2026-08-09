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
import {
  EXPECTED_FUNCTION_ACL,
  unwrapReviewedMigration,
  validateProductionDatabaseUrl,
} from "./production-schema-c674-bootstrap.mjs";

const { Client } = pg;

export const INSPECTION_FRESHNESS_MIGRATION = Object.freeze({
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

const FUNCTION_SIGNATURE = "public.cleaning_inspections_set_snapshot()";
const ADVISORY_LOCK = "memphis-zoo:production-schema-inspection-freshness:20260809125735";
export const INSPECTION_TRIGGER_DEFINITION_PATTERN =
  /BEFORE INSERT OR UPDATE ON (?:public\.)?cleaning_inspections\b/;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function validateMigrationDirectory(directoryInput) {
  assert.ok(directoryInput, "--migration-dir is required");
  const directory = resolve(String(directoryInput));
  const entries = readdirSync(directory, { withFileTypes: true });
  assert.equal(entries.length, 1, "isolated migration directory must contain exactly one entry");
  assert.ok(entries[0].isFile() && !entries[0].isSymbolicLink(),
    "isolated migration entry must be a regular file");
  assert.equal(entries[0].name, INSPECTION_FRESHNESS_MIGRATION.file,
    "isolated directory contains the wrong migration");
  const path = resolve(directory, entries[0].name);
  const migrationSql = readFileSync(path, "utf8");
  assert.equal(statSync(path).size, INSPECTION_FRESHNESS_MIGRATION.bytes,
    "migration byte length does not match reviewed source");
  assert.equal(Buffer.byteLength(migrationSql), INSPECTION_FRESHNESS_MIGRATION.bytes,
    "migration UTF-8 byte length does not match reviewed source");
  assert.equal(sha256(migrationSql), INSPECTION_FRESHNESS_MIGRATION.sha256,
    "migration SHA-256 does not match reviewed source");
  return {
    directory,
    path,
    migrationSql,
    body: unwrapReviewedMigration(migrationSql),
    migration_count: 1,
  };
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
  assert.ok(["preflight", "apply", "verify"].includes(mode),
    "--mode must be preflight, apply, or verify");
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
  assert.ok(process.env.PRODUCTION_SUPABASE_DB_CA_CERT_PATH,
    "PRODUCTION_SUPABASE_DB_CA_CERT_PATH is required");
  const validated = validateProductionDatabaseUrl(databaseUrl, projectRef);
  const ca = readFileSync(caPath, "utf8");
  assert.match(ca, /-----BEGIN CERTIFICATE-----/, "production database CA certificate is invalid");
  return {
    connectionString: validated.connectionString,
    ssl: { ca, rejectUnauthorized: true },
    safeIdentity: validated.safeIdentity,
  };
}

async function physicalState(client) {
  const inventory = await captureSchemaCatalog(client);
  const { fingerprint } = fingerprintSchemaCatalog(inventory);
  return {
    fingerprint,
    counts: Object.fromEntries(Object.entries(inventory).map(([name, rows]) => [name, rows.length])),
  };
}

async function ledgerState(client) {
  const result = await client.query(`
    select count(*)::integer as migration_count,
           min(version) as min_version,
           max(version) as max_version,
           count(*) filter(where version=$1 or name=$2)::integer as target_conflicts,
           (
             select encode(extensions.digest(convert_to(coalesce(
               jsonb_agg(jsonb_build_object(
                 'version',base.version,
                 'name',base.name,
                 'statements',base.statements,
                 'created_by',base.created_by,
                 'idempotency_key',base.idempotency_key,
                 'rollback',base.rollback
               ) order by base.version,base.name)::text,
               '[]'
             ),'UTF8'),'sha256'),'hex')
             from supabase_migrations.schema_migrations base
             where base.version is distinct from $1 and base.name is distinct from $2
           ) as base_ledger_sha256
      from supabase_migrations.schema_migrations
  `, [INSPECTION_FRESHNESS_MIGRATION.version, INSPECTION_FRESHNESS_MIGRATION.name]);
  return result.rows[0];
}

async function assertDatabaseIdentity(client) {
  const result = await client.query(`
    select current_user as database_role,
           current_database() as database_name,
           has_schema_privilege(current_user,'public','CREATE') as can_create_public,
           has_table_privilege(current_user,'supabase_migrations.schema_migrations','INSERT') as can_record_migration
  `);
  assert.deepEqual(result.rows[0], {
    database_role: "postgres",
    database_name: "postgres",
    can_create_public: true,
    can_record_migration: true,
  }, "production database role or privilege identity differs from the reviewed contract");
  return result.rows[0];
}

async function inspectionContract(client) {
  const [fn, functionAcl, trigger, compatibility] = await Promise.all([
    client.query(`
      select p.prosecdef as security_definer,
             p.proconfig as configuration,
             pg_get_userbyid(p.proowner) as object_owner,
             obj_description(p.oid,'pg_proc') as comment
        from pg_proc p
       where p.oid=to_regprocedure($1)
    `, [FUNCTION_SIGNATURE]),
    client.query(`
      select coalesce(grantee.rolname,'PUBLIC') as grantee,
             x.privilege_type,
             x.is_grantable,
             coalesce(grantor.rolname,'PUBLIC') as grantor
        from pg_proc p
        cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x
        left join pg_roles grantee on grantee.oid=x.grantee
        left join pg_roles grantor on grantor.oid=x.grantor
       where p.oid=to_regprocedure($1)
       order by grantee,x.privilege_type,grantor
    `, [FUNCTION_SIGNATURE]),
    client.query(`
      select t.tgenabled as enabled,pg_get_triggerdef(t.oid,true) as definition
        from pg_trigger t
        join pg_class c on c.oid=t.tgrelid
        join pg_namespace n on n.oid=c.relnamespace
       where n.nspname='public' and c.relname='cleaning_inspections'
         and t.tgname='trg_cleaning_inspections_set_snapshot' and not t.tgisinternal
    `),
    client.query(`
      with completion as (
        select s.id,s.status,s.ended_at,max(cr.submitted_at) as completion_submitted_at
          from public.sessions s
          left join public.completion_responses cr on cr.session_id=s.id
         group by s.id,s.status,s.ended_at
      )
      select
        (select count(*)::integer from completion
          where status in ('pending_submit','closed')
            and coalesce(ended_at,completion_submitted_at) is null) as finished_without_completion,
        (select count(*)::integer
           from public.cleaning_inspections ci
           join completion c on c.id=ci.session_id
          where coalesce(c.ended_at,c.completion_submitted_at) is null
             or ci.inspected_at<coalesce(c.ended_at,c.completion_submitted_at)
             or ci.inspected_at>coalesce(c.ended_at,c.completion_submitted_at)+interval '24 hours') as incompatible_inspections
    `),
  ]);
  assert.equal(fn.rowCount, 1, "inspection snapshot function is missing");
  assert.equal(trigger.rowCount, 1, "inspection snapshot trigger is missing");
  assert.equal(trigger.rows[0].enabled, "O", "inspection snapshot trigger is not enabled normally");
  assert.match(trigger.rows[0].definition, INSPECTION_TRIGGER_DEFINITION_PATTERN);
  assert.deepEqual(functionAcl.rows, EXPECTED_FUNCTION_ACL,
    "inspection snapshot function ACL differs from the reviewed contract");
  assert.equal(compatibility.rows[0].finished_without_completion, 0,
    "finished sessions without completion evidence must be repaired before migration");
  assert.equal(compatibility.rows[0].incompatible_inspections, 0,
    "existing inspections violate the 24-hour completion contract");
  return {
    function: fn.rows[0],
    function_acl: functionAcl.rows,
    trigger: trigger.rows[0],
    compatibility: compatibility.rows[0],
  };
}

async function assertBeforeState(client) {
  const [physical, ledger, contract] = await Promise.all([
    physicalState(client),
    ledgerState(client),
    inspectionContract(client),
  ]);
  assert.equal(physical.fingerprint, INSPECTION_FRESHNESS_MIGRATION.from_fingerprint,
    "production physical catalog is not the reviewed c674 source state");
  assert.equal(ledger.migration_count, INSPECTION_FRESHNESS_MIGRATION.before_ledger_count,
    "production migration ledger cardinality changed");
  assert.equal(ledger.max_version, INSPECTION_FRESHNESS_MIGRATION.before_ledger_max_version,
    "production migration ledger tip changed");
  assert.equal(ledger.base_ledger_sha256, INSPECTION_FRESHNESS_MIGRATION.base_ledger_sha256,
    "production migration ledger contents changed");
  assert.equal(ledger.target_conflicts, 0, "target migration version or name is already present");
  return { physical, ledger, contract };
}

async function assertAfterState(client, migrationSql, createdBy) {
  const [physical, ledger, targetLedger, contract] = await Promise.all([
    physicalState(client),
    ledgerState(client),
    client.query(`
      select version,name,statements,created_by,idempotency_key,rollback
        from supabase_migrations.schema_migrations
       where version=$1 or name=$2
       order by version
    `, [INSPECTION_FRESHNESS_MIGRATION.version, INSPECTION_FRESHNESS_MIGRATION.name]),
    inspectionContract(client),
  ]);
  assert.equal(physical.fingerprint, INSPECTION_FRESHNESS_MIGRATION.to_fingerprint,
    "post-migration physical catalog is not the reviewed 333ddfc8 target state");
  assert.equal(ledger.migration_count, INSPECTION_FRESHNESS_MIGRATION.after_ledger_count,
    "post-migration ledger must contain exactly one additional row");
  assert.equal(ledger.max_version, INSPECTION_FRESHNESS_MIGRATION.version,
    "post-migration ledger tip is not the reviewed version");
  assert.equal(ledger.target_conflicts, 1, "post-migration ledger target is not unique");
  assert.equal(ledger.base_ledger_sha256, INSPECTION_FRESHNESS_MIGRATION.base_ledger_sha256,
    "pre-existing production migration ledger contents changed");
  assert.equal(targetLedger.rowCount, 1, "target ledger row must be unique by version and name");
  assert.deepEqual(targetLedger.rows[0], {
    version: INSPECTION_FRESHNESS_MIGRATION.version,
    name: INSPECTION_FRESHNESS_MIGRATION.name,
    statements: [migrationSql],
    created_by: createdBy,
    idempotency_key: null,
    rollback: null,
  }, "target migration ledger evidence differs from the reviewed SQL and workflow identity");
  assert.deepEqual(contract.function, {
    security_definer: true,
    configuration: ["search_path=pg_catalog, public"],
    object_owner: "postgres",
    comment: "Assigns immutable server timestamps, binds inspections to completed session facts, and rejects evidence recorded more than 24 elapsed hours after completion.",
  }, "inspection snapshot function metadata differs from the reviewed target");
  return { physical, ledger, contract };
}

function workflowIdentity() {
  const repository = String(process.env.GITHUB_REPOSITORY || "").trim();
  const sha = String(process.env.GITHUB_SHA || "").trim();
  assert.match(repository, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, "GITHUB_REPOSITORY is required");
  assert.match(sha, /^[0-9a-f]{40}$/, "GITHUB_SHA is required");
  return {
    repository,
    sha,
    createdBy: `github-actions:${repository}@${sha}`,
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
  const identity = workflowIdentity();
  if (mode === "apply") {
    assert.equal(process.env.PRODUCTION_SCHEMA_INSPECTION_FRESHNESS_APPLY,
      INSPECTION_FRESHNESS_MIGRATION.version,
      "apply mode requires the exact inspection-freshness confirmation environment value");
  }
  const client = new Client({
    connectionString: database.connectionString,
    ssl: database.ssl,
    application_name: `memphis-zoo-inspection-freshness-${mode}`,
  });
  const evidence = {
    ok: false,
    mode,
    generated_at: new Date().toISOString(),
    database_connection: database.safeIdentity,
    workflow: identity,
    migration: {
      path: basename(migration.path),
      version: INSPECTION_FRESHNESS_MIGRATION.version,
      name: INSPECTION_FRESHNESS_MIGRATION.name,
      sha256: INSPECTION_FRESHNESS_MIGRATION.sha256,
      bytes: INSPECTION_FRESHNESS_MIGRATION.bytes,
      migration_count: migration.migration_count,
      from_fingerprint: INSPECTION_FRESHNESS_MIGRATION.from_fingerprint,
      to_fingerprint: INSPECTION_FRESHNESS_MIGRATION.to_fingerprint,
    },
  };

  await client.connect();
  try {
    if (mode === "apply") {
      await client.query("begin isolation level serializable");
      await client.query("set local lock_timeout='5s'");
      await client.query("set local statement_timeout='120s'");
      await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [ADVISORY_LOCK]);
      evidence.database_identity = await assertDatabaseIdentity(client);
      evidence.before = await assertBeforeState(client);
      await client.query(migration.body);
      await client.query(`
        insert into supabase_migrations.schema_migrations(
          version,statements,name,created_by,idempotency_key,rollback
        ) values($1,$2::text[],$3,$4,null,null)
      `, [
        INSPECTION_FRESHNESS_MIGRATION.version,
        [migration.migrationSql],
        INSPECTION_FRESHNESS_MIGRATION.name,
        identity.createdBy,
      ]);
      evidence.after = await assertAfterState(client, migration.migrationSql, identity.createdBy);
      await client.query("commit");
      evidence.applied = true;
    } else {
      await client.query("begin isolation level repeatable read read only");
      evidence.database_identity = await assertDatabaseIdentity(client);
      if (mode === "preflight") {
        evidence.before = await assertBeforeState(client);
        evidence.ready_to_apply = true;
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
      migration_sha256: INSPECTION_FRESHNESS_MIGRATION.sha256,
      from_fingerprint: INSPECTION_FRESHNESS_MIGRATION.from_fingerprint,
      to_fingerprint: INSPECTION_FRESHNESS_MIGRATION.to_fingerprint,
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
if (import.meta.url === invokedPath) await run();
