-- Professional Gemini Console foundation.
-- Forward-only: adds private, manager-scoped chat, attachment, proposal, and
-- controlled-repair records. Existing Memphis/Moxie data is not rewritten.

create table if not exists public.gemini_console_conversations (
  conversation_id uuid primary key default gen_random_uuid(),
  owner_manager_id uuid not null references public.ops_manager_managers(manager_id),
  title text not null default 'New chat',
  status text not null default 'active' check (status in ('active','archived','deleted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  archived_at timestamptz,
  deleted_at timestamptz,
  metadata_json jsonb not null default '{}'::jsonb,
  draft_text text not null default '',
  draft_updated_at timestamptz,
  check (char_length(title) between 1 and 160),
  check (char_length(draft_text) <= 30000)
);

create index if not exists idx_gemini_console_conversations_owner_activity
  on public.gemini_console_conversations(owner_manager_id, last_activity_at desc)
  where status <> 'deleted';

create table if not exists public.gemini_console_messages (
  message_id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.gemini_console_conversations(conversation_id),
  manager_id uuid not null references public.ops_manager_managers(manager_id),
  role text not null check (role in ('user','assistant','system')),
  body text not null default '',
  state text not null default 'queued' check (state in ('queued','generating','completed','failed','cancelled')),
  client_message_id uuid not null,
  response_to_message_id uuid references public.gemini_console_messages(message_id),
  correlation_id uuid not null,
  provider text,
  model text,
  error_code text,
  error_message text,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  cancelled_at timestamptz,
  check (char_length(body) <= 100000),
  unique (manager_id, client_message_id)
);

create unique index if not exists idx_gemini_console_messages_one_response
  on public.gemini_console_messages(response_to_message_id)
  where response_to_message_id is not null and role = 'assistant';
create index if not exists idx_gemini_console_messages_conversation_created
  on public.gemini_console_messages(conversation_id, created_at, message_id);
create index if not exists idx_gemini_console_messages_manager
  on public.gemini_console_messages(manager_id);
create index if not exists idx_gemini_console_messages_search
  on public.gemini_console_messages using gin(to_tsvector('english', coalesce(body, '')));

create table if not exists public.gemini_console_attachments (
  attachment_id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.gemini_console_conversations(conversation_id),
  manager_id uuid not null references public.ops_manager_managers(manager_id),
  message_id uuid references public.gemini_console_messages(message_id),
  storage_bucket text not null default 'gemini-console-private',
  storage_path text not null,
  original_filename text not null,
  mime_type text not null,
  extension text not null,
  size_bytes bigint not null check (size_bytes between 1 and 6291456),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  status text not null default 'pending' check (status in ('pending','attached','deleted','rejected')),
  created_at timestamptz not null default now(),
  attached_at timestamptz,
  deleted_at timestamptz,
  retain_until timestamptz not null default (now() + interval '90 days'),
  metadata_json jsonb not null default '{}'::jsonb,
  unique (storage_bucket, storage_path)
);

create unique index if not exists idx_gemini_console_attachments_active_hash
  on public.gemini_console_attachments(conversation_id, sha256)
  where status in ('pending','attached');

create index if not exists idx_gemini_console_attachments_manager
  on public.gemini_console_attachments(manager_id);
create index if not exists idx_gemini_console_attachments_message
  on public.gemini_console_attachments(message_id)
  where message_id is not null;
create index if not exists idx_gemini_console_attachments_cleanup
  on public.gemini_console_attachments(status, created_at, retain_until);

create table if not exists public.gemini_console_repair_proposals (
  proposal_id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.gemini_console_conversations(conversation_id),
  source_message_id uuid not null references public.gemini_console_messages(message_id),
  proposed_by_manager_id uuid not null references public.ops_manager_managers(manager_id),
  plan_revision integer not null default 1 check (plan_revision > 0),
  plan_sha256 text not null check (plan_sha256 ~ '^[0-9a-f]{64}$'),
  plan_text text not null,
  affected_components text[] not null default '{}'::text[],
  risk_level text not null default 'review' check (risk_level in ('low','review','high','destructive')),
  repair_kind text not null default 'controlled_source_repair' check (repair_kind in ('controlled_source_repair','acceptance_probe')),
  status text not null default 'proposed' check (status in ('proposed','authorized','superseded','expired','cancelled')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  authorized_at timestamptz,
  metadata_json jsonb not null default '{}'::jsonb,
  unique (conversation_id, plan_revision),
  unique (source_message_id)
);

create index if not exists idx_gemini_console_proposals_manager_status
  on public.gemini_console_repair_proposals(proposed_by_manager_id, status, created_at desc);

create table if not exists public.gemini_console_repair_jobs (
  repair_job_id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null unique references public.gemini_console_repair_proposals(proposal_id),
  conversation_id uuid not null references public.gemini_console_conversations(conversation_id),
  approving_manager_id uuid not null references public.ops_manager_managers(manager_id),
  approving_credential_id uuid not null references public.ops_manager_trusted_devices(credential_id),
  authorization_message_id uuid not null references public.gemini_console_messages(message_id),
  operation_id uuid not null unique,
  status text not null default 'authorized' check (status in ('authorized','queued','backing_up','repairing','testing','deploying','verifying','completed','failed','rolled_back','blocked','cancelled')),
  execution_mode text not null default 'controlled_worker' check (execution_mode in ('controlled_worker','acceptance_probe')),
  affected_components text[] not null default '{}'::text[],
  starting_backend_commit text,
  starting_frontend_commit text,
  starting_schema_fingerprint text,
  release_id text,
  backup_reference text,
  branch_name text,
  changed_files jsonb not null default '[]'::jsonb,
  test_evidence jsonb not null default '[]'::jsonb,
  migration_evidence jsonb not null default '[]'::jsonb,
  deployment_evidence jsonb not null default '[]'::jsonb,
  verification_evidence jsonb not null default '[]'::jsonb,
  rollback_evidence jsonb not null default '[]'::jsonb,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  authorized_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz not null default now(),
  metadata_json jsonb not null default '{}'::jsonb
);

create index if not exists idx_gemini_console_repair_jobs_manager_status
  on public.gemini_console_repair_jobs(approving_manager_id, status, created_at desc);
create index if not exists idx_gemini_console_repair_jobs_conversation
  on public.gemini_console_repair_jobs(conversation_id, created_at desc);

create table if not exists public.gemini_console_repair_job_events (
  event_id uuid primary key default gen_random_uuid(),
  repair_job_id uuid not null references public.gemini_console_repair_jobs(repair_job_id),
  event_type text not null,
  status text not null,
  correlation_id uuid not null,
  actor_manager_id uuid references public.ops_manager_managers(manager_id),
  created_at timestamptz not null default now(),
  detail_json jsonb not null default '{}'::jsonb
);

create index if not exists idx_gemini_console_repair_events_job
  on public.gemini_console_repair_job_events(repair_job_id, created_at, event_id);
create index if not exists idx_gemini_console_repair_events_actor
  on public.gemini_console_repair_job_events(actor_manager_id)
  where actor_manager_id is not null;

alter table public.gemini_console_conversations enable row level security;
alter table public.gemini_console_conversations force row level security;
alter table public.gemini_console_messages enable row level security;
alter table public.gemini_console_messages force row level security;
alter table public.gemini_console_attachments enable row level security;
alter table public.gemini_console_attachments force row level security;
alter table public.gemini_console_repair_proposals enable row level security;
alter table public.gemini_console_repair_proposals force row level security;
alter table public.gemini_console_repair_jobs enable row level security;
alter table public.gemini_console_repair_jobs force row level security;
alter table public.gemini_console_repair_job_events enable row level security;
alter table public.gemini_console_repair_job_events force row level security;

revoke all on table public.gemini_console_conversations from anon, authenticated, public;
revoke all on table public.gemini_console_messages from anon, authenticated, public;
revoke all on table public.gemini_console_attachments from anon, authenticated, public;
revoke all on table public.gemini_console_repair_proposals from anon, authenticated, public;
revoke all on table public.gemini_console_repair_jobs from anon, authenticated, public;
revoke all on table public.gemini_console_repair_job_events from anon, authenticated, public;
grant select, insert, update on table public.gemini_console_conversations to postgres, service_role;
grant select, insert, update on table public.gemini_console_messages to postgres, service_role;
grant select, insert, update, delete on table public.gemini_console_attachments to postgres, service_role;
grant select, insert, update on table public.gemini_console_repair_proposals to postgres, service_role;
grant select, insert, update on table public.gemini_console_repair_jobs to postgres, service_role;
grant select, insert on table public.gemini_console_repair_job_events to postgres, service_role;

-- The source rebuild database does not install the hosted Storage schema. The
-- production Supabase database does; create/update the private bucket there
-- without making Storage a prerequisite for reconstructing the public schema.
do $bucket$
begin
  if to_regclass('storage.buckets') is not null then
    execute $sql$
      insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
      values (
        'gemini-console-private',
        'gemini-console-private',
        false,
        6291456,
        array[
          'image/png','image/jpeg','image/webp','image/gif','application/pdf',
          'text/plain','text/markdown','text/csv','application/json',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        ]::text[]
      )
      on conflict (id) do update set
        public = false,
        file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types
    $sql$;
  end if;
end
$bucket$;

create or replace function public.gemini_console_begin_turn(
  p_conversation_id uuid,
  p_manager_id uuid,
  p_client_message_id uuid,
  p_body text,
  p_attachment_ids uuid[],
  p_correlation_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $function$
declare
  v_conversation public.gemini_console_conversations%rowtype;
  v_message public.gemini_console_messages%rowtype;
  v_assistant public.gemini_console_messages%rowtype;
  v_inserted boolean := false;
  v_claimed boolean := false;
  v_expected integer := coalesce(cardinality(p_attachment_ids), 0);
  v_attached integer := 0;
begin
  if p_conversation_id is null or p_manager_id is null or p_client_message_id is null or p_correlation_id is null then
    raise exception 'conversation, manager, client message, and correlation identifiers are required';
  end if;
  if nullif(btrim(coalesce(p_body, '')), '') is null then raise exception 'message body is required'; end if;
  if char_length(p_body) > 30000 then raise exception 'message body exceeds 30000 characters'; end if;

  select * into v_conversation
  from public.gemini_console_conversations
  where conversation_id = p_conversation_id
  for update;
  if not found or v_conversation.status <> 'active' then raise exception 'active conversation not found'; end if;
  if v_conversation.owner_manager_id <> p_manager_id then raise exception 'conversation access denied'; end if;
  if not exists (
    select 1 from public.ops_manager_managers m
    where m.manager_id = p_manager_id and m.active and m.revoked_at is null
  ) then raise exception 'active manager not found'; end if;

  insert into public.gemini_console_messages(
    conversation_id, manager_id, role, body, state, client_message_id,
    correlation_id, metadata_json
  ) values (
    p_conversation_id, p_manager_id, 'user', p_body, 'queued',
    p_client_message_id, p_correlation_id,
    jsonb_build_object('source', 'direct_authenticated_user')
  )
  on conflict (manager_id, client_message_id) do nothing
  returning * into v_message;
  v_inserted := found;

  if not v_inserted then
    select * into v_message
    from public.gemini_console_messages
    where manager_id = p_manager_id and client_message_id = p_client_message_id
    for update;
    if v_message.conversation_id <> p_conversation_id or v_message.role <> 'user' or v_message.body <> p_body then
      raise exception 'client message identifier conflicts with another logical message';
    end if;
  end if;

  if v_expected > 0 then
    update public.gemini_console_attachments
    set message_id = v_message.message_id,
        status = 'attached',
        attached_at = coalesce(attached_at, now())
    where attachment_id = any(p_attachment_ids)
      and conversation_id = p_conversation_id
      and manager_id = p_manager_id
      and (status = 'pending' or message_id = v_message.message_id);
    get diagnostics v_attached = row_count;
    if v_attached <> v_expected then raise exception 'one or more attachments are unavailable'; end if;
  end if;

  select * into v_assistant
  from public.gemini_console_messages
  where response_to_message_id = v_message.message_id and role = 'assistant'
  limit 1;

  if v_assistant.message_id is null and v_message.state in ('queued','failed','cancelled') then
    update public.gemini_console_messages
    set state = 'generating', error_code = null, error_message = null,
        cancelled_at = null
    where message_id = v_message.message_id
      and state in ('queued','failed','cancelled')
    returning * into v_message;
    v_claimed := found;
  end if;

  update public.gemini_console_conversations
  set last_activity_at = now(), updated_at = now(),
      title = case when title = 'New chat' then left(regexp_replace(p_body, E'[\\n\\r\\t]+', ' ', 'g'), 80) else title end
  where conversation_id = p_conversation_id;

  return jsonb_build_object(
    'inserted', v_inserted,
    'claimed', v_claimed,
    'user_message', to_jsonb(v_message),
    'assistant_message', case when v_assistant.message_id is null then null else to_jsonb(v_assistant) end
  );
end
$function$;

create or replace function public.gemini_console_complete_turn(
  p_user_message_id uuid,
  p_body text,
  p_provider text,
  p_model text,
  p_correlation_id uuid,
  p_metadata_json jsonb
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $function$
declare
  v_user public.gemini_console_messages%rowtype;
  v_assistant public.gemini_console_messages%rowtype;
begin
  select * into v_user from public.gemini_console_messages
  where message_id = p_user_message_id and role = 'user' for update;
  if not found then raise exception 'user message not found'; end if;

  insert into public.gemini_console_messages(
    conversation_id, manager_id, role, body, state, client_message_id,
    response_to_message_id, correlation_id, provider, model, metadata_json,
    completed_at
  ) values (
    v_user.conversation_id, v_user.manager_id, 'assistant', coalesce(p_body,''),
    'completed', gen_random_uuid(), v_user.message_id, p_correlation_id,
    nullif(btrim(p_provider),''), nullif(btrim(p_model),''),
    coalesce(p_metadata_json,'{}'::jsonb), now()
  )
  on conflict (response_to_message_id) where response_to_message_id is not null and role = 'assistant'
  do update set body = excluded.body, state = 'completed', provider = excluded.provider,
    model = excluded.model, metadata_json = excluded.metadata_json,
    completed_at = coalesce(public.gemini_console_messages.completed_at, excluded.completed_at)
  returning * into v_assistant;

  update public.gemini_console_messages
  set state = 'completed', completed_at = now(), error_code = null, error_message = null
  where message_id = v_user.message_id;
  update public.gemini_console_conversations
  set updated_at = now(), last_activity_at = now()
  where conversation_id = v_user.conversation_id;
  return to_jsonb(v_assistant);
end
$function$;

create or replace function public.gemini_console_fail_turn(
  p_user_message_id uuid,
  p_state text,
  p_error_code text,
  p_error_message text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $function$
declare v_message public.gemini_console_messages%rowtype;
begin
  if p_state not in ('failed','cancelled') then raise exception 'invalid terminal state'; end if;
  update public.gemini_console_messages
  set state = p_state,
      error_code = left(coalesce(p_error_code,'request_failed'),80),
      error_message = left(coalesce(p_error_message,'Request failed.'),500),
      cancelled_at = case when p_state='cancelled' then now() else cancelled_at end
  where message_id = p_user_message_id and role='user' and state='generating'
  returning * into v_message;
  return case when v_message.message_id is null then null else to_jsonb(v_message) end;
end
$function$;

create or replace function public.gemini_console_authorize_repair(
  p_proposal_id uuid,
  p_manager_id uuid,
  p_credential_id uuid,
  p_authorization_message_id uuid,
  p_operation_id uuid,
  p_release_id text,
  p_backend_commit text,
  p_frontend_commit text,
  p_schema_fingerprint text,
  p_correlation_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $function$
declare
  v_proposal public.gemini_console_repair_proposals%rowtype;
  v_authorization public.gemini_console_messages%rowtype;
  v_job public.gemini_console_repair_jobs%rowtype;
  v_kind text;
begin
  select * into v_proposal from public.gemini_console_repair_proposals
  where proposal_id = p_proposal_id for update;
  if not found then raise exception 'repair proposal not found'; end if;
  if v_proposal.status <> 'proposed' or v_proposal.expires_at <= now() then raise exception 'repair proposal is no longer authorizable'; end if;

  if not exists (
    select 1 from public.ops_manager_managers m
    where m.manager_id = p_manager_id and m.active and m.revoked_at is null
      and 'CUSTODIAL_MANAGER' = any(m.roles)
  ) then raise exception 'Custodial Manager authorization is required'; end if;
  if not exists (
    select 1 from public.ops_manager_trusted_devices d
    where d.credential_id = p_credential_id and d.manager_id = p_manager_id
      and d.revoked_at is null and d.expires_at > now()
  ) then raise exception 'active approving credential is required'; end if;

  select * into v_authorization from public.gemini_console_messages
  where message_id = p_authorization_message_id and manager_id = p_manager_id
    and conversation_id = v_proposal.conversation_id and role='user' for update;
  if not found or v_authorization.metadata_json->>'source' <> 'direct_authenticated_user' then
    raise exception 'direct authenticated authorization message is required';
  end if;
  if lower(btrim(v_authorization.body)) !~ '^(go ahead and repair that|implement the plan|fix it|proceed with the repair)[.! ]*$' then
    raise exception 'authorization message is not an explicit repair instruction';
  end if;

  v_kind := case when v_proposal.repair_kind='acceptance_probe' then 'acceptance_probe' else 'controlled_worker' end;
  insert into public.gemini_console_repair_jobs(
    proposal_id, conversation_id, approving_manager_id, approving_credential_id,
    authorization_message_id, operation_id, status, execution_mode,
    affected_components, starting_backend_commit, starting_frontend_commit,
    starting_schema_fingerprint, release_id, backup_reference, metadata_json
  ) values (
    v_proposal.proposal_id, v_proposal.conversation_id, p_manager_id, p_credential_id,
    p_authorization_message_id, p_operation_id,
    case when v_kind='acceptance_probe' then 'completed' else 'authorized' end,
    v_kind, v_proposal.affected_components,
    nullif(btrim(p_backend_commit),''), nullif(btrim(p_frontend_commit),''),
    nullif(btrim(p_schema_fingerprint),''), nullif(btrim(p_release_id),''),
    'required_before_worker_claim',
    jsonb_build_object('plan_sha256',v_proposal.plan_sha256,'authorization_source','direct_authenticated_user')
  )
  on conflict (proposal_id) do update set updated_at=now()
  returning * into v_job;

  if v_kind='acceptance_probe' then
    update public.gemini_console_repair_jobs
    set started_at=coalesce(started_at,now()), finished_at=coalesce(finished_at,now()),
        test_evidence=jsonb_build_array(jsonb_build_object('kind','database_transaction','result','pass')),
        verification_evidence=jsonb_build_array(jsonb_build_object('kind','durable_job_readback','result','pass')),
        rollback_evidence=jsonb_build_array(jsonb_build_object('kind','no_production_feature_changed','result','pass')),
        updated_at=now()
    where repair_job_id=v_job.repair_job_id
    returning * into v_job;
  end if;

  update public.gemini_console_repair_proposals
  set status='authorized', authorized_at=now()
  where proposal_id=v_proposal.proposal_id;
  insert into public.gemini_console_repair_job_events(
    repair_job_id,event_type,status,correlation_id,actor_manager_id,detail_json
  ) values (
    v_job.repair_job_id,'repair_authorized',v_job.status,p_correlation_id,p_manager_id,
    jsonb_build_object('execution_mode',v_kind,'plan_sha256',v_proposal.plan_sha256)
  );
  return to_jsonb(v_job);
end
$function$;

revoke all on function public.gemini_console_begin_turn(uuid,uuid,uuid,text,uuid[],uuid) from public, anon, authenticated;
revoke all on function public.gemini_console_complete_turn(uuid,text,text,text,uuid,jsonb) from public, anon, authenticated;
revoke all on function public.gemini_console_fail_turn(uuid,text,text,text) from public, anon, authenticated;
revoke all on function public.gemini_console_authorize_repair(uuid,uuid,uuid,uuid,uuid,text,text,text,text,uuid) from public, anon, authenticated;
grant execute on function public.gemini_console_begin_turn(uuid,uuid,uuid,text,uuid[],uuid) to postgres, service_role;
grant execute on function public.gemini_console_complete_turn(uuid,text,text,text,uuid,jsonb) to postgres, service_role;
grant execute on function public.gemini_console_fail_turn(uuid,text,text,text) to postgres, service_role;
grant execute on function public.gemini_console_authorize_repair(uuid,uuid,uuid,uuid,uuid,text,text,text,text,uuid) to postgres, service_role;

comment on table public.gemini_console_conversations is 'Private persistent Gemini Console conversations scoped to a server-authenticated manager identity.';
comment on table public.gemini_console_attachments is 'Private object-storage metadata; binary data is never stored inline in PostgreSQL.';
comment on table public.gemini_console_repair_jobs is 'Durable controlled repair authorization and execution evidence. Browser input cannot supply shell commands.';
