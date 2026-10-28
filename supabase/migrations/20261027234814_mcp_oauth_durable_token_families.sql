-- Source-only proposal. Activation requires reviewed legacy OAuth reauthorization;
-- no manager/device/browser trust table or legacy connector token is changed.
begin;
create table public.mcp_oauth_replay_artifacts_v2 (
  artifact_digest text primary key check (artifact_digest ~ '^[0-9a-f]{64}$'),
  authority_generation bigint not null check (authority_generation >= 0),
  artifact_kind text not null check (artifact_kind in ('decision','code')),
  expires_at timestamptz not null,
  consumed_at timestamptz not null default clock_timestamp()
);
create table public.mcp_oauth_token_families_v2 (
  family_digest text primary key check (family_digest ~ '^[0-9a-f]{64}$'),
  authority_generation bigint not null check (authority_generation >= 0),
  binding_digest text not null check (binding_digest ~ '^[0-9a-f]{64}$'),
  current_refresh_digest text check (current_refresh_digest ~ '^[0-9a-f]{64}$'),
  generation bigint not null default 0 check (generation >= 0 and generation <= 9007199254740991),
  expires_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  revoked_at timestamptz,
  revocation_reason text check (revocation_reason is null or revocation_reason='refresh_reuse')
);
alter table public.mcp_oauth_replay_artifacts_v2 enable row level security;
alter table public.mcp_oauth_token_families_v2 enable row level security;
revoke all on public.mcp_oauth_replay_artifacts_v2, public.mcp_oauth_token_families_v2 from public, anon, authenticated, service_role;
grant select, insert on public.mcp_oauth_replay_artifacts_v2 to service_role;
grant select, insert, update on public.mcp_oauth_token_families_v2 to service_role;

-- Reuse the existing service-only shared mutation fence and its non-restored
-- control authority. No direct custodial_dr grant and no new SECURITY DEFINER.
create function public.mcp_oauth_authority_generation_v2()
returns text language sql volatile security invoker set search_path=pg_catalog,public set lock_timeout='5s' set statement_timeout='8s' as $$
  select public.custodial_begin_application_mutation()::text;
$$;

create function public.mcp_oauth_consume_decision_v2(p_artifact_digest text,p_expires_at bigint,p_authority_generation text)
returns boolean language plpgsql security invoker set search_path=pg_catalog,public set lock_timeout='5s' set statement_timeout='8s' as $$
declare v_authority_generation bigint;
begin
  v_authority_generation := public.custodial_begin_application_mutation();
  if p_authority_generation is null or p_authority_generation <> v_authority_generation::text then return false; end if;
  if p_artifact_digest is null or p_artifact_digest !~ '^[0-9a-f]{64}$' or p_expires_at is null
    or p_expires_at <= extract(epoch from clock_timestamp()) or p_expires_at > extract(epoch from clock_timestamp())+600 then return false; end if;
  insert into public.mcp_oauth_replay_artifacts_v2(artifact_digest,authority_generation,artifact_kind,expires_at)
    values(p_artifact_digest,v_authority_generation,'decision',to_timestamp(p_expires_at)) on conflict do nothing;
  if not found then return false; end if;
  -- Unique-key contention can wait past expiration. Raising rolls back the insert.
  if p_expires_at <= extract(epoch from clock_timestamp()) then raise exception 'OAuth decision expired' using errcode='22023'; end if;
  return true;
end $$;

create function public.mcp_oauth_exchange_code_v2(p_code_digest text,p_code_expires_at bigint,p_family_digest text,
  p_binding_digest text,p_refresh_digest text,p_expires_at bigint,p_authority_generation text)
returns boolean language plpgsql security invoker set search_path=pg_catalog,public set lock_timeout='5s' set statement_timeout='8s' as $$
declare v_authority_generation bigint;
begin
  v_authority_generation := public.custodial_begin_application_mutation();
  if p_authority_generation is null or p_authority_generation <> v_authority_generation::text then return false; end if;
  if p_code_digest is null or p_code_digest !~ '^[0-9a-f]{64}$'
    or p_family_digest is null or p_family_digest !~ '^[0-9a-f]{64}$'
    or p_binding_digest is null or p_binding_digest !~ '^[0-9a-f]{64}$'
    or (p_refresh_digest is not null and p_refresh_digest !~ '^[0-9a-f]{64}$')
    or p_code_expires_at is null or p_expires_at is null
    or p_code_expires_at <= extract(epoch from clock_timestamp())
    or p_code_expires_at > extract(epoch from clock_timestamp())+600
    or p_expires_at <= extract(epoch from clock_timestamp())
    or p_expires_at > extract(epoch from clock_timestamp())+2592000 then return false; end if;
  insert into public.mcp_oauth_replay_artifacts_v2(artifact_digest,authority_generation,artifact_kind,expires_at)
    values(p_code_digest,v_authority_generation,'code',to_timestamp(p_code_expires_at)) on conflict do nothing;
  if not found then return false; end if;
  -- This family INSERT and the code's one-use INSERT commit or roll back together.
  insert into public.mcp_oauth_token_families_v2(family_digest,authority_generation,binding_digest,current_refresh_digest,expires_at)
    values(p_family_digest,v_authority_generation,p_binding_digest,p_refresh_digest,to_timestamp(p_expires_at));
  if p_code_expires_at <= extract(epoch from clock_timestamp()) or p_expires_at <= extract(epoch from clock_timestamp()) then
    raise exception 'OAuth code expired' using errcode='22023'; end if;
  return true;
end $$;

create function public.mcp_oauth_rotate_refresh_v2(p_family_digest text,p_binding_digest text,p_previous_digest text,
  p_generation bigint,p_next_digest text,p_expires_at bigint,p_authority_generation text)
returns boolean language plpgsql security invoker set search_path=pg_catalog,public set lock_timeout='5s' set statement_timeout='8s' as $$
declare f public.mcp_oauth_token_families_v2%rowtype; v_authority_generation bigint;
begin
  v_authority_generation := public.custodial_begin_application_mutation();
  if p_authority_generation is null or p_authority_generation <> v_authority_generation::text then return false; end if;
  if p_family_digest is null or p_family_digest !~ '^[0-9a-f]{64}$'
    or p_binding_digest is null or p_binding_digest !~ '^[0-9a-f]{64}$'
    or p_previous_digest is null or p_previous_digest !~ '^[0-9a-f]{64}$'
    or p_next_digest is null or p_next_digest !~ '^[0-9a-f]{64}$' or p_next_digest=p_previous_digest
    or p_generation is null or p_generation < 0 or p_generation >= 9007199254740991
    or p_expires_at is null then return false; end if;
  select * into f from public.mcp_oauth_token_families_v2 where family_digest=p_family_digest for update;
  if not found or f.authority_generation <> v_authority_generation or f.binding_digest <> p_binding_digest or f.revoked_at is not null
    or f.expires_at <= clock_timestamp() or p_expires_at <= extract(epoch from clock_timestamp())
    or p_expires_at > extract(epoch from clock_timestamp())+2592000 then return false; end if;
  if f.generation<>p_generation or f.current_refresh_digest is distinct from p_previous_digest then
    -- Return false rather than raising: the reuse revocation MUST commit.
    update public.mcp_oauth_token_families_v2 set revoked_at=clock_timestamp(),revocation_reason='refresh_reuse'
      where family_digest=p_family_digest;
    return false;
  end if;
  update public.mcp_oauth_token_families_v2 set current_refresh_digest=p_next_digest,
    generation=p_generation+1,expires_at=to_timestamp(p_expires_at) where family_digest=p_family_digest;
  return true;
end $$;

create function public.mcp_oauth_family_active_v2(p_family_digest text,p_binding_digest text,p_authority_generation text)
returns boolean language plpgsql volatile security invoker set search_path=pg_catalog,public set lock_timeout='5s' set statement_timeout='8s' as $$
declare v_authority_generation bigint;
begin
  v_authority_generation := public.custodial_begin_application_mutation();
  if p_authority_generation is null or p_authority_generation <> v_authority_generation::text then return false; end if;
  return exists(select 1 from public.mcp_oauth_token_families_v2 where family_digest=p_family_digest
    and authority_generation=v_authority_generation and binding_digest=p_binding_digest
    and revoked_at is null and expires_at>clock_timestamp());
end $$;
revoke all on function public.mcp_oauth_authority_generation_v2(),public.mcp_oauth_consume_decision_v2(text,bigint,text),
  public.mcp_oauth_exchange_code_v2(text,bigint,text,text,text,bigint,text),
  public.mcp_oauth_rotate_refresh_v2(text,text,text,bigint,text,bigint,text),
  public.mcp_oauth_family_active_v2(text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.mcp_oauth_authority_generation_v2(),public.mcp_oauth_consume_decision_v2(text,bigint,text),
  public.mcp_oauth_exchange_code_v2(text,bigint,text,text,text,bigint,text),
  public.mcp_oauth_rotate_refresh_v2(text,text,text,bigint,text,bigint,text),
  public.mcp_oauth_family_active_v2(text,text,text) to service_role;
commit;
