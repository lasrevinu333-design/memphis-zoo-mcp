-- Private assigned-phone transport. Browser request/status never exposes a
-- bootstrap secret; only the frozen named-manager maintenance claimant may
-- retrieve the same encrypted operation token. No phone data is reset.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';

create table public.custodial_assigned_activation_operations (
 operation_id uuid primary key,
 device_id uuid not null references public.devices(id),
 canonical_device_id text not null,
 expected_employee_id uuid not null references public.employees(id),
 expected_assignment_epoch bigint not null check(expected_assignment_epoch>0),
 requested_action text not null check(requested_action='activate_or_recover'),
 requester_manager_id uuid not null references public.ops_manager_managers(manager_id),
 requester_credential_id uuid not null references public.ops_manager_trusted_devices(credential_id),
 approved_serial_sha256 text not null check(approved_serial_sha256 ~ '^[0-9a-f]{64}$'),
 claimant_credential_id uuid references public.ops_manager_trusted_devices(credential_id),
 claimant_device_id text,
 client_version text,
 enrollment_id uuid references public.device_auth_enrollment_codes(enrollment_id),
 token_envelope jsonb,
 state text not null default 'requested' check(state in
  ('requested','prepared','delivered','delivery_unknown','native_active','not_required','error','expired','cancelled')),
 state_version integer not null default 1 check(state_version>0),
 attempts integer not null default 0 check(attempts between 0 and 5),
 last_error_code text check(last_error_code is null or last_error_code ~ '^[a-z0-9_]{1,80}$'),
 native_receipt jsonb,
 requested_at timestamptz not null default now(),
 prepared_at timestamptz,
 delivered_at timestamptz,
 terminal_at timestamptz,
 expires_at timestamptz not null default (now()+interval '25 minutes'),
 constraint assigned_activation_bounded_expiry check(expires_at>requested_at and expires_at<=requested_at+interval '25 minutes'),
 constraint assigned_activation_claim_complete check(
  (claimant_credential_id is null and claimant_device_id is null and client_version is null and enrollment_id is null)
  or (claimant_credential_id is not null and claimant_device_id is not null and client_version is not null and enrollment_id is not null)),
 constraint assigned_activation_secret_lifecycle check(
  (state in ('prepared','delivered','delivery_unknown') and token_envelope is not null and jsonb_typeof(token_envelope)='object')
  or (state not in ('prepared','delivered','delivery_unknown') and token_envelope is null)),
 constraint assigned_activation_native_proof check(
  (state in ('native_active','not_required'))=(native_receipt is not null)),
 constraint assigned_activation_terminal_time check(
  (state in ('native_active','not_required','error','expired','cancelled'))=(terminal_at is not null))
);
create unique index custodial_one_pending_activation_per_device
 on public.custodial_assigned_activation_operations(device_id) where terminal_at is null;
create index custodial_activation_requester_pending on public.custodial_assigned_activation_operations(requester_manager_id,requested_at) where terminal_at is null;
alter table public.custodial_assigned_activation_operations enable row level security;
alter table public.custodial_assigned_activation_operations force row level security;
revoke all on public.custodial_assigned_activation_operations from public,anon,authenticated,service_role,
 static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader;

create function public.custodial_activation_public_status(p_row public.custodial_assigned_activation_operations)
 returns jsonb language sql immutable set search_path=pg_catalog,public as $fn$
 select jsonb_build_object('operation_id',p_row.operation_id,'device_id',p_row.canonical_device_id,
  'employee_id',p_row.expected_employee_id,'assignment_epoch',p_row.expected_assignment_epoch,
  'action',p_row.requested_action,'state',p_row.state,'state_version',p_row.state_version,
  'attempts',p_row.attempts,'requested_at',p_row.requested_at,'expires_at',p_row.expires_at,
  'terminal_at',p_row.terminal_at,'last_error_code',p_row.last_error_code,
  'native_receipt',p_row.native_receipt);
$fn$;

create function public.custodial_activation_assert_manager(p_manager uuid,p_credential uuid,p_workstation text default null)
 returns void language plpgsql security definer set search_path=pg_catalog,public as $fn$
begin
 if not exists(select 1 from public.ops_manager_trusted_devices t join public.ops_manager_managers m using(manager_id)
  where t.credential_id=p_credential and m.manager_id=p_manager and m.active and m.revoked_at is null
   and 'CUSTODIAL_MANAGER'=any(m.roles) and t.revoked_at is null and t.expires_at>now()
   and t.created_at+interval '365 days'>now() and t.max_access_level='full_access'
   and (p_workstation is null or (t.device_id=p_workstation and p_workstation ~ '^CUSTODIAL-MAINTENANCE-[A-Z0-9-]{36}$')))
 then raise exception using errcode='42501',message='current named custodial manager trust required'; end if;
end $fn$;

create function public.custodial_activation_expire_device(p_device uuid)
 returns void language plpgsql security definer set search_path=pg_catalog,public as $fn$
begin
 perform public.custodial_begin_application_mutation();
 update public.device_auth_enrollment_codes c set revoked_at=coalesce(c.revoked_at,now())
 from public.custodial_assigned_activation_operations a
 where a.device_id=p_device and a.terminal_at is null and a.expires_at<=now()
  and c.enrollment_id=a.enrollment_id and c.consumed_at is null;
 update public.custodial_assigned_activation_operations set state='expired',state_version=state_version+1,
  terminal_at=now(),token_envelope=null,last_error_code='activation_expired'
 where device_id=p_device and terminal_at is null and expires_at<=now();
end $fn$;

create function public.custodial_activation_request(p_operation uuid,p_device text,p_employee uuid,p_epoch bigint,
 p_manager uuid,p_requester uuid,p_serial_sha256 text)
 returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare d public.devices%rowtype; a public.custodial_assigned_activation_operations%rowtype;
begin
 perform public.custodial_begin_application_mutation();
 perform public.custodial_activation_assert_manager(p_manager,p_requester);
 if p_operation is null or p_employee is null or p_epoch is null or p_serial_sha256 is null then raise exception 'exact activation request required'; end if;
 perform pg_advisory_xact_lock(hashtextextended('custodial-enrollment-operation:'||p_operation::text,0));
 select * into strict d from public.devices where device_id=p_device for update;
 perform public.custodial_activation_expire_device(d.id);
 select * into a from public.custodial_assigned_activation_operations where operation_id=p_operation for update;
 if found then
  if (a.device_id,a.expected_employee_id,a.expected_assignment_epoch,a.requester_manager_id,a.requester_credential_id,a.approved_serial_sha256)
   is distinct from (d.id,p_employee,p_epoch,p_manager,p_requester,p_serial_sha256)
   then raise exception using errcode='40001',message='activation operation conflict'; end if;
  return public.custodial_activation_public_status(a);
 end if;
 if d.active is not true or d.assigned_employee_id is distinct from p_employee or d.assignment_epoch is distinct from p_epoch
  or not exists(select 1 from public.employees where id=p_employee and active and employee_code ~ '^EMP[0-9]+$')
 then raise exception using errcode='40001',message='phone assignment changed or unavailable'; end if;
 insert into public.custodial_assigned_activation_operations(operation_id,device_id,canonical_device_id,
  expected_employee_id,expected_assignment_epoch,requested_action,requester_manager_id,requester_credential_id,approved_serial_sha256)
 values(p_operation,d.id,d.device_id,p_employee,p_epoch,'activate_or_recover',p_manager,p_requester,p_serial_sha256) returning * into a;
 return public.custodial_activation_public_status(a);
end $fn$;

create function public.custodial_activation_claim(p_operation uuid,p_manager uuid,p_claimant uuid,p_workstation text,
 p_serial_sha256 text,p_client_version text,p_code_hash text,p_token_envelope jsonb)
 returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare a public.custodial_assigned_activation_operations%rowtype; d public.devices%rowtype; code jsonb;
begin
 perform public.custodial_begin_application_mutation();
 perform public.custodial_activation_assert_manager(p_manager,p_claimant,p_workstation);
 if p_workstation is null or p_operation is null then raise exception 'exact workstation claim required'; end if;
 perform pg_advisory_xact_lock(hashtextextended('custodial-enrollment-operation:'||p_operation::text,0));
 select d0.* into strict d from public.devices d0 join public.custodial_assigned_activation_operations a0 on a0.device_id=d0.id
  where a0.operation_id=p_operation for update of d0;
 perform public.custodial_activation_expire_device(d.id);
 select * into strict a from public.custodial_assigned_activation_operations where operation_id=p_operation for update;
 if a.requester_manager_id is distinct from p_manager or a.requester_credential_id=p_claimant
  or a.approved_serial_sha256 is distinct from p_serial_sha256 then raise exception using errcode='42501',message='activation claimant or physical recipient mismatch'; end if;
 if a.terminal_at is not null then return jsonb_build_object('status',public.custodial_activation_public_status(a)); end if;
 -- Reserve the bounded attempt BEFORE returning the dispatch secret. Counting
 -- only the later delivery report permits endless retries after client loss.
 if a.attempts>=5 then raise exception using errcode='40001',message='activation dispatch attempt limit reached'; end if;
 if d.active is not true or d.assigned_employee_id is distinct from a.expected_employee_id
  or d.assignment_epoch is distinct from a.expected_assignment_epoch then raise exception 'activation assignment changed'; end if;
 if a.claimant_credential_id is not null then
  if (a.claimant_credential_id,a.claimant_device_id,a.client_version) is distinct from (p_claimant,p_workstation,p_client_version)
   then raise exception using errcode='42501',message='activation already claimed by another workstation'; end if;
  update public.custodial_assigned_activation_operations set state='prepared',state_version=state_version+1,
   attempts=attempts+1 where operation_id=p_operation returning * into a;
 else
  if coalesce(p_code_hash,'') !~ '^[0-9a-f]{64}$' or coalesce(p_client_version,'') !~ '^[a-z0-9][a-z0-9._-]{0,79}$'
   or p_token_envelope is null or jsonb_typeof(p_token_envelope)<>'object' or pg_column_size(p_token_envelope)>2048
   or p_token_envelope->>'version' is distinct from 'assigned-activation.aes-256-gcm.v1'
   or coalesce(p_token_envelope->>'ciphertext','') !~ '^[A-Za-z0-9_-]{58}$'
   or coalesce(p_token_envelope->>'iv','') !~ '^[A-Za-z0-9_-]{16}$'
   or coalesce(p_token_envelope->>'tag','') !~ '^[A-Za-z0-9_-]{22}$'
   or (select count(*) from jsonb_object_keys(p_token_envelope))<>4
   then raise exception 'bounded authenticated activation envelope required'; end if;
  select to_jsonb(issued) into strict code from public.device_auth_issue_enrollment_code(d.id,p_code_hash,p_manager::text,a.expires_at,
   jsonb_build_object('purpose','assigned_device_activation','operation_id',p_operation,'device_id',d.id,
    'canonical_device_id',d.device_id,'employee_id',a.expected_employee_id,'assignment_epoch',a.expected_assignment_epoch,
    'claimant_credential_id',p_claimant)) issued;
  update public.custodial_assigned_activation_operations set claimant_credential_id=p_claimant,claimant_device_id=p_workstation,
   client_version=p_client_version,enrollment_id=(code->>'enrollment_id')::uuid,token_envelope=p_token_envelope,
   state='prepared',state_version=state_version+1,attempts=1,prepared_at=now() where operation_id=p_operation returning * into a;
 end if;
 return jsonb_build_object('status',public.custodial_activation_public_status(a),'token_envelope',a.token_envelope);
end $fn$;

create function public.custodial_activation_read(p_operation uuid,p_manager uuid,p_requester uuid)
 returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare a public.custodial_assigned_activation_operations%rowtype;
begin
 perform public.custodial_begin_application_mutation();
 perform public.custodial_activation_assert_manager(p_manager,p_requester);
 select * into strict a from public.custodial_assigned_activation_operations where operation_id=p_operation;
 if a.requester_manager_id is distinct from p_manager then raise exception using errcode='42501',message='activation belongs to another manager'; end if;
 perform 1 from public.devices where id=a.device_id for update;
 perform public.custodial_activation_expire_device(a.device_id);
 select * into strict a from public.custodial_assigned_activation_operations where operation_id=p_operation;
 return public.custodial_activation_public_status(a);
end $fn$;

create function public.custodial_activation_list(p_manager uuid,p_requester uuid)
 returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare d record; result jsonb;
begin
 perform public.custodial_begin_application_mutation();
 perform public.custodial_activation_assert_manager(p_manager,p_requester);
 for d in select dev.id from public.devices dev where exists(select 1 from public.custodial_assigned_activation_operations a
  where a.device_id=dev.id and a.requester_manager_id=p_manager and a.terminal_at is null)
  order by dev.id limit 50 for update of dev
 loop perform public.custodial_activation_expire_device(d.id);end loop;
 select coalesce(jsonb_agg(public.custodial_activation_public_status(a) order by a.requested_at),'[]'::jsonb)
 into result from (select * from public.custodial_assigned_activation_operations
  where requester_manager_id=p_manager and terminal_at is null order by requested_at limit 50) a;
 return jsonb_build_object('operations',result);
end $fn$;

create function public.custodial_activation_delivery(p_operation uuid,p_manager uuid,p_claimant uuid,p_workstation text,
 p_expected_version integer,p_outcome text,p_error_code text)
 returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare a public.custodial_assigned_activation_operations%rowtype;
begin
 perform public.custodial_begin_application_mutation();
 perform public.custodial_activation_assert_manager(p_manager,p_claimant,p_workstation);
 select * into strict a from public.custodial_assigned_activation_operations where operation_id=p_operation;
 perform 1 from public.devices where id=a.device_id for update;
 perform public.custodial_activation_expire_device(a.device_id);
 select * into strict a from public.custodial_assigned_activation_operations where operation_id=p_operation for update;
 if (a.requester_manager_id,a.claimant_credential_id,a.claimant_device_id) is distinct from (p_manager,p_claimant,p_workstation)
  then raise exception using errcode='42501',message='exact activation claimant required'; end if;
 if a.terminal_at is not null then return public.custodial_activation_public_status(a); end if;
 if a.state_version is distinct from p_expected_version or a.state<>'prepared'
  or a.attempts<1 or coalesce(p_outcome,'') not in ('delivered','delivery_unknown')
  then raise exception using errcode='40001',message='stale or invalid activation delivery report'; end if;
 update public.custodial_assigned_activation_operations set state=p_outcome,state_version=state_version+1,
  delivered_at=case when p_outcome='delivered' then coalesce(delivered_at,now()) else delivered_at end,
  last_error_code=p_error_code where operation_id=p_operation returning * into a;
 return public.custodial_activation_public_status(a);
end $fn$;

create function public.custodial_activation_assert_consume(p_operation uuid,p_device uuid,p_code_hash text)
 returns void language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare a public.custodial_assigned_activation_operations%rowtype; d public.devices%rowtype; c public.device_auth_enrollment_codes%rowtype;
begin
 perform public.custodial_begin_application_mutation();
 select * into strict d from public.devices where id=p_device for update;
 select * into a from public.custodial_assigned_activation_operations where operation_id=p_operation for update;
 if a.operation_id is null then raise exception 'assigned activation operation not found'; end if;
 if a.device_id is distinct from p_device or a.canonical_device_id is distinct from d.device_id or d.active is not true
  or a.expected_employee_id is distinct from d.assigned_employee_id or a.expected_assignment_epoch is distinct from d.assignment_epoch
  or a.state not in ('prepared','delivered','delivery_unknown') or a.expires_at<=now() or a.claimant_credential_id is null
  then raise exception 'assigned activation recipient is stale or unavailable'; end if;
 perform public.custodial_activation_assert_manager(a.requester_manager_id,a.claimant_credential_id,a.claimant_device_id);
 select * into strict c from public.device_auth_enrollment_codes where enrollment_id=a.enrollment_id for update;
 if c.device_id is distinct from p_device or c.code_hash is distinct from p_code_hash or c.revoked_at is not null or c.expires_at<=now()
  or c.failed_attempts>=10 or c.metadata_json->>'purpose' is distinct from 'assigned_device_activation'
  or c.metadata_json->>'operation_id' is distinct from p_operation::text
  or c.metadata_json->>'device_id' is distinct from p_device::text
  or c.metadata_json->>'canonical_device_id' is distinct from d.device_id
  or c.metadata_json->>'employee_id' is distinct from a.expected_employee_id::text
  or c.metadata_json->>'assignment_epoch' is distinct from a.expected_assignment_epoch::text
  or c.metadata_json->>'claimant_credential_id' is distinct from a.claimant_credential_id::text
  or (c.consumed_at is not null and not exists(select 1 from public.device_auth_enrollment_operations e
   where e.operation_id=p_operation and e.device_id=p_device and e.enrollment_id=c.enrollment_id))
  then raise exception 'assigned activation code binding invalid'; end if;
end $fn$;

-- Insert the guard before the predecessor's replay or mutation paths. Existing
-- historical operation replay without a transport row stays owned by the same
-- fingerprint validator. New assigned tokens without an exact ledger fail.
do $consume$
declare d text; needle text:='  perform pg_advisory_xact_lock'; p integer;
begin
 d:=pg_get_functiondef('public.device_auth_consume_enrollment_operation(uuid,text,uuid,text,text,uuid,text,text,timestamptz,text,text,text,timestamptz,text,text,text,jsonb)'::regprocedure);
 p:=position(needle in d); if p=0 then raise exception 'enrollment operation lock seam missing'; end if;
 -- Guard after the existing operation advisory lock, before selecting a replay.
 needle:='  select * into v_operation';
 if position(needle in d)=0 then raise exception 'enrollment replay seam missing'; end if;
 d:=replace(d,needle,$new$
  if exists(select 1 from public.custodial_assigned_activation_operations where operation_id=p_operation_id) then
   perform public.custodial_activation_assert_consume(p_operation_id,p_device_id,p_code_hash);
  elsif not exists(select 1 from public.device_auth_enrollment_operations where operation_id=p_operation_id)
   and (p_metadata_json->>'activation_kind'='assigned_device_activation' or exists(
    select 1 from public.device_auth_enrollment_codes where device_id=p_device_id and code_hash=p_code_hash
     and metadata_json->>'purpose'='assigned_device_activation')) then
   raise exception 'assigned activation transport operation required';
  end if;
  select * into v_operation$new$);
 execute d;
end $consume$;

create function public.custodial_activation_assignment_changed()
 returns trigger language plpgsql security definer set search_path=pg_catalog,public as $fn$
begin
 if (new.assigned_employee_id,new.assignment_epoch,new.active) is distinct from (old.assigned_employee_id,old.assignment_epoch,old.active) then
  update public.device_auth_enrollment_codes c set revoked_at=coalesce(c.revoked_at,now())
   from public.custodial_assigned_activation_operations a where a.device_id=new.id and a.terminal_at is null
    and c.enrollment_id=a.enrollment_id and c.consumed_at is null;
  update public.custodial_assigned_activation_operations set state='cancelled',state_version=state_version+1,
   terminal_at=now(),token_envelope=null,last_error_code='assignment_changed' where device_id=new.id and terminal_at is null;
 end if;
 return new;
end $fn$;
create trigger trg_custodial_activation_assignment_changed after update on public.devices
 for each row execute function public.custodial_activation_assignment_changed();

create function public.custodial_activation_native_result(p_operation uuid,p_device uuid,p_credential uuid,
 p_token_hash text,p_receipt jsonb)
 returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare a public.custodial_assigned_activation_operations%rowtype; d public.devices%rowtype;
 c public.device_auth_credentials%rowtype; e public.device_auth_enrollment_operations%rowtype;
outcome text; lineage uuid;
begin
 perform public.custodial_begin_application_mutation();
 if p_operation is null or p_device is null or p_credential is null then raise exception 'exact native result identity required'; end if;
 perform pg_advisory_xact_lock(hashtextextended('custodial-enrollment-operation:'||p_operation::text,0));
 select * into strict d from public.devices where id=p_device for update;
 perform public.custodial_activation_expire_device(p_device);
 select * into strict a from public.custodial_assigned_activation_operations where operation_id=p_operation for update;
 select * into c from public.device_auth_credentials where credential_id=p_credential and device_id=p_device
  and token_hash=p_token_hash and confirmed_at is not null and revoked_at is null and expires_at>now();
 if c.credential_id is null or a.device_id is distinct from p_device or d.active is not true
  or a.expected_employee_id is distinct from d.assigned_employee_id or a.expected_assignment_epoch is distinct from d.assignment_epoch
  then raise exception using errcode='42501',message='current exact assigned device credential required'; end if;
 if p_receipt is null or jsonb_typeof(p_receipt)<>'object' or pg_column_size(p_receipt)>2048
  or (select count(*) from jsonb_object_keys(p_receipt))<>9
  or p_receipt->>'operation_id' is distinct from p_operation::text
  or p_receipt->>'device_id' is distinct from d.device_id
  or p_receipt->>'credential_id' is distinct from p_credential::text
  or coalesce(p_receipt->>'flow','') not in ('enrollment','recovery')
  or p_receipt->>'journal_schema' is distinct from 'native-assigned-activation.v1'
  or coalesce(p_receipt->>'journal_binding_sha256','') !~ '^[0-9a-f]{64}$'
  or coalesce(p_receipt->>'lineage_operation_id','') !~ '^[0-9a-f-]{36}$'
  then raise exception 'exact bounded protected native receipt required'; end if;
 lineage:=(p_receipt->>'lineage_operation_id')::uuid;
 if not exists(select 1 from public.device_auth_enrollment_operations original
  where original.operation_id=lineage and original.device_id=p_device and original.status='confirmed'
   and public.custodial_credential_may_transmit_frozen_work(original.credential_id,p_credential,p_device,now()))
  then raise exception 'native lineage is not an authenticated predecessor'; end if;
 if a.state in ('native_active','not_required') then
  if a.native_receipt is distinct from p_receipt then raise exception 'native terminal receipt conflict'; end if;
  return public.custodial_activation_public_status(a);
 end if;
 if a.state not in ('prepared','delivered','delivery_unknown') or a.claimant_credential_id is null
  then raise exception 'native activation is not pending'; end if;
 select * into e from public.device_auth_enrollment_operations where operation_id=p_operation;
 if p_receipt->>'outcome'='active' and p_receipt->'changed'='true'::jsonb then
  if e.operation_id is null or e.device_id is distinct from p_device or e.credential_id is distinct from p_credential
   or e.flow is distinct from p_receipt->>'flow' or e.status<>'confirmed' or e.enrollment_id is distinct from a.enrollment_id
   then raise exception 'native active requires exact confirmed enrollment'; end if;
  outcome:='native_active';
 elsif p_receipt->>'outcome'='not_required' and p_receipt->'changed'='false'::jsonb then
  if e.operation_id is not null or c.created_at>=a.requested_at or not exists(
   select 1 from public.device_auth_enrollment_codes where enrollment_id=a.enrollment_id and consumed_at is null)
   then raise exception 'not required must preserve an existing healthy credential'; end if;
  outcome:='not_required';
 else raise exception 'invalid native activation outcome'; end if;
 update public.device_auth_enrollment_codes set revoked_at=coalesce(revoked_at,now())
  where enrollment_id=a.enrollment_id and consumed_at is null;
 update public.custodial_assigned_activation_operations set state=outcome,state_version=state_version+1,
  native_receipt=p_receipt,terminal_at=now(),token_envelope=null,last_error_code=null
  where operation_id=p_operation returning * into a;
 return public.custodial_activation_public_status(a);
end $fn$;

create function public.custodial_activation_guard_row()
 returns trigger language plpgsql set search_path=pg_catalog,public as $fn$
begin
 if tg_op='DELETE' then raise exception 'activation operation history is retained'; end if;
 if old.terminal_at is not null then raise exception 'terminal activation receipt is immutable'; end if;
 if (new.operation_id,new.device_id,new.canonical_device_id,new.expected_employee_id,new.expected_assignment_epoch,
  new.requested_action,new.requester_manager_id,new.requester_credential_id,new.approved_serial_sha256,new.requested_at,new.expires_at)
 is distinct from (old.operation_id,old.device_id,old.canonical_device_id,old.expected_employee_id,old.expected_assignment_epoch,
  old.requested_action,old.requester_manager_id,old.requester_credential_id,old.approved_serial_sha256,old.requested_at,old.expires_at)
 then raise exception 'activation frozen recipient changed'; end if;
 if old.claimant_credential_id is not null and
  (new.claimant_credential_id,new.claimant_device_id,new.client_version,new.enrollment_id,new.prepared_at)
  is distinct from (old.claimant_credential_id,old.claimant_device_id,old.client_version,old.enrollment_id,old.prepared_at)
  then raise exception 'activation claimant changed'; end if;
 if new.state_version<>old.state_version+1 or new.attempts<old.attempts or new.attempts>old.attempts+1
  or not ((old.state='requested' and new.state in ('prepared','error','expired','cancelled'))
   or (old.state in ('prepared','delivered','delivery_unknown') and new.state in
    ('prepared','delivered','delivery_unknown','native_active','not_required','error','expired','cancelled')))
  then raise exception 'activation state transition invalid'; end if;
 if new.terminal_at is null and old.token_envelope is not null and new.token_envelope is distinct from old.token_envelope
  then raise exception 'activation same-operation token cannot rotate'; end if;
 return new;
end $fn$;
create trigger trg_custodial_activation_guard_row before update or delete on public.custodial_assigned_activation_operations
 for each row execute function public.custodial_activation_guard_row();

create function public.custodial_activation_expire_pending(p_limit integer)
 returns void language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare d record;
begin
 perform public.custodial_begin_application_mutation();
 for d in select dev.id from public.devices dev where exists(select 1 from public.custodial_assigned_activation_operations a
   where a.device_id=dev.id and a.terminal_at is null and a.expires_at<=now())
  order by dev.id limit greatest(1,least(coalesce(p_limit,100),1000)) for update of dev skip locked
 loop perform public.custodial_activation_expire_device(d.id); end loop;
end $fn$;
-- Reuse the existing bounded enrollment-expiration maintenance job. Expiry
-- erases only this transport ciphertext, never an already confirmed credential.
do $expiry$
declare d text;
begin
 d:=pg_get_functiondef('public.device_auth_expire_custodial_enrollment_operations(timestamptz,integer)'::regprocedure);
 if position('begin' in d)=0 then raise exception 'enrollment expiration seam missing'; end if;
 d:=overlay(d placing E'begin\n  perform public.custodial_activation_expire_pending(p_limit);' from position('begin' in d) for 5);
 execute d;
end $expiry$;

-- Explicit RPC-only grants. No browser/device direct table access, no sequence.
do $acl$
declare f regprocedure;
begin
 for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname like 'custodial_activation_%'
 loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader',f);
 end loop;
end $acl$;
grant execute on function public.custodial_activation_request(uuid,text,uuid,bigint,uuid,uuid,text),
 public.custodial_activation_claim(uuid,uuid,uuid,text,text,text,text,jsonb),
 public.custodial_activation_read(uuid,uuid,uuid),
 public.custodial_activation_list(uuid,uuid),
 public.custodial_activation_delivery(uuid,uuid,uuid,text,integer,text,text),
 public.custodial_activation_native_result(uuid,uuid,uuid,text,jsonb) to service_role;

do $surface$
declare d text; additions text;
begin
 d:=pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure);
 if (length(d)-length(replace(d,'  values','')))/length('  values')<>1 then raise exception 'activation canary surface seam missing'; end if;
 -- Definition bytes must be identical in a clean replay and the atomic release
 -- transaction. Catalog scan/OID order is not a stable source identity.
 select string_agg(format('(%L,%L,%L),','function',p.oid::regprocedure::text,'assigned phone operation authority'),E'\n'
  order by p.proname,pg_get_function_identity_arguments(p.oid)) into additions
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and starts_with(p.proname,'custodial_activation_');
 additions:=additions||E'\n'||format('(%L,%L,%L),','relation','public.custodial_assigned_activation_operations','private activation operation ledger')
  ||E'\n'||format('(%L,%L,%L),','trigger','public.devices.trg_custodial_activation_assignment_changed','cancel stale assignment activation')
  ||E'\n'||format('(%L,%L,%L),','trigger','public.custodial_assigned_activation_operations.trg_custodial_activation_guard_row','immutable activation recipient and terminal receipt')
  ||E'\n'||format('(%L,%L,%L),','trigger','public.custodial_assigned_activation_operations.custodial_disaster_restore_mutation_fence','pause activation writes during disaster restore');
 execute replace(d,'  values','  values'||E'\n'||additions);
end $surface$;

alter table public.custodial_release_authority_restore_inventory disable trigger trg_custodial_release_authority_restore_inventory_immutable;
do $recovery$
declare obj record; next_order integer; relation_name text:='public.custodial_assigned_activation_operations';
begin
 for obj in with funcs as (
  select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and
   (starts_with(p.proname,'custodial_activation_') or p.oid in (
    'public.device_auth_consume_enrollment_operation(uuid,text,uuid,text,text,uuid,text,text,timestamptz,text,text,text,timestamptz,text,text,text,jsonb)'::regprocedure,
    'public.device_auth_expire_custodial_enrollment_operations(timestamptz,integer)'::regprocedure,
    'public.custodial_release_canary_authority_surface()'::regprocedure))
 ), objects as (
  select 1000 bucket,'relation'::text kind,relation_name identity,
   public.custodial_release_authority_current_relation_definition(relation_name) definition
  union all select 100000,'function',oid::regprocedure::text,pg_get_functiondef(oid) from funcs
  union all select 200000,'column',relation_name||':'||attname,
   public.custodial_release_authority_current_column_definition(relation_name||':'||attname)
   from pg_attribute where attrelid=relation_name::regclass and attnum>0 and not attisdropped
  union all select 300000,'column_set',relation_name,public.custodial_release_authority_current_column_set_definition(relation_name)
  union all select 400000,'relation_state',relation_name,public.custodial_release_authority_current_relation_state_definition(relation_name)
  union all select 500000,'constraint',relation_name||':'||conname,
   public.custodial_release_authority_current_constraint_definition(relation_name||':'||conname)
   from pg_constraint where conrelid=relation_name::regclass
  union all select 600000,'index','public.'||quote_ident(ci.relname),
   public.custodial_release_authority_current_index_definition('public.'||quote_ident(ci.relname))
   from pg_index i join pg_class ci on ci.oid=i.indexrelid
   where i.indrelid=relation_name::regclass and not exists(select 1 from pg_constraint c where c.conindid=i.indexrelid)
  union all select 700000,'trigger',quote_ident(n.nspname)||'.'||quote_ident(r.relname)||'.'||quote_ident(t.tgname),
   'drop trigger if exists '||quote_ident(t.tgname)||' on '||quote_ident(n.nspname)||'.'||quote_ident(r.relname)||'; '
    ||pg_get_triggerdef(t.oid,true)||'; alter table '||quote_ident(n.nspname)||'.'||quote_ident(r.relname)||' '
    ||case t.tgenabled when 'O' then 'enable' when 'D' then 'disable' when 'R' then 'enable replica' when 'A' then 'enable always' end
    ||' trigger '||quote_ident(t.tgname)||';'
   from pg_trigger t join pg_class r on r.oid=t.tgrelid join pg_namespace n on n.oid=r.relnamespace
   where not t.tgisinternal and (t.tgrelid=relation_name::regclass or
    (t.tgrelid='public.devices'::regclass and t.tgname='trg_custodial_activation_assignment_changed'))
  union all select 900000,'grant',relation_name,public.custodial_release_authority_current_grant_definition(relation_name)
  union all select 900000,'grant',oid::regprocedure::text,public.custodial_release_authority_current_grant_definition(oid::regprocedure::text) from funcs
 ) select * from objects order by bucket,identity loop
  if obj.definition is null then raise exception 'missing activation recovery object %',obj.identity; end if;
  update public.custodial_release_authority_restore_inventory set definition_sql=obj.definition,
   definition_sha256=public.static_weekly_digest_text(obj.definition),captured_at=statement_timestamp()
   where object_kind=obj.kind and (object_identity=obj.identity or
    case when obj.kind in ('function','grant') and object_identity like '%(%' and obj.identity like '%(%'
     then to_regprocedure(object_identity)=to_regprocedure(obj.identity) else false end);
  if not found then
   select coalesce(max(restore_order),obj.bucket)+1 into next_order from public.custodial_release_authority_restore_inventory
    where restore_order>=obj.bucket and restore_order<case when obj.bucket=1000 then 100000 else obj.bucket+100000 end;
   insert into public.custodial_release_authority_restore_inventory
    (restore_order,object_kind,object_identity,definition_sql,definition_sha256)
    values(next_order,obj.kind,obj.identity,obj.definition,public.static_weekly_digest_text(obj.definition));
  end if;
 end loop;
end $recovery$;
alter table public.custodial_release_authority_restore_inventory enable trigger trg_custodial_release_authority_restore_inventory_immutable;
commit;
