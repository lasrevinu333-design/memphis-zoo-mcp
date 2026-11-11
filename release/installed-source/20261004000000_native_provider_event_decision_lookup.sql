-- CLI-created EMPTY 20261003072816_native_provider_event_decision_lookup.sql;
-- parent-reserved forward218 filename. No existing migration was rewritten.
-- F6 first slice ONLY: authenticated readback of an immutable accepted original.
-- No event admission, terminal denial, retention/eviction, new kind or activation.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';

create function public.custodial_native_provider_event_decisions(p_credential uuid,p_credential_hash text,
 p_native_request uuid,p_attestation_digest text,p_raw_body_sha256 text,p_body jsonb)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog,public as $fn$
declare d public.devices%rowtype;c public.device_auth_credentials%rowtype;
 current_g public.employee_native_push_generations%rowtype;g public.employee_native_push_generations%rowtype;
 registration public.employee_push_registrations%rowtype;r public.employee_native_push_delivery_receipts%rowtype;
 prior public.employee_native_provider_events%rowtype;
 requester jsonb;e jsonb;payload jsonb;results jsonb:='[]';field text;at_time timestamptz;
 current_ok boolean;original_ok boolean;
begin
 -- The service-only HTTP adapter verifies the CURRENT credential and fresh
 -- path/method/nonce/timestamp/raw-body HMAC before this RPC. The exact request
 -- nonce and raw digest are echoed, not promoted to a time anchor or receipt.
 if p_credential is null or p_native_request is null or coalesce(p_credential_hash,'') !~ '^[0-9a-f]{64}$'
  or coalesce(p_attestation_digest,'') !~ '^[0-9a-f]{64}$' or coalesce(p_raw_body_sha256,'') !~ '^[0-9a-f]{64}$'
  or jsonb_typeof(p_body) is distinct from 'object' or octet_length(p_body::text)>65536
  or (select array_agg(key order by key) from jsonb_object_keys(p_body) key) is distinct from array['events','requester','schema']
  or p_body->>'schema' is distinct from 'custodial.native-provider-event-decision-query.v1'
  or jsonb_typeof(p_body->'events') is distinct from 'array' or jsonb_array_length(p_body->'events') not between 1 and 16 then
  raise exception 'exact native original event query required' using errcode='22023';end if;
 requester:=p_body->'requester';
 if jsonb_typeof(requester) is distinct from 'object' or
  (select array_agg(key order by key) from jsonb_object_keys(requester) key) is distinct from
   array['assignment_epoch','credential_id','current_generation_id','device_id','employee_id','principal_digest','token_digest'] then
  raise exception 'exact native current requester required' using errcode='22023';end if;
 foreach field in array array['credential_id','current_generation_id','employee_id'] loop
  if jsonb_typeof(requester->field) is distinct from 'string' or requester->>field !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then
   raise exception 'exact native requester UUID required' using errcode='22023';end if;
 end loop;
 foreach field in array array['principal_digest','token_digest'] loop
  if jsonb_typeof(requester->field) is distinct from 'string' or requester->>field !~ '^[0-9a-f]{64}$' then
   raise exception 'exact native requester digest required' using errcode='22023';end if;
 end loop;
 if requester->>'credential_id' is distinct from p_credential::text or jsonb_typeof(requester->'device_id') is distinct from 'string'
  or requester->>'device_id' !~ '^KIOSK_(0[2-9]|10)$' or jsonb_typeof(requester->'assignment_epoch') is distinct from 'number'
  or requester->>'assignment_epoch' !~ '^[1-9][0-9]{0,15}$' or (requester->>'assignment_epoch')::numeric>9007199254740991 then
  raise exception 'exact native requester identity required' using errcode='22023';end if;
 for e in select value from jsonb_array_elements(p_body->'events') loop
  perform public.custodial_native_provider_event_shape(e);
  if e->>'receipt_credential_id' is distinct from requester->>'credential_id'
   or e->>'receipt_employee_id' is distinct from requester->>'employee_id'
   or e->>'receipt_device_id' is distinct from requester->>'device_id'
   or e->'receipt_assignment_epoch' is distinct from requester->'assignment_epoch'
   or e->>'principal_digest' is distinct from requester->>'principal_digest' then
   raise exception 'one exact original query principal required' using errcode='22023';end if;
 end loop;
 if (select count(distinct x->>'event_id') from jsonb_array_elements(p_body->'events') x)<>jsonb_array_length(p_body->'events')
  or (select count(distinct (x->>'record_id',x->>'action')) from jsonb_array_elements(p_body->'events') x)<>jsonb_array_length(p_body->'events') then
  raise exception 'unique original events and transitions required' using errcode='22023';end if;

 -- Existing authority order: global -> device -> credential -> employee ->
 -- registrations -> generations -> original reservations. SHARE locks prevent
 -- a current binding from being revoked between check and readback. No network
 -- and no INSERT/UPDATE/DELETE or application-mutation/control call occurs here.
 perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 select d0.* into d from public.devices d0 join public.device_auth_credentials c0 on c0.device_id=d0.id
  where c0.credential_id=p_credential for share of d0;
 select * into c from public.device_auth_credentials where credential_id=p_credential for share;
 perform 1 from public.employees where id=d.assigned_employee_id for share;
 perform 1 from public.employee_push_registrations where device_id=d.id order by registration_id for share;
 perform 1 from public.employee_native_push_generations where generation_id=(requester->>'current_generation_id')::uuid
  or generation_id in(select (x->>'generation_id')::uuid from jsonb_array_elements(p_body->'events') x) order by generation_id for share;
 perform 1 from public.employee_native_push_delivery_receipts where job_id in
  (select (x->>'receipt_job_id')::uuid from jsonb_array_elements(p_body->'events') x) order by job_id for share;
 select * into current_g from public.employee_native_push_generations where generation_id=(requester->>'current_generation_id')::uuid;
 select * into registration from public.employee_push_registrations where registration_id=current_g.registration_id;
 at_time:=clock_timestamp();
 current_ok:=isfinite(at_time) and d.id is not null and d.active is true and c.device_id=d.id
  and c.token_hash=p_credential_hash and c.confirmed_at is not null and c.revoked_at is null and c.expires_at>at_time
  and requester->>'device_id'=d.device_id and requester->>'employee_id'=d.assigned_employee_id::text
  and requester->>'assignment_epoch'=d.assignment_epoch::text
  and exists(select 1 from public.employees where id=d.assigned_employee_id and active and employee_code ~ '^EMP[0-9]+$')
  and current_g.generation_id is not null and current_g.device_id=d.id and current_g.device_identifier=d.device_id
  and current_g.credential_id=c.credential_id and current_g.employee_id=d.assigned_employee_id and current_g.assignment_epoch=d.assignment_epoch
  and current_g.principal_digest=requester->>'principal_digest' and current_g.token_digest=requester->>'token_digest'
  and current_g.activated_at<=at_time and current_g.dispatch_retired_at is null and current_g.revoked_at is null
  and registration.registration_id is not null and registration.device_id=d.id and registration.credential_id=c.credential_id
  and registration.employee_id=d.assigned_employee_id and registration.assignment_epoch=d.assignment_epoch
  and registration.active is true and registration.revoked_at is null and registration.platform='android'
  and registration.token_hash=current_g.token_digest and public.static_weekly_digest_text(registration.fcm_token)=current_g.token_digest;
 for e in select value from jsonb_array_elements(p_body->'events') loop
  original_ok:=false;
  -- Denied current state deliberately does not disclose whether an event exists.
  if current_ok is true then
   select * into g from public.employee_native_push_generations where generation_id=(e->>'generation_id')::uuid;
   select * into r from public.employee_native_push_delivery_receipts where job_id=(e->>'receipt_job_id')::uuid;
   payload:=r.native_payload;
   original_ok:=g.generation_id is not null and g.device_id=d.id and g.device_identifier=d.device_id
    and g.credential_id=c.credential_id and g.employee_id=d.assigned_employee_id and g.assignment_epoch=d.assignment_epoch
    and g.principal_digest=requester->>'principal_digest' and g.token_digest=e->>'token_digest' and g.revoked_at is null
    and r.native_generation_id=g.generation_id and r.registration_id=g.registration_id and r.credential_id=c.credential_id
    and r.assignment_epoch=d.assignment_epoch and r.prepared_at>=g.activated_at and r.prepared_at<=at_time
    and (g.dispatch_retired_at is null or r.prepared_at<=g.dispatch_retired_at)
    and r.native_payload_sha256=payload->>'content_sha256' and r.token_hash=g.token_digest
    and (payload->>'schema'='custodial.native-location-payload.v2' or
      (payload->>'schema'='custodial.native-provider-payload.v1' and payload->>'kind'='employee_lunch_coverage'));
   foreach field in array array['generation_id','receipt_job_id','notification_key','receipt_credential_id','receipt_employee_id',
    'receipt_device_id','receipt_assignment_epoch','principal_digest','token_digest','content_sha256'] loop
    if e->>field is distinct from payload->>field then original_ok:=false;end if;
   end loop;
   select * into prior from public.employee_native_provider_events where event_id=(e->>'event_id')::uuid;
   original_ok:=original_ok and prior.event_id is not null and prior.original_event=e
    and prior.generation_id=g.generation_id and prior.job_id=r.job_id and prior.credential_id=c.credential_id
    and prior.record_id=e->>'record_id' and prior.action=e->>'action';
  end if;
  if original_ok is true then
   -- This is the immutable prior ACCEPTED fact, not a new effect. Business
   -- expiry/supersession cannot rewrite it; supported same-principal rotation
   -- keeps the ORIGINAL generation/token/observation/server receipt unchanged.
   results:=results||jsonb_build_array(jsonb_build_object('event_id',e->>'event_id','decision','ORIGINAL_ACCEPTED',
    'receipt',prior.original_event||jsonb_build_object('schema','custodial.native-provider-event-receipt.v2',
     'admitted_state','ACCEPTED','server_received_at',public.custodial_native_location_utc(prior.server_received_at),'replayed',true)));
  else
   results:=results||jsonb_build_array(jsonb_build_object('event_id',e->>'event_id','decision','UNRESOLVED'));
  end if;
 end loop;
 return jsonb_build_object('ok',true,'data',jsonb_build_object('schema','custodial.native-provider-event-decisions.v1',
  'native_request_id',p_native_request::text,'request_body_sha256',p_raw_body_sha256,'requester',requester,'results',results));
end $fn$;

revoke all on function public.custodial_native_provider_event_decisions(uuid,text,uuid,text,text,jsonb)
 from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,
 custodial_application_reader,static_weekly_runtime_20260823;
grant execute on function public.custodial_native_provider_event_decisions(uuid,text,uuid,text,text,jsonb) to service_role;

-- Capture ONLY the new function and its explicit ACL; no surviving inventory
-- becomes the intended membership list and no existing drift is recaptured.
lock table public.custodial_release_authority_restore_inventory in share row exclusive mode;
do $capture$
declare obj record;next_order integer;
begin
 if not exists(select 1 from pg_trigger where tgrelid='public.custodial_release_authority_restore_inventory'::regclass
  and tgname='trg_custodial_release_authority_restore_inventory_immutable' and tgenabled='O') then
  raise exception 'Native decision recovery immutability changed';end if;
 if exists(select 1 from public.custodial_release_authority_restore_inventory where object_kind in ('function','grant')
  and case when position('(' in object_identity)>0 then to_regprocedure(object_identity) end
   ='public.custodial_native_provider_event_decisions(uuid,text,uuid,text,text,jsonb)'::regprocedure) then
  raise exception 'Native decision recovery identity already exists';end if;
 alter table public.custodial_release_authority_restore_inventory disable trigger trg_custodial_release_authority_restore_inventory_immutable;
 for obj in select * from (values
  (100000,'function','public.custodial_native_provider_event_decisions(uuid,text,uuid,text,text,jsonb)',
   pg_get_functiondef('public.custodial_native_provider_event_decisions(uuid,text,uuid,text,text,jsonb)'::regprocedure)),
  (900000,'grant','public.custodial_native_provider_event_decisions(uuid,text,uuid,text,text,jsonb)',
   public.custodial_release_authority_current_grant_definition('public.custodial_native_provider_event_decisions(uuid,text,uuid,text,text,jsonb)'))
 ) x(bucket,kind,identity,definition) loop
  if obj.definition is null then raise exception 'Native decision recovery definition absent';end if;
  select n into next_order from generate_series(obj.bucket+1,obj.bucket+99998) n
   where not exists(select 1 from public.custodial_release_authority_restore_inventory where restore_order=n) order by n limit 1;
  if next_order is null then raise exception 'Native decision recovery order exhausted';end if;
  insert into public.custodial_release_authority_restore_inventory(restore_order,object_kind,object_identity,definition_sql,definition_sha256)
   values(next_order,obj.kind,obj.identity,obj.definition,public.static_weekly_digest_text(obj.definition));
 end loop;
 alter table public.custodial_release_authority_restore_inventory enable trigger trg_custodial_release_authority_restore_inventory_immutable;
end $capture$;

-- Exact rendered predecessor from the owned216 NORMAL inventory; all216 source
-- migration hashes are unchanged at217, whose named-handoff patch does not
-- alter this function. Hash mismatch is fatal, never silently recaptured.
do $surface$
declare prior_definition text;next_definition text;prior_grant text;matched integer;updated integer;
 additions text:=E'    (''function'',''public.custodial_native_provider_event_decisions(uuid,text,uuid,text,text,jsonb)'',''original accepted native event lookup''),\n    (''grant'',''public.custodial_native_provider_event_decisions(uuid,text,uuid,text,text,jsonb)'',''server-only original event lookup ACL''),\n';
begin
 prior_definition:=pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure);
 prior_grant:=public.custodial_release_authority_current_grant_definition('custodial_release_canary_authority_surface()');
 if public.static_weekly_digest_text(prior_definition) is distinct from '661cd2a5aecc83d0244920466b161b6fc52d22143074a037148660abed351471'
  or prior_grant is null or (length(prior_definition)-length(replace(prior_definition,'  values','')))/length('  values')<>1 then
  raise exception 'Native decision surface predecessor changed';end if;
 select count(*) into matched from public.custodial_release_authority_restore_inventory i where i.object_kind='function'
  and case when i.object_kind='function' then to_regprocedure(i.object_identity) end='public.custodial_release_canary_authority_surface()'::regprocedure;
 if matched<>1 or exists(select 1 from public.custodial_release_authority_restore_inventory i where i.object_kind='function'
  and case when i.object_kind='function' then to_regprocedure(i.object_identity) end='public.custodial_release_canary_authority_surface()'::regprocedure
  and (i.definition_sql is distinct from prior_definition or i.definition_sha256 is distinct from public.static_weekly_digest_text(prior_definition))) then
  raise exception 'Native decision surface recovery predecessor changed';end if;
 if exists(select 1 from public.custodial_release_canary_authority_surface() where object_kind in ('function','grant')
  and case when position('(' in object_identity)>0 then to_regprocedure(object_identity) end
   ='public.custodial_native_provider_event_decisions(uuid,text,uuid,text,text,jsonb)'::regprocedure) then
  raise exception 'Native decision surface already includes new identity';end if;
 execute replace(prior_definition,'  values',E'  values\n'||additions);
 next_definition:=pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure);
 if next_definition is distinct from replace(prior_definition,'  values',E'  values\n'||additions)
  or public.custodial_release_authority_current_grant_definition('custodial_release_canary_authority_surface()') is distinct from prior_grant then
  raise exception 'Native decision surface delta or ACL changed';end if;
 alter table public.custodial_release_authority_restore_inventory disable trigger trg_custodial_release_authority_restore_inventory_immutable;
 update public.custodial_release_authority_restore_inventory set definition_sql=next_definition,
  definition_sha256=public.static_weekly_digest_text(next_definition),captured_at=statement_timestamp()
  where object_kind='function' and case when object_kind='function' then to_regprocedure(object_identity) end
   ='public.custodial_release_canary_authority_surface()'::regprocedure and definition_sql=prior_definition
   and definition_sha256=public.static_weekly_digest_text(prior_definition);
 get diagnostics updated=row_count;
 if updated<>matched then raise exception 'Native decision surface recovery update count changed';end if;
 alter table public.custodial_release_authority_restore_inventory enable trigger trg_custodial_release_authority_restore_inventory_immutable;
end $surface$;
commit;
