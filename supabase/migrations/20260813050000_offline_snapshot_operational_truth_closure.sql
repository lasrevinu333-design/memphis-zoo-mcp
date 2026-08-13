begin;

set local lock_timeout = '5s';
set local statement_timeout = '90s';

-- A snapshot must be reconstructable after the handset is offline.  The ledger
-- records exactly the signed identity issued by the authority endpoint; it is
-- not a cache that can be substituted after reassignment.
create table if not exists public.custodial_offline_scan_authority_snapshots (
  snapshot_id text primary key check (snapshot_id ~ '^[0-9a-f]{64}$'),
  device_id uuid not null references public.devices(id) on delete restrict,
  employee_id uuid not null references public.employees(id) on delete restrict,
  assignment_epoch integer not null check (assignment_epoch >= 0),
  credential_id uuid not null references public.device_auth_credentials(credential_id) on delete restrict,
  generated_at timestamptz not null,
  expires_at timestamptz not null,
  locations_json jsonb not null,
  check (expires_at > generated_at and expires_at <= generated_at + interval '24 hours')
);
create index if not exists idx_custodial_offline_snapshot_identity
  on public.custodial_offline_scan_authority_snapshots(device_id, employee_id, assignment_epoch, credential_id, expires_at);

alter table public.custodial_offline_actor_contexts
  add column if not exists snapshot_id text,
  add column if not exists snapshot_employee_id uuid,
  add column if not exists snapshot_assignment_epoch integer,
  add column if not exists snapshot_credential_id uuid;
alter table public.custodial_offline_actor_contexts
  drop constraint if exists custodial_offline_actor_contexts_snapshot_identity_check;
alter table public.custodial_offline_actor_contexts
  add constraint custodial_offline_actor_contexts_snapshot_identity_check check (
    (snapshot_id is null and snapshot_employee_id is null and snapshot_assignment_epoch is null and snapshot_credential_id is null)
    or (snapshot_id ~ '^[0-9a-f]{64}$' and snapshot_employee_id is not null and snapshot_assignment_epoch is not null and snapshot_credential_id is not null)
  ) not valid;

create or replace function public.tool_get_offline_scan_authority_snapshot(
  p_device_id text, p_authenticated_credential_id text, p_backend_execution_secret text
) returns jsonb language plpgsql security definer
set search_path to 'pg_catalog', 'public', 'extensions'
as $function$
declare
  v_device record; v_credential public.device_auth_credentials%rowtype;
  v_generated_at timestamptz := clock_timestamp(); v_expires_at timestamptz;
  v_locations jsonb; v_snapshot_id text;
begin
  perform public.custodial_require_backend_execution_secret(p_backend_execution_secret);
  select d.id,d.device_id,d.assigned_employee_id,d.assignment_epoch,e.display_name employee_name,e.active employee_active
    into v_device from public.devices d join public.employees e on e.id=d.assigned_employee_id
   where upper(btrim(d.device_id))=upper(btrim(coalesce(p_device_id,''))) and d.active=true;
  begin
    select * into v_credential from public.device_auth_credentials
     where credential_id=nullif(lower(btrim(coalesce(p_authenticated_credential_id,''))),'')::uuid for share;
  exception when others then
    raise exception using errcode='42501',message='an active authenticated employee-device credential is required';
  end;
  if v_device.id is null or v_device.assigned_employee_id is null or v_device.employee_active is not true
     or v_credential.credential_id is null or v_credential.device_id<>v_device.id or v_credential.confirmed_at is null
     or v_credential.revoked_at is not null or v_credential.expires_at<=v_generated_at then
    raise exception using errcode='42501',message='an active authenticated employee-device assignment is required';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('location_code',l.location_code,'location_name',l.location_name,
    'location_type',l.location_type,'form_type',coalesce(l.form_type,l.location_type)) order by l.location_code),'[]'::jsonb)
    into v_locations from public.locations l where l.active=true;
  v_expires_at:=least(v_generated_at+interval '24 hours',v_credential.expires_at);
  v_snapshot_id:=encode(extensions.digest(convert_to(jsonb_build_object('contract_version','scan.v4.snapshot-bound-authority',
    'device_id',v_device.device_id,'employee_id',v_device.assigned_employee_id::text,'assignment_epoch',v_device.assignment_epoch,
    'credential_id',v_credential.credential_id::text,'generated_at',v_generated_at,'expires_at',v_expires_at,'locations',v_locations)::text,'UTF8'),'sha256'),'hex');
  insert into public.custodial_offline_scan_authority_snapshots(snapshot_id,device_id,employee_id,assignment_epoch,credential_id,generated_at,expires_at,locations_json)
  values(v_snapshot_id,v_device.id,v_device.assigned_employee_id,v_device.assignment_epoch,v_credential.credential_id,v_generated_at,v_expires_at,v_locations)
  on conflict(snapshot_id) do nothing;
  return jsonb_build_object('schema_version','offline-scan-snapshot.v2','contract_version','scan.v4.snapshot-bound-authority',
    'snapshot_id',v_snapshot_id,'canonical_device_id',v_device.device_id,'employee_id',v_device.assigned_employee_id,
    'employee_name',v_device.employee_name,'assignment_epoch',v_device.assignment_epoch,'credential_id',v_credential.credential_id,
    'generated_at',v_generated_at,'expires_at',v_expires_at,'locations',v_locations);
end $function$;

drop function if exists public.tool_start_offline_occurrence(text,text,text,text,text,text);
drop function if exists public.custodial_start_offline_occurrence(text,text,text,text,text,text);
create function public.custodial_start_offline_occurrence(
  p_device_id text, p_location_code text, p_client_session_id text, p_client_started_at text,
  p_snapshot_id text, p_snapshot_employee_id text, p_snapshot_assignment_epoch integer,
  p_snapshot_credential_id text, p_authenticated_credential_id text, p_backend_execution_secret text
) returns jsonb language plpgsql security definer
set search_path to 'pg_catalog', 'public', 'extensions'
as $function$
declare
  v_client_session_id text:=nullif(btrim(coalesce(p_client_session_id,'')), ''); v_started_at timestamptz;
  v_credential_id uuid; v_snapshot_employee_id uuid; v_snapshot_credential_id uuid;
  v_snapshot public.custodial_offline_scan_authority_snapshots%rowtype;
  v_existing public.custodial_offline_actor_contexts%rowtype; v_proof public.custodial_offline_submission_proofs%rowtype;
  v_device record; v_location record; v_assignment_change_id uuid; v_context public.custodial_offline_actor_contexts%rowtype;
  v_proof_value text:=encode(extensions.gen_random_bytes(32),'hex'); v_fingerprint text;
begin
  perform public.custodial_require_backend_execution_secret(p_backend_execution_secret);
  if v_client_session_id is null or length(v_client_session_id)>200 then raise exception using errcode='22023',message='client_session_id is required for offline occurrence activation'; end if;
  begin
    v_started_at:=nullif(btrim(coalesce(p_client_started_at,'')),'')::timestamptz;
    v_credential_id:=nullif(lower(btrim(coalesce(p_authenticated_credential_id,''))),'')::uuid;
    v_snapshot_employee_id:=nullif(lower(btrim(coalesce(p_snapshot_employee_id,''))),'')::uuid;
    v_snapshot_credential_id:=nullif(lower(btrim(coalesce(p_snapshot_credential_id,''))),'')::uuid;
  exception when others then raise exception using errcode='22023',message='offline activation requires canonical snapshot identity and credential'; end;
  if nullif(lower(btrim(coalesce(p_snapshot_id,''))),'') !~ '^[0-9a-f]{64}$' or p_snapshot_assignment_epoch is null
     or v_snapshot_credential_id<>v_credential_id then raise exception using errcode='22023',message='exact authenticated snapshot identity is required for offline occurrence activation'; end if;
  if not isfinite(v_started_at) or v_started_at>now()+interval '10 minutes' or v_started_at<now()-interval '7 days' then raise exception using errcode='22023',message='offline occurrence start timestamp is outside the accepted window'; end if;
  perform pg_advisory_xact_lock(hashtextextended('custodial-offline-activation:'||v_client_session_id,0));
  select * into v_existing from public.custodial_offline_actor_contexts where client_session_id=v_client_session_id for update;
  if v_existing.context_id is not null then
    if upper(btrim(coalesce(p_device_id,'')))<>upper((select device_id from public.devices where id=v_existing.device_id))
       or v_existing.credential_id<>v_credential_id or v_existing.canonical_location_code<>public.resolve_scan_location_code(p_location_code)
       or v_existing.started_at<>v_started_at or v_existing.snapshot_id<>lower(btrim(p_snapshot_id))
       or v_existing.snapshot_employee_id<>v_snapshot_employee_id or v_existing.snapshot_assignment_epoch<>p_snapshot_assignment_epoch
       or v_existing.snapshot_credential_id<>v_snapshot_credential_id then raise exception using errcode='23505',message='offline occurrence activation replay does not match the original frozen snapshot'; end if;
    select * into v_proof from public.custodial_offline_submission_proofs where context_id=v_existing.context_id for update;
    if v_proof.state='issued' and v_proof.issued_submission_proof is not null then
      return jsonb_build_object('context_id',v_existing.context_id,'occurrence_id',v_existing.occurrence_id,'client_session_id',v_existing.client_session_id,
        'canonical_location_code',v_existing.canonical_location_code,'location_aliases',v_existing.location_aliases,'started_at',v_existing.started_at,
        'submission_proof',v_proof.issued_submission_proof,'expires_at',v_existing.expires_at,'snapshot_id',v_existing.snapshot_id,
        'schema_version','offline-authority.v4','committable',true,'replayed',true,'frozen_actor',true);
    end if;
    raise exception using errcode='40901',message='the frozen occurrence cannot recover a completion proof; create a manager-visible recovery disposition';
  end if;
  select * into v_snapshot from public.custodial_offline_scan_authority_snapshots where snapshot_id=lower(btrim(p_snapshot_id)) for share;
  if v_snapshot.snapshot_id is null or v_snapshot.employee_id<>v_snapshot_employee_id or v_snapshot.assignment_epoch<>p_snapshot_assignment_epoch
     or v_snapshot.credential_id<>v_snapshot_credential_id or v_snapshot.expires_at<=now() then raise exception using errcode='42501',message='issued offline authority snapshot is absent, expired, or does not match its exact identity'; end if;
  select d.id,d.device_id,c.confirmed_at,c.revoked_at,c.expires_at
    into v_device from public.devices d
    join public.device_auth_credentials c on c.credential_id=v_credential_id and c.device_id=d.id
   where upper(btrim(d.device_id))=upper(btrim(coalesce(p_device_id,''))) and d.active=true for update of d;
  if v_device.id is null or v_device.id<>v_snapshot.device_id
     or v_device.confirmed_at is null or v_device.revoked_at is not null or v_device.expires_at<=now() then
    raise exception using errcode='42501',message='the authenticated device credential cannot exercise the issued offline snapshot';
  end if;
  select l.id,l.location_code,jsonb_build_array(l.location_code,upper(btrim(p_location_code))) aliases into v_location
    from public.locations l where l.location_code=public.resolve_scan_location_code(p_location_code) and l.active=true;
  if v_location.id is null or not exists(select 1 from jsonb_array_elements(v_snapshot.locations_json) x where x->>'location_code'=v_location.location_code) then raise exception using errcode='22023',message='active location is not authorized by the issued offline snapshot'; end if;
  select h.assignment_change_id into v_assignment_change_id from public.custodial_employee_device_assignment_history h
   where h.device_id=v_snapshot.device_id and h.new_employee_id=v_snapshot.employee_id
     and h.changed_at<=v_snapshot.generated_at
   order by h.changed_at desc limit 1;
  if v_assignment_change_id is null then raise exception using errcode='42501',message='an authoritative device assignment epoch is required for offline occurrence activation'; end if;
  v_fingerprint:=encode(extensions.digest(convert_to(jsonb_build_object('client_session_id',v_client_session_id,'device_id',v_snapshot.device_id::text,
    'employee_id',v_snapshot.employee_id::text,'credential_id',v_credential_id::text,'assignment_epoch',v_snapshot.assignment_epoch,
    'snapshot_id',v_snapshot.snapshot_id,'snapshot_employee_id',v_snapshot.employee_id::text,'snapshot_assignment_epoch',v_snapshot.assignment_epoch,
    'snapshot_credential_id',v_snapshot.credential_id::text,'assignment_change_id',v_assignment_change_id::text,'location_id',v_location.id::text,
    'location_code',v_location.location_code,'location_aliases',v_location.aliases,'started_at',v_started_at)::text,'UTF8'),'sha256'),'hex');
  insert into public.custodial_offline_actor_contexts(client_session_id,device_id,employee_id,credential_id,assignment_epoch,assignment_change_id,location_id,canonical_location_code,location_aliases,started_at,occurrence_fingerprint,expires_at,snapshot_id,snapshot_employee_id,snapshot_assignment_epoch,snapshot_credential_id)
  values(v_client_session_id,v_snapshot.device_id,v_snapshot.employee_id,v_credential_id,v_snapshot.assignment_epoch,v_assignment_change_id,v_location.id,v_location.location_code,v_location.aliases,v_started_at,v_fingerprint,now()+interval '7 days',v_snapshot.snapshot_id,v_snapshot.employee_id,v_snapshot.assignment_epoch,v_snapshot.credential_id) returning * into v_context;
  insert into public.custodial_offline_submission_proofs(context_id,proof_digest,issued_submission_proof) values(v_context.context_id,encode(extensions.digest(convert_to(v_proof_value,'UTF8'),'sha256'),'hex'),v_proof_value);
  return jsonb_build_object('context_id',v_context.context_id,'occurrence_id',v_context.occurrence_id,'client_session_id',v_context.client_session_id,'canonical_location_code',v_context.canonical_location_code,'location_aliases',v_context.location_aliases,'started_at',v_context.started_at,'employee_id',v_context.employee_id,'assignment_epoch',v_context.assignment_epoch,'submission_proof',v_proof_value,'expires_at',v_context.expires_at,'snapshot_id',v_snapshot.snapshot_id,'schema_version','offline-authority.v4','committable',true,'replayed',false,'frozen_actor',true);
end $function$;
create function public.tool_start_offline_occurrence(p_device_id text,p_location_code text,p_client_session_id text,p_client_started_at text,p_snapshot_id text,p_snapshot_employee_id text,p_snapshot_assignment_epoch integer,p_snapshot_credential_id text,p_authenticated_credential_id text,p_backend_execution_secret text)
returns jsonb language sql security definer set search_path to 'pg_catalog','public','extensions' as $function$
  select public.custodial_start_offline_occurrence(p_device_id,p_location_code,p_client_session_id,p_client_started_at,p_snapshot_id,p_snapshot_employee_id,p_snapshot_assignment_epoch,p_snapshot_credential_id,p_authenticated_credential_id,p_backend_execution_secret)
$function$;
revoke all on function public.custodial_start_offline_occurrence(text,text,text,text,text,text,integer,text,text,text),public.tool_start_offline_occurrence(text,text,text,text,text,text,integer,text,text,text) from public,anon,authenticated;
grant execute on function public.custodial_start_offline_occurrence(text,text,text,text,text,text,integer,text,text,text),public.tool_start_offline_occurrence(text,text,text,text,text,text,integer,text,text,text) to postgres,service_role;

create or replace function public.custodial_backend_authority_health(p_backend_execution_secret text)
returns jsonb language plpgsql security definer set search_path to 'pg_catalog','public','extensions'
as $function$
begin
  perform public.custodial_require_backend_execution_secret(p_backend_execution_secret);
  return jsonb_build_object('ok',true,'authority','offline-authority.v4','phase','snapshot-rebind-closure',
    'configured',true,'issued_snapshot_ledger',true,'frozen_exact_replay',true,'operational_day_location_truth',true);
end $function$;

-- Never-cleaned locations can only be due when they have a current operational
-- day assignment. Cancelled, inactive, and unassigned rows remain not_cleaned.
create or replace view public.v_location_dashboard_status as
with op_day as (select public.operational_day_start(now()) day_start, public.sch_service_date(public.operational_day_start(now())) service_date),
scheduled_baseline as (
  select membership.location_id, min((od.service_date + schedule.coverage_start::time) at time zone 'America/Chicago') baseline_at
  from op_day od join lateral public.sch_get_daily_schedule_with_purpose(od.service_date) schedule on schedule.status='ASSIGNED' and schedule.assigned_employee_id is not null and coalesce(schedule.coverage_purpose,'area_owner')<>'reminder'
  join public.location_group_memberships membership on membership.location_group_id=schedule.location_group_id and membership.active=true
  join public.locations location on location.id=membership.location_id and location.active=true
  group by membership.location_id
), latest_scan as (select location_id,max(coalesce(scanned_at,created_at)) last_scan_at from public.scan_events group by location_id),
open_session as (select distinct on (s.location_id) s.location_id,s.id session_id,s.session_uuid,s.status session_status,s.started_at,s.ended_at,s.duration_minutes,s.duration_display,e.display_name employee_name,d.device_id device_identifier from public.sessions s cross join op_day od left join public.employees e on e.id=s.employee_id left join public.devices d on d.id=s.device_id where s.status in ('active','pending_submit') and s.started_at>=od.day_start order by s.location_id,s.started_at desc,s.created_at desc),
latest_completed as (select distinct on (s.location_id) s.location_id,s.id session_id,s.session_uuid,s.started_at,s.ended_at,s.duration_minutes,s.duration_display,e.display_name employee_name,cr.submitted_at,cr.response_json,coalesce(cr.submitted_at,s.ended_at,s.started_at) effective_completed_at from public.sessions s join public.employees e on e.id=s.employee_id left join public.completion_responses cr on cr.session_id=s.id cross join op_day od where s.status='closed' and coalesce(cr.submitted_at,s.ended_at,s.started_at)>=od.day_start order by s.location_id,coalesce(cr.submitted_at,s.ended_at,s.started_at) desc,s.started_at desc),
open_tickets as (select location_id,count(*) open_ticket_count from public.maintenance_tickets where status='open' group by location_id),
truth as (select l.id location_id,l.location_code,l.location_name,l.location_type,l.form_type,od.day_start,ls.last_scan_at,os.session_id open_session_id,os.session_uuid open_session_uuid,os.session_status open_session_status,os.started_at open_session_started_at,os.ended_at open_session_ended_at,os.employee_name open_session_employee_name,os.device_identifier open_session_device_identifier,lc.session_id latest_completed_session_id,lc.session_uuid latest_completed_session_uuid,lc.started_at latest_started_at,lc.ended_at latest_ended_at,lc.submitted_at latest_submitted_at,lc.effective_completed_at latest_completed_at,lc.employee_name latest_employee_name,lc.duration_minutes,lc.duration_display,lc.response_json,coalesce(ot.open_ticket_count,0::bigint) open_ticket_count,sb.baseline_at,coalesce(lc.effective_completed_at,sb.baseline_at) due_baseline_at from public.locations l cross join op_day od left join scheduled_baseline sb on sb.location_id=l.id left join latest_scan ls on ls.location_id=l.id left join open_session os on os.location_id=l.id left join latest_completed lc on lc.location_id=l.id left join open_tickets ot on ot.location_id=l.id where l.active=true)
select location_id,location_code,location_name,location_type,form_type,day_start operational_day_start,last_scan_at,open_session_id,open_session_uuid,open_session_status,open_session_started_at,open_session_ended_at,latest_completed_session_id,latest_completed_session_uuid,latest_started_at,latest_ended_at,latest_submitted_at,latest_completed_at,latest_employee_name,duration_minutes,duration_display,coalesce(response_json->'services_performed',response_json->'servicesPerformed',response_json->'services',response_json->'completed_services',response_json->'completedServices','[]'::jsonb) services_performed,coalesce(response_json->>'notes',response_json->>'cleaning_notes',response_json->>'cleaningNotes',response_json->>'maintenance_notes',response_json->>'maintenanceNotes',response_json->>'other_service_performed',response_json->>'otherServicePerformed',response_json->>'note') notes,open_ticket_count,
case when open_session_status in ('active','pending_submit') then 'in_progress' when due_baseline_at is null then 'not_cleaned' when form_type='restroom' and now()>=due_baseline_at+make_interval(mins=>public.get_setting_int('restroom_overdue_minutes',120)) then 'overdue' when form_type='restroom' and now()>=due_baseline_at+make_interval(mins=>public.get_setting_int('restroom_due_soon_minutes',90)) then 'due_soon' when form_type='exhibit' and now()>=due_baseline_at+make_interval(mins=>public.get_setting_int('exhibit_overdue_minutes',240)) then 'overdue' when form_type='exhibit' and now()>=due_baseline_at+make_interval(mins=>public.get_setting_int('exhibit_due_soon_minutes',195)) then 'due_soon' else 'okay' end status_code,
case when open_session_status in ('active','pending_submit') then 'blue' when due_baseline_at is null then 'black' when (form_type='restroom' and now()>=due_baseline_at+make_interval(mins=>public.get_setting_int('restroom_overdue_minutes',120))) or (form_type='exhibit' and now()>=due_baseline_at+make_interval(mins=>public.get_setting_int('exhibit_overdue_minutes',240))) then 'red' when (form_type='restroom' and now()>=due_baseline_at+make_interval(mins=>public.get_setting_int('restroom_due_soon_minutes',90))) or (form_type='exhibit' and now()>=due_baseline_at+make_interval(mins=>public.get_setting_int('exhibit_due_soon_minutes',195))) then 'yellow' else 'green' end status_color,
to_char(timezone('America/Chicago',day_start),'MM/DD/YYYY HH12:MI AM')||' Central' operational_day_start_display,to_char(timezone('America/Chicago',last_scan_at),'MM/DD/YYYY HH12:MI AM')||' Central' last_scan_at_display,to_char(timezone('America/Chicago',open_session_started_at),'MM/DD/YYYY HH12:MI AM')||' Central' open_session_started_at_display,to_char(timezone('America/Chicago',open_session_ended_at),'MM/DD/YYYY HH12:MI AM')||' Central' open_session_ended_at_display,to_char(timezone('America/Chicago',latest_started_at),'MM/DD/YYYY HH12:MI AM')||' Central' latest_started_at_display,to_char(timezone('America/Chicago',latest_ended_at),'MM/DD/YYYY HH12:MI AM')||' Central' latest_ended_at_display,to_char(timezone('America/Chicago',latest_submitted_at),'MM/DD/YYYY HH12:MI AM')||' Central' latest_submitted_at_display,to_char(timezone('America/Chicago',latest_completed_at),'MM/DD/YYYY HH12:MI AM')||' Central' latest_completed_at_display,open_session_employee_name,open_session_device_identifier from truth;

-- A reminder is for an event occurrence that has not started. Date-only
-- filtering previously emitted a morning reminder after that day's start.
create or replace function public.ops_manager_enqueue_scheduled_notifications(p_now timestamptz default now()) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_local_now timestamp without time zone:=p_now at time zone 'America/Chicago'; v_local_date date:=v_local_now::date; v_local_time time:=v_local_now::time; v_dow smallint:=extract(dow from v_local_now)::smallint; v_target record; v_event_count integer; v_next_event record; v_location_count integer; v_due_count integer; v_overdue_count integer; v_location_fingerprint text; v_location_rows jsonb; v_state public.ops_manager_notification_state%rowtype; v_bucket bigint; v_inserted integer:=0;
begin
for v_target in select pd.credential_id,pd.manager_id,coalesce(pref.event_reminders_enabled,false) event_reminders_enabled,coalesce(pref.event_reminder_weekdays,array[0,1,2,3,4,5,6]::smallint[]) event_reminder_weekdays,coalesce(pref.event_reminder_time,'08:00'::time) event_reminder_time,coalesce(pref.event_lookahead_days,7) event_lookahead_days,coalesce(pref.due_soon_enabled,false) due_soon_enabled,coalesce(pref.overdue_enabled,false) overdue_enabled,coalesce(pref.location_repeat_minutes,240) location_repeat_minutes from public.ops_manager_push_devices pd join public.ops_manager_trusted_devices td on td.credential_id=pd.credential_id and td.manager_id=pd.manager_id join public.ops_manager_managers m on m.manager_id=pd.manager_id left join public.ops_manager_notification_preferences pref on pref.credential_id=pd.credential_id where pd.enabled=true and pd.revoked_at is null and td.revoked_at is null and td.expires_at>p_now and m.active=true and m.revoked_at is null and m.is_system_principal=false loop
if v_target.event_reminders_enabled and v_dow=any(v_target.event_reminder_weekdays) and v_local_time>=v_target.event_reminder_time then
select count(*)::integer into v_event_count from public.events_app_events e where e.status='SCHEDULED' and e.event_date<=v_local_date+v_target.event_lookahead_days and ((e.event_date+coalesce(e.start_time,time '00:00')) at time zone 'America/Chicago')>p_now;
if v_event_count>0 then select e.id,e.event_name,e.event_date,e.start_time,e.display_location,((e.event_date+coalesce(e.start_time,time '00:00')) at time zone 'America/Chicago') occurrence_starts_at into v_next_event from public.events_app_events e where e.status='SCHEDULED' and e.event_date<=v_local_date+v_target.event_lookahead_days and ((e.event_date+coalesce(e.start_time,time '00:00')) at time zone 'America/Chicago')>p_now order by e.event_date,e.start_time,e.event_name limit 1;
insert into public.ops_manager_notification_queue(job_key,credential_id,manager_id,notification_type,title,body,data_json) values('manager-event-digest:'||v_target.credential_id::text||':'||v_next_event.id::text||':'||extract(epoch from v_next_event.occurrence_starts_at)::bigint::text,v_target.credential_id,v_target.manager_id,'event_digest','Upcoming Memphis Zoo Events',left(format('%s event%s in the next %s day%s. Next: %s on %s%s.',v_event_count,case when v_event_count=1 then '' else 's' end,v_target.event_lookahead_days,case when v_target.event_lookahead_days=1 then '' else 's' end,coalesce(v_next_event.event_name,'Event'),to_char(v_next_event.event_date,'Mon FMDD'),case when v_next_event.display_location is null then '' else ' at '||v_next_event.display_location end),1000),jsonb_build_object('kind','event_digest','route','events.html','service_date',v_local_date::text,'lookahead_days',v_target.event_lookahead_days,'next_event_id',v_next_event.id,'next_event_starts_at',v_next_event.occurrence_starts_at)) on conflict(job_key) do nothing; get diagnostics v_event_count=row_count; v_inserted:=v_inserted+v_event_count; end if; end if;
if v_target.due_soon_enabled or v_target.overdue_enabled then select count(*)::integer,count(*) filter(where s.status_code='due_soon')::integer,count(*) filter(where s.status_code='overdue')::integer,md5(coalesce(string_agg(s.location_code||':'||s.status_code,',' order by s.status_code,s.location_code),'')),coalesce(jsonb_agg(jsonb_build_object('location_code',s.location_code,'location_name',s.location_name,'status',s.status_code) order by s.status_code,s.location_name),'[]'::jsonb) into v_location_count,v_due_count,v_overdue_count,v_location_fingerprint,v_location_rows from public.v_location_dashboard_status s where (v_target.due_soon_enabled and s.status_code='due_soon') or (v_target.overdue_enabled and s.status_code='overdue'); select * into v_state from public.ops_manager_notification_state where credential_id=v_target.credential_id and state_key='location_digest' for update; if v_location_count=0 then insert into public.ops_manager_notification_state(credential_id,state_key,fingerprint,metadata_json,updated_at) values(v_target.credential_id,'location_digest','',jsonb_build_object('due_soon',0,'overdue',0),p_now) on conflict(credential_id,state_key) do update set fingerprint='',metadata_json=excluded.metadata_json,updated_at=p_now; elsif v_state.credential_id is null or v_state.fingerprint is distinct from v_location_fingerprint or v_state.last_enqueued_at is null or v_state.last_enqueued_at<=p_now-make_interval(mins=>v_target.location_repeat_minutes) then v_bucket:=floor(extract(epoch from p_now)/(v_target.location_repeat_minutes*60))::bigint; insert into public.ops_manager_notification_queue(job_key,credential_id,manager_id,notification_type,title,body,data_json) values('manager-location-digest:'||v_target.credential_id::text||':'||v_location_fingerprint||':'||v_bucket::text,v_target.credential_id,v_target.manager_id,'location_digest','Custodial Location Attention',left(format('%s overdue and %s due soon across all active areas. Tap to review the dashboard.',v_overdue_count,v_due_count),1000),jsonb_build_object('kind','location_digest','route','dashboard.html','overdue_count',v_overdue_count,'due_soon_count',v_due_count,'locations',v_location_rows)) on conflict(job_key) do nothing; get diagnostics v_location_count=row_count; v_inserted:=v_inserted+v_location_count; insert into public.ops_manager_notification_state(credential_id,state_key,fingerprint,last_enqueued_at,metadata_json,updated_at) values(v_target.credential_id,'location_digest',v_location_fingerprint,p_now,jsonb_build_object('due_soon',v_due_count,'overdue',v_overdue_count),p_now) on conflict(credential_id,state_key) do update set fingerprint=excluded.fingerprint,last_enqueued_at=excluded.last_enqueued_at,metadata_json=excluded.metadata_json,updated_at=now(); end if; end if;
end loop; return jsonb_build_object('ok',true,'enqueued',v_inserted,'checked_at',p_now,'local_date',v_local_date); end $function$;

-- A delayed or retried event digest is useful only while the exact occurrence
-- named in its payload remains in the future.
create or replace function public.ops_manager_claim_notification_jobs(
  p_worker_id text,p_limit integer default 20,p_lease_seconds integer default 120
) returns setof public.ops_manager_notification_queue language plpgsql security definer set search_path=pg_catalog,public as $function$
begin
  if nullif(btrim(p_worker_id),'') is null then raise exception using errcode='22023',message='worker id is required'; end if;
  update public.ops_manager_notification_queue q set status='cancelled',completed_at=now(),leased_until=null,lease_token=null,
    last_error='event occurrence is no longer upcoming',updated_at=now()
  where q.notification_type='event_digest' and (q.status='pending' or (q.status='leased' and q.leased_until<now()))
    and not exists (
      select 1 from public.events_app_events e
      where e.id=case when coalesce(q.data_json->>'next_event_id','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        then (q.data_json->>'next_event_id')::uuid else null end
        and e.status='SCHEDULED'
        and ((e.event_date+e.start_time) at time zone 'America/Chicago')>now()
        and to_jsonb((e.event_date+e.start_time) at time zone 'America/Chicago')=q.data_json->'next_event_starts_at'
    );
  return query with candidates as (
    select q.queue_id from public.ops_manager_notification_queue q
    where ((q.status='pending' and q.available_at<=now()) or (q.status='leased' and q.leased_until<now())) and q.attempts<q.max_attempts
      and (q.notification_type<>'event_digest' or exists (
        select 1 from public.events_app_events e
        where e.id=case when coalesce(q.data_json->>'next_event_id','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          then (q.data_json->>'next_event_id')::uuid else null end
          and e.status='SCHEDULED'
          and ((e.event_date+e.start_time) at time zone 'America/Chicago')>now()
          and to_jsonb((e.event_date+e.start_time) at time zone 'America/Chicago')=q.data_json->'next_event_starts_at'
      ))
    order by q.available_at,q.created_at,q.queue_id for update skip locked limit greatest(1,least(coalesce(p_limit,20),100))
  ) update public.ops_manager_notification_queue q set status='leased',attempts=q.attempts+1,leased_at=now(),
    leased_until=now()+make_interval(secs=>greatest(15,least(coalesce(p_lease_seconds,120),900))),lease_token=gen_random_uuid(),
    worker_id=left(btrim(p_worker_id),160),updated_at=now() from candidates c where q.queue_id=c.queue_id returning q.*;
end $function$;

create or replace function public.ops_manager_finish_notification_job(
  p_queue_id uuid,p_lease_token uuid,p_succeeded boolean,p_provider_message_id text default null,p_error text default null,p_retry_seconds integer default 30
) returns public.ops_manager_notification_queue language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_row public.ops_manager_notification_queue%rowtype; v_event_current boolean:=true;
begin
  select * into v_row from public.ops_manager_notification_queue where queue_id=p_queue_id and status='leased' and lease_token=p_lease_token for update;
  if v_row.queue_id is null then raise exception using errcode='P0002',message='Notification job lease was not found'; end if;
  if v_row.notification_type='event_digest' then
    select exists (
      select 1 from public.events_app_events e
      where e.id=case when coalesce(v_row.data_json->>'next_event_id','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        then (v_row.data_json->>'next_event_id')::uuid else null end
        and e.status='SCHEDULED'
        and ((e.event_date+e.start_time) at time zone 'America/Chicago')>now()
        and to_jsonb((e.event_date+e.start_time) at time zone 'America/Chicago')=v_row.data_json->'next_event_starts_at'
    ) into v_event_current;
  end if;
  if not v_event_current then
    update public.ops_manager_notification_queue set status='cancelled',completed_at=now(),leased_until=null,lease_token=null,
      last_error='event occurrence is no longer upcoming',updated_at=now() where queue_id=p_queue_id returning * into v_row;
  elsif p_succeeded then
    update public.ops_manager_notification_queue set status='sent',sent_at=now(),completed_at=now(),leased_until=null,lease_token=null,
      provider_message_id=nullif(left(coalesce(p_provider_message_id,''),500),''),last_error=null,updated_at=now()
    where queue_id=p_queue_id returning * into v_row;
    update public.ops_manager_notification_state set last_sent_at=now(),updated_at=now()
    where credential_id=v_row.credential_id and state_key=case when v_row.notification_type='location_digest' then 'location_digest' else '__none__' end;
  else
    update public.ops_manager_notification_queue set status=case when attempts>=max_attempts then 'failed' else 'pending' end,
      available_at=case when attempts>=max_attempts then available_at else now()+make_interval(secs=>greatest(15,least(coalesce(p_retry_seconds,30),86400))) end,
      completed_at=case when attempts>=max_attempts then now() else null end,leased_until=null,lease_token=null,
      last_error=left(coalesce(p_error,'Notification delivery failed'),2000),updated_at=now() where queue_id=p_queue_id returning * into v_row;
  end if;
  return v_row;
end $function$;

commit;
