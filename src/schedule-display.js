const SECTION_DEFINITIONS = Object.freeze({
  morning: { order: 10, title: "Morning Full Clean Schedule" },
  rebalance: { order: 20, title: "Restroom Rebalance Schedule" },
  lunch: { order: 30, title: "1 Hour Lunch Coverage" },
  late: { order: 40, title: "Afternoon Call Coverage" },
  reminder: { order: 50, title: "Reminder Only" },
  special: { order: 60, title: "Special Coverage" },
});

const REBALANCE_START_MINUTES = 9 * 60 + 45;

function normalizedText(value) {
  return String(value == null ? "" : value).trim();
}

function normalizedKey(value) {
  return normalizedText(value).toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

function uniqueText(values = []) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const text = normalizedText(value);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }
  return result;
}

export function parseScheduleTimeMinutes(value) {
  const raw = normalizedText(value);
  if (!raw) return null;
  if (/^close$/i.test(raw)) return 24 * 60;

  const twelveHour = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)$/i);
  if (twelveHour) {
    let hours = Number.parseInt(twelveHour[1], 10);
    const minutes = Number.parseInt(twelveHour[2], 10);
    const meridiem = twelveHour[3].toUpperCase();
    if (!Number.isFinite(hours) || !Number.isFinite(minutes) || hours < 1 || hours > 12 || minutes < 0 || minutes > 59) return null;
    if (meridiem === "AM" && hours === 12) hours = 0;
    if (meridiem === "PM" && hours !== 12) hours += 12;
    return hours * 60 + minutes;
  }

  const twentyFourHour = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!twentyFourHour) return null;
  const hours = Number.parseInt(twentyFourHour[1], 10);
  const minutes = Number.parseInt(twentyFourHour[2], 10);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || hours < 0 || hours > 24 || minutes < 0 || minutes > 59) return null;
  if (hours === 24 && minutes !== 0) return null;
  return hours * 60 + minutes;
}

export function formatScheduleTime(minutes) {
  if (!Number.isFinite(minutes)) return null;
  if (minutes >= 24 * 60) return "Close";
  const normalized = Math.max(0, Math.min(24 * 60 - 1, Math.round(minutes)));
  const hours24 = Math.floor(normalized / 60);
  const minute = normalized % 60;
  const meridiem = hours24 >= 12 ? "PM" : "AM";
  const hours12 = hours24 % 12 || 12;
  return `${String(hours12).padStart(2, "0")}:${String(minute).padStart(2, "0")} ${meridiem}`;
}

function normalizePurpose(item = {}) {
  return normalizedKey(item.coverage_purpose || item.purpose || item.kind);
}

export function scheduleSectionKey(item = {}) {
  const purpose = normalizePurpose(item);
  if (purpose === "reminder") return "reminder";
  if (purpose === "lunch coverage" || purpose === "lunch_coverage") return "lunch";
  if (purpose === "late coverage" || purpose === "late_coverage") return "late";
  if (purpose === "deep clean" || purpose === "deep_clean") return "morning";

  const start = parseScheduleTimeMinutes(item.coverage_start || item.start_time);
  if (start != null && start < REBALANCE_START_MINUTES) return "morning";

  if (["area owner", "area_owner", "restroom upkeep", "restroom_upkeep"].includes(purpose) || start != null) {
    return "rebalance";
  }
  return "special";
}

function groupIdentity(item = {}) {
  const occurrenceId = normalizedText(item.occurrence_id);
  if (occurrenceId) return `occurrence:${occurrenceId.toLowerCase()}`;
  const stableId = normalizedText(item.location_group_id || item.group_code);
  if (stableId) return stableId.toLowerCase();
  return normalizedKey(item.group_name || item.name || item.location_name || "assigned area");
}

function intervalForItem(item = {}) {
  const startValue = normalizedText(item.coverage_start || item.start_time);
  const endValue = normalizedText(item.coverage_end || item.end_time);
  const start = parseScheduleTimeMinutes(startValue);
  const end = parseScheduleTimeMinutes(endValue);
  return {
    start,
    end,
    start_label: start != null ? formatScheduleTime(start) : (startValue || null),
    end_label: end != null ? formatScheduleTime(end) : (endValue || null),
  };
}

function mergeIntervals(intervals = []) {
  const parsed = intervals
    .filter((interval) => interval.start != null && interval.end != null && interval.end >= interval.start)
    .sort((left, right) => left.start - right.start || left.end - right.end);
  const merged = [];
  for (const interval of parsed) {
    const last = merged[merged.length - 1];
    if (!last || interval.start > last.end) {
      merged.push({ start: interval.start, end: interval.end });
      continue;
    }
    last.end = Math.max(last.end, interval.end);
  }

  const unparsed = uniqueText(intervals
    .filter((interval) => interval.start == null || interval.end == null)
    .map((interval) => [interval.start_label, interval.end_label].filter(Boolean).join(" – ")));

  return [
    ...merged.map((interval) => ({
      start: interval.start,
      end: interval.end,
      start_label: formatScheduleTime(interval.start),
      end_label: formatScheduleTime(interval.end),
      label: `${formatScheduleTime(interval.start)} – ${formatScheduleTime(interval.end)}`,
    })),
    ...unparsed.map((label) => ({ start: null, end: null, start_label: null, end_label: null, label })),
  ];
}

function representativePurpose(sectionKey, purposes = []) {
  if (sectionKey === "morning") return "deep_clean";
  if (sectionKey === "lunch") return "lunch_coverage";
  if (sectionKey === "late") return "late_coverage";
  if (sectionKey === "reminder") return "reminder";
  if (purposes.includes("restroom_upkeep")) return "restroom_upkeep";
  if (purposes.includes("area_owner")) return "area_owner";
  return purposes[0] || "special_coverage";
}

export function consolidateScheduleItems(items = []) {
  const buckets = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    if (!item || typeof item !== "object") continue;
    const sectionKey = scheduleSectionKey(item);
    const identity = groupIdentity(item);
    const bucketKey = `${sectionKey}|${identity}`;
    let bucket = buckets.get(bucketKey);
    if (!bucket) {
      bucket = {
        occurrence_id: item.occurrence_id || null,
        section_key: sectionKey,
        location_group_id: item.location_group_id || null,
        group_code: item.group_code || null,
        group_name: item.group_name || item.name || item.location_name || "Assigned Area",
        name: item.name || item.group_name || item.location_name || item.group_code || "Assigned Area",
        included_locations: [],
        intervals: [],
        purposes: [],
        source_types: [],
        statuses: [],
        owner_types: [],
        notes: [],
        is_current: false,
        is_public_restroom: false,
        is_schedule_only_reminder: false,
        source_rows: 0,
        raw_items: [],
      };
      buckets.set(bucketKey, bucket);
    }

    bucket.source_rows += 1;
    bucket.raw_items.push(item);
    bucket.intervals.push(intervalForItem(item));
    bucket.included_locations.push(...(Array.isArray(item.included_locations) ? item.included_locations : []));
    bucket.purposes.push(normalizePurpose(item).replace(/ /g, "_"));
    bucket.source_types.push(item.source_type);
    bucket.statuses.push(item.status);
    bucket.owner_types.push(item.owner_type);
    bucket.notes.push(item.notes);
    bucket.is_current = bucket.is_current || item.is_current === true;
    bucket.is_public_restroom = bucket.is_public_restroom || item.is_public_restroom === true;
    bucket.is_schedule_only_reminder = bucket.is_schedule_only_reminder || item.is_schedule_only_reminder === true;
  }

  const displayItems = [];
  for (const bucket of buckets.values()) {
    const definition = SECTION_DEFINITIONS[bucket.section_key] || SECTION_DEFINITIONS.special;
    const timeRanges = mergeIntervals(bucket.intervals);
    const purposes = uniqueText(bucket.purposes);
    const includedLocations = uniqueText(bucket.included_locations);
    const firstRange = timeRanges.find((range) => range.start != null) || timeRanges[0] || null;
    const lastRange = [...timeRanges].reverse().find((range) => range.end != null) || timeRanges[timeRanges.length - 1] || null;
    displayItems.push({
      occurrence_id: bucket.occurrence_id,
      location_group_id: bucket.location_group_id,
      group_code: bucket.group_code,
      group_name: bucket.group_name,
      name: bucket.name,
      section_key: bucket.section_key,
      section_title: definition.title,
      section_order: definition.order,
      coverage_purpose: representativePurpose(bucket.section_key, purposes),
      purposes,
      source_type: uniqueText(bucket.source_types)[0] || null,
      source_types: uniqueText(bucket.source_types),
      owner_type: uniqueText(bucket.owner_types)[0] || null,
      owner_types: uniqueText(bucket.owner_types),
      status: uniqueText(bucket.statuses)[0] || "ASSIGNED",
      notes: uniqueText(bucket.notes).join(" | ") || null,
      included_locations: includedLocations,
      coverage_start: firstRange?.start_label || null,
      coverage_end: lastRange?.end_label || null,
      time_ranges: timeRanges,
      time_label: timeRanges.map((range) => range.label).filter(Boolean).join(", "),
      is_current: bucket.is_current,
      is_public_restroom: bucket.is_public_restroom,
      is_schedule_only_reminder: bucket.is_schedule_only_reminder,
      source_rows: bucket.source_rows,
    });
  }

  displayItems.sort((left, right) => {
    if (left.section_order !== right.section_order) return left.section_order - right.section_order;
    const leftStart = parseScheduleTimeMinutes(left.coverage_start);
    const rightStart = parseScheduleTimeMinutes(right.coverage_start);
    if (leftStart != null && rightStart != null && leftStart !== rightStart) return leftStart - rightStart;
    if (leftStart != null && rightStart == null) return -1;
    if (leftStart == null && rightStart != null) return 1;
    return normalizedText(left.name).localeCompare(normalizedText(right.name));
  });

  const sections = [];
  for (const definitionEntry of Object.entries(SECTION_DEFINITIONS).sort(([, left], [, right]) => left.order - right.order)) {
    const [sectionKey, definition] = definitionEntry;
    const sectionItems = displayItems.filter((item) => item.section_key === sectionKey);
    if (!sectionItems.length) continue;
    sections.push({ key: sectionKey, title: definition.title, order: definition.order, items: sectionItems });
  }

  return { items: displayItems, sections };
}

export function summarizeScheduleAreas(items = []) {
  const { sections } = consolidateScheduleItems(items);
  return sections.map((section) => ({
    key: section.key,
    title: section.title,
    items: section.items.map((item) => ({
      name: item.name,
      group_code: item.group_code,
      time_label: item.time_label,
      is_current: item.is_current,
    })),
  }));
}
