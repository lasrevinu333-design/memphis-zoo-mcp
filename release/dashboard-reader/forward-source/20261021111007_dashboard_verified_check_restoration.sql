-- G12/G31 canonical candidate dependency restoration.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
set local check_function_bodies=on;
set local search_path=pg_catalog,public;
-- Exact reviewed project only. Caller supplies project identity from its
-- authenticated deployment target; no key or database URL is stored here.
do $target$
begin
 if current_setting('custodial.deployment_project_ref',true) is distinct from 'rqquvtjdmugpigbndmne' then
  raise exception 'Expected explicit Custodial deployment target rqquvtjdmugpigbndmne';end if;
 if current_user<>'postgres' then raise exception 'Expected existing postgres migration owner';end if;
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

-- Verbatim canonical Source slice from 20260922090000; no notification worker,
-- schedule admission, physical-completion writer, data row, or role replay.
do $dependencies$
declare dependency record;column_name text;existing_oid oid;
begin
 if not exists(select 1 from pg_proc p where p.oid=to_regprocedure('public.custodial_canonical_utc_millis(timestamptz)')
   and p.proowner='postgres'::regrole and p.prokind='f' and p.prorettype='text'::regtype
   and p.provolatile='i' and p.prosecdef=false
   and md5(p.prosrc)='1fc63ecfbab39b8e0d756ae4af258cf6' and not (p.proconfig is distinct from array['search_path=pg_catalog']::text[])) then
  raise exception 'Canonical signature/body/owner/security mismatch: public.custodial_canonical_utc_millis(timestamptz)';end if;

 for dependency in select * from (values
  ('public.custodial_offline_reconciliation_records',array['client_completion_id','client_session_id','completion_response_id','context_id','credential_id','device_id','location_id','occurrence_fingerprint','occurrence_id','original_employee_id','payload_json','reconciliation_id','session_id','state']::text[]),
  ('public.custodial_offline_actor_contexts',array['client_session_id','context_id','credential_id','device_id','employee_id','location_id','native_completed_at','native_completion_attestation_sha256','native_completion_attestation_version','native_finish_scan_entry_id','native_scan_entry_id','native_start_attestation_version','occurrence_fingerprint','occurrence_id','started_at','status']::text[]),
  ('public.sessions',array['client_session_id','device_id','employee_id','ended_at','id','location_id','started_at','status']::text[]),
  ('public.completion_responses',array['client_completion_id','device_id','id','location_id','response_json','session_id','submitted_by_employee_id']::text[]),
  ('public.custodial_offline_scan_event_evidence',array['client_event_id','context_id','event_payload','reconciliation_id','session_id']::text[])
 ) expected(identity,columns) loop
  if to_regclass(dependency.identity) is null then raise exception 'Missing canonical relation: %',dependency.identity;end if;
  foreach column_name in array dependency.columns loop
   if not exists(select 1 from pg_attribute where attrelid=to_regclass(dependency.identity)
     and attname=column_name and attnum>0 and not attisdropped) then
    raise exception 'Missing canonical column: %.%',dependency.identity,column_name;end if;
  end loop;
 end loop;
 existing_oid:=to_regprocedure('public.mz_latest_verified_check(uuid,timestamptz,timestamptz)');
 if existing_oid is not null then
 if not exists(select 1 from pg_proc p where p.oid=to_regprocedure('public.mz_latest_verified_check(uuid,timestamptz,timestamptz)')
   and p.proowner='postgres'::regrole and p.prokind='f' and p.prorettype='timestamptz'::regtype
   and p.provolatile='s' and p.prosecdef=true
   and md5(p.prosrc)='db291da01ace223486f791a646e98ff0' and not (p.proconfig is distinct from array['search_path=pg_catalog, public']::text[])) then
  raise exception 'Canonical signature/body/owner/security mismatch: public.mz_latest_verified_check(uuid,timestamptz,timestamptz)';end if;
 end if;
end $dependencies$;
create or replace function public.mz_latest_verified_check(
 p_location_id uuid,p_day_start timestamptz,p_now timestamptz
) returns timestamptz language sql stable security definer
set search_path=pg_catalog,public as $function$
 select max(context.native_completed_at)
 from public.custodial_offline_reconciliation_records receipt
 join public.custodial_offline_actor_contexts context on context.context_id=receipt.context_id
 join public.sessions session on session.id=receipt.session_id
 join public.completion_responses response on response.id=receipt.completion_response_id
 where receipt.state='committed' and context.status='committed' and session.status='closed'
   and receipt.occurrence_id=context.occurrence_id
   and receipt.occurrence_fingerprint=context.occurrence_fingerprint
   and receipt.credential_id=context.credential_id
   and receipt.location_id=p_location_id and session.location_id=p_location_id
   and context.location_id=p_location_id and response.location_id=p_location_id
   and response.session_id=session.id and context.client_session_id=session.client_session_id
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
   and context.started_at=session.started_at
   and context.native_completed_at=session.ended_at
   and context.native_completed_at>context.started_at
   and context.native_completed_at>=p_day_start and context.native_completed_at<=p_now
   and isfinite(context.native_completed_at)
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
   );
$function$;
alter function public.mz_latest_verified_check(uuid,timestamptz,timestamptz) owner to postgres;
-- The canonical service ACL plus the exact retained application-reader grant.
-- Reject foreign grants rather than silently removing another owner's access.
do $acl_guard$
begin
 if exists(select 1 from pg_proc p cross join lateral aclexplode(p.proacl) acl
  where p.oid='public.mz_latest_verified_check(uuid,timestamptz,timestamptz)'::regprocedure
   and acl.grantee not in(0,'postgres'::regrole,'service_role'::regrole,'custodial_application_reader'::regrole,'anon'::regrole,'authenticated'::regrole)) then
  raise exception 'Unexpected verified-check function grantee: %',(select string_agg(coalesce(r.rolname,'PUBLIC'),',') from pg_proc p cross join lateral aclexplode(p.proacl) acl left join pg_roles r on r.oid=acl.grantee where p.oid='public.mz_latest_verified_check(uuid,timestamptz,timestamptz)'::regprocedure);end if;
end $acl_guard$;
revoke all on function public.mz_latest_verified_check(uuid,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.mz_latest_verified_check(uuid,timestamptz,timestamptz) to postgres,service_role,custodial_application_reader;
do $exact_acl$
begin
 if (select array_agg(coalesce(r.rolname,'PUBLIC')||':'||a.privilege_type||':'||a.is_grantable::text order by coalesce(r.rolname,'PUBLIC'))
  from pg_proc p cross join lateral aclexplode(p.proacl) a left join pg_roles r on r.oid=a.grantee
  where p.oid='public.mz_latest_verified_check(uuid,timestamptz,timestamptz)'::regprocedure)
  is distinct from array['custodial_application_reader:EXECUTE:false','postgres:EXECUTE:false','service_role:EXECUTE:false']::text[] then
  raise exception 'Exact canonical verified-check ACL not established';end if;
end $exact_acl$;
-- Extend only the exact required recovery surface; no unrelated recapture.
do $surface$
declare definition text;insertion text:=''; identity text;
begin
 if not exists(select 1 from public.custodial_release_canary_authority_surface() where object_kind='function' and to_regprocedure(object_identity)=to_regprocedure('public.mz_latest_verified_check(uuid,timestamp with time zone,timestamp with time zone)')) then
  insertion:=insertion||E'\n    (''function'',''mz_latest_verified_check(uuid,timestamp with time zone,timestamp with time zone)'',''dashboard read dependency''),';end if;
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
'public.mz_latest_verified_check(uuid,timestamptz,timestamptz)','public.custodial_release_canary_authority_surface()'] loop
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
