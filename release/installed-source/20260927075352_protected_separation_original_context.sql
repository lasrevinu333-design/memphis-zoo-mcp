-- H04 stage1: immutable original principal capture and purpose-only read.
-- No work acceptance, inventory acknowledgement, finalization or phone reuse.
-- Historical v12 rows remain UNKNOWN; never backfill identity from today's DB.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $capture$
declare definition text;old_text text;new_text text;prior_grants text;
begin
 definition:=pg_get_functiondef('public.custodial_v12_inactivate_preserving_work(uuid,uuid,uuid,text,bigint,uuid,date)'::regprocedure);
 prior_grants:=public.custodial_release_authority_current_grant_definition('public.custodial_v12_inactivate_preserving_work(uuid,uuid,uuid,text,bigint,uuid,date)');
 old_text:=$old$select coalesce(jsonb_agg(jsonb_build_object('device_uuid',d.id,'device_identifier',d.device_id)
    order by d.device_id),'[]'::jsonb) into v_devices
    from public.devices d where d.assigned_employee_id=p_employee_id and d.active is true;$old$;
 new_text:=$new$select coalesce(jsonb_agg(jsonb_build_object(
    'schema','custodial.separation-principal.v1','device_uuid',d.id,'device_identifier',d.device_id,
    'employee_id',p_employee_id,'assignment_epoch',d.assignment_epoch,
    'credentials',coalesce((select jsonb_agg(jsonb_build_object('credential_id',c.credential_id)
       order by c.credential_id) from public.device_auth_credentials c
       where c.device_id=d.id and c.revoked_at is null and c.created_at<v_cutoff
         and c.expires_at>v_cutoff and c.confirmed_at is not null and c.confirmed_at<v_cutoff),'[]'::jsonb),
    'server_known_open_sessions',coalesce((select jsonb_agg(jsonb_build_object(
       'session_id',s.id,'session_uuid',s.session_uuid,'client_session_id',s.client_session_id,
       'started_at',s.started_at,'status_at_separation',s.status) order by s.id)
       from public.sessions s where s.employee_id=p_employee_id and s.device_id=d.id
         and s.assignment_epoch_snapshot=d.assignment_epoch and s.created_at<v_cutoff
         and s.status in ('active','pending_submit')),'[]'::jsonb))
    order by d.device_id),'[]'::jsonb) into v_devices
    from public.devices d where d.assigned_employee_id=p_employee_id and d.active is true;$new$;
 if length(definition)-length(replace(definition,old_text,''))<>length(old_text) then
  raise exception 'original principal capture predecessor seam changed';end if;
 execute replace(definition,old_text,new_text);
 if public.custodial_release_authority_current_grant_definition('public.custodial_v12_inactivate_preserving_work(uuid,uuid,uuid,text,bigint,uuid,date)') is distinct from prior_grants then
  raise exception 'original capture changed mutation privileges';end if;
end $capture$;

create function public.custodial_v13_read_separation_context(p_device_id uuid,p_credential_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public
as $function$
declare f public.custodial_employee_separation_fences%rowtype;principal jsonb;matched record;
begin
 if p_device_id is null or p_credential_id is null then
  raise exception using errcode='22023',message='exact original device and credential required';end if;
 select sf as fence,item as principal into matched
 from public.custodial_employee_separation_fences sf
 cross join lateral jsonb_array_elements(sf.device_inventory_json) item
 join public.devices d on d.id=p_device_id and d.active is true
 join public.employees e on e.id=sf.employee_id and e.active is false
 join public.device_auth_credentials c on c.device_id=d.id and c.credential_id=p_credential_id and c.revoked_at is null
 where sf.state='PENDING_RECONCILIATION'
   and item->>'schema'='custodial.separation-principal.v1'
   and item->>'device_uuid'=p_device_id::text
   and item->>'device_identifier'=d.device_id
   and item->>'employee_id'=sf.employee_id::text
   and d.assigned_employee_id=sf.employee_id
   and item->'assignment_epoch'=to_jsonb(d.assignment_epoch)
   and item->'credentials' @> jsonb_build_array(jsonb_build_object('credential_id',p_credential_id))
 order by sf.separated_at desc,sf.separation_id desc limit 1;
 if not found then return null;end if;
 f:=matched.fence;principal:=matched.principal;
 return jsonb_build_object('schema','custodial.separation-context.v1',
  'separation_id',f.separation_id,'authority_revision',f.authority_revision,
  'employee_id',f.employee_id,'device_id',p_device_id,'canonical_device_id',principal->>'device_identifier',
  'credential_id',p_credential_id,'assignment_epoch',principal->'assignment_epoch',
  'cutoff_at',to_char(f.separated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'state',f.state,'native_inventory_state',f.native_inventory_state,
  'server_known_open_sessions',principal->'server_known_open_sessions',
  'new_work_allowed',false,'phone_released',false,'purpose','SEPARATION_STATUS_ONLY');
end $function$;
revoke all on function public.custodial_v13_read_separation_context(uuid,uuid)
 from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader;
-- Backend authenticates retained token + native raw-body request before this
-- read. No browser/Data API role can request somebody else's context directly.
grant execute on function public.custodial_v13_read_separation_context(uuid,uuid) to custodial_application_reader;

do $surface$
declare definition text;
begin
 definition:=pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure);
 if (length(definition)-length(replace(definition,'  values','')))/length('  values')<>1 then
  raise exception 'separation context canary surface seam changed';end if;
 execute replace(definition,'  values','  values'||E'\n'||
  '(''function'',''public.custodial_v13_read_separation_context(uuid,uuid)'',''purpose-only original separation context''),');
end $surface$;

alter table public.custodial_release_authority_restore_inventory disable trigger trg_custodial_release_authority_restore_inventory_immutable;
do $recovery$
declare obj record;next_order integer;
begin
 for obj in with funcs as (
   select p.oid,'public.'||p.oid::regprocedure::text identity from pg_proc p
   where p.oid in ('public.custodial_v12_inactivate_preserving_work(uuid,uuid,uuid,text,bigint,uuid,date)'::regprocedure,
    'public.custodial_v13_read_separation_context(uuid,uuid)'::regprocedure,
    'public.custodial_release_canary_authority_surface()'::regprocedure)),objects as (
   select 100000 bucket,'function'::text kind,identity,pg_get_functiondef(oid) definition from funcs
   union all select 900000,'grant',identity,public.custodial_release_authority_current_grant_definition(identity) from funcs)
  select * from objects order by bucket,identity loop
  if obj.definition is null then raise exception 'missing separation context recovery object %',obj.identity;end if;
  update public.custodial_release_authority_restore_inventory set definition_sql=obj.definition,
    definition_sha256=public.static_weekly_digest_text(obj.definition),captured_at=statement_timestamp()
    where object_kind=obj.kind and object_identity like '%(%' and to_regprocedure(object_identity)=to_regprocedure(obj.identity);
  if not found then
   select coalesce(max(restore_order),obj.bucket)+1 into next_order from public.custodial_release_authority_restore_inventory
    where restore_order>=obj.bucket and restore_order<obj.bucket+100000;
   insert into public.custodial_release_authority_restore_inventory(restore_order,object_kind,object_identity,definition_sql,definition_sha256)
    values(next_order,obj.kind,obj.identity,obj.definition,public.static_weekly_digest_text(obj.definition));
  end if;
 end loop;
end $recovery$;
alter table public.custodial_release_authority_restore_inventory enable trigger trg_custodial_release_authority_restore_inventory_immutable;
commit;
