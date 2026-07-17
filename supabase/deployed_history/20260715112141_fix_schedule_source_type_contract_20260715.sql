-- Deployed migration history snapshot: 20260715112141 fix_schedule_source_type_contract_20260715

drop function if exists public.sch_get_daily_schedule_with_purpose(date);

create function public.sch_get_daily_schedule_with_purpose(p_service_date date)
returns table(
  location_group_id uuid,
  group_code text,
  group_name text,
  included_locations text[],
  segment_id uuid,
  segment_number integer,
  owner_type text,
  assigned_employee_id uuid,
  assigned_employee_name text,
  coverage_start text,
  coverage_end text,
  status text,
  load_points numeric,
  coverage_purpose text,
  notes text,
  source_type text
)
language sql
stable
set search_path = pg_catalog, public
as $function$
  select
    s.location_group_id,
    s.group_code,
    s.group_name,
    s.included_locations,
    s.segment_id,
    s.segment_number,
    s.owner_type,
    s.assigned_employee_id,
    s.assigned_employee_name,
    s.coverage_start,
    s.coverage_end,
    s.status,
    s.load_points,
    coalesce(
      dsa.coverage_purpose,
      ct.coverage_purpose,
      case
        when s.group_code in ('ELEPHANT_TRUNK_GIFT_SHOP','ELEPHANT_TRUNK_RESTROOMS','BAMBOO_GIFT_SHOP','NORTH_WEST_PASSAGE_GIFT_SHOP') then 'reminder'
        when s.assigned_employee_name = 'Michael McWright' then 'late_coverage'
        when s.coverage_start::time < time '09:45' then 'deep_clean'
        else 'area_owner'
      end
    ) as coverage_purpose,
    s.notes,
    coalesce(
      nullif(btrim(dsa.source_type), ''),
      case when ct.id is not null then 'coverage_template' else 'schedule' end
    ) as source_type
  from public.sch_get_daily_schedule(p_service_date) s
  left join public.daily_schedule_assignments dsa on dsa.id = s.segment_id
  left join public.coverage_templates ct on ct.id = s.segment_id;
$function$;

revoke all on function public.sch_get_daily_schedule_with_purpose(date) from public, anon, authenticated;
grant execute on function public.sch_get_daily_schedule_with_purpose(date) to service_role;
