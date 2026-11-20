-- H04 durable terminal range/target primitives. Owner-private until mutation
-- integration and the merged schedule/terminal HTTP/native path are complete.
-- Nothing here grants an employee RPC, advances confirmation to ACCEPTED,
-- invalidates from a trigger, or claims a disconnected phone learned a change.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

create table public.static_weekly_recurring_invalidations (
 invalidation_id uuid primary key default gen_random_uuid(),
 operation_id uuid not null unique,
 publication_id uuid not null references public.static_weekly_recurring_publication_bindings(publication_id) on delete restrict,
 effective_start date not null,
 effective_end date,
 authority_revision bigint not null unique references public.weekly_schedule_authority_revisions(authority_revision) on delete restrict,
 reason_code text not null check(reason_code in ('ROSTER_DEPENDENCY_CHANGED','SOURCE_RETIRED','RESTRICTION_DEPENDENCY_CHANGED')),
 dependency_digest text not null check(dependency_digest~'^[0-9a-f]{64}$'),
 actor_manager_id uuid not null references public.ops_manager_managers(manager_id) on delete restrict,
 request_json jsonb not null,
 request_digest text not null check(request_digest~'^[0-9a-f]{64}$'),
 created_at timestamptz not null default statement_timestamp(),
 check(isfinite(effective_start) and (effective_end is null or (isfinite(effective_end) and effective_end>effective_start)))
);
create index static_weekly_recurring_invalidations_range
 on public.static_weekly_recurring_invalidations(publication_id,effective_start,authority_revision desc);
create table public.static_weekly_recurring_invalidated_principals (
 invalidation_id uuid not null references public.static_weekly_recurring_invalidations(invalidation_id) on delete restrict,
 employee_id uuid not null references public.employees(id) on delete restrict,
 created_at timestamptz not null default statement_timestamp(),
 primary key(invalidation_id,employee_id)
);
create index static_weekly_recurring_invalidated_principals_employee
 on public.static_weekly_recurring_invalidated_principals(employee_id,invalidation_id);
create table public.static_weekly_recurring_terminal_intents (
 intent_id uuid primary key default gen_random_uuid(),
 invalidation_id uuid not null references public.static_weekly_recurring_invalidations(invalidation_id) on delete restrict,
 service_date date not null check(isfinite(service_date)),
 employee_id uuid not null references public.employees(id) on delete restrict,
 device_id uuid references public.devices(id) on delete restrict,
 credential_id uuid references public.device_auth_credentials(credential_id) on delete restrict,
 assignment_epoch bigint check(assignment_epoch between 1 and 9007199254740991),
 authority_revision bigint not null references public.weekly_schedule_authority_revisions(authority_revision) on delete restrict,
 target_json jsonb not null,
 target_digest text not null check(target_digest~'^[0-9a-f]{64}$'),
 created_at timestamptz not null default statement_timestamp(),
 check((device_id is null and credential_id is null and assignment_epoch is null)
  or (device_id is not null and credential_id is not null and assignment_epoch is not null)),
 unique nulls not distinct(invalidation_id,service_date,employee_id,device_id,credential_id,assignment_epoch),
 foreign key(invalidation_id,employee_id) references public.static_weekly_recurring_invalidated_principals(invalidation_id,employee_id) on delete restrict
);
create index static_weekly_recurring_terminal_intents_principal
 on public.static_weekly_recurring_terminal_intents(device_id,assignment_epoch,employee_id,service_date,authority_revision desc);
create index static_weekly_recurring_terminal_intents_credential
 on public.static_weekly_recurring_terminal_intents(credential_id) where credential_id is not null;
create index static_weekly_recurring_terminal_intents_revision
 on public.static_weekly_recurring_terminal_intents(authority_revision);
create table public.static_weekly_recurring_terminal_receipts (
 intent_id uuid primary key references public.static_weekly_recurring_terminal_intents(intent_id) on delete restrict,
 receipt_id uuid not null unique default gen_random_uuid(),
 rendered_digest text not null check(rendered_digest~'^[0-9a-f]{64}$'),
 applied_at timestamptz not null,
 received_at timestamptz not null default statement_timestamp()
);
do $tables$
declare t text;
begin
 foreach t in array array['static_weekly_recurring_invalidations','static_weekly_recurring_invalidated_principals',
  'static_weekly_recurring_terminal_intents','static_weekly_recurring_terminal_receipts'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('alter table public.%I force row level security',t);
  execute format('revoke all on table public.%I from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader',t);
  execute format('create trigger trg_recurring_terminal_immutable before update or delete on public.%I for each row execute function public.static_weekly_reject_update_delete()',t);
 end loop;
end
$tables$;
do $operation$
declare c record;
begin
 select con.conname,pg_get_expr(con.conbin,con.conrelid) expression into strict c
 from pg_constraint con join pg_attribute a on a.attrelid=con.conrelid and a.attnum=any(con.conkey)
 where con.conrelid='public.weekly_schedule_authority_revisions'::regclass and con.contype='c' and a.attname='operation';
 execute format('alter table public.weekly_schedule_authority_revisions drop constraint %I',c.conname);
 execute format('alter table public.weekly_schedule_authority_revisions add constraint %I check((%s) or operation=''invalidate_recurring'')',c.conname,c.expression);
end
$operation$;

create function public.static_weekly_v19_current_terminal_range(p_service_date date)
returns public.static_weekly_recurring_invalidations language sql stable security definer set search_path=pg_catalog,public as $function$
 select i from public.v_weekly_schedule_effective_ranges r
 join public.weekly_schedule_publications p on p.version_id=r.version_id
 join public.static_weekly_recurring_invalidations i on i.publication_id=p.publication_id
 where r.effective_start<=p_service_date and (r.effective_end is null or p_service_date<r.effective_end)
  and i.effective_start<=p_service_date and (i.effective_end is null or p_service_date<i.effective_end)
 order by i.authority_revision desc limit 1
$function$;

-- Reconciliation is deliberately bounded to ONE requested date. Called for
-- already materialized dates during invalidation and later by the existing
-- materialization/reconnect lifecycle; never expand an infinite calendar.
create function public.static_weekly_v19_reconcile_terminal_date(p_service_date date)
returns integer language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_range public.static_weekly_recurring_invalidations%rowtype;person record;device record;
 v_target jsonb;v_intent uuid;v_count int:=0;v_has_device boolean;
begin
 if p_service_date is null or not isfinite(p_service_date) then raise exception 'terminal target requires one finite service date';end if;
 perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 v_range:=public.static_weekly_v19_current_terminal_range(p_service_date);
 if v_range.invalidation_id is null then return 0;end if;
 -- Capture currently incumbent people too: filling a position or assigning a
 -- first phone must not make an invalid recurring pattern look usable.
 insert into public.static_weekly_recurring_invalidated_principals(invalidation_id,employee_id)
 select distinct v_range.invalidation_id,r.person_id from public.static_weekly_recurring_publication_bindings b
 cross join lateral jsonb_array_elements(b.dependency_snapshot->'slots') s
 join public.v_weekly_roster_slot_incumbency_ranges r on r.slot_id=(s->>'slotId')::uuid
  and r.effective_start<=p_service_date and (r.effective_end is null or p_service_date<r.effective_end)
 join public.employees e on e.id=r.person_id where b.publication_id=v_range.publication_id
 on conflict do nothing;
 for person in select employee_id from public.static_weekly_recurring_invalidated_principals
  where invalidation_id=v_range.invalidation_id order by employee_id loop
  v_has_device:=false;
  for device in select d.id,c.credential_id,d.assignment_epoch from public.devices d
   join public.device_auth_credentials c on c.device_id=d.id and c.confirmed_at is not null
    and c.revoked_at is null and c.expires_at>statement_timestamp()
   where d.active=true and d.assigned_employee_id=person.employee_id order by d.id,c.credential_id loop
   v_has_device:=true;
   v_target:=jsonb_build_object('schema','static-weekly.recurring-terminal-target.v1',
    'targetType','BLOCKED_RECURRING_AUTHORITY','invalidationId',v_range.invalidation_id,
    'operationId',v_range.operation_id,'publicationId',v_range.publication_id,'serviceDate',p_service_date,
    'authorityRevision',v_range.authority_revision,'reasonCode',v_range.reason_code,
    'employeeId',person.employee_id,'deviceId',device.id,'credentialId',device.credential_id,'assignmentEpoch',device.assignment_epoch);
   insert into public.static_weekly_recurring_terminal_intents(invalidation_id,service_date,employee_id,
    device_id,credential_id,assignment_epoch,authority_revision,target_json,target_digest)
   values(v_range.invalidation_id,p_service_date,person.employee_id,device.id,device.credential_id,device.assignment_epoch,
    v_range.authority_revision,v_target,public.static_weekly_digest_jsonb(v_target)) on conflict do nothing returning intent_id into v_intent;
   if found then v_count:=v_count+1;end if;
  end loop;
  if not v_has_device then
   v_target:=jsonb_build_object('schema','static-weekly.recurring-terminal-target.v1',
    'targetType','BLOCKED_RECURRING_AUTHORITY','invalidationId',v_range.invalidation_id,
    'operationId',v_range.operation_id,'publicationId',v_range.publication_id,'serviceDate',p_service_date,
    'authorityRevision',v_range.authority_revision,'reasonCode',v_range.reason_code,
    'employeeId',person.employee_id,'deviceId',null,'credentialId',null,'assignmentEpoch',null);
   insert into public.static_weekly_recurring_terminal_intents(invalidation_id,service_date,employee_id,
    authority_revision,target_json,target_digest)
   values(v_range.invalidation_id,p_service_date,person.employee_id,v_range.authority_revision,
    v_target,public.static_weekly_digest_jsonb(v_target)) on conflict do nothing returning intent_id into v_intent;
   if found then v_count:=v_count+1;end if;
  end if;
 end loop;
 return v_count;
end
$function$;

create function public.static_weekly_v19_invalidate_recurring_range(p_manager_id uuid,p_operation_id uuid,
 p_publication_id uuid,p_start date,p_end date,p_reason text,p_dependency_digest text,p_expected_revision bigint)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_actor jsonb;v_request jsonb;v_prior public.static_weekly_recurring_invalidations%rowtype;
 v_binding public.static_weekly_recurring_publication_bindings%rowtype;v_revision bigint;v_id uuid:=gen_random_uuid();
 v_weekday date;v_count int:=0;
begin
 perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 v_actor:=public.static_weekly_v3_manager_actor(p_manager_id);
 v_request:=jsonb_build_object('managerId',p_manager_id,'operationId',p_operation_id,'publicationId',p_publication_id,
  'start',p_start,'end',p_end,'reason',p_reason,'dependencyDigest',p_dependency_digest,'expectedRevision',p_expected_revision);
 select * into v_prior from public.static_weekly_recurring_invalidations where operation_id=p_operation_id;
 if found then
  if v_prior.request_json is distinct from v_request then raise exception using errcode='23505',message='recurring invalidation operation already binds a different request';end if;
  return jsonb_build_object('invalidationId',v_prior.invalidation_id,'authorityRevision',v_prior.authority_revision,'state','BLOCKED_RECURRING_AUTHORITY','replayed',true);
 end if;
 select * into v_binding from public.static_weekly_recurring_publication_bindings where publication_id=p_publication_id;
 if p_operation_id is null or v_binding.publication_id is null or p_start is null or not isfinite(p_start)
  or p_start<=public.sch_service_date(statement_timestamp())
  or p_start<v_binding.effective_start or (p_end is not null and (not isfinite(p_end) or p_end<=p_start))
  or p_reason is null or p_reason not in ('ROSTER_DEPENDENCY_CHANGED','SOURCE_RETIRED','RESTRICTION_DEPENDENCY_CHANGED')
  or p_dependency_digest is null or p_dependency_digest!~'^[0-9a-f]{64}$'
  or not exists(select 1 from public.v_weekly_schedule_effective_ranges r join public.weekly_schedule_publications p using(version_id)
   where p.publication_id=p_publication_id and r.effective_start<=p_start
    and (r.effective_end is null or (p_start<r.effective_end and p_end is not null and p_end<=r.effective_end))) then
  raise exception using errcode='23514',message='recurring invalidation requires the exact latest winner and an affected future range';end if;
 v_revision:=public.static_weekly_advance_authority(p_expected_revision,'invalidate_recurring',p_manager_id,
  v_actor->>'manager_name',p_operation_id,public.static_weekly_digest_jsonb(v_request));
 insert into public.static_weekly_recurring_invalidations(invalidation_id,operation_id,publication_id,effective_start,effective_end,
  authority_revision,reason_code,dependency_digest,actor_manager_id,request_json,request_digest)
 values(v_id,p_operation_id,p_publication_id,p_start,p_end,v_revision,p_reason,p_dependency_digest,p_manager_id,v_request,public.static_weekly_digest_jsonb(v_request));
 insert into public.static_weekly_recurring_invalidated_principals(invalidation_id,employee_id)
 select distinct v_id,(r->>'personId')::uuid from jsonb_array_elements(v_binding.dependency_snapshot->'roster') r
 join public.employees e on e.id=(r->>'personId')::uuid where r->>'personId' is not null;
 -- All known materialized weeks, not just the first seven days. The persistent
 -- range plus principals also covers dates/phones not materialized yet.
 for v_weekday in select distinct x.week_start+n from public.weekly_schedule_compiled_projections x
  cross join generate_series(0,6) n where x.publication_id=p_publication_id
   and x.week_start+n>=p_start and (p_end is null or x.week_start+n<p_end) order by 1 loop
  v_count:=v_count+public.static_weekly_v19_reconcile_terminal_date(v_weekday);
 end loop;
 return jsonb_build_object('invalidationId',v_id,'authorityRevision',v_revision,
  'state','BLOCKED_RECURRING_AUTHORITY','targetsCreated',v_count,'affectedPhonesUpdated',false,'replayed',false);
end
$function$;

create function public.static_weekly_v19_assert_terminal_principal(p_device uuid,p_credential uuid,p_employee uuid,p_epoch bigint)
returns void language plpgsql stable security definer set search_path=pg_catalog,public as $function$
begin
 if p_device is null or p_credential is null or p_employee is null or p_epoch is null or p_epoch<1
  or not exists(select 1 from public.devices d join public.device_auth_credentials c on c.device_id=d.id
   where d.id=p_device and d.active=true and d.assigned_employee_id=p_employee and d.assignment_epoch=p_epoch
    and c.credential_id=p_credential and c.confirmed_at is not null and c.revoked_at is null and c.expires_at>statement_timestamp()) then
  raise exception using errcode='42501',message='exact current terminal schedule principal is required';end if;
end
$function$;
create function public.static_weekly_v19_read_terminal_target(p_date date,p_device uuid,p_credential uuid,p_employee uuid,p_epoch bigint)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $function$
declare r public.static_weekly_recurring_invalidations%rowtype;t public.static_weekly_recurring_terminal_intents%rowtype;
 ack public.static_weekly_recurring_terminal_receipts%rowtype;
begin
 if p_date is null or not isfinite(p_date) then raise exception 'terminal read requires one finite service date';end if;
 perform public.static_weekly_v19_assert_terminal_principal(p_device,p_credential,p_employee,p_epoch);
 r:=public.static_weekly_v19_current_terminal_range(p_date);if r.invalidation_id is null then return null;end if;
 select * into t from public.static_weekly_recurring_terminal_intents where invalidation_id=r.invalidation_id
  and service_date=p_date and employee_id=p_employee and device_id=p_device and credential_id=p_credential and assignment_epoch=p_epoch;
 if not found then return jsonb_build_object('targetType','BLOCKED_RECURRING_AUTHORITY','authorityRevision',r.authority_revision,
  'publicationId',r.publication_id,'invalidationId',r.invalidation_id,'applicationStatus','PENDING_TARGET_RECONCILIATION');end if;
 select * into ack from public.static_weekly_recurring_terminal_receipts where intent_id=t.intent_id;
 return jsonb_build_object('intentId',t.intent_id,'target',t.target_json,'targetDigest',t.target_digest,
  'applicationStatus',case when ack.intent_id is null then 'PENDING' else 'DEVICE_REPORTED_BLOCKED' end,
  'appliedAt',ack.applied_at,'receivedAt',ack.received_at,'replacementCoverageReady',false);
end
$function$;
create function public.static_weekly_v19_ack_terminal_target(p_intent uuid,p_device uuid,p_credential uuid,p_employee uuid,p_epoch bigint,
 p_revision bigint,p_rendered_digest text,p_applied_at timestamptz)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare t public.static_weekly_recurring_terminal_intents%rowtype;a public.static_weekly_recurring_terminal_receipts%rowtype;
begin
 perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 perform public.static_weekly_v19_assert_terminal_principal(p_device,p_credential,p_employee,p_epoch);
 select * into t from public.static_weekly_recurring_terminal_intents where intent_id=p_intent;
 if not found or t.device_id is distinct from p_device or t.credential_id is distinct from p_credential
  or t.employee_id is distinct from p_employee or t.assignment_epoch is distinct from p_epoch
  or t.authority_revision is distinct from p_revision or t.target_digest is distinct from p_rendered_digest
  or p_applied_at is null or not isfinite(p_applied_at) or p_applied_at<t.created_at
  or p_applied_at>statement_timestamp()+interval '5 minutes' then
  raise exception using errcode='23514',message='terminal receipt must match exact principal target revision digest and time';end if;
 select * into a from public.static_weekly_recurring_terminal_receipts where intent_id=p_intent;
 if found then
  if a.rendered_digest is distinct from p_rendered_digest or a.applied_at is distinct from p_applied_at then
   raise exception using errcode='23505',message='terminal target already has a different receipt';end if;
 else
  insert into public.static_weekly_recurring_terminal_receipts(intent_id,rendered_digest,applied_at)
  values(p_intent,p_rendered_digest,p_applied_at) returning * into a;
 end if;
 -- An old exact receipt is retained history only. Selection always consults
 -- the latest winner/range, so this cannot acknowledge a later invalidation.
 return jsonb_build_object('intentId',a.intent_id,'receiptId',a.receipt_id,'applicationStatus','DEVICE_REPORTED_BLOCKED',
  'replacementCoverageReady',false,'receivedAt',a.received_at);
end
$function$;
do $private$
declare p record;
begin
 for p in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace and proname like 'static_weekly_v19_%' loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader',p.signature);
 end loop;
end
$private$;

-- Exact recovery inventory is completed below before commit.
do $surface$
declare v_definition text;v_rows text;v_seam text:='  values';
begin
 select string_agg(format('(%L,%L,%L)',kind,identity,'recurring terminal range and phone targets'),E',\n' order by kind,identity)||',' into v_rows
 from (
  select 'relation' kind,'public.'||name identity from unnest(array['static_weekly_recurring_invalidations',
   'static_weekly_recurring_invalidated_principals','static_weekly_recurring_terminal_intents','static_weekly_recurring_terminal_receipts']) name
  union all select 'function','public.'||oid::regprocedure::text from pg_proc where pronamespace='public'::regnamespace and proname like 'static_weekly_v19_%'
  union all select 'trigger','public.'||c.relname||'.'||t.tgname from pg_trigger t join pg_class c on c.oid=t.tgrelid
   where t.tgname='trg_recurring_terminal_immutable'
 ) objects;
 v_definition:=pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure);
 if length(v_definition)-length(replace(v_definition,v_seam,''))<>length(v_seam) then raise exception 'recurring terminal canary seam changed';end if;
 execute replace(v_definition,v_seam,v_seam||E'\n'||v_rows);
end
$surface$;
alter table public.custodial_release_authority_restore_inventory disable trigger trg_custodial_release_authority_restore_inventory_immutable;
do $recovery$
declare obj record;v_order integer;
begin
 for obj in with relations(name) as (values('public.static_weekly_recurring_invalidations'),
  ('public.static_weekly_recurring_invalidated_principals'),('public.static_weekly_recurring_terminal_intents'),
  ('public.static_weekly_recurring_terminal_receipts')),
 funcs as (select oid,'public.'||oid::regprocedure::text identity from pg_proc where pronamespace='public'::regnamespace
  and (proname like 'static_weekly_v19_%' or oid='public.custodial_release_canary_authority_surface()'::regprocedure)),objects as (
  select 1000 bucket,'relation'::text kind,name identity,public.custodial_release_authority_current_relation_definition(name) definition from relations
  union all select 100000,'function',identity,pg_get_functiondef(oid) from funcs
  union all select 200000,'column',r.name||':'||a.attname,public.custodial_release_authority_current_column_definition(r.name||':'||a.attname)
   from relations r join pg_attribute a on a.attrelid=r.name::regclass and a.attnum>0 and not a.attisdropped
  union all select 300000,'column_set',name,public.custodial_release_authority_current_column_set_definition(name) from relations
  union all select 400000,'relation_state',name,public.custodial_release_authority_current_relation_state_definition(name) from relations
  union all select 500000,'constraint',r.name||':'||c.conname,public.custodial_release_authority_current_constraint_definition(r.name||':'||c.conname)
   from relations r join pg_constraint c on c.conrelid=r.name::regclass
  union all select 500000,'constraint','public.weekly_schedule_authority_revisions:'||c.conname,
   public.custodial_release_authority_current_constraint_definition('public.weekly_schedule_authority_revisions:'||c.conname)
   from pg_constraint c where c.conrelid='public.weekly_schedule_authority_revisions'::regclass and c.contype='c'
  union all select 600000,'index','public.'||quote_ident(c.relname),public.custodial_release_authority_current_index_definition('public.'||quote_ident(c.relname))
   from relations r join pg_index i on i.indrelid=r.name::regclass join pg_class c on c.oid=i.indexrelid
   where not exists(select 1 from pg_constraint k where k.conindid=i.indexrelid)
  union all select 700000,'trigger',r.name||'.'||t.tgname,
   'drop trigger if exists '||quote_ident(t.tgname)||' on '||r.name||'; '||pg_get_triggerdef(t.oid,true)||';'
   from relations r join pg_trigger t on t.tgrelid=r.name::regclass and not t.tgisinternal
  union all select 900000,'grant',name,public.custodial_release_authority_current_grant_definition(name) from relations
  union all select 900000,'grant',identity,public.custodial_release_authority_current_grant_definition(identity) from funcs
 ) select * from objects order by bucket,identity loop
  if obj.definition is null then raise exception 'missing recurring terminal recovery object %',obj.identity;end if;
  update public.custodial_release_authority_restore_inventory set definition_sql=obj.definition,
   definition_sha256=public.static_weekly_digest_text(obj.definition),captured_at=statement_timestamp()
   where object_kind=obj.kind and (object_identity=obj.identity or case when obj.kind in ('function','grant')
    and object_identity like '%(%' and obj.identity like '%(%' then to_regprocedure(object_identity)=to_regprocedure(obj.identity) else false end);
  if not found then
   select coalesce(max(restore_order),obj.bucket)+1 into v_order from public.custodial_release_authority_restore_inventory
    where restore_order>=obj.bucket and restore_order<case when obj.bucket=1000 then 100000 else obj.bucket+100000 end;
   insert into public.custodial_release_authority_restore_inventory(restore_order,object_kind,object_identity,definition_sql,definition_sha256)
    values(v_order,obj.kind,obj.identity,obj.definition,public.static_weekly_digest_text(obj.definition));
  end if;
 end loop;
end
$recovery$;
alter table public.custodial_release_authority_restore_inventory enable trigger trg_custodial_release_authority_restore_inventory_immutable;
commit;
