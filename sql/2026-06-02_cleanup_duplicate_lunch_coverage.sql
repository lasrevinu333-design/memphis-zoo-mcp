-- Remove duplicate lunch-coverage rows created while repairing incremental lunch coverage.
-- Keeps the newest row for the same service date, location group, and lunch window.

WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY service_date, location_group_id, coverage_start, coverage_end, coverage_purpose
      ORDER BY created_at DESC NULLS LAST, updated_at DESC NULLS LAST, id DESC
    ) AS rn
  FROM public.daily_schedule_assignments
  WHERE service_date = '2026-06-02'::date
    AND coverage_purpose = 'lunch_coverage'
)
DELETE FROM public.daily_schedule_assignments dsa
USING ranked r
WHERE dsa.id = r.id
  AND r.rn > 1;
