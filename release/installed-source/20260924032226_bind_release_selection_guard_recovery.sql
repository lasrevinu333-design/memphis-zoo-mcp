begin;
set local lock_timeout='5s';
set local statement_timeout='120s';

-- Bind the new selector invariant into exact health/recovery. Private trigger
-- functions remain private; no API role gains execution or table access.
do $surface$
declare definition text;
begin
 definition:=pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure);
 if (length(definition)-length(replace(definition,'  values','')))/length('  values')<>1 then
  raise exception 'unexpected canary authority surface shape'; end if;
 execute replace(definition,'  values','  values
    (''function'',''custodial_dr.guard_release_selection()'',''database-derived ordinary release selection''),
    (''function'',''custodial_dr.require_single_release_on_resume()'',''paused recovery single-selector admission''),
    (''column'',''public.release_deployment_manifest:recovery_staged'',''database-derived staging marker''),
    (''column_set'',''public.release_deployment_manifest'',''release ledger schema''),
    (''index'',''public.release_deployment_manifest_one_ordinary_deployed'',''concurrent deployed selector uniqueness''),
    (''trigger'',''public.release_deployment_manifest.trg_release_selection_guard'',''restore-mode staging guard''),
    (''trigger'',''custodial_dr.restore_control.trg_require_single_release_on_resume'',''resume cannot retain ambiguous selection''),');
end $surface$;

alter table public.custodial_release_authority_restore_inventory disable trigger trg_custodial_release_authority_restore_inventory_immutable;
do $recovery$
declare obj record;next_order integer;
begin
 for obj in with functions as (
   select oid from pg_proc where oid in
    ('custodial_dr.guard_release_selection()'::regprocedure,
     'custodial_dr.require_single_release_on_resume()'::regprocedure,
     'public.custodial_release_canary_authority_surface()'::regprocedure)
 ), objects as (
  select 100000 bucket,'function'::text kind,oid::regprocedure::text identity,pg_get_functiondef(oid) definition from functions
  union all select 200000,'column','public.release_deployment_manifest:recovery_staged',
   public.custodial_release_authority_current_column_definition('public.release_deployment_manifest:recovery_staged')
  union all select 300000,'column_set','public.release_deployment_manifest',
   public.custodial_release_authority_current_column_set_definition('public.release_deployment_manifest')
  union all select 600000,'index','public.release_deployment_manifest_one_ordinary_deployed',
   public.custodial_release_authority_current_index_definition('public.release_deployment_manifest_one_ordinary_deployed')
  union all select 700000,'trigger',quote_ident(n.nspname)||'.'||quote_ident(r.relname)||'.'||quote_ident(t.tgname),
   'drop trigger if exists '||quote_ident(t.tgname)||' on '||quote_ident(n.nspname)||'.'||quote_ident(r.relname)||'; '
    ||pg_get_triggerdef(t.oid,true)||'; alter table '||quote_ident(n.nspname)||'.'||quote_ident(r.relname)||' '
    ||case t.tgenabled when 'O' then 'enable' when 'D' then 'disable' when 'R' then 'enable replica' when 'A' then 'enable always' end
    ||' trigger '||quote_ident(t.tgname)||';'
   from pg_trigger t join pg_class r on r.oid=t.tgrelid join pg_namespace n on n.oid=r.relnamespace
   where not t.tgisinternal and ((t.tgrelid='public.release_deployment_manifest'::regclass and t.tgname='trg_release_selection_guard')
    or(t.tgrelid='custodial_dr.restore_control'::regclass and t.tgname='trg_require_single_release_on_resume'))
  union all select 900000,'grant',oid::regprocedure::text,
   public.custodial_release_authority_current_grant_definition(oid::regprocedure::text) from functions
 ) select * from objects order by bucket,identity loop
  if obj.definition is null then raise exception 'missing release-selection recovery object %',obj.identity; end if;
  update public.custodial_release_authority_restore_inventory set definition_sql=obj.definition,
   definition_sha256=public.static_weekly_digest_text(obj.definition),captured_at=statement_timestamp()
   where object_kind=obj.kind and (object_identity=obj.identity or
    case when obj.kind in ('function','grant') and object_identity like '%(%'
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
