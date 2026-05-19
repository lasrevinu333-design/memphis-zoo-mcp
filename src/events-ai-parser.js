const MONTH_LOOKUP = {
  january: 1, jan: 1,
  february: 2, feb: 2,
  march: 3, mar: 3,
  april: 4, apr: 4,
  may: 5,
  june: 6, jun: 6,
  july: 7, jul: 7,
  august: 8, aug: 8,
  september: 9, sept: 9, sep: 9,
  october: 10, oct: 10,
  november: 11, nov: 11,
  december: 12, dec: 12,
};

const FIELD_LABELS = [
  "Event Name",
  "Event Area",
  "Location Group",
  "Location",
  "Area",
  "Venue",
  "Event Date",
  "Date",
  "Start Time",
  "Begin Time",
  "End Time",
  "Stop Time",
  "Start",
  "Begin",
  "End",
  "Stop",
  "Projected",
  "Attendees",
  "Attendance",
  "Guests",
  "People",
  "Count",
  "Notes",
  "Details",
  "Comments",
  "Needs",
  "Host Department",
  "Manager on Duty",
];

const GARBAGE_PHRASES = [
  "admissions staff",
  "animal staff",
  "custodial staff",
  "it staff",
  "marketing staff",
  "rides staff",
  "security staff",
  "vendors",
  "manager on duty",
  "host department",
  "tbd",
];

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const GEMINI_MODEL = String(process.env.EVENTS_GEMINI_MODEL || process.env.MEMPHIS_GEMINI_MODEL || process.env.GEMINI_MODEL || "gemini-2.5-flash").trim();
const GEMINI_TIMEOUT_MS = Math.max(1000, Number.parseInt(String(process.env.EVENTS_GEMINI_TIMEOUT_MS || process.env.MEMPHIS_GEMINI_TIMEOUT_MS || "12000"), 10) || 12000);
const GEMINI_MAX_OUTPUT_TOKENS = Math.max(256, Number.parseInt(String(process.env.EVENTS_GEMINI_MAX_OUTPUT_TOKENS || "1200"), 10) || 1200);

function getGeminiApiKey() {
  return String(
    process.env.EVENTS_GEMINI_API_KEY ||
    process.env.GEMINI_API_KEY ||
    process.env.MEMPHIS_GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.GOOGLE_GENAI_API_KEY ||
    ""
  ).trim();
}

async function fetchWithTimeout(url, options = {}, timeoutMs = GEMINI_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeLoose(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/pavillion/g, "pavilion")
    .replace(/\band\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function stripSpreadsheetGarbage(text) {
  let result = String(text || "");
  for (const phrase of GARBAGE_PHRASES) {
    result = result.replace(new RegExp(`\\b${escapeRegex(phrase)}\\b`, "ig"), " ");
  }
  return result
    .replace(/\bstaff\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanupLooseText(text) {
  return stripSpreadsheetGarbage(text)
    .replace(/\b(on|at|for)\b\s*(?=,|\.|$)/gi, " ")
    .replace(/^[,;:\-\s|]+|[,;:\-\s|]+$/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeIntakeText(raw) {
  let text = String(raw || "").replace(/\r/g, "\n").replace(/\t/g, " | ");
  const labels = [...FIELD_LABELS].sort((a, b) => b.length - a.length);
  for (const label of labels) {
    const after = label.includes(" ") ? "" : "(?!\\s+(?:Time))";
    text = text.replace(new RegExp(`(^|[|\\n;])\\s*${escapeRegex(label)}${after}\\s*:?`, "ig"), (_m, p) => `${p} ${label}: `);
  }
  return text.replace(/\n+/g, " | ").replace(/\s*\|\s*/g, " | ").replace(/(?:^\s*\|\s*)+|(?:\s*\|\s*)+$/g, "").replace(/\s+/g, " ").trim();
}

function parseLabelMap(text) {
  const normalized = normalizeIntakeText(text);
  const result = {};
  const labels = [...FIELD_LABELS].sort((a, b) => b.length - a.length);
  const segments = normalized.split(/\s*\|\s*/).map((segment) => String(segment || "").trim()).filter(Boolean);
  for (const segment of segments) {
    const colonMatch = segment.match(/^([^:]+):\s*(.*)$/);
    if (colonMatch) {
      const rawLabel = String(colonMatch[1] || "").trim();
      const value = cleanupLooseText(colonMatch[2]);
      const matchedLabel = FIELD_LABELS.find((label) => normalizeLoose(label) === normalizeLoose(rawLabel));
      if (matchedLabel && value) {
        const key = normalizeLoose(matchedLabel);
        if (!result[key]) result[key] = value;
        continue;
      }
    }
    for (const label of labels) {
      const labelGuard = label.includes(" ") ? "" : "(?!\\s+time)";
      const otherLabels = labels
        .filter((candidate) => candidate !== label)
        .map((candidate) => candidate.includes(" ") ? escapeRegex(candidate) : `${escapeRegex(candidate)}(?!\\s+time)`)
        .join("|");
      const pattern = otherLabels
        ? new RegExp(`(^|\\s)${escapeRegex(label)}${labelGuard}\\s+(.+?)(?=\\s+(?:${otherLabels})(?:\\s|:|$)|$)`, "i")
        : new RegExp(`(^|\\s)${escapeRegex(label)}${labelGuard}\\s+(.+)$`, "i");
      const match = segment.match(pattern);
      if (!match) continue;
      const value = cleanupLooseText(match[2] || "");
      if (!value) continue;
      const key = normalizeLoose(label);
      if (!result[key]) result[key] = value;
      break;
    }
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

function isValidCalendarDate(year, month, day) {
  const candidate = new Date(year, month - 1, day);
  return candidate.getFullYear() === year && candidate.getMonth() === month - 1 && candidate.getDate() === day;
}

function inferEventYear() {
  return new Date().getFullYear();
}

function isoDateFor(year, month, day) {
  if (!isValidCalendarDate(year, month, day)) return "";
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function buildDate(year, month, day) {
  if (!Number.isFinite(month) || !Number.isFinite(day)) return "";
  if (Number.isFinite(year)) return isoDateFor(year, month, day);

  const now = new Date();
  const currentYear = now.getFullYear();
  const todayUtc = Date.UTC(currentYear, now.getMonth(), now.getDate());
  const thisYear = isoDateFor(currentYear, month, day);
  const nextYear = isoDateFor(currentYear + 1, month, day);

  if (!thisYear && !nextYear) return "";
  if (!thisYear) return nextYear;

  const thisDate = new Date(`${thisYear}T12:00:00Z`);
  const deltaDays = Math.round((thisDate.getTime() - todayUtc) / 86400000);
  if (deltaDays >= -1 && deltaDays <= 35) return thisYear;
  if (deltaDays < -1 && nextYear) return nextYear;
  return thisYear;
}

function normalizePossibleDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const monthNames = Object.keys(MONTH_LOOKUP).sort((a, b) => b.length - a.length).join("|");

  let match = raw.match(new RegExp(`\\b(?:Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday),?\\s+(${monthNames})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s*(\\d{2,4}))?\\b`, "i"));
  if (match) {
    const year = match[3] ? Number(String(match[3]).length === 2 ? `20${match[3]}` : match[3]) : NaN;
    const built = buildDate(year, MONTH_LOOKUP[String(match[1]).toLowerCase()], Number(match[2]));
    if (built) return built;
  }

  match = raw.match(/\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/);
  if (match) {
    const year = match[3] ? Number(String(match[3]).length === 2 ? `20${match[3]}` : match[3]) : NaN;
    const built = buildDate(year, Number(match[1]), Number(match[2]));
    if (built) return built;
  }
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

function detectEventDateFromText(text = "") {
  const raw = String(text || "").trim();
  if (!raw) return "";
  const monthNames = Object.keys(MONTH_LOOKUP).sort((a, b) => b.length - a.length).join("|");

  const weekdayMonthPattern = new RegExp(`\\b(?:Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday),?\\s+(${monthNames})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s*(\\d{2,4}))?\\b`, "i");
  let match = raw.match(weekdayMonthPattern);
  if (match) {
    const year = match[3] ? Number(String(match[3]).length === 2 ? `20${match[3]}` : match[3]) : NaN;
    const built = buildDate(year, MONTH_LOOKUP[String(match[1]).toLowerCase()], Number(match[2]));
    if (built) return built;
  }

  const monthDayPattern = new RegExp(`\\b(${monthNames})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s*(\\d{2,4}))?\\b`, "i");
  match = raw.match(monthDayPattern);
  if (match) {
    const year = match[3] ? Number(String(match[3]).length === 2 ? `20${match[3]}` : match[3]) : NaN;
    const built = buildDate(year, MONTH_LOOKUP[String(match[1]).toLowerCase()], Number(match[2]));
    if (built) return built;
  }

  const dayMonthPattern = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthNames})\\.?(?:,?\\s*(\\d{2,4}))?\\b`, "i");
  match = raw.match(dayMonthPattern);
  if (match) {
    const year = match[3] ? Number(String(match[3]).length === 2 ? `20${match[3]}` : match[3]) : NaN;
    const built = buildDate(year, MONTH_LOOKUP[String(match[2]).toLowerCase()], Number(match[1]));
    if (built) return built;
  }

  const numericMatches = [...raw.matchAll(/\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/g)];
  for (const item of numericMatches) {
    const before = raw.slice(Math.max(0, item.index - 3), item.index);
    const after = raw.slice(item.index + item[0].length, item.index + item[0].length + 3);
    if (/[:.]$/.test(before) || /^[:.]/.test(after)) continue;
    const year = item[3] ? Number(String(item[3]).length === 2 ? `20${item[3]}` : item[3]) : NaN;
    const built = buildDate(year, Number(item[1]), Number(item[2]));
    if (built) return built;
  }
  return "";
}

function compactNarrativeNotes(rawText = "", eventName = "", matchedGroup = null) {
  const raw = String(rawText || "").replace(/\s+/g, " " ).trim();
  if (!raw) return "";
  const sentences = raw.split(/(?<=[.!?])\s+/).map((part) => part.trim()).filter(Boolean);
  const kept = [];
  for (let sentence of sentences) {
    const lower = normalizeLoose(sentence);
    if (!lower) continue;
    if (/\bevent will run\b|\brun from\b|\bevent window\b|\bactual event\b/.test(lower)) continue;
    sentence = sentence.replace(/^I would (also )?like to request that\s+/i, "");
    sentence = sentence.replace(/^I would (also )?like to request\s+/i, "");
    sentence = sentence.replace(/^please\s+/i, "");
    if (eventName) sentence = sentence.replace(new RegExp(`\\b${escapeRegex(eventName)}\\b`, "ig"), "the event");
    sentence = sentence.replace(/\bon\s+(?:Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday),?\s+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t|tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s*\d{2,4})?/ig, "");
    sentence = sentence.replace(/\s+/g, " " ).trim();
    sentence = sentence.replace(/^[,.;:\-\s]+|[,.;:\-\s]+$/g, "").trim();
    if (sentence) kept.push(sentence.charAt(0).toUpperCase() + sentence.slice(1));
  }
  return cleanupLooseText(kept.join(" "));
}

function extractTimeParts(value) {
  const original = String(value || "").toLowerCase().trim();
  if (original === "noon") return { hour: 12, minute: 0, second: 0, meridiem: "", explicit: true };
  if (original === "midnight") return { hour: 0, minute: 0, second: 0, meridiem: "", explicit: true };
  const raw = original
    .toLowerCase()
    .replace(/\b\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?\b/g, " ")
    .replace(/\b20\d{2}-\d{1,2}-\d{1,2}\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const canonicalMatch = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (canonicalMatch) {
    const hour = Number(canonicalMatch[1]);
    const minute = Number(canonicalMatch[2]);
    const second = Number(canonicalMatch[3] || "0");
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) return null;
    return { hour, minute, second, meridiem: "", explicit: false };
  }

  const matches = [...raw.matchAll(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?|am|pm|a|p)?\b|\b(\d{3,4})\s*(a\.?m\.?|p\.?m\.?|am|pm|a|p)?\b/gi)];
  if (!matches.length) return null;

  const match = matches[matches.length - 1];
  let hour;
  let minute = 0;
  let meridiem = "";

  if (match[4]) {
    const digits = match[4];
    hour = Number(digits.length === 3 ? digits.slice(0, 1) : digits.slice(0, 2));
    minute = Number(digits.length === 3 ? digits.slice(1) : digits.slice(2));
    meridiem = String(match[5] || "").replace(/\./g, "").toLowerCase();
  } else {
    hour = Number(match[1]);
    minute = Number(match[2] || "0");
    meridiem = String(match[3] || "").replace(/\./g, "").toLowerCase();
  }

  if (meridiem === "a") meridiem = "am";
  if (meridiem === "p") meridiem = "pm";
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || minute > 59) return null;
  return { hour, minute, meridiem, explicit: Boolean(meridiem) };
}

function materializeTime(parts, fallbackMeridiem = "") {
  if (!parts) return "";
  let hour = Number(parts.hour);
  const minute = Number(parts.minute || 0);
  const second = Number(parts.second || 0);
  let meridiem = String(parts.meridiem || fallbackMeridiem || "").toLowerCase();
  if (meridiem === "a") meridiem = "am";
  if (meridiem === "p") meridiem = "pm";

  if (meridiem) {
    if (hour < 1 || hour > 12) return "";
    if (meridiem === "pm" && hour < 12) hour += 12;
    if (meridiem === "am" && hour === 12) hour = 0;
  }

  if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) return "";
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}`;
}

function timeToMinutes(value) {
  const [hour, minute] = String(value || "").split(":").map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return -1;
  return hour * 60 + minute;
}

function normalizeTimePair(startValue, endValue) {
  const startParts = extractTimeParts(startValue);
  const endParts = extractTimeParts(endValue);
  let start = materializeTime(startParts);
  let end = materializeTime(endParts);

  if (startParts && endParts && !startParts.explicit && endParts.explicit && endParts.meridiem) {
    start = materializeTime({ ...startParts, meridiem: endParts.meridiem });
  }

  if (startParts && endParts && !endParts.explicit) {
    const startMinutes = timeToMinutes(start);
    const rawEndMinutes = (endParts.hour * 60) + (endParts.minute || 0);
    if (startParts.meridiem === "am" && endParts.hour >= 1 && endParts.hour <= 11 && rawEndMinutes <= startMinutes) {
      end = materializeTime({ ...endParts, meridiem: "pm" });
    } else if (startParts.meridiem === "pm" && endParts.hour >= 1 && endParts.hour <= 11) {
      end = materializeTime({ ...endParts, meridiem: "pm" });
    }
  }

  return { start_time: start, end_time: end };
}

function detectTimeRange(text) {
  const raw = String(text || "").replace(/\s+/g, " ");
  const token = "(noon|midnight|\\d{1,2}(?::?\\d{2})?\\s*(?:a\\.?m\\.?|p\\.?m\\.?|am|pm|a|p)?|\\d{3,4}\\s*(?:a\\.?m\\.?|p\\.?m\\.?|am|pm|a|p)?)";
  const slashMatch = raw.match(new RegExp(`${token}\\s*(?:to|until|thru|through|\\-|–|—)\\s*${token}\\s*/\\s*${token}`, "i"));
  if (slashMatch) {
    const meridiemMatch = slashMatch[0].match(/(a\.?m\.?|p\.?m\.?|am|pm|a|p)\b/i);
    const startRaw = slashMatch[1];
    const lastEndRaw = slashMatch[3] + (meridiemMatch && !/(a\.?m\.?|p\.?m\.?|am|pm|a|p)\b/i.test(slashMatch[3]) ? ` ${meridiemMatch[1]}` : "");
    const slashPair = normalizeTimePair(startRaw, lastEndRaw);
    if (slashPair.start_time && slashPair.end_time) return { ...slashPair, matched_text: slashMatch[0] };
  }
  const match = raw.match(new RegExp(`${token}\\s*(?:to|until|thru|through|\\-|–|—)\\s*${token}`, "i"));
  if (!match) return null;
  const pair = normalizeTimePair(match[1], match[2]);
  if (!pair.start_time || !pair.end_time) return null;
  return { ...pair, matched_text: match[0] };
}

function detectInlineLabeledTimeRange(text) {
  const raw = String(text || "").replace(/\s+/g, " ").trim();
  if (!raw) return null;
  const nextField = "(?:\\s+|\\s*\\|\\s*)";
  const startMatch = raw.match(new RegExp(`\\b(?:start time|start|begin time|begin)\\b\\s*:?\\s*([^|,;]+?)(?=${nextField}\\b(?:end time|end|stop time|stop)\\b|$)`, "i"));
  const endMatch = raw.match(new RegExp(`\\b(?:end time|end|stop time|stop)\\b\\s*:?\\s*([^|,;]+?)(?=(?:${nextField}\\b(?:attendees|attendance|guests|people|students|pax|persons|notes|details|comments|needs)\\b)|$)`, "i"));
  if (!startMatch || !endMatch) return null;
  const pair = normalizeTimePair(String(startMatch[1] || "").trim(), String(endMatch[1] || "").trim());
  if (!pair.start_time || !pair.end_time) return null;
  return { ...pair, matched_text: `${startMatch[0]} ${endMatch[0]}`.trim() };
}

function detectAttendeeCount(text) {
  const raw = String(text || "");
  let match = raw.match(/\b(\d{1,5})\s*(attendees|guests|people|students|pax|persons)\b/i);
  if (match) return Number.parseInt(match[1], 10);
  match = raw.match(/\b(?:attendance|count|projected|expected|guests?)\s*[:\-]?\s*(\d{1,5})\b/i);
  if (match) return Number.parseInt(match[1], 10);
  return null;
}

function rankLocationGroups(locationGroups, nameOrCode, limit = 3) {
  const needle = normalizeLoose(nameOrCode);
  if (!needle) return [];
  const byGroup = new Map();
  for (const group of locationGroups || []) {
    const names = [group.group_name, group.group_code].concat(group.included_locations || []).filter(Boolean);
    for (const name of names) {
      const normalized = normalizeLoose(name);
      if (!normalized) continue;
      let score = -1;
      if (needle === normalized) score = 1000 + normalized.length;
      else if (needle.includes(normalized)) {
        if (normalized.length <= 2 && !(new RegExp(`\\b${escapeRegex(normalized)}\\b`).test(needle))) score = -1;
        else score = 700 + normalized.length;
      }
      else if (normalized.includes(needle)) {
        if (needle.length <= 2 && !(new RegExp(`\\b${escapeRegex(needle)}\\b`).test(normalized))) score = -1;
        else score = 500 + needle.length;
      }
      else {
        const needleParts = needle.split(/\s+/).filter(Boolean);
        const nameParts = normalized.split(/\s+/).filter(Boolean);
        const overlap = needleParts.filter((part) => nameParts.includes(part)).length;
        if (overlap) score = (overlap * 80) + normalized.length;
      }
      if (score < 0) continue;
      const key = String(group.location_group_id || group.group_code || group.group_name || "");
      const current = byGroup.get(key);
      if (!current || score > current.score) {
        byGroup.set(key, {
          location_group_id: group.location_group_id || "",
          group_name: group.group_name || "",
          group_code: group.group_code || "",
          matched_text: String(name || ""),
          score,
          group,
        });
      }
    }
  }
  return Array.from(byGroup.values())
    .sort((a, b) => b.score - a.score || String(a.group_name).localeCompare(String(b.group_name)))
    .slice(0, Math.max(1, limit));
}

function matchLocationGroup(locationGroups, nameOrCode) {
  return rankLocationGroups(locationGroups, nameOrCode, 1)[0]?.group || null;
}

function areaIsAmbiguous(candidates = []) {
  if (!Array.isArray(candidates) || candidates.length < 2) return false;
  const [first, second] = candidates;
  if (!first?.score || !second?.score) return false;
  return first.score < 900 && (first.score - second.score) < 90;
}

function compactAreaCandidates(candidates = []) {
  return (Array.isArray(candidates) ? candidates : []).map((candidate) => ({
    location_group_id: candidate.location_group_id || "",
    group_name: candidate.group_name || "",
    group_code: candidate.group_code || "",
    matched_text: candidate.matched_text || "",
    score: Number(candidate.score || 0),
  }));
}

function stripTimeDateNoise(text) {
  return String(text || "")
    .replace(/\b\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?\b/gi, " ")
    .replace(/\b(?:jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s*\d{2,4})?\b/gi, " ")
    .replace(/\b\d{1,2}(?:\:?\d{2})?\s*(?:a|p|am|pm)\b/gi, " ")
    .replace(/\b\d{2}:\d{2}(?::\d{2})?\b/gi, " ")
    .replace(/\b\d{1,5}\s*(?:attendees|guests|people|students|pax|persons)\b/gi, " ");
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

function cleanEventNameBase(eventName, matchedGroup) {
  let result = String(eventName || "");
  result = removeAreaText(result, matchedGroup);
  result = stripTimeDateNoise(result);
  result = result.replace(/\b(?:need|needs|requires|required|setup|cleanup|attendees|guests|people|students|notes?|details?)\b.*$/i, " ");
  result = result.replace(/\b(?:start time|begin time|end time|stop time|event date|event area|location group|location|venue|area|projected|attendance|attendees)\b.*$/i, " ");
  return cleanupLooseText(result);
}

function cleanEventName(eventName, matchedGroup) {
  const original = String(eventName || "");
  let result = original;
  result = result.replace(/\|+/g, " " );
  result = result.replace(/\b(?:host department|manager on duty)\b\s*:?\s*[^|,;]+/ig, " " );
  result = result.replace(/\b(?:event|event name|title)\b\s*:?\s*/ig, " " );
  result = removeAreaText(result, matchedGroup);
  result = stripTimeDateNoise(result);
  result = result.replace(/\b(?:will be over by|over by|near the|near|at|in|on|is thursday|is friday|is saturday|is sunday|is monday|is tuesday|is wednesday)\b.*$/i, " " );
  result = result.replace(/\b(?:need|needs|requires|required|setup|cleanup|attendees|guests|people|students|notes?|details?)\b.*$/i, " " );
  result = result.replace(/\b(?:start time|begin time|end time|stop time|event date|event area|location group|location|venue|area|projected|attendance|attendees)\b.*$/i, " " );
  result = cleanupLooseText(result);
  if (/\bbig group\b/i.test(original) || /\blarge group\b/i.test(original)) return "Large Group";
  if (/school kids|students|school group/i.test(original)) return "School Group";
  if (/member preview/i.test(original) && (!result || result.length > 30)) return "Member Preview";
  if (/training games/i.test(original)) return "Training Games";
  if (/run wild/i.test(original)) return "Run Wild";
  if (/zoo brew/i.test(original)) return "Zoo Brew";
  return result;
}

function cleanNotes(notes, eventName, matchedGroup) {
  let result = stripSpreadsheetGarbage(notes);
  if (eventName) result = result.replace(new RegExp(`\\b${escapeRegex(eventName)}\\b`, "ig"), " ");
  result = removeAreaText(result, matchedGroup);
  return cleanupLooseText(result);
}

function extractFallbackTitle(text, matchedGroup, timeRange) {
  let result = normalizeIntakeText(text);
  result = result.replace(/\b(Event Name|Event Area|Location Group|Location|Venue|Area|Event Date|Date|Start Time|Begin Time|End Time|Stop Time|Projected|Attendees|Attendance|Guests|People|Notes|Details|Host Department|Manager on Duty)\s*:/gi, " ");
  if (timeRange?.matched_text) result = result.replace(timeRange.matched_text, " ");
  result = removeAreaText(result, matchedGroup);
  result = stripTimeDateNoise(result);
  return cleanEventName(result, matchedGroup);
}

function minutesFromTime(value) {
  const match = String(value || "").match(/^(\d{2}):(\d{2})/);
  if (!match) return null;
  return (Number(match[1]) * 60) + Number(match[2]);
}

function buildTimeWarnings(startTime, endTime) {
  const warnings = [];
  const start = minutesFromTime(startTime);
  const end = minutesFromTime(endTime);
  if (start == null || end == null) return warnings;
  if (end <= start) warnings.push("end_not_after_start");
  const duration = end - start;
  if (duration > 12 * 60) warnings.push("suspicious_time");
  if (start < 5 * 60 || end > 23 * 60) warnings.push("suspicious_time");
  return warnings;
}

function inferEventProfile({ eventName = "", notes = "", attendeeCount = null, startTime = "" } = {}) {
  const text = normalizeLoose(`${eventName} ${notes}`);
  const count = Number.parseInt(String(attendeeCount ?? ""), 10);
  let eventType = "general_event";
  if (/\b(prom|wedding|reception|gala|fundraiser|banquet|dinner)\b/.test(text)) eventType = "formal_event";
  else if (/\b(school|students|field trip|class|camp|youth)\b/.test(text)) eventType = "school_group";
  else if (/\b(birthday|party)\b/.test(text)) eventType = "party";
  else if (/\b(corporate|meeting|conference|training)\b/.test(text)) eventType = "corporate_event";
  else if (/\b(member|members|donor|preview)\b/.test(text)) eventType = "member_event";
  else if (/\b(public|festival|concert|run|race)\b/.test(text)) eventType = "public_event";

  const start = minutesFromTime(startTime);
  const afterHours = start != null && start >= 17 * 60;
  let restroomPressure = "low";
  if (Number.isFinite(count) && count >= 150) restroomPressure = "high";
  else if (Number.isFinite(count) && count >= 60) restroomPressure = "medium";
  if (/\b(bar|alcohol|dinner|reception|prom|gala|festival|public)\b/.test(text) && restroomPressure !== "high") restroomPressure = "medium";

  let cleanupPressure = "low";
  if (/\b(food|dinner|reception|party|cake|catering|vendors?|setup|breakdown|cleanup|trash)\b/.test(text)) cleanupPressure = "medium";
  if ((Number.isFinite(count) && count >= 150) || /\b(festival|public|concert|prom|gala)\b/.test(text)) cleanupPressure = "high";

  let custodialImpact = "low";
  if (restroomPressure === "high" || cleanupPressure === "high") custodialImpact = "high";
  else if (restroomPressure === "medium" || cleanupPressure === "medium" || afterHours) custodialImpact = "medium";

  return {
    event_type: eventType,
    restroom_pressure: restroomPressure,
    cleanup_pressure: cleanupPressure,
    custodial_impact: custodialImpact,
    after_hours: afterHours,
    requires_followup: custodialImpact !== "low" || /\b(setup|breakdown|cleanup|trash|restroom|bathroom|security|vendors?)\b/.test(text),
  };
}

function appendOperationalNotes(notes = "", profile = {}) {
  const flags = [
    profile.event_type ? `type=${profile.event_type}` : "",
    profile.custodial_impact ? `custodial=${profile.custodial_impact}` : "",
    profile.restroom_pressure ? `restrooms=${profile.restroom_pressure}` : "",
    profile.cleanup_pressure ? `cleanup=${profile.cleanup_pressure}` : "",
    profile.after_hours ? "after_hours=yes" : "",
    profile.requires_followup ? "followup=yes" : "",
  ].filter(Boolean).join("; " );
  return cleanupLooseText([notes, flags ? `Operational flags: ${flags}.` : ""].filter(Boolean).join(" "));
}

function extractAmbiguousAreaEventName(text = "") {
  const raw = String(text || "").replace(/\s+/g, " " ).trim();
  if (!raw) return "";
  const match = raw.match(/^([A-Z][A-Za-z0-9'& -]{2,40}?)\s+at\s+([A-Z][A-Za-z0-9'& -]{3,80}?)(?:\s+on\s+|\s+from\s+|\s+for\s+|\.|,|$)/i);
  if (!match) return "";
  const left = cleanupLooseText(match[1]);
  const right = cleanupLooseText(match[2]);
  const leftNorm = normalizeLoose(left);
  const rightNorm = normalizeLoose(right);
  if (!leftNorm || !rightNorm) return "";
  if (rightNorm.includes(leftNorm) && leftNorm.split(/\s+/).length <= 2 && rightNorm !== leftNorm) return right;
  return "";
}

function extractNarrativeEventName(text = "") {
  const raw = String(text || "").replace(/\s+/g, " " ).trim();
  if (!raw) return "";
  const patterns = [
    /\b(?:prior to|before|for|during)\s+(?:the\s+)?([A-Z][A-Za-z0-9'& -]{3,80}?)(?:\s+on\s+(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)|\s+from\s+|\s+at\s+|\.|,)/i,
    /\b(?:event|program|party|meeting|game|training|tour)\s+(?:called|named|for)?\s*[:\-]?\s*([A-Z][A-Za-z0-9'& -]{3,80}?)(?:\s+on\s+|\s+from\s+|\.|,)/i,
  ];
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    const candidate = String(match?.[1] || "").trim().replace(/^(?:the|a|an)\s+/i, "").replace(/[\s,.;:-]+$/g, "");
    if (candidate && !/^(restrooms?|bathrooms?|courtyard|remain open|be cleaned|request)$/i.test(candidate)) return candidate;
  }
  return "";
}

function buildNotesFromNarrative(rawText = "", baseNotes = "", eventName = "", matchedGroup = null) {
  const source = String(baseNotes || rawText || "").replace(/\s+/g, " " ).trim();
  if (!source) return "";

  const sentences = source
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);

  const operational = [];
  for (let sentence of sentences) {
    const lower = sentence.toLowerCase();
    const isPureSchedule = /\bevent\s+will\s+run\b/.test(lower) || /\brun\s+from\b/.test(lower);
    const hasOperationalNeed = /\b(request|remain open|open|clean|cleaned|trash|boxes|restrooms?|bathrooms?|arrive|arrive,|guests|race crowd|prior to|before)\b/.test(lower);
    if (isPureSchedule && !/\b(arrive|guests|trash|clean|open|restrooms?)\b/.test(lower)) continue;
    if (!hasOperationalNeed) continue;

    if (eventName) sentence = sentence.replace(new RegExp(`\\b${escapeRegex(eventName)}\\b`, "ig"), "the event");
    sentence = sentence.replace(/\b(?:on\s+)?(?:Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday),?\s+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t|tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s*\d{2,4})?\b/ig, " " );
    sentence = sentence.replace(/\bthe\s+event\s+will\s+run\s+from\s+[^.]+\.?/ig, " " );
    sentence = sentence.replace(/\bI\s+would\s+(?:also\s+)?like\s+to\s+request\s+(?:that\s+)?/ig, "" );
    sentence = sentence.replace(/\bplease\s+/ig, "" );
    sentence = cleanupLooseText(sentence);
    if (sentence) operational.push(sentence.charAt(0).toUpperCase() + sentence.slice(1));
  }

  if (!operational.length) {
    let fallback = source;
    if (eventName) fallback = fallback.replace(new RegExp(`\\b${escapeRegex(eventName)}\\b`, "ig"), "the event");
    fallback = fallback.replace(/\bthe\s+event\s+will\s+run\s+from\s+[^.]+\.?/ig, " " );
    fallback = removeAreaText(fallback, matchedGroup);
    return cleanupLooseText(fallback);
  }

  return operational.join(" ");
}

function buildFieldConfidence({ eventName, locationGroupId, eventDate, startTime, endTime, attendeeCount, areaCandidates = [], warnings = [] } = {}) {
  const warningSet = new Set(warnings || []);
  return {
    event_name: eventName ? (warningSet.has("missing_event_name") ? "low" : "high") : "low",
    area: locationGroupId ? (warningSet.has("ambiguous_area") || areaIsAmbiguous(areaCandidates) ? "medium" : "high") : "low",
    date: eventDate ? (warningSet.has("ambiguous_date") ? "medium" : "high") : "low",
    time: startTime && endTime ? (warningSet.has("suspicious_time") || warningSet.has("ambiguous_time") ? "medium" : "high") : "low",
    attendees: attendeeCount == null || attendeeCount === "" ? "medium" : "high",
  };
}

function buildParseWarnings({ eventName, locationGroupId, eventDate, startTime, endTime, areaCandidates = [] }) {
  const warnings = [];
  if (!eventName) warnings.push("missing_event_name");
  if (!locationGroupId) warnings.push("missing_area");
  if (locationGroupId && areaIsAmbiguous(areaCandidates)) warnings.push("ambiguous_area");
  if (!eventDate) warnings.push("missing_date");
  if (!startTime || !endTime) warnings.push("missing_time");
  warnings.push(...buildTimeWarnings(startTime, endTime));
  return Array.from(new Set(warnings));
}

function detectRelativeWeekdayDate(text = "") {
  const raw = String(text || "").toLowerCase();
  const match = raw.match(/\b(next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i);
  if (!match) return "";
  const names = ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"];
  const target = names.indexOf(String(match[2] || "").toLowerCase());
  if (target < 0) return "";
  const now = new Date();
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0);
  let delta = (target - base.getDay() + 7) % 7;
  if (delta === 0 || match[1]) delta = delta || 7;
  base.setDate(base.getDate() + delta);
  return `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, "0")}-${String(base.getDate()).padStart(2, "0")}`;
}

function detectApproxTimeRange(text = "") {
  const lower = normalizeLoose(text);
  if (/\baround lunch\b|\bat lunch\b|\blunch time\b|\blunchtime\b/.test(lower)) {
    return { start_time: "12:00:00", end_time: "13:00:00", matched_text: "around lunch" };
  }
  return null;
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

  const areaCandidates = rankLocationGroups(locationGroups, areaFromLabel || normalizedText, 3);
  const matchedGroup = areaCandidates[0]?.group || null;
  const labeledTimeRange = detectInlineLabeledTimeRange(normalizedText);
  const timeRange = labeledTimeRange
    || (startFromLabel && endFromLabel
      ? { ...normalizeTimePair(startFromLabel, endFromLabel), matched_text: `${startFromLabel} ${endFromLabel}` }
      : detectTimeRange(normalizedText))
    || detectApproxTimeRange(normalizedText);
  const eventDate = normalizePossibleDate(dateFromLabel) || detectEventDateFromText(normalizedText) || detectRelativeWeekdayDate(normalizedText) || normalizePossibleDate(endFromLabel) || normalizePossibleDate(normalizedText);
  const attendeeValue = detectAttendeeCount(attendeesFromLabel) ?? detectAttendeeCount(normalizedText);
  const attendeeCount = Number.isFinite(attendeeValue) ? String(attendeeValue) : null;
  const ambiguousAreaName = extractAmbiguousAreaEventName(normalizedText);
  const narrativeName = extractNarrativeEventName(normalizedText);
  const eventName = eventNameFromLabel
    ? cleanEventName(eventNameFromLabel, matchedGroup)
    : (ambiguousAreaName || cleanEventName(narrativeName || extractFallbackTitle(normalizedText, matchedGroup, timeRange), matchedGroup));
  const baseNotes = notesFromLabel ? buildNotesFromNarrative(normalizedText, notesFromLabel, eventName, matchedGroup) : compactNarrativeNotes(normalizedText, eventName, matchedGroup);
  const startTime = timeRange?.start_time || "";
  const endTime = timeRange?.end_time || "";
  const warnings = buildParseWarnings({ eventName, locationGroupId: matchedGroup?.location_group_id || "", eventDate, startTime, endTime, areaCandidates });
  const operational_profile = inferEventProfile({ eventName, notes: baseNotes || normalizedText, attendeeCount, startTime, endTime });
  const field_confidence = buildFieldConfidence({ eventName, locationGroupId: matchedGroup?.location_group_id || "", eventDate, startTime, endTime, attendeeCount, areaCandidates, warnings });

  return {
    raw_text: normalizedText,
    source_index: index,
    event_name: eventName,
    location_group_id: matchedGroup?.location_group_id || "",
    location_group_name: matchedGroup?.group_name || areaFromLabel || "",
    event_date: eventDate,
    start_time: startTime,
    end_time: endTime,
    attendee_count: attendeeCount,
    notes: baseNotes,
    created_by: "Input Console Parse",
    confidence: warnings.length ? (warnings.includes("missing_event_name") || warnings.includes("missing_area") || warnings.includes("missing_date") || warnings.includes("missing_time") ? "medium" : "high") : "high",
    review_notes: warnings.length ? warnings.join(", ") : null,
    warnings,
    area_candidates: compactAreaCandidates(areaCandidates),
    field_confidence,
    operational_profile,
  };
}

function shouldUseGemini(localRow) {
  if (!localRow) return false;
  const warnings = Array.isArray(localRow.warnings) ? localRow.warnings : [];
  if (warnings.some((warning) => [
    "missing_event_name",
    "missing_area",
    "missing_date",
    "missing_time",
    "end_not_after_start",
    "ambiguous_area",
    "ambiguous_date",
    "ambiguous_time",
    "suspicious_time",
  ].includes(warning))) return true;

  const fieldConfidence = localRow.field_confidence || {};
  return Object.values(fieldConfidence).some((value) => String(value || "") === "medium" || String(value || "") === "low");
}

function buildGeminiPrompt(rows, locationGroups) {
  const groups = (locationGroups || []).map((group) => ({
    location_group_id: group.location_group_id,
    group_name: group.group_name,
    group_code: group.group_code,
    included_locations: group.included_locations || [],
  }));

  return [
    "You are extracting Memphis Zoo event intake rows into strict JSON.",
    "Return JSON only. No markdown. No explanation.",
    "Output shape: {\"rows\":[{...}]}",
    "Each row must include:",
    "source_index, event_name, location_group_id, location_group_name, event_date, start_time, end_time, attendee_count, notes, confidence, review_notes, warnings, event_type, custodial_impact, restroom_pressure, cleanup_pressure, requires_followup",
    "Rules:",
    "- event_date must be YYYY-MM-DD when known, else empty string.",
    "- start_time and end_time must be HH:MM:SS 24-hour when known, else empty string.",
    "- attendee_count must be a string integer or null.",
    "- location_group_id must match one of the provided location groups when you can infer it, else empty string.",
    "- location_group_name should be the canonical group name when matched, else your best short area text.",
    "- warnings must be an array using these values when applicable: missing_event_name, missing_area, missing_date, missing_time, end_not_after_start, ambiguous_area, ambiguous_date, ambiguous_time.",
    "- confidence must be one of high, medium, low.",
    "- review_notes should be short plain text or null.",
    "- Do not invent facts. Leave fields blank if unknown.",
    "- Preserve each source_index exactly as provided in the input rows.",
    "- Use event_type values like school_group, formal_event, party, corporate_event, member_event, public_event, or general_event.",
    "- custodial_impact, restroom_pressure, and cleanup_pressure must be low, medium, or high.",
    "- requires_followup must be true when setup, breakdown, cleanup, restroom pressure, vendors, food, trash, or high attendance appears likely.",
    "Location groups:",
    JSON.stringify(groups),
    "Input rows:",
    JSON.stringify((rows || []).map((row) => ({
      source_index: Number(row?.source_index),
      text: String(row?.text || ""),
    }))),
  ].join("\n");
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = String(text || "").match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

async function tryGeminiParseTexts({ rows, locationGroups }) {
  const apiKey = getGeminiApiKey();
  if (!apiKey) return { ok: false, reason: "gemini_not_configured" };
  const prompt = buildGeminiPrompt(rows, locationGroups);
  const response = await fetchWithTimeout(`${GEMINI_BASE_URL}/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.15, maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS, responseMimeType: "application/json" },
    }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error?.message || payload?.message || `Gemini HTTP ${response.status}`);
  const text = (payload?.candidates?.[0]?.content?.parts || [])
    .filter((part) => typeof part?.text === "string" && part.text.trim())
    .map((part) => part.text.trim())
    .join("\n\n");
  const parsed = safeJsonParse(text);
  const parsedRows = Array.isArray(parsed?.rows) ? parsed.rows : null;
  if (!parsedRows) throw new Error("Gemini returned invalid JSON rows payload.");
  return { ok: true, provider: "gemini", model: GEMINI_MODEL, rows: parsedRows };
}

function mergeWarnings(...warningLists) {
  return Array.from(new Set(warningLists.flat().filter(Boolean)));
}

function normalizeGeminiRow(raw = {}, locationGroups = [], fallbackText = "", index = 0) {
  const matchedGroup = raw.location_group_id
    ? (locationGroups || []).find((group) => String(group.location_group_id || "") === String(raw.location_group_id || "")) || null
    : matchLocationGroup(locationGroups, raw.location_group_name || fallbackText);
  const locationGroupId = matchedGroup?.location_group_id || String(raw.location_group_id || "").trim();
  const locationGroupName = matchedGroup?.group_name || String(raw.location_group_name || "").trim();
  const eventDate = normalizePossibleDate(raw.event_date);
  const timePair = normalizeTimePair(raw.start_time, raw.end_time);
  const attendeeRaw = raw.attendee_count == null || raw.attendee_count === "" ? null : Number.parseInt(String(raw.attendee_count), 10);
  const attendeeCount = Number.isFinite(attendeeRaw) ? String(attendeeRaw) : null;
  const eventName = cleanEventName(raw.event_name || "", matchedGroup);
  const notes = cleanNotes(raw.notes || "", eventName, matchedGroup);
  const areaCandidates = rankLocationGroups(locationGroups, raw.location_group_name || fallbackText, 3);
  const warnings = mergeWarnings(
    Array.isArray(raw.warnings) ? raw.warnings.map((x) => String(x || "").trim()).filter(Boolean) : [],
    buildParseWarnings({ eventName, locationGroupId, eventDate, startTime: timePair.start_time, endTime: timePair.end_time, areaCandidates })
  );
  const aiProfile = {
    event_type: String(raw.event_type || "").trim(),
    custodial_impact: String(raw.custodial_impact || "").trim(),
    restroom_pressure: String(raw.restroom_pressure || "").trim(),
    cleanup_pressure: String(raw.cleanup_pressure || "").trim(),
    requires_followup: raw.requires_followup === true,
  };
  const fallbackProfile = inferEventProfile({ eventName, notes: notes || fallbackText, attendeeCount, startTime: timePair.start_time, endTime: timePair.end_time });
  const operational_profile = {
    ...fallbackProfile,
    ...Object.fromEntries(Object.entries(aiProfile).filter(([, value]) => value !== "" && value != null)),
  };
  const field_confidence = buildFieldConfidence({ eventName, locationGroupId, eventDate, startTime: timePair.start_time, endTime: timePair.end_time, attendeeCount, areaCandidates, warnings });

  return {
    raw_text: normalizeIntakeText(fallbackText),
    source_index: Number.isFinite(Number(raw.source_index)) ? Number(raw.source_index) : index,
    event_name: eventName,
    location_group_id: locationGroupId || "",
    location_group_name: locationGroupName || "",
    event_date: eventDate,
    start_time: timePair.start_time || "",
    end_time: timePair.end_time || "",
    attendee_count: attendeeCount,
    notes,
    created_by: "Input Console Parse",
    confidence: ["high", "medium", "low"].includes(String(raw.confidence || "").toLowerCase()) ? String(raw.confidence).toLowerCase() : (warnings.length ? "medium" : "high"),
    review_notes: raw.review_notes == null ? (warnings.length ? warnings.join(", ") : null) : String(raw.review_notes || "").trim() || null,
    warnings,
    area_candidates: compactAreaCandidates(areaCandidates),
    field_confidence,
    operational_profile,
    provider: "gemini",
    provider_used: "gemini",
    provider_fallback: false,
    model: GEMINI_MODEL,
  };
}

function decorateLocalRow(row, { providerFallback = false } = {}) {
  return {
    ...row,
    provider: "local-parser",
    provider_used: "local-parser",
    provider_fallback: providerFallback,
  };
}

function chooseBestRow(localRow, geminiRow) {
  if (!geminiRow) return localRow;

  const localWarnings = Array.isArray(localRow?.warnings) ? localRow.warnings : [];
  const geminiWarnings = Array.isArray(geminiRow?.warnings) ? geminiRow.warnings : [];
  const localCriticalMissing = localWarnings.filter((w) => ["missing_event_name", "missing_area", "missing_date", "missing_time", "end_not_after_start"].includes(w));
  const geminiCriticalMissing = geminiWarnings.filter((w) => ["missing_event_name", "missing_area", "missing_date", "missing_time", "end_not_after_start"].includes(w));

  if (geminiCriticalMissing.length < localCriticalMissing.length) {
    return {
      ...localRow,
      event_name: localRow.event_name || geminiRow.event_name || "",
      location_group_id: localRow.location_group_id || geminiRow.location_group_id || "",
      location_group_name: localRow.location_group_name || geminiRow.location_group_name || "",
      event_date: localRow.event_date || geminiRow.event_date || "",
      start_time: localRow.start_time || geminiRow.start_time || "",
      end_time: localRow.end_time || geminiRow.end_time || "",
      attendee_count: localRow.attendee_count ?? geminiRow.attendee_count ?? null,
      notes: localRow.notes || geminiRow.notes || "",
      warnings: geminiCriticalMissing.length ? geminiWarnings : [],
      review_notes: geminiRow.review_notes || localRow.review_notes || null,
      provider_used: "local-parser+gemini-fill",
      provider_fallback: false,
      gemini_candidate: geminiRow,
    };
  }

  const localFilled = [localRow.event_name, localRow.location_group_id, localRow.event_date, localRow.start_time, localRow.end_time].filter(Boolean).length;
  const geminiFilled = [geminiRow.event_name, geminiRow.location_group_id, geminiRow.event_date, geminiRow.start_time, geminiRow.end_time].filter(Boolean).length;
  if (localFilled < 3 && geminiFilled > localFilled) return geminiRow;
  return localRow;
}

export async function aiParseEventTexts({ texts, locationGroups }) {
  const rows = texts
    .map((text, index) => ({ index, text: String(text || "").trim() }))
    .filter((row) => row.text);

  const localRows = rows.map((row) => decorateLocalRow(parseOneEventText(row.text, locationGroups || [], row.index)));
  const rowsNeedingAi = localRows.filter(shouldUseGemini);
  if (!rowsNeedingAi.length) return localRows;

  try {
    const aiInputRows = rowsNeedingAi.map((row) => ({
      source_index: row.source_index,
      text: row.raw_text,
    }));
    const aiRowBySourceIndex = new Map(aiInputRows.map((row) => [row.source_index, row]));
    const geminiResult = await tryGeminiParseTexts({
      rows: aiInputRows,
      locationGroups: locationGroups || [],
    });
    if (!geminiResult?.ok || !Array.isArray(geminiResult.rows)) return localRows.map((row) => decorateLocalRow(row, { providerFallback: shouldUseGemini(row) }));

    const geminiRows = geminiResult.rows.map((row, idx) => {
      const requestedSourceIndex = Number(row?.source_index);
      const fallbackRow = aiRowBySourceIndex.get(requestedSourceIndex) || aiInputRows[idx];
      return normalizeGeminiRow(
        row,
        locationGroups || [],
        fallbackRow?.text || "",
        fallbackRow?.source_index ?? idx
      );
    });
    const bySourceIndex = new Map(geminiRows.map((row) => [row.source_index, row]));
    return localRows.map((localRow) => chooseBestRow(localRow, bySourceIndex.get(localRow.source_index)));
  } catch {
    return localRows.map((row) => decorateLocalRow(row, { providerFallback: shouldUseGemini(row) }));
  }
}
