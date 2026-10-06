import express from "express";
import { sharedEventFeed, employeeVisibleEvents } from "./shared-events-feed.js";
import { resolveChicagoEventInterval } from "./events-time.js";

const EVENTS_TIME_ZONE = "America/Chicago";
const EVENTS_CONTRACT_VERSION = "events.v3";
const EVENT_MAINTENANCE_COOLDOWN_MS = 20 * 1000;
const MAX_SCAN_ALERTS_PER_RUN = 50;
const SCAN_ALERT_COOLDOWN_MINUTES = 30;
const SCAN_ALERT_MANAGER_ESCALATION_GRACE_MINUTES = 30;

function fail(res, error, fallback = "Events request failed", statusCode = 400) {
  const response = { ok: false, error: error?.message || fallback };
  if (["AMBIGUOUS_EVENT_TIME", "NONEXISTENT_EVENT_TIME", "INVALID_EVENT_INSTANT", "INVALID_EVENT_INTERVAL"].includes(error?.code)) {
    response.code = error.code;
    response.details = error.details || null;
  }
  res.status(error?.status || statusCode).json(response);
}

function sqlLiteral(value) {
  if (value == null) return "null";
  return `'${String(value).replace(/'/g, "''")}'`;
}

function isIsoDate(value) {
  const match = String(value || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const day = Number.parseInt(match[3], 10);
  const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  return date.getUTCFullYear() === year && (date.getUTCMonth() + 1) === month && date.getUTCDate() === day;
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || "").trim()
  );
}

function normalizeTimeInput(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) throw new Error("Time is required.");
  if (/^\d{2}:\d{2}(:\d{2})?$/.test(raw)) {
    const [hourText, minuteText, secondText = "00"] = raw.split(":");
    const hour = Number(hourText);
    const minute = Number(minuteText);
    const second = Number(secondText);
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) {
      throw new Error("24-hour times must stay within 00:00:00 and 23:59:59.");
    }
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}`;
  }

  let compact = raw.replace(/\./g, ":").replace(/\s+/g, "");
  compact = compact.replace(/(\d)(a|p)$/i, (_full, digit, meridiem) => `${digit}${meridiem}m`);
  const match = compact.match(/^(\d{1,2})(?::?(\d{2}))?(am|pm)?$/i);
  if (!match) {
    throw new Error("Time must be HH:MM, HH:MM:SS, or a recognizable format like 6pm, 630p, or 6:30 pm.");
  }

  let hour = Number(match[1]);
  const minute = Number(match[2] || "0");
  const meridiem = String(match[3] || "").toLowerCase();
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || minute < 0 || minute > 59) {
    throw new Error("Time must be HH:MM, HH:MM:SS, or a recognizable format like 6pm, 630p, or 6:30 pm.");
  }

  if (meridiem) {
    if (hour < 1 || hour > 12) {
      throw new Error("12-hour times must use an hour from 1 to 12.");
    }
    if (meridiem === "pm" && hour < 12) hour += 12;
    if (meridiem === "am" && hour === 12) hour = 0;
  } else if (hour < 0 || hour > 23) {
    throw new Error("24-hour times must use an hour from 00 to 23.");
  }

  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`;
}

function toNullableInt(value) {
  if (value == null || value === "") return null;
  const raw = String(value).trim();
  const parsed = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error("attendee_count must be a whole number or blank.");
  }
  return parsed;
}

function sanitizeEventNotes(value, attendeeCount = null) {
  const raw = value == null ? "" : String(value).trim();
  if (!raw) return null;
  const compact = raw.replace(/,/g, "").trim();
  if (attendeeCount != null && compact === String(attendeeCount)) return null;
  return raw;
}

const CUSTODIAL_NOTE_CODES = new Set(["trash_boxes", "extra_cans", "restroom_checks"]);
function normalizeCustodialNoteCodes(value) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.some((code) => !CUSTODIAL_NOTE_CODES.has(code))) {
    throw new Error("Custodial reminder notes must be selected from the approved operations list.");
  }
  return [...new Set(value)];
}
function normalizeCustodialPublicNotes(value) {
  const notes = value == null ? "" : String(value).trim();
  if (notes.length > 500) throw new Error("Employee-visible custodial notes must be 500 characters or fewer.");
  return notes;
}

const EVENT_SCOPES = new Set(["ZOO_WIDE", "SINGLE_VENUE", "MULTI_VENUE", "OFFSITE", "UNKNOWN"]);
const PARSER_CONFIDENCE_VALUES = new Set(["high", "medium", "low"]);

function normalizeEventScope(value, fallback = "UNKNOWN") {
  const raw = String(value || "").trim().toUpperCase().replace(/[\s-]+/g, "_");
  if (raw === "ZOO" || raw === "ZOO_WIDE" || raw === "ZOO_FOOTPRINT" || raw === "ZOO-WIDE") return "ZOO_WIDE";
  if (raw === "SINGLE" || raw === "SINGLE_VENUE") return "SINGLE_VENUE";
  if (raw === "MULTI" || raw === "MULTIPLE" || raw === "MULTI_VENUE" || raw === "MULTIPLE_VENUES") return "MULTI_VENUE";
  if (raw === "OFF_SITE") return "OFFSITE";
  return EVENT_SCOPES.has(raw) ? raw : fallback;
}

function normalizeParserConfidence(value) {
  const raw = String(value || "").trim().toLowerCase();
  return PARSER_CONFIDENCE_VALUES.has(raw) ? raw : null;
}

function normalizeUuidArray(value) {
  if (value == null || value === "") return [];
  const raw = Array.isArray(value) ? value : String(value).split(",");
  const seen = new Set();
  const ids = [];
  for (const item of raw) {
    const id = String(item || "").trim();
    if (!id) continue;
    if (!isUuid(id)) throw new Error("Location and venue id arrays must contain only valid UUIDs.");
    const key = id.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    ids.push(id);
  }
  return ids;
}

function normalizeDisplayLocation(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function isRestroomGroup(row = {}) {
  const code = String(row.group_code || "").toUpperCase();
  const name = String(row.group_name || "");
  if (code.includes("RESTROOM") || /restrooms?/i.test(name)) return true;
  return Boolean(row.public_restroom || row.staff_restroom);
}

function mapRowsBy(rows = [], key) {
  const map = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const value = String(row?.[key] || "").trim();
    if (value) map.set(value, row);
  }
  return map;
}

async function getEventReferenceData(runReadOnlySql) {
  const locationGroups = await listLocationGroups(runReadOnlySql);
  const eventVenues = await listEventVenues(runReadOnlySql);
  const allowedVenueIds = new Set(eventVenues.map((row) => String(row.venue_id)));
  const defaultRules = (await listEventDefaultRules(runReadOnlySql))
    .filter((row) => !row.primary_venue_id || allowedVenueIds.has(String(row.primary_venue_id)));
  const groupsById = mapRowsBy(locationGroups, "location_group_id");
  const venuesById = mapRowsBy(eventVenues, "venue_id");
  const zooVenue = eventVenues.find((row) => row.venue_code === "ZOO_FOOTPRINT" || row.event_scope === "ZOO_WIDE") || null;
  const offsiteVenue = eventVenues.find((row) => row.venue_code === "OFFSITE" || row.event_scope === "OFFSITE") || null;
  return { locationGroups, eventVenues, defaultRules, groupsById, venuesById, zooVenue, offsiteVenue };
}

function resolveVenueByLegacyLocationGroup(referenceData, locationGroupId) {
  const id = String(locationGroupId || "").trim();
  if (!id) return null;
  return (referenceData.eventVenues || []).find((venue) => String(venue.location_group_id || "") === id) || null;
}

function normalizeEventLocationPayload(payload = {}, referenceData = {}) {
  const explicitScope = normalizeEventScope(payload.event_scope, "");
  const primaryVenueId = String(payload.primary_venue_id || payload.event_venue_id || "").trim();
  const venueIds = normalizeUuidArray(payload.venue_ids);
  const coverageLocationIds = normalizeUuidArray(payload.coverage_location_ids);
  const staffingAreaIds = normalizeUuidArray(payload.staffing_area_ids);
  const legacyLocationGroupId = String(payload.location_group_id || "").trim();
  const displayLocationInput = normalizeDisplayLocation(payload.display_location || payload.location_group_name);
  const parserConfidence = normalizeParserConfidence(payload.parser_confidence || payload.confidence);
  const rawSourceLocationText = String(payload.source_location_text ?? payload.location_group_name ?? "");
  const sourceLocationText = rawSourceLocationText.trim() ? rawSourceLocationText : null;
  const originalSourceText = String(payload.source_text || payload.raw_text || "");
  const sourceText = originalSourceText.trim() ? originalSourceText : null;
  const sourceFormat = String(payload.source_format || "").trim() || null;
  const manuallyOverridden = Boolean(payload.manually_overridden);
  const eventTimezone = String(payload.event_timezone || EVENTS_TIME_ZONE).trim() || EVENTS_TIME_ZONE;

  if (eventTimezone !== EVENTS_TIME_ZONE) throw new Error(`event_timezone must be ${EVENTS_TIME_ZONE}.`);

  let scope = explicitScope || "UNKNOWN";
  let primaryVenue = primaryVenueId ? referenceData.venuesById?.get(primaryVenueId) : null;
  if (primaryVenueId && !primaryVenue) throw new Error("primary_venue_id is not an active event venue.");

  let normalizedVenueIds = venueIds;
  if (primaryVenue && !normalizedVenueIds.map((id) => id.toLowerCase()).includes(String(primaryVenue.venue_id).toLowerCase())) {
    normalizedVenueIds = [primaryVenue.venue_id, ...normalizedVenueIds];
  }

  if (!primaryVenue && legacyLocationGroupId) {
    primaryVenue = resolveVenueByLegacyLocationGroup(referenceData, legacyLocationGroupId);
    if (primaryVenue) {
      normalizedVenueIds = [primaryVenue.venue_id, ...normalizedVenueIds.filter((id) => id.toLowerCase() !== String(primaryVenue.venue_id).toLowerCase())];
      if (!explicitScope) scope = primaryVenue.event_scope || "SINGLE_VENUE";
    }
  }

  if (!explicitScope && primaryVenue) scope = primaryVenue.event_scope === "ZOO_WIDE" ? "ZOO_WIDE" : "SINGLE_VENUE";
  if (!explicitScope && normalizedVenueIds.length > 1) scope = "MULTI_VENUE";

  if (scope === "ZOO_WIDE") {
    const zooVenue = referenceData.zooVenue || primaryVenue;
    if (zooVenue) {
      primaryVenue = zooVenue;
      normalizedVenueIds = [zooVenue.venue_id];
    }
  }

  if (scope === "SINGLE_VENUE" && !primaryVenue && normalizedVenueIds.length === 1) {
    primaryVenue = referenceData.venuesById?.get(normalizedVenueIds[0]) || null;
  }

  const venueRows = normalizedVenueIds.map((id) => referenceData.venuesById?.get(id)).filter(Boolean);
  if (venueRows.length !== normalizedVenueIds.length) throw new Error("venue_ids contains an unknown or inactive event venue.");
  const ineligibleVenue = venueRows.find((venue) => venue.eligible_event_venue === false && !["ZOO_WIDE", "OFFSITE"].includes(String(venue.event_scope || "")));
  if (ineligibleVenue) throw new Error(`${ineligibleVenue.display_name || "Selected venue"} is not eligible as a primary event venue.`);

  for (const locationGroupId of coverageLocationIds) {
    const group = referenceData.groupsById?.get(locationGroupId);
    if (!group) throw new Error("coverage_location_ids contains an unknown location group.");
    if (group.eligible_custodial_coverage === false) throw new Error(`${group.group_name || "Selected location"} is not eligible for custodial coverage.`);
  }

  for (const locationGroupId of staffingAreaIds) {
    const group = referenceData.groupsById?.get(locationGroupId);
    if (!group) throw new Error("staffing_area_ids contains an unknown location group.");
    if (group.eligible_staffing_assignment === false) throw new Error(`${group.group_name || "Selected location"} is not eligible for staffing assignment.`);
  }

  let displayLocation = displayLocationInput;
  let finalLegacyLocationGroupId = legacyLocationGroupId;
  let needsReview = Boolean(payload.needs_review);
  const parseReasons = [];
  if (payload.parse_reason) parseReasons.push(String(payload.parse_reason).trim());

  if (scope === "ZOO_WIDE") {
    displayLocation = "Zoo Footprint";
    finalLegacyLocationGroupId = String(primaryVenue?.location_group_id || referenceData.zooVenue?.location_group_id || legacyLocationGroupId || "").trim();
    needsReview = false;
    parseReasons.push("Event scope is ZOO_WIDE; display location normalized to Zoo Footprint.");
  } else if (scope === "SINGLE_VENUE") {
    if (!primaryVenue) throw new Error("SINGLE_VENUE events require one eligible event venue.");
    if (primaryVenue.eligible_event_venue === false) throw new Error(`${primaryVenue.display_name || "Selected venue"} is not eligible as a primary event venue.`);
    displayLocation = primaryVenue.display_name || displayLocation || "Unknown Venue";
    finalLegacyLocationGroupId = String(primaryVenue.location_group_id || legacyLocationGroupId || "").trim();
    needsReview = false;
  } else if (scope === "MULTI_VENUE") {
    if (venueRows.length < 2) throw new Error("MULTI_VENUE events require at least two eligible event venues.");
    displayLocation = displayLocation || venueRows.map((venue) => venue.display_name).filter(Boolean).join(", ");
    primaryVenue = primaryVenue || venueRows[0] || null;
    finalLegacyLocationGroupId = String(primaryVenue?.location_group_id || legacyLocationGroupId || "").trim();
    needsReview = false;
  } else if (scope === "OFFSITE") {
    displayLocation = displayLocation || "Offsite";
    const offsiteVenue = referenceData.offsiteVenue || null;
    if (offsiteVenue) {
      primaryVenue = offsiteVenue;
      normalizedVenueIds = [offsiteVenue.venue_id];
      finalLegacyLocationGroupId = String(offsiteVenue.location_group_id || legacyLocationGroupId || "").trim();
    }
    needsReview = false;
  } else {
    scope = "UNKNOWN";
    needsReview = true;
    const compatibilityGroupId = String(referenceData.zooVenue?.location_group_id || "").trim();
    if (primaryVenueId || normalizedVenueIds.length || coverageLocationIds.length || staffingAreaIds.length
      || (legacyLocationGroupId && legacyLocationGroupId !== compatibilityGroupId)) {
      throw new Error("Needs Review events cannot assign a venue, cleaning coverage, staffing area, or location group.");
    }
    primaryVenue = null;
    normalizedVenueIds = [];
    displayLocation = "Needs Review";
    finalLegacyLocationGroupId = compatibilityGroupId;
    parseReasons.push("Event venue/scope is unresolved; saved for manager review without operational coverage.");
  }

  const legacyGroup = referenceData.groupsById?.get(finalLegacyLocationGroupId);
  if (scope !== "UNKNOWN" && legacyGroup && isRestroomGroup(legacyGroup) && !legacyGroup.eligible_event_venue) {
    throw new Error(`${legacyGroup.group_name} is a custodial coverage location, not an eligible primary event venue.`);
  }

  if (!finalLegacyLocationGroupId) {
    throw new Error("A compatible location_group_id could not be resolved for the event.");
  }
  if (!referenceData.groupsById?.has(finalLegacyLocationGroupId)) {
    throw new Error("location_group_id must reference a known location group.");
  }

  return {
    event_scope: scope,
    primary_venue_id: primaryVenue?.venue_id || null,
    venue_ids: normalizedVenueIds,
    display_location: displayLocation,
    coverage_location_ids: needsReview ? [] : coverageLocationIds,
    staffing_area_ids: needsReview ? [] : staffingAreaIds,
    source_location_text: sourceLocationText,
    parser_confidence: parserConfidence,
    needs_review: needsReview,
    parse_reason: parseReasons.filter(Boolean).join(" "),
    source_text: sourceText,
    source_format: sourceFormat,
    manually_overridden: manuallyOverridden,
    overridden_by: null,
    overridden_at: null,
    event_timezone: eventTimezone,
    location_group_id: finalLegacyLocationGroupId,
  };
}

function cleanEventName(value) {
  let text = String(value || "").replace(/\s+/g, " " ).trim();
  const labelPattern = /\b(Start Time|End Time|Location|Area|Host Department|Projected|Attendees|Event Date|Date|Notes?)\b[:\s]*/i;
  const labelMatch = text.match(labelPattern);
  if (labelMatch && labelMatch.index > 0) {
    text = text.slice(0, labelMatch.index).trim();
  }
  text = text.replace(/^Event Name\s*[:\-]?\s*/i, "").trim();
  text = text.replace(/[,;:\-\s]+$/g, "").trim();
  if (text.length > 120) text = `${text.slice(0, 117).trim()}...`;
  return text;
}

function addDaysToIsoDate(value, days = 0) {
  const [year, month, day] = String(value || "").split("-").map((part) => Number.parseInt(part, 10));
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
}

function normalizeEventPayload(payload = {}, referenceData = {}) {
  const eventName = cleanEventName(payload.event_name);
  const eventDate = String(payload.event_date || "").trim();
  const startTime = normalizeTimeInput(payload.start_time);
  const endTime = normalizeTimeInput(payload.end_time);
  const attendeeCount = toNullableInt(payload.attendee_count);
  const notes = sanitizeEventNotes(payload.notes, attendeeCount);
  const custodialNoteCodes = normalizeCustodialNoteCodes(payload.custodial_note_codes);
  const custodialPublicNotes = normalizeCustodialPublicNotes(payload.custodial_public_notes);
  const operationId = payload.operation_id == null || payload.operation_id === "" ? null : String(payload.operation_id).trim();
  const location = normalizeEventLocationPayload(payload, referenceData);

  if (!eventName) throw new Error("event_name is required.");
  if (!isIsoDate(eventDate)) throw new Error("event_date must be YYYY-MM-DD.");
  const explicitEndDate = String(payload.end_date || "").trim();
  if (operationId && !isUuid(operationId)) throw new Error("operation_id must be a valid UUID when supplied.");

  if (explicitEndDate && !isIsoDate(explicitEndDate)) throw new Error("end_date must be YYYY-MM-DD when supplied.");
  const endDate = explicitEndDate || (endTime < startTime ? addDaysToIsoDate(eventDate, 1) : eventDate);
  if (endDate < eventDate || endDate > addDaysToIsoDate(eventDate, 1)) {
    throw new Error("Event end date must be the event date or the next day.");
  }
  const interpretation = resolveChicagoEventInterval({ event_date: eventDate, end_date: endDate,
    start_time: startTime, end_time: endTime,
    start_instant_utc: payload.start_instant_utc, end_instant_utc: payload.end_instant_utc });
  const spansOvernight = endDate > eventDate;

  return {
    event_name: eventName,
    ...location,
    status: location.needs_review ? "NEEDS_REVIEW" : "SCHEDULED",
    event_date: eventDate,
    end_date: endDate,
    start_time: startTime,
    end_time: endTime,
    start_instant_utc: interpretation.start.instant_utc,
    end_instant_utc: interpretation.end.instant_utc,
    attendee_count: attendeeCount,
    notes,
    custodial_note_codes: custodialNoteCodes,
    custodial_public_notes: custodialPublicNotes,
    spans_overnight: spansOvernight,
    operation_id: operationId,
  };
}

async function listUpcomingEvents(runReadOnlySql) {
  const rows = await runReadOnlySql(buildEventResponseSelectSql(
    `coalesce(e.status, 'SCHEDULED') = 'SCHEDULED'
     and coalesce(e.needs_review, false) = false and e.event_scope <> 'UNKNOWN'
     and coalesce((place.authority->>'admissible')::boolean,false)
     and coalesce(e.end_date, e.event_date) >= (now() at time zone '${EVENTS_TIME_ZONE}')::date`,
    `order by e.event_date asc, e.start_time asc, e.event_name asc`
  ));
  return Array.isArray(rows) ? rows : [];
}

function boundedWholeNumber(value, fallback, minimum, maximum) {
  const raw = String(value ?? "").trim();
  if (!/^\d+$/.test(raw)) return fallback;
  return Math.min(maximum, Math.max(minimum, Number(raw)));
}

export async function listSharedEvents(runReadOnlySql) {
  const rows = await runReadOnlySql(buildEventResponseSelectSql(
    `(e.status = 'NEEDS_REVIEW' or
      (e.status = 'CANCELLED' and coalesce(e.needs_review,false) = true) or
      (e.status in ('SCHEDULED','CANCELLED','SUPERSEDED') and coalesce(e.needs_review, false) = false
       and e.event_scope <> 'UNKNOWN'
       and coalesce(e.end_date, e.event_date) >= (now() at time zone '${EVENTS_TIME_ZONE}')::date))`,
    `order by case when e.status = 'NEEDS_REVIEW' then 0 else 1 end,
      e.event_date asc, e.start_time asc, e.event_name asc limit 501`
  ));
  if (!Array.isArray(rows) || rows.length > 500) throw new Error("Complete bounded event source unavailable.");
  return rows;
}

const PUBLIC_EVENT_FIELDS = Object.freeze([
  "id",
  "event_name",
  "event_title",
  "event_date",
  "end_date",
  "start_time",
  "end_time",
  "spans_overnight",
  "attendee_count",
  "display_location",
  "venue_name",
  "status",
  "event_timezone",
]);

const EMPLOYEE_EVENT_FIELDS = Object.freeze([
  ...PUBLIC_EVENT_FIELDS,
  "revision",
  "custodial_note_codes",
  "start_instant_utc",
  "end_instant_utc",
  "superseded_by_event_id",
  "notes",
  "custodial_public_notes",
]);

function toPublicEvent(event = {}) {
  return Object.fromEntries(PUBLIC_EVENT_FIELDS.map((field) => [field, event[field] ?? null]));
}

function toEmployeeEvent(event = {}) {
  const safeEvent = { ...event, notes: event.custodial_public_notes || null };
  return Object.fromEntries(EMPLOYEE_EVENT_FIELDS.map((field) => [field, safeEvent[field] ?? null]));
}

function buildEventResponseSelectSql(whereSql, suffixSql = "") {
  return `select e.id,coalesce(e.revision,1) as revision,e.event_name,e.event_name as event_title,
    e.event_scope,e.status,e.audience_scope,e.audience_employee_ids,
    coalesce((place.authority->>'admissible')::boolean,false) as place_admissible,
    coalesce(nullif(place.authority->>'primary_display_name',''),e.display_location) as display_location,
    coalesce(nullif(place.authority->>'primary_display_name',''),ev.display_name,e.display_location,lg.group_name) as venue_name,
    e.location_group_id,e.primary_venue_id,e.venue_ids,e.coverage_location_ids,e.staffing_area_ids,
    e.event_date,e.end_date,to_char(e.start_time,'HH24:MI:SS') as start_time,
    to_char(e.end_time,'HH24:MI:SS') as end_time,e.start_instant_utc,e.end_instant_utc,
    (e.end_date>e.event_date) as spans_overnight,e.event_timezone,e.attendee_count,
    coalesce(e.needs_review,false) as needs_review,e.custodial_note_codes,e.custodial_public_notes,
    e.superseded_by_event_id,e.updated_at
    from public.events_app_events e join public.location_groups lg on lg.id=e.location_group_id
    left join public.event_venues ev on ev.id=e.primary_venue_id
    cross join lateral (select public.app_event_place_authority(to_jsonb(e),statement_timestamp()) as authority) place
    ${whereSql ? `where ${whereSql}` : ''} ${suffixSql}`;
}

async function listLocationGroups(runReadOnlySql) {
  const rows = await runReadOnlySql(`
    select
      lg.id as location_group_id,
      lg.group_code,
      lg.group_name,
      coalesce(lg.eligible_event_venue, false) as eligible_event_venue,
      coalesce(lg.eligible_event_scope, false) as eligible_event_scope,
      coalesce(lg.eligible_custodial_coverage, true) as eligible_custodial_coverage,
      coalesce(lg.eligible_staffing_assignment, true) as eligible_staffing_assignment,
      coalesce(lg.public_restroom, false) as public_restroom,
      coalesce(lg.staff_restroom, false) as staff_restroom,
      coalesce(lg.exhibit, false) as exhibit,
      coalesce(lg.restaurant, false) as restaurant,
      coalesce(lg.event_venue, false) as event_venue,
      coalesce(lg.administrative, false) as administrative,
      coalesce(lg.zoo_wide_scope, false) as zoo_wide_scope,
      coalesce(lg.offsite, false) as offsite,
      coalesce(
        array_agg(distinct item.name order by item.name)
          filter (where item.name is not null),
        array[]::text[]
      ) as included_locations
    from public.location_groups lg
    left join lateral (
      select l.location_name as name
      from public.location_group_memberships lgm
      join public.locations l on l.id = lgm.location_id and l.active = true
      where lgm.location_group_id = lg.id and lgm.active = true
      union
      select alias_text as name
      from public.location_group_aliases a
      where a.location_group_id = lg.id and a.active = true
      union
      select alias_text as name
      from public.event_area_aliases eaa
      where eaa.location_group_id = lg.id and eaa.active = true
    ) item on true
    where lg.active = true
       or coalesce(lg.eligible_event_scope, false) = true
       or coalesce(lg.eligible_event_venue, false) = true
    group by lg.id, lg.group_code, lg.group_name
    order by lg.group_name asc
  `);
  return Array.isArray(rows) ? rows : [];
}

async function listEventVenues(runReadOnlySql) {
  const rows = await runReadOnlySql(`
    select
      ev.id as venue_id,
      ev.venue_code,
      ev.display_name,
      ev.event_scope,
      ev.location_group_id,
      lg.group_code,
      lg.group_name,
      coalesce(ev.eligible_event_venue, false) as eligible_event_venue,
      coalesce(ev.eligible_event_scope, false) as eligible_event_scope,
      coalesce(ev.active, true) as active,
      coalesce(ev.aliases, array[]::text[]) as aliases
    from public.event_venues ev
    left join public.location_groups lg on lg.id = ev.location_group_id
    where ev.active = true
    order by case when ev.event_scope = 'ZOO_WIDE' then 0 else 1 end, ev.display_name asc
  `);
  const overlayRows = await runReadOnlySql(`select public.custodial_place_event_venue_overlay(statement_timestamp()) as overlay`);
  const rawOverlay = overlayRows?.[0]?.overlay;
  const overlay = typeof rawOverlay === "string" ? JSON.parse(rawOverlay) : rawOverlay;
  if (!Array.isArray(rows) || !Array.isArray(overlay?.venues)) throw new Error("Current Event Venue overlay is unavailable.");
  const overlayById = new Map(overlay.venues.map((row) => [String(row.venue_id), row]));
  return rows.flatMap((row) => {
    const mapped = overlayById.get(String(row.venue_id));
    if (!mapped || !["UNMAPPED", "MAPPED"].includes(mapped.mapping_status) || mapped.event_eligible !== true) return [];
    return [{ ...row,
      display_name: mapped.mapping_status === "MAPPED" ? mapped.display_name : row.display_name,
      aliases: mapped.mapping_status === "MAPPED" ? mapped.aliases : row.aliases,
      place_mapping_status: mapped.mapping_status,
      canonical_place_id: mapped.mapping_status === "MAPPED" ? mapped.canonical_place_id : null,
      capability_authority: mapped.capability_authority,
    }];
  });
}

async function listCoverageLocationGroups(runReadOnlySql) {
  const groups = await listLocationGroups(runReadOnlySql);
  return groups.filter((group) => group.eligible_custodial_coverage !== false);
}

async function listEventDefaultRules(runReadOnlySql) {
  const rows = await runReadOnlySql(`
    select
      edr.id,
      edr.match_text,
      edr.normalized_match,
      edr.event_scope,
      edr.primary_venue_id,
      ev.display_name,
      ev.venue_code,
      ev.location_group_id,
      coalesce(edr.active, true) as active
    from public.event_default_rules edr
    left join public.event_venues ev on ev.id = edr.primary_venue_id
    where edr.active = true
    order by length(edr.normalized_match) desc, edr.match_text asc
  `);
  return Array.isArray(rows) ? rows : [];
}

async function enqueueNativeEventNotifications(runRpc) {
  if (typeof runRpc !== "function") {
    return { ok: true, skipped: true, reason: "runRpc_missing", enqueued: 0 };
  }

  try {
    const result = await runRpc("mz_enqueue_employee_event_pushes", {
      p_now: new Date().toISOString(),
    });
    return result || { ok: true, enqueued: 0 };
  } catch (error) {
    console.error("native employee event enqueue failed:", error);
    return { ok: false, error: error?.message || "Native employee event enqueue failed", enqueued: 0 };
  }
}

async function queueDueScanAlerts(runScanAlertQueue) {
  if (typeof runScanAlertQueue !== "function") {
    return { ok: true, skipped: true, reason: "runScanAlertQueue_missing" };
  }

  try {
    const result = await runScanAlertQueue({
      limit: MAX_SCAN_ALERTS_PER_RUN,
      dryRun: false,
      cooldownMinutes: SCAN_ALERT_COOLDOWN_MINUTES,
      managerEscalationGraceMinutes: SCAN_ALERT_MANAGER_ESCALATION_GRACE_MINUTES,
    });
    return result || { ok: true, result_count: 0 };
  } catch (error) {
    console.error("scan alert queue failed:", error);
    return { ok: false, error: error?.message || "Scan alert queue failed" };
  }
}

export function createEventMaintenanceController({ runRpc, runScanAlertQueue }) {
  let lastRunAt = 0;
  let running = false;
  let lastStartedAt = null;
  let lastFinishedAt = null;
  let lastResult = null;

  function buildStatus() {
    return {
      running,
      last_started_at: lastStartedAt,
      last_finished_at: lastFinishedAt,
      last_run_at: lastRunAt ? new Date(lastRunAt).toISOString() : null,
      last_result: lastResult,
    };
  }

  async function runMaintenance(reason = "manual") {
    if (running) {
      const result = { ok: true, skipped: true, reason: "already_running" };
      lastResult = result;
      return result;
    }
    const now = Date.now();
    if (now - lastRunAt < EVENT_MAINTENANCE_COOLDOWN_MS) {
      const result = { ok: true, skipped: true, reason: "cooldown" };
      lastResult = result;
      return result;
    }

    running = true;
    lastRunAt = now;
    lastStartedAt = new Date(now).toISOString();
    try {
      const scheduleSync = { ok: true, skipped: true, reason: "events_are_reminders_only" };
      const nativeEventPushes = await enqueueNativeEventNotifications(runRpc);
      const scanAlerts = await queueDueScanAlerts(runScanAlertQueue);
      const result = {
        ok: nativeEventPushes?.ok !== false && scanAlerts?.ok !== false,
        reason,
        processed: Number(nativeEventPushes?.enqueued || 0),
        delivery: "native_employee_push_only",
        messenger_coupling: false,
        native_event_pushes: nativeEventPushes,
        schedule_sync: scheduleSync,
        scan_alerts: scanAlerts,
      };
      lastResult = result;
      return result;
    } catch (error) {
      console.error("events maintenance failed:", error);
      const result = { ok: false, error: error?.message || "Events maintenance failed" };
      lastResult = result;
      return result;
    } finally {
      running = false;
      lastFinishedAt = new Date().toISOString();
    }
  }

  return {
    kick(reason = "kick") {
      runMaintenance(reason).catch((error) => {
        console.error("events maintenance kick failed:", error);
        lastResult = { ok: false, error: error?.message || "Events maintenance kick failed" };
        lastFinishedAt = new Date().toISOString();
        running = false;
      });
    },
    runMaintenance,
    getStatus() {
      return buildStatus();
    },
  };
}

export function createEventsPublicRouter({
  runReadOnlySql,
  buildHealthPayload,
  appVersion,
  releaseId,
  maintenanceController,
}) {
  const router = express.Router();

  router.get("/", async (_req, res) => {
    try {
      const events = (await listUpcomingEvents(runReadOnlySql)).map(toPublicEvent);
      res.status(200).json({
        ok: true,
        data: events,
        meta: {
          version: appVersion,
          release_id: releaseId,
          contract_version: EVENTS_CONTRACT_VERSION,
          timezone: EVENTS_TIME_ZONE,
        },
      });
    } catch (error) {
      fail(res, error, "Upcoming events failed", 500);
    }
  });

  router.get("/health", (_req, res) => {
    const status = typeof maintenanceController?.getStatus === "function" ? maintenanceController.getStatus() : null;
    res.status(200).json(
      buildHealthPayload("events_public", {
        contract_version: EVENTS_CONTRACT_VERSION,
        timezone: EVENTS_TIME_ZONE,
        maintenance: status
          ? {
              running: Boolean(status.running),
              last_started_at: status.last_started_at || null,
              last_finished_at: status.last_finished_at || null,
              last_run_at: status.last_run_at || null,
              last_result: status.last_result || null,
            }
          : null,
      })
    );
  });

  router.get("/location-groups", async (_req, res) => {
    try {
      const rows = await listLocationGroups(runReadOnlySql);
      res.status(200).json({
        ok: true,
        data: rows,
        meta: {
          version: appVersion,
          release_id: releaseId,
          contract_version: EVENTS_CONTRACT_VERSION,
        },
      });
    } catch (error) {
      fail(res, error, "Location groups failed", 500);
    }
  });

  router.get("/event-venues", async (_req, res) => {
    try {
      const rows = await listEventVenues(runReadOnlySql);
      res.status(200).json({
        ok: true,
        data: rows,
        meta: {
          version: appVersion,
          release_id: releaseId,
          contract_version: EVENTS_CONTRACT_VERSION,
        },
      });
    } catch (error) {
      fail(res, error, "Event venues failed", 500);
    }
  });

  router.get("/coverage-locations", async (_req, res) => {
    try {
      const rows = await listCoverageLocationGroups(runReadOnlySql);
      res.status(200).json({
        ok: true,
        data: rows,
        meta: {
          version: appVersion,
          release_id: releaseId,
          contract_version: EVENTS_CONTRACT_VERSION,
        },
      });
    } catch (error) {
      fail(res, error, "Coverage locations failed", 500);
    }
  });

  return router;
}

export function createEventsEmployeeRouter({
  runReadOnlySql,
  appVersion,
  releaseId,
  requireDeviceAccess,
  readSyncStatus = null,
}) {
  if (typeof requireDeviceAccess !== "function") {
    throw new Error("Employee Events requires enrolled-device authentication.");
  }

  const router = express.Router();
  router.use(requireDeviceAccess);

  router.get("/", async (req, res) => {
    try {
      const device = req.memphisDevice || {};
      const credential = req.memphisDeviceCredential || {};
      const employeeId = device.assigned_employee_id || device.employee_id || null;
      if (!isUuid(employeeId) || !isUuid(credential.credential_id)) {
        return res.status(403).json({ok:false,error:"Current enrolled employee identity required."});
      }
      const rows = await listSharedEvents(runReadOnlySql);
      const events = employeeVisibleEvents(rows, employeeId).map(toEmployeeEvent);
      const syncStatus = typeof readSyncStatus === "function" ? await readSyncStatus().catch(() => null) : null;
      const feed = sharedEventFeed(rows, { employeeId, syncStatus });
      res.setHeader("Cache-Control", "private, no-store");
      res.status(200).json({
        ok: true,
        data: events,
        feed,
        meta: {
          version: appVersion,
          release_id: releaseId,
          contract_version: EVENTS_CONTRACT_VERSION,
          timezone: EVENTS_TIME_ZONE,
          generated_at: new Date().toISOString(),
          canonical_device_id: device.canonical_device_id || device.device_id || null,
          employee_id: device.assigned_employee_id || device.employee_id || null,
          assignment_epoch: Number.isSafeInteger(Number(device.assignment_epoch)) ? Number(device.assignment_epoch) : null,
          credential_id: credential.credential_id || null,
        },
      });
    } catch (error) {
      fail(res, error, "Employee events failed", 500);
    }
  });

  return router;
}

export { EVENTS_CONTRACT_VERSION, normalizeEventPayload, getEventReferenceData };
