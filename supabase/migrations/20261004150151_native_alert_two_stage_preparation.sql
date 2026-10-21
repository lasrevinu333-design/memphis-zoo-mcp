-- Private no-send preparation of current Event/Message source facts. The
-- separate finalize migration must revalidate these facts before permission.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
set local search_path=pg_catalog,public;

create table public.employee_native_alert_preparations (
 job_id uuid primary key references public.operational_notification_jobs(job_id),
 preparation_id uuid not null unique default gen_random_uuid(),
 lease_token uuid not null,
 alert_kind text not null check(alert_kind in ('EVENT','MESSAGE')),
 expected jsonb not null check(jsonb_typeof(expected)='object'),
 source_projection jsonb not null check(jsonb_typeof(source_projection)='object'),
 source_revision text not null check(source_revision~'^[0-9a-f]{64}$'),
 prepared_at timestamptz not null,
 prepared_until timestamptz not null check(isfinite(prepared_until) and prepared_until>prepared_at)
);
create trigger trg_employee_native_alert_preparations_immutable
 before update or delete on public.employee_native_alert_preparations
 for each row execute function public.custodial_native_location_append_only();
alter table public.employee_native_alert_preparations enable always trigger trg_employee_native_alert_preparations_immutable;
alter table public.employee_native_alert_preparations enable row level security;
alter table public.employee_native_alert_preparations force row level security;
revoke all on table public.employee_native_alert_preparations
 from public,anon,authenticated,service_role,static_weekly_control_plane,
 static_weekly_release_operator,custodial_application_reader,static_weekly_runtime_20260823;

-- This read returns a token only to the backend service role. It never admits
-- a send; the mutable owner/generation/registration row set is rechecked by
-- prepare and later by finalize. No bearer reaches the handset or a receipt.
create function public.custodial_native_alert_target_at(p_job uuid,p_lease uuid,p_test_at timestamptz)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare j public.operational_notification_jobs%rowtype;i public.event_push_instances%rowtype;
 d public.devices%rowtype;c public.device_auth_credentials%rowtype;r public.employee_push_registrations%rowtype;
 g public.employee_native_push_generations%rowtype;at_time timestamptz;recipient uuid;epoch bigint;
 kind text;active_count integer;
begin
 perform public.custodial_begin_application_mutation();
 if p_job is null or p_lease is null then raise exception 'exact alert job lease required' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 select * into j from public.operational_notification_jobs where job_id=p_job;
 if j.job_id is null or j.status<>'leased' or j.lease_token is distinct from p_lease
  or j.job_type not in ('employee_event_push','employee_native_push') then
  return jsonb_build_object('current',false,'reason','native_alert_job_superseded');end if;
 if j.job_type='employee_event_push' then
  kind:='EVENT';
  select * into i from public.event_push_instances where instance_id=j.source_id;
  recipient:=i.credential_id;epoch:=i.assignment_epoch;
 elsif j.payload_json#>>'{data_json,kind}'='employee_message'
  and (j.payload_json#>'{data_json,test_delivery}') is null
  and j.job_key='employee-message-push:'||j.source_id::text||':'||(j.payload_json->>'credential_id') then
  kind:='MESSAGE';recipient:=(j.payload_json->>'credential_id')::uuid;
  epoch:=(j.payload_json->>'assignment_epoch')::bigint;
 else return jsonb_build_object('current',false,'reason','native_alert_kind_unavailable');end if;
 select d0.* into d from public.devices d0 join public.device_auth_credentials c0 on c0.device_id=d0.id
  where c0.credential_id=recipient for update of d0;
 select * into c from public.device_auth_credentials where credential_id=recipient for update;
 perform 1 from public.employees where id=d.assigned_employee_id for share;
 perform 1 from public.employee_push_registrations where device_id=d.id order by registration_id for update;
 select * into r from public.employee_push_registrations
  where credential_id=recipient and device_id=d.id and employee_id=d.assigned_employee_id
   and assignment_epoch=d.assignment_epoch and active is true and revoked_at is null
  order by last_seen_at desc,registration_id desc limit 1;
 select count(*) into active_count from public.employee_native_push_generations
  where credential_id=recipient and registration_id=r.registration_id
   and revoked_at is null and dispatch_retired_at is null;
 if active_count=1 then
  select * into g from public.employee_native_push_generations
   where credential_id=recipient and registration_id=r.registration_id
    and revoked_at is null and dispatch_retired_at is null for update;
 end if;
 -- Match the existing native target's device -> credential -> registration
 -- -> generation -> job lock order. Re-read the job after acquiring its lock;
 -- the preliminary recipient lookup is never itself authority.
 select * into j from public.operational_notification_jobs where job_id=p_job for update;
 at_time:=coalesce(p_test_at,clock_timestamp());
 if not isfinite(at_time) or j.job_id is null or j.status<>'leased'
  or j.lease_token is distinct from p_lease or j.leased_until<=at_time
  or j.job_type is distinct from (case kind when 'EVENT' then 'employee_event_push' else 'employee_native_push' end)
  or (kind='EVENT' and j.source_id is distinct from i.instance_id)
  or (kind='MESSAGE' and (j.payload_json->>'credential_id' is distinct from recipient::text
   or j.payload_json->>'assignment_epoch' is distinct from epoch::text))
  or d.id is null or d.active is not true
  or d.device_id !~ '^KIOSK_(0[2-9]|10)$'
  or d.assignment_epoch is distinct from epoch or c.device_id is distinct from d.id
  or c.confirmed_at is null or c.revoked_at is not null or c.expires_at<=at_time
  or r.registration_id is null or r.platform is distinct from 'android'
  or r.token_hash is distinct from public.static_weekly_digest_text(r.fcm_token)
  or g.generation_id is null or g.registration_id is distinct from r.registration_id
  or g.device_id is distinct from d.id or g.device_identifier is distinct from d.device_id
  or g.employee_id is distinct from d.assigned_employee_id or g.assignment_epoch is distinct from d.assignment_epoch
  or g.principal_digest !~ '^[0-9a-f]{64}$' or g.token_digest is distinct from r.token_hash
  or g.activated_at>at_time or not exists(select 1 from public.employees e
   where e.id=d.assigned_employee_id and e.active and e.employee_code~'^EMP[0-9]+$')
  or (kind='EVENT' and (i.instance_id is null or i.credential_id is distinct from c.credential_id
    or i.device_id is distinct from d.id or i.employee_id is distinct from d.assigned_employee_id))
  or (kind='MESSAGE' and (j.payload_json->>'credential_id' is distinct from c.credential_id::text
    or j.payload_json->>'employee_id' is distinct from d.assigned_employee_id::text
    or j.payload_json->>'device_id' is distinct from d.id::text
    or j.payload_json->>'device_identifier' is distinct from d.device_id
    or j.payload_json->>'assignment_epoch' is distinct from d.assignment_epoch::text)) then
  return jsonb_build_object('current',false,'reason','native_alert_recipient_superseded');end if;
 return jsonb_build_object('current',true,'kind',kind,'token',r.fcm_token,
  'expected',jsonb_build_object('generation_id',g.generation_id::text,'principal_digest',g.principal_digest,
   'token_digest',g.token_digest,'credential_id',c.credential_id::text,'employee_id',d.assigned_employee_id::text,
   'device_id',d.device_id,'device_uuid',d.id::text,'assignment_epoch',d.assignment_epoch::text,
   'registration_id',r.registration_id::text));
end $fn$;
create function public.custodial_native_alert_target(p_job uuid,p_lease uuid)
returns jsonb language sql volatile security definer set search_path=pg_catalog,public as $fn$
 select public.custodial_native_alert_target_at(p_job,p_lease,null);
$fn$;

-- Existing source admission is the only route to this immutable no-send row.
-- A pre-existing legacy prepared/sent receipt is never adopted as a native
-- preparation; retry may read only this exact private preparation identity.
create function public.custodial_native_alert_prepare_at(p_job uuid,p_lease uuid,p_expected jsonb,p_test_at timestamptz)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare target jsonb;j public.operational_notification_jobs%rowtype;i public.event_push_instances%rowtype;
 prep public.employee_native_alert_preparations%rowtype;claim jsonb;projection jsonb;
 at_time timestamptz;until_time timestamptz;revision text;kind text;
begin
 perform public.custodial_begin_application_mutation();
 if p_job is null or p_lease is null or jsonb_typeof(p_expected) is distinct from 'object' then
  raise exception 'exact alert preparation required' using errcode='22023';end if;
 target:=public.custodial_native_alert_target_at(p_job,p_lease,p_test_at);
 if target->'current' is distinct from 'true'::jsonb or target->'expected' is distinct from p_expected then
  return jsonb_build_object('current',false,'dispatch_authorized',false,'reason','native_alert_target_superseded');end if;
 select * into j from public.operational_notification_jobs where job_id=p_job for update;
 at_time:=coalesce(p_test_at,clock_timestamp());kind:=target->>'kind';
 until_time:=least(j.leased_until,(select expires_at from public.device_auth_credentials
  where credential_id=(p_expected->>'credential_id')::uuid));
 select * into prep from public.employee_native_alert_preparations where job_id=p_job for update;
 if prep.job_id is not null then
  if prep.lease_token is distinct from p_lease or prep.expected is distinct from p_expected
   or prep.alert_kind is distinct from kind or prep.prepared_until<=at_time then
   return jsonb_build_object('current',false,'dispatch_authorized',false,'reason','native_alert_preparation_superseded');end if;
  return jsonb_build_object('schema','custodial.native-alert-preparation.v1','current',true,
   'dispatch_authorized',false,'prepared_id',prep.preparation_id,'job_id',p_job,'lease_token',p_lease,
   'kind',kind,'expected',prep.expected,'source_revision',prep.source_revision,
   'source_projection',prep.source_projection,
   'prepared_until',public.custodial_native_location_utc(prep.prepared_until));
 end if;
 if kind='EVENT' then
  select * into i from public.event_push_instances where instance_id=j.source_id for update;
  claim:=public.mz_claim_employee_event_push_delivery(p_job,p_lease,i.instance_id,
   (p_expected->>'credential_id')::uuid,i.assignment_epoch,(p_expected->>'registration_id')::uuid,
   p_expected->>'token_digest',at_time);
  if claim->'dispatch_authorized' is distinct from 'true'::jsonb then
   return jsonb_build_object('current',false,'dispatch_authorized',false,'reason','native_event_claim_unavailable');end if;
  projection:=public.mz_employee_event_push_current_projection(p_job,p_lease,i.instance_id,
   (p_expected->>'credential_id')::uuid,i.assignment_epoch);
  if projection->'current' is distinct from 'true'::jsonb then
   raise exception 'native Event projection unavailable after claim' using errcode='42501';end if;
  until_time:=least(until_time,(projection->>'start_instant_utc')::timestamptz);
  projection:=projection||jsonb_build_object('notification_kind',i.notification_kind,'service_date',i.service_date::text);
  revision:=public.static_weekly_digest_jsonb(projection);
 elsif kind='MESSAGE' then
  claim:=public.mz_prepare_employee_native_push_delivery(p_job,p_lease,
   (p_expected->>'credential_id')::uuid,(p_expected->>'assignment_epoch')::bigint,
   (p_expected->>'registration_id')::uuid,p_expected->>'token_digest',at_time);
  if claim->'dispatch_authorized' is distinct from 'true'::jsonb
   or jsonb_typeof(claim->'message_projection') is distinct from 'object' then
   return jsonb_build_object('current',false,'dispatch_authorized',false,'reason','native_message_source_unavailable');end if;
  projection:=claim->'message_projection';revision:=projection->>'source_revision';
 else raise exception 'native alert kind unavailable' using errcode='22023';end if;
 if not isfinite(at_time) or until_time<=at_time+interval '1 second'
  or revision !~ '^[0-9a-f]{64}$' then
  raise exception 'native alert preparation window or source unavailable' using errcode='42501';end if;
 insert into public.employee_native_alert_preparations(job_id,lease_token,alert_kind,expected,
  source_projection,source_revision,prepared_at,prepared_until)
 values(p_job,p_lease,kind,p_expected,projection,revision,at_time,until_time) returning * into prep;
 return jsonb_build_object('schema','custodial.native-alert-preparation.v1','current',true,
  'dispatch_authorized',false,'prepared_id',prep.preparation_id,'job_id',p_job,'lease_token',p_lease,
  'kind',kind,'expected',prep.expected,'source_revision',prep.source_revision,
  'source_projection',prep.source_projection,
  'prepared_until',public.custodial_native_location_utc(prep.prepared_until));
end $fn$;
create function public.custodial_native_alert_prepare(p_job uuid,p_lease uuid,p_expected jsonb)
returns jsonb language sql volatile security definer set search_path=pg_catalog,public as $fn$
 select public.custodial_native_alert_prepare_at(p_job,p_lease,p_expected,null);
$fn$;

revoke all on function public.custodial_native_alert_target_at(uuid,uuid,timestamptz),
 public.custodial_native_alert_target(uuid,uuid),
 public.custodial_native_alert_prepare_at(uuid,uuid,jsonb,timestamptz),
 public.custodial_native_alert_prepare(uuid,uuid,jsonb)
 from public,anon,authenticated,service_role,static_weekly_control_plane,
 static_weekly_release_operator,custodial_application_reader,static_weekly_runtime_20260823;
grant execute on function public.custodial_native_alert_target(uuid,uuid),
 public.custodial_native_alert_prepare(uuid,uuid,jsonb) to service_role;
-- Capture only objects created in THIS transaction, before any runtime use.
-- These explicit birth identities are independent of surviving recovery rows.
lock table public.custodial_release_authority_restore_inventory in share row exclusive mode;
do $alert_birth_recovery$
declare obj record;next_order integer;previous_mode text;surface text;surface_acl text;
 additions text:='';updated integer;
begin
 select tgenabled::text into previous_mode from pg_trigger
  where tgrelid='public.custodial_release_authority_restore_inventory'::regclass
   and tgname='trg_custodial_release_authority_restore_inventory_immutable';
 if previous_mode not in ('O','A') then raise exception 'Alert recovery guard unavailable';end if;
 surface:=pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure);
 surface_acl:=public.custodial_release_authority_current_grant_definition('custodial_release_canary_authority_surface()');
 if (length(surface)-length(replace(surface,'  values','')))/length('  values')<>1
  or (select count(*) from public.custodial_release_authority_restore_inventory
   where object_kind='function' and to_regprocedure(object_identity)='public.custodial_release_canary_authority_surface()'::regprocedure
    and definition_sql=surface and definition_sha256=public.static_weekly_digest_text(surface))<>1 then
  raise exception 'Alert recovery surface predecessor changed';end if;
 alter table public.custodial_release_authority_restore_inventory disable trigger trg_custodial_release_authority_restore_inventory_immutable;
 for obj in with relations(identity) as (values ('public.employee_native_alert_preparations')),
 funcs as (select x.identity::regprocedure::oid oid from (values ('public.custodial_native_alert_target_at(uuid,uuid,timestamptz)'),('public.custodial_native_alert_target(uuid,uuid)'),('public.custodial_native_alert_prepare_at(uuid,uuid,jsonb,timestamptz)'),('public.custodial_native_alert_prepare(uuid,uuid,jsonb)')) x(identity)),
 objects as (
  select 1000 bucket,'relation'::text kind,identity,public.custodial_release_authority_current_relation_definition(identity) definition from relations
  union all select 100000,'function',oid::regprocedure::text,pg_get_functiondef(oid) from funcs
  union all select 200000,'column',r.identity||':'||a.attname,public.custodial_release_authority_current_column_definition(r.identity||':'||a.attname)
   from relations r join pg_attribute a on a.attrelid=r.identity::regclass and a.attnum>0 and not a.attisdropped
  union all select 300000,'column_set',identity,public.custodial_release_authority_current_column_set_definition(identity) from relations
  union all select 400000,'relation_state',identity,public.custodial_release_authority_current_relation_state_definition(identity) from relations
  union all select 500000,'constraint',r.identity||':'||c.conname,public.custodial_release_authority_current_constraint_definition(r.identity||':'||c.conname)
   from relations r join pg_constraint c on c.conrelid=r.identity::regclass
  union all select 600000,'index','public.'||quote_ident(c.relname),public.custodial_release_authority_current_index_definition('public.'||quote_ident(c.relname))
   from relations r join pg_index i on i.indrelid=r.identity::regclass join pg_class c on c.oid=i.indexrelid
   where not exists(select 1 from pg_constraint k where k.conindid=i.indexrelid)
  union all select 700000,'trigger',r.identity||'.'||quote_ident(t.tgname),
   'drop trigger if exists '||quote_ident(t.tgname)||' on '||r.identity||'; '||pg_get_triggerdef(t.oid,true)
   ||'; alter table '||r.identity||' '||case t.tgenabled when 'O' then 'enable' when 'D' then 'disable'
    when 'R' then 'enable replica' when 'A' then 'enable always' end||' trigger '||quote_ident(t.tgname)||';'
   from relations r join pg_trigger t on t.tgrelid=r.identity::regclass and not t.tgisinternal
  union all select 900000,'grant',identity,public.custodial_release_authority_current_grant_definition(identity) from relations
  union all select 900000,'grant',oid::regprocedure::text,public.custodial_release_authority_current_grant_definition(oid::regprocedure::text) from funcs
 ) select * from objects order by bucket,identity loop
  if obj.definition is null or exists(select 1 from public.custodial_release_authority_restore_inventory i
   where i.object_kind=obj.kind and (i.object_identity=obj.identity or
    case when obj.kind in ('function','grant') and i.object_identity like '%(%' and obj.identity like '%(%'
     then to_regprocedure(i.object_identity)=to_regprocedure(obj.identity) else false end)) then
   raise exception 'Alert birth recovery absent definition or preexisting identity: %',obj.identity;end if;
  select n into next_order from generate_series(obj.bucket+1,
   (case when obj.bucket=1000 then 100000 else obj.bucket+100000 end)-1) n
   where not exists(select 1 from public.custodial_release_authority_restore_inventory where restore_order=n) order by n limit 1;
  if next_order is null then raise exception 'Alert recovery order exhausted';end if;
  insert into public.custodial_release_authority_restore_inventory(restore_order,object_kind,object_identity,definition_sql,definition_sha256)
   values(next_order,obj.kind,obj.identity,obj.definition,public.static_weekly_digest_text(obj.definition));
  if exists(select 1 from public.custodial_release_canary_authority_surface() s where s.object_kind=obj.kind and s.object_identity=obj.identity) then
   raise exception 'Alert birth surface already contains identity: %',obj.identity;end if;
  additions:=additions||format('    (%L,%L,%L),',obj.kind,obj.identity,'native alert birth authority')||E'\n';
 end loop;
 execute replace(surface,'  values',E'  values\n'||additions);
 if public.custodial_release_authority_current_grant_definition('custodial_release_canary_authority_surface()') is distinct from surface_acl then
  raise exception 'Alert surface ACL changed';end if;
 update public.custodial_release_authority_restore_inventory
  set definition_sql=pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure),
   definition_sha256=public.static_weekly_digest_text(pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure)),
   captured_at=statement_timestamp()
  where object_kind='function' and to_regprocedure(object_identity)='public.custodial_release_canary_authority_surface()'::regprocedure
   and definition_sql=surface and definition_sha256=public.static_weekly_digest_text(surface);
 get diagnostics updated=row_count;
 if updated<>1 then raise exception 'Alert surface recovery identity changed';end if;
 execute 'alter table public.custodial_release_authority_restore_inventory enable '
  ||case when previous_mode='A' then 'always ' else '' end||'trigger trg_custodial_release_authority_restore_inventory_immutable';
end $alert_birth_recovery$;
commit;
