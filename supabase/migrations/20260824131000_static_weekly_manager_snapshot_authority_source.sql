-- Keep manager roster truth bound to the authoritative compiler input after
-- the memory-bounded adapter removes the redundant full semantic source copy.
begin;

create or replace function public.static_weekly_v3_read_manager_snapshot_base(p_week_start date)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public
as $function$
declare
  v_revision bigint;
  v_effective_version_id uuid;
  v_publication_id uuid;
  v_draft_version_id uuid;
  v_display_version_id uuid;
  v_sources jsonb;
  v_current_publication jsonb;
  v_drafts jsonb;
  v_display_version jsonb;
  v_roster jsonb;
  v_availability jsonb;
  v_assignments jsonb;
  v_exceptions jsonb := '[]'::jsonb;
  v_projection jsonb;
begin
  perform public.static_weekly_v3_assert_control_plane();
  if p_week_start is null or extract(isodow from p_week_start)<>1 then
    raise exception using errcode='22023',message='manager scheduler snapshot week_start must be a Monday';
  end if;

  select current_revision into v_revision
  from public.static_weekly_schedule_control
  where singleton;

  v_effective_version_id:=public.static_weekly_effective_version(p_week_start);
  if v_effective_version_id is not null then
    select publication_id into v_publication_id
    from public.weekly_schedule_publications
    where version_id=v_effective_version_id;
  end if;

  select version_id into v_draft_version_id
  from public.weekly_schedule_versions
  where lifecycle_state='draft' and effective_start=p_week_start
  order by created_at desc,version_id desc
  limit 1;

  v_display_version_id:=coalesce(v_draft_version_id,v_effective_version_id);

  select coalesce(jsonb_agg(jsonb_build_object(
    'source_id',source_id::text,
    'source_digest',source_digest,
    'configured_at',configured_at,
    'configured_by',configured_by,
    'slot_count',jsonb_array_length(canonical_source->'slots')
  ) order by configured_at desc,source_id),'[]'::jsonb) into v_sources
  from public.static_weekly_authority_source_documents
  where active=true and retired_at is null;

  if v_publication_id is not null then
    select jsonb_build_object(
      'publication_id',p.publication_id::text,
      'version_id',p.version_id::text,
      'version_number',v.version_number,
      'version_revision',v.revision,
      'authority_source_id',v.authority_source_id::text,
      'publication_kind',p.publication_kind,
      'effective_start',p.effective_start::text,
      'published_at',p.published_at,
      'published_by_manager_id',p.actor_manager_id::text,
      'published_by_manager_name',p.actor_manager_name_snapshot,
      'authority_revision',p.authority_revision
    ) into v_current_publication
    from public.weekly_schedule_publications p
    join public.weekly_schedule_versions v on v.version_id=p.version_id
    where p.publication_id=v_publication_id;

    v_exceptions:=public.static_weekly_compiler_exception_set(v_publication_id,p_week_start);

    select jsonb_build_object(
      'projection_id',projection_id::text,
      'publication_id',publication_id::text,
      'version_id',version_id::text,
      'week_start',week_start::text,
      'week_end',week_end::text,
      'compiler_version',compiler_version,
      'metrics',metrics_json,
      'replay_digest',replay_digest,
      'compiled_at',compiled_at,
      'assignments',projection_envelope->'assignments'
    ) into v_projection
    from public.weekly_schedule_compiled_projections
    where publication_id=v_publication_id
      and week_start=p_week_start
      and exception_set_digest=public.static_weekly_digest_jsonb(
        public.static_weekly_accepted_exception_set(v_publication_id,p_week_start)
      )
    order by compiled_at desc,projection_id desc
    limit 1;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'version_id',version_id::text,
    'revision',revision,
    'authority_source_id',authority_source_id::text,
    'effective_start',effective_start::text,
    'created_at',created_at,
    'created_by_manager_id',created_by_manager_id::text,
    'created_by_manager_name',created_by_manager_name_snapshot,
    'compiler_version',objective_version,
    'objective',objective_json,
    'validation',draft_document->'validation'
  ) order by created_at desc,version_id desc),'[]'::jsonb) into v_drafts
  from public.weekly_schedule_versions
  where lifecycle_state='draft' and effective_start=p_week_start;

  if v_display_version_id is not null then
    select jsonb_build_object(
      'version_id',version_id::text,
      'lifecycle_state',lifecycle_state,
      'version_number',version_number,
      'revision',revision,
      'authority_source_id',authority_source_id::text,
      'effective_start',effective_start::text,
      'created_at',created_at,
      'created_by_manager_id',created_by_manager_id::text,
      'created_by_manager_name',created_by_manager_name_snapshot,
      'compiler_version',objective_version,
      'objective',objective_json,
      'validation',draft_document->'validation'
    ) into v_display_version
    from public.weekly_schedule_versions
    where version_id=v_display_version_id;

    select coalesce(jsonb_agg(jsonb_build_object(
      'slot_id',slot_id::text,
      'day_of_week',day_of_week,
      'availability_state',availability_state,
      'shift_start',case when shift_start is null then null else to_char(shift_start,'HH24:MI') end,
      'shift_end',case when shift_end is null then null else to_char(shift_end,'HH24:MI') end,
      'lunch_start',case when lunch_start is null then null else to_char(lunch_start,'HH24:MI') end,
      'lunch_end',case when lunch_end is null then null else to_char(lunch_end,'HH24:MI') end,
      'capacity_units',capacity_units,
      'max_load_points',max_load_points,
      'slot_label',slot_label_snapshot,
      'person_id',incumbent_person_id_snapshot::text,
      'person_name',incumbent_name_snapshot
    ) order by day_of_week,slot_label_snapshot,slot_id),'[]'::jsonb) into v_availability
    from public.weekly_schedule_slot_availability
    where version_id=v_display_version_id;

    select coalesce(jsonb_agg(jsonb_build_object(
      'assignment_id',assignment_id::text,
      'work_id',work_id,
      'day_of_week',day_of_week,
      'status',status,
      'location_id',location_id::text,
      'location_code',location_code_snapshot,
      'location_name',location_name_snapshot,
      'coverage_start',to_char(coverage_start,'HH24:MI'),
      'coverage_end',to_char(coverage_end,'HH24:MI'),
      'owner_slot_id',owner_slot_id::text,
      'owner_slot_label',owner_slot_label_snapshot,
      'owner_person_id',owner_person_id_snapshot::text,
      'owner_name',owner_name_snapshot,
      'workload_points',workload_points,
      'manual_lock',manual_lock,
      'work',payload_json,
      'explanation',authority_facts_json
    ) order by day_of_week,coverage_start,location_name_snapshot,work_id),'[]'::jsonb) into v_assignments
    from public.weekly_schedule_slot_assignments
    where version_id=v_display_version_id;
  else
    v_availability:='[]'::jsonb;
    v_assignments:='[]'::jsonb;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'slot_id',s.slot_id::text,
    'slot_code',s.slot_code,
    'slot_label',s.slot_label,
    'contractor_capacity',coalesce((
      select lower(slot->>'contractorCapacity')='true'
      from public.weekly_schedule_versions v
      cross join lateral jsonb_array_elements(v.draft_document#>'{authority,compilerInput,slots}') slot
      where v.version_id=v_display_version_id and slot->>'id'=s.slot_id::text
      limit 1
    ),false),
    'incumbencies',coalesce((
      select jsonb_agg(jsonb_build_object(
        'person_id',r.person_id::text,
        'person_name',r.person_name_snapshot,
        'effective_start',r.effective_start::text,
        'effective_end',case when r.effective_end is null then null else r.effective_end::text end
      ) order by r.effective_start,r.incumbency_id)
      from public.v_weekly_roster_slot_incumbency_ranges r
      where r.slot_id=s.slot_id
        and r.effective_start<=p_week_start+6
        and (r.effective_end is null or r.effective_end>p_week_start)
    ),'[]'::jsonb)
  ) order by s.slot_label,s.slot_id),'[]'::jsonb) into v_roster
  from public.weekly_roster_slots s;

  return jsonb_build_object(
    'schema','memphis-zoo.static-weekly-manager-snapshot.v1',
    'week_start',p_week_start::text,
    'week_end',(p_week_start+6)::text,
    'authority_revision',v_revision,
    'sources',v_sources,
    'current_publication',v_current_publication,
    'drafts',v_drafts,
    'display_version',v_display_version,
    'roster',v_roster,
    'availability',v_availability,
    'assignments',v_assignments,
    'exceptions',v_exceptions,
    'latest_projection',v_projection
  );
end
$function$;

revoke all on function public.static_weekly_v3_read_manager_snapshot_base(date)
from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator;

comment on function public.static_weekly_v3_read_manager_snapshot_base(date) is
'One read-only Monday-aligned manager snapshot whose contractor-capacity truth is derived from the attested compiler authority instead of a redundant semantic source copy.';

commit;
