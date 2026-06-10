-- Validation query for the custodial operational notes policy.
-- Expected healthy result: zero rows from sch_validate_operational_schedule_rules
-- plus the required policy/preferences rows present in the follow-up checks.

select *
from public.sch_validate_operational_schedule_rules(current_date, current_date + 60);

select *
from public.sch_validate_kathy_east_boundary(current_date, current_date + 60);

select rule_code, category, active
from public.schedule_operational_notes
where rule_code in (
  'balance_primary',
  'no_same_lunch_relief',
  'gift_shops_monday_reminders_only',
  'primate_canyon_cat_country_response_only',
  'herpetarium_no_wednesday',
  'alijah_herpetarium_restriction',
  'kinnaye_route',
  'karen_route',
  'tammy_route',
  'kathy_route',
  'kathy_east_boundary',
  'preserve_primate_pavillion_key'
)
order by rule_code;
