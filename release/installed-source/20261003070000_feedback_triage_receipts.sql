begin;
set local lock_timeout='5s';
set local statement_timeout='90s';

-- Compare the complete server timestamp without JavaScript Date truncation.
-- This token is an optimistic concurrency version, not authentication.
create function public.custodial_feedback_triage_version(p_status text,p_updated_at timestamptz)
returns text language sql immutable strict security definer
set search_path to 'pg_catalog','public','extensions'
as $fn$
 select public.static_weekly_digest_jsonb(jsonb_build_array(
   p_status,to_char(p_updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')))
$fn$;
revoke all on function public.custodial_feedback_triage_version(text,timestamptz) from public,anon,authenticated;
grant execute on function public.custodial_feedback_triage_version(text,timestamptz)
 to service_role,custodial_application_reader;

create table public.system_feedback_triage_receipts(
 request_id uuid primary key,
 feedback_id uuid not null references public.system_feedback_items(id) on delete restrict,
 manager_id uuid not null references public.ops_manager_managers(manager_id) on delete restrict,
 credential_id uuid not null references public.ops_manager_trusted_devices(credential_id) on delete restrict,
 action text not null check(action in ('acknowledged','resolved','closed')),
 expected_version text not null check(expected_version~'^[a-f0-9]{64}$'),
 receipt jsonb not null check(jsonb_typeof(receipt)='object'),
 accepted_at timestamptz not null default clock_timestamp()
);
create index system_feedback_triage_feedback_idx on public.system_feedback_triage_receipts(feedback_id);
create index system_feedback_triage_manager_idx on public.system_feedback_triage_receipts(manager_id);
create index system_feedback_triage_credential_idx on public.system_feedback_triage_receipts(credential_id);
alter table public.system_feedback_triage_receipts enable row level security;
alter table public.system_feedback_triage_receipts force row level security;
revoke all on public.system_feedback_triage_receipts from public,anon,authenticated,service_role,custodial_application_reader;
create function public.custodial_feedback_triage_immutable()
returns trigger language plpgsql security invoker set search_path to 'pg_catalog','public'
as $fn$ begin raise exception using errcode='55000',message='Feedback triage receipts are append-only'; end $fn$;
revoke all on function public.custodial_feedback_triage_immutable() from public,anon,authenticated,service_role,custodial_application_reader;
create trigger system_feedback_triage_immutable before update or delete on public.system_feedback_triage_receipts
 for each row execute function public.custodial_feedback_triage_immutable();
alter table public.system_feedback_triage_receipts enable always trigger system_feedback_triage_immutable;

create function public.custodial_feedback_triage(
 p_request uuid,p_manager uuid,p_credential uuid,p_feedback uuid,p_action text,p_expected_version text
) returns jsonb language plpgsql security definer set search_path to 'pg_catalog','public','extensions'
as $fn$
declare
 old_receipt public.system_feedback_triage_receipts%rowtype;
 item public.system_feedback_items%rowtype;
 manager public.ops_manager_managers%rowtype;
 accepted timestamptz; result jsonb;
begin
 if p_request is null or p_manager is null or p_credential is null or p_feedback is null
  or p_action is null or p_action not in ('acknowledged','resolved','closed')
  or p_expected_version is null or p_expected_version!~'^[a-f0-9]{64}$' then
  raise exception using errcode='22023',message='Exact Feedback command and version required'; end if;
 select * into manager from public.ops_manager_managers m where m.manager_id=p_manager
  and m.active and m.revoked_at is null and not m.is_system_principal
  and m.roles&&array['OPS_MANAGER','CUSTODIAL_MANAGER','DIRECTOR','SECURITY_ADMIN']::text[] for share;
 if not found then raise exception using errcode='42501',message='Current named manager required'; end if;
 perform 1 from public.ops_manager_trusted_devices d where d.credential_id=p_credential
  and d.manager_id=p_manager and d.revoked_at is null and d.expires_at>clock_timestamp()
  and d.max_access_level='full_access' for share;
 if not found then raise exception using errcode='42501',message='Current full-access manager credential required'; end if;
 perform pg_advisory_xact_lock(hashtextextended('feedback-triage:'||p_request::text,0));
 select * into old_receipt from public.system_feedback_triage_receipts where request_id=p_request;
 if found then
  if old_receipt.feedback_id<>p_feedback or old_receipt.manager_id<>p_manager
   or old_receipt.credential_id<>p_credential or old_receipt.action<>p_action
   or old_receipt.expected_version<>p_expected_version then
   raise exception using errcode='40001',message='Feedback request identity conflict'; end if;
  return jsonb_build_object('ok',true,'replayed',true,'receipt',old_receipt.receipt);
 end if;
 select * into item from public.system_feedback_items where id=p_feedback for update;
 if not found then raise exception using errcode='P0002',message='Feedback item unavailable'; end if;
 if public.custodial_feedback_triage_version(item.status,item.updated_at)<>p_expected_version
  or item.status='closed' or item.status=p_action
  or (item.status='resolved' and p_action<>'closed') then
  raise exception using errcode='40001',message='Feedback changed; refresh before a new action'; end if;
 accepted:=clock_timestamp();
 update public.system_feedback_items set status=p_action,updated_at=accepted,
  acknowledged_at=case when p_action='acknowledged' then accepted else acknowledged_at end,
  acknowledged_by=case when p_action='acknowledged' then manager.display_name else acknowledged_by end,
  metadata_json=coalesce(metadata_json,'{}'::jsonb)||jsonb_build_object(
   'status_changed_via','manager_feedback_inbox','status_changed_by',manager.display_name,
   'status_changed_manager_id',p_manager,'status_changed_credential_id',p_credential)
  where id=p_feedback returning * into item;
 result:=jsonb_build_object('request_id',p_request,'feedback_id',p_feedback,'status',p_action,
  'triage_version',public.custodial_feedback_triage_version(item.status,item.updated_at),
  'actor_manager_id',p_manager,'actor_credential_id',p_credential,'accepted_at',accepted);
 insert into public.system_feedback_triage_receipts
  (request_id,feedback_id,manager_id,credential_id,action,expected_version,receipt,accepted_at)
 values(p_request,p_feedback,p_manager,p_credential,p_action,p_expected_version,result,accepted);
 return jsonb_build_object('ok',true,'replayed',false,'receipt',result);
end $fn$;
revoke all on function public.custodial_feedback_triage(uuid,uuid,uuid,uuid,text,text)
 from public,anon,authenticated,custodial_application_reader;
grant execute on function public.custodial_feedback_triage(uuid,uuid,uuid,uuid,text,text) to service_role;

-- Capture only the exact new owning surface, including automatically installed
-- restoration fences. Never recapture unrelated drift.
do $recovery$
declare obj record; ord integer; changed integer;
begin
 if not exists(select 1 from pg_trigger where tgrelid='public.custodial_release_authority_restore_inventory'::regclass
  and tgname='trg_custodial_release_authority_restore_inventory_immutable' and tgenabled='O') then raise exception 'Recovery immutability unavailable'; end if;
 alter table public.custodial_release_authority_restore_inventory disable trigger trg_custodial_release_authority_restore_inventory_immutable;
 for obj in select * from (
  select 100000 bucket,'function'::text kind,p.oid::regprocedure::text identity,pg_get_functiondef(p.oid) definition
   from pg_proc p where pronamespace='public'::regnamespace and proname in
    ('custodial_feedback_triage_version','custodial_feedback_triage_immutable','custodial_feedback_triage')
  union all select 900000,'grant',p.oid::regprocedure::text,public.custodial_release_authority_current_grant_definition(p.oid::regprocedure::text)
   from pg_proc p where pronamespace='public'::regnamespace and proname in
    ('custodial_feedback_triage_version','custodial_feedback_triage_immutable','custodial_feedback_triage')
  union all select x.* from unnest(array['public.system_feedback_triage_receipts']) rel
   cross join lateral (
    select 1000,'relation'::text,rel,public.custodial_release_authority_current_relation_definition(rel)
    union all select 200000,'column',rel||':'||attname,public.custodial_release_authority_current_column_definition(rel||':'||attname) from pg_attribute where attrelid=rel::regclass and attnum>0 and not attisdropped
    union all select 300000,'column_set',rel,public.custodial_release_authority_current_column_set_definition(rel)
    union all select 400000,'relation_state',rel,public.custodial_release_authority_current_relation_state_definition(rel)
    union all select 500000,'constraint',rel||':'||conname,public.custodial_release_authority_current_constraint_definition(rel||':'||conname) from pg_constraint where conrelid=rel::regclass
    union all select 600000,'index',indexrelid::regclass::text,public.custodial_release_authority_current_index_definition(indexrelid::regclass::text) from pg_index i where indrelid=rel::regclass and not exists(select 1 from pg_constraint where conindid=i.indexrelid)
    union all select 700000,'trigger',rel||'.'||tgname,'drop trigger if exists '||quote_ident(tgname)||' on '||rel||'; '||pg_get_triggerdef(oid,true)||'; alter table '||rel||case tgenabled when 'A' then ' enable always trigger ' else ' enable trigger ' end||quote_ident(tgname)||';' from pg_trigger where tgrelid=rel::regclass and not tgisinternal
    union all select 900000,'grant',rel,public.custodial_release_authority_current_grant_definition(rel)
   ) x
 ) objects order by bucket,case when identity like '%custodial_feedback_triage_version(%' then 0 else 1 end,identity
 loop
  if obj.definition is null then raise exception 'Missing Feedback triage recovery object %',obj.identity; end if;
  update public.custodial_release_authority_restore_inventory set definition_sql=obj.definition,definition_sha256=public.static_weekly_digest_text(obj.definition),captured_at=statement_timestamp() where object_kind=obj.kind and object_identity=obj.identity;
  get diagnostics changed=row_count;
  if changed>1 then raise exception 'Duplicate recovery identity'; end if;
  if changed=0 then
   select n into ord from generate_series(obj.bucket+1,(case when obj.bucket=1000 then 100000 else obj.bucket+100000 end)-1) n where not exists(select 1 from public.custodial_release_authority_restore_inventory where restore_order=n) order by n limit 1;
   if ord is null then raise exception 'Recovery order exhausted'; end if;
   insert into public.custodial_release_authority_restore_inventory(restore_order,object_kind,object_identity,definition_sql,definition_sha256) values(ord,obj.kind,obj.identity,obj.definition,public.static_weekly_digest_text(obj.definition));
  end if;
 end loop;
 alter table public.custodial_release_authority_restore_inventory enable trigger trg_custodial_release_authority_restore_inventory_immutable;
end $recovery$;
commit;
