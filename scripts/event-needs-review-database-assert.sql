-- Run only against an owned disposable, fully migrated database. All sample
-- event writes are rolled back; catalog/grant checks observe committed DDL.
begin;
set local search_path = pg_catalog, public;
do $test$
declare
  v_manager uuid;
  v_employee uuid;
  v_zoo_group uuid;
  v_venue public.event_venues%rowtype;
  v_review jsonb;
  v_replay jsonb;
  v_resolved jsonb;
  v_id uuid;
  v_operation uuid := '99999999-0000-4000-8000-000000000021';
  v_record jsonb;
begin
  select manager_id into strict v_manager from public.ops_manager_managers
    where active and revoked_at is null and not is_system_principal
      and roles && array['OPS_MANAGER','CUSTODIAL_MANAGER','DIRECTOR','SECURITY_ADMIN']::text[]
    order by manager_id limit 1;
  select id into strict v_employee from public.employees where active order by id limit 1;
  select location_group_id into strict v_zoo_group from public.event_venues
    where venue_code = 'ZOO_FOOTPRINT' and active limit 1;
  select * into strict v_venue from public.event_venues
    where eligible_event_venue and active and event_scope = 'SINGLE_VENUE'
    order by id limit 1;
  v_record := jsonb_build_object(
    'actor_manager_id', v_manager, 'event_name', 'Unknown Venue Regression',
    'location_group_id', v_zoo_group, 'event_scope', 'UNKNOWN',
    'primary_venue_id', null, 'venue_ids', '[]'::jsonb,
    'display_location', 'Needs Review', 'coverage_location_ids', '[]'::jsonb,
    'staffing_area_ids', '[]'::jsonb, 'source_location_text', '  West Service Terrace (TBD)  ',
    'source_text', 'Subject: Unknown Venue Regression; Venue: West Service Terrace (TBD)',
    'source_format', 'email', 'needs_review', true,
    'operation_id', v_operation, 'event_date', current_date + 10,
    'end_date', current_date + 10, 'start_time', '19:00', 'end_time', '21:00'
  );
  v_review := public.app_apply_event_command('create', null, v_record, 'untrusted actor', 'intake');
  v_id := (v_review->>'id')::uuid;
  if v_review->>'status' <> 'NEEDS_REVIEW' or v_review->>'event_scope' <> 'UNKNOWN'
     or (v_review->>'needs_review')::boolean is not true
     or v_review->>'source_location_text' <> '  West Service Terrace (TBD)  '
     or v_review->>'display_location' <> 'Needs Review'
     or v_review->>'source_text' <> 'Subject: Unknown Venue Regression; Venue: West Service Terrace (TBD)'
     or v_review->>'primary_venue_id' is not null
     or jsonb_array_length(v_review->'venue_ids') <> 0
     or jsonb_array_length(v_review->'coverage_location_ids') <> 0
     or jsonb_array_length(v_review->'staffing_area_ids') <> 0 then
    raise exception 'unknown event was not durably isolated: %', v_review;
  end if;
  v_replay := public.app_apply_event_command('create', null, v_record, 'untrusted actor', 'replay');
  if v_replay->>'id' <> v_id::text or v_replay->>'status' <> 'NEEDS_REVIEW'
     or (select count(*) from public.events_app_events where operation_id=v_operation) <> 1 then
    raise exception 'unknown event replay changed identity or status: %', v_replay;
  end if;
  if exists(select 1 from public.events_app_events where id=v_id and status='SCHEDULED') then
    raise exception 'unknown event entered scheduled consumers';
  end if;
  if exists(select 1 from public.mz_event_reminder_schedule(v_id,
      (v_review->>'revision')::integer,v_employee,'three_days_before')) then
    raise exception 'unknown event received an employee reminder schedule';
  end if;
  perform public.mz_enqueue_employee_event_pushes(now());
  if exists(select 1 from public.event_push_instances where event_id=v_id)
     or exists(select 1 from public.operational_notification_jobs
       where job_type='employee_event_push' and payload_json->>'event_id'=v_id::text) then
    raise exception 'unknown event entered the native push outbox';
  end if;
  v_record := v_record || jsonb_build_object(
    'event_scope', 'SINGLE_VENUE', 'needs_review', false,
    'primary_venue_id', v_venue.id, 'venue_ids', jsonb_build_array(v_venue.id),
    'location_group_id', v_venue.location_group_id, 'display_location', v_venue.display_name,
    'source_location_text', '  West Service Terrace (TBD)  '
  );
  v_resolved := public.app_apply_event_command('update', v_id, v_record, 'untrusted actor', 'manager resolved venue');
  if v_resolved->>'status' <> 'SCHEDULED' or v_resolved->>'event_scope' <> 'SINGLE_VENUE'
     or (v_resolved->>'needs_review')::boolean is not false
     or v_resolved->>'source_location_text' <> '  West Service Terrace (TBD)  '
     or (v_resolved->>'revision')::integer <> (v_review->>'revision')::integer + 1
     or (select count(*) from public.events_app_event_history where event_id=v_id and action='update') <> 1 then
    raise exception 'authorized venue resolution did not publish a revision: %', v_resolved;
  end if;
  if has_function_privilege('public', 'public.events_app_isolate_needs_review()', 'execute')
     or has_function_privilege('anon', 'public.events_app_isolate_needs_review()', 'execute')
     or has_function_privilege('authenticated', 'public.events_app_isolate_needs_review()', 'execute')
     or has_function_privilege('service_role', 'public.events_app_isolate_needs_review()', 'execute')
     or has_function_privilege('authenticated', 'public.app_apply_event_command(text,uuid,jsonb,text,text)', 'execute')
     or has_table_privilege('authenticated', 'public.events_app_events', 'insert') then
    raise exception 'event review mutation grant boundary expanded';
  end if;
  if (select count(*) from public.custodial_release_authority_restore_inventory
      where object_identity in (
        'public.events_app_events:events_app_events_status_check',
        'public.events_app_events:events_app_events_review_isolation_check',
        'public.events_app_isolate_needs_review()',
        'public.events_app_events.trg_events_app_zz_needs_review_isolation'
      )) <> 5 then
    raise exception 'event review recovery inventory is incomplete';
  end if;
  if exists(select 1 from public.custodial_release_authority_restore_inventory
      where object_identity in (
        'public.events_app_events:events_app_events_status_check',
        'public.events_app_events:events_app_events_review_isolation_check',
        'public.events_app_isolate_needs_review()',
        'public.events_app_events.trg_events_app_zz_needs_review_isolation'
      ) and definition_sha256 <> public.static_weekly_digest_text(definition_sql))
     or not exists(select 1 from pg_trigger where tgrelid='public.events_app_events'::regclass
       and tgname='trg_events_app_zz_needs_review_isolation' and tgenabled='O') then
    raise exception 'event review recovery hash or trigger state is invalid';
  end if;
  if has_table_privilege('anon', 'public.events_app_events', 'select')
     or has_table_privilege('authenticated', 'public.events_app_events', 'select')
     or has_table_privilege('anon', 'public.events_app_events', 'insert') then
    raise exception 'browser roles gained event table access';
  end if;
  raise notice 'event review create/replay/isolation/resolution/grant/recovery assertions passed';
end
$test$;
rollback;
