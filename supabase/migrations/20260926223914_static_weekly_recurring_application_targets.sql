-- H03/H04 recurring schedule desired-state primitives. Owner-private until
-- the complete parent finalizer and merged employee transport are wired.
-- These rows alone are NOT delivery, confirmation acceptance or phone proof.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
create table public.static_weekly_recurring_application_intents (
 intent_id uuid primary key default gen_random_uuid(),
 operation_id uuid not null references public.static_weekly_recurring_confirmations(operation_id) on delete restrict,
 publication_id uuid not null references public.static_weekly_recurring_publication_bindings(publication_id) on delete restrict,
 projection_id uuid not null references public.weekly_schedule_compiled_projections(projection_id) on delete restrict,
 service_date date not null check(isfinite(service_date)),
 employee_id uuid not null references public.employees(id) on delete restrict,
 device_id uuid references public.devices(id) on delete restrict,
 credential_id uuid references public.device_auth_credentials(credential_id) on delete restrict,
 assignment_epoch bigint check(assignment_epoch between 1 and 9007199254740991),
 authority_revision bigint not null references public.weekly_schedule_authority_revisions(authority_revision) on delete restrict,
 lunch_document_identity text not null check(lunch_document_identity~'^[0-9a-f]{64}$'),
 view_json jsonb not null check(jsonb_typeof(view_json)='object'),
 view_digest text not null check(view_digest~'^[0-9a-f]{64}$'),
 target_json jsonb not null check(jsonb_typeof(target_json)='object'),
 target_digest text not null check(target_digest~'^[0-9a-f]{64}$'),
 created_at timestamptz not null default statement_timestamp(),
 check((device_id is null and credential_id is null and assignment_epoch is null)
  or (device_id is not null and credential_id is not null and assignment_epoch is not null)),
 unique nulls not distinct(publication_id,projection_id,service_date,employee_id,device_id,credential_id,assignment_epoch,authority_revision)
);
create index static_weekly_recurring_application_principal on public.static_weekly_recurring_application_intents
 (device_id,assignment_epoch,employee_id,service_date,authority_revision desc);
create index static_weekly_recurring_application_operation on public.static_weekly_recurring_application_intents(operation_id,service_date,intent_id);
create index static_weekly_recurring_application_credential on public.static_weekly_recurring_application_intents(credential_id) where credential_id is not null;
create index static_weekly_recurring_application_employee on public.static_weekly_recurring_application_intents(employee_id);
create index static_weekly_recurring_application_revision on public.static_weekly_recurring_application_intents(authority_revision);
create table public.static_weekly_recurring_application_receipts (
 intent_id uuid primary key references public.static_weekly_recurring_application_intents(intent_id) on delete restrict,
 receipt_id uuid not null unique default gen_random_uuid(),
 rendered_digest text not null check(rendered_digest~'^[0-9a-f]{64}$'),
 applied_at timestamptz not null check(isfinite(applied_at)),
 received_at timestamptz not null default statement_timestamp()
);
do $tables$
declare t text;
begin
 foreach t in array array['static_weekly_recurring_application_intents','static_weekly_recurring_application_receipts'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('alter table public.%I force row level security',t);
  execute format('revoke all on table public.%I from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader',t);
  execute format('create trigger trg_recurring_application_immutable before update or delete on public.%I for each row execute function public.static_weekly_reject_update_delete()',t);
 end loop;
end
$tables$;

-- Reuse the established employee-day reader, including its official lunch
-- responsibilities. Only the stable full-day fields enter the digest: phase,
-- current-window flags, observation time and cleaning/check clocks do not.
create function public.static_weekly_v22_recurring_render_view(p_projection uuid,p_date date,p_employee uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $function$
declare a record;d jsonb;
begin
 if p_date is null or not isfinite(p_date) or p_projection is null or p_employee is null then raise exception 'exact recurring render principal date and projection required';end if;
 select * into a from public.static_weekly_v6_schedule_authority_state(p_date);
 if a.projection_status is distinct from 'current' or a.projection_id is distinct from p_projection then
  raise exception using errcode='23514',message='recurring view requires the exact current usable projection';end if;
 d:=public.static_weekly_v5_read_employee_day(p_date,p_employee,(p_date::timestamp+interval '12 hours') at time zone 'America/Chicago');
 if d->>'projection_status' is distinct from 'current' or d->>'projection_id' is distinct from p_projection::text
  or d->>'employee_id' is distinct from p_employee::text or d->>'service_date' is distinct from p_date::text
  or jsonb_typeof(d->'all_items') is distinct from 'array' then
  raise exception using errcode='23514',message='recurring full-day render source is unavailable';end if;
 return jsonb_build_object('schema','static-weekly.recurring-render-view.v1','service_date',p_date,
  'employee_id',p_employee,'employee_name',d->'employee_name','publication_id',a.publication_id,
  'projection_id',p_projection,'projection_status','current','full_day',true,
  'shift',d->'shift','raw_items',d->'all_items');
end
$function$;

-- One finite date only. The accepted binding and predecessor provenance
-- survive indefinitely; materialization/reconnect reuses this same boundary.
create function public.static_weekly_v22_reconcile_recurring_application_date(p_date date)
returns integer language plpgsql security definer set search_path=pg_catalog,public as $function$
declare a record;b public.static_weekly_recurring_publication_bindings%rowtype;
 p public.static_weekly_recurring_confirmations%rowtype;l public.weekly_schedule_lunch_documents%rowtype;
person record;device record;v_view jsonb;v_target jsonb;v_view_digest text;v_intent uuid;v_count int:=0;v_devices int;
begin
 if p_date is null or not isfinite(p_date) then raise exception 'recurring application reconciliation requires one finite date';end if;
 perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 select * into a from public.static_weekly_v6_schedule_authority_state(p_date);
 if a.projection_status='blocked_recurring_authority' then return public.static_weekly_v19_reconcile_terminal_date(p_date);end if;
 if a.projection_status is distinct from 'current' or a.projection_id is null then raise exception 'recurring schedule projection is unavailable';end if;
 select * into b from public.static_weekly_recurring_publication_bindings where publication_id=a.publication_id;
 if not found then return 0;end if; -- old release-registered workflow is not relabeled recurring acceptance
 select * into strict p from public.static_weekly_recurring_confirmations where operation_id=b.operation_id;
 if not exists(select 1 from public.static_weekly_recurring_confirmation_receipts r where r.operation_id=b.operation_id)
  and (b.owner_xid<>pg_current_xact_id() or p.owner_xid<>pg_current_xact_id()) then
  raise exception 'unaccepted recurring parent cannot create phone targets';end if;
 select * into l from public.weekly_schedule_lunch_documents where projection_id=a.projection_id;
 if not found then raise exception 'exact recurring lunch companion is unavailable';end if;
 for person in with people as (
  select (r->>'personId')::uuid employee_id from jsonb_array_elements(b.dependency_snapshot->'roster') r
   where r->>'personId' is not null and extract(isodow from (r->>'serviceDate')::date)=extract(isodow from p_date)
  union
  select (r->>'personId')::uuid from public.static_weekly_recurring_publication_bindings prior
   cross join lateral jsonb_array_elements(prior.dependency_snapshot->'roster') r
   where prior.publication_id=b.predecessor_publication_id and r->>'personId' is not null
    and extract(isodow from (r->>'serviceDate')::date)=extract(isodow from p_date)
  union
  select x.owner_person_id_snapshot from public.weekly_schedule_occurrences x
   join public.weekly_schedule_compiled_projections projection using(projection_id)
   where projection.publication_id in (a.publication_id,b.predecessor_publication_id) and x.service_date=p_date
    and x.owner_person_id_snapshot is not null
  union
  select (r->>'normal_owner_person_id')::uuid from public.weekly_schedule_lunch_documents lunch
   join public.weekly_schedule_compiled_projections projection using(projection_id)
   cross join lateral jsonb_array_elements(lunch.document_json->'responsibilities') r
   where projection.publication_id in (a.publication_id,b.predecessor_publication_id)
    and r->>'service_date'=p_date::text and r->>'normal_owner_person_id' is not null
  union
  select (r->>'coverer_person_id')::uuid from public.weekly_schedule_lunch_documents lunch
   join public.weekly_schedule_compiled_projections projection using(projection_id)
   cross join lateral jsonb_array_elements(lunch.document_json->'responsibilities') r
   where projection.publication_id in (a.publication_id,b.predecessor_publication_id)
    and r->>'service_date'=p_date::text and r->>'coverer_person_id' is not null
 ) select distinct people.employee_id from people join public.employees e on e.id=people.employee_id order by people.employee_id loop
  v_view:=public.static_weekly_v22_recurring_render_view(a.projection_id,p_date,person.employee_id);
  v_view_digest:=public.static_weekly_digest_jsonb(v_view);v_devices:=0;
  -- Rotation/reconnect must not silently create a different view at the same
  -- authority identity, nor make ON CONFLICT hide changed display bytes.
  if exists(select 1 from public.static_weekly_recurring_application_intents i
   where i.publication_id=a.publication_id and i.projection_id=a.projection_id
    and i.service_date=p_date and i.employee_id=person.employee_id
    and i.authority_revision=a.projection_authority_revision
    and (i.view_json is distinct from v_view or i.view_digest is distinct from v_view_digest
      or i.lunch_document_identity is distinct from l.document_identity)) then
   raise exception using errcode='23514',message='recurring render changed without a new exact authority identity';end if;
  for device in select d.id,c.credential_id,d.assignment_epoch from public.devices d
   join public.device_auth_credentials c on c.device_id=d.id and c.confirmed_at is not null
    and c.revoked_at is null and c.expires_at>statement_timestamp()
   where d.active=true and d.assigned_employee_id=person.employee_id
   order by d.id,c.credential_id loop
   v_devices:=v_devices+1;
   v_target:=jsonb_build_object('schema','static-weekly.recurring-application-target.v1','targetType','SCHEDULE',
    'operationId',b.operation_id,'publicationId',a.publication_id,'projectionId',a.projection_id,'serviceDate',p_date,
    'authorityRevision',a.projection_authority_revision,'lunchDocumentIdentity',l.document_identity,
    'employeeId',person.employee_id,'deviceId',device.id,'credentialId',device.credential_id,
    'assignmentEpoch',device.assignment_epoch,'viewDigest',v_view_digest);
   insert into public.static_weekly_recurring_application_intents(operation_id,publication_id,projection_id,service_date,
    employee_id,device_id,credential_id,assignment_epoch,authority_revision,lunch_document_identity,view_json,view_digest,target_json,target_digest)
   values(b.operation_id,a.publication_id,a.projection_id,p_date,person.employee_id,device.id,device.credential_id,
    device.assignment_epoch,a.projection_authority_revision,l.document_identity,v_view,v_view_digest,v_target,public.static_weekly_digest_jsonb(v_target))
   on conflict do nothing returning intent_id into v_intent;
   if found then v_count:=v_count+1;end if;
  end loop;
  if v_devices=0 then
   v_target:=jsonb_build_object('schema','static-weekly.recurring-application-target.v1','targetType','SCHEDULE',
    'operationId',b.operation_id,'publicationId',a.publication_id,'projectionId',a.projection_id,'serviceDate',p_date,
    'authorityRevision',a.projection_authority_revision,'lunchDocumentIdentity',l.document_identity,
    'employeeId',person.employee_id,'deviceId',null,'credentialId',null,'assignmentEpoch',null,'viewDigest',v_view_digest);
   insert into public.static_weekly_recurring_application_intents(operation_id,publication_id,projection_id,service_date,
    employee_id,authority_revision,lunch_document_identity,view_json,view_digest,target_json,target_digest)
   values(b.operation_id,a.publication_id,a.projection_id,p_date,person.employee_id,a.projection_authority_revision,
    l.document_identity,v_view,v_view_digest,v_target,public.static_weekly_digest_jsonb(v_target))
   on conflict do nothing returning intent_id into v_intent;
   if found then v_count:=v_count+1;end if;
  end if;
 end loop;
 return v_count;
end
$function$;

create function public.static_weekly_v22_read_recurring_application_target(p_date date,p_device uuid,p_credential uuid,p_employee uuid,p_epoch bigint)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $function$
declare t public.static_weekly_recurring_application_intents%rowtype;receipt public.static_weekly_recurring_application_receipts%rowtype;a record;
begin
 if p_date is null or not isfinite(p_date) then raise exception 'recurring application read requires finite date';end if;
 perform public.static_weekly_v19_assert_terminal_principal(p_device,p_credential,p_employee,p_epoch);
 if not exists(select 1 from public.employees where id=p_employee and active=true) then
  raise exception using errcode='42501',message='recurring schedule requires an active employee principal';end if;
 select * into a from public.static_weekly_v6_schedule_authority_state(p_date);
 if a.projection_status='blocked_recurring_authority' then return public.static_weekly_v19_read_terminal_target(p_date,p_device,p_credential,p_employee,p_epoch);end if;
 select * into t from public.static_weekly_recurring_application_intents i
  where i.service_date=p_date and i.device_id=p_device and i.credential_id=p_credential
   and i.employee_id=p_employee and i.assignment_epoch=p_epoch
  order by i.authority_revision desc,i.created_at desc,i.intent_id desc limit 1;
 if not found then
  if exists(select 1 from public.static_weekly_recurring_publication_bindings where publication_id=a.publication_id) then
   return jsonb_build_object('applicationStatus','PENDING_TARGET_RECONCILIATION','affectedPhonesUpdated',false);end if;
  return null;
 end if;
 if a.projection_status is distinct from 'current' or t.publication_id is distinct from a.publication_id
  or t.projection_id is distinct from a.projection_id or t.authority_revision is distinct from a.projection_authority_revision then
  return jsonb_build_object('applicationStatus','PENDING_TARGET_RECONCILIATION','affectedPhonesUpdated',false);end if;
 select * into receipt from public.static_weekly_recurring_application_receipts where intent_id=t.intent_id;
 return jsonb_build_object('intentId',t.intent_id,'target',t.target_json,'targetDigest',t.target_digest,
  'view',t.view_json,'viewJsonText',t.view_json::text,'viewDigest',t.view_digest,
  'applicationStatus',case when receipt.intent_id is null then 'PENDING' else 'DEVICE_REPORTED_APPLIED' end,
  'receiptId',receipt.receipt_id,'appliedAt',receipt.applied_at,'receivedAt',receipt.received_at);
end
$function$;

create function public.static_weekly_v22_ack_recurring_application_target(p_intent uuid,p_device uuid,p_credential uuid,p_employee uuid,p_epoch bigint,
 p_revision bigint,p_target_digest text,p_rendered_digest text,p_applied_at timestamptz)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare t public.static_weekly_recurring_application_intents%rowtype;r public.static_weekly_recurring_application_receipts%rowtype;
begin
 perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 perform public.static_weekly_v19_assert_terminal_principal(p_device,p_credential,p_employee,p_epoch);
 if not exists(select 1 from public.employees where id=p_employee and active=true) then
  raise exception using errcode='42501',message='recurring schedule requires an active employee principal';end if;
 select * into t from public.static_weekly_recurring_application_intents where intent_id=p_intent for share;
 if not found or t.device_id is distinct from p_device or t.credential_id is distinct from p_credential
  or t.employee_id is distinct from p_employee or t.assignment_epoch is distinct from p_epoch
  or t.authority_revision is distinct from p_revision or t.target_digest is distinct from p_target_digest
  or t.view_digest is distinct from p_rendered_digest or p_applied_at is null or not isfinite(p_applied_at)
  or p_applied_at<t.created_at or p_applied_at>clock_timestamp()+interval '5 minutes' then
  raise exception using errcode='23514',message='recurring receipt requires exact principal target rendered-view revision and time';end if;
 select * into r from public.static_weekly_recurring_application_receipts where intent_id=p_intent;
 if found then
  if r.rendered_digest is distinct from p_rendered_digest or r.applied_at is distinct from p_applied_at then
   raise exception using errcode='23505',message='recurring target already has a different receipt';end if;
 else
  insert into public.static_weekly_recurring_application_receipts(intent_id,rendered_digest,applied_at)
   values(p_intent,p_rendered_digest,p_applied_at) returning * into r;
 end if;
 -- This is an immutable historical receipt. The merged reader, not this
 -- response, decides whether it still applies to the CURRENT desired state.
 return jsonb_build_object('intentId',p_intent,'receiptId',r.receipt_id,'applicationStatus','DEVICE_REPORTED_APPLIED',
  'currentAuthorityNotInferred',true,'appliedAt',r.applied_at,'receivedAt',r.received_at);
end
$function$;
do $private$
declare f record;
begin
 for f in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace and proname like 'static_weekly_v22_%' loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader',f.signature);
 end loop;
end
$private$;

do $surface$
declare definition text;rows_sql text;seam text:='  values';
begin
 select string_agg(format('(%L,%L,%L)',kind,identity,'exact recurring schedule application targets'),E',\n' order by kind,identity)||',' into rows_sql
 from (
  select 'relation' kind,'public.'||name identity from unnest(array['static_weekly_recurring_application_intents','static_weekly_recurring_application_receipts']) name
  union all select 'function','public.'||oid::regprocedure::text from pg_proc where pronamespace='public'::regnamespace and proname like 'static_weekly_v22_%'
  union all select 'trigger','public.'||c.relname||'.'||t.tgname from pg_trigger t join pg_class c on c.oid=t.tgrelid
   where t.tgname='trg_recurring_application_immutable'
 ) objects;
 definition:=pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure);
 if length(definition)-length(replace(definition,seam,''))<>length(seam) then raise exception 'application target canary seam changed';end if;
 execute replace(definition,seam,seam||E'\n'||rows_sql);
end
$surface$;
alter table public.custodial_release_authority_restore_inventory disable trigger trg_custodial_release_authority_restore_inventory_immutable;
do $recovery$
declare obj record;v_order integer;
begin
 for obj in with relations(name) as (values('public.static_weekly_recurring_application_intents'),('public.static_weekly_recurring_application_receipts')),
 funcs as (select oid,'public.'||oid::regprocedure::text identity from pg_proc where pronamespace='public'::regnamespace
  and (proname like 'static_weekly_v22_%' or oid='public.custodial_release_canary_authority_surface()'::regprocedure)),objects as (
  select 1000 bucket,'relation'::text kind,name identity,public.custodial_release_authority_current_relation_definition(name) definition from relations
  union all select 100000,'function',identity,pg_get_functiondef(oid) from funcs
  union all select 200000,'column',r.name||':'||a.attname,public.custodial_release_authority_current_column_definition(r.name||':'||a.attname)
   from relations r join pg_attribute a on a.attrelid=r.name::regclass and a.attnum>0 and not a.attisdropped
  union all select 300000,'column_set',name,public.custodial_release_authority_current_column_set_definition(name) from relations
  union all select 400000,'relation_state',name,public.custodial_release_authority_current_relation_state_definition(name) from relations
  union all select 500000,'constraint',r.name||':'||c.conname,public.custodial_release_authority_current_constraint_definition(r.name||':'||c.conname)
   from relations r join pg_constraint c on c.conrelid=r.name::regclass
  union all select 600000,'index','public.'||quote_ident(c.relname),public.custodial_release_authority_current_index_definition('public.'||quote_ident(c.relname))
   from relations r join pg_index i on i.indrelid=r.name::regclass join pg_class c on c.oid=i.indexrelid
   where not exists(select 1 from pg_constraint k where k.conindid=i.indexrelid)
  union all select 700000,'trigger',r.name||'.'||t.tgname,
   'drop trigger if exists '||quote_ident(t.tgname)||' on '||r.name||'; '||pg_get_triggerdef(t.oid,true)||';'
   from relations r join pg_trigger t on t.tgrelid=r.name::regclass and not t.tgisinternal
  union all select 900000,'grant',name,public.custodial_release_authority_current_grant_definition(name) from relations
  union all select 900000,'grant',identity,public.custodial_release_authority_current_grant_definition(identity) from funcs
 ) select * from objects order by bucket,identity loop
  if obj.definition is null then raise exception 'missing recurring application recovery object %',obj.identity;end if;
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
