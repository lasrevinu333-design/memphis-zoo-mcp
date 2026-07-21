begin;
create extension if not exists pgcrypto with schema extensions;

alter table public.ops_manager_managers
  add column if not exists job_title text,
  add column if not exists department_key text,
  add column if not exists leadership_sort_order integer not null default 100,
  add column if not exists is_system_principal boolean not null default false;

alter table public.ops_manager_managers drop constraint if exists ops_manager_managers_job_title_len;
alter table public.ops_manager_managers add constraint ops_manager_managers_job_title_len check (job_title is null or length(btrim(job_title)) between 1 and 160);
alter table public.ops_manager_managers drop constraint if exists ops_manager_managers_department_key_format;
alter table public.ops_manager_managers add constraint ops_manager_managers_department_key_format check (department_key is null or department_key ~ '^[a-z][a-z0-9_]{2,63}$');
alter table public.ops_manager_managers drop constraint if exists ops_manager_managers_leadership_sort_order;
alter table public.ops_manager_managers add constraint ops_manager_managers_leadership_sort_order check (leadership_sort_order between 1 and 9999);
create index if not exists idx_ops_manager_managers_leadership on public.ops_manager_managers(is_system_principal,active,leadership_sort_order,display_name);

do $leadership$
declare
  v_eric uuid; v_jennifer uuid; v_brandy uuid; v_haley uuid; v_eric_m uuid; v_shared uuid;
  v_legacy_msg_user uuid; v_thread uuid;
begin
  select manager_id into v_eric from public.ops_manager_managers where system_key='eric_custodial_manager' order by created_at limit 1;
  if v_eric is null then
    insert into public.ops_manager_managers(display_name,contact_label,roles,active,metadata_json,system_key,job_title,department_key,leadership_sort_order,is_system_principal)
    values('Eric Operle','Custodial Manager',array['OPS_MANAGER','CUSTODIAL_MANAGER','SECURITY_ADMIN']::text[],true,jsonb_build_object('canonical_leadership_roster',true),'eric_custodial_manager','Custodial Manager','custodial',50,false)
    returning manager_id into v_eric;
  else
    update public.ops_manager_managers set display_name='Eric Operle',contact_label='Custodial Manager',job_title='Custodial Manager',department_key='custodial',leadership_sort_order=50,is_system_principal=false,roles=array['OPS_MANAGER','CUSTODIAL_MANAGER','SECURITY_ADMIN']::text[],active=true,revoked_at=null,revoked_reason=null,metadata_json=coalesce(metadata_json,'{}')||jsonb_build_object('canonical_leadership_roster',true,'canonicalized_at',now()) where manager_id=v_eric;
  end if;

  select manager_id into v_jennifer from public.ops_manager_managers where system_key='jennifer_sheffield_director_operations' limit 1;
  if v_jennifer is null then
    select manager_id into v_jennifer from public.ops_manager_managers where lower(btrim(display_name))='jennifer sheffield' and active=true and revoked_at is null order by case when 'DIRECTOR'=any(roles) then 0 else 1 end,created_at limit 1;
  end if;
  if v_jennifer is null then
    insert into public.ops_manager_managers(display_name,contact_label,roles,active,metadata_json,system_key,job_title,department_key,leadership_sort_order,is_system_principal)
    values('Jennifer Sheffield','Director of Operations',array['DIRECTOR']::text[],true,jsonb_build_object('canonical_leadership_roster',true),'jennifer_sheffield_director_operations','Director of Operations','operations',10,false)
    returning manager_id into v_jennifer;
  else
    update public.ops_manager_managers set display_name='Jennifer Sheffield',contact_label='Director of Operations',job_title='Director of Operations',department_key='operations',leadership_sort_order=10,is_system_principal=false,system_key='jennifer_sheffield_director_operations',roles=array['DIRECTOR']::text[],active=true,revoked_at=null,revoked_reason=null,metadata_json=coalesce(metadata_json,'{}')||jsonb_build_object('canonical_leadership_roster',true,'canonicalized_at',now()) where manager_id=v_jennifer;
  end if;

  select manager_id into v_brandy from public.ops_manager_managers where system_key='brandy_gull_horticulture_manager' limit 1;
  if v_brandy is null then
    insert into public.ops_manager_managers(display_name,contact_label,roles,active,metadata_json,system_key,job_title,department_key,leadership_sort_order,is_system_principal)
    values('Brandy Gull','Horticulture Manager',array['OPS_MANAGER']::text[],true,jsonb_build_object('canonical_leadership_roster',true),'brandy_gull_horticulture_manager','Horticulture Manager','horticulture',20,false) returning manager_id into v_brandy;
  else
    update public.ops_manager_managers set display_name='Brandy Gull',contact_label='Horticulture Manager',job_title='Horticulture Manager',department_key='horticulture',leadership_sort_order=20,is_system_principal=false,roles=array['OPS_MANAGER']::text[],active=true,revoked_at=null,revoked_reason=null,metadata_json=coalesce(metadata_json,'{}')||jsonb_build_object('canonical_leadership_roster',true,'canonicalized_at',now()) where manager_id=v_brandy;
  end if;

  select manager_id into v_haley from public.ops_manager_managers where system_key='haley_lejman_water_quality_manager' limit 1;
  if v_haley is null then
    insert into public.ops_manager_managers(display_name,contact_label,roles,active,metadata_json,system_key,job_title,department_key,leadership_sort_order,is_system_principal)
    values('Haley Lejman','Water Quality Manager',array['OPS_MANAGER']::text[],true,jsonb_build_object('canonical_leadership_roster',true),'haley_lejman_water_quality_manager','Water Quality Manager','water_quality',30,false) returning manager_id into v_haley;
  else
    update public.ops_manager_managers set display_name='Haley Lejman',contact_label='Water Quality Manager',job_title='Water Quality Manager',department_key='water_quality',leadership_sort_order=30,is_system_principal=false,roles=array['OPS_MANAGER']::text[],active=true,revoked_at=null,revoked_reason=null,metadata_json=coalesce(metadata_json,'{}')||jsonb_build_object('canonical_leadership_roster',true,'canonicalized_at',now()) where manager_id=v_haley;
  end if;

  select manager_id into v_eric_m from public.ops_manager_managers where system_key='eric_mckenney_facilities_maintenance_manager' limit 1;
  if v_eric_m is null then
    insert into public.ops_manager_managers(display_name,contact_label,roles,active,metadata_json,system_key,job_title,department_key,leadership_sort_order,is_system_principal)
    values('Eric McKenney','Facilities Maintenance Manager',array['OPS_MANAGER']::text[],true,jsonb_build_object('canonical_leadership_roster',true),'eric_mckenney_facilities_maintenance_manager','Facilities Maintenance Manager','facilities_maintenance',40,false) returning manager_id into v_eric_m;
  else
    update public.ops_manager_managers set display_name='Eric McKenney',contact_label='Facilities Maintenance Manager',job_title='Facilities Maintenance Manager',department_key='facilities_maintenance',leadership_sort_order=40,is_system_principal=false,roles=array['OPS_MANAGER']::text[],active=true,revoked_at=null,revoked_reason=null,metadata_json=coalesce(metadata_json,'{}')||jsonb_build_object('canonical_leadership_roster',true,'canonicalized_at',now()) where manager_id=v_eric_m;
  end if;

  update public.ops_manager_trusted_devices d set manager_id=v_eric,metadata_json=coalesce(d.metadata_json,'{}')||jsonb_build_object('identity_reassigned_at',now(),'identity_reassigned_to','Eric Operle')
  from public.ops_manager_managers m where d.manager_id=m.manager_id and m.manager_id<>v_eric and (lower(btrim(m.display_name))='eric operle' or lower(m.display_name) like 'eric self text invite test%' or lower(d.device_label) like 'eric operle%');
  update public.ops_manager_trusted_devices d set manager_id=v_eric_m,metadata_json=coalesce(d.metadata_json,'{}')||jsonb_build_object('identity_reassigned_at',now(),'identity_reassigned_to','Eric McKenney') where d.revoked_at is null and lower(btrim(d.device_label)) in('eric m','eric mckenney');
  update public.ops_manager_trusted_devices d set manager_id=v_eric,metadata_json=coalesce(d.metadata_json,'{}')||jsonb_build_object('identity_reassigned_at',now(),'identity_reassigned_to','Eric Operle') where d.revoked_at is null and (lower(d.device_label) like '%eric operle%personal%' or lower(d.device_label) like '%eric operle%perosnal%');
  update public.ops_manager_trusted_devices d set manager_id=v_brandy,metadata_json=coalesce(d.metadata_json,'{}')||jsonb_build_object('identity_reassigned_at',now(),'identity_reassigned_to','Brandy Gull')
  where d.revoked_at is null and d.device_id in(select distinct metadata_json->>'device_id' from public.msg_messages where message_type='text' and body ~ 'Who[’‘]s working today' and coalesce(metadata_json->>'device_id','')<>'');

  update public.ops_manager_shared_enrollment_windows set status=case when status='active' then 'disabled' else status end,disabled_at=coalesce(disabled_at,now()),disabled_reason=coalesce(disabled_reason,'retired_for_named_leadership_enrollment') where status='active' or disabled_at is null;
  select manager_id into v_shared from public.ops_manager_managers where system_key='shared_ops_manager' limit 1;
  if v_shared is not null then
    update public.ops_manager_trusted_devices set revoked_at=coalesce(revoked_at,now()),revoked_reason=coalesce(revoked_reason,'shared_identity_quarantined_20260721'),metadata_json=coalesce(metadata_json,'{}')||jsonb_build_object('quarantined_at',now(),'quarantine_reason','unattributed_shared_manager_device') where manager_id=v_shared and revoked_at is null;
    update public.ops_manager_managers set active=false,revoked_at=coalesce(revoked_at,now()),revoked_reason=coalesce(revoked_reason,'shared_identity_retired_for_named_leadership'),is_system_principal=true,metadata_json=coalesce(metadata_json,'{}')||jsonb_build_object('quarantined_at',now(),'quarantine_reason','shared_manager_identity_retired') where manager_id=v_shared;
  end if;

  update public.ops_manager_managers m set active=false,revoked_at=coalesce(m.revoked_at,now()),revoked_reason=coalesce(m.revoked_reason,'quarantined_duplicate_or_test_identity_20260721'),is_system_principal=true,metadata_json=coalesce(m.metadata_json,'{}')||jsonb_build_object('quarantined_at',now(),'quarantine_reason','duplicate_or_test_identity')
  where m.manager_id not in(v_eric,v_jennifer,v_brandy,v_haley,v_eric_m) and (lower(m.display_name) like 'codex %' or lower(m.display_name) like '% test %' or lower(m.display_name) like '% probe %' or lower(m.display_name) like 'eric self text invite test%' or lower(btrim(m.display_name)) in('eric operle','jennifer sheffield','shared ops manager enrollment'));

  select id into v_legacy_msg_user from public.msg_users where ops_manager_id is null and lower(btrim(display_name))='ops manager' and role='manager' order by created_at limit 1;
  if v_legacy_msg_user is not null then
    update public.msg_users set display_name='Legacy Shared Ops Manager',is_active=false,active=false,updated_at=now(),messaging_identity_key=coalesce(messaging_identity_key,'legacy_shared_ops_manager') where id=v_legacy_msg_user;
  end if;

  perform public.msg_ensure_ops_manager_user(v_jennifer); perform public.msg_ensure_ops_manager_user(v_brandy); perform public.msg_ensure_ops_manager_user(v_haley); perform public.msg_ensure_ops_manager_user(v_eric_m); perform public.msg_ensure_ops_manager_user(v_eric);
  perform public.msg_get_or_create_ops_manager_thread(v_jennifer); perform public.msg_get_or_create_ops_manager_thread(v_brandy); perform public.msg_get_or_create_ops_manager_thread(v_haley); perform public.msg_get_or_create_ops_manager_thread(v_eric_m); perform public.msg_get_or_create_ops_manager_thread(v_eric);
  select id into v_thread from public.msg_threads where system_key='ops_manager_shared_chat_v1' limit 1;
  if v_thread is not null then
    update public.msg_threads set title='Operations Leadership Chat',updated_at=now(),is_active=true,thread_type='group' where id=v_thread;
    if v_legacy_msg_user is not null then update public.msg_thread_participants set left_at=coalesce(left_at,now()) where thread_id=v_thread and user_id=v_legacy_msg_user; end if;
  end if;
end
$leadership$;

create or replace function public.msg_get_or_create_ops_manager_thread(p_manager_id uuid) returns public.msg_threads
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_manager public.ops_manager_managers%rowtype; v_user public.msg_users%rowtype; v_thread public.msg_threads%rowtype;
begin
  if p_manager_id is null then raise exception using errcode='22023',message='Authenticated leadership manager id is required'; end if;
  select * into v_manager from public.ops_manager_managers where manager_id=p_manager_id and active=true and revoked_at is null and is_system_principal=false and roles&&array['OPS_MANAGER','CUSTODIAL_MANAGER','DIRECTOR','SECURITY_ADMIN']::text[];
  if v_manager.manager_id is null then raise exception using errcode='42501',message='Active authenticated Operations Leadership identity was not found'; end if;
  v_user:=public.msg_ensure_ops_manager_user(p_manager_id);
  select * into v_thread from public.msg_threads where system_key='ops_manager_shared_chat_v1' limit 1;
  if v_thread.id is null then
    perform pg_advisory_xact_lock(hashtextextended('operations-leadership-chat-v1',0));
    select * into v_thread from public.msg_threads where system_key='ops_manager_shared_chat_v1' limit 1;
    if v_thread.id is null then insert into public.msg_threads(thread_type,title,created_by_user_id,is_active,system_key) values('group','Operations Leadership Chat',v_user.id,true,'ops_manager_shared_chat_v1') returning * into v_thread; end if;
  elsif v_thread.is_active=false or v_thread.thread_type<>'group' or v_thread.title is distinct from 'Operations Leadership Chat' then
    update public.msg_threads set is_active=true,thread_type='group',title='Operations Leadership Chat',updated_at=now() where id=v_thread.id returning * into v_thread;
  end if;
  insert into public.msg_thread_participants(thread_id,user_id,joined_at,left_at) values(v_thread.id,v_user.id,now(),null) on conflict(thread_id,user_id) do update set left_at=null where public.msg_thread_participants.left_at is not null;
  insert into public.msg_receipts(message_id,user_id,queued_at) select m.id,v_user.id,now() from public.msg_messages m where m.thread_id=v_thread.id and m.is_deleted=false and m.sender_user_id<>v_user.id on conflict(message_id,user_id) do nothing;
  return v_thread;
end; $$;
revoke all on function public.msg_get_or_create_ops_manager_thread(uuid) from public,anon,authenticated;
grant execute on function public.msg_get_or_create_ops_manager_thread(uuid) to service_role;

create or replace function public.public_viewer_dashboard_snapshot() returns jsonb
language sql stable security definer set search_path=pg_catalog,public as $$
with health as(select * from public.v_admin_health_snapshot order by snapshot_at desc limit 1),
status_counts as(select count(*) filter(where status_code='okay') okay_locations,count(*) filter(where status_code='overdue') overdue_locations,count(*) filter(where status_code='due_soon') due_soon_locations,count(*) filter(where open_session_status is not null) in_progress_locations,count(*) total_locations from public.v_location_dashboard_status),
upcoming as(select count(*) upcoming_event_count from public.events_app_events where status='SCHEDULED' and coalesce(end_date,event_date)>=public.sch_service_date(now()) and event_date<=public.sch_service_date(now())+30)
select jsonb_build_object('operational_date',public.sch_service_date(now()),'generated_at',now(),'locations_total',coalesce(s.total_locations,h.active_locations,0),'locations_current',coalesce(s.okay_locations,0),'locations_due_soon',coalesce(s.due_soon_locations,0),'locations_overdue',coalesce(s.overdue_locations,0),'locations_in_progress',coalesce(s.in_progress_locations,0),'cleanings_completed_today',coalesce(h.closed_sessions_today,0),'upcoming_event_count_30d',coalesce(u.upcoming_event_count,0),'status',case when coalesce(s.overdue_locations,0)>0 then 'attention' else 'current' end) from health h cross join status_counts s cross join upcoming u;
$$;
revoke all on function public.public_viewer_dashboard_snapshot() from public,anon,authenticated;
grant execute on function public.public_viewer_dashboard_snapshot() to service_role;
comment on function public.public_viewer_dashboard_snapshot() is 'Public-safe aggregate for Memphis Zoo Viewer; no employee, device, note, ticket-detail, or raw-feedback data.';
commit;
