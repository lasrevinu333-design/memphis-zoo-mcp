const DEFAULT_STALE_AFTER_MS = 60 * 60 * 1000;

export function toNullableNonNegativeInteger(value) {
  if (value == null || value === "") return null;
  const raw = typeof value === "string" ? value.trim() : value;
  if (raw === "") return null;
  if (typeof raw === "string" && !/^\d+$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

export function attendanceSourceTimestamp(row = {}) {
  const candidate = row.fetched_at || row.updated_at || null;
  const timestamp = candidate ? Date.parse(String(candidate)) : NaN;
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
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
  const sourceAgeMs = sourceTimestamp ? Math.max(0, nowMs - Date.parse(sourceTimestamp)) : null;
  const stale = sourceAgeMs == null || sourceAgeMs > staleAfterMs;
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
    fetched_at: row.fetched_at || null,
    updated_at: row.updated_at || null,
    source_timestamp: sourceTimestamp,
    source_age_minutes: sourceAgeMs == null ? null : Math.round(sourceAgeMs / 60000),
    cached: true,
    stale,
    ...(stale ? { warning: sourceTimestamp ? "Stored attendance is older than the freshness limit." : "Stored attendance has no valid source timestamp." } : {}),
  };
}

export { DEFAULT_STALE_AFTER_MS as ATTENDANCE_DEFAULT_STALE_AFTER_MS };
