begin;
set local lock_timeout='5s';
set local statement_timeout='120s';

-- No new missing-outcome completion is admitted. Historical rows are untouched.
-- Only the exact immutable server-accepted operation may replay; client dates,
-- context age, flags, versions, and browser receipts do not establish acceptance.
create function public.custodial_oc24_legacy_replay_allowed(
 p_context_id text,p_client_session_id text,p_client_completion_id text,
 p_device_id text,p_location_code text,p_client_started_at text,p_client_ended_at text,
 p_response_json jsonb,p_scan_evidence jsonb,p_correlation_id text
) returns boolean language plpgsql stable set search_path=pg_catalog,public as $fn$
declare c public.custodial_offline_actor_contexts; r public.custodial_offline_reconciliation_records;
 started timestamptz; ended timestamptz; services jsonb;
begin
 if jsonb_typeof(p_response_json) is distinct from 'object' or p_response_json ? 'work_result' then return false; end if;
 services:=p_response_json->'services_performed';
 if jsonb_typeof(services) is distinct from 'array' then return false; end if;
 if jsonb_array_length(services)=0 or exists(select 1 from jsonb_array_elements(services) x
  where jsonb_typeof(x)<>'string' or public.custodial_oc24_service_trim(x#>>'{}')='') then return false; end if;
 if jsonb_array_length(services)>1 and exists(select 1 from jsonb_array_elements(services) x
  where lower(public.custodial_oc24_service_trim(x#>>'{}'))='full cleaning services') then return false; end if;
 begin
  started:=p_client_started_at::timestamptz; ended:=p_client_ended_at::timestamptz;
  select * into c from public.custodial_offline_actor_contexts where context_id=p_context_id::uuid;
 exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then return false;
 end;
 if c.context_id is null or c.status<>'committed' or not isfinite(started) or not isfinite(ended)
  or c.client_session_id is distinct from p_client_session_id or c.started_at is distinct from started
  or c.canonical_location_code is distinct from public.resolve_scan_location_code(p_location_code)
  or not exists(select 1 from public.devices d where d.id=c.device_id and upper(d.device_id)=upper(p_device_id))
 then return false; end if;
 select * into r from public.custodial_offline_reconciliation_records
  where context_id=c.context_id and client_session_id=p_client_session_id
   and client_completion_id=p_client_completion_id and state='committed';
 return coalesce(r.reconciliation_id is not null and r.result_json->>'status'='closed'
  and r.payload_fingerprint=public.custodial_offline_payload_fingerprint(c,p_client_completion_id,started,ended,p_response_json,p_scan_evidence,p_correlation_id)
  and r.payload_json->'response_json'=p_response_json and r.payload_json->'scan_evidence'=p_scan_evidence
  and exists(select 1 from public.completion_responses cr
   where cr.id=r.completion_response_id and cr.session_id=r.session_id
    and cr.client_completion_id=p_client_completion_id and cr.response_json=p_response_json),false);
end $fn$;
revoke all on function public.custodial_oc24_legacy_replay_allowed(text,text,text,text,text,text,text,jsonb,jsonb,text) from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader;

do $strict_new$
declare d text; seam text:=' if not (p_response ? ''work_result'') then return; end if;';
begin
 d:=pg_get_functiondef('public.custodial_oc24_assert_completion_selection(jsonb)'::regprocedure);
 if (length(d)-length(replace(d,seam,'')))/length(seam)<>1 then raise exception 'OC24 explicit outcome seam missing'; end if;
 execute replace(d,seam,$replacement$ if not (p_response ? 'work_result') then
  raise exception using errcode='22023',message='explicit work_result required for new completion';
 end if;$replacement$);
end $strict_new$;

create or replace function public.custodial_oc24_completion_selection_guard()
returns trigger language plpgsql set search_path=pg_catalog,public as $fn$
begin
 -- An unchanged historical value is not a new completion or a rewrite. Existing
 -- immutable-identity triggers still enforce all other record fields.
 if tg_op='UPDATE' and new.response_json is not distinct from old.response_json then return new; end if;
 perform public.custodial_oc24_assert_completion_selection(new.response_json);
 return new;
end $fn$;

do $precheck$
declare d text; seam text:='  perform public.custodial_oc24_assert_completion_selection(p_response_json);';
begin
 select pg_get_functiondef(p.oid) into strict d from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='tool_commit_cleaning_workflow_authoritative';
 if (length(d)-length(replace(d,seam,'')))/length(seam)<>1 then raise exception 'OC24 replay precheck seam missing'; end if;
 execute replace(d,seam,$replacement$  if jsonb_typeof(p_response_json)='object' and not (p_response_json ? 'work_result') then
    if not public.custodial_oc24_legacy_replay_allowed(p_context_id,p_client_session_id,p_client_completion_id,
      p_device_id,p_location_code,p_client_started_at,p_client_ended_at,p_response_json,p_scan_evidence,p_correlation_id) then
      raise exception using errcode='22023',message='explicit work_result required; no exact accepted legacy completion';
    end if;
  else
    perform public.custodial_oc24_assert_completion_selection(p_response_json);
  end if;$replacement$);
end $precheck$;

do $surface$
declare d text;
begin
 d:=pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure);
 if (length(d)-length(replace(d,'  values','')))/length('  values')<>1 then raise exception 'OC24 legacy surface seam missing'; end if;
 execute replace(d,'  values','  values'||E'\n'||
  $rows$('function','public.custodial_oc24_legacy_replay_allowed(text,text,text,text,text,text,text,jsonb,jsonb,text)','Exact immutable legacy replay only'),
  $rows$);
end $surface$;

alter table public.custodial_release_authority_restore_inventory disable trigger trg_custodial_release_authority_restore_inventory_immutable;
do $recovery$
declare obj record; next_order integer;
begin
 for obj in with funcs as (
  select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in (
   'custodial_oc24_legacy_replay_allowed','custodial_oc24_assert_completion_selection',
   'custodial_oc24_completion_selection_guard','tool_commit_cleaning_workflow_authoritative','custodial_release_canary_authority_surface')
 ), objects as (
  select 100000 bucket,'function'::text kind,oid::regprocedure::text identity,pg_get_functiondef(oid) definition from funcs
  union all select 900000,'grant',oid::regprocedure::text,public.custodial_release_authority_current_grant_definition(oid::regprocedure::text) from funcs
 ) select * from objects order by bucket,identity loop
  if obj.definition is null then raise exception 'missing OC24 legacy recovery object %',obj.identity; end if;
  update public.custodial_release_authority_restore_inventory set definition_sql=obj.definition,
   definition_sha256=public.static_weekly_digest_text(obj.definition),captured_at=statement_timestamp()
   where object_kind=obj.kind and (object_identity=obj.identity or
    case when object_identity like '%(%' and obj.identity like '%(%'
     then to_regprocedure(object_identity)=to_regprocedure(obj.identity) else false end);
  if not found then
   select coalesce(max(restore_order),obj.bucket)+1 into next_order from public.custodial_release_authority_restore_inventory
    where restore_order>=obj.bucket and restore_order<obj.bucket+100000;
   insert into public.custodial_release_authority_restore_inventory(restore_order,object_kind,object_identity,definition_sql,definition_sha256)
    values(next_order,obj.kind,obj.identity,obj.definition,public.static_weekly_digest_text(obj.definition));
  end if;
 end loop;
end $recovery$;
alter table public.custodial_release_authority_restore_inventory enable trigger trg_custodial_release_authority_restore_inventory_immutable;
commit;
