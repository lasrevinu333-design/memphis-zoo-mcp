begin;

alter table public.device_sync_status
  add column if not exists queue_authority_groups jsonb not null default '[]'::jsonb;
alter table public.device_sync_status
  drop constraint if exists device_sync_status_queue_authority_groups_check;
alter table public.device_sync_status
  add constraint device_sync_status_queue_authority_groups_check check (
    jsonb_typeof(queue_authority_groups)='array'
    and jsonb_array_length(queue_authority_groups)<=100
  );

create or replace function public.custodial_report_device_sync_status_internal(
  p_device_identifier text, p_queue_count integer, p_oldest_item_at timestamptz,
  p_retry_count integer, p_last_server_ack_at timestamptz, p_frontend_version text,
  p_last_error text, p_correlation_id text, p_queue_authority_groups jsonb
) returns jsonb language plpgsql security definer
set search_path to 'pg_catalog','public','extensions'
as $function$
declare
  v_device public.devices%rowtype;
  v_now timestamptz:=clock_timestamp();
  v_group jsonb; v_groups jsonb:='[]'::jsonb; v_seen text[]:='{}'::text[];
  v_employee_id uuid; v_epoch integer; v_snapshot_id text; v_count integer;
  v_oldest timestamptz; v_key text; v_bound_count integer:=0;
begin
  if p_queue_count is null or p_queue_count<0 or p_queue_count>10000
     or p_retry_count is null or p_retry_count<0 then
    raise exception using errcode='22023',message='device sync counts are invalid';
  end if;
  if jsonb_typeof(coalesce(p_queue_authority_groups,'null'::jsonb))<>'array'
     or jsonb_array_length(p_queue_authority_groups)>100 then
    raise exception using errcode='22023',message='queue authority groups must be a bounded array';
  end if;
  select d.* into v_device from public.device_aliases da join public.devices d
    on d.id=da.canonical_device_id and d.active=true
   where da.alias_identifier=btrim(p_device_identifier) and da.active=true limit 1;
  if not found then
    select d.* into v_device from public.devices d
     where d.device_id=btrim(p_device_identifier) and d.active=true limit 1;
  end if;
  if v_device.id is null then raise exception 'Active device not found.'; end if;

  for v_group in select value from jsonb_array_elements(p_queue_authority_groups) loop
    if jsonb_typeof(v_group)<>'object' or exists(
      select 1 from jsonb_object_keys(v_group) key
       where key not in ('employee_id','assignment_epoch','snapshot_id','queue_count','oldest_item_at')
    ) then raise exception using errcode='22023',message='queue authority group has an invalid shape'; end if;
    begin
      v_employee_id:=nullif(lower(btrim(v_group->>'employee_id')),'')::uuid;
      v_epoch:=(v_group->>'assignment_epoch')::integer;
      v_snapshot_id:=lower(btrim(v_group->>'snapshot_id'));
      v_count:=(v_group->>'queue_count')::integer;
      v_oldest:=nullif(btrim(v_group->>'oldest_item_at'),'')::timestamptz;
    exception when others then
      raise exception using errcode='22023',message='queue authority group values are invalid';
    end;
    if v_employee_id is null or v_epoch is null or v_epoch<1
       or v_snapshot_id is null or v_snapshot_id !~ '^[0-9a-f]{64}$'
       or v_count is null or v_count<1 or v_oldest is null
       or not isfinite(v_oldest) or v_oldest>v_now+interval '10 minutes' then
      raise exception using errcode='22023',message='queue authority group values are outside their accepted bounds';
    end if;
    v_key:=v_employee_id::text||':'||v_epoch::text||':'||v_snapshot_id;
    if v_key=any(v_seen) then raise exception using errcode='22023',message='queue authority groups contain a duplicate identity'; end if;
    v_seen:=array_append(v_seen,v_key); v_bound_count:=v_bound_count+v_count;
    if v_bound_count>p_queue_count then raise exception using errcode='22023',message='queue authority group counts exceed the reported queue'; end if;
    if not exists(select 1 from public.custodial_offline_scan_authority_snapshots s
      where s.snapshot_id=v_snapshot_id and s.device_id=v_device.id
        and s.employee_id=v_employee_id and s.assignment_epoch=v_epoch) then
      raise exception using errcode='42501',message='queue authority group does not match an issued device snapshot';
    end if;
    v_groups:=v_groups||jsonb_build_array(jsonb_build_object(
      'employee_id',v_employee_id,'assignment_epoch',v_epoch,'snapshot_id',v_snapshot_id,
      'queue_count',v_count,'oldest_item_at',v_oldest));
  end loop;
  select coalesce(jsonb_agg(value order by value->>'employee_id',(value->>'assignment_epoch')::integer,value->>'snapshot_id'),'[]'::jsonb)
    into v_groups from jsonb_array_elements(v_groups);

  insert into public.device_sync_status(
    device_id,presented_identifier,queue_count,oldest_item_at,retry_count,last_server_ack_at,
    frontend_version,last_error,correlation_id,queue_authority_groups,updated_at
  ) values(
    v_device.id,btrim(p_device_identifier),p_queue_count,p_oldest_item_at,p_retry_count,p_last_server_ack_at,
    nullif(btrim(coalesce(p_frontend_version,'')),''),left(nullif(coalesce(p_last_error,''),''),1000),
    nullif(btrim(coalesce(p_correlation_id,'')),''),v_groups,v_now
  ) on conflict(device_id) do update set
    presented_identifier=excluded.presented_identifier,queue_count=excluded.queue_count,
    oldest_item_at=excluded.oldest_item_at,retry_count=excluded.retry_count,
    last_server_ack_at=excluded.last_server_ack_at,frontend_version=excluded.frontend_version,
    last_error=excluded.last_error,correlation_id=excluded.correlation_id,
    queue_authority_groups=excluded.queue_authority_groups,updated_at=v_now;
  update public.devices set last_seen_at=v_now,updated_at=v_now where id=v_device.id;
  return jsonb_build_object('ok',true,'device_id',v_device.device_id,'updated_at',v_now,
    'last_seen_at',v_now,'bound_queue_count',v_bound_count,'unbound_queue_count',p_queue_count-v_bound_count);
end $function$;

create or replace function public.tool_report_device_sync_status(
  p_device_identifier text,p_queue_count integer,p_oldest_item_at timestamptz,p_retry_count integer,
  p_last_server_ack_at timestamptz,p_frontend_version text,p_last_error text,p_correlation_id text
) returns jsonb language sql security definer set search_path to 'pg_catalog','public','extensions'
as $function$
  select public.custodial_report_device_sync_status_internal(
    p_device_identifier,p_queue_count,p_oldest_item_at,p_retry_count,p_last_server_ack_at,
    p_frontend_version,p_last_error,p_correlation_id,'[]'::jsonb)
$function$;

create or replace function public.tool_report_device_sync_status_v2(
  p_device_identifier text,p_queue_count integer,p_oldest_item_at timestamptz,p_retry_count integer,
  p_last_server_ack_at timestamptz,p_frontend_version text,p_last_error text,p_correlation_id text,
  p_queue_authority_groups jsonb
) returns jsonb language sql security definer set search_path to 'pg_catalog','public','extensions'
as $function$
  select public.custodial_report_device_sync_status_internal(
    p_device_identifier,p_queue_count,p_oldest_item_at,p_retry_count,p_last_server_ack_at,
    p_frontend_version,p_last_error,p_correlation_id,p_queue_authority_groups)
$function$;

revoke all on function public.custodial_report_device_sync_status_internal(text,integer,timestamptz,integer,timestamptz,text,text,text,jsonb),
  public.tool_report_device_sync_status(text,integer,timestamptz,integer,timestamptz,text,text,text),
  public.tool_report_device_sync_status_v2(text,integer,timestamptz,integer,timestamptz,text,text,text,jsonb)
from public,anon,authenticated;
revoke all on function public.custodial_report_device_sync_status_internal(text,integer,timestamptz,integer,timestamptz,text,text,text,jsonb)
from service_role;
grant execute on function public.custodial_report_device_sync_status_internal(text,integer,timestamptz,integer,timestamptz,text,text,text,jsonb)
to postgres;
grant execute on function public.tool_report_device_sync_status(text,integer,timestamptz,integer,timestamptz,text,text,text),
  public.tool_report_device_sync_status_v2(text,integer,timestamptz,integer,timestamptz,text,text,text,jsonb)
to postgres,service_role;

commit;
