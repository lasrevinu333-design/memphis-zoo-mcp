-- Fill/restore use the same transactionally complete projection/lunch contract
-- as vacancy. No applied history or immutable employee identity is rewritten.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';

create function public.static_weekly_v9_roster_completion_context(
 p_source_id uuid,p_slot_id uuid,p_effective_start date,p_require_vacancy boolean
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare source public.static_weekly_authority_source_documents%rowtype;
 publication uuid; publication_source uuid; matches integer;
begin
 perform public.static_weekly_v3_assert_control_plane();
 if p_source_id is null or p_slot_id is null or p_effective_start is null or p_require_vacancy is null then
  raise exception 'roster completion requires exact source, position and date'; end if;
 select * into source from public.static_weekly_authority_source_documents
  where source_id=p_source_id and active and retired_at is null for share;
 if not found then raise exception 'roster completion requires active registered source'; end if;
 select count(*) into matches from jsonb_array_elements(source.canonical_source->'slots') s
  where s->>'id'=p_slot_id::text and coalesce(s->'contractorCapacity','false'::jsonb)='false'::jsonb;
 if matches<>1 or (p_require_vacancy and not coalesce((source.canonical_source#>'{version,vacancyCapableSlotIds}') ? p_slot_id::text,false)) then
  raise exception 'registered source must bind the exact vacancy-capable stable employee position'; end if;
 select p.publication_id,v.authority_source_id into publication,publication_source
  from public.weekly_schedule_publications p join public.weekly_schedule_versions v on v.version_id=p.version_id
  where p.version_id=public.static_weekly_effective_version(p_effective_start-(extract(isodow from p_effective_start)::int-1));
 if publication is not null and publication_source is distinct from p_source_id then
  raise exception 'roster source does not own the effective published baseline'; end if;
 return jsonb_build_object('source_id',p_source_id,'source_digest',source.source_digest,
  'completion_mode',case when publication is null then 'mutation_only' else 'projection_required' end,
  'original_publication_id',publication);
end $function$;
revoke all on function public.static_weekly_v9_roster_completion_context(uuid,uuid,date,boolean)
 from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader;

-- Preserve the complete earlier integrity proof for vacancy/projection. Extend
-- it only with the exact new fill and restore response/request relationships.
do $integrity$
declare d text;
begin
 d:=pg_get_functiondef('public.static_weekly_v8_assert_vacancy_receipt(uuid,text)'::regprocedure);
 if position($old$p_operation not in ('vacate_roster_slot','materialize_projection')$old$ in d)=0 then raise exception 'receipt operation seam missing'; end if;
 d:=replace(d,$old$p_operation not in ('vacate_roster_slot','materialize_projection')$old$,
  $new$p_operation not in ('vacate_roster_slot','materialize_projection','fill_vacant_slot','restore_existing_employee')$new$);
 d:=replace(d,$old$ else
  if v_request->>'actor_manager_name'$old$,$new$
 elsif p_operation in ('fill_vacant_slot','restore_existing_employee') then
  v_content_digest:=public.static_weekly_digest_jsonb(v_request-'expected_revision'-'actor_manager_id'-'operation');
  if v_receipt.response_json#>>'{data,slot_id}' is distinct from v_request->>'slot_id'
   or v_receipt.response_json#>>'{data,effective_start}' is distinct from v_request->>'effective_start'
   or v_receipt.response_json#>>'{data,source_id}' is distinct from v_request->>'source_id'
   or coalesce(v_receipt.response_json#>>'{data,source_digest}','') !~ '^[0-9a-f]{64}$'
   or v_receipt.response_json#>'{data,phone_assignment}' is distinct from 'null'::jsonb
   or (p_operation='fill_vacant_slot' and (
    v_receipt.response_json#>>'{data,new_employee_name}' is distinct from v_request->>'new_employee_name'
    or nullif(v_receipt.response_json#>>'{data,new_employee_id}','') is null))
   or (p_operation='restore_existing_employee' and (
    v_receipt.response_json#>>'{data,employee_id}' is distinct from v_request->>'employee_id'
    or v_receipt.response_json#>'{data,history_preserved}' is distinct from 'true'::jsonb)) then
   raise exception 'roster receipt integrity: exact mutation response mismatch'; end if;
 else
  if v_request->>'actor_manager_name'$new$);
 if position('roster receipt integrity: exact mutation response mismatch' in d)=0 then raise exception 'receipt integrity branch seam missing'; end if;
 execute d;
end $integrity$;

do $fill$
declare d text;
begin
 d:=pg_get_functiondef('public.static_weekly_v7_fill_vacant_roster_slot(uuid,text,date,text,bigint,uuid,text)'::regprocedure);
 if position('public.static_weekly_v7_fill_vacant_roster_slot(p_slot_id uuid,' in d)=0
  or position($old$'effective_start',p_effective_start,'phone_assignment',null
  ));$old$ in d)=0 then raise exception 'fill source or response seam missing'; end if;
 d:=replace(d,'public.static_weekly_v7_fill_vacant_roster_slot(p_slot_id uuid,',
  'public.static_weekly_v9_fill_vacant_roster_slot(p_source_id uuid, p_slot_id uuid,');
 d:=replace(d,'  v_actor jsonb;','  v_completion jsonb; v_actor jsonb;');
 d:=replace(d,'if p_slot_id is null','if p_source_id is null or p_slot_id is null');
 d:=replace(d,$old$'operation','fill_vacant_slot','slot_id',p_slot_id$old$,
  $new$'operation','fill_vacant_slot','source_id',p_source_id,'slot_id',p_slot_id$new$);
 d:=replace(d,'end if; return v_prior.response_json; end if;',
  'end if; perform public.static_weekly_v8_assert_vacancy_receipt(v_prior.command_id,''fill_vacant_slot''); return v_prior.response_json; end if;');
 d:=replace(d,'  v_created:=public.static_weekly_v5_create_replacement_employee(v_name,p_manager_id);',
  '  v_completion:=public.static_weekly_v9_roster_completion_context(p_source_id,p_slot_id,p_effective_start,true);
  v_created:=public.static_weekly_v5_create_replacement_employee(v_name,p_manager_id);');
 d:=replace(d,$old$'effective_start',p_effective_start,'phone_assignment',null
  ));$old$,$new$'effective_start',p_effective_start,'phone_assignment',null
  )||v_completion);$new$);
 if position('v_completion:=public.static_weekly_v9_roster_completion_context' in d)=0
  or position($check$'source_id',p_source_id,'slot_id'$check$ in d)=0 then raise exception 'source-bound fill integration failed'; end if;
 execute d;
end $fill$;
-- Preserve the original function for historical recovery only. Runtime writers
-- must not use its mutation-only unbound route after this migration.
revoke all on function public.static_weekly_v7_fill_vacant_roster_slot(uuid,text,date,text,bigint,uuid,text)
 from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader;
revoke all on function public.static_weekly_v9_fill_vacant_roster_slot(uuid,uuid,text,date,text,bigint,uuid,text)
 from public,anon,authenticated,service_role,static_weekly_release_operator,custodial_application_reader;
grant execute on function public.static_weekly_v9_fill_vacant_roster_slot(uuid,uuid,text,date,text,bigint,uuid,text) to static_weekly_control_plane;

do $restore$
declare d text;
begin
 d:=pg_get_functiondef('public.static_weekly_v8_restore_existing_employee(uuid,uuid,uuid,date,text,bigint,uuid,text)'::regprocedure);
 if position('  v_status jsonb;' in d)=0 or position($old$'phone_assignment',null,'history_preserved',true
    )$old$ in d)=0 then raise exception 'restore completion seam missing'; end if;
 d:=replace(d,'  v_status jsonb;','  v_status jsonb; v_completion jsonb;');
 d:=replace(d,'     or p_effective_start<public.sch_service_date(statement_timestamp())','');
 d:=replace(d,'    return v_prior.response_json;',
  '    perform public.static_weekly_v8_assert_vacancy_receipt(v_prior.command_id,''restore_existing_employee'');
    return v_prior.response_json;');
 d:=replace(d,'  select * into v_slot from public.weekly_roster_slots where slot_id=p_slot_id for share;',
  '  if p_effective_start<public.sch_service_date(statement_timestamp()) then raise exception ''new restoration cannot be backdated''; end if;
  v_completion:=public.static_weekly_v9_roster_completion_context(p_source_id,p_slot_id,p_effective_start,false);
  select * into v_slot from public.weekly_roster_slots where slot_id=p_slot_id for share;');
 d:=replace(d,$old$'phone_assignment',null,'history_preserved',true
    )$old$,$new$'phone_assignment',null,'history_preserved',true
    )||v_completion$new$);
 if position('v_completion:=public.static_weekly_v9_roster_completion_context' in d)=0 then raise exception 'restore source binding seam missing'; end if;
 execute d;
end $restore$;

-- Reuse the exact original publication/projection/lunch integrity reader. Its
-- additional operation selector is checked before any receipt can be returned.
do $completed$
declare d text;
begin
 d:=pg_get_functiondef('public.static_weekly_v8_read_completed_vacancy(uuid,text)'::regprocedure);
 if position('public.static_weekly_v8_read_completed_vacancy(p_manager_id uuid, p_idempotency_key text)' in d)=0 then raise exception 'completed roster reader signature seam missing'; end if;
 d:=replace(d,'public.static_weekly_v8_read_completed_vacancy(p_manager_id uuid, p_idempotency_key text)',
  'public.static_weekly_v9_read_completed_roster_change(p_manager_id uuid, p_idempotency_key text, p_operation text)');
 d:=replace(d,' if p_manager_id is null or nullif(btrim(p_idempotency_key),'''') is null then',
  ' if p_operation is null or p_operation not in (''vacate_roster_slot'',''fill_vacant_slot'',''restore_existing_employee'') or p_manager_id is null or nullif(btrim(p_idempotency_key),'''') is null then');
 d:=replace(d,'and command_type=''vacate_roster_slot'';','and command_type=p_operation;');
 d:=replace(d,'v_mutation.command_id,''vacate_roster_slot''','v_mutation.command_id,p_operation');
 if position('p_operation not in' in d)=0 or position('and command_type=p_operation;' in d)=0 then raise exception 'completed roster exact-operation seam missing'; end if;
 execute d;
end $completed$;
revoke all on function public.static_weekly_v9_read_completed_roster_change(uuid,text,text)
 from public,anon,authenticated,service_role,static_weekly_release_operator,custodial_application_reader;
grant execute on function public.static_weekly_v9_read_completed_roster_change(uuid,text,text) to static_weekly_control_plane;

alter table public.custodial_release_authority_restore_inventory disable trigger trg_custodial_release_authority_restore_inventory_immutable;
do $recovery$
declare identity text; kind text; definition text; bucket integer; next_order integer;
begin
 foreach identity in array array[
  'public.static_weekly_v9_roster_completion_context(uuid,uuid,date,boolean)',
  'public.static_weekly_v8_assert_vacancy_receipt(uuid,text)',
  'public.static_weekly_v7_fill_vacant_roster_slot(uuid,text,date,text,bigint,uuid,text)',
  'public.static_weekly_v9_fill_vacant_roster_slot(uuid,uuid,text,date,text,bigint,uuid,text)',
  'public.static_weekly_v8_restore_existing_employee(uuid,uuid,uuid,date,text,bigint,uuid,text)',
  'public.static_weekly_v9_read_completed_roster_change(uuid,text,text)'] loop
  foreach kind in array array['function','grant'] loop
   definition:=case kind when 'function' then pg_get_functiondef(identity::regprocedure)
    else public.custodial_release_authority_current_grant_definition(identity) end;
   if definition is null then raise exception 'missing roster recovery object %',identity; end if;
   update public.custodial_release_authority_restore_inventory set definition_sql=definition,
    definition_sha256=public.static_weekly_digest_text(definition),captured_at=statement_timestamp()
    where object_kind=kind and (case when object_kind in ('function','grant') then to_regprocedure(object_identity) end)=identity::regprocedure;
   if not found then
    bucket:=case kind when 'function' then 100000 else 900000 end;
    select coalesce(max(restore_order),bucket)+1 into next_order from public.custodial_release_authority_restore_inventory where restore_order>=bucket and restore_order<bucket+100000;
    insert into public.custodial_release_authority_restore_inventory(restore_order,object_kind,object_identity,definition_sql,definition_sha256)
     values(next_order,kind,identity,definition,public.static_weekly_digest_text(definition));
   end if;
  end loop;
 end loop;
end $recovery$;
alter table public.custodial_release_authority_restore_inventory enable trigger trg_custodial_release_authority_restore_inventory_immutable;
commit;
