-- CUMULATIVE v2 SOURCE-ONLY FORWARD PROPOSAL. Replaces v1; NEVER apply both.
-- Not a migration, activation or execution receipt. Same qualified v1 body.
-- Candidate over backend a97ad09179f7bab4bcdbf77f47d16074e179b3b6; canonical286 f8634d69.
-- Retained original predecessor Source is unchanged from backend 59be253f.
-- Main correction after v159 actual refusal: the original inventory has TWO
-- known noninternal triggers, including its separate application-mutation
-- fence. Require both exact Source guards, never disable/remove that fence.
-- Current predecessor includes 20261003140000 nonemployee-capacity replacement;
-- it is NOT the unmodified August initializer. Preserve that typed branch.
-- Native definition/owner/ACL evidence: unchanged c2ca UNIT archive v109,
-- inventory/source-catalog.json + application-schema.sql and original registry DATA.
-- Only the original creator may replace this one routine and register its exact
-- successor in the ONE original FUNCTION row. No grant/canary/other row changes.
-- Fixed protocol: canonical286 20261017225101, SHA256
-- 2526dde3e55268da83ba43c8ce30c61c5f1a8c83df50aae85d557c517c383418.
-- BEFORE definition da1cb4243732c913b18123d9ff7e6f035c4d523a39753aac89ce4bcdf1d52757; prosrc 1c1f44a9f3bcf2f223425cfc70e061d98f7f487c0b31534e5a315c2a549aeecb
-- AFTER  definition f08a357f5391b68a28c80dc9876d342b2e26d7e7755fbb236509bb3c9d78eca7; prosrc ef0cd45509fb683b03285c4d1c869ac2fd39d984338a2cb1eb36bca2f20194de
-- Main must qualify initialization, exact replay, denied declarations and the
-- full dated-pending owning path in protected SQL before any admission claim.
BEGIN;
SET LOCAL search_path=pg_catalog,public;
DO $registered_never_filled_vacancy$
DECLARE
  function_oid oid;
  owner_oid oid;
  postgres_oid oid;
  release_oid oid;
  original pg_catalog.pg_proc;
  observed pg_catalog.pg_proc;
  old_definition text;
  new_definition text;
  new_body text;
  old_comment text;
  inventory_before jsonb;
  inventory_after jsonb;
  inventory_rows_before public.custodial_release_authority_restore_inventory[];
  function_inventory public.custodial_release_authority_restore_inventory;
  grant_inventory public.custodial_release_authority_restore_inventory;
  registered_inventory public.custodial_release_authority_restore_inventory;
  inventory_relation_oid oid;
  inventory_relation_before pg_catalog.pg_class;
  inventory_relation_after pg_catalog.pg_class;
  inventory_guard_before pg_catalog.pg_proc;
  inventory_guard_after pg_catalog.pg_proc;
  inventory_trigger_before pg_catalog.pg_trigger;
  inventory_trigger_after pg_catalog.pg_trigger;
  mutation_guard_before pg_catalog.pg_proc;
  mutation_guard_after pg_catalog.pg_proc;
  inventory_triggers_before pg_catalog.pg_trigger[];
  inventory_triggers_after pg_catalog.pg_trigger[];
  inventory_columns_before pg_catalog.pg_attribute[];
  inventory_columns_after pg_catalog.pg_attribute[];
  inventory_policies_before pg_catalog.pg_policy[];
  inventory_policies_after pg_catalog.pg_policy[];
  canary_before pg_catalog.pg_proc;
  canary_after pg_catalog.pg_proc;
  canary_definition text;
  registration_time timestamptz;
  changed integer;
  source_search_path text:=pg_catalog.current_setting('search_path');
  canonical_trigger_before text;
  canonical_trigger_after text;
  canonical_mutation_fence_before text;
  canonical_mutation_fence_after text;
  guard_definition constant text:=$original_inventory_guard_definition$CREATE OR REPLACE FUNCTION public.custodial_reject_release_authority_inventory_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  raise exception using errcode='55000',message='release authority restore inventory is immutable';
end
$function$
$original_inventory_guard_definition$;
  trigger_definition constant text:=$original_inventory_trigger_definition$CREATE TRIGGER trg_custodial_release_authority_restore_inventory_immutable BEFORE DELETE OR UPDATE ON public.custodial_release_authority_restore_inventory FOR EACH ROW EXECUTE FUNCTION public.custodial_reject_release_authority_inventory_mutation()$original_inventory_trigger_definition$;
  mutation_fence_definition constant text:=$original_mutation_fence$CREATE TRIGGER custodial_disaster_restore_mutation_fence BEFORE INSERT OR DELETE OR UPDATE OR TRUNCATE ON public.custodial_release_authority_restore_inventory FOR EACH STATEMENT EXECUTE FUNCTION custodial_dr.guard_application_mutation()$original_mutation_fence$;
  mutation_guard_body constant text:=$original_mutation_guard_body$
begin
  perform custodial_dr.acquire_application_mutation_fence();
  return null;
end
$original_mutation_guard_body$;
  original_definition constant text:=$original_initializer$CREATE OR REPLACE FUNCTION public.static_weekly_v6_initialize_registered_roster(p_source_id uuid, p_manager_id uuid, p_configured_by text DEFAULT 'production-manager'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_source jsonb;
  v_slots jsonb;
  v_slot jsonb;
  v_incumbencies jsonb;
  v_incumbent jsonb;
  v_actor jsonb;
  v_slot_id uuid;
  v_person_id uuid;
  v_effective_start date;
  v_effective_end date;
  v_slot_code text;
  v_expected_slots integer:=0;
  v_expected_incumbencies integer:=0;
  v_existing_slots integer:=0;
  v_existing_incumbencies integer:=0;
  v_mismatch boolean:=false;
begin
  perform public.static_weekly_v3_assert_release_operator();
  perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-initial-roster',0));
  v_actor:=public.static_weekly_v3_manager_actor(p_manager_id);
  if p_source_id is null or nullif(btrim(coalesce(p_configured_by,'')),'') is null or length(p_configured_by)>200 then
    raise exception using errcode='22023',message='registered roster bootstrap requires a source, named manager, and bounded release owner';
  end if;

  select canonical_source into v_source
  from public.static_weekly_authority_source_documents
  where source_id=p_source_id and active=true and retired_at is null
  for share;
  if not found then
    raise exception using errcode='23514',message='registered roster bootstrap requires one active immutable authority source';
  end if;
  v_slots:=v_source->'slots';
  if jsonb_typeof(v_slots) is distinct from 'array' or jsonb_array_length(v_slots)=0 or jsonb_array_length(v_slots)>256 then
    raise exception using errcode='23514',message='registered roster bootstrap source must contain a bounded nonempty stable-slot set';
  end if;

  -- Validate the complete registered source before deciding between initial
  -- insertion and the exact idempotent replay path.
  for v_slot in select value from jsonb_array_elements(v_slots) loop
    perform public.static_weekly_v3_assert_uuid(v_slot->'id','registered roster slot id');
    perform public.static_weekly_v3_assert_text(v_slot->'label','registered roster slot label',200);
    v_incumbencies:=v_slot->'incumbencies';
    if v_slot->>'kind'='CONTRACTOR_CAPACITY' then perform public.static_weekly_capacity_assert_shape(v_slot); end if;
    if jsonb_typeof(v_incumbencies) is distinct from 'array'
      or (jsonb_array_length(v_incumbencies)=0 and v_slot->>'kind' is distinct from 'CONTRACTOR_CAPACITY')
      or jsonb_array_length(v_incumbencies)>64 then
      raise exception using errcode='23514',message='each registered roster slot requires bounded immutable incumbency history';
    end if;
    v_expected_slots:=v_expected_slots+1;
    for v_incumbent in select value from jsonb_array_elements(v_incumbencies) loop
      perform public.static_weekly_v3_assert_uuid(v_incumbent->'personId','registered roster incumbent person id');
      perform public.static_weekly_v3_assert_text(v_incumbent->'displayName','registered roster incumbent name',200);
      perform public.static_weekly_v3_assert_text(v_incumbent->'effectiveStart','registered roster effective start',10);
      if (v_incumbent->>'effectiveStart') !~ '^\d{4}-\d{2}-\d{2}$' then
        raise exception using errcode='23514',message='registered roster effective start must be YYYY-MM-DD';
      end if;
      v_effective_start:=(v_incumbent->>'effectiveStart')::date;
      v_effective_end:=null;
      if nullif(v_incumbent->>'effectiveEnd','') is not null then
        if (v_incumbent->>'effectiveEnd') !~ '^\d{4}-\d{2}-\d{2}$' then
          raise exception using errcode='23514',message='registered roster effective end must be YYYY-MM-DD or null';
        end if;
        v_effective_end:=(v_incumbent->>'effectiveEnd')::date;
        if v_effective_end<=v_effective_start then
          raise exception using errcode='23514',message='registered roster incumbency end must follow its start';
        end if;
      end if;
      v_expected_incumbencies:=v_expected_incumbencies+1;
    end loop;
  end loop;
  if v_expected_slots<>(select count(distinct value->>'id') from jsonb_array_elements(v_slots)) then
    raise exception using errcode='23514',message='registered roster source contains duplicate stable-slot identities';
  end if;

  select count(*) into v_existing_slots from public.weekly_roster_slots;
  select count(*) into v_existing_incumbencies from public.weekly_roster_slot_incumbencies;
  if v_existing_slots<>0 or v_existing_incumbencies<>0 then
    if v_existing_slots<>v_expected_slots or v_existing_incumbencies<>v_expected_incumbencies then
      raise exception using errcode='23514',message='registered roster bootstrap refuses partial or unrelated existing roster state';
    end if;
    for v_slot in select value from jsonb_array_elements(v_slots) loop
      v_slot_id:=(v_slot->>'id')::uuid;
      v_slot_code:='STATIC_'||upper(replace(v_slot_id::text,'-',''));
      if not exists(
        select 1 from public.weekly_roster_slots s
        where s.slot_id=v_slot_id and s.slot_code=v_slot_code and s.slot_label=v_slot->>'label'
      ) then v_mismatch:=true; exit; end if;
      if v_slot->>'kind'='CONTRACTOR_CAPACITY' and not public.static_weekly_capacity_registered(v_slot) then v_mismatch:=true; exit; end if;
      for v_incumbent in select value from jsonb_array_elements(v_slot->'incumbencies') loop
        v_person_id:=(v_incumbent->>'personId')::uuid;
        v_effective_start:=(v_incumbent->>'effectiveStart')::date;
        v_effective_end:=nullif(v_incumbent->>'effectiveEnd','')::date;
        if not exists(
          select 1 from public.weekly_roster_slot_incumbencies i
          where i.slot_id=v_slot_id and i.person_id=v_person_id
            and i.person_name_snapshot=v_incumbent->>'displayName'
            and i.effective_start=v_effective_start
            and i.effective_end is not distinct from v_effective_end
        ) then v_mismatch:=true; exit; end if;
      end loop;
      exit when v_mismatch;
    end loop;
    if v_mismatch then
      raise exception using errcode='23514',message='registered roster bootstrap refuses roster state that differs from the immutable source';
    end if;
    return jsonb_build_object(
      'source_id',p_source_id::text,
      'source_digest',public.static_weekly_digest_jsonb(v_source),
      'slot_count',v_expected_slots,
      'incumbency_count',v_expected_incumbencies,
      'already_initialized',true
    );
  end if;

  for v_slot in select value from jsonb_array_elements(v_slots) loop
    v_slot_id:=(v_slot->>'id')::uuid;
    v_slot_code:='STATIC_'||upper(replace(v_slot_id::text,'-',''));
    insert into public.weekly_roster_slots(
      slot_id,slot_code,slot_label,created_by_manager_id,created_by_manager_name_snapshot,content_digest
    ) values(
      v_slot_id,v_slot_code,v_slot->>'label',p_manager_id,v_actor->>'manager_name',
      public.static_weekly_digest_jsonb(jsonb_build_object(
        'source_id',p_source_id::text,'slot_id',v_slot_id::text,'slot_code',v_slot_code,'slot_label',v_slot->>'label'
      ))
    );
    if v_slot->>'kind'='CONTRACTOR_CAPACITY' then
      insert into public.static_weekly_contractor_capacity_registrations(
       capacity_slot_id,capacity_code,source_id,source_digest,slot_snapshot,slot_digest,registered_by_manager_id,manager_name_snapshot)
      values(v_slot_id,v_slot->>'label',p_source_id,public.static_weekly_digest_jsonb(v_source),v_slot,
       public.static_weekly_digest_jsonb(v_slot),p_manager_id,v_actor->>'manager_name');
    end if;
    for v_incumbent in select value from jsonb_array_elements(v_slot->'incumbencies') loop
      v_person_id:=(v_incumbent->>'personId')::uuid;
      v_effective_start:=(v_incumbent->>'effectiveStart')::date;
      v_effective_end:=nullif(v_incumbent->>'effectiveEnd','')::date;
      insert into public.weekly_roster_slot_incumbencies(
        slot_id,person_id,person_name_snapshot,effective_start,effective_end,
        created_by_manager_id,created_by_manager_name_snapshot,content_digest
      ) values(
        v_slot_id,v_person_id,v_incumbent->>'displayName',v_effective_start,v_effective_end,
        p_manager_id,v_actor->>'manager_name',
        public.static_weekly_digest_jsonb(jsonb_build_object(
          'source_id',p_source_id::text,'slot_id',v_slot_id::text,'person_id',v_person_id::text,
          'person_name_snapshot',v_incumbent->>'displayName','effective_start',v_effective_start::text,
          'effective_end',case when v_effective_end is null then null else to_jsonb(v_effective_end::text) end
        ))
      );
    end loop;
  end loop;

  return jsonb_build_object(
    'source_id',p_source_id::text,
    'source_digest',public.static_weekly_digest_jsonb(v_source),
    'slot_count',v_expected_slots,
    'incumbency_count',v_expected_incumbencies,
    'already_initialized',false,
    'configured_by',left(p_configured_by,200),
    'manager_id',p_manager_id::text,
    'manager_name',v_actor->>'manager_name'
  );
end
$function$
$original_initializer$;
  original_guard constant text:=$original_history_guard$    if jsonb_typeof(v_incumbencies) is distinct from 'array'
      or (jsonb_array_length(v_incumbencies)=0 and v_slot->>'kind' is distinct from 'CONTRACTOR_CAPACITY')
      or jsonb_array_length(v_incumbencies)>64 then
      raise exception using errcode='23514',message='each registered roster slot requires bounded immutable incumbency history';
    end if;$original_history_guard$;
  vacancy_guard constant text:=$declared_vacancy_guard$    if jsonb_typeof(v_incumbencies) is distinct from 'array' or jsonb_array_length(v_incumbencies)>64 then
      raise exception using errcode='23514',message='each registered roster slot requires bounded immutable incumbency history';
    end if;
    if jsonb_array_length(v_incumbencies)=0 and v_slot->>'kind' is distinct from 'CONTRACTOR_CAPACITY' then
      -- Only an ordinary stable slot explicitly declared vacant AND capable
      -- may have never held an incumbent. No person or history is synthesized.
      if v_slot ? 'kind' or v_slot ? 'contractorCapacity' or v_slot ? 'capacityId' then
        raise exception using errcode='23514',message='empty ordinary roster history requires an explicit stable vacancy';
      end if;
      v_vacancy_version:=null;
      if jsonb_typeof(v_source->'version')='object' and not (v_source ? 'versions') then
        v_vacancy_version:=v_source->'version';
      elsif not (v_source ? 'version') and jsonb_typeof(v_source->'versions')='array' then
        if jsonb_array_length(v_source->'versions')=1
          and jsonb_typeof(v_source->'versions'->0)='object' then
          v_vacancy_version:=v_source->'versions'->0;
        end if;
      end if;
      if v_vacancy_version is null
        or jsonb_typeof(v_vacancy_version->'vacantSlotIds') is distinct from 'array'
        or jsonb_typeof(v_vacancy_version->'vacancyCapableSlotIds') is distinct from 'array' then
        raise exception using errcode='23514',message='empty ordinary roster history requires exact vacancy declarations';
      end if;
      if jsonb_array_length(v_vacancy_version->'vacantSlotIds') not between 1 and 256
        or jsonb_array_length(v_vacancy_version->'vacancyCapableSlotIds') not between 1 and 256
        or not (v_vacancy_version->'vacantSlotIds' @> jsonb_build_array(v_slot->'id'))
        or not (v_vacancy_version->'vacancyCapableSlotIds' @> jsonb_build_array(v_slot->'id')) then
        raise exception using errcode='23514',message='empty ordinary roster history requires declared vacant and vacancy-capable identity';
      end if;
      -- Reject malformed/duplicate/foreign declarations, not just a matching
      -- substring, object key, or a caller-coerced representation.
      if exists(
        select 1 from jsonb_array_elements((v_vacancy_version->'vacantSlotIds')
          ||(v_vacancy_version->'vacancyCapableSlotIds')) entry
        where jsonb_typeof(entry) is distinct from 'string'
          or not exists(select 1 from jsonb_array_elements(v_slots) slot where slot->'id'=entry)
      ) or jsonb_array_length(v_vacancy_version->'vacantSlotIds')<>
        (select count(distinct entry) from jsonb_array_elements(v_vacancy_version->'vacantSlotIds') entry)
        or jsonb_array_length(v_vacancy_version->'vacancyCapableSlotIds')<>
        (select count(distinct entry) from jsonb_array_elements(v_vacancy_version->'vacancyCapableSlotIds') entry)
        or exists(select 1 from jsonb_array_elements(v_vacancy_version->'vacantSlotIds') entry
          where not (v_vacancy_version->'vacancyCapableSlotIds' @> jsonb_build_array(entry))) then
        raise exception using errcode='23514',message='empty ordinary roster history has malformed vacancy declarations';
      end if;
    end if;$declared_vacancy_guard$;
  original_grant constant text:=$original_initializer_grant$select public.custodial_release_authority_reset_grants('static_weekly_v6_initialize_registered_roster(uuid,uuid,text)'); grant execute on function static_weekly_v6_initialize_registered_roster(uuid,uuid,text) to postgres; grant execute on function static_weekly_v6_initialize_registered_roster(uuid,uuid,text) to static_weekly_release_operator;$original_initializer_grant$;
BEGIN
  SELECT oid INTO owner_oid FROM pg_catalog.pg_roles WHERE rolname='supabase_admin';
  SELECT oid INTO postgres_oid FROM pg_catalog.pg_roles WHERE rolname='postgres';
  SELECT oid INTO release_oid FROM pg_catalog.pg_roles WHERE rolname='static_weekly_release_operator';
  function_oid:=pg_catalog.to_regprocedure('public.static_weekly_v6_initialize_registered_roster(uuid,uuid,text)');
  IF current_user IS DISTINCT FROM session_user OR current_user<>'supabase_admin'
    OR pg_catalog.current_setting('session_replication_role')<>'origin'
    OR pg_catalog.current_setting('transaction_read_only')<>'off'
    OR owner_oid IS NULL OR postgres_oid IS NULL OR release_oid IS NULL OR function_oid IS NULL
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class
      WHERE oid=pg_catalog.to_regclass('public.custodial_release_authority_restore_inventory')
        AND relowner=owner_oid AND relkind='r' AND relpersistence='p')
  THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Registered vacancy original creator/context unavailable'; END IF;
  -- Normal canonical286 order: application fence -> weekly authority ->
  -- original roster key -> exclusive inventory. No role/permission fallback.
  PERFORM public.custodial_begin_application_mutation();
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('memphis-static-weekly-authority',0));
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('memphis-static-weekly-initial-roster',0));
  LOCK TABLE public.custodial_release_authority_restore_inventory IN ACCESS EXCLUSIVE MODE;
  SELECT * INTO STRICT original FROM pg_catalog.pg_proc WHERE oid=function_oid;
  old_definition:=pg_catalog.pg_get_functiondef(function_oid);
  old_comment:=pg_catalog.obj_description(function_oid,'pg_proc');
  IF original.proowner IS DISTINCT FROM owner_oid OR original.prokind<>'f'
    OR NOT original.prosecdef OR original.proretset OR original.pronargs<>3
    OR original.prorettype<>'pg_catalog.jsonb'::regtype
    OR original.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']::text[]
    OR old_definition IS DISTINCT FROM original_definition
    OR pg_catalog.encode(extensions.digest(pg_catalog.convert_to(old_definition,'UTF8'),'sha256'),'hex')
      IS DISTINCT FROM 'da1cb4243732c913b18123d9ff7e6f035c4d523a39753aac89ce4bcdf1d52757'
    OR pg_catalog.encode(extensions.digest(pg_catalog.convert_to(original.prosrc,'UTF8'),'sha256'),'hex')
      IS DISTINCT FROM '1c1f44a9f3bcf2f223425cfc70e061d98f7f487c0b31534e5a315c2a549aeecb'
  THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Registered vacancy exact initializer predecessor differs'; END IF;
  -- Exact captured ACL, not a survivor/default grant or privilege fallback.
  IF original.proacl IS NULL
    OR (SELECT count(*) FROM pg_catalog.aclexplode(original.proacl))<>3
    OR EXISTS(SELECT 1 FROM pg_catalog.aclexplode(original.proacl) a
      WHERE a.grantee NOT IN(owner_oid,postgres_oid,release_oid) OR a.grantor<>owner_oid
        OR a.privilege_type<>'EXECUTE' OR a.is_grantable)
    OR (SELECT count(DISTINCT grantee) FROM pg_catalog.aclexplode(original.proacl))<>3
  THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Registered vacancy original initializer ACL differs'; END IF;
  SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(r) ORDER BY r.object_kind)
    INTO inventory_before FROM public.custodial_release_authority_restore_inventory r
    WHERE r.object_identity='static_weekly_v6_initialize_registered_roster(uuid,uuid,text)'
      AND r.object_kind IN('function','grant');
  IF pg_catalog.jsonb_array_length(inventory_before) IS DISTINCT FROM 2
    OR NOT EXISTS(SELECT 1 FROM public.custodial_release_authority_restore_inventory r
      WHERE r.object_kind='function'
        AND r.object_identity='static_weekly_v6_initialize_registered_roster(uuid,uuid,text)'
        AND r.definition_sql=original_definition AND r.definition_sha256='da1cb4243732c913b18123d9ff7e6f035c4d523a39753aac89ce4bcdf1d52757')
    OR NOT EXISTS(SELECT 1 FROM public.custodial_release_authority_restore_inventory r
      WHERE r.object_kind='grant'
        AND r.object_identity='static_weekly_v6_initialize_registered_roster(uuid,uuid,text)'
        AND r.definition_sql=original_grant
        AND r.definition_sha256='ea3c432dd580cfb2222db0f24c5c963ff9c92674af45e4b18cc05b396b77bf95')
    OR pg_catalog.encode(extensions.digest(pg_catalog.convert_to(original_grant,'UTF8'),'sha256'),'hex')
      IS DISTINCT FROM 'ea3c432dd580cfb2222db0f24c5c963ff9c92674af45e4b18cc05b396b77bf95'
  THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Registered vacancy stored original function/grant inventory differs'; END IF;
  IF (pg_catalog.length(original.prosrc)-pg_catalog.length(pg_catalog.replace(original.prosrc,original_guard,'')))
      <>pg_catalog.length(original_guard)
    OR (pg_catalog.length(original.prosrc)-pg_catalog.length(pg_catalog.replace(original.prosrc,E'  v_slots jsonb;\n','')))
      <>pg_catalog.length(E'  v_slots jsonb;\n')
  THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Registered vacancy unique history replacement differs'; END IF;
  new_body:=pg_catalog.replace(pg_catalog.replace(original.prosrc,E'  v_slots jsonb;\n',
    E'  v_slots jsonb;\n  v_vacancy_version jsonb;\n'),original_guard,vacancy_guard);
  new_definition:=pg_catalog.replace(pg_catalog.replace(old_definition,E'  v_slots jsonb;\n',
    E'  v_slots jsonb;\n  v_vacancy_version jsonb;\n'),original_guard,vacancy_guard);
  IF pg_catalog.encode(extensions.digest(pg_catalog.convert_to(new_body,'UTF8'),'sha256'),'hex')
      IS DISTINCT FROM 'ef0cd45509fb683b03285c4d1c869ac2fd39d984338a2cb1eb36bca2f20194de'
    OR pg_catalog.encode(extensions.digest(pg_catalog.convert_to(new_definition,'UTF8'),'sha256'),'hex')
      IS DISTINCT FROM 'f08a357f5391b68a28c80dc9876d342b2e26d7e7755fbb236509bb3c9d78eca7'
  THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Registered vacancy fixed successor differs'; END IF;
  SELECT * INTO STRICT observed FROM pg_catalog.pg_proc WHERE oid=function_oid;
  IF pg_catalog.to_jsonb(observed) IS DISTINCT FROM pg_catalog.to_jsonb(original)
    OR pg_catalog.pg_get_functiondef(function_oid) IS DISTINCT FROM old_definition
    OR current_user IS DISTINCT FROM session_user OR current_user<>'supabase_admin'
  THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Registered vacancy predecessor changed before replacement'; END IF;

  -- BEGIN fixed cumulative recovery-registration preflight.
  -- The instance UUID/captured_at comes from its actual locked original row;
  -- object identity/order/definition are fixed to retained canonical Source.
  SELECT * INTO STRICT function_inventory FROM public.custodial_release_authority_restore_inventory
    WHERE object_kind='function'
      AND object_identity='static_weekly_v6_initialize_registered_roster(uuid,uuid,text)'
      AND restore_order=100431;
  SELECT * INTO STRICT grant_inventory FROM public.custodial_release_authority_restore_inventory
    WHERE object_kind='grant'
      AND object_identity='static_weekly_v6_initialize_registered_roster(uuid,uuid,text)'
      AND restore_order=900262;
  IF function_inventory.definition_sql IS DISTINCT FROM original_definition
    OR function_inventory.definition_sha256 IS DISTINCT FROM 'da1cb4243732c913b18123d9ff7e6f035c4d523a39753aac89ce4bcdf1d52757'
    OR grant_inventory.definition_sql IS DISTINCT FROM original_grant
    OR grant_inventory.definition_sha256 IS DISTINCT FROM 'ea3c432dd580cfb2222db0f24c5c963ff9c92674af45e4b18cc05b396b77bf95'
    OR (SELECT count(*) FROM public.custodial_release_authority_restore_inventory r
      WHERE r.object_kind IN('function','grant') AND r.object_identity LIKE '%(%'
        AND pg_catalog.to_regprocedure(r.object_identity)=function_oid)<>2
  THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Registered vacancy exact original recovery identity/order differs'; END IF;
  inventory_relation_oid:=pg_catalog.to_regclass('public.custodial_release_authority_restore_inventory');
  SELECT * INTO STRICT inventory_relation_before FROM pg_catalog.pg_class WHERE oid=inventory_relation_oid;
  SELECT * INTO STRICT inventory_trigger_before FROM pg_catalog.pg_trigger
    WHERE tgrelid=inventory_relation_oid AND tgname='trg_custodial_release_authority_restore_inventory_immutable';
  SELECT * INTO STRICT inventory_guard_before FROM pg_catalog.pg_proc WHERE oid=inventory_trigger_before.tgfoid;
  SELECT * INTO STRICT mutation_guard_before FROM pg_catalog.pg_proc
    WHERE oid=pg_catalog.to_regprocedure('custodial_dr.guard_application_mutation()');
  -- ruleutils deparses visible public names without their schema. Read these
  -- SAME catalog OIDs under a fixed narrower deparse path, then restore the
  -- normal Source binding path before any installer check or effect. This
  -- changes no permission, guard, definition, row or admitted identity.
  PERFORM pg_catalog.set_config('search_path','pg_catalog',true);
  SELECT pg_catalog.pg_get_triggerdef(inventory_trigger_before.oid,true) INTO STRICT canonical_trigger_before;
  SELECT pg_catalog.pg_get_triggerdef(t.oid,true) INTO STRICT canonical_mutation_fence_before
    FROM pg_catalog.pg_trigger t WHERE t.tgrelid=inventory_relation_oid AND t.tgname='custodial_disaster_restore_mutation_fence';
  PERFORM pg_catalog.set_config('search_path',source_search_path,true);
  IF inventory_relation_before.relowner IS DISTINCT FROM owner_oid
    OR inventory_relation_before.relkind<>'r' OR inventory_relation_before.relpersistence<>'p'
    OR inventory_relation_before.relhasrules OR inventory_relation_before.relispartition
    OR inventory_relation_before.relhassubclass
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_inherits
      WHERE inhrelid=inventory_relation_oid OR inhparent=inventory_relation_oid)
    OR inventory_relation_before.relrowsecurity OR inventory_relation_before.relforcerowsecurity
    OR inventory_trigger_before.tgfoid IS DISTINCT FROM pg_catalog.to_regprocedure('public.custodial_reject_release_authority_inventory_mutation()')
    OR inventory_trigger_before.tgtype<>27 OR inventory_trigger_before.tgenabled<>'A'
    OR inventory_trigger_before.tgisinternal OR inventory_trigger_before.tgnargs<>0
    OR pg_catalog.octet_length(inventory_trigger_before.tgargs)<>0
    OR inventory_trigger_before.tgqual IS NOT NULL OR inventory_trigger_before.tgattr::text<>''
    OR inventory_trigger_before.tgdeferrable OR inventory_trigger_before.tginitdeferred
    OR (SELECT count(*) FROM pg_catalog.pg_trigger WHERE tgrelid=inventory_relation_oid AND NOT tgisinternal)<>2
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_trigger t WHERE t.tgrelid=inventory_relation_oid
      AND t.tgname='custodial_disaster_restore_mutation_fence' AND NOT t.tgisinternal
      AND t.tgtype=62 AND t.tgenabled='O' AND t.tgfoid=mutation_guard_before.oid
      AND t.tgnargs=0 AND pg_catalog.octet_length(t.tgargs)=0 AND t.tgqual IS NULL AND t.tgattr::text=''
      AND NOT t.tgdeferrable AND NOT t.tginitdeferred
      AND canonical_mutation_fence_before=mutation_fence_definition)
    OR mutation_guard_before.proowner IS DISTINCT FROM owner_oid
    OR mutation_guard_before.prokind<>'f' OR mutation_guard_before.pronargs<>0
    OR NOT mutation_guard_before.prosecdef OR mutation_guard_before.proretset
    OR mutation_guard_before.prorettype<>'pg_catalog.trigger'::regtype
    OR mutation_guard_before.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, custodial_dr']::text[]
    OR mutation_guard_before.prosrc IS DISTINCT FROM mutation_guard_body
    OR canonical_trigger_before IS DISTINCT FROM trigger_definition
    OR inventory_guard_before.proowner IS DISTINCT FROM owner_oid
    OR inventory_guard_before.prokind<>'f' OR inventory_guard_before.pronargs<>0
    OR inventory_guard_before.prosecdef OR inventory_guard_before.proretset
    OR inventory_guard_before.prorettype<>'pg_catalog.trigger'::regtype
    OR inventory_guard_before.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']::text[]
    OR pg_catalog.pg_get_functiondef(inventory_guard_before.oid) IS DISTINCT FROM guard_definition
    OR pg_catalog.encode(extensions.digest(pg_catalog.convert_to(guard_definition,'UTF8'),'sha256'),'hex')
      IS DISTINCT FROM '7904db6a14a4c8d2b93cbe4d53ba34f68052e736d15f0a55323fa04c1fae76f6'
    OR pg_catalog.encode(extensions.digest(pg_catalog.convert_to(inventory_guard_before.prosrc,'UTF8'),'sha256'),'hex')
      IS DISTINCT FROM '398375253665aa45da0a0d73329ae907605d83ac32b00702f34ce2b730dda80b'
  THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Registered vacancy exact original ALWAYS inventory guard differs'; END IF;
  IF inventory_guard_before.proacl IS NULL
    OR (SELECT count(*) FROM pg_catalog.aclexplode(inventory_guard_before.proacl))<>2
    OR (SELECT count(DISTINCT grantee) FROM pg_catalog.aclexplode(inventory_guard_before.proacl))<>2
    OR EXISTS(SELECT 1 FROM pg_catalog.aclexplode(inventory_guard_before.proacl) a
      WHERE a.grantee NOT IN(owner_oid,postgres_oid) OR a.grantor<>owner_oid
        OR a.privilege_type<>'EXECUTE' OR a.is_grantable)
  THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Registered vacancy original inventory guard ACL differs'; END IF;
  SELECT * INTO STRICT canary_before FROM pg_catalog.pg_proc
    WHERE oid=pg_catalog.to_regprocedure('public.custodial_release_canary_authority_surface()');
  canary_definition:=pg_catalog.pg_get_functiondef(canary_before.oid);
  IF canary_before.proowner IS DISTINCT FROM owner_oid
    OR pg_catalog.encode(extensions.digest(pg_catalog.convert_to(canary_definition,'UTF8'),'sha256'),'hex')
      IS DISTINCT FROM '2c56bb3c751b6f1124dc8cd13117470dc16dd02d3b84939e88dab0a94bde93c5'
  THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Registered vacancy fixed canary Source differs'; END IF;
  -- Typed original rowsets, not JS-decoded DATA or live expected definitions.
  SELECT pg_catalog.array_agg(r ORDER BY r.inventory_id) INTO inventory_rows_before
    FROM public.custodial_release_authority_restore_inventory r;
  SELECT pg_catalog.array_agg(t ORDER BY t.oid) INTO inventory_triggers_before
    FROM pg_catalog.pg_trigger t WHERE t.tgrelid=inventory_relation_oid;
  SELECT pg_catalog.array_agg(a ORDER BY a.attnum) INTO inventory_columns_before
    FROM pg_catalog.pg_attribute a WHERE a.attrelid=inventory_relation_oid;
  SELECT pg_catalog.array_agg(p ORDER BY p.oid) INTO inventory_policies_before
    FROM pg_catalog.pg_policy p WHERE p.polrelid=inventory_relation_oid;
  -- END fixed cumulative recovery-registration preflight.
  -- The only routine replacement; still no roster/person/history/ACL edits.
  EXECUTE new_definition;
  SELECT * INTO STRICT observed FROM pg_catalog.pg_proc WHERE oid=function_oid;
  SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(r) ORDER BY r.object_kind)
    INTO inventory_after FROM public.custodial_release_authority_restore_inventory r
    WHERE r.object_identity='static_weekly_v6_initialize_registered_roster(uuid,uuid,text)'
      AND r.object_kind IN('function','grant');
  IF observed.prosrc IS DISTINCT FROM new_body
    OR pg_catalog.pg_get_functiondef(function_oid) IS DISTINCT FROM new_definition
    OR pg_catalog.to_jsonb(observed)-'prosrc' IS DISTINCT FROM pg_catalog.to_jsonb(original)-'prosrc'
    OR pg_catalog.obj_description(function_oid,'pg_proc') IS DISTINCT FROM old_comment
    OR inventory_after IS DISTINCT FROM inventory_before
  THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Registered vacancy replacement changed original metadata'; END IF;

  -- BEGIN sole fixed recovery registration. No operational/private DATA edit.
  -- Same captured-owner protocol as canonical286 dated materialization.
  -- The ACCESS EXCLUSIVE inventory lock spans both ALTERs and the one UPDATE.
  ALTER TABLE public.custodial_release_authority_restore_inventory
    DISABLE TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
  registration_time:=pg_catalog.statement_timestamp();
  UPDATE public.custodial_release_authority_restore_inventory i SET
    definition_sql=new_definition,
    definition_sha256='f08a357f5391b68a28c80dc9876d342b2e26d7e7755fbb236509bb3c9d78eca7',
    captured_at=registration_time
  WHERE i.inventory_id=function_inventory.inventory_id AND i.restore_order=100431
    AND i.object_kind='function'
    AND i.object_identity='static_weekly_v6_initialize_registered_roster(uuid,uuid,text)'
    AND i.definition_sql=original_definition
    AND i.definition_sha256='da1cb4243732c913b18123d9ff7e6f035c4d523a39753aac89ce4bcdf1d52757'
    AND pg_catalog.to_jsonb(i) IS NOT DISTINCT FROM pg_catalog.to_jsonb(function_inventory);
  GET DIAGNOSTICS changed=ROW_COUNT;
  IF changed<>1 THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Registered vacancy exact one-row recovery update refused';
  END IF;
  ALTER TABLE public.custodial_release_authority_restore_inventory
    ENABLE ALWAYS TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
  -- Any error aborts the whole transaction, including trigger suspension and
  -- routine replacement. No exception handler catches/continues this block.
  SELECT * INTO STRICT registered_inventory FROM public.custodial_release_authority_restore_inventory
    WHERE inventory_id=function_inventory.inventory_id;
  IF pg_catalog.to_jsonb(registered_inventory)-ARRAY['definition_sql','definition_sha256','captured_at']
      IS DISTINCT FROM pg_catalog.to_jsonb(function_inventory)-ARRAY['definition_sql','definition_sha256','captured_at']
    OR registered_inventory.definition_sql IS DISTINCT FROM new_definition
    OR registered_inventory.definition_sha256 IS DISTINCT FROM 'f08a357f5391b68a28c80dc9876d342b2e26d7e7755fbb236509bb3c9d78eca7'
    OR registered_inventory.captured_at IS DISTINCT FROM registration_time
    OR (SELECT count(*) FROM public.custodial_release_authority_restore_inventory)
      IS DISTINCT FROM pg_catalog.cardinality(inventory_rows_before)::bigint
    OR EXISTS(
      (SELECT old.* FROM pg_catalog.unnest(inventory_rows_before) old
        WHERE old.inventory_id<>function_inventory.inventory_id
       EXCEPT ALL SELECT live.* FROM public.custodial_release_authority_restore_inventory live
        WHERE live.inventory_id<>function_inventory.inventory_id)
      UNION ALL
      (SELECT live.* FROM public.custodial_release_authority_restore_inventory live
        WHERE live.inventory_id<>function_inventory.inventory_id
       EXCEPT ALL SELECT old.* FROM pg_catalog.unnest(inventory_rows_before) old
        WHERE old.inventory_id<>function_inventory.inventory_id))
    OR NOT EXISTS(SELECT 1 FROM public.custodial_release_authority_restore_inventory i
      WHERE i.inventory_id=grant_inventory.inventory_id
        AND pg_catalog.to_jsonb(i) IS NOT DISTINCT FROM pg_catalog.to_jsonb(grant_inventory))
  THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Registered vacancy recovery update changed unrelated original rows'; END IF;
  SELECT * INTO STRICT inventory_relation_after FROM pg_catalog.pg_class WHERE oid=inventory_relation_oid;
  SELECT * INTO STRICT inventory_trigger_after FROM pg_catalog.pg_trigger WHERE oid=inventory_trigger_before.oid;
  SELECT * INTO STRICT inventory_guard_after FROM pg_catalog.pg_proc WHERE oid=inventory_guard_before.oid;
  SELECT * INTO STRICT mutation_guard_after FROM pg_catalog.pg_proc WHERE oid=mutation_guard_before.oid;
  PERFORM pg_catalog.set_config('search_path','pg_catalog',true);
  SELECT pg_catalog.pg_get_triggerdef(inventory_trigger_after.oid,true) INTO STRICT canonical_trigger_after;
  SELECT pg_catalog.pg_get_triggerdef(t.oid,true) INTO STRICT canonical_mutation_fence_after
    FROM pg_catalog.pg_trigger t WHERE t.tgrelid=inventory_relation_oid AND t.tgname='custodial_disaster_restore_mutation_fence';
  PERFORM pg_catalog.set_config('search_path',source_search_path,true);
  SELECT * INTO STRICT canary_after FROM pg_catalog.pg_proc WHERE oid=canary_before.oid;
  SELECT pg_catalog.array_agg(t ORDER BY t.oid) INTO inventory_triggers_after
    FROM pg_catalog.pg_trigger t WHERE t.tgrelid=inventory_relation_oid;
  SELECT pg_catalog.array_agg(a ORDER BY a.attnum) INTO inventory_columns_after
    FROM pg_catalog.pg_attribute a WHERE a.attrelid=inventory_relation_oid;
  SELECT pg_catalog.array_agg(p ORDER BY p.oid) INTO inventory_policies_after
    FROM pg_catalog.pg_policy p WHERE p.polrelid=inventory_relation_oid;
  SELECT * INTO STRICT observed FROM pg_catalog.pg_proc WHERE oid=function_oid;
  IF pg_catalog.to_jsonb(inventory_relation_after) IS DISTINCT FROM pg_catalog.to_jsonb(inventory_relation_before)
    OR pg_catalog.to_jsonb(inventory_trigger_after) IS DISTINCT FROM pg_catalog.to_jsonb(inventory_trigger_before)
    OR inventory_trigger_after.tgenabled<>'A'
    OR canonical_trigger_after IS DISTINCT FROM trigger_definition
    OR canonical_mutation_fence_after IS DISTINCT FROM mutation_fence_definition
    OR pg_catalog.to_jsonb(inventory_triggers_after) IS DISTINCT FROM pg_catalog.to_jsonb(inventory_triggers_before)
    OR pg_catalog.to_jsonb(inventory_columns_after) IS DISTINCT FROM pg_catalog.to_jsonb(inventory_columns_before)
    OR pg_catalog.to_jsonb(inventory_policies_after) IS DISTINCT FROM pg_catalog.to_jsonb(inventory_policies_before)
    OR pg_catalog.to_jsonb(inventory_guard_after) IS DISTINCT FROM pg_catalog.to_jsonb(inventory_guard_before)
    OR pg_catalog.pg_get_functiondef(inventory_guard_after.oid) IS DISTINCT FROM guard_definition
    OR pg_catalog.to_jsonb(mutation_guard_after) IS DISTINCT FROM pg_catalog.to_jsonb(mutation_guard_before)
    OR pg_catalog.to_jsonb(canary_after) IS DISTINCT FROM pg_catalog.to_jsonb(canary_before)
    OR pg_catalog.pg_get_functiondef(canary_after.oid) IS DISTINCT FROM canary_definition
    OR observed.prosrc IS DISTINCT FROM new_body
    OR pg_catalog.pg_get_functiondef(function_oid) IS DISTINCT FROM new_definition
    OR pg_catalog.to_jsonb(observed)-'prosrc' IS DISTINCT FROM pg_catalog.to_jsonb(original)-'prosrc'
    OR pg_catalog.obj_description(function_oid,'pg_proc') IS DISTINCT FROM old_comment
    OR current_user IS DISTINCT FROM session_user OR current_user<>'supabase_admin'
    OR pg_catalog.current_setting('session_replication_role')<>'origin'
    OR pg_catalog.current_setting('search_path') IS DISTINCT FROM source_search_path
  THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Registered vacancy final original Source security or ALWAYS state differs'; END IF;
  -- END sole fixed recovery registration.
END;
$registered_never_filled_vacancy$;
COMMIT;


