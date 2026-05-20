import { resolveSupabaseClient } from "./client.js";

const DEFAULT_SQL_READ_MAX_ROWS = 50_000;
const DEFAULT_SQL_READ_MAX_RESPONSE_BYTES = 25_000_000;
const HARD_SQL_READ_MAX_ROWS = 250_000;
const HARD_SQL_READ_MAX_RESPONSE_BYTES = 100_000_000;

function toSafeInt(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function getReadLimits({ maxRows, maxResponseBytes } = {}) {
  return {
    max_rows: toSafeInt(maxRows ?? process.env.MCP_SUPABASE_SQL_READ_MAX_ROWS, DEFAULT_SQL_READ_MAX_ROWS, {
      min: 1,
      max: HARD_SQL_READ_MAX_ROWS,
    }),
    max_response_bytes: toSafeInt(maxResponseBytes ?? process.env.MCP_SUPABASE_SQL_READ_MAX_RESPONSE_BYTES, DEFAULT_SQL_READ_MAX_RESPONSE_BYTES, {
      min: 1_000,
      max: HARD_SQL_READ_MAX_RESPONSE_BYTES,
    }),
    hard_caps: {
      max_rows: HARD_SQL_READ_MAX_ROWS,
      max_response_bytes: HARD_SQL_READ_MAX_RESPONSE_BYTES,
    },
  };
}

function stripOuterTrailingSemicolon(sql) {
  return String(sql || "").trim().replace(/;\s*$/, "");
}

function canWrapReadQuery(normalized) {
  return normalized.startsWith("select") || normalized.startsWith("with");
}

function wrapReadQuery(sql, limits) {
  const trimmed = stripOuterTrailingSemicolon(sql);
  return `select * from (${trimmed}) as mcp_readonly_result limit ${limits.max_rows + 1}`;
}

function byteSizeJson(value) {
  return Buffer.byteLength(JSON.stringify(value ?? null), "utf8");
}

function compactRowsToByteLimit(rows, maxBytes) {
  if (!Array.isArray(rows)) {
    const responseBytes = byteSizeJson(rows);
    if (responseBytes <= maxBytes) {
      return { rows, row_count: null, response_bytes: responseBytes, response_truncated: false };
    }
    return {
      rows: null,
      row_count: null,
      response_bytes: 0,
      response_truncated: true,
      omitted_oversized_value_bytes: responseBytes,
    };
  }

  const compacted = [];
  let bytes = Buffer.byteLength("[]", "utf8");
  let omittedOversizedRows = 0;

  for (const row of rows) {
    const rowBytes = byteSizeJson(row) + 1;

    if (rowBytes > maxBytes) {
      omittedOversizedRows += 1;
      if (compacted.length === 0) {
        return {
          rows: [],
          row_count: 0,
          response_bytes: bytes,
          response_truncated: true,
          omitted_oversized_rows: omittedOversizedRows,
          first_oversized_row_bytes: rowBytes,
        };
      }
      return {
        rows: compacted,
        row_count: compacted.length,
        response_bytes: bytes,
        response_truncated: true,
        omitted_oversized_rows: omittedOversizedRows,
        first_oversized_row_bytes: rowBytes,
      };
    }

    if (bytes + rowBytes > maxBytes) {
      return {
        rows: compacted,
        row_count: compacted.length,
        response_bytes: bytes,
        response_truncated: true,
        omitted_oversized_rows: omittedOversizedRows,
      };
    }

    compacted.push(row);
    bytes += rowBytes;
  }

  return {
    rows: compacted,
    row_count: compacted.length,
    response_bytes: bytes,
    response_truncated: false,
    omitted_oversized_rows: omittedOversizedRows,
  };
}

export function sanitizeReadOnlySql(sql) {
  const trimmed = String(sql || "").trim();

  if (!trimmed) {
    throw new Error("SQL cannot be empty.");
  }

  const withoutTrailingSemicolon = stripOuterTrailingSemicolon(trimmed);

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

export async function runReadOnlySql({ client, sql, maxRows, max_rows, maxResponseBytes, max_response_bytes } = {}) {
  const supabase = resolveSupabaseClient(client);
  const sanitized = sanitizeReadOnlySql(sql);
  const limits = getReadLimits({
    maxRows: maxRows ?? max_rows,
    maxResponseBytes: maxResponseBytes ?? max_response_bytes,
  });
  const wrappedSql = canWrapReadQuery(sanitized.normalized) ? wrapReadQuery(sanitized.sql, limits) : sanitized.sql;

  const { data, error } = await supabase.rpc("run_sql_readonly", {
    p_sql: wrappedSql,
  });

  if (error) {
    throw new Error(error.message || "run_sql_readonly failed");
  }

  const originalRowCount = Array.isArray(data) ? data.length : null;
  const rowLimitTruncated = Array.isArray(data) && data.length > limits.max_rows;
  const rowsWithinRowLimit = rowLimitTruncated ? data.slice(0, limits.max_rows) : data;
  const compacted = compactRowsToByteLimit(rowsWithinRowLimit, limits.max_response_bytes);

  return {
    ok: true,
    rowCount: compacted.row_count,
    originalRowCount,
    row_limit_truncated: rowLimitTruncated,
    response_truncated: compacted.response_truncated,
    response_bytes: compacted.response_bytes,
    omitted_oversized_rows: compacted.omitted_oversized_rows,
    first_oversized_row_bytes: compacted.first_oversized_row_bytes,
    omitted_oversized_value_bytes: compacted.omitted_oversized_value_bytes,
    limits,
    wrapped: canWrapReadQuery(sanitized.normalized),
    rows: compacted.rows,
  };
}
