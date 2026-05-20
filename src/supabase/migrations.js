import { resolveSupabaseClient } from "./client.js";

const DEFAULT_MIGRATION_MAX_BYTES = 500_000;
const DEFAULT_MIGRATION_MAX_STATEMENTS = 250;
const DEFAULT_MIGRATION_TIMEOUT_MS = 180_000;

const HARD_CAP_MAX_BYTES = 5_000_000;
const HARD_CAP_MAX_STATEMENTS = 2_000;
const HARD_CAP_TIMEOUT_MS = 600_000;

function toSafeInt(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function getMigrationLimits({ allowLarge = false } = {}) {
  const envMaxBytes = allowLarge
    ? process.env.MCP_MIGRATION_LARGE_MAX_BYTES || process.env.MCP_MIGRATION_MAX_BYTES
    : process.env.MCP_MIGRATION_MAX_BYTES;

  const envMaxStatements = allowLarge
    ? process.env.MCP_MIGRATION_LARGE_MAX_STATEMENTS || process.env.MCP_MIGRATION_MAX_STATEMENTS
    : process.env.MCP_MIGRATION_MAX_STATEMENTS;

  const envTimeoutMs = allowLarge
    ? process.env.MCP_MIGRATION_LARGE_TIMEOUT_MS || process.env.MCP_MIGRATION_TIMEOUT_MS
    : process.env.MCP_MIGRATION_TIMEOUT_MS;

  return {
    allow_large: Boolean(allowLarge),
    max_bytes: toSafeInt(envMaxBytes, DEFAULT_MIGRATION_MAX_BYTES, {
      min: 1_000,
      max: HARD_CAP_MAX_BYTES,
    }),
    max_statements: toSafeInt(envMaxStatements, DEFAULT_MIGRATION_MAX_STATEMENTS, {
      min: 1,
      max: HARD_CAP_MAX_STATEMENTS,
    }),
    timeout_ms: toSafeInt(envTimeoutMs, DEFAULT_MIGRATION_TIMEOUT_MS, {
      min: 5_000,
      max: HARD_CAP_TIMEOUT_MS,
    }),
    hard_caps: {
      max_bytes: HARD_CAP_MAX_BYTES,
      max_statements: HARD_CAP_MAX_STATEMENTS,
      timeout_ms: HARD_CAP_TIMEOUT_MS,
    },
  };
}

function stripSqlForStatementEstimate(sql = "") {
  let text = String(sql || "");

  // Remove dollar-quoted function bodies before counting semicolons.
  // This avoids over-counting statements inside plpgsql functions.
  text = text.replace(/\$([a-zA-Z_][a-zA-Z0-9_]*)?\$[\s\S]*?\$\1\$/g, "$$BODY$$");

  // Remove single-quoted strings.
  text = text.replace(/'(?:''|[^'])*'/g, "'STRING'");

  // Remove double-quoted identifiers.
  text = text.replace(/"(?:""|[^"])*"/g, '"IDENT"');

  // Remove line comments.
  text = text.replace(/--.*$/gm, "");

  // Remove block comments.
  text = text.replace(/\/\*[\s\S]*?\*\//g, "");

  return text;
}

function estimateStatementCount(sql = "") {
  const stripped = stripSqlForStatementEstimate(sql);
  return stripped
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean).length;
}

function previewSql(sql = "", maxChars = 600) {
  const compact = String(sql || "")
    .replace(/\s+/g, " ")
    .trim();

  if (compact.length <= maxChars) return compact;
  return `${compact.slice(0, maxChars).trim()}...`;
}

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
    sql_bytes: Buffer.byteLength(migrationSql, "utf8"),
    statement_count_estimate: estimateStatementCount(migrationSql),
    sql_preview: previewSql(migrationSql),
  };
}

function buildMigrationMetadata({ normalized, dryRun, action, limits, elapsedMs = null, warning = null }) {
  return {
    migration: {
      name: normalized.name,
      sql_bytes: normalized.sql_bytes,
      statement_count_estimate: normalized.statement_count_estimate,
      sql_preview: normalized.sql_preview,
    },
    limits: limits || getMigrationLimits(),
    audit: {
      dry_run: Boolean(dryRun),
      action,
      elapsed_ms: elapsedMs,
      warning,
      generated_at: new Date().toISOString(),
      log_table: "public.migration_log",
    },
  };
}

function validateMigrationAgainstLimits(normalized, limits) {
  const problems = [];

  if (normalized.sql_bytes > limits.max_bytes) {
    problems.push(
      `SQL is ${normalized.sql_bytes} bytes, above limit ${limits.max_bytes}.`
    );
  }

  if (normalized.statement_count_estimate > limits.max_statements) {
    problems.push(
      `Estimated statement count is ${normalized.statement_count_estimate}, above limit ${limits.max_statements}.`
    );
  }

  if (!problems.length) return;

  throw new Error(
    [
      "Migration is too large for this MCP write call.",
      ...problems,
      "Raise MCP_MIGRATION_MAX_BYTES / MCP_MIGRATION_MAX_STATEMENTS, use allow_large once schema exposes it, or split the migration.",
    ].join(" ")
  );
}

async function runRpcWithTimeout({ supabase, normalized, timeoutMs }) {
  const controller = new AbortController();
  const startedAt = Date.now();

  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => {
      controller.abort();
      reject(new Error(`run_sql_migration timed out after ${timeoutMs}ms.`));
    }, timeoutMs);
  });

  let request = supabase.rpc("run_sql_migration", {
    p_name: normalized.name,
    p_sql: normalized.sql,
  });

  // Supabase PostgREST builders support abortSignal in current versions.
  // If this runtime does not, Promise.race still returns a clean timeout.
  if (request && typeof request.abortSignal === "function") {
    request = request.abortSignal(controller.signal);
  }

  const result = await Promise.race([request, timeoutPromise]);
  return {
    ...result,
    elapsed_ms: Date.now() - startedAt,
  };
}

function getLargeModeFlag({ allowLarge, allow_large } = {}) {
  return Boolean(allowLarge || allow_large);
}

export async function applyMigration({
  client,
  name,
  sql,
  dryRun = true,
  dry_run,
  allowLarge = false,
  allow_large = false,
} = {}) {
  const normalized = normalizeMigrationInput({ name, sql });
  const effectiveDryRun = dry_run == null ? Boolean(dryRun) : Boolean(dry_run);
  const largeMode = getLargeModeFlag({ allowLarge, allow_large });
  const limits = getMigrationLimits({ allowLarge: largeMode });

  if (effectiveDryRun) {
    let warning = null;

    try {
      validateMigrationAgainstLimits(normalized, limits);
    } catch (error) {
      warning = error?.message || "Migration exceeds configured write limits.";
    }

    return {
      ok: true,
      dry_run: true,
      action: "would_apply_migration",
      name: normalized.name,
      sql_bytes: normalized.sql_bytes,
      statement_count_estimate: normalized.statement_count_estimate,
      within_limits: !warning,
      warning,
      ...buildMigrationMetadata({
        normalized,
        dryRun: true,
        action: "would_apply_migration",
        limits,
        warning,
      }),
    };
  }

  validateMigrationAgainstLimits(normalized, limits);

  const supabase = resolveSupabaseClient(client);
  const { data, error, elapsed_ms } = await runRpcWithTimeout({
    supabase,
    normalized,
    timeoutMs: limits.timeout_ms,
  });

  if (error) {
    throw new Error(error.message || "run_sql_migration failed");
  }

  return {
    ok: true,
    action: "migration_applied",
    name: normalized.name,
    data,
    ...buildMigrationMetadata({
      normalized,
      dryRun: false,
      action: "migration_applied",
      limits,
      elapsedMs: elapsed_ms,
    }),
  };
}