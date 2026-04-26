import { esc, normalizeLoose } from "./memphis-ai-utils.js";

const DAY_NAMES = {
  0: "Sunday",
  1: "Monday",
  2: "Tuesday",
  3: "Wednesday",
  4: "Thursday",
  5: "Friday",
  6: "Saturday",
};

function isEmployeeWeeklyScheduleQuestion(text = "") {
  const lower = normalizeLoose(text);
  if (!lower) return false;

  const asksSchedule = /\b(weekly schedule|regular schedule|normal schedule|standing schedule|what days|which days|days does|days is|work week|weekly|every week|when does|when do|work next|works next|next work|next shift)\b/.test(lower);
  const mentionsEmployeeSchedule = /\b(schedule|work|works|working|shift|shifts)\b/.test(lower);

  return asksSchedule || (mentionsEmployeeSchedule && /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|week)\b/.test(lower));
}

function extractNameCandidate(text = "", threadContext = {}) {
  const raw = String(text || "").trim();
  const lower = normalizeLoose(raw);

  if (/\b(her|his|their|that person|same person)\b/.test(lower) && threadContext?.last_employee_name) {
    return String(threadContext.last_employee_name || "").trim();
  }

  const possessive = raw.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)['’]s\b/);
  if (possessive?.[1]) return possessive[1].trim();

  const named = raw.match(/\b(?:for|is|does|did|was|where is|what is)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/);
  if (named?.[1]) return named[1].trim();

  const lowerName = lower.match(/\b(tammy|karen|kathy|michael|sherita|alijah|daniel|markiesha)\b/);
  if (lowerName?.[1]) return lowerName[1];

  return "";
}

function compressTemplateRows(rows = []) {
  const groups = new Map();

  for (const row of rows) {
    const key = `${row.shift_start}|${row.shift_end}|${row.notes || ""}`;
    if (!groups.has(key)) {
      groups.set(key, {
        shift_start: row.shift_start,
        shift_end: row.shift_end,
        notes: row.notes || "",
        days: [],
      });
    }
    groups.get(key).days.push(Number(row.day_of_week));
  }

  return Array.from(groups.values()).map((group) => {
    const sorted = group.days.sort((a, b) => a - b);
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const dayText = sorted.length > 1 && last - first === sorted.length - 1
      ? `${DAY_NAMES[first]} through ${DAY_NAMES[last]}`
      : sorted.map((day) => DAY_NAMES[day]).join(", ");

    const start = String(group.shift_start || "").slice(0, 5);
    const end = String(group.shift_end || "").slice(0, 5);
    const lunch = String(group.notes || "").match(/Lunch\s+([^\.]+)\./i)?.[1];

    return `${dayText}, ${start} to ${end}${lunch ? `, lunch ${lunch}` : ""}`;
  });
}

export async function answerEmployeeWeeklyScheduleQuestion(runReadOnlySql, text = "", threadContext = {}) {
  if (!isEmployeeWeeklyScheduleQuestion(text)) return null;

  const nameCandidate = extractNameCandidate(text, threadContext);
  if (!nameCandidate) return null;

  const employeeRows = await runReadOnlySql(`
    select id, display_name, role
    from public.employees
    where active = true
      and display_name ilike '%${esc(nameCandidate)}%'
    order by length(display_name), display_name
    limit 1
  `);

  const employee = Array.isArray(employeeRows) && employeeRows.length ? employeeRows[0] : null;
  if (!employee?.id) return null;

  const templateRows = await runReadOnlySql(`
    select est.day_of_week, est.shift_start, est.shift_end, est.notes, est.active
    from public.employee_shift_templates est
    where est.employee_id = '${esc(employee.id)}'::uuid
      and est.active = true
    order by est.day_of_week, est.shift_start
  `);

  const templates = Array.isArray(templateRows) ? templateRows : [];
  if (!templates.length) {
    return `${employee.display_name} does not have an active weekly shift template listed.`;
  }

  const summary = compressTemplateRows(templates).join("; ");
  return `${employee.display_name}'s regular weekly schedule is ${summary}.`;
}
