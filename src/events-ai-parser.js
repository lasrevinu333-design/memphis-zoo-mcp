const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const EVENTS_AI_MODEL = String(process.env.EVENTS_GEMINI_MODEL || process.env.MEMPHIS_GEMINI_MODEL || process.env.GEMINI_MODEL || "gemini-2.5-flash").trim();
const MONTH_LOOKUP = { january:1,jan:1,february:2,feb:2,march:3,mar:3,april:4,apr:4,may:5,june:6,jun:6,july:7,jul:7,august:8,aug:8,september:9,sep:9,sept:9,october:10,oct:10,november:11,nov:11,december:12,dec:12 };

function normalizeLoose(value) {
  return String(value || "").toLowerCase().replace(/pavillion/g, "pavilion").replace(/[^a-z0-9]+/g, " ").trim();
}

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "").trim());
}

function inferEventYear(month, day) {
  const now = new Date();
  const currentYear = now.getFullYear();
  const candidate = new Date(currentYear, month - 1, day);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (candidate < today && Math.abs(candidate - today) > 1000 * 60 * 60 * 24 * 30) return currentYear + 1;
  return currentYear;
}

function isValidCalendarDate(year, month, day) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const candidate = new Date(year, month - 1, day);
  return candidate.getFullYear() === year && candidate.getMonth() === month - 1 && candidate.getDate() === day;
}

function normalizePossibleDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (isIsoDate(raw)) return raw;

  const normalized = raw
    .replace(/\b(\d{1,2})(st|nd|rd|th)\b/gi, "$1")
    .replace(/\b([a-z]{3,9})\.(?=\s+\d{1,2}\b)/gi, "$1")
    .replace(/\b(\d{1,2})\s+([a-z]{3,9})\.(?=\b)/gi, "$1 $2");

  let match = normalized.match(/\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/);
  if (match) {
    const month = Number(match[1]);
    const day = Number(match[2]);
    let year = match[3] ? Number(String(match[3]).length === 2 ? `20${match[3]}` : match[3]) : inferEventYear(month, day);
    if (Number.isFinite(month) && Number.isFinite(day) && Number.isFinite(year) && isValidCalendarDate(year, month, day)) {
      return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  const monthNames = Object.keys(MONTH_LOOKUP).sort((a, b) => b.length - a.length).join("|");
  match = normalized.match(new RegExp(`\\b(${monthNames})\\s+(\\d{1,2})(?:,?\\s*(\\d{2,4}))?\\b`, "i"));
  if (match) {
    const month = MONTH_LOOKUP[String(match[1]).toLowerCase()];
    const day = Number(match[2]);
    let year = match[3] ? Number(String(match[3]).length === 2 ? `20${match[3]}` : match[3]) : inferEventYear(month, day);
    if (Number.isFinite(month) && Number.isFinite(day) && Number.isFinite(year) && isValidCalendarDate(year, month, day)) {
      return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  match = normalized.match(new RegExp(`\\b(\\d{1,2})\\s+(${monthNames})(?:,?\\s*(\\d{2,4}))?\\b`, "i"));
  if (match) {
    const day = Number(match[1]);
    const month = MONTH_LOOKUP[String(match[2]).toLowerCase()];
    let year = match[3] ? Number(String(match[3]).length === 2 ? `20${match[3]}` : match[3]) : inferEventYear(month, day);
    if (Number.isFinite(month) && Number.isFinite(day) && Number.isFinite(year) && isValidCalendarDate(year, month, day)) {
      return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  return "";
}

function normalizePossibleTime(value, options = {}) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  if (/^\d{2}:\d{2}(:\d{2})?$/.test(raw)) return raw.length === 5 ? `${raw}:00` : raw;

  let compact = raw.replace(/\./g, ":").replace(/\s+/g, "");
  compact = compact.replace(/(\d)(a|p)$/i, (_full, digit, meridiem) => `${digit}${meridiem}m`);

  const fallbackMeridiem = String(options?.fallbackMeridiem || "").toLowerCase();
  let match = compact.match(/^(\d{1,2})(?::?(\d{2}))?(am|pm)?$/i);
  if (match) {
    let hour = Number(match[1]);
    const minute = Number(match[2] || "0");
    const meridiem = String(match[3] || fallbackMeridiem || "").toLowerCase();
    if (!Number.isFinite(hour) || !Number.isFinite(minute) || minute > 59) return "";
    if (meridiem) {
      if (hour < 1 || hour > 12) return "";
      if (meridiem === "pm" && hour < 12) hour += 12;
      if (meridiem === "am" && hour === 12) hour = 0;
      return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`;
    }
    if (hour >= 0 && hour <= 23) {
      return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`;
    }
  }

  return "";
}

function cleanupLooseText(text) {
  return String(text || "")
    .replace(/\b(on|at|for)\b\s*(?=,|\.|$)/gi, " ")
    .replace(/^[,;:\-\s]+|[,;:\-\s]+$/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripTimeDateNoise(text) {
  return String(text || "")
    .replace(/\b\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?\b/gi, " ")
    .replace(/\b(?:jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s*\d{2,4})?\b/gi, " ")
    .replace(/\b\d{1,2}(?:\:?\d{2})?\s*(?:a|p|am|pm)\b/gi, " ")
    .replace(/\b\d{2}:\d{2}(?::\d{2})?\b/gi, " ")
    .replace(/\b\d{1,5}\s*(?:attendees|guests|people|students)\b/gi, " ");
}

function getGeminiApiKey() {
  return String(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "").trim();
}

function matchLocationGroup(locationGroups, nameOrCode) {
  const needle = normalizeLoose(nameOrCode);
  if (!needle) return null;
  let best = null;
  for (const group of locationGroups || []) {
    const names = [group.group_name, group.group_code].concat(group.included_locations || []).filter(Boolean);
    for (const name of names) {
      const normalized = normalizeLoose(name);
      if (!normalized) continue;
      let score = -1;
      if (needle === normalized) score = 1000 + normalized.length;
      else if (needle.includes(normalized)) score = 700 + normalized.length;
      else if (normalized.includes(needle)) score = 500 + needle.length;
      else {
        const needleParts = needle.split(/\s+/).filter(Boolean);
        const nameParts = normalized.split(/\s+/).filter(Boolean);
        const overlap = needleParts.filter((part) => nameParts.includes(part)).length;
        if (overlap) score = (overlap * 80) + normalized.length;
      }
      if (score >= 0 && (!best || score > best.score)) best = { group, score };
    }
  }
  return best ? best.group : null;
}

function cleanEventName(eventName, locationGroups, matchedGroup) {
  let result = String(eventName || "").trim();
  const groups = matchedGroup ? [matchedGroup] : locationGroups || [];
  for (const group of groups) {
    const names = [group.group_name, group.group_code].concat(group.included_locations || []).filter(Boolean);
    for (const name of names) {
      const escaped = String(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      result = result.replace(new RegExp(`\\bat\\s+${escaped}\\b`, "ig"), " ");
      result = result.replace(new RegExp(`\\bin\\s+${escaped}\\b`, "ig"), " ");
      result = result.replace(new RegExp(`\\b${escaped}\\b`, "ig"), " ");
    }
  }
  result = stripTimeDateNoise(result);
  result = result.replace(/\b(?:need|needs|requires|required|setup|cleanup|attendees|guests|people|students)\b.*$/i, " ");
  return cleanupLooseText(result);
}

function cleanNotes(notes, eventName, matchedGroup) {
  let result = String(notes || "").trim();
  if (!result) return "";
  if (eventName) {
    const escaped = String(eventName).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(new RegExp(`\\b${escaped}\\b`, "ig"), " ");
  }
  if (matchedGroup) {
    const names = [matchedGroup.group_name, matchedGroup.group_code].concat(matchedGroup.included_locations || []).filter(Boolean);
    for (const name of names) {
      const escaped = String(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      result = result.replace(new RegExp(`\\b${escaped}\\b`, "ig"), " ");
    }
  }
  return cleanupLooseText(result);
}

function detectTimeRange(text) {
  const raw = String(text || "").replace(/\s+/g, " ");
  const timePattern = "(\\d{1,2}(?::?\\d{2})?\\s*(?:am|pm|a|p)?|\\d{2}:\\d{2}(?::\\d{2})?)";
  const match = raw.match(new RegExp(`${timePattern}[\\s]*(?:to|\\-|–|—)[\\s]*${timePattern}`, "i"));
  if (!match) return null;
  const startToken = String(match[1] || "").trim();
  const endToken = String(match[2] || "").trim();
  const startMeridiem = startToken.match(/(am|pm|a|p)\b/i)?.[1]?.toLowerCase() || "";
  const endMeridiem = endToken.match(/(am|pm|a|p)\b/i)?.[1]?.toLowerCase() || "";
  const normalizeMeridiem = (value) => (value === "a" ? "am" : value === "p" ? "pm" : value);
  const inferredStartMeridiem = normalizeMeridiem(startMeridiem || endMeridiem);
  const inferredEndMeridiem = normalizeMeridiem(endMeridiem || startMeridiem);
  const start = normalizePossibleTime(startToken, { fallbackMeridiem: inferredStartMeridiem });
  const end = normalizePossibleTime(endToken, { fallbackMeridiem: inferredEndMeridiem });
  if (!start || !end) return null;
  return { start_time: start, end_time: end, matched_text: match[0] };
}

function detectAttendeeCount(text) {
  const raw = String(text || "");
  let match = raw.match(/\b(\d{1,5})\s*(attendees|guests|people|students)\b/i);
  if (match) return Number.parseInt(match[1], 10);
  match = raw.match(/\b(?:attendance|count)\s*[:\-]?\s*(\d{1,5})\b/i);
  if (match) return Number.parseInt(match[1], 10);
  return null;
}

function extractLocalHints(text, locationGroups) {
  const raw = String(text || "").trim();
  const matchedGroup = matchLocationGroup(locationGroups, raw);
  const timeRange = detectTimeRange(raw);
  const attendeeCount = detectAttendeeCount(raw);
  const eventDate = normalizePossibleDate(raw);
  const eventName = cleanEventName(raw, locationGroups, matchedGroup);

  return {
    event_name: eventName,
    matched_group: matchedGroup,
    event_date: eventDate,
    start_time: timeRange?.start_time || "",
    end_time: timeRange?.end_time || "",
    attendee_count: Number.isFinite(attendeeCount) ? attendeeCount : null,
  };
}

function buildParseWarnings({ eventName, locationGroupId, eventDate, startTime, endTime, confidence, reviewNotes }) {
  const warnings = [];
  if (!eventName) warnings.push("missing_event_name");
  if (!locationGroupId) warnings.push("missing_area");
  if (!eventDate) warnings.push("missing_date");
  if (!startTime || !endTime) warnings.push("missing_time");
  if (startTime && endTime && endTime <= startTime) warnings.push("end_not_after_start");
  if (!confidence || confidence === "low") warnings.push("low_confidence");
  if (reviewNotes) warnings.push("review_notes_present");
  return Array.from(new Set(warnings));
}

async function callGeminiJson({ prompt, schemaDescription }) {
  const apiKey = getGeminiApiKey();
  if (!apiKey) throw new Error("Gemini parsing is not configured on the server.");
  const response = await fetch(`${GEMINI_BASE_URL}/${encodeURIComponent(EVENTS_AI_MODEL)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: `${prompt}\n\nReturn valid JSON only. Schema: ${schemaDescription}` }] }],
      generationConfig: { temperature: 0.05, responseMimeType: "application/json" }
    })
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error?.message || payload?.message || `Gemini HTTP ${response.status}`);
  const parts = payload?.candidates?.[0]?.content?.parts || [];
  const text = parts.filter((part) => typeof part?.text === "string").map((part) => part.text).join("\n").trim();
  if (!text) throw new Error("Gemini returned empty parse output.");
  return JSON.parse(text);
}

export async function aiParseEventTexts({ texts, locationGroups }) {
  const rows = texts.map((text, index) => ({ index, text: String(text || "").trim() })).filter((row) => row.text);
  if (!rows.length) return [];
  const groupCatalog = (locationGroups || []).map((group) => ({ group_name: group.group_name, group_code: group.group_code, included_locations: group.included_locations || [] }));
  const today = new Date().toISOString().slice(0, 10);
  const schemaDescription = JSON.stringify({ type: "array", items: { index: "number", event_name: "string", event_area_name: "string", event_date: "YYYY-MM-DD or month/day text without a year", start_time: "HH:MM or 6:30 PM or 630p or 6p", end_time: "HH:MM or 9 PM or 930p or 9p", attendee_count: "number|null", notes: "string", confidence: "high|medium|low", review_notes: "string" } });
  const prompt = [
    "You are parsing custodial event intake for Memphis Zoo.",
    "Extract only the exact event data needed for the system.",
    "Rules:",
    "1. event_name must be only the event name. Do not include the location, venue, date, time, or attendee count in the event name.",
    "2. event_area_name must be matched to the closest valid area from the catalog.",
    "3. Put leftover useful details into notes.",
    "4. Throw away irrelevant junk.",
    `5. Assume today's date is ${today} when inferring missing years. A year is not required; month and day are enough.`,
    "6. Times may be returned as either 24-hour HH:MM or human format like 6:30 PM, 630pm, 6am, 6p, or 630p. The server will normalize them.",
    "7. Dates may be returned as YYYY-MM-DD, numeric month/day, or recognizable human date text like Apr 30 or April 30th. The server will normalize them.",
    "8. Add confidence as high, medium, or low.",
    "9. Add short review_notes when the row still looks ambiguous.",
    `Valid area catalog: ${JSON.stringify(groupCatalog)}`,
    `Rows to parse: ${JSON.stringify(rows)}`
  ].join("\n");
  const parsed = await callGeminiJson({ prompt, schemaDescription });
  const byIndex = new Map((Array.isArray(parsed) ? parsed : []).map((row) => [Number(row.index), row]));
  return rows.map((row) => {
    const ai = byIndex.get(row.index) || {};
    const local = extractLocalHints(row.text, locationGroups);
    const matchedGroup = matchLocationGroup(locationGroups, ai.event_area_name || "") || local.matched_group;
    const attendeeValue = ai.attendee_count == null || ai.attendee_count === "" ? local.attendee_count : Number.parseInt(String(ai.attendee_count), 10);
    const normalizedEventName = cleanEventName(ai.event_name || local.event_name || "", locationGroups, matchedGroup);
    const normalizedNotes = cleanNotes([String(ai.notes || "").trim(), String(ai.review_notes || "").trim()].filter(Boolean).join(" | "), normalizedEventName, matchedGroup);
    const eventDate = normalizePossibleDate(ai.event_date) || local.event_date;
    const startTime = normalizePossibleTime(ai.start_time) || local.start_time;
    const endTime = normalizePossibleTime(ai.end_time) || local.end_time;
    const confidence = String(ai.confidence || "").trim().toLowerCase() || null;
    const reviewNotes = String(ai.review_notes || "").trim() || null;
    const warnings = buildParseWarnings({ eventName: normalizedEventName, locationGroupId: matchedGroup?.location_group_id || "", eventDate, startTime, endTime, confidence, reviewNotes });
    return {
      raw_text: row.text,
      event_name: normalizedEventName,
      location_group_id: matchedGroup?.location_group_id || "",
      event_date: eventDate,
      start_time: startTime,
      end_time: endTime,
      attendee_count: Number.isFinite(attendeeValue) ? String(attendeeValue) : null,
      notes: normalizedNotes,
      location_group_name: matchedGroup?.group_name || ai.event_area_name || local.matched_group?.group_name || "",
      created_by: "Input Console AI Parse",
      confidence,
      review_notes: reviewNotes,
      warnings
    };
  });
}