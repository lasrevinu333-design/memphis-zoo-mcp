\set ON_ERROR_STOP on
begin;
do $test$
declare
  v_manager uuid;
  v_name text;
  v_group uuid;
  v_venue uuid;
  v_source jsonb;
  v_replacement jsonb;
  v_result jsonb;
  v_replay jsonb;
  v_original uuid;
  v_new uuid;
  v_op uuid:=gen_random_uuid();
  v_history integer;
begin
  select manager_id,display_name into v_manager,v_name from public.ops_manager_managers
    where active and not is_system_principal and roles && array['OPS_MANAGER','CUSTODIAL_MANAGER','DIRECTOR','SECURITY_ADMIN']::text[]
    order by manager_id limit 1;
  select id,location_group_id into v_venue,v_group from public.event_venues
    where venue_code='ZOO_FOOTPRINT' and active limit 1;
  if v_manager is null or v_venue is null or v_group is null then raise exception 'disposable manager/venue fixture missing'; end if;
  if has_function_privilege('authenticated','public.app_replace_event_authoritative(uuid,integer,jsonb,uuid)','execute')
    or has_function_privilege('anon','public.app_replace_event_authoritative(uuid,integer,jsonb,uuid)','execute')
    or has_function_privilege('custodial_application_reader','public.app_replace_event_authoritative(uuid,integer,jsonb,uuid)','execute')
    or not has_function_privilege('service_role','public.app_replace_event_authoritative(uuid,integer,jsonb,uuid)','execute') then
    raise exception 'replacement execute grant boundary wrong';
  end if;

  v_source:=jsonb_build_object('event_name','Disposable Fall Fold','location_group_id',v_group,
    'event_scope','ZOO_WIDE','primary_venue_id',v_venue,'venue_ids',jsonb_build_array(v_venue),
    'display_location','Zoo Footprint','coverage_location_ids','[]'::jsonb,'staffing_area_ids','[]'::jsonb,
    'status','SCHEDULED','needs_review',false,'event_timezone','America/Chicago',
    'event_date','2026-11-01','end_date','2026-11-01','start_time','01:30:00','end_time','01:45:00',
    'start_instant_utc','2026-11-01T06:30:00.000Z','end_instant_utc','2026-11-01T07:45:00.000Z',
    'operation_id',gen_random_uuid(),'actor_manager_id',v_manager,'created_by',v_name);
  v_source:=public.app_apply_event_command('create',null,v_source,null,null);
  v_original:=(v_source->>'id')::uuid;
  if v_original is null or (v_source->>'start_instant_utc')::timestamptz is distinct from '2026-11-01 06:30Z'::timestamptz
    or (v_source->>'end_instant_utc')::timestamptz is distinct from '2026-11-01 07:45Z'::timestamptz then
    raise exception 'fall fold instants not stored exactly';
  end if;
  begin
    perform public.app_apply_event_command('create',null,
      (v_source-'id'-'revision')||jsonb_build_object('event_date','2026-03-08','end_date','2026-03-08',
        'start_time','02:30:00','end_time','03:30:00','start_instant_utc','2026-03-08T08:30:00.000Z',
        'end_instant_utc','2026-03-08T09:30:00.000Z','operation_id',gen_random_uuid(),
        'actor_manager_id',v_manager),null,null);
    raise exception 'spring gap falsely saved';
  exception when check_violation then null;
  end;

  v_replacement:=v_source-'id'-'revision'-'created_at'-'updated_at'
    ||jsonb_build_object('event_name','Disposable Replacement','event_date','2026-11-01','end_date','2026-11-01',
      'start_time','09:00:00','end_time','11:00:00',
      'start_instant_utc','2026-11-01T15:00:00.000Z','end_instant_utc','2026-11-01T17:00:00.000Z',
      'operation_id',v_op,'status','SCHEDULED','needs_review',false);
  begin
    perform public.app_replace_event_authoritative(v_original,2,v_replacement,v_manager);
    raise exception 'stale replacement falsely saved';
  exception when sqlstate '40901' then null;
  end;
  select count(*) into v_history from public.events_app_events where operation_id=v_op;
  if v_history<>0 then raise exception 'stale replacement created child event'; end if;
  v_result:=public.app_replace_event_authoritative(v_original,1,v_replacement,v_manager);
  v_new:=(v_result->'replacement_event'->>'id')::uuid;
  if v_new is null or (v_result->'old_event'->>'status')<>'SUPERSEDED'
    or (v_result->'old_event'->>'superseded_by_event_id')::uuid<>v_new
    or (v_result->'replacement_event'->>'status')<>'SCHEDULED' then
    raise exception 'atomic replacement state/link wrong';
  end if;
  select count(*) into v_history from public.events_app_event_history
    where event_id in (v_original,v_new) and action in ('supersede','create_replacement');
  if v_history<>2 then raise exception 'replacement history missing: %',v_history; end if;
  v_replay:=public.app_replace_event_authoritative(v_original,1,v_replacement,v_manager);
  if coalesce((v_replay->>'replayed')::boolean,false) is not true
    or (v_replay->'replacement_event'->>'id')::uuid<>v_new then raise exception 'exact replay created a duplicate'; end if;
  begin
    perform public.app_replace_event_authoritative(v_original,1,
      v_replacement||jsonb_build_object('event_name','Changed Replay'),v_manager);
    raise exception 'changed replay falsely accepted';
  exception when sqlstate '40901' then null;
  end;
  begin
    update public.events_app_events set event_name='Tamper' where id=v_original;
    raise exception 'superseded original mutable';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.events_app_events where id=v_original;
    raise exception 'superseded original deletable';
  exception when insufficient_privilege then null;
  end;
  begin
    v_result:=public.app_apply_event_command('create',null,
      v_replacement||jsonb_build_object('status','SUPERSEDED','operation_id',gen_random_uuid(),
        'actor_manager_id',v_manager),null,null);
    if v_result->>'status'<>'SCHEDULED' then raise exception 'writer accepted born-superseded status'; end if;
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.events_app_events(event_name,location_group_id,event_date,end_date,start_time,end_time,
      status,superseded_by_event_id,superseded_at,superseded_by_manager_id,supersession_request_digest)
    values('Forged Superseded',v_group,'2026-11-01','2026-11-01','09:00','10:00',
      'SUPERSEDED',v_new,now(),v_manager,'forged');
    raise exception 'event born superseded';
  exception when insufficient_privilege then null;
  end;
  raise notice 'EVENT_DST_REPLACEMENT_PASS manager=% original=% new=% history=%',v_manager,v_original,v_new,v_history;
end $test$;
rollback;
