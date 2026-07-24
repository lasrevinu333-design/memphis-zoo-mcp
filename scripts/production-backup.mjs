#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { execFile } from "node:child_process";
import { join, relative, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const projectRef = String(process.env.SUPABASE_PROJECT_REF || "").trim();
const secret = String(process.env.SUPABASE_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const databaseUrl = String(process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || "").trim();
const backupDir = resolve(String(process.env.BACKUP_DIR || "").trim());
const sourceDir = process.env.BACKUP_SOURCE_DIR ? resolve(String(process.env.BACKUP_SOURCE_DIR).trim()) : "";
const includeData = String(process.env.INCLUDE_DATA || "true").toLowerCase() !== "false";
const includeStorage = String(process.env.INCLUDE_STORAGE || "true").toLowerCase() !== "false";

if (!sourceDir && (!projectRef || !/^[a-z0-9]{20}$/.test(projectRef))) {
  throw new Error("SUPABASE_PROJECT_REF must be the 20-character project reference.");
}
if (!sourceDir && !secret) throw new Error("SUPABASE_SECRET is required.");
if (!sourceDir && includeData && !databaseUrl) {
  throw new Error("SUPABASE_DB_URL is required for a transactionally consistent data backup.");
}
if (!process.env.BACKUP_DIR) throw new Error("BACKUP_DIR is required.");

const baseUrl = `https://${projectRef}.supabase.co`;
const rpcUrl = `${baseUrl}/rest/v1/rpc/run_sql_readonly`;
const startedAt = new Date().toISOString();
const replaySourceSummary = sourceDir
  ? JSON.parse(readFileSync(join(sourceDir, "backup-summary.json"), "utf8"))
  : null;

mkdirSync(backupDir, { recursive: true, mode: 0o700 });
mkdirSync(join(backupDir, "inventory"), { recursive: true, mode: 0o700 });
mkdirSync(join(backupDir, "data"), { recursive: true, mode: 0o700 });
mkdirSync(join(backupDir, "storage", "objects"), { recursive: true, mode: 0o700 });

function stableJson(value) {
  if (Array.isArray(value)) return value.map(stableJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableJson(value[key])]),
    );
  }
  return value;
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(stableJson(value), null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function quoteLiteral(value) {
  if (value == null) return "NULL";
  return `'${String(value).replaceAll("'", "''")}'`;
}

function qualified(schema, name) {
  return `${quoteIdentifier(schema)}.${quoteIdentifier(name)}`;
}

async function rpc(sql) {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: {
      apikey: secret,
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ p_sql: String(sql).trim() }),
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`run_sql_readonly failed (${response.status}): ${body.slice(0, 500)}`);
  }
  const parsed = JSON.parse(body);
  if (!Array.isArray(parsed)) throw new Error("run_sql_readonly returned a non-array response.");
  return parsed;
}

const queries = {
  database: `
    select current_database() as database_name,
           current_setting('server_version') as server_version,
           current_setting('TimeZone') as timezone,
           now() as captured_at
  `,
  schemas: `
    select n.nspname as schema_name,
           pg_get_userbyid(n.nspowner) as owner
    from pg_namespace n
    where n.nspname in ('public','auth','storage','cron','extensions','supabase_migrations')
    order by n.nspname
  `,
  extensions: `
    select e.extname as extension_name,
           e.extversion as version,
           n.nspname as schema_name
    from pg_extension e
    join pg_namespace n on n.oid = e.extnamespace
    order by e.extname
  `,
  types: `
    select n.nspname as schema_name,
           t.typname as type_name,
           t.typtype as type_kind,
           format_type(t.typbasetype, t.typtypmod) as base_type,
           t.typnotnull as not_null,
           pg_get_expr(t.typdefaultbin, 0) as default_expression,
           coalesce(
             (select jsonb_agg(e.enumlabel order by e.enumsortorder)
              from pg_enum e where e.enumtypid = t.oid),
             '[]'::jsonb
           ) as enum_labels
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typtype in ('e','d')
    order by t.typname
  `,
  sequences: `
    select schemaname as schema_name,
           sequencename as sequence_name,
           data_type,
           start_value,
           min_value,
           max_value,
           increment_by,
           cycle,
           cache_size
    from pg_sequences
    where schemaname = 'public'
    order by sequencename
  `,
  tables: `
    select n.nspname as schema_name,
           c.relname as table_name,
           c.relkind as relation_kind,
           c.relrowsecurity as rls_enabled,
           c.relforcerowsecurity as rls_forced,
           pg_get_partkeydef(c.oid) as partition_key,
           obj_description(c.oid, 'pg_class') as comment
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r','p')
    order by c.relname
  `,
  columns: `
    select n.nspname as schema_name,
           c.relname as table_name,
           a.attnum as ordinal_position,
           a.attname as column_name,
           format_type(a.atttypid, a.atttypmod) as data_type,
           a.attnotnull as not_null,
           a.attidentity as identity_kind,
           a.attgenerated as generated_kind,
           pg_get_expr(ad.adbin, ad.adrelid) as default_expression,
           case when a.attcollation <> t.typcollation then coll.collname else null end as collation_name,
           col_description(c.oid, a.attnum) as comment
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_type t on t.oid = a.atttypid
    left join pg_attrdef ad on ad.adrelid = a.attrelid and ad.adnum = a.attnum
    left join pg_collation coll on coll.oid = a.attcollation
    where n.nspname = 'public'
      and c.relkind in ('r','p')
      and a.attnum > 0
      and not a.attisdropped
    order by c.relname, a.attnum
  `,
  constraints: `
    select n.nspname as schema_name,
           c.relname as table_name,
           con.conname as constraint_name,
           con.contype as constraint_type,
           pg_get_constraintdef(con.oid, true) as definition,
           con.convalidated as validated
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
    order by c.relname, con.conname
  `,
  indexes: `
    select n.nspname as schema_name,
           c.relname as table_name,
           i.relname as index_name,
           pg_get_indexdef(ix.indexrelid) as definition,
           ix.indisunique as is_unique,
           ix.indisprimary as is_primary,
           exists(select 1 from pg_constraint con where con.conindid = ix.indexrelid) as backs_constraint
    from pg_index ix
    join pg_class c on c.oid = ix.indrelid
    join pg_class i on i.oid = ix.indexrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
    order by c.relname, i.relname
  `,
  functions: `
    select n.nspname as schema_name,
           p.proname as function_name,
           pg_get_function_identity_arguments(p.oid) as identity_arguments,
           pg_get_functiondef(p.oid) as definition,
           obj_description(p.oid, 'pg_proc') as comment
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
    order by p.proname, pg_get_function_identity_arguments(p.oid)
  `,
  views: `
    select n.nspname as schema_name,
           c.relname as view_name,
           c.relkind as relation_kind,
           pg_get_viewdef(c.oid, true) as definition,
           obj_description(c.oid, 'pg_class') as comment
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('v','m')
    order by c.relname
  `,
  view_dependencies: `
    select distinct dependent.relname as view_name,
           referenced.relname as depends_on
    from pg_rewrite rw
    join pg_class dependent on dependent.oid = rw.ev_class
    join pg_namespace dn on dn.oid = dependent.relnamespace
    join pg_depend dep on dep.objid = rw.oid
    join pg_class referenced on referenced.oid = dep.refobjid
    join pg_namespace rn on rn.oid = referenced.relnamespace
    where dn.nspname = 'public'
      and rn.nspname = 'public'
      and dependent.relkind in ('v','m')
      and referenced.relkind in ('v','m')
      and dependent.oid <> referenced.oid
    order by dependent.relname, referenced.relname
  `,
  triggers: `
    select n.nspname as schema_name,
           c.relname as table_name,
           t.tgname as trigger_name,
           pg_get_triggerdef(t.oid, true) as definition,
           t.tgenabled as enabled
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and not t.tgisinternal
    order by c.relname, t.tgname
  `,
  policies: `
    select n.nspname as schema_name,
           c.relname as table_name,
           p.polname as policy_name,
           p.polpermissive as permissive,
           p.polcmd as command_code,
           coalesce((select jsonb_agg(r.rolname order by r.rolname)
                     from unnest(p.polroles) role_oid
                     join pg_roles r on r.oid = role_oid), '[]'::jsonb) as roles,
           pg_get_expr(p.polqual, p.polrelid) as using_expression,
           pg_get_expr(p.polwithcheck, p.polrelid) as check_expression
    from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
    order by c.relname, p.polname
  `,
  table_grants: `
    select table_schema as schema_name,
           table_name,
           grantee,
           privilege_type,
           is_grantable
    from information_schema.role_table_grants
    where table_schema = 'public'
    order by table_name, grantee, privilege_type
  `,
  routine_grants: `
    select n.nspname as schema_name,
           p.proname as function_name,
           pg_get_function_identity_arguments(p.oid) as identity_arguments,
           coalesce(r.rolname, 'PUBLIC') as grantee,
           x.privilege_type,
           x.is_grantable
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
    left join pg_roles r on r.oid = x.grantee
    where n.nspname = 'public'
    order by p.proname, pg_get_function_identity_arguments(p.oid), grantee
  `,
  cron_jobs: `
    select jobname, schedule, command, database, username, active
    from cron.job
    order by jobname
  `,
  supabase_migrations: `
    select version, name, statements
    from supabase_migrations.schema_migrations
    order by version
  `,
  application_migrations: `
    select * from public.migration_log order by applied_at, id
  `,
};

const inventory = {};
for (const [name, sql] of Object.entries(queries)) {
  if (sourceDir) {
    console.error(`[backup] replay inventory ${name}`);
    inventory[name] = JSON.parse(readFileSync(join(sourceDir, "inventory", `${name}.json`), "utf8"));
  } else {
    console.error(`[backup] inventory ${name}`);
    try {
      inventory[name] = await rpc(sql);
    } catch (error) {
      if (["cron_jobs", "supabase_migrations", "application_migrations"].includes(name)) {
        inventory[name] = { unavailable: true, error: error.message };
      } else {
        throw error;
      }
    }
  }
  writeJson(join(backupDir, "inventory", `${name}.json`), inventory[name]);
}

function orderViews(views, dependencies) {
  const names = new Set(views.map((view) => view.view_name));
  const remaining = new Map([...names].map((name) => [name, new Set()]));
  for (const edge of dependencies) {
    if (names.has(edge.view_name) && names.has(edge.depends_on)) {
      remaining.get(edge.view_name).add(edge.depends_on);
    }
  }
  const result = [];
  while (remaining.size) {
    const ready = [...remaining.entries()]
      .filter(([, deps]) => [...deps].every((dep) => !remaining.has(dep)))
      .map(([name]) => name)
      .sort();
    if (!ready.length) {
      result.push(...[...remaining.keys()].sort());
      break;
    }
    for (const name of ready) {
      result.push(name);
      remaining.delete(name);
    }
  }
  return result.map((name) => views.find((view) => view.view_name === name));
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function orderFunctions(functions) {
  const byKey = new Map(
    functions.map((fn) => [`${fn.function_name}(${fn.identity_arguments})`, fn]),
  );
  const functionNames = [...new Set(functions.map((fn) => fn.function_name))].sort();
  const dependencies = new Map([...byKey.keys()].map((key) => [key, new Set()]));

  for (const [key, fn] of byKey.entries()) {
    const text = String(fn.definition || "");
    for (const name of functionNames) {
      if (name === fn.function_name) continue;
      const escaped = escapeRegExp(name);
      const qualified = new RegExp(`\\bpublic\\s*\\.\\s*${escaped}\\s*\\(`, "i");
      const unqualified = new RegExp(`(^|[^\\.\\w])${escaped}\\s*\\(`, "i");
      if (!qualified.test(text) && !unqualified.test(text)) continue;
      for (const [candidateKey, candidate] of byKey.entries()) {
        if (candidate.function_name === name) dependencies.get(key).add(candidateKey);
      }
    }
  }

  const remaining = new Map(
    [...dependencies.entries()].map(([key, deps]) => [key, new Set(deps)]),
  );
  const result = [];

  while (remaining.size) {
    const ready = [...remaining.entries()]
      .filter(([, deps]) => [...deps].every((dep) => !remaining.has(dep)))
      .map(([key]) => key)
      .sort();
    if (!ready.length) {
      result.push(...[...remaining.keys()].sort());
      break;
    }
    for (const key of ready) {
      result.push(key);
      remaining.delete(key);
    }
  }

  return result.map((key) => byKey.get(key));
}

function buildBaselineSql(data) {
  const lines = [
    "-- Sanitized schema-only baseline captured from the deployed Memphis Zoo database.",
    `-- Captured at ${startedAt}. Contains no table data or credential values.`,
    "begin;",
    "set local check_function_bodies = off;",
    "set local client_min_messages = warning;",
    "create schema if not exists public;",
  ];

  for (const extension of data.extensions) {
    if (extension.extension_name === "plpgsql") continue;
    lines.push(
      `create extension if not exists ${quoteIdentifier(extension.extension_name)} with schema ${quoteIdentifier(extension.schema_name)};`,
    );
  }

  for (const type of data.types) {
    const target = qualified(type.schema_name, type.type_name);
    if (type.type_kind === "e") {
      const labels = (type.enum_labels || []).map(quoteLiteral).join(", ");
      lines.push(`create type ${target} as enum (${labels});`);
    } else if (type.type_kind === "d") {
      let ddl = `create domain ${target} as ${type.base_type}`;
      if (type.default_expression) ddl += ` default ${type.default_expression}`;
      if (type.not_null) ddl += " not null";
      lines.push(`${ddl};`);
    }
  }

  for (const sequence of data.sequences) {
    lines.push(
      [
        `create sequence ${qualified(sequence.schema_name, sequence.sequence_name)}`,
        `as ${sequence.data_type}`,
        `increment by ${sequence.increment_by}`,
        `minvalue ${sequence.min_value}`,
        `maxvalue ${sequence.max_value}`,
        `start with ${sequence.start_value}`,
        `cache ${sequence.cache_size}`,
        sequence.cycle ? "cycle" : "no cycle",
        ";",
      ].join(" "),
    );
  }

  const columnsByTable = Map.groupBy(data.columns, (column) => column.table_name);
  for (const table of data.tables) {
    const columnSql = (columnsByTable.get(table.table_name) || []).map((column) => {
      let ddl = `  ${quoteIdentifier(column.column_name)} ${column.data_type}`;
      if (column.collation_name) ddl += ` collate ${quoteIdentifier(column.collation_name)}`;
      if (column.generated_kind === "s") {
        ddl += ` generated always as (${column.default_expression}) stored`;
      } else if (column.identity_kind) {
        ddl += column.identity_kind === "a" ? " generated always as identity" : " generated by default as identity";
      } else if (column.default_expression) {
        ddl += ` default ${column.default_expression}`;
      }
      if (column.not_null) ddl += " not null";
      return ddl;
    });
    let ddl = `create table ${qualified(table.schema_name, table.table_name)} (\n${columnSql.join(",\n")}\n)`;
    if (table.partition_key) ddl += ` partition by ${table.partition_key}`;
    lines.push(`${ddl};`);
  }

  // PostgreSQL requires every referenced primary/unique key to exist before a
  // foreign key can be created.  Catalog order is alphabetical by table, so a
  // single undifferentiated constraint pass is not rebuildable when an early
  // table references a later one.  Install key constraints first, then the
  // functions used by expression/check constraints, and foreign keys last.
  for (const constraint of data.constraints.filter((item) => ["p", "u", "x"].includes(item.constraint_type))) {
    lines.push(
      `alter table only ${qualified(constraint.schema_name, constraint.table_name)} add constraint ${quoteIdentifier(constraint.constraint_name)} ${constraint.definition};`,
    );
  }

  for (const index of data.indexes.filter((item) => !item.backs_constraint)) {
    lines.push(`${index.definition};`);
  }

  for (const fn of orderFunctions(data.functions)) lines.push(fn.definition.trim().replace(/;?$/, ";"));

  for (const constraint of data.constraints.filter((item) => !["p", "u", "x", "f"].includes(item.constraint_type))) {
    lines.push(
      `alter table only ${qualified(constraint.schema_name, constraint.table_name)} add constraint ${quoteIdentifier(constraint.constraint_name)} ${constraint.definition};`,
    );
  }

  for (const constraint of data.constraints.filter((item) => item.constraint_type === "f")) {
    lines.push(
      `alter table only ${qualified(constraint.schema_name, constraint.table_name)} add constraint ${quoteIdentifier(constraint.constraint_name)} ${constraint.definition};`,
    );
  }

  for (const view of orderViews(data.views, data.view_dependencies)) {
    const target = qualified(view.schema_name, view.view_name);
    if (view.relation_kind === "m") lines.push(`create materialized view ${target} as\n${view.definition};`);
    else lines.push(`create view ${target} as\n${view.definition};`);
  }

  for (const trigger of data.triggers) lines.push(`${trigger.definition};`);

  for (const policy of data.policies) {
    const command = { r: "select", a: "insert", w: "update", d: "delete", "*": "all" }[policy.command_code] || "all";
    const roles = (policy.roles || []).length ? policy.roles.map(quoteIdentifier).join(", ") : "public";
    let ddl = `create policy ${quoteIdentifier(policy.policy_name)} on ${qualified(policy.schema_name, policy.table_name)}`;
    ddl += policy.permissive ? " as permissive" : " as restrictive";
    ddl += ` for ${command} to ${roles}`;
    if (policy.using_expression) ddl += ` using (${policy.using_expression})`;
    if (policy.check_expression) ddl += ` with check (${policy.check_expression})`;
    lines.push(`${ddl};`);
  }

  for (const table of data.tables) {
    const target = qualified(table.schema_name, table.table_name);
    if (table.rls_enabled) lines.push(`alter table ${target} enable row level security;`);
    if (table.rls_forced) lines.push(`alter table ${target} force row level security;`);
  }

  const tableGrantGroups = Map.groupBy(data.table_grants, (grant) => `${grant.schema_name}.${grant.table_name}.${grant.grantee}`);
  for (const grants of tableGrantGroups.values()) {
    const first = grants[0];
    const privileges = grants.map((grant) => grant.privilege_type.toLowerCase()).sort().join(", ");
    const grantee = first.grantee === "PUBLIC" ? "public" : quoteIdentifier(first.grantee);
    lines.push(`grant ${privileges} on table ${qualified(first.schema_name, first.table_name)} to ${grantee};`);
  }

  const routineGrantGroups = Map.groupBy(
    data.routine_grants,
    (grant) => `${grant.schema_name}.${grant.function_name}(${grant.identity_arguments}).${grant.grantee}`,
  );
  for (const grants of routineGrantGroups.values()) {
    const first = grants[0];
    const grantee = first.grantee === "PUBLIC" ? "public" : quoteIdentifier(first.grantee);
    lines.push(
      `grant execute on function ${qualified(first.schema_name, first.function_name)}(${first.identity_arguments}) to ${grantee};`,
    );
  }

  for (const table of data.tables.filter((item) => item.comment)) {
    lines.push(`comment on table ${qualified(table.schema_name, table.table_name)} is ${quoteLiteral(table.comment)};`);
  }
  for (const column of data.columns.filter((item) => item.comment)) {
    lines.push(
      `comment on column ${qualified(column.schema_name, column.table_name)}.${quoteIdentifier(column.column_name)} is ${quoteLiteral(column.comment)};`,
    );
  }
  for (const fn of data.functions.filter((item) => item.comment)) {
    lines.push(
      `comment on function ${qualified(fn.schema_name, fn.function_name)}(${fn.identity_arguments}) is ${quoteLiteral(fn.comment)};`,
    );
  }

  lines.push("commit;", "");
  return lines.join("\n\n");
}

const fingerprintInput = {
  extensions: inventory.extensions,
  types: inventory.types,
  sequences: inventory.sequences,
  tables: inventory.tables,
  columns: inventory.columns,
  constraints: inventory.constraints,
  indexes: inventory.indexes,
  functions: inventory.functions,
  views: inventory.views,
  triggers: inventory.triggers,
  policies: inventory.policies,
  table_grants: inventory.table_grants,
  routine_grants: inventory.routine_grants,
  cron_jobs: inventory.cron_jobs,
};
const fingerprintJson = JSON.stringify(stableJson(fingerprintInput));
const fingerprint = createHash("sha256").update(fingerprintJson).digest("hex");
const baselineSql = buildBaselineSql(inventory);
writeFileSync(join(backupDir, "schema.sql"), baselineSql, { mode: 0o600 });
writeFileSync(join(backupDir, "schema-fingerprint.txt"), `${fingerprint}\n`, { mode: 0o600 });
writeJson(join(backupDir, "schema-fingerprint-input.json"), fingerprintInput);

const databaseDumpPath = join(backupDir, "data", "public-database.dump");
if (includeData) {
  if (sourceDir) {
    const sourceDump = join(sourceDir, "data", "public-database.dump");
    if (!statSync(sourceDump).isFile()) throw new Error("Replay backup is missing data/public-database.dump.");
    copyFileSync(sourceDump, databaseDumpPath);
  } else {
    console.error("[backup] transactionally consistent public database snapshot");
    await execFileAsync(
      "pg_dump",
      [
        "--format=custom",
        "--compress=9",
        "--no-owner",
        "--no-privileges",
        "--schema=public",
        "--serializable-deferrable",
        `--file=${databaseDumpPath}`,
      ],
      {
        env: { ...process.env, PGDATABASE: databaseUrl },
        maxBuffer: 8 * 1024 * 1024,
      },
    );
  }
  chmodSync(databaseDumpPath, 0o600);
}

function storageMetadataFingerprint(rows) {
  return createHash("sha256")
    .update(JSON.stringify(stableJson(rows.map((row) => ({
      id: row.id,
      bucket_id: row.bucket_id,
      name: row.name,
      created_at: row.created_at,
      updated_at: row.updated_at,
      metadata: row.metadata,
      user_metadata: row.user_metadata,
    })))))
    .digest("hex");
}

async function listStorageMetadata() {
  return rpc(`
    select o.id, o.bucket_id, o.name, o.created_at, o.updated_at,
           o.last_accessed_at, o.metadata, o.user_metadata
    from storage.objects o
    order by o.bucket_id, o.name, o.id
  `);
}

async function listStorageBuckets() {
  const rows = await rpc("select to_jsonb(b) as bucket from storage.buckets b order by b.id");
  return rows.map((row) => row.bucket);
}

function storageObjectUrl(bucket, name) {
  const bucketPath = encodeURIComponent(String(bucket));
  const objectPath = String(name).split("/").map((part) => encodeURIComponent(part)).join("/");
  return `${baseUrl}/storage/v1/object/authenticated/${bucketPath}/${objectPath}`;
}

let storageObjects = [];
let storageBuckets = [];
let storageBytes = 0;
let storageMetadataHash = null;
if (includeStorage) {
  if (sourceDir) {
    storageObjects = JSON.parse(readFileSync(join(sourceDir, "storage-object-manifest.json"), "utf8"));
    storageBuckets = JSON.parse(readFileSync(join(sourceDir, "storage-bucket-manifest.json"), "utf8"));
    for (const item of storageObjects) {
      const sourceObject = join(sourceDir, "storage", "objects", item.archive_name);
      const destinationObject = join(backupDir, "storage", "objects", item.archive_name);
      copyFileSync(sourceObject, destinationObject);
      chmodSync(destinationObject, 0o600);
      const bytes = readFileSync(destinationObject);
      const hash = createHash("sha256").update(bytes).digest("hex");
      if (hash !== item.sha256 || bytes.length !== Number(item.bytes)) {
        throw new Error(`Replay Storage object failed integrity verification: ${item.bucket_id}/${item.name}`);
      }
      storageBytes += bytes.length;
    }
    storageMetadataHash = String(replaySourceSummary?.storage_metadata_sha256 || "") || null;
  } else {
    console.error("[backup] private and public Storage objects");
    storageBuckets = await listStorageBuckets();
    const metadataBefore = await listStorageMetadata();
    storageMetadataHash = storageMetadataFingerprint(metadataBefore);
    for (const row of metadataBefore) {
      const response = await fetch(storageObjectUrl(row.bucket_id, row.name), {
        headers: { apikey: secret, Authorization: `Bearer ${secret}` },
      });
      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Storage backup failed for ${row.bucket_id}/${row.name} (${response.status}): ${body.slice(0, 300)}`);
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const archiveName = `${createHash("sha256").update(`${row.bucket_id}\0${row.name}`).digest("hex")}.object`;
      const outputPath = join(backupDir, "storage", "objects", archiveName);
      writeFileSync(outputPath, bytes, { mode: 0o600 });
      chmodSync(outputPath, 0o600);
      const expectedSize = Number(row.metadata?.size);
      if (Number.isFinite(expectedSize) && expectedSize >= 0 && expectedSize !== bytes.length) {
        throw new Error(`Storage object size changed during backup: ${row.bucket_id}/${row.name}`);
      }
      storageObjects.push({
        id: row.id,
        bucket_id: row.bucket_id,
        name: row.name,
        created_at: row.created_at,
        updated_at: row.updated_at,
        metadata: row.metadata,
        user_metadata: row.user_metadata,
        archive_name: archiveName,
        bytes: bytes.length,
        sha256,
      });
      storageBytes += bytes.length;
    }
    const metadataAfter = await listStorageMetadata();
    const bucketsAfter = await listStorageBuckets();
    if (
      storageMetadataFingerprint(metadataAfter) !== storageMetadataHash
      || JSON.stringify(stableJson(bucketsAfter)) !== JSON.stringify(stableJson(storageBuckets))
    ) {
      throw new Error("storage_metadata_changed_during_backup");
    }
  }
}
writeJson(join(backupDir, "storage-object-manifest.json"), storageObjects);
writeJson(join(backupDir, "storage-bucket-manifest.json"), storageBuckets);

function walkFiles(directory) {
  const result = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...walkFiles(path));
    else if (entry.isFile() && entry.name !== "SHA256SUMS") result.push(path);
  }
  return result.sort();
}

const manifestLines = [];
for (const path of walkFiles(backupDir)) {
  const hash = createHash("sha256").update(readFileSync(path)).digest("hex");
  manifestLines.push(`${hash}  ${relative(backupDir, path)}`);
}
writeFileSync(join(backupDir, "SHA256SUMS"), `${manifestLines.join("\n")}\n`, { mode: 0o600 });

const summary = {
  ok: true,
  started_at: startedAt,
  completed_at: new Date().toISOString(),
  backup_directory: backupDir,
  source_project_ref: sourceDir ? (replaySourceSummary?.source_project_ref || null) : projectRef,
  schema_fingerprint: fingerprint,
  table_count: inventory.tables.length,
  view_count: inventory.views.length,
  function_count: inventory.functions.length,
  policy_count: inventory.policies.length,
  trigger_count: inventory.triggers.length,
  data_backup_included: includeData,
  database_snapshot_format: includeData ? "pg_dump-custom-serializable-deferrable" : null,
  database_snapshot_file: includeData ? "data/public-database.dump" : null,
  storage_backup_included: includeStorage,
  storage_object_count: storageObjects.length,
  storage_bucket_count: storageBuckets.length,
  storage_bytes: storageBytes,
  storage_metadata_sha256: storageMetadataHash,
  storage_consistency_verified: includeStorage,
  backup_bytes: walkFiles(backupDir).reduce((total, path) => total + statSync(path).size, 0),
};
writeJson(join(backupDir, "backup-summary.json"), summary);

// Refresh hashes after writing the summary.
const finalManifest = [];
for (const path of walkFiles(backupDir)) {
  const hash = createHash("sha256").update(readFileSync(path)).digest("hex");
  finalManifest.push(`${hash}  ${relative(backupDir, path)}`);
}
writeFileSync(join(backupDir, "SHA256SUMS"), `${finalManifest.join("\n")}\n`, { mode: 0o600 });

console.log(JSON.stringify(summary, null, 2));
