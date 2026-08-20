-- A terminal writer is a routine whose mutation statement actually targets a
-- terminal-truth table. Independent keyword and type-reference matches can
-- falsely classify append-only correction writers that merely read a session.

begin;

create or replace view public.custodial_terminal_writer_inventory as
select p.oid,
  p.oid::regprocedure::text as routine_identity,
  p.proname,
  p.prorettype <> 'pg_catalog.trigger'::regtype
    and (
      has_function_privilege('anon',p.oid,'EXECUTE')
      or has_function_privilege('authenticated',p.oid,'EXECUTE')
      or has_function_privilege('service_role',p.oid,'EXECUTE')
    ) as application_callable,
  lower(pg_get_functiondef(p.oid)) as definition,
  lower(pg_get_functiondef(p.oid)) ~
    '(insert[[:space:]]+into|update|delete[[:space:]]+from|truncate([[:space:]]+table)?)[[:space:]]+public[.]?(sessions|completion_responses|scan_events|maintenance_tickets)([^a-z0-9_]|$)'
    as mutates_terminal_truth,
  (
    p.proname like 'demo_scan_mock_%'
    or p.proname='custodial_finish_historical_session_authoritative'
    or lower(pg_get_functiondef(p.oid)) ~
      'public[.]demo_scan_mock_[a-z0-9_]*[[:space:]]*[(]'
    or lower(pg_get_functiondef(p.oid)) ~
      'public[.](purge_closed_scan_history_before|tool_purge_closed_scan_history_before|close_maintenance_ticket|tool_close_maintenance_ticket|force_close_session|tool_force_close_session|start_session|tool_start_session|finish_session|tool_finish_session|complete_session|tool_complete_session|record_scan_event|tool_record_scan_event)[[:space:]]*[(]'
  ) as delegates_alternate_terminal_authority
from pg_proc p
join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.prokind='f';

comment on view public.custodial_terminal_writer_inventory is
  'Catalog-derived terminal writer detector. Mutation verbs must target an exact terminal-truth relation; unrelated type references cannot create false authority.';

do $terminal_writer_detection_postflight$
begin
  if coalesce((
    select mutates_terminal_truth
    from public.custodial_terminal_writer_inventory
    where routine_identity like 'custodial_append_session_correction(%'
  ),true) then
    raise exception 'append-only correction was misclassified as a terminal session writer';
  end if;
  if not exists (
    select 1
    from public.custodial_terminal_writer_inventory
    where mutates_terminal_truth
      and definition ~ 'update[[:space:]]+public[.]sessions'
  ) then
    raise exception 'direct terminal-session mutation is no longer detected';
  end if;
end
$terminal_writer_detection_postflight$;

commit;
