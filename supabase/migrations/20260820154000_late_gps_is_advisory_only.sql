begin;

set local lock_timeout = '5s';
set local statement_timeout = '90s';

-- Preserve the reviewed distance/freshness implementations, but place a
-- session-state authority wrapper in front of both deployed RPC generations.
do $block$
begin
  if to_regprocedure('public.custodial_evaluate_location_proximity_measurement(text,text,numeric,numeric,numeric,text,text,text)') is null then
    alter function public.evaluate_location_proximity(text,text,numeric,numeric,numeric,text,text,text)
      rename to custodial_evaluate_location_proximity_measurement;
  end if;
  if to_regprocedure('public.custodial_evaluate_location_proximity_v2_measurement(text,text,numeric,numeric,numeric,text,text,text,timestamptz)') is null then
    alter function public.evaluate_location_proximity_v2(text,text,numeric,numeric,numeric,text,text,text,timestamptz)
      rename to custodial_evaluate_location_proximity_v2_measurement;
  end if;
end
$block$;

revoke all on function public.custodial_evaluate_location_proximity_measurement(text,text,numeric,numeric,numeric,text,text,text)
  from public,anon,authenticated,service_role;
revoke all on function public.custodial_evaluate_location_proximity_v2_measurement(text,text,numeric,numeric,numeric,text,text,text,timestamptz)
  from public,anon,authenticated,service_role;
grant execute on function public.custodial_evaluate_location_proximity_measurement(text,text,numeric,numeric,numeric,text,text,text)
  to postgres;
grant execute on function public.custodial_evaluate_location_proximity_v2_measurement(text,text,numeric,numeric,numeric,text,text,text,timestamptz)
  to postgres;

create or replace function public.custodial_gps_session_state(
  p_location_code text,
  p_device_identifier text,
  p_session_uuid text
) returns text
language sql
stable
security definer
set search_path to 'pg_catalog','public'
as $function$
  select s.status
  from public.sessions s
  join public.devices d on d.id=s.device_id and d.active=true
  join public.locations l on l.id=s.location_id and l.active=true
  where s.session_uuid=nullif(btrim(coalesce(p_session_uuid,'')),'')
    and l.location_code=public.resolve_scan_location_code(p_location_code)
    and (
      upper(btrim(d.device_id))=upper(btrim(coalesce(p_device_identifier,'')))
      or exists(
        select 1 from public.device_aliases da
        where da.canonical_device_id=d.id and da.active=true
          and upper(btrim(da.alias_identifier))=upper(btrim(coalesce(p_device_identifier,'')))
      )
    )
  limit 1
$function$;

revoke all on function public.custodial_gps_session_state(text,text,text)
  from public,anon,authenticated,service_role;
grant execute on function public.custodial_gps_session_state(text,text,text) to postgres;

create or replace function public.custodial_mark_post_session_gps(
  p_result jsonb,
  p_session_state text
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $function$
declare
  v_scan_event_id uuid;
begin
  v_scan_event_id := nullif(p_result->>'scan_event_id','')::uuid;
  update public.device_location_proximity_status gps
  set result='post_session',
      badge_color='amber',
      metadata_json=coalesce(gps.metadata_json,'{}'::jsonb) || jsonb_build_object(
        'authoritative',false,
        'evidence_scope','post_session_advisory',
        'session_state',p_session_state
      )
  where gps.session_uuid=coalesce(p_result->>'session_uuid','')
    and gps.device_id=(select d.id from public.devices d where d.device_id=p_result->>'device_id' limit 1)
    and gps.location_id=(select l.id from public.locations l where l.location_code=p_result->>'location_code' limit 1);

  if v_scan_event_id is not null then
    update public.scan_events se
    set result='post_session',
        notes='GPS arrived after the cleaning was no longer active. It is retained as advisory evidence only.',
        payload_json=coalesce(se.payload_json,'{}'::jsonb) || jsonb_build_object(
          'authoritative',false,
          'evidence_scope','post_session_advisory',
          'session_state',p_session_state
        )
    where se.id=v_scan_event_id;
  end if;

  return coalesce(p_result,'{}'::jsonb) || jsonb_build_object(
    'result','post_session',
    'badge_color','amber',
    'authoritative',false,
    'evidence_scope','post_session_advisory',
    'session_state',p_session_state
  );
end
$function$;

revoke all on function public.custodial_mark_post_session_gps(jsonb,text)
  from public,anon,authenticated,service_role;
grant execute on function public.custodial_mark_post_session_gps(jsonb,text) to postgres;

create or replace function public.evaluate_location_proximity(
  p_location_code text,
  p_device_identifier text,
  p_latitude numeric,
  p_longitude numeric,
  p_accuracy_m numeric default null,
  p_session_uuid text default null,
  p_client_event_id text default null,
  p_correlation_id text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','extensions'
as $function$
declare
  v_session_key text:=nullif(btrim(coalesce(p_session_uuid,'')),'');
  v_session_state text;
  v_result jsonb;
begin
  if v_session_key is not null then
    v_session_state:=public.custodial_gps_session_state(p_location_code,p_device_identifier,v_session_key);
    if v_session_state is null then
      raise exception using errcode='23503', message='Session does not belong to this device and location';
    end if;
  end if;
  v_result:=public.custodial_evaluate_location_proximity_measurement(
    p_location_code,p_device_identifier,p_latitude,p_longitude,p_accuracy_m,
    p_session_uuid,p_client_event_id,p_correlation_id
  );
  if v_session_state is not null and v_session_state not in ('active','pending_submit') then
    return public.custodial_mark_post_session_gps(v_result,v_session_state);
  end if;
  return v_result || jsonb_build_object('authoritative',false,'evidence_scope','active_work_advisory');
end
$function$;

create or replace function public.evaluate_location_proximity_v2(
  p_location_code text,
  p_device_identifier text,
  p_latitude numeric,
  p_longitude numeric,
  p_accuracy_m numeric default null,
  p_session_uuid text default null,
  p_client_event_id text default null,
  p_correlation_id text default null,
  p_observed_at timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','extensions'
as $function$
declare
  v_session_key text:=nullif(btrim(coalesce(p_session_uuid,'')),'');
  v_session_state text;
  v_result jsonb;
begin
  if v_session_key is not null then
    v_session_state:=public.custodial_gps_session_state(p_location_code,p_device_identifier,v_session_key);
    if v_session_state is null then
      raise exception using errcode='23503', message='Session does not belong to this device and location';
    end if;
  end if;
  v_result:=public.custodial_evaluate_location_proximity_v2_measurement(
    p_location_code,p_device_identifier,p_latitude,p_longitude,p_accuracy_m,
    p_session_uuid,p_client_event_id,p_correlation_id,p_observed_at
  );
  if v_session_state is not null and v_session_state not in ('active','pending_submit') then
    return public.custodial_mark_post_session_gps(v_result,v_session_state);
  end if;
  return v_result;
end
$function$;

-- Recreate the tool wrappers after the renames so their stored dependencies
-- point to the state-checking functions, never the retained measurement cores.
create or replace function public.tool_evaluate_location_proximity(
  p_location_code text,p_device_identifier text,p_latitude numeric,p_longitude numeric,
  p_accuracy_m numeric default null,p_session_uuid text default null,
  p_client_event_id text default null,p_correlation_id text default null
) returns jsonb
language sql
security definer
set search_path to 'pg_catalog','public','extensions'
as $function$
  select public.evaluate_location_proximity(
    p_location_code,p_device_identifier,p_latitude,p_longitude,p_accuracy_m,
    p_session_uuid,p_client_event_id,p_correlation_id
  )
$function$;

create or replace function public.tool_evaluate_location_proximity_v2(
  p_location_code text,p_device_identifier text,p_latitude numeric,p_longitude numeric,
  p_accuracy_m numeric default null,p_session_uuid text default null,
  p_client_event_id text default null,p_correlation_id text default null,
  p_observed_at timestamptz default null
) returns jsonb
language sql
security definer
set search_path to 'pg_catalog','public','extensions'
as $function$
  select public.evaluate_location_proximity_v2(
    p_location_code,p_device_identifier,p_latitude,p_longitude,p_accuracy_m,
    p_session_uuid,p_client_event_id,p_correlation_id,p_observed_at
  )
$function$;

revoke all on function public.evaluate_location_proximity(text,text,numeric,numeric,numeric,text,text,text)
  from public,anon,authenticated;
revoke all on function public.evaluate_location_proximity_v2(text,text,numeric,numeric,numeric,text,text,text,timestamptz)
  from public,anon,authenticated;
revoke all on function public.tool_evaluate_location_proximity(text,text,numeric,numeric,numeric,text,text,text)
  from public,anon,authenticated;
revoke all on function public.tool_evaluate_location_proximity_v2(text,text,numeric,numeric,numeric,text,text,text,timestamptz)
  from public,anon,authenticated;
grant execute on function public.evaluate_location_proximity(text,text,numeric,numeric,numeric,text,text,text) to service_role;
grant execute on function public.evaluate_location_proximity_v2(text,text,numeric,numeric,numeric,text,text,text,timestamptz) to service_role;
grant execute on function public.tool_evaluate_location_proximity(text,text,numeric,numeric,numeric,text,text,text) to service_role;
grant execute on function public.tool_evaluate_location_proximity_v2(text,text,numeric,numeric,numeric,text,text,text,timestamptz) to service_role;

comment on function public.evaluate_location_proximity_v2(text,text,numeric,numeric,numeric,text,text,text,timestamptz) is
  'Advisory GPS evidence. Session-bound observations are active-work evidence only while the session is active or pending_submit; terminal-session observations are retained as post-session advisory telemetry.';

commit;
