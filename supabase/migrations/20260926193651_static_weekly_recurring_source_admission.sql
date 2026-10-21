-- Private source admission in the H03/H04 parent transaction. No publication
-- endpoint or finalizer is mounted. Partial admission cannot commit because
-- the parent ledger requires its complete atomic receipt at transaction end.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

create table public.static_weekly_recurring_source_bindings (
  source_id uuid primary key references public.static_weekly_authority_source_documents(source_id) on delete restrict,
  operation_id uuid not null unique references public.static_weekly_recurring_confirmations(operation_id) on delete restrict,
  source_digest text not null check(source_digest~'^[0-9a-f]{64}$'),
  owner_xid xid8 not null default pg_current_xact_id(),
  admitted_at timestamptz not null default statement_timestamp()
);
alter table public.static_weekly_recurring_source_bindings enable row level security;
alter table public.static_weekly_recurring_source_bindings force row level security;
revoke all on table public.static_weekly_recurring_source_bindings from public,anon,authenticated,
  service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader;
create trigger trg_recurring_source_binding_immutable before update or delete
  on public.static_weekly_recurring_source_bindings for each row
  execute function public.static_weekly_reject_update_delete();

create function public.static_weekly_v14_admit_recurring_source(
  p_manager_id uuid,p_confirmation_key uuid,p_canonical_source jsonb,p_source_digest text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare
  v_parent public.static_weekly_recurring_confirmations%rowtype;
  v_binding public.static_weekly_recurring_source_bindings%rowtype;
  v_digest text;v_identity text;v_source_id uuid;
begin
  perform public.static_weekly_v3_assert_control_plane();
  perform public.static_weekly_v3_manager_actor(p_manager_id);
  perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
  select * into v_parent from public.static_weekly_recurring_confirmations
    where manager_id=p_manager_id and confirmation_key=p_confirmation_key for update;
  if not found or v_parent.owner_xid<>pg_current_xact_id()
    or exists(select 1 from public.static_weekly_recurring_confirmation_receipts where operation_id=v_parent.operation_id) then
    raise exception using errcode='42501',message='recurring source requires this transaction''s uncompleted named-manager reservation';
  end if;
  if p_canonical_source is null or jsonb_typeof(p_canonical_source) is distinct from 'object'
    or jsonb_typeof(p_canonical_source->'version') is distinct from 'object'
    or p_canonical_source ? 'versions'
    or p_canonical_source->'exceptions' is distinct from '[]'::jsonb
    or p_canonical_source#>'{version,namedAbsentSlotIds}' is distinct from '[]'::jsonb
    or p_canonical_source->>'serviceDate' is distinct from v_parent.effective_start::text
    or p_canonical_source#>>'{version,effectiveStart}' is distinct from v_parent.effective_start::text
    or p_canonical_source#>'{version,effectiveEnd}' is distinct from 'null'::jsonb
    or p_source_digest is null or p_source_digest!~'^[0-9a-f]{64}$' then
    raise exception using errcode='23514',message='recurring source must match the exact future exception-free candidate';
  end if;
  perform public.static_weekly_v3_source_identity(p_canonical_source);
  v_digest:=public.static_weekly_digest_jsonb(p_canonical_source);
  if p_source_digest<>v_digest then
    raise exception using errcode='23514',message='recurring source digest does not match actual inserted bytes';
  end if;
  select * into v_binding from public.static_weekly_recurring_source_bindings where operation_id=v_parent.operation_id;
  if found then
    if v_binding.owner_xid<>pg_current_xact_id() or v_binding.source_digest<>v_digest
      or not exists(select 1 from public.static_weekly_authority_source_documents
        where source_id=v_binding.source_id and source_digest=v_digest and canonical_source=p_canonical_source) then
      raise exception using errcode='23505',message='recurring parent already binds different source bytes';
    end if;
    return jsonb_build_object('source_id',v_binding.source_id,'source_digest',v_digest,'operation_id',v_parent.operation_id);
  end if;
  v_identity:=public.static_weekly_digest_text('static-weekly.recurring-source.v1:'||p_manager_id||':'||p_confirmation_key||':'||v_digest);
  -- Stable RFC-variant UUID identity from parent semantic identity + actual
  -- bytes. Rollback/retry does not pick a different registered source UUID.
  v_source_id:=(substr(v_identity,1,8)||'-'||substr(v_identity,9,4)||'-5'||substr(v_identity,14,3)||'-a'||substr(v_identity,18,3)||'-'||substr(v_identity,21,12))::uuid;
  insert into public.static_weekly_authority_source_documents(source_id,canonical_source,source_digest,configured_by)
    values(v_source_id,p_canonical_source,v_digest,'recurring-confirmation:'||v_parent.operation_id);
  insert into public.static_weekly_recurring_source_bindings(source_id,operation_id,source_digest)
    values(v_source_id,v_parent.operation_id,v_digest);
  return jsonb_build_object('source_id',v_source_id,'source_digest',v_digest,'operation_id',v_parent.operation_id);
end
$function$;

create function public.static_weekly_v14_assert_recurring_source_use(
  p_source_id uuid,p_manager_id uuid,p_effective_start date,p_idempotency_key text,p_stage text
) returns void language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_parent public.static_weekly_recurring_confirmations%rowtype;v_binding public.static_weekly_recurring_source_bindings%rowtype;
begin
  -- Lock before source/version row locks for legacy and derived paths alike.
  perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
  select * into v_binding from public.static_weekly_recurring_source_bindings where source_id=p_source_id;
  if not found then return;end if; -- unchanged release-registered source path
  select * into strict v_parent from public.static_weekly_recurring_confirmations where operation_id=v_binding.operation_id;
  if v_parent.manager_id is distinct from p_manager_id
    or v_parent.owner_xid<>pg_current_xact_id() or v_binding.owner_xid<>pg_current_xact_id()
    or p_stage not in ('draft','publish') or p_stage is null
    or v_parent.effective_start is distinct from p_effective_start
    or p_idempotency_key is distinct from 'recurring:'||p_manager_id||':'||v_parent.confirmation_key||':'||p_stage
    or exists(select 1 from public.static_weekly_recurring_confirmation_receipts where operation_id=v_parent.operation_id) then
    raise exception using errcode='42501',message='derived recurring source cannot escape its original confirmation transaction and exact child key';
  end if;
end
$function$;

-- Add only the typed parent check to the latest installed wrappers. Exact
-- one-seam guards preserve every later compact-document/attestation repair.
do $wrappers$
declare v_signature text;v_check text;v_definition text;v_seam text:='perform public.static_weekly_v3_assert_control_plane();';
begin
  for v_signature,v_check in select * from (values
    ('public.static_weekly_v3_create_draft(date,text,jsonb,jsonb,jsonb,bigint,uuid,text,uuid)',
     'perform public.static_weekly_v14_assert_recurring_source_use(p_source_id,p_manager_id,p_effective_start,p_idempotency_key,''draft'');'),
    ('public.static_weekly_v3_update_draft(uuid,jsonb,jsonb,jsonb,bigint,bigint,uuid,text)',
     'perform public.static_weekly_v14_assert_recurring_source_use((select authority_source_id from public.weekly_schedule_versions where version_id=p_version_id),p_manager_id,null,p_idempotency_key,''update'');'),
    ('public.static_weekly_v3_publish_draft(uuid,bigint,bigint,uuid,text,text,uuid)',
     'perform public.static_weekly_v14_assert_recurring_source_use((select authority_source_id from public.weekly_schedule_versions where version_id=p_draft_version_id),p_manager_id,(select effective_start from public.weekly_schedule_versions where version_id=p_draft_version_id),p_idempotency_key,''publish'');')
  ) t(signature,guard_sql) loop
    v_definition:=pg_get_functiondef(v_signature::regprocedure);
    if length(v_definition)-length(replace(v_definition,v_seam,''))<>length(v_seam) then
      raise exception 'recurring source wrapper seam changed: %',v_signature;
    end if;
    execute replace(v_definition,v_seam,v_seam||E'\n  '||v_check);
  end loop;
end
$wrappers$;

do $receipt_binding$
declare v_definition text;v_seam text:='if v_parent.owner_xid<>pg_current_xact_id()';
begin
  v_definition:=pg_get_functiondef('public.static_weekly_v13_guard_recurring_receipt()'::regprocedure);
  if length(v_definition)-length(replace(v_definition,v_seam,''))<>length(v_seam) then
    raise exception 'recurring parent receipt binding seam changed';
  end if;
  execute replace(v_definition,v_seam,v_seam||E'\n    or not exists(select 1 from public.static_weekly_recurring_source_bindings b\n      where b.operation_id=new.operation_id and b.source_id=new.source_id\n        and b.source_digest=new.source_digest and b.owner_xid=pg_current_xact_id())');
end
$receipt_binding$;

revoke all on function public.static_weekly_v14_admit_recurring_source(uuid,uuid,jsonb,text),
  public.static_weekly_v14_assert_recurring_source_use(uuid,uuid,date,text,text)
  from public,anon,authenticated,service_role,static_weekly_control_plane,
    static_weekly_release_operator,custodial_application_reader;
grant execute on function public.static_weekly_v14_admit_recurring_source(uuid,uuid,jsonb,text)
  to static_weekly_control_plane;

-- Forward recovery inventory is appended below before the migration commits.
do $surface$
declare v_definition text;v_additions text;
begin
  v_definition:=pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure);
  if (length(v_definition)-length(replace(v_definition,'  values','')))/length('  values')<>1 then
    raise exception 'recurring source canary surface seam changed';
  end if;
  v_additions:=$rows$
 ('relation','public.static_weekly_recurring_source_bindings','parent-transaction recurring source admission'),
 ('function','public.static_weekly_v14_admit_recurring_source(uuid,uuid,jsonb,text)','parent-transaction recurring source admission'),
 ('function','public.static_weekly_v14_assert_recurring_source_use(uuid,uuid,date,text,text)','parent-transaction recurring source admission'),
 ('trigger','public.static_weekly_recurring_source_bindings.trg_recurring_source_binding_immutable','parent-transaction recurring source admission'),
$rows$;
  execute replace(v_definition,'  values','  values'||E'\n'||v_additions);
end
$surface$;

alter table public.custodial_release_authority_restore_inventory
  disable trigger trg_custodial_release_authority_restore_inventory_immutable;
do $recovery$
declare obj record;next_order integer;
begin
  for obj in with relation_names(name) as (values ('public.static_weekly_recurring_source_bindings')),
    funcs as (select p.oid,'public.'||p.oid::regprocedure::text identity
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and (starts_with(p.proname,'static_weekly_v14_')
        or p.oid in ('public.static_weekly_v13_guard_recurring_receipt()'::regprocedure,
          'public.static_weekly_v3_create_draft(date,text,jsonb,jsonb,jsonb,bigint,uuid,text,uuid)'::regprocedure,
          'public.static_weekly_v3_update_draft(uuid,jsonb,jsonb,jsonb,bigint,bigint,uuid,text)'::regprocedure,
          'public.static_weekly_v3_publish_draft(uuid,bigint,bigint,uuid,text,text,uuid)'::regprocedure)
        or p.oid='public.custodial_release_canary_authority_surface()'::regprocedure)),
    new_triggers as (select t.oid,c.relname,n.nspname,t.tgname,t.tgenabled
      from pg_trigger t join pg_class c on c.oid=t.tgrelid
      join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and t.tgname in (
        'trg_recurring_source_binding_immutable')),
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
    if obj.definition is null then raise exception 'missing recurring confirmation recovery object %',obj.identity;end if;
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
