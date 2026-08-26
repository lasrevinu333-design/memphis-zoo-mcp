-- Preserve frozen employee work across an explicit manager-approved phone
-- credential renewal. The original credential remains immutable evidence; a
-- current successor credential is transport authority only.

begin;

create table public.custodial_device_credential_replacements (
  replacement_id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices(id),
  predecessor_credential_id uuid not null references public.device_auth_credentials(credential_id),
  successor_credential_id uuid not null references public.device_auth_credentials(credential_id),
  enrollment_id uuid not null references public.device_auth_enrollment_codes(enrollment_id),
  replaced_at timestamptz not null,
  replaced_by text not null,
  replacement_reason text not null default 'manager_enrollment',
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint custodial_device_credential_replacements_distinct check (
    predecessor_credential_id <> successor_credential_id
  ),
  constraint custodial_device_credential_replacements_reason check (
    replacement_reason = 'manager_enrollment'
  ),
  constraint custodial_device_credential_replacements_metadata check (
    jsonb_typeof(metadata_json) = 'object'
  ),
  constraint uq_custodial_device_credential_replacement unique (
    predecessor_credential_id, successor_credential_id
  )
);

create index idx_custodial_device_credential_replacements_successor
  on public.custodial_device_credential_replacements(device_id, successor_credential_id, replaced_at);
create index idx_custodial_device_credential_replacements_predecessor
  on public.custodial_device_credential_replacements(device_id, predecessor_credential_id, replaced_at);

alter table public.custodial_device_credential_replacements enable row level security;
alter table public.custodial_device_credential_replacements force row level security;

create function public.custodial_reject_device_credential_replacement_update_delete()
returns trigger language plpgsql set search_path to 'pg_catalog','public' as $function$
begin
  raise exception using errcode='23514',message='Device credential replacement lineage is immutable';
end
$function$;

create trigger trg_custodial_device_credential_replacements_immutable
before update or delete on public.custodial_device_credential_replacements
for each row execute function public.custodial_reject_device_credential_replacement_update_delete();

revoke all on table public.custodial_device_credential_replacements from public,anon,authenticated,service_role;
revoke all on function public.custodial_reject_device_credential_replacement_update_delete() from public,anon,authenticated,service_role;

create function public.custodial_credential_may_transmit_frozen_work(
  p_original_credential_id uuid,
  p_authenticated_credential_id uuid,
  p_device_id uuid,
  p_now timestamptz default now()
) returns boolean
language sql stable security definer
set search_path to 'pg_catalog','public'
as $function$
  with recursive lineage(predecessor_credential_id,successor_credential_id,path) as (
    select r.predecessor_credential_id,r.successor_credential_id,
      array[r.predecessor_credential_id,r.successor_credential_id]::uuid[]
    from public.custodial_device_credential_replacements r
    where r.device_id=p_device_id and r.predecessor_credential_id=p_original_credential_id
    union all
    select l.predecessor_credential_id,r.successor_credential_id,l.path||r.successor_credential_id
    from lineage l
    join public.custodial_device_credential_replacements r
      on r.device_id=p_device_id and r.predecessor_credential_id=l.successor_credential_id
    where not r.successor_credential_id=any(l.path) and cardinality(l.path)<32
  )
  select coalesce(
    case
      when p_original_credential_id is null or p_authenticated_credential_id is null or p_device_id is null then false
      when p_original_credential_id=p_authenticated_credential_id then exists(
        select 1 from public.device_auth_credentials c
        where c.credential_id=p_original_credential_id and c.device_id=p_device_id
      )
      else exists(
        select 1
        from public.device_auth_credentials current_credential
        where current_credential.credential_id=p_authenticated_credential_id
          and current_credential.device_id=p_device_id
          and current_credential.confirmed_at is not null
          and current_credential.revoked_at is null
          and current_credential.expires_at>p_now
          and exists(
            select 1 from lineage l
            where l.successor_credential_id=p_authenticated_credential_id
          )
      )
    end,
    false
  )
$function$;

revoke all on function public.custodial_credential_may_transmit_frozen_work(uuid,uuid,uuid,timestamptz)
  from public,anon,authenticated;
grant execute on function public.custodial_credential_may_transmit_frozen_work(uuid,uuid,uuid,timestamptz)
  to postgres,service_role;

-- Enrollment is the only writer of successor lineage. It first revokes every
-- active predecessor, creates the successor, then records every exact edge in
-- the same transaction as consumption of the manager-issued code.
create or replace function public.device_auth_consume_enrollment_code(
  p_device_id uuid,
  p_code_hash text,
  p_credential_id uuid,
  p_token_hash text,
  p_device_label text,
  p_expires_at timestamptz,
  p_user_agent_hash text default null,
  p_ip_hash text default null,
  p_metadata_json jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','extensions'
as $function$
declare
  v_code public.device_auth_enrollment_codes%rowtype;
  v_now timestamptz := now();
  v_credential public.device_auth_credentials%rowtype;
  v_replaced_id uuid;
  v_replaced_ids uuid[] := array[]::uuid[];
begin
  if p_device_id is null then raise exception 'device_id is required'; end if;
  if p_code_hash is null or length(p_code_hash)<>64 then raise exception 'valid code_hash is required'; end if;
  if p_credential_id is null then raise exception 'credential_id is required'; end if;
  if p_token_hash is null or length(p_token_hash)<>64 then raise exception 'valid token_hash is required'; end if;
  if p_expires_at is null or p_expires_at<=v_now then raise exception 'future expires_at is required'; end if;

  select * into v_code
  from public.device_auth_enrollment_codes c
  where c.device_id=p_device_id and c.consumed_at is null and c.revoked_at is null and c.status='active'
  for update;

  if not found then return jsonb_build_object('ok',false,'reason','missing'); end if;
  if v_code.expires_at<=v_now then
    update public.device_auth_enrollment_codes c set status='expired' where c.enrollment_id=v_code.enrollment_id;
    return jsonb_build_object('ok',false,'reason','expired','enrollment_id',v_code.enrollment_id);
  end if;
  if v_code.code_hash<>p_code_hash then
    update public.device_auth_enrollment_codes c
       set failed_attempts=least(10,c.failed_attempts+1),last_failed_at=v_now
     where c.enrollment_id=v_code.enrollment_id;
    return jsonb_build_object('ok',false,'reason','invalid','enrollment_id',v_code.enrollment_id);
  end if;

  for v_replaced_id in
    update public.device_auth_credentials dc
       set revoked_at=v_now,revoked_reason='replaced_by_new_enrollment'
     where dc.device_id=p_device_id and dc.revoked_at is null
     returning dc.credential_id
  loop
    v_replaced_ids:=array_append(v_replaced_ids,v_replaced_id);
  end loop;

  insert into public.device_auth_credentials(
    credential_id,device_id,token_hash,device_label,user_agent_hash,
    created_ip_hash,expires_at,metadata_json
  ) values (
    p_credential_id,p_device_id,p_token_hash,nullif(left(coalesce(p_device_label,''),160),''),
    p_user_agent_hash,p_ip_hash,p_expires_at,coalesce(p_metadata_json,'{}'::jsonb)
  ) returning * into v_credential;

  insert into public.custodial_device_credential_replacements(
    device_id,predecessor_credential_id,successor_credential_id,enrollment_id,
    replaced_at,replaced_by,metadata_json
  )
  select p_device_id,replaced_id,p_credential_id,v_code.enrollment_id,v_now,
    v_code.created_by,jsonb_build_object('enrollment_flow',coalesce(p_metadata_json->>'enrollment_flow','enrollment'))
  from unnest(v_replaced_ids) replaced_id;

  update public.device_auth_enrollment_codes c
     set consumed_at=v_now,consumed_by_credential_id=p_credential_id,use_count=1,status='used'
   where c.enrollment_id=v_code.enrollment_id;

  return jsonb_build_object(
    'ok',true,'enrollment_id',v_code.enrollment_id,'credential_id',v_credential.credential_id,
    'expires_at',v_credential.expires_at,'replaced_credential_count',cardinality(v_replaced_ids)
  );
end
$function$;

revoke all on function public.device_auth_consume_enrollment_code(uuid,text,uuid,text,text,timestamptz,text,text,jsonb)
  from public,anon,authenticated;
grant execute on function public.device_auth_consume_enrollment_code(uuid,text,uuid,text,text,timestamptz,text,text,jsonb)
  to postgres,service_role;

-- Reconstruct any exact historical replacement edges already durably proven
-- by an enrollment consumption and the predecessor revocation timestamp.
insert into public.custodial_device_credential_replacements(
  device_id,predecessor_credential_id,successor_credential_id,enrollment_id,
  replaced_at,replaced_by,metadata_json
)
select predecessor.device_id,predecessor.credential_id,successor.credential_id,enrollment.enrollment_id,
  predecessor.revoked_at,enrollment.created_by,jsonb_build_object('backfilled_from_exact_enrollment_receipt',true)
from public.device_auth_credentials predecessor
join public.device_auth_enrollment_codes enrollment
  on enrollment.device_id=predecessor.device_id
 and enrollment.consumed_at=predecessor.revoked_at
 and enrollment.consumed_by_credential_id is not null
join public.device_auth_credentials successor
  on successor.credential_id=enrollment.consumed_by_credential_id
 and successor.device_id=predecessor.device_id
where predecessor.revoked_reason='replaced_by_new_enrollment'
  and predecessor.credential_id<>successor.credential_id
on conflict(predecessor_credential_id,successor_credential_id) do nothing;

-- The current Android recovery route uses the resumable enrollment operation.
-- Patch that independently-owned writer as well so it records the same exact
-- predecessor lineage in the same transaction that revokes the predecessor
-- and creates the successor.
do $patch_resumable_enrollment_successor_lineage$
declare v_definition text; v_next text;
begin
  v_definition:=pg_get_functiondef('public.device_auth_consume_enrollment_operation(uuid,text,uuid,text,text,uuid,text,text,timestamp with time zone,text,text,text,timestamp with time zone,text,text,text,jsonb)'::regprocedure);
  v_next:=replace(v_definition,
$old$  v_failed_attempts integer;
$old$,
$new$  v_failed_attempts integer;
  v_replaced_id uuid;
  v_replaced_ids uuid[]:=array[]::uuid[];
$new$);
  if v_next=v_definition then raise exception 'resumable enrollment declaration patch point was not found'; end if;
  v_definition:=v_next;
  v_next:=replace(v_definition,
$old$  update public.device_auth_credentials
     set revoked_at=v_now,revoked_reason='re_enrolled'
   where device_id=p_device_id and revoked_at is null;
$old$,
$new$  for v_replaced_id in
    update public.device_auth_credentials
       set revoked_at=v_now,revoked_reason='re_enrolled'
     where device_id=p_device_id and revoked_at is null
     returning credential_id
  loop
    v_replaced_ids:=array_append(v_replaced_ids,v_replaced_id);
  end loop;
$new$);
  if v_next=v_definition then raise exception 'resumable enrollment predecessor capture patch point was not found'; end if;
  v_definition:=v_next;
  v_next:=replace(v_definition,
$old$  ) returning * into v_credential;

  update public.device_auth_enrollment_codes
$old$,
$new$  ) returning * into v_credential;

  insert into public.custodial_device_credential_replacements(
    device_id,predecessor_credential_id,successor_credential_id,enrollment_id,
    replaced_at,replaced_by,metadata_json
  )
  select p_device_id,replaced_id,p_credential_id,v_code.enrollment_id,v_now,
    v_code.created_by,jsonb_build_object('enrollment_flow',p_flow,'resumable_operation_id',p_operation_id)
  from unnest(v_replaced_ids) replaced_id;

  update public.device_auth_enrollment_codes
$new$);
  if v_next=v_definition then raise exception 'resumable enrollment lineage insert patch point was not found'; end if;
  execute v_next;
end
$patch_resumable_enrollment_successor_lineage$;

-- Reconstruct exact resumable-operation edges for deployments that already
-- consumed a manager code before this migration. The shared consumed_at and
-- predecessor revoked_at timestamp is the durable transaction receipt.
insert into public.custodial_device_credential_replacements(
  device_id,predecessor_credential_id,successor_credential_id,enrollment_id,
  replaced_at,replaced_by,metadata_json
)
select predecessor.device_id,predecessor.credential_id,successor.credential_id,enrollment.enrollment_id,
  predecessor.revoked_at,enrollment.created_by,
  jsonb_build_object('backfilled_from_exact_enrollment_receipt',true,'enrollment_flow',operation.flow,
    'resumable_operation_id',operation.operation_id)
from public.device_auth_credentials predecessor
join public.device_auth_enrollment_codes enrollment
  on enrollment.device_id=predecessor.device_id
 and enrollment.consumed_at=predecessor.revoked_at
 and enrollment.consumed_by_credential_id is not null
join public.device_auth_credentials successor
  on successor.credential_id=enrollment.consumed_by_credential_id
 and successor.device_id=predecessor.device_id
join public.device_auth_enrollment_operations operation
  on operation.enrollment_id=enrollment.enrollment_id
 and operation.credential_id=successor.credential_id
where predecessor.revoked_reason='re_enrolled'
  and predecessor.credential_id<>successor.credential_id
on conflict(predecessor_credential_id,successor_credential_id) do nothing;

-- A manager-enrolled successor may transmit a frozen snapshot. The snapshot
-- credential remains the context credential and fingerprint identity.
do $patch_offline_start_successor_lineage$
declare v_definition text; v_next text;
begin
  v_definition:=pg_get_functiondef('public.custodial_start_offline_occurrence(text,text,text,text,text,text,integer,text,text,text)'::regprocedure);
  v_next:=replace(v_definition,' or v_snapshot_credential_id<>v_credential_id','');
  if v_next=v_definition then raise exception 'offline start exact-credential precheck was not found'; end if;
  v_definition:=v_next;
  v_next:=replace(v_definition,'or v_existing.credential_id<>v_credential_id or v_existing.canonical_location_code',
    'or not public.custodial_credential_may_transmit_frozen_work(v_existing.credential_id,v_credential_id,v_existing.device_id) or v_existing.canonical_location_code');
  if v_next=v_definition then raise exception 'offline start replay credential predicate was not found'; end if;
  v_definition:=v_next;
  v_next:=replace(v_definition,'or v_snapshot.credential_id<>v_snapshot_credential_id or v_started_at>=v_snapshot.expires_at',
    'or v_snapshot.credential_id<>v_snapshot_credential_id or not public.custodial_credential_may_transmit_frozen_work(v_snapshot.credential_id,v_credential_id,v_snapshot.device_id) or v_started_at>=v_snapshot.expires_at');
  if v_next=v_definition then raise exception 'offline start snapshot lineage predicate was not found'; end if;
  v_definition:=v_next;
  v_next:=replace(v_definition,'join public.device_auth_credentials c on c.credential_id=v_credential_id and c.device_id=d.id',
    'join public.device_auth_credentials c on c.credential_id=v_snapshot_credential_id and c.device_id=d.id');
  if v_next=v_definition then raise exception 'offline start historical credential lookup was not found'; end if;
  v_definition:=v_next;
  v_next:=replace(v_definition,'''credential_id'',v_credential_id::text','''credential_id'',v_snapshot_credential_id::text');
  if v_next=v_definition then raise exception 'offline start fingerprint credential was not found'; end if;
  v_definition:=v_next;
  v_next:=replace(v_definition,
    'values(v_client_session_id,v_snapshot.device_id,v_snapshot.employee_id,v_credential_id,v_snapshot.assignment_epoch',
    'values(v_client_session_id,v_snapshot.device_id,v_snapshot.employee_id,v_snapshot_credential_id,v_snapshot.assignment_epoch');
  if v_next=v_definition then raise exception 'offline start context credential insert was not found'; end if;
  execute v_next;
end
$patch_offline_start_successor_lineage$;

-- Gate the authenticated transport credential before exact replay handling so
-- an unrelated credential cannot recover even a byte-identical result.
do $patch_offline_completion_successor_lineage$
declare v_definition text; v_next text;
begin
  v_definition:=pg_get_functiondef('public.custodial_commit_offline_occurrence(text,text,text,text,text,text,jsonb,jsonb,text,text,text,text,text)'::regprocedure);
  v_next:=replace(v_definition,
$old$  v_payload_fingerprint := public.custodial_offline_payload_fingerprint$old$,
$new$  if not public.custodial_credential_may_transmit_frozen_work(v_context.credential_id,v_credential_id,v_context.device_id) then
    return public.custodial_quarantine_offline_submission(v_client_session_id,v_client_completion_id,v_context.context_id,null,
      jsonb_build_object('response_json',p_response_json,'scan_evidence',p_scan_evidence),'context_binding_mismatch','{}'::jsonb,p_backend_execution_secret);
  end if;
  v_payload_fingerprint := public.custodial_offline_payload_fingerprint$new$);
  if v_next=v_definition then raise exception 'offline completion pre-replay credential gate was not inserted'; end if;
  v_definition:=v_next;
  v_next:=replace(v_definition,' or v_context.credential_id<>v_credential_id or v_context.started_at<>v_started_at',
    ' or v_context.started_at<>v_started_at');
  if v_next=v_definition then raise exception 'offline completion exact-credential predicate was not found'; end if;
  execute v_next;
end
$patch_offline_completion_successor_lineage$;

-- Recovery must restore the new immutable lineage and the exact corrected
-- canonical function bodies. Incrementally capture this surface using the
-- existing reviewed renderers instead of leaving release health stale.
alter table public.custodial_release_authority_restore_inventory
  disable trigger trg_custodial_release_authority_restore_inventory_immutable;

do $capture_credential_recovery_functions$
declare identity text; definition text; next_order integer;
begin
  foreach identity in array array[
    'public.custodial_reject_device_credential_replacement_update_delete()',
    'public.custodial_credential_may_transmit_frozen_work(uuid,uuid,uuid,timestamp with time zone)',
    'public.device_auth_consume_enrollment_code(uuid,text,uuid,text,text,timestamp with time zone,text,text,jsonb)',
    'public.device_auth_consume_enrollment_operation(uuid,text,uuid,text,text,uuid,text,text,timestamp with time zone,text,text,text,timestamp with time zone,text,text,text,jsonb)',
    'public.custodial_start_offline_occurrence(text,text,text,text,text,text,integer,text,text,text)',
    'public.custodial_commit_offline_occurrence(text,text,text,text,text,text,jsonb,jsonb,text,text,text,text,text)'
  ] loop
    definition:=pg_get_functiondef(to_regprocedure(identity));
    if definition is null then raise exception 'required credential-recovery function % is missing',identity; end if;
    if exists(
      select 1 from public.custodial_release_authority_restore_inventory
      where object_kind='function' and object_identity=to_regprocedure(identity)::text
    ) then
      update public.custodial_release_authority_restore_inventory
         set definition_sql=definition,
             definition_sha256=encode(extensions.digest(convert_to(definition,'UTF8'),'sha256'),'hex'),
             captured_at=statement_timestamp()
       where object_kind='function' and object_identity=to_regprocedure(identity)::text;
    else
      select coalesce(max(restore_order),100000)+1 into next_order
      from public.custodial_release_authority_restore_inventory where object_kind='function';
      insert into public.custodial_release_authority_restore_inventory(
        restore_order,object_kind,object_identity,definition_sql,definition_sha256
      ) values (
        next_order,'function',to_regprocedure(identity)::text,definition,
        encode(extensions.digest(convert_to(definition,'UTF8'),'sha256'),'hex')
      );
    end if;
  end loop;
end
$capture_credential_recovery_functions$;

do $capture_credential_recovery_relation$
declare
  relation_identity text:='public.custodial_device_credential_replacements';
  object_identity text;
  definition text;
  next_order integer;
  row_data record;
begin
  definition:=public.custodial_release_authority_current_relation_definition(relation_identity);
  select coalesce(max(restore_order),1000)+1 into next_order
  from public.custodial_release_authority_restore_inventory where object_kind='relation';
  insert into public.custodial_release_authority_restore_inventory(
    restore_order,object_kind,object_identity,definition_sql,definition_sha256
  ) values (
    next_order,'relation',relation_identity,definition,
    encode(extensions.digest(convert_to(definition,'UTF8'),'sha256'),'hex')
  );

  for row_data in
    select a.attname
    from pg_attribute a
    where a.attrelid=relation_identity::regclass and a.attnum>0 and not a.attisdropped
    order by a.attnum
  loop
    object_identity:=relation_identity||':'||row_data.attname;
    definition:=public.custodial_release_authority_current_column_definition(object_identity);
    select coalesce(max(restore_order),200000)+1 into next_order
    from public.custodial_release_authority_restore_inventory where object_kind='column';
    insert into public.custodial_release_authority_restore_inventory(
      restore_order,object_kind,object_identity,definition_sql,definition_sha256
    ) values (next_order,'column',object_identity,definition,
      encode(extensions.digest(convert_to(definition,'UTF8'),'sha256'),'hex'));
  end loop;

  definition:=public.custodial_release_authority_current_column_set_definition(relation_identity);
  select coalesce(max(restore_order),300000)+1 into next_order
  from public.custodial_release_authority_restore_inventory where object_kind='column_set';
  insert into public.custodial_release_authority_restore_inventory(
    restore_order,object_kind,object_identity,definition_sql,definition_sha256
  ) values (next_order,'column_set',relation_identity,definition,
    encode(extensions.digest(convert_to(definition,'UTF8'),'sha256'),'hex'));

  definition:=public.custodial_release_authority_current_relation_state_definition(relation_identity);
  select coalesce(max(restore_order),400000)+1 into next_order
  from public.custodial_release_authority_restore_inventory where object_kind='relation_state';
  insert into public.custodial_release_authority_restore_inventory(
    restore_order,object_kind,object_identity,definition_sql,definition_sha256
  ) values (next_order,'relation_state',relation_identity,definition,
    encode(extensions.digest(convert_to(definition,'UTF8'),'sha256'),'hex'));

  for row_data in
    select c.conname
    from pg_constraint c where c.conrelid=relation_identity::regclass
    order by case c.contype when 'p' then 1 when 'u' then 2 when 'f' then 3 else 4 end,c.conname
  loop
    object_identity:=relation_identity||':'||row_data.conname;
    definition:=public.custodial_release_authority_current_constraint_definition(object_identity);
    select coalesce(max(restore_order),500000)+1 into next_order
    from public.custodial_release_authority_restore_inventory where object_kind='constraint';
    insert into public.custodial_release_authority_restore_inventory(
      restore_order,object_kind,object_identity,definition_sql,definition_sha256
    ) values (next_order,'constraint',object_identity,definition,
      encode(extensions.digest(convert_to(definition,'UTF8'),'sha256'),'hex'));
  end loop;

  for row_data in
    select quote_ident(n.nspname)||'.'||quote_ident(i.relname) index_identity
    from pg_index ix
    join pg_class i on i.oid=ix.indexrelid
    join pg_namespace n on n.oid=i.relnamespace
    where ix.indrelid=relation_identity::regclass
      and not exists(select 1 from pg_constraint c where c.conindid=ix.indexrelid)
    order by i.relname
  loop
    object_identity:=row_data.index_identity;
    definition:=public.custodial_release_authority_current_index_definition(object_identity);
    select coalesce(max(restore_order),600000)+1 into next_order
    from public.custodial_release_authority_restore_inventory where object_kind='index';
    insert into public.custodial_release_authority_restore_inventory(
      restore_order,object_kind,object_identity,definition_sql,definition_sha256
    ) values (next_order,'index',object_identity,definition,
      encode(extensions.digest(convert_to(definition,'UTF8'),'sha256'),'hex'));
  end loop;

  select relation_identity||'.'||quote_ident(t.tgname),
    'drop trigger if exists '||quote_ident(t.tgname)||' on '||relation_identity||'; '
      ||pg_get_triggerdef(t.oid,true)||'; alter table '||relation_identity||' '
      ||case t.tgenabled when 'O' then 'enable' when 'D' then 'disable'
          when 'R' then 'enable replica' when 'A' then 'enable always' end
      ||' trigger '||quote_ident(t.tgname)||';'
    into object_identity,definition
  from pg_trigger t
  where t.tgrelid=relation_identity::regclass and not t.tgisinternal;
  select coalesce(max(restore_order),700000)+1 into next_order
  from public.custodial_release_authority_restore_inventory where object_kind='trigger';
  insert into public.custodial_release_authority_restore_inventory(
    restore_order,object_kind,object_identity,definition_sql,definition_sha256
  ) values (next_order,'trigger',object_identity,definition,
    encode(extensions.digest(convert_to(definition,'UTF8'),'sha256'),'hex'));

  definition:=public.custodial_release_authority_current_grant_definition(relation_identity);
  select coalesce(max(restore_order),900000)+1 into next_order
  from public.custodial_release_authority_restore_inventory where object_kind='grant';
  insert into public.custodial_release_authority_restore_inventory(
    restore_order,object_kind,object_identity,definition_sql,definition_sha256
  ) values (next_order,'grant',relation_identity,definition,
    encode(extensions.digest(convert_to(definition,'UTF8'),'sha256'),'hex'));
end
$capture_credential_recovery_relation$;

alter table public.custodial_release_authority_restore_inventory
  enable trigger trg_custodial_release_authority_restore_inventory_immutable;

do $credential_recovery_postflight$
begin
  if exists(
    select 1 from public.custodial_release_authority_restore_inventory
    where definition_sha256<>encode(extensions.digest(convert_to(definition_sql,'UTF8'),'sha256'),'hex')
  ) then raise exception 'credential recovery release inventory digest mismatch'; end if;
  if (select count(*) from public.custodial_release_authority_restore_inventory
      where object_identity like '%custodial_device_credential_replacements%')<15 then
    raise exception 'credential replacement recovery surface is incomplete';
  end if;
  if has_table_privilege('service_role','public.custodial_device_credential_replacements','INSERT')
     or has_table_privilege('service_role','public.custodial_device_credential_replacements','UPDATE')
     or has_table_privilege('service_role','public.custodial_device_credential_replacements','DELETE') then
    raise exception 'service role has direct credential replacement lineage mutation authority';
  end if;
end
$credential_recovery_postflight$;

commit;
