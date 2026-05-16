import {
  addMinutesToTime,
  answerEmployeeWeeklyScheduleQuestion,
  answerInternalContactQuestion,
  answerOpsManagerScheduleQuestion,
  computeWeekdayDate,
  esc,
  extractExplicitDate,
  extractTimeWindow,
  extractWeekdayReference,
  findLocationCode,
  generateDailyStaffScheduleReply,
  hasLocationKeyword,
  generateWeeklyScheduleReply,
  inferRelativeDateOffset,
  isSystemSpecificQuestion,
  normalizeDate,
  normalizeLoose,
  sqlLikeLiteral,
  toSafeInt,
  DEFAULT_WEATHER_LOCATION as SHARED_DEFAULT_WEATHER_LOCATION,
  augmentWeatherPrompt as sharedAugmentWeatherPrompt,
  fetchWeatherForMemphisTn as sharedFetchWeatherForMemphisTn,
  inferWeatherLocation as sharedInferWeatherLocation,
  isWeatherQuestion as sharedIsWeatherQuestion,
  mentionsMemphisPlace as sharedMentionsMemphisPlace,
  summarizeEmployeeWorkStatus as sharedSummarizeEmployeeWorkStatus,
  summarizeWeatherPayload as sharedSummarizeWeatherPayload,
  weekdayNameForIsoDate as sharedWeekdayNameForIsoDate,
  employeeTokenMatchScore as sharedEmployeeTokenMatchScore,
  fetchRecentThreadMessages as sharedFetchRecentThreadMessages,
  fetchThreadContext as sharedFetchThreadContext,
  formatRecentThreadMessages as sharedFormatRecentThreadMessages,
  guessEmployeeName as sharedGuessEmployeeName,
  levenshteinDistance as sharedLevenshteinDistance,
  mergeContextJson as sharedMergeContextJson,
  normalizeEmployeeMatchText as sharedNormalizeEmployeeMatchText,
  resolveEmployeeByLooseName as sharedResolveEmployeeByLooseName,
  saveThreadContext as sharedSaveThreadContext,
  scoreEmployeeNameMatch as sharedScoreEmployeeNameMatch,
} from "./ai/index.js";

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_MODEL = String(process.env.MEMPHIS_GEMINI_MODEL || process.env.GEMINI_MODEL || "gemini-2.5-flash").trim();
const DEFAULT_SCAN_DEVICE_ID = "memphis-bot";
const DEFAULT_WEATHER_LOCATION = SHARED_DEFAULT_WEATHER_LOCATION;
const GEMINI_TIMEOUT_MS = Number.parseInt(String(process.env.MEMPHIS_GEMINI_TIMEOUT_MS || "12000"), 10);
const GEMINI_MAX_OUTPUT_TOKENS = Number.parseInt(String(process.env.MEMPHIS_GEMINI_MAX_OUTPUT_TOKENS || "900"), 10);



function getGeminiApiKey() {
  return String(
    process.env.GEMINI_API_KEY ||
    process.env.MEMPHIS_GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.GOOGLE_GENAI_API_KEY ||
    process.env.EVENTS_GEMINI_API_KEY ||
    ""
  ).trim();
}

async function fetchWithTimeout(url, options = {}, timeoutMs = GEMINI_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs) || 12000));
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
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

function isSelfIdentityQuestion(text = "") {
  return /^(who am i|what is my name|what's my name|whats my name)$/i.test(String(text || "").trim());
}

function isMemphisIdentityQuestion(text = "") {
  return /^(what is your name|what's your name|whats your name|your name|who are you|what are you)$/i.test(String(text || "").trim());
}

function isConversationalOpener(text = "") {
  const lower = normalizeLoose(text);
  return /(what up|whats up|what s up|how are you|you getting things figured out|getting things figured out|doing better|you good|hows it going|how s it going|you alive|are you alive|are you connected|connected and alive|hello there|dude what it do|who are you|what are you)/.test(lower);
}

function isWeatherQuestion(text = "") {
  return sharedIsWeatherQuestion(text);
}

function isRecipeQuestion(text = "") {
  return /\b(recipe|ingredients|cook|cooking|bake|baking|homemade|pie|pretzel|pretzels|creme brulee|crème brûlée|cake|cookies|bread|sauce|soup)\b/i.test(String(text || ""));
}

function isBroadGeneralQuestion(text = "") {
  return isGeneralKnowledgeQuestion(text) || /\b(tell me about|teach me|what causes|how do i|how do you|how to|why does|why do|what is|what are|who invented|history of)\b/i.test(String(text || ""));
}

function isContactLookupPrompt(text = "") {
  const lower = normalizeLoose(text);
  if (!lower) return false;
  if (findLocationCode(text) || hasLocationKeyword(text)) return false;

  if (/\b(phone|number|contact|call|text|reach|boss|director|supervisor)\b/.test(lower)) return true;
  if (/\b(eric|operle|brandy|gull|haley|lejman|jennifer|sheffield)\b/.test(lower)) return true;
  if (/\b(who is|who are|who s|whos|who's)\b/.test(lower) && /\b(ops manager|operations manager|manager|managers|custodial manager|horticulture manager|water quality manager|facilities manager)\b/.test(lower)) return true;

  return false;
}

function isNamedOpsPersonPrompt(text = "") {
  const lower = normalizeLoose(text);
  return /\b(eric|operle|brandy|gull|haley|lejman|jennifer|sheffield)\b/.test(lower);
}

function hasExplicitDayOrRelativeDate(text = "") {
  const lower = normalizeLoose(text);
  return /\b(today|tomorrow|yesterday|sunday|monday|tuesday|wednesday|thursday|friday|saturday|next week|this week)\b/.test(lower) || Boolean(extractExplicitDate(text));
}

function isNamedRegularOpsSchedulePrompt(text = "") {
  const lower = normalizeLoose(text);
  if (!isNamedOpsPersonPrompt(text)) return false;
  if (hasExplicitDayOrRelativeDate(text)) return false;
  return /\b(when does|what days|which days|regular|normal|weekly|standing|schedule|work again|works again)\b/.test(lower);
}

function isOpsManagerSchedulePrompt(text = "") {
  const lower = normalizeLoose(text);
  if (!lower) return false;
  if (findLocationCode(text) || hasLocationKeyword(text)) return false;

  const mentionsOps =
    /\b(ops|operations|manager|boss|director|custodial manager|horticulture manager|water quality manager)\b/.test(lower) ||
    isNamedOpsPersonPrompt(text);

  const asksSchedule =
    /\b(schedule|work|works|working|shift|shifts|on duty|duty|coverage|cover|covers|today|tomorrow|sunday|monday|tuesday|wednesday|thursday|friday|saturday|again)\b/.test(lower);

  return Boolean(mentionsOps && asksSchedule);
}

function isEmployeeAreaQuestion(text = "") {
  const lower = normalizeLoose(text);
  if (!lower) return false;
  return /\b(area|areas|assignment|assignments|assigned|where|who has|who covers|who owns|current owner|clean|cleans|cleaning|who cleans)\b/.test(lower);
}

function mentionsMemphisPlace(text = "") {
  return sharedMentionsMemphisPlace(text);
}

function hasDateReference(text = "") {
  const raw = String(text || "");
  return Boolean(extractExplicitDate(raw) || inferRelativeDateOffset(raw) || extractWeekdayReference(raw));
}

function inferWeatherLocation(text = "", threadContext = {}) {
  return sharedInferWeatherLocation(text, threadContext);
}

function augmentWeatherPrompt(userMessage = "", threadContext = {}) {
  return sharedAugmentWeatherPrompt(userMessage, threadContext);
}

function isGeneralKnowledgeQuestion(text = "") {
  const lower = String(text || "").toLowerCase();
  if (isWeatherQuestion(lower)) return true;
  if (isRecipeQuestion(lower)) return true;
  if (/sparrow|swallow|air speed velocity|capital of|who invented|how tall|what is the meaning|define |definition of|explain |why is the sky|how far|how many|science of|history of|recipe|ingredients|cook|bake|pumpkin pie|creme brulee|pretzel|pretzels/i.test(lower)) return true;
  return false;
}

function shouldTreatAsPureOpener(text = "") {
  const lower = normalizeLoose(text);
  if (isWeatherQuestion(lower)) return false;
  if (isGreetingOnly(text) || (isConversationalOpener(text) && String(text || "").trim().length < 40)) return true;
  if (/(who|what|when|where|why|how)\b/.test(lower)) return false;
  return false;
}

function isContradictionFollowUp(text = "") {
  return /(why would you say|that is wrong|you are wrong|that can't be right|that is not right|always off|not on sunday|not sunday|that makes no sense)/i.test(String(text || ""));
}

function shouldUseEmployeeContext(text = "") {
  const lower = normalizeLoose(text);
  if (!lower) return false;
  if (hasLocationKeyword(text)) return false;
  return /\b(she|he|they|them|that person|same person|where was|where is|assigned today|assigned tomorrow)\b/.test(lower);
}

function normalizeEmployeeMatchText(value = "") {
  return sharedNormalizeEmployeeMatchText(value);
}

function levenshteinDistance(a = "", b = "") {
  const left = String(a || "");
  const right = String(b || "");
  if (left === right) return 0;
  if (!left) return right.length;
  if (!right) return left.length;

  const previous = Array.from({ length: right.length + 1 }, (_value, index) => index);
  const current = Array(right.length + 1).fill(0);

  for (let i = 1; i <= left.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + cost
      );
    }
    for (let j = 0; j <= right.length; j += 1) previous[j] = current[j];
  }

  return previous[right.length];
}

function employeeTokenMatchScore(queryToken = "", nameToken = "") {
  const query = normalizeEmployeeMatchText(queryToken);
  const name = normalizeEmployeeMatchText(nameToken);
  if (!query || !name) return 0;
  if (query === name) return 40;
  if (query.length >= 3 && name.startsWith(query)) return 30;
  if (name.length >= 3 && query.startsWith(name)) return 28;
  if (query.length >= 4 && name.includes(query)) return 24;
  if (name.length >= 4 && query.includes(name)) return 22;

  const distance = levenshteinDistance(query, name);
  const maxLength = Math.max(query.length, name.length);
  if (maxLength >= 5 && distance <= 1) return 25;
  if (maxLength >= 7 && distance <= 2) return 18;
  return 0;
}

function scoreEmployeeNameMatch(userText = "", displayName = "") {
  const query = normalizeEmployeeMatchText(userText);
  const name = normalizeEmployeeMatchText(displayName);
  if (!query || !name) return 0;
  if (query.includes(name)) return 1000 + name.length;

  const nameTokens = name.split(/\s+/).filter(Boolean);
  const queryTokens = query.split(/\s+/).filter(Boolean);
  let score = 0;

  for (const nameToken of nameTokens) {
    let bestTokenScore = 0;
    for (const queryToken of queryTokens) {
      bestTokenScore = Math.max(bestTokenScore, employeeTokenMatchScore(queryToken, nameToken));
    }
    score += bestTokenScore;
  }

  const firstName = nameTokens[0] || "";
  const lastName = nameTokens[nameTokens.length - 1] || "";
  if (firstName && queryTokens.some((token) => employeeTokenMatchScore(token, firstName) >= 18)) score += 80;
  if (lastName && queryTokens.some((token) => employeeTokenMatchScore(token, lastName) >= 22)) score += 40;

  return score;
}

function weekdayNameForIsoDate(serviceDate = "") {
  const date = new Date(`${serviceDate}T12:00:00`);
  if (Number.isNaN(date.getTime())) return "that day";
  return sharedWeekdayNameForIsoDate(serviceDate);
}

function openerReply(text = "") {
  const lower = normalizeLoose(text);
  if (/\bwho are you\b/.test(lower)) return "I am Memphis. I help with schedules, area coverage, contacts, tickets, scans, and day-of operations questions for the zoo.";
  if (/\bwhat are you\b/.test(lower)) return "I am Memphis, the zoo operations assistant. Ask me about who covers an area, schedules, contacts, tickets, scans, or events.";
  if (/connected/.test(lower)) return "Yeah. I am connected. What do you need?";
  if (/alive/.test(lower)) return "Yeah. I am here. What are we checking?";
  if (/figured out|doing better|better/.test(lower)) return "Yeah, better than before. What do you need?";
  if (/how are you|you good|hows it going|how s it going/.test(lower)) return "Doing alright. What are you trying to pin down?";
  if (/what up|whats up|what s up|dude what it do/.test(lower)) return "Not much. What do you need?";
  return "Hey. What are we trying to solve?";
}

function genericConversationalFallback(text = "", threadContext = {}) {
  const lower = normalizeLoose(text);
  const weatherLocation = inferWeatherLocation(text, threadContext);
  if (/\bwho are you\b/.test(lower)) return "I am Memphis. I help with schedules, area coverage, contacts, tickets, scans, and day-of operations questions for the zoo.";
  if (/\bwhat are you\b/.test(lower)) return "I am Memphis, the zoo operations assistant. Ask me about who covers an area, schedules, contacts, tickets, scans, or events.";
  if (/alive|connected/.test(lower)) return "Yeah. I am here and ready for system questions.";
  if (/sparrow/.test(lower)) return "That depends. African or European?";
  if (/weather/.test(lower)) return `I could not land a clean weather answer for ${weatherLocation || DEFAULT_WEATHER_LOCATION} right now.`;
  if (/recipe|ingredients|cook|bake|pumpkin pie|creme brulee|pretzel|pretzels/.test(lower)) return "I did not get a clean general-answer response for that recipe question. Check the Gemini/API setup and try again.";
  if (/hello|hey|hi/.test(lower)) return "Hey. What do you need?";
  return "I am here and ready. Ask me a schedule, area, contact, ticket, scan, or events question.";
}

function mergeContextJson(threadContext = {}, patch = {}) {
  return {
    ...(threadContext?.context_json && typeof threadContext.context_json === "object" ? threadContext.context_json : {}),
    ...(patch && typeof patch === "object" ? patch : {}),
  };
}

function formatLead(label, value) {
  return `${label}: ${value}.`;
}

function joinBullets(lines = []) {
  return lines.filter(Boolean).join(" ");
}

function summarizeWeatherPayload(weather) {
  return sharedSummarizeWeatherPayload(weather, DEFAULT_WEATHER_LOCATION);
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

function summarizeEmployeeWorkStatus(status = {}) {
  return sharedSummarizeEmployeeWorkStatus(status);
}

function summarizeEmployeeAssignments(assignments = [], employeeName, serviceDate, staticShift = null) {
  const resolvedName = staticShift?.employee_name || employeeName || "That employee";
  const weekday = weekdayNameForIsoDate(serviceDate);

  if (!assignments.length) {
    if (staticShift?.scheduled_off) {
      return `${resolvedName} is off on ${weekday}, ${serviceDate}.`;
    }

    if (staticShift?.employee_name) {
      const start = String(staticShift.shift_start || "—").slice(0, 5);
      const end = String(staticShift.shift_end || "—").slice(0, 5);
      const lunch = String(staticShift.notes || "").match(/Lunch\s+([^\.]+)\./i)?.[1];
      return `${resolvedName} is scheduled to work on ${weekday}, ${serviceDate} from ${start} to ${end}${lunch ? `, lunch ${lunch}` : ""}, but area assignments have not been generated yet.`;
    }

    return `I couldn't find schedule assignments for ${resolvedName} on ${weekday}, ${serviceDate}.`;
  }

  return `${resolvedName} on ${weekday}, ${serviceDate}: ` + assignments.slice(0, 12).map((row) => `${row.group_name || row.group_code || "Unknown area"} from ${row.coverage_start || "—"} to ${row.coverage_end || "—"}`).join("; ") + ".";
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

function formatAttendanceTimestamp(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit", month: "short", day: "numeric" });
}

function summarizeAttendance(attendance = null, queryText = "") {
  if (!attendance || attendance.attendance == null) return "I don't have a current attendance count available right now.";

  const lower = normalizeLoose(queryText);
  const updated = formatAttendanceTimestamp(attendance.updated_at || attendance.fetched_at);
  const updatedText = updated ? ` Last updated ${updated}.` : "";

  if (lower.includes("yesterday")) {
    if (attendance.yesterday != null) return `Yesterday's attendance was ${Number(attendance.yesterday).toLocaleString()} guests.${updatedText}`;
    return `I don't have yesterday's attendance available yet. Today's attendance so far is ${Number(attendance.attendance).toLocaleString()} guests.${updatedText}`;
  }

  if (lower.includes("planned") || lower.includes("plan")) {
    if (lower.includes("yesterday") && attendance.yesterday_plan != null) return `Yesterday's planned attendance was ${Number(attendance.yesterday_plan).toLocaleString()} guests.${updatedText}`;
    if (attendance.planned != null) return `Today's planned attendance is ${Number(attendance.planned).toLocaleString()} guests. Current attendance so far is ${Number(attendance.attendance).toLocaleString()} guests.${updatedText}`;
    return `I don't have planned attendance available yet. Today's attendance so far is ${Number(attendance.attendance).toLocaleString()} guests.${updatedText}`;
  }

  if (lower.includes("last year") || lower.includes("last-year")) {
    if (attendance.last_year != null) return `Attendance on this day last year was ${Number(attendance.last_year).toLocaleString()} guests.${updatedText}`;
    return `I don't have last year's comparison attendance available yet. Today's attendance so far is ${Number(attendance.attendance).toLocaleString()} guests.${updatedText}`;
  }

  const parts = [`Today's attendance so far is ${Number(attendance.attendance).toLocaleString()} guests`];
  if (attendance.planned != null) parts.push(`planned attendance is ${Number(attendance.planned).toLocaleString()}`);
  if (attendance.last_year != null) parts.push(`last year was ${Number(attendance.last_year).toLocaleString()}`);
  if (attendance.yesterday != null) parts.push(`yesterday was ${Number(attendance.yesterday).toLocaleString()}`);
  if (attendance.yesterday_plan != null) parts.push(`yesterday's plan was ${Number(attendance.yesterday_plan).toLocaleString()}`);

  return `${parts.join(". ")}.${updatedText}`;
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

async function fetchRecentThreadMessages(runReadOnlySql, threadId, limit = 10) {
  const normalized = String(threadId || "").trim();
  if (!normalized) return [];
  const safeLimit = Math.min(Math.max(Number.parseInt(String(limit), 10) || 10, 2), 20);
  const rows = await runReadOnlySql(`
    select message_type, body
    from (
      select sent_at, message_type, body
      from public.msg_messages
      where thread_id = '${esc(normalized)}'::uuid
        and message_type in ('text', 'bot_response')
        and body is not null
        and trim(body) <> ''
      order by sent_at desc
      limit ${safeLimit}
    ) recent
    order by sent_at asc
  `);
  return Array.isArray(rows) ? rows : [];
}

function formatRecentThreadMessages(messages = []) {
  const lines = messages
    .map((row) => {
      const speaker = row.message_type === "bot_response" ? "Memphis" : "User";
      const body = String(row.body || "").replace(/\s+/g, " ").trim();
      return body ? `${speaker}: ${body}` : "";
    })
    .filter(Boolean)
    .slice(-10);
  return lines.length ? `Recent thread context:\n${lines.join("\n")}` : "";
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
    p_context_json: context.context_json ?? {},
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

function addDaysToIsoDate(serviceDate, daysToAdd = 0) {
  const base = new Date(`${serviceDate}T12:00:00`);
  if (Number.isNaN(base.getTime())) return serviceDate;
  base.setDate(base.getDate() + Number(daysToAdd || 0));
  return base.toISOString().slice(0, 10);
}

function buildScheduleDateRange(startDate, days = 7) {
  return Array.from({ length: days }, (_value, index) => addDaysToIsoDate(startDate, index));
}

function daysBetweenIsoDates(fromDate, toDate) {
  const from = new Date(`${String(fromDate || "")}T12:00:00`);
  const to = new Date(`${String(toDate || "")}T12:00:00`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
  return Math.round((to.getTime() - from.getTime()) / 86400000);
}

function shiftIsoDate(serviceDate, daysToAdd = 0) {
  return addDaysToIsoDate(serviceDate, daysToAdd);
}

function isWeeklyScheduleQuestion(text = "") {
  const raw = String(text || "");
  const lower = normalizeLoose(raw);
  return /\b(entire week|whole week|this week|next week|weekly|week schedule|all week|for the week)\b/i.test(raw)
    || (lower.includes("week") && /\b(who|where|schedule|assigned|works|working|staff|staffing)\b/.test(lower));
}

function getWeekStartDate(text = "", todayServiceDate, relativeServiceDate) {
  if (/\bnext week\b/i.test(String(text || ""))) return addDaysToIsoDate(todayServiceDate || relativeServiceDate, 7);
  return relativeServiceDate || todayServiceDate;
}

async function ensureDailySchedule(runRpc, serviceDate, { force = false } = {}) {
  try {
    return await runRpc("sch_generate_daily_schedule", { p_service_date: serviceDate, p_force: force });
  } catch (error) {
    console.error("memphis schedule generation failed:", serviceDate, error);
    return null;
  }
}

async function ensureScheduleRange(runRpc, dates = [], { force = false } = {}) {
  for (const serviceDate of dates) {
    await ensureDailySchedule(runRpc, serviceDate, { force });
  }
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

async function getAllAreaRows(runReadOnlySql, _serviceDate = "") {
  const groupRows = await runReadOnlySql("select lg.id as location_group_id, lg.group_name, lg.group_code, coalesce(array_agg(a.alias_text order by a.alias_text) filter (where a.alias_text is not null), array[]::text[]) as aliases from public.location_groups lg left join public.location_group_aliases a on a.location_group_id = lg.id and a.active = true where lg.active = true group by lg.id, lg.group_name, lg.group_code order by lg.group_name asc, lg.group_code asc");
  return Array.isArray(groupRows) ? groupRows : [];
}

function scoreAreaMatch(candidate, rawNeedle) {
  const needle = normalizeLoose(rawNeedle);
  if (!needle) return -1;
  const candidates = [candidate.group_name, candidate.group_code].concat(candidate.aliases || []).filter(Boolean).map(normalizeLoose);
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

function normalizeAreaPrompt(text = "", threadContext = {}) {
  const raw = String(text || "").trim();
  if (!raw) return String(threadContext?.last_group_name || "").trim();
  let rewritten = raw;
  rewritten = rewritten
    .replace(/\blomodos\b/ig, "komodos")
    .replace(/\bkomodo\b/ig, "komodos")
    .replace(/\bcathouse cafe restrooms\b/ig, "cathouse")
    .replace(/\bcat house cafe restrooms\b/ig, "cat house");
  if (/^(how about|what about)\b/i.test(rewritten) && String(threadContext?.last_group_name || "").trim()) {
    return `${threadContext.last_group_name} ${rewritten}`;
  }
  return rewritten;
}

function isFollowUpPrompt(text = "") {
  const raw = String(text || "").trim();
  if (!raw) return false;
  return /^(what about|how about|and what about|and|tomorrow|today|yesterday|next week|this week|next|this|same|what about tomorrow|what about today|how about tomorrow|how about today)\b/i.test(raw)
    || /^(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(raw);
}

function rewriteFollowUpWithContext(text = "", threadContext = {}) {
  const raw = String(text || "").trim();
  if (!isFollowUpPrompt(raw)) return raw;

  const lastIntent = String(threadContext?.last_intent || "").trim();
  const lastGroupName = String(threadContext?.last_group_name || "").trim();
  const lastEmployeeName = String(threadContext?.last_employee_name || "").trim();
  const lastLocationCode = String(threadContext?.last_location_code || "").trim();
  const lastQuestionShape = String(threadContext?.context_json?.last_question_shape || "").trim();
  const lastSubjectKind = String(threadContext?.context_json?.last_subject_kind || "").trim();

  if ((lastIntent === "current_owner" || lastQuestionShape === "current_owner") && (lastGroupName || lastLocationCode)) {
    const ownerSubject = lastSubjectKind === "group" && lastGroupName
      ? lastGroupName
      : (lastLocationCode || lastGroupName);
    return `who has ${ownerSubject} ${raw}`;
  }

  if ((lastIntent === "employee_schedule" || lastQuestionShape === "employee_schedule") && lastEmployeeName) {
    return `${lastEmployeeName} ${raw}`;
  }

  if ((lastIntent === "my_schedule" || lastQuestionShape === "my_schedule")) {
    return `my schedule ${raw}`;
  }

  if ((lastIntent === "location_details" || lastQuestionShape === "location_details") && lastLocationCode) {
    return `tell me about ${lastLocationCode} ${raw}`;
  }

  if ((lastIntent === "area_schedule" || lastQuestionShape === "area_schedule" || threadContext?.last_subject_type === "group") && lastGroupName) {
    return `${lastGroupName} ${raw}`;
  }

  return raw;
}

async function resolveAreaRow(runReadOnlySql, serviceDate, text = "", threadContext = {}) {
  const raw = normalizeAreaPrompt(text, threadContext);
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

async function resolveLocationRow(runReadOnlySql, text = "", threadContext = {}) {
  const raw = String(text || "").trim();
  const contextCode = String(threadContext?.last_location_code || "").trim();
  const source = findLocationCode(raw) || raw || contextCode;
  if (!source) return null;
  const rows = await runReadOnlySql(`
    select l.id, l.location_code, l.location_name, l.location_type, l.form_type, l.active,
      coalesce(array_agg(distinct lg.group_name) filter (where lg.group_name is not null), array[]::text[]) as group_names
    from public.locations l
    left join public.location_group_memberships lgm on lgm.location_id = l.id and lgm.active = true
    left join public.location_groups lg on lg.id = lgm.location_group_id and lg.active = true
    where l.active = true and (
      l.location_code ilike ${sqlLikeLiteral(source)}
      or l.location_name ilike ${sqlLikeLiteral(source)}
      or lower(${sqlLikeLiteral(source)}) like '%' || lower(l.location_code) || '%'
      or lower(${sqlLikeLiteral(source)}) like '%' || lower(l.location_name) || '%'
      or exists (
        select 1
        from public.location_group_memberships lgm2
        join public.location_groups lg2 on lg2.id = lgm2.location_group_id and lg2.active = true
        left join public.location_group_aliases lga2 on lga2.location_group_id = lg2.id and lga2.active = true
        where lgm2.location_id = l.id
          and lgm2.active = true
          and (
            lg2.group_name ilike ${sqlLikeLiteral(source)}
            or lg2.group_code ilike ${sqlLikeLiteral(source)}
            or coalesce(lga2.alias_text, '') ilike ${sqlLikeLiteral(source)}
            or lower(${sqlLikeLiteral(source)}) like '%' || lower(lg2.group_name) || '%'
            or lower(${sqlLikeLiteral(source)}) like '%' || lower(lg2.group_code) || '%'
            or lower(${sqlLikeLiteral(source)}) like '%' || lower(coalesce(lga2.alias_text, '')) || '%'
          )
      )
    )
    group by l.id, l.location_code, l.location_name, l.location_type, l.form_type, l.active
    order by case when lower(l.location_code)=lower(${sqlLikeLiteral(source)}) then 0 when lower(l.location_name)=lower(${sqlLikeLiteral(source)}) then 1 else 2 end,
             length(l.location_name), l.location_name
    limit 1
  `);
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function summarizeOwnerQuestion(runReadOnlySql, runRpc, serviceDate, todayServiceDate, text = "", threadContext = {}) {
  const location = await resolveLocationRow(runReadOnlySql, text, threadContext);
  const futureOffset = daysBetweenIsoDates(todayServiceDate, serviceDate);
  if (location?.location_code && (futureOffset == null || futureOffset <= 0)) {
    const ownerRows = await runReadOnlySql(`select * from public.sch_get_current_owner('${esc(location.location_code)}', now())`);
    const owner = Array.isArray(ownerRows) && ownerRows.length ? ownerRows[0] : null;
    if (owner?.owner_display_name || owner?.employee_name) {
      return `Current owner: ${owner.owner_display_name || owner.employee_name}. Location: ${location.location_name || location.location_code}. Coverage: ${owner.coverage_start || '—'}-${owner.coverage_end || '—'}.`;
    }
  }

  const areaRow = await resolveAreaRow(runReadOnlySql, serviceDate, text, threadContext);
  if (!areaRow?.group_name) return "";
  if (futureOffset != null && futureOffset >= 0 && futureOffset < 7) {
    await ensureDailySchedule(runRpc, serviceDate, { force: true });
  }
  let rows = [];
  if (areaRow?.location_group_id) {
    rows = await runReadOnlySql(`select * from public.v_memphis_area_schedule where service_date = '${esc(serviceDate)}'::date and location_group_id = '${esc(areaRow.location_group_id)}'::uuid order by coverage_start asc, segment_number asc`);
  }
  if (!Array.isArray(rows) || !rows.length) {
    rows = await runReadOnlySql(`select * from public.v_memphis_area_schedule where service_date = '${esc(serviceDate)}'::date and (group_name ilike ${sqlLikeLiteral(areaRow.group_name)} or group_code ilike ${sqlLikeLiteral(areaRow.group_code || areaRow.group_name)}) order by coverage_start asc, segment_number asc`);
  }
  rows = Array.isArray(rows) ? rows : [];
  let assignments = rows.filter((row) => row.employee_name || row.assigned_employee_name);
  if (!assignments.length && futureOffset != null && futureOffset > 0 && futureOffset < 7) {
    let fallbackRows = [];
    if (areaRow?.location_group_id) {
      fallbackRows = await runReadOnlySql(`select * from public.v_memphis_area_schedule where service_date = '${esc(shiftIsoDate(serviceDate, -7))}'::date and location_group_id = '${esc(areaRow.location_group_id)}'::uuid order by coverage_start asc, segment_number asc`);
    }
    if (!Array.isArray(fallbackRows) || !fallbackRows.length) {
      fallbackRows = await runReadOnlySql(`select * from public.v_memphis_area_schedule where service_date = '${esc(shiftIsoDate(serviceDate, -7))}'::date and (group_name ilike ${sqlLikeLiteral(areaRow.group_name)} or group_code ilike ${sqlLikeLiteral(areaRow.group_code || areaRow.group_name)}) order by coverage_start asc, segment_number asc`);
    }
    assignments = (Array.isArray(fallbackRows) ? fallbackRows : []).filter((row) => row.employee_name || row.assigned_employee_name).map((row) => ({ ...row, service_date: serviceDate }));
  }
  if (!assignments.length) {
    if (futureOffset != null && futureOffset > 0) return `I do not see generated schedule assignments for ${areaRow.group_name} on ${serviceDate} yet.`;
    return `I could not find an assignment for ${areaRow.group_name} on ${serviceDate}.`;
  }
  const lines = assignments.slice(0, 4).map((row) => `${row.employee_name || row.assigned_employee_name} ${row.coverage_start || '—'}-${row.coverage_end || '—'}`);
  const label = areaRow.group_name || location?.location_name || "that area";
  return `${label}: ${lines.join('; ')}.`;
}

async function fetchAssignedEmployeeForDevice(runReadOnlySql, deviceId) {
  const normalized = String(deviceId || "").trim();
  if (!normalized) return null;
  const rows = await runReadOnlySql(`select d.device_id,d.device_name,d.assigned_employee_id,e.display_name as assigned_employee_name,e.employee_code,e.role,d.active as device_active,coalesce(e.active, false) as employee_active from public.devices d left join public.employees e on e.id = d.assigned_employee_id where d.device_id = '${esc(normalized)}' limit 1`);
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function fetchDeviceIdentity(runReadOnlySql, deviceId) {
  const normalized = String(deviceId || "").trim();
  if (!normalized) return null;
  const rows = await runReadOnlySql(`select * from public.msg_get_user_by_device('${esc(normalized)}')`);
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function resolveEmployeeByLooseName(runReadOnlySql, employeeName = "") {
  const rawName = String(employeeName || "").trim();
  if (!rawName) return null;

  const rows = await runReadOnlySql(`
    select public.sch_resolve_employee_ref('${esc(rawName)}') as data
  `);
  const resolved = Array.isArray(rows) && rows.length ? rows[0].data : null;

  if (!resolved?.ok || !resolved.employee_id) return null;

  return {
    id: resolved.employee_id,
    display_name: resolved.employee_name,
    employee_code: resolved.employee_code,
    role: resolved.role,
    match_source: resolved.match_source,
    matched_text: resolved.matched_text,
    score: resolved.score,
  };
}

async function fetchStaticEmployeeShift(runReadOnlySql, employeeName = "", serviceDate = "") {
  const rawDate = String(serviceDate || "").trim();
  if (!String(employeeName || "").trim() || !rawDate) return null;

  const employee = await resolveEmployeeByLooseName(runReadOnlySql, employeeName);
  if (!employee?.id) return null;

  const rows = await runReadOnlySql(`
    select e.display_name as employee_name, est.shift_start, est.shift_end, est.notes
    from public.employee_shift_templates est
    join public.employees e on e.id = est.employee_id
    where est.active = true
      and e.active = true
      and e.id = '${esc(employee.id)}'::uuid
      and est.day_of_week = extract(dow from '${esc(rawDate)}'::date)::int
    order by est.shift_start
    limit 1
  `);

  if (Array.isArray(rows) && rows.length) return rows[0];

  return {
    employee_name: employee.display_name,
    scheduled_off: true,
    service_date: rawDate,
  };
}

async function guessEmployeeName(runRpc, text) {
  const raw = String(text || "").trim();
  if (!raw) return "";
  const employees = await runRpc("tool_list_active_employees", {});
  const list = Array.isArray(employees) ? employees : [];
  let best = null;
  let bestScore = 0;

  for (const employee of list) {
    const name = String(employee.display_name || employee.employee_name || "").trim();
    if (!name) continue;
    const score = scoreEmployeeNameMatch(raw, name);
    if (score > bestScore) {
      best = name;
      bestScore = score;
    }
  }

  return bestScore >= 70 ? best : "";
}

function mergeContextDate(text, threadContext = {}, explicitServiceDate = null) {
  if (explicitServiceDate) return explicitServiceDate;
  const direct = extractExplicitDate(text);
  if (direct) return direct;
  return threadContext?.last_service_date || null;
}

async function fetchWeatherForMemphisTn(location = DEFAULT_WEATHER_LOCATION) {
  return await sharedFetchWeatherForMemphisTn(location);
}

function weatherCodeToText(code) {
  const value = Number(code);
  if (value === 0) return "clear";
  if ([1, 2, 3].includes(value)) return "partly cloudy";
  if ([45, 48].includes(value)) return "foggy";
  if ([51, 53, 55, 56, 57].includes(value)) return "drizzle";
  if ([61, 63, 65, 66, 67].includes(value)) return "rain";
  if ([71, 73, 75, 77].includes(value)) return "snow";
  if ([80, 81, 82].includes(value)) return "rain showers";
  if ([85, 86].includes(value)) return "snow showers";
  if ([95, 96, 99].includes(value)) return "thunderstorms";
  return "mixed conditions";
}

async function tryGeminiConversation({ apiKey, userMessage, webEnabled, threadContext, recentMessages = [] }) {
  const generalKnowledge = isBroadGeneralQuestion(userMessage);
  const locationHint = isWeatherQuestion(userMessage) ? `The default weather location is ${DEFAULT_WEATHER_LOCATION}. If the user says here, local, or asks weather without another city, use ${DEFAULT_WEATHER_LOCATION}.` : "";
  const priorHint = threadContext?.last_subject_type === "weather" ? `Previous exchange was about weather in ${threadContext?.context_json?.weather_location || DEFAULT_WEATHER_LOCATION}.` : "";
  const systemInstruction = [
    "You are Memphis, a conversational assistant for Memphis Zoo operations.",
    "Be human, natural, concise, and useful.",
    "For casual chat, greetings, follow-up questions, or broad reasoning, answer directly and conversationally.",
    "If the question is general knowledge, food, cooking, a recipe, definitions, history, science, or practical advice, answer it directly instead of saying it is outside zoo operations.",
    "When recent thread context is provided, use it to understand follow-ups, callbacks, jokes, quotes, and implied references.",
    "For casual conversation, first check whether the current message and recent messages form a known quote, pop culture reference, running bit, pun, or callback; if so, briefly identify it and play along.",
    "Do not drift into a canned feature list unless the user explicitly asks what you can do.",
    "Do not claim access to internal Memphis Zoo records unless the local system tools supplied that information.",
    locationHint,
    priorHint,
    (webEnabled || generalKnowledge) ? "You may answer broader general questions as a normal Gemini model would." : "Stay focused on conversation and Memphis Zoo context.",
  ].filter(Boolean).join(" ");
  const recentContext = formatRecentThreadMessages(recentMessages);
  const promptBase = isWeatherQuestion(userMessage) || threadContext?.last_subject_type === "weather" ? augmentWeatherPrompt(userMessage, threadContext) : userMessage;
  const prompt = recentContext ? `${recentContext}\n\nCurrent user message: ${promptBase}` : promptBase;
  const response = await fetchWithTimeout(`${GEMINI_BASE_URL}/${encodeURIComponent(DEFAULT_MODEL)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemInstruction }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: generalKnowledge ? 0.55 : 0.65, maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS },
    }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error?.message || payload?.message || `Gemini HTTP ${response.status}`);
  const parts = payload?.candidates?.[0]?.content?.parts || [];
  return parts.filter((part) => typeof part?.text === "string" && part.text.trim()).map((part) => part.text.trim()).join("\n\n").trim();
}

export function createMemphisResponder({ runReadOnlySql, runRpc }) {
  async function fetchFallbackAreaAssignments(locationGroupId, serviceDate) {
    const fallbackDate = shiftIsoDate(serviceDate, -7);
    const rows = await runReadOnlySql(`
      select *
      from public.v_memphis_area_schedule
      where service_date = '${esc(fallbackDate)}'::date
        and location_group_id = '${esc(locationGroupId)}'::uuid
      order by group_name asc, segment_number asc
    `);
    return (Array.isArray(rows) ? rows : []).map((row) => ({ ...row, service_date: serviceDate }));
  }

  async function fetchFallbackEmployeeAssignments(employeeName, serviceDate) {
    const fallbackDate = shiftIsoDate(serviceDate, -7);
    const rows = await runReadOnlySql(`
      select *
      from public.v_memphis_employee_schedule
      where service_date = '${esc(fallbackDate)}'::date
        and employee_name ilike ${sqlLikeLiteral(employeeName)}
      order by group_name asc, segment_number asc
    `);
    return (Array.isArray(rows) ? rows : []).map((row) => ({ ...row, service_date: serviceDate }));
  }

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
      let rows = await runReadOnlySql(`
        select *
        from public.v_memphis_area_schedule
        where service_date = '${esc(serviceDate)}'::date
          and location_group_id = '${esc(target.location_group_id)}'::uuid
        order by group_name asc, segment_number asc
      `);
      rows = Array.isArray(rows) ? rows : [];
      if (!rows.length) rows = await fetchFallbackAreaAssignments(target.location_group_id, serviceDate);
      return { service_date: serviceDate, assignments: rows || [], group_name: target.group_name || target.group_code };
    }

    if (name === "get_employee_work_status") {
      const employeeName = String(args.employee_name || "").trim();
      const serviceDate = normalizeDate(args.service_date) || await getDefaultServiceDate(runReadOnlySql);
      if (!employeeName) return { ok: false, service_date: serviceDate, work_status: "unknown_employee", reason: "employee_name_required" };

      const employee = await resolveEmployeeByLooseName(runReadOnlySql, employeeName);
      if (!employee?.id) {
        return { ok: false, service_date: serviceDate, employee_name: employeeName, work_status: "unknown_employee", reason: "employee_not_resolved" };
      }

      const rows = await runReadOnlySql(`
        select public.sch_get_employee_work_status(
          '${esc(serviceDate)}'::date,
          '${esc(employee.id)}'::uuid
        ) as data
      `);
      return Array.isArray(rows) && rows.length ? rows[0].data : { ok: false, service_date: serviceDate, employee_name: employee.display_name, work_status: "unknown", reason: "status_lookup_failed" };
    }

    if (name === "get_employee_schedule") {
      const employeeName = String(args.employee_name || "").trim();
      const serviceDate = normalizeDate(args.service_date) || await getDefaultServiceDate(runReadOnlySql);
      if (!employeeName) return { service_date: serviceDate, assignments: [] };
      let rows = await runReadOnlySql(`
        select *
        from public.v_memphis_employee_schedule
        where service_date = '${esc(serviceDate)}'::date
          and employee_name ilike ${sqlLikeLiteral(employeeName)}
        order by group_name asc, segment_number asc
      `);
      rows = Array.isArray(rows) ? rows : [];
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
      const employeeRows = employeeName ? await runReadOnlySql(`
            select id, display_name
            from public.employees
            where active = true and display_name ilike ${sqlLikeLiteral(employeeName)}
            order by length(display_name), display_name
            limit 1
          `) : [];
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
        coverage_rows: coverageRows || [],
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
      return {
        service_date: serviceDate,
        group_name: target.group_name || target.group_code || area,
        coverage_start: coverageStart,
        coverage_end: coverageEnd,
        candidates: rows || [],
      };
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
        runReadOnlySql(`select attendance, last_year, planned, yesterday, yesterday_plan, fetched_at, updated_at from public.current_attendance_state where id = 1 limit 1`),
      ]);
      return {
        snapshot: Array.isArray(snapshotRows) && snapshotRows.length ? snapshotRows[0] : {},
        attention_locations: badRows || [],
        attendance: Array.isArray(attendanceRows) && attendanceRows.length ? attendanceRows[0] : null,
      };
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
    const threadContext = await fetchThreadContext(runReadOnlySql, threadId);
    const rewrittenMessage = rewriteFollowUpWithContext(userMessage, threadContext);
    const text = String(rewrittenMessage || "").trim();
    const lower = text.toLowerCase();
    const todayServiceDate = await getDefaultServiceDate(runReadOnlySql);
    const explicitDate = extractExplicitDate(text);
    const explicitToday = /\btoday\b/i.test(text);
    const weekdayRef = extractWeekdayReference(text);
    let relativeServiceDate = explicitToday ? todayServiceDate : (mergeContextDate(text, threadContext, explicitDate) || todayServiceDate);
    if (!explicitDate && weekdayRef && todayServiceDate) {
      relativeServiceDate = computeWeekdayDate(todayServiceDate, weekdayRef.weekday, weekdayRef.modifier) || relativeServiceDate;
    } else if (!explicitDate && !weekdayRef) {
      const relativeOffset = inferRelativeDateOffset(text);
      if (relativeOffset !== 0) relativeServiceDate = await getRelativeServiceDate(runReadOnlySql, relativeOffset);
    }
    const futureWindowOffset = daysBetweenIsoDates(todayServiceDate, relativeServiceDate);
    if (futureWindowOffset != null && futureWindowOffset >= 0 && futureWindowOffset < 7) {
      await ensureScheduleRange(runRpc, buildScheduleDateRange(todayServiceDate, 7), { force: true });
    }
    const assignedEmployee = await fetchAssignedEmployeeForDevice(runReadOnlySql, deviceId);

    if (/(schedule|assigned|assignment|assignments|area|areas|works|working|scheduled|staff|staffing|teton|aquarium|restroom|zambezi|expo|cleans|cover|coverage|open segment|uncovered|unassigned)/i.test(text)) {
      await ensureDailySchedule(runRpc, relativeServiceDate);
    }

    if (isWeeklyScheduleQuestion(text)) {
      const weekly = await generateWeeklyScheduleReply({ runReadOnlySql, runRpc, text, todayServiceDate, relativeServiceDate });
      await saveThreadContext(runRpc, threadId, { last_intent: "weekly_staff_schedule", last_service_date: weekly.meta?.dates?.[0] || relativeServiceDate, last_subject_type: "summary", context_json: { dates: weekly.meta?.dates || [] } });
      return weekly;
    }

    if (shouldTreatAsPureOpener(text)) {
      const subjectType = isWeatherQuestion(text) ? "weather" : "conversation";
      await saveThreadContext(runRpc, threadId, {
        last_intent: "conversation",
        last_service_date: relativeServiceDate,
        last_subject_type: subjectType,
        context_json: mergeContextJson(threadContext, subjectType === "weather"
          ? { weather_location: inferWeatherLocation(text, threadContext) || DEFAULT_WEATHER_LOCATION, last_question_shape: "conversation" }
          : { last_question_shape: "conversation" }),
      });
      return { text: openerReply(text), meta: { fallback: true, mode: "local_conversation" } };
    }

    if (isWeatherQuestion(text)) {
      const location = inferWeatherLocation(text, threadContext) || DEFAULT_WEATHER_LOCATION;
      try {
        const weather = await fetchWeatherForMemphisTn(location);
        await saveThreadContext(runRpc, threadId, {
          last_intent: "weather",
          last_service_date: relativeServiceDate,
          last_subject_type: "weather",
          context_json: mergeContextJson(threadContext, { weather_location: location, last_question_shape: "weather" }),
        });
        return { text: summarizeWeatherPayload(weather), meta: { fallback: true, mode: "local_weather_direct" } };
      } catch (error) {
        await saveThreadContext(runRpc, threadId, {
          last_intent: "weather",
          last_service_date: relativeServiceDate,
          last_subject_type: "weather",
          context_json: mergeContextJson(threadContext, { weather_location: location, last_question_shape: "weather" }),
        });
        return { text: `I could not pull live weather for ${location} right now.`, meta: { fallback: true, mode: "local_weather_failed", error: error?.message || "weather_failed" } };
      }
    }

    if (isSelfIdentityQuestion(text)) {
      const assignedEmployee = deviceId ? await fetchAssignedEmployeeForDevice(runReadOnlySql, deviceId) : null;
      const identity = deviceId ? await fetchDeviceIdentity(runReadOnlySql, deviceId) : null;
      const name = assignedEmployee?.assigned_employee_name || identity?.display_name || identity?.user_name || "";
      if (name) {
        await saveThreadContext(runRpc, threadId, { last_intent: "self_identity", last_employee_name: name, last_subject_type: "employee", context_json: mergeContextJson(threadContext, { last_question_shape: "self_identity", last_subject_kind: "employee", last_subject_label: name }) });
        return { text: `You are ${name}.`, meta: { fallback: true, mode: "local_self_identity" } };
      }
      return { text: "I do not have your assigned identity on this device yet.", meta: { fallback: true, mode: "local_self_identity_missing" } };
    }

    if (isContradictionFollowUp(text) && threadContext?.last_group_name && threadContext?.last_service_date) {
      return {
        text: `You are right to challenge that. I should have been using ${threadContext.last_service_date} for ${threadContext.last_group_name}, and if Karen Robinson and Kathy Phelps are always off Sunday, that earlier answer was wrong. Ask me the area again and I will re-run it cleanly.`,
        meta: { fallback: true, mode: "local_contradiction_followup" },
      };
    }

    if (lower.includes("event") || lower.includes("upcoming") || lower.includes("coming up")) {
      const areaRow = await resolveAreaRow(runReadOnlySql, relativeServiceDate, text, threadContext);
      const eventArea = areaRow?.group_name === "Event Center" && !/\b(event center|event centre|ec)\b/i.test(text) ? "" : (areaRow?.group_name || "");
      const data = await executeTool("get_upcoming_events", { days: 14, area: eventArea });
      await saveThreadContext(runRpc, threadId, { last_intent: "upcoming_events", last_group_name: areaRow?.group_name || null, last_service_date: relativeServiceDate, last_subject_type: "group", context_json: mergeContextJson(threadContext, { last_question_shape: "upcoming_events", last_subject_kind: "group", last_subject_label: areaRow?.group_name || null }) });
      return { text: summarizeEvents(data.events), meta: { fallback: true, mode: "local_events" } };
    }

    if (lower.includes("ticket")) {
      const data = await executeTool("get_open_tickets", { location: findLocationCode(text) || text });
      await saveThreadContext(runRpc, threadId, { last_intent: "open_tickets", last_location_code: findLocationCode(text) || null, last_service_date: relativeServiceDate, last_subject_type: "location" });
      return { text: summarizeTickets(data.tickets, findLocationCode(text)), meta: { fallback: true, mode: "local_tickets" } };
    }

    if (/(pto|p\s*t\s*o|time off|callout|call out|sick|vacation|absent|absence|absences|off|out on|out today|out tomorrow|who is out|who's out|cover|covering|fill|filling)/i.test(lower) && !isContradictionFollowUp(text)) {
      const employeeName = await guessEmployeeName(runRpc, text) || (shouldUseEmployeeContext(text) ? threadContext?.last_employee_name : "") || "";
      const data = await executeTool("get_absence_coverage", { employee_name: employeeName, service_date: relativeServiceDate });
      await saveThreadContext(runRpc, threadId, { last_intent: "absence_coverage", last_employee_name: employeeName || null, last_service_date: relativeServiceDate, last_subject_type: "employee" });
      return { text: summarizeAbsenceCoverage(data, employeeName), meta: { fallback: true, mode: "local_absence_coverage" } };
    }

    if ((lower.includes("my schedule") || lower === "schedule" || lower.includes("what am i assigned") || lower.includes("what am i doing today")) && assignedEmployee?.assigned_employee_name) {
      const data = await executeTool("get_my_schedule", { device_id: deviceId, service_date: relativeServiceDate });
      await saveThreadContext(runRpc, threadId, { last_intent: "my_schedule", last_employee_name: data.employee_name || assignedEmployee.assigned_employee_name, last_service_date: relativeServiceDate, last_subject_type: "employee", context_json: mergeContextJson(threadContext, { last_question_shape: "my_schedule", last_subject_kind: "employee", last_subject_label: data.employee_name || assignedEmployee.assigned_employee_name }) });
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
      const employeeName = await guessEmployeeName(runRpc, text) || (shouldUseEmployeeContext(text) ? threadContext?.last_employee_name : "") || "";
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
      const employeeName = await guessEmployeeName(runRpc, text) || (shouldUseEmployeeContext(text) ? threadContext?.last_employee_name : "") || "";
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
      const locationRow = await resolveLocationRow(runReadOnlySql, text, threadContext);
      const areaRow = await resolveAreaRow(runReadOnlySql, relativeServiceDate, text, threadContext);
      const explicitLocationCode = findLocationCode(text);
      const shouldTreatAsLocationOwner = Boolean(!areaRow?.group_name && (explicitLocationCode || locationRow?.location_code));
      const ownerText = await summarizeOwnerQuestion(runReadOnlySql, runRpc, relativeServiceDate, todayServiceDate, text, threadContext);
      await saveThreadContext(runRpc, threadId, {
        last_intent: "current_owner",
        last_location_code: shouldTreatAsLocationOwner ? (locationRow?.location_code || explicitLocationCode || threadContext?.last_location_code || null) : null,
        last_group_name: areaRow?.group_name || locationRow?.group_names?.[0] || threadContext?.last_group_name || null,
        last_service_date: relativeServiceDate,
        last_subject_type: shouldTreatAsLocationOwner ? "location" : "group",
        context_json: mergeContextJson(threadContext, {
          last_question_shape: "current_owner",
          last_subject_kind: shouldTreatAsLocationOwner ? "location" : "group",
          last_subject_label: shouldTreatAsLocationOwner
            ? (locationRow?.location_code || explicitLocationCode || areaRow?.group_name || locationRow?.group_names?.[0] || threadContext?.last_group_name || null)
            : (areaRow?.group_name || locationRow?.group_names?.[0] || threadContext?.last_group_name || null),
        })
      });
      if (ownerText) return { text: ownerText, meta: { fallback: true, mode: "local_owner" } };
    }

    if (lower.includes("scan") || lower.includes("state")) {
      const code = findLocationCode(text) || threadContext?.last_location_code || "";
      if (code) {
        const stateValue = await executeTool("get_scan_state", { location_code: code });
        await saveThreadContext(runRpc, threadId, { last_intent: "scan_state", last_location_code: code, last_service_date: relativeServiceDate, last_subject_type: "location" });
        return { text: joinBullets([
          formatLead("Scan state", stateValue.suggested_action || stateValue.status || "available"),
          stateValue.location_name || stateValue.location_code ? `Location: ${stateValue.location_name || stateValue.location_code}.` : "",
          stateValue.open_session_status ? `Session: ${stateValue.open_session_status}.` : "",
        ]), meta: { fallback: true, mode: "local_scan" } };
      }
    }

    if (/\b(who works|who work|who is working|who's working|who all works|which custodians work|which ops managers work|would is working|staff|staffing|custodian|custodians|scheduled)\b/i.test(text)) {
      const daily = await generateDailyStaffScheduleReply({ runReadOnlySql, runRpc, serviceDate: relativeServiceDate, queryText: text });
      await saveThreadContext(runRpc, threadId, { last_intent: "daily_staff_schedule", last_service_date: relativeServiceDate, last_subject_type: "summary" });
      return daily;
    }

    if (lower.includes("schedule") || lower.includes("assigned") || lower.includes("assignment") || lower.includes("areas") || lower.includes("area") || lower.includes("works") || lower.includes("working") || lower.includes("scheduled") || lower.includes("staff") || lower.includes("aquarium") || lower.includes("restroom") || lower.includes("zambezi") || lower.includes("teton") || lower.includes("expo") || lower.includes("cleans") || hasLocationKeyword(text) || ((/^(how about|what about)\b/i.test(text) || hasDateReference(text)) && threadContext?.last_subject_type === "group" && threadContext?.last_group_name) || ((/^(how about|what about)\b/i.test(text) || hasDateReference(text)) && threadContext?.last_subject_type === "employee" && threadContext?.last_employee_name) || ((/^(how about|what about)\b/i.test(text) || hasDateReference(text)) && threadContext?.context_json?.last_question_shape === "my_schedule")) {
      const employeeName = await guessEmployeeName(runRpc, text) || (shouldUseEmployeeContext(text) ? threadContext?.last_employee_name : "") || "";
      if (employeeName) {
        const workStatus = await executeTool("get_employee_work_status", { employee_name: employeeName, service_date: relativeServiceDate });
        await saveThreadContext(runRpc, threadId, {
          last_intent: "employee_work_status",
          last_employee_name: workStatus?.employee_name || employeeName,
          last_service_date: relativeServiceDate,
          last_subject_type: "employee",
          context_json: mergeContextJson(threadContext, {
            last_question_shape: "employee_work_status",
            last_subject_kind: "employee",
            last_subject_label: workStatus?.employee_name || employeeName,
            work_status: workStatus?.work_status || null,
          })
        });
        return { text: summarizeEmployeeWorkStatus(workStatus), meta: { fallback: true, mode: "local_employee_work_status" } };
      }
      const areaRow = await resolveAreaRow(runReadOnlySql, relativeServiceDate, text, threadContext);
      let data = await executeTool("get_area_schedule", { area: areaRow?.group_name || text, service_date: relativeServiceDate });
      const futureOffset = daysBetweenIsoDates(todayServiceDate, relativeServiceDate);
      if ((!Array.isArray(data?.assignments) || !data.assignments.length) && futureOffset != null && futureOffset >= 0 && futureOffset < 7) {
        await ensureDailySchedule(runRpc, relativeServiceDate, { force: true });
        data = await executeTool("get_area_schedule", { area: areaRow?.group_name || text, service_date: relativeServiceDate });
      }
      await saveThreadContext(runRpc, threadId, { last_intent: "area_schedule", last_group_name: areaRow?.group_name || data.group_name || null, last_service_date: relativeServiceDate, last_subject_type: "group", context_json: mergeContextJson(threadContext, { last_question_shape: "area_schedule", last_subject_kind: "group", last_subject_label: areaRow?.group_name || data.group_name || null }) });
      const noAssignmentsText = data.service_date && data.service_date > todayServiceDate
        ? `I do not see generated schedule assignments for ${areaRow?.group_name || text} on ${data.service_date} yet.`
        : `I couldn't find schedule assignments for ${areaRow?.group_name || text} on ${data.service_date}.`;
      return { text: summarizeAssignments(data.assignments, noAssignmentsText), meta: { fallback: true, mode: "local_area_schedule" } };
    }

    if (lower.includes("dashboard") || lower.includes("summary") || lower.includes("status") || lower.includes("metrics") || lower.includes("attendance") || lower.includes("guest") || lower.includes("guests") || lower.includes("visitor") || lower.includes("visitors")) {
      const data = await executeTool("get_dashboard_summary", {});
      await saveThreadContext(runRpc, threadId, { last_intent: "dashboard_summary", last_service_date: relativeServiceDate, last_subject_type: "summary" });
      const attendanceOnly = /\b(attendance|guest|guests|visitor|visitors)\b/i.test(text);
      return { text: attendanceOnly ? summarizeAttendance(data.attendance, text) : summarizeDashboard(data.snapshot, data.attention_locations, data.attendance), meta: { fallback: true, mode: attendanceOnly ? "local_attendance" : "local_dashboard" } };
    }

    const weatherLocation = inferWeatherLocation(text, threadContext);
    const subjectType = isWeatherQuestion(text) ? "weather" : (isGeneralKnowledgeQuestion(text) ? "general_knowledge" : "generic");
    await saveThreadContext(runRpc, threadId, { last_intent: "generic", last_service_date: relativeServiceDate, last_subject_type: subjectType, context_json: mergeContextJson(threadContext, weatherLocation ? { weather_location: weatherLocation, last_question_shape: "generic" } : { last_question_shape: "generic" }) });
    return { text: genericConversationalFallback(text, threadContext), meta: { fallback: true, mode: "local_generic" } };
  }

  async function generateReply({ deviceId = "", userMessage = "", threadId = "" }) {
    const apiKey = getGeminiApiKey();
    const identity = await fetchDeviceIdentity(runReadOnlySql, deviceId);
    const webEnabled = allowWebSearch({ deviceId, identityRole: identity?.role || "" });
    const threadContext = await fetchThreadContext(runReadOnlySql, threadId);
    const recentMessages = await fetchRecentThreadMessages(runReadOnlySql, threadId, 10);

    if (isMemphisIdentityQuestion(userMessage)) {
      await saveThreadContext(runRpc, threadId, {
        last_intent: "memphis_identity",
        last_subject_type: "conversation",
        context_json: mergeContextJson(threadContext, {
          last_question_shape: "memphis_identity",
          last_subject_kind: "assistant",
          last_subject_label: "Memphis",
        }),
      });
      return {
        text: "I am Memphis, the Memphis Zoo operations assistant. I help with schedules, area coverage, contacts, tickets, scans, and day-of operations questions.",
        meta: { fallback: true, mode: "local_memphis_identity" }
      };
    }

    const locationHint = findLocationCode(userMessage) || hasLocationKeyword(userMessage);

    if (!locationHint && isOpsManagerSchedulePrompt(userMessage)) {
      const opsScheduleText = isNamedRegularOpsSchedulePrompt(userMessage)
        ? `${userMessage} regular schedule`
        : userMessage;
      const opsScheduleReply = await answerOpsManagerScheduleQuestion(runReadOnlySql, opsScheduleText);

      if (opsScheduleReply) {
        await saveThreadContext(runRpc, threadId, { last_intent: "ops_manager_schedule", last_subject_type: "contact", context_json: mergeContextJson(threadContext, { last_question_shape: "ops_manager_schedule", last_subject_kind: "contact" }) });
        return { text: opsScheduleReply, meta: { fallback: true, mode: "local_ops_manager_schedule" } };
      }
    }

    if (isContactLookupPrompt(userMessage)) {
      const contactReply = await answerInternalContactQuestion(runReadOnlySql, userMessage);

      if (contactReply) {
        await saveThreadContext(runRpc, threadId, { last_intent: "internal_contact_lookup", last_subject_type: "contact", context_json: mergeContextJson(threadContext, { last_question_shape: "internal_contact_lookup", last_subject_kind: "contact" }) });
        return { text: contactReply, meta: { fallback: true, mode: "local_internal_contact" } };
      }
    }

    const weeklyEmployeeReply = await answerEmployeeWeeklyScheduleQuestion(runReadOnlySql, userMessage, threadContext);
    if (weeklyEmployeeReply) {
      await saveThreadContext(runRpc, threadId, { last_intent: "employee_weekly_schedule", last_subject_type: "employee", context_json: mergeContextJson(threadContext, { last_question_shape: "employee_weekly_schedule", last_subject_kind: "employee" }) });
      return { text: weeklyEmployeeReply, meta: { fallback: true, mode: "local_employee_weekly_schedule" } };
    }

    const explicitSystem =
      !isGeneralKnowledgeQuestion(userMessage) &&
      (isSystemSpecificQuestion(userMessage, threadContext) || isEmployeeAreaQuestion(userMessage));

    if (!apiKey || explicitSystem) {
      return await generateSystemReply(userMessage, { deviceId, threadId });
    }

    if (isWeatherQuestion(userMessage)) {
      const location = inferWeatherLocation(userMessage, threadContext) || DEFAULT_WEATHER_LOCATION;
      try {
        const weather = await fetchWeatherForMemphisTn(location);
        await saveThreadContext(runRpc, threadId, { last_intent: "weather", last_subject_type: "weather", context_json: mergeContextJson(threadContext, { weather_location: location, last_question_shape: "weather", last_subject_kind: "weather", last_subject_label: location }) });
        return { text: summarizeWeatherPayload(weather), meta: { fallback: false, provider: "weather_direct", mode: "conversation_weather_direct" } };
      } catch (error) {
        console.error("memphis direct weather path failed:", error);
      }
    }

    try {
      const text = await tryGeminiConversation({ apiKey, userMessage, webEnabled, threadContext, recentMessages });
      if (text) {
        const subjectType = isWeatherQuestion(userMessage) ? "weather" : (isGeneralKnowledgeQuestion(userMessage) ? "general_knowledge" : "conversation");
        const weatherLocation = inferWeatherLocation(userMessage, threadContext);
        await saveThreadContext(runRpc, threadId, { last_intent: "conversation", last_subject_type: subjectType, context_json: mergeContextJson(threadContext, weatherLocation ? { weather_location: weatherLocation, last_question_shape: "conversation", last_subject_kind: subjectType, last_subject_label: weatherLocation } : { last_question_shape: "conversation", last_subject_kind: subjectType }) });
        return { text, meta: { fallback: false, provider: "gemini", model: DEFAULT_MODEL, mode: "conversation_first" } };
      }
    } catch (error) {
      console.error("memphis conversation gemini path failed:", error);
    }

    return await generateSystemReply(userMessage, { deviceId, threadId });
  }

  return { generateReply };
}
