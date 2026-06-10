-- Kathy east-boundary validation.
-- Healthy result: first query returns zero rows; second query shows the active
-- restriction/preference rows that enforce the route boundary.

select *
from public.sch_validate_kathy_east_boundary(current_date, current_date + 60);

select e.display_name, lg.group_code, lg.group_name, eap.preference_type, eap.active, eap.notes
from public.employee_area_preferences eap
join public.employees e on e.id = eap.employee_id
join public.location_groups lg on lg.id = eap.location_group_id
where e.display_name = 'Kathy Phelps'
  and lg.group_code in ('TROPICAL_BIRDS', 'CATHOUSE_CAFE_RESTROOMS', 'EVENT_CENTER', 'HERPETARIUM')
order by lg.group_name;

select ct.day_of_week, lg.group_code, lg.group_name, ct.owner_type, e.display_name as assigned_employee, ct.active, ct.notes
from public.coverage_templates ct
join public.location_groups lg on lg.id = ct.location_group_id
left join public.employees e on e.id = ct.assigned_employee_id
where lg.group_code in ('CATHOUSE_CAFE_RESTROOMS', 'EVENT_CENTER', 'HERPETARIUM')
  and e.display_name = 'Kathy Phelps'
  and ct.active = true;

select dsa.service_date, lg.group_code, lg.group_name, dsa.status, dsa.owner_type, e.display_name as assigned_employee, dsa.notes
from public.daily_schedule_assignments dsa
join public.location_groups lg on lg.id = dsa.location_group_id
left join public.employees e on e.id = dsa.assigned_employee_id
where dsa.service_date between current_date and current_date + 60
  and lg.group_code in ('CATHOUSE_CAFE_RESTROOMS', 'EVENT_CENTER', 'HERPETARIUM')
  and e.display_name = 'Kathy Phelps'
  and dsa.status = 'ASSIGNED';
