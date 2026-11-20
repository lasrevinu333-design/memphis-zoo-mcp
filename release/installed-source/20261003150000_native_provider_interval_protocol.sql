-- CLI-created20261002123821, parent-reserved03150000. Accepted PC01/PC02 source only.
-- No runtime profile, sender/index/factory activation, or historical point conversion.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

-- Interval metadata is evidence from the typed current native credential, NOT
-- qualification authority. Profiles are pinned natively and never supplied here.
create function public.custodial_native_provider_interval_observation(o jsonb,p_required boolean)
returns void language plpgsql immutable set search_path=pg_catalog,public as $fn$
declare field text; first_at timestamptz; last_at timestamptz;
begin
 if jsonb_typeof(o) is distinct from 'object' or
  (select array_agg(key order by key) from jsonb_object_keys(o) key) is distinct from
   array['boot_count','clock_profile_id','earliest_at','elapsed_realtime_ms','latest_at'] then
  raise exception 'exact native interval observation required' using errcode='22023';end if;
 foreach field in array array['boot_count','elapsed_realtime_ms'] loop
  if o->field is distinct from 'null'::jsonb and
   (jsonb_typeof(o->field) is distinct from 'number' or o->>field !~ '^(0|[1-9][0-9]{0,15})$'
    or (o->>field)::numeric>(case when field='boot_count' then 2147483647 else 9007199254740991 end)) then
   raise exception 'exact native interval counter required' using errcode='22023';end if;
 end loop;
 if o->'earliest_at'='null'::jsonb then
  if p_required is distinct from false or o->'latest_at' is distinct from 'null'::jsonb or o->'clock_profile_id' is distinct from 'null'::jsonb then
   raise exception 'complete native interval required' using errcode='22023';end if;
 else
  first_at:=public.custodial_native_provider_event_time(o->'earliest_at');last_at:=public.custodial_native_provider_event_time(o->'latest_at');
  if last_at<first_at or jsonb_typeof(o->'clock_profile_id') is distinct from 'string'
   or o->>'clock_profile_id' !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' or o->'boot_count'='null'::jsonb or o->'elapsed_realtime_ms'='null'::jsonb then
   raise exception 'ordered qualified native interval evidence required' using errcode='22023';end if;
 end if;
end $fn$;
create function public.custodial_native_provider_observation_order(a jsonb,b jsonb)
returns boolean language sql immutable set search_path=pg_catalog as $fn$
 select case when a->'boot_count'='null'::jsonb or b->'boot_count'='null'::jsonb then true
  when (a->>'boot_count')::bigint>(b->>'boot_count')::bigint then false
  when a->'boot_count'=b->'boot_count' and a->'elapsed_realtime_ms'<>'null'::jsonb and b->'elapsed_realtime_ms'<>'null'::jsonb
   then (a->>'elapsed_realtime_ms')::bigint<=(b->>'elapsed_realtime_ms')::bigint
  else true end;
$fn$;

create or replace function public.custodial_native_provider_event_shape(p_event jsonb)
returns void language plpgsql immutable set search_path=pg_catalog,public as $fn$
declare field text;
begin
 if jsonb_typeof(p_event) is distinct from 'object' or
  (select array_agg(key order by key) from jsonb_object_keys(p_event) key) is distinct from
  array['action','admission_bounds','content_sha256','event_id','generation_id','notification_key','original_observation','principal_digest',
   'receipt_assignment_epoch','receipt_credential_id','receipt_device_id','receipt_employee_id','receipt_job_id','record_id','schema','token_digest']
  or p_event->>'schema' is distinct from 'custodial.native-provider-event.v2'
  or p_event->>'action' not in ('received','displayed','opened','acknowledged') then
  raise exception 'exact finite native event required' using errcode='22023';end if;
 foreach field in array array['action','schema','event_id','generation_id','receipt_credential_id','receipt_employee_id','receipt_job_id',
  'record_id','content_sha256','principal_digest','token_digest','notification_key','receipt_device_id'] loop
  if jsonb_typeof(p_event->field) is distinct from 'string' then raise exception 'native event string required' using errcode='22023';end if;
 end loop;
 foreach field in array array['event_id','generation_id','receipt_credential_id','receipt_employee_id','receipt_job_id'] loop
  if p_event->>field !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then raise exception 'native event UUID required' using errcode='22023';end if;
 end loop;
 foreach field in array array['record_id','content_sha256','principal_digest','token_digest'] loop
  if p_event->>field !~ '^[0-9a-f]{64}$' then raise exception 'native event digest required' using errcode='22023';end if;
 end loop;
 if p_event->>'receipt_device_id' !~ '^KIOSK_(0[2-9]|10)$' or jsonb_typeof(p_event->'receipt_assignment_epoch') is distinct from 'number'
  or p_event->>'receipt_assignment_epoch' !~ '^[1-9][0-9]{0,15}$' or (p_event->>'receipt_assignment_epoch')::numeric>9007199254740991
  or length(p_event->>'notification_key') not between 1 and 1000 or p_event->>'notification_key' ~ '[[:cntrl:]]'
  or p_event->>'record_id'<>public.static_weekly_digest_text((p_event->>'generation_id')||E'\n'||(p_event->>'receipt_job_id')||E'\n'||(p_event->>'notification_key'))
 then raise exception 'native event identity required' using errcode='22023';end if;
 perform public.custodial_native_provider_interval_observation(p_event->'admission_bounds',true);
 perform public.custodial_native_provider_interval_observation(p_event->'original_observation',p_event->>'action'='displayed');
end $fn$;

create or replace function public.custodial_native_provider_events_at(p_credential uuid,p_credential_hash text,p_native_request uuid,
 p_attestation_digest text,p_body jsonb,p_test_at timestamptz)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare d public.devices%rowtype;c public.device_auth_credentials%rowtype;g public.employee_native_push_generations%rowtype;
 r public.employee_native_push_delivery_receipts%rowtype;prior public.employee_native_provider_events%rowtype;
 received public.employee_native_provider_events%rowtype;request public.employee_native_provider_event_requests%rowtype;
 e jsonb;first_event jsonb;payload jsonb;results jsonb:='[]';observed timestamptz;observed_last timestamptz;admitted timestamptz;admitted_last timestamptz;at_time timestamptz;
 other_event jsonb;field text;body_digest text;code text;replayed boolean;
begin
 perform public.custodial_begin_application_mutation();
 if p_credential is null or p_native_request is null or coalesce(p_credential_hash,'') !~ '^[0-9a-f]{64}$'
  or coalesce(p_attestation_digest,'') !~ '^[0-9a-f]{64}$' or jsonb_typeof(p_body) is distinct from 'object' or octet_length(p_body::text)>65536
  or (select array_agg(key order by key) from jsonb_object_keys(p_body) key) is distinct from array['events','schema']
  or p_body->>'schema' is distinct from 'custodial.native-provider-events.v2' or jsonb_typeof(p_body->'events') is distinct from 'array'
  or jsonb_array_length(p_body->'events') not between 1 and 16 then raise exception 'exact native event batch required' using errcode='22023';end if;
 first_event:=p_body->'events'->0;
 for e in select value from jsonb_array_elements(p_body->'events') loop
  perform public.custodial_native_provider_event_shape(e);
  foreach field in array array['receipt_credential_id','receipt_employee_id','receipt_device_id','receipt_assignment_epoch','principal_digest'] loop
   if e->field is distinct from first_event->field then raise exception 'one exact batch principal required' using errcode='22023';end if;
  end loop;
 end loop;
 if (select count(distinct x->>'event_id') from jsonb_array_elements(p_body->'events') x)<>jsonb_array_length(p_body->'events')
  or (select count(distinct (x->>'record_id',x->>'action')) from jsonb_array_elements(p_body->'events') x)<>jsonb_array_length(p_body->'events') then
  raise exception 'unique native events and transitions required' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 select d0.* into d from public.devices d0 join public.device_auth_credentials c0 on c0.device_id=d0.id where c0.credential_id=p_credential for update of d0;
 select * into c from public.device_auth_credentials where credential_id=p_credential for update;
 perform 1 from public.employees where id=d.assigned_employee_id for share;
 perform 1 from public.employee_push_registrations where device_id=d.id order by registration_id for update;
 perform 1 from public.employee_native_push_generations where generation_id in(select (x->>'generation_id')::uuid from jsonb_array_elements(p_body->'events') x) order by generation_id for update;
 perform 1 from public.operational_notification_jobs where job_id in(select (x->>'receipt_job_id')::uuid from jsonb_array_elements(p_body->'events') x) order by job_id for update;
 perform 1 from public.employee_native_push_delivery_receipts where job_id in(select (x->>'receipt_job_id')::uuid from jsonb_array_elements(p_body->'events') x) order by job_id for update;
 at_time:=coalesce(p_test_at,clock_timestamp());
 if not isfinite(at_time) or d.id is null or d.active is not true or c.token_hash is distinct from p_credential_hash
  or c.confirmed_at is null or c.revoked_at is not null or c.expires_at<=at_time
  or first_event->>'receipt_credential_id' is distinct from c.credential_id::text
  or first_event->>'receipt_device_id' is distinct from d.device_id or first_event->>'receipt_employee_id' is distinct from d.assigned_employee_id::text
  or first_event->>'receipt_assignment_epoch' is distinct from d.assignment_epoch::text
  or not exists(select 1 from public.employees where id=d.assigned_employee_id and active and employee_code ~ '^EMP[0-9]+$') then
  raise exception 'current event credential required' using errcode='42501';end if;
 body_digest:=public.static_weekly_digest_text(p_body::text);
 select * into request from public.employee_native_provider_event_requests where native_request_id=p_native_request;
 if request.native_request_id is null then
  insert into public.employee_native_provider_event_requests values(p_native_request,p_credential,body_digest,p_attestation_digest,at_time);
 elsif request.credential_id<>p_credential or request.body_digest<>body_digest or request.attestation_digest<>p_attestation_digest then
  raise exception 'native request identity conflict' using errcode='23505';end if;
 -- Received first even if a durable batch was enumerated in another order.
 for e in select value from jsonb_array_elements(p_body->'events') order by value->>'record_id',
  case value->>'action' when 'received' then 0 when 'displayed' then 1 when 'opened' then 2 else 3 end loop
  code:=null;replayed:=false;
  select * into g from public.employee_native_push_generations where generation_id=(e->>'generation_id')::uuid;
  select * into r from public.employee_native_push_delivery_receipts where job_id=(e->>'receipt_job_id')::uuid;
  payload:=r.native_payload;
  if g.generation_id is null or g.device_id is distinct from d.id or g.device_identifier is distinct from d.device_id
   or g.credential_id is distinct from c.credential_id or g.employee_id is distinct from d.assigned_employee_id or g.assignment_epoch is distinct from d.assignment_epoch
   or g.principal_digest is distinct from e->>'principal_digest' or g.token_digest is distinct from e->>'token_digest' or g.revoked_at is not null
   or r.native_generation_id is distinct from g.generation_id or r.registration_id is distinct from g.registration_id
   or r.credential_id is distinct from c.credential_id or r.assignment_epoch is distinct from d.assignment_epoch
   or r.prepared_at<g.activated_at or r.prepared_at>at_time or (g.dispatch_retired_at is not null and r.prepared_at>g.dispatch_retired_at)
   or payload->>'schema' is distinct from 'custodial.native-location-payload.v2' then code:='native_provider_original_binding_invalid';end if;
  foreach field in array array['generation_id','receipt_job_id','notification_key','receipt_credential_id','receipt_employee_id','receipt_device_id',
   'receipt_assignment_epoch','principal_digest','token_digest','content_sha256'] loop
   if e->>field is distinct from payload->>field then code:='native_provider_original_binding_invalid';end if;
  end loop;
  select * into prior from public.employee_native_provider_events where event_id=(e->>'event_id')::uuid;
  if code is null and prior.event_id is not null then
   if prior.original_event<>e then code:='native_provider_event_conflict';else replayed:=true;end if;
  end if;
  if code is null and not replayed then
   if exists(select 1 from public.employee_native_provider_events where record_id=e->>'record_id' and action=e->>'action') then
    code:='native_provider_event_conflict';
   else
    admitted:=public.custodial_native_provider_event_time(e#>'{admission_bounds,earliest_at}');
    admitted_last:=public.custodial_native_provider_event_time(e#>'{admission_bounds,latest_at}');
    observed:=case when e#>'{original_observation,earliest_at}'='null'::jsonb then null else public.custodial_native_provider_event_time(e#>'{original_observation,earliest_at}') end;
    observed_last:=case when observed is null then null else public.custodial_native_provider_event_time(e#>'{original_observation,latest_at}') end;
    -- BOTH endpoints for admission; a cutoff-straddling interval grants nothing.
    -- Server receipt can tighten its own upper bound, not rewrite original evidence.
    if admitted<r.prepared_at or admitted_last>=r.native_valid_until or admitted>at_time or observed>at_time then code:='native_provider_observation_invalid';end if;
    if e->>'action'='received' then
     if observed>admitted_last or not public.custodial_native_provider_observation_order(e->'original_observation',e->'admission_bounds') then
      code:='native_provider_observation_invalid';end if;
    else
     select * into received from public.employee_native_provider_events where record_id=e->>'record_id' and action='received';
     if received.event_id is null then code:='native_provider_transition_pending';
     elsif received.original_event->>'schema' is distinct from 'custodial.native-provider-event.v2'
      or received.original_event->'admission_bounds'<>e->'admission_bounds' or received.original_event->>'content_sha256'<>e->>'content_sha256'
      or observed_last<admitted
      or not public.custodial_native_provider_observation_order(e->'admission_bounds',e->'original_observation') then code:='native_provider_observation_invalid';
     end if;
     if e->>'action'='displayed' and (observed is null or observed<r.prepared_at or observed_last>=r.native_valid_until) then
      code:='native_provider_observation_invalid';end if;
    end if;
   end if;
   if code is null then
    insert into public.employee_native_provider_events values((e->>'event_id')::uuid,e->>'record_id',e->>'action',g.generation_id,r.job_id,c.credential_id,
     e,at_time,p_native_request,p_attestation_digest) returning * into prior;
   end if;
  end if;
  if code is null and prior.action='acknowledged' then perform public.custodial_native_location_project_ack(prior.event_id,at_time);end if;
  if code is not null then results:=results||jsonb_build_array(jsonb_build_object('event_id',e->>'event_id','admitted_state','REJECTED','code',code));
  else results:=results||jsonb_build_array(prior.original_event||jsonb_build_object('schema','custodial.native-provider-event-receipt.v2',
   'admitted_state','ACCEPTED','server_received_at',public.custodial_native_location_utc(prior.server_received_at),'replayed',replayed));end if;
 end loop;
 return jsonb_build_object('ok',true,'data',jsonb_build_object('schema','custodial.native-provider-event-receipts.v2','results',results));
end $fn$;
create or replace function public.custodial_native_provider_events(p_credential uuid,p_credential_hash text,p_native_request uuid,p_attestation_digest text,p_body jsonb)
returns jsonb language sql security definer set search_path=pg_catalog,public as $fn$
 select public.custodial_native_provider_events_at(p_credential,p_credential_hash,p_native_request,p_attestation_digest,p_body,null);
$fn$;


-- Existing inventory holds current recipient/proof/registration/generation locks.
-- Its frozen scan server_now is retained byte-for-byte and NEVER reused as S.
-- Private test clocks are not granted to any runtime role.
create function public.custodial_native_provider_inventory_clock_at(p_credential uuid,p_credential_hash text,p_native_request uuid,
 p_attestation_digest text,p_body jsonb,p_test_at timestamptz,p_test_clock timestamptz)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare page jsonb;sampled_at timestamptz;expires timestamptz;
begin
 page:=public.custodial_native_location_inventory_at(p_credential,p_credential_hash,p_native_request,p_attestation_digest,p_body,p_test_at);
 if page->'ok' is distinct from 'true'::jsonb then return page;end if; -- Cursor rejection grants no clock.
 sampled_at:=coalesce(p_test_clock,clock_timestamp());
 select c.expires_at into strict expires from public.device_auth_credentials c where c.credential_id=p_credential;
 if not isfinite(sampled_at) or expires is null or expires<=sampled_at
  or (p_test_at is not null and sampled_at<p_test_at)
  or public.custodial_native_provider_event_time(page#>'{data,server_now}')>sampled_at then
  raise exception 'native inventory clock unavailable' using errcode='42501';end if;
 return page||jsonb_build_object('clock',jsonb_build_object('native_request_id',p_native_request::text,
  'server_now',public.custodial_native_location_utc(sampled_at),
  'valid_until',public.custodial_native_location_utc(least(sampled_at+interval '15 minutes',expires))));
end $fn$;
create function public.custodial_native_provider_inventory_clock(p_credential uuid,p_credential_hash text,p_native_request uuid,p_attestation_digest text,p_body jsonb)
returns jsonb language sql volatile security definer set search_path=pg_catalog,public as $fn$
 select public.custodial_native_provider_inventory_clock_at(p_credential,p_credential_hash,p_native_request,p_attestation_digest,p_body,null,null);
$fn$;

do $acl$ declare f regprocedure;begin
 for f in select p.oid::regprocedure from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in ('custodial_native_provider_interval_observation','custodial_native_provider_observation_order','custodial_native_provider_event_shape','custodial_native_provider_events_at','custodial_native_provider_events','custodial_native_provider_inventory_clock_at','custodial_native_provider_inventory_clock') loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader,static_weekly_runtime_20260823',f);
 end loop;
end $acl$;
grant execute on function public.custodial_native_provider_events(uuid,text,uuid,text,jsonb),
 public.custodial_native_provider_inventory_clock(uuid,text,uuid,text,jsonb) to service_role;
-- Old inventory is still a page-only proof, not a route clock fallback. The API
-- calls the new wrapper exclusively; historical point events remain immutable.
lock table public.custodial_release_authority_restore_inventory in share row exclusive mode;
do $recovery$ declare obj record;next_order integer;changed integer;begin
 if not exists(select 1 from pg_trigger where tgrelid='public.custodial_release_authority_restore_inventory'::regclass
  and tgname='trg_custodial_release_authority_restore_inventory_immutable' and tgenabled='O') then raise exception 'recovery immutability unavailable';end if;
 alter table public.custodial_release_authority_restore_inventory disable trigger trg_custodial_release_authority_restore_inventory_immutable;
 for obj in with funcs as(
  select p.oid,p.proname from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in ('custodial_native_provider_interval_observation','custodial_native_provider_observation_order','custodial_native_provider_event_shape','custodial_native_provider_events_at','custodial_native_provider_events','custodial_native_provider_inventory_clock_at','custodial_native_provider_inventory_clock')
 ),objects as(
  select 100000 bucket,'function'::text kind,oid::regprocedure::text identity,pg_get_functiondef(oid) definition from funcs
  union all select 900000,'grant',oid::regprocedure::text,public.custodial_release_authority_current_grant_definition(oid::regprocedure::text) from funcs
 )select * from objects order by bucket,identity loop
  if obj.definition is null then raise exception 'missing interval recovery object %',obj.identity;end if;
  update public.custodial_release_authority_restore_inventory set definition_sql=obj.definition,definition_sha256=public.static_weekly_digest_text(obj.definition),captured_at=statement_timestamp()
   where object_kind=obj.kind and (object_identity=obj.identity or case when object_identity like '%(%' and obj.identity like '%(%'
    then to_regprocedure(object_identity)=to_regprocedure(obj.identity) else false end);
  get diagnostics changed=row_count;if changed>1 then raise exception 'duplicate interval recovery object %',obj.identity;end if;
  if changed=0 then
   select n into next_order from generate_series(obj.bucket+1,obj.bucket+99998) n
    where not exists(select 1 from public.custodial_release_authority_restore_inventory where restore_order=n) order by n limit 1;
   if next_order is null then raise exception 'interval recovery order exhausted';end if;
   insert into public.custodial_release_authority_restore_inventory(restore_order,object_kind,object_identity,definition_sql,definition_sha256)
    values(next_order,obj.kind,obj.identity,obj.definition,public.static_weekly_digest_text(obj.definition));
  end if;
 end loop;
 alter table public.custodial_release_authority_restore_inventory enable trigger trg_custodial_release_authority_restore_inventory_immutable;
end $recovery$;
commit;
