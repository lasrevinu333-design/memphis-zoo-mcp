create or replace function public.device_auth_issue_enrollment_code(
  p_device_id uuid,
  p_code_hash text,
  p_created_by text,
  p_expires_at timestamptz,
  p_metadata_json jsonb default '{}'::jsonb
)
returns table(enrollment_id uuid, device_id uuid, expires_at timestamptz)
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'extensions'
as $function$
declare
  v_row public.device_auth_enrollment_codes%rowtype;
begin
  if p_device_id is null then raise exception 'device_id is required'; end if;
  if p_code_hash is null or length(p_code_hash) <> 64 then raise exception 'valid code_hash is required'; end if;
  if p_expires_at is null or p_expires_at <= now() then raise exception 'future expires_at is required'; end if;
  if coalesce(p_metadata_json, '{}'::jsonb) is null or jsonb_typeof(coalesce(p_metadata_json, '{}'::jsonb)) <> 'object' then
    raise exception 'metadata_json must be an object';
  end if;
  if not exists(select 1 from public.devices d where d.id = p_device_id and d.active = true) then
    raise exception 'active device not found';
  end if;

  update public.device_auth_enrollment_codes c
  set revoked_at = now(),
      status = 'revoked',
      metadata_json = c.metadata_json || jsonb_build_object('revoked_reason','replaced')
  where c.device_id = p_device_id
    and c.consumed_at is null
    and c.revoked_at is null;

  insert into public.device_auth_enrollment_codes(
    device_id, code_hash, created_by, expires_at, metadata_json,
    purpose, max_uses, use_count, status
  ) values (
    p_device_id, p_code_hash,
    coalesce(nullif(left(btrim(coalesce(p_created_by,'')),160),''),'ops_manager'),
    p_expires_at, coalesce(p_metadata_json,'{}'::jsonb),
    coalesce(nullif(left(coalesce(p_metadata_json->>'purpose',''),80),''),'employee_device_enrollment'),
    1, 0, 'active'
  )
  returning * into v_row;

  return query select v_row.enrollment_id, v_row.device_id, v_row.expires_at;
end;
$function$;

create or replace function public.device_auth_consume_enrollment_code(
  p_device_id uuid,
  p_code_hash text,
  p_credential_id uuid,
  p_token_hash text,
  p_device_label text,
  p_expires_at timestamptz,
  p_user_agent_hash text default null,
  p_ip_hash text default null,
  p_metadata_json jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'extensions'
as $function$
declare
  v_code public.device_auth_enrollment_codes%rowtype;
  v_now timestamptz := now();
  v_credential public.device_auth_credentials%rowtype;
begin
  if p_device_id is null then raise exception 'device_id is required'; end if;
  if p_code_hash is null or length(p_code_hash) <> 64 then raise exception 'valid code_hash is required'; end if;
  if p_credential_id is null then raise exception 'credential_id is required'; end if;
  if p_token_hash is null or length(p_token_hash) <> 64 then raise exception 'valid token_hash is required'; end if;
  if p_expires_at is null or p_expires_at <= v_now then raise exception 'future expires_at is required'; end if;

  select *
    into v_code
  from public.device_auth_enrollment_codes c
  where c.device_id = p_device_id
    and c.consumed_at is null
    and c.revoked_at is null
    and c.status = 'active'
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'missing');
  end if;
  if v_code.expires_at <= v_now then
    update public.device_auth_enrollment_codes c
    set status = 'expired'
    where c.enrollment_id = v_code.enrollment_id;
    return jsonb_build_object('ok', false, 'reason', 'expired', 'enrollment_id', v_code.enrollment_id);
  end if;
  if v_code.code_hash <> p_code_hash then
    update public.device_auth_enrollment_codes c
    set failed_attempts = least(10, c.failed_attempts + 1),
        last_failed_at = v_now
    where c.enrollment_id = v_code.enrollment_id;
    return jsonb_build_object('ok', false, 'reason', 'invalid', 'enrollment_id', v_code.enrollment_id);
  end if;

  update public.device_auth_credentials dc
  set revoked_at = v_now,
      revoked_reason = 'replaced_by_new_enrollment'
  where dc.device_id = p_device_id
    and dc.revoked_at is null;

  insert into public.device_auth_credentials(
    credential_id, device_id, token_hash, device_label, user_agent_hash,
    created_ip_hash, expires_at, metadata_json
  ) values (
    p_credential_id, p_device_id, p_token_hash, nullif(left(coalesce(p_device_label,''),160),''),
    p_user_agent_hash, p_ip_hash, p_expires_at, coalesce(p_metadata_json,'{}'::jsonb)
  )
  returning * into v_credential;

  update public.device_auth_enrollment_codes c
  set consumed_at = v_now,
      consumed_by_credential_id = p_credential_id,
      use_count = 1,
      status = 'used'
  where c.enrollment_id = v_code.enrollment_id;

  return jsonb_build_object(
    'ok', true,
    'enrollment_id', v_code.enrollment_id,
    'credential_id', v_credential.credential_id,
    'expires_at', v_credential.expires_at
  );
end;
$function$;

revoke all on function public.device_auth_issue_enrollment_code(uuid, text, text, timestamptz, jsonb) from public, anon, authenticated;
revoke all on function public.device_auth_consume_enrollment_code(uuid, text, uuid, text, text, timestamptz, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.device_auth_issue_enrollment_code(uuid, text, text, timestamptz, jsonb) to postgres, service_role;
grant execute on function public.device_auth_consume_enrollment_code(uuid, text, uuid, text, text, timestamptz, text, text, jsonb) to postgres, service_role;
