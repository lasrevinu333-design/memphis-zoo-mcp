-- Restore Michael McWright's device-facing afternoon/all-location ownership templates.
-- Previous migration overcorrected for paper-printout needs by deactivating these rows.
-- Keep pre-existing inactive/out-of-scope rows inactive; only restore rows carrying the 2026-06-02 marker.

update public.coverage_templates ct
   set active = true,
       notes = btrim(replace(
         coalesce(ct.notes, ''),
         ' Deactivated 2026-06-02: Michael is evening whole-zoo call coverage; named evening tasks will move to Evening Shift page/task list.',
         ''
       )),
       updated_at = now()
  from public.employees e
 where e.id = ct.assigned_employee_id
   and e.display_name = 'Michael McWright'
   and e.employee_code = 'EMP002'
   and ct.coverage_purpose = 'late_coverage'
   and ct.active = false
   and coalesce(ct.notes, '') like '%Deactivated 2026-06-02: Michael is evening whole-zoo call coverage%';
