import { createHash } from "node:crypto";

export const SCHEMA_CATALOG_QUERIES = Object.freeze({
  extensions: `select e.extname as extension_name,case when e.extname='pg_net' then 'provider_managed' else e.extversion end as version,n.nspname as schema_name from pg_extension e join pg_namespace n on n.oid=e.extnamespace order by e.extname`,
  types: `select n.nspname as schema_name,t.typname as type_name,t.typtype as type_kind,case when pg_get_userbyid(t.typowner) in ('postgres','supabase_admin') then 'migration_owner' else pg_get_userbyid(t.typowner) end as owner_name,format_type(t.typbasetype,t.typtypmod) as base_type,t.typnotnull as not_null,pg_get_expr(t.typdefaultbin,0) as default_expression,coalesce((select jsonb_agg(e.enumlabel order by e.enumsortorder) from pg_enum e where e.enumtypid=t.oid),'[]'::jsonb) as enum_labels from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname='public' and t.typtype in ('e','d') order by t.typname`,
  sequences: `select schemaname as schema_name,sequencename as sequence_name,case when sequenceowner in ('postgres','supabase_admin') then 'migration_owner' else sequenceowner end as owner_name,data_type,start_value,min_value,max_value,increment_by,cycle,cache_size from pg_sequences where schemaname='public' order by sequencename`,
  tables: `select n.nspname as schema_name,c.relname as table_name,c.relkind as relation_kind,case when pg_get_userbyid(c.relowner) in ('postgres','supabase_admin') then 'migration_owner' else pg_get_userbyid(c.relowner) end as owner_name,c.relrowsecurity as rls_enabled,c.relforcerowsecurity as rls_forced,pg_get_partkeydef(c.oid) as partition_key,obj_description(c.oid,'pg_class') as object_comment from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p') order by c.relname`,
  columns: `select n.nspname as schema_name,c.relname as table_name,a.attnum as ordinal_position,a.attname as column_name,format_type(a.atttypid,a.atttypmod) as data_type,a.attnotnull as not_null,a.attidentity as identity_kind,a.attgenerated as generated_kind,pg_get_expr(ad.adbin,ad.adrelid) as default_expression,case when a.attcollation<>t.typcollation then coll.collname else null end as collation_name,col_description(c.oid,a.attnum) as object_comment from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace join pg_type t on t.oid=a.atttypid left join pg_attrdef ad on ad.adrelid=a.attrelid and ad.adnum=a.attnum left join pg_collation coll on coll.oid=a.attcollation where n.nspname='public' and c.relkind in ('r','p') and a.attnum>0 and not a.attisdropped order by c.relname,a.attnum`,
  constraints: `select n.nspname as schema_name,c.relname as table_name,con.conname as constraint_name,con.contype as constraint_type,pg_get_constraintdef(con.oid,true) as definition,con.convalidated as validated from pg_constraint con join pg_class c on c.oid=con.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' order by c.relname,con.conname`,
  indexes: `select n.nspname as schema_name,c.relname as table_name,i.relname as index_name,pg_get_indexdef(ix.indexrelid) as definition,ix.indisunique as is_unique,ix.indisprimary as is_primary,exists(select 1 from pg_constraint con where con.conindid=ix.indexrelid) as backs_constraint from pg_index ix join pg_class c on c.oid=ix.indrelid join pg_class i on i.oid=ix.indexrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' order by c.relname,i.relname`,
  functions: `select n.nspname as schema_name,p.proname as function_name,pg_get_function_identity_arguments(p.oid) as identity_arguments,case when pg_get_userbyid(p.proowner) in ('postgres','supabase_admin') then 'migration_owner' else pg_get_userbyid(p.proowner) end as owner_name,pg_get_functiondef(p.oid) as definition,obj_description(p.oid,'pg_proc') as object_comment from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' order by p.proname,pg_get_function_identity_arguments(p.oid)`,
  views: `select n.nspname as schema_name,c.relname as view_name,c.relkind as relation_kind,case when pg_get_userbyid(c.relowner) in ('postgres','supabase_admin') then 'migration_owner' else pg_get_userbyid(c.relowner) end as owner_name,pg_get_viewdef(c.oid,true) as definition,obj_description(c.oid,'pg_class') as object_comment from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('v','m') order by c.relname`,
  triggers: `select n.nspname as schema_name,c.relname as table_name,t.tgname as trigger_name,pg_get_triggerdef(t.oid,true) as definition,t.tgenabled as enabled from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal order by c.relname,t.tgname`,
  policies: `select n.nspname as schema_name,c.relname as table_name,p.polname as policy_name,p.polpermissive as permissive,p.polcmd as command_code,coalesce((select jsonb_agg(r.rolname order by r.rolname) from unnest(p.polroles) role_oid join pg_roles r on r.oid=role_oid),'[]'::jsonb) as roles,pg_get_expr(p.polqual,p.polrelid) as using_expression,pg_get_expr(p.polwithcheck,p.polrelid) as check_expression from pg_policy p join pg_class c on c.oid=p.polrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' order by c.relname,p.polname`,
  owned_scheduler_roles: `select rolname as role_name,rolsuper as is_superuser,rolinherit as inherits_role,rolcreaterole as can_create_role,rolcreatedb as can_create_database,rolcanlogin as can_login,rolreplication as can_replicate,rolbypassrls as bypasses_rls,rolconnlimit as connection_limit from pg_roles where rolname in ('static_weekly_control_plane','static_weekly_release_operator','static_weekly_runtime_20260823') order by rolname`,
  owned_scheduler_role_memberships: `select distinct parent.rolname as granted_role,case when member.rolname in ('postgres','supabase_admin') then 'migration_owner' else member.rolname end as member_role,case when member.rolname in ('postgres','supabase_admin') then false else m.admin_option end as admin_option from pg_auth_members m join pg_roles parent on parent.oid=m.roleid join pg_roles member on member.oid=m.member where parent.rolname in ('static_weekly_control_plane','static_weekly_release_operator','static_weekly_runtime_20260823') or member.rolname in ('static_weekly_control_plane','static_weekly_release_operator','static_weekly_runtime_20260823') order by parent.rolname,member_role`,
  privilege_bearing_roles: `select rolname as role_name,rolsuper as is_superuser,rolinherit as inherits_role,rolcreaterole as can_create_role,rolcreatedb as can_create_database,rolcanlogin as can_login,rolreplication as can_replicate,rolbypassrls as bypasses_rls,rolconnlimit as connection_limit,rolvaliduntil as valid_until,rolconfig as role_config from pg_roles where rolname in ('memphis_zoo_backup','static_weekly_control_plane','static_weekly_release_operator','static_weekly_runtime_20260823') order by rolname`,
  role_memberships: `select distinct parent.rolname as granted_role,case when member.rolname in ('postgres','supabase_admin') then 'migration_owner' else member.rolname end as member_role,case when grantor.rolname in ('postgres','supabase_admin') then 'migration_owner' else grantor.rolname end as grantor_role,case when parent.rolname in ('static_weekly_control_plane','static_weekly_release_operator') and member.rolname in ('postgres','supabase_admin') then false else m.admin_option end as admin_option from pg_auth_members m join pg_roles parent on parent.oid=m.roleid join pg_roles member on member.oid=m.member left join pg_roles grantor on grantor.oid=m.grantor where not (parent.rolname='memphis_zoo_backup' and member.rolname in ('postgres','supabase_admin')) and parent.rolname<>'custodial_application_reader' and not (parent.rolname~'^custodial_readonly_runtime_[0-9]{8}$' and member.rolname in ('postgres','supabase_admin') and parent.rolcanlogin and not parent.rolsuper and not parent.rolcreaterole and not parent.rolcreatedb and not parent.rolreplication and not parent.rolbypassrls and exists (select 1 from pg_auth_members reader_membership join pg_roles reader_parent on reader_parent.oid=reader_membership.roleid where reader_membership.member=parent.oid and reader_parent.rolname='custodial_application_reader')) order by parent.rolname,member_role,grantor_role,admin_option`,
  table_grants: `select n.nspname as schema_name,c.relname as table_name,coalesce(grantee.rolname,'PUBLIC') as grantee,case when grantor.rolname in ('postgres','supabase_admin') then 'migration_owner' else grantor.rolname end as grantor,x.privilege_type,x.is_grantable from pg_class c join pg_namespace n on n.oid=c.relnamespace cross join lateral aclexplode(coalesce(c.relacl,acldefault(case when c.relkind='S' then 'S'::"char" else 'r'::"char" end,c.relowner))) x left join pg_roles grantee on grantee.oid=x.grantee left join pg_roles grantor on grantor.oid=x.grantor where n.nspname='public' and c.relkind in ('r','p','v','m') and coalesce(grantee.rolname,'PUBLIC') not in ('postgres','supabase_admin') order by c.relname,grantee,grantor,x.privilege_type`,
  column_grants: `select n.nspname as schema_name,c.relname as table_name,a.attname as column_name,coalesce(grantee.rolname,'PUBLIC') as grantee,case when grantor.rolname in ('postgres','supabase_admin') then 'migration_owner' else grantor.rolname end as grantor,x.privilege_type,x.is_grantable from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace cross join lateral aclexplode(a.attacl) x left join pg_roles grantee on grantee.oid=x.grantee left join pg_roles grantor on grantor.oid=x.grantor where n.nspname='public' and a.attnum>0 and not a.attisdropped and a.attacl is not null and coalesce(grantee.rolname,'PUBLIC') not in ('postgres','supabase_admin') order by c.relname,a.attname,grantee,grantor,x.privilege_type`,
  sequence_grants: `select n.nspname as schema_name,c.relname as sequence_name,coalesce(grantee.rolname,'PUBLIC') as grantee,case when grantor.rolname in ('postgres','supabase_admin') then 'migration_owner' else grantor.rolname end as grantor,x.privilege_type,x.is_grantable from pg_class c join pg_namespace n on n.oid=c.relnamespace cross join lateral aclexplode(coalesce(c.relacl,acldefault('S',c.relowner))) x left join pg_roles grantee on grantee.oid=x.grantee left join pg_roles grantor on grantor.oid=x.grantor where n.nspname='public' and c.relkind='S' and coalesce(grantee.rolname,'PUBLIC') not in ('postgres','supabase_admin') order by c.relname,grantee,grantor,x.privilege_type`,
  routine_grants: `select n.nspname as schema_name,p.proname as function_name,pg_get_function_identity_arguments(p.oid) as identity_arguments,coalesce(grantee.rolname,'PUBLIC') as grantee,case when grantor.rolname in ('postgres','supabase_admin') then 'migration_owner' else grantor.rolname end as grantor,x.privilege_type,x.is_grantable from pg_proc p join pg_namespace n on n.oid=p.pronamespace cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x left join pg_roles grantee on grantee.oid=x.grantee left join pg_roles grantor on grantor.oid=x.grantor where n.nspname='public' and coalesce(grantee.rolname,'PUBLIC') not in ('postgres','supabase_admin') order by p.proname,pg_get_function_identity_arguments(p.oid),grantee,grantor,x.privilege_type`,
  type_grants: `select n.nspname as schema_name,t.typname as type_name,coalesce(grantee.rolname,'PUBLIC') as grantee,case when grantor.rolname in ('postgres','supabase_admin') then 'migration_owner' else grantor.rolname end as grantor,x.privilege_type,x.is_grantable from pg_type t join pg_namespace n on n.oid=t.typnamespace cross join lateral aclexplode(coalesce(t.typacl,acldefault('T',t.typowner))) x left join pg_roles grantee on grantee.oid=x.grantee left join pg_roles grantor on grantor.oid=x.grantor where n.nspname='public' and t.typtype in ('e','d') and coalesce(grantee.rolname,'PUBLIC') not in ('postgres','supabase_admin') order by t.typname,grantee,grantor,x.privilege_type`,
  schema_grants: `select n.nspname as schema_name,case when coalesce(grantee.rolname,'PUBLIC') in ('postgres','supabase_admin') then 'migration_owner' else coalesce(grantee.rolname,'PUBLIC') end as grantee,case when grantor.rolname in ('postgres','supabase_admin') then 'migration_owner' else grantor.rolname end as grantor,x.privilege_type,x.is_grantable from pg_namespace n cross join lateral aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) x left join pg_roles grantee on grantee.oid=x.grantee left join pg_roles grantor on grantor.oid=x.grantor where n.nspname='public' order by n.nspname,grantee,grantor,x.privilege_type`,
  default_privileges: `select distinct 'migration_owner' as owner_role,n.nspname as schema_name,d.defaclobjtype as object_type,grantee.rolname as grantee,'migration_owner' as grantor,x.privilege_type,x.is_grantable from pg_default_acl d join pg_roles owner on owner.oid=d.defaclrole left join pg_namespace n on n.oid=d.defaclnamespace cross join lateral aclexplode(d.defaclacl) x join pg_roles grantee on grantee.oid=x.grantee where owner.rolname in ('postgres','supabase_admin') and (n.nspname='public' or d.defaclnamespace=0) and grantee.rolname='service_role' order by n.nspname,d.defaclobjtype,grantee,x.privilege_type`,
  cron_jobs: `select jobname,schedule,command,database,case when username in ('postgres','supabase_admin') then 'migration_owner' else username end as username,active from custodial_release_identity.custodial_schema_identity_cron_jobs() order by jobname`,
});

export const SCHEMA_CATALOG_NAMES = Object.freeze(Object.keys(SCHEMA_CATALOG_QUERIES));
export const UNSUPPORTED_PUBLIC_RELATION_CLASSES_QUERY = `select c.relname as relation_name,c.relkind as relation_kind from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('f') order by c.relkind,c.relname`;
export const UNSUPPORTED_PUBLIC_TYPE_CLASSES_QUERY = `select t.typname as type_name,t.typtype as type_kind from pg_type t join pg_namespace n on n.oid=t.typnamespace join pg_class c on c.oid=t.typrelid where n.nspname='public' and t.typtype='c' and c.relkind='c' order by t.typtype,t.typname`;

export function stableSchemaJson(value) {
  if (Array.isArray(value)) return value.map(stableSchemaJson);
  if (value && typeof value === "object") {
    const commentNormalized = Object.hasOwn(value, "object_comment")
      ? { ...value, comment: value.object_comment }
      : value;
    if (commentNormalized !== value) delete commentNormalized.object_comment;
    return Object.fromEntries(
      Object.keys(commentNormalized).sort()
        .map((key) => [key, stableSchemaJson(commentNormalized[key])]),
    );
  }
  return value;
}

export function fingerprintSchemaCatalog(inventory) {
  const normalized = stableSchemaJson(inventory);
  return {
    normalized,
    fingerprint: createHash("sha256").update(JSON.stringify(normalized)).digest("hex"),
  };
}

function assertSupportedPublicSchemaObjects({ unsupportedRelations, unsupportedTypes }) {
  for (const relation of unsupportedRelations) {
    if (relation.relation_kind === "f") {
      throw new Error(`Unsupported public foreign table must be reviewed before schema fingerprint capture: ${relation.relation_name}`);
    }
    throw new Error(`Unsupported public relation class ${relation.relation_kind} must be reviewed before schema fingerprint capture: ${relation.relation_name}`);
  }
  for (const type of unsupportedTypes) {
    if (type.type_kind === "c") {
      throw new Error(`Unsupported public composite type must be reviewed before schema fingerprint capture: ${type.type_name}`);
    }
    throw new Error(`Unsupported public type class ${type.type_kind} must be reviewed before schema fingerprint capture: ${type.type_name}`);
  }
}

export async function captureSchemaCatalog(client) {
  const inventory = {};
  for (const [name, sql] of Object.entries(SCHEMA_CATALOG_QUERIES)) {
    const result = await client.query(sql);
    inventory[name] = result.rows;
  }
  const [unsupportedRelations, unsupportedTypes] = await Promise.all([
    client.query(UNSUPPORTED_PUBLIC_RELATION_CLASSES_QUERY),
    client.query(UNSUPPORTED_PUBLIC_TYPE_CLASSES_QUERY),
  ]);
  assertSupportedPublicSchemaObjects({
    unsupportedRelations: unsupportedRelations.rows,
    unsupportedTypes: unsupportedTypes.rows,
  });
  return inventory;
}
