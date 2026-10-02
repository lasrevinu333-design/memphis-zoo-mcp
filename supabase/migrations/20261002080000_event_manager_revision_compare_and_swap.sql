begin;

set local lock_timeout = '5s';
set local statement_timeout = '90s';

-- The manager's edit readback supplies the revision. Hold the event row lock
-- through the existing named-manager mutation, so a concurrent editor cannot
-- pass a stale comparison and silently overwrite the first correction.
create or replace function public.app_apply_event_update_cas(
  p_event_id uuid, p_record jsonb, p_actor text default null, p_reason text default null
) returns jsonb language plpgsql security definer set search_path to 'pg_catalog','public','extensions'
as $function$
declare
  v_expected_revision bigint;
  v_current_revision bigint;
begin
  if p_event_id is null or jsonb_typeof(p_record) is distinct from 'object' then
    raise exception using errcode='22023',message='event id and update record are required';
  end if;
  if jsonb_typeof(p_record->'expected_revision') is distinct from 'number'
    or p_record->>'expected_revision' !~ '^[1-9][0-9]*$' then
    raise exception using errcode='22023',message='expected event revision is required';
  end if;
  begin
    v_expected_revision := (p_record->>'expected_revision')::bigint;
  exception when numeric_value_out_of_range then
    raise exception using errcode='22023',message='expected event revision is invalid';
  end;
  select coalesce(e.revision,1) into v_current_revision
    from public.events_app_events e where e.id=p_event_id for update;
  if not found then
    raise exception using errcode='P0002',message='event not found';
  end if;
  if v_current_revision is distinct from v_expected_revision then
    raise exception using errcode='40901',message='Event changed since this preview. Refresh and review before saving.';
  end if;
  return public.app_apply_event_command('update',p_event_id,p_record,p_actor,p_reason);
end
$function$;

revoke all on function public.app_apply_event_update_cas(uuid,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.app_apply_event_update_cas(uuid,jsonb,text,text) to postgres,service_role;

commit;
