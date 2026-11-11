begin;
set local lock_timeout='5s';
set local statement_timeout='120s';

-- OC24-02: enforce the explicit selection at the persistence boundary. Legacy
-- records without work_result retain their original representation/history.
create function public.custodial_oc24_completion_selection_guard()
returns trigger language plpgsql set search_path=pg_catalog,public as $fn$
declare response jsonb:=new.response_json; services jsonb; outcome text;
begin
 if response ? 'work_result' then
  outcome:=response->>'work_result'; services:=response->'services_performed';
  if outcome is null or outcome not in ('full','details','checked_no_cleaning_needed')
   or jsonb_typeof(services) is distinct from 'array' then
   raise exception using errcode='22023',message='unsupported completion selection';
  end if;
  if outcome='full' then
   if jsonb_array_length(services)<>1 or jsonb_typeof(services->0) is distinct from 'string'
    or lower(btrim(services->>0))<>'full cleaning services' then
    raise exception using errcode='22023',message='full cleaning is one selection, not individual services';
   end if;
  elsif outcome='checked_no_cleaning_needed' then
   if services<>'[]'::jsonb then
    raise exception using errcode='22023',message='check-only outcome cannot claim cleaning services';
   end if;
  elsif jsonb_array_length(services)=0 or exists (
   select 1 from jsonb_array_elements(services) item
   where jsonb_typeof(item)<>'string' or btrim(item#>>'{}')=''
     or lower(btrim(item#>>'{}'))='full cleaning services'
  ) then
   raise exception using errcode='22023',message='selective cleaning requires individual services, never full cleaning';
  end if;
 end if;
 return new;
end $fn$;
revoke all on function public.custodial_oc24_completion_selection_guard() from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader;
create trigger trg_oc24_completion_selection before insert or update of response_json
 on public.completion_responses for each row execute function public.custodial_oc24_completion_selection_guard();
alter table public.completion_responses enable always trigger trg_oc24_completion_selection;

-- OC24-03: keep every historical inspection, but no route/AI/direct runtime
-- writer may record or revise one. No table/record is dropped or deleted.
create function public.custodial_oc24_inspection_recording_retired()
returns trigger language plpgsql set search_path=pg_catalog as $fn$
begin
 raise exception using errcode='42501',message='inspection recording is retired; historical records are preserved';
end $fn$;
revoke all on function public.custodial_oc24_inspection_recording_retired() from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader;
create trigger aaa_oc24_inspection_recording_retired before insert or update
 on public.cleaning_inspections for each row execute function public.custodial_oc24_inspection_recording_retired();
alter table public.cleaning_inspections enable always trigger aaa_oc24_inspection_recording_retired;
revoke insert,update,delete,truncate on public.cleaning_inspections from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader;

-- OC24-01: this legacy RPC encoded an absence-count contractor formula. The
-- explicit dated manager-capacity publication route is separate and unchanged.
create or replace function public.app_apply_coverall_assignment_policy_v2(p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $fn$
begin
 raise exception using errcode='42501',message='CoverAll must be added manually through an accepted dated schedule';
end $fn$;
revoke all on function public.app_apply_coverall_assignment_policy_v2(jsonb) from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader;

-- Bind new enforcement and changed legacy RPC into the existing exact recovery
-- inventory. No new client table, sequence or runtime EXECUTE grant is needed.
do $surface$
declare d text;
begin
 d:=pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure);
 if (length(d)-length(replace(d,'  values','')))/length('  values')<>1 then raise exception 'OC24 surface seam missing'; end if;
 execute replace(d,'  values','  values'||E'\n'||
  $rows$('function','public.custodial_oc24_completion_selection_guard()','OC24 truthful completion selection'),
  ('function','public.custodial_oc24_inspection_recording_retired()','OC24 no new inspection records'),
  ('trigger','public.completion_responses.trg_oc24_completion_selection','OC24 persisted full or selective selection'),
  ('trigger','public.cleaning_inspections.aaa_oc24_inspection_recording_retired','OC24 historical inspection preservation'),
  $rows$);
end $surface$;

alter table public.custodial_release_authority_restore_inventory disable trigger trg_custodial_release_authority_restore_inventory_immutable;
do $recovery$
declare obj record; next_order integer;
begin
 for obj in with funcs as (
  select unnest(array[
   'public.custodial_oc24_completion_selection_guard()'::regprocedure::oid,
   'public.custodial_oc24_inspection_recording_retired()'::regprocedure::oid,
   'public.app_apply_coverall_assignment_policy_v2(jsonb)'::regprocedure::oid,
   'public.custodial_release_canary_authority_surface()'::regprocedure::oid]) oid
 ), objects as (
  select 100000 bucket,'function'::text kind,oid::regprocedure::text identity,pg_get_functiondef(oid) definition from funcs
  union all select 700000,'trigger',quote_ident(n.nspname)||'.'||quote_ident(r.relname)||'.'||quote_ident(t.tgname),
   'drop trigger if exists '||quote_ident(t.tgname)||' on '||quote_ident(n.nspname)||'.'||quote_ident(r.relname)||'; '
    ||pg_get_triggerdef(t.oid,true)||'; alter table '||quote_ident(n.nspname)||'.'||quote_ident(r.relname)||' enable always trigger '||quote_ident(t.tgname)||';'
   from pg_trigger t join pg_class r on r.oid=t.tgrelid join pg_namespace n on n.oid=r.relnamespace
   where n.nspname='public' and ((r.relname='completion_responses' and t.tgname='trg_oc24_completion_selection')
    or (r.relname='cleaning_inspections' and t.tgname='aaa_oc24_inspection_recording_retired'))
  union all select 900000,'grant','public.cleaning_inspections',public.custodial_release_authority_current_grant_definition('public.cleaning_inspections')
  union all select 900000,'grant',oid::regprocedure::text,public.custodial_release_authority_current_grant_definition(oid::regprocedure::text) from funcs
 ) select * from objects order by bucket,identity loop
  if obj.definition is null then raise exception 'missing OC24 recovery object %',obj.identity; end if;
  update public.custodial_release_authority_restore_inventory set definition_sql=obj.definition,
   definition_sha256=public.static_weekly_digest_text(obj.definition),captured_at=statement_timestamp()
   where object_kind=obj.kind and (object_identity=obj.identity or
    case when obj.kind in ('function','grant') and object_identity like '%(%' and obj.identity like '%(%'
     then to_regprocedure(object_identity)=to_regprocedure(obj.identity) else false end);
  if not found then
   select coalesce(max(restore_order),obj.bucket)+1 into next_order from public.custodial_release_authority_restore_inventory
    where restore_order>=obj.bucket and restore_order<case when obj.bucket=1000 then 100000 else obj.bucket+100000 end;
   insert into public.custodial_release_authority_restore_inventory
    (restore_order,object_kind,object_identity,definition_sql,definition_sha256)
    values(next_order,obj.kind,obj.identity,obj.definition,public.static_weekly_digest_text(obj.definition));
  end if;
 end loop;

end $recovery$;
alter table public.custodial_release_authority_restore_inventory enable trigger trg_custodial_release_authority_restore_inventory_immutable;
commit;
