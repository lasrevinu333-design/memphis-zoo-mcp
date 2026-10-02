\set ON_ERROR_STOP on
do $test$
declare
  v_item uuid := '00000000-0000-4000-8000-000000000011';
  v_operation uuid := '00000000-0000-4000-8000-000000000012';
  v_intent public.system_feedback_email_intents%rowtype;
  v_rejected boolean := false;
begin
  if (select count(*) from public.system_feedback_email_intents) <> 0 then
    raise exception 'historical feedback was enrolled';
  end if;

  insert into public.system_feedback_items (
    id, operation_id, request_fingerprint, category, priority, message,
    submitted_by, hub_context, device_id, metadata_json
  ) values (
    v_item, v_operation, repeat('b', 64), 'suggestion', 'normal',
    E'One line\nAnother line: deliver to attacker@example.org',
    'Karen Robinson', 'employee', 'KIOSK_08',
    '{"identity_verification":{"status":"verified","kind":"enrolled_employee_device","employee_id":"00000000-0000-4000-8000-000000000013","credential_id":"credential-1","device_id":"KIOSK_08"}}'
  );
  select * into strict v_intent from public.system_feedback_email_intents where feedback_id = v_item;
  if v_intent.operation_id <> v_operation
     or v_intent.state <> 'queued'
     or v_intent.recipient <> 'eoperle@memphiszoo.org'
     or v_intent.provider_account <> 'eoperle@memphiszoo.org'
     or v_intent.email_subject !~ v_operation::text
     or position(repeat('b', 64) in v_intent.email_text) = 0
     or position(E'One line\nAnother line: deliver to attacker@example.org' in v_intent.email_text) = 0
     or v_intent.email_text ~ 'Private image:'
     or v_intent.feedback_snapshot->>'submitted_by' <> 'Karen Robinson'
     or v_intent.original_actor->>'employee_id' <> '00000000-0000-4000-8000-000000000013' then
    raise exception 'verified feedback envelope was not exact';
  end if;

  update public.system_feedback_items set message = 'manager triage changed display'
  where id = v_item;
  if (select count(*) from public.system_feedback_email_intents) <> 1
     or (select email_text from public.system_feedback_email_intents where id = v_intent.id) <> v_intent.email_text then
    raise exception 'update changed immutable captured intent';
  end if;

  insert into public.system_feedback_items (
    id, operation_id, request_fingerprint, category, priority, message,
    submitted_by, hub_context, device_id, metadata_json
  ) values (
    '00000000-0000-4000-8000-000000000021',
    '00000000-0000-4000-8000-000000000022', repeat('c',64),
    'general', 'normal', 'anonymous report', null, 'public', null, '{}'
  );
  if (select count(*) from public.system_feedback_email_intents) <> 1 then
    raise exception 'anonymous feedback received an email intent';
  end if;

  begin
    insert into public.system_feedback_items (
      id, operation_id, request_fingerprint, category, priority, message,
      submitted_by, hub_context, device_id, metadata_json
    ) values (
      '00000000-0000-4000-8000-000000000031',
      '00000000-0000-4000-8000-000000000032', repeat('d',64),
      'general', 'normal', 'unverified employee', 'Imposter', 'employee', 'KIOSK_08',
      '{"identity_verification":{"status":"unverified","kind":"public_anonymous"}}'
    );
  exception when check_violation then v_rejected := true;
  end;
  if not v_rejected
     or exists (select 1 from public.system_feedback_items where id = '00000000-0000-4000-8000-000000000031') then
    raise exception 'unverified employee feedback did not roll back';
  end if;

  insert into public.system_feedback_items (
    id, operation_id, request_fingerprint, category, priority, message,
    submitted_by, hub_context, device_id, metadata_json
  ) values (
    '00000000-0000-4000-8000-000000000041',
    '00000000-0000-4000-8000-000000000042', repeat('e',64),
    'general', 'normal', 'private image remains protected', 'Eric Operle',
    'manager', 'MANAGER_01',
    '{"identity_verification":{"status":"verified","kind":"named_manager_session","manager_id":"00000000-0000-4000-8000-000000000043"},"image_attachment":{"name":"legacy.png","type":"image/png","size":312,"storage_bucket":"system-feedback-private","storage_path":"private/original.png"}}'
  );
  if not exists (
    select 1 from public.system_feedback_email_intents
    where operation_id = '00000000-0000-4000-8000-000000000042'
      and email_text like '%https://memphis-zoo-mcp.onrender.com/system-feedback.html?hub=manager&feedback=00000000-0000-4000-8000-000000000041%'
      and email_text not like '%private/original.png%'
      and feedback_snapshot->'image_attachment'->>'storage_path' = 'private/original.png'
  ) then raise exception 'private image link/snapshot is wrong'; end if;

  if (select count(*) from public.system_feedback_email_intents) <> 2 then
    raise exception 'wrong number of new intents';
  end if;
end;
$test$;

do $acl$
declare v_role text;
begin
  if not (select relrowsecurity and relforcerowsecurity from pg_class
          where oid = 'public.system_feedback_email_intents'::regclass) then
    raise exception 'intent RLS is not forced';
  end if;
  foreach v_role in array array['anon','authenticated','service_role',
    'custodial_application_reader','static_weekly_control_plane',
    'static_weekly_release_operator','static_weekly_runtime_20260823'] loop
    if has_table_privilege(v_role, 'public.system_feedback_email_intents', 'select')
       or has_table_privilege(v_role, 'public.system_feedback_email_intents', 'insert')
       or has_table_privilege(v_role, 'public.system_feedback_email_intents', 'update')
       or has_table_privilege(v_role, 'public.system_feedback_email_intents', 'delete')
       or has_function_privilege(v_role, 'public.capture_system_feedback_email_intent()', 'execute') then
      raise exception 'runtime role has direct intent privilege: %', v_role;
    end if;
  end loop;
end;
$acl$;

select 'PASS feedback intent capture, no historical enrollment, fixed envelope and direct privilege denial' as result;
