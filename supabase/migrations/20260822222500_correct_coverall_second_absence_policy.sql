-- Memphis Zoo operational policy: zoo staff share the first absence; the
-- second and every later absence activate contractor capacity. This narrow RPC
-- supersedes the legacy generic schedule-command branch without granting any
-- new caller or allowing arbitrary assignment selection.

begin;

create or replace function public.app_apply_coverall_assignment_policy_v2(
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'extensions'
as $function$
declare
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_coverage jsonb;
  v_capacity jsonb;
  v_assignments jsonb;
  v_item jsonb;
  v_date date;
  v_coverall_capacity_employee_id uuid;
  v_absent_employee_id uuid;
  v_internal_ids uuid[];
  v_coverall_absent_ids uuid[];
  v_covered_absent_ids uuid[] := '{}'::uuid[];
  v_capacity_employee_ids uuid[] := '{}'::uuid[];
  v_assignment_count integer := 0;
  v_preserved_count integer := 0;
  v_updated_count integer := 0;
  v_assignment_id uuid;
  v_current_source_type text;
  v_current_status text;
begin
  if jsonb_typeof(v_payload) <> 'object' then
    raise exception using errcode='22023', message='CoverAll policy payload must be an object';
  end if;
  begin
    v_date := (v_payload->>'service_date')::date;
    v_internal_ids := coalesce(array(
      select value::uuid from jsonb_array_elements_text(coalesce(v_payload->'internally_redistributed_employee_ids','[]'::jsonb))
    ), '{}'::uuid[]);
    v_coverall_absent_ids := coalesce(array(
      select value::uuid from jsonb_array_elements_text(coalesce(v_payload->'coverall_absent_employee_ids','[]'::jsonb))
    ), '{}'::uuid[]);
  exception when others then
    raise exception using errcode='22023', message='CoverAll policy requires a valid service date and absence identities';
  end;
  v_coverage := coalesce(v_payload->'coverage', '[]'::jsonb);
  if jsonb_typeof(v_coverage) <> 'array' then
    raise exception using errcode='22023', message='CoverAll coverage must be an array';
  end if;
  if cardinality(v_internal_ids) <> 1 or cardinality(v_coverall_absent_ids) < 1
     or v_internal_ids[1] = any(v_coverall_absent_ids)
     or v_date is null
     or cardinality(v_coverall_absent_ids) <> (select count(distinct value) from unnest(v_coverall_absent_ids) value)
     or jsonb_array_length(v_coverage) <> cardinality(v_coverall_absent_ids) then
    raise exception using errcode='22023', message='First-absence redistribution and second-or-later CoverAll identities are required';
  end if;

  for v_capacity in select value from jsonb_array_elements(v_coverage) loop
    if jsonb_typeof(v_capacity) <> 'object'
       or (select count(*) from jsonb_object_keys(v_capacity)) <> 3
       or not (v_capacity ?& array['absent_employee_id','coverall_capacity_employee_id','assignments']) then
      raise exception using errcode='22023', message='Each CoverAll capacity entry requires one absent employee, one contractor slot, and its assignments';
    end if;
    begin
      v_absent_employee_id := (v_capacity->>'absent_employee_id')::uuid;
      v_coverall_capacity_employee_id := (v_capacity->>'coverall_capacity_employee_id')::uuid;
    exception when others then
      raise exception using errcode='22023', message='CoverAll capacity identities must be UUIDs';
    end;
    if v_absent_employee_id <> all(v_coverall_absent_ids)
       or v_absent_employee_id = any(v_covered_absent_ids)
       or v_coverall_capacity_employee_id = any(v_capacity_employee_ids)
       or not exists (
         select 1 from public.employees e
         where e.id=v_coverall_capacity_employee_id and e.active=true
           and coalesce(e.employee_code,'') in ('COVERALL_01','COVERALL_02','COVERALL_03','COVERALL_04')
       ) then
      raise exception using errcode='23514', message='Each second-or-later absence requires one distinct registered CoverAll contractor-capacity slot';
    end if;
    v_covered_absent_ids := array_append(v_covered_absent_ids,v_absent_employee_id);
    v_capacity_employee_ids := array_append(v_capacity_employee_ids,v_coverall_capacity_employee_id);
    v_assignments := coalesce(v_capacity->'assignments','[]'::jsonb);
    if jsonb_typeof(v_assignments) <> 'array' then
      raise exception using errcode='22023', message='CoverAll assignments must be an array';
    end if;
    for v_item in select value from jsonb_array_elements(v_assignments) loop
      if jsonb_typeof(v_item) <> 'object'
         or (select count(*) from jsonb_object_keys(v_item)) <> 5
         or not (v_item ?& array['location_group_id','segment_number','coverage_start','coverage_end','original_employee_id'])
         or coalesce(v_item->>'original_employee_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
         or (v_item->>'original_employee_id')::uuid <> v_absent_employee_id
         or coalesce(v_item->>'location_group_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
         or coalesce(v_item->>'segment_number','') !~ '^[1-9][0-9]*$'
         or coalesce(v_item->>'coverage_start','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'
         or coalesce(v_item->>'coverage_end','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'
         or (v_item->>'coverage_start')::time >= (v_item->>'coverage_end')::time
         or not exists (
           select 1 from public.coverage_templates ct
           where ct.active=true
             and ct.day_of_week=extract(dow from v_date)::integer
             and ct.location_group_id=(v_item->>'location_group_id')::uuid
             and ct.segment_number=(v_item->>'segment_number')::integer
             and ct.assigned_employee_id=v_absent_employee_id
             and ct.coverage_start=(v_item->>'coverage_start')::time
             and least(ct.coverage_end,public.sch_get_schedule_close_time(v_date))=(v_item->>'coverage_end')::time
         ) then
        raise exception using errcode='22023', message='Every CoverAll assignment must belong to its exact second-or-later absence and carry one valid bounded window';
      end if;
    end loop;
  end loop;
  if (select array_agg(value order by value) from unnest(v_covered_absent_ids) value)
     is distinct from (select array_agg(value order by value) from unnest(v_coverall_absent_ids) value) then
    raise exception using errcode='22023', message='Every second-or-later absence requires exactly one CoverAll capacity entry';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('custodial-coverall-policy-v2:'||v_date::text,0));
  for v_capacity in select value from jsonb_array_elements(v_coverage) loop
    v_coverall_capacity_employee_id := (v_capacity->>'coverall_capacity_employee_id')::uuid;
    v_assignments := v_capacity->'assignments';
    if jsonb_array_length(v_assignments) > 0 then
      insert into public.daily_work_roster(service_date,employee_id,shift_start,shift_end,source_type,notes,active,created_at,updated_at)
      select v_date,v_coverall_capacity_employee_id,min((x->>'coverage_start')::time),max((x->>'coverage_end')::time),'coverall',
        'Call CoverAll: one contractor capacity for one second-or-later absence.',true,now(),now()
      from jsonb_array_elements(v_assignments) x
      on conflict(service_date,employee_id) do update set
        shift_start=least(public.daily_work_roster.shift_start,excluded.shift_start),
        shift_end=greatest(public.daily_work_roster.shift_end,excluded.shift_end),
        active=true,updated_at=now(),notes=excluded.notes;
    end if;
    for v_item in select value from jsonb_array_elements(v_assignments) loop
      select dsa.id,dsa.source_type,dsa.status
      into v_assignment_id,v_current_source_type,v_current_status
      from public.daily_schedule_assignments dsa
      where dsa.service_date=v_date
        and dsa.location_group_id=(v_item->>'location_group_id')::uuid
        and dsa.segment_number=(v_item->>'segment_number')::integer;
      if v_assignment_id is null then
        raise exception using errcode='23514', message='The exact daily assignment derived from the absent employee template is missing';
      end if;
      if coalesce(v_current_source_type,'') ilike '%manual%'
         or coalesce(v_current_source_type,'') ilike '%manager%'
         or coalesce(v_current_source_type,'') ilike '%override%' then
        v_preserved_count := v_preserved_count + 1;
        continue;
      end if;
      if v_current_status not in ('ASSIGNED','OPEN') then
        raise exception using errcode='23514', message='The exact daily assignment is not eligible for CoverAll transition';
      end if;
      update public.daily_schedule_assignments dsa set
        assigned_employee_id=v_coverall_capacity_employee_id,
        owner_type='EMPLOYEE',status='ASSIGNED',source_type='coverall_escalation',
        notes=trim(concat_ws(' ',nullif(dsa.notes,''),'Call CoverAll: one contractor assigned for this second-or-later custodial absence.')),
        updated_at=now()
      where dsa.id=v_assignment_id;
      get diagnostics v_updated_count = row_count;
      if v_updated_count <> 1 then
        raise exception using errcode='40001', message='The exact CoverAll transition assignment changed concurrently';
      end if;
      v_assignment_count := v_assignment_count + v_updated_count;
      v_assignment_id := null;
      v_current_source_type := null;
      v_current_status := null;
    end loop;
  end loop;
  return jsonb_build_object('ok',true,'assigned_count',v_assignment_count,'preserved_count',v_preserved_count,'capacity_count',cardinality(v_capacity_employee_ids),'policy','first_internal_second_plus_distinct_coverall');
end
$function$;

revoke all on function public.app_apply_coverall_assignment_policy_v2(jsonb) from public,anon,authenticated;
grant execute on function public.app_apply_coverall_assignment_policy_v2(jsonb) to service_role;

comment on function public.app_apply_coverall_assignment_policy_v2(jsonb) is
'Bounded transition writer: preserves the first recorded absence for internal redistribution and assigns only second-or-later absence workload to registered CoverAll capacity.';

commit;
