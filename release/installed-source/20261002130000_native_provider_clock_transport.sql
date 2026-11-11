-- CLI-created 20261002064024, ordered 130000 by the release owner to avoid
-- concurrent Events140000/Feedback150000 writers. Unmounted transport prerequisite.
-- Fresh transport clock is NOT a device qualification or provider effect authority.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
set local search_path=pg_catalog,public,extensions;

create function public.custodial_native_provider_registration_clock(
 p_credential uuid,p_credential_hash text,p_native_request uuid,p_attestation_digest text,p_body jsonb,p_status boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare admission jsonb; sampled_at timestamptz; expires timestamptz;
begin
 -- Existing proof validates exact native request, full current recipient and secret
 -- hash, then takes device -> credential -> registration -> generation locks.
 -- It obeys the mutation fence and keeps every original admission fact immutable.
 admission:=public.custodial_native_provider_registration(p_credential,p_credential_hash,p_native_request,p_attestation_digest,p_body,p_status);
 -- Read AFTER proof, never transaction_timestamp/now, activation time or a cached
 -- inventory ceiling. The locked credential cannot be concurrently revoked here.
 sampled_at:=clock_timestamp();
 select c.expires_at into strict expires from public.device_auth_credentials c where c.credential_id=p_credential;
 if not isfinite(sampled_at) or expires is null or expires<=sampled_at or (admission->>'server_now')::timestamptz>sampled_at then
  raise exception 'native provider clock unavailable' using errcode='42501';
 end if;
 return jsonb_build_object('data',admission,'clock',jsonb_build_object(
  'native_request_id',p_native_request::text,
  'server_now',to_char(sampled_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'valid_until',to_char(least(sampled_at+interval '15 minutes',expires) at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')));
end $fn$;
revoke all on function public.custodial_native_provider_registration_clock(uuid,text,uuid,text,jsonb,boolean)
 from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader,static_weekly_runtime_20260823;
grant execute on function public.custodial_native_provider_registration_clock(uuid,text,uuid,text,jsonb,boolean) to service_role;
comment on function public.custodial_native_provider_registration_clock(uuid,text,uuid,text,jsonb,boolean) is
 'Service-only exact native register/status wrapper. Clock block is fresh per attested request, separate from immutable admission; not QP-01 or dispatch/delivery authority.';

-- Only the two new owning objects; no recapture/approval of unrelated catalog drift.
lock table public.custodial_release_authority_restore_inventory in share row exclusive mode;
do $recovery$
declare identity text:='public.custodial_native_provider_registration_clock(uuid,text,uuid,text,jsonb,boolean)'; kind text; definition text; bucket integer; next_order integer;
begin
 if not exists(select 1 from pg_trigger where tgrelid='public.custodial_release_authority_restore_inventory'::regclass
  and tgname='trg_custodial_release_authority_restore_inventory_immutable' and tgenabled='O') then raise exception 'recovery immutability unavailable';end if;
 alter table public.custodial_release_authority_restore_inventory disable trigger trg_custodial_release_authority_restore_inventory_immutable;
 foreach kind in array array['function','grant'] loop
  if exists(select 1 from public.custodial_release_authority_restore_inventory i where i.object_kind=kind and i.object_identity like '%(%' and to_regprocedure(i.object_identity)=identity::regprocedure)
   then raise exception 'new native clock recovery identity already captured';end if;
  definition:=case kind when 'function' then pg_get_functiondef(identity::regprocedure) else public.custodial_release_authority_current_grant_definition(identity) end;
  if definition is null then raise exception 'native clock recovery definition missing';end if;
  bucket:=case kind when 'function' then 100000 else 900000 end;
  select coalesce(max(restore_order),bucket)+1 into next_order from public.custodial_release_authority_restore_inventory where restore_order>=bucket and restore_order<bucket+100000;
  insert into public.custodial_release_authority_restore_inventory(restore_order,object_kind,object_identity,definition_sql,definition_sha256)
   values(next_order,kind,identity,definition,public.static_weekly_digest_text(definition));
 end loop;
 alter table public.custodial_release_authority_restore_inventory enable trigger trg_custodial_release_authority_restore_inventory_immutable;
end $recovery$;
commit;
