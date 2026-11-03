-- Proposed guarded successor component; Main owns canonical integration.
-- Legacy named credentials keep their original FK and actor checks. Cohort
-- links reference real registrations; public-token reads never bind or invent
-- a signed manager request. Run after coverall-accepted-period.sql.
begin;
set local lock_timeout='5s';set local statement_timeout='30s';
lock table public.custodial_release_authority_restore_inventory in access exclusive mode;
create temporary table coverall_cohort_recovery_before on commit drop as table public.custodial_release_authority_restore_inventory;
create temporary table coverall_cohort_function_before on commit drop as
 select oid,proowner,proacl from pg_proc where oid=any(array[
 'public.static_weekly_issue_coverall_link(uuid,uuid,text,text,uuid,text,jsonb,integer)'::regprocedure,
 'public.static_weekly_read_coverall_link(text)'::regprocedure,
 'public.static_weekly_revoke_coverall_link(uuid,uuid,text,text,uuid)'::regprocedure]);
do $predecessors$
begin
 if public.static_weekly_digest_text((select prosrc from pg_proc where oid='public.static_weekly_issue_coverall_link(uuid,uuid,text,text,uuid,text,jsonb,integer)'::regprocedure))<>'a05e7a46783523470e0d540cc6d9a8164a8b1f9a0d9529e5b94195cd15493b71' then raise exception 'Unexpected issue CoverAll predecessor';end if;
 if public.static_weekly_digest_text((select prosrc from pg_proc where oid='public.static_weekly_read_coverall_link(text)'::regprocedure))<>'925646046ac270fab1967e2030f83dcb50e1bc208319a8c19b5a5bafd014b554' then raise exception 'Unexpected read CoverAll predecessor';end if;
 if public.static_weekly_digest_text((select prosrc from pg_proc where oid='public.static_weekly_revoke_coverall_link(uuid,uuid,text,text,uuid)'::regprocedure))<>'e53d4b2049983a2d3d4adc2280fc45947dacbc9f39fd02e3d21cd050d6decb94' then raise exception 'Unexpected revoke CoverAll predecessor';end if;
 if exists(select 1 from coverall_cohort_function_before b where
  (select count(*) from public.custodial_release_authority_restore_inventory i where case when i.object_kind='function' then to_regprocedure(i.object_identity) end=b.oid and i.definition_sql=pg_get_functiondef(b.oid)
   and i.definition_sha256=public.static_weekly_digest_text(pg_get_functiondef(b.oid)))<>1) then
  raise exception 'Exact prior CoverAll recovery definitions required';end if;
 if exists(select 1 from information_schema.columns where table_schema='public' and table_name='static_weekly_coverall_access_links' and column_name like 'cohort_%')
  or to_regprocedure('custodial_leadership_private.coverall_link_issuer(uuid,uuid,text,text,uuid,uuid,integer,integer)') is not null then
  raise exception 'Unexpected CoverAll cohort successor state';end if;
end $predecessors$;
alter table public.static_weekly_coverall_access_links
 alter column credential_id drop not null,
 add column cohort_registration_id uuid references custodial_leadership_private.registrations(registration_id),
 add column cohort_claimed_account_id uuid references public.ops_manager_managers(manager_id),
 add column cohort_policy_version integer,
 add column cohort_security_epoch integer,
 add column cohort_request_id uuid,
 add column cohort_revoked_registration_id uuid references custodial_leadership_private.registrations(registration_id),
 add column cohort_revoked_claimed_account_id uuid references public.ops_manager_managers(manager_id),
 add column cohort_revoked_request_id uuid,
 add constraint coverall_exact_credential_kind check(
  (credential_id is not null and cohort_registration_id is null and cohort_claimed_account_id is null
   and cohort_policy_version is null and cohort_security_epoch is null and cohort_request_id is null)
  or (credential_id is null and cohort_registration_id is not null and cohort_claimed_account_id is not null
   and cohort_policy_version is not null and cohort_policy_version>0
   and cohort_security_epoch is not null and cohort_security_epoch>0 and cohort_request_id is not null
   and session_access='full_access')),
 add constraint coverall_exact_revocation_actor check(
  (cohort_revoked_registration_id is null and cohort_revoked_claimed_account_id is null and cohort_revoked_request_id is null)
  or (revoked_at is not null and cohort_revoked_registration_id is not null and cohort_revoked_claimed_account_id is not null
   and cohort_revoked_request_id is not null));

create function custodial_leadership_private.coverall_link_issuer(
 p_manager uuid,p_credential uuid,p_device text,p_access text,p_registration uuid,p_claim uuid,p_policy integer,p_epoch integer
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $issuer$
declare actor jsonb;view jsonb;
begin
 perform public.static_weekly_v3_assert_control_plane();
 if p_registration is null then
  -- Preserve the exact named-manager permission/revocation semantics.
  actor:=public.custodial_action_actor_v1(p_manager,p_credential,p_device,p_access,'manage_coverall');
  return jsonb_build_object('managerId',p_manager,'managerName',actor->>'manager_name');
 end if;
 view:=custodial_leadership_private.session_view(p_registration);
 if p_credential is not null or p_access is distinct from 'full_access' or view is null
  or view->>'registrationId' is distinct from p_registration::text
  or view->>'browserId' is distinct from p_device
  or view#>>'{cohort,principalId}' is distinct from p_manager::text
  or view#>>'{claimedAccount,accountId}' is distinct from p_claim::text
  or (view#>>'{cohort,policyVersion}')::integer is distinct from p_policy
  or (view#>>'{cohort,securityEpoch}')::integer is distinct from p_epoch
  or (view#>'{cohort,permissions}' ? 'custodialManagementAdmin') is not true then
  raise exception using errcode='42501',message='CoverAll original cohort credential changed or was revoked';end if;
 return jsonb_build_object('managerId',p_manager,'managerName','Custodial leadership cohort',
  'actorKind','CUSTODIAL_LEADERSHIP_COHORT','identityAssurance','SELF_ASSERTED_NAME','individualIdentityVerified',false,
  'claimedAccountId',p_claim,'claimedName',view#>>'{claimedAccount,displayName}');
end $issuer$;
revoke all on function custodial_leadership_private.coverall_link_issuer(uuid,uuid,text,text,uuid,uuid,integer,integer)
 from public,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator;

create or replace function public.static_weekly_issue_coverall_link(
 p_manager uuid,p_credential uuid,p_device text,p_access text,p_link uuid,p_token_hash text,p_binding jsonb,p_ttl integer
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare actor jsonb;basis jsonb;created timestamptz;expires timestamptz;view jsonb;registration uuid;
begin
 perform public.static_weekly_v3_assert_control_plane();
 perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 actor:=public.custodial_action_actor_v1(p_manager,p_credential,p_device,p_access,'manage_coverall');
 if p_link is null or coalesce(p_token_hash,'')!~'^[a-f0-9]{64}$' or p_ttl is null or p_ttl not between 1 and 168 then
  raise exception using errcode='22023',message='Bounded canonical CoverAll issuance required';end if;
 basis:=public.static_weekly_assert_coverall_link_basis(p_binding);
 actor:=public.custodial_action_actor_v1(p_manager,p_credential,p_device,p_access,'manage_coverall');
 if actor->>'actor_kind'='CUSTODIAL_LEADERSHIP_COHORT' then
  registration:=p_credential;view:=custodial_leadership_private.session_view(registration);
  perform custodial_leadership_private.coverall_link_issuer(p_manager,null,p_device,p_access,registration,
   (actor->>'claimed_account_id')::uuid,(actor->>'policy_version')::integer,(view#>>'{cohort,securityEpoch}')::integer);
 end if;
 created:=clock_timestamp();expires:=created+make_interval(hours=>p_ttl);
 -- The once-only request ID is scoped to the server-derived issuing manager.
 -- Another manager may use/revoke the same nonsecret UUID without interference.
 insert into public.static_weekly_coverall_access_links(link_id,token_hash,binding,source_id,source_digest,manager_id,credential_id,device_id,session_access,created_at,expires_at,cohort_registration_id,cohort_claimed_account_id,cohort_policy_version,cohort_security_epoch,cohort_request_id)
 values(p_link,p_token_hash,p_binding,(basis->>'source_id')::uuid,basis->>'source_digest',p_manager,case when registration is null then p_credential end,p_device,p_access,created,expires,
  registration,case when registration is not null then (actor->>'claimed_account_id')::uuid end,
  case when registration is not null then (actor->>'policy_version')::integer end,
  case when registration is not null then (view#>>'{cohort,securityEpoch}')::integer end,
  case when registration is not null then (actor->>'request_id')::uuid end);
 return jsonb_build_object('link_id',p_link,'expires_at',expires);
end $fn$;

create or replace function public.static_weekly_read_coverall_link(p_token_hash text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare link public.static_weekly_coverall_access_links%rowtype;issuer jsonb;
begin
 perform public.static_weekly_v3_assert_control_plane();
 perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 if coalesce(p_token_hash,'')!~'^[a-f0-9]{64}$' then raise exception using errcode='42501',message='CoverAll link unavailable';end if;
 select * into link from public.static_weekly_coverall_access_links where token_hash=p_token_hash for share;
 if not found or link.revoked_at is not null or link.expires_at<=clock_timestamp() then
  raise exception using errcode='42501',message='CoverAll link unavailable';end if;
 issuer:=custodial_leadership_private.coverall_link_issuer(link.manager_id,link.credential_id,link.device_id,link.session_access,
  link.cohort_registration_id,link.cohort_claimed_account_id,link.cohort_policy_version,link.cohort_security_epoch);
 perform public.static_weekly_assert_coverall_link_basis(link.binding,link.source_id,link.source_digest);
 if link.expires_at<=clock_timestamp() then raise exception using errcode='42501',message='CoverAll link unavailable';end if;
 issuer:=custodial_leadership_private.coverall_link_issuer(link.manager_id,link.credential_id,link.device_id,link.session_access,
  link.cohort_registration_id,link.cohort_claimed_account_id,link.cohort_policy_version,link.cohort_security_epoch);
 if link.expires_at<=clock_timestamp() then raise exception using errcode='42501',message='CoverAll link unavailable';end if;
 return jsonb_build_object('schema','custodial.coverall-canonical-access.v1','binding',link.binding,
  'issuing_manager',issuer);
end $fn$;

create or replace function public.static_weekly_revoke_coverall_link(p_manager uuid,p_credential uuid,p_device text,p_access text,p_link uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare actor jsonb;link public.static_weekly_coverall_access_links%rowtype;view jsonb;registration uuid;
begin
 perform public.static_weekly_v3_assert_control_plane();
 perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 actor:=public.custodial_action_actor_v1(p_manager,p_credential,p_device,p_access,'manage_coverall');
 select * into link from public.static_weekly_coverall_access_links where manager_id=p_manager and link_id=p_link for update;
 -- Capture FOUND before rechecking current credential after a possible row wait.
 if found then
  actor:=public.custodial_action_actor_v1(p_manager,p_credential,p_device,p_access,'manage_coverall');
 else
  actor:=public.custodial_action_actor_v1(p_manager,p_credential,p_device,p_access,'manage_coverall');
  if actor->>'actor_kind'='CUSTODIAL_LEADERSHIP_COHORT' then
   registration:=p_credential;view:=custodial_leadership_private.session_view(registration);
   perform custodial_leadership_private.coverall_link_issuer(p_manager,null,p_device,p_access,registration,
    (actor->>'claimed_account_id')::uuid,(actor->>'policy_version')::integer,(view#>>'{cohort,securityEpoch}')::integer);
  end if;
  -- Durable nonsecret tombstone settles an unknown issuance and prevents a
  -- delayed original POST from creating this request after revocation ACK.
  insert into public.static_weekly_coverall_access_links(link_id,token_hash,binding,manager_id,credential_id,device_id,session_access,created_at,expires_at,revoked_at,revoked_by,cohort_registration_id,cohort_claimed_account_id,cohort_policy_version,cohort_security_epoch,cohort_request_id,cohort_revoked_registration_id,cohort_revoked_claimed_account_id,cohort_revoked_request_id)
   values(p_link,public.static_weekly_digest_text('revoked-coverall-request:'||p_manager::text||':'||p_link::text),'{}'::jsonb,p_manager,case when registration is null then p_credential end,p_device,p_access,
    statement_timestamp(),statement_timestamp()+interval '1 second',statement_timestamp(),p_manager,
    registration,case when registration is not null then (actor->>'claimed_account_id')::uuid end,
    case when registration is not null then (actor->>'policy_version')::integer end,
    case when registration is not null then (view#>>'{cohort,securityEpoch}')::integer end,
    case when registration is not null then (actor->>'request_id')::uuid end,
    registration,case when registration is not null then (actor->>'claimed_account_id')::uuid end,
    case when registration is not null then (actor->>'request_id')::uuid end);
  return jsonb_build_object('link_id',p_link,'revoked',true);
 end if;
 -- Revocation is exact issuer scope. Cross-issuer administrative revocation
 -- requires a separate explicit issuer context, never a guessed request ID.
 update public.static_weekly_coverall_access_links set revoked_at=coalesce(revoked_at,clock_timestamp()),revoked_by=coalesce(revoked_by,p_manager),
  cohort_revoked_registration_id=case when revoked_at is null and actor->>'actor_kind'='CUSTODIAL_LEADERSHIP_COHORT' then p_credential else cohort_revoked_registration_id end,
  cohort_revoked_claimed_account_id=case when revoked_at is null and actor->>'actor_kind'='CUSTODIAL_LEADERSHIP_COHORT' then (actor->>'claimed_account_id')::uuid else cohort_revoked_claimed_account_id end,
  cohort_revoked_request_id=case when revoked_at is null and actor->>'actor_kind'='CUSTODIAL_LEADERSHIP_COHORT' then (actor->>'request_id')::uuid else cohort_revoked_request_id end
  where manager_id=p_manager and link_id=p_link;
 return jsonb_build_object('link_id',p_link,'revoked',true);
end $fn$;

do $authority_unchanged$
begin
 if exists(select 1 from coverall_cohort_function_before b join pg_proc p using(oid)
  where p.proowner is distinct from b.proowner or p.proacl is distinct from b.proacl) then
  raise exception 'CoverAll cohort successor changed existing function authority';end if;
 if has_function_privilege('static_weekly_control_plane','custodial_leadership_private.coverall_link_issuer(uuid,uuid,text,text,uuid,uuid,integer,integer)','EXECUTE') then
  raise exception 'Private CoverAll issuer resolver unexpectedly exposed';end if;
end $authority_unchanged$;
-- Bounded recovery closure follows in this same transaction.

create temporary table coverall_cohort_recovery(bucket integer,kind text,identity text,definition text,primary key(kind,identity)) on commit drop;
do $recovery$
declare rel text:='public.static_weekly_coverall_access_links';rid oid:=rel::regclass;
 sig text;obj record;next_order integer;surface_before text;surface text;new_roots text;affected integer;
begin
 insert into coverall_cohort_recovery values
  (1000,'relation',rel,public.custodial_release_authority_current_relation_definition(rel)),
  (300000,'column_set',rel,public.custodial_release_authority_current_column_set_definition(rel)),
  (400000,'relation_state',rel,public.custodial_release_authority_current_relation_state_definition(rel)),
  (900000,'grant',rel,public.custodial_release_authority_current_grant_definition(rel));
 insert into coverall_cohort_recovery select 200000,'column',rel||':'||attname,
  public.custodial_release_authority_current_column_definition(rel||':'||attname)
  from pg_attribute where attrelid=rid and attnum>0 and not attisdropped;
 insert into coverall_cohort_recovery select 500000,'constraint',rel||':'||conname,
  public.custodial_release_authority_current_constraint_definition(rel||':'||conname) from pg_constraint where conrelid=rid;
 foreach sig in array array[
  'public.static_weekly_issue_coverall_link(uuid,uuid,text,text,uuid,text,jsonb,integer)',
  'public.static_weekly_read_coverall_link(text)',
  'public.static_weekly_revoke_coverall_link(uuid,uuid,text,text,uuid)',
  'custodial_leadership_private.coverall_link_issuer(uuid,uuid,text,text,uuid,uuid,integer,integer)'
 ] loop
  insert into coverall_cohort_recovery values
   (100000,'function',sig::regprocedure::text,pg_get_functiondef(sig::regprocedure)),
   (1000000,'grant',sig::regprocedure::text,public.custodial_release_authority_current_grant_definition(sig::regprocedure::text));
 end loop;
 if exists(select 1 from coverall_cohort_recovery where definition is null or definition='') then raise exception 'CoverAll recovery renderer unavailable';end if;
 surface_before:=pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure);
 if (select count(*) from public.custodial_release_authority_restore_inventory
  where case when object_kind='function' then to_regprocedure(object_identity) end='public.custodial_release_canary_authority_surface()'::regprocedure
   and definition_sql=surface_before and definition_sha256=public.static_weekly_digest_text(surface_before))<>1 then
  raise exception 'Exact prior canary recovery definition required';end if;
 if length(surface_before)-length(replace(surface_before,'  values',''))<>length('  values') then raise exception 'Exact canary VALUES seam changed';end if;
 select string_agg(format('(%L,%L,%L),',kind,identity,'typed original CoverAll credential; cohort name remains self-asserted'),E'\n ' order by bucket,kind,identity)
 into new_roots from coverall_cohort_recovery where kind in('function','grant')
  and identity='custodial_leadership_private.coverall_link_issuer(uuid,uuid,text,text,uuid,uuid,integer,integer)';
 if new_roots is null then raise exception 'Private CoverAll recovery roots missing';end if;
 surface:=replace(surface_before,'  values','  values'||E'\n '||new_roots);execute surface;
 alter table public.custodial_release_authority_restore_inventory disable trigger trg_custodial_release_authority_restore_inventory_immutable;
 for obj in select * from coverall_cohort_recovery order by bucket,kind,identity loop
  if exists(select 1 from public.custodial_release_authority_restore_inventory where object_kind=obj.kind and object_identity=obj.identity) then
   update public.custodial_release_authority_restore_inventory set definition_sql=obj.definition,
    definition_sha256=public.static_weekly_digest_text(obj.definition),captured_at=statement_timestamp()
    where object_kind=obj.kind and object_identity=obj.identity and definition_sql is distinct from obj.definition;
  else
   select n into next_order from generate_series(obj.bucket+1,case when obj.bucket=1000 then 99999 else obj.bucket+99999 end) n
    where not exists(select 1 from public.custodial_release_authority_restore_inventory i where i.restore_order=n) order by n limit 1;
   if next_order is null then raise exception 'CoverAll recovery bucket exhausted';end if;
   insert into public.custodial_release_authority_restore_inventory(restore_order,object_kind,object_identity,definition_sql,definition_sha256)
    values(next_order,obj.kind,obj.identity,obj.definition,public.static_weekly_digest_text(obj.definition));
  end if;
 end loop;
 update public.custodial_release_authority_restore_inventory set
  definition_sql=pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure),
  definition_sha256=public.static_weekly_digest_text(pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure)),captured_at=statement_timestamp()
  where case when object_kind='function' then to_regprocedure(object_identity) end='public.custodial_release_canary_authority_surface()'::regprocedure;
 get diagnostics affected=row_count;if affected<>1 then raise exception 'Exact canary recovery row required';end if;
 alter table public.custodial_release_authority_restore_inventory enable always trigger trg_custodial_release_authority_restore_inventory_immutable;
 if exists(select 1 from coverall_cohort_recovery n left join public.custodial_release_authority_restore_inventory i
  on i.object_kind=n.kind and i.object_identity=n.identity where i.definition_sql is distinct from n.definition
   or i.definition_sha256 is distinct from public.static_weekly_digest_text(n.definition)) then raise exception 'CoverAll recovery readback mismatch';end if;
 if exists(select b.* from coverall_cohort_recovery_before b
   where not exists(select 1 from coverall_cohort_recovery n where n.kind=b.object_kind and n.identity=b.object_identity)
   and not(case when b.object_kind='function' then to_regprocedure(b.object_identity)='public.custodial_release_canary_authority_surface()'::regprocedure else false end)
   except select * from public.custodial_release_authority_restore_inventory) then raise exception 'Unrelated recovery membership changed';end if;
 if exists(select 1 from coverall_cohort_recovery n where n.kind in('relation','column_set','relation_state','function','grant')
  and not exists(select 1 from public.custodial_release_canary_authority_surface() s where s.object_kind=n.kind and s.object_identity=n.identity)) then raise exception 'CoverAll recovery canary roots missing';end if;
end $recovery$;
commit;
