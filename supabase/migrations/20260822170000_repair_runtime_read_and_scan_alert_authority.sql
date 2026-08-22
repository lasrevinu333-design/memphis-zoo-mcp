-- Restore the pure service-date read dependency to the restricted application
-- reader and route scan alerts through the one canonical Memphis conversation.
-- The legacy alert helper attempted to create a second active direct thread for
-- the same two principals, which the canonical-pair guard correctly rejected.

begin;

do $preflight$
begin
  if current_user not in ('postgres', 'supabase_admin') then
    raise exception 'A managed migration owner is required.';
  end if;
  if not exists (
    select 1 from pg_roles
    where rolname = 'custodial_application_reader'
      and not rolsuper and not rolbypassrls and not rolcanlogin
  ) then
    raise exception 'The restricted custodial_application_reader role is required.';
  end if;
  if to_regprocedure('public.get_setting_int(text,integer)') is null
     or to_regprocedure('public.sch_service_date(timestamptz)') is null
     or to_regprocedure('public.msg_get_or_create_memphis_thread(uuid)') is null
     or to_regprocedure('public.sch_get_or_create_scan_alert_thread(uuid)') is null then
    raise exception 'The admitted runtime authority functions are incomplete.';
  end if;
end
$preflight$;

-- get_setting_int is a stable SECURITY INVOKER read helper over a table the
-- restricted reader can already SELECT. Grant only that role; public web roles
-- and the ordinary service role do not gain new authority here.
revoke all on function public.get_setting_int(text, integer)
  from public, anon, authenticated;
grant execute on function public.get_setting_int(text, integer)
  to custodial_application_reader;

create or replace function public.sch_get_or_create_scan_alert_thread(p_msg_user_id uuid)
returns uuid
language plpgsql
set search_path to 'pg_catalog', 'public', 'extensions'
as $function$
declare
  v_thread public.msg_threads%rowtype;
begin
  if p_msg_user_id is null then
    raise exception 'p_msg_user_id is required';
  end if;

  -- Reuse or normalize the one canonical employee-to-Memphis conversation.
  -- Existing Scan Alerts threads remain preserved and become the canonical
  -- Memphis thread on first use; no message or receipt is rewritten.
  select * into v_thread
  from public.msg_get_or_create_memphis_thread(p_msg_user_id);

  if v_thread.id is null then
    raise exception 'Canonical Memphis conversation is unavailable.';
  end if;
  return v_thread.id;
end
$function$;

revoke all on function public.sch_get_or_create_scan_alert_thread(uuid)
  from public, anon, authenticated, custodial_application_reader;
grant execute on function public.sch_get_or_create_scan_alert_thread(uuid)
  to postgres, service_role;

comment on function public.sch_get_or_create_scan_alert_thread(uuid) is
  'Compatibility wrapper for scan-alert delivery. Reuses the canonical Memphis conversation and never creates a second active principal pair.';

do $postflight$
declare
  v_definition text;
begin
  if not has_function_privilege(
    'custodial_application_reader',
    'public.get_setting_int(text,integer)',
    'execute'
  ) or has_function_privilege('anon','public.get_setting_int(text,integer)','execute')
     or has_function_privilege('authenticated','public.get_setting_int(text,integer)','execute') then
    raise exception 'The pure integer-setting helper has an invalid execute boundary.';
  end if;

  select pg_get_functiondef('public.sch_get_or_create_scan_alert_thread(uuid)'::regprocedure)
  into v_definition;
  if v_definition not like '%msg_get_or_create_memphis_thread%'
     or v_definition like '%insert into public.msg_threads%'
     or v_definition like '%title = ''Scan Alerts''%' then
    raise exception 'The scan-alert helper is not bound exclusively to canonical Memphis authority.';
  end if;

  if has_function_privilege('public','public.sch_get_or_create_scan_alert_thread(uuid)','execute')
     or has_function_privilege('anon','public.sch_get_or_create_scan_alert_thread(uuid)','execute')
     or has_function_privilege('authenticated','public.sch_get_or_create_scan_alert_thread(uuid)','execute')
     or has_function_privilege('custodial_application_reader','public.sch_get_or_create_scan_alert_thread(uuid)','execute')
     or not has_function_privilege('service_role','public.sch_get_or_create_scan_alert_thread(uuid)','execute') then
    raise exception 'The scan-alert compatibility wrapper has an invalid execute boundary.';
  end if;
end
$postflight$;

commit;
