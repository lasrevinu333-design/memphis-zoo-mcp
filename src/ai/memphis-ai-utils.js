const WEEKDAY_INDEX = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

export function esc(value) {
  if (value == null) return "null";
  return String(value).replace(/'/g, "''");
}

export function sqlLikeLiteral(value) {
  return `'%${String(value || "").replace(/'/g, "''")}%'`;
}

export function normalizeLoose(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/pavillion/g, "pavilion")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function normalizeDate(value) {
  const raw = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

export function extractExplicitDate(text) {
  const match = String(text || "").match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  return match ? match[1] : null;
}

export function inferRelativeDateOffset(text) {
  const lower = String(text || "").toLowerCase();
  if (lower.includes("tomorrow")) return 1;
  if (lower.includes("yesterday")) return -1;
  return 0;
}

export function extractWeekdayReference(text = "") {
  const lower = String(text || "").toLowerCase();
  const match = lower.match(/\b(?:(this|next)\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  if (!match) return null;
  return { modifier: match[1] || "", weekday: match[2] || "" };
}

export function computeWeekdayDate(referenceDate, weekdayName, modifier = "") {
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

export function extractTimeWindow(text) {
  const raw = String(text || "").replace(/\s+/g, " ");
  const explicitRange = raw.match(/(\d{1,2}(?::\d{2})?\s*(?:am|pm)|\d{3,4}\s*(?:am|pm))[\s]*(?:to|\-|–|—)[\s]*(\d{1,2}(?::\d{2})?\s*(?:am|pm)|\d{3,4}\s*(?:am|pm))/i);
  if (explicitRange) {
    return { start: normalizeHumanTime(explicitRange[1]), end: normalizeHumanTime(explicitRange[2]) };
  }
  const single = raw.match(/\b(?:at|for|around|after)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)|\d{3,4}\s*(?:am|pm))\b/i);
  if (single) {
    const start = normalizeHumanTime(single[1]);
    if (start) return { start, end: start };
  }
  return null;
}

export function normalizeHumanTime(value) {
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

export function addMinutesToTime(value, minutesToAdd = 0) {
  const raw = String(value || "").trim();
  if (!/^\d{2}:\d{2}$/.test(raw)) return raw;
  const [h, m] = raw.split(":").map(Number);
  const total = Math.max(0, (h * 60) + m + minutesToAdd);
  const hour = Math.floor(total / 60) % 24;
  const minute = total % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function toSafeInt(value, fallback, min = 1, max = 90) {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

/**
 * LOW #2: Shared normalizeTime() function for consistent time slicing.
 * Strips seconds, pads to HH:MM, and handles edge cases uniformly.
 */
export function normalizeTime(value = "") {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  // Match HH:MM:SS or HH:MM or H:MM
  const match = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return raw.slice(0, 5);
  const hour = String(match[1]).padStart(2, "0");
  const minute = String(match[2]).padStart(2, "0");
  return `${hour}:${minute}`;
}
