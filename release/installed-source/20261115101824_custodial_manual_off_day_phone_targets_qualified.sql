-- Exact forward repair for an omitted, canonically confirmed OFF phone.
-- No credential/assignment/job/receipt change and no new function or grant.
DO $manual_off_day_targets$
DECLARE
 target regprocedure:='custodial_coverall.reconcile_manual_application_date(date)'::regprocedure;
 original_definition text;next_definition text;original_body text;next_body text;
 before_metadata jsonb;after_metadata jsonb;role_name text;
 old_body constant text:=$old_body$
declare a record;b custodial_coverall.manual_application_bindings%rowtype;
 current_projection public.weekly_schedule_compiled_projections%rowtype;l public.weekly_schedule_lunch_documents%rowtype;
person record;device record;v_view jsonb;v_target jsonb;v_view_digest text;v_intent uuid;v_count int:=0;v_devices int;
v_recurring_accepted boolean:=false;
begin
 if p_date is null or not isfinite(p_date) then raise exception 'recurring application reconciliation requires one finite date';end if;
 perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 select * into a from public.static_weekly_v6_schedule_authority_state(p_date);
 if a.projection_status='blocked_recurring_authority' then return public.static_weekly_v19_reconcile_terminal_date(p_date);end if;
 if a.projection_status is distinct from 'current' or a.projection_id is null then raise exception 'recurring schedule projection is unavailable';end if;
 select * into b from custodial_coverall.manual_application_bindings where publication_id=a.publication_id;
 if not found then return 0;end if;
 select * into strict current_projection from public.weekly_schedule_compiled_projections where projection_id=a.projection_id;
 if current_projection.publication_id is distinct from b.publication_id or current_projection.version_id is distinct from b.version_id
  or not exists(select 1 from public.weekly_schedule_versions v join public.static_weekly_authority_source_documents s on s.source_id=v.authority_source_id
    where v.version_id=b.version_id and s.source_id=b.source_id and s.source_digest=b.source_digest and s.active=true)
  or not exists(select 1 from public.static_weekly_approved_initial_confirmations i where i.publication_id=b.publication_id and i.manager_id=b.initial_manager_id
    and i.idempotency_key=b.initial_idempotency_key and i.receipt_json=b.initial_receipt_json and i.request_json=b.initial_request_json
    and public.static_weekly_digest_jsonb(i.receipt_json)=b.initial_receipt_digest)
  then raise exception 'Manual target origin/current source correspondence differs';end if;
 if current_projection.projection_id<>b.original_projection_id then
  v_recurring_accepted:=custodial_coverall.manual_recurring_projection_accepted(b.operation_id,current_projection.projection_id,a.projection_authority_revision);
 end if;
 if current_projection.projection_id<>b.original_projection_id and not v_recurring_accepted and
  (current_projection.projection_envelope#>>'{authority,schema}' is distinct from 'custodial.approved-manual-period-projection-authority.v1'
   or current_projection.projection_envelope#>>'{adapter,schema}' is distinct from 'custodial.approved-manual-period-database-adapter.v1'
   or current_projection.projection_envelope#>>'{authority,sourcePublicationId}' is distinct from b.publication_id::text
   or current_projection.projection_envelope#>>'{authority,sourceVersionId}' is distinct from b.version_id::text
   or current_projection.projection_envelope#>'{authority,normalSourceChanged}' is distinct from 'false'::jsonb)
  then raise exception 'Only accepted original or exact native manual lineage creates targets';end if;
 if current_projection.projection_id<>b.original_projection_id and not v_recurring_accepted and not exists(
  select 1 from public.static_weekly_staffing_commands command
  join public.static_weekly_staffing_staged_candidates staged on staged.operation_id=command.operation_id and staged.candidate_kind='projection'
  join public.static_weekly_staffing_command_receipts receipt on receipt.operation_id=command.operation_id and receipt.event_kind='ACCEPTED'
  where command.state='ACCEPTED' and staged.payload_json->'envelope'=current_projection.projection_envelope
   and command.accepted_receipt->>'event'='ACCEPTED' and command.accepted_receipt->>'operation_id'=command.operation_id::text
   and command.accepted_receipt->>'semantic_digest'=command.semantic_digest
   and command.accepted_receipt#>>ARRAY['projections',current_projection.week_start::text,'publication_id']=b.publication_id::text
   and command.accepted_receipt#>>ARRAY['projections',current_projection.week_start::text,'projection_id']=current_projection.projection_id::text
   and receipt.receipt_json=command.accepted_receipt and receipt.receipt_digest=public.static_weekly_digest_jsonb(receipt.receipt_json))
  then raise exception 'Prepared native document is not an accepted original operation';end if;
 if b.activation_operation_id is not null and not exists(select 1 from custodial_coverall.activation_receipts r where r.operation_id=b.activation_operation_id
  and r.receipt_json=b.activation_receipt_json and public.static_weekly_digest_jsonb(r.receipt_json)=b.activation_receipt_digest)
  then raise exception 'Original operational activation receipt changed';end if;
 select * into l from public.weekly_schedule_lunch_documents where projection_id=a.projection_id;
 if not found then raise exception 'exact recurring lunch companion is unavailable';end if;
 if current_projection.projection_id<>b.original_projection_id and not v_recurring_accepted and not exists(select 1 from public.static_weekly_staffing_commands command
  where command.state='ACCEPTED' and command.accepted_receipt#>>ARRAY['projections',current_projection.week_start::text,'projection_id']=current_projection.projection_id::text
   and command.accepted_receipt#>>ARRAY['projections',current_projection.week_start::text,'lunch_document_identity']=l.document_identity)
  then raise exception 'Accepted original native full lunch correspondence differs';end if;
 for person in with people as (
  select (r->>'incumbentPersonId')::uuid employee_id from jsonb_array_elements(coalesce(current_projection.projection_envelope#>'{authority,projectionAvailability}','[]')) r
   where r->>'incumbentPersonId' is not null and r->>'serviceDate'=p_date::text
  union select (r->>'incumbentPersonId')::uuid from public.weekly_schedule_compiled_projections old
   cross join lateral jsonb_array_elements(coalesce(old.projection_envelope#>'{authority,projectionAvailability}','[]')) r
   where old.projection_id=b.original_projection_id and r->>'incumbentPersonId' is not null
    and extract(isodow from (r->>'serviceDate')::date)=extract(isodow from p_date)
  union select (r->>'personId')::uuid from public.weekly_schedule_versions v
   cross join lateral jsonb_array_elements(coalesce(v.draft_document#>'{authority,compilerInput,roster}','[]')) r
   where v.version_id=b.version_id and r->>'personId' is not null
    and extract(isodow from (r->>'serviceDate')::date)=extract(isodow from p_date)
  union select old.employee_id from custodial_coverall.manual_application_intents old where old.publication_id=b.publication_id and old.service_date=p_date
  union select x.owner_person_id_snapshot from public.weekly_schedule_occurrences x join public.weekly_schedule_compiled_projections projection using(projection_id)
   where projection.publication_id in(b.publication_id,b.predecessor_publication_id) and x.service_date=p_date and x.owner_person_id_snapshot is not null
  union select (r->>'normal_owner_person_id')::uuid from public.weekly_schedule_lunch_documents lunch join public.weekly_schedule_compiled_projections projection using(projection_id)
   cross join lateral jsonb_array_elements(lunch.document_json->'responsibilities') r
   where projection.publication_id in(b.publication_id,b.predecessor_publication_id) and r->>'service_date'=p_date::text and r->>'normal_owner_person_id' is not null
  union select (r->>'coverer_person_id')::uuid from public.weekly_schedule_lunch_documents lunch join public.weekly_schedule_compiled_projections projection using(projection_id)
   cross join lateral jsonb_array_elements(lunch.document_json->'responsibilities') r
   where projection.publication_id in(b.publication_id,b.predecessor_publication_id) and r->>'service_date'=p_date::text and r->>'coverer_person_id' is not null
 ) select distinct people.employee_id from people join public.employees e on e.id=people.employee_id order by people.employee_id loop
  v_view:=public.static_weekly_v22_recurring_render_view(a.projection_id,p_date,person.employee_id);
  v_view_digest:=public.static_weekly_digest_jsonb(v_view);v_devices:=0;
  -- Rotation/reconnect must not silently create a different view at the same
  -- authority identity, nor make ON CONFLICT hide changed display bytes.
  if exists(select 1 from custodial_coverall.manual_application_intents i
   where i.publication_id=a.publication_id and i.projection_id=a.projection_id
    and i.service_date=p_date and i.employee_id=person.employee_id
    and i.authority_revision=a.projection_authority_revision
    and (i.view_json is distinct from v_view or i.view_digest is distinct from v_view_digest
      or i.lunch_document_identity is distinct from l.document_identity)) then
   raise exception using errcode='23514',message='recurring render changed without a new exact authority identity';end if;
  for device in select d.id,c.credential_id,d.assignment_epoch from public.devices d
   join public.device_auth_credentials c on c.device_id=d.id and c.confirmed_at is not null
    and c.revoked_at is null and c.expires_at>statement_timestamp()
   where d.active=true and d.assigned_employee_id=person.employee_id
   order by d.id,c.credential_id loop
   v_devices:=v_devices+1;
   v_target:=jsonb_build_object('schema','static-weekly.recurring-application-target.v1','targetType','SCHEDULE',
    'operationId',b.operation_id,'publicationId',a.publication_id,'projectionId',a.projection_id,'serviceDate',p_date,
    'authorityRevision',a.projection_authority_revision,'lunchDocumentIdentity',l.document_identity,
    'employeeId',person.employee_id,'deviceId',device.id,'credentialId',device.credential_id,
    'assignmentEpoch',device.assignment_epoch,'viewDigest',v_view_digest);
   insert into custodial_coverall.manual_application_intents(operation_id,publication_id,projection_id,service_date,
    employee_id,device_id,credential_id,assignment_epoch,authority_revision,lunch_document_identity,view_json,view_digest,target_json,target_digest)
   values(b.operation_id,a.publication_id,a.projection_id,p_date,person.employee_id,device.id,device.credential_id,
    device.assignment_epoch,a.projection_authority_revision,l.document_identity,v_view,v_view_digest,v_target,public.static_weekly_digest_jsonb(v_target))
   on conflict do nothing returning intent_id into v_intent;
   if found then v_count:=v_count+1;end if;
  end loop;
  if v_devices=0 then
   v_target:=jsonb_build_object('schema','static-weekly.recurring-application-target.v1','targetType','SCHEDULE',
    'operationId',b.operation_id,'publicationId',a.publication_id,'projectionId',a.projection_id,'serviceDate',p_date,
    'authorityRevision',a.projection_authority_revision,'lunchDocumentIdentity',l.document_identity,
    'employeeId',person.employee_id,'deviceId',null,'credentialId',null,'assignmentEpoch',null,'viewDigest',v_view_digest);
   insert into custodial_coverall.manual_application_intents(operation_id,publication_id,projection_id,service_date,
    employee_id,authority_revision,lunch_document_identity,view_json,view_digest,target_json,target_digest)
   values(b.operation_id,a.publication_id,a.projection_id,p_date,person.employee_id,a.projection_authority_revision,
    l.document_identity,v_view,v_view_digest,v_target,public.static_weekly_digest_jsonb(v_target))
   on conflict do nothing returning intent_id into v_intent;
   if found then v_count:=v_count+1;end if;
  end if;
 end loop;
 return v_count;
end
$old_body$;
 new_body constant text:=$new_body$
declare a record;b custodial_coverall.manual_application_bindings%rowtype;
 current_projection public.weekly_schedule_compiled_projections%rowtype;l public.weekly_schedule_lunch_documents%rowtype;
person record;device record;v_view jsonb;v_target jsonb;v_view_digest text;v_intent uuid;v_count int:=0;v_devices int;
v_recurring_accepted boolean:=false;
begin
 if p_date is null or not isfinite(p_date) then raise exception 'recurring application reconciliation requires one finite date';end if;
 perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 select * into a from public.static_weekly_v6_schedule_authority_state(p_date);
 if a.projection_status='blocked_recurring_authority' then return public.static_weekly_v19_reconcile_terminal_date(p_date);end if;
 if a.projection_status is distinct from 'current' or a.projection_id is null then raise exception 'recurring schedule projection is unavailable';end if;
 select * into b from custodial_coverall.manual_application_bindings where publication_id=a.publication_id;
 if not found then return 0;end if;
 select * into strict current_projection from public.weekly_schedule_compiled_projections where projection_id=a.projection_id;
 if current_projection.publication_id is distinct from b.publication_id or current_projection.version_id is distinct from b.version_id
  or not exists(select 1 from public.weekly_schedule_versions v join public.static_weekly_authority_source_documents s on s.source_id=v.authority_source_id
    where v.version_id=b.version_id and s.source_id=b.source_id and s.source_digest=b.source_digest and s.active=true)
  or not exists(select 1 from public.static_weekly_approved_initial_confirmations i where i.publication_id=b.publication_id and i.manager_id=b.initial_manager_id
    and i.idempotency_key=b.initial_idempotency_key and i.receipt_json=b.initial_receipt_json and i.request_json=b.initial_request_json
    and public.static_weekly_digest_jsonb(i.receipt_json)=b.initial_receipt_digest)
  then raise exception 'Manual target origin/current source correspondence differs';end if;
 if current_projection.projection_id<>b.original_projection_id then
  v_recurring_accepted:=custodial_coverall.manual_recurring_projection_accepted(b.operation_id,current_projection.projection_id,a.projection_authority_revision);
 end if;
 if current_projection.projection_id<>b.original_projection_id and not v_recurring_accepted and
  (current_projection.projection_envelope#>>'{authority,schema}' is distinct from 'custodial.approved-manual-period-projection-authority.v1'
   or current_projection.projection_envelope#>>'{adapter,schema}' is distinct from 'custodial.approved-manual-period-database-adapter.v1'
   or current_projection.projection_envelope#>>'{authority,sourcePublicationId}' is distinct from b.publication_id::text
   or current_projection.projection_envelope#>>'{authority,sourceVersionId}' is distinct from b.version_id::text
   or current_projection.projection_envelope#>'{authority,normalSourceChanged}' is distinct from 'false'::jsonb)
  then raise exception 'Only accepted original or exact native manual lineage creates targets';end if;
 if current_projection.projection_id<>b.original_projection_id and not v_recurring_accepted and not exists(
  select 1 from public.static_weekly_staffing_commands command
  join public.static_weekly_staffing_staged_candidates staged on staged.operation_id=command.operation_id and staged.candidate_kind='projection'
  join public.static_weekly_staffing_command_receipts receipt on receipt.operation_id=command.operation_id and receipt.event_kind='ACCEPTED'
  where command.state='ACCEPTED' and staged.payload_json->'envelope'=current_projection.projection_envelope
   and command.accepted_receipt->>'event'='ACCEPTED' and command.accepted_receipt->>'operation_id'=command.operation_id::text
   and command.accepted_receipt->>'semantic_digest'=command.semantic_digest
   and command.accepted_receipt#>>ARRAY['projections',current_projection.week_start::text,'publication_id']=b.publication_id::text
   and command.accepted_receipt#>>ARRAY['projections',current_projection.week_start::text,'projection_id']=current_projection.projection_id::text
   and receipt.receipt_json=command.accepted_receipt and receipt.receipt_digest=public.static_weekly_digest_jsonb(receipt.receipt_json))
  then raise exception 'Prepared native document is not an accepted original operation';end if;
 if b.activation_operation_id is not null and not exists(select 1 from custodial_coverall.activation_receipts r where r.operation_id=b.activation_operation_id
  and r.receipt_json=b.activation_receipt_json and public.static_weekly_digest_jsonb(r.receipt_json)=b.activation_receipt_digest)
  then raise exception 'Original operational activation receipt changed';end if;
 select * into l from public.weekly_schedule_lunch_documents where projection_id=a.projection_id;
 if not found then raise exception 'exact recurring lunch companion is unavailable';end if;
 if current_projection.projection_id<>b.original_projection_id and not v_recurring_accepted and not exists(select 1 from public.static_weekly_staffing_commands command
  where command.state='ACCEPTED' and command.accepted_receipt#>>ARRAY['projections',current_projection.week_start::text,'projection_id']=current_projection.projection_id::text
   and command.accepted_receipt#>>ARRAY['projections',current_projection.week_start::text,'lunch_document_identity']=l.document_identity)
  then raise exception 'Accepted original native full lunch correspondence differs';end if;
 for person in with dated_people as materialized (
  select (r->>'incumbentPersonId')::uuid employee_id from jsonb_array_elements(coalesce(current_projection.projection_envelope#>'{authority,projectionAvailability}','[]')) r
   where r->>'incumbentPersonId' is not null and r->>'serviceDate'=p_date::text
  union select (r->>'incumbentPersonId')::uuid from public.weekly_schedule_compiled_projections old
   cross join lateral jsonb_array_elements(coalesce(old.projection_envelope#>'{authority,projectionAvailability}','[]')) r
   where old.projection_id=b.original_projection_id and r->>'incumbentPersonId' is not null
    and extract(isodow from (r->>'serviceDate')::date)=extract(isodow from p_date)
  union select (r->>'personId')::uuid from public.weekly_schedule_versions v
   cross join lateral jsonb_array_elements(coalesce(v.draft_document#>'{authority,compilerInput,roster}','[]')) r
   where v.version_id=b.version_id and r->>'personId' is not null
    and extract(isodow from (r->>'serviceDate')::date)=extract(isodow from p_date)
  union select old.employee_id from custodial_coverall.manual_application_intents old where old.publication_id=b.publication_id and old.service_date=p_date
  union select x.owner_person_id_snapshot from public.weekly_schedule_occurrences x join public.weekly_schedule_compiled_projections projection using(projection_id)
   where projection.publication_id in(b.publication_id,b.predecessor_publication_id) and x.service_date=p_date and x.owner_person_id_snapshot is not null
  union select (r->>'normal_owner_person_id')::uuid from public.weekly_schedule_lunch_documents lunch join public.weekly_schedule_compiled_projections projection using(projection_id)
   cross join lateral jsonb_array_elements(lunch.document_json->'responsibilities') r
   where projection.publication_id in(b.publication_id,b.predecessor_publication_id) and r->>'service_date'=p_date::text and r->>'normal_owner_person_id' is not null
  union select (r->>'coverer_person_id')::uuid from public.weekly_schedule_lunch_documents lunch join public.weekly_schedule_compiled_projections projection using(projection_id)
   cross join lateral jsonb_array_elements(lunch.document_json->'responsibilities') r
   where projection.publication_id in(b.publication_id,b.predecessor_publication_id) and r->>'service_date'=p_date::text and r->>'coverer_person_id' is not null
 ), off_day_phone_candidates as materialized (
  -- Dated work/history already owns its existing exact target population.
  -- Only an omitted active enrolled phone needs this additional OFF proof.
  select distinct d.assigned_employee_id employee_id from public.devices d
   join public.employees e on e.id=d.assigned_employee_id and e.active=true
   where d.active=true and not exists(select 1 from dated_people existing where existing.employee_id=d.assigned_employee_id)
    and exists(select 1 from public.device_auth_credentials c where c.device_id=d.id
     and c.confirmed_at is not null and c.revoked_at is null and c.expires_at>statement_timestamp())
 ), off_day_phone_views as materialized (
  select candidate.employee_id,public.static_weekly_v5_read_employee_day(p_date,candidate.employee_id,
   (p_date::timestamp+interval '12 hours') at time zone 'America/Chicago') canonical_day
  from off_day_phone_candidates candidate
 ), people as (
  select employee_id from dated_people
  union select off_view.employee_id from off_day_phone_views off_view
   where off_view.canonical_day->'governed'='true'::jsonb and off_view.canonical_day->>'source'='static_weekly_projection'
    and off_view.canonical_day->>'projection_status'='current' and off_view.canonical_day->>'service_date'=p_date::text
    and off_view.canonical_day->>'employee_id'=off_view.employee_id::text and off_view.canonical_day->>'publication_id'=a.publication_id::text
    and off_view.canonical_day->>'projection_id'=a.projection_id::text and off_view.canonical_day->>'phase'='off_day'
    and off_view.canonical_day->>'schedule_status'='off'
    and (off_view.canonical_day->'shift'='null'::jsonb or off_view.canonical_day#>'{shift,active}'='false'::jsonb)
    and off_view.canonical_day->'all_items'='[]'::jsonb
 ) select distinct people.employee_id from people join public.employees e on e.id=people.employee_id order by people.employee_id loop
  v_view:=public.static_weekly_v22_recurring_render_view(a.projection_id,p_date,person.employee_id);
  v_view_digest:=public.static_weekly_digest_jsonb(v_view);v_devices:=0;
  -- Rotation/reconnect must not silently create a different view at the same
  -- authority identity, nor make ON CONFLICT hide changed display bytes.
  if exists(select 1 from custodial_coverall.manual_application_intents i
   where i.publication_id=a.publication_id and i.projection_id=a.projection_id
    and i.service_date=p_date and i.employee_id=person.employee_id
    and i.authority_revision=a.projection_authority_revision
    and (i.view_json is distinct from v_view or i.view_digest is distinct from v_view_digest
      or i.lunch_document_identity is distinct from l.document_identity)) then
   raise exception using errcode='23514',message='recurring render changed without a new exact authority identity';end if;
  for device in select d.id,c.credential_id,d.assignment_epoch from public.devices d
   join public.device_auth_credentials c on c.device_id=d.id and c.confirmed_at is not null
    and c.revoked_at is null and c.expires_at>statement_timestamp()
   where d.active=true and d.assigned_employee_id=person.employee_id
   order by d.id,c.credential_id loop
   v_devices:=v_devices+1;
   v_target:=jsonb_build_object('schema','static-weekly.recurring-application-target.v1','targetType','SCHEDULE',
    'operationId',b.operation_id,'publicationId',a.publication_id,'projectionId',a.projection_id,'serviceDate',p_date,
    'authorityRevision',a.projection_authority_revision,'lunchDocumentIdentity',l.document_identity,
    'employeeId',person.employee_id,'deviceId',device.id,'credentialId',device.credential_id,
    'assignmentEpoch',device.assignment_epoch,'viewDigest',v_view_digest);
   insert into custodial_coverall.manual_application_intents(operation_id,publication_id,projection_id,service_date,
    employee_id,device_id,credential_id,assignment_epoch,authority_revision,lunch_document_identity,view_json,view_digest,target_json,target_digest)
   values(b.operation_id,a.publication_id,a.projection_id,p_date,person.employee_id,device.id,device.credential_id,
    device.assignment_epoch,a.projection_authority_revision,l.document_identity,v_view,v_view_digest,v_target,public.static_weekly_digest_jsonb(v_target))
   on conflict do nothing returning intent_id into v_intent;
   if found then v_count:=v_count+1;end if;
  end loop;
  if v_devices=0 then
   v_target:=jsonb_build_object('schema','static-weekly.recurring-application-target.v1','targetType','SCHEDULE',
    'operationId',b.operation_id,'publicationId',a.publication_id,'projectionId',a.projection_id,'serviceDate',p_date,
    'authorityRevision',a.projection_authority_revision,'lunchDocumentIdentity',l.document_identity,
    'employeeId',person.employee_id,'deviceId',null,'credentialId',null,'assignmentEpoch',null,'viewDigest',v_view_digest);
   insert into custodial_coverall.manual_application_intents(operation_id,publication_id,projection_id,service_date,
    employee_id,authority_revision,lunch_document_identity,view_json,view_digest,target_json,target_digest)
   values(b.operation_id,a.publication_id,a.projection_id,p_date,person.employee_id,a.projection_authority_revision,
    l.document_identity,v_view,v_view_digest,v_target,public.static_weekly_digest_jsonb(v_target))
   on conflict do nothing returning intent_id into v_intent;
   if found then v_count:=v_count+1;end if;
  end if;
 end loop;
 return v_count;
end
$new_body$;
BEGIN
 IF current_user NOT IN('postgres','supabase_admin')
  OR (SELECT proowner FROM pg_proc WHERE oid=target) IS DISTINCT FROM current_user::regrole
 THEN RAISE EXCEPTION 'Exact existing manual target function owner required';END IF;
 PERFORM public.custodial_begin_application_mutation();
 PERFORM pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 SELECT prosrc,to_jsonb(p)-'prosrc' INTO STRICT original_body,before_metadata FROM pg_proc p WHERE p.oid=target;
 IF original_body IS DISTINCT FROM old_body OR public.static_weekly_digest_text(original_body) IS DISTINCT FROM '5bb8d499005ad7d5cabf2c4e99e455bd7b4df96ab5b1a6ad1949107a7fa7e544'
  OR (SELECT prosecdef FROM pg_proc WHERE oid=target) IS DISTINCT FROM true
  OR (SELECT proconfig FROM pg_proc WHERE oid=target) IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']::text[]
  OR (SELECT provolatile FROM pg_proc WHERE oid=target) IS DISTINCT FROM 'v'::"char"
  OR (SELECT prorettype FROM pg_proc WHERE oid=target) IS DISTINCT FROM 'integer'::regtype
 THEN RAISE EXCEPTION 'Exact manual target predecessor body/security differs; no repair applied';END IF;
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role','static_weekly_control_plane','static_weekly_release_operator','custodial_application_reader'] LOOP
  IF has_function_privilege(role_name,target,'EXECUTE')
  THEN RAISE EXCEPTION 'Exact private manual target execute boundary differs; no repair applied';END IF;
 END LOOP;
 -- This existing owner-private function is included in complete private-schema
 -- backups. An unexpected separate release-recovery row requires its owning
 -- exact rebind; never leave such a row stale or weaken its immutable trigger.
 IF EXISTS(SELECT 1 FROM public.custodial_release_authority_restore_inventory i
  WHERE CASE WHEN i.object_kind='function' OR (i.object_kind='grant' AND position('(' IN i.object_identity)>0)
   THEN to_regprocedure(i.object_identity) END=target)
 THEN RAISE EXCEPTION 'Manual target has a retained release recovery entry; exact rebind required before repair';END IF;
 original_definition:=pg_get_functiondef(target);
 IF (length(original_definition)-length(replace(original_definition,old_body,'')))<>length(old_body)
  OR public.static_weekly_digest_text(new_body) IS DISTINCT FROM '7bf3ee3a83585aebc22ff0a13a47256a711b46c3cd884dbf3b2e19b68c7792c2'
 THEN RAISE EXCEPTION 'Exact manual OFF target substitution differs';END IF;
 next_definition:=replace(original_definition,old_body,new_body);
 IF replace(next_definition,new_body,old_body) IS DISTINCT FROM original_definition
 THEN RAISE EXCEPTION 'Exact manual OFF target inverse differs';END IF;
 EXECUTE next_definition;
 SELECT prosrc,to_jsonb(p)-'prosrc' INTO STRICT next_body,after_metadata FROM pg_proc p WHERE p.oid=target;
 IF next_body IS DISTINCT FROM new_body OR public.static_weekly_digest_text(next_body) IS DISTINCT FROM '7bf3ee3a83585aebc22ff0a13a47256a711b46c3cd884dbf3b2e19b68c7792c2'
  OR before_metadata IS DISTINCT FROM after_metadata
  OR pg_get_functiondef(target) IS DISTINCT FROM next_definition
 THEN RAISE EXCEPTION 'Manual target owner/ACL/attributes/body changed beyond exact OFF repair';END IF;
END $manual_off_day_targets$;
