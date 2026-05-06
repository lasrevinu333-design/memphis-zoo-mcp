const MONTH_LOOKUP = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sept: 9,
  sep: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
};

const FIELD_LABELS = [
  "Event Name",
  "Event Area",
  "Location Group",
  "Location",
  "Area",
  "Event Date",
  "Date",
  "Start Time",
  "End Time",
  "Projected",
  "Attendees",
  "Attendance",
  "Guests",
  "People",
  "Notes",
  "Details",
  "Host Department",
  "Staff",
  "Manager on Duty",
];

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeLoose(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/pavillion/g, "pavilion")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function cleanupLooseText(text) {
  return stripSpreadsheetGarbage(text)
    .replace(/\b(on|at|for)\b\s*(?=,|\.|$)/gi, " ")
    .replace(/^[,;:\-\s|]+|[,;:\-\s|]+$/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripSpreadsheetGarbage(text) {
  return String(text || "")
    .replace(/\b(?:admissions|animal staff|custodial staff|it staff|marketing staff|rides staff|security staff|vendors|manager on duty|tbd|host department)\b/gi, " ")
    .replace(/\b(?:staff)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeIntakeText(raw) {
  let text = String(raw || "").replace(/\r/g, "\n").replace(/\t/g, " | ");

  for (const label of FIELD_LABELS) {
    text = text.replace(new RegExp(`\\b${escapeRegex(label)}\\b\\s*:?`, "ig"), ` | ${label}: `);
  }

  return text
    .replace(/\n+/g, " | ")
    .replace(/\s*\|\s*/g, " | ")
    .replace(/(?:^\s*\|\s*)+|(?:\s*\|\s*)+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseLabelMap(text) {
  const normalized = normalizeIntakeText(text);
  const result = {};
  const labels = FIELD_LABELS.map(escapeRegex).join("|");
  const regex = new RegExp(`(?:^|\\|)\\s*(${labels})\\s*:\\s*([^|]*?)(?=\\s*\\|\\s*(?:${labels})\\s*:|$)`, "ig");
  let match;

  while ((match = regex.exec(normalized))) {
    const key = normalizeLoose(match[1]);
    const value = cleanupLooseText(match[2]);
    if (!value) continue;
    if (!result[key]) result[key] = value;
  }

  return result;
}

function firstLabelValue(map, candidates = []) {
  for (const candidate of candidates) {
    const exact = map[normalizeLoose(candidate)];
    if (exact) return exact;
  }
  return "";
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
  const candidate = new Date(year, month - 1, day);
  return candidate.getFullYear() === year && candidate.getMonth() === month - 1 && candidate.getDate() === day;
}

function buildDate(year, month, day) {
  if (!Number.isFinite(month) || !Number.isFinite(day)) return "";
  const normalizedYear = Number.isFinite(year) ? year : inferEventYear(month, day);
  if (!isValidCalendarDate(normalizedYear, month, day)) return "";
  return `${String(normalizedYear).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function normalizePossibleDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (isIsoDate(raw)) return raw;

  let match = raw.match(/\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/);
  if (match) {
    const year = match[3] ? Number(String(match[3]).length === 2 ? `20${match[3]}` : match[3]) : NaN;
    return buildDate(year, Number(match[1]), Number(match[2]));
  }

  const monthNames = Object.keys(MONTH_LOOKUP).sort((a, b) => b.length - a.length).join("|");
  match = raw.match(new RegExp(`\\b(${monthNames})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s*(\\d{2,4}))?\\b`, "i"));
  if (match) {
    const year = match[3] ? Number(String(match[3]).length === 2 ? `20${match[3]}` : match[3]) : NaN;
    return buildDate(year, MONTH_LOOKUP[String(match[1]).toLowerCase()], Number(match[2]));
  }

  match = raw.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthNames})\\.?(?:,?\\s*(\\d{2,4}))?\\b`, "i"));
  if (match) {
    const year = match[3] ? Number(String(match[3]).length === 2 ? `20${match[3]}` : match[3]) : NaN;
    return buildDate(year, MONTH_LOOKUP[String(match[2]).toLowerCase()], Number(match[1]));
  }

  return "";
}

function normalizePossibleTime(value, options = {}) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  if (/^\d{2}:\d{2}(:\d{2})?$/.test(raw)) {
    const [hourText, minuteText, secondText = "00"] = raw.split(":");
    const hour = Number(hourText);
    const minute = Number(minuteText);
    const second = Number(secondText);
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) return "";
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`;
  }

  let compact = raw.replace(/\./g, ":").replace(/\s+/g, "");
  compact = compact.replace(/(\d)(a|p)$/i, (_full, digit, meridiem) => `${digit}${meridiem}m`);
  const fallbackMeridiem = String(options.fallbackMeridiem || "").toLowerCase();
  const match = compact.match(/^(\d{1,2})(?::?(\d{2}))?(am|pm)?$/i);
  if (!match) return "";

  let hour = Number(match[1]);
  const minute = Number(match[2] || "0");
  const meridiem = String(match[3] || fallbackMeridiem || "").toLowerCase();
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || minute > 59) return "";

  if (meridiem) {
    if (hour < 1 || hour > 12) return "";
    if (meridiem === "pm" && hour < 12) hour += 12;
    if (meridiem === "am" && hour === 12) hour = 0;
  }

  if (hour < 0 || hour > 23) return "";
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`;
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
  const start = normalizePossibleTime(startToken, { fallbackMeridiem: normalizeMeridiem(startMeridiem || endMeridiem) });
  const end = normalizePossibleTime(endToken, { fallbackMeridiem: normalizeMeridiem(endMeridiem || startMeridiem) });
  if (!start || !end) return null;
  return { start_time: start, end_time: end, matched_text: match[0] };
}

function detectAttendeeCount(text) {
  const raw = String(text || "");
  let match = raw.match(/\b(\d{1,5})\s*(attendees|guests|people|students)\b/i);
  if (match) return Number.parseInt(match[1], 10);
  match = raw.match(/\b(?:attendance|count|projected)\s*[:\-]?\s*(\d{1,5})\b/i);
  if (match) return Number.parseInt(match[1], 10);
  return null;
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

  return best?.group || null;
}

function stripTimeDateNoise(text) {
  return String(text || "")
    .replace(/\b\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?\b/gi, " ")
    .replace(/\b(?:jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s*\d{2,4})?\b/gi, " ")
    .replace(/\b\d{1,2}(?:\:?\d{2})?\s*(?:a|p|am|pm)\b/gi, " ")
    .replace(/\b\d{2}:\d{2}(?::\d{2})?\b/gi, " ")
    .replace(/\b\d{1,5}\s*(?:attendees|guests|people|students)\b/gi, " ");
}

function removeAreaText(text, group) {
  let result = String(text || "");
  if (!group) return result;
  const names = [group.group_name, group.group_code].concat(group.included_locations || []).filter(Boolean);
  for (const name of names) {
    const escaped = escapeRegex(name);
    result = result.replace(new RegExp(`\\bat\\s+${escaped}\\b`, "ig"), " ");
    result = result.replace(new RegExp(`\\bin\\s+${escaped}\\b`, "ig"), " ");
    result = result.replace(new RegExp(`\\b${escaped}\\b`, "ig"), " ");
  }
  return result;
}

function cleanEventName(eventName, matchedGroup) {
  let result = String(eventName || "");
  result = removeAreaText(result, matchedGroup);
  result = stripTimeDateNoise(result);
  result = result.replace(/\b(?:need|needs|requires|required|setup|cleanup|attendees|guests|people|students|notes?|details?)\b.*$/i, " ");
  result = result.replace(/\b(?:start time|end time|event date|event area|location|area|projected|attendance|attendees)\b.*$/i, " ");
  return cleanupLooseText(result);
}

function cleanNotes(notes, eventName, matchedGroup) {
  let result = stripSpreadsheetGarbage(notes);
  if (eventName) result = result.replace(new RegExp(`\\b${escapeRegex(eventName)}\\b`, "ig"), " ");
  result = removeAreaText(result, matchedGroup);
  return cleanupLooseText(result);
}

function extractFallbackTitle(text, matchedGroup, timeRange) {
  let result = normalizeIntakeText(text);
  result = result.replace(/\b(Event Name|Event Area|Location Group|Location|Area|Event Date|Date|Start Time|End Time|Projected|Attendees|Attendance|Guests|People|Notes|Details|Host Department|Staff|Manager on Duty)\s*:/gi, " ");
  if (timeRange?.matched_text) result = result.replace(timeRange.matched_text, " ");
  result = removeAreaText(result, matchedGroup);
  result = stripTimeDateNoise(result);
  return cleanEventName(result, matchedGroup);
}

function buildParseWarnings({ eventName, locationGroupId, eventDate, startTime, endTime }) {
  const warnings = [];
  if (!eventName) warnings.push("missing_event_name");
  if (!locationGroupId) warnings.push("missing_area");
  if (!eventDate) warnings.push("missing_date");
  if (!startTime || !endTime) warnings.push("missing_time");
  if (startTime && endTime && endTime <= startTime) warnings.push("end_not_after_start");
  return warnings;
}

function parseOneEventText(rawText, locationGroups, index = 0) {
  const normalizedText = normalizeIntakeText(rawText);
  const labels = parseLabelMap(normalizedText);
  const eventNameFromLabel = firstLabelValue(labels, ["Event Name", "Name", "Title", "Event Title"]);
  const areaFromLabel = firstLabelValue(labels, ["Event Area", "Location Group", "Area", "Location", "Venue"]);
  const dateFromLabel = firstLabelValue(labels, ["Event Date", "Date"]);
  const startFromLabel = firstLabelValue(labels, ["Start Time", "Start", "Begin Time", "Begin"]);
  const endFromLabel = firstLabelValue(labels, ["End Time", "End", "Stop Time", "Stop"]);
  const attendeesFromLabel = firstLabelValue(labels, ["Attendees", "Attendance", "Projected", "Guests", "People", "Count"]);
  const notesFromLabel = firstLabelValue(labels, ["Notes", "Details", "Comments", "Comment", "Needs"]);

  const matchedGroup = matchLocationGroup(locationGroups, areaFromLabel) || matchLocationGroup(locationGroups, normalizedText);
  const timeRange = startFromLabel && endFromLabel
    ? {
        start_time: normalizePossibleTime(startFromLabel),
        end_time: normalizePossibleTime(endFromLabel),
        matched_text: `${startFromLabel} ${endFromLabel}`,
      }
    : detectTimeRange(normalizedText);

  const eventDate = normalizePossibleDate(dateFromLabel) || normalizePossibleDate(normalizedText);
  const attendeeValue = detectAttendeeCount(attendeesFromLabel) ?? detectAttendeeCount(normalizedText);
  const eventName = cleanEventName(eventNameFromLabel || extractFallbackTitle(normalizedText, matchedGroup, timeRange), matchedGroup);
  const notes = cleanNotes(notesFromLabel || "", eventName, matchedGroup);
  const startTime = timeRange?.start_time || "";
  const endTime = timeRange?.end_time || "";
  const warnings = buildParseWarnings({
    eventName,
    locationGroupId: matchedGroup?.location_group_id || "",
    eventDate,
    startTime,
    endTime,
  });

  return {
    raw_text: normalizedText,
    source_index: index,
    event_name: eventName,
    location_group_id: matchedGroup?.location_group_id || "",
    location_group_name: matchedGroup?.group_name || areaFromLabel || "",
    event_date: eventDate,
    start_time: startTime,
    end_time: endTime,
    attendee_count: Number.isFinite(attendeeValue) ? String(attendeeValue) : null,
    notes,
    created_by: "Input Console Parse",
    confidence: warnings.length ? "medium" : "high",
    review_notes: warnings.length ? warnings.join(", ") : null,
    warnings,
  };
}

export async function aiParseEventTexts({ texts, locationGroups }) {
  const rows = texts
    .map((text, index) => ({ index, text: String(text || "").trim() }))
    .filter((row) => row.text);

  return rows.map((row) => parseOneEventText(row.text, locationGroups || [], row.index));
}
