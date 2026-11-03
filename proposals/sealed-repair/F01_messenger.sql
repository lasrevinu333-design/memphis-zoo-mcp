BEGIN;
DO $predecessor$
BEGIN
 IF public.static_weekly_digest_text(pg_get_functiondef('public.msg_is_runtime_user(uuid)'::regprocedure)) IS DISTINCT FROM '1bd4f8312c0833e2f63d01e1887dd1b8b7146c7ef28eddb5f8fc1378b28ab4a9' THEN
  RAISE EXCEPTION 'F01 predecessor differs: public.msg_is_runtime_user(uuid)';
 END IF;
END $predecessor$;

-- Main-owned guarded successor fragment. Selected-name inboxes are new identities;
-- ops_manager_id remains NULL and verified named history is never adopted.
alter table public.msg_users add column custodial_cohort_manager_id uuid references public.ops_manager_managers(manager_id);
alter table public.msg_users add column custodial_claimed_account_id uuid references public.ops_manager_managers(manager_id);
alter table public.msg_users add constraint msg_users_custodial_cohort_identity_check check (
 (custodial_cohort_manager_id is null and custodial_claimed_account_id is null)
 or (custodial_cohort_manager_id is not null and custodial_claimed_account_id is not null
     and custodial_cohort_manager_id<>custodial_claimed_account_id and ops_manager_id is null and employee_id is null and role='manager'));
create unique index msg_users_custodial_cohort_account on public.msg_users(custodial_cohort_manager_id,custodial_claimed_account_id)
 where custodial_cohort_manager_id is not null;

create function custodial_leadership_private.messaging_account_active(p_cohort uuid,p_account uuid)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $fn$
 select exists(select 1 from custodial_leadership_private.policy p
 join public.ops_manager_managers m on m.manager_id=p.cohort_principal_id
 where p.singleton and p.enabled and p.cohort_principal_id=p_cohort and m.active and m.revoked_at is null and m.is_system_principal
 and exists(select 1 from jsonb_array_elements(custodial_leadership_private.approved_names()) n where n->>'accountId'=p_account::text))
$fn$;
revoke all on function custodial_leadership_private.messaging_account_active(uuid,uuid) from public,anon,authenticated,service_role,static_weekly_control_plane,custodial_application_reader;

create or replace function public.msg_is_runtime_user(p_user_id uuid)
returns boolean language sql stable security definer set search_path=pg_catalog,public,extensions as $fn$
 select exists(select 1 from public.msg_users mu
 left join public.employees e on e.id=mu.employee_id
 left join public.ops_manager_managers om on om.manager_id=mu.ops_manager_id
 where mu.id=p_user_id and mu.is_active and (
  (mu.role='bot' and lower(btrim(mu.display_name))='memphis')
  or (mu.role in ('manager','ops','ops_manager','operations_manager') and mu.employee_id is null and (
   (mu.custodial_cohort_manager_id is not null and mu.ops_manager_id is null
    and custodial_leadership_private.messaging_account_active(mu.custodial_cohort_manager_id,mu.custodial_claimed_account_id))
   or (mu.custodial_cohort_manager_id is null and (mu.ops_manager_id is null
    or (om.manager_id is not null and om.active and om.revoked_at is null and not om.is_system_principal)))))
  or (mu.role='employee' and e.id is not null and e.active and coalesce(e.employee_code,'')~'^EMP[0-9]+'
   and exists(select 1 from public.msg_device_assignments a where a.msg_user_id=mu.id and a.is_active))))
$fn$;

create function custodial_leadership_private.ensure_messaging_account(p_cohort uuid,p_account uuid,p_name text)
returns public.msg_users language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare u public.msg_users%rowtype;label text;
begin
 if not custodial_leadership_private.messaging_account_active(p_cohort,p_account) then raise exception 'Current approved cohort account required' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('custodial-messenger:'||p_cohort::text||':'||p_account::text,0));
 select * into u from public.msg_users where custodial_cohort_manager_id=p_cohort and custodial_claimed_account_id=p_account;
 label:=p_name||' (shared PIN)';
 if exists(select 1 from public.msg_users other where other.display_name=label and (u.id is null or other.id<>u.id)) then label:=label||' ['||p_account::text||']';end if;
 if u.id is null then
  -- Lossless ordered UUID pair: 79 characters in the retained source303
  -- identity-key alphabet/length. Never reuse a verified named identity key.
  insert into public.msg_users(display_name,role,is_active,messaging_identity_key,custodial_cohort_manager_id,custodial_claimed_account_id)
  values(label,'manager',true,'custodial_pin_'||replace(p_cohort::text,'-','')||'_'||replace(p_account::text,'-',''),p_cohort,p_account) returning * into u;
 else
  update public.msg_users set display_name=label,is_active=true where id=u.id returning * into u;
 end if;
 return u;
end $fn$;
revoke all on function custodial_leadership_private.ensure_messaging_account(uuid,uuid,text) from public,anon,authenticated,service_role,static_weekly_control_plane,custodial_application_reader;

create table custodial_leadership_private.messaging_message_bindings(
 message_id uuid primary key references public.msg_messages(id) on delete cascade,
 msg_user_id uuid not null references public.msg_users(id),
 registration_id uuid not null references custodial_leadership_private.registrations(registration_id),
 cohort_principal_id uuid not null,claimed_account_id uuid not null,policy_version integer not null,
 recorded_at timestamptz not null default clock_timestamp()
);
alter table custodial_leadership_private.messaging_message_bindings enable row level security;
revoke all on custodial_leadership_private.messaging_message_bindings from public,anon,authenticated,service_role,static_weekly_control_plane,custodial_application_reader;

create function public.custodial_leadership_messaging_operation_v1(
 p_manager_id uuid,p_credential_id uuid,p_device_id text,p_action text,p_input jsonb
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare actor jsonb;u public.msg_users%rowtype;member jsonb;m public.msg_messages%rowtype;metadata jsonb;binding custodial_leadership_private.messaging_message_bindings%rowtype;
begin
 perform public.static_weekly_v3_assert_control_plane();
 actor:=custodial_leadership_private.require_context(p_manager_id,'custodialManagementAdmin');
 if actor->>'actor_kind' is distinct from 'CUSTODIAL_LEADERSHIP_COHORT' or actor->'owner' is distinct from 'false'::jsonb
 or actor->>'identity_assurance' is distinct from 'SELF_ASSERTED_NAME' or actor->'individual_identity_verified' is distinct from 'false'::jsonb
 or actor->>'credential_id' is distinct from p_credential_id::text or actor->>'device_id' is distinct from p_device_id then
  raise exception 'Original cohort Messenger actor required' using errcode='42501';end if;
 if jsonb_typeof(p_input) is distinct from 'object' or octet_length(p_input::text)>32768 then raise exception 'Bounded Messenger input required' using errcode='22023';end if;
 if p_action='identity' then
  if p_input<>'{}'::jsonb then raise exception 'Identity input must be empty' using errcode='22023';end if;
  -- Provision the approved directory consistently so every selected name is
  -- addressable, independently of whether that name has opened Messenger yet.
  for member in select * from jsonb_array_elements(custodial_leadership_private.approved_names()) loop
   perform custodial_leadership_private.ensure_messaging_account(p_manager_id,(member->>'accountId')::uuid,member->>'displayName');
  end loop;
 else
  if p_action is distinct from 'send' then raise exception 'Unsupported Messenger action' using errcode='22023';end if;
 end if;
 u:=custodial_leadership_private.ensure_messaging_account(p_manager_id,(actor->>'claimed_account_id')::uuid,actor->>'claimed_name');
 if p_action='identity' then return jsonb_build_object('schema','custodial.cohort-messenger-identity.v1','msg_user_id',u.id,'role','manager',
  'display_name',u.display_name,'claimed_name',actor->>'claimed_name','ops_manager_id',null,
  'custodial_cohort_manager_id',p_manager_id,'custodial_claimed_account_id',actor->>'claimed_account_id',
  'identity_assurance','SELF_ASSERTED_NAME','individual_identity_verified',false);end if;
 if (select array_agg(key order by key) from jsonb_object_keys(p_input) key) is distinct from array['body','client_message_id','message_type','metadata_json','thread_id']
 or p_input->>'message_type' is distinct from 'text' or jsonb_typeof(p_input->'body') is distinct from 'string'
 or length(btrim(p_input->>'body')) not between 1 and 2000 or jsonb_typeof(p_input->'client_message_id') is distinct from 'string'
 or length(p_input->>'client_message_id') not between 1 and 200 or p_input->>'client_message_id'<>btrim(p_input->>'client_message_id')
 or jsonb_typeof(p_input->'metadata_json') is distinct from 'object' or octet_length((p_input->'metadata_json')::text)>8192 then
  raise exception 'Invalid original message payload' using errcode='22023';end if;
 if not exists(select 1 from public.msg_thread_participants p join public.msg_threads t on t.id=p.thread_id
  where p.thread_id=(p_input->>'thread_id')::uuid and p.user_id=u.id and p.left_at is null and t.is_active
   and t.system_key is distinct from 'ops_manager_shared_chat_v1') then raise exception 'Current inbox participation required' using errcode='42501';end if;
 metadata:=((p_input->'metadata_json')-'authenticated_ops_manager_id'::text-'custodial_cohort_actor'::text)
  ||jsonb_build_object('device_id',p_device_id,'custodial_cohort_actor',jsonb_build_object('schema','custodial.cohort-message-actor.v1',
   'cohort_principal_id',p_manager_id,'claimed_account_id',actor->>'claimed_account_id','registration_id',p_credential_id,
   'identity_assurance','SELF_ASSERTED_NAME','individual_identity_verified',false));
 m:=public.msg_send_message((p_input->>'thread_id')::uuid,u.id,p_input->>'body','text',metadata,p_input->>'client_message_id');
 insert into custodial_leadership_private.messaging_message_bindings(message_id,msg_user_id,registration_id,cohort_principal_id,claimed_account_id,policy_version)
 values(m.id,u.id,p_credential_id,p_manager_id,(actor->>'claimed_account_id')::uuid,(actor->>'policy_version')::integer) on conflict(message_id) do nothing;
 select * into binding from custodial_leadership_private.messaging_message_bindings where message_id=m.id;
 if binding.msg_user_id<>u.id or binding.registration_id<>p_credential_id or binding.cohort_principal_id<>p_manager_id
 or binding.claimed_account_id<>(actor->>'claimed_account_id')::uuid then raise exception 'Original message actor conflicts' using errcode='23505';end if;
 -- The named audit field remains NULL. Cohort provenance lives in its typed
 -- private binding and authoritative message metadata, never a claimed login.
 update public.msg_message_audit set sender_ops_manager_id=null,sender_user_id=u.id,sender_display_name=u.display_name,sender_role='manager' where message_id=m.id;
 return to_jsonb(m);
end $fn$;
revoke all on function public.custodial_leadership_messaging_operation_v1(uuid,uuid,text,text,jsonb) from public,anon,authenticated,service_role,custodial_application_reader,static_weekly_release_operator;
grant execute on function public.custodial_leadership_messaging_operation_v1(uuid,uuid,text,text,jsonb) to static_weekly_control_plane;

-- Read-only, current authorization for a queued Memphis message. The message
-- ID is sourced from the durable operational job, never a client role assertion.
create function public.msg_custodial_cohort_message_actor_v1(p_message_id uuid,p_user_id uuid,p_device_id text)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $fn$
declare b custodial_leadership_private.messaging_message_bindings%rowtype;v jsonb;u public.msg_users%rowtype;
begin
 select binding.* into b from custodial_leadership_private.messaging_message_bindings binding
 join public.msg_messages m on m.id=binding.message_id join public.msg_threads t on t.id=m.thread_id
 where m.id=p_message_id and m.sender_user_id=p_user_id and not m.is_deleted and t.is_active
 and exists(select 1 from public.msg_thread_participants p where p.thread_id=t.id and p.user_id=p_user_id and p.left_at is null);
 if b.message_id is null or b.msg_user_id<>p_user_id then return null;end if;
 v:=custodial_leadership_private.session_view(b.registration_id);
 select * into u from public.msg_users where id=p_user_id and is_active;
 if v is null or u.id is null or u.ops_manager_id is not null or v->>'browserId' is distinct from p_device_id
 or v#>>'{cohort,principalId}' is distinct from b.cohort_principal_id::text
 or v#>>'{claimedAccount,accountId}' is distinct from b.claimed_account_id::text
 or (v#>>'{cohort,policyVersion}')::integer is distinct from b.policy_version
 or u.custodial_cohort_manager_id is distinct from b.cohort_principal_id
 or u.custodial_claimed_account_id is distinct from b.claimed_account_id
 or not (v#>'{cohort,permissions}' ? 'custodialManagementAdmin') then return null;end if;
 return jsonb_build_object('schema','custodial.cohort-messenger-actor.v1','msg_user_id',u.id,'source_message_id',p_message_id,
  'role','manager','identity_assurance','SELF_ASSERTED_NAME','individual_identity_verified',false,'owner',false,
  'custodial_cohort_manager_id',b.cohort_principal_id,'custodial_claimed_account_id',b.claimed_account_id);
end $fn$;
revoke all on function public.msg_custodial_cohort_message_actor_v1(uuid,uuid,text) from public,anon,authenticated,static_weekly_control_plane,static_weekly_release_operator;
grant execute on function public.msg_custodial_cohort_message_actor_v1(uuid,uuid,text) to service_role,custodial_application_reader;

COMMIT;
