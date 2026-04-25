import { resolveSupabaseClient } from "./client.js";

export function sanitizeReadOnlySql(sql) {
  const trimmed = String(sql || "").trim();

  if (!trimmed) {
    throw new Error("SQL cannot be empty.");
  }

  const withoutTrailingSemicolon = trimmed.replace(/;\s*$/, "");

  if (withoutTrailingSemicolon.includes(";")) {
    throw new Error("Only one SQL statement is allowed.");
  }

  const normalized = withoutTrailingSemicolon.toLowerCase();
  const startsReadOnly = normalized.startsWith("select") || normalized.startsWith("with") || normalized.startsWith("explain");

  if (!startsReadOnly) {
    throw new Error("Only read-only SELECT, WITH, or EXPLAIN queries are allowed.");
  }

  const forbidden = /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|comment|vacuum|analyze|call|do|execute|merge)\b/i;
  if (forbidden.test(withoutTrailingSemicolon)) {
    throw new Error("Mutating SQL is not allowed in read-only mode.");
  }

  return {
    sql: withoutTrailingSemicolon,
    normalized,
  };
}

export async function runReadOnlySql({ client, sql } = {}) {
  const supabase = resolveSupabaseClient(client);
  const sanitized = sanitizeReadOnlySql(sql);

  const { data, error } = await supabase.rpc("run_sql_readonly", {
    p_sql: sanitized.sql,
  });

  if (error) {
    throw new Error(error.message || "run_sql_readonly failed");
  }

  return {
    ok: true,
    rowCount: Array.isArray(data) ? data.length : null,
    rows: data,
  };
}
