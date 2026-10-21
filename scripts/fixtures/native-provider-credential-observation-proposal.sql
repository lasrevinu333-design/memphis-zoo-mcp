-- PROPOSAL ONLY: OUTSIDE MIGRATIONS, NOT EXECUTED, NOT MOUNTED.
-- Materialization is blocked until legitimate CLI ordering AFTER the current
-- 20261004000000 fixed canary predecessor writer. Never rename/invent a timestamp.
-- Negative credential fact only; CURRENT_AS_OF is NOT future/effect/clock authority.
-- No caller-supplied time, clock profile, expiry extension, cleanup or audio policy.

create function public.custodial_native_provider_credential_observation(
 p_credential uuid,p_credential_hash text,p_credential_secret_key_id text,
 p_native_request uuid,p_attestation_digest text,p_raw_body_sha256 text,p_body jsonb)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog,public as $fn$
declare d public.devices%rowtype;c public.device_auth_credentials%rowtype;
 g public.employee_native_push_generations%rowtype;r public.employee_push_registrations%rowtype;
 requester jsonb;field text;at_time timestamptz;decision text:='UNRESOLVED';
 observed text:=null;expiry text:=null;revocation text:=null;binding_ok boolean;current_ok boolean;
begin
 -- Service-only adapter has verified fresh path/method/nonce/raw-body HMAC.
 -- These digests are SERVER-derived; echo binding is not a clock sample.
 if p_credential is null or p_native_request is null
  or coalesce(p_credential_hash,'') !~ '^[0-9a-f]{64}$'
  or coalesce(p_credential_secret_key_id,'') !~ '^[0-9a-f]{64}$'
  or coalesce(p_attestation_digest,'') !~ '^[0-9a-f]{64}$'
  or coalesce(p_raw_body_sha256,'') !~ '^[0-9a-f]{64}$'
  or jsonb_typeof(p_body) is distinct from 'object' or octet_length(p_body::text)>65536 then
  raise exception 'exact credential observation proof required' using errcode='22023';end if;
 if (select array_agg(key order by key) from jsonb_object_keys(p_body) key) is distinct from array['requester','schema']
  or p_body->>'schema' is distinct from 'custodial.native-provider-credential-observation-query.v1' then
  raise exception 'exact credential observation query required' using errcode='22023';end if;
 requester:=p_body->'requester';
 if jsonb_typeof(requester) is distinct from 'object' then
  raise exception 'exact credential observation requester required' using errcode='22023';end if;
 if (select array_agg(key order by key) from jsonb_object_keys(requester) key) is distinct from
  array['assignment_epoch','credential_id','current_generation_id','device_id','employee_id','principal_digest','token_digest'] then
  raise exception 'exact credential observation requester required' using errcode='22023';end if;
 foreach field in array array['credential_id','current_generation_id','employee_id'] loop
  if jsonb_typeof(requester->field) is distinct from 'string' or requester->>field !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then
   raise exception 'exact native requester UUID required' using errcode='22023';end if;
 end loop;
 foreach field in array array['principal_digest','token_digest'] loop
  if jsonb_typeof(requester->field) is distinct from 'string' or requester->>field !~ '^[0-9a-f]{64}$' then
   raise exception 'exact native requester digest required' using errcode='22023';end if;
 end loop;
 if requester->>'credential_id' is distinct from p_credential::text
  or jsonb_typeof(requester->'device_id') is distinct from 'string' or requester->>'device_id' !~ '^KIOSK_(0[2-9]|10)$'
  or jsonb_typeof(requester->'assignment_epoch') is distinct from 'number' or requester->>'assignment_epoch' !~ '^[1-9][0-9]{0,15}$'
  or (requester->>'assignment_epoch')::numeric>9007199254740991 then
  raise exception 'exact native requester identity required' using errcode='22023';end if;

 -- Existing authority lock order. Read locks are data-nonmutating, NOT a claim
 -- that this function can execute in PostgreSQL transaction READ ONLY mode.
 perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 select d0.* into d from public.devices d0 join public.device_auth_credentials c0 on c0.device_id=d0.id
  where c0.credential_id=p_credential for share of d0;
 select * into c from public.device_auth_credentials where credential_id=p_credential for share;
 perform 1 from public.employees where id=d.assigned_employee_id for share;
 perform 1 from public.employee_push_registrations where device_id=d.id order by registration_id for share;
 perform 1 from public.employee_native_push_generations where device_id=d.id order by generation_id for share;
 select * into g from public.employee_native_push_generations where generation_id=(requester->>'current_generation_id')::uuid;
 select * into r from public.employee_push_registrations where registration_id=g.registration_id;

 binding_ok:=d.id is not null and d.active is true and c.credential_id=p_credential and c.device_id=d.id
  and c.token_hash=p_credential_hash and c.confirmed_at is not null
  and (c.metadata_json is null or jsonb_typeof(c.metadata_json)='object')
  and (not(coalesce(c.metadata_json,'{}'::jsonb) ? 'credential_secret_key_id') or
   (jsonb_typeof(c.metadata_json->'credential_secret_key_id')='string'
    and c.metadata_json->>'credential_secret_key_id'=p_credential_secret_key_id))
  and requester->>'device_id'=d.device_id and requester->>'employee_id'=d.assigned_employee_id::text
  and requester->>'assignment_epoch'=d.assignment_epoch::text
  and exists(select 1 from public.employees where id=d.assigned_employee_id and active and employee_code ~ '^EMP[0-9]+$')
  and g.generation_id is not null and g.device_id=d.id and g.device_identifier=d.device_id
  and g.credential_id=c.credential_id and g.employee_id=d.assigned_employee_id and g.assignment_epoch=d.assignment_epoch
  and g.principal_digest=requester->>'principal_digest' and g.token_digest=requester->>'token_digest'
  and r.registration_id is not null and r.device_id=d.id and r.credential_id=c.credential_id
  and r.employee_id=d.assigned_employee_id and r.assignment_epoch=d.assignment_epoch and r.platform='android'
  and r.token_hash=g.token_digest and public.static_weekly_digest_text(r.fcm_token)=g.token_digest
  and not exists(select 1 from public.employee_native_push_generations successor where successor.device_id=d.id
   and successor.generation_id<>g.generation_id and successor.dispatch_retired_at is null and successor.revoked_at is null);
 -- Reassignment, secret/token rotation and contradictory/missing lineage yield
 -- UNRESOLVED. Only the credential row can establish credential revocation.
 if binding_ok is true then
  at_time:=clock_timestamp();
  if isfinite(at_time) and isfinite(c.expires_at) and isfinite(c.confirmed_at) and c.confirmed_at<=at_time
   and isfinite(g.activated_at) and g.activated_at<=at_time
   and (c.revoked_at is null or (isfinite(c.revoked_at) and c.revoked_at<=at_time)) then
   current_ok:=c.revoked_at is null and c.expires_at>at_time and g.dispatch_retired_at is null and g.revoked_at is null
    and r.active is true and r.revoked_at is null;
   if c.revoked_at is not null then decision:='REVOKED_AS_OF';
   elsif c.expires_at<=at_time then decision:='EXPIRED_AS_OF';
   elsif current_ok is true then decision:='CURRENT_AS_OF';end if;
   if decision<>'UNRESOLVED' then
    observed:=public.custodial_native_location_utc(at_time);
    expiry:=public.custodial_native_location_utc(c.expires_at);
    revocation:=case when c.revoked_at is null then null else public.custodial_native_location_utc(c.revoked_at) end;
   end if;
  end if;
 end if;
 return jsonb_build_object('ok',true,'data',jsonb_build_object('schema','custodial.native-provider-credential-observation.v1',
  'native_request_id',p_native_request::text,'request_body_sha256',p_raw_body_sha256,'requester',requester,
  'decision',decision,'observed_at',observed,'credential_expires_at',expiry,'credential_revoked_at',revocation));
end $fn$;

revoke all on function public.custodial_native_provider_credential_observation(uuid,text,text,uuid,text,text,jsonb)
 from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,
 custodial_application_reader,static_weekly_runtime_20260823;
grant execute on function public.custodial_native_provider_credential_observation(uuid,text,text,uuid,text,text,jsonb) to service_role;

-- NOT EXECUTABLE RECOVERY SPECIFICATION: materialization is a separate root gate.
-- Exact new members (and ONLY these two):
-- function public.custodial_native_provider_credential_observation(uuid,text,text,uuid,text,text,jsonb)
-- grant public.custodial_native_provider_credential_observation(uuid,text,text,uuid,text,text,jsonb)
-- Capture pg_get_functiondef and current_grant_definition under exact identity;
-- assert absent both aliases/OIDs, immutable inventory trigger O, available finite
-- function/grant restore-order slots, complete old inventory/ACL preservation.
-- Guard canary predecessor by independently pinned exact current definition:
-- current 04000000 input661cd2a5aecc83d0244920466b161b6fc52d22143074a037148660abed351471;
-- independently source-derived current output:
-- 4f2cac31af750c5bc10a50445583b27ae2c6e67b0f66fe72c078b53c533d00db.
-- Revalidate that exact preimage and every later writer before materialization.
-- Augment only its exact values insertion with those two literal members, update
-- only the matching canary function recovery row, preserve its ACL/all prior rows.
-- No broad recapture, membership learned from survivors, helper/table/RLS grant.
-- Required later actual proof: intended service/denied roles, all protected rows
-- byte-identical, before/after owner/secret/token race, new body+ACL drift/restore,
-- full final migration and every later canary guard under no automatic grants.
