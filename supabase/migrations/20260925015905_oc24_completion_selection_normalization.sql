begin;
set local lock_timeout='5s';
set local statement_timeout='120s';

-- ECMA-262 WhiteSpace + LineTerminator, exactly String.prototype.trim().
-- Do not use locale-dependent \s or PostgreSQL's ASCII-space-only btrim.
create function public.custodial_oc24_service_trim(p_value text)
returns text language sql immutable strict parallel safe
set search_path=pg_catalog as $fn$
 select btrim(p_value,chr(9)||chr(10)||chr(11)||chr(12)||chr(13)||chr(32)||chr(160)||
  chr(5760)||chr(8192)||chr(8193)||chr(8194)||chr(8195)||chr(8196)||chr(8197)||
  chr(8198)||chr(8199)||chr(8200)||chr(8201)||chr(8202)||chr(8232)||chr(8233)||
  chr(8239)||chr(8287)||chr(12288)||chr(65279));
$fn$;
revoke all on function public.custodial_oc24_service_trim(text) from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader;

-- Shared by the HTTP authority's SQL precheck AND final table trigger.
-- CB01's missing-outcome legacy admission is a separate unresolved boundary;
-- this migration closes CB02 without silently certifying that exception.
create function public.custodial_oc24_assert_completion_selection(p_response jsonb)
returns void language plpgsql set search_path=pg_catalog,public as $fn$
declare services jsonb; outcome text;
begin
 if jsonb_typeof(p_response) is distinct from 'object' then
  raise exception using errcode='22023',message='completion response must be an object';
 end if;
 if not (p_response ? 'work_result') then return; end if;
 outcome:=p_response->>'work_result'; services:=p_response->'services_performed';
 if outcome is null or outcome not in ('full','details','checked_no_cleaning_needed') then
  raise exception using errcode='22023',message='unsupported completion outcome';
 end if;
 if jsonb_typeof(services) is distinct from 'array' then
  raise exception using errcode='22023',message='completion services must be an array';
 end if;
 if outcome='full' then
  if jsonb_array_length(services)<>1 or jsonb_typeof(services->0) is distinct from 'string'
   or lower(public.custodial_oc24_service_trim(services->>0))<>'full cleaning services' then
   raise exception using errcode='22023',message='full cleaning is one selection, not individual services';
  end if;
 elsif outcome='checked_no_cleaning_needed' then
  if services<>'[]'::jsonb then
   raise exception using errcode='22023',message='check-only outcome cannot claim cleaning services';
  end if;
 elsif jsonb_array_length(services)=0 or exists (
  select 1 from jsonb_array_elements(services) item
  where jsonb_typeof(item)<>'string' or public.custodial_oc24_service_trim(item#>>'{}')=''
   or lower(public.custodial_oc24_service_trim(item#>>'{}'))='full cleaning services'
 ) then
  raise exception using errcode='22023',message='selective cleaning requires individual services, never full cleaning';
 end if;
end $fn$;
revoke all on function public.custodial_oc24_assert_completion_selection(jsonb) from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader;

create or replace function public.custodial_oc24_completion_selection_guard()
returns trigger language plpgsql set search_path=pg_catalog,public as $fn$
begin
 perform public.custodial_oc24_assert_completion_selection(new.response_json);
 return new;
end $fn$;

-- Replace only the old explicit-selection precheck; retain the complete native
-- proof, immutable occurrence, replay, and reconciliation implementation.
do $precheck$
declare d text; prefix text; finish text; a integer; b integer;
begin
 select pg_get_functiondef(p.oid) into strict d from pg_proc p
 join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname='tool_commit_cleaning_workflow_authoritative';
 prefix:='  -- Validate explicit new outcomes without redefining legacy response records.';
 finish:='  begin'||E'\n'||'    v_completion_id:=';
 a:=strpos(d,prefix); b:=strpos(d,finish);
 if a=0 or b<=a or strpos(substr(d,a+length(prefix)),prefix)<>0 then
  raise exception 'OC24 completion precheck seam does not match';
 end if;
 execute substr(d,1,a-1)||'  perform public.custodial_oc24_assert_completion_selection(p_response_json);'||E'\n'||substr(d,b);
end $precheck$;

do $surface$
declare d text;
begin
 d:=pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure);
 if (length(d)-length(replace(d,'  values','')))/length('  values')<>1 then raise exception 'OC24 normalization surface seam missing'; end if;
 execute replace(d,'  values','  values'||E'\n'||
  $rows$('function','public.custodial_oc24_service_trim(text)','Exact JavaScript service whitespace'),
  ('function','public.custodial_oc24_assert_completion_selection(jsonb)','Shared completion selection precheck and trigger'),
  $rows$);
end $surface$;

alter table public.custodial_release_authority_restore_inventory disable trigger trg_custodial_release_authority_restore_inventory_immutable;
do $recovery$
declare obj record; next_order integer;
begin
 for obj in with funcs as (
  select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in (
   'custodial_oc24_service_trim','custodial_oc24_assert_completion_selection',
   'custodial_oc24_completion_selection_guard','tool_commit_cleaning_workflow_authoritative',
   'custodial_release_canary_authority_surface')
 ), objects as (
  select 100000 bucket,'function'::text kind,oid::regprocedure::text identity,pg_get_functiondef(oid) definition from funcs
  union all select 900000,'grant',oid::regprocedure::text,
   public.custodial_release_authority_current_grant_definition(oid::regprocedure::text) from funcs
 ) select * from objects order by bucket,identity loop
  if obj.definition is null then raise exception 'missing OC24 normalization recovery object %',obj.identity; end if;
  update public.custodial_release_authority_restore_inventory set definition_sql=obj.definition,
   definition_sha256=public.static_weekly_digest_text(obj.definition),captured_at=statement_timestamp()
   where object_kind=obj.kind and (object_identity=obj.identity or
    case when object_identity like '%(%' and obj.identity like '%(%'
     then to_regprocedure(object_identity)=to_regprocedure(obj.identity) else false end);
  if not found then
   select coalesce(max(restore_order),obj.bucket)+1 into next_order from public.custodial_release_authority_restore_inventory
    where restore_order>=obj.bucket and restore_order<obj.bucket+100000;
   insert into public.custodial_release_authority_restore_inventory
    (restore_order,object_kind,object_identity,definition_sql,definition_sha256)
    values(next_order,obj.kind,obj.identity,obj.definition,public.static_weekly_digest_text(obj.definition));
  end if;
 end loop;
end $recovery$;
alter table public.custodial_release_authority_restore_inventory enable trigger trg_custodial_release_authority_restore_inventory_immutable;
commit;
