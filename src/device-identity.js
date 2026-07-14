function sqlLiteral(value) {
  return `'${String(value ?? "").replace(/'/g, "''")}'`;
}

export function normalizeDeviceIdentifier(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^kiosk[-_ ]?\d{1,2}$/i.test(raw)) {
    const digits = (raw.match(/\d+/) || [""])[0].padStart(2, "0");
    return `KIOSK_${digits}`;
  }
  return raw;
}

export function isCanonicalEmployeeKiosk(value) {
  return /^KIOSK_(0[2-9]|10)$/i.test(normalizeDeviceIdentifier(value));
}

export async function resolveCanonicalDevice({ runReadOnlySql, deviceIdentifier }) {
  if (typeof runReadOnlySql !== "function") throw new Error("runReadOnlySql is required.");
  const requested = normalizeDeviceIdentifier(deviceIdentifier);
  if (!requested) return null;

  const rows = await runReadOnlySql(`
    with requested as (
      select upper(btrim(${sqlLiteral(requested)})) as identifier
    ), matches as (
      select
        0 as match_rank,
        'alias'::text as matched_by,
        da.alias_identifier as matched_alias,
        d.id as canonical_device_pk,
        d.device_id as canonical_device_id,
        d.device_name,
        d.active as device_active,
        d.assigned_employee_id,
        d.last_seen_at,
        e.display_name as assigned_employee_name,
        e.employee_code,
        e.role,
        coalesce(e.active, false) as employee_active
      from public.device_aliases da
      join public.devices d on d.id = da.canonical_device_id
      left join public.employees e on e.id = d.assigned_employee_id
      join requested r on upper(btrim(da.alias_identifier)) = r.identifier
      where da.active = true

      union all

      select
        1 as match_rank,
        'canonical'::text as matched_by,
        null::text as matched_alias,
        d.id as canonical_device_pk,
        d.device_id as canonical_device_id,
        d.device_name,
        d.active as device_active,
        d.assigned_employee_id,
        d.last_seen_at,
        e.display_name as assigned_employee_name,
        e.employee_code,
        e.role,
        coalesce(e.active, false) as employee_active
      from public.devices d
      left join public.employees e on e.id = d.assigned_employee_id
      join requested r on upper(btrim(d.device_id)) = r.identifier
    )
    select
      ${sqlLiteral(requested)}::text as requested_device_id,
      matched_by,
      matched_alias,
      canonical_device_pk,
      canonical_device_id,
      canonical_device_id as device_id,
      device_name,
      device_active,
      assigned_employee_id,
      assigned_employee_name,
      employee_code,
      role,
      employee_active,
      last_seen_at
    from matches
    order by match_rank, canonical_device_id
    limit 1
  `);

  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

export async function resolveActiveAssignedDevice(options) {
  const resolved = await resolveCanonicalDevice(options);
  if (!resolved || !resolved.device_active) return null;
  if (!resolved.assigned_employee_id || !resolved.employee_active) return { ...resolved, assignment_valid: false };
  return { ...resolved, assignment_valid: true };
}
