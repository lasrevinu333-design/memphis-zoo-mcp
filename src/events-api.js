import express from "express";
import { createClient } from "@supabase/supabase-js";
import { aiParseEventTexts } from "./events-ai-parser.js";

const EVENTS_SUPABASE_CLIENT =
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;

function getEventsSupabaseClient() {
  if (!EVENTS_SUPABASE_CLIENT) {
    throw new Error("Supabase is not configured. Check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.");
  }
  return EVENTS_SUPABASE_CLIENT;
}

const EVENTS_TIME_ZONE = "America/Chicago";
const EVENTS_CONTRACT_VERSION = "events.v3";
const EVENT_MAINTENANCE_COOLDOWN_MS = 20 * 1000;
const MAX_SCAN_ALERTS_PER_RUN = 50;
const SCAN_ALERT_COOLDOWN_MINUTES = 30;
const SCAN_ALERT_MANAGER_ESCALATION_GRACE_MINUTES = 30;

function fail(res, error, fallback = "Events request failed", statusCode = 400) {
  res.status(statusCode).json({ ok: false, error: error?.message || fallback });
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
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
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

function sqlUuidArrayLiteral(ids = []) {
  const values = normalizeUuidArray(ids);
  if (!values.length) return "'{}'::uuid[]";
  return `array[${values.map((id) => `${sqlLiteral(id)}::uuid`).join(", ")}]::uuid[]`;
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
  const defaultRules = await listEventDefaultRules(runReadOnlySql);
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
  const sourceLocationText = normalizeDisplayLocation(payload.source_location_text || payload.location_group_name || "");
  const sourceText = String(payload.source_text || payload.raw_text || "").trim() || null;
  const sourceFormat = String(payload.source_format || "").trim() || null;
  const manuallyOverridden = Boolean(payload.manually_overridden);
  const overriddenBy = payload.overridden_by == null ? null : String(payload.overridden_by).trim() || null;
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
    displayLocation = displayLocation || "Needs Review";
    finalLegacyLocationGroupId = String(finalLegacyLocationGroupId || referenceData.zooVenue?.location_group_id || "").trim();
    parseReasons.push("Event venue/scope is unresolved and requires manager review.");
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
    coverage_location_ids: coverageLocationIds,
    staffing_area_ids: staffingAreaIds,
    source_location_text: sourceLocationText || null,
    parser_confidence: parserConfidence,
    needs_review: needsReview,
    parse_reason: parseReasons.filter(Boolean).join(" "),
    source_text: sourceText,
    source_format: sourceFormat,
    manually_overridden: manuallyOverridden,
    overridden_by: overriddenBy,
    overridden_at: manuallyOverridden ? new Date().toISOString() : null,
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
  const createdBy = payload.created_by == null ? null : String(payload.created_by).trim() || null;
  const operationId = payload.operation_id == null || payload.operation_id === "" ? null : String(payload.operation_id).trim();
  const location = normalizeEventLocationPayload(payload, referenceData);

  if (!eventName) throw new Error("event_name is required.");
  if (location.needs_review || location.event_scope === "UNKNOWN") {
    throw new Error("Event scope or venue requires review before saving. Select Zoo Footprint or an eligible event venue.");
  }
  if (!isIsoDate(eventDate)) throw new Error("event_date must be YYYY-MM-DD.");
  if (endTime === startTime) throw new Error("end_time must differ from start_time.");
  if (operationId && !isUuid(operationId)) throw new Error("operation_id must be a valid UUID when supplied.");

  const spansOvernight = endTime < startTime;
  const endDate = spansOvernight ? addDaysToIsoDate(eventDate, 1) : eventDate;

  return {
    event_name: eventName,
    ...location,
    event_date: eventDate,
    end_date: endDate,
    start_time: startTime,
    end_time: endTime,
    attendee_count: attendeeCount,
    notes,
    created_by: createdBy,
    spans_overnight: spansOvernight,
    operation_id: operationId,
  };
}

async function listUpcomingEvents(runReadOnlySql) {
  const rows = await runReadOnlySql(buildEventResponseSelectSql(
    `coalesce(e.status, 'SCHEDULED') = 'SCHEDULED'
     and coalesce(e.end_date, e.event_date) >= (now() at time zone '${EVENTS_TIME_ZONE}')::date`,
    `order by e.event_date asc, e.start_time asc, e.event_name asc`
  ));
  return Array.isArray(rows) ? rows : [];
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

function toPublicEvent(event = {}) {
  return Object.fromEntries(PUBLIC_EVENT_FIELDS.map((field) => [field, event[field] ?? null]));
}

function buildEventResponseSelectSql(whereSql, suffixSql = "") {
  const where = String(whereSql || "").trim();
  const suffix = String(suffixSql || "").trim();
  return `
    select
      e.id,
      e.event_name,
      e.event_name as event_title,
      coalesce(e.event_scope, 'UNKNOWN') as event_scope,
      coalesce(e.status, 'SCHEDULED') as status,
      e.cancelled_at,
      e.cancelled_by,
      e.cancellation_reason,
      e.archived_at,
      e.primary_venue_id,
      e.venue_ids,
      e.display_location,
      e.coverage_location_ids,
      e.staffing_area_ids,
      e.source_location_text,
      e.parser_confidence,
      coalesce(e.needs_review, false) as needs_review,
      e.parse_reason,
      coalesce(e.manually_overridden, false) as manually_overridden,
      e.overridden_by,
      e.overridden_at,
      coalesce(e.event_timezone, '${EVENTS_TIME_ZONE}') as event_timezone,
      e.location_group_id,
      coalesce(ev.venue_code, lg.group_code) as venue_code,
      coalesce(ev.display_name, nullif(e.display_location, ''), lg.group_name) as venue_name,
      coalesce(ev.venue_code, lg.group_code) as group_code,
      coalesce(nullif(e.display_location, ''), ev.display_name, lg.group_name) as group_name,
      e.event_date,
      e.end_date,
      to_char(e.start_time, 'HH24:MI:SS') as start_time,
      to_char(e.end_time, 'HH24:MI:SS') as end_time,
      (e.end_date > e.event_date) as spans_overnight,
      e.attendee_count,
      case
        when nullif(btrim(e.notes), '') is null then null
        when e.attendee_count is not null and btrim(e.notes) = e.attendee_count::text then null
        else e.notes
      end as notes,
      e.created_by,
      e.created_at,
      e.updated_at
    from public.events_app_events e
    join public.location_groups lg on lg.id = e.location_group_id
    left join public.event_venues ev on ev.id = e.primary_venue_id
    ${where ? `where ${where}` : ""}
    ${suffix}
  `;
}

async function readEventByOperationId(runReadOnlySql, operationId) {
  const normalizedId = String(operationId || "").trim();
  if (!isUuid(normalizedId)) return null;
  const rows = await runReadOnlySql(buildEventResponseSelectSql(
    `e.operation_id = ${sqlLiteral(normalizedId)}::uuid`,
    "limit 1"
  ));
  return Array.isArray(rows) && rows[0]?.id ? rows[0] : null;
}

async function readEventById(runReadOnlySql, eventId) {
  const normalizedId = String(eventId || "").trim();
  if (!isUuid(normalizedId)) return null;
  const rows = await runReadOnlySql(buildEventResponseSelectSql(
    `e.id = ${sqlLiteral(normalizedId)}::uuid`,
    "limit 1"
  ));
  return Array.isArray(rows) && rows[0]?.id ? rows[0] : null;
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
  return Array.isArray(rows) ? rows : [];
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

async function getUpcomingEventScheduleStates(runReadOnlySql) {
  const rows = await runReadOnlySql(`
    select
      e.event_date,
      count(distinct e.id)::int as event_count,
      (
        select count(*)::int
        from public.daily_schedule_assignments dsa
        where dsa.service_date = e.event_date
      ) as schedule_assignment_count,
      (
        select count(*)::int
        from public.daily_group_assignments dga
        where dga.assignment_date = e.event_date
          and dga.active = true
          and dga.assigned_employee_id is not null
      ) as group_assignment_count
    from public.events_app_events e
    where e.event_date <= ((now() at time zone '${EVENTS_TIME_ZONE}')::date + 1)
      and coalesce(e.end_date, e.event_date) >= (now() at time zone '${EVENTS_TIME_ZONE}')::date
    group by e.event_date
    order by e.event_date asc
  `);
  return Array.isArray(rows) ? rows : [];
}

async function ensureUpcomingEventScheduleState({ runReadOnlySql, runRpc }) {
  const eventScheduleStates = await getUpcomingEventScheduleStates(runReadOnlySql);
  return {
    ok: true,
    skipped: true,
    reason: "events_are_reminders_only",
    checked_dates: eventScheduleStates.length,
    generated_dates: [],
  };

  if (typeof runRpc !== "function") {
    return { ok: true, skipped: true, reason: "runRpc_missing", generated_dates: [] };
  }

  const states = await getUpcomingEventScheduleStates(runReadOnlySql);
  const generatedDates = [];

  for (const state of states) {
    if (Number(state?.schedule_assignment_count || 0) > 0) continue;
    const eventDate = String(state?.event_date || "").trim();
    if (!eventDate) continue;
    await runRpc("sch_generate_daily_schedule", { p_service_date: eventDate, p_force: false });
    generatedDates.push(eventDate);
  }

  return { ok: true, checked_dates: states.length, generated_dates: generatedDates };
}

function buildEventInsertSql(record) {
  const operationConflict = record.operation_id
    ? `on conflict (operation_id) where operation_id is not null do update set updated_at = public.events_app_events.updated_at`
    : "";
  return `insert into public.events_app_events (
       event_name,
       location_group_id,
       event_scope,
       primary_venue_id,
       venue_ids,
       display_location,
       coverage_location_ids,
       staffing_area_ids,
       source_location_text,
       parser_confidence,
       needs_review,
       parse_reason,
       source_text,
       source_format,
       manually_overridden,
       overridden_by,
       overridden_at,
       event_timezone,
       operation_id,
       event_date,
       end_date,
       start_time,
       end_time,
       attendee_count,
       notes,
       created_by,
       updated_at
     ) values (
       ${sqlLiteral(record.event_name)},
       ${sqlLiteral(record.location_group_id)}::uuid,
       ${sqlLiteral(record.event_scope)},
       ${record.primary_venue_id ? `${sqlLiteral(record.primary_venue_id)}::uuid` : "null"},
       ${sqlUuidArrayLiteral(record.venue_ids)},
       ${sqlLiteral(record.display_location)},
       ${sqlUuidArrayLiteral(record.coverage_location_ids)},
       ${sqlUuidArrayLiteral(record.staffing_area_ids)},
       ${sqlLiteral(record.source_location_text)},
       ${sqlLiteral(record.parser_confidence)},
       ${record.needs_review ? "true" : "false"},
       ${sqlLiteral(record.parse_reason)},
       ${sqlLiteral(record.source_text)},
       ${sqlLiteral(record.source_format)},
       ${record.manually_overridden ? "true" : "false"},
       ${sqlLiteral(record.overridden_by)},
       ${record.overridden_at ? `${sqlLiteral(record.overridden_at)}::timestamptz` : "null"},
       ${sqlLiteral(record.event_timezone)},
       ${record.operation_id ? `${sqlLiteral(record.operation_id)}::uuid` : "null"},
       ${sqlLiteral(record.event_date)}::date,
       ${sqlLiteral(record.end_date)}::date,
       ${sqlLiteral(record.start_time)}::time,
       ${sqlLiteral(record.end_time)}::time,
       ${record.attendee_count == null ? "null" : record.attendee_count},
       ${sqlLiteral(record.notes)},
       ${sqlLiteral(record.created_by)},
       now()
     )
     ${operationConflict}
     returning *;`;
}

function buildEventUpdateSql(eventId, record) {
  return `with before_row as (
       select to_jsonb(e.*) as previous_record
       from public.events_app_events e
       where e.id = ${sqlLiteral(eventId)}::uuid
       for update
     ), updated as (
       update public.events_app_events e
          set event_name = ${sqlLiteral(record.event_name)},
              location_group_id = ${sqlLiteral(record.location_group_id)}::uuid,
              event_scope = ${sqlLiteral(record.event_scope)},
              primary_venue_id = ${record.primary_venue_id ? `${sqlLiteral(record.primary_venue_id)}::uuid` : "null"},
              venue_ids = ${sqlUuidArrayLiteral(record.venue_ids)},
              display_location = ${sqlLiteral(record.display_location)},
              coverage_location_ids = ${sqlUuidArrayLiteral(record.coverage_location_ids)},
              staffing_area_ids = ${sqlUuidArrayLiteral(record.staffing_area_ids)},
              source_location_text = ${sqlLiteral(record.source_location_text)},
              parser_confidence = ${sqlLiteral(record.parser_confidence)},
              needs_review = ${record.needs_review ? "true" : "false"},
              parse_reason = ${sqlLiteral(record.parse_reason)},
              source_text = ${sqlLiteral(record.source_text)},
              source_format = ${sqlLiteral(record.source_format)},
              manually_overridden = true,
              overridden_by = ${sqlLiteral(record.overridden_by || record.created_by || "Input Console")},
              overridden_at = now(),
              event_timezone = ${sqlLiteral(record.event_timezone)},
              event_date = ${sqlLiteral(record.event_date)}::date,
              end_date = ${sqlLiteral(record.end_date)}::date,
              start_time = ${sqlLiteral(record.start_time)}::time,
              end_time = ${sqlLiteral(record.end_time)}::time,
              attendee_count = ${record.attendee_count == null ? "null" : record.attendee_count},
              notes = ${sqlLiteral(record.notes)},
              revision = coalesce(e.revision, 1) + 1,
              updated_at = now()
        from before_row
        where e.id = ${sqlLiteral(eventId)}::uuid
        returning e.*, before_row.previous_record
     ), history as (
       insert into public.events_app_event_history (
         event_id, action, actor, reason, previous_record, new_record, created_at
       )
       select id, 'update', ${sqlLiteral(record.overridden_by || record.created_by || "Input Console")},
              ${sqlLiteral(record.parse_reason || "Event updated from Event Input Console.")},
              previous_record, to_jsonb(updated.*) - 'previous_record', now()
       from updated
       returning id
     )
     select * from updated;`;
}

function normalizeWriteResultRows(result) {
  if (Array.isArray(result)) return result.filter(Boolean);
  if (result && typeof result === "object") return [result];
  return [];
}

async function createEventRecord(runReadOnlySql, runWriteSql, payload) {
  const referenceData = await getEventReferenceData(runReadOnlySql);
  const record = normalizeEventPayload(payload, referenceData);
  const rows = normalizeWriteResultRows(await runWriteSql(
    "events_app_create",
    buildEventInsertSql(record)
  ));
  const writeRow = rows.find((row) => row?.id);
  if (writeRow) return { ...record, ...writeRow };
  const authoritativeRow = await readEventByOperationId(runReadOnlySql, record.operation_id);
  if (authoritativeRow) return { ...record, ...authoritativeRow };
  return record;
}

async function updateEventRecord(runReadOnlySql, runWriteSql, eventId, payload) {
  const normalizedId = String(eventId || "").trim();
  if (!isUuid(normalizedId)) throw new Error("A valid event id is required.");
  const referenceData = await getEventReferenceData(runReadOnlySql);
  const record = normalizeEventPayload({ ...payload, manually_overridden: true }, referenceData);
  const rows = normalizeWriteResultRows(await runWriteSql("events_app_update", buildEventUpdateSql(normalizedId, record)));
  const writeRow = rows.find((row) => row?.id);
  if (writeRow) return { ...record, ...writeRow, previous_record: undefined };
  const authoritativeRow = await readEventById(runReadOnlySql, normalizedId);
  if (authoritativeRow) return { ...record, ...authoritativeRow, previous_record: undefined };
  throw new Error("Event not found.");
}

async function deleteEventRecord(runWriteSql, eventId, actor = "Input Console", reason = "Event cancelled from Event Input Console.") {
  const normalizedId = String(eventId || "").trim();
  if (!isUuid(normalizedId)) throw new Error("A valid event id is required.");
  const rows = normalizeWriteResultRows(await runWriteSql("events_app_cancel", `
    with before_row as (
      select e.*, to_jsonb(e.*) as previous_record
      from public.events_app_events e
      where e.id = ${sqlLiteral(normalizedId)}::uuid
      for update
    ), updated as (
      update public.events_app_events e
      set status = 'CANCELLED',
          cancelled_at = coalesce(e.cancelled_at, now()),
          cancelled_by = ${sqlLiteral(String(actor || "Input Console").slice(0, 200))},
          cancellation_reason = ${sqlLiteral(String(reason || "Event cancelled.").slice(0, 1000))},
          revision = coalesce(e.revision, 1) + 1,
          updated_at = now()
      from before_row
      where e.id = before_row.id
      returning e.*, before_row.previous_record
    ), history as (
      insert into public.events_app_event_history(event_id, action, actor, reason, previous_record, new_record, created_at)
      select id, 'cancel', ${sqlLiteral(String(actor || "Input Console").slice(0, 200))},
             ${sqlLiteral(String(reason || "Event cancelled.").slice(0, 1000))},
             previous_record, to_jsonb(updated.*) - 'previous_record', now()
      from updated
      returning id
    )
    select id, status, cancelled_at, cancelled_by, cancellation_reason, revision
    from updated;
  `));
  const row = rows.find((item) => item?.id);
  if (!row) throw Object.assign(new Error("Event not found."), { status: 404 });
  return { ...row, deleted: false, cancelled: true };
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

async function queueDueScanAlerts(runRpc) {
  if (typeof runRpc !== "function") {
    return { ok: true, skipped: true, reason: "runRpc_missing" };
  }

  try {
    const result = await runRpc("sch_queue_due_scan_alerts", {
      p_limit: MAX_SCAN_ALERTS_PER_RUN,
      p_dry_run: false,
      p_cooldown_minutes: SCAN_ALERT_COOLDOWN_MINUTES,
      p_manager_escalation_grace_minutes: SCAN_ALERT_MANAGER_ESCALATION_GRACE_MINUTES,
    });
    return result || { ok: true, result_count: 0 };
  } catch (error) {
    console.error("scan alert queue failed:", error);
    return { ok: false, error: error?.message || "Scan alert queue failed" };
  }
}

export function createEventMaintenanceController({ runReadOnlySql, runWriteSql, runRpc }) {
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
      const scanAlerts = await queueDueScanAlerts(runRpc);
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
  runWriteSql,
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

export function createEventsAdminRouter({
  runReadOnlySql,
  runWriteSql,
  buildHealthPayload,
  appVersion,
  releaseId,
  maintenanceController,
  requireAdminApiAuth,
  requireAdminApiWrite,
}) {
  const router = express.Router();
  if (typeof requireAdminApiAuth === "function") {
    router.use(requireAdminApiAuth);
  }

  router.get("/", async (_req, res) => {
    try {
      const events = await listUpcomingEvents(runReadOnlySql);
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
      fail(res, error, "Admin events list failed", 500);
    }
  });

  router.get("/health", (_req, res) => {
    res.status(200).json(
      buildHealthPayload("events_admin", {
        contract_version: EVENTS_CONTRACT_VERSION,
        timezone: EVENTS_TIME_ZONE,
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

  router.post("/parse-ai", async (req, res) => {
    try {
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const texts = Array.isArray(body.texts)
        ? body.texts.map((text) => String(text || "").trim()).filter(Boolean)
        : [String(body.text || "").trim()].filter(Boolean);
      if (!texts.length) throw new Error("text or texts is required.");
      const groups = await listLocationGroups(runReadOnlySql);
      const eventVenues = await listEventVenues(runReadOnlySql);
      const eventDefaults = await listEventDefaultRules(runReadOnlySql);
      const parsed = await aiParseEventTexts({ texts, locationGroups: groups, eventVenues, eventDefaults });
      const providersUsed = Array.from(new Set(parsed.map((row) => String(row?.provider_used || row?.provider || "local-parser").trim()).filter(Boolean)));
      const fallbackCount = parsed.filter((row) => row?.provider_fallback).length;
      res.status(200).json({
        ok: true,
        data: parsed,
        meta: {
          version: appVersion,
          release_id: releaseId,
          contract_version: EVENTS_CONTRACT_VERSION,
          provider: providersUsed.length === 1 ? providersUsed[0] : "hybrid",
          providers_used: providersUsed,
          fallback_count: fallbackCount,
        },
      });
    } catch (error) {
      fail(res, error, "AI event parse failed", 400);
    }
  });

  router.post("/", typeof requireAdminApiWrite === "function" ? requireAdminApiWrite : (_req, _res, next) => next(), async (req, res) => {
    try {
      const record = await createEventRecord(
        runReadOnlySql,
        runWriteSql,
        req.body && typeof req.body === "object" ? req.body : {}
      );
      maintenanceController?.kick("events_admin_create_after");
      res.status(200).json({
        ok: true,
        data: record,
        meta: {
          version: appVersion,
          release_id: releaseId,
          contract_version: EVENTS_CONTRACT_VERSION,
        },
      });
    } catch (error) {
      fail(res, error, "Create event failed", 400);
    }
  });

  router.put("/:eventId", typeof requireAdminApiWrite === "function" ? requireAdminApiWrite : (_req, _res, next) => next(), async (req, res) => {
    try {
      const record = await updateEventRecord(
        runReadOnlySql,
        runWriteSql,
        req.params.eventId,
        req.body && typeof req.body === "object" ? req.body : {}
      );
      maintenanceController?.kick("events_admin_update_after");
      res.status(200).json({
        ok: true,
        data: record,
        meta: {
          version: appVersion,
          release_id: releaseId,
          contract_version: EVENTS_CONTRACT_VERSION,
        },
      });
    } catch (error) {
      fail(res, error, "Update event failed", 400);
    }
  });

  router.delete("/:eventId", typeof requireAdminApiWrite === "function" ? requireAdminApiWrite : (_req, _res, next) => next(), async (req, res) => {
    try {
      const result = await deleteEventRecord(
        runWriteSql,
        req.params.eventId,
        req.body?.cancelled_by || req.body?.actor || "Input Console",
        req.body?.reason || "Event cancelled from Event Input Console.",
      );
      res.status(200).json({
        ok: true,
        data: result,
        meta: {
          version: appVersion,
          release_id: releaseId,
          contract_version: EVENTS_CONTRACT_VERSION,
        },
      });
    } catch (error) {
      fail(res, error, "Delete event failed", 400);
    }
  });

  return router;
}

export { EVENTS_CONTRACT_VERSION };
