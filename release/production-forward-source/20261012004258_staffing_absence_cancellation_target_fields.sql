-- Main normal CLI-generated forward migration; manager read DTO only.
-- Exact committed B6682107eff823afd177fec63c99445ef14f17a3a.
-- Compiler/source/exception envelopes and cancellation inclusion stay unchanged.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SET LOCAL search_path=pg_catalog,public,extensions;
LOCK TABLE public.custodial_release_authority_restore_inventory IN ACCESS EXCLUSIVE MODE;
-- BEGIN finite_cancellation127_existing_owner_guard
-- Observed rollback-only capture39660509791; exact saved/current grant matches
-- sealed Source252 profile. Omission is redundant owner serialization only.
DO $cancellation127_existing_owner$
BEGIN
 IF current_user<>'postgres' OR session_user<>current_user
  OR current_setting('custodial.deployment_project_ref',true) IS DISTINCT FROM 'rqquvtjdmugpigbndmne'
  OR current_setting('session_replication_role')<>'origin'
  OR current_setting('transaction_read_only')<>'off'
  OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='postgres' AND NOT rolsuper AND rolbypassrls)
  OR NOT EXISTS(SELECT 1 FROM pg_class WHERE oid=to_regclass('public.custodial_release_authority_restore_inventory')
   AND relowner='postgres'::regrole AND relkind='r' AND relpersistence='p')
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Exact cancellation127 original postgres project/context required';END IF;
 IF NOT EXISTS(SELECT 1 FROM (
SELECT pg_get_userbyid(p.proowner)::text owner_name,p.pronamespace='public'::regnamespace public_schema,p.prokind::text kind,
   p.prosecdef security_definer,p.provolatile::text volatility,p.proconfig configuration,
   md5(p.prosrc) body_md5,md5(pg_get_functiondef(p.oid)) definition_md5,
   public.static_weekly_digest_text(pg_get_functiondef(p.oid)) definition_sha256,
   (SELECT jsonb_agg(jsonb_build_object('grantee',CASE WHEN x.grantee=0 THEN 'PUBLIC'::text ELSE pg_get_userbyid(x.grantee)::text END,
     'grantor',pg_get_userbyid(x.grantor)::text,'privilege',x.privilege_type,'grantable',x.is_grantable)
    ORDER BY (CASE WHEN x.grantee=0 THEN 'PUBLIC'::text ELSE pg_get_userbyid(x.grantee)::text END) COLLATE pg_catalog."C",
     (pg_get_userbyid(x.grantor)::text) COLLATE pg_catalog."C",x.privilege_type COLLATE pg_catalog."C",x.is_grantable)
    FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x) named_acl,
   has_function_privilege('postgres',p.oid,'EXECUTE') owner_execute,
   has_function_privilege('static_weekly_control_plane',p.oid,'EXECUTE') control_execute,
   EXISTS(SELECT 1 FROM unnest(ARRAY['anon','authenticated','service_role','custodial_application_reader','static_weekly_release_operator']) role_name
    WHERE has_function_privilege(role_name,p.oid,'EXECUTE')) denied_runtime_execute,
   public.custodial_release_authority_current_grant_definition('public.static_weekly_v3_read_manager_snapshot(date)') grant_definition,
   public.static_weekly_digest_text(public.custodial_release_authority_current_grant_definition('public.static_weekly_v3_read_manager_snapshot(date)')) grant_sha256
  FROM pg_proc p WHERE p.oid=to_regprocedure('public.static_weekly_v3_read_manager_snapshot(date)')
 ) o WHERE
-- BEGIN exact_cancellation127_predicate
o.owner_name='postgres' AND o.public_schema AND o.kind='f'
   AND o.security_definer AND o.volatility='v'
   AND o.configuration=ARRAY['search_path=pg_catalog, public']::text[]
   AND o.body_md5='5a44d92246554e8ba37081c3ee0cfbe0'
   AND o.definition_md5='b2ad1bcabfdd6b77b7a824dfdf020cdd'
   AND o.definition_sha256='ab1583186f60403baea1ef6041881d18ef96181d6f14fd789e637aff0c59d016'
   AND o.named_acl='[{"grantee":"postgres","grantor":"postgres","privilege":"EXECUTE","grantable":false},{"grantee":"static_weekly_control_plane","grantor":"postgres","privilege":"EXECUTE","grantable":false}]'::jsonb
   AND o.owner_execute AND o.control_execute AND NOT o.denied_runtime_execute
   AND o.grant_definition=$existing_grant$select public.custodial_release_authority_reset_grants('public.static_weekly_v3_read_manager_snapshot(date)'); grant execute on function static_weekly_v3_read_manager_snapshot(date) to static_weekly_control_plane;$existing_grant$
   AND o.grant_sha256='363ba443a22e34a7aada201ae2cbfadf2b456cd443bbae2dd9ce113d686557ee'
-- END exact_cancellation127_predicate
 ) THEN RAISE EXCEPTION 'Exact cancellation127 existing owner/body/options/ACL/grant required';END IF;
END $cancellation127_existing_owner$;
-- END finite_cancellation127_existing_owner_guard
CREATE TEMP TABLE cancel_target_inventory_before ON COMMIT DROP AS
 SELECT * FROM public.custodial_release_authority_restore_inventory;
CREATE TEMP TABLE cancel_target_reader_before ON COMMIT DROP AS
 SELECT proowner,proacl,prosrc,pg_get_functiondef(oid) definition FROM pg_proc
 WHERE oid='public.static_weekly_v3_read_manager_snapshot(date)'::regprocedure;
CREATE TEMP TABLE cancel_target_surface_before ON COMMIT DROP AS
 SELECT proowner,proacl,pg_get_functiondef(oid) definition FROM pg_proc
 WHERE oid='public.custodial_release_canary_authority_surface()'::regprocedure;
DO $reader$
DECLARE target regprocedure:='public.static_weekly_v3_read_manager_snapshot(date)'::regprocedure;
 old_body constant text:=$old_body$
declare
  v_snapshot jsonb;
  v_source jsonb;
  v_roster jsonb; v_terminal jsonb;
begin
  perform public.static_weekly_v3_assert_control_plane();
  v_snapshot:=public.static_weekly_v3_read_manager_snapshot_staffing_base(p_week_start);

  select jsonb_agg(jsonb_build_object('invalidationId',r.invalidation_id,'publicationId',r.publication_id,
    'authorityRevision',r.authority_revision,'effectiveStart',r.effective_start,'effectiveEnd',r.effective_end,
    'state','BLOCKED_RECURRING_AUTHORITY') order by r.authority_revision,r.invalidation_id) into v_terminal
  from (select distinct i.invalidation_id,i.publication_id,i.authority_revision,i.effective_start,i.effective_end
    from generate_series(0,6) offset_day
    cross join lateral public.static_weekly_v19_current_terminal_range(p_week_start+offset_day) i
    where i.invalidation_id is not null) r;
  if v_terminal is not null then
    return v_snapshot||jsonb_build_object('projection_status','blocked_recurring_authority',
      'latest_projection',null,'assignments','[]'::jsonb,'recurring_invalidations',v_terminal,
      'recurring_repair_required',true);
  end if;
 

  -- A draft or publication already binds its own immutable compiler input.
  if jsonb_typeof(v_snapshot->'display_version')='object' then
    return v_snapshot;
  end if;

  begin
    select s.canonical_source into strict v_source
    from public.static_weekly_authority_source_documents s
    where s.active=true;
  exception
    when no_data_found then
      raise exception using errcode='23514',message='initial manager snapshot requires one active registered recurring source';
    when too_many_rows then
      raise exception using errcode='23514',message='initial manager snapshot requires exactly one active registered recurring source';
  end;

  if jsonb_typeof(v_source->'slots')<>'array' then
    raise exception using errcode='23514',message='active registered recurring source has no canonical slot array';
  end if;

  select coalesce(jsonb_agg(
    item||jsonb_build_object(
      'contractor_capacity',coalesce((
        select lower(slot->>'contractorCapacity')='true'
        from jsonb_array_elements(v_source->'slots') slot
        where slot->>'id'=item->>'slot_id'
        limit 1
      ),false)
    ) order by item->>'slot_label',item->>'slot_id'
  ),'[]'::jsonb) into v_roster
  from jsonb_array_elements(coalesce(v_snapshot->'roster','[]'::jsonb)) item;

  return jsonb_set(v_snapshot,'{roster}',v_roster,true);
end
$old_body$;
 new_body constant text:=$new_body$
declare
  v_snapshot jsonb;
  v_source jsonb;
  v_roster jsonb; v_terminal jsonb; v_cancel_exceptions jsonb;
begin
  perform public.static_weekly_v3_assert_control_plane();
  v_snapshot:=public.static_weekly_v3_read_manager_snapshot_staffing_base(p_week_start);
  -- Server civil date is a cancellation fence, never the selected week,
  -- client clock, physical clock qualification or acceptance permission.
  v_snapshot:=v_snapshot||jsonb_build_object('current_service_date',public.sch_service_date(statement_timestamp())::text);
  -- Enrich ONLY rows already included by the existing canonical compiler
  -- exception-set/cancellation guard. Never reconstruct a range from a week
  -- or an employee from today's slot incumbent, and never add absent rows.
  if jsonb_typeof(v_snapshot->'exceptions')='array' then
    if jsonb_array_length(v_snapshot->'exceptions')>100000 then
      raise exception using errcode='54000',message='manager cancellation target row bound exceeded';
    end if;
    select coalesce(jsonb_agg(
      case when a.absence_id is null then e.value else e.value||jsonb_build_object(
        'staffingEmployeeId',a.employee_id::text,
        'staffingStartDate',a.start_date::text,
        'staffingEndDate',a.end_date::text,
        'staffingAcceptedOperationId',a.accepted_operation_id::text)
      end order by e.ordinal),'[]'::jsonb) into v_cancel_exceptions
    from jsonb_array_elements(v_snapshot->'exceptions') with ordinality e(value,ordinal)
    left join public.static_weekly_staffing_absences a
      on a.absence_id::text=e.value->>'staffingAbsenceId'
      and e.value->>'id'=a.absence_id::text||':'||(e.value->>'serviceDate')
      and e.value->>'serviceDate' between a.start_date::text and a.end_date::text
      and e.value->>'actorId'=a.accepted_by_manager_id::text
      and e.value->>'status'='accepted';
    if octet_length(v_cancel_exceptions::text)>16777216 then
      raise exception using errcode='54000',message='manager cancellation target byte bound exceeded';
    end if;
    v_snapshot:=jsonb_set(v_snapshot,'{exceptions}',v_cancel_exceptions,false);
  end if;


  select jsonb_agg(jsonb_build_object('invalidationId',r.invalidation_id,'publicationId',r.publication_id,
    'authorityRevision',r.authority_revision,'effectiveStart',r.effective_start,'effectiveEnd',r.effective_end,
    'state','BLOCKED_RECURRING_AUTHORITY') order by r.authority_revision,r.invalidation_id) into v_terminal
  from (select distinct i.invalidation_id,i.publication_id,i.authority_revision,i.effective_start,i.effective_end
    from generate_series(0,6) offset_day
    cross join lateral public.static_weekly_v19_current_terminal_range(p_week_start+offset_day) i
    where i.invalidation_id is not null) r;
  if v_terminal is not null then
    return v_snapshot||jsonb_build_object('projection_status','blocked_recurring_authority',
      'latest_projection',null,'assignments','[]'::jsonb,'recurring_invalidations',v_terminal,
      'recurring_repair_required',true);
  end if;
 

  -- A draft or publication already binds its own immutable compiler input.
  if jsonb_typeof(v_snapshot->'display_version')='object' then
    return v_snapshot;
  end if;

  begin
    select s.canonical_source into strict v_source
    from public.static_weekly_authority_source_documents s
    where s.active=true;
  exception
    when no_data_found then
      raise exception using errcode='23514',message='initial manager snapshot requires one active registered recurring source';
    when too_many_rows then
      raise exception using errcode='23514',message='initial manager snapshot requires exactly one active registered recurring source';
  end;

  if jsonb_typeof(v_source->'slots')<>'array' then
    raise exception using errcode='23514',message='active registered recurring source has no canonical slot array';
  end if;

  select coalesce(jsonb_agg(
    item||jsonb_build_object(
      'contractor_capacity',coalesce((
        select lower(slot->>'contractorCapacity')='true'
        from jsonb_array_elements(v_source->'slots') slot
        where slot->>'id'=item->>'slot_id'
        limit 1
      ),false)
    ) order by item->>'slot_label',item->>'slot_id'
  ),'[]'::jsonb) into v_roster
  from jsonb_array_elements(coalesce(v_snapshot->'roster','[]'::jsonb)) item;

  return jsonb_set(v_snapshot,'{roster}',v_roster,true);
end
$new_body$;
 definition text;
BEGIN
 SELECT b.definition INTO STRICT definition FROM cancel_target_reader_before b;
 IF public.static_weekly_digest_text(old_body) IS DISTINCT FROM '14e26f32104b7f25bfd155fbfbccf08a7f4c0279ed8bbc7accdb3fbaaf78a326'
  OR (SELECT prosrc FROM cancel_target_reader_before) IS DISTINCT FROM old_body
  OR (length(definition)-length(replace(definition,old_body,'')))/length(old_body)<>1
  OR (SELECT count(*) FROM cancel_target_inventory_before WHERE object_kind='function' AND object_identity LIKE '%(%'
   AND to_regprocedure(object_identity)=target AND definition_sql=definition
   AND definition_sha256=public.static_weekly_digest_text(definition))<>1
  OR (SELECT count(*) FROM cancel_target_inventory_before WHERE object_kind='grant' AND object_identity LIKE '%(%'
   AND to_regprocedure(object_identity)=target
   AND definition_sql=public.custodial_release_authority_current_grant_definition(object_identity)
   AND definition_sha256=public.static_weekly_digest_text(definition_sql))<>1
  OR NOT has_function_privilege('static_weekly_control_plane',target,'EXECUTE')
  OR EXISTS(SELECT 1 FROM unnest(ARRAY['anon','authenticated','service_role','custodial_application_reader','static_weekly_release_operator']) role_name
   WHERE has_function_privilege(role_name,target,'EXECUTE'))
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.custodial_release_authority_restore_inventory'::regclass
   AND tgname='trg_custodial_release_authority_restore_inventory_immutable' AND tgenabled='A')
 THEN RAISE EXCEPTION 'Cancellation target exact manager snapshot source/ACL/recovery predecessor changed';END IF;
 EXECUTE replace(definition,old_body,new_body);
 IF (SELECT prosrc FROM pg_proc WHERE oid=target) IS DISTINCT FROM new_body
  OR (SELECT proowner FROM pg_proc WHERE oid=target) IS DISTINCT FROM (SELECT proowner FROM cancel_target_reader_before)
  OR (SELECT proacl FROM pg_proc WHERE oid=target) IS DISTINCT FROM (SELECT proacl FROM cancel_target_reader_before)
 THEN RAISE EXCEPTION 'Cancellation target reader owner/ACL/body changed beyond the exact DTO extension';END IF;
END $reader$;

-- Source260 did not declare this manager reader in the independent canary
-- surface. Main's sealed260-prefix capture bd0f7619...bb2a6fb7d confirms ZERO
-- function/grant surface entries and exactly the two public inventory pins.
-- Register ONLY that source-qualified pair. Any existing/aliased membership,
-- different inventory identity/hash, or malformed predecessor fails closed.
DO $canary$
DECLARE target regprocedure:='public.static_weekly_v3_read_manager_snapshot(date)'::regprocedure;
 definition text;patched text;
BEGIN
 SELECT b.definition INTO STRICT definition FROM cancel_target_surface_before b;
 IF (SELECT count(*) FROM cancel_target_inventory_before WHERE object_kind='function' AND object_identity LIKE '%(%'
   AND to_regprocedure(object_identity)='public.custodial_release_canary_authority_surface()'::regprocedure
   AND definition_sql=definition AND definition_sha256=public.static_weekly_digest_text(definition))<>1
  OR EXISTS(SELECT 1 FROM cancel_target_inventory_before WHERE definition_sha256 IS DISTINCT FROM public.static_weekly_digest_text(definition_sql))
  OR (SELECT count(*) FROM public.custodial_release_canary_authority_surface() WHERE object_kind='function'
   AND object_identity LIKE '%(%' AND to_regprocedure(object_identity)=target)<>0
  OR (SELECT count(*) FROM public.custodial_release_canary_authority_surface() WHERE object_kind='grant'
   AND object_identity LIKE '%(%' AND to_regprocedure(object_identity)=target)<>0
  OR (SELECT count(*) FROM cancel_target_inventory_before WHERE object_kind='function'
   AND object_identity='public.static_weekly_v3_read_manager_snapshot(date)'
   AND definition_sha256='ab1583186f60403baea1ef6041881d18ef96181d6f14fd789e637aff0c59d016'
   AND definition_sql=(SELECT b.definition FROM cancel_target_reader_before b))<>1
  OR (SELECT count(*) FROM cancel_target_inventory_before WHERE object_kind='grant'
   AND object_identity='public.static_weekly_v3_read_manager_snapshot(date)'
   AND definition_sha256='363ba443a22e34a7aada201ae2cbfadf2b456cd443bbae2dd9ce113d686557ee'
   AND definition_sql=public.custodial_release_authority_current_grant_definition(object_identity))<>1
  OR EXISTS(SELECT 1 FROM cancel_target_inventory_before WHERE object_kind IN('function','grant')
   AND object_identity LIKE '%(%' AND to_regprocedure(object_identity)=target
   AND object_identity<>'public.static_weekly_v3_read_manager_snapshot(date)')
 THEN RAISE EXCEPTION 'Cancellation target exact canary predecessor changed';END IF;
 IF (length(definition)-length(replace(definition,'  values','')))/length('  values')<>1 THEN
  RAISE EXCEPTION 'Cancellation target canary VALUES seam changed';END IF;
 patched:=replace(definition,'  values','  values'||E'\n'
  ||'(''function'',''public.static_weekly_v3_read_manager_snapshot(date)'',''existing CP-only manager cancellation target snapshot''),'
  ||E'\n'||'(''grant'',''public.static_weekly_v3_read_manager_snapshot(date)'',''exact existing CP-only manager snapshot ACL''),');
 EXECUTE patched;
 IF pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure) IS DISTINCT FROM patched
  OR (SELECT count(*) FROM public.custodial_release_canary_authority_surface() WHERE object_kind='function'
   AND object_identity='public.static_weekly_v3_read_manager_snapshot(date)')<>1
  OR (SELECT count(*) FROM public.custodial_release_canary_authority_surface() WHERE object_kind='grant'
   AND object_identity='public.static_weekly_v3_read_manager_snapshot(date)')<>1 THEN
  RAISE EXCEPTION 'Cancellation target canary changed outside the exact source function/grant registration';END IF;
 IF (SELECT proowner FROM pg_proc WHERE oid='public.custodial_release_canary_authority_surface()'::regprocedure)
   IS DISTINCT FROM (SELECT proowner FROM cancel_target_surface_before)
  OR (SELECT proacl FROM pg_proc WHERE oid='public.custodial_release_canary_authority_surface()'::regprocedure)
   IS DISTINCT FROM (SELECT proacl FROM cancel_target_surface_before) THEN
  RAISE EXCEPTION 'Cancellation target canary owner/ACL changed';END IF;
END $canary$;

ALTER TABLE public.custodial_release_authority_restore_inventory DISABLE TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
DO $recovery$ DECLARE target regprocedure;changed integer;BEGIN
 FOREACH target IN ARRAY ARRAY['public.static_weekly_v3_read_manager_snapshot(date)'::regprocedure,
  'public.custodial_release_canary_authority_surface()'::regprocedure] LOOP
  UPDATE public.custodial_release_authority_restore_inventory i SET definition_sql=pg_get_functiondef(target),
   definition_sha256=public.static_weekly_digest_text(pg_get_functiondef(target)),captured_at=statement_timestamp()
   WHERE i.object_kind='function' AND i.object_identity LIKE '%(%' AND to_regprocedure(i.object_identity)=target
    AND i.definition_sql=(SELECT old.definition_sql FROM cancel_target_inventory_before old WHERE old.inventory_id=i.inventory_id);
  GET DIAGNOSTICS changed=ROW_COUNT;IF changed<>1 THEN RAISE EXCEPTION 'Cancellation target exact recovery row missing/duplicated';END IF;
 END LOOP;
END $recovery$;
ALTER TABLE public.custodial_release_authority_restore_inventory ENABLE ALWAYS TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
DO $scope$ BEGIN
 IF (SELECT count(*) FROM public.custodial_release_authority_restore_inventory)<>(SELECT count(*) FROM cancel_target_inventory_before)
  OR EXISTS(SELECT old.* FROM cancel_target_inventory_before old WHERE NOT(old.object_kind='function' AND old.object_identity LIKE '%(%'
   AND to_regprocedure(old.object_identity) IN('public.static_weekly_v3_read_manager_snapshot(date)'::regprocedure,
    'public.custodial_release_canary_authority_surface()'::regprocedure)) EXCEPT SELECT * FROM public.custodial_release_authority_restore_inventory)
  OR EXISTS(SELECT now.* FROM public.custodial_release_authority_restore_inventory now WHERE NOT(now.object_kind='function' AND now.object_identity LIKE '%(%'
   AND to_regprocedure(now.object_identity) IN('public.static_weekly_v3_read_manager_snapshot(date)'::regprocedure,
    'public.custodial_release_canary_authority_surface()'::regprocedure)) EXCEPT SELECT * FROM cancel_target_inventory_before)
  OR EXISTS(SELECT 1 FROM public.custodial_release_authority_restore_inventory i WHERE i.object_kind='grant' AND i.object_identity LIKE '%(%'
   AND to_regprocedure(i.object_identity)='public.static_weekly_v3_read_manager_snapshot(date)'::regprocedure
   AND i.definition_sql IS DISTINCT FROM public.custodial_release_authority_current_grant_definition(i.object_identity))
  OR (SELECT count(*) FROM public.custodial_release_canary_authority_surface() WHERE object_kind IN('function','grant')
   AND object_identity LIKE '%(%' AND to_regprocedure(object_identity)='public.static_weekly_v3_read_manager_snapshot(date)'::regprocedure)<>2
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.custodial_release_authority_restore_inventory'::regclass
   AND tgname='trg_custodial_release_authority_restore_inventory_immutable' AND tgenabled='A')
 THEN RAISE EXCEPTION 'Cancellation target unrelated inventory/ACL/canary/final ALWAYS scope changed';END IF;
END $scope$;
COMMIT;
