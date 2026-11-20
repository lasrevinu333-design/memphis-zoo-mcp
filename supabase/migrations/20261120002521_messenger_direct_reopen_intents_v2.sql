-- Forward candidate: retain canonical conversations, deletion cutoffs and message history.
-- LOCAL ONLY / UNAPPLIED. Schema before backend before client; release review and
-- full migration rehearsal required. The runner owns the transaction.
-- RPC timeout pins the existing authenticator 8s policy for PostgREST.
alter table public.msg_thread_visibility add column list_reopened boolean not null default false;
create table public.msg_direct_open_intents (
 intent_id uuid primary key default gen_random_uuid(), request_id uuid not null unique,
 user_id uuid not null,other_user_id uuid not null,request_at timestamptz not null,
 expires_at timestamptz not null,thread_id uuid,visibility_generation jsonb not null,
 completed boolean not null default false,check(user_id<>other_user_id),
 check(expires_at=request_at+interval '15 minutes')
);
create index msg_direct_open_intents_expiry_idx on public.msg_direct_open_intents(expires_at,intent_id);
alter table public.msg_direct_open_intents enable row level security;
revoke all on public.msg_direct_open_intents from public,anon,authenticated,service_role;
create trigger custodial_disaster_restore_mutation_fence before insert or update or delete or truncate on public.msg_direct_open_intents for each statement execute function custodial_dr.guard_application_mutation();

-- Transaction-held all-writer fence for the captured runtime eligibility closure.
-- SHARE conflicts with INSERT/UPDATE/DELETE table locks, including replacement
-- rows and predicate phantoms. NOWAIT makes inverse administrative orders abort
-- rather than adding a wait edge while we hold operation/thread locks.
create function public.msg_lock_direct_intent_authority(p_user_a uuid,p_user_b uuid)
returns void language plpgsql security definer set search_path=pg_catalog,public,extensions as $$
begin
 if current_setting('transaction_isolation') <> 'read committed' then raise exception using errcode='25000',message='Direct intents require READ COMMITTED';end if;
 begin
  lock table public.msg_users,public.employees,public.ops_manager_managers,
    public.msg_device_assignments,custodial_leadership_private.policy in share mode nowait;
 exception when lock_not_available then
  raise exception using errcode='40001',message='Messaging authority changed or busy';
 end;
 if not public.msg_is_runtime_user(p_user_a) or not public.msg_is_runtime_user(p_user_b) then raise exception using errcode='42501',message='Active messaging users are required';end if;
end $$;
revoke all on function public.msg_lock_direct_intent_authority(uuid,uuid) from public,anon,authenticated,service_role;

create function public.msg_issue_direct_open_intent(p_user_a uuid,p_user_b uuid,p_request_id uuid,p_request_at timestamptz)
returns public.msg_direct_open_intents language plpgsql security definer set search_path=pg_catalog,public,extensions set statement_timeout='8s' as $$
declare v public.msg_direct_open_intents%rowtype; t uuid; ids uuid[]; generation jsonb;
begin
 if current_setting('transaction_isolation') <> 'read committed' then raise exception using errcode='25000',message='Direct intents require READ COMMITTED';end if;
 if p_user_a is null or p_user_b is null or p_user_a=p_user_b or p_request_id is null or p_request_at is null then raise exception using errcode='22023',message='Invalid intent request';end if;
 if not public.msg_is_runtime_user(p_user_a) or not public.msg_is_runtime_user(p_user_b) then raise exception using errcode='42501',message='Active messaging users are required';end if;
 if not isfinite(p_request_at) or p_request_at>clock_timestamp()+interval '30 seconds' or p_request_at+interval '15 minutes'<=clock_timestamp() then raise exception using errcode='22023',message='Intent request expired or clock invalid';end if;
 perform pg_advisory_xact_lock(hashtextextended('msg-intent-issue:v2:'||p_request_id::text,0));
 select * into v from public.msg_direct_open_intents where request_id=p_request_id;
 if v.intent_id is not null then
  if v.user_id<>p_user_a or v.other_user_id<>p_user_b or v.request_at<>p_request_at then raise exception using errcode='23505',message='Intent request binding mismatch';end if;
  if v.expires_at<=clock_timestamp() then raise exception using errcode='22023',message='Intent request expired or clock invalid';end if;
  perform public.msg_lock_direct_intent_authority(p_user_a,p_user_b);
  if v.expires_at<=clock_timestamp() then raise exception using errcode='22023',message='Intent request expired or clock invalid';end if;
  return v;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('msg-canonical-conversation-pair:v1:'||least(p_user_a,p_user_b)::text||':'||greatest(p_user_a,p_user_b)::text,0));
 select array_agg(q.id) into ids from (select x.id from public.msg_threads x where x.thread_type='direct' and x.is_active
 and exists(select 1 from public.msg_thread_participants p where p.thread_id=x.id and p.user_id=p_user_a and p.left_at is null)
 and exists(select 1 from public.msg_thread_participants p where p.thread_id=x.id and p.user_id=p_user_b and p.left_at is null)
 and 2=(select count(*) from public.msg_thread_participants p where p.thread_id=x.id and p.left_at is null) for update)q;
 if cardinality(ids)>1 then raise exception using errcode='23505',message='Ambiguous direct pair';end if;
 t:=ids[1];
 if t is not null then perform public.msg_assert_active_mutable_thread(t);end if;
 select coalesce(jsonb_agg(jsonb_build_array(id,hidden_before) order by id),'[]'::jsonb) into generation from public.msg_thread_visibility where thread_id=t and user_id=p_user_a and device_identifier is null;
 if p_request_at+interval '15 minutes'<=clock_timestamp() then raise exception using errcode='22023',message='Intent request expired or clock invalid';end if;
 perform public.msg_lock_direct_intent_authority(p_user_a,p_user_b);
 insert into public.msg_direct_open_intents(request_id,user_id,other_user_id,request_at,expires_at,thread_id,visibility_generation)
 values(p_request_id,p_user_a,p_user_b,p_request_at,p_request_at+interval '15 minutes',t,generation) returning * into v;
 if v.expires_at<=clock_timestamp() then raise exception using errcode='22023',message='Intent request expired or clock invalid';end if;
 return v;
end $$;

create function public.msg_consume_direct_open_intent(p_user_a uuid,p_user_b uuid,p_intent_id uuid)
returns public.msg_threads language plpgsql security definer set search_path=pg_catalog,public,extensions set statement_timeout='8s' as $$
declare v public.msg_direct_open_intents%rowtype; t public.msg_threads%rowtype; generation jsonb; ids uuid[];
begin
 if current_setting('transaction_isolation') <> 'read committed' then raise exception using errcode='25000',message='Direct intents require READ COMMITTED';end if;
 if p_user_a is null or p_user_b is null or p_intent_id is null or p_user_a=p_user_b then raise exception using errcode='22023',message='Invalid intent request';end if;
 if not public.msg_is_runtime_user(p_user_a) or not public.msg_is_runtime_user(p_user_b) then raise exception using errcode='42501',message='Active messaging users are required';end if;
 select * into v from public.msg_direct_open_intents where intent_id=p_intent_id for update;
 if v.intent_id is null or v.expires_at<=clock_timestamp() then raise exception using errcode='22023',message='Intent missing or expired';end if;
 if v.user_id<>p_user_a or v.other_user_id<>p_user_b then raise exception using errcode='42501',message='Intent actor or target mismatch';end if;
 perform pg_advisory_xact_lock(hashtextextended('msg-canonical-conversation-pair:v1:'||least(p_user_a,p_user_b)::text||':'||greatest(p_user_a,p_user_b)::text,0));
 if v.completed then select * into t from public.msg_threads where id=v.thread_id for update;
 else
  select array_agg(q.id) into ids from (select x.id from public.msg_threads x where x.thread_type='direct' and x.is_active
  and exists(select 1 from public.msg_thread_participants p where p.thread_id=x.id and p.user_id=p_user_a and p.left_at is null)
  and exists(select 1 from public.msg_thread_participants p where p.thread_id=x.id and p.user_id=p_user_b and p.left_at is null)
  and 2=(select count(*) from public.msg_thread_participants p where p.thread_id=x.id and p.left_at is null) for update)q;
  if cardinality(ids)>1 then raise exception using errcode='23505',message='Ambiguous direct pair';end if;
  if ids[1] is distinct from v.thread_id then raise exception using errcode='40001',message='Conversation generation changed';end if;
  select coalesce(jsonb_agg(jsonb_build_array(id,hidden_before) order by id),'[]'::jsonb) into generation from public.msg_thread_visibility where thread_id=v.thread_id and user_id=p_user_a and device_identifier is null;
  if generation<>v.visibility_generation then raise exception using errcode='40001',message='Conversation generation changed';end if;
  if v.thread_id is null then select * into t from public.msg_get_or_create_direct_thread(p_user_a,p_user_b);
  else select * into t from public.msg_threads where id=v.thread_id for update;end if;
 end if;
 if t.id is null or t.thread_type<>'direct' then raise exception using errcode='42501',message='Direct conversation is unavailable';end if;
 perform public.msg_assert_active_mutable_thread(t.id);
 if not exists(select 1 from public.msg_thread_participants where thread_id=t.id and user_id=p_user_a and left_at is null) or not exists(select 1 from public.msg_thread_participants where thread_id=t.id and user_id=p_user_b and left_at is null) then raise exception using errcode='42501',message='Active direct participants are required';end if;
 if v.expires_at<=clock_timestamp() then raise exception using errcode='22023',message='Intent missing or expired';end if;
 perform public.msg_lock_direct_intent_authority(p_user_a,p_user_b);
 if v.expires_at<=clock_timestamp() then raise exception using errcode='22023',message='Intent missing or expired';end if;
 if v.completed then return t;end if;
 update public.msg_thread_visibility set list_reopened=true,updated_at=clock_timestamp() where thread_id=t.id and user_id=p_user_a and device_identifier is null;
 update public.msg_direct_open_intents set completed=true,thread_id=t.id where intent_id=v.intent_id;
 if v.expires_at<=clock_timestamp() then raise exception using errcode='22023',message='Intent missing or expired';end if;
 return t;
end $$;

create function public.msg_cleanup_direct_open_intents(p_limit integer default 1000) returns integer language plpgsql security definer set search_path=pg_catalog,public as $$
declare n integer;
begin
 if p_limit is null or p_limit<1 or p_limit>10000 then raise exception using errcode='22023',message='Invalid cleanup limit';end if;
 with expired as (select intent_id from public.msg_direct_open_intents where expires_at<=clock_timestamp() order by expires_at,intent_id limit p_limit for update skip locked)
 delete from public.msg_direct_open_intents i using expired e where i.intent_id=e.intent_id;
 get diagnostics n=row_count;return n;
end $$;
revoke all on function public.msg_issue_direct_open_intent(uuid,uuid,uuid,timestamptz),public.msg_consume_direct_open_intent(uuid,uuid,uuid),public.msg_cleanup_direct_open_intents(integer) from public,anon,authenticated;
grant execute on function public.msg_issue_direct_open_intent(uuid,uuid,uuid,timestamptz),public.msg_consume_direct_open_intent(uuid,uuid,uuid),public.msg_cleanup_direct_open_intents(integer) to service_role;

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
