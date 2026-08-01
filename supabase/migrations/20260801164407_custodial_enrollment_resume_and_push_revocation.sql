-- Custodial native enrollment and employee push revocation boundary.
--
-- This migration is forward-only and data-preserving.  It does not alter the
-- legacy enrollment RPC signature, so the previous backend can be restored
-- while these additive objects remain in place.  Rollback consists of rolling
-- back the application release; the encrypted operation history and audit rows
-- are intentionally retained.  The cleanup cron may be disabled independently
-- with cron.unschedule if application rollback needs a longer inspection
-- window.

begin;

create table if not exists public.device_auth_enrollment_operations (
  operation_id uuid primary key,
  device_id uuid not null references public.devices(id) on delete restrict,
  credential_id uuid not null unique references public.device_auth_credentials(credential_id) on delete restrict,
  enrollment_id uuid null references public.device_auth_enrollment_codes(enrollment_id) on delete set null,
  flow text not null,
  request_fingerprint text not null,
  status text not null default 'committed',
  encryption_version text null,
  result_ciphertext text null,
  result_iv text null,
  result_auth_tag text null,
  resume_expires_at timestamptz not null,
  confirmed_at timestamptz null,
  cancelled_at timestamptz null,
  expired_at timestamptz null,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint device_auth_enrollment_operations_flow_check
    check (flow in ('enrollment','recovery')),
  constraint device_auth_enrollment_operations_status_check
    check (status in ('committed','confirmed','cancelled','expired')),
  constraint device_auth_enrollment_operations_fingerprint_check
    check (length(request_fingerprint)=64),
  constraint device_auth_enrollment_operations_metadata_check
    check (jsonb_typeof(metadata_json)='object'),
  constraint device_auth_enrollment_operations_result_check
    check (
      (status='committed'
        and encryption_version is not null
        and result_ciphertext is not null
        and result_iv is not null
        and result_auth_tag is not null)
      or
      (status<>'committed'
        and result_ciphertext is null
        and result_iv is null
        and result_auth_tag is null)
    )
);

create index if not exists idx_device_auth_enrollment_operations_expiry
  on public.device_auth_enrollment_operations(resume_expires_at,operation_id)
  where status='committed';
create index if not exists idx_device_auth_enrollment_operations_device_recent
  on public.device_auth_enrollment_operations(device_id,created_at desc);

alter table public.device_auth_enrollment_operations enable row level security;
alter table public.device_auth_enrollment_operations force row level security;
revoke all on table public.device_auth_enrollment_operations from public,anon,authenticated;
grant select,insert,update,delete on table public.device_auth_enrollment_operations to postgres,service_role;

create or replace function public.device_auth_consume_enrollment_operation(
  p_operation_id uuid,
  p_flow text,
  p_device_id uuid,
  p_code_hash text,
  p_request_fingerprint text,
  p_credential_id uuid,
  p_token_hash text,
  p_device_label text,
  p_expires_at timestamptz,
  p_result_ciphertext text,
  p_result_iv text,
  p_result_auth_tag text,
  p_result_expires_at timestamptz,
  p_encryption_version text,
  p_user_agent_hash text default null,
  p_ip_hash text default null,
  p_metadata_json jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public
as $function$
declare
  v_now timestamptz:=clock_timestamp();
  v_operation public.device_auth_enrollment_operations%rowtype;
  v_code public.device_auth_enrollment_codes%rowtype;
  v_credential public.device_auth_credentials%rowtype;
  v_failed_attempts integer;
begin
  if p_operation_id is null or p_device_id is null or p_credential_id is null then
    raise exception using errcode='22023',message='operation_id, device_id, and credential_id are required';
  end if;
  if p_flow not in ('enrollment','recovery') then
    raise exception using errcode='22023',message='flow must be enrollment or recovery';
  end if;
  if p_code_hash is null or length(p_code_hash)<>64
     or p_request_fingerprint is null or length(p_request_fingerprint)<>64
     or p_token_hash is null or length(p_token_hash)<>64 then
    raise exception using errcode='22023',message='valid enrollment hashes are required';
  end if;
  if p_expires_at is null or p_expires_at<=v_now then
    raise exception using errcode='22023',message='future credential expiry is required';
  end if;
  if p_result_expires_at is null
     or p_result_expires_at<=v_now
     or p_result_expires_at>v_now+interval '1 hour' then
    raise exception using errcode='22023',message='resumable result expiry must be within one hour';
  end if;
  if nullif(btrim(coalesce(p_encryption_version,'')),'') is null
     or length(coalesce(p_result_ciphertext,''))<32
     or length(coalesce(p_result_ciphertext,''))>16384
     or length(coalesce(p_result_iv,'')) not between 12 and 128
     or length(coalesce(p_result_auth_tag,'')) not between 16 and 128 then
    raise exception using errcode='22023',message='valid encrypted enrollment result is required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('custodial-enrollment-operation:'||p_operation_id::text,0));

  select * into v_operation
  from public.device_auth_enrollment_operations
  where operation_id=p_operation_id
  for update;

  if v_operation.operation_id is not null then
    if v_operation.device_id<>p_device_id
       or v_operation.flow<>p_flow
       or v_operation.request_fingerprint<>p_request_fingerprint then
      return jsonb_build_object('ok',false,'reason','operation_conflict');
    end if;

    if v_operation.status='committed' and v_operation.resume_expires_at<=v_now then
      update public.device_auth_credentials
         set revoked_at=coalesce(revoked_at,v_now),
             revoked_reason=case when revoked_at is null then 'enrollment_operation_unconfirmed_timeout' else revoked_reason end
       where credential_id=v_operation.credential_id;
      update public.device_auth_enrollment_operations
         set status='expired',expired_at=coalesce(expired_at,v_now),
             result_ciphertext=null,result_iv=null,result_auth_tag=null,updated_at=v_now
       where operation_id=v_operation.operation_id
       returning * into v_operation;
      return jsonb_build_object('ok',false,'reason','operation_expired','operation_id',v_operation.operation_id);
    end if;

    if v_operation.status='committed' then
      select * into v_credential
      from public.device_auth_credentials
      where credential_id=v_operation.credential_id
        and device_id=v_operation.device_id
        and revoked_at is null
        and expires_at>v_now;
      if v_credential.credential_id is null then
        update public.device_auth_enrollment_operations
           set status='cancelled',cancelled_at=coalesce(cancelled_at,v_now),
               result_ciphertext=null,result_iv=null,result_auth_tag=null,updated_at=v_now
         where operation_id=v_operation.operation_id;
        return jsonb_build_object('ok',false,'reason','credential_unavailable','operation_id',v_operation.operation_id);
      end if;
      return jsonb_build_object(
        'ok',true,'replayed',true,'status',v_operation.status,
        'operation_id',v_operation.operation_id,'flow',v_operation.flow,
        'credential_id',v_operation.credential_id,
        'credential_expires_at',v_credential.expires_at,
        'resume_expires_at',v_operation.resume_expires_at,
        'encryption_version',v_operation.encryption_version,
        'result_ciphertext',v_operation.result_ciphertext,
        'result_iv',v_operation.result_iv,
        'result_auth_tag',v_operation.result_auth_tag
      );
    end if;

    return jsonb_build_object(
      'ok',false,'reason','operation_'||v_operation.status,
      'operation_id',v_operation.operation_id,'credential_id',v_operation.credential_id
    );
  end if;

  perform 1 from public.devices where id=p_device_id for update;
  if not found then
    raise exception using errcode='P0002',message='device was not found';
  end if;

  select * into v_code
  from public.device_auth_enrollment_codes
  where device_id=p_device_id and consumed_at is null and revoked_at is null
  order by created_at desc
  limit 1
  for update;

  if v_code.enrollment_id is null or v_code.expires_at<=v_now then
    if v_code.enrollment_id is not null then
      update public.device_auth_enrollment_codes
         set revoked_at=coalesce(revoked_at,v_now),
             metadata_json=metadata_json||jsonb_build_object('revoked_reason','expired')
       where enrollment_id=v_code.enrollment_id;
    end if;
    return jsonb_build_object('ok',false,'reason','invalid_or_expired');
  end if;

  if v_code.failed_attempts>=10 then
    update public.device_auth_enrollment_codes
       set revoked_at=coalesce(revoked_at,v_now),
           metadata_json=metadata_json||jsonb_build_object('revoked_reason','attempt_limit')
     where enrollment_id=v_code.enrollment_id;
    return jsonb_build_object('ok',false,'reason','invalid_or_expired');
  end if;

  if v_code.code_hash<>p_code_hash then
    v_failed_attempts:=least(v_code.failed_attempts+1,10);
    update public.device_auth_enrollment_codes
       set failed_attempts=v_failed_attempts,last_failed_at=v_now,
           revoked_at=case when v_failed_attempts>=10 then v_now else revoked_at end,
           metadata_json=case when v_failed_attempts>=10
             then metadata_json||jsonb_build_object('revoked_reason','attempt_limit')
             else metadata_json end
     where enrollment_id=v_code.enrollment_id;
    insert into public.device_auth_events(
      device_id,credential_id,event_type,success,reason,ip_hash,user_agent_hash,metadata_json
    ) values (
      p_device_id,null,'custodial_enrollment_operation_failed',false,'invalid_code',
      p_ip_hash,p_user_agent_hash,
      jsonb_build_object('operation_id',p_operation_id,'flow',p_flow,'enrollment_id',v_code.enrollment_id,'failed_attempts',v_failed_attempts)
    );
    return jsonb_build_object('ok',false,'reason','invalid_or_expired');
  end if;

  update public.device_auth_credentials
     set revoked_at=v_now,revoked_reason='re_enrolled'
   where device_id=p_device_id and revoked_at is null;

  insert into public.device_auth_credentials(
    credential_id,device_id,token_hash,device_label,
    user_agent_hash,created_ip_hash,last_user_agent_hash,last_ip_hash,
    metadata_json,confirmed_at,last_used_at,expires_at
  ) values (
    p_credential_id,p_device_id,p_token_hash,
    nullif(left(btrim(coalesce(p_device_label,'')),160),''),
    p_user_agent_hash,p_ip_hash,p_user_agent_hash,p_ip_hash,
    coalesce(p_metadata_json,'{}'::jsonb)||jsonb_build_object('enrollment_operation_id',p_operation_id,'enrollment_flow',p_flow),
    null,null,p_expires_at
  ) returning * into v_credential;

  update public.device_auth_enrollment_codes
     set consumed_at=v_now,consumed_by_credential_id=v_credential.credential_id
   where enrollment_id=v_code.enrollment_id;

  insert into public.device_auth_enrollment_operations(
    operation_id,device_id,credential_id,enrollment_id,flow,request_fingerprint,status,
    encryption_version,result_ciphertext,result_iv,result_auth_tag,resume_expires_at,metadata_json
  ) values (
    p_operation_id,p_device_id,v_credential.credential_id,v_code.enrollment_id,p_flow,p_request_fingerprint,'committed',
    left(p_encryption_version,80),p_result_ciphertext,p_result_iv,p_result_auth_tag,p_result_expires_at,
    coalesce(p_metadata_json,'{}'::jsonb)
  ) returning * into v_operation;

  insert into public.device_auth_events(
    device_id,credential_id,event_type,success,reason,ip_hash,user_agent_hash,metadata_json
  ) values (
    p_device_id,v_credential.credential_id,'custodial_enrollment_operation_committed',true,null,
    p_ip_hash,p_user_agent_hash,
    coalesce(p_metadata_json,'{}'::jsonb)||jsonb_build_object(
      'operation_id',p_operation_id,'flow',p_flow,'enrollment_id',v_code.enrollment_id,
      'resume_expires_at',p_result_expires_at
    )
  );

  return jsonb_build_object(
    'ok',true,'replayed',false,'status','committed',
    'operation_id',v_operation.operation_id,'flow',v_operation.flow,
    'credential_id',v_credential.credential_id,
    'credential_expires_at',v_credential.expires_at,
    'resume_expires_at',v_operation.resume_expires_at,
    'encryption_version',v_operation.encryption_version,
    'result_ciphertext',v_operation.result_ciphertext,
    'result_iv',v_operation.result_iv,
    'result_auth_tag',v_operation.result_auth_tag
  );
end
$function$;

create or replace function public.device_auth_confirm_enrollment_operation(
  p_operation_id uuid,
  p_device_id uuid,
  p_credential_id uuid,
  p_token_hash text
) returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public
as $function$
declare
  v_now timestamptz:=clock_timestamp();
  v_operation public.device_auth_enrollment_operations%rowtype;
  v_credential public.device_auth_credentials%rowtype;
begin
  if p_operation_id is null or p_device_id is null or p_credential_id is null
     or p_token_hash is null or length(p_token_hash)<>64 then
    raise exception using errcode='22023',message='operation and credential proof are required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('custodial-enrollment-operation:'||p_operation_id::text,0));
  select * into v_operation from public.device_auth_enrollment_operations
   where operation_id=p_operation_id for update;
  if v_operation.operation_id is null
     or v_operation.device_id<>p_device_id
     or v_operation.credential_id<>p_credential_id then
    return jsonb_build_object('ok',false,'reason','operation_not_found');
  end if;
  select * into v_credential from public.device_auth_credentials
   where credential_id=p_credential_id and device_id=p_device_id and token_hash=p_token_hash;
  if v_credential.credential_id is null then
    return jsonb_build_object('ok',false,'reason','credential_mismatch');
  end if;
  if v_operation.status='confirmed' then
    return jsonb_build_object(
      'ok',true,'replayed',true,'status','confirmed','operation_id',p_operation_id,
      'credential_id',p_credential_id,
      'credential_active',(v_credential.revoked_at is null and v_credential.expires_at>v_now)
    );
  end if;
  if v_operation.status<>'committed' then
    return jsonb_build_object('ok',false,'reason','operation_'||v_operation.status);
  end if;
  if v_operation.resume_expires_at<=v_now then
    update public.device_auth_credentials
       set revoked_at=coalesce(revoked_at,v_now),
           revoked_reason=case when revoked_at is null then 'enrollment_operation_unconfirmed_timeout' else revoked_reason end
     where credential_id=p_credential_id;
    update public.device_auth_enrollment_operations
       set status='expired',expired_at=coalesce(expired_at,v_now),
           result_ciphertext=null,result_iv=null,result_auth_tag=null,updated_at=v_now
     where operation_id=p_operation_id;
    return jsonb_build_object('ok',false,'reason','operation_expired');
  end if;
  if v_credential.revoked_at is not null or v_credential.expires_at<=v_now then
    update public.device_auth_enrollment_operations
       set status='cancelled',cancelled_at=coalesce(cancelled_at,v_now),
           result_ciphertext=null,result_iv=null,result_auth_tag=null,updated_at=v_now
     where operation_id=p_operation_id;
    return jsonb_build_object('ok',false,'reason','credential_unavailable');
  end if;

  update public.device_auth_credentials
     set confirmed_at=coalesce(confirmed_at,v_now),last_used_at=coalesce(last_used_at,v_now)
   where credential_id=p_credential_id;
  update public.device_auth_enrollment_operations
     set status='confirmed',confirmed_at=v_now,
         result_ciphertext=null,result_iv=null,result_auth_tag=null,updated_at=v_now
   where operation_id=p_operation_id;
  insert into public.device_auth_events(device_id,credential_id,event_type,success,metadata_json)
  values (p_device_id,p_credential_id,'custodial_enrollment_operation_confirmed',true,jsonb_build_object('operation_id',p_operation_id));
  return jsonb_build_object(
    'ok',true,'replayed',false,'status','confirmed','operation_id',p_operation_id,
    'credential_id',p_credential_id,'credential_active',true
  );
end
$function$;

create or replace function public.device_auth_cancel_enrollment_operation(
  p_operation_id uuid,
  p_device_id uuid,
  p_credential_id uuid,
  p_token_hash text
) returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public
as $function$
declare
  v_now timestamptz:=clock_timestamp();
  v_operation public.device_auth_enrollment_operations%rowtype;
  v_credential public.device_auth_credentials%rowtype;
begin
  if p_operation_id is null or p_device_id is null or p_credential_id is null
     or p_token_hash is null or length(p_token_hash)<>64 then
    raise exception using errcode='22023',message='operation and credential proof are required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('custodial-enrollment-operation:'||p_operation_id::text,0));
  select * into v_operation from public.device_auth_enrollment_operations
   where operation_id=p_operation_id for update;
  if v_operation.operation_id is null
     or v_operation.device_id<>p_device_id
     or v_operation.credential_id<>p_credential_id then
    return jsonb_build_object('ok',false,'reason','operation_not_found');
  end if;
  select * into v_credential from public.device_auth_credentials
   where credential_id=p_credential_id and device_id=p_device_id and token_hash=p_token_hash;
  if v_credential.credential_id is null then
    return jsonb_build_object('ok',false,'reason','credential_mismatch');
  end if;
  if v_operation.status='confirmed' then
    return jsonb_build_object('ok',false,'reason','operation_confirmed');
  end if;
  if v_operation.status in ('cancelled','expired') then
    return jsonb_build_object('ok',true,'replayed',true,'status',v_operation.status,'operation_id',p_operation_id,'credential_id',p_credential_id);
  end if;

  update public.device_auth_credentials
     set revoked_at=coalesce(revoked_at,v_now),
         revoked_reason=case when revoked_at is null then 'enrollment_operation_cancelled' else revoked_reason end
   where credential_id=p_credential_id;
  update public.device_auth_enrollment_operations
     set status='cancelled',cancelled_at=v_now,
         result_ciphertext=null,result_iv=null,result_auth_tag=null,updated_at=v_now
   where operation_id=p_operation_id;
  insert into public.device_auth_events(device_id,credential_id,event_type,success,reason,metadata_json)
  values (p_device_id,p_credential_id,'custodial_enrollment_operation_cancelled',true,'client_cancelled',jsonb_build_object('operation_id',p_operation_id));
  return jsonb_build_object('ok',true,'replayed',false,'status','cancelled','operation_id',p_operation_id,'credential_id',p_credential_id);
end
$function$;

create or replace function public.device_auth_expire_custodial_enrollment_operations(
  p_now timestamptz default now(),
  p_limit integer default 100
) returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public
as $function$
declare
  v_count integer:=0;
begin
  with expired as (
    select operation_id,credential_id
    from public.device_auth_enrollment_operations
    where status='committed' and resume_expires_at<=p_now
    order by resume_expires_at,operation_id
    for update skip locked
    limit greatest(1,least(coalesce(p_limit,100),1000))
  ), revoked as (
    update public.device_auth_credentials credential
       set revoked_at=coalesce(credential.revoked_at,p_now),
           revoked_reason=case when credential.revoked_at is null then 'enrollment_operation_unconfirmed_timeout' else credential.revoked_reason end
      from expired
     where credential.credential_id=expired.credential_id
    returning credential.credential_id
  ), finalized as (
    update public.device_auth_enrollment_operations operation
       set status='expired',expired_at=coalesce(operation.expired_at,p_now),
           result_ciphertext=null,result_iv=null,result_auth_tag=null,updated_at=p_now
      from expired
     where operation.operation_id=expired.operation_id
    returning operation.operation_id
  )
  select count(*) into v_count from finalized;
  return jsonb_build_object('ok',true,'expired',v_count,'checked_at',p_now);
end
$function$;

revoke all on function public.device_auth_consume_enrollment_operation(uuid,text,uuid,text,text,uuid,text,text,timestamptz,text,text,text,timestamptz,text,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.device_auth_confirm_enrollment_operation(uuid,uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.device_auth_cancel_enrollment_operation(uuid,uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.device_auth_expire_custodial_enrollment_operations(timestamptz,integer) from public,anon,authenticated;
grant execute on function public.device_auth_consume_enrollment_operation(uuid,text,uuid,text,text,uuid,text,text,timestamptz,text,text,text,timestamptz,text,text,text,jsonb) to postgres,service_role;
grant execute on function public.device_auth_confirm_enrollment_operation(uuid,uuid,uuid,text) to postgres,service_role;
grant execute on function public.device_auth_cancel_enrollment_operation(uuid,uuid,uuid,text) to postgres,service_role;
grant execute on function public.device_auth_expire_custodial_enrollment_operations(timestamptz,integer) to postgres,service_role;

create or replace function public.mz_reconcile_employee_push_credential_state()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public
as $function$
declare
  v_reason text;
begin
  if new.revoked_at is null and new.expires_at>clock_timestamp() then
    return new;
  end if;
  v_reason:=case when new.revoked_at is not null then 'device_credential_revoked' else 'device_credential_expired' end;
  update public.employee_push_registrations
     set active=false,revoked_at=coalesce(revoked_at,clock_timestamp()),revoked_reason=v_reason,updated_at=clock_timestamp()
   where credential_id=new.credential_id and (active=true or revoked_at is null);
  update public.event_push_instances
     set state='cancelled',cancelled_at=coalesce(cancelled_at,clock_timestamp()),last_error=v_reason,updated_at=clock_timestamp()
   where credential_id=new.credential_id and state in ('pending','leased');
  update public.operational_notification_jobs
     set status='dead',completed_at=coalesce(completed_at,clock_timestamp()),last_error=v_reason,updated_at=clock_timestamp()
   where job_type in ('employee_event_push','employee_native_push')
     and status in ('pending','leased')
     and payload_json->>'credential_id'=new.credential_id::text
     and (status='pending' or leased_until<clock_timestamp());
  return new;
end
$function$;

revoke all on function public.mz_reconcile_employee_push_credential_state() from public,anon,authenticated;
drop trigger if exists trg_mz_reconcile_employee_push_credential_state on public.device_auth_credentials;
create trigger trg_mz_reconcile_employee_push_credential_state
after update of revoked_at,expires_at on public.device_auth_credentials
for each row
when (old.revoked_at is distinct from new.revoked_at or old.expires_at is distinct from new.expires_at)
execute function public.mz_reconcile_employee_push_credential_state();

create or replace function public.mz_resolve_employee_push_delivery(
  p_credential_id uuid,
  p_assignment_epoch bigint,
  p_now timestamptz default now()
) returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public
as $function$
declare
  v_registration public.employee_push_registrations%rowtype;
  v_credential public.device_auth_credentials%rowtype;
  v_device public.devices%rowtype;
  v_employee_active boolean;
  v_reason text;
begin
  if p_credential_id is null or p_assignment_epoch is null or p_assignment_epoch<1 then
    raise exception using errcode='22023',message='credential and assignment epoch are required';
  end if;

  select * into v_registration
  from public.employee_push_registrations
  where credential_id=p_credential_id and assignment_epoch=p_assignment_epoch
  order by active desc,last_seen_at desc
  limit 1
  for update;

  select * into v_credential from public.device_auth_credentials
   where credential_id=p_credential_id;
  if v_credential.credential_id is not null then
    select * into v_device from public.devices where id=v_credential.device_id;
  end if;
  if v_registration.registration_id is not null then
    select active into v_employee_active from public.employees where id=v_registration.employee_id;
  end if;

  v_reason:=case
    when v_registration.registration_id is null then 'push_registration_missing'
    when v_credential.credential_id is null then 'device_credential_missing'
    when v_credential.revoked_at is not null then 'device_credential_revoked'
    when v_credential.expires_at<=p_now then 'device_credential_expired'
    when v_credential.confirmed_at is null then 'device_credential_unconfirmed'
    when v_registration.active is not true or v_registration.revoked_at is not null then 'push_registration_revoked'
    when v_device.id is null or v_device.id<>v_registration.device_id or v_credential.device_id<>v_registration.device_id then 'device_credential_device_mismatch'
    when v_device.active is not true then 'device_inactive'
    when v_device.assigned_employee_id is null or v_device.assigned_employee_id<>v_registration.employee_id then 'employee_assignment_superseded'
    when v_device.assignment_epoch<>v_registration.assignment_epoch or v_device.assignment_epoch<>p_assignment_epoch then 'assignment_epoch_superseded'
    when v_employee_active is not true then 'employee_inactive'
    else null
  end;

  if v_reason is not null then
    if v_registration.registration_id is not null and (v_registration.active=true or v_registration.revoked_at is null) then
      update public.employee_push_registrations
         set active=false,revoked_at=coalesce(revoked_at,p_now),revoked_reason=v_reason,updated_at=p_now
       where registration_id=v_registration.registration_id;
    end if;
    update public.event_push_instances
       set state='cancelled',cancelled_at=coalesce(cancelled_at,p_now),last_error=v_reason,updated_at=p_now
     where credential_id=p_credential_id and assignment_epoch=p_assignment_epoch and state in ('pending','leased');
    update public.operational_notification_jobs
       set status='dead',completed_at=coalesce(completed_at,p_now),last_error=v_reason,updated_at=p_now
     where job_type in ('employee_event_push','employee_native_push')
       and status in ('pending','leased')
       and payload_json->>'credential_id'=p_credential_id::text
       and payload_json->>'assignment_epoch'=p_assignment_epoch::text
       and (status='pending' or leased_until<p_now);
    return jsonb_build_object('ok',false,'terminal',true,'reason',v_reason);
  end if;

  return jsonb_build_object(
    'ok',true,'checked_at',p_now,
    'registration',to_jsonb(v_registration),
    'credential_id',p_credential_id,
    'device_id',v_registration.device_id,
    'employee_id',v_registration.employee_id,
    'assignment_epoch',v_registration.assignment_epoch
  );
end
$function$;

create or replace function public.finish_operational_notification_job_terminal(
  p_job_id uuid,
  p_lease_token uuid,
  p_error text
) returns public.operational_notification_jobs
language plpgsql
security definer
set search_path=pg_catalog,public
as $function$
declare
  v_row public.operational_notification_jobs%rowtype;
begin
  select * into v_row from public.operational_notification_jobs where job_id=p_job_id for update;
  if v_row.job_id is null
     or v_row.lease_token is distinct from p_lease_token
     or v_row.status not in ('leased','dead') then
    raise exception 'notification job lease is no longer authoritative';
  end if;
  update public.operational_notification_jobs
     set status='dead',completed_at=coalesce(completed_at,now()),
         leased_at=null,leased_until=null,lease_token=null,worker_id=null,
         last_error=left(coalesce(p_error,'notification recipient is no longer authorized'),2000),
         updated_at=now()
   where job_id=p_job_id
   returning * into v_row;
  return v_row;
end
$function$;

revoke all on function public.mz_resolve_employee_push_delivery(uuid,bigint,timestamptz) from public,anon,authenticated;
revoke all on function public.finish_operational_notification_job_terminal(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.mz_resolve_employee_push_delivery(uuid,bigint,timestamptz) to postgres,service_role;
grant execute on function public.finish_operational_notification_job_terminal(uuid,uuid,text) to postgres,service_role;

do $cron$
begin
  if to_regprocedure('cron.schedule(text,text,text)') is not null then
    perform cron.schedule(
      'mz-custodial-enrollment-operation-expiry',
      '*/5 * * * *',
      'select public.device_auth_expire_custodial_enrollment_operations(now(),500);'
    );
  end if;
end
$cron$;

comment on table public.device_auth_enrollment_operations is
  'Short-lived AES-GCM ciphertext for idempotent native custodial enrollment response recovery. Plaintext device credentials are never stored here.';
comment on function public.mz_resolve_employee_push_delivery(uuid,bigint,timestamptz) is
  'Fail-closed final recipient resolution for employee FCM delivery. Reconciles stale registrations against current credential, device, employee, and assignment state.';

commit;
