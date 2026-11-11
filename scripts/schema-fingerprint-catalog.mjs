import { createHash } from "node:crypto";
import { types } from "node:util";

// Closed Source302 namespaces; caller input never selects database scope.
export const APPLICATION_PRIVATE_SCHEMAS = Object.freeze(["custodial_employment","custodial_coverall","custodial_leadership_private"]);

export const SCHEMA_CATALOG_QUERIES = Object.freeze({
  extensions: `select e.extname as extension_name,case when e.extname='pg_net' then 'provider_managed' else e.extversion end as version,n.nspname as schema_name from pg_extension e join pg_namespace n on n.oid=e.extnamespace order by e.extname`,
  types: `select n.nspname as schema_name,t.typname as type_name,t.typtype as type_kind,case when pg_get_userbyid(t.typowner) in ('postgres','supabase_admin') then 'migration_owner' else pg_get_userbyid(t.typowner) end as owner_name,format_type(t.typbasetype,t.typtypmod) as base_type,t.typnotnull as not_null,pg_get_expr(t.typdefaultbin,0) as default_expression,coalesce((select jsonb_agg(e.enumlabel order by e.enumsortorder) from pg_enum e where e.enumtypid=t.oid),'[]'::jsonb) as enum_labels from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname in ('public','custodial_employment','custodial_coverall','custodial_leadership_private') and t.typtype in ('e','d') order by n.nspname,t.typname`,
  sequences: `select schemaname as schema_name,sequencename as sequence_name,case when sequenceowner in ('postgres','supabase_admin') then 'migration_owner' else sequenceowner end as owner_name,data_type,start_value,min_value,max_value,increment_by,cycle,cache_size from pg_sequences where schemaname in ('public','custodial_employment','custodial_coverall','custodial_leadership_private') order by schemaname,sequencename`,
  tables: `select n.nspname as schema_name,c.relname as table_name,c.relkind as relation_kind,case when pg_get_userbyid(c.relowner) in ('postgres','supabase_admin') then 'migration_owner' else pg_get_userbyid(c.relowner) end as owner_name,c.relrowsecurity as rls_enabled,c.relforcerowsecurity as rls_forced,pg_get_partkeydef(c.oid) as partition_key,obj_description(c.oid,'pg_class') as object_comment from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','custodial_employment','custodial_coverall','custodial_leadership_private') and c.relkind in ('r','p') order by n.nspname,c.relname`,
  columns: `select n.nspname as schema_name,c.relname as table_name,a.attnum as ordinal_position,a.attname as column_name,format_type(a.atttypid,a.atttypmod) as data_type,a.attnotnull as not_null,a.attidentity as identity_kind,a.attgenerated as generated_kind,pg_get_expr(ad.adbin,ad.adrelid) as default_expression,case when a.attcollation<>t.typcollation then coll.collname else null end as collation_name,col_description(c.oid,a.attnum) as object_comment from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace join pg_type t on t.oid=a.atttypid left join pg_attrdef ad on ad.adrelid=a.attrelid and ad.adnum=a.attnum left join pg_collation coll on coll.oid=a.attcollation where n.nspname in ('public','custodial_employment','custodial_coverall','custodial_leadership_private') and c.relkind in ('r','p') and a.attnum>0 and not a.attisdropped order by n.nspname,c.relname,a.attnum`,
  constraints: `select n.nspname as schema_name,c.relname as table_name,con.conname as constraint_name,con.contype as constraint_type,pg_get_constraintdef(con.oid,true) as definition,con.convalidated as validated from pg_constraint con join pg_class c on c.oid=con.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','custodial_employment','custodial_coverall','custodial_leadership_private') order by n.nspname,c.relname,con.conname`,
  indexes: `select n.nspname as schema_name,c.relname as table_name,i.relname as index_name,pg_get_indexdef(ix.indexrelid) as definition,ix.indisunique as is_unique,ix.indisprimary as is_primary,exists(select 1 from pg_constraint con where con.conindid=ix.indexrelid) as backs_constraint from pg_index ix join pg_class c on c.oid=ix.indrelid join pg_class i on i.oid=ix.indexrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','custodial_employment','custodial_coverall','custodial_leadership_private') order by n.nspname,c.relname,i.relname`,
  functions: `select n.nspname as schema_name,p.proname as function_name,pg_get_function_identity_arguments(p.oid) as identity_arguments,case when pg_get_userbyid(p.proowner) in ('postgres','supabase_admin') then 'migration_owner' else pg_get_userbyid(p.proowner) end as owner_name,pg_get_functiondef(p.oid) as definition,obj_description(p.oid,'pg_proc') as object_comment from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','custodial_recovery','custodial_employment','custodial_coverall','custodial_leadership_private') order by n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)`,
  views: `select n.nspname as schema_name,c.relname as view_name,c.relkind as relation_kind,case when pg_get_userbyid(c.relowner) in ('postgres','supabase_admin') then 'migration_owner' else pg_get_userbyid(c.relowner) end as owner_name,pg_get_viewdef(c.oid,true) as definition,obj_description(c.oid,'pg_class') as object_comment from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','custodial_employment','custodial_coverall','custodial_leadership_private') and c.relkind in ('v','m') order by n.nspname,c.relname`,
  triggers: `select n.nspname as schema_name,c.relname as table_name,t.tgname as trigger_name,pg_get_triggerdef(t.oid,true) as definition,t.tgenabled as enabled from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','custodial_employment','custodial_coverall','custodial_leadership_private') and not t.tgisinternal order by n.nspname,c.relname,t.tgname`,
  policies: `select n.nspname as schema_name,c.relname as table_name,p.polname as policy_name,p.polpermissive as permissive,p.polcmd as command_code,coalesce((select jsonb_agg(r.rolname order by r.rolname) from unnest(p.polroles) role_oid join pg_roles r on r.oid=role_oid),'[]'::jsonb) as roles,pg_get_expr(p.polqual,p.polrelid) as using_expression,pg_get_expr(p.polwithcheck,p.polrelid) as check_expression from pg_policy p join pg_class c on c.oid=p.polrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','custodial_employment','custodial_coverall','custodial_leadership_private') order by n.nspname,c.relname,p.polname`,
  owned_scheduler_roles: `select rolname as role_name,rolsuper as is_superuser,rolinherit as inherits_role,rolcreaterole as can_create_role,rolcreatedb as can_create_database,rolcanlogin as can_login,rolreplication as can_replicate,rolbypassrls as bypasses_rls,rolconnlimit as connection_limit from pg_roles where rolname in ('static_weekly_control_plane','static_weekly_release_operator','static_weekly_runtime_20260823') order by rolname`,
  owned_scheduler_role_memberships: `select distinct parent.rolname as granted_role,case when member.rolname in ('postgres','supabase_admin') then 'migration_owner' else member.rolname end as member_role,case when member.rolname in ('postgres','supabase_admin') then false else m.admin_option end as admin_option from pg_auth_members m join pg_roles parent on parent.oid=m.roleid join pg_roles member on member.oid=m.member left join pg_roles grantor on grantor.oid=m.grantor where (parent.rolname in ('static_weekly_control_plane','static_weekly_release_operator','static_weekly_runtime_20260823') or member.rolname in ('static_weekly_control_plane','static_weekly_release_operator','static_weekly_runtime_20260823')) and not (parent.rolname='static_weekly_runtime_20260823' and member.rolname in ('postgres','supabase_admin') and grantor.rolname in ('postgres','supabase_admin') and m.admin_option and parent.rolcanlogin and not parent.rolsuper and not parent.rolinherit and not parent.rolcreaterole and not parent.rolcreatedb and not parent.rolreplication and not parent.rolbypassrls) order by parent.rolname,member_role`,
  privilege_bearing_roles: `select rolname as role_name,rolsuper as is_superuser,rolinherit as inherits_role,rolcreaterole as can_create_role,rolcreatedb as can_create_database,rolcanlogin as can_login,rolreplication as can_replicate,rolbypassrls as bypasses_rls,rolconnlimit as connection_limit,rolvaliduntil as valid_until,rolconfig as role_config from pg_roles where rolname in ('memphis_zoo_backup','static_weekly_control_plane','static_weekly_release_operator','static_weekly_runtime_20260823') order by rolname`,
  role_memberships: `select distinct parent.rolname as granted_role,case when member.rolname in ('postgres','supabase_admin') then 'migration_owner' else member.rolname end as member_role,case when grantor.rolname in ('postgres','supabase_admin') then 'migration_owner' else grantor.rolname end as grantor_role,case when parent.rolname in ('static_weekly_control_plane','static_weekly_release_operator') and member.rolname in ('postgres','supabase_admin') then false else m.admin_option end as admin_option from pg_auth_members m join pg_roles parent on parent.oid=m.roleid join pg_roles member on member.oid=m.member left join pg_roles grantor on grantor.oid=m.grantor where not (parent.rolname='memphis_zoo_backup' and member.rolname in ('postgres','supabase_admin')) and parent.rolname<>'custodial_application_reader' and not (parent.rolname='static_weekly_runtime_20260823' and member.rolname in ('postgres','supabase_admin') and grantor.rolname in ('postgres','supabase_admin') and m.admin_option and parent.rolcanlogin and not parent.rolsuper and not parent.rolinherit and not parent.rolcreaterole and not parent.rolcreatedb and not parent.rolreplication and not parent.rolbypassrls) and not (parent.rolname~'^custodial_readonly_runtime_[0-9]{8}$' and member.rolname in ('postgres','supabase_admin') and parent.rolcanlogin and not parent.rolsuper and not parent.rolcreaterole and not parent.rolcreatedb and not parent.rolreplication and not parent.rolbypassrls and exists (select 1 from pg_auth_members reader_membership join pg_roles reader_parent on reader_parent.oid=reader_membership.roleid where reader_membership.member=parent.oid and reader_parent.rolname='custodial_application_reader')) order by parent.rolname,member_role,grantor_role,admin_option`,
  table_grants: `select n.nspname as schema_name,c.relname as table_name,coalesce(grantee.rolname,'PUBLIC') as grantee,case when grantor.rolname in ('postgres','supabase_admin') then 'migration_owner' else grantor.rolname end as grantor,x.privilege_type,x.is_grantable from pg_class c join pg_namespace n on n.oid=c.relnamespace cross join lateral aclexplode(coalesce(c.relacl,acldefault(case when c.relkind='S' then 'S'::"char" else 'r'::"char" end,c.relowner))) x left join pg_roles grantee on grantee.oid=x.grantee left join pg_roles grantor on grantor.oid=x.grantor where n.nspname in ('public','custodial_employment','custodial_coverall','custodial_leadership_private') and c.relkind in ('r','p','v','m') and (n.nspname<>'public' or coalesce(grantee.rolname,'PUBLIC') not in ('postgres','supabase_admin')) order by n.nspname,c.relname,grantee,grantor,x.privilege_type`,
  column_grants: `select n.nspname as schema_name,c.relname as table_name,a.attname as column_name,coalesce(grantee.rolname,'PUBLIC') as grantee,case when grantor.rolname in ('postgres','supabase_admin') then 'migration_owner' else grantor.rolname end as grantor,x.privilege_type,x.is_grantable from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace cross join lateral aclexplode(a.attacl) x left join pg_roles grantee on grantee.oid=x.grantee left join pg_roles grantor on grantor.oid=x.grantor where n.nspname in ('public','custodial_employment','custodial_coverall','custodial_leadership_private') and a.attnum>0 and not a.attisdropped and a.attacl is not null and (n.nspname<>'public' or coalesce(grantee.rolname,'PUBLIC') not in ('postgres','supabase_admin')) order by n.nspname,c.relname,a.attname,grantee,grantor,x.privilege_type`,
  sequence_grants: `select n.nspname as schema_name,c.relname as sequence_name,coalesce(grantee.rolname,'PUBLIC') as grantee,case when grantor.rolname in ('postgres','supabase_admin') then 'migration_owner' else grantor.rolname end as grantor,x.privilege_type,x.is_grantable from pg_class c join pg_namespace n on n.oid=c.relnamespace cross join lateral aclexplode(coalesce(c.relacl,acldefault('S',c.relowner))) x left join pg_roles grantee on grantee.oid=x.grantee left join pg_roles grantor on grantor.oid=x.grantor where n.nspname in ('public','custodial_employment','custodial_coverall','custodial_leadership_private') and c.relkind='S' and (n.nspname<>'public' or coalesce(grantee.rolname,'PUBLIC') not in ('postgres','supabase_admin')) order by n.nspname,c.relname,grantee,grantor,x.privilege_type`,
  routine_grants: `select n.nspname as schema_name,p.proname as function_name,pg_get_function_identity_arguments(p.oid) as identity_arguments,case when coalesce(grantee.rolname,'PUBLIC') in ('postgres','supabase_admin') then 'migration_owner' else coalesce(grantee.rolname,'PUBLIC') end as grantee,case when grantor.rolname in ('postgres','supabase_admin') then 'migration_owner' else grantor.rolname end as grantor,x.privilege_type,x.is_grantable from pg_proc p join pg_namespace n on n.oid=p.pronamespace cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x left join pg_roles grantee on grantee.oid=x.grantee left join pg_roles grantor on grantor.oid=x.grantor where n.nspname in ('public','custodial_recovery','custodial_employment','custodial_coverall','custodial_leadership_private') and (n.nspname<>'public' or coalesce(grantee.rolname,'PUBLIC') not in ('postgres','supabase_admin')) order by n.nspname,p.proname,pg_get_function_identity_arguments(p.oid),grantee,grantor,x.privilege_type`,
  type_grants: `select n.nspname as schema_name,t.typname as type_name,coalesce(grantee.rolname,'PUBLIC') as grantee,case when grantor.rolname in ('postgres','supabase_admin') then 'migration_owner' else grantor.rolname end as grantor,x.privilege_type,x.is_grantable from pg_type t join pg_namespace n on n.oid=t.typnamespace cross join lateral aclexplode(coalesce(t.typacl,acldefault('T',t.typowner))) x left join pg_roles grantee on grantee.oid=x.grantee left join pg_roles grantor on grantor.oid=x.grantor where n.nspname in ('public','custodial_employment','custodial_coverall','custodial_leadership_private') and t.typtype in ('e','d') and (n.nspname<>'public' or coalesce(grantee.rolname,'PUBLIC') not in ('postgres','supabase_admin')) order by n.nspname,t.typname,grantee,grantor,x.privilege_type`,
  schema_grants: `select n.nspname as schema_name,case when coalesce(grantee.rolname,'PUBLIC') in ('postgres','supabase_admin') then 'migration_owner' else coalesce(grantee.rolname,'PUBLIC') end as grantee,case when grantor.rolname in ('postgres','supabase_admin') then 'migration_owner' else grantor.rolname end as grantor,x.privilege_type,x.is_grantable from pg_namespace n cross join lateral aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) x left join pg_roles grantee on grantee.oid=x.grantee left join pg_roles grantor on grantor.oid=x.grantor where n.nspname in ('public','custodial_recovery','custodial_employment','custodial_coverall','custodial_leadership_private') order by n.nspname,grantee,grantor,x.privilege_type`,
  default_privileges: `select distinct 'migration_owner' as owner_role,n.nspname as schema_name,d.defaclobjtype as object_type,grantee.rolname as grantee,'migration_owner' as grantor,x.privilege_type,x.is_grantable from pg_default_acl d join pg_roles owner on owner.oid=d.defaclrole left join pg_namespace n on n.oid=d.defaclnamespace cross join lateral aclexplode(d.defaclacl) x join pg_roles grantee on grantee.oid=x.grantee where owner.rolname in ('postgres','supabase_admin') and (n.nspname='public' or d.defaclnamespace=0) and grantee.rolname='service_role' order by n.nspname,d.defaclobjtype,grantee,x.privilege_type`,
  cron_jobs: `select jobname,schedule,command,database,case when username in ('postgres','supabase_admin') then 'migration_owner' else username end as username,active from custodial_release_identity.custodial_schema_identity_cron_jobs() order by jobname`,
});

export const SCHEMA_CATALOG_NAMES = Object.freeze(Object.keys(SCHEMA_CATALOG_QUERIES));
// Fixed, separate optional section: do not add empty metadata to historical
// public-only catalogs or reinterpret an archived inventory during hashing.
// Namespace ownership is independent of function ownership and namespace ACL.
export const RECOVERY_SCHEMA_OWNERS_QUERY = `select n.nspname as schema_name,case when pg_get_userbyid(n.nspowner) in ('postgres','supabase_admin') then 'migration_owner' else pg_get_userbyid(n.nspowner) end as owner_name from pg_namespace n where n.nspname='custodial_recovery' order by n.nspname`;
// Keep the existing query exports/capture format. custodial_recovery is a
// fixed function-only namespace: ANY relation or type there is unsupported,
// not silently excluded table DATA. No schema names come from the caller.
export const UNSUPPORTED_PUBLIC_RELATION_CLASSES_QUERY = `select n.nspname as schema_name,c.relname as relation_name,c.relkind as relation_kind from pg_class c join pg_namespace n on n.oid=c.relnamespace where (n.nspname in ('public','custodial_employment','custodial_coverall','custodial_leadership_private') and c.relkind in ('f')) or n.nspname='custodial_recovery' or (n.nspname in ('custodial_employment','custodial_coverall','custodial_leadership_private') and (c.relispartition or c.relkind not in ('r','S','v','m','i','I'))) order by n.nspname,c.relkind,c.relname`;
export const UNSUPPORTED_PUBLIC_TYPE_CLASSES_QUERY = `select n.nspname as schema_name,t.typname as type_name,t.typtype as type_kind from pg_type t join pg_namespace n on n.oid=t.typnamespace left join pg_class c on c.oid=t.typrelid where (n.nspname='public' and t.typtype='c' and c.relkind='c') or n.nspname='custodial_recovery' or (n.nspname in ('custodial_employment','custodial_coverall','custodial_leadership_private') and ((t.typtype='c' and coalesce(c.relkind,'') not in ('r','p','v','m')) or (t.typtype not in ('e','d','c') and not(t.typtype='b' and t.typcategory='A' and t.typelem<>0)))) order by n.nspname,t.typtype,t.typname`;


export const APPLICATION_PRIVATE_SCHEMA_OWNERS_QUERY = `select n.nspname as schema_name,case when pg_get_userbyid(n.nspowner) in ('postgres','supabase_admin') then 'migration_owner' else pg_get_userbyid(n.nspowner) end as owner_name from pg_namespace n where n.nspname in ('custodial_employment','custodial_coverall','custodial_leadership_private') order by n.nspname`;
export const APPLICATION_PRIVATE_DEFAULT_PRIVILEGES_QUERY = `select case when owner.rolname in ('postgres','supabase_admin') then 'migration_owner' else owner.rolname end as owner_role,n.nspname as schema_name,d.defaclobjtype as object_type,case when x.grantee=0 then 'PUBLIC' else grantee.rolname end as grantee,case when grantor.rolname in ('postgres','supabase_admin') then 'migration_owner' else grantor.rolname end as grantor,x.privilege_type,x.is_grantable from pg_default_acl d join pg_roles owner on owner.oid=d.defaclrole left join pg_namespace n on n.oid=d.defaclnamespace left join lateral aclexplode(d.defaclacl) x on true left join pg_roles grantee on grantee.oid=x.grantee left join pg_roles grantor on grantor.oid=x.grantor where (n.nspname in ('custodial_employment','custodial_coverall','custodial_leadership_private') or (d.defaclnamespace=0 and exists(select 1 from pg_namespace owned where owned.nspname in ('custodial_employment','custodial_coverall','custodial_leadership_private') and has_schema_privilege(d.defaclrole,owned.oid,'CREATE')) and (owner.rolname in ('postgres','supabase_admin') and grantee.rolname='service_role') is not true)) order by n.nspname,d.defaclobjtype,owner_role,grantee,grantor,x.privilege_type,x.is_grantable`;
export const APPLICATION_PRIVATE_DOMAIN_CONSTRAINTS_QUERY = `select n.nspname as schema_name,t.typname as table_name,con.conname as constraint_name,con.contype as constraint_type,pg_get_constraintdef(con.oid,true) as definition,con.convalidated as validated from pg_constraint con join pg_type t on t.oid=con.contypid join pg_namespace n on n.oid=t.typnamespace where n.nspname in ('custodial_employment','custodial_coverall','custodial_leadership_private') order by n.nspname,t.typname,con.conname`;
export function validateApplicationPrivateSchemaOwners(value) {
 const bad=()=>{throw Error('Invalid private_schema_owners canonical metadata');};
 if(!Array.isArray(value)||types.isProxy(value)||Object.getPrototypeOf(value)!==Array.prototype)bad();
 const props=Object.getOwnPropertyDescriptors(value),length=props.length?.value;
 if(!Number.isSafeInteger(length)||length<1||length>3||Reflect.ownKeys(props).length!==length+1)bad();
 const seen=new Set(),rows=[];
 for(let i=0;i<length;i++){
  const d=props[i];if(!d||!Object.hasOwn(d,'value')||!d.enumerable)bad();const row=d.value;
  if(!row||types.isProxy(row)||Object.getPrototypeOf(row)!==Object.prototype)bad();
  const f=Object.getOwnPropertyDescriptors(row);if(Reflect.ownKeys(f).length!==2)bad();
  if(!f.schema_name||!f.owner_name||!Object.hasOwn(f.schema_name,'value')||!Object.hasOwn(f.owner_name,'value')||!f.schema_name.enumerable||!f.owner_name.enumerable)bad();
  const schema=f.schema_name.value,owner=f.owner_name.value;
  if(!APPLICATION_PRIVATE_SCHEMAS.includes(schema)||seen.has(schema)||typeof owner!=='string'||!owner.length||owner.includes('\0')||Buffer.byteLength(owner,'utf8')>63||Buffer.from(owner,'utf8').toString('utf8')!==owner)bad();
  seen.add(schema);rows.push({schema_name:schema,owner_name:owner});
 }
 return rows;
}
export function applicationPrivateOwnerSection(catalog) {
 const d=Object.getOwnPropertyDescriptor(catalog,'private_schema_owners');
 const rows=d?(()=>{if(!Object.hasOwn(d,'value')||!d.enumerable)throw Error('Invalid private_schema_owners canonical metadata');return validateApplicationPrivateSchemaOwners(d.value);})():[];
 const owners=new Set(rows.map(r=>r.schema_name));
 for(const name of SCHEMA_CATALOG_NAMES){
  const value=Object.getOwnPropertyDescriptor(catalog,name);if(!value||!Object.hasOwn(value,'value')||!Array.isArray(value.value))throw Error('The complete canonical catalog is required');
  for(const row of value.value){const schema=row&&Object.getOwnPropertyDescriptor(row,'schema_name');
   if(schema&&!Object.hasOwn(schema,'value'))throw Error('Canonical schema metadata getters refused');
   if(schema&&APPLICATION_PRIVATE_SCHEMAS.includes(schema.value)&&!owners.has(schema.value))throw Error('Missing private_schema_owners for captured private objects');}
 }
 return d?['private_schema_owners']:[];
}

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
  if(Object.getOwnPropertyDescriptor(inventory,'private_schema_owners'))applicationPrivateOwnerSection(inventory);
  else for(const entry of Object.values(Object.getOwnPropertyDescriptors(inventory))){
   if(!Object.hasOwn(entry,'value')||!Array.isArray(entry.value))continue;
   for(const row of entry.value){const schema=row&&Object.getOwnPropertyDescriptor(row,'schema_name');
    if(schema&&Object.hasOwn(schema,'value')&&APPLICATION_PRIVATE_SCHEMAS.includes(schema.value))throw Error('Missing private_schema_owners for captured private objects');}
  }
  const normalized = stableSchemaJson(inventory);
  return {
    normalized,
    fingerprint: createHash("sha256").update(JSON.stringify(normalized)).digest("hex"),
  };
}

function assertSupportedPublicSchemaObjects({ unsupportedRelations, unsupportedTypes }) {
  for (const relation of unsupportedRelations) {
    if (relation.schema_name === "custodial_recovery") {
      throw new Error(`Unsupported custodial_recovery relation class ${relation.relation_kind} must be reviewed before schema fingerprint capture: ${relation.relation_name}`);
    }
    if (relation.relation_kind === "f") {
      throw new Error(`Unsupported ${relation.schema_name === "public" ? "public" : "selected"} foreign table must be reviewed before schema fingerprint capture: ${relation.relation_name}`);
    }
    throw new Error(`Unsupported selected relation class ${relation.relation_kind} must be reviewed before schema fingerprint capture: ${relation.relation_name}`);
  }
  for (const type of unsupportedTypes) {
    if (type.schema_name === "custodial_recovery") {
      throw new Error(`Unsupported custodial_recovery type class ${type.type_kind} must be reviewed before schema fingerprint capture: ${type.type_name}`);
    }
    if (type.type_kind === "c") {
      throw new Error(`Unsupported ${type.schema_name === "public" ? "public" : "selected"} composite type must be reviewed before schema fingerprint capture: ${type.type_name}`);
    }
    throw new Error(`Unsupported selected type class ${type.type_kind} must be reviewed before schema fingerprint capture: ${type.type_name}`);
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
  const owners = await client.query(RECOVERY_SCHEMA_OWNERS_QUERY);
  const ownerFailure = () => new Error('Complete custodial_recovery namespace owner metadata required for catalog capture.');
  if (!Array.isArray(owners?.rows) || owners.rows.length > 1) throw ownerFailure();
  const privateRows = ['functions', 'routine_grants', 'schema_grants']
    .some(name => inventory[name].some(row => row?.schema_name === 'custodial_recovery'));
  if (owners.rows.length === 0) {
    if (privateRows) throw ownerFailure();
    // Actual absence in the same caller-owned snapshot, not an unknown owner
    // default. Keep the original public-only JSON and fingerprint unchanged.
  } else {
    const row = owners.rows[0];
    if (!row || Object.getPrototypeOf(row) !== Object.prototype || Reflect.ownKeys(row).length !== 2) throw ownerFailure();
    const fields = Object.getOwnPropertyDescriptors(row);
    if (!Object.hasOwn(fields.schema_name ?? {}, 'value') || !Object.hasOwn(fields.owner_name ?? {}, 'value')) throw ownerFailure();
    const schema = fields.schema_name.value, owner = fields.owner_name.value;
    if (schema !== 'custodial_recovery' || typeof owner !== 'string' || !owner.length || owner.includes('\0')
        || Buffer.from(owner, 'utf8').toString('utf8') !== owner) throw ownerFailure();
    inventory.recovery_schema_owners = [{schema_name: schema, owner_name: owner}];
  }
  const privateOwnersReply=await client.query(APPLICATION_PRIVATE_SCHEMA_OWNERS_QUERY);
  const privateOwners=Object.getOwnPropertyDescriptor(privateOwnersReply,'rows');
  if(!privateOwners||!Object.hasOwn(privateOwners,'value')||!Array.isArray(privateOwners.value))throw Error('Complete private schema namespace owner census required');
  if(types.isProxy(privateOwners.value)||Object.getPrototypeOf(privateOwners.value)!==Array.prototype)throw Error('Complete private schema namespace owner census required');
  const ownerFields=Object.getOwnPropertyDescriptors(privateOwners.value),ownerCount=ownerFields.length?.value;
  if(!Number.isSafeInteger(ownerCount)||ownerCount<0||ownerCount>3||Reflect.ownKeys(ownerFields).length!==ownerCount+1)throw Error('Complete private schema namespace owner census required');
  if(ownerCount){
   inventory.private_schema_owners=validateApplicationPrivateSchemaOwners(privateOwners.value);
   // Retain the historical public/global query and array order byte-for-byte.
   // Empty private default ACLs remain explicit NULL privilege tuples, not absence.
   inventory.default_privileges=inventory.default_privileges.concat((await client.query(APPLICATION_PRIVATE_DEFAULT_PRIVILEGES_QUERY)).rows);
   inventory.constraints=inventory.constraints.concat((await client.query(APPLICATION_PRIVATE_DOMAIN_CONSTRAINTS_QUERY)).rows);
  }
  applicationPrivateOwnerSection(inventory);
  return inventory;
}
