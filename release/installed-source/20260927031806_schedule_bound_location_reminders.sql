-- A verified visit cycle is location authority, not employee schedule authority.
-- Bind each delivery to the exact current projection and qualify its key so an
-- older projection's job/acknowledgement cannot consume a successor's reminder.
-- No new client table, sequence, function, or role grant is introduced.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $patch$
declare definition text;before_definition text;patch record;signature text;
begin
 for signature in select unnest(array[
  'public.mz_enqueue_employee_location_pushes(timestamptz)',
  'public.mz_validate_employee_location_reminder(uuid,uuid,timestamptz)'
 ]) loop
  definition:=pg_get_functiondef(signature::regprocedure);
  before_definition:=definition;
  for patch in select * from (values
   ('public.mz_enqueue_employee_location_pushes(timestamptz)',
    E'      target.*,\n      assignment.location_group_id',
    E'      target.*,\n      assignment.projection_id, assignment.publication_id,\n      assignment.location_group_id'),
   ('public.mz_enqueue_employee_location_pushes(timestamptz)',
    $$     and assignment.assignment_status = 'ASSIGNED'$$,
    $$     and assignment.assignment_status = 'ASSIGNED'
     and assignment.projection_status = 'current'
     and assignment.projection_id is not null$$),
   ('public.mz_enqueue_employee_location_pushes(timestamptz)',
    'select assigned.*,cycle.status_code,cycle.notification_key,cycle.cleaned_at,',
    $$select assigned.*,cycle.status_code,
      cycle.notification_key||':projection:'||assigned.projection_id::text as notification_key,cycle.cleaned_at,$$),
   ('public.mz_enqueue_employee_location_pushes(timestamptz)',
    $$        'service_date', v_service_date::text,$$,
    $$        'service_date', v_service_date::text,
        'projection_id', candidate.projection_id::text,
        'publication_id', candidate.publication_id::text,$$),
   ('public.mz_enqueue_employee_location_pushes(timestamptz)',
    $$        and c.notification_key=job.payload_json#>>'{data_json,notification_key}'$$,
    $$        and c.notification_key||':projection:'||a.projection_id::text=job.payload_json#>>'{data_json,notification_key}'
        and a.projection_status='current'
        and a.projection_id::text=job.payload_json#>>'{data_json,projection_id}'
        and a.publication_id::text=job.payload_json#>>'{data_json,publication_id}'$$),
   ('public.mz_validate_employee_location_reminder(uuid,uuid,timestamptz)',
    $$     and c.notification_key=j.payload_json#>>'{data_json,notification_key}'$$,
    $$     and c.notification_key||':projection:'||a.projection_id::text=j.payload_json#>>'{data_json,notification_key}'
     and a.projection_status='current'
     and a.projection_id::text=j.payload_json#>>'{data_json,projection_id}'
     and a.publication_id::text=j.payload_json#>>'{data_json,publication_id}'$$)
  ) changes(owner_signature,old_text,new_text) where owner_signature=signature loop
   if length(definition)-length(replace(definition,patch.old_text,''))<>length(patch.old_text) then
    raise exception 'schedule-bound reminder predecessor seam changed for %',signature;
   end if;
   definition:=replace(definition,patch.old_text,patch.new_text);
  end loop;
  if definition=before_definition then raise exception 'schedule-bound reminder function not changed: %',signature;end if;
  execute definition;
 end loop;
end
$patch$;

-- Retain exact predecessor ACLs and replace only the two owning recovery bodies.
alter table public.custodial_release_authority_restore_inventory disable trigger trg_custodial_release_authority_restore_inventory_immutable;
do $recovery$
declare signature text;definition text;changed int;
begin
 foreach signature in array array[
  'public.mz_enqueue_employee_location_pushes(timestamptz)',
  'public.mz_validate_employee_location_reminder(uuid,uuid,timestamptz)'
 ] loop
  definition:=pg_get_functiondef(signature::regprocedure);
  update public.custodial_release_authority_restore_inventory set definition_sql=definition,
   definition_sha256=public.static_weekly_digest_text(definition),captured_at=statement_timestamp()
   where object_kind='function' and to_regprocedure(object_identity)=signature::regprocedure;
  get diagnostics changed=row_count;
  if changed<>1 then raise exception 'schedule-bound reminder recovery expected exactly one existing body: %',signature;end if;
  if has_function_privilege('anon',signature,'EXECUTE') or has_function_privilege('authenticated',signature,'EXECUTE')
   or not has_function_privilege('service_role',signature,'EXECUTE') then
   raise exception 'schedule-bound reminder predecessor privileges changed: %',signature;
  end if;
 end loop;
end
$recovery$;
alter table public.custodial_release_authority_restore_inventory enable trigger trg_custodial_release_authority_restore_inventory_immutable;
commit;
