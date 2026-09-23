const DEFAULT_STALE_AFTER_MS = 60 * 60 * 1000;
export const ATTENDANCE_FUTURE_SKEW_MS = 60 * 1000;

// PostgreSQL keeps microseconds; Date and Date.parse alone keep only milliseconds.
// Read this observation's timestamps as text and compare canonical instants, not
// rounded millisecond values. Date-valued callers still retain their exact ms.
export function canonicalAttendanceTimestamp(value) {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.toISOString() : null;
  }
  if (typeof value !== "string") return null;
  const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}(?::?\d{2})?)$/.exec(value.trim());
  if (!match) return null;
  const fraction = (match[3] || "").padEnd(6, "0");
  const local = `${match[1]}T${match[2]}.${fraction.slice(0, 3)}`;
  const calendar = Date.parse(`${local}Z`);
  if (!Number.isFinite(calendar) || new Date(calendar).toISOString() !== `${local}Z`) return null;
  const zone = match[4] === "Z" ? "Z" : match[4].length === 3 ? `${match[4]}:00`
    : match[4].length === 5 ? `${match[4].slice(0, 3)}:${match[4].slice(3)}` : match[4];
  const timestamp = Date.parse(`${local}${zone}`);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString().replace(/Z$/, `${fraction.slice(3).replace(/0+$/, "")}Z`) : null;
}

export function isCurrentAttendanceTimestamp(value, nowMs = Date.now()) {
  const timestamp = canonicalAttendanceTimestamp(value);
  const age = timestamp == null ? NaN : nowMs - Date.parse(timestamp);
  return Number.isFinite(age) && age >= -ATTENDANCE_FUTURE_SKEW_MS && age <= DEFAULT_STALE_AFTER_MS;
}

export function toNullableNonNegativeInteger(value) {
  if (value == null || value === "") return null;
  if (typeof value !== "number" && typeof value !== "string") return null;
  const raw = typeof value === "string" ? value.trim() : value;
  if (raw === "") return null;
  if (typeof raw === "string" && !/^\d+$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= 2147483647 ? parsed : null;
}

export function parseAttendanceDisplayInteger(value) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!/^(?:[0-9]+|[0-9]{1,3}(?:,[0-9]{3})+)$/.test(text)) return null;
  return toNullableNonNegativeInteger(text.replace(/,/g, ""));
}

export function attendanceSourceTimestamp(row = {}) {
  const candidate = row.fetched_at || row.updated_at || null;
  return canonicalAttendanceTimestamp(candidate);
}

export function normalizeAttendanceRecord(row, {
  nowMs = Date.now(),
  staleAfterMs = DEFAULT_STALE_AFTER_MS,
} = {}) {
  if (!row) return null;
  const attendance = toNullableNonNegativeInteger(row.attendance);
  const lastYear = toNullableNonNegativeInteger(row.last_year);
  const planned = toNullableNonNegativeInteger(row.planned);
  const yesterday = toNullableNonNegativeInteger(row.yesterday);
  const yesterdayPlan = toNullableNonNegativeInteger(row.yesterday_plan);
  if (attendance == null && lastYear == null && planned == null && yesterday == null && yesterdayPlan == null) return null;

  const sourceTimestamp = attendanceSourceTimestamp(row);
  const sourceAgeMs = sourceTimestamp ? nowMs - Date.parse(sourceTimestamp) : null;
  const future = sourceAgeMs != null && sourceAgeMs < -ATTENDANCE_FUTURE_SKEW_MS;
  const stale = sourceAgeMs == null || sourceAgeMs > staleAfterMs || future;
  return {
    attendance,
    last_year: lastYear,
    planned,
    yesterday,
    yesterday_plan: yesterdayPlan,
    parse_method: row.parse_method || "stored_state",
    source_url: row.source_url || null,
    source: row.source || null,
    content_type: row.content_type || null,
    fetched_at: canonicalAttendanceTimestamp(row.fetched_at),
    updated_at: canonicalAttendanceTimestamp(row.updated_at),
    source_timestamp: sourceTimestamp,
    source_age_minutes: sourceAgeMs == null ? null : Math.round(Math.max(0, sourceAgeMs) / 60000),
    cached: true,
    stale,
    ...(stale ? { warning: future ? "Stored attendance has a future source timestamp." : sourceTimestamp ? "Stored attendance is older than the freshness limit." : "Stored attendance has no valid source timestamp." } : {}),
  };
}

export { DEFAULT_STALE_AFTER_MS as ATTENDANCE_DEFAULT_STALE_AFTER_MS };
