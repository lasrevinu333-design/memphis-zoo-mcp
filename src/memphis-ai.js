const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_MODEL = String(process.env.MEMPHIS_GEMINI_MODEL || process.env.GEMINI_MODEL || "gemini-2.5-flash").trim();
const DEFAULT_SCAN_DEVICE_ID = "memphis-bot";
const DEFAULT_WEATHER_LOCATION = "Memphis, Tennessee";
const WEEKDAY_INDEX = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };

function esc(value) {
  return String(value || "").replace(/'/g, "''");
}

function sqlLikeLiteral(value) {
  return `'%${String(value || "").replace(/'/g, "''") }%'`;
}

function normalizeLoose(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/pavillion/g, "pavilion")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeDate(value) {
  const raw = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

function extractExplicitDate(text) {
  const match = String(text || "").match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  return match ? match[1] : null;
}

function inferRelativeDateOffset(text) {
  const lower = String(text || "").toLowerCase();
  if (lower.includes("tomorrow")) return 1;
  if (lower.includes("yesterday")) return -1;
  return 0;
}

function extractWeekdayReference(text = "") {
  const lower = String(text || "").toLowerCase();
  const match = lower.match(/\b(?:(this|next)\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  if (!match) return null;
  return { modifier: match[1] || "", weekday: match[2] || "" };
}

function computeWeekdayDate(referenceDate, weekdayName, modifier = "") {
  const targetIndex = WEEKDAY_INDEX[String(weekdayName || "").toLowerCase()];
  if (targetIndex == null) return null;
  const base = new Date(`${referenceDate}T12:00:00`);
  if (Number.isNaN(base.getTime())) return null;
  const baseIndex = base.getDay();
  let delta = targetIndex - baseIndex;
  if (modifier === "next") {
    if (delta <= 0) delta += 7;
    else delta += 7;
  } else if (modifier === "this") {
    if (delta < 0) delta += 7;
  } else {
    if (delta < 0) delta += 7;
  }
  base.setDate(base.getDate() + delta);
  return base.toISOString().slice(0, 10);
}

function extractTimeWindow(text) {
  const raw = String(text || "").replace(/\s+/g, " ");
  const explicitRange = raw.match(/(\d{1,2}(?::\d{2})?\s*(?:am|pm)|\d{3,4}\s*(?:am|pm))[\s]*(?:to|\-|–|—)[\s]*(\d{1,2}(?::\d{2})?\s*(?:am|pm)|\d{3,4}\s*(?:am|pm))/i);
  if (explicitRange) return { start: normalizeHumanTime(explicitRange[1]), end: normalizeHumanTime(explicitRange[2]) };
  const single = raw.match(/\b(?:at|for|around|after)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)|\d{3,4}\s*(?:am|pm))\b/i);
  if (single) {
    const start = normalizeHumanTime(single[1]);
    if (start) return { start, end: start };
  }
  return null;
}

function normalizeHumanTime(value) {
  const raw = String(value || "").trim().toLowerCase().replace(/\s+/g, "");
  let match = raw.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)$/i);
  if (match) {
    let hour = Number(match[1]);
    const minute = Number(match[2] || "0");
    const meridiem = String(match[3] || "").toLowerCase();
    if (meridiem === "pm" && hour < 12) hour += 12;
    if (meridiem === "am" && hour === 12) hour = 0;
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }
  match = raw.match(/^(\d{3,4})(am|pm)$/i);
  if (match) {
    const digits = match[1];
    const meridiem = String(match[2] || "").toLowerCase();
    let hour = Number(digits.length === 3 ? digits.slice(0, 1) : digits.slice(0, 2));
    const minute = Number(digits.length === 3 ? digits.slice(1) : digits.slice(2));
    if (!Number.isFinite(hour) || !Number.isFinite(minute) || minute > 59) return "";
    if (meridiem === "pm" && hour < 12) hour += 12;
    if (meridiem === "am" && hour === 12) hour = 0;
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }
  return "";
}

function addMinutesToTime(value, minutesToAdd = 0) {
  const raw = String(value || "").trim();
  if (!/^\d{2}:\d{2}$/.test(raw)) return raw;
  const [h, m] = raw.split(":").map(Number);
  const total = Math.max(0, (h * 60) + m + minutesToAdd);
  const hour = Math.floor(total / 60) % 24;
  const minute = total % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function toSafeInt(value, fallback, min = 1, max = 90) {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function getGeminiApiKey() {
  return String(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "").trim();
}

function allowWebSearch({ deviceId = "", identityRole = "" }) {
  const configuredDevices = String(process.env.MEMPHIS_WEB_SEARCH_DEVICE_IDS || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  if (configuredDevices.length && deviceId && configuredDevices.includes(deviceId)) return true;
  return String(identityRole || "").trim().toLowerCase() === "manager";
}

function isGreetingOnly(text = "") {
  const lower = normalizeLoose(text);
  return /^(hi|hey|hello|yo|sup|whats up|what s up|what up|good morning|good afternoon|good evening|howdy)( dude| man| memphis| brother| bro)?$/.test(lower);
}

function isConversationalOpener(text = "") {
  const lower = normalizeLoose(text);
  return /(what up|whats up|what s up|how are you|you getting things figured out|getting things figured out|doing better|you good|hows it going|how s it going|you alive|are you alive|are you connected|connected and alive|hello there|dude what it do)/.test(lower);
}

function isWeatherQuestion(text = "") {
  return /\b(weather|forecast|temperature|rain|storm|sunny|cloudy|wind|humid|humidity)\b/i.test(String(text || ""));
}

function mentionsMemphisPlace(text = "") {
  return /\bmemphis\b/i.test(String(text || ""));
}

function inferWeatherLocation(text = "", threadContext = {}) {
  if (!isWeatherQuestion(text) && threadContext?.last_subject_type !== "weather") return "";
  if (mentionsMemphisPlace(text)) return DEFAULT_WEATHER_LOCATION;
  if (threadContext?.context_json?.weather_location) return String(threadContext.context_json.weather_location || "");
  return DEFAULT_WEATHER_LOCATION;
}

function augmentWeatherPrompt(userMessage = "", threadContext = {}) {
  const location = inferWeatherLocation(userMessage, threadContext);
  if (!location) return userMessage;
  return `${String(userMessage || "").trim()}\n\nWeather location context: ${location}. If the user says \"here\" or asks weather without another city, use ${location}.`;
}

function isGeneralKnowledgeQuestion(text = "") {
  const lower = String(text || "").toLowerCase();
  if (isWeatherQuestion(lower)) return true;
  if (/sparrow|capital of|who invented|how tall|what is the meaning|define |explain |why is the sky|how far|how many/i.test(lower)) return true;
  return false;
}

function shouldTreatAsPureOpener(text = "") {
  const lower = normalizeLoose(text);
  if (isWeatherQuestion(lower)) return false;
  if (/(who|what|when|where|why|how)\b/.test(lower)) return false;
  return isGreetingOnly(text) || (isConversationalOpener(text) && String(text || "").trim().length < 40);
}

function isContradictionFollowUp(text = "") {
  return /(why would you say|that is wrong|you are wrong|that can't be right|that is not right|always off|not on sunday|not sunday|that makes no sense)/i.test(String(text || ""));
}

function openerReply(text = "") {
  const lower = normalizeLoose(text);
  if (/connected/.test(lower)) return "Yeah. I am up and talking. What do you need?";
  if (/alive/.test(lower)) return "Still kicking. What are we checking?";
  if (/figured out|doing better|better/.test(lower)) return "Yeah, better than before. Still ugly in a few corners, but a lot less confused. What do you need?";
  if (/how are you|you good|hows it going|how s it going/.test(lower)) return "Doing alright. Slightly less feral than yesterday. What are you trying to pin down?";
  if (/what up|whats up|what s up|dude what it do/.test(lower)) return "Not much. Just chewing through schedule logic and trying not to embarrass myself. What do you need?";
  return "Hey. What are we trying to solve?";
}

function genericConversationalFallback(text = "", threadContext = {}) {
  const lower = normalizeLoose(text);
  const weatherLocation = inferWeatherLocation(text, threadContext);
  if (/alive|connected/.test(lower)) return "Yeah. I am here and connected enough to answer real system questions. Give me one.";
  if (/sparrow/.test(lower)) return "That depends. African or European?";
  if (/weather/.test(lower)) return `I should be able to answer weather for ${weatherLocation || DEFAULT_WEATHER_LOCATION}, but my general-answer side did not land it cleanly.`;
  if (/hello|hey|hi/.test(lower)) return "Hey. What do you need?";
  return "I am here. Ask me something specific or just talk to me like a person.";
}

function summarizeWeatherPayload(weather) {
  if (!weather) return `I could not pull weather for ${DEFAULT_WEATHER_LOCATION} right now.`;
  const temp = weather.temperature_c == null ? "temperature unavailable" : `${Math.round(Number(weather.temperature_c))}°C`;
  const wind = weather.wind_kmh == null ? "wind unavailable" : `${Math.round(Number(weather.wind_kmh))} km/h wind`;
  const high = weather.high_c == null ? "high unavailable" : `high ${Math.round(Number(weather.high_c))}°C`;
  const low = weather.low_c == null ? "low unavailable" : `low ${Math.round(Number(weather.low_c))}°C`;
  const precip = weather.precipitation_probability == null ? "precipitation unknown" : `${Math.round(Number(weather.precipitation_probability))}% chance of precipitation`;
  const condition = weather.condition || "conditions unavailable";
  return `${weather.location || DEFAULT_WEATHER_LOCATION} today: ${condition}, ${temp}, ${high}, ${low}, ${wind}, ${precip}.`;
}

function inferIntent(text = "") {
  const lower = String(text || "").toLowerCase();
  if (/(my schedule|what am i assigned|what am i doing)/i.test(lower)) return "my_schedule";
  if (/(who is off|who'?s off|absent|covering|fill in|filling in|cover)/i.test(lower)) return "absence_coverage";
  if (/(open segments|what is open|who is open|uncovered|unassigned)/i.test(lower)) return "open_segments";
  if (/(who can cover|who should cover|best backup|best person to cover|coverage candidate)/i.test(lower)) return "coverage_candidates";
  if (/(load|heaviest day|workload|busy)/i.test(lower)) return "employee_load_summary";
  if (/(who owns|current owner|who has)/i.test(lower)) return "current_owner";
  if (/(tickets|maintenance)/i.test(lower)) return "open_tickets";
  if (/(events|event)/i.test(lower)) return "upcoming_events";
  if (/(dashboard|summary|attendance|overdue)/i.test(lower)) return "dashboard_summary";
  if (/(who is assigned|assigned to|schedule for|who has|who cleans|who covers|who works)/i.test(lower)) return "area_schedule";
  return "generic";
}

function findLocationCode(text) {
  const match = String(text || "").match(/\b[A-Z]{3,5}\b/);
  return match ? match[0] : "";
}

function isSystemSpecificQuestion(text = "", threadContext = {}) {
  if (isGeneralKnowledgeQuestion(text)) return false;
  const intent = inferIntent(text);
  if (intent !== "generic") return true;
  if (findLocationCode(text)) return true;
  const lower = String(text || "").toLowerCase();
  if (/(aquarium|zambezi|teton|expo|dashboard|tickets|attendance|schedule|absence|cover|coverage|employee|location|owner|restroom|primate|china|east admin|west admin|breezeway|herpetarium|komodos|nocturnal)/i.test(lower)) return true;
  if (threadContext?.last_subject_type && !["conversation", "generic", "general_knowledge", "weather"].includes(String(threadContext.last_subject_type))) return true;
  return false;
}

function summarizeEvents(events = []) {
  if (!events.length) return "I don't see any upcoming events in the system right now.";
  return events.slice(0, 6).map((event) => {
    const attendees = event.attendee_count == null ? "attendees not listed" : `${event.attendee_count} attendees`;
    return `${event.event_name} in ${event.group_name || event.group_code} on ${event.event_date} from ${event.start_time} to ${event.end_time}, ${attendees}.`;
  }).join(" ");
}

function summarizeAssignments(assignments = [], emptyText) {
  if (!assignments.length) return emptyText;
  return assignments.slice(0, 12).map((row) => {
    const employee = row.employee_name || row.assigned_employee_name || "Open";
    const group = row.group_name || row.group_code || "Unknown area";
    const start = row.coverage_start || "—";
    const end = row.coverage_end || "—";
    return `${employee} covers ${group} from ${start} to ${end}.`;
  }).join(" ");
}

function summarizeEmployeeAssignments(assignments = [], employeeName, serviceDate) {
  if (!assignments.length) return `I couldn't find schedule assignments for ${employeeName} on ${serviceDate}.`;
  return `${employeeName} on ${serviceDate}: ` + assignments.slice(0, 12).map((row) => `${row.group_name || row.group_code || "Unknown area"} from ${row.coverage_start || "—"} to ${row.coverage_end || "—"}`).join("; ") + ".";
}

function summarizeTickets(tickets = [], location = "") {
  if (!tickets.length) return location ? `No open tickets matching ${location}.` : "No open tickets right now.";
  return tickets.slice(0, 8).map((ticket) => `${ticket.location_name || ticket.location_code}: ${ticket.maintenance_issue}.`).join(" ");
}

function summarizeDashboard(snapshot = {}, attention = [], attendance = null) {
  const bits = [];
  if (attendance?.attendance != null) bits.push(`attendance ${attendance.attendance}`);
  if (snapshot.open_ticket_count != null) bits.push(`${snapshot.open_ticket_count} open tickets`);
  if (snapshot.overdue_locations != null) bits.push(`${snapshot.overdue_locations} overdue locations`);
  if (snapshot.due_soon_locations != null) bits.push(`${snapshot.due_soon_locations} due soon`);
  if (snapshot.in_progress_locations != null) bits.push(`${snapshot.in_progress_locations} in progress`);
  const summary = bits.length ? `Dashboard snapshot: ${bits.join(", ")}.` : "Dashboard snapshot is available.";
  const focus = attention.length ? ` Attention locations: ${attention.slice(0, 8).map((row) => `${row.location_name || row.location_code} (${row.status_code}, ${row.open_ticket_count} tickets)`).join("; ")}.` : "";
  return `${summary}${focus}`.trim();
}

function summarizeAbsenceCoverage(data = {}, employeeName = "") {
  const serviceDate = data.service_date || "the requested day";
  const absentPeople = Array.isArray(data.absent_employees) ? data.absent_employees : [];
  const coverage = Array.isArray(data.coverage_rows) ? data.coverage_rows : [];
  const notes = Array.isArray(data.absence_notes) ? data.absence_notes : [];
  if (employeeName) {
    if (!coverage.length) {
      const notesText = notes.length ? ` Notes: ${notes.join(" | ")}` : "";
      return `I couldn't find explicit coverage rows for ${employeeName} on ${serviceDate}.${notesText}`.trim();
    }
    return `${employeeName} on ${serviceDate}: ` + coverage.slice(0, 12).map((row) => `${row.group_name || row.group_code || "Unknown area"} is covered by ${row.assigned_employee_name || "Open"} from ${row.coverage_start || "—"} to ${row.coverage_end || "—"}`).join("; ") + ".";
  }
  if (!absentPeople.length && !notes.length) return `I don't see any absence notes or replacement coverage for ${serviceDate}.`;
  const absentLine = absentPeople.length ? `Absent on ${serviceDate}: ${absentPeople.join(", ")}.` : `Absence notes exist for ${serviceDate}.`;
  const coverageLine = coverage.length ? ` Coverage examples: ${coverage.slice(0, 10).map((row) => `${row.group_name || row.group_code} covered by ${row.assigned_employee_name || "Open"} ${row.coverage_start || "—"}-${row.coverage_end || "—"}`).join("; ")}.` : "";
  return `${absentLine}${coverageLine}`.trim();
}

function summarizeEmployeeProfile(profile = null) {
  if (!profile) return "I couldn't find that employee in the system.";
  const parts = [`${profile.display_name} (${profile.employee_code || "no code"})`];
  if (profile.role) parts.push(`role ${profile.role}`);
  if (profile.device_name) parts.push(`device ${profile.device_name}`);
  if (profile.primary_groups?.length) parts.push(`primary groups: ${profile.primary_groups.join(", ")}`);
  if (profile.secondary_groups?.length) parts.push(`secondary groups: ${profile.secondary_groups.join(", ")}`);
  return parts.join(". ") + ".";
}

function summarizeLocationDetails(data = {}) {
  if (!data?.location) return "I couldn't find that location in the system.";
  const loc = data.location;
  const parts = [`${loc.location_name} (${loc.location_code})`];
  if (loc.location_type) parts.push(`type ${loc.location_type}`);
  if (loc.form_type) parts.push(`form ${loc.form_type}`);
  if (loc.group_names?.length) parts.push(`groups: ${loc.group_names.join(", ")}`);
  if (loc.difficulty_rating != null || loc.priority_rating != null) parts.push(`difficulty ${loc.difficulty_rating ?? "n/a"}, priority ${loc.priority_rating ?? "n/a"}`);
  if (loc.workload_notes) parts.push(`workload notes: ${loc.workload_notes}`);
  if (loc.notes) parts.push(`notes: ${loc.notes}`);
  if (data.current_owner?.owner_display_name || data.current_owner?.employee_name) parts.push(`current owner ${data.current_owner.owner_display_name || data.current_owner.employee_name}`);
  return parts.join(". ") + ".";
}

function summarizeLoadSummary(rows = [], serviceDate = "") {
  if (!rows.length) return `I don't see any employee load rows for ${serviceDate || "that day"}.`;
  return rows.slice(0, 12).map((row) => `${row.employee_name}: ${row.assigned_segments} segments, ${row.assigned_load_points} load points, ${Math.round(Number(row.assigned_minutes || 0))} minutes`).join("; ") + ".";
}

function summarizeOpenSegments(rows = [], serviceDate = "") {
  if (!rows.length) return `I don't see any open segments for ${serviceDate || "that day"}.`;
  return rows.slice(0, 12).map((row) => `${row.group_name || row.group_code} ${row.coverage_start || "—"}-${row.coverage_end || "—"} (${row.reason_open || "open"})`).join("; ") + ".";
}

function summarizeCoverageCandidates(rows = [], groupName = "") {
  if (!rows.length) return `I don't see any eligible coverage candidates for ${groupName || "that segment"}.`;
  return rows.slice(0, 6).map((row, index) => `#${index + 1} ${row.employee_name} scored ${Number(row.recommendation_score || 0).toFixed(1)}. ${row.explanation || ""}`.trim()).join(" ");
}

async function fetchThreadContext(runReadOnlySql, threadId) {
  const normalized = String(threadId || "").trim();
  if (!normalized) return {};
  const rows = await runReadOnlySql(`select public.msg_get_memphis_thread_context('${esc(normalized)}'::uuid) as data`);
  return Array.isArray(rows) && rows.length && rows[0].data ? rows[0].data : {};
}

async function saveThreadContext(runRpc, threadId, context = {}) {
  const normalized = String(threadId || "").trim();
  if (!normalized) return null;
  return await runRpc("msg_set_memphis_thread_context", {
    p_thread_id: normalized,
    p_last_intent: context.last_intent ?? null,
    p_last_employee_name: context.last_employee_name ?? null,
    p_last_group_name: context.last_group_name ?? null,
    p_last_location_code: context.last_location_code ?? null,
    p_last_service_date: context.last_service_date ?? null,
    p_last_subject_type: context.last_subject_type ?? null,
    p_context_json: context.context_json ?? {}
  });
}

async function getDefaultServiceDate(runReadOnlySql) {
  const rows = await runReadOnlySql("select public.sch_service_date(now()) as service_date");
  return Array.isArray(rows) && rows.length ? rows[0].service_date : null;
}

async function getRelativeServiceDate(runReadOnlySql, offsetDays = 0) {
  const safeOffset = Number.isFinite(Number(offsetDays)) ? Number(offsetDays) : 0;
  const rows = await runReadOnlySql(`select public.sch_service_date(now() + interval '${safeOffset} day') as service_date`);
  return Array.isArray(rows) && rows.length ? rows[0].service_date : null;
}

async function getAllAreaRows(runReadOnlySql, serviceDate) {
  const rows = await runReadOnlySql(`
    select distinct location_group_id, group_name, group_code
    from public.v_memphis_area_schedule
    where service_date = '${esc(serviceDate)}'::date
    order by group_name asc, group_code asc
  `);
  return Array.isArray(rows) ? rows : [];
}

function scoreAreaMatch(candidate, rawNeedle) {
  const needle = normalizeLoose(rawNeedle);
  if (!needle) return -1;
  const candidates = [candidate.group_name, candidate.group_code].filter(Boolean).map(normalizeLoose);
  let best = -1;
  for (const value of candidates) {
    if (!value) continue;
    let score = -1;
    if (needle === value) score = 1000 + value.length;
    else if (needle.includes(value)) score = 700 + value.length;
    else if (value.includes(needle)) score = 500 + needle.length;
    else {
      const needleParts = needle.split(/\s+/).filter(Boolean);
      const valueParts = value.split(/\s+/).filter(Boolean);
      const overlap = needleParts.filter((part) => valueParts.includes(part)).length;
      if (overlap) score = (overlap * 80) + value.length;
    }
    if (score > best) best = score;
  }
  return best;
}

async function resolveAreaRow(runReadOnlySql, serviceDate, text = "", threadContext = {}) {
  const raw = String(text || "").trim();
  const contextArea = String(threadContext?.last_group_name || "").trim();
  const source = raw || contextArea;
  if (!source) return null;
  const rows = await getAllAreaRows(runReadOnlySql, serviceDate);
  let best = null;
  for (const row of rows) {
    const score = scoreAreaMatch(row, source);
    if (score < 0) continue;
    if (!best || score > best.score || (score === best.score && String(row.group_name || "").length < String(best.row.group_name || "").length)) {
      best = { row, score };
    }
  }
  return best ? best.row : null;
}

async function fetchAssignedEmployeeForDevice(runReadOnlySql, deviceId) {
  const normalized = String(deviceId || "").trim();
  if (!normalized) return null;
  const rows = await runReadOnlySql(`
    select
      d.device_id,
      d.device_name,
      d.assigned_employee_id,
      e.display_name as assigned_employee_name,
      e.employee_code,
      e.role,
      d.active as device_active,
      coalesce(e.active, false) as employee_active
    from public.devices d
    left join public.employees e on e.id = d.assigned_employee_id
    where d.device_id = '${esc(normalized)}'
    limit 1
  `);
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function fetchDeviceIdentity(runReadOnlySql, deviceId) {
  const normalized = String(deviceId || "").trim();
  if (!normalized) return null;
  const rows = await runReadOnlySql(`select * from public.msg_get_user_by_device('${esc(normalized)}')`);
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function guessEmployeeName(runRpc, text) {
  const raw = String(text || "").trim();
  if (!raw) return "";
  const employees = await runRpc("tool_list_active_employees", {});
  const list = Array.isArray(employees) ? employees : [];
  const lowered = raw.toLowerCase();
  let best = null;
  for (const employee of list) {
    const name = String(employee.display_name || employee.employee_name || "").trim();
    if (!name) continue;
    const nameLower = name.toLowerCase();
    if (lowered.includes(nameLower)) {
      if (!best || name.length > best.length) best = name;
      continue;
    }
    const parts = nameLower.split(/\s+/).filter(Boolean);
    if (parts.length >= 2 && parts.every((part) => lowered.includes(part))) {
      if (!best || name.length > best.length) best = name;
      continue;
    }
    if (parts.length && parts.some((part) => part.length >= 4 && lowered.includes(part))) {
      if (!best || name.length > best.length) best = name;
    }
  }
  return best || "";
}

function mergeContextDate(text, threadContext = {}, explicitServiceDate = null) {
  if (explicitServiceDate) return explicitServiceDate;
  const direct = extractExplicitDate(text);
  if (direct) return direct;
  return threadContext?.last_service_date || null;
}

async function fetchWeatherForMemphisTn(location = DEFAULT_WEATHER_LOCATION) {
  const geoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1&language=en&format=json`);
  const geo = await geoRes.json().catch(() => null);
  const first = geo?.results?.[0];
  if (!first?.latitude || !first?.longitude) throw new Error("Weather geocoding failed");
  const forecastRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(first.latitude)}&longitude=${encodeURIComponent(first.longitude)}&current=temperature_2m,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=1`);
  const forecast = await forecastRes.json().catch(() => null);
  if (!forecast?.current || !forecast?.daily) throw new Error("Weather forecast failed");
  return {
    location,
    temperature_c: forecast.current.temperature_2m,
    wind_kmh: forecast.current.wind_speed_10m,
    high_c: forecast.daily.temperature_2m_max?.[0],
    low_c: forecast.daily.temperature_2m_min?.[0],
    precipitation_probability: forecast.daily.precipitation_probability_max?.[0],
    condition: weatherCodeToText(forecast.current.weather_code)
  };
}

function weatherCodeToText(code) {
  const value = Number(code);
  if (value === 0) return "clear";
  if ([1,2,3].includes(value)) return "partly cloudy";
  if ([45,48].includes(value)) return "foggy";
  if ([51,53,55,56,57].includes(value)) return "drizzle";
  if ([61,63,65,66,67].includes(value)) return "rain";
  if ([71,73,75,77].includes(value)) return "snow";
  if ([80,81,82].includes(value)) return "rain showers";
  if ([85,86].includes(value)) return "snow showers";
  if ([95,96,99].includes(value)) return "thunderstorms";
  return "mixed conditions";
}

async function tryGeminiConversation({ apiKey, userMessage, webEnabled, threadContext }) {
  const locationHint = isWeatherQuestion(userMessage) ? `The default weather location is ${DEFAULT_WEATHER_LOCATION}. If the user says here, local, or weather without another city, use ${DEFAULT_WEATHER_LOCATION}.` : "";
  const priorHint = threadContext?.last_subject_type === "weather" ? `Previous exchange was about weather in ${threadContext?.context_json?.weather_location || DEFAULT_WEATHER_LOCATION}.` : "";
  const systemInstruction = [
    "You are Memphis, a conversational assistant for Memphis Zoo operations.",
    "Be human, natural, and useful.",
    "For casual chat, greetings, follow-up questions, or broad reasoning, answer directly and conversationally.",
    "Do not drift into a canned feature list unless the user explicitly asks what you can do.",
    locationHint,
    priorHint,
    webEnabled
      ? "You may answer broader general questions as a normal online Gemini model would."
      : "Stay focused on conversation and Memphis Zoo context."
  ].filter(Boolean).join(" ");
  const prompt = isWeatherQuestion(userMessage) || threadContext?.last_subject_type === "weather"
    ? augmentWeatherPrompt(userMessage, threadContext)
    : userMessage;
  const response = await fetch(`${GEMINI_BASE_URL}/${encodeURIComponent(DEFAULT_MODEL)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemInstruction }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.65 }
    })
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error?.message || payload?.message || `Gemini HTTP ${response.status}`);
  const parts = payload?.candidates?.[0]?.content?.parts || [];
  return parts.filter((part) => typeof part?.text === "string" && part.text.trim()).map((part) => part.text.trim()).join("\n\n").trim();
}

export function createMemphisResponder({ runReadOnlySql, runRpc }) {
  async function executeTool(name, args = {}) {
    if (name === "get_upcoming_events") {
      const days = toSafeInt(args.days, 14, 1, 60);
      const area = String(args.area || "").trim();
      const rows = await runReadOnlySql(`
        select e.event_name, lg.group_name, lg.group_code, e.event_date, to_char(e.start_time, 'HH24:MI:SS') as start_time, to_char(e.end_time, 'HH24:MI:SS') as end_time, e.attendee_count, e.notes
        from public.events_app_events e
        join public.location_groups lg on lg.id = e.location_group_id
        where e.event_date >= current_date
          and e.event_date <= current_date + ${days}
          ${area ? `and (lg.group_name ilike ${sqlLikeLiteral(area)} or lg.group_code ilike ${sqlLikeLiteral(area)} or lower('${esc(area)}') like '%' || lower(lg.group_name) || '%')` : ""}
        order by e.event_date asc, e.start_time asc, e.event_name asc
      `);
      return { events: rows || [] };
    }

    if (name === "get_area_schedule") {
      const serviceDate = normalizeDate(args.service_date) || await getDefaultServiceDate(runReadOnlySql);
      const target = await resolveAreaRow(runReadOnlySql, serviceDate, String(args.area || "").trim(), {});
      if (!target?.location_group_id) return { service_date: serviceDate, assignments: [] };
      const rows = await runReadOnlySql(`
        select *
        from public.v_memphis_area_schedule
        where service_date = '${esc(serviceDate)}'::date
          and location_group_id = '${esc(target.location_group_id)}'::uuid
        order by group_name asc, segment_number asc
      `);
      return { service_date: serviceDate, assignments: rows || [], group_name: target.group_name || target.group_code };
    }

    if (name === "get_employee_schedule") {
      const employeeName = String(args.employee_name || "").trim();
      const serviceDate = normalizeDate(args.service_date) || await getDefaultServiceDate(runReadOnlySql);
      if (!employeeName) return { service_date: serviceDate, assignments: [] };
      const rows = await runReadOnlySql(`
        select *
        from public.v_memphis_employee_schedule
        where service_date = '${esc(serviceDate)}'::date
          and employee_name ilike ${sqlLikeLiteral(employeeName)}
        order by group_name asc, segment_number asc
      `);
      return { service_date: serviceDate, assignments: rows || [] };
    }

    if (name === "get_my_schedule") {
      const deviceId = String(args.device_id || "").trim();
      const serviceDate = normalizeDate(args.service_date) || await getDefaultServiceDate(runReadOnlySql);
      const assignedEmployee = await fetchAssignedEmployeeForDevice(runReadOnlySql, deviceId);
      if (!assignedEmployee?.assigned_employee_name) return { service_date: serviceDate, employee_name: null, assignments: [] };
      const rows = await runReadOnlySql(`
        select *
        from public.v_memphis_employee_schedule
        where service_date = '${esc(serviceDate)}'::date
          and employee_id = '${esc(assignedEmployee.assigned_employee_id)}'::uuid
        order by group_name asc, segment_number asc
      `);
      return { service_date: serviceDate, employee_name: assignedEmployee.assigned_employee_name, assignments: rows || [] };
    }

    if (name === "get_absence_coverage") {
      const serviceDate = normalizeDate(args.service_date) || await getDefaultServiceDate(runReadOnlySql);
      const employeeName = String(args.employee_name || "").trim();
      const employeeRows = employeeName
        ? await runReadOnlySql(`
            select id, display_name
            from public.employees
            where active = true and display_name ilike ${sqlLikeLiteral(employeeName)}
            order by length(display_name), display_name
            limit 1
          `)
        : [];
      const employee = Array.isArray(employeeRows) && employeeRows.length ? employeeRows[0] : null;
      const coverageRows = await runReadOnlySql(`
        select *
        from public.v_memphis_absence_coverage
        where service_date = '${esc(serviceDate)}'::date
        ${employee ? `and absent_employee_id = '${esc(employee.id)}'::uuid` : ""}
        order by absent_employee_name asc, group_name asc, segment_number asc
      `);
      const noteRows = await runReadOnlySql(`
        select distinct notes
        from public.v_memphis_open_segments
        where service_date = '${esc(serviceDate)}'::date
          and notes is not null and notes <> '' and notes ilike '%off%'
      `);
      const absenceNotes = (noteRows || []).map((row) => row.notes).filter(Boolean);
      return {
        service_date: serviceDate,
        employee_name: employee?.display_name || employeeName || null,
        absent_employees: Array.from(new Set((coverageRows || []).map((row) => row.absent_employee_name).filter(Boolean))),
        absence_notes: absenceNotes,
        coverage_rows: coverageRows || []
      };
    }

    if (name === "get_open_segments") {
      const serviceDate = normalizeDate(args.service_date) || await getDefaultServiceDate(runReadOnlySql);
      const area = String(args.area || "").trim();
      let rows;
      if (area) {
        const target = await resolveAreaRow(runReadOnlySql, serviceDate, area, {});
        if (!target?.location_group_id) return { service_date: serviceDate, open_segments: [] };
        rows = await runReadOnlySql(`
          select *
          from public.v_memphis_open_segments
          where service_date = '${esc(serviceDate)}'::date
            and location_group_id = '${esc(target.location_group_id)}'::uuid
          order by group_name asc, segment_number asc
        `);
      } else {
        rows = await runReadOnlySql(`
          select *
          from public.v_memphis_open_segments
          where service_date = '${esc(serviceDate)}'::date
          order by group_name asc, segment_number asc
        `);
      }
      return { service_date: serviceDate, open_segments: rows || [] };
    }

    if (name === "get_employee_load_summary") {
      const serviceDate = normalizeDate(args.service_date) || await getDefaultServiceDate(runReadOnlySql);
      const employeeName = String(args.employee_name || "").trim();
      const rows = await runReadOnlySql(`
        select *
        from public.v_memphis_employee_load_summary
        where service_date = '${esc(serviceDate)}'::date
        ${employeeName ? `and employee_name ilike ${sqlLikeLiteral(employeeName)}` : ""}
        order by assigned_load_points desc, assigned_segments desc, employee_name asc
      `);
      return { service_date: serviceDate, load_rows: rows || [] };
    }

    if (name === "get_coverage_candidates") {
      const serviceDate = normalizeDate(args.service_date) || await getDefaultServiceDate(runReadOnlySql);
      const area = String(args.area || "").trim();
      const target = await resolveAreaRow(runReadOnlySql, serviceDate, area, {});
      if (!target?.location_group_id) return { service_date: serviceDate, group_name: area, candidates: [] };
      const openRows = await runReadOnlySql(`
        select *
        from public.v_memphis_open_segments
        where service_date = '${esc(serviceDate)}'::date
          and location_group_id = '${esc(target.location_group_id)}'::uuid
        order by segment_number asc
        limit 1
      `);
      const timeWindow = extractTimeWindow(`${args.coverage_start || ""} ${args.coverage_end || ""}`);
      const coverageStart = String(args.coverage_start || openRows?.[0]?.coverage_start || timeWindow?.start || "06:00").slice(0, 5);
      const coverageEnd = String(args.coverage_end || openRows?.[0]?.coverage_end || timeWindow?.end || addMinutesToTime(coverageStart, 60)).slice(0, 5);
      const rows = await runReadOnlySql(`
        select *
        from public.sch_get_coverage_candidates(
          '${esc(serviceDate)}'::date,
          '${esc(target.location_group_id)}'::uuid,
          '${esc(coverageStart)}'::time,
          '${esc(coverageEnd)}'::time
        )
        order by recommendation_score desc, employee_name asc
        limit 10
      `);
      return { service_date: serviceDate, group_name: target.group_name || target.group_code || area, coverage_start: coverageStart, coverage_end: coverageEnd, candidates: rows || [] };
    }

    if (name === "explain_open_segment") {
      const serviceDate = normalizeDate(args.service_date) || await getDefaultServiceDate(runReadOnlySql);
      const area = String(args.area || "").trim();
      const target = await resolveAreaRow(runReadOnlySql, serviceDate, area, {});
      if (!target?.location_group_id) return { service_date: serviceDate, open_segments: [] };
      const rows = await runReadOnlySql(`
        select *
        from public.v_memphis_open_segments
        where service_date = '${esc(serviceDate)}'::date
          and location_group_id = '${esc(target.location_group_id)}'::uuid
        order by segment_number asc
        limit 5
      `);
      return { service_date: serviceDate, open_segments: rows || [] };
    }

    if (name === "get_employee_profile") {
      const employeeName = String(args.employee_name || "").trim();
      const rows = await runReadOnlySql(`
        select
          em.display_name,
          em.employee_code,
          em.role,
          em.active,
          coalesce((
            select array_agg(lg.group_name order by lg.group_name)
            from public.employee_primary_group_assignments epga
            join public.location_groups lg on lg.id = epga.location_group_id
            where epga.active = true and epga.employee_id = em.id
          ), array[]::text[]) as primary_groups,
          coalesce((
            select array_agg(lg.group_name order by lg.group_name)
            from public.employee_location_group_assignments elga
            join public.location_groups lg on lg.id = elga.location_group_id
            where elga.active = true and elga.employee_id = em.id
          ), array[]::text[]) as secondary_groups,
          (
            select d.device_name
            from public.devices d
            where d.active = true and d.assigned_employee_id = em.id
            order by d.device_name
            limit 1
          ) as device_name
        from public.employees em
        where em.display_name ilike ${sqlLikeLiteral(employeeName)}
        order by length(em.display_name), em.display_name
        limit 1
      `);
      return Array.isArray(rows) && rows.length ? rows[0] : null;
    }

    if (name === "get_location_details") {
      const location = String(args.location || "").trim();
      const locationRows = await runReadOnlySql(`
        select
          lm.id,
          lm.location_code,
          lm.location_name,
          lm.location_type,
          lm.form_type,
          lm.active,
          lm.notes,
          lm.difficulty_rating,
          lm.priority_rating,
          lm.workload_notes,
          coalesce(array_agg(distinct lg.group_name) filter (where lg.group_name is not null), array[]::text[]) as group_names
        from (
          select l.id, l.location_code, l.location_name, l.location_type, l.form_type, l.active, l.notes, l.difficulty_rating, l.priority_rating, l.workload_notes
          from public.locations l
          where l.active = true
            and (
              l.location_code ilike ${sqlLikeLiteral(location)}
              or l.location_name ilike ${sqlLikeLiteral(location)}
              or lower('${esc(location)}') like '%' || lower(l.location_code) || '%'
              or lower('${esc(location)}') like '%' || lower(l.location_name) || '%'
            )
          order by case when lower(l.location_code)=lower('${esc(location)}') then 0 else 1 end, length(l.location_name), l.location_name
          limit 1
        ) lm
        left join public.location_group_memberships lgm on lgm.location_id = lm.id and lgm.active = true
        left join public.location_groups lg on lg.id = lgm.location_group_id and lg.active = true
        group by lm.id, lm.location_code, lm.location_name, lm.location_type, lm.form_type, lm.active, lm.notes, lm.difficulty_rating, lm.priority_rating, lm.workload_notes
      `);
      const loc = Array.isArray(locationRows) && locationRows.length ? locationRows[0] : null;
      if (!loc) return { location: null, current_owner: null };
      const ownerRows = await runReadOnlySql(`select * from public.sch_get_current_owner('${esc(loc.location_code)}', now())`);
      return { location: loc, current_owner: Array.isArray(ownerRows) && ownerRows.length ? ownerRows[0] : null };
    }

    if (name === "get_current_owner") {
      const locationCode = String(args.location_code || "").trim();
      const at = String(args.at || "").trim();
      const literal = at ? `'${esc(at)}'::timestamptz` : "now()";
      const rows = await runReadOnlySql(`select * from public.sch_get_current_owner('${esc(locationCode)}', ${literal})`);
      return Array.isArray(rows) && rows.length ? rows[0] : null;
    }

    if (name === "get_open_tickets") {
      const location = String(args.location || "").trim();
      const rows = await runReadOnlySql(`
        select ticket_id, location_code, location_name, maintenance_issue, reported_by, fixture_type, fixture_identifier, out_of_order, date_submitted_display, created_at_display
        from public.v_open_maintenance_tickets
        ${location ? `where location_code ilike ${sqlLikeLiteral(location)} or location_name ilike ${sqlLikeLiteral(location)}` : ""}
        order by date_submitted desc nulls last, created_at desc nulls last
        limit 50
      `);
      return { tickets: rows || [] };
    }

    if (name === "get_dashboard_summary") {
      const [snapshotRows, badRows, attendanceRows] = await Promise.all([
        runReadOnlySql(`select * from public.v_admin_health_snapshot order by snapshot_at desc limit 1`),
        runReadOnlySql(`
          select location_code, location_name, status_code, status_color, open_ticket_count, latest_employee_name, latest_completed_at_display, open_session_status
          from public.v_location_dashboard_status
          where status_code <> 'okay' or open_ticket_count > 0
          order by case status_color when 'red' then 1 when 'yellow' then 2 when 'blue' then 3 else 9 end, open_ticket_count desc, location_name
          limit 15
        `),
        runReadOnlySql(`select attendance, last_year, planned, yesterday, yesterday_plan, fetched_at, updated_at from public.current_attendance_state where id = 1 limit 1`)
      ]);
      return { snapshot: Array.isArray(snapshotRows) && snapshotRows.length ? snapshotRows[0] : {}, attention_locations: badRows || [], attendance: Array.isArray(attendanceRows) && attendanceRows.length ? attendanceRows[0] : null };
    }

    if (name === "get_scan_state") {
      const locationCode = String(args.location_code || "").trim();
      return await runRpc("tool_get_location_scan_state", { p_location_code: locationCode, p_device_id: DEFAULT_SCAN_DEVICE_ID });
    }

    if (name === "list_active_employees") {
      const data = await runRpc("tool_list_active_employees", {});
      return { employees: Array.isArray(data) ? data : [] };
    }

    throw new Error(`Unknown Memphis tool: ${name}`);
  }

  async function generateSystemReply(userMessage, { deviceId = "", threadId = "" } = {}) {
    const text = String(userMessage || "").trim();
    const lower = text.toLowerCase();
    const threadContext = await fetchThreadContext(runReadOnlySql, threadId);
    const todayServiceDate = await getDefaultServiceDate(runReadOnlySql);
    const explicitDate = extractExplicitDate(text);
    const weekdayRef = extractWeekdayReference(text);
    let relativeServiceDate = mergeContextDate(text, threadContext, explicitDate) || todayServiceDate;
    if (!explicitDate && weekdayRef && todayServiceDate) {
      relativeServiceDate = computeWeekdayDate(todayServiceDate, weekdayRef.weekday, weekdayRef.modifier) || relativeServiceDate;
    } else if (!explicitDate && !weekdayRef) {
      const relativeOffset = inferRelativeDateOffset(text);
      if (relativeOffset !== 0) relativeServiceDate = await getRelativeServiceDate(runReadOnlySql, relativeOffset);
    }
    const assignedEmployee = await fetchAssignedEmployeeForDevice(runReadOnlySql, deviceId);

    if (shouldTreatAsPureOpener(text)) {
      const subjectType = isWeatherQuestion(text) ? "weather" : "conversation";
      await saveThreadContext(runRpc, threadId, { last_intent: "conversation", last_service_date: relativeServiceDate, last_subject_type: subjectType, context_json: subjectType === "weather" ? { weather_location: inferWeatherLocation(text, threadContext) || DEFAULT_WEATHER_LOCATION } : {} });
      return { text: openerReply(text), meta: { fallback: true, mode: "local_conversation" } };
    }

    if (isWeatherQuestion(text)) {
      const location = inferWeatherLocation(text, threadContext) || DEFAULT_WEATHER_LOCATION;
      try {
        const weather = await fetchWeatherForMemphisTn(location);
        await saveThreadContext(runRpc, threadId, { last_intent: "weather", last_service_date: relativeServiceDate, last_subject_type: "weather", context_json: { weather_location: location } });
        return { text: summarizeWeatherPayload(weather), meta: { fallback: true, mode: "local_weather_direct" } };
      } catch (error) {
        await saveThreadContext(runRpc, threadId, { last_intent: "weather", last_service_date: relativeServiceDate, last_subject_type: "weather", context_json: { weather_location: location } });
        return { text: `I could not pull live weather for ${location} right now.`, meta: { fallback: true, mode: "local_weather_failed", error: error?.message || "weather_failed" } };
      }
    }

    if (isContradictionFollowUp(text) && threadContext?.last_group_name && threadContext?.last_service_date) {
      return {
        text: `You are right to challenge that. I should have been using ${threadContext.last_service_date} for ${threadContext.last_group_name}, and if Karen Robinson and Kathy Phelps are always off Sunday, that earlier answer was wrong. Ask me the area again and I will re-run it cleanly.`,
        meta: { fallback: true, mode: "local_contradiction_followup" }
      };
    }

    if (lower.includes("event")) {
      const areaRow = await resolveAreaRow(runReadOnlySql, relativeServiceDate, text, threadContext);
      const data = await executeTool("get_upcoming_events", { days: 14, area: areaRow?.group_name || "" });
      await saveThreadContext(runRpc, threadId, { last_intent: "upcoming_events", last_group_name: areaRow?.group_name || null, last_service_date: relativeServiceDate, last_subject_type: "group" });
      return { text: summarizeEvents(data.events), meta: { fallback: true, mode: "local_events" } };
    }

    if (lower.includes("ticket")) {
      const data = await executeTool("get_open_tickets", { location: findLocationCode(text) || text });
      await saveThreadContext(runRpc, threadId, { last_intent: "open_tickets", last_location_code: findLocationCode(text) || null, last_service_date: relativeServiceDate, last_subject_type: "location" });
      return { text: summarizeTickets(data.tickets, findLocationCode(text)), meta: { fallback: true, mode: "local_tickets" } };
    }

    if (/(absent|off|cover|covering|fill|filling)/i.test(lower) && !isContradictionFollowUp(text)) {
      const employeeName = await guessEmployeeName(runRpc, text) || threadContext?.last_employee_name || "";
      const data = await executeTool("get_absence_coverage", { employee_name: employeeName, service_date: relativeServiceDate });
      await saveThreadContext(runRpc, threadId, { last_intent: "absence_coverage", last_employee_name: employeeName || null, last_service_date: relativeServiceDate, last_subject_type: "employee" });
      return { text: summarizeAbsenceCoverage(data, employeeName), meta: { fallback: true, mode: "local_absence_coverage" } };
    }

    if ((lower.includes("my schedule") || lower === "schedule" || lower.includes("what am i assigned") || lower.includes("what am i doing today")) && assignedEmployee?.assigned_employee_name) {
      const data = await executeTool("get_my_schedule", { device_id: deviceId, service_date: relativeServiceDate });
      await saveThreadContext(runRpc, threadId, { last_intent: "my_schedule", last_employee_name: data.employee_name || assignedEmployee.assigned_employee_name, last_service_date: relativeServiceDate, last_subject_type: "employee" });
      return { text: summarizeEmployeeAssignments(data.assignments, data.employee_name || assignedEmployee.assigned_employee_name, data.service_date), meta: { fallback: true, mode: "local_my_schedule" } };
    }

    if (/(who can cover|who should cover|best backup|best person to cover|coverage candidate)/i.test(lower)) {
      const areaRow = await resolveAreaRow(runReadOnlySql, relativeServiceDate, text, threadContext);
      const timeWindow = extractTimeWindow(text) || {};
      const data = await executeTool("get_coverage_candidates", { service_date: relativeServiceDate, area: areaRow?.group_name || text, coverage_start: timeWindow.start, coverage_end: timeWindow.end });
      await saveThreadContext(runRpc, threadId, { last_intent: "coverage_candidates", last_group_name: areaRow?.group_name || null, last_service_date: relativeServiceDate, last_subject_type: "group", context_json: { coverage_start: data.coverage_start || null, coverage_end: data.coverage_end || null } });
      return { text: summarizeCoverageCandidates(data.candidates, data.group_name || areaRow?.group_name || text), meta: { fallback: true, mode: "local_coverage_candidates" } };
    }

    if (/(open segments|what is open|what's open|uncovered|unassigned)/i.test(lower)) {
      const areaRow = await resolveAreaRow(runReadOnlySql, relativeServiceDate, text, threadContext);
      const data = await executeTool("get_open_segments", { service_date: relativeServiceDate, area: areaRow?.group_name || "" });
      await saveThreadContext(runRpc, threadId, { last_intent: "open_segments", last_group_name: areaRow?.group_name || null, last_service_date: relativeServiceDate, last_subject_type: "group" });
      return { text: summarizeOpenSegments(data.open_segments, data.service_date), meta: { fallback: true, mode: "local_open_segments" } };
    }

    if (/(load|workload|heaviest|busy)/i.test(lower)) {
      const employeeName = await guessEmployeeName(runRpc, text) || threadContext?.last_employee_name || "";
      const data = await executeTool("get_employee_load_summary", { service_date: relativeServiceDate, employee_name: employeeName });
      await saveThreadContext(runRpc, threadId, { last_intent: "employee_load_summary", last_employee_name: employeeName || null, last_service_date: relativeServiceDate, last_subject_type: employeeName ? "employee" : "summary" });
      return { text: summarizeLoadSummary(data.load_rows, data.service_date), meta: { fallback: true, mode: "local_load_summary" } };
    }

    if (/(why is .* open|why is .* uncovered|why open)/i.test(lower)) {
      const areaRow = await resolveAreaRow(runReadOnlySql, relativeServiceDate, text, threadContext);
      const data = await executeTool("explain_open_segment", { service_date: relativeServiceDate, area: areaRow?.group_name || text });
      await saveThreadContext(runRpc, threadId, { last_intent: "explain_open_segment", last_group_name: areaRow?.group_name || null, last_service_date: relativeServiceDate, last_subject_type: "group" });
      if (!data.open_segments?.length) return { text: `I do not see an open segment for ${areaRow?.group_name || text} on ${relativeServiceDate}.`, meta: { fallback: true, mode: "local_explain_open" } };
      return { text: summarizeOpenSegments(data.open_segments, data.service_date), meta: { fallback: true, mode: "local_explain_open" } };
    }

    if (lower.includes("employee") || lower.includes("role") || lower.includes("device")) {
      const employeeName = await guessEmployeeName(runRpc, text) || threadContext?.last_employee_name || "";
      if (employeeName) {
        const profile = await executeTool("get_employee_profile", { employee_name: employeeName });
        await saveThreadContext(runRpc, threadId, { last_intent: "employee_profile", last_employee_name: employeeName, last_service_date: relativeServiceDate, last_subject_type: "employee" });
        return { text: summarizeEmployeeProfile(profile), meta: { fallback: true, mode: "local_employee_profile" } };
      }
    }

    if (lower.includes("location") || lower.includes("where is") || lower.includes("what is") || lower.includes("tell me about")) {
      const code = findLocationCode(text) || threadContext?.last_location_code || "";
      const query = code || text || threadContext?.last_group_name || "";
      const data = await executeTool("get_location_details", { location: query });
      if (data?.location) {
        await saveThreadContext(runRpc, threadId, { last_intent: "location_details", last_group_name: data.location.location_name || null, last_location_code: data.location.location_code || null, last_service_date: relativeServiceDate, last_subject_type: "location" });
        return { text: summarizeLocationDetails(data), meta: { fallback: true, mode: "local_location_details" } };
      }
    }

    if (lower.includes("owner") || lower.includes("who owns") || lower.includes("who has")) {
      const code = findLocationCode(text) || threadContext?.last_location_code || "";
      if (code) {
        const owner = await executeTool("get_current_owner", { location_code: code });
        await saveThreadContext(runRpc, threadId, { last_intent: "current_owner", last_location_code: code, last_service_date: relativeServiceDate, last_subject_type: "location" });
        if (!owner) return { text: `I could not find a current owner for ${code}.`, meta: { fallback: true, mode: "local_owner" } };
        return { text: `${owner.location_name || owner.location_code || code} is currently owned by ${owner.owner_display_name || owner.employee_name || "nobody listed"}.`, meta: { fallback: true, mode: "local_owner" } };
      }
    }

    if (lower.includes("scan") || lower.includes("state")) {
      const code = findLocationCode(text) || threadContext?.last_location_code || "";
      if (code) {
        const stateValue = await executeTool("get_scan_state", { location_code: code });
        await saveThreadContext(runRpc, threadId, { last_intent: "scan_state", last_location_code: code, last_service_date: relativeServiceDate, last_subject_type: "location" });
        return { text: `${stateValue.location_name || stateValue.location_code || code} is currently ${stateValue.suggested_action || stateValue.status || "available"}.`, meta: { fallback: true, mode: "local_scan" } };
      }
    }

    if (lower.includes("schedule") || lower.includes("assigned") || lower.includes("working") || lower.includes("aquarium") || lower.includes("restroom") || lower.includes("zambezi") || lower.includes("teton") || lower.includes("expo") || lower.includes("cleans")) {
      const employeeName = await guessEmployeeName(runRpc, text) || threadContext?.last_employee_name || "";
      if (employeeName) {
        const data = await executeTool("get_employee_schedule", { employee_name: employeeName, service_date: relativeServiceDate });
        await saveThreadContext(runRpc, threadId, { last_intent: "employee_schedule", last_employee_name: employeeName, last_service_date: relativeServiceDate, last_subject_type: "employee" });
        return { text: summarizeEmployeeAssignments(data.assignments, employeeName, data.service_date), meta: { fallback: true, mode: "local_employee_schedule" } };
      }
      const areaRow = await resolveAreaRow(runReadOnlySql, relativeServiceDate, text, threadContext);
      const data = await executeTool("get_area_schedule", { area: areaRow?.group_name || text, service_date: relativeServiceDate });
      await saveThreadContext(runRpc, threadId, { last_intent: "area_schedule", last_group_name: areaRow?.group_name || data.group_name || null, last_service_date: relativeServiceDate, last_subject_type: "group" });
      return { text: summarizeAssignments(data.assignments, `I couldn't find schedule assignments for ${areaRow?.group_name || text} on ${data.service_date}.`), meta: { fallback: true, mode: "local_area_schedule" } };
    }

    if (lower.includes("dashboard") || lower.includes("summary") || lower.includes("status") || lower.includes("metrics") || lower.includes("attendance")) {
      const data = await executeTool("get_dashboard_summary", {});
      await saveThreadContext(runRpc, threadId, { last_intent: "dashboard_summary", last_service_date: relativeServiceDate, last_subject_type: "summary" });
      return { text: summarizeDashboard(data.snapshot, data.attention_locations, data.attendance), meta: { fallback: true, mode: "local_dashboard" } };
    }

    const weatherLocation = inferWeatherLocation(text, threadContext);
    const subjectType = isWeatherQuestion(text) ? "weather" : (isGeneralKnowledgeQuestion(text) ? "general_knowledge" : "generic");
    await saveThreadContext(runRpc, threadId, { last_intent: inferIntent(text), last_service_date: relativeServiceDate, last_subject_type: subjectType, context_json: weatherLocation ? { weather_location: weatherLocation } : {} });
    return { text: genericConversationalFallback(text, threadContext), meta: { fallback: true, mode: "local_generic" } };
  }

  async function generateReply({ deviceId = "", userMessage = "", threadId = "" }) {
    const apiKey = getGeminiApiKey();
    const identity = await fetchDeviceIdentity(runReadOnlySql, deviceId);
    const webEnabled = allowWebSearch({ deviceId, identityRole: identity?.role || "" });
    const threadContext = await fetchThreadContext(runReadOnlySql, threadId);
    const explicitSystem = isSystemSpecificQuestion(userMessage, threadContext);

    if (!apiKey || explicitSystem) {
      return await generateSystemReply(userMessage, { deviceId, threadId });
    }

    if (isWeatherQuestion(userMessage)) {
      const location = inferWeatherLocation(userMessage, threadContext) || DEFAULT_WEATHER_LOCATION;
      try {
        const weather = await fetchWeatherForMemphisTn(location);
        await saveThreadContext(runRpc, threadId, { last_intent: "weather", last_subject_type: "weather", context_json: { weather_location: location } });
        return { text: summarizeWeatherPayload(weather), meta: { fallback: false, provider: "weather_direct", mode: "conversation_weather_direct" } };
      } catch (error) {
        console.error("memphis direct weather path failed:", error);
      }
    }

    try {
      const text = await tryGeminiConversation({ apiKey, userMessage, webEnabled, threadContext });
      if (text && !/^i can help with /i.test(text.trim())) {
        const subjectType = isWeatherQuestion(userMessage) ? "weather" : (isGeneralKnowledgeQuestion(userMessage) ? "general_knowledge" : "conversation");
        const weatherLocation = inferWeatherLocation(userMessage, threadContext);
        await saveThreadContext(runRpc, threadId, { last_intent: "conversation", last_subject_type: subjectType, context_json: weatherLocation ? { weather_location: weatherLocation } : {} });
        return { text, meta: { fallback: false, provider: "gemini", model: DEFAULT_MODEL, mode: "conversation_first" } };
      }
    } catch (error) {
      console.error("memphis conversation gemini path failed:", error);
    }

    return await generateSystemReply(userMessage, { deviceId, threadId });
  }

  return { generateReply };
}
