-- Read-only postcheck for the daily NFC scan-tracked Primate Pavillion group.
-- Safety: this file intentionally contains only SELECT statements. Do not insert,
-- update, delete, rename, create, or otherwise mutate production data from here.

select
  lg.id as location_group_id,
  lg.group_code,
  lg.group_name,
  lg.active as group_active,
  count(l.id) filter (where l.active = true) as active_nfc_location_count,
  coalesce(
    array_agg(l.location_name order by l.sort_order nulls last, l.location_name)
      filter (where l.id is not null and l.active = true),
    array[]::text[]
  ) as active_nfc_locations
from public.location_groups lg
left join public.location_group_memberships lgm
  on lgm.location_group_id = lg.id
  and lgm.active = true
left join public.locations l
  on l.id = lgm.location_id
where lg.active = true
  and (
    upper(lg.group_code) in ('PRIMATE_PAVILLION', 'PRIMATE PAVILLION', 'PRIMATE_PAVILION', 'PRIMATE PAVILION')
    or upper(lg.group_name) in ('PRIMATE PAVILLION', 'PRIMATE PAVILION')
  )
group by lg.id, lg.group_code, lg.group_name, lg.active
order by lg.group_name, lg.group_code;

select
  case
    when exists (
      select 1
      from public.location_groups lg
      join public.location_group_memberships lgm
        on lgm.location_group_id = lg.id
        and lgm.active = true
      join public.locations l
        on l.id = lgm.location_id
        and l.active = true
      where lg.active = true
        and (
          upper(lg.group_code) in ('PRIMATE_PAVILLION', 'PRIMATE PAVILLION', 'PRIMATE_PAVILION', 'PRIMATE PAVILION')
          or upper(lg.group_name) in ('PRIMATE PAVILLION', 'PRIMATE PAVILION')
        )
    ) then 'OK_SCAN_TRACKED'
    when exists (
      select 1
      from public.location_groups lg
      where lg.active = true
        and (
          upper(lg.group_code) in ('PRIMATE_PAVILLION', 'PRIMATE PAVILLION', 'PRIMATE_PAVILION', 'PRIMATE PAVILION')
          or upper(lg.group_name) in ('PRIMATE PAVILLION', 'PRIMATE PAVILION')
        )
    ) then 'ERROR_SCAN_TRACKED_EMPTY'
    else 'ERROR_SCAN_TRACKED_MISSING'
  end as primate_pavillion_daily_nfc_status;
