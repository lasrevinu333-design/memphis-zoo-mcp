-- Forward-only protected-work separation authority. This local candidate
-- keeps native inventory UNKNOWN and phones fenced. It is NOT release-ready
-- until original-principal replay and an audited reconciliation/finalizer are
-- implemented and proven. No historical migration is edited.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

create table public.custodial_employee_separation_fences (
  separation_id uuid primary key default gen_random_uuid(),
  command_id uuid not null unique,
  authority_revision bigint not null unique references public.weekly_schedule_authority_revisions(authority_revision) on delete restrict,
  employee_id uuid not null references public.employees(id) on delete restrict,
  slot_id uuid not null references public.weekly_roster_slots(slot_id) on delete restrict,
  separated_at timestamptz not null,
  effective_date date not null,
  actor_manager_id uuid not null references public.ops_manager_managers(manager_id) on delete restrict,
  device_inventory_json jsonb not null check(jsonb_typeof(device_inventory_json)='array'),
  native_inventory_state text not null default 'UNKNOWN' check(native_inventory_state in ('UNKNOWN','VERIFIED_EMPTY','PROTECTED_PENDING','RECONCILED')),
  state text not null default 'PENDING_RECONCILIATION' check(state in ('PENDING_RECONCILIATION','RETAINED_UNRESOLVED','FINALIZED')),
  created_at timestamptz not null default statement_timestamp(),
  check(separated_at <= created_at + interval '1 second')
);
create index custodial_employee_separation_fences_employee_time
  on public.custodial_employee_separation_fences(employee_id,separated_at desc);
create unique index custodial_employee_one_pending_separation
  on public.custodial_employee_separation_fences(employee_id) where state='PENDING_RECONCILIATION';
alter table public.custodial_employee_separation_fences enable row level security;
alter table public.custodial_employee_separation_fences force row level security;
revoke all on table public.custodial_employee_separation_fences
  from public,anon,authenticated,service_role,static_weekly_control_plane,
       static_weekly_release_operator,custodial_application_reader;
create trigger trg_custodial_employee_separation_fences_immutable
  before update or delete on public.custodial_employee_separation_fences
  for each row execute function public.static_weekly_reject_update_delete();

-- This fence is a second line of defense at both canonical Start persistence
-- surfaces. It permits only genuinely pre-separation replay under the
-- separately attested device/snapshot/credential authority; it does not by
-- itself authenticate a client timestamp.
create function public.custodial_v12_reject_post_separation_start() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $function$
begin
  if exists(select 1 from public.custodial_employee_separation_fences f
    where f.employee_id=new.employee_id and f.state='PENDING_RECONCILIATION'
      and new.started_at>=f.separated_at) then
    raise exception using errcode='42501',message='separated employee cannot start new cleaning work';
  end if;
  return new;
end
$function$;
revoke all on function public.custodial_v12_reject_post_separation_start()
  from public,anon,authenticated,service_role,static_weekly_control_plane,
       static_weekly_release_operator,custodial_application_reader;
create trigger trg_custodial_v12_session_separation_fence
  before insert on public.sessions for each row
  execute function public.custodial_v12_reject_post_separation_start();
create trigger trg_custodial_v12_offline_separation_fence
  before insert on public.custodial_offline_actor_contexts for each row
  execute function public.custodial_v12_reject_post_separation_start();

-- No generic employee/device administration command may transfer or disable
-- an unresolved former principal's phone while its native inventory is still
-- unknown. A later audited finalizer must explicitly settle this boundary.
create function public.custodial_v12_guard_protected_device() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $function$
begin
  if old.assigned_employee_id is not null
    and (new.assigned_employee_id is distinct from old.assigned_employee_id
      or new.active is distinct from old.active)
    and exists(select 1 from public.custodial_employee_separation_fences f
      where f.employee_id=old.assigned_employee_id and f.state='PENDING_RECONCILIATION') then
    raise exception using errcode='42501',message='protected former-employee phone cannot be released or reassigned before reconciliation';
  end if;
  return new;
end
$function$;
revoke all on function public.custodial_v12_guard_protected_device()
  from public,anon,authenticated,service_role,static_weekly_control_plane,
       static_weekly_release_operator,custodial_application_reader;
create trigger trg_custodial_v12_guard_protected_device
  before update of assigned_employee_id,active on public.devices for each row
  execute function public.custodial_v12_guard_protected_device();

create function public.custodial_v12_guard_protected_credential() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $function$
begin
  if (new.revoked_at is distinct from old.revoked_at
      or new.expires_at<old.expires_at)
    and exists(select 1 from public.devices d
      join public.custodial_employee_separation_fences f
        on f.employee_id=d.assigned_employee_id and f.state='PENDING_RECONCILIATION'
      where d.id=old.device_id) then
    raise exception using errcode='42501',message='protected former-employee credential cannot be revoked before reconciliation';
  end if;
  return new;
end
$function$;
revoke all on function public.custodial_v12_guard_protected_credential()
  from public,anon,authenticated,service_role,static_weekly_control_plane,
       static_weekly_release_operator,custodial_application_reader;
create trigger trg_custodial_v12_guard_protected_credential
  before update of revoked_at,expires_at on public.device_auth_credentials for each row
  execute function public.custodial_v12_guard_protected_credential();

-- Only the already authenticated and revision-bound scheduler writer may
-- inactivate the original employee. The phone and its credential remain with
-- that principal while old signed native work reconciles. No phone is cleared,
-- released or rebound here.
create function public.custodial_v12_inactivate_preserving_work(
  p_employee_id uuid,p_slot_id uuid,p_manager_id uuid,p_reason text,
  p_authority_revision bigint,p_command_id uuid,p_effective_date date
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public
as $function$
declare
  v_employee public.employees%rowtype;
  v_devices jsonb;
  v_cutoff timestamptz:=statement_timestamp();
  v_separation_id uuid;
begin
  perform public.static_weekly_v3_assert_control_plane();
  perform public.custodial_assert_manager(p_manager_id);
  select * into v_employee from public.employees where id=p_employee_id for update;
  if not found or v_employee.active is distinct from true
    or v_employee.employee_code !~ '^EMP[0-9]+$' then
    raise exception using errcode='23514',message='exact active custodian required for protected separation';
  end if;
  if p_slot_id is null or p_authority_revision is null or p_command_id is null
    or p_effective_date is null or p_effective_date<>public.sch_service_date(v_cutoff)
    or nullif(btrim(coalesce(p_reason,'')),'') is null then
    raise exception using errcode='23514',message='protected separation identity or effective date missing';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('device_uuid',d.id,'device_identifier',d.device_id)
    order by d.device_id),'[]'::jsonb) into v_devices
    from public.devices d where d.assigned_employee_id=p_employee_id and d.active is true;
  update public.employees set active=false,updated_at=v_cutoff where id=p_employee_id;
  update public.msg_users set is_active=false,updated_at=v_cutoff where employee_id=p_employee_id;
  insert into public.custodial_employee_status_history(
    employee_id,employee_name,previous_active,new_active,changed_by_manager_id,
    change_reason,source,metadata_json,changed_at)
  values(p_employee_id,v_employee.display_name,true,false,p_manager_id,p_reason,
    'static_weekly_protected_separation',
    jsonb_build_object('slot_id',p_slot_id,'authority_revision',p_authority_revision,
      'command_id',p_command_id,'device_inventory',v_devices,
      'native_inventory_state','UNKNOWN','phone_released',false),v_cutoff);
  insert into public.custodial_employee_separation_fences(
    command_id,authority_revision,employee_id,slot_id,separated_at,effective_date,
    actor_manager_id,device_inventory_json)
  values(p_command_id,p_authority_revision,p_employee_id,p_slot_id,v_cutoff,p_effective_date,
    p_manager_id,v_devices) returning separation_id into v_separation_id;
  return jsonb_build_object('changed',true,'employee_id',p_employee_id,
    'separation_id',v_separation_id,'separated_at',v_cutoff,
    'protected_work_state','PENDING_RECONCILIATION','native_inventory_state','UNKNOWN',
    'assigned_devices_retained',v_devices,'released_devices','[]'::jsonb);
end
$function$;
revoke all on function public.custodial_v12_inactivate_preserving_work(uuid,uuid,uuid,text,bigint,uuid,date)
  from public,anon,authenticated,service_role,static_weekly_release_operator,custodial_application_reader;
grant execute on function public.custodial_v12_inactivate_preserving_work(uuid,uuid,uuid,text,bigint,uuid,date)
  to static_weekly_control_plane;

-- Forward-replace the already receipt-bound vacancy writer at the exact three
-- unsafe seams. Guarded source transformation fails the migration if upstream
-- bytes differ; it never silently installs a partially patched authority.
do $migration$
declare
  v_definition text;
  v_old text;
begin
  select pg_get_functiondef('public.static_weekly_v8_vacate_roster_slot(uuid,uuid,uuid,date,text,bigint,uuid,text)'::regprocedure)
    into v_definition;
  v_old:='or not coalesce((v_source.canonical_source#>''{version,vacantSlotIds}'') ? p_slot_id::text,false)';
  if length(v_definition)-length(replace(v_definition,v_old,''))<>length(v_old) then
    raise exception 'vacancy source authority seam changed';
  end if;
  v_definition:=replace(v_definition,v_old,'');
  v_old:='perform public.static_weekly_v4_assert_employee_turnover_ready(p_employee_id);';
  if length(v_definition)-length(replace(v_definition,v_old,''))<>length(v_old) then
    raise exception 'protected work turnover guard seam changed';
  end if;
  v_definition:=replace(v_definition,v_old,'');
  v_old:='v_status:=public.custodial_set_employee_active(p_employee_id,false,p_manager_id,p_reason,true);';
  if length(v_definition)-length(replace(v_definition,v_old,''))<>length(v_old) then
    raise exception 'phone release seam changed';
  end if;
  v_definition:=replace(v_definition,v_old,
    'v_status:=public.custodial_v12_inactivate_preserving_work(p_employee_id,p_slot_id,p_manager_id,p_reason,v_revision,v_command,p_effective_start);');
  v_definition:=replace(v_definition,
    'registered source must declare this stable position vacancy-capable and vacant',
    'registered source must declare this stable position vacancy-capable');
  execute v_definition;
end
$migration$;

create function public.custodial_v12_read_separation(p_slot_id uuid,p_manager_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public
as $function$
declare v_fence public.custodial_employee_separation_fences%rowtype;
begin
  perform public.static_weekly_v3_assert_control_plane();
  perform public.custodial_assert_manager(p_manager_id);
  if p_slot_id is null then raise exception using errcode='22023',message='exact stable position required';end if;
  select * into v_fence from public.custodial_employee_separation_fences
    where slot_id=p_slot_id order by separated_at desc,separation_id desc limit 1;
  if not found then return jsonb_build_object('slot_id',p_slot_id,'state','NONE');end if;
  return jsonb_build_object(
    'slot_id',v_fence.slot_id,'employee_id',v_fence.employee_id,
    'separation_id',v_fence.separation_id,'command_id',v_fence.command_id,
    'authority_revision',v_fence.authority_revision,
    'separated_at',v_fence.separated_at,'state',v_fence.state,
    'native_inventory_state',v_fence.native_inventory_state,
    'assigned_devices_retained',v_fence.device_inventory_json,
    'database_active_sessions',(select count(*) from public.sessions s
      where s.employee_id=v_fence.employee_id and s.status in ('active','pending_submit')),
    'database_activated_offline_contexts',(select count(*) from public.custodial_offline_actor_contexts c
      where c.employee_id=v_fence.employee_id and c.status='activated'),
    'phone_released',false);
end
$function$;
revoke all on function public.custodial_v12_read_separation(uuid,uuid)
  from public,anon,authenticated,service_role,static_weekly_release_operator,custodial_application_reader;
grant execute on function public.custodial_v12_read_separation(uuid,uuid)
  to static_weekly_control_plane;

do $surface$
declare v_definition text;v_additions text;
begin
  v_definition:=pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure);
  if (length(v_definition)-length(replace(v_definition,'  values','')))/length('  values')<>1 then
    raise exception 'protected separation canary surface seam changed';
  end if;
  v_additions:=$rows$
 ('relation','public.custodial_employee_separation_fences','private protected-work separation and original-principal fence'),
 ('function','public.custodial_v12_reject_post_separation_start()','new Start persistence fence'),
 ('function','public.custodial_v12_guard_protected_device()','old phone ownership fence'),
 ('function','public.custodial_v12_guard_protected_credential()','old credential ownership fence'),
 ('function','public.custodial_v12_inactivate_preserving_work(uuid,uuid,uuid,text,bigint,uuid,date)','status transition preserving old phone work'),
 ('function','public.custodial_v12_read_separation(uuid,uuid)','manager-only honest pending separation readback'),
 ('trigger','public.sessions.trg_custodial_v12_session_separation_fence','new online Start fence'),
 ('trigger','public.custodial_offline_actor_contexts.trg_custodial_v12_offline_separation_fence','new offline Start fence'),
 ('trigger','public.devices.trg_custodial_v12_guard_protected_device','pending old-phone preservation'),
 ('trigger','public.device_auth_credentials.trg_custodial_v12_guard_protected_credential','pending credential preservation'),
 ('trigger','public.custodial_employee_separation_fences.trg_custodial_employee_separation_fences_immutable','immutable pending separation evidence'),
$rows$;
  execute replace(v_definition,'  values','  values'||E'\n'||v_additions);
end
$surface$;

alter table public.custodial_release_authority_restore_inventory
  disable trigger trg_custodial_release_authority_restore_inventory_immutable;
do $recovery$
declare obj record;next_order integer;
begin
  for obj in with relation_names(name) as (values ('public.custodial_employee_separation_fences')),
    funcs as (select p.oid,'public.'||p.oid::regprocedure::text identity
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and (starts_with(p.proname,'custodial_v12_')
        or p.oid='public.static_weekly_v8_vacate_roster_slot(uuid,uuid,uuid,date,text,bigint,uuid,text)'::regprocedure
        or p.oid='public.custodial_release_canary_authority_surface()'::regprocedure)),
    new_triggers as (select t.oid,c.relname,n.nspname,t.tgname,t.tgenabled
      from pg_trigger t join pg_class c on c.oid=t.tgrelid
      join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and t.tgname in (
        'trg_custodial_v12_session_separation_fence',
        'trg_custodial_v12_offline_separation_fence',
        'trg_custodial_v12_guard_protected_device',
        'trg_custodial_v12_guard_protected_credential',
        'trg_custodial_employee_separation_fences_immutable')),
    objects as (
      select 1000 bucket,'relation'::text kind,name identity,
        public.custodial_release_authority_current_relation_definition(name) definition from relation_names
      union all select 100000,'function',identity,pg_get_functiondef(oid) from funcs
      union all select 200000,'column',r.name||':'||a.attname,
        public.custodial_release_authority_current_column_definition(r.name||':'||a.attname)
        from relation_names r join pg_attribute a on a.attrelid=r.name::regclass and a.attnum>0 and not a.attisdropped
      union all select 300000,'column_set',name,
        public.custodial_release_authority_current_column_set_definition(name) from relation_names
      union all select 400000,'relation_state',name,
        public.custodial_release_authority_current_relation_state_definition(name) from relation_names
      union all select 500000,'constraint',r.name||':'||c.conname,
        public.custodial_release_authority_current_constraint_definition(r.name||':'||c.conname)
        from relation_names r join pg_constraint c on c.conrelid=r.name::regclass
      union all select 600000,'index','public.'||quote_ident(ci.relname),
        public.custodial_release_authority_current_index_definition('public.'||quote_ident(ci.relname))
        from relation_names r join pg_index i on i.indrelid=r.name::regclass
        join pg_class ci on ci.oid=i.indexrelid
        where not exists(select 1 from pg_constraint c where c.conindid=i.indexrelid)
      union all select 700000,'trigger',quote_ident(nspname)||'.'||quote_ident(relname)||'.'||quote_ident(tgname),
        'drop trigger if exists '||quote_ident(tgname)||' on '||quote_ident(nspname)||'.'||quote_ident(relname)||'; '
        ||pg_get_triggerdef(oid,true)||'; alter table '||quote_ident(nspname)||'.'||quote_ident(relname)||' '
        ||case tgenabled when 'O' then 'enable' when 'D' then 'disable' when 'R' then 'enable replica' when 'A' then 'enable always' end
        ||' trigger '||quote_ident(tgname)||';' from new_triggers
      union all select 900000,'grant',name,
        public.custodial_release_authority_current_grant_definition(name) from relation_names
      union all select 900000,'grant',identity,
        public.custodial_release_authority_current_grant_definition(identity) from funcs
    ) select * from objects order by bucket,identity loop
    if obj.definition is null then raise exception 'missing protected separation recovery object %',obj.identity;end if;
    update public.custodial_release_authority_restore_inventory set definition_sql=obj.definition,
      definition_sha256=public.static_weekly_digest_text(obj.definition),captured_at=statement_timestamp()
      where object_kind=obj.kind and (object_identity=obj.identity or
        case when obj.kind in ('function','grant') and object_identity like '%(%' and obj.identity like '%(%'
          then to_regprocedure(object_identity)=to_regprocedure(obj.identity) else false end);
    if not found then
      select coalesce(max(restore_order),obj.bucket)+1 into next_order
        from public.custodial_release_authority_restore_inventory
        where restore_order>=obj.bucket and restore_order<case when obj.bucket=1000 then 100000 else obj.bucket+100000 end;
      insert into public.custodial_release_authority_restore_inventory
        (restore_order,object_kind,object_identity,definition_sql,definition_sha256)
        values(next_order,obj.kind,obj.identity,obj.definition,public.static_weekly_digest_text(obj.definition));
    end if;
  end loop;
end
$recovery$;
alter table public.custodial_release_authority_restore_inventory
  enable trigger trg_custodial_release_authority_restore_inventory_immutable;

commit;
