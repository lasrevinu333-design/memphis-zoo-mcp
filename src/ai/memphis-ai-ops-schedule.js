import { esc, normalizeLoose } from "./memphis-ai-utils.js";
import { findLocationCode, hasLocationKeyword } from "./memphis-ai-intent.js";

function isManagerRole(role = "") {
  return String(role || "").trim().toLowerCase() === "manager";
}

const DAY_NAMES = {
  0: "Sunday",
  1: "Monday",
  2: "Tuesday",
  3: "Wednesday",
  4: "Thursday",
  5: "Friday",
  6: "Saturday",
};

const DAY_LOOKUP = Object.fromEntries(Object.entries(DAY_NAMES).map(([value, name]) => [name.toLowerCase(), Number(value)]));

function isOpsScheduleQuestion(text = "") {
  const lower = normalizeLoose(text);
  if (!lower) return false;
  if (findLocationCode(text) || hasLocationKeyword(text)) return false;

  const mentionsOps = /\b(ops|operations|manager|managers|boss|director|custodial manager|facilities manager|facility manager|maintenance manager|horticulture manager|water quality manager)\b/.test(lower)
    || /\b(eric|operle|mckenney|mckenny|brandy|gull|haley|lejman|jennifer|sheffield)\b/.test(lower);
  const asksSchedule = /\b(schedule|work|works|working|shift|shifts|cover|covers|coverage|who is|who's|who has|today|tomorrow|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/.test(lower);

  return mentionsOps && asksSchedule;
}

function extractExplicitDayOfWeek(text = "") {
  const lower = normalizeLoose(text);
  for (const [name, index] of Object.entries(DAY_LOOKUP)) {
    if (new RegExp(`\\b${name}s?\\b`).test(lower)) return index;
    if (new RegExp(`\\b${name}[a-z]{1,2}\\b`).test(lower)) return index;
  }
  return null;
}

function extractNameTerm(text = "") {
  const lower = normalizeLoose(text);
  if (/\bmckenney\b|\bmckenny\b|\bfacilities manager\b|\bfacility manager\b|\bmaintenance manager\b/.test(lower)) return "Eric McKenney";
  if (/\boperle\b|\bcustodial manager\b/.test(lower)) return "Eric Operle";
  if (/\beric\b/.test(lower)) return "Eric";
  if (/\bbrandy\b|\bgull\b/.test(lower)) return "Brandy";
  if (/\bhaley\b|\blejman\b/.test(lower)) return "Haley";
  if (/\bjennifer\b|\bsheffield\b/.test(lower)) return "Jennifer";
  return "";
}

function buildNameFilter(nameTerm = "") {
  const value = String(nameTerm || "").trim();
  if (!value) return "";
  if (value === "Eric") return "and s.display_name ilike '%Eric%'";
  return `and s.display_name ilike ${`'%${esc(value)}%'`}`;
}

function summarizeRows(rows = [], label = "", { includePhone = false } = {}) {
  if (!rows.length) return `I don't see an ops manager schedule listed for ${label || "that day"}.`;

  const parts = rows.map((row) => {
    const start = String(row.shift_start || "").slice(0, 5);
    const end = String(row.shift_end || "").slice(0, 5);
    const phone = includePhone && row.phone ? `, phone ${row.phone}` : "";
    return `${row.display_name} (${row.role_title}) ${start}-${end}${phone}`;
  });

  return `Ops manager schedule for ${label}: ${parts.join("; ")}.`;
}

function summarizeWeeklyForOne(rows = [], { includePhone = false } = {}) {
  if (!rows.length) return "";

  const name = rows[0].display_name;
  const role = rows[0].role_title;
  const phone = includePhone && rows[0].phone ? ` Phone ${rows[0].phone}.` : "";
  const byTime = new Map();

  for (const row of rows) {
    const key = `${row.shift_start}|${row.shift_end}`;
    if (!byTime.has(key)) byTime.set(key, { shift_start: row.shift_start, shift_end: row.shift_end, days: [] });
    byTime.get(key).days.push(Number(row.day_of_week));
  }

  const chunks = Array.from(byTime.values()).map((group) => {
    const sorted = group.days.sort((a, b) => a - b);
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const dayText = sorted.length > 1 && last - first === sorted.length - 1
      ? `${DAY_NAMES[first]} through ${DAY_NAMES[last]}`
      : sorted.map((day) => DAY_NAMES[day]).join(", ");
    return `${dayText}, ${String(group.shift_start).slice(0, 5)}-${String(group.shift_end).slice(0, 5)}`;
  });

  return `${name} (${role}) works ${chunks.join("; ")}.${phone}`;
}

function summarizeWeekly(rows = [], { includePhone = false } = {}) {
  if (!rows.length) return "I don't see a regular ops manager schedule listed for that person.";

  const byPerson = new Map();
  for (const row of rows) {
    const key = row.display_name || "Unknown";
    if (!byPerson.has(key)) byPerson.set(key, []);
    byPerson.get(key).push(row);
  }

  return Array.from(byPerson.values()).map((rowsForPerson) => summarizeWeeklyForOne(rowsForPerson, { includePhone })).filter(Boolean).join(" ");
}

export async function answerOpsManagerScheduleQuestion(runReadOnlySql, text = "", userRole = "") {
  if (!isOpsScheduleQuestion(text)) return null;

  const nameTerm = extractNameTerm(text);
  const lower = normalizeLoose(text);
  // H5: Phone numbers are only exposed to manager role.
  const phoneRequested = /\b(phone|number|contact|call|text|reach)\b/.test(lower);
  const includePhone = phoneRequested && isManagerRole(userRole);
  const asksWeekly = /\b(weekly|regular|normal|standing|what days|which days|schedule)\b/.test(lower) && Boolean(nameTerm);

  if (asksWeekly) {
    const rows = await runReadOnlySql(`
      select s.display_name, c.role_title, c.phone, s.day_of_week, s.shift_start, s.shift_end
      from public.ops_manager_weekly_schedules s
      left join public.internal_ops_contacts c on c.id = s.contact_id
      where s.active = true
        ${buildNameFilter(nameTerm)}
      order by s.display_name, s.day_of_week, s.shift_start
    `);
    return summarizeWeekly(Array.isArray(rows) ? rows : [], { includePhone });
  }

  const day = await resolveRelativeDay(runReadOnlySql, text);
  const nameFilter = buildNameFilter(nameTerm);
  const rows = await runReadOnlySql(`
    select s.display_name, c.role_title, c.phone, s.day_of_week, s.shift_start, s.shift_end
    from public.ops_manager_weekly_schedules s
    left join public.internal_ops_contacts c on c.id = s.contact_id
    where s.active = true
      and s.day_of_week = ${Number(day.day_of_week)}
      ${nameFilter}
    order by s.shift_start, s.display_name
  `);

  return summarizeRows(Array.isArray(rows) ? rows : [], day.label, { includePhone });
}

// LOW #4: Use shared date resolution instead of duplicating SQL for relative day computation.
async function resolveRelativeDay(runReadOnlySql, text = "") {
  const lower = normalizeLoose(text);
  const explicitDow = extractExplicitDayOfWeek(text);
  if (explicitDow != null) return { day_of_week: explicitDow, label: DAY_NAMES[explicitDow] };

  const offset = lower.includes("tomorrow") ? 1 : 0;
  // Use make_interval with validated integer offset for safety.
  const intOffset = Math.trunc(offset);
  const rows = await runReadOnlySql(`select extract(dow from public.sch_service_date(now() + interval '${intOffset} day'))::int as day_of_week, public.sch_service_date(now() + interval '${intOffset} day') as service_date`);
  const row = Array.isArray(rows) && rows.length ? rows[0] : null;
  const day = Number(row?.day_of_week ?? 0);
  const date = row?.service_date || "";
  return { day_of_week: day, label: offset === 1 ? `tomorrow (${date}, ${DAY_NAMES[day]})` : `today (${date}, ${DAY_NAMES[day]})` };
}
