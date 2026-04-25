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

export function summarizeDailyAssignments(assignments = [], serviceDate = "") {
  if (!assignments.length) return `I couldn't find schedule assignments for anyone on ${serviceDate}.`;

  return assignments.slice(0, 40).map((row) => {
    const employee = row.employee_name || row.assigned_employee_name || "Open";
    const group = row.group_name || row.group_code || "Unknown area";
    const start = row.coverage_start || "—";
    const end = row.coverage_end || "—";
    return `${employee} covers ${group} from ${start} to ${end}.`;
  }).join(" ");
}

export async function generateDailyStaffScheduleReply({ runReadOnlySql, runRpc, serviceDate } = {}) {
  await ensureDailySchedule(runRpc, serviceDate);
  const rows = await fetchDailyAreaScheduleRows(runReadOnlySql, serviceDate);

  return {
    text: summarizeDailyAssignments(rows, serviceDate),
    meta: {
      fallback: true,
      mode: "local_daily_staff_schedule",
      service_date: serviceDate,
      generated_before_read: true,
    },
  };
}
