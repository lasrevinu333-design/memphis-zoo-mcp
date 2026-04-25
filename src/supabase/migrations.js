import { resolveSupabaseClient } from "./client.js";

export function normalizeMigrationInput({ name, sql } = {}) {
  const migrationName = String(name || "").trim();
  const migrationSql = String(sql || "").trim();

  if (!migrationName) throw new Error("Migration name is required.");
  if (!/^[a-zA-Z0-9_.-]+$/.test(migrationName)) {
    throw new Error("Migration name may only contain letters, numbers, underscores, dots, and hyphens.");
  }
  if (!migrationSql) throw new Error("Migration SQL is required.");

  return {
    name: migrationName,
    sql: migrationSql,
  };
}

export async function applyMigration({ client, name, sql, dryRun = true } = {}) {
  const normalized = normalizeMigrationInput({ name, sql });

  if (dryRun) {
    return {
      ok: true,
      dry_run: true,
      action: "would_apply_migration",
      name: normalized.name,
      sql_bytes: Buffer.byteLength(normalized.sql, "utf8"),
      statement_count_estimate: normalized.sql.split(";").map((part) => part.trim()).filter(Boolean).length,
    };
  }

  const supabase = resolveSupabaseClient(client);
  const { data, error } = await supabase.rpc("run_sql_migration", {
    p_name: normalized.name,
    p_sql: normalized.sql,
  });

  if (error) {
    throw new Error(error.message || "run_sql_migration failed");
  }

  return {
    ok: true,
    action: "migration_applied",
    name: normalized.name,
    data,
  };
}
