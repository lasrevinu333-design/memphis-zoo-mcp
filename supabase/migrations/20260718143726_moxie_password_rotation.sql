-- Complete the existing Moxie persistent-credential design with one atomic,
-- service-role-only rotation primitive. Password derivation remains in the
-- application process; PostgreSQL receives only a random salt and derived
-- hash, never plaintext.

create or replace function public.rotate_moxie_auth_credential(
  p_credential_key text,
  p_expected_version integer,
  p_password_salt text,
  p_password_hash text,
  p_updated_by text
)
returns table(password_version integer, updated_at timestamptz)
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_credential public.moxie_auth_credentials%rowtype;
begin
  if btrim(coalesce(p_credential_key, '')) = '' then
    raise exception using errcode = '22023', message = 'credential key is required';
  end if;
  if coalesce(p_expected_version, -1) < 0 then
    raise exception using errcode = '22023', message = 'expected version must be zero or greater';
  end if;
  if p_password_salt is null or p_password_salt !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'password salt format is invalid';
  end if;
  if p_password_hash is null or p_password_hash !~ '^[0-9a-f]{128}$' then
    raise exception using errcode = '22023', message = 'password hash format is invalid';
  end if;

  if p_expected_version = 0 then
    insert into public.moxie_auth_credentials(
      credential_key,
      password_salt,
      password_hash,
      password_version,
      updated_by,
      created_at,
      updated_at
    ) values (
      btrim(p_credential_key),
      p_password_salt,
      p_password_hash,
      1,
      nullif(left(btrim(coalesce(p_updated_by, '')), 160), ''),
      now(),
      now()
    )
    on conflict (credential_key) do nothing
    returning * into v_credential;
  else
    update public.moxie_auth_credentials as credential
       set password_salt = p_password_salt,
           password_hash = p_password_hash,
           password_version = credential.password_version + 1,
           updated_by = nullif(left(btrim(coalesce(p_updated_by, '')), 160), ''),
           updated_at = now()
     where credential.credential_key = btrim(p_credential_key)
       and credential.password_version = p_expected_version
    returning credential.* into v_credential;
  end if;

  if v_credential.credential_key is null then
    raise exception using
      errcode = '40001',
      message = 'Moxie credential changed concurrently; reload and try again.';
  end if;

  return query
  select v_credential.password_version, v_credential.updated_at;
end;
$$;

revoke all on function public.rotate_moxie_auth_credential(text, integer, text, text, text) from public, anon, authenticated;
grant execute on function public.rotate_moxie_auth_credential(text, integer, text, text, text) to service_role;

comment on function public.rotate_moxie_auth_credential(text, integer, text, text, text) is
  'Atomically creates or rotates the private Moxie scrypt credential using optimistic version control. Service role only; accepts no plaintext password.';
