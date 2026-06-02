-- Remove stale Michael McWright rebalance note fragments from visible schedule rows.
-- Michael is evening whole-zoo call coverage, not a normal named-location owner.

update public.daily_schedule_assignments
   set notes = btrim(regexp_replace(
                 coalesce(notes, ''),
                 '\s*9:45 restroom rebalance: moved only as needed to spread restroom load evenly\. From Michael McWright to [^.]+\.',
                 '',
                 'g'
               )),
       updated_at = now()
 where service_date >= current_date
   and notes ilike '%Michael McWright%'
   and notes ilike '%9:45 restroom rebalance%';
