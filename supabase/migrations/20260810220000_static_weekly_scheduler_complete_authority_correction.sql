-- Complete I2 authority correction: control-plane-only mutators, strict
-- exception contracts, recurring multiweek projections, publish-time roster
-- truth, explicit rollback lineage, versioned keys, and release readiness.
--
-- This migration intentionally leaves historical v2 rows readable.  New work
-- is accepted only through v3 control-plane wrappers; service_role, browser
-- roles, and ordinary API workers have no scheduler mutation execution path.
begin;

do $roles$
begin
  begin create role static_weekly_control_plane noinherit nologin; exception when duplicate_object then null; end;
  begin create role static_weekly_release_operator noinherit nologin; exception when duplicate_object then null; end;
  -- The migration owner is used by disposable-rebuild tests and by the
  -- repository-owned release procedure. Production grants these roles only to
  -- separately provisioned control-plane/release login identities.
  if exists(select 1 from pg_roles where rolname=current_user) then
    execute format('grant static_weekly_control_plane to %I',current_user);
    execute format('grant static_weekly_release_operator to %I',current_user);
  end if;
end
$roles$;

create table if not exists public.static_weekly_authority_attestation_keys (
  key_id text primary key check(key_id ~ '^static-weekly-authority-hmac-v[0-9]+$'),
  secret_material text not null check(length(secret_material)>=32),
  key_state text not null check(key_state in ('pending','active','overlap','revoked')),
  activates_at timestamptz not null,
  verify_not_after timestamptz,
  configured_at timestamptz not null default statement_timestamp(),
  configured_by text not null check(length(btrim(configured_by)) between 1 and 200),
  revoked_at timestamptz,
  revoked_by text,
  recovery_of_key_id text references public.static_weekly_authority_attestation_keys(key_id),
  check((key_state='revoked') = (revoked_at is not null)),
  check(verify_not_after is null or verify_not_after>activates_at)
);
create unique index if not exists static_weekly_authority_one_active_key
  on public.static_weekly_authority_attestation_keys((key_state)) where key_state='active';

-- Disable the superseded single-key row. It remains only as historical schema
-- compatibility; v3 never reads it.
update public.static_weekly_authority_attestation_config
set enabled=false,hmac_secret=null,configured_at=statement_timestamp(),configured_by='superseded-by-versioned-v3-keyring'
where singleton and (enabled or hmac_secret is not null);

create or replace function public.static_weekly_v3_assert_runtime_role(p_role text)
returns void language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_requested text:=coalesce(current_setting('role',true),'');
begin
  -- SECURITY DEFINER changes current_user, so check the SET ROLE setting (for
  -- a provisioned NOLOGIN group) or a direct dedicated login session user.
  if session_user is distinct from p_role and v_requested is distinct from p_role then
    raise exception using errcode='42501',message=format('static weekly %s identity is required',p_role);
  end if;
end
$function$;

create or replace function public.static_weekly_v3_assert_control_plane()
returns void language plpgsql security definer set search_path=pg_catalog,public as $function$
begin
  perform public.static_weekly_v3_assert_runtime_role('static_weekly_control_plane');
end
$function$;

create or replace function public.static_weekly_v3_assert_release_operator()
returns void language plpgsql security definer set search_path=pg_catalog,public as $function$
begin
  perform public.static_weekly_v3_assert_runtime_role('static_weekly_release_operator');
end
$function$;

create or replace function public.static_weekly_v3_assert_text(p_value jsonb,p_label text,p_maximum integer default 200)
returns void language plpgsql security definer set search_path=pg_catalog,public as $function$
begin
  if jsonb_typeof(p_value) is distinct from 'string' or nullif(btrim(p_value#>>'{}'),'') is null
    or length(p_value#>>'{}')>p_maximum or (p_value#>>'{}') ~ '[\x00-\x1f\x7f]' then
    raise exception using errcode='23514',message=format('%s must be a bounded nonblank text value',p_label);
  end if;
end
$function$;

create or replace function public.static_weekly_v3_assert_uuid(p_value jsonb,p_label text)
returns void language plpgsql security definer set search_path=pg_catalog,public as $function$
begin
  perform public.static_weekly_v3_assert_text(p_value,p_label,36);
  if p_value#>>'{}' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception using errcode='23514',message=format('%s must be a UUID identity',p_label);
  end if;
end
$function$;

create or replace function public.static_weekly_v3_assert_string_array(p_value jsonb,p_label text,p_allow_empty boolean default true,p_maximum integer default 200)
returns void language plpgsql security definer set search_path=pg_catalog,public as $function$
begin
  if jsonb_typeof(p_value) is distinct from 'array' or (not p_allow_empty and jsonb_array_length(p_value)=0)
    or exists(select 1 from jsonb_array_elements(p_value) x(value) where jsonb_typeof(x.value) is distinct from 'string' or nullif(btrim(x.value#>>'{}'),'') is null or length(x.value#>>'{}')>p_maximum or (x.value#>>'{}') ~ '[\x00-\x1f\x7f]')
    or (select count(*) from jsonb_array_elements(p_value))<>(select count(distinct value#>>'{}') from jsonb_array_elements(p_value)) then
    raise exception using errcode='23514',message=format('%s must be a unique bounded string array',p_label);
  end if;
end
$function$;

create or replace function public.static_weekly_v3_assert_window(p_value jsonb,p_label text)
returns void language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_start time; v_end time;
begin
  perform public.static_weekly_assert_exact_object(p_value,array['start','end'],array['start','end'],p_label);
  perform public.static_weekly_v3_assert_text(p_value->'start',p_label||' start',5);
  perform public.static_weekly_v3_assert_text(p_value->'end',p_label||' end',5);
  if p_value->>'start' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or p_value->>'end' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    raise exception using errcode='23514',message=format('%s endpoints must be HH:MM local time',p_label);
  end if;
  v_start:=(p_value->>'start')::time; v_end:=(p_value->>'end')::time;
  if v_start>=v_end then raise exception using errcode='23514',message=format('%s must be an ordered nonempty local window',p_label); end if;
end
$function$;

create or replace function public.static_weekly_v3_assert_work_payload(p_work jsonb,p_added boolean)
returns void language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_effort numeric; v_priority numeric;
begin
  perform public.static_weekly_assert_exact_object(p_work,
    case when p_added then array['workId','dayOfWeek','originSlotId','locationId','locationCodeSnapshot','locationNameSnapshot','window','serviceEffortMinutes','serviceEffortProvenance','priority','priorityProvenance','requiredQualifications','qualificationProvenance','restrictions','restrictionProvenance'] else array['workId','locationId','locationCodeSnapshot','locationNameSnapshot','window','serviceEffortMinutes','serviceEffortProvenance','priority','priorityProvenance','requiredQualifications','qualificationProvenance','restrictions','restrictionProvenance'] end,
    case when p_added then array['workId','dayOfWeek','originSlotId','locationId','locationCodeSnapshot','locationNameSnapshot','window','serviceEffortMinutes','serviceEffortProvenance','priority','priorityProvenance','requiredQualifications','qualificationProvenance','restrictions','restrictionProvenance'] else array['workId','locationId','locationCodeSnapshot','locationNameSnapshot','window','serviceEffortMinutes','serviceEffortProvenance','priority','priorityProvenance','requiredQualifications','qualificationProvenance','restrictions','restrictionProvenance'] end,
    case when p_added then 'event added work' else 'event patch work' end);
  perform public.static_weekly_v3_assert_text(p_work->'workId','event workId',160);
  perform public.static_weekly_v3_assert_uuid(p_work->'locationId','event locationId');
  perform public.static_weekly_v3_assert_text(p_work->'locationCodeSnapshot','event location code');
  perform public.static_weekly_v3_assert_text(p_work->'locationNameSnapshot','event location name');
  perform public.static_weekly_v3_assert_window(p_work->'window','event work window');
  if jsonb_typeof(p_work->'serviceEffortMinutes') is distinct from 'number' or jsonb_typeof(p_work->'priority') is distinct from 'number' then
    raise exception using errcode='23514',message='event work effort and priority must be JSON numbers';
  end if;
  v_effort:=(p_work->>'serviceEffortMinutes')::numeric; v_priority:=(p_work->>'priority')::numeric;
  if v_effort<>trunc(v_effort) or v_effort<1 or v_effort>1440 or v_priority<>trunc(v_priority) or v_priority<0 or v_priority>100 then
    raise exception using errcode='23514',message='event work effort or priority is outside the accepted integer range';
  end if;
  perform public.static_weekly_v3_assert_text(p_work->'serviceEffortProvenance','event service provenance');
  perform public.static_weekly_v3_assert_text(p_work->'priorityProvenance','event priority provenance');
  perform public.static_weekly_v3_assert_text(p_work->'qualificationProvenance','event qualification provenance');
  perform public.static_weekly_v3_assert_text(p_work->'restrictionProvenance','event restriction provenance');
  perform public.static_weekly_v3_assert_string_array(p_work->'requiredQualifications','event qualifications');
  perform public.static_weekly_v3_assert_string_array(p_work->'restrictions','event restrictions');
  if p_added then
    if jsonb_typeof(p_work->'dayOfWeek') is distinct from 'number' or (p_work->>'dayOfWeek') !~ '^[0-6]$' then raise exception using errcode='23514',message='event added work weekday must be a JSON integer from zero through six'; end if;
    perform public.static_weekly_v3_assert_uuid(p_work->'originSlotId','event origin slotId');
  end if;
end
$function$;

-- The v3 replacement is deliberately exhaustive.  Every type/range/identity
-- test completes before v2 can advance revision or insert a command receipt.
create or replace function public.static_weekly_assert_exception_payload(
  p_exception_type text,p_service_date date,p_starts_at time,p_ends_at time,p_base_version_id uuid,p_publication_id uuid,p_payload jsonb,p_reverses_exception_id uuid
) returns void language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_slot text; v_lock jsonb; v_patch jsonb; v_add jsonb; v_ids text[]; v_effort numeric;
begin
  if jsonb_typeof(p_payload) is distinct from 'object' then raise exception using errcode='23514',message='exception payload must be an exact JSON object'; end if;
  if exists(select 1 from public.weekly_schedule_exception_commands e where e.publication_id=p_publication_id and e.base_version_id=p_base_version_id and e.service_date=p_service_date and e.exception_type=p_exception_type and e.payload_digest=public.static_weekly_digest_jsonb(p_payload) and not exists(select 1 from public.weekly_schedule_exception_commands r where r.reverses_exception_id=e.exception_id)) then
    raise exception using errcode='23514',message='duplicate semantic exception command is already effective';
  end if;
  if p_exception_type in ('pto','daily_absence') then
    perform public.static_weekly_assert_exact_object(p_payload,array['slotId'],array['slotId'],p_exception_type||' payload'); perform public.static_weekly_v3_assert_uuid(p_payload->'slotId',p_exception_type||' slotId'); v_slot:=p_payload->>'slotId';
    if p_starts_at is not null or p_ends_at is not null or not public.static_weekly_exception_slot_exists(p_base_version_id,p_service_date,v_slot,true)
      or exists(select 1 from public.weekly_schedule_exception_commands e where e.publication_id=p_publication_id and e.service_date=p_service_date and e.exception_type in ('pto','daily_absence','partial_absence','lunch') and e.payload_json->>'slotId'=v_slot and not exists(select 1 from public.weekly_schedule_exception_commands r where r.reverses_exception_id=e.exception_id)) then
      raise exception using errcode='23514',message='full-day absence must target one currently working slot without conflict or no-op';
    end if;
  elsif p_exception_type in ('partial_absence','lunch') then
    perform public.static_weekly_assert_exact_object(p_payload,array['slotId'],array['slotId'],p_exception_type||' payload'); perform public.static_weekly_v3_assert_uuid(p_payload->'slotId',p_exception_type||' slotId'); v_slot:=p_payload->>'slotId';
    if p_starts_at is null or p_ends_at is null or not public.static_weekly_exception_slot_exists(p_base_version_id,p_service_date,v_slot,true)
      or exists(select 1 from public.weekly_schedule_exception_commands e where e.publication_id=p_publication_id and e.service_date=p_service_date and e.exception_type in ('pto','daily_absence') and e.payload_json->>'slotId'=v_slot and not exists(select 1 from public.weekly_schedule_exception_commands r where r.reverses_exception_id=e.exception_id))
      or exists(select 1 from public.weekly_schedule_exception_commands e where e.publication_id=p_publication_id and e.service_date=p_service_date and e.exception_type in ('partial_absence','lunch') and e.payload_json->>'slotId'=v_slot and not exists(select 1 from public.weekly_schedule_exception_commands r where r.reverses_exception_id=e.exception_id) and p_starts_at<e.ends_at and e.starts_at<p_ends_at) then
      raise exception using errcode='23514',message='partial absence or lunch must target one working slot with a nonoverlapping effective window';
    end if;
  elsif p_exception_type='shift_override' then
    perform public.static_weekly_assert_exact_object(p_payload,array['slotId','status','shift'],array['slotId','status','shift'],'shift override payload'); perform public.static_weekly_v3_assert_uuid(p_payload->'slotId','shift override slotId'); perform public.static_weekly_v3_assert_window(p_payload->'shift','shift override shift'); v_slot:=p_payload->>'slotId';
    if p_starts_at is not null or p_ends_at is not null or p_payload->>'status' not in ('working','absent','unavailable') or not public.static_weekly_exception_slot_exists(p_base_version_id,p_service_date,v_slot,false)
      or exists(select 1 from public.weekly_schedule_exception_commands e where e.publication_id=p_publication_id and e.service_date=p_service_date and e.exception_type='shift_override' and e.payload_json->>'slotId'=v_slot and not exists(select 1 from public.weekly_schedule_exception_commands r where r.reverses_exception_id=e.exception_id)) then raise exception using errcode='23514',message='shift override requires one extant slot and one nonduplicate exact replacement'; end if;
  elsif p_exception_type='cover_all' then
    perform public.static_weekly_assert_exact_object(p_payload,array['availability'],array['availability'],'coverall payload');
    perform public.static_weekly_assert_exact_object(p_payload->'availability',array['slotId','shift','productiveCapacityProvenance','maxServiceEffortMinutes','maxServiceEffortProvenance','qualifications','qualificationProvenance','restrictions','restrictionProvenance','acceptedRouteAnchorLocationId','acceptedRouteProvenance'],array['slotId','shift','productiveCapacityProvenance','maxServiceEffortMinutes','maxServiceEffortProvenance','qualifications','qualificationProvenance','restrictions','restrictionProvenance','acceptedRouteAnchorLocationId','acceptedRouteProvenance'],'coverall availability');
    perform public.static_weekly_v3_assert_uuid(p_payload#>'{availability,slotId}','coverall slotId'); perform public.static_weekly_v3_assert_window(p_payload#>'{availability,shift}','coverall shift'); perform public.static_weekly_v3_assert_uuid(p_payload#>'{availability,acceptedRouteAnchorLocationId}','coverall route anchor');
    foreach v_slot in array array['productiveCapacityProvenance','maxServiceEffortProvenance','qualificationProvenance','restrictionProvenance','acceptedRouteProvenance'] loop perform public.static_weekly_v3_assert_text(p_payload#>array['availability',v_slot],'coverall '||v_slot); end loop;
    perform public.static_weekly_v3_assert_string_array(p_payload#>'{availability,qualifications}','coverall qualifications'); perform public.static_weekly_v3_assert_string_array(p_payload#>'{availability,restrictions}','coverall restrictions');
    if jsonb_typeof(p_payload#>'{availability,maxServiceEffortMinutes}') is distinct from 'number' then raise exception using errcode='23514',message='coverall maximum effort must be a JSON integer'; end if; v_effort:=(p_payload#>>'{availability,maxServiceEffortMinutes}')::numeric;
    if v_effort<>trunc(v_effort) or v_effort<1 or v_effort>1440 or p_starts_at is not null or p_ends_at is not null or not public.static_weekly_exception_slot_exists(p_base_version_id,p_service_date,p_payload#>>'{availability,slotId}',false)
      or exists(select 1 from public.weekly_schedule_exception_commands e where e.publication_id=p_publication_id and e.service_date=p_service_date and e.exception_type='cover_all' and e.payload_json#>>'{availability,slotId}'=p_payload#>>'{availability,slotId}' and not exists(select 1 from public.weekly_schedule_exception_commands r where r.reverses_exception_id=e.exception_id)) then raise exception using errcode='23514',message='coverall requires one extant slot and one bounded nonduplicate availability replacement'; end if;
  elsif p_exception_type in ('nine_forty_five_rebalance','manager_correction') then
    perform public.static_weekly_assert_exact_object(p_payload,array['locks'],array['locks'],p_exception_type||' payload');
    if jsonb_typeof(p_payload->'locks') is distinct from 'array' or jsonb_array_length(p_payload->'locks')=0 or p_starts_at is not null or p_ends_at is not null then raise exception using errcode='23514',message='rebalance and correction require nonempty lock arrays without a window'; end if;
    for v_lock in select value from jsonb_array_elements(p_payload->'locks') loop
      perform public.static_weekly_assert_exact_object(v_lock,array['workId','slotId'],array['workId','slotId'],'manager correction lock'); perform public.static_weekly_v3_assert_text(v_lock->'workId','manager correction workId',160); perform public.static_weekly_v3_assert_uuid(v_lock->'slotId','manager correction slotId');
      if not public.static_weekly_exception_work_exists(p_base_version_id,p_service_date,v_lock->>'workId') or not public.static_weekly_exception_slot_exists(p_base_version_id,p_service_date,v_lock->>'slotId',true) then raise exception using errcode='23514',message='rebalance and correction locks must target current weekday work and working slots'; end if;
    end loop;
    if (select count(*) from jsonb_array_elements(p_payload->'locks'))<>(select count(distinct value->>'workId') from jsonb_array_elements(p_payload->'locks')) or exists(select 1 from public.weekly_schedule_exception_commands e cross join lateral jsonb_array_elements(coalesce(e.payload_json->'locks','[]'::jsonb)) l(value) where e.publication_id=p_publication_id and e.service_date=p_service_date and e.exception_type in ('nine_forty_five_rebalance','manager_correction') and not exists(select 1 from public.weekly_schedule_exception_commands r where r.reverses_exception_id=e.exception_id) and l.value->>'workId' in (select value->>'workId' from jsonb_array_elements(p_payload->'locks'))) then raise exception using errcode='23514',message='rebalance and correction locks may not duplicate or contradict effective commands'; end if;
  elsif p_exception_type='event_impact' then
    perform public.static_weekly_assert_exact_object(p_payload,array['removeWorkIds','patchWork','addWork'],array['removeWorkIds','patchWork','addWork'],'event impact payload');
    if p_starts_at is not null or p_ends_at is not null or jsonb_typeof(p_payload->'removeWorkIds') is distinct from 'array' or jsonb_typeof(p_payload->'patchWork') is distinct from 'array' or jsonb_typeof(p_payload->'addWork') is distinct from 'array' or jsonb_array_length(p_payload->'removeWorkIds')+jsonb_array_length(p_payload->'patchWork')+jsonb_array_length(p_payload->'addWork')=0 then raise exception using errcode='23514',message='event impact requires nonempty exact command arrays without a window'; end if;
    perform public.static_weekly_v3_assert_string_array(p_payload->'removeWorkIds','event removal targets',true,160);
    if exists(select 1 from jsonb_array_elements(p_payload->'removeWorkIds') x(value) where not public.static_weekly_exception_work_exists(p_base_version_id,p_service_date,x.value#>>'{}')) then raise exception using errcode='23514',message='event removal must target work on the exception service weekday'; end if;
    for v_patch in select value from jsonb_array_elements(p_payload->'patchWork') loop perform public.static_weekly_v3_assert_work_payload(v_patch,false); if not public.static_weekly_exception_work_exists(p_base_version_id,p_service_date,v_patch->>'workId') then raise exception using errcode='23514',message='event patch must target work on the exception service weekday'; end if; end loop;
    for v_add in select value from jsonb_array_elements(p_payload->'addWork') loop perform public.static_weekly_v3_assert_work_payload(v_add,true); if (v_add->>'dayOfWeek')::integer<>extract(dow from p_service_date)::integer or exists(select 1 from public.weekly_schedule_slot_assignments a where a.version_id=p_base_version_id and a.day_of_week=extract(dow from p_service_date)::smallint and a.work_id=v_add->>'workId') or not public.static_weekly_exception_slot_exists(p_base_version_id,p_service_date,v_add->>'originSlotId',false) then raise exception using errcode='23514',message='event addition must be a new work identity for the service weekday and an extant origin slot'; end if; end loop;
    select array_agg(value#>>'{}') into v_ids from jsonb_array_elements(p_payload->'removeWorkIds');
    if exists(select 1 from jsonb_array_elements(p_payload->'patchWork') x(value) where x.value->>'workId'=any(coalesce(v_ids,array[]::text[]))) or exists(select 1 from jsonb_array_elements(p_payload->'addWork') x(value) where x.value->>'workId'=any(coalesce(v_ids,array[]::text[]))) or (select count(*) from jsonb_array_elements(p_payload->'patchWork'))<>(select count(distinct value->>'workId') from jsonb_array_elements(p_payload->'patchWork')) or (select count(*) from jsonb_array_elements(p_payload->'addWork'))<>(select count(distinct value->>'workId') from jsonb_array_elements(p_payload->'addWork')) then raise exception using errcode='23514',message='event targets must be unique and may not remove, patch, and add the same work'; end if;
  elsif p_exception_type='reverse' then
    perform public.static_weekly_assert_exact_object(p_payload,array['reversesExceptionId'],array['reversesExceptionId'],'reverse payload'); perform public.static_weekly_v3_assert_uuid(p_payload->'reversesExceptionId','reverse target');
    if p_starts_at is not null or p_ends_at is not null or p_reverses_exception_id is distinct from (p_payload->>'reversesExceptionId')::uuid then raise exception using errcode='23514',message='reversal requires one coherent UUID target without a window'; end if;
  else raise exception using errcode='23514',message='unsupported exception operation';
  end if;
end
$function$;

create or replace function public.static_weekly_v3_constant_time_equal(p_left bytea,p_right bytea)
returns boolean language plpgsql immutable strict as $function$
declare v_index integer; v_difference integer:=0;
begin
  -- Callers reject variable lengths before this function. The loop has fixed
  -- work for every byte and accumulates differences without early exit. This
  -- is structural constant-work code; no remote timing claim is made here.
  if octet_length(p_left)<>octet_length(p_right) then return false; end if;
  for v_index in 0..octet_length(p_left)-1 loop v_difference:=v_difference | (get_byte(p_left,v_index) # get_byte(p_right,v_index)); end loop;
  return v_difference=0;
end
$function$;

create or replace function public.static_weekly_v3_hmac(p_secret text,p_scope text,p_payload jsonb)
returns text language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_schema text; v_hmac text;
begin
  select n.nspname into v_schema from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname='pgcrypto';
  if v_schema not in ('extensions','public') then raise exception using errcode='55000',message='pgcrypto must be installed in extensions or public'; end if;
  execute format('select encode(%I.hmac(convert_to($1,''UTF8''),convert_to($2,''UTF8''),''sha256''),''hex'')',v_schema) into v_hmac using p_scope||E'\n'||p_payload::text,p_secret;
  return v_hmac;
end
$function$;

create or replace function public.static_weekly_v3_issue_attestation(p_scope text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_key public.static_weekly_authority_attestation_keys%rowtype;
begin
  select * into v_key from public.static_weekly_authority_attestation_keys where key_state='active' and activates_at<=statement_timestamp() and (verify_not_after is null or verify_not_after>statement_timestamp()) for share;
  if not found then raise exception using errcode='42501',message='static weekly authority has no active signing key'; end if;
  return jsonb_build_object('schema','memphis-zoo.static-weekly-authority-attestation.v2','key_id',v_key.key_id,'scope',p_scope,'payload_digest',public.static_weekly_digest_jsonb(p_payload),'signature',public.static_weekly_v3_hmac(v_key.secret_material,p_scope,p_payload));
end
$function$;

create or replace function public.static_weekly_assert_authority_attestation(p_attestation jsonb,p_scope text,p_payload jsonb)
returns void language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_key public.static_weekly_authority_attestation_keys%rowtype; v_signature text; v_expected text;
begin
  perform public.static_weekly_assert_exact_object(p_attestation,array['schema','key_id','scope','payload_digest','signature'],array['schema','key_id','scope','payload_digest','signature'],'authority attestation');
  if p_attestation->>'schema' is distinct from 'memphis-zoo.static-weekly-authority-attestation.v2' or p_attestation->>'scope' is distinct from p_scope or p_attestation->>'payload_digest' is distinct from public.static_weekly_digest_jsonb(p_payload) or jsonb_typeof(p_attestation->'key_id') is distinct from 'string' or jsonb_typeof(p_attestation->'signature') is distinct from 'string' then raise exception using errcode='23514',message='complete versioned authority attestation is required'; end if;
  v_signature:=p_attestation->>'signature';
  if v_signature !~ '^[0-9a-f]{64}$' then raise exception using errcode='23514',message='authority attestation signature must be canonical lower-case fixed-length hex'; end if;
  select * into v_key from public.static_weekly_authority_attestation_keys where key_id=p_attestation->>'key_id' and key_state in ('active','overlap') and activates_at<=statement_timestamp() and (verify_not_after is null or verify_not_after>statement_timestamp()) for share;
  if not found then raise exception using errcode='23514',message='authority attestation key is unknown, expired, or revoked'; end if;
  v_expected:=public.static_weekly_v3_hmac(v_key.secret_material,p_scope,p_payload);
  if not public.static_weekly_v3_constant_time_equal(decode(v_signature,'hex'),decode(v_expected,'hex')) then raise exception using errcode='23514',message='authority attestation does not bind the canonical semantic payload'; end if;
end
$function$;

-- Defined before the release procedures so their bodies bind to a real
-- readiness function. It is replaced below only to keep the release section
-- adjacent to rotation/recovery documentation.
create or replace function public.static_weekly_v3_authority_health()
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_active integer; v_overlap_bad integer; v_cp boolean; v_v3 integer;
begin
  select count(*) into v_active from public.static_weekly_authority_attestation_keys where key_state='active' and activates_at<=statement_timestamp() and (verify_not_after is null or verify_not_after>statement_timestamp());
  select count(*) into v_overlap_bad from public.static_weekly_authority_attestation_keys where key_state='overlap' and (verify_not_after is null or verify_not_after<=statement_timestamp());
  select exists(select 1 from pg_roles where rolname='static_weekly_control_plane') into v_cp;
  select count(*) into v_v3 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'static_weekly_v3_%';
  return jsonb_build_object('ready',v_active=1 and v_overlap_bad=0 and v_cp and v_v3>=8,'active_key_count',v_active,'expired_overlap_count',v_overlap_bad,'control_plane_role_present',v_cp,'v3_function_count',v_v3,'key_ids',(select coalesce(jsonb_agg(jsonb_build_object('key_id',key_id,'state',key_state,'activates_at',activates_at,'verify_not_after',verify_not_after) order by key_id),'[]'::jsonb) from public.static_weekly_authority_attestation_keys));
end
$function$;

create or replace function public.static_weekly_v3_configure_initial_authority_key(p_key_id text,p_secret text,p_configured_by text default 'release-owner')
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
begin
  perform public.static_weekly_v3_assert_release_operator();
  if p_key_id !~ '^static-weekly-authority-hmac-v[0-9]+$' or length(coalesce(p_secret,''))<32 then raise exception using errcode='22023',message='versioned scheduler key identity and minimum secret length are required'; end if;
  if exists(select 1 from public.static_weekly_authority_attestation_keys where key_state in ('active','overlap','pending')) then raise exception using errcode='23505',message='use the explicit key-rotation procedure after initial scheduler key provisioning'; end if;
  insert into public.static_weekly_authority_attestation_keys(key_id,secret_material,key_state,activates_at,verify_not_after,configured_by) values(p_key_id,p_secret,'active',statement_timestamp(),null,left(coalesce(nullif(btrim(p_configured_by),''),'release-owner'),200));
  return public.static_weekly_v3_authority_health();
end
$function$;

create or replace function public.static_weekly_v3_rotate_authority_key(p_key_id text,p_secret text,p_overlap_until timestamptz,p_configured_by text default 'release-owner')
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_now timestamptz:=statement_timestamp();
begin
  perform public.static_weekly_v3_assert_release_operator();
  if p_key_id !~ '^static-weekly-authority-hmac-v[0-9]+$' or length(coalesce(p_secret,''))<32 or p_overlap_until<=v_now or p_overlap_until>v_now+interval '24 hours' then raise exception using errcode='22023',message='rotation requires a new versioned key, 32-character secret, and bounded 24-hour overlap'; end if;
  update public.static_weekly_authority_attestation_keys set key_state='overlap',verify_not_after=p_overlap_until where key_state='active';
  insert into public.static_weekly_authority_attestation_keys(key_id,secret_material,key_state,activates_at,verify_not_after,configured_by) values(p_key_id,p_secret,'active',v_now,null,left(coalesce(nullif(btrim(p_configured_by),''),'release-owner'),200));
  return public.static_weekly_v3_authority_health();
end
$function$;

create or replace function public.static_weekly_v3_revoke_authority_key(p_key_id text,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
begin
  perform public.static_weekly_v3_assert_release_operator();
  if nullif(btrim(p_reason),'') is null then raise exception using errcode='22023',message='key revocation reason is required'; end if;
  update public.static_weekly_authority_attestation_keys set key_state='revoked',revoked_at=statement_timestamp(),revoked_by=left(p_reason,200),verify_not_after=least(coalesce(verify_not_after,statement_timestamp()),statement_timestamp()) where key_id=p_key_id and key_state<>'active';
  if not found then raise exception using errcode='23514',message='only a non-active overlap or pending key may be revoked'; end if;
  return public.static_weekly_v3_authority_health();
end
$function$;

create or replace function public.static_weekly_v3_recover_authority_key(p_key_id text,p_secret text,p_recovery_of text,p_configured_by text default 'release-owner')
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
begin
  perform public.static_weekly_v3_assert_release_operator();
  if p_key_id !~ '^static-weekly-authority-hmac-v[0-9]+$' or length(coalesce(p_secret,''))<32 or not exists(select 1 from public.static_weekly_authority_attestation_keys where key_id=p_recovery_of and key_state='revoked') then raise exception using errcode='22023',message='recovery requires a new key, secret, and revoked predecessor'; end if;
  update public.static_weekly_authority_attestation_keys set key_state='revoked',revoked_at=statement_timestamp(),revoked_by='failed-rotation-recovery',verify_not_after=statement_timestamp() where key_state in ('active','overlap');
  insert into public.static_weekly_authority_attestation_keys(key_id,secret_material,key_state,activates_at,verify_not_after,configured_by,recovery_of_key_id) values(p_key_id,p_secret,'active',statement_timestamp(),null,left(coalesce(nullif(btrim(p_configured_by),''),'release-owner'),200),p_recovery_of);
  return public.static_weekly_v3_authority_health();
end
$function$;

create or replace function public.static_weekly_v3_authority_health()
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_active integer; v_overlap_bad integer; v_cp boolean; v_v3 integer;
begin
  select count(*) into v_active from public.static_weekly_authority_attestation_keys where key_state='active' and activates_at<=statement_timestamp() and (verify_not_after is null or verify_not_after>statement_timestamp());
  select count(*) into v_overlap_bad from public.static_weekly_authority_attestation_keys where key_state='overlap' and (verify_not_after is null or verify_not_after<=statement_timestamp());
  select exists(select 1 from pg_roles where rolname='static_weekly_control_plane') into v_cp;
  select count(*) into v_v3 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'static_weekly_v3_%';
  return jsonb_build_object('ready',v_active=1 and v_overlap_bad=0 and v_cp and v_v3>=8,'active_key_count',v_active,'expired_overlap_count',v_overlap_bad,'control_plane_role_present',v_cp,'v3_function_count',v_v3,'key_ids',(select coalesce(jsonb_agg(jsonb_build_object('key_id',key_id,'state',key_state,'activates_at',activates_at,'verify_not_after',verify_not_after) order by key_id),'[]'::jsonb) from public.static_weekly_authority_attestation_keys));
end
$function$;

create or replace function public.static_weekly_v3_manager_actor(p_manager_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_name text;
begin
  select display_name into v_name from public.ops_manager_managers where manager_id=p_manager_id and active=true and revoked_at is null and is_system_principal=false and roles && array['OPS_MANAGER','CUSTODIAL_MANAGER','DIRECTOR','SECURITY_ADMIN']::text[] for share;
  if nullif(btrim(v_name),'') is null then raise exception using errcode='42501',message='an authorized active named manager principal is required'; end if;
  return jsonb_build_object('manager_id',p_manager_id::text,'manager_name',v_name);
end
$function$;

create or replace function public.static_weekly_v3_recurring_identity(p_source jsonb)
returns jsonb language sql immutable as $function$
  select coalesce(p_source,'{}'::jsonb)-'serviceDate'
$function$;

create or replace function public.static_weekly_assert_projection_envelope_attested(p_envelope jsonb,p_publication_id uuid,p_week_start date,p_exception_set jsonb)
returns void language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_legacy jsonb; v_snapshot jsonb; v_document jsonb;
begin
  perform public.static_weekly_assert_exact_object(p_envelope,array['adapter','service_date','week_start','week_end','authority','receipt','authority_digest','replay_digest','compiler_version','objective','metrics','applied_exceptions','assignments','database_projection_identity','semantic_snapshot','attestation'],array['adapter','service_date','week_start','week_end','authority','receipt','authority_digest','replay_digest','compiler_version','objective','metrics','applied_exceptions','assignments','database_projection_identity','semantic_snapshot','attestation'],'attested projection envelope');
  perform public.static_weekly_assert_authority_attestation(p_envelope->'attestation','dated_projection',public.static_weekly_projection_attestation_payload(p_envelope));
  if p_envelope->>'database_projection_identity' is distinct from public.static_weekly_digest_jsonb((p_envelope-'attestation')-'database_projection_identity') then raise exception using errcode='23514',message='projection semantic identity must bind the complete attested envelope'; end if;
  v_snapshot:=p_envelope->'semantic_snapshot'; perform public.static_weekly_assert_exact_object(v_snapshot,array['schema','recurring_source','overlay_source','applied_exceptions','active_assignments'],array['schema','recurring_source','overlay_source','applied_exceptions','active_assignments'],'projection semantic snapshot');
  select draft_document into v_document from public.weekly_schedule_versions v join public.weekly_schedule_publications p on p.version_id=v.version_id where p.publication_id=p_publication_id;
  if v_snapshot->>'schema' is distinct from 'memphis-zoo.static-weekly-projection-semantic-snapshot.v1' or v_snapshot->'recurring_source' is distinct from public.static_weekly_v3_recurring_identity(p_envelope#>'{authority,compilerInput}') or v_snapshot->'recurring_source' is distinct from public.static_weekly_v3_recurring_identity(v_document#>'{semantic_snapshot,recurring_source}') or v_snapshot->'overlay_source' is distinct from public.static_weekly_v3_recurring_identity(p_envelope#>'{authority,overlayCompilerInput}') or v_snapshot->'applied_exceptions' is distinct from p_envelope->'applied_exceptions' or v_snapshot->'active_assignments' is distinct from p_envelope->'assignments' then raise exception using errcode='23514',message='projection must bind stable recurring source, dated overlay, accepted exceptions, and active assignments'; end if;
  v_legacy:=p_envelope-'semantic_snapshot'-'attestation'; v_legacy:=jsonb_set(v_legacy,'{database_projection_identity}',to_jsonb(public.static_weekly_digest_jsonb(v_legacy-'database_projection_identity')),true); perform public.static_weekly_assert_projection_envelope(v_legacy,p_publication_id,p_week_start,p_exception_set);
end
$function$;

create or replace function public.static_weekly_v2_materialize_projection(
  p_publication_id uuid,p_service_date date,p_exception_set_digest text,p_compiler_version text,p_objective jsonb,p_metrics jsonb,p_replay_digest text,p_assignments jsonb,p_expected_revision bigint,p_actor_manager_id uuid,p_actor_manager_name text,p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_request jsonb; v_request_digest text; v_prior public.weekly_schedule_command_receipts%rowtype; v_publication public.weekly_schedule_publications%rowtype; v_effective_start date; v_effective_end date; v_exception_set jsonb; v_exception_digest text; v_command uuid:=gen_random_uuid(); v_projection uuid:=gen_random_uuid(); v_revision bigint; v_content_digest text; v_response jsonb; v_item jsonb; v_assignment public.weekly_schedule_slot_assignments%rowtype; v_owner public.v_weekly_roster_slot_incumbency_ranges%rowtype; v_occurrence uuid; v_work jsonb;
begin
  perform public.static_weekly_assert_command_identity(p_expected_revision,p_actor_manager_id,p_actor_manager_name,p_idempotency_key,'materialize_projection'); v_request:=jsonb_build_object('operation','materialize_projection','publication_id',p_publication_id,'service_date',p_service_date,'exception_set_digest',p_exception_set_digest,'compiler_version',p_compiler_version,'objective',p_objective,'metrics',p_metrics,'replay_digest',p_replay_digest,'projection_envelope',p_assignments,'expected_revision',p_expected_revision,'actor_manager_id',p_actor_manager_id,'actor_manager_name',p_actor_manager_name); v_request_digest:=public.static_weekly_digest_jsonb(v_request); perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
  select * into v_prior from public.weekly_schedule_command_receipts where actor_manager_id=p_actor_manager_id and idempotency_key=p_idempotency_key; if found then if v_prior.request_digest<>v_request_digest then raise exception using errcode='23505',message='idempotency key was already used for different semantic inputs'; end if; return v_prior.response_json; end if;
  select * into v_publication from public.weekly_schedule_publications where publication_id=p_publication_id; select effective_start,effective_end into v_effective_start,v_effective_end from public.v_weekly_schedule_effective_ranges where version_id=v_publication.version_id; if not found or v_publication.publication_id is null or p_service_date is null or public.static_weekly_effective_version(p_service_date) is distinct from v_publication.version_id or mod(p_service_date-v_effective_start,7)<>0 or (v_effective_end is not null and p_service_date+6>=v_effective_end) then raise exception using errcode='23514',message='projection must be an aligned complete seven-day horizon wholly within one effective publication'; end if;
  v_exception_set:=public.static_weekly_accepted_exception_set(p_publication_id,p_service_date); v_exception_digest:=public.static_weekly_digest_jsonb(v_exception_set); if p_exception_set_digest is distinct from v_exception_digest or p_compiler_version is distinct from p_assignments->>'compiler_version' or p_objective is distinct from p_assignments->'objective' or p_metrics is distinct from p_assignments->'metrics' or p_replay_digest is distinct from p_assignments->>'replay_digest' then raise exception using errcode='23514',message='projection command identity must include exact compiler, objective, metrics, replay, and weekly exception authority'; end if;
  perform public.static_weekly_assert_projection_envelope_attested(p_assignments,p_publication_id,p_service_date,v_exception_set); if exists(select 1 from public.weekly_schedule_compiled_projections where publication_id=p_publication_id and week_start=p_service_date and exception_set_digest=v_exception_digest and compiler_version=p_compiler_version) then raise exception using errcode='23505',message='immutable projection already exists for this exact weekly authority'; end if;
  v_content_digest:=public.static_weekly_digest_jsonb(jsonb_build_object('publication_id',p_publication_id,'week_start',p_service_date,'exception_set_digest',v_exception_digest,'compiler_version',p_compiler_version,'objective',p_objective,'metrics',p_metrics,'replay_digest',p_replay_digest,'projection_envelope_identity',p_assignments->>'database_projection_identity','attestation',p_assignments->'attestation')); v_revision:=public.static_weekly_advance_authority(p_expected_revision,'materialize_projection',p_actor_manager_id,p_actor_manager_name,v_command,v_content_digest);
  insert into public.weekly_schedule_compiled_projections(projection_id,publication_id,version_id,week_start,week_end,exception_set_json,exception_set_digest,compiler_version,objective_json,metrics_json,replay_digest,authority_digest,receipt_json,projection_envelope,compiled_by_manager_id) values(v_projection,p_publication_id,v_publication.version_id,p_service_date,p_service_date+6,v_exception_set,v_exception_digest,p_compiler_version,p_objective,p_metrics,p_replay_digest,p_assignments->>'authority_digest',p_assignments->'receipt',p_assignments,p_actor_manager_id);
  for v_item in select value from jsonb_array_elements(p_assignments->'assignments') loop
    v_owner:=null; v_assignment:=null; v_work:=v_item->'work_snapshot'; select * into v_assignment from public.weekly_schedule_slot_assignments where version_id=v_publication.version_id and day_of_week=(v_item->>'day_of_week')::smallint and work_id=v_item->>'work_id'; if v_assignment.assignment_id is null and (v_work->>'overlayWork') is distinct from 'true' then raise exception using errcode='23514',message='active baseline work must retain its stored baseline assignment link'; end if;
    if upper(v_item->>'status')='ASSIGNED' then select * into v_owner from public.v_weekly_roster_slot_incumbency_ranges where slot_id=(v_item->>'owner_slot_id')::uuid and effective_start<=(v_item->>'service_date')::date and (effective_end is null or (v_item->>'service_date')::date<effective_end); if not found or v_owner.person_id::text is distinct from v_item->>'owner_person_id' then raise exception using errcode='23514',message='projection assigned owner lacks an effective dated incumbent'; end if; elsif upper(v_item->>'status') not in ('OPEN','REVIEW') or v_item->>'owner_slot_id' is not null or v_item->>'owner_person_id' is not null then raise exception using errcode='23514',message='open and review projection rows must have null owner facts'; end if;
    insert into public.weekly_schedule_occurrences(projection_id,publication_id,version_id,assignment_id,service_date,work_id,day_of_week,location_id,location_code_snapshot,location_name_snapshot,coverage_start,coverage_end,owner_slot_id,owner_slot_label_snapshot,owner_person_id_snapshot,owner_name_snapshot,state,state_reason,original_actor_person_id,original_actor_name_snapshot,authority_facts_json,occurrence_digest) values(v_projection,p_publication_id,v_publication.version_id,v_assignment.assignment_id,(v_item->>'service_date')::date,v_item->>'work_id',(v_item->>'day_of_week')::smallint,nullif(v_work->>'locationId','')::uuid,coalesce(v_work->>'locationCodeSnapshot',v_item->>'work_id'),coalesce(v_work->>'locationNameSnapshot',v_item->>'work_id'),(v_work#>>'{window,start}')::time,(v_work#>>'{window,end}')::time,case when lower(v_item->>'status')='assigned' then (v_item->>'owner_slot_id')::uuid else null end,case when lower(v_item->>'status')='assigned' then (select slot_label from public.weekly_roster_slots where slot_id=(v_item->>'owner_slot_id')::uuid) else null end,case when lower(v_item->>'status')='assigned' then (v_item->>'owner_person_id')::uuid else null end,case when lower(v_item->>'status')='assigned' then v_owner.person_name_snapshot else null end,case lower(v_item->>'status') when 'assigned' then 'created' when 'open' then 'open' else 'review' end,v_item->>'reason_code',nullif(v_item->>'original_actor_person_id','')::uuid,nullif(v_item->>'original_actor_name',''),jsonb_build_object('baseline_owner_slot_id',v_item->>'baseline_owner_slot_id','baseline_owner_person_id',v_item->>'baseline_owner_person_id','baseline_owner_name',v_item->>'baseline_owner_name','original_actor_person_id',v_item->>'original_actor_person_id','original_actor_name',v_item->>'original_actor_name','optimized_owner_slot_id',v_item->>'optimized_owner_slot_id','optimized_owner_person_id',v_item->>'optimized_owner_person_id','actual_actor_person_id',v_item->>'actual_actor_person_id','work_snapshot',v_work),public.static_weekly_digest_jsonb(v_item)) returning occurrence_id into v_occurrence;
    insert into public.weekly_schedule_projection_assignments(projection_id,occurrence_id,work_id,status,reason_code,owner_slot_id,owner_slot_label_snapshot,owner_person_id_snapshot,owner_name_snapshot,authority_facts_json,explanation_json,content_digest) values(v_projection,v_occurrence,v_item->>'work_id',lower(v_item->>'status'),v_item->>'reason_code',case when lower(v_item->>'status')='assigned' then (v_item->>'owner_slot_id')::uuid else null end,case when lower(v_item->>'status')='assigned' then (select slot_label from public.weekly_roster_slots where slot_id=(v_item->>'owner_slot_id')::uuid) else null end,case when lower(v_item->>'status')='assigned' then (v_item->>'owner_person_id')::uuid else null end,case when lower(v_item->>'status')='assigned' then v_owner.person_name_snapshot else null end,(select authority_facts_json from public.weekly_schedule_occurrences where occurrence_id=v_occurrence),coalesce(v_item->'explanation','{}'::jsonb),public.static_weekly_digest_jsonb(v_item));
  end loop;
  v_response:=public.static_weekly_response_json('materialize_projection',v_revision,v_content_digest,v_request_digest,jsonb_build_object('projection_id',v_projection,'publication_id',p_publication_id,'week_start',p_service_date,'week_end',p_service_date+6,'replay_digest',p_replay_digest)); insert into public.weekly_schedule_command_receipts(command_id,actor_manager_id,actor_manager_name_snapshot,command_type,idempotency_key,expected_revision,request_digest,request_canonical_json,response_json,response_digest,content_digest) values(v_command,p_actor_manager_id,p_actor_manager_name,'materialize_projection',p_idempotency_key,p_expected_revision,v_request_digest,v_request,v_response,v_response->>'output_digest',v_content_digest); return v_response;
end
$function$;

create or replace function public.static_weekly_v3_assert_draft_incumbency(p_version_id uuid)
returns void language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_start date; v_row record; v_person uuid; v_name text; v_date date;
begin
  select effective_start into v_start from public.weekly_schedule_versions where version_id=p_version_id for share; if v_start is null then raise exception using errcode='23514',message='draft version does not exist'; end if;
  for v_row in select * from public.weekly_schedule_slot_availability where version_id=p_version_id order by day_of_week,slot_id loop
    v_date:=v_start+mod(v_row.day_of_week-extract(dow from v_start)::integer+7,7); select person_id,person_name_snapshot into v_person,v_name from public.weekly_roster_slot_incumbencies where slot_id=v_row.slot_id and effective_start<=v_date and (effective_end is null or v_date<effective_end) for share;
    if v_person is null or v_row.incumbent_person_id_snapshot is distinct from v_person or v_row.incumbent_name_snapshot is distinct from v_name then raise exception using errcode='23514',message='draft roster incumbency snapshot is stale or incomplete at publication effective date'; end if;
  end loop;
  for v_row in select * from public.weekly_schedule_slot_assignments where version_id=p_version_id and owner_slot_id is not null order by day_of_week,assignment_id loop
    v_date:=v_start+mod(v_row.day_of_week-extract(dow from v_start)::integer+7,7); select person_id,person_name_snapshot into v_person,v_name from public.weekly_roster_slot_incumbencies where slot_id=v_row.owner_slot_id and effective_start<=v_date and (effective_end is null or v_date<effective_end) for share;
    if v_person is null or v_row.owner_person_id_snapshot is distinct from v_person or v_row.owner_name_snapshot is distinct from v_name then raise exception using errcode='23514',message='draft recurring owner snapshot is stale or incomplete at publication effective date'; end if;
  end loop;
end
$function$;

create or replace function public.static_weekly_v3_assert_rollback_lineage(p_draft_version_id uuid,p_rollback_of_version_id uuid)
returns void language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_effective date; v_current uuid; v_target_kind text; v_is_ancestor boolean;
begin
  select effective_start into v_effective from public.weekly_schedule_versions where version_id=p_draft_version_id for share; select public.static_weekly_effective_version(v_effective) into v_current;
  if v_current is null or p_rollback_of_version_id is null or p_rollback_of_version_id=v_current then raise exception using errcode='23514',message='rollback must name one distinct current-lineage superseded ancestor'; end if;
  select publication_kind into v_target_kind from public.weekly_schedule_versions where version_id=p_rollback_of_version_id and lifecycle_state='published' for share;
  if v_target_kind is null or v_target_kind='rollback_compensation' then raise exception using errcode='23514',message='rollback targets must be published non-rollback ancestors'; end if;
  with recursive lineage(version_id,prior_version_id) as (
    select p.version_id,p.prior_version_id from public.weekly_schedule_publications p where p.version_id=v_current
    union all select p.version_id,p.prior_version_id from public.weekly_schedule_publications p join lineage l on p.version_id=l.prior_version_id
  ) select exists(select 1 from lineage where version_id=p_rollback_of_version_id) into v_is_ancestor;
  if not v_is_ancestor then raise exception using errcode='23514',message='rollback target is not an eligible superseded ancestor in the current immutable lineage'; end if;
end
$function$;

create or replace function public.static_weekly_v3_create_draft(p_effective_start date,p_objective_version text,p_objective jsonb,p_input_provenance jsonb,p_document jsonb,p_expected_revision bigint,p_manager_id uuid,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_actor jsonb; v_document jsonb;
begin perform public.static_weekly_v3_assert_control_plane(); v_actor:=public.static_weekly_v3_manager_actor(p_manager_id); v_document:=jsonb_set(p_document,'{attestation}',public.static_weekly_v3_issue_attestation('recurring_document',public.static_weekly_document_attestation_payload(p_document)),true); return public.static_weekly_v2_create_draft(p_effective_start,p_objective_version,p_objective,p_input_provenance,v_document,p_expected_revision,p_manager_id,v_actor->>'manager_name',p_idempotency_key); end
$function$;

create or replace function public.static_weekly_v3_read_publication_source(p_publication_id uuid,p_service_date date)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_document jsonb; v_version uuid;
begin
  perform public.static_weekly_v3_assert_control_plane();
  select v.draft_document,p.version_id into v_document,v_version from public.weekly_schedule_publications p join public.weekly_schedule_versions v on v.version_id=p.version_id where p.publication_id=p_publication_id;
  if not found or public.static_weekly_effective_version(p_service_date) is distinct from v_version then raise exception using errcode='23514',message='control plane source must name the effective immutable publication'; end if;
  return jsonb_build_object('compiler_input',v_document#>'{semantic_snapshot,recurring_source}','exceptions',public.static_weekly_compiler_exception_set(p_publication_id,p_service_date),'publication_id',p_publication_id::text,'version_id',v_version::text,'authority_revision',(select current_revision from public.static_weekly_schedule_control where singleton));
end
$function$;

create or replace function public.static_weekly_v3_update_draft(p_version_id uuid,p_document jsonb,p_objective jsonb,p_input_provenance jsonb,p_expected_draft_revision bigint,p_expected_revision bigint,p_manager_id uuid,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_actor jsonb; v_document jsonb;
begin perform public.static_weekly_v3_assert_control_plane(); v_actor:=public.static_weekly_v3_manager_actor(p_manager_id); v_document:=jsonb_set(p_document,'{attestation}',public.static_weekly_v3_issue_attestation('recurring_document',public.static_weekly_document_attestation_payload(p_document)),true); return public.static_weekly_v2_update_draft(p_version_id,v_document,p_objective,p_input_provenance,p_expected_draft_revision,p_expected_revision,p_manager_id,v_actor->>'manager_name',p_idempotency_key); end
$function$;

create or replace function public.static_weekly_v3_publish_draft(p_draft_version_id uuid,p_expected_draft_revision bigint,p_expected_revision bigint,p_manager_id uuid,p_idempotency_key text,p_publication_kind text default 'publish',p_rollback_of_version_id uuid default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_actor jsonb;
begin perform public.static_weekly_v3_assert_control_plane(); v_actor:=public.static_weekly_v3_manager_actor(p_manager_id); perform public.static_weekly_v3_assert_draft_incumbency(p_draft_version_id); if p_publication_kind='rollback_compensation' then perform public.static_weekly_v3_assert_rollback_lineage(p_draft_version_id,p_rollback_of_version_id); elsif p_rollback_of_version_id is not null then raise exception using errcode='23514',message='only rollback compensation accepts a rollback target'; end if; return public.static_weekly_v2_publish_draft(p_draft_version_id,p_expected_draft_revision,p_expected_revision,p_manager_id,v_actor->>'manager_name',p_idempotency_key,p_publication_kind,p_rollback_of_version_id); end
$function$;

create or replace function public.static_weekly_v3_apply_exception(p_exception_type text,p_service_date date,p_starts_at time,p_ends_at time,p_base_version_id uuid,p_publication_id uuid,p_reason text,p_payload jsonb,p_expected_revision bigint,p_manager_id uuid,p_idempotency_key text,p_reverses_exception_id uuid default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_actor jsonb;
begin perform public.static_weekly_v3_assert_control_plane(); v_actor:=public.static_weekly_v3_manager_actor(p_manager_id); return public.static_weekly_v2_apply_exception(p_exception_type,p_service_date,p_starts_at,p_ends_at,p_base_version_id,p_publication_id,p_reason,p_payload,p_expected_revision,p_manager_id,v_actor->>'manager_name',p_idempotency_key,p_reverses_exception_id); end
$function$;

create or replace function public.static_weekly_v3_replace_incumbency(p_slot_id uuid,p_person_id uuid,p_person_name_snapshot text,p_effective_start date,p_expected_revision bigint,p_manager_id uuid,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_actor jsonb;
begin perform public.static_weekly_v3_assert_control_plane(); v_actor:=public.static_weekly_v3_manager_actor(p_manager_id); return public.static_weekly_v2_replace_incumbency(p_slot_id,p_person_id,p_person_name_snapshot,p_effective_start,p_expected_revision,p_manager_id,v_actor->>'manager_name',p_idempotency_key); end
$function$;

create or replace function public.static_weekly_v3_materialize_projection(p_publication_id uuid,p_service_date date,p_exception_set_digest text,p_compiler_version text,p_objective jsonb,p_metrics jsonb,p_replay_digest text,p_envelope jsonb,p_expected_revision bigint,p_manager_id uuid,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_actor jsonb; v_envelope jsonb;
begin perform public.static_weekly_v3_assert_control_plane(); v_actor:=public.static_weekly_v3_manager_actor(p_manager_id); v_envelope:=jsonb_set(p_envelope,'{attestation}',public.static_weekly_v3_issue_attestation('dated_projection',public.static_weekly_projection_attestation_payload(p_envelope)),true); return public.static_weekly_v2_materialize_projection(p_publication_id,p_service_date,p_exception_set_digest,p_compiler_version,p_objective,p_metrics,p_replay_digest,v_envelope,p_expected_revision,p_manager_id,v_actor->>'manager_name',p_idempotency_key); end
$function$;

-- A control-plane login may compile and persist only a release-registered
-- source of record.  This closes the bootstrap gap as well as later drafts:
-- ordinary request payloads never become recurring roster/work/proximity
-- truth merely because a privileged process happened to sign them.
create table if not exists public.static_weekly_authority_source_documents (
  source_id uuid primary key,
  canonical_source jsonb not null,
  source_digest text not null unique check(source_digest ~ '^[0-9a-f]{64}$'),
  active boolean not null default true,
  configured_at timestamptz not null default statement_timestamp(),
  configured_by text not null check(length(btrim(configured_by)) between 1 and 200),
  retired_at timestamptz,
  retired_by text,
  check((retired_at is null) or active is false)
);
alter table public.weekly_schedule_versions add column if not exists authority_source_id uuid references public.static_weekly_authority_source_documents(source_id);

create or replace function public.static_weekly_version_guard()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $function$
begin
  if tg_op='DELETE' then raise exception using errcode='23514',message='weekly versions are immutable'; end if;
  if tg_op='INSERT' then
    if new.lifecycle_state='published' and current_setting('app.static_weekly_publish_write',true) is distinct from 'on' then raise exception using errcode='23514',message='published versions require v2 publication'; end if;
    return new;
  end if;
  if old.lifecycle_state='draft' and current_setting('app.static_weekly_publish_write',true)='on' and new.lifecycle_state='published' and new.revision=old.revision then return new; end if;
  -- v3 binds a just-created v2 draft to a registered immutable source inside
  -- the same SECURITY DEFINER transaction. No other field/revision may move.
  if old.lifecycle_state='draft' and current_setting('app.static_weekly_source_bind',true)='on' and old.authority_source_id is null and new.authority_source_id is not null and (to_jsonb(new)-'authority_source_id')=(to_jsonb(old)-'authority_source_id') then return new; end if;
  if old.lifecycle_state<>'draft' or current_setting('app.static_weekly_draft_write',true) is distinct from 'on' or new.lifecycle_state<>'draft' or new.revision<>old.revision+1 then raise exception using errcode='23514',message='draft versions require a revision-checked v2 command'; end if;
  return new;
end
$function$;

create or replace function public.static_weekly_v3_source_identity(p_source jsonb)
returns jsonb language plpgsql immutable as $function$
declare v_identity jsonb; v_version jsonb;
begin
  if jsonb_typeof(p_source) is distinct from 'object' or coalesce(p_source->'exceptions','[]'::jsonb)<>'[]'::jsonb then
    raise exception using errcode='23514',message='registered scheduler source must be one exception-free recurring compiler input';
  end if;
  if jsonb_typeof(p_source->'version')='object' then
    v_version:=p_source->'version';
  elsif jsonb_typeof(p_source->'versions')='array' and jsonb_array_length(p_source->'versions')=1 then
    v_version:=(p_source->'versions')->0;
  else
    raise exception using errcode='23514',message='registered scheduler source must carry exactly one recurring version';
  end if;
  v_version:=v_version-'id'-'publicationId'-'status'-'effectiveStart'-'effectiveEnd';
  v_identity:=(p_source-'serviceDate'-'exceptions'-'version'-'versions');
  return jsonb_set(v_identity,'{version}',v_version,true);
end
$function$;

create or replace function public.static_weekly_v3_register_authority_source(p_source_id uuid,p_canonical_source jsonb,p_configured_by text default 'release-owner')
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_digest text;
begin
  perform public.static_weekly_v3_assert_release_operator();
  if p_source_id is null or nullif(btrim(p_configured_by),'') is null then raise exception using errcode='22023',message='registered scheduler source needs an immutable UUID and release owner'; end if;
  perform public.static_weekly_v3_source_identity(p_canonical_source); v_digest:=public.static_weekly_digest_jsonb(p_canonical_source);
  insert into public.static_weekly_authority_source_documents(source_id,canonical_source,source_digest,configured_by)
  values(p_source_id,p_canonical_source,v_digest,left(p_configured_by,200));
  return jsonb_build_object('source_id',p_source_id::text,'source_digest',v_digest,'active',true);
end
$function$;

create or replace function public.static_weekly_v3_assert_registered_source(p_source_id uuid,p_compiler_input jsonb)
returns void language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_source jsonb;
begin
  select canonical_source into v_source from public.static_weekly_authority_source_documents where source_id=p_source_id and active=true and retired_at is null for share;
  if not found or public.static_weekly_v3_source_identity(p_compiler_input) is distinct from public.static_weekly_v3_source_identity(v_source) then
    raise exception using errcode='23514',message='draft compiler input must exactly bind one active release-registered recurring source';
  end if;
end
$function$;

create or replace function public.static_weekly_v3_read_authority_source(p_source_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_source jsonb;
begin
  perform public.static_weekly_v3_assert_control_plane();
  select canonical_source into v_source from public.static_weekly_authority_source_documents where source_id=p_source_id and active=true and retired_at is null for share;
  if not found then raise exception using errcode='23514',message='scheduler source is not an active release-registered source of record'; end if;
  return jsonb_build_object('source_id',p_source_id::text,'compiler_input',v_source,'exceptions','[]'::jsonb);
end
$function$;

create or replace function public.static_weekly_v3_read_publication_source(p_publication_id uuid,p_service_date date)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_document jsonb; v_version uuid; v_source uuid;
begin
  perform public.static_weekly_v3_assert_control_plane();
  select v.draft_document,p.version_id,v.authority_source_id into v_document,v_version,v_source from public.weekly_schedule_publications p join public.weekly_schedule_versions v on v.version_id=p.version_id where p.publication_id=p_publication_id;
  if not found or v_source is null or public.static_weekly_effective_version(p_service_date) is distinct from v_version then raise exception using errcode='23514',message='control plane source must name the effective immutable publication and registered source'; end if;
  return jsonb_build_object('source_id',v_source::text,'compiler_input',v_document#>'{semantic_snapshot,recurring_source}','exceptions',public.static_weekly_compiler_exception_set(p_publication_id,p_service_date),'publication_id',p_publication_id::text,'version_id',v_version::text,'authority_revision',(select current_revision from public.static_weekly_schedule_control where singleton));
end
$function$;

create or replace function public.static_weekly_v3_create_draft(p_effective_start date,p_objective_version text,p_objective jsonb,p_input_provenance jsonb,p_document jsonb,p_expected_revision bigint,p_manager_id uuid,p_idempotency_key text,p_source_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_actor jsonb; v_document jsonb; v_response jsonb; v_version uuid; v_source uuid;
begin
  perform public.static_weekly_v3_assert_control_plane(); v_actor:=public.static_weekly_v3_manager_actor(p_manager_id); perform public.static_weekly_v3_assert_registered_source(p_source_id,p_document#>'{semantic_snapshot,recurring_source}');
  v_document:=jsonb_set(p_document,'{attestation}',public.static_weekly_v3_issue_attestation('recurring_document',public.static_weekly_document_attestation_payload(p_document)),true);
  v_response:=public.static_weekly_v2_create_draft(p_effective_start,p_objective_version,p_objective,p_input_provenance,v_document,p_expected_revision,p_manager_id,v_actor->>'manager_name',p_idempotency_key);
  v_version:=(v_response#>>'{data,version_id}')::uuid; perform set_config('app.static_weekly_source_bind','on',true); update public.weekly_schedule_versions set authority_source_id=p_source_id where version_id=v_version and authority_source_id is null;
  select authority_source_id into v_source from public.weekly_schedule_versions where version_id=v_version for share;
  if v_source is distinct from p_source_id then raise exception using errcode='23514',message='draft did not retain one immutable authority source identity'; end if;
  return v_response;
end
$function$;

create or replace function public.static_weekly_v3_update_draft(p_version_id uuid,p_document jsonb,p_objective jsonb,p_input_provenance jsonb,p_expected_draft_revision bigint,p_expected_revision bigint,p_manager_id uuid,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_actor jsonb; v_document jsonb; v_source uuid;
begin
  perform public.static_weekly_v3_assert_control_plane(); v_actor:=public.static_weekly_v3_manager_actor(p_manager_id); select authority_source_id into v_source from public.weekly_schedule_versions where version_id=p_version_id and lifecycle_state='draft' for share; perform public.static_weekly_v3_assert_registered_source(v_source,p_document#>'{semantic_snapshot,recurring_source}');
  v_document:=jsonb_set(p_document,'{attestation}',public.static_weekly_v3_issue_attestation('recurring_document',public.static_weekly_document_attestation_payload(p_document)),true);
  return public.static_weekly_v2_update_draft(p_version_id,v_document,p_objective,p_input_provenance,p_expected_draft_revision,p_expected_revision,p_manager_id,v_actor->>'manager_name',p_idempotency_key);
end
$function$;

create or replace function public.static_weekly_v3_publish_draft(p_draft_version_id uuid,p_expected_draft_revision bigint,p_expected_revision bigint,p_manager_id uuid,p_idempotency_key text,p_publication_kind text default 'publish',p_rollback_of_version_id uuid default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_actor jsonb;
begin
  perform public.static_weekly_v3_assert_control_plane(); v_actor:=public.static_weekly_v3_manager_actor(p_manager_id); perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0)); perform public.static_weekly_v3_assert_draft_incumbency(p_draft_version_id); if p_publication_kind='rollback_compensation' then perform public.static_weekly_v3_assert_rollback_lineage(p_draft_version_id,p_rollback_of_version_id); elsif p_rollback_of_version_id is not null then raise exception using errcode='23514',message='only rollback compensation accepts a rollback target'; end if; return public.static_weekly_v2_publish_draft(p_draft_version_id,p_expected_draft_revision,p_expected_revision,p_manager_id,v_actor->>'manager_name',p_idempotency_key,p_publication_kind,p_rollback_of_version_id); end
$function$;

do $security$
declare proc record; r text;
begin
  alter table public.static_weekly_authority_attestation_keys enable row level security;
  alter table public.static_weekly_authority_attestation_keys force row level security;
  revoke all on table public.static_weekly_authority_attestation_keys from public,anon,authenticated,service_role,static_weekly_control_plane;
  revoke all on table public.static_weekly_authority_source_documents from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator;
  for proc in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'static_weekly%' loop
    execute format('revoke all on function %s from public',proc.signature);
    foreach r in array array['anon','authenticated','service_role','static_weekly_control_plane','static_weekly_release_operator'] loop if exists(select 1 from pg_roles where rolname=r) then execute format('revoke all on function %s from %I',proc.signature,r); end if; end loop;
  end loop;
end
$security$;

grant execute on function public.static_weekly_v3_create_draft(date,text,jsonb,jsonb,jsonb,bigint,uuid,text,uuid) to static_weekly_control_plane;
grant execute on function public.static_weekly_v3_read_authority_source(uuid) to static_weekly_control_plane;
grant execute on function public.static_weekly_v3_read_publication_source(uuid,date) to static_weekly_control_plane;
grant execute on function public.static_weekly_v3_update_draft(uuid,jsonb,jsonb,jsonb,bigint,bigint,uuid,text) to static_weekly_control_plane;
grant execute on function public.static_weekly_v3_publish_draft(uuid,bigint,bigint,uuid,text,text,uuid) to static_weekly_control_plane;
grant execute on function public.static_weekly_v3_apply_exception(text,date,time,time,uuid,uuid,text,jsonb,bigint,uuid,text,uuid) to static_weekly_control_plane;
grant execute on function public.static_weekly_v3_replace_incumbency(uuid,uuid,text,date,bigint,uuid,text) to static_weekly_control_plane;
grant execute on function public.static_weekly_v3_materialize_projection(uuid,date,text,text,jsonb,jsonb,text,jsonb,bigint,uuid,text) to static_weekly_control_plane;
grant execute on function public.static_weekly_v3_authority_health() to static_weekly_control_plane,static_weekly_release_operator;
grant execute on function public.static_weekly_v3_configure_initial_authority_key(text,text,text) to static_weekly_release_operator;
grant execute on function public.static_weekly_v3_rotate_authority_key(text,text,timestamptz,text) to static_weekly_release_operator;
grant execute on function public.static_weekly_v3_revoke_authority_key(text,text) to static_weekly_release_operator;
grant execute on function public.static_weekly_v3_recover_authority_key(text,text,text,text) to static_weekly_release_operator;
grant execute on function public.static_weekly_v3_register_authority_source(uuid,jsonb,text) to static_weekly_release_operator;

comment on table public.static_weekly_authority_attestation_keys is 'Private versioned scheduler HMAC keyring. Secrets are database-private and never returned by health or mutation responses. Release ownership provisions a separate control-plane database identity, sets STATIC_WEEKLY_CONTROL_PLANE_DATABASE_URL only on that deployment, rotates with at most 24-hour verification overlap, and revokes/recoveries through v3 release procedures.';
comment on function public.static_weekly_v3_constant_time_equal(bytea,bytea) is 'Compares equal-length decoded MAC bytes with a fixed-work byte loop. Callers validate canonical lower-case hex and exact 32-byte length first. This is structural constant-work code, not a measured remote timing guarantee.';
comment on function public.static_weekly_v3_publish_draft(uuid,bigint,bigint,uuid,text,text,uuid) is 'State machine: first publication=publish; later ordinary replacement=supersede; rollback=one new later-effective rollback_compensation targeting a distinct non-rollback superseded ancestor in the current lineage. Current/no-op, wrong-lineage, and rollback-of-rollback targets are rejected.';

commit;
