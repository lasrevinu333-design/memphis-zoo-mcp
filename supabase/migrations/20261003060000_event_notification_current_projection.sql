-- Only the exact leased employee Event dispatch may read its current,
-- manager-classified speech projection. Legacy IDs and raw evidence stay put.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
set local search_path=pg_catalog,public;

create function public.mz_employee_event_push_current_projection(
  p_job_id uuid,p_lease_token uuid,p_instance_id uuid,
  p_credential_id uuid,p_assignment_epoch bigint
) returns jsonb language plpgsql stable security definer
set search_path=pg_catalog,public as $function$
declare v_job public.operational_notification_jobs%rowtype;
  v_instance public.event_push_instances%rowtype;
  v_event public.events_app_events%rowtype;
  v_employee public.employees%rowtype;
  v_place jsonb;
begin
  if p_job_id is null or p_lease_token is null or p_instance_id is null
    or p_credential_id is null or p_assignment_epoch is null or p_assignment_epoch<1 then
    raise exception using errcode='22023',message='exact leased Event delivery identity is required';
  end if;
  select * into v_job from public.operational_notification_jobs where job_id=p_job_id;
  select * into v_instance from public.event_push_instances where instance_id=p_instance_id;
  if v_job.job_id is null or v_job.job_type<>'employee_event_push'
    or v_job.source_id<>p_instance_id or v_job.status<>'leased'
    or v_job.lease_token is distinct from p_lease_token
    or v_job.leased_until is null or v_job.leased_until<=statement_timestamp()
    or v_instance.instance_id is null or v_instance.state<>'leased'
    or v_instance.dispatch_job_id is distinct from p_job_id
    or v_instance.dispatch_lease_token is distinct from p_lease_token
    or v_instance.credential_id is distinct from p_credential_id
    or v_instance.assignment_epoch is distinct from p_assignment_epoch
    or v_job.payload_json->>'employee_id' is distinct from v_instance.employee_id::text
    or v_job.payload_json->>'event_id' is distinct from v_instance.event_id::text
    or v_job.payload_json->>'notification_key' is distinct from v_instance.notification_key
    or not exists(
      select 1 from public.devices d
      join public.device_auth_credentials c on c.device_id=d.id
        and c.credential_id=v_instance.credential_id
      join public.employee_push_registrations r on r.device_id=d.id
        and r.credential_id=c.credential_id
      where d.id=v_instance.device_id and d.active=true
        and d.assigned_employee_id=v_instance.employee_id
        and d.assignment_epoch=v_instance.assignment_epoch
        and c.confirmed_at is not null and c.revoked_at is null
        and c.expires_at>statement_timestamp()
        and r.registration_id=v_instance.dispatch_registration_id
        and r.employee_id=v_instance.employee_id
        and r.assignment_epoch=v_instance.assignment_epoch
        and r.token_hash=v_instance.dispatch_token_hash
        and r.active=true and r.revoked_at is null) then
    return jsonb_build_object('current',false,'reason','event_delivery_identity_superseded');
  end if;
  select * into v_event from public.events_app_events where id=v_instance.event_id;
  select * into v_employee from public.employees where id=v_instance.employee_id and active=true;
  if v_event.id is null or v_employee.id is null
    or v_event.revision<>v_instance.event_revision or v_event.status<>'SCHEDULED'
    or coalesce(v_event.needs_review,false) or v_event.event_scope='UNKNOWN'
    or v_event.cancelled_at is not null or v_event.archived_at is not null
    or v_event.start_instant_utc is null or v_event.end_instant_utc is null
    or v_event.start_instant_utc<=statement_timestamp()
    or not exists(select 1 from public.mz_event_reminder_schedule(
      v_event.id,v_event.revision,v_instance.employee_id,v_instance.notification_kind) schedule
      where schedule.scheduled_for=v_instance.scheduled_for) then
    return jsonb_build_object('current',false,'reason','event_or_recipient_superseded');
  end if;
  v_place:=public.app_event_place_authority(to_jsonb(v_event),statement_timestamp());
  if (v_place->>'admissible')::boolean is not true then
    return jsonb_build_object('current',false,'reason','event_place_needs_review');
  end if;
  return jsonb_build_object('current',true,'event_id',v_event.id,
    'event_revision',v_event.revision,'instance_id',v_instance.instance_id,
    'notification_key',v_instance.notification_key,
    'employee_id',v_employee.id,'employee_name',v_employee.display_name,
    'event_name',v_event.event_name,
    'display_location',coalesce(nullif(v_place->>'primary_display_name',''),v_event.display_location),
    'event_date',v_event.event_date,'start_time',v_event.start_time,
    'end_time',v_event.end_time,'start_instant_utc',v_event.start_instant_utc,
    'end_instant_utc',v_event.end_instant_utc,
    'attendee_count',v_event.attendee_count,
    'custodial_note_codes',v_event.custodial_note_codes,
    'custodial_public_notes',v_event.custodial_public_notes,
    'place_authority',v_place->>'capability_authority');
end $function$;
revoke all on function public.mz_employee_event_push_current_projection(uuid,uuid,uuid,uuid,bigint)
  from public,anon,authenticated,service_role,custodial_application_reader;
grant execute on function public.mz_employee_event_push_current_projection(uuid,uuid,uuid,uuid,bigint)
  to postgres,service_role;

-- A manager digest has the same confirmed, resolved, current Place admission.
-- Missing exact instants on old rows are not guessed through a DST fold.
create function public.app_event_manager_digest_candidate(p_event_id uuid,p_at timestamptz)
returns table(event_revision integer,occurrence_starts_at timestamptz,
  event_name text,event_date date,display_location text)
language plpgsql stable security definer set search_path=pg_catalog,public as $function$
declare v_event public.events_app_events%rowtype;v_place jsonb;
begin
  if p_event_id is null or p_at is null or not isfinite(p_at) then return; end if;
  select * into v_event from public.events_app_events where id=p_event_id;
  if v_event.id is null or v_event.status<>'SCHEDULED'
    or coalesce(v_event.needs_review,false) or v_event.event_scope='UNKNOWN'
    or v_event.cancelled_at is not null or v_event.archived_at is not null
    or v_event.start_instant_utc is null or v_event.end_instant_utc is null
    or v_event.start_instant_utc<=p_at then return;end if;
  v_place:=public.app_event_place_authority(to_jsonb(v_event),p_at);
  if (v_place->>'admissible')::boolean is not true then return;end if;
  return query select v_event.revision,v_event.start_instant_utc,v_event.event_name,
    v_event.event_date,coalesce(nullif(v_place->>'primary_display_name',''),v_event.display_location);
end $function$;
revoke all on function public.app_event_manager_digest_candidate(uuid,timestamptz)
  from public,anon,authenticated,service_role,custodial_application_reader;
grant execute on function public.app_event_manager_digest_candidate(uuid,timestamptz)
  to postgres,service_role;

create function public.app_event_manager_digest_is_current(p_payload jsonb,p_at timestamptz)
returns boolean language plpgsql stable security definer set search_path=pg_catalog,public as $function$
declare v_id uuid;v_revision integer;v_start timestamptz;
begin
  if p_payload is null or jsonb_typeof(p_payload)<>'object' or p_at is null then return false;end if;
  if coalesce(p_payload->>'next_event_id','') !~*
    '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(p_payload->>'next_event_revision','') !~ '^[1-9][0-9]{0,8}$'
    or coalesce(p_payload->>'next_event_starts_at','')=''
    or not (p_payload ? 'next_event_display_location') then return false;end if;
  begin
    v_id:=(p_payload->>'next_event_id')::uuid;
    v_revision:=(p_payload->>'next_event_revision')::integer;
    v_start:=(p_payload->>'next_event_starts_at')::timestamptz;
  exception when others then return false;end;
  return exists(select 1 from public.app_event_manager_digest_candidate(v_id,p_at) candidate
    where candidate.event_revision=v_revision and candidate.occurrence_starts_at=v_start
      and candidate.display_location is not distinct from
        nullif(p_payload->>'next_event_display_location',''));
end $function$;
revoke all on function public.app_event_manager_digest_is_current(jsonb,timestamptz)
  from public,anon,authenticated,service_role,custodial_application_reader;
grant execute on function public.app_event_manager_digest_is_current(jsonb,timestamptz)
  to postgres,service_role;

-- Replace only the event section of the existing digest writer; location
-- notifications and all recipient/device fences remain byte-for-byte intact.
do $digest_enqueue$ declare v_definition text;v_start integer;v_end integer;begin
  v_definition:=pg_get_functiondef('public.ops_manager_enqueue_scheduled_notifications(timestamptz)'::regprocedure);
  v_start:=strpos(v_definition,'if v_target.event_reminders_enabled and v_dow=any(v_target.event_reminder_weekdays)');
  v_end:=strpos(v_definition,'if v_target.due_soon_enabled or v_target.overdue_enabled');
  if v_start=0 or v_end<=v_start or strpos(v_definition,'app_event_manager_digest_candidate')>0 then
    raise exception 'unexpected manager Event digest writer; refusing unsafe patch';end if;
  v_definition:=substr(v_definition,1,v_start-1)||$event_block$
if v_target.event_reminders_enabled and v_dow=any(v_target.event_reminder_weekdays)
  and v_local_time>=v_target.event_reminder_time then
  select count(*)::integer into v_event_count
  from public.events_app_events e
  cross join lateral public.app_event_manager_digest_candidate(e.id,p_now) candidate
  where candidate.event_date<=v_local_date+v_target.event_lookahead_days;
  if v_event_count>0 then
    select e.id,candidate.event_revision,candidate.event_name,candidate.event_date,
      candidate.display_location,candidate.occurrence_starts_at
    into v_next_event
    from public.events_app_events e
    cross join lateral public.app_event_manager_digest_candidate(e.id,p_now) candidate
    where candidate.event_date<=v_local_date+v_target.event_lookahead_days
    order by candidate.occurrence_starts_at,candidate.event_name,e.id limit 1;
    insert into public.ops_manager_notification_queue
      (job_key,credential_id,manager_id,notification_type,title,body,data_json)
    values('manager-event-digest:'||v_target.credential_id::text||':'||v_next_event.id::text
        ||':'||v_next_event.event_revision::text||':'||extract(epoch from v_next_event.occurrence_starts_at)::bigint::text
        ||':'||md5(coalesce(v_next_event.display_location,'')),
      v_target.credential_id,v_target.manager_id,'event_digest','Upcoming Memphis Zoo Events',
      left(format('%s event%s in the next %s day%s. Next: %s on %s%s.',v_event_count,
        case when v_event_count=1 then '' else 's' end,v_target.event_lookahead_days,
        case when v_target.event_lookahead_days=1 then '' else 's' end,
        coalesce(v_next_event.event_name,'Event'),to_char(v_next_event.event_date,'Mon FMDD'),
        case when v_next_event.display_location is null then '' else ' at '||v_next_event.display_location end),1000),
      jsonb_build_object('kind','event_digest','route','events.html','service_date',v_local_date::text,
        'lookahead_days',v_target.event_lookahead_days,'next_event_id',v_next_event.id,
        'next_event_revision',v_next_event.event_revision,
        'next_event_starts_at',v_next_event.occurrence_starts_at,
        'next_event_display_location',v_next_event.display_location)) on conflict(job_key) do nothing;
    get diagnostics v_event_count=row_count;v_inserted:=v_inserted+v_event_count;
  end if;
end if;
$event_block$||substr(v_definition,v_end);
  execute v_definition;
end $digest_enqueue$;

-- Existing queued digests without an exact event revision are cancelled at
-- claim. Current claims and completion both recheck the same typed predicate.
create or replace function public.ops_manager_notification_job_is_current(
  p_queue_id uuid,p_lease_token uuid,p_push_device_id uuid,p_fcm_token_sha256 text
) returns boolean language sql stable security definer set search_path=pg_catalog,public as $function$
  select exists(select 1 from public.ops_manager_notification_queue q
    where q.queue_id=p_queue_id and q.status='leased' and q.lease_token=p_lease_token
      and q.leased_until>=now()
      and public.custodial_ops_manager_notification_binding_is_current(
        p_push_device_id,q.credential_id,q.manager_id,p_fcm_token_sha256,now())
      and (q.notification_type<>'event_digest'
        or public.app_event_manager_digest_is_current(q.data_json,now()))
      and (q.notification_type<>'location_digest'
        or public.custodial_ops_manager_location_digest_is_current(
          q.credential_id,q.data_json->>'location_fingerprint')));
$function$;
revoke all on function public.ops_manager_notification_job_is_current(uuid,uuid,uuid,text)
  from public,anon,authenticated,custodial_application_reader;
grant execute on function public.ops_manager_notification_job_is_current(uuid,uuid,uuid,text)
  to postgres,service_role;

do $digest_claim_finish$ declare v_definition text;v_start integer;v_end integer;v_identity text;begin
  -- Two claim-site predicates: cancellation and claim candidate admission.
  v_identity:='public.ops_manager_claim_notification_jobs(text,integer,integer)';
  v_definition:=pg_get_functiondef(v_identity::regprocedure);
  v_start:=strpos(v_definition,'    and not exists ('||chr(10)||'      select 1 from public.events_app_events e');
  v_end:=v_start+strpos(substr(v_definition,v_start+1),
    '  update public.ops_manager_notification_queue q set status=''cancelled''');
  if v_start=0 or v_end<=v_start then raise exception 'unexpected digest claim cancellation shape';end if;
  -- Retain the following location cancellation; replace only old event predicate.
  v_definition:=substr(v_definition,1,v_start-1)||
    '    and not public.app_event_manager_digest_is_current(q.data_json,now());'||chr(10)
    ||substr(v_definition,v_end);
  v_start:=strpos(v_definition,'      and (q.notification_type<>''event_digest'' or exists (');
  v_end:=v_start+strpos(substr(v_definition,v_start+1),
    '      and (q.notification_type<>''location_digest''');
  if v_start=0 or v_end<=v_start then raise exception 'unexpected digest claim candidate shape';end if;
  v_definition:=substr(v_definition,1,v_start-1)||
    '      and (q.notification_type<>''event_digest'' or public.app_event_manager_digest_is_current(q.data_json,now()))'||chr(10)
    ||substr(v_definition,v_end);
  execute v_definition;

  v_identity:='public.ops_manager_finish_notification_job(uuid,uuid,uuid,text,boolean,text,text,integer,boolean)';
  v_definition:=pg_get_functiondef(v_identity::regprocedure);
  v_start:=strpos(v_definition,'  if v_row.notification_type=''event_digest'' then');
  v_end:=v_start+strpos(substr(v_definition,v_start+1),
    '  if v_row.notification_type=''location_digest'' then');
  if v_start=0 or v_end<=v_start then raise exception 'unexpected digest finish event shape';end if;
  v_definition:=substr(v_definition,1,v_start-1)||
    '  if v_row.notification_type=''event_digest'' then'||chr(10)||
    '    v_job_current:=v_job_current and public.app_event_manager_digest_is_current(v_row.data_json,now());'||chr(10)||
    '  end if;'||chr(10)||substr(v_definition,v_end);
  execute v_definition;
end $digest_claim_finish$;

-- Recover only these changed Event notification objects and their grants.
do $event_notification_recovery$ declare obj record;ord integer;changed integer;begin
  if not exists(select 1 from pg_trigger
    where tgrelid='public.custodial_release_authority_restore_inventory'::regclass
      and tgname='trg_custodial_release_authority_restore_inventory_immutable' and tgenabled='O') then
    raise exception 'Event notification recovery inventory immutability unavailable';end if;
  alter table public.custodial_release_authority_restore_inventory
    disable trigger trg_custodial_release_authority_restore_inventory_immutable;
  for obj in
    select 100000 bucket,'function'::text kind,p.oid::regprocedure::text identity,
      pg_get_functiondef(p.oid) definition
    from pg_proc p where p.oid=any(array[
      'public.mz_employee_event_push_current_projection(uuid,uuid,uuid,uuid,bigint)'::regprocedure,
      'public.app_event_manager_digest_candidate(uuid,timestamptz)'::regprocedure,
      'public.app_event_manager_digest_is_current(jsonb,timestamptz)'::regprocedure,
      'public.ops_manager_enqueue_scheduled_notifications(timestamptz)'::regprocedure,
      'public.ops_manager_notification_job_is_current(uuid,uuid,uuid,text)'::regprocedure,
      'public.ops_manager_claim_notification_jobs(text,integer,integer)'::regprocedure,
      'public.ops_manager_finish_notification_job(uuid,uuid,uuid,text,boolean,text,text,integer,boolean)'::regprocedure])
    union all select 900000,'grant',x.identity,
      public.custodial_release_authority_current_grant_definition(x.identity)
      from (values
        ('public.mz_employee_event_push_current_projection(uuid,uuid,uuid,uuid,bigint)'),
        ('public.app_event_manager_digest_candidate(uuid,timestamptz)'),
        ('public.app_event_manager_digest_is_current(jsonb,timestamptz)'),
        ('public.ops_manager_enqueue_scheduled_notifications(timestamptz)'),
        ('public.ops_manager_notification_job_is_current(uuid,uuid,uuid,text)'),
        ('public.ops_manager_claim_notification_jobs(text,integer,integer)'),
        ('public.ops_manager_finish_notification_job(uuid,uuid,uuid,text,boolean,text,text,integer,boolean)')) x(identity)
  loop
    if obj.definition is null then raise exception 'Missing Event notification recovery object %',obj.identity;end if;
    update public.custodial_release_authority_restore_inventory set definition_sql=obj.definition,
      definition_sha256=public.static_weekly_digest_text(obj.definition),captured_at=statement_timestamp()
      where object_kind=obj.kind and object_identity=obj.identity;
    get diagnostics changed=row_count;
    if changed>1 then raise exception 'Duplicate Event notification recovery identity %',obj.identity;end if;
    if changed=0 then
      select n into ord from generate_series(obj.bucket+1,obj.bucket+99999) n
      where not exists(select 1 from public.custodial_release_authority_restore_inventory where restore_order=n)
      order by n limit 1;
      if ord is null then raise exception 'Event notification recovery order exhausted';end if;
      insert into public.custodial_release_authority_restore_inventory
        (restore_order,object_kind,object_identity,definition_sql,definition_sha256)
      values(ord,obj.kind,obj.identity,obj.definition,public.static_weekly_digest_text(obj.definition));
    end if;
  end loop;
  alter table public.custodial_release_authority_restore_inventory
    enable trigger trg_custodial_release_authority_restore_inventory_immutable;
end $event_notification_recovery$;

commit;
