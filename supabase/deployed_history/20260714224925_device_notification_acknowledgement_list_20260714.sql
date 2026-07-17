-- Deployed migration history snapshot: 20260714224925 device_notification_acknowledgement_list_20260714

create or replace function public.list_device_notification_acknowledgements(
  p_device_identifier text,
  p_limit integer default 500
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_requested text := nullif(btrim(coalesce(p_device_identifier,'')), '');
  v_device text;
  v_limit integer := greatest(1, least(coalesce(p_limit,500), 2000));
  v_result jsonb;
begin
  if v_requested is null or length(v_requested) > 200 then
    raise exception 'device_identifier is required and must be at most 200 characters';
  end if;

  select d.device_id into v_device
  from public.devices d
  where d.active = true and upper(btrim(d.device_id)) = upper(v_requested)
  limit 1;

  if v_device is null then
    select d.device_id into v_device
    from public.device_aliases da
    join public.devices d on d.id = da.canonical_device_id and d.active = true
    where da.active = true and upper(btrim(da.alias_identifier)) = upper(v_requested)
    limit 1;
  end if;

  if v_device is null then raise exception 'Active device not found: %', v_requested; end if;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.updated_at desc), '[]'::jsonb)
    into v_result
  from (
    select notification_key, notification_type, displayed_at, dismissed_at,
           opened_at, acknowledged_at, updated_at
    from public.device_notification_acknowledgements
    where device_identifier = v_device
      and acknowledged_at is not null
    order by updated_at desc
    limit v_limit
  ) x;

  return jsonb_build_object(
    'device_identifier', v_device,
    'acknowledgements', v_result
  );
end
$function$;

revoke all on function public.list_device_notification_acknowledgements(text,integer) from public, anon, authenticated;
grant execute on function public.list_device_notification_acknowledgements(text,integer) to service_role;
