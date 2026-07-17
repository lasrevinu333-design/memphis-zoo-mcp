import { randomUUID } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

const { Client } = pg;
const adminUrl = process.env.SCHEMA_REBUILD_ADMIN_URL || process.env.DATABASE_URL;
let dockerContainer = process.env.SCHEMA_REBUILD_DOCKER_CONTAINER;
const dockerImage = process.env.SCHEMA_REBUILD_DOCKER_IMAGE;
let ownsDockerContainer = false;

if (!adminUrl && !dockerContainer && !dockerImage) {
  console.error("Set SCHEMA_REBUILD_ADMIN_URL, SCHEMA_REBUILD_DOCKER_CONTAINER, or SCHEMA_REBUILD_DOCKER_IMAGE for a non-production PostgreSQL target.");
  process.exit(2);
}

if (adminUrl && !/(localhost|127\.0\.0\.1|memphis-rebuild|schema-rebuild|test|ci)/i.test(adminUrl)) {
  console.error("Refusing empty-database rebuild check against a URL that does not look local/test/CI.");
  process.exit(2);
}

const root = resolve(new URL("..", import.meta.url).pathname);
const migrationsDir = resolve(root, "supabase/migrations");
const migrationFiles = readdirSync(migrationsDir).filter((name) => name.endsWith(".sql")).sort();
const databaseName = `mz_schema_rebuild_${Date.now()}_${randomUUID().replaceAll("-", "").slice(0, 12)}`;

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function dockerPsql(database, sql) {
  const user = process.env.SCHEMA_REBUILD_DOCKER_USER || "supabase_admin";
  const result = spawnSync(
    "docker",
    ["exec", "-i", dockerContainer, "psql", "-v", "ON_ERROR_STOP=1", "-At", "-U", user, "-d", database],
    { input: sql, encoding: "utf8", maxBuffer: 1024 * 1024 * 32 },
  );
  if (result.status !== 0) {
    throw new Error(`docker psql failed (${result.status}): ${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

if (dockerImage) {
  dockerContainer = `mz_schema_rebuild_${Date.now()}_${randomUUID().replaceAll("-", "").slice(0, 8)}`;
  ownsDockerContainer = true;
  try {
    execFileSync(
      "docker",
      [
        "run",
        "-d",
        "--name",
        dockerContainer,
        "-e",
        "POSTGRES_PASSWORD=postgres",
        dockerImage,
        "-c",
        "shared_preload_libraries=pg_cron,pg_net,pg_stat_statements",
      ],
      { stdio: "ignore" },
    );
    let ready = false;
    for (let attempt = 0; attempt < 180; attempt += 1) {
      const check = spawnSync(
        "docker",
        ["exec", dockerContainer, "psql", "-At", "-U", "supabase_admin", "-d", "postgres", "-c", "select 1"],
        { encoding: "utf8" },
      );
      if (check.status === 0 && check.stdout.trim() === "1") {
        ready = true;
        break;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
    }
    if (!ready) throw new Error(`Disposable rebuild container ${dockerContainer} did not become ready.`);
    let healthy = false;
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const status = spawnSync(
        "docker",
        ["inspect", "--format", "{{if .State.Health}}{{.State.Health.Status}}{{end}}", dockerContainer],
        { encoding: "utf8" },
      ).stdout.trim();
      if (!status || status === "healthy") {
        healthy = true;
        break;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
    }
    if (!healthy) throw new Error(`Disposable rebuild container ${dockerContainer} did not become healthy.`);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10000);
  } catch (error) {
    execFileSync("docker", ["rm", "-f", dockerContainer], { stdio: "ignore" });
    throw error;
  }
}

if (dockerContainer) {
  try {
    execFileSync("docker", ["inspect", dockerContainer], { stdio: "ignore" });
    const targetDatabase = ownsDockerContainer ? "postgres" : databaseName;
    if (!ownsDockerContainer) dockerPsql("postgres", `create database ${quoteIdentifier(databaseName)};`);
    for (const file of migrationFiles) {
      const sql = readFileSync(resolve(migrationsDir, file), "utf8");
      dockerPsql(targetDatabase, sql);
      console.log(`applied ${file}`);
    }
    const counts = dockerPsql(
      targetDatabase,
      `
      select json_build_object(
        'tables', (select count(*)::int from information_schema.tables where table_schema='public' and table_type='BASE TABLE'),
        'functions', (select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'),
        'views', (select count(*)::int from information_schema.views where table_schema='public')
      )::text;
      `,
    ).trim().split("\n").find((line) => line.trim().startsWith("{"));
    console.log(JSON.stringify({ ok: true, database: targetDatabase, migrations: migrationFiles.length, counts: JSON.parse(counts) }, null, 2));
  } finally {
    try {
      if (!ownsDockerContainer) {
        dockerPsql(
          "postgres",
          `
          select pg_terminate_backend(pid)
          from pg_stat_activity
          where datname = ${quoteIdentifier(databaseName).replaceAll('"', "'")} and pid <> pg_backend_pid();
          `,
        );
        dockerPsql("postgres", `drop database if exists ${quoteIdentifier(databaseName)};`);
      }
    } catch {
      // Best-effort cleanup for local/CI disposable databases.
    } finally {
      if (ownsDockerContainer) {
        execFileSync("docker", ["rm", "-f", dockerContainer], { stdio: "ignore" });
      }
    }
  }
  process.exit(0);
}

const admin = new Client({ connectionString: adminUrl, connectionTimeoutMillis: 10000 });
let adminConnected = false;

function databaseUrlFor(dbName) {
  const url = new URL(adminUrl);
  url.pathname = `/${dbName}`;
  return String(url);
}

try {
  await admin.connect();
  adminConnected = true;
  await admin.query(`create database ${pg.escapeIdentifier(databaseName)}`);
  const db = new Client({ connectionString: databaseUrlFor(databaseName) });
  await db.connect();
  try {
    await db.query("set statement_timeout = 0");
    for (const file of migrationFiles) {
      const sql = readFileSync(resolve(migrationsDir, file), "utf8");
      await db.query(sql);
      console.log(`applied ${file}`);
    }
    const counts = await db.query(`
      select
        (select count(*)::int from information_schema.tables where table_schema='public' and table_type='BASE TABLE') as tables,
        (select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public') as functions,
        (select count(*)::int from information_schema.views where table_schema='public') as views
    `);
    console.log(JSON.stringify({ ok: true, database: databaseName, migrations: migrationFiles.length, ...counts.rows[0] }, null, 2));
  } finally {
    await db.end().catch(() => {});
  }
} finally {
  if (adminConnected) {
    await admin.query(
      `
      select pg_terminate_backend(pid)
      from pg_stat_activity
      where datname = $1 and pid <> pg_backend_pid()
      `,
      [databaseName],
    ).catch(() => {});
    await admin.query(`drop database if exists ${pg.escapeIdentifier(databaseName)}`).catch(() => {});
    await admin.end().catch(() => {});
  }
}
