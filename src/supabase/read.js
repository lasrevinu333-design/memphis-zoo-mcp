import { Pool } from "pg";

const DEFAULT_SQL_READ_MAX_ROWS = 50_000;
const DEFAULT_SQL_READ_MAX_RESPONSE_BYTES = 25_000_000;
const HARD_SQL_READ_MAX_ROWS = 250_000;
const HARD_SQL_READ_MAX_RESPONSE_BYTES = 100_000_000;
const DEFAULT_SQL_READ_STATEMENT_TIMEOUT_MS = 30_000;
const DEFAULT_SQL_READ_LOCK_TIMEOUT_MS = 5_000;

let sharedReadOnlyPool = null;

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

function readOnlyDatabaseUrl(env = process.env) {
  return String(env.CUSTODIAL_READONLY_DATABASE_URL || "").trim();
}

export function createReadOnlyPool({ connectionString = readOnlyDatabaseUrl(), PoolClass = Pool } = {}) {
  if (!connectionString) {
    throw new Error("CUSTODIAL_READONLY_DATABASE_URL is required for database reads.");
  }
  return new PoolClass({
    connectionString,
    max: 6,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    application_name: "memphis-custodial-readonly",
  });
}

function resolveReadOnlyPool(pool) {
  if (pool) return pool;
  if (!sharedReadOnlyPool) sharedReadOnlyPool = createReadOnlyPool();
  return sharedReadOnlyPool;
}

export async function assertDedicatedReadAuthority(client) {
  const result = await client.query(`
    with login_role as (
      select r.*
      from pg_catalog.pg_roles r
      where r.rolname = session_user
    ), direct_object_grants as (
      select acl.grantee
      from pg_catalog.pg_namespace o
      cross join lateral pg_catalog.aclexplode(o.nspacl) acl
      union all
      select acl.grantee
      from pg_catalog.pg_class o
      cross join lateral pg_catalog.aclexplode(o.relacl) acl
      union all
      select acl.grantee
      from pg_catalog.pg_proc o
      cross join lateral pg_catalog.aclexplode(o.proacl) acl
      union all
      select acl.grantee
      from pg_catalog.pg_type o
      cross join lateral pg_catalog.aclexplode(o.typacl) acl
      union all
      select acl.grantee
      from pg_catalog.pg_database o
      cross join lateral pg_catalog.aclexplode(o.datacl) acl
      union all
      select acl.grantee
      from pg_catalog.pg_default_acl o
      cross join lateral pg_catalog.aclexplode(o.defaclacl) acl
    )
    select
      session_user as session_user,
      current_user as current_user,
      current_user = session_user as same_session_identity,
      current_setting('transaction_read_only') = 'on' as transaction_read_only,
      pg_has_role(current_user, 'custodial_application_reader', 'member') as dedicated_reader_member,
      not exists (
        select 1
        from pg_catalog.pg_roles inherited
        cross join login_role login
        where inherited.oid <> login.oid
          and inherited.rolname <> 'custodial_application_reader'
          and pg_has_role(login.oid, inherited.oid, 'member')
      ) as exclusive_reader_membership,
      not exists (
        select 1
        from direct_object_grants direct_grant
        cross join login_role login
        where direct_grant.grantee = login.oid
      ) as direct_object_grants_absent,
      not exists (
        select 1 from pg_catalog.pg_namespace o cross join login_role login where o.nspowner = login.oid
        union all
        select 1 from pg_catalog.pg_class o cross join login_role login where o.relowner = login.oid
        union all
        select 1 from pg_catalog.pg_proc o cross join login_role login where o.proowner = login.oid
        union all
        select 1 from pg_catalog.pg_type o cross join login_role login where o.typowner = login.oid
        union all
        select 1 from pg_catalog.pg_database o cross join login_role login where o.datdba = login.oid
      ) as owned_objects_absent,
      not (
        r.rolsuper
        or r.rolbypassrls
        or r.rolcreaterole
        or r.rolcreatedb
        or r.rolreplication
        or not r.rolinherit
        or not r.rolcanlogin
      ) as reader_role_restricted
    from login_role r
  `);
  const authority = result.rows?.[0] || {};
  if (
    authority.same_session_identity !== true
    || authority.transaction_read_only !== true
    || authority.dedicated_reader_member !== true
    || authority.exclusive_reader_membership !== true
    || authority.direct_object_grants_absent !== true
    || authority.owned_objects_absent !== true
    || authority.reader_role_restricted !== true
  ) {
    const error = new Error("Database read authority is not the dedicated restricted application reader.");
    error.code = "read_authority_not_dedicated";
    throw error;
  }
  return authority;
}

async function rollbackQuietly(client) {
  try {
    await client.query("rollback");
  } catch {
    // Preserve the owning query failure. The pooled connection is released as
    // unusable below so pg cannot reuse an uncertain transaction.
  }
}

async function executeInReadOnlyTransaction(pool, sql) {
  const client = await resolveReadOnlyPool(pool).connect();
  let reusable = true;
  try {
    await client.query("begin isolation level repeatable read read only");
    await client.query(`set local statement_timeout = '${DEFAULT_SQL_READ_STATEMENT_TIMEOUT_MS}ms'`);
    await client.query(`set local lock_timeout = '${DEFAULT_SQL_READ_LOCK_TIMEOUT_MS}ms'`);
    await client.query("set local row_security = on");
    await assertDedicatedReadAuthority(client);
    const result = await client.query(sql);
    await client.query("commit");
    return result.rows;
  } catch (error) {
    reusable = false;
    await rollbackQuietly(client);
    throw error;
  } finally {
    client.release(reusable ? undefined : new Error("read-only database transaction failed"));
  }
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

export async function runReadOnlySql({ pool, sql, maxRows, max_rows, maxResponseBytes, max_response_bytes } = {}) {
  const sanitized = sanitizeReadOnlySql(sql);
  const limits = getReadLimits({
    maxRows: maxRows ?? max_rows,
    maxResponseBytes: maxResponseBytes ?? max_response_bytes,
  });
  const wrappedSql = canWrapReadQuery(sanitized.normalized) ? wrapReadQuery(sanitized.sql, limits) : sanitized.sql;

  const data = await executeInReadOnlyTransaction(pool, wrappedSql);

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
