import { esc } from "./memphis-ai-utils.js";

function addDaysToIsoDate(serviceDate, daysToAdd = 0) {
  const base = new Date(`${serviceDate}T12:00:00`);
  if (Number.isNaN(base.getTime())) return serviceDate;
  base.setDate(base.getDate() + Number(daysToAdd || 0));
  return base.toISOString().slice(0, 10);
}

function buildScheduleDateRange(startDate, days = 7) {
  return Array.from({ length: days }, (_value, index) => addDaysToIsoDate(startDate, index));
}

function getWeekStartDate(text = "", todayServiceDate, relativeServiceDate) {
  if (/\bnext week\b/i.test(String(text || ""))) return addDaysToIsoDate(todayServiceDate || relativeServiceDate, 7);
  return relativeServiceDate || todayServiceDate;
}

async function ensureDailySchedule(runRpc, serviceDate) {
  try {
    return await runRpc("sch_generate_daily_schedule", { p_service_date: serviceDate, p_force: false });
  } catch (error) {
    console.error("memphis weekly schedule generation failed:", serviceDate, error);
    return null;
  }
}

async function fetchAreaScheduleRows(runReadOnlySql, serviceDate) {
  const rows = await runReadOnlySql(`select * from public.v_memphis_area_schedule where service_date = '${esc(serviceDate)}'::date order by group_name asc, coverage_start asc, segment_number asc`);
  return Array.isArray(rows) ? rows : [];
}

function summarizeWeeklyAssignments(days = []) {
  if (!days.length) return "I couldn't find any schedule days to summarize.";
  const sections = days.map((day) => {
    const rows = Array.isArray(day.assignments) ? day.assignments : [];
    if (!rows.length) return `${day.service_date}: no schedule assignments found.`;
    const lines = rows.map((row) => {
      const employee = row.employee_name || row.assigned_employee_name || "Open";
      const group = row.group_name || row.group_code || "Unknown area";
      const start = row.coverage_start || "—";
      const end = row.coverage_end || "—";
      return `${employee} — ${group} ${start}-${end}`;
    });
    return `${day.service_date}: ${lines.join("; ")}.`;
  });
  return sections.join("\n");
}

export async function generateWeeklyScheduleReply({
  runReadOnlySql,
  runRpc,
  text = "",
  todayServiceDate,
  relativeServiceDate,
} = {}) {
  const startDate = getWeekStartDate(text, todayServiceDate, relativeServiceDate);
  const dates = buildScheduleDateRange(startDate, 7);
  const days = [];

  for (const serviceDate of dates) {
    await ensureDailySchedule(runRpc, serviceDate);
    const rows = await fetchAreaScheduleRows(runReadOnlySql, serviceDate);
    days.push({ service_date: serviceDate, assignments: rows });
  }

  return {
    text: summarizeWeeklyAssignments(days),
    meta: {
      fallback: true,
      mode: "local_weekly_staff_schedule",
      dates,
    },
  };
}
