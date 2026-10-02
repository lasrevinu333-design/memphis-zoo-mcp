-- CLI-created20261002100317; parent-reserved20261003080000. Source only.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';

-- Service-only LOCATION transport ownership. A committed reservation consumes
-- permission permanently, even when its reply or the owning process is lost.
create table public.employee_native_location_dispatch_attempts (
 job_id uuid primary key references public.employee_native_push_delivery_receipts(job_id),
 attempt_id uuid not null unique default gen_random_uuid(),
 outcome_operation_id uuid not null unique default gen_random_uuid(),
 check(attempt_id<>outcome_operation_id)
);
create trigger trg_native_location_dispatch_immutable before update or delete on public.employee_native_location_dispatch_attempts
 for each row execute function public.custodial_native_location_append_only();
alter table public.employee_native_location_dispatch_attempts enable always trigger trg_native_location_dispatch_immutable;

create function public.custodial_native_location_dispatch_status(p_job uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare r public.employee_native_push_delivery_receipts%rowtype;a public.employee_native_location_dispatch_attempts%rowtype;b jsonb;
begin
 perform public.custodial_begin_application_mutation();
 if p_job is null then raise exception 'exact original job required' using errcode='22023';end if;
 -- Same final job->receipt read fence as original outcome status, no later
 -- device/generation locks. This read grants neither token nor dispatch rights.
 perform 1 from public.operational_notification_jobs where job_id=p_job for update;
 select * into r from public.employee_native_push_delivery_receipts where job_id=p_job for update;
 if r.job_id is null then return jsonb_build_object('schema','custodial.native-location-dispatch-status.v1','reserved',false,'dispatch_authorized',false);end if;
 if r.native_generation_id is null or r.native_payload->>'schema' is distinct from 'custodial.native-location-payload.v2' then
  raise exception 'original LOCATION native reservation required' using errcode='42501';end if;
 select * into a from public.employee_native_location_dispatch_attempts where job_id=p_job;
 b:=jsonb_build_object('receipt_job_id',r.job_id::text,'lease_token',r.lease_token::text,'registration_id',r.registration_id::text,
  'generation_id',r.native_generation_id::text,'reservation_at',public.custodial_native_location_utc(r.prepared_at),
  'content_sha256',r.native_payload_sha256,'token_digest',r.token_hash,'principal_digest',r.native_payload->>'principal_digest',
  'receipt_credential_id',r.credential_id::text,'receipt_assignment_epoch',r.assignment_epoch::text,
  'receipt_employee_id',r.native_payload->>'receipt_employee_id','receipt_device_id',r.native_payload->>'receipt_device_id');
 return jsonb_build_object('schema','custodial.native-location-dispatch-status.v1','reserved',true,'dispatch_authorized',false,
  'binding',b,'attempt_id',a.attempt_id,'outcome_operation_id',a.outcome_operation_id);
end $fn$;

-- Private test clock is NEVER granted to service/client/runtime roles.
create function public.custodial_native_location_dispatch_prepare_at(p_job uuid,p_lease uuid,p_expected jsonb,p_test_at timestamptz)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare reserved jsonb;a public.employee_native_location_dispatch_attempts%rowtype;ttl integer;
begin
 perform public.custodial_begin_application_mutation();
 -- reserve_at owns final original recipient + exact publication/projection
 -- admission and its full ordered lock fence. Sample clock only inside it.
 reserved:=public.custodial_native_location_reserve_at(p_job,p_lease,p_expected,p_test_at);
 if reserved->'dispatch_authorized' is distinct from 'true'::jsonb then
  return jsonb_build_object('current',false,'dispatch_authorized',false,'reason','native_location_dispatch_not_fresh');end if;
 insert into public.employee_native_location_dispatch_attempts(job_id) values(p_job) returning * into a;
 ttl:=least(2419200,floor(extract(epoch from (reserved#>>'{payload,valid_until}')::timestamptz-(reserved#>>'{payload,reservation_at}')::timestamptz))::integer);
 if ttl<0 then raise exception 'native LOCATION validity unavailable';end if;
 return jsonb_build_object('schema','custodial.native-location-dispatch.v1','dispatch_authorized',true,'reservation',reserved,
  'attempt_id',a.attempt_id,'outcome_operation_id',a.outcome_operation_id,'ttl_seconds',ttl);
end $fn$;
create function public.custodial_native_location_dispatch_prepare(p_job uuid,p_lease uuid,p_expected jsonb)
returns jsonb language sql security definer set search_path=pg_catalog,public as $fn$
 select public.custodial_native_location_dispatch_prepare_at(p_job,p_lease,p_expected,null);
$fn$;

-- Durable link from the exact admitted ACK to the existing suppression reader.
-- It is not a synthetic displayed/opened event or a new cleaning/check baseline.
create table public.employee_native_location_ack_projections (
 event_id uuid primary key references public.employee_native_provider_events(event_id),
 job_id uuid not null references public.employee_native_push_delivery_receipts(job_id),
 acknowledgement_id uuid not null references public.device_notification_acknowledgements(id),
 projected_at timestamptz not null,
 acknowledged_at timestamptz not null
);
create index native_location_ack_projection_job on public.employee_native_location_ack_projections(job_id);
create index native_location_ack_projection_legacy on public.employee_native_location_ack_projections(acknowledgement_id);
create trigger trg_native_location_ack_projection_immutable before update or delete on public.employee_native_location_ack_projections
 for each row execute function public.custodial_native_location_append_only();
alter table public.employee_native_location_ack_projections enable always trigger trg_native_location_ack_projection_immutable;

create function public.custodial_native_location_project_ack(p_event uuid,p_at timestamptz)
returns void language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare e public.employee_native_provider_events%rowtype;r public.employee_native_push_delivery_receipts%rowtype;
 g public.employee_native_push_generations%rowtype;d public.devices%rowtype;c public.device_auth_credentials%rowtype;
 a public.device_notification_acknowledgements%rowtype;prior public.employee_native_location_ack_projections%rowtype;field text;
begin
 perform public.custodial_begin_application_mutation();
 select * into e from public.employee_native_provider_events where event_id=p_event;
 if e.event_id is null or e.action<>'acknowledged' then raise exception 'exact admitted native ACK required' using errcode='42501';end if;
 select * into g from public.employee_native_push_generations where generation_id=e.generation_id;
 -- Reentrant when called by the receipt owner; no new reverse-order lock.
 perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 select * into d from public.devices where id=g.device_id for update;
 select * into c from public.device_auth_credentials where credential_id=e.credential_id for update;
 perform 1 from public.employees where id=d.assigned_employee_id for share;
 perform 1 from public.employee_push_registrations where device_id=d.id order by registration_id for update;
 select * into g from public.employee_native_push_generations where generation_id=e.generation_id for update;
 perform 1 from public.operational_notification_jobs where job_id=e.job_id for update;
 select * into r from public.employee_native_push_delivery_receipts where job_id=e.job_id for update;
 if p_at is null or not isfinite(p_at) or p_at<e.server_received_at or d.active is not true or c.revoked_at is not null or c.confirmed_at is null or c.expires_at<=p_at
  or c.device_id is distinct from d.id or g.device_id is distinct from d.id or g.credential_id is distinct from c.credential_id
  or g.employee_id is distinct from d.assigned_employee_id or g.assignment_epoch is distinct from d.assignment_epoch or g.revoked_at is not null
  or r.native_generation_id is distinct from g.generation_id or r.registration_id is distinct from g.registration_id
  or r.credential_id is distinct from c.credential_id or r.assignment_epoch is distinct from d.assignment_epoch
  or r.native_payload->>'schema' is distinct from 'custodial.native-location-payload.v2'
  or not exists(select 1 from public.employees where id=d.assigned_employee_id and active and employee_code ~ '^EMP[0-9]+$') then
  raise exception 'current original ACK identity required' using errcode='42501';end if;
 foreach field in array array['generation_id','receipt_job_id','notification_key','receipt_credential_id','receipt_employee_id','receipt_device_id',
  'receipt_assignment_epoch','principal_digest','token_digest','content_sha256'] loop
  if e.original_event->>field is distinct from r.native_payload->>field then raise exception 'ACK original reservation mismatch' using errcode='42501';end if;
 end loop;
 select * into prior from public.employee_native_location_ack_projections where event_id=p_event;
 if prior.event_id is not null then return;end if;
 insert into public.device_notification_acknowledgements as old(device_identifier,notification_key,notification_type,
  credential_id,assignment_epoch,employee_id,notification_job_id,acknowledged_at,metadata_json)
 values(d.device_id,r.native_payload->>'notification_key','location_status',c.credential_id,d.assignment_epoch,d.assigned_employee_id,r.job_id,e.server_received_at,
  jsonb_build_object('schema','custodial.native-location-ack-projection.v1','native_event_id',e.event_id))
 on conflict(device_identifier,notification_key,credential_id,assignment_epoch) do update
  set acknowledged_at=coalesce(old.acknowledged_at,excluded.acknowledged_at),
   updated_at=case when old.acknowledged_at is null then p_at else old.updated_at end
  where old.employee_id=excluded.employee_id and old.notification_job_id=excluded.notification_job_id and old.notification_type=excluded.notification_type
 returning * into a;
 if a.id is null then raise exception 'legacy ACK original actor/job conflict' using errcode='23505';end if;
 insert into public.employee_native_location_ack_projections values(e.event_id,r.job_id,a.id,p_at,a.acknowledged_at);
end $fn$;

-- Projection is in the SAME transaction as the authenticated native receipt;
-- missing projection cannot be returned as an accepted/drainable ACK. Preserve
-- all prior admission/replay/chronology validation and only add this exact hook.
do $patch$ declare old text;needle text:=$needle$  if code is not null then results:=results||jsonb_build_array(jsonb_build_object('event_id',e->>'event_id','admitted_state','REJECTED','code',code));$needle$;begin
 select pg_get_functiondef('public.custodial_native_provider_events_at(uuid,text,uuid,text,jsonb,timestamptz)'::regprocedure) into old;
 if (length(old)-length(replace(old,needle,'')))/length(needle)<>1 then raise exception 'native receipt ACK hook anchor drift';end if;
 execute replace(old,needle,$hook$  if code is null and prior.action='acknowledged' then perform public.custodial_native_location_project_ack(prior.event_id,at_time);end if;
$hook$||needle);
end $patch$;

-- The original outcome API remains callable, but a dispatched LOCATION must use
-- its database-owned operation, never a new process-local operation identity.
do $patch$ declare old text;needle text:=$needle$ select * into g from public.employee_native_push_generations where generation_id=receipt.native_generation_id;$needle$;begin
 select pg_get_functiondef('public.custodial_native_location_outcome_at(jsonb,jsonb,timestamptz)'::regprocedure) into old;
 if (length(old)-length(replace(old,needle,'')))/length(needle)<>1 then raise exception 'native dispatch outcome anchor drift';end if;
 execute replace(old,needle,$hook$ if exists(select 1 from public.employee_native_location_dispatch_attempts where job_id=receipt.job_id and outcome_operation_id<>operation) then
  raise exception 'original dispatch outcome operation required' using errcode='23505';end if;
$hook$||needle);
end $patch$;

do $acl$ declare rel text;f regprocedure;begin
 foreach rel in array array['public.employee_native_location_dispatch_attempts','public.employee_native_location_ack_projections'] loop
  execute 'alter table '||rel||' enable row level security';execute 'alter table '||rel||' force row level security';
  execute 'revoke all on table '||rel||' from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader,static_weekly_runtime_20260823';
  if not exists(select 1 from pg_trigger where tgrelid=rel::regclass and tgname='custodial_disaster_restore_mutation_fence' and tgenabled='O') then raise exception 'native dispatch restore fence missing';end if;
 end loop;
 for f in select oid::regprocedure from pg_proc where pronamespace='public'::regnamespace and proname in
  ('custodial_native_location_dispatch_status','custodial_native_location_dispatch_prepare_at','custodial_native_location_dispatch_prepare','custodial_native_location_project_ack') loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader,static_weekly_runtime_20260823',f);
 end loop;
end $acl$;
grant execute on function public.custodial_native_location_dispatch_status(uuid),public.custodial_native_location_dispatch_prepare(uuid,uuid,jsonb) to service_role;

lock table public.custodial_release_authority_restore_inventory in share row exclusive mode;
alter table public.custodial_release_authority_restore_inventory disable trigger trg_custodial_release_authority_restore_inventory_immutable;
do $recovery$ declare obj record;next_order integer;changed integer;begin
 for obj in with funcs as (
  select p.oid,p.proname,case p.proname when 'custodial_native_location_project_ack' then 0 when 'custodial_native_provider_events_at' then 4 else 1 end rank
  from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in
  ('custodial_native_location_dispatch_status','custodial_native_location_dispatch_prepare_at','custodial_native_location_dispatch_prepare','custodial_native_location_project_ack','custodial_native_provider_events_at','custodial_native_location_outcome_at')
 ),objects as (
  select 100000 bucket,rank,'function'::text kind,oid::regprocedure::text identity,pg_get_functiondef(oid) definition from funcs
  union all select 900000,rank,'grant',oid::regprocedure::text,public.custodial_release_authority_current_grant_definition(oid::regprocedure::text) from funcs
  union all select x.bucket,0,x.kind,x.identity,x.definition from
   unnest(array['public.employee_native_location_dispatch_attempts','public.employee_native_location_ack_projections']) rel cross join lateral (
    select 1000 bucket,'relation'::text kind,rel identity,public.custodial_release_authority_current_relation_definition(rel) definition
    union all select 200000,'column',rel||':'||attname,public.custodial_release_authority_current_column_definition(rel||':'||attname)
     from pg_attribute where attrelid=rel::regclass and attnum>0 and not attisdropped
    union all select 300000,'column_set',rel,public.custodial_release_authority_current_column_set_definition(rel)
    union all select 400000,'relation_state',rel,public.custodial_release_authority_current_relation_state_definition(rel)
    union all select 500000,'constraint',rel||':'||conname,public.custodial_release_authority_current_constraint_definition(rel||':'||conname)
     from pg_constraint where conrelid=rel::regclass
    union all select 600000,'index',indexrelid::regclass::text,public.custodial_release_authority_current_index_definition(indexrelid::regclass::text)
     from pg_index i where indrelid=rel::regclass and not exists(select 1 from pg_constraint c where c.conindid=i.indexrelid)
    union all select 700000,'trigger',rel||'.'||tgname,'drop trigger if exists '||quote_ident(tgname)||' on '||rel||'; '
     ||pg_get_triggerdef(oid,true)||'; alter table '||rel||case when tgenabled='A' then ' enable always trigger ' else ' enable trigger ' end||quote_ident(tgname)||';'
     from pg_trigger where tgrelid=rel::regclass and not tgisinternal
    union all select 900000,'grant',rel,public.custodial_release_authority_current_grant_definition(rel)
   ) x
 ) select * from objects order by bucket,rank,identity loop
  if obj.definition is null then raise exception 'missing native dispatch recovery object %',obj.identity;end if;
  update public.custodial_release_authority_restore_inventory set definition_sql=obj.definition,definition_sha256=public.static_weekly_digest_text(obj.definition),captured_at=statement_timestamp()
   where object_kind=obj.kind and (object_identity=obj.identity or case when obj.kind in ('function','grant') and object_identity like '%(%' and obj.identity like '%(%'
    then to_regprocedure(object_identity)=to_regprocedure(obj.identity) else false end);
  get diagnostics changed=row_count;
  if changed>1 then raise exception 'duplicate native dispatch recovery object %',obj.identity;end if;
  if changed=0 then
   select n into next_order from generate_series(obj.bucket+1,case when obj.bucket=1000 then 99998 else obj.bucket+99998 end) n
    where not exists(select 1 from public.custodial_release_authority_restore_inventory where restore_order=n) order by n limit 1;
   if next_order is null then raise exception 'native dispatch recovery order exhausted';end if;
   insert into public.custodial_release_authority_restore_inventory(restore_order,object_kind,object_identity,definition_sql,definition_sha256)
    values(next_order,obj.kind,obj.identity,obj.definition,public.static_weekly_digest_text(obj.definition));
  end if;
 end loop;
end $recovery$;
alter table public.custodial_release_authority_restore_inventory enable trigger trg_custodial_release_authority_restore_inventory_immutable;
commit;
