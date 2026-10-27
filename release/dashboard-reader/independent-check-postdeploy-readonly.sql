-- Read-only catalog receipt; does not impersonate the reader or mutate data.
-- Run only through the exact authenticated Custodial project connection.
with wanted(identity) as (values
 ('custodial_release_identity.read_current_verified_dashboard_checks_v1()'),
 ('custodial_release_identity.read_current_original_dashboard_completions_v1()')),
 functions as (
 select w.identity,p.oid is not null present,r.rolname owner,p.prosecdef,p.provolatile,
 p.proconfig,md5(p.prosrc) body_md5,md5(pg_get_functiondef(p.oid)) definition_md5,
 pg_get_function_result(p.oid) result_contract,
 has_function_privilege('custodial_application_reader',p.oid,'EXECUTE') reader_execute,
 (select jsonb_agg(jsonb_build_object('grantee',coalesce(g.rolname,'PUBLIC'),
 'privilege',a.privilege_type,'grantable',a.is_grantable) order by coalesce(g.rolname,'PUBLIC'))
 from aclexplode(p.proacl) a left join pg_roles g on g.oid=a.grantee) acl
 from wanted w left join pg_proc p on p.oid=to_regprocedure(w.identity)
 left join pg_roles r on r.oid=p.proowner
)
select jsonb_build_object('scope','independent-verified-check-reader-after-deployment',
 'functions',(select jsonb_agg(to_jsonb(f) order by identity) from functions f),
 'schema',(select jsonb_build_object('owner',n.nspowner::regrole::text,'acl',n.nspacl::text,
 'reader_usage',has_schema_privilege('custodial_application_reader',n.oid,'USAGE'),
 'reader_create',has_schema_privilege('custodial_application_reader',n.oid,'CREATE'),
 'anon_usage',has_schema_privilege('anon',n.oid,'USAGE'),
 'authenticated_usage',has_schema_privilege('authenticated',n.oid,'USAGE'),
 'service_usage',has_schema_privilege('service_role',n.oid,'USAGE'))
 from pg_namespace n where n.nspname='custodial_release_identity'),
 'protected_relations',(select jsonb_agg(jsonb_build_object('identity',c.oid::regclass::text,
 'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,'policy_count',
 (select count(*) from pg_policy p where p.polrelid=c.oid)))
 from pg_class c where c.oid in('public.sessions'::regclass,'public.completion_responses'::regclass)),
 'cleaning_view_definition_md5',md5(public.custodial_release_authority_current_view_definition('public.v_location_dashboard_status')),
 'view_columns',(select jsonb_agg(attname order by attnum) from pg_attribute
 where attrelid='public.v_location_dashboard_status'::regclass and attnum>0 and not attisdropped),
 'recovery',(select jsonb_agg(jsonb_build_object('order',restore_order,'kind',object_kind,
 'identity',object_identity,'sha256',definition_sha256) order by restore_order)
 from public.custodial_release_authority_restore_inventory
 where object_identity like '%read_current_verified_dashboard_checks_v1%'),
 'inventory_guard',(select tgenabled::text from pg_trigger
 where tgrelid='public.custodial_release_authority_restore_inventory'::regclass
 and tgname='trg_custodial_release_authority_restore_inventory_immutable'));
