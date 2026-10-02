\set ON_ERROR_STOP on
begin;
do $test$
declare
  v_manager uuid;
  v_other uuid;
  v_group uuid;
  v_venue uuid;
  v_event jsonb;
  v_id uuid;
  v_cancel uuid:=gen_random_uuid();
  v_restore uuid:=gen_random_uuid();
  v_result jsonb;
  v_replay jsonb;
  v_review uuid;
begin
  select manager_id into v_manager from public.ops_manager_managers
    where active and revoked_at is null and not is_system_principal
      and roles && array['OPS_MANAGER','CUSTODIAL_MANAGER','DIRECTOR','SECURITY_ADMIN']::text[]
    order by manager_id limit 1;
  select manager_id into v_other from public.ops_manager_managers
    where manager_id<>v_manager and active and revoked_at is null and not is_system_principal
      and roles && array['OPS_MANAGER','CUSTODIAL_MANAGER','DIRECTOR','SECURITY_ADMIN']::text[]
    order by manager_id limit 1;
  select id,location_group_id into v_venue,v_group from public.event_venues
    where venue_code='ZOO_FOOTPRINT' and active limit 1;
  if v_manager is null or v_other is null or v_venue is null or v_group is null then
    raise exception 'two managers and active Zoo Footprint are required in disposable fixture';
  end if;
  if has_function_privilege('authenticated','public.app_transition_event_cancellation(uuid,text,integer,uuid,uuid,text)','execute')
    or has_function_privilege('anon','public.app_transition_event_cancellation(uuid,text,integer,uuid,uuid,text)','execute')
    or has_function_privilege('custodial_application_reader','public.app_transition_event_cancellation(uuid,text,integer,uuid,uuid,text)','execute')
    or not has_function_privilege('service_role','public.app_transition_event_cancellation(uuid,text,integer,uuid,uuid,text)','execute')
    or has_table_privilege('service_role','public.events_app_transition_receipts','select')
    or has_table_privilege('authenticated','public.events_app_transition_receipts','insert') then
    raise exception 'transition grant boundary wrong';
  end if;
  v_event:=public.app_apply_event_command('create',null,jsonb_build_object(
    'event_name','Disposable event recovery','location_group_id',v_group,
    'event_scope','ZOO_WIDE','primary_venue_id',v_venue,'venue_ids',jsonb_build_array(v_venue),
    'display_location','Zoo Footprint','coverage_location_ids','[]'::jsonb,'staffing_area_ids','[]'::jsonb,
    'status','SCHEDULED','needs_review',false,'event_timezone','America/Chicago',
    'event_date','2026-11-01','end_date','2026-11-01','start_time','09:00:00','end_time','11:00:00',
    'start_instant_utc','2026-11-01T15:00:00.000Z','end_instant_utc','2026-11-01T17:00:00.000Z',
    'operation_id',gen_random_uuid(),'actor_manager_id',v_manager),null,null);
  v_id:=(v_event->>'id')::uuid;
  begin
    perform public.app_apply_event_command('cancel',v_id,jsonb_build_object('actor_manager_id',v_manager),null,null);
    raise exception 'legacy unconditional cancel remained reachable';
  exception when invalid_parameter_value then null;
  end;
  begin
    update public.events_app_events set status='CANCELLED' where id=v_id;
    raise exception 'direct status mutation bypassed transition guard';
  exception when insufficient_privilege then null;
  end;
  v_result:=public.app_transition_event_cancellation(v_id,'cancel',1,v_cancel,v_manager,'confirmed cancellation');
  if v_result->'event'->>'status'<>'CANCELLED' or (v_result->'event'->>'revision')::int<>2
    or v_result->'event'->>'cancelled_from_status'<>'SCHEDULED' then
    raise exception 'ordinary cancellation receipt/status wrong';
  end if;
  v_replay:=public.app_transition_event_cancellation(v_id,'cancel',1,v_cancel,v_manager,'confirmed cancellation');
  if v_replay->>'replayed'<>'true' or v_replay->'event'<>v_result->'event' then
    raise exception 'same lost-response request did not replay exact event snapshot';
  end if;
  begin
    perform public.app_transition_event_cancellation(v_id,'cancel',1,v_cancel,v_other,'confirmed cancellation');
    raise exception 'different manager reused operation';
  exception when sqlstate '40901' then null;
  end;
  begin
    perform public.app_transition_event_cancellation(v_id,'cancel',2,v_cancel,v_manager,'confirmed cancellation');
    raise exception 'changed expected revision reused operation';
  exception when sqlstate '40901' then null;
  end;
  begin
    perform public.app_transition_event_cancellation(v_id,'restore',1,gen_random_uuid(),v_other,null);
    raise exception 'stale manager revision restored event';
  exception when sqlstate '40901' then null;
  end;
  update public.event_venues set active=false where id=v_venue;
  begin
    perform public.app_transition_event_cancellation(v_id,'restore',2,gen_random_uuid(),v_other,null);
    raise exception 'inactive current venue was restored';
  exception when sqlstate '40901' then null;
  end;
  update public.event_venues set active=true where id=v_venue;
  v_result:=public.app_transition_event_cancellation(v_id,'restore',2,v_restore,v_other,null);
  if v_result->'event'->>'status'<>'SCHEDULED' or (v_result->'event'->>'revision')::int<>3
    or v_result->'event'->>'cancelled_from_status' is not null
    or v_result->'event'->>'cancelled_at' is not null then
    raise exception 'restore did not preserve event identity and clear cancellation state';
  end if;
  if (select count(*) from public.events_app_event_history where event_id=v_id and action in ('cancel','restore'))<>2
    or (select count(*) from public.events_app_transition_receipts where event_id=v_id)<>2 then
    raise exception 'transition actor history or receipt count wrong';
  end if;
  if (select actor_manager_id from public.events_app_event_history where event_id=v_id and action='restore')<>v_other then
    raise exception 'restore actor was not the authenticated named manager';
  end if;
  v_replay:=public.app_transition_event_cancellation(v_id,'restore',2,v_restore,v_other,null);
  if v_replay->>'replayed'<>'true' or v_replay->'event'<>v_result->'event' then
    raise exception 'restore replay was not stable';
  end if;
  -- Unresolved review drafts can be cancelled but cannot become scheduled by undo.
  v_event:=public.app_apply_event_command('create',null,jsonb_build_object(
    'event_name','Disposable unknown venue','location_group_id',v_group,
    'event_scope','UNKNOWN','display_location','Unknown hall','source_location_text','Unknown hall',
    'event_date','2026-11-01','end_date','2026-11-01','start_time','09:00:00','end_time','11:00:00',
    'start_instant_utc','2026-11-01T15:00:00.000Z','end_instant_utc','2026-11-01T17:00:00.000Z',
    'operation_id',gen_random_uuid(),'actor_manager_id',v_manager),null,null);
  v_review:=(v_event->>'id')::uuid;
  v_result:=public.app_transition_event_cancellation(v_review,'cancel',1,gen_random_uuid(),v_manager,null);
  if v_result->'event'->>'cancelled_from_status'<>'NEEDS_REVIEW' then
    raise exception 'review cancellation origin lost';
  end if;
  begin
    perform public.app_transition_event_cancellation(v_review,'restore',2,gen_random_uuid(),v_manager,null);
    raise exception 'unresolved review draft became scheduled';
  exception when sqlstate '40901' then null;
  end;
  raise notice 'EVENT_CANCEL_RESTORE_PASS manager=% other=% event=%',v_manager,v_other,v_id;
end $test$;
rollback;
