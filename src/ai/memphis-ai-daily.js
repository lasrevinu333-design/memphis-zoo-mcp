import { esc } from "./memphis-ai-utils.js";

export async function fetchCurrentMemphisScheduleDay(runReadOnlySql,serviceDate) {
  const rows=await runReadOnlySql(`select public.custodial_memphis_schedule_day('${esc(serviceDate)}'::date) as data`);
  const data=Array.isArray(rows)&&rows.length===1?rows[0].data:null;
  if (data?.schema!=='memphis.schedule-day.v1' || !['current','unavailable'].includes(data.status)
    || !Array.isArray(data.rows)) return {status:'unavailable',rows:[],projection_status:'invalid_authority_response'};
  return data;
}

// A work-state answer may use only segments from the same current governed
// publication and projection as the day/availability readback. In particular,
// an old OPEN row or a departed person's old assignment cannot be recast as
// today's coverage or employee load.
export async function fetchCurrentMemphisScheduleSegments(runReadOnlySql,serviceDate,day) {
  if(day?.status!=='current'||!day.publication_id||!day.projection_id)return null;
  const rows=await runReadOnlySql(`select to_jsonb(authority) as authority,
    (select coalesce(jsonb_agg(to_jsonb(segment) order by segment.group_name,segment.coverage_start,segment.segment_number),'[]'::jsonb)
      from public.static_weekly_v6_read_schedule_segments('${esc(serviceDate)}'::date) segment
      where segment.publication_id=authority.publication_id
        and segment.projection_id=authority.projection_id
        and segment.governed=true and segment.projection_status='current') as segments
    from public.static_weekly_v6_schedule_authority_state('${esc(serviceDate)}'::date) authority`);
  const result=Array.isArray(rows)&&rows.length===1?rows[0]:null;
  if(result?.authority?.governed!==true||result.authority.projection_status!=='current'
    ||result.authority.publication_id!==day.publication_id
    ||result.authority.projection_id!==day.projection_id
    ||!Array.isArray(result.segments))return null;
  const working=new Set(day.rows.filter(row=>row.working===true).map(row=>row.employee_id));
  if(result.segments.some(row=>row.status==='ASSIGNED'&&
    (row.owner_type!=='EMPLOYEE'||!working.has(row.assigned_employee_id))))return null;
  return result.segments;
}

export async function fetchDailyRosterRows(runReadOnlySql, serviceDate) {
  const day=await fetchCurrentMemphisScheduleDay(runReadOnlySql,serviceDate);
  return day.status==='current'?day.rows.filter((row)=>row.working===true):[];
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

export function summarizeDailyRoster(roster = [], serviceDate = "", opsRows = [], queryText = "") {
  const audience = detectStaffAudience(queryText);
  const custodianPeople = summarizeRosterPeople(roster, false);
  const opsPeople = summarizeRosterPeople(opsRows, true);
  if (audience === "ops") {
    if (!opsPeople.length) return `I can't verify day-of ops-manager staffing for ${serviceDate} from the current custodial publication.`;
    return `${serviceDate}: Ops managers: ${opsPeople.join("; ")}.`;
  }

  if (audience === "custodians") {
    if (!custodianPeople.length) return `I couldn't find any custodians scheduled to work on ${serviceDate}.`;
    return `${serviceDate}: Custodians: ${custodianPeople.join("; ")}. Ask who is where if you want area assignments.`;
  }

  if (!custodianPeople.length && !opsPeople.length) return `I couldn't find any custodians scheduled to work in the current publication on ${serviceDate}. Ops-manager day-of staffing is not verified here.`;

  const sections = [];
  sections.push(`Ops managers: ${opsPeople.length ? opsPeople.join("; ") : "day-of staffing not verified"}`);
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
  const day = await fetchCurrentMemphisScheduleDay(runReadOnlySql,serviceDate);
  if (day.status!=='current') return {text:`I can't verify a current published custodial schedule for ${serviceDate}.`,
    meta:{fallback:true,mode:'local_daily_staff_schedule',service_date:serviceDate,
      projection_status:day.projection_status||'unavailable',generated_before_read:false}};
  const roster=day.rows.filter((row)=>row.working===true);
  // No accepted day-of ops-manager publication is available in this reader.
  const opsRows = [];

  return {
    text: summarizeDailyRoster(roster, serviceDate, opsRows, queryText),
    meta: {
      fallback: true,
      mode: "local_daily_staff_schedule",
      service_date: serviceDate,
      generated_before_read: false,
      projection_id:day.projection_id||null,
    },
  };
}
