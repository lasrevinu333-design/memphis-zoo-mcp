-- Exact recovery declarations for the unapplied direct-open intent extension.
-- The existing migration runner owns this transaction and release window.
lock table public.custodial_release_authority_restore_inventory in access exclusive mode;
create temp table msg_direct_recovery_before on commit drop as
 select * from public.custodial_release_authority_restore_inventory;
create temp table msg_direct_recovery_triggers on commit drop as
 select oid,to_jsonb(t) as definition from pg_catalog.pg_trigger t
 where tgrelid='public.custodial_release_authority_restore_inventory'::regclass;
do $messenger_recovery_owner$
begin
 if current_user<>session_user or current_user<>'postgres'
  or (select relowner from pg_catalog.pg_class where oid='public.custodial_release_authority_restore_inventory'::regclass)
    <>(select oid from pg_catalog.pg_roles where rolname=current_user)
  or (select tgenabled from pg_catalog.pg_trigger where tgrelid='public.custodial_release_authority_restore_inventory'::regclass
    and tgname='trg_custodial_release_authority_restore_inventory_immutable') is distinct from 'A'
 then raise exception using errcode='42501',message='Original Messenger recovery owner and ALWAYS inventory guard required';end if;
end $messenger_recovery_owner$;
create temp table msg_direct_recovery_objects on commit drop as
 with relations(name) as (values('public.msg_direct_open_intents'::text),('public.msg_thread_visibility'::text)),
 funcs(identity) as (values
  ('public.msg_lock_direct_intent_authority(uuid,uuid)'::text),
  ('public.msg_issue_direct_open_intent(uuid,uuid,uuid,timestamp with time zone)'::text),
  ('public.msg_consume_direct_open_intent(uuid,uuid,uuid)'::text),
  ('public.msg_cleanup_direct_open_intents(integer)'::text)),objects as (
 select 1000 bucket,'relation'::text kind,name identity,public.custodial_release_authority_current_relation_definition(name) definition from relations
 union all select 100000,'function',identity,pg_get_functiondef(to_regprocedure(identity)) from funcs
 union all select 200000,'column',r.name||':'||a.attname,public.custodial_release_authority_current_column_definition(r.name||':'||a.attname)
  from relations r join pg_catalog.pg_attribute a on a.attrelid=r.name::regclass and a.attnum>0 and not a.attisdropped
 union all select 300000,'column_set',name,public.custodial_release_authority_current_column_set_definition(name) from relations
 union all select 400000,'relation_state',name,public.custodial_release_authority_current_relation_state_definition(name) from relations
 union all select 500000,'constraint',r.name||':'||c.conname,public.custodial_release_authority_current_constraint_definition(r.name||':'||c.conname)
  from relations r join pg_catalog.pg_constraint c on c.conrelid=r.name::regclass
 union all select 600000,'index','public.'||quote_ident(c.relname),public.custodial_release_authority_current_index_definition('public.'||quote_ident(c.relname))
  from relations r join pg_catalog.pg_index i on i.indrelid=r.name::regclass join pg_catalog.pg_class c on c.oid=i.indexrelid
  where not exists(select 1 from pg_catalog.pg_constraint k where k.conindid=i.indexrelid)
 union all select 700000,'trigger',r.name||'.'||t.tgname,
  'drop trigger if exists '||quote_ident(t.tgname)||' on '||r.name||'; '||pg_get_triggerdef(t.oid,true)||'; alter table '||r.name||' '||case t.tgenabled when 'O' then 'enable' when 'D' then 'disable' when 'R' then 'enable replica' when 'A' then 'enable always' end||' trigger '||quote_ident(t.tgname)||';'
  from relations r join pg_catalog.pg_trigger t on t.tgrelid=r.name::regclass and not t.tgisinternal
 union all select 900000,'grant',name,public.custodial_release_authority_current_grant_definition(name) from relations
 union all select 900000,'grant',identity,public.custodial_release_authority_current_grant_definition(identity) from funcs
 ) select * from objects;
alter table public.custodial_release_authority_restore_inventory disable trigger trg_custodial_release_authority_restore_inventory_immutable;
do $messenger_recovery_register$
declare obj record;v_order integer;matched integer;
begin
 if exists(select 1 from msg_direct_recovery_objects where definition is null)
  or exists(select 1 from msg_direct_recovery_objects group by kind,identity having count(*)<>1)
 then raise exception 'Exact Messenger recovery definitions unavailable or ambiguous';end if;
 for obj in select * from msg_direct_recovery_objects order by bucket,identity loop
  select count(*) into matched from public.custodial_release_authority_restore_inventory
   where object_kind=obj.kind and (object_identity=obj.identity or case when obj.kind in('function','grant')
    and position('(' in object_identity)>0 and position('(' in obj.identity)>0 then to_regprocedure(object_identity)=to_regprocedure(obj.identity) else false end);
  if matched>1 then raise exception 'Messenger recovery identity is ambiguous';end if;
  if matched=1 then
   update public.custodial_release_authority_restore_inventory set definition_sql=obj.definition,
    definition_sha256=public.static_weekly_digest_text(obj.definition),captured_at=statement_timestamp()
    where object_kind=obj.kind and (object_identity=obj.identity or case when obj.kind in('function','grant')
     and position('(' in object_identity)>0 and position('(' in obj.identity)>0 then to_regprocedure(object_identity)=to_regprocedure(obj.identity) else false end)
     and (definition_sql is distinct from obj.definition or definition_sha256 is distinct from public.static_weekly_digest_text(obj.definition));
  else
   select coalesce(max(restore_order),obj.bucket)+1 into v_order from public.custodial_release_authority_restore_inventory
    where restore_order>=obj.bucket and restore_order<case when obj.bucket=1000 then 100000 else obj.bucket+100000 end;
   insert into public.custodial_release_authority_restore_inventory(restore_order,object_kind,object_identity,definition_sql,definition_sha256)
    values(v_order,obj.kind,obj.identity,obj.definition,public.static_weekly_digest_text(obj.definition));
  end if;
 end loop;
end $messenger_recovery_register$;
alter table public.custodial_release_authority_restore_inventory enable always trigger trg_custodial_release_authority_restore_inventory_immutable;
do $messenger_recovery_verify$
begin
 if exists((select oid,to_jsonb(t) from pg_catalog.pg_trigger t where tgrelid='public.custodial_release_authority_restore_inventory'::regclass
   except select oid,definition from msg_direct_recovery_triggers)
  union all(select oid,definition from msg_direct_recovery_triggers except
   select oid,to_jsonb(t) from pg_catalog.pg_trigger t where tgrelid='public.custodial_release_authority_restore_inventory'::regclass))
 then raise exception 'Messenger recovery inventory guard metadata changed';end if;
 if exists(select 1 from msg_direct_recovery_before b left join public.custodial_release_authority_restore_inventory i using(inventory_id)
  where i.inventory_id is null or to_jsonb(i)-'definition_sql'-'definition_sha256'-'captured_at'
   is distinct from to_jsonb(b)-'definition_sql'-'definition_sha256'-'captured_at')
 then raise exception 'Messenger recovery changed original identity or ordering';end if;
 if exists(select 1 from public.custodial_release_authority_restore_inventory i
  where not exists(select 1 from msg_direct_recovery_objects o where i.object_kind=o.kind and (i.object_identity=o.identity or case when o.kind in('function','grant') and position('(' in i.object_identity)>0 and position('(' in o.identity)>0 then to_regprocedure(i.object_identity)=to_regprocedure(o.identity) else false end))
  and not exists(select 1 from msg_direct_recovery_before b where to_jsonb(b)=to_jsonb(i)))
 then raise exception 'Messenger recovery changed unrelated inventory';end if;
 if exists(select 1 from msg_direct_recovery_objects o where (select count(*) from public.custodial_release_authority_restore_inventory i
  where i.object_kind=o.kind and (i.object_identity=o.identity or case when o.kind in('function','grant') and position('(' in i.object_identity)>0 and position('(' in o.identity)>0 then to_regprocedure(i.object_identity)=to_regprocedure(o.identity) else false end)
  and i.definition_sql=o.definition and i.definition_sha256=public.static_weekly_digest_text(o.definition))<>1)
 then raise exception 'Messenger recovery readback differs';end if;
end $messenger_recovery_verify$;
