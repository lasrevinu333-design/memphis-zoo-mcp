import { createHash } from "node:crypto";

export const SCHEMA_CATALOG_QUERIES = Object.freeze({
  extensions: `select e.extname as extension_name,case when e.extname='pg_net' then 'provider_managed' else e.extversion end as version,n.nspname as schema_name from pg_extension e join pg_namespace n on n.oid=e.extnamespace order by e.extname`,
  types: `select n.nspname as schema_name,t.typname as type_name,t.typtype as type_kind,format_type(t.typbasetype,t.typtypmod) as base_type,t.typnotnull as not_null,pg_get_expr(t.typdefaultbin,0) as default_expression,coalesce((select jsonb_agg(e.enumlabel order by e.enumsortorder) from pg_enum e where e.enumtypid=t.oid),'[]'::jsonb) as enum_labels from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname='public' and t.typtype in ('e','d') order by t.typname`,
  sequences: `select schemaname as schema_name,sequencename as sequence_name,data_type,start_value,min_value,max_value,increment_by,cycle,cache_size from pg_sequences where schemaname='public' order by sequencename`,
  tables: `select n.nspname as schema_name,c.relname as table_name,c.relkind as relation_kind,c.relrowsecurity as rls_enabled,c.relforcerowsecurity as rls_forced,pg_get_partkeydef(c.oid) as partition_key,obj_description(c.oid,'pg_class') as comment from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p') order by c.relname`,
  columns: `select n.nspname as schema_name,c.relname as table_name,a.attnum as ordinal_position,a.attname as column_name,format_type(a.atttypid,a.atttypmod) as data_type,a.attnotnull as not_null,a.attidentity as identity_kind,a.attgenerated as generated_kind,pg_get_expr(ad.adbin,ad.adrelid) as default_expression,case when a.attcollation<>t.typcollation then coll.collname else null end as collation_name,col_description(c.oid,a.attnum) as comment from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace join pg_type t on t.oid=a.atttypid left join pg_attrdef ad on ad.adrelid=a.attrelid and ad.adnum=a.attnum left join pg_collation coll on coll.oid=a.attcollation where n.nspname='public' and c.relkind in ('r','p') and a.attnum>0 and not a.attisdropped order by c.relname,a.attnum`,
  constraints: `select n.nspname as schema_name,c.relname as table_name,con.conname as constraint_name,con.contype as constraint_type,pg_get_constraintdef(con.oid,true) as definition,con.convalidated as validated from pg_constraint con join pg_class c on c.oid=con.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' order by c.relname,con.conname`,
  indexes: `select n.nspname as schema_name,c.relname as table_name,i.relname as index_name,pg_get_indexdef(ix.indexrelid) as definition,ix.indisunique as is_unique,ix.indisprimary as is_primary,exists(select 1 from pg_constraint con where con.conindid=ix.indexrelid) as backs_constraint from pg_index ix join pg_class c on c.oid=ix.indrelid join pg_class i on i.oid=ix.indexrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' order by c.relname,i.relname`,
  functions: `select n.nspname as schema_name,p.proname as function_name,pg_get_function_identity_arguments(p.oid) as identity_arguments,pg_get_functiondef(p.oid) as definition,obj_description(p.oid,'pg_proc') as comment from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' order by p.proname,pg_get_function_identity_arguments(p.oid)`,
  views: `select n.nspname as schema_name,c.relname as view_name,c.relkind as relation_kind,pg_get_viewdef(c.oid,true) as definition,obj_description(c.oid,'pg_class') as comment from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('v','m') order by c.relname`,
  triggers: `select n.nspname as schema_name,c.relname as table_name,t.tgname as trigger_name,pg_get_triggerdef(t.oid,true) as definition,t.tgenabled as enabled from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal order by c.relname,t.tgname`,
  policies: `select n.nspname as schema_name,c.relname as table_name,p.polname as policy_name,p.polpermissive as permissive,p.polcmd as command_code,coalesce((select jsonb_agg(r.rolname order by r.rolname) from unnest(p.polroles) role_oid join pg_roles r on r.oid=role_oid),'[]'::jsonb) as roles,pg_get_expr(p.polqual,p.polrelid) as using_expression,pg_get_expr(p.polwithcheck,p.polrelid) as check_expression from pg_policy p join pg_class c on c.oid=p.polrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' order by c.relname,p.polname`,
  owned_scheduler_roles: `select rolname as role_name,rolsuper as is_superuser,rolinherit as inherits_role,rolcreaterole as can_create_role,rolcreatedb as can_create_database,rolcanlogin as can_login,rolreplication as can_replicate,rolbypassrls as bypasses_rls,rolconnlimit as connection_limit from pg_roles where rolname in ('static_weekly_control_plane','static_weekly_release_operator') order by rolname`,
  owned_scheduler_role_memberships: `select parent.rolname as granted_role,member.rolname as member_role,m.admin_option from pg_auth_members m join pg_roles parent on parent.oid=m.roleid join pg_roles member on member.oid=m.member where parent.rolname in ('static_weekly_control_plane','static_weekly_release_operator') or member.rolname in ('static_weekly_control_plane','static_weekly_release_operator') order by parent.rolname,member.rolname`,
  table_grants: `select table_schema as schema_name,table_name,grantee,privilege_type,is_grantable from information_schema.role_table_grants where table_schema='public' and grantee in ('PUBLIC','anon','authenticated','service_role','static_weekly_control_plane','static_weekly_release_operator') order by table_name,grantee,privilege_type`,
  routine_grants: `select n.nspname as schema_name,p.proname as function_name,pg_get_function_identity_arguments(p.oid) as identity_arguments,coalesce(r.rolname,'PUBLIC') as grantee,x.privilege_type,x.is_grantable from pg_proc p join pg_namespace n on n.oid=p.pronamespace cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x left join pg_roles r on r.oid=x.grantee where n.nspname='public' and coalesce(r.rolname,'PUBLIC') in ('PUBLIC','anon','authenticated','service_role','static_weekly_control_plane','static_weekly_release_operator') order by p.proname,pg_get_function_identity_arguments(p.oid),grantee`,
  schema_grants: `select n.nspname as schema_name,coalesce(r.rolname,'PUBLIC') as grantee,x.privilege_type,x.is_grantable from pg_namespace n cross join lateral aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) x left join pg_roles r on r.oid=x.grantee where n.nspname='public' and coalesce(r.rolname,'PUBLIC') in ('PUBLIC','anon','authenticated','service_role','static_weekly_control_plane','static_weekly_release_operator') order by n.nspname,grantee,x.privilege_type`,
  cron_jobs: `select jobname,schedule,command,database,case when username in ('postgres','supabase_admin') then 'migration_owner' else username end as username,active from cron.job order by jobname`,
});

export const SCHEMA_CATALOG_NAMES = Object.freeze(Object.keys(SCHEMA_CATALOG_QUERIES));

export function stableSchemaJson(value) {
  if (Array.isArray(value)) return value.map(stableSchemaJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, stableSchemaJson(value[key])]),
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

export async function captureSchemaCatalog(client) {
  const inventory = {};
  for (const [name, sql] of Object.entries(SCHEMA_CATALOG_QUERIES)) {
    const result = await client.query(sql);
    inventory[name] = result.rows;
  }
  return inventory;
}
