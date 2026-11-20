-- CLI-created forward slot. Mixed native alert receipts are private and never
-- turn a no-send preparation or an old legacy prepared row into authority.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
set local search_path=pg_catalog,public;

-- Exact source-derived prosrc predecessors, including the two LUNCH receipt
-- splices and its inventory splice. A matching needle alone is insufficient:
-- unknown changes elsewhere in a routine must fail before any replacement.
do $predecessors$ declare target record;actual text;begin
 for target in select * from (values
  ('public.custodial_native_provider_events_at(uuid,text,uuid,text,jsonb,timestamptz)',
   '574bb2f8e29c0d0475bba4ab164bcd42a380921f1b15e5d214d68cc9e184ab25'),
  ('public.custodial_native_location_inventory_at(uuid,text,uuid,text,jsonb,timestamptz)',
   '5a8aa85da05e5ec99a5b19b99e68689f112ba046a1236908fa6d962a192e7d91'),
  ('public.custodial_native_location_inventory_rows(uuid,text,jsonb,timestamptz)',
   '92887ab72a6869aa115231154f2aefb47107c8a01934f5a32416cf224279f4c2')
 ) x(identity,body_sha256) loop
  select p.prosrc into actual from pg_proc p where p.oid=to_regprocedure(target.identity);
  if actual is null or public.static_weekly_digest_text(actual) is distinct from target.body_sha256 then
   raise exception 'native alert exact predecessor changed: %',target.identity;end if;
 end loop;
end $predecessors$;

-- The existing Event ledger already references a job that globally owns both
-- the historical location/lunch receipt and the separate alert finalization.
-- Replace only that overly narrow FK; do not delete or rewrite any receipt.
alter table public.employee_native_provider_events
 drop constraint employee_native_provider_events_job_id_fkey;
alter table public.employee_native_provider_events
 add constraint employee_native_provider_events_job_id_fkey
 foreign key(job_id) references public.operational_notification_jobs(job_id);

-- Post-dispatch source currentness cannot use the leased-only Event projector
-- or Message prepare: a terminal job is not evidence that the event/thread is
-- still current. This private predicate re-reads business source and exact
-- projection revision without reopening any job lease or provider send.
create function public.custodial_native_alert_source_live(p_job uuid,p_at timestamptz)
returns boolean language plpgsql stable security definer set search_path=pg_catalog,public as $fn$
declare a public.employee_native_alert_finalizations%rowtype;
 prep public.employee_native_alert_preparations%rowtype;
 j public.operational_notification_jobs%rowtype;
 i public.event_push_instances%rowtype;e public.events_app_events%rowtype;
 employee public.employees%rowtype;place jsonb;source jsonb;
 m public.msg_messages%rowtype;t public.msg_threads%rowtype;
 u public.msg_users%rowtype;r public.msg_receipts%rowtype;
 recipient uuid;revision text;
begin
 if p_job is null or p_at is null or not isfinite(p_at) then return false;end if;
 select * into a from public.employee_native_alert_finalizations where job_id=p_job;
 select * into prep from public.employee_native_alert_preparations where job_id=p_job;
 select * into j from public.operational_notification_jobs where job_id=p_job;
 if a.job_id is null or prep.job_id is null or j.job_id is null
  or a.preparation_id<>prep.preparation_id or a.alert_kind<>prep.alert_kind
  or a.source_revision<>prep.source_revision or a.payload->>'source_revision'<>prep.source_revision
  or a.finalized_at>p_at or a.valid_until<=p_at
  or a.payload->>'valid_until'<>public.custodial_native_location_utc(a.valid_until) then return false;end if;
 if prep.alert_kind='EVENT' then
  select * into i from public.event_push_instances where instance_id=j.source_id;
  select * into e from public.events_app_events where id=i.event_id;
  select * into employee from public.employees where id=i.employee_id and active=true;
  if j.job_type<>'employee_event_push' or i.instance_id is null
   or i.state not in ('leased','sent','opened') or i.cancelled_at is not null
   or i.dispatch_job_id is distinct from p_job or i.dispatch_lease_token is distinct from prep.lease_token
   or e.id is null or e.revision<>i.event_revision or e.status<>'SCHEDULED'
   or coalesce(e.needs_review,false) or e.event_scope='UNKNOWN'
   or e.cancelled_at is not null or e.archived_at is not null
   or e.start_instant_utc<=p_at or e.end_instant_utc is null
   or employee.id is null or i.employee_id::text<>a.payload->>'receipt_employee_id'
   or i.credential_id::text<>a.payload->>'receipt_credential_id'
   or i.device_id::text<>a.payload->>'recipient_device_uuid'
   or i.assignment_epoch::text<>a.payload->>'receipt_assignment_epoch'
   or not exists(select 1 from public.mz_event_reminder_schedule(e.id,e.revision,i.employee_id,i.notification_kind) s
     where s.scheduled_for=i.scheduled_for) then return false;end if;
  place:=public.app_event_place_authority(to_jsonb(e),p_at);
  if place->>'admissible' is distinct from 'true' then return false;end if;
  source:=jsonb_build_object('current',true,'event_id',e.id,'event_revision',e.revision,
   'instance_id',i.instance_id,'notification_key',i.notification_key,
   'employee_id',employee.id,'employee_name',employee.display_name,
   'event_name',e.event_name,
   'display_location',coalesce(nullif(place->>'primary_display_name',''),e.display_location),
   'event_date',e.event_date,'start_time',e.start_time,'end_time',e.end_time,
   'start_instant_utc',e.start_instant_utc,'end_instant_utc',e.end_instant_utc,
   'attendee_count',e.attendee_count,'custodial_note_codes',e.custodial_note_codes,
   'custodial_public_notes',e.custodial_public_notes,
   'place_authority',place->>'capability_authority',
   'notification_kind',i.notification_kind,'service_date',i.service_date::text);
  return source=prep.source_projection
   and public.static_weekly_digest_jsonb(source)=a.source_revision
   and a.payload->>'event_id'=e.id::text
   and a.payload->>'event_revision'=e.revision::text
   and a.payload->>'notification_key'=i.notification_key;
 end if;
 if prep.alert_kind<>'MESSAGE' or j.job_type<>'employee_native_push'
  or j.source_id::text is distinct from prep.source_projection->>'message_id'
  or j.job_key is distinct from prep.source_projection->>'job_key' then return false;end if;
 recipient:=(prep.source_projection->>'recipient_user_id')::uuid;
 select * into m from public.msg_messages where id=j.source_id;
 select * into t from public.msg_threads where id=m.thread_id;
 select * into u from public.msg_users where id=recipient and is_active=true;
 select * into r from public.msg_receipts where message_id=m.id and user_id=u.id;
 if m.id is null or m.is_deleted is not false or m.sent_at is null or m.sent_at>p_at
  or t.id is null or t.is_active is not true or t.system_key='ops_manager_shared_chat_v1'
  or u.id is null or u.employee_id::text is distinct from a.payload->>'receipt_employee_id'
  or m.sender_user_id=u.id or r.message_id is null or r.acknowledged_at is not null
  or not exists(select 1 from public.msg_thread_participants x
    where x.thread_id=t.id and x.user_id=u.id and x.left_at is null)
  or exists(select 1 from public.msg_message_deletions x where x.message_id=m.id and x.user_id=u.id)
  or exists(select 1 from public.msg_thread_visibility v where v.thread_id=t.id and v.user_id=u.id
    and (v.device_identifier is null or upper(btrim(v.device_identifier))=upper(btrim(a.payload->>'receipt_device_id')))
    and coalesce(m.sent_at,m.created_at)<=v.hidden_before) then return false;end if;
 revision:=public.static_weekly_digest_jsonb(jsonb_build_object('message_id',m.id,
  'thread_id',m.thread_id,'sender_user_id',m.sender_user_id,'sent_at',m.sent_at,
  'body',m.body,'metadata_json',m.metadata_json,'recipient_user_id',u.id));
 return revision=a.source_revision and prep.source_projection->>'source_revision'=revision
  and prep.source_projection#>>'{payload,body}'=left(coalesce(nullif(regexp_replace(m.body,'[[:space:]]+',' ','g'),''),'New message'),1000)
  and a.payload->>'message_id'=m.id::text and a.payload->>'thread_id'=t.id::text
  and a.payload->>'recipient_user_id'=u.id::text;
exception when data_exception or invalid_text_representation then return false;
end $fn$;

-- Same bounded scan, two independently typed finalized receipt sources. The
-- historical location/lunch predicate is retained verbatim; a mere alert
-- preparation has no row and never enters the native inventory.
create or replace function public.custodial_native_location_inventory_rows(
 p_credential uuid,p_principal text,p_generations jsonb,p_at timestamptz)
returns table(job_id uuid,reservation_at timestamptz,payload jsonb,provider_outcome text)
language sql stable security definer set search_path=pg_catalog,public as $fn$
 select r.job_id,r.prepared_at,r.native_payload,coalesce(o.outcome,'prepared')
 from public.employee_native_push_delivery_receipts r
 join public.employee_native_push_generations g on g.generation_id=r.native_generation_id
 left join lateral(select outcome from public.employee_native_location_outcomes x where x.job_id=r.job_id
  order by (x.outcome<>'delivery_outcome_unknown') desc,x.server_received_at desc,x.operation_id desc limit 1) o on true
 where r.credential_id=p_credential and g.credential_id=p_credential and g.principal_digest=p_principal
  and p_generations ? g.generation_id::text and g.revoked_at is null
  and g.registration_id=r.registration_id and g.token_digest=r.token_hash and g.assignment_epoch=r.assignment_epoch
  and r.native_payload->>'receipt_employee_id'=g.employee_id::text
  and r.native_payload->>'receipt_device_id'=g.device_identifier and r.native_payload->>'principal_digest'=g.principal_digest
  and r.prepared_at>=g.activated_at and (g.dispatch_retired_at is null or r.prepared_at<=g.dispatch_retired_at)
  and r.native_valid_until>p_at and coalesce(o.outcome,'prepared')<>'known_nonacceptance'
  and ((r.native_payload->>'schema'='custodial.native-location-payload.v2'
   and public.custodial_native_location_live(r.job_id,r.native_payload,p_at) is true)
   or (r.native_payload->>'schema'='custodial.native-provider-payload.v1'
   and r.native_payload->>'kind'='employee_lunch_coverage'
   and public.custodial_native_lunch_live(r.job_id,r.native_payload,p_at) is true))
 union all
 select a.job_id,a.finalized_at,a.payload,coalesce(o.provider_outcome,'prepared')
 from public.employee_native_alert_finalizations a
 join public.employee_native_alert_preparations prep on prep.job_id=a.job_id
  and prep.preparation_id=a.preparation_id and prep.source_revision=a.source_revision
 join public.employee_native_push_generations g on g.generation_id=(a.payload->>'generation_id')::uuid
 left join public.employee_native_alert_outcomes o on o.job_id=a.job_id
 where prep.expected->>'credential_id'=p_credential::text
  and g.credential_id=p_credential and g.principal_digest=p_principal
  and p_generations ? g.generation_id::text and g.revoked_at is null
  and g.registration_id::text=prep.expected->>'registration_id'
  and g.token_digest=a.payload->>'token_digest'
  and g.assignment_epoch::text=a.payload->>'receipt_assignment_epoch'
  and g.employee_id::text=a.payload->>'receipt_employee_id'
  and g.device_identifier=a.payload->>'receipt_device_id'
  and a.payload->>'principal_digest'=g.principal_digest
  and a.finalized_at>=g.activated_at
  and (g.dispatch_retired_at is null or a.finalized_at<=g.dispatch_retired_at)
  and a.valid_until>p_at and coalesce(o.provider_outcome,'prepared')<>'known_nonacceptance'
  and not exists(select 1 from public.employee_native_provider_events n
   where n.job_id=a.job_id and n.action='acknowledged')
  and public.custodial_native_alert_source_live(a.job_id,p_at) is true;
$fn$;

-- A scan cursor/ceiling names the original immutable reservation, not a
-- re-evaluated row or whichever table happens to be queried first.
create function public.custodial_native_provider_original_tuple(p_job uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $fn$
declare a public.employee_native_alert_finalizations%rowtype;
 r public.employee_native_push_delivery_receipts%rowtype;
begin
 select * into a from public.employee_native_alert_finalizations where job_id=p_job;
 select * into r from public.employee_native_push_delivery_receipts where job_id=p_job;
 if a.job_id is not null then
  if r.native_payload is not null then return null;end if;
  return jsonb_build_object('reservation_at',public.custodial_native_location_utc(a.finalized_at),'job_id',a.job_id::text);
 end if;
 if r.job_id is null or r.native_payload is null then return null;end if;
 return jsonb_build_object('reservation_at',public.custodial_native_location_utc(r.prepared_at),'job_id',r.job_id::text);
end $fn$;

do $patch$ declare definition text;old text;replacement text;begin
 definition:=pg_get_functiondef('public.custodial_native_location_inventory_at(uuid,text,uuid,text,jsonb,timestamptz)'::regprocedure);
 old:=$old$select jsonb_build_object('reservation_at',public.custodial_native_location_utc(prepared_at),'job_id',job_id::text)
   into bound from public.employee_native_push_delivery_receipts where job_id=ids[cardinality(ids)];$old$;
 replacement:=$new$select public.custodial_native_provider_original_tuple(ids[cardinality(ids)]) into bound;
   if bound is null then raise exception 'original bounded native ceiling unavailable' using errcode='42501';end if;$new$;
 if (length(definition)-length(replace(definition,old,'')))/length(old)<>1 then
  raise exception 'native inventory ceiling seam changed';end if;
 definition:=replace(definition,old,replacement);
 old:=$old$not exists(select 1 from public.employee_native_push_delivery_receipts r
    where r.job_id=any(scan.candidate_jobs) and r.job_id::text=p_body#>>'{cursor,job_id}'
     and public.custodial_native_location_utc(r.prepared_at)=p_body#>>'{cursor,reservation_at}')$old$;
 replacement:=$new$not exists(select 1 from unnest(scan.candidate_jobs) job(job_id)
    where job.job_id::text=p_body#>>'{cursor,job_id}'
     and public.custodial_native_provider_original_tuple(job.job_id)=p_body->'cursor')$new$;
 if (length(definition)-length(replace(definition,old,'')))/length(old)<>1 then
  raise exception 'native inventory cursor seam changed';end if;
 execute replace(definition,old,replacement);
end $patch$;

-- The existing authenticated event endpoint retains its nonce, interval,
-- principal, request-id and received-before-opened algorithm. This helper
-- admits only a byte-bound finalized alert; an exact original event replay
-- may still reconcile after its effect window, without authorizing a new one.
create function public.custodial_native_alert_event_binding(p_job uuid,p_event jsonb,
 p_credential uuid,p_at timestamptz)
returns boolean language plpgsql stable security definer set search_path=pg_catalog,public as $fn$
declare a public.employee_native_alert_finalizations%rowtype;
 prep public.employee_native_alert_preparations%rowtype;
 g public.employee_native_push_generations%rowtype;
 field text;
begin
 if p_job is null or p_credential is null or p_at is null or not isfinite(p_at) then return false;end if;
 select * into a from public.employee_native_alert_finalizations where job_id=p_job;
 select * into prep from public.employee_native_alert_preparations where job_id=p_job;
 select * into g from public.employee_native_push_generations
  where generation_id=(p_event->>'generation_id')::uuid;
 if a.job_id is null or prep.job_id is null or g.generation_id is null
  or a.preparation_id<>prep.preparation_id or a.source_revision<>prep.source_revision
  or a.alert_kind is distinct from prep.alert_kind
  or a.finalized_at<g.activated_at or a.finalized_at>p_at
  or (g.dispatch_retired_at is not null and a.finalized_at>g.dispatch_retired_at)
  or g.revoked_at is not null or g.credential_id<>p_credential
  or g.device_id::text is distinct from prep.expected->>'device_uuid'
  or g.registration_id::text is distinct from prep.expected->>'registration_id'
  or g.token_digest is distinct from a.payload->>'token_digest'
  or g.principal_digest is distinct from a.payload->>'principal_digest'
  or g.employee_id::text is distinct from a.payload->>'receipt_employee_id'
  or g.device_identifier is distinct from a.payload->>'receipt_device_id'
  or g.assignment_epoch::text is distinct from a.payload->>'receipt_assignment_epoch'
  or a.payload->>'receipt_credential_id' is distinct from p_credential::text
  or a.payload->>'receipt_job_id' is distinct from p_job::text
  or a.payload->>'generation_id' is distinct from g.generation_id::text
  or a.payload->>'schema' is distinct from (case a.alert_kind when 'EVENT' then 'custodial.native-event-payload.v1'
    when 'MESSAGE' then 'custodial.native-message-payload.v1' end)
  or a.payload->>'reservation_at' is distinct from public.custodial_native_location_utc(a.finalized_at)
  or a.payload->>'valid_until' is distinct from public.custodial_native_location_utc(a.valid_until)
  or a.payload->>'content_sha256' is distinct from a.content_sha256
  or exists(select 1 from public.employee_native_push_delivery_receipts legacy
    where legacy.job_id=p_job and legacy.native_payload is not null) then return false;end if;
 foreach field in array array['generation_id','receipt_job_id','notification_key','receipt_credential_id',
  'receipt_employee_id','receipt_device_id','receipt_assignment_epoch',
  'principal_digest','token_digest','content_sha256'] loop
  if p_event->>field is distinct from a.payload->>field then return false;end if;
 end loop;
 -- This is ORIGINAL receipt binding, not a fresh inventory/send permission.
 -- The unchanged outer v2 algorithm validates original admission/observation
 -- intervals and exact replay. A transport delay past valid_until or a later
 -- business-source change must not erase a valid original received/Open/ACK.
 -- Fresh inventory retains the separate live-source and current-time checks.
 return true;
exception when data_exception or invalid_text_representation then return false;
end $fn$;

do $patch$ declare definition text;old text;replacement text;begin
 definition:=pg_get_functiondef('public.custodial_native_provider_events_at(uuid,text,uuid,text,jsonb,timestamptz)'::regprocedure);
 old:=$old$r public.employee_native_push_delivery_receipts%rowtype;prior public.employee_native_provider_events%rowtype;$old$;
 replacement:=$new$r public.employee_native_push_delivery_receipts%rowtype;
 alert public.employee_native_alert_finalizations%rowtype;
 reservation_started timestamptz;valid_cutoff timestamptz;
 prior public.employee_native_provider_events%rowtype;$new$;
 if (length(definition)-length(replace(definition,old,'')))/length(old)<>1 then
  raise exception 'native receipt declaration seam changed';end if;
 definition:=replace(definition,old,replacement);
 old:=$old$perform 1 from public.employee_native_push_delivery_receipts where job_id in(select (x->>'receipt_job_id')::uuid from jsonb_array_elements(p_body->'events') x) order by job_id for update;$old$;
 replacement:=old||E'\n perform 1 from public.employee_native_alert_finalizations where job_id in(select (x->>''receipt_job_id'')::uuid from jsonb_array_elements(p_body->''events'') x) order by job_id for update;';
 if (length(definition)-length(replace(definition,old,'')))/length(old)<>1 then
  raise exception 'native receipt lock seam changed';end if;
 definition:=replace(definition,old,replacement);
 old:=$old$select * into r from public.employee_native_push_delivery_receipts where job_id=(e->>'receipt_job_id')::uuid;
  payload:=r.native_payload;$old$;
 replacement:=$new$select * into r from public.employee_native_push_delivery_receipts where job_id=(e->>'receipt_job_id')::uuid;
  select * into alert from public.employee_native_alert_finalizations where job_id=(e->>'receipt_job_id')::uuid;
  payload:=case when alert.job_id is not null then alert.payload else r.native_payload end;
  reservation_started:=case when alert.job_id is not null then alert.finalized_at else r.prepared_at end;
  valid_cutoff:=case when alert.job_id is not null then alert.valid_until else r.native_valid_until end;$new$;
 if (length(definition)-length(replace(definition,old,'')))/length(old)<>1 then
  raise exception 'native receipt original row seam changed';end if;
 definition:=replace(definition,old,replacement);
 old:=$old$if g.generation_id is null or g.device_id is distinct from d.id$old$;
 replacement:=$new$if alert.job_id is not null then
   if public.custodial_native_alert_event_binding(alert.job_id,e,c.credential_id,at_time) is not true then
    code:='native_provider_original_binding_invalid';end if;
  else
  if g.generation_id is null or g.device_id is distinct from d.id$new$;
 if (length(definition)-length(replace(definition,old,'')))/length(old)<>1 then
  raise exception 'native receipt typed binding seam changed';end if;
 definition:=replace(definition,old,replacement);
 old:=$old$and payload->>'kind'='employee_lunch_coverage')) then code:='native_provider_original_binding_invalid';end if;$old$;
 replacement:=$new$and payload->>'kind'='employee_lunch_coverage')) then code:='native_provider_original_binding_invalid';end if;
  end if;$new$;
 if (length(definition)-length(replace(definition,old,'')))/length(old)<>1 then
  raise exception 'native receipt legacy branch seam changed';end if;
 definition:=replace(definition,old,replacement);
 old:=$old$g.generation_id,r.job_id,c.credential_id,$old$;
 replacement:=$new$g.generation_id,(e->>'receipt_job_id')::uuid,c.credential_id,$new$;
 if (length(definition)-length(replace(definition,old,'')))/length(old)<>1 then
  raise exception 'native receipt owning FK insert seam changed';end if;
 definition:=replace(definition,old,replacement);
 if (length(definition)-length(replace(definition,'r.prepared_at','')))/length('r.prepared_at')<>6
  or (length(definition)-length(replace(definition,'r.native_valid_until','')))/length('r.native_valid_until')<>3 then
  raise exception 'native receipt finite interval use sites changed';end if;
 definition:=replace(replace(definition,'r.prepared_at','reservation_started'),
  'r.native_valid_until','valid_cutoff');
 -- Restore the original initializer expressions after the bounded use-site
 -- rewrite; otherwise these two new assignments would self-reference.
 definition:=replace(definition,'else reservation_started end','else r.prepared_at end');
 definition:=replace(definition,'else valid_cutoff end','else r.native_valid_until end');
 if (length(definition)-length(replace(definition,'r.prepared_at','')))/length('r.prepared_at')<>1
  or (length(definition)-length(replace(definition,'r.native_valid_until','')))/length('r.native_valid_until')<>1 then
  raise exception 'native receipt initializer restoration changed';end if;
 execute definition;
end $patch$;

revoke all on function public.custodial_native_alert_source_live(uuid,timestamptz),
 public.custodial_native_provider_original_tuple(uuid),
 public.custodial_native_alert_event_binding(uuid,jsonb,uuid,timestamptz)
 from public,anon,authenticated,service_role,static_weekly_control_plane,
 static_weekly_release_operator,custodial_application_reader,static_weekly_runtime_20260823;

-- Rebind only the exact changed FK and six routine/grant identities. No
-- historical recovery membership or explicit runtime grants are discarded.
lock table public.custodial_release_authority_restore_inventory in share row exclusive mode;
alter table public.custodial_release_authority_restore_inventory
 disable trigger trg_custodial_release_authority_restore_inventory_immutable;
do $recovery$ declare obj record;next_order integer;changed integer;begin
 for obj in with funcs as (
  select p.oid from pg_proc p where p.pronamespace='public'::regnamespace
   and p.proname in ('custodial_native_alert_source_live',
    'custodial_native_provider_original_tuple','custodial_native_alert_event_binding',
    'custodial_native_location_inventory_rows','custodial_native_location_inventory_at',
    'custodial_native_provider_events_at')
 ),objects as (
  select 100000 bucket,'function'::text kind,oid::regprocedure::text identity,
   pg_get_functiondef(oid) definition from funcs
  union all select 900000,'grant',oid::regprocedure::text,
   public.custodial_release_authority_current_grant_definition(oid::regprocedure::text) from funcs
  union all select 500000,'constraint',
   'public.employee_native_provider_events:employee_native_provider_events_job_id_fkey',
   public.custodial_release_authority_current_constraint_definition(
    'public.employee_native_provider_events:employee_native_provider_events_job_id_fkey')
 ) select * from objects order by bucket,identity loop
  if obj.definition is null then raise exception 'missing native alert recovery object %',obj.identity;end if;
  update public.custodial_release_authority_restore_inventory
   set definition_sql=obj.definition,definition_sha256=public.static_weekly_digest_text(obj.definition),
    captured_at=statement_timestamp()
   where object_kind=obj.kind and (object_identity=obj.identity or
    (obj.kind in ('function','grant') and object_identity like '%(%' and obj.identity like '%(%'
      and to_regprocedure(object_identity)=to_regprocedure(obj.identity)));
  get diagnostics changed=row_count;
  if changed>1 then raise exception 'duplicate native alert recovery object %',obj.identity;end if;
  if changed=0 then
   select n into next_order from generate_series(obj.bucket+1,obj.bucket+99998) n
    where not exists(select 1 from public.custodial_release_authority_restore_inventory where restore_order=n)
    order by n limit 1;
   if next_order is null then raise exception 'native alert recovery order exhausted';end if;
   insert into public.custodial_release_authority_restore_inventory
    (object_kind,object_identity,definition_sql,definition_sha256,captured_at,restore_order)
   values(obj.kind,obj.identity,obj.definition,public.static_weekly_digest_text(obj.definition),
    statement_timestamp(),next_order);
  end if;
 end loop;
end $recovery$;
alter table public.custodial_release_authority_restore_inventory
 enable always trigger trg_custodial_release_authority_restore_inventory_immutable;
commit;
