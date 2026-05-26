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

async function ensureDailySchedule(runRpc, serviceDate, { force = false } = {}) {
  try {
    return await runRpc("sch_generate_daily_schedule", { p_service_date: serviceDate, p_force: force });
  } catch (error) {
    console.error("memphis weekly schedule generation failed:", serviceDate, error);
    return null;
  }
}

async function fetchAreaScheduleRows(runReadOnlySql, serviceDate) {
  const rows = await runReadOnlySql(`select * from public.v_memphis_area_schedule where service_date = '${esc(serviceDate)}'::date order by group_name asc, coverage_start asc, segment_number asc`);
  return Array.isArray(rows) ? rows : [];
}

async function fetchAreaSpecificScheduleRows(runReadOnlySql, serviceDate, areaTarget = {}) {
  const groupId = String(areaTarget?.location_group_id || "").trim();
  const groupName = String(areaTarget?.group_name || "").trim();
  const groupCode = String(areaTarget?.group_code || "").trim();
  if (!groupId && !groupName && !groupCode) return fetchAreaScheduleRows(runReadOnlySql, serviceDate);

  const areaClause = groupId
    ? `location_group_id = '${esc(groupId)}'::uuid`
    : `(group_name ilike '${esc(groupName || groupCode)}' or group_code ilike '${esc(groupCode || groupName)}')`;
  const rows = await runReadOnlySql(`select * from public.v_memphis_area_schedule where service_date = '${esc(serviceDate)}'::date and ${areaClause} order by group_name asc, coverage_start asc, segment_number asc`);
  return Array.isArray(rows) ? rows : [];
}

function weekdayShort(serviceDate = "") {
  const date = new Date(`${serviceDate}T12:00:00`);
  if (Number.isNaN(date.getTime())) return serviceDate || "Day";
  return date.toLocaleDateString("en-US", { weekday: "short", month: "numeric", day: "numeric", timeZone: "UTC" });
}

function compactTime(value = "") {
  const raw = String(value || "").trim();
  return raw ? raw.slice(0, 5) : "—";
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

function summarizeWeeklyAreaAssignments(days = [], areaTarget = {}) {
  const label = areaTarget?.group_name || areaTarget?.group_code || "that area";
  if (!days.length) return `I couldn't find weekly assignments for ${label}.`;

  const sections = days.map((day) => {
    const rows = Array.isArray(day.assignments) ? day.assignments : [];
    if (!rows.length) return `${weekdayShort(day.service_date)}: no generated assignment`;
    const people = Array.from(new Map(rows
      .map((row) => {
        const employee = row.employee_name || row.assigned_employee_name || "Open";
        const start = compactTime(row.coverage_start);
        const end = compactTime(row.coverage_end);
        return [`${employee}|${start}|${end}`, `${employee} ${start}-${end}`];
      })
      .filter((entry) => Boolean(entry[1]))).values());
    return `${weekdayShort(day.service_date)}: ${people.join("; ")}`;
  });

  let text = `Normal weekly ${label} assignments (unless absence, PTO, or Coverall changes it): ${sections.join(". ")}.`;
  if (text.length > 1900) {
    const compactSections = sections.slice(0, 7).map((section) => section.replace(/\s+\d{1,2}:\d{2}-\d{1,2}:\d{2}/g, ""));
    text = `Normal weekly ${label} assignments (unless absence, PTO, or Coverall changes it): ${compactSections.join(". ")}. Ask for a specific day if you need exact times.`;
  }
  if (text.length > 1900) return `${text.slice(0, 1850).replace(/\s+\S*$/, "")}… Ask for a specific day if you need the full breakdown.`;
  return text;
}

export async function generateWeeklyScheduleReply({
  runReadOnlySql,
  runRpc,
  text = "",
  todayServiceDate,
  relativeServiceDate,
  areaTarget = null,
} = {}) {
  const startDate = getWeekStartDate(text, todayServiceDate, relativeServiceDate);
  const dates = buildScheduleDateRange(startDate, 7);
  const days = [];

  for (const serviceDate of dates) {
    let rows = areaTarget
      ? await fetchAreaSpecificScheduleRows(runReadOnlySql, serviceDate, areaTarget)
      : await fetchAreaScheduleRows(runReadOnlySql, serviceDate);
    if (!rows.length) {
      await ensureDailySchedule(runRpc, serviceDate);
      rows = areaTarget
        ? await fetchAreaSpecificScheduleRows(runReadOnlySql, serviceDate, areaTarget)
        : await fetchAreaScheduleRows(runReadOnlySql, serviceDate);
    }
    days.push({ service_date: serviceDate, assignments: rows });
  }

  return {
    text: areaTarget ? summarizeWeeklyAreaAssignments(days, areaTarget) : summarizeWeeklyAssignments(days),
    meta: {
      fallback: true,
      mode: areaTarget ? "local_weekly_area_schedule" : "local_weekly_staff_schedule",
      dates,
      group_name: areaTarget?.group_name || areaTarget?.group_code || null,
    },
  };
}
