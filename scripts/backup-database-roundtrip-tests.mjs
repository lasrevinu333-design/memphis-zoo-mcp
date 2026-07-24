#!/usr/bin/env node

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const container = String(process.env.BACKUP_RESTORE_TEST_DOCKER_CONTAINER || "").trim();
const sourceDatabase = String(process.env.BACKUP_RESTORE_TEST_DATABASE || "postgres").trim();

if (!/^mz_schema_rebuild_[a-zA-Z0-9_]+$/.test(container)) {
  throw new Error("BACKUP_RESTORE_TEST_DOCKER_CONTAINER must be a disposable schema-rebuild container.");
}
if (!/^(postgres|mz_schema_rebuild_[a-zA-Z0-9_]+)$/.test(sourceDatabase)) {
  throw new Error("BACKUP_RESTORE_TEST_DATABASE must be a disposable schema-rebuild database.");
}

const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
const targetDatabase = `mz_backup_restore_${suffix}`;
const dumpPath = `/tmp/${targetDatabase}.dump`;
const user = "supabase_admin";

async function docker(args, options = {}) {
  return execFileAsync("docker", args, { maxBuffer: 32 * 1024 * 1024, ...options });
}

async function psql(database, statement) {
  const { stdout } = await docker([
    "exec",
    container,
    "psql",
    "-v",
    "ON_ERROR_STOP=1",
    "-At",
    "-U",
    user,
    "-d",
    database,
    "-c",
    statement,
  ]);
  return stdout.trim();
}

try {
  await psql(sourceDatabase, `
    create table if not exists public.backup_restore_probe (
      id integer primary key,
      payload text not null
    );
    truncate public.backup_restore_probe;
    insert into public.backup_restore_probe(id, payload)
    values (1, 'first private recovery row'), (2, 'second private recovery row');
  `);

  await docker([
    "exec",
    container,
    "pg_dump",
    "-U",
    user,
    "-d",
    sourceDatabase,
    "--format=custom",
    "--compress=9",
    "--no-owner",
    "--no-privileges",
    "--schema=public",
    "--serializable-deferrable",
    `--file=${dumpPath}`,
  ]);

  await psql("postgres", `create database "${targetDatabase}";`);
  await docker([
    "exec",
    container,
    "pg_restore",
    "-U",
    user,
    "-d",
    targetDatabase,
    "--clean",
    "--if-exists",
    "--no-owner",
    "--no-privileges",
    "--exit-on-error",
    dumpPath,
  ]);

  const restored = await psql(
    targetDatabase,
    "select id::text || ':' || payload from public.backup_restore_probe order by id;",
  );
  assert.equal(
    restored,
    "1:first private recovery row\n2:second private recovery row",
    "The independent restore target must contain the exact snapshot rows.",
  );

  const sourceSchemaCount = Number(await psql(
    sourceDatabase,
    "select count(*) from information_schema.tables where table_schema='public';",
  ));
  const restoredSchemaCount = Number(await psql(
    targetDatabase,
    "select count(*) from information_schema.tables where table_schema='public';",
  ));
  assert.equal(
    restoredSchemaCount,
    sourceSchemaCount,
    "The restored public schema must contain the same number of tables as the snapshot source.",
  );
} finally {
  await psql("postgres", `
    select pg_terminate_backend(pid)
    from pg_stat_activity
    where datname = '${targetDatabase}' and pid <> pg_backend_pid();
  `).catch(() => {});
  await psql("postgres", `drop database if exists "${targetDatabase}";`).catch(() => {});
  await psql(sourceDatabase, "drop table if exists public.backup_restore_probe;").catch(() => {});
  await docker(["exec", container, "rm", "-f", dumpPath]).catch(() => {});
}

console.log("BACKUP_DATABASE_ROUNDTRIP_PASS");
