-- AU13: extend only the existing bounded Home reader; preserve grants/RLS and dated behavior.
begin;
set local lock_timeout='5s';
set local statement_timeout='40s';
do $home_reader_scope$
declare targets jsonb:=$targets$[{"identity":"public.static_weekly_v27_read_home_time_facts(date,uuid,uuid,uuid)","preimage_sha256":"43c3d0b75b45dfcc001864e098e067d5a8623aca49e9c30e9f0c1a9059473f78","replacement":"CREATE OR REPLACE FUNCTION public.static_weekly_v27_read_home_time_facts(p_date date, p_employee uuid, p_publication uuid, p_projection uuid)\n RETURNS jsonb\n LANGUAGE plpgsql\n STABLE SECURITY DEFINER\n SET search_path TO 'pg_catalog', 'public'\nAS $function$\ndeclare rec jsonb:=public.custodial_dated_record(p_date);roster jsonb;working boolean;normal_facts jsonb;\nbegin\n if p_date is null or p_employee is null or p_publication is null or p_projection is null then return null;end if;\n -- Normal publication facts stay inside this existing bounded reader. The\n -- canonical roster owns exception/staffing freshness; raw projection RLS stays\n -- unchanged. Return only this dated employee's selected published time fields.\n if rec is null then\n  select jsonb_agg(jsonb_build_object(\n   'contract_version','employee-home-projected-record.v1','service_date',p_date,\n   'employee_id',p_employee,'publication_id',p_publication,'projection_id',p_projection,'projection_status','current',\n   'roster',jsonb_build_object('employee_id',r.employee_id,'projection_id',r.projection_id,\n    'publication_id',r.publication_id,'version_id',r.version_id,'slot_id',r.slot_id,\n    'projection_status',r.projection_status,'staffing_state',r.staffing_state),\n   'employee_active',emp.active,\n   'availability',(select jsonb_agg(jsonb_build_object('slotId',a->'slotId','incumbentPersonId',a->'incumbentPersonId',\n    'serviceDate',a->'serviceDate','dayOfWeek',a->'dayOfWeek','status',a->'status',\n    'shift',a->'shift','lunch',a->'lunch','blockedWindows',a->'blockedWindows'))\n    from jsonb_array_elements(p.projection_envelope#>'{authority,projectionAvailability}') a\n    where a->>'serviceDate'=p_date::text and a->>'incumbentPersonId'=r.employee_id::text))) into normal_facts\n  from public.static_weekly_v6_read_roster(p_date) r\n  join public.employees emp on emp.id=r.employee_id\n  join public.weekly_schedule_compiled_projections p on p.projection_id=r.projection_id\n   and p.publication_id=r.publication_id and p.version_id=r.version_id\n  where r.employee_id=p_employee and r.projection_id=p_projection and r.publication_id=p_publication\n   and r.governed is true and r.projection_status='current' and p_date between p.week_start and p.week_end;\n  if jsonb_array_length(normal_facts) is distinct from 1 then return null;end if;\n  return normal_facts->0;\n end if;\n if rec is null or rec->>'projectionStatus'<>'current' or rec->>'publicationId'<>p_publication::text or rec->>'projectionId'<>p_projection::text then return null;end if;\n select r into roster from jsonb_array_elements(public.custodial_dated_rows('roster',p_date)) r where r->>'employee_id'=p_employee::text;\n if roster is null then return null;end if;working:=roster->>'active'='true';\n return jsonb_build_object('contract_version','employee-home-time-facts.v1','service_date',p_date,'employee_id',p_employee,\n  'employee_name',roster->>'employee_name','projection_status','current','projection_id',p_projection,'publication_id',p_publication,\n  'candidate_revision',rec->>'phonePdfRevision','source','static_weekly_projection','reason',null,\n  'schedule_status',case when working then 'scheduled' else 'off' end,\n  'shift',case when working then jsonb_build_object('active',true,'start',roster->>'shift_start','end',roster->>'shift_end',\n   'shift_start',roster->>'shift_start','shift_end',roster->>'shift_end','lunch_start',roster->>'lunch_start','lunch_end',roster->>'lunch_end') else jsonb_build_object('active',false) end,\n  'lunch',case when working then jsonb_build_object('start',roster->>'lunch_start','end',roster->>'lunch_end') else null end);\nend $function$\n","replacement_sha256":"daf9df7d12b6b1d6244ab4e15dc24dc084b268a9d16c29871c50b72ba118027b","metadata":{"acl":"{postgres=X/postgres,service_role=X/postgres,custodial_application_reader=X/postgres}","owner":"postgres","config":["search_path=pg_catalog, public"],"strict":false,"definer":true,"language":"plpgsql","parallel":"u","volatility":"s"},"inventory":[{"object_kind":"function","object_identity":"public.static_weekly_v27_read_home_time_facts(date,uuid,uuid,uuid)","restore_order":100317,"definition_sql":"CREATE OR REPLACE FUNCTION public.static_weekly_v27_read_home_time_facts(p_date date, p_employee uuid, p_publication uuid, p_projection uuid)\n RETURNS jsonb\n LANGUAGE plpgsql\n STABLE SECURITY DEFINER\n SET search_path TO 'pg_catalog', 'public'\nAS $function$\ndeclare rec jsonb:=public.custodial_dated_record(p_date);roster jsonb;working boolean;\nbegin\n if p_date is null or p_employee is null or p_publication is null or p_projection is null then return null;end if;\n if rec is null or rec->>'projectionStatus'<>'current' or rec->>'publicationId'<>p_publication::text or rec->>'projectionId'<>p_projection::text then return null;end if;\n select r into roster from jsonb_array_elements(public.custodial_dated_rows('roster',p_date)) r where r->>'employee_id'=p_employee::text;\n if roster is null then return null;end if;working:=roster->>'active'='true';\n return jsonb_build_object('contract_version','employee-home-time-facts.v1','service_date',p_date,'employee_id',p_employee,\n  'employee_name',roster->>'employee_name','projection_status','current','projection_id',p_projection,'publication_id',p_publication,\n  'candidate_revision',rec->>'phonePdfRevision','source','static_weekly_projection','reason',null,\n  'schedule_status',case when working then 'scheduled' else 'off' end,\n  'shift',case when working then jsonb_build_object('active',true,'start',roster->>'shift_start','end',roster->>'shift_end',\n   'shift_start',roster->>'shift_start','shift_end',roster->>'shift_end','lunch_start',roster->>'lunch_start','lunch_end',roster->>'lunch_end') else jsonb_build_object('active',false) end,\n  'lunch',case when working then jsonb_build_object('start',roster->>'lunch_start','end',roster->>'lunch_end') else null end);\nend $function$\n","definition_sha256":"43c3d0b75b45dfcc001864e098e067d5a8623aca49e9c30e9f0c1a9059473f78"},{"object_kind":"grant","object_identity":"public.static_weekly_v27_read_home_time_facts(date,uuid,uuid,uuid)","restore_order":950163,"definition_sql":"select public.custodial_release_authority_reset_grants('public.static_weekly_v27_read_home_time_facts(date,uuid,uuid,uuid)'); grant execute on function static_weekly_v27_read_home_time_facts(date,uuid,uuid,uuid) to service_role; grant execute on function static_weekly_v27_read_home_time_facts(date,uuid,uuid,uuid) to custodial_application_reader;","definition_sha256":"66e8c793a1af99cc91fe80af26314446e12d6e308c2635b808fe07d1cd175901"}]}]$targets$::jsonb;
 helpers jsonb:=$helpers$[]$helpers$::jsonb;
 t jsonb;h jsonb;identity text;original text;before_meta jsonb;after_meta jsonb;found_inventory jsonb;expected_inventory jsonb;before_surface jsonb;changed_count integer;
begin
 if not exists(select 1 from pg_class where oid='public.weekly_schedule_compiled_projections'::regclass
  and relrowsecurity and relforcerowsecurity) or exists(select 1 from pg_policy
   where polrelid='public.weekly_schedule_compiled_projections'::regclass) then
  raise exception 'Home reader repair projection RLS predecessor differs';end if;
 for h in select value from jsonb_array_elements(helpers) loop
  if public.static_weekly_digest_text(pg_get_functiondef(to_regprocedure(h->>'identity'))) is distinct from h->>'sha256' then
   raise exception 'Exact unchanged digest helper differs: %',h->>'identity';end if;
 end loop;
 if not exists(select 1 from pg_trigger where tgrelid='public.custodial_release_authority_restore_inventory'::regclass
  and tgname='trg_custodial_release_authority_restore_inventory_immutable' and tgenabled='A') then
  raise exception 'Home reader repair recovery guard is not ALWAYS';end if;
 select coalesce(jsonb_agg(to_jsonb(s) order by object_kind,object_identity),'[]'::jsonb) into before_surface
  from public.custodial_release_canary_authority_surface() s;
 -- Validate every predecessor before the first change.
 for t in select value from jsonb_array_elements(targets) loop
  identity:=t->>'identity';original:=pg_get_functiondef(to_regprocedure(identity));
  if public.static_weekly_digest_text(original) is distinct from t->>'preimage_sha256' then
   raise exception 'Exact Home reader predecessor differs: %',identity;end if;
  select jsonb_build_object('owner',proowner::regrole::text,'acl',proacl::text,'definer',prosecdef,
   'volatility',provolatile,'strict',proisstrict,'config',to_jsonb(proconfig),'parallel',proparallel,'language',l.lanname)
   into strict before_meta from pg_proc f join pg_language l on l.oid=f.prolang where f.oid=to_regprocedure(identity);
  if before_meta is distinct from t->'metadata' then raise exception 'Exact Home reader metadata differs: %',identity;end if;
  select coalesce(jsonb_agg(jsonb_build_object('object_kind',object_kind,'object_identity',object_identity,'restore_order',restore_order,
   'definition_sql',definition_sql,'definition_sha256',definition_sha256) order by object_kind,object_identity,restore_order),'[]'::jsonb)
   into found_inventory from public.custodial_release_authority_restore_inventory
   where object_identity in(identity,replace(identity,'public.',''));
  if found_inventory is distinct from t->'inventory' then raise exception 'Exact Home reader recovery predecessor differs: %',identity;end if;
  if public.static_weekly_digest_text(t->>'replacement') is distinct from t->>'replacement_sha256' then
   raise exception 'Home reader replacement identity differs: %',identity;end if;
 end loop;
 for t in select value from jsonb_array_elements(targets) loop
  identity:=t->>'identity';execute t->>'replacement';
  select jsonb_build_object('owner',proowner::regrole::text,'acl',proacl::text,'definer',prosecdef,
   'volatility',provolatile,'strict',proisstrict,'config',to_jsonb(proconfig),'parallel',proparallel,'language',l.lanname)
   into strict after_meta from pg_proc f join pg_language l on l.oid=f.prolang where f.oid=to_regprocedure(identity);
  if pg_get_functiondef(to_regprocedure(identity)) is distinct from t->>'replacement' or after_meta is distinct from t->'metadata' then
   raise exception 'Home reader replacement authority/readback differs: %',identity;end if;
 end loop;
 alter table public.custodial_release_authority_restore_inventory disable trigger trg_custodial_release_authority_restore_inventory_immutable;
 for t in select value from jsonb_array_elements(targets) loop
  identity:=t->>'identity';
  update public.custodial_release_authority_restore_inventory set definition_sql=t->>'replacement',
   definition_sha256=t->>'replacement_sha256',captured_at=statement_timestamp()
   where object_kind='function' and object_identity in(identity,replace(identity,'public.',''))
    and definition_sha256=t->>'preimage_sha256';
  get diagnostics changed_count=row_count;
  if changed_count<>(select count(*) from jsonb_array_elements(t->'inventory') r where r->>'object_kind'='function') then
   raise exception 'Home reader exact recovery update count differs: %',identity;end if;
 end loop;
 alter table public.custodial_release_authority_restore_inventory enable always trigger trg_custodial_release_authority_restore_inventory_immutable;
 for t in select value from jsonb_array_elements(targets) loop
  identity:=t->>'identity';
  select coalesce(jsonb_agg(case when r->>'object_kind'='function' then r||jsonb_build_object('definition_sql',t->>'replacement',
   'definition_sha256',t->>'replacement_sha256') else r end order by r->>'object_kind',r->>'object_identity',(r->>'restore_order')::integer),'[]'::jsonb)
   into expected_inventory from jsonb_array_elements(t->'inventory') r;
  select coalesce(jsonb_agg(jsonb_build_object('object_kind',object_kind,'object_identity',object_identity,'restore_order',restore_order,
   'definition_sql',definition_sql,'definition_sha256',definition_sha256) order by object_kind,object_identity,restore_order),'[]'::jsonb)
   into found_inventory from public.custodial_release_authority_restore_inventory
   where object_identity in(identity,replace(identity,'public.',''));
  if found_inventory is distinct from expected_inventory then raise exception 'Home reader recovery/grant readback differs: %',identity;end if;
 end loop;
 if before_surface is distinct from (select coalesce(jsonb_agg(to_jsonb(s) order by object_kind,object_identity),'[]'::jsonb)
  from public.custodial_release_canary_authority_surface() s) then raise exception 'Home reader repair changed authority surface';end if;
 for h in select value from jsonb_array_elements(helpers) loop
  if public.static_weekly_digest_text(pg_get_functiondef(to_regprocedure(h->>'identity'))) is distinct from h->>'sha256' then
   raise exception 'Home reader repair changed global helper';end if;
 end loop;
 if not exists(select 1 from pg_trigger where tgrelid='public.custodial_release_authority_restore_inventory'::regclass
  and tgname='trg_custodial_release_authority_restore_inventory_immutable' and tgenabled='A') then
  raise exception 'Home reader repair did not preserve ALWAYS guard';end if;
 if not exists(select 1 from pg_class where oid='public.weekly_schedule_compiled_projections'::regclass
  and relrowsecurity and relforcerowsecurity) or exists(select 1 from pg_policy
   where polrelid='public.weekly_schedule_compiled_projections'::regclass) then
  raise exception 'Home reader repair projection RLS predecessor differs';end if;
end $home_reader_scope$;
commit;
