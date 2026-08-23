-- Hydrate the immutable stable-roster identity from one release-registered
-- recurring source.  The release operator supplies only the registered source
-- UUID and an active named manager; caller-authored roster content is never
-- accepted.

create or replace function public.static_weekly_v6_initialize_registered_roster(
  p_source_id uuid,
  p_manager_id uuid,
  p_configured_by text default 'production-manager'
)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public
as $function$
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
    if jsonb_typeof(v_incumbencies) is distinct from 'array' or jsonb_array_length(v_incumbencies)=0 or jsonb_array_length(v_incumbencies)>64 then
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
$function$;

revoke all on function public.static_weekly_v6_initialize_registered_roster(uuid,uuid,text)
from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator;
grant execute on function public.static_weekly_v6_initialize_registered_roster(uuid,uuid,text)
to static_weekly_release_operator;
