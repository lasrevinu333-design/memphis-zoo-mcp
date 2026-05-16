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

  const possessive = raw.match(/\b([A-Z][A-Za-z]*(?:\s+[A-Z][A-Za-z]*)?)['’]s\b/);
  if (possessive?.[1]) return possessive[1].trim();

  const named = raw.match(/\b(?:for|is|does|did|was|where is|what is)\s+([A-Z][A-Za-z]*(?:\s+[A-Z][A-Za-z]*)?)/);
  if (named?.[1]) return named[1].trim();

  const lowerName = lower.match(/\b(tammy|karen|kathy|michael|sherita|alijah|daniel|markiesha|markeisha|markesha|markeisha)\b/);
  if (lowerName?.[1]) return lowerName[1];

  return "";
}

function employeeTokenScore(queryToken = "", nameToken = "") {
  const query = normalizeLoose(queryToken);
  const name = normalizeLoose(nameToken);
  if (!query || !name) return 0;
  if (query === name) return 40;
  if (query.length >= 3 && name.startsWith(query)) return 30;
  if (name.length >= 3 && query.startsWith(name)) return 28;
  if (query.length >= 4 && name.includes(query)) return 24;

  let distance = 0;
  const maxLength = Math.max(query.length, name.length);
  const minLength = Math.min(query.length, name.length);
  for (let i = 0; i < minLength; i += 1) if (query[i] !== name[i]) distance += 1;
  distance += maxLength - minLength;
  if (maxLength >= 5 && distance <= 1) return 22;
  if (maxLength >= 7 && distance <= 2) return 16;
  return 0;
}

function scoreEmployeeMatch(candidate = "", displayName = "") {
  const query = normalizeLoose(candidate);
  const name = normalizeLoose(displayName);
  if (!query || !name) return 0;
  if (query.includes(name)) return 1000 + name.length;

  const queryTokens = query.split(/\s+/).filter(Boolean);
  const nameTokens = name.split(/\s+/).filter(Boolean);
  let score = 0;
  for (const nameToken of nameTokens) {
    score += Math.max(...queryTokens.map((queryToken) => employeeTokenScore(queryToken, nameToken)), 0);
  }
  if (nameTokens[0] && queryTokens.some((token) => employeeTokenScore(token, nameTokens[0]) >= 16)) score += 80;
  if (nameTokens[nameTokens.length - 1] && queryTokens.some((token) => employeeTokenScore(token, nameTokens[nameTokens.length - 1]) >= 22)) score += 40;
  return score;
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
    order by display_name
  `);

  let employee = null;
  let bestScore = 0;
  for (const row of Array.isArray(employeeRows) ? employeeRows : []) {
    const score = scoreEmployeeMatch(nameCandidate, row.display_name);
    if (score > bestScore) {
      employee = row;
      bestScore = score;
    }
  }

  if (!employee?.id || bestScore < 70) return null;

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
