-- Repair future daily rows where the code-side static-owner restore overwrote lunch coverage/split rows
-- with Michael McWright before his 3 PM shift. Regenerate only the affected future dates
-- from the canonical static templates and lunch-coverage function.
select public.sch_generate_daily_schedule('2026-06-08'::date, true) as june_08_result;
select public.sch_generate_daily_schedule('2026-06-09'::date, true) as june_09_result;
