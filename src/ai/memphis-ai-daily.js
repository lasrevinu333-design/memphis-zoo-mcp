import { esc } from "./memphis-ai-utils.js";

export async function ensureDailySchedule(runRpc, serviceDate, { force = false } = {}) {
  try {
    return await runRpc("sch_generate_daily_schedule", { p_service_date: serviceDate, p_force: force });
  } catch (error) {
    console.error("memphis daily schedule generation failed:", serviceDate, error);
    return null;
  }
}

export async function fetchDailyAreaScheduleRows(runReadOnlySql, serviceDate) {
  const rows = await runReadOnlySql(`select * from public.v_memphis_area_schedule where service_date = '${esc(serviceDate)}'::date order by group_name asc, coverage_start asc, segment_number asc`);
  return Array.isArray(rows) ? rows : [];
}

function wait(ms = 300) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchDailyRosterRows(runReadOnlySql, serviceDate) {
  const rows = await runReadOnlySql(`select dwr.service_date, e.display_name as employee_name, dwr.shift_start, dwr.shift_end, dwr.active, dwr.source_type from public.daily_work_roster dwr join public.employees e on e.id = dwr.employee_id where dwr.service_date = '${esc(serviceDate)}'::date and dwr.active = true order by dwr.shift_start asc, e.display_name asc`);
  const rosterRows = Array.isArray(rows) ? rows : [];
  if (rosterRows.length) return rosterRows;

  const day = getDayOfWeekFromIsoDate(serviceDate);
  if (day == null) return [];
  const templateRows = await runReadOnlySql(`select '${esc(serviceDate)}'::date as service_date, e.display_name as employee_name, est.shift_start, est.shift_end, est.active, 'shift_template' as source_type from public.employee_shift_templates est join public.employees e on e.id = est.employee_id where est.active = true and e.active = true and est.day_of_week = ${Number(day)} order by est.shift_start asc, e.display_name asc`);
  return Array.isArray(templateRows) ? templateRows : [];
}

function getDayOfWeekFromIsoDate(serviceDate = "") {
  const date = new Date(`${serviceDate}T12:00:00`);
  return Number.isNaN(date.getTime()) ? null : date.getDay();
}

export async function fetchDailyOpsManagerRows(runReadOnlySql, serviceDate) {
  const dayOfWeek = getDayOfWeekFromIsoDate(serviceDate);
  if (dayOfWeek == null) return [];
  const rows = await runReadOnlySql(`select s.display_name as employee_name, coalesce(c.role_title, 'Ops Manager') as role_title, s.shift_start, s.shift_end, c.phone from public.ops_manager_weekly_schedules s left join public.internal_ops_contacts c on c.id = s.contact_id where s.active = true and s.day_of_week = ${Number(dayOfWeek)} order by s.shift_start asc, s.display_name asc`);
  return Array.isArray(rows) ? rows : [];
}

export async function fetchDailyAbsenceRows(runReadOnlySql, serviceDate) {
  const rows = await runReadOnlySql(`
    select e.display_name as employee_name, dao.absence_type, dao.notes
    from public.daily_absence_overrides dao
    join public.employees e on e.id = dao.employee_id
    where dao.absence_date = '${esc(serviceDate)}'::date
      and dao.active = true
    order by e.display_name
  `);
  return Array.isArray(rows) ? rows : [];
}

function detectStaffAudience(queryText = "") {
  const lower = String(queryText || "").toLowerCase();
  if (/\b(ops|operations|manager|managers|boss|director)\b/.test(lower)) return "ops";
  if (/\b(custodian|custodians|custodial)\b/.test(lower)) return "custodians";
  return "all";
}

function summarizeRosterPeople(rows = [], includeRole = false) {
  return rows.map((row) => {
    const start = String(row.shift_start || "—").slice(0, 5);
    const end = String(row.shift_end || "—").slice(0, 5);
    const role = includeRole && row.role_title ? ` (${row.role_title})` : "";
    return `${row.employee_name}${role} ${start}-${end}`;
  });
}

export function summarizeDailyRoster(roster = [], serviceDate = "", opsRows = [], queryText = "", absenceRows = []) {
  const audience = detectStaffAudience(queryText);
  const custodianPeople = summarizeRosterPeople(roster, false);
  const opsPeople = summarizeRosterPeople(opsRows, true);
  const absentPeople = Array.isArray(absenceRows) ? absenceRows.map((row) => `${row.employee_name}${row.absence_type ? ` (${row.absence_type})` : ""}`).filter(Boolean) : [];
  const absenceSuffix = absentPeople.length ? ` Out today: ${absentPeople.join("; ")}.` : "";

  if (audience === "ops") {
    if (!opsPeople.length) return `I couldn't find any ops managers scheduled to work on ${serviceDate}.`;
    return `${serviceDate}: Ops managers: ${opsPeople.join("; ")}.${absenceSuffix}`;
  }

  if (audience === "custodians") {
    if (!custodianPeople.length) return `I couldn't find any custodians scheduled to work on ${serviceDate}.`;
    return `${serviceDate}: Custodians: ${custodianPeople.join("; ")}. Ask who is where if you want area assignments.${absenceSuffix}`;
  }

  if (!custodianPeople.length && !opsPeople.length) return `I couldn't find anyone scheduled to work on ${serviceDate}.`;

  const sections = [];
  sections.push(`Ops managers: ${opsPeople.length ? opsPeople.join("; ") : "none listed"}`);
  sections.push(`Custodians: ${custodianPeople.length ? custodianPeople.join("; ") : "none listed"}`);
  return `${serviceDate}: ${sections.join(". ")}. Ask who is where if you want area assignments.`;
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

export async function generateDailyStaffScheduleReply({ runReadOnlySql, runRpc, serviceDate, queryText = "" } = {}) {
  let generatedBeforeRead = false;
  let roster = await fetchDailyRosterRows(runReadOnlySql, serviceDate);
  if (!roster.length) {
    await ensureDailySchedule(runRpc, serviceDate);
    generatedBeforeRead = true;
    await wait(450);
    roster = await fetchDailyRosterRows(runReadOnlySql, serviceDate);
  }
  const opsRows = await fetchDailyOpsManagerRows(runReadOnlySql, serviceDate);

  return {
    text: summarizeDailyRoster(roster, serviceDate, opsRows, queryText),
    meta: {
      fallback: true,
      mode: "local_daily_staff_schedule",
      service_date: serviceDate,
      generated_before_read: generatedBeforeRead,
    },
  };
}
