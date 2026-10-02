-- Capture only newly inserted, verified program feedback for the selected
-- connected-Outlook relay. This migration deliberately exposes no claim or
-- send authority. Historical rows are never enrolled by a replay/update.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
set local search_path = pg_catalog, public, extensions;

create table public.system_feedback_email_intents (
  id uuid primary key default gen_random_uuid(),
  feedback_id uuid not null unique references public.system_feedback_items(id) on delete restrict,
  operation_id uuid not null unique,
  request_fingerprint text not null,
  contract_version text not null default 'custodial-feedback-relay.v1',
  provider text not null default 'outlook',
  provider_account text not null default 'eoperle@memphiszoo.org',
  recipient text not null default 'eoperle@memphiszoo.org',
  original_actor jsonb not null,
  feedback_snapshot jsonb not null,
  email_subject text not null,
  email_text text not null,
  envelope_sha256 text not null,
  state text not null default 'queued',
  captured_at timestamptz not null default now(),
  constraint feedback_email_intent_fingerprint check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint feedback_email_intent_envelope_hash check (envelope_sha256 ~ '^[0-9a-f]{64}$'),
  constraint feedback_email_intent_contract check (contract_version = 'custodial-feedback-relay.v1'),
  constraint feedback_email_intent_provider check (provider = 'outlook'),
  constraint feedback_email_intent_account check (provider_account = 'eoperle@memphiszoo.org'),
  constraint feedback_email_intent_recipient check (recipient = 'eoperle@memphiszoo.org'),
  constraint feedback_email_intent_initial_state check (state = 'queued'),
  constraint feedback_email_intent_actor_object check (jsonb_typeof(original_actor) = 'object'),
  constraint feedback_email_intent_snapshot_object check (jsonb_typeof(feedback_snapshot) = 'object')
);

create index feedback_email_intents_queued_idx
  on public.system_feedback_email_intents(captured_at, id) where state = 'queued';

alter table public.system_feedback_email_intents enable row level security;
alter table public.system_feedback_email_intents force row level security;
revoke all on table public.system_feedback_email_intents
  from public, anon, authenticated, service_role, custodial_application_reader,
       static_weekly_control_plane, static_weekly_release_operator,
       static_weekly_runtime_20260823;

create function public.capture_system_feedback_email_intent()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $function$
declare
  v_actor jsonb := new.metadata_json->'identity_verification';
  v_image jsonb := new.metadata_json->'image_attachment';
  v_snapshot jsonb;
  v_subject text;
  v_text text;
  v_link text;
  v_envelope jsonb;
begin
  -- The old public/anonymous submission path remains saved for manager review,
  -- but is never enrolled for email. Only the authenticated employee/manager
  -- path may create a relay intent.
  if new.hub_context not in ('employee', 'manager') then
    return new;
  end if;

  if jsonb_typeof(v_actor) is distinct from 'object'
     or v_actor->>'status' is distinct from 'verified'
     or (new.hub_context = 'employee' and (
       v_actor->>'kind' is distinct from 'enrolled_employee_device'
       or coalesce(v_actor->>'employee_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or nullif(btrim(v_actor->>'credential_id'), '') is null
       or upper(coalesce(v_actor->>'device_id', '')) is distinct from upper(coalesce(new.device_id, ''))
     ))
     or (new.hub_context = 'manager' and (
       v_actor->>'kind' is distinct from 'named_manager_session'
       or coalesce(v_actor->>'manager_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     ))
     or nullif(btrim(new.submitted_by), '') is null then
    raise exception using errcode = '23514',
      message = 'Verified feedback identity is required before email intent capture';
  end if;

  if v_image is not null and jsonb_typeof(v_image) <> 'null' then
    -- This is a manager-authenticated application page, not a signed Storage
    -- URL. A later claim must verify the protected object and exact reader.
    v_link := 'https://memphis-zoo-mcp.onrender.com/system-feedback.html?hub=manager&feedback=' || new.id::text;
  end if;

  v_snapshot := jsonb_build_object(
    'feedback_id', new.id,
    'operation_id', new.operation_id,
    'request_fingerprint', new.request_fingerprint,
    'category', new.category,
    'priority', new.priority,
    'message', new.message,
    'submitted_by', new.submitted_by,
    'hub_context', new.hub_context,
    'device_id', new.device_id,
    'created_at', new.created_at,
    'image_attachment', v_image
  );
  v_subject := 'Memphis Zoo Program Feedback [' || new.operation_id::text || ']';
  v_text := 'Memphis Zoo Program Feedback' || E'\n'
    || 'Operation ID: ' || new.operation_id::text || E'\n'
    || 'Feedback ID: ' || new.id::text || E'\n'
    || 'Submitted by: ' || new.submitted_by || E'\n'
    || 'Source: ' || new.hub_context || E'\n'
    || 'Category: ' || new.category || E'\n'
    || 'Priority: ' || new.priority || E'\n'
    || case when v_link is not null then 'Private image: ' || v_link || E'\n' else '' end
    || E'\nMessage (verbatim):\n' || new.message;
  v_envelope := jsonb_build_object(
    'contract_version', 'custodial-feedback-relay.v1',
    'provider', 'outlook',
    'provider_account', 'eoperle@memphiszoo.org',
    'to', jsonb_build_array('eoperle@memphiszoo.org'),
    'cc', '[]'::jsonb,
    'bcc', '[]'::jsonb,
    'subject', v_subject,
    'text_content', v_text,
    'save_to_sent_items', true
  );

  insert into public.system_feedback_email_intents(
    feedback_id, operation_id, request_fingerprint, original_actor,
    feedback_snapshot, email_subject, email_text, envelope_sha256
  ) values (
    new.id, new.operation_id, new.request_fingerprint, v_actor,
    v_snapshot, v_subject, v_text,
    encode(extensions.digest(convert_to(v_envelope::text, 'UTF8'), 'sha256'), 'hex')
  );
  return new;
end;
$function$;

revoke all on function public.capture_system_feedback_email_intent()
  from public, anon, authenticated, service_role, custodial_application_reader,
       static_weekly_control_plane, static_weekly_release_operator,
       static_weekly_runtime_20260823;

create trigger capture_system_feedback_email_intent_after_insert
  after insert on public.system_feedback_items
  for each row execute function public.capture_system_feedback_email_intent();

commit;
