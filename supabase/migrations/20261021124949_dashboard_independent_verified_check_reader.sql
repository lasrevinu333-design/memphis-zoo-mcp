-- Canonical current-source independent genuine check-only Dashboard reader.
-- Normal declared-source actor/schema/original reader owner remain supabase_admin.
-- The observed-live postgres repair remains separately pinned in forward-source/.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
set local check_function_bodies=on;
set local search_path=pg_catalog,public;
-- Canonical fresh-source installation only, after the exact declared288.
-- Preserve its existing original source actor and private reader owner family.
do $target$
begin
 if current_user<>'supabase_admin' or session_user<>current_user then
  raise exception 'Expected unchanged normal canonical supabase_admin source actor';end if;
 if not exists(select 1 from pg_roles where rolname='custodial_application_reader'
  and not rolsuper and not rolbypassrls and not rolcanlogin and not rolcreaterole
  and not rolcreatedb and not rolreplication) then
  raise exception 'Existing restricted application reader required';end if;
 if to_regclass('public.custodial_release_authority_restore_inventory') is null
  or to_regprocedure('public.custodial_release_authority_current_grant_definition(text)') is null
  or to_regprocedure('public.static_weekly_digest_text(text)') is null
  or to_regprocedure('public.custodial_release_canary_authority_surface()') is null then
  raise exception 'Canonical release recovery prerequisites missing';end if;
 if not exists(select 1 from pg_trigger where tgrelid='public.custodial_release_authority_restore_inventory'::regclass
  and tgname='trg_custodial_release_authority_restore_inventory_immutable' and tgenabled in('O','A')) then
  raise exception 'Expected enabled canonical inventory guard';end if;
end $target$;
lock table public.custodial_release_authority_restore_inventory in share row exclusive mode;
create temporary table dashboard_recovery_guard_before on commit drop as
 select tgenabled::text enabled from pg_trigger
 where tgrelid='public.custodial_release_authority_restore_inventory'::regclass
 and tgname='trg_custodial_release_authority_restore_inventory_immutable';

-- The current plain SELECT silently loses check records because sessions
-- and completion_responses have FORCE RLS with no application-reader policies.
-- Reuse the existing private reader boundary, with the exact pre-existing
-- fixed check-only SELECT; never grant direct protected-table access.
do $independent_check_preflight$
declare dependency record;column_name text;
begin
 if not exists(select 1 from pg_namespace where nspname='custodial_release_identity' and nspowner='supabase_admin'::regrole)
  or not has_schema_privilege('custodial_application_reader','custodial_release_identity','USAGE')
  or has_schema_privilege('custodial_application_reader','custodial_release_identity','CREATE')
  or has_schema_privilege('anon','custodial_release_identity','USAGE')
  or has_schema_privilege('authenticated','custodial_release_identity','USAGE')
  or has_schema_privilege('service_role','custodial_release_identity','USAGE') then
  raise exception 'Existing canonical private backend-read schema admission required';end if;
 if not exists(select 1 from pg_proc p where p.oid=to_regprocedure('custodial_release_identity.read_current_original_dashboard_completions_v1()')
  and p.proowner='supabase_admin'::regrole and p.prosecdef and p.provolatile='s'
  and p.proconfig=array['search_path=pg_catalog, public']::text[] and md5(p.prosrc)='b80ecc247cc6d966b0b09ff70f19c47c') then
  raise exception 'Existing original Dashboard reader must remain exact';end if;
 if (select array_agg(coalesce(r.rolname,'PUBLIC')||':'||a.privilege_type||':'||a.is_grantable::text order by coalesce(r.rolname,'PUBLIC'))
  from pg_proc p cross join lateral aclexplode(p.proacl) a left join pg_roles r on r.oid=a.grantee
  where p.oid='custodial_release_identity.read_current_original_dashboard_completions_v1()'::regprocedure)
  is distinct from array['custodial_application_reader:EXECUTE:false','supabase_admin:EXECUTE:false']::text[] then
  raise exception 'Existing original Dashboard reader owner/reader ACL changed';end if;
 if (select count(*) from pg_class where oid in(to_regclass('public.sessions'),to_regclass('public.completion_responses'))
  and relrowsecurity and relforcerowsecurity)<>2 then
  raise exception 'Existing protected session/completion FORCE RLS required';end if;
 for dependency in select * from (values
  ('public.custodial_offline_reconciliation_records',array['client_completion_id','client_session_id','completion_response_id','context_id','credential_id','device_id','location_id','occurrence_fingerprint','occurrence_id','original_employee_id','payload_json','reconciliation_id','session_id','state']::text[]),
  ('public.custodial_offline_actor_contexts',array['client_session_id','context_id','credential_id','device_id','employee_id','location_id','native_completed_at','native_completion_attestation_sha256','native_completion_attestation_version','native_finish_scan_entry_id','native_scan_entry_id','native_start_attestation_version','occurrence_fingerprint','occurrence_id','started_at','status']::text[]),
  ('public.sessions',array['client_session_id','device_id','employee_id','ended_at','id','location_id','session_uuid','started_at','status']::text[]),
  ('public.completion_responses',array['client_completion_id','device_id','id','location_id','response_json','session_id','submitted_by_employee_id']::text[]),
  ('public.employees',array['display_name','id']::text[]),
  ('public.custodial_offline_scan_event_evidence',array['client_event_id','context_id','event_payload','reconciliation_id','session_id']::text[])
 ) expected(identity,columns) loop
  if to_regclass(dependency.identity) is null then raise exception 'Missing independent check reader relation: %',dependency.identity;end if;
  foreach column_name in array dependency.columns loop
   if not exists(select 1 from pg_attribute where attrelid=to_regclass(dependency.identity)
    and attname=column_name and attnum>0 and not attisdropped) then
    raise exception 'Missing independent check reader column: %.%',dependency.identity,column_name;end if;
  end loop;
 end loop;
 if to_regprocedure('custodial_release_identity.read_current_verified_dashboard_checks_v1()') is not null
  and not exists(select 1 from pg_proc p where p.oid=to_regprocedure('custodial_release_identity.read_current_verified_dashboard_checks_v1()')
   and p.proowner='supabase_admin'::regrole and p.prosecdef and p.provolatile='s' and p.proretset
   and p.proconfig=array['search_path=pg_catalog, public']::text[]
   and md5(p.prosrc)='64eca95488a9e8ff03a422557a3e49b6') then
  raise exception 'Independent verified-check reader predecessor changed';end if;
end $independent_check_preflight$;
create temporary table independent_check_reader_preserved on commit drop as
 select md5(pg_get_functiondef('custodial_release_identity.read_current_original_dashboard_completions_v1()'::regprocedure)) original_reader_md5,
 md5(public.custodial_release_authority_current_view_definition('public.v_location_dashboard_status')) cleaning_view_md5;
CREATE OR REPLACE FUNCTION custodial_release_identity.read_current_verified_dashboard_checks_v1()
RETURNS TABLE(location_id uuid,latest_verified_check_at timestamptz,
 latest_verified_checker_name text,latest_verified_check_session_uuid text,
 latest_verified_check_completion_id text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public
AS $function$
      select distinct on (receipt.location_id)
        receipt.location_id, context.native_completed_at as latest_verified_check_at,
        employee.display_name as latest_verified_checker_name,
        session.session_uuid as latest_verified_check_session_uuid,
        response.client_completion_id as latest_verified_check_completion_id
      from public.custodial_offline_reconciliation_records receipt
      join public.custodial_offline_actor_contexts context on context.context_id=receipt.context_id
      join public.sessions session on session.id=receipt.session_id
      join public.completion_responses response on response.id=receipt.completion_response_id
      join public.employees employee on employee.id=session.employee_id
      where receipt.state='committed' and context.status='committed' and session.status='closed'
        and receipt.occurrence_id=context.occurrence_id
        and receipt.occurrence_fingerprint=context.occurrence_fingerprint
        and receipt.credential_id=context.credential_id
        and receipt.location_id=session.location_id and context.location_id=session.location_id
        and response.location_id=session.location_id and response.session_id=session.id
        and context.client_session_id=session.client_session_id
        and receipt.client_session_id=session.client_session_id
        and receipt.client_completion_id=response.client_completion_id
        and receipt.original_employee_id=session.employee_id and context.employee_id=session.employee_id
        and receipt.device_id=session.device_id and context.device_id=session.device_id
        and response.device_id=session.device_id and response.submitted_by_employee_id=session.employee_id
        and response.response_json->>'work_result'='checked_no_cleaning_needed'
        and response.response_json->'services_performed'='[]'::jsonb
        and receipt.payload_json->'response_json'=response.response_json
        and context.native_start_attestation_version='custodial-native-start.v1'
        and context.native_scan_entry_id is not null
        and context.native_completion_attestation_version='custodial-native-completion.v2'
        and context.native_completion_attestation_sha256 ~ '^[0-9a-f]{64}$'
        and context.native_finish_scan_entry_id is not null
        and context.native_finish_scan_entry_id<>context.native_scan_entry_id
        and context.started_at=session.started_at and context.native_completed_at=session.ended_at
        and context.native_completed_at>context.started_at
        and context.native_completed_at>=public.operational_day_start(now())
        and context.native_completed_at<=now() and isfinite(context.native_completed_at)
        and exists (
          select 1 from public.custodial_offline_scan_event_evidence evidence
          where evidence.context_id=context.context_id
            and evidence.reconciliation_id=receipt.reconciliation_id
            and evidence.session_id=session.id
            and lower(evidence.client_event_id)=context.native_finish_scan_entry_id::text
            and evidence.event_payload->>'event_type'='scan_finish'
            and evidence.event_payload->>'result'='ok'
            and evidence.event_payload#>>'{payload_json,entry_source}'='native-nfc'
            and evidence.event_payload->>'scanned_at'=
              public.custodial_canonical_utc_millis(context.native_completed_at)
        )
      order by receipt.location_id, context.native_completed_at desc, receipt.reconciliation_id desc;
$function$;
ALTER FUNCTION custodial_release_identity.read_current_verified_dashboard_checks_v1() OWNER TO supabase_admin;
REVOKE ALL ON FUNCTION custodial_release_identity.read_current_verified_dashboard_checks_v1()
 FROM PUBLIC,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader;
GRANT EXECUTE ON FUNCTION custodial_release_identity.read_current_verified_dashboard_checks_v1() TO custodial_application_reader;
do $independent_check_acl$
begin
 if (select array_agg(coalesce(r.rolname,'PUBLIC')||':'||a.privilege_type||':'||a.is_grantable::text order by coalesce(r.rolname,'PUBLIC'))
  from pg_proc p cross join lateral aclexplode(p.proacl) a left join pg_roles r on r.oid=a.grantee
  where p.oid='custodial_release_identity.read_current_verified_dashboard_checks_v1()'::regprocedure)
  is distinct from array['custodial_application_reader:EXECUTE:false','supabase_admin:EXECUTE:false']::text[] then
  raise exception 'Exact independent verified-check reader ACL not established';end if;
 if exists(select 1 from independent_check_reader_preserved before where
  before.original_reader_md5 is distinct from md5(pg_get_functiondef('custodial_release_identity.read_current_original_dashboard_completions_v1()'::regprocedure))
  or before.cleaning_view_md5 is distinct from md5(public.custodial_release_authority_current_view_definition('public.v_location_dashboard_status'))) then
  raise exception 'Original Dashboard reader or cleaning view changed';end if;
end $independent_check_acl$;
-- Extend only the exact required recovery surface; no unrelated recapture.
do $surface$
declare definition text;insertion text:=''; identity text;
begin
 if not exists(select 1 from public.custodial_release_canary_authority_surface() where object_kind='function' and to_regprocedure(object_identity)=to_regprocedure('custodial_release_identity.read_current_verified_dashboard_checks_v1()')) then
  insertion:=insertion||E'\n    (''function'',''custodial_release_identity.read_current_verified_dashboard_checks_v1()'',''dashboard read dependency''),';end if;
 if insertion<>'' then
  definition:=pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure);
  if length(definition)-length(replace(definition,'  values',''))<>length('  values') then
   raise exception 'Canonical surface insertion seam changed';end if;
  execute replace(definition,'  values','  values'||insertion);
 end if;
end $surface$;
alter table public.custodial_release_authority_restore_inventory disable trigger trg_custodial_release_authority_restore_inventory_immutable;
do $capture$
declare signature text;kind text;definition text;changed integer;next_order integer;bucket integer;
begin
 foreach signature in array array[
'custodial_release_identity.read_current_verified_dashboard_checks_v1()','public.custodial_release_canary_authority_surface()'] loop
  foreach kind in array array['function','grant'] loop
   definition:=case when kind='function' then pg_get_functiondef(to_regprocedure(signature))
    else public.custodial_release_authority_current_grant_definition(to_regprocedure(signature)::text) end;
   if definition is null then raise exception 'Missing exact recovery definition: % %',kind,signature;end if;
   update public.custodial_release_authority_restore_inventory set definition_sql=definition,
    definition_sha256=public.static_weekly_digest_text(definition),captured_at=statement_timestamp()
    where object_kind=kind and object_identity like '%(%' and to_regprocedure(object_identity)=to_regprocedure(signature);
   get diagnostics changed=row_count;
   if changed=0 and signature<>'public.custodial_release_canary_authority_surface()' then
    bucket:=case when kind='function' then 100000 else 900000 end;
    select coalesce(max(restore_order),bucket)+1 into next_order
     from public.custodial_release_authority_restore_inventory where restore_order>=bucket and restore_order<bucket+100000;
    if next_order>=bucket+100000 then raise exception 'Recovery order bucket exhausted';end if;
    insert into public.custodial_release_authority_restore_inventory
     (restore_order,object_kind,object_identity,definition_sql,definition_sha256)
     values(next_order,kind,to_regprocedure(signature)::text,definition,public.static_weekly_digest_text(definition));
   elsif changed<>1 then raise exception 'Expected one exact recovery identity: % %',kind,signature;end if;
  end loop;
 end loop;
end $capture$;
do $restore_guard$
begin
 if (select enabled from dashboard_recovery_guard_before)='A' then
  alter table public.custodial_release_authority_restore_inventory enable always trigger trg_custodial_release_authority_restore_inventory_immutable;
 else
  alter table public.custodial_release_authority_restore_inventory enable trigger trg_custodial_release_authority_restore_inventory_immutable;
 end if;
end $restore_guard$;
commit;
