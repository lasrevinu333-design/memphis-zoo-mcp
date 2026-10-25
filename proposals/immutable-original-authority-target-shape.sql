-- Main-owned fixed Source extension, installed after the authority scope.
-- Derived from the pinned original immutable_import_target_shape() body;
-- the only semantic delta is sealing the reviewed authority object shape.
-- No old FINISHED import/context is adopted or modified.
CREATE OR REPLACE FUNCTION custodial_dr.immutable_import_target_shape()
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
 WITH selected_relations AS MATERIALIZED (
   SELECT c.*,n.nspname FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname IN('public','auth','storage','custodial_release_identity') AND c.relkind IN('r','p','f')
 ),
 relation_column_shapes AS MATERIALIZED (
   SELECT a.attrelid,jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),
     'notnull',a.attnotnull,'generated',a.attgenerated,'identity',a.attidentity,'acl',a.attacl,'default',pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum) AS shape
   FROM selected_relations c JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid
   LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
   WHERE a.attnum>0 AND NOT a.attisdropped GROUP BY a.attrelid
 ),
 relation_constraint_shapes AS MATERIALIZED (
   SELECT k.conrelid,jsonb_agg(jsonb_build_object('name',k.conname,'valid',k.convalidated,'type',k.contype,
     'definition',pg_get_constraintdef(k.oid,true)) ORDER BY k.conname) AS shape
   FROM selected_relations c JOIN pg_catalog.pg_constraint k ON k.conrelid=c.oid GROUP BY k.conrelid
 ),
 relation_index_shapes AS MATERIALIZED (
   SELECT i.indrelid,jsonb_agg(pg_get_indexdef(i.indexrelid) ORDER BY i.indexrelid) AS shape
   FROM selected_relations c JOIN pg_catalog.pg_index i ON i.indrelid=c.oid GROUP BY i.indrelid
 ),
 relation_policy_shapes AS MATERIALIZED (
   SELECT p.polrelid,jsonb_agg(to_jsonb(p) ORDER BY p.polname) AS shape
   FROM selected_relations c JOIN pg_catalog.pg_policy p ON p.polrelid=c.oid GROUP BY p.polrelid
 ),
 selected_triggers AS MATERIALIZED (
   SELECT t.* FROM selected_relations c JOIN pg_catalog.pg_trigger t ON t.tgrelid=c.oid WHERE NOT t.tgisinternal
 ),
 trigger_function_shapes AS MATERIALIZED (
   SELECT p.oid,p.proowner,p.proacl,p.prosecdef,p.proconfig,pg_get_functiondef(p.oid) AS definition
   FROM pg_catalog.pg_proc p JOIN (SELECT DISTINCT tgfoid FROM selected_triggers) used ON used.tgfoid=p.oid
 ),
 relation_trigger_shapes AS MATERIALIZED (
   SELECT t.tgrelid,jsonb_agg(jsonb_build_object('definition',pg_get_triggerdef(t.oid,true),'enabled',t.tgenabled,'type',t.tgtype,
     'function_oid',f.oid) ORDER BY t.tgname) AS shape
   FROM selected_triggers t JOIN trigger_function_shapes f ON f.oid=t.tgfoid GROUP BY t.tgrelid
 )
 SELECT jsonb_build_object('authority_reconciliation',custodial_dr.immutable_original_authority_scope_shape(),
 'database',current_database(),'database_oid',(SELECT oid::text FROM pg_catalog.pg_database WHERE datname=current_database()),
 'owner_contract',jsonb_build_object(
   'operator',(SELECT jsonb_build_object('oid',r.oid,'name',r.rolname,'session_user',session_user,
     'superuser',r.rolsuper,'inherit',r.rolinherit,'create_role',r.rolcreaterole,'create_database',r.rolcreatedb,
     'login',r.rolcanlogin,'replication',r.rolreplication,'bypass_rls',r.rolbypassrls,
     'connection_limit',r.rolconnlimit,'valid_until',r.rolvaliduntil)
     FROM pg_catalog.pg_roles r WHERE r.rolname=current_user),
   'database_owner',(SELECT datdba FROM pg_catalog.pg_database WHERE datname=current_database()),
   'namespaces',(SELECT jsonb_agg(jsonb_build_object('oid',n.oid,'name',n.nspname,'owner',n.nspowner,'acl',n.nspacl)
     ORDER BY n.nspname) FROM pg_catalog.pg_namespace n WHERE n.nspname IN('custodial_dr','custodial_release_identity')),
   'original_relations',(SELECT jsonb_agg(jsonb_build_object('oid',c.oid,'schema',n.nspname,'name',c.relname,
     'owner',c.relowner,'acl',c.relacl,'rls',c.relrowsecurity,'force',c.relforcerowsecurity) ORDER BY n.nspname,c.relname)
     FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE c.oid IN(
       to_regclass('custodial_dr.restore_control'),to_regclass('custodial_dr.restore_manifests'),
       to_regclass('custodial_dr.application_mutation_leases'),
       to_regclass('custodial_release_identity.group_original_creations'),
       to_regclass('custodial_release_identity.employee_message_original_outcomes'))),
   'original_guards',(SELECT jsonb_agg(jsonb_build_object('oid',p.oid,'identity',p.oid::regprocedure::text,
     'owner',p.proowner,'acl',p.proacl,'definer',p.prosecdef,'config',p.proconfig,
     'definition',pg_get_functiondef(p.oid)) ORDER BY p.oid::regprocedure::text)
     FROM pg_catalog.pg_proc p WHERE p.oid IN(to_regprocedure('custodial_dr.guard_application_mutation()'),
       to_regprocedure('custodial_release_identity.guard_group_original_creation()'),
       to_regprocedure('public.custodial_feedback_triage_immutable()')))),
 'migration_head',(SELECT max(version)::text FROM supabase_migrations.schema_migrations),
 'release',(SELECT jsonb_agg(jsonb_build_object('release_id',release_id,'backend_commit',backend_commit,'frontend_commit',frontend_commit,
   'migration_head',migration_head,'migration_manifest_sha256',migration_manifest_sha256) ORDER BY release_id)
   FROM public.release_deployment_manifest WHERE status='deployed'),
 -- Current target SOURCE metadata, initialized under the real unexposed
 -- bootstrap fence before begin(). This is NOT its archive-file digest or
 -- proof of initializer provenance. Bind EVERY typed row/field, including
 -- inventory identity/order/captured_at, for each later assert_context().
 'recovery_inventory',custodial_dr.immutable_import_source_inventory_state(),
 'trigger_functions',(SELECT jsonb_agg(jsonb_build_object('oid',f.oid,'definition',f.definition,
   'owner',f.proowner,'acl',f.proacl,'definer',f.prosecdef,'config',f.proconfig) ORDER BY f.oid)
   FROM trigger_function_shapes f),
 'relations',(SELECT jsonb_agg(jsonb_build_object('oid',c.oid,'schema',c.nspname,'name',c.relname,'owner',c.relowner,
   'kind',c.relkind,'partition',c.relispartition,'persistence',c.relpersistence,'acl',c.relacl,'rls',c.relrowsecurity,'force',c.relforcerowsecurity,
   'columns',column_shape.shape,'constraints',constraint_shape.shape,'indexes',index_shape.shape,
   'policies',policy_shape.shape,'triggers',trigger_shape.shape)
   ORDER BY c.nspname,c.relname) FROM selected_relations c
   LEFT JOIN relation_column_shapes column_shape ON column_shape.attrelid=c.oid
   LEFT JOIN relation_constraint_shapes constraint_shape ON constraint_shape.conrelid=c.oid
   LEFT JOIN relation_index_shapes index_shape ON index_shape.indrelid=c.oid
   LEFT JOIN relation_policy_shapes policy_shape ON policy_shape.polrelid=c.oid
   LEFT JOIN relation_trigger_shapes trigger_shape ON trigger_shape.tgrelid=c.oid))
$fn$;

