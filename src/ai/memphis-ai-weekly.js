import { esc } from "./memphis-ai-utils.js";
import { fetchCurrentMemphisScheduleDay } from "./memphis-ai-daily.js";

function addDaysToIsoDate(serviceDate, daysToAdd = 0) {
  const base = new Date(`${serviceDate}T12:00:00Z`);
  if (Number.isNaN(base.getTime())) return serviceDate;
  base.setUTCDate(base.getUTCDate() + Number(daysToAdd || 0));
  return base.toISOString().slice(0, 10);
}

function buildScheduleDateRange(startDate, days = 7) {
  return Array.from({ length: days }, (_value, index) => addDaysToIsoDate(startDate, index));
}

function getWeekStartDate(text = "", todayServiceDate, relativeServiceDate) {
  if (/\bnext week\b/i.test(String(text || ""))) return addDaysToIsoDate(todayServiceDate || relativeServiceDate, 7);
  return relativeServiceDate || todayServiceDate;
}

async function fetchCurrentWeekSegments(runReadOnlySql,serviceDate,day) {
  const rows=await runReadOnlySql(`select to_jsonb(authority) as authority,
    (select coalesce(jsonb_agg(to_jsonb(segment) order by segment.group_name,segment.coverage_start,segment.segment_number),'[]'::jsonb)
      from public.static_weekly_v6_read_schedule_segments('${esc(serviceDate)}'::date) segment
      where segment.publication_id=authority.publication_id and segment.projection_id=authority.projection_id
        and segment.owner_type='EMPLOYEE' and segment.status='ASSIGNED') as assignments
    from public.static_weekly_v6_schedule_authority_state('${esc(serviceDate)}'::date) authority`);
  const result=Array.isArray(rows)&&rows.length===1?rows[0]:null;
  if(result?.authority?.governed!==true || result.authority.projection_status!=='current'
    || result.authority.publication_id!==day.publication_id
    || result.authority.projection_id!==day.projection_id
    || !Array.isArray(result.assignments))return null;
  const eligible=new Set(day.rows.filter(row=>row.working===true).map(row=>row.employee_id));
  if(result.assignments.some(row=>!eligible.has(row.assigned_employee_id)))return null;
  return result.assignments;
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
  return `Current published assignments for these dates:\n${sections.join("\n")}`;
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

  let text = `Current published ${label} assignments for these dates: ${sections.join(". ")}.`;
  if (text.length > 1900) {
    const compactSections = sections.slice(0, 7).map((section) => section.replace(/\s+\d{1,2}:\d{2}-\d{1,2}:\d{2}/g, ""));
    text = `Current published ${label} assignments for these dates: ${compactSections.join(". ")}. Ask for a specific day if you need exact times.`;
  }
  if (text.length > 1900) return `${text.slice(0, 1850).replace(/\s+\S*$/, "")}… Ask for a specific day if you need the full breakdown.`;
  return text;
}

export async function generateWeeklyScheduleReply({
  runReadOnlySql,
  runRpc: _runRpc,
  text = "",
  todayServiceDate,
  relativeServiceDate,
  areaTarget = null,
} = {}) {
  const startDate = getWeekStartDate(text, todayServiceDate, relativeServiceDate);
  const dates = buildScheduleDateRange(startDate, 7);
  const days = [];

  for (const serviceDate of dates) {
    const day=await fetchCurrentMemphisScheduleDay(runReadOnlySql,serviceDate);
    if(day.status!=='current')return {text:`I can't verify the full current published seven-day schedule; ${serviceDate} has no current readback.`,
      meta:{fallback:true,mode:areaTarget?'local_weekly_area_schedule':'local_weekly_staff_schedule',dates,
        projection_status:day.projection_status||'unavailable',publication_unavailable:true}};
    const all=await fetchCurrentWeekSegments(runReadOnlySql,serviceDate,day);
    if(!all)return {text:`I can't verify the full current published seven-day schedule; ${serviceDate} changed or has no matching assignment readback.`,
      meta:{fallback:true,mode:areaTarget?'local_weekly_area_schedule':'local_weekly_staff_schedule',dates,
        projection_status:'assignment_authority_mismatch',publication_unavailable:true}};
    const rows=areaTarget?all.filter(row=>{
      if(areaTarget.location_group_id)return row.location_group_id===areaTarget.location_group_id;
      return row.group_name===areaTarget.group_name || row.group_code===areaTarget.group_code;
    }):all;
    days.push({service_date:serviceDate,assignments:rows});
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
