create or replace function public.tool_get_offline_scan_authority_snapshot(
  p_device_id text,
  p_authenticated_credential_id text,
  p_backend_execution_secret text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'extensions'
as $function$
declare
  v_device record;
  v_credential public.device_auth_credentials%rowtype;
  v_generated_at timestamptz := clock_timestamp();
  v_expires_at timestamptz;
  v_locations jsonb;
  v_snapshot_id text;
begin
  perform public.custodial_require_backend_execution_secret(p_backend_execution_secret);
  select d.id,d.device_id,d.assigned_employee_id,d.assignment_epoch,e.display_name as employee_name,e.active as employee_active
  into v_device
  from public.devices d
  join public.employees e on e.id=d.assigned_employee_id
  where upper(btrim(d.device_id))=upper(btrim(coalesce(p_device_id,''))) and d.active=true;
  begin
    select * into v_credential
    from public.device_auth_credentials
    where credential_id=nullif(lower(btrim(coalesce(p_authenticated_credential_id,''))),'')::uuid
    for share;
  exception when others then
    raise exception using errcode='42501',message='an active authenticated employee-device credential is required';
  end;
  if v_device.id is null or v_device.assigned_employee_id is null or v_device.employee_active is not true
     or v_credential.credential_id is null or v_credential.device_id<>v_device.id
     or v_credential.confirmed_at is null or v_credential.revoked_at is not null or v_credential.expires_at<=v_generated_at then
    raise exception using errcode='42501',message='an active authenticated employee-device assignment is required';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'location_code',l.location_code,
    'location_name',l.location_name,
    'location_type',l.location_type,
    'form_type',coalesce(l.form_type,l.location_type)
  ) order by l.location_code),'[]'::jsonb)
  into v_locations
  from public.locations l
  where l.active=true;
  v_expires_at := least(v_generated_at+interval '24 hours',v_credential.expires_at);
  v_snapshot_id := encode(extensions.digest(convert_to(jsonb_build_object(
    'contract_version','scan.v3.offline-authority',
    'device_id',v_device.device_id,
    'employee_id',v_device.assigned_employee_id::text,
    'assignment_epoch',v_device.assignment_epoch,
    'credential_id',v_credential.credential_id::text,
    'generated_at',v_generated_at,
    'expires_at',v_expires_at,
    'locations',v_locations
  )::text,'UTF8'),'sha256'),'hex');
  return jsonb_build_object(
    'schema_version','offline-scan-snapshot.v1',
    'contract_version','scan.v3.offline-authority',
    'snapshot_id',v_snapshot_id,
    'canonical_device_id',v_device.device_id,
    'employee_id',v_device.assigned_employee_id,
    'employee_name',v_device.employee_name,
    'assignment_epoch',v_device.assignment_epoch,
    'credential_id',v_credential.credential_id,
    'generated_at',v_generated_at,
    'expires_at',v_expires_at,
    'locations',v_locations
  );
end
$function$;

revoke all on function public.tool_get_offline_scan_authority_snapshot(text,text,text) from public,anon,authenticated;
grant execute on function public.tool_get_offline_scan_authority_snapshot(text,text,text) to service_role,postgres;
comment on function public.tool_get_offline_scan_authority_snapshot(text,text,text) is
  'Issues a bounded 24-hour employee-device/location snapshot for fail-closed offline NFC activation. Queued starts remain subject to current authority when synchronized.';

create or replace function public.custodial_scan_evidence_is_canonical(p_event jsonb)
returns boolean
language sql
immutable
set search_path to 'pg_catalog', 'public'
as $function$
  select jsonb_typeof(p_event)='object'
    and p_event ?& array['client_event_id','event_type','result','notes','scanned_at','payload_json']
    and not exists(
      select 1 from jsonb_object_keys(p_event) key
      where key not in ('client_event_id','event_type','result','notes','scanned_at','payload_json')
    )
    and jsonb_typeof(p_event->'client_event_id')='string'
    and jsonb_typeof(p_event->'event_type')='string'
    and coalesce(jsonb_typeof(p_event->'result'),'null') in ('string','null')
    and coalesce(jsonb_typeof(p_event->'notes'),'null') in ('string','null')
    and jsonb_typeof(p_event->'scanned_at')='string'
    and jsonb_typeof(p_event->'payload_json')='object'
    and (p_event->'payload_json') ? 'entry_source'
    and not exists(select 1 from jsonb_object_keys(p_event->'payload_json') key where key<>'entry_source')
    and (p_event->'payload_json'->>'entry_source') in ('native-nfc','manual-qr-fallback');
$function$;

create or replace function public.custodial_require_canonical_scan_evidence_insert()
returns trigger
language plpgsql
security invoker
set search_path to 'pg_catalog', 'public'
as $function$
begin
  if not public.custodial_scan_evidence_is_canonical(new.event_payload) then
    raise exception using errcode='22023',message='immutable scan evidence must use the exact canonical provenance shape';
  end if;
  return new;
end
$function$;

drop trigger if exists trg_custodial_require_canonical_scan_evidence on public.custodial_offline_scan_event_evidence;
create trigger trg_custodial_require_canonical_scan_evidence
before insert on public.custodial_offline_scan_event_evidence
for each row execute function public.custodial_require_canonical_scan_evidence_insert();

revoke all on function public.custodial_scan_evidence_is_canonical(jsonb),
  public.custodial_require_canonical_scan_evidence_insert()
from public,anon,authenticated,service_role;
grant execute on function public.custodial_scan_evidence_is_canonical(jsonb),
  public.custodial_require_canonical_scan_evidence_insert()
to postgres;
