begin;

insert into public.system_settings(setting_key,setting_value,description,updated_at)
values
  (
    'inspection_policy_mode',
    to_jsonb('manager_spot_check'::text),
    'Manager inspections are discretionary spot checks. There is no per-session quota and days without an inspection are not failures.',
    now()
  ),
  (
    'inspection_coverage_target_pct',
    '0'::jsonb,
    'Informational only. Inspection coverage has no minimum percentage because managers perform discretionary spot checks.',
    now()
  )
on conflict(setting_key) do update
set setting_value=excluded.setting_value,
    description=excluded.description,
    updated_at=now();

commit;
