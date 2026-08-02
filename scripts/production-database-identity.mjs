import assert from "node:assert/strict";
import { createHash, timingSafeEqual } from "node:crypto";

export const PRODUCTION_DATABASE_IDENTITY = Object.freeze({
  project_ref: "rqquvtjdmugpigbndmne",
  session_pooler_host: "aws-1-us-east-1.pooler.supabase.com",
  system_identifier_domain: "memphis-zoo-production-system-id:v1",
  system_identifier_sha256: "353529a1fab57d124366abbaaf7a2819c4a14bbe9f7df87693ad9740c5b4c1c9",
});

function safeDecodeUsername(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    assert.fail("production database username is not valid URL userinfo");
  }
}

export function validateProductionProjectRef(projectRefInput) {
  const projectRef = String(projectRefInput || "").trim();
  assert.match(projectRef, /^[a-z0-9]{20}$/,
    "production Supabase project reference must contain exactly 20 lowercase letters or digits");
  assert.equal(projectRef, PRODUCTION_DATABASE_IDENTITY.project_ref,
    "production Supabase project reference is not the reviewed Memphis Zoo project");
  return projectRef;
}

export function validateProductionDatabasePassword(passwordInput) {
  const password = String(passwordInput || "");
  assert.ok(password, "production Supabase database password is required");
  if (/[\r\n\0]/.test(password)) {
    assert.fail("production Supabase database password contains forbidden control characters");
  }
  return password;
}

export function productionDatabaseConnectionFromPassword(passwordInput, projectRefInput) {
  const password = validateProductionDatabasePassword(passwordInput);
  const projectRef = validateProductionProjectRef(projectRefInput);
  const parsed = new URL(`postgresql://${PRODUCTION_DATABASE_IDENTITY.session_pooler_host}:5432/postgres`);
  parsed.username = `postgres.${projectRef}`;
  // WHATWG URL setters encode delimiters but preserve a literal percent sign.
  // Escape percent first so arbitrary database passwords remain valid URL userinfo.
  parsed.password = password.replaceAll("%", "%25");
  return Object.freeze({
    connectionString: parsed.toString(),
    projectRef,
    safeIdentity: Object.freeze({
      connection_mode: "shared-session-pooler",
      project_binding: "reviewed-constant",
      database: "postgres",
      port: 5432,
    }),
  });
}

export function validateProductionDatabaseUrl(databaseUrlInput, projectRefInput) {
  const databaseUrl = String(databaseUrlInput || "").trim();
  const projectRef = validateProductionProjectRef(projectRefInput);
  assert.ok(databaseUrl, "production Supabase database URL is required");

  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    assert.fail("production database URL is not a well-formed URL");
  }
  assert.ok(["postgres:", "postgresql:"].includes(parsed.protocol),
    "production database URL must use PostgreSQL");
  assert.equal(parsed.hash, "", "production database URL cannot contain a fragment");
  assert.equal(parsed.pathname, "/postgres", "production database URL must select the postgres database");
  assert.equal(parsed.port || "5432", "5432",
    "production database connection must use the direct/session port 5432");
  assert.ok(parsed.password, "production database URL must contain a password");

  const username = safeDecodeUsername(parsed.username);
  let connectionMode;
  if (parsed.hostname === `db.${projectRef}.supabase.co`) {
    assert.equal(username, "postgres", "direct production database username must be postgres");
    connectionMode = "direct";
  } else if (/^aws-[0-9]+-[a-z0-9]+(?:-[a-z0-9]+)*\.pooler\.supabase\.com$/.test(parsed.hostname)) {
    assert.equal(username, `postgres.${projectRef}`,
      "shared session-pooler username must bind exactly to the production project");
    connectionMode = "shared-session-pooler";
  } else {
    assert.fail("production database host is not an exact reviewed Supabase endpoint");
  }

  const permittedParameters = new Set(["sslmode", "sslcert", "sslkey", "sslrootcert"]);
  for (const key of parsed.searchParams.keys()) {
    assert.ok(permittedParameters.has(key), `production database URL parameter is not reviewed: ${key}`);
  }
  for (const key of permittedParameters) parsed.searchParams.delete(key);

  return Object.freeze({
    connectionString: parsed.toString(),
    projectRef,
    safeIdentity: Object.freeze({
      connection_mode: connectionMode,
      project_binding: "exact",
      database: "postgres",
      port: 5432,
    }),
  });
}

export function productionSystemIdentifierDigest(systemIdentifierInput) {
  const systemIdentifier = String(systemIdentifierInput || "").trim();
  assert.match(systemIdentifier, /^[0-9]+$/, "production database system identifier is malformed");
  return createHash("sha256")
    .update(`${PRODUCTION_DATABASE_IDENTITY.system_identifier_domain}\0${systemIdentifier}`, "utf8")
    .digest("hex");
}

function equalDigest(actual, expected) {
  const actualBytes = Buffer.from(actual, "hex");
  const expectedBytes = Buffer.from(expected, "hex");
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

export function validateProductionDatabaseIdentityRow(row, {
  expectedSystemIdentifierSha256 = PRODUCTION_DATABASE_IDENTITY.system_identifier_sha256,
  migrationAuthority = false,
} = {}) {
  const systemIdentifierSha256 = productionSystemIdentifierDigest(row?.system_identifier);
  assert.ok(equalDigest(systemIdentifierSha256, expectedSystemIdentifierSha256),
    "production database physical-cluster identity does not match the reviewed project");

  const safeBase = {
    database_role: row?.database_role,
    database_name: row?.database_name,
  };
  assert.deepEqual(safeBase, {
    database_role: "postgres",
    database_name: "postgres",
  }, "production connection is not the reviewed postgres identity");

  const result = {
    ...safeBase,
    system_identifier_sha256: systemIdentifierSha256,
  };
  if (migrationAuthority) {
    const authority = {
      can_create_public: row?.can_create_public,
      can_record_migration: row?.can_record_migration,
      notification_jobs_owner: row?.notification_jobs_owner,
    };
    assert.deepEqual(authority, {
      can_create_public: true,
      can_record_migration: true,
      notification_jobs_owner: "postgres",
    }, "production connection is not the migration-owning postgres identity");
    Object.assign(result, authority);
  }
  return Object.freeze(result);
}

export async function assertProductionDatabaseIdentity(client, { migrationAuthority = false } = {}) {
  const authorityProjection = migrationAuthority ? `,
           has_schema_privilege(current_user, 'public', 'CREATE') as can_create_public,
           has_table_privilege(
             current_user,
             'supabase_migrations.schema_migrations',
             'INSERT'
           ) as can_record_migration,
           pg_get_userbyid(c.relowner) as notification_jobs_owner` : "";
  const relationJoin = migrationAuthority
    ? "from pg_class c where c.oid = 'public.operational_notification_jobs'::regclass"
    : "";
  const result = await client.query(`
    select current_user as database_role,
           current_database() as database_name,
           (pg_control_system()).system_identifier::text as system_identifier
           ${authorityProjection}
      ${relationJoin}
  `);
  assert.equal(result.rowCount, 1, "production database identity query is incomplete");
  return validateProductionDatabaseIdentityRow(result.rows[0], { migrationAuthority });
}
