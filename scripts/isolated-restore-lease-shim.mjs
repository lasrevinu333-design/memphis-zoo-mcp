const LEASE_RELATION = "custodial_dr.application_mutation_leases";

export const GLOBAL_MUTATION_FENCE_MIGRATION = "20260827150000";
export const ISOLATED_LEASE_SHIM_COMMENT =
  "Memphis Zoo isolated restore rehearsal compatibility shim; must be empty and retired before the production migration plan is rehearsed.";

export function ledgerHasGlobalMutationFence(ledger) {
  return Array.isArray(ledger)
    && ledger.some((row) => String(row?.version || "") === GLOBAL_MUTATION_FENCE_MIGRATION);
}

async function leaseRelationState(db) {
  const result = await db.query(`
    select
      relation_oid::text relation_name,
      obj_description(relation_oid,'pg_class') relation_comment,
      (select pg_get_userbyid(relowner) from pg_class where oid=relation_oid) relation_owner,
      (select relkind from pg_class where oid=relation_oid) relation_kind,
      (select relpersistence from pg_class where oid=relation_oid) relation_persistence,
      current_user
    from (select to_regclass('${LEASE_RELATION}') relation_oid) relation
  `);
  return result.rows[0] || {
    relation_name: null,
    relation_comment: null,
    relation_owner: null,
    relation_kind: null,
    relation_persistence: null,
    current_user: null,
  };
}

async function assertExactEmptyShim(db, state) {
  if (state.relation_comment !== ISOLATED_LEASE_SHIM_COMMENT) {
    throw new Error("Refusing to use an unmarked application mutation lease table as an isolated rehearsal shim.");
  }
  if (!state.relation_owner || state.relation_owner !== state.current_user) {
    throw new Error("The isolated application mutation lease shim is not owned by the isolated restore identity.");
  }
  if (state.relation_kind !== "r" || state.relation_persistence !== "p") {
    throw new Error("The isolated application mutation lease shim is not an ordinary persistent table.");
  }
  const shape = await db.query(`
    select
      coalesce(json_agg(json_build_object(
        'name',a.attname,
        'type',format_type(a.atttypid,a.atttypmod),
        'not_null',a.attnotnull,
        'default',pg_get_expr(d.adbin,d.adrelid)
      ) order by a.attnum),'[]'::json) columns,
      (select coalesce(json_agg(json_build_object(
        'name',conname,
        'type',contype,
        'definition',pg_get_constraintdef(oid)
      ) order by conname),'[]'::json)
       from pg_constraint where conrelid=to_regclass('${LEASE_RELATION}')) constraints,
      (select coalesce(json_agg(json_build_object(
        'grantee',case when acl.grantee=0 then 'PUBLIC' else pg_get_userbyid(acl.grantee) end,
        'privilege',acl.privilege_type,
        'grantable',acl.is_grantable
      ) order by case when acl.grantee=0 then 'PUBLIC' else pg_get_userbyid(acl.grantee) end,acl.privilege_type),'[]'::json)
       from pg_class c
       cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl
       where c.oid=to_regclass('${LEASE_RELATION}') and acl.grantee<>c.relowner) non_owner_acl
    from pg_attribute a
    left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
    where a.attrelid=to_regclass('${LEASE_RELATION}') and a.attnum>0 and not a.attisdropped
  `);
  const expectedColumns = [
    { name: "request_id", type: "uuid", not_null: true, default: null },
    { name: "authority_generation", type: "bigint", not_null: true, default: null },
    { name: "service_name", type: "text", not_null: true, default: null },
    { name: "admitted_at", type: "timestamp with time zone", not_null: true, default: "clock_timestamp()" },
    { name: "heartbeat_at", type: "timestamp with time zone", not_null: true, default: "clock_timestamp()" },
    { name: "expires_at", type: "timestamp with time zone", not_null: true, default: "(clock_timestamp() + '00:03:00'::interval)" },
  ];
  const expectedConstraints = [
    { name: "application_mutation_lease_expiry_order", type: "c", definition: "CHECK ((expires_at > admitted_at))" },
    { name: "application_mutation_leases_authority_generation_check", type: "c", definition: "CHECK ((authority_generation >= 0))" },
    { name: "application_mutation_leases_pkey", type: "p", definition: "PRIMARY KEY (request_id)" },
    { name: "application_mutation_leases_service_name_check", type: "c", definition: "CHECK (((length(btrim(service_name)) >= 1) AND (length(btrim(service_name)) <= 120)))" },
  ];
  const expectedNonOwnerAcl = [
    { grantee: "postgres", privilege: "DELETE", grantable: false },
    { grantee: "postgres", privilege: "INSERT", grantable: false },
    { grantee: "postgres", privilege: "SELECT", grantable: false },
  ];
  if (JSON.stringify(shape.rows[0]?.columns || []) !== JSON.stringify(expectedColumns)
      || JSON.stringify(shape.rows[0]?.constraints || []) !== JSON.stringify(expectedConstraints)
      || JSON.stringify(shape.rows[0]?.non_owner_acl || []) !== JSON.stringify(expectedNonOwnerAcl)) {
    throw new Error("The isolated application mutation lease shim shape is not exact.");
  }
  const leases = await db.query(`
    select
      count(*)::int total_count,
      count(*) filter (where expires_at>clock_timestamp())::int active_count,
      count(*) filter (where expires_at<=clock_timestamp())::int expired_count
    from custodial_dr.application_mutation_leases
  `);
  const counts = leases.rows[0] || {};
  if (Number(counts.total_count) !== 0
      || Number(counts.active_count) !== 0
      || Number(counts.expired_count) !== 0) {
    throw new Error("The isolated application mutation lease shim is not empty.");
  }
}

export async function ensureIsolatedRestoreLeaseShim(db, { sourceMigrationPresent }) {
  const state = await leaseRelationState(db);
  if (state.relation_name) {
    if (sourceMigrationPresent) return { created: false, sourceMigrationPresent: true };
    if (state.relation_comment !== ISOLATED_LEASE_SHIM_COMMENT) {
      throw new Error("The pre-migration isolated target unexpectedly contains an unmarked application mutation lease table.");
    }
    await assertExactEmptyShim(db, state);
    return { created: false, sourceMigrationPresent: false };
  }
  if (sourceMigrationPresent) {
    throw new Error("The signed source ledger includes the global mutation fence but its application mutation lease table is missing.");
  }

  const control = await db.query("select to_regclass('custodial_dr.restore_control')::text relation_name");
  if (!control.rows[0]?.relation_name) {
    throw new Error("The isolated target cannot add a lease compatibility shim without the signed restore control plane.");
  }
  await db.query(`
    create table custodial_dr.application_mutation_leases (
      request_id uuid primary key,
      authority_generation bigint not null check (authority_generation >= 0),
      service_name text not null check (length(btrim(service_name)) between 1 and 120),
      admitted_at timestamptz not null default clock_timestamp(),
      heartbeat_at timestamptz not null default clock_timestamp(),
      expires_at timestamptz not null default (clock_timestamp() + interval '3 minutes'),
      constraint application_mutation_lease_expiry_order check (expires_at > admitted_at)
    )
  `);
  await db.query("revoke all on table custodial_dr.application_mutation_leases from public, anon, authenticated, service_role");
  await db.query("grant select, insert, delete on table custodial_dr.application_mutation_leases to postgres");
  const commentLiteral = `'${ISOLATED_LEASE_SHIM_COMMENT.replaceAll("'", "''")}'`;
  await db.query(`comment on table custodial_dr.application_mutation_leases is ${commentLiteral}`);
  await assertExactEmptyShim(db, await leaseRelationState(db));
  return { created: true, sourceMigrationPresent: false };
}

export async function retireIsolatedRestoreLeaseShim(db) {
  const migration = await db.query(
    "select exists(select 1 from supabase_migrations.schema_migrations where version=$1) migration_present",
    [GLOBAL_MUTATION_FENCE_MIGRATION],
  );
  const sourceMigrationPresent = migration.rows[0]?.migration_present === true;
  const state = await leaseRelationState(db);
  if (!state.relation_name) {
    if (sourceMigrationPresent) {
      throw new Error("The global mutation fence is recorded but its application mutation lease table is missing.");
    }
    return { retired: false, alreadyAbsent: true, sourceMigrationPresent };
  }
  if (sourceMigrationPresent) {
    if (state.relation_comment === ISOLATED_LEASE_SHIM_COMMENT) {
      throw new Error("An isolated lease shim cannot survive after the global mutation fence is recorded.");
    }
    return { retired: false, alreadyAbsent: false, sourceMigrationPresent: true };
  }
  await assertExactEmptyShim(db, state);
  await db.query("drop table custodial_dr.application_mutation_leases");
  const retiredState = await leaseRelationState(db);
  if (retiredState.relation_name) throw new Error("The isolated application mutation lease shim was not retired.");
  return { retired: true, alreadyAbsent: false, sourceMigrationPresent: false };
}
