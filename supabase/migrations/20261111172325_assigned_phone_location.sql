-- Owner-authorized private latest phone position, independent of cleaning.
-- No scan/session/geofence writes, public API grants, or historical backfill.
begin;
set local lock_timeout='2s';
set local statement_timeout='20s';
create table public.custodial_phone_positions (
  device_id uuid primary key references public.devices(id),
  employee_id uuid not null references public.employees(id),
  assignment_epoch bigint not null check (assignment_epoch>0),
  credential_id uuid not null references public.device_auth_credentials(credential_id),
  sample_id uuid not null,
  observed_at timestamptz not null check(isfinite(observed_at)),
  received_at timestamptz not null default clock_timestamp(),
  latitude double precision not null check(latitude between -90 and 90),
  longitude double precision not null check(longitude between -180 and 180),
  accuracy_m double precision not null check(accuracy_m>0 and accuracy_m<'Infinity'::float8)
);
alter table public.custodial_phone_positions enable row level security;
alter table public.custodial_phone_positions force row level security;
revoke all on public.custodial_phone_positions from public,anon,authenticated;
grant select,insert,update on public.custodial_phone_positions to service_role;
comment on table public.custodial_phone_positions is
  'Latest measured assigned-phone location. Private named-manager route only; no cleaning authority or travel history.';

create function public.custodial_record_phone_position(
  p_device_id uuid,p_employee_id uuid,p_assignment_epoch bigint,p_credential_id uuid,
  p_sample_id uuid,p_observed_at timestamptz,p_latitude double precision,
  p_longitude double precision,p_accuracy_m double precision
) returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare d public.devices%rowtype; c public.device_auth_credentials%rowtype;
  e public.employees%rowtype; previous public.custodial_phone_positions%rowtype;
begin
  perform public.custodial_begin_application_mutation();
  select * into d from public.devices where id=p_device_id for share;
  select * into c from public.device_auth_credentials where credential_id=p_credential_id for share;
  select * into e from public.employees where id=p_employee_id for share;
  if d.id is null or d.active is not true or e.id is null or e.active is not true
    or d.assigned_employee_id is distinct from p_employee_id
    or d.assignment_epoch is distinct from p_assignment_epoch
    or c.device_id is distinct from d.id or c.confirmed_at is null
    or c.revoked_at is not null or c.expires_at<=clock_timestamp()
    or c.metadata_json ? 'retained_original_enrollment' then
    raise exception using errcode='42501',message='Current assigned phone authority required';
  end if;
  if p_sample_id is null or p_observed_at is null or not isfinite(p_observed_at)
    or p_observed_at>clock_timestamp() or p_observed_at<c.created_at
    or p_latitude is null or not(p_latitude between -90 and 90)
    or p_longitude is null or not(p_longitude between -180 and 180)
    or p_accuracy_m is null or not(p_accuracy_m>0 and p_accuracy_m<'Infinity'::float8) then
    raise exception using errcode='22023',message='Measured position and original capture time required';
  end if;
  -- Serialize only this device's latest snapshot, never an active work row.
  perform pg_advisory_xact_lock(hashtextextended('custodial-phone-position:'||d.id::text,0));
  select * into previous from public.custodial_phone_positions where device_id=d.id;
  if previous.sample_id=p_sample_id and
    (previous.employee_id,previous.assignment_epoch,previous.credential_id,previous.observed_at,
     previous.latitude,previous.longitude,previous.accuracy_m) is distinct from
    (p_employee_id,p_assignment_epoch,p_credential_id,p_observed_at,p_latitude,p_longitude,p_accuracy_m) then
    raise exception using errcode='22023',message='Original position sample conflict';
  end if;
  if previous.assignment_epoch=p_assignment_epoch and previous.employee_id=p_employee_id
    and previous.observed_at>=p_observed_at then
    return jsonb_build_object('ok',true,'stored',false,'result','already_current_or_superseded','sample_id',p_sample_id);
  end if;
  insert into public.custodial_phone_positions values(d.id,p_employee_id,p_assignment_epoch,
    p_credential_id,p_sample_id,p_observed_at,clock_timestamp(),p_latitude,p_longitude,p_accuracy_m)
  on conflict(device_id) do update set employee_id=excluded.employee_id,
    assignment_epoch=excluded.assignment_epoch,credential_id=excluded.credential_id,
    sample_id=excluded.sample_id,observed_at=excluded.observed_at,received_at=excluded.received_at,
    latitude=excluded.latitude,longitude=excluded.longitude,accuracy_m=excluded.accuracy_m;
  return jsonb_build_object('ok',true,'stored',true,'result','stored','sample_id',p_sample_id);
end $$;

create function public.custodial_read_phone_positions()
returns table(device_id text,employee_id uuid,employee_name text,assignment_epoch bigint,
  sample_id uuid,observed_at timestamptz,received_at timestamptz,
  latitude double precision,longitude double precision,accuracy_m double precision)
language sql stable security invoker set search_path=pg_catalog,public as $$
 select d.device_id,e.id,e.display_name,d.assignment_epoch,
   p.sample_id,p.observed_at,p.received_at,p.latitude,p.longitude,p.accuracy_m
 from public.devices d join public.employees e on e.id=d.assigned_employee_id and e.active=true
 left join lateral (
   select pos.* from public.custodial_phone_positions pos
   join public.device_auth_credentials cred on cred.credential_id=pos.credential_id
     and cred.device_id=d.id and cred.confirmed_at is not null
     and cred.revoked_at is null and cred.expires_at>now()
     and not(coalesce(cred.metadata_json,'{}'::jsonb) ? 'retained_original_enrollment')
   where pos.device_id=d.id and pos.employee_id=e.id and pos.assignment_epoch=d.assignment_epoch
 ) p on true where d.active=true order by d.device_id
$$;
revoke all on function public.custodial_record_phone_position(uuid,uuid,bigint,uuid,uuid,timestamptz,double precision,double precision,double precision) from public,anon,authenticated;
revoke all on function public.custodial_read_phone_positions() from public,anon,authenticated;
grant execute on function public.custodial_record_phone_position(uuid,uuid,bigint,uuid,uuid,timestamptz,double precision,double precision,double precision) to service_role;
grant execute on function public.custodial_read_phone_positions() to service_role;
-- Extend the existing exact restore inventory; retain its ALWAYS guard.
alter table public.custodial_release_authority_restore_inventory disable trigger trg_custodial_release_authority_restore_inventory_immutable;
do $recovery$
declare obj record;v_order integer;
begin
 for obj in with relations(name) as (values('public.custodial_phone_positions')),
 funcs as (select oid,'public.'||oid::regprocedure::text identity from pg_proc where pronamespace='public'::regnamespace
  and proname in ('custodial_record_phone_position','custodial_read_phone_positions')),objects as (
  select 1000 bucket,'relation'::text kind,name identity,public.custodial_release_authority_current_relation_definition(name) definition from relations
  union all select 100000,'function',identity,pg_get_functiondef(oid) from funcs
  union all select 200000,'column',r.name||':'||a.attname,public.custodial_release_authority_current_column_definition(r.name||':'||a.attname)
   from relations r join pg_attribute a on a.attrelid=r.name::regclass and a.attnum>0 and not a.attisdropped
  union all select 300000,'column_set',name,public.custodial_release_authority_current_column_set_definition(name) from relations
  union all select 400000,'relation_state',name,public.custodial_release_authority_current_relation_state_definition(name) from relations
  union all select 500000,'constraint',r.name||':'||c.conname,public.custodial_release_authority_current_constraint_definition(r.name||':'||c.conname)
   from relations r join pg_constraint c on c.conrelid=r.name::regclass
  union all select 600000,'index','public.'||quote_ident(c.relname),public.custodial_release_authority_current_index_definition('public.'||quote_ident(c.relname))
   from relations r join pg_index i on i.indrelid=r.name::regclass join pg_class c on c.oid=i.indexrelid
   where not exists(select 1 from pg_constraint k where k.conindid=i.indexrelid)
  union all select 700000,'trigger',r.name||'.'||t.tgname,
   'drop trigger if exists '||quote_ident(t.tgname)||' on '||r.name||'; '||pg_get_triggerdef(t.oid,true)||';'
   from relations r join pg_trigger t on t.tgrelid=r.name::regclass and not t.tgisinternal
  union all select 900000,'grant',name,public.custodial_release_authority_current_grant_definition(name) from relations
  union all select 900000,'grant',identity,public.custodial_release_authority_current_grant_definition(identity) from funcs
 ) select * from objects order by bucket,identity loop
  if obj.definition is null then raise exception 'missing phone position recovery object %',obj.identity;end if;
  update public.custodial_release_authority_restore_inventory set definition_sql=obj.definition,
   definition_sha256=public.static_weekly_digest_text(obj.definition),captured_at=statement_timestamp()
   where object_kind=obj.kind and (object_identity=obj.identity or case when obj.kind in ('function','grant')
    and object_identity like '%(%' and obj.identity like '%(%' then to_regprocedure(object_identity)=to_regprocedure(obj.identity) else false end);
  if not found then
   select coalesce(max(restore_order),obj.bucket)+1 into v_order from public.custodial_release_authority_restore_inventory
    where restore_order>=obj.bucket and restore_order<case when obj.bucket=1000 then 100000 else obj.bucket+100000 end;
   insert into public.custodial_release_authority_restore_inventory(restore_order,object_kind,object_identity,definition_sql,definition_sha256)
    values(v_order,obj.kind,obj.identity,obj.definition,public.static_weekly_digest_text(obj.definition));
  end if;
 end loop;
end
$recovery$;
alter table public.custodial_release_authority_restore_inventory enable always trigger trg_custodial_release_authority_restore_inventory_immutable;

commit;
