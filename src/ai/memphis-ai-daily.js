import { esc } from "./memphis-ai-utils.js";

export async function ensureDailySchedule(runRpc, serviceDate) {
  try {
    return await runRpc("sch_generate_daily_schedule", { p_service_date: serviceDate, p_force: false });
  } catch (error) {
    console.error("memphis daily schedule generation failed:", serviceDate, error);
    return null;
  }
}

export async function fetchDailyAreaScheduleRows(runReadOnlySql, serviceDate) {
  const rows = await runReadOnlySql(`select * from public.v_memphis_area_schedule where service_date = '${esc(serviceDate)}'::date order by group_name asc, coverage_start asc, segment_number asc`);
  return Array.isArray(rows) ? rows : [];
}

export async function fetchDailyRosterRows(runReadOnlySql, serviceDate) {
  const rows = await runReadOnlySql(`select dwr.service_date, e.display_name as employee_name, dwr.shift_start, dwr.shift_end, dwr.active, dwr.source_type from public.daily_work_roster dwr join public.employees e on e.id = dwr.employee_id where dwr.service_date = '${esc(serviceDate)}'::date and dwr.active = true order by dwr.shift_start asc, e.display_name asc`);
  return Array.isArray(rows) ? rows : [];
}

export function summarizeDailyRoster(roster = [], serviceDate = "") {
  if (!roster.length) return `I couldn't find anyone scheduled to work on ${serviceDate}.`;

  const people = roster.map((row) => {
    const start = String(row.shift_start || "—").slice(0, 5);
    const end = String(row.shift_end || "—").slice(0, 5);
    return `${row.employee_name} ${start}-${end}`;
  });

  return `${serviceDate}: ${people.join("; ")}. Ask who is where if you want area assignments.`;
}

export function summarizeDailyAssignments(assignments = [], serviceDate = "") {
  if (!assignments.length) return `I couldn't find schedule assignments for anyone on ${serviceDate}.`;

  const byEmployee = new Map();

  for (const row of assignments) {
    const employee = row.employee_name || row.assigned_employee_name || "Open";
    const group = row.group_name || row.group_code || "Unknown area";
    const start = row.coverage_start || "—";
    const end = row.coverage_end || "—";

    if (!byEmployee.has(employee)) byEmployee.set(employee, []);
    byEmployee.get(employee).push(`${group} ${start}-${end}`);
  }

  const lines = Array.from(byEmployee.entries())
    .slice(0, 12)
    .map(([employee, segments]) => `${employee}: ${segments.slice(0, 6).join("; ")}`);

  const hiddenEmployeeCount = Math.max(0, byEmployee.size - 12);
  const hiddenRowCount = Math.max(0, assignments.length - lines.length);
  const suffix = hiddenEmployeeCount || hiddenRowCount
    ? ` ${hiddenEmployeeCount ? `${hiddenEmployeeCount} more people. ` : ""}Ask for more detail if you want the full breakdown.`
    : "";

  return `${serviceDate} staffing: ${lines.join(". ")}.${suffix}`;
}

export async function generateDailyStaffScheduleReply({ runReadOnlySql, runRpc, serviceDate } = {}) {
  await ensureDailySchedule(runRpc, serviceDate);
  const roster = await fetchDailyRosterRows(runReadOnlySql, serviceDate);

  return {
    text: summarizeDailyRoster(roster, serviceDate),
    meta: {
      fallback: true,
      mode: "local_daily_staff_schedule",
      service_date: serviceDate,
      generated_before_read: true,
    },
  };
}
