-- CLI-created20261002090900, parent-reserved03050000. LOCATION receipt-only.
-- No sender/index/runtime activation, no qualified clock or delivery claim.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create table public.employee_native_provider_events (
 event_id uuid primary key,record_id text not null check(record_id ~ '^[0-9a-f]{64}$'),
 action text not null check(action in ('received','displayed','opened','acknowledged')),
 generation_id uuid not null references public.employee_native_push_generations(generation_id),
 job_id uuid not null references public.employee_native_push_delivery_receipts(job_id),
 credential_id uuid not null references public.device_auth_credentials(credential_id),
 original_event jsonb not null check(jsonb_typeof(original_event)='object'),
 server_received_at timestamptz not null check(isfinite(server_received_at)),
 first_native_request_id uuid not null,first_attestation_digest text not null check(first_attestation_digest ~ '^[0-9a-f]{64}$'),
 unique(record_id,action)
);
create index native_provider_event_generation on public.employee_native_provider_events(generation_id);
create index native_provider_event_job on public.employee_native_provider_events(job_id);
create index native_provider_event_credential on public.employee_native_provider_events(credential_id);
create table public.employee_native_provider_event_requests (
 native_request_id uuid primary key,credential_id uuid not null references public.device_auth_credentials(credential_id),
 body_digest text not null check(body_digest ~ '^[0-9a-f]{64}$'),attestation_digest text not null check(attestation_digest ~ '^[0-9a-f]{64}$'),
 server_received_at timestamptz not null check(isfinite(server_received_at))
);
create index native_provider_event_request_credential on public.employee_native_provider_event_requests(credential_id);
create trigger trg_native_provider_event_immutable before update or delete on public.employee_native_provider_events
 for each row execute function public.custodial_native_location_append_only();
alter table public.employee_native_provider_events enable always trigger trg_native_provider_event_immutable;
create trigger trg_native_provider_event_request_immutable before update or delete on public.employee_native_provider_event_requests
 for each row execute function public.custodial_native_location_append_only();
alter table public.employee_native_provider_event_requests enable always trigger trg_native_provider_event_request_immutable;

create function public.custodial_native_provider_event_time(p_value jsonb)
returns timestamptz language plpgsql immutable set search_path=pg_catalog,public as $fn$
declare value timestamptz;
begin
 if jsonb_typeof(p_value) is distinct from 'string' or p_value#>>'{}' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$'
 then raise exception 'canonical native event time required' using errcode='22023';end if;
 value:=(p_value#>>'{}')::timestamptz;
 if not isfinite(value) or public.custodial_native_location_utc(value)<>(p_value#>>'{}') then
  raise exception 'canonical native event time required' using errcode='22023';end if;
 return value;
end $fn$;

create function public.custodial_native_provider_event_shape(p_event jsonb)
returns void language plpgsql immutable set search_path=pg_catalog,public as $fn$
declare field text;observation jsonb;
begin
 if jsonb_typeof(p_event) is distinct from 'object' or
  (select array_agg(key order by key) from jsonb_object_keys(p_event) key) is distinct from
  array['action','admitted_at','content_sha256','event_id','generation_id','notification_key','original_observation','principal_digest',
   'receipt_assignment_epoch','receipt_credential_id','receipt_device_id','receipt_employee_id','receipt_job_id','record_id','schema','token_digest']
  or p_event->>'schema' is distinct from 'custodial.native-provider-event.v1'
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
 perform public.custodial_native_provider_event_time(p_event->'admitted_at');observation:=p_event->'original_observation';
 if jsonb_typeof(observation) is distinct from 'object' or
  (select array_agg(key order by key) from jsonb_object_keys(observation) key) is distinct from array['authenticated_at','boot_count','elapsed_realtime_ms']
 then raise exception 'exact original observation required' using errcode='22023';end if;
 foreach field in array array['boot_count','elapsed_realtime_ms'] loop
  if observation->field is distinct from 'null'::jsonb then
   if jsonb_typeof(observation->field) is distinct from 'number' or observation->>field !~ '^(0|[1-9][0-9]{0,15})$'
    or (observation->>field)::numeric>(case when field='boot_count' then 2147483647 else 9007199254740991 end)
   then raise exception 'exact original native counter required' using errcode='22023';end if;
  end if;
 end loop;
 if observation->'authenticated_at' is distinct from 'null'::jsonb then
  perform public.custodial_native_provider_event_time(observation->'authenticated_at');
  if observation->'boot_count'='null'::jsonb or observation->'elapsed_realtime_ms'='null'::jsonb then
   raise exception 'authenticated observation counters required' using errcode='22023';end if;
 elsif p_event->>'action'='displayed' then raise exception 'displayed observation required' using errcode='22023';end if;
end $fn$;

-- Private clock seam is denied to every runtime role; production wrapper samples
-- its own clock only AFTER current authority/registration/generation/job locks.
create function public.custodial_native_provider_events_at(p_credential uuid,p_credential_hash text,p_native_request uuid,
 p_attestation_digest text,p_body jsonb,p_test_at timestamptz)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare d public.devices%rowtype;c public.device_auth_credentials%rowtype;g public.employee_native_push_generations%rowtype;
 r public.employee_native_push_delivery_receipts%rowtype;prior public.employee_native_provider_events%rowtype;
 received public.employee_native_provider_events%rowtype;request public.employee_native_provider_event_requests%rowtype;
 e jsonb;first_event jsonb;payload jsonb;results jsonb:='[]';observed timestamptz;admitted timestamptz;at_time timestamptz;
 other_event jsonb;field text;body_digest text;code text;replayed boolean;
begin
 perform public.custodial_begin_application_mutation();
 if p_credential is null or p_native_request is null or coalesce(p_credential_hash,'') !~ '^[0-9a-f]{64}$'
  or coalesce(p_attestation_digest,'') !~ '^[0-9a-f]{64}$' or jsonb_typeof(p_body) is distinct from 'object' or octet_length(p_body::text)>65536
  or (select array_agg(key order by key) from jsonb_object_keys(p_body) key) is distinct from array['events','schema']
  or p_body->>'schema' is distinct from 'custodial.native-provider-events.v1' or jsonb_typeof(p_body->'events') is distinct from 'array'
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
    admitted:=public.custodial_native_provider_event_time(e->'admitted_at');
    observed:=case when e#>'{original_observation,authenticated_at}'='null'::jsonb then null else public.custodial_native_provider_event_time(e#>'{original_observation,authenticated_at}') end;
    if admitted<r.prepared_at or admitted>=r.native_valid_until or admitted>at_time or observed>at_time then code:='native_provider_observation_invalid';end if;
    if e->>'action'='received' then
     if observed>admitted then code:='native_provider_observation_invalid';end if;
    else
     select * into received from public.employee_native_provider_events where record_id=e->>'record_id' and action='received';
     if received.event_id is null then code:='native_provider_transition_pending';
     elsif received.original_event->'admitted_at'<>e->'admitted_at' or received.original_event->>'content_sha256'<>e->>'content_sha256'
      or (observed is not null and observed<admitted) then code:='native_provider_observation_invalid';
     else
      other_event:=received.original_event;
      if e#>'{original_observation,boot_count}'<>'null'::jsonb and other_event#>'{original_observation,boot_count}'<>'null'::jsonb then
       if (e#>>'{original_observation,boot_count}')::bigint<(other_event#>>'{original_observation,boot_count}')::bigint
        or (e#>'{original_observation,boot_count}'=other_event#>'{original_observation,boot_count}'
         and e#>'{original_observation,elapsed_realtime_ms}'<>'null'::jsonb and other_event#>'{original_observation,elapsed_realtime_ms}'<>'null'::jsonb
         and (e#>>'{original_observation,elapsed_realtime_ms}')::bigint<(other_event#>>'{original_observation,elapsed_realtime_ms}')::bigint) then
        code:='native_provider_observation_invalid';end if;
      end if;
     end if;
     if e->>'action'='displayed' and (observed is null or observed>=r.native_valid_until) then code:='native_provider_observation_invalid';end if;
    end if;
   end if;
   if code is null then
    insert into public.employee_native_provider_events values((e->>'event_id')::uuid,e->>'record_id',e->>'action',g.generation_id,r.job_id,c.credential_id,
     e,at_time,p_native_request,p_attestation_digest) returning * into prior;
   end if;
  end if;
  if code is not null then results:=results||jsonb_build_array(jsonb_build_object('event_id',e->>'event_id','admitted_state','REJECTED','code',code));
  else results:=results||jsonb_build_array(prior.original_event||jsonb_build_object('schema','custodial.native-provider-event-receipt.v1',
   'admitted_state','ACCEPTED','server_received_at',public.custodial_native_location_utc(prior.server_received_at),'replayed',replayed));end if;
 end loop;
 return jsonb_build_object('ok',true,'data',jsonb_build_object('schema','custodial.native-provider-event-receipts.v1','results',results));
end $fn$;
create function public.custodial_native_provider_events(p_credential uuid,p_credential_hash text,p_native_request uuid,p_attestation_digest text,p_body jsonb)
returns jsonb language sql security definer set search_path=pg_catalog,public as $fn$
 select public.custodial_native_provider_events_at(p_credential,p_credential_hash,p_native_request,p_attestation_digest,p_body,null);
$fn$;

do $acl$ declare rel text;f regprocedure;begin
 foreach rel in array array['public.employee_native_provider_events','public.employee_native_provider_event_requests'] loop
  execute 'alter table '||rel||' enable row level security';execute 'alter table '||rel||' force row level security';
  execute 'revoke all on table '||rel||' from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader,static_weekly_runtime_20260823';
  if not exists(select 1 from pg_trigger where tgrelid=rel::regclass and tgname='custodial_disaster_restore_mutation_fence' and tgenabled='O') then
   raise exception 'new native receipt restore mutation fence missing: %',rel;end if;
 end loop;
 for f in select oid::regprocedure from pg_proc where pronamespace='public'::regnamespace and proname in
  ('custodial_native_provider_event_time','custodial_native_provider_event_shape','custodial_native_provider_events_at','custodial_native_provider_events') loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader,static_weekly_runtime_20260823',f);
 end loop;
end $acl$;
grant execute on function public.custodial_native_provider_events(uuid,text,uuid,text,jsonb) to service_role;

-- Only exact new receipt objects; original reservations and legacy ACKs unchanged.
-- Parent owns the explicit final combined canary20261003090000.
lock table public.custodial_release_authority_restore_inventory in share row exclusive mode;
alter table public.custodial_release_authority_restore_inventory disable trigger trg_custodial_release_authority_restore_inventory_immutable;
do $recovery$ declare obj record;next_order integer;changed integer;begin
 for obj in with funcs as (
  select p.oid,p.proname,case p.proname when 'custodial_native_provider_event_time' then 0 when 'custodial_native_provider_event_shape' then 1 when 'custodial_native_provider_events_at' then 2 else 3 end rank
  from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in
  ('custodial_native_provider_event_time','custodial_native_provider_event_shape','custodial_native_provider_events_at','custodial_native_provider_events')
 ),objects as (
  select 100000 bucket,rank,'function'::text kind,oid::regprocedure::text identity,pg_get_functiondef(oid) definition from funcs
  union all select 900000,rank,'grant',oid::regprocedure::text,public.custodial_release_authority_current_grant_definition(oid::regprocedure::text) from funcs
  union all select x.bucket,0,x.kind,x.identity,x.definition from
   unnest(array['public.employee_native_provider_events','public.employee_native_provider_event_requests']) rel cross join lateral (
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
  if obj.definition is null then raise exception 'missing native receipt recovery object %',obj.identity;end if;
  update public.custodial_release_authority_restore_inventory set definition_sql=obj.definition,definition_sha256=public.static_weekly_digest_text(obj.definition),captured_at=statement_timestamp()
   where object_kind=obj.kind and (object_identity=obj.identity or case when obj.kind in ('function','grant') and object_identity like '%(%' and obj.identity like '%(%'
    then to_regprocedure(object_identity)=to_regprocedure(obj.identity) else false end);
  get diagnostics changed=row_count;
  if changed>1 then raise exception 'duplicate native receipt recovery object %',obj.identity;end if;
  if changed=0 then
   select n into next_order from generate_series(obj.bucket+1,case when obj.bucket=1000 then 99998 else obj.bucket+99998 end) n
    where not exists(select 1 from public.custodial_release_authority_restore_inventory where restore_order=n) order by n limit 1;
   if next_order is null then raise exception 'native receipt recovery order exhausted';end if;
   insert into public.custodial_release_authority_restore_inventory(restore_order,object_kind,object_identity,definition_sql,definition_sha256)
    values(next_order,obj.kind,obj.identity,obj.definition,public.static_weekly_digest_text(obj.definition));
  end if;
 end loop;
end $recovery$;
alter table public.custodial_release_authority_restore_inventory enable trigger trg_custodial_release_authority_restore_inventory_immutable;
commit;
