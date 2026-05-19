import express from "express";
import { aiParseEventTexts } from "./events-ai-parser.js";

const EVENTS_TIME_ZONE = "America/Chicago";
const EVENTS_CONTRACT_VERSION = "events.v1";
const DAY_BEFORE_NOTIFICATION_TIME = "08:00:00";
const EVENT_MAINTENANCE_COOLDOWN_MS = 20 * 1000;
const MAX_NOTIFICATIONS_PER_RUN = 50;
const MAX_SCAN_ALERTS_PER_RUN = 50;
const SCAN_ALERT_COOLDOWN_MINUTES = 30;

const EVENT_PARSER_TEST_FIXTURES = [
  { id: "zoom-zoo-courtyard-restrooms", text: "I would like to request that the courtyard restrooms remain open and be cleaned prior to the Zoom through the Zoo on Thursday, May 21st. The event will run from 6:30 pm - 8:30/9:00 pm. Some guests will come in to use the restrooms as they arrive, starting at 5:00 pm. I would also like to request a few extra trash boxes in the courtyard for the race crowd.", expect: { event_name: "Zoom through the Zoo", area_contains: "Courtyard", event_date: "2026-05-21", start_time: "18:30", end_time: "21:00", notes_include: ["remain open", "cleaned", "trash"], notes_exclude: ["Operational flags", "event will run"] } },
  { id: "zoo-brew-courtyard", text: "Can we keep the Courtyard restrooms open for the Zoo Brew thing on Friday June 6th? Guests start arriving around 5:15 but the actual event is 6:00p-9/9:30pm. Please add trash cans near the courtyard and check paper before it starts.", expect: { event_name: "Zoo Brew", area_contains: "Courtyard", event_date: "2026-06-06", start_time: "18:00", end_time: "21:30", notes_include: ["trash", "paper"], notes_exclude: ["actual event"] } },
  { id: "donor-dinner-teton", text: "Event Name: Donor Dinner Location: Teton Trek Date: 6/12 Start: 5:30 pm End: 8:00 pm Guests: 85 Notes: catering, extra trash, restroom check before dinner and after dessert", expect: { event_name: "Donor Dinner", area_contains: "Teton", event_date: "2026-06-12", start_time: "17:30", end_time: "20:00", attendee_count: "85", notes_include: ["catering", "trash", "restroom"] } },
  { id: "teton-at-teton-trek-no-title", text: "Teton at Teton Trek on June 12 from 5:30 pm to 8:00 pm. Need trash and restroom check before guests arrive.", expect: { event_name: "Teton Trek", area_contains: "Teton", event_date: "2026-06-12", start_time: "17:30", end_time: "20:00", notes_include: ["trash", "restroom"] } },
  { id: "training-games-china", text: "Training Games will be over by China / CHINA area on Wed May 20 from 1:00 PM to 2:30 PM. Not sure if they mean China exhibit or China restrooms. No notes.", expect: { event_name: "Training Games", area_contains: "China", event_date: "2026-05-20", start_time: "13:00", end_time: "14:30", notes_include: ["exhibit", "restrooms"] } },
  { id: "twilight-safari-primate", text: "Please note a private tour called Twilight Safari at Primate Pavilion on Thursday, May 28th from 6:30pm - 8:30/9:00pm. Need restrooms checked before arrival and trash pulled after.", expect: { event_name: "Twilight Safari", area_contains: "Primate", event_date: "2026-05-28", start_time: "18:30", end_time: "21:00", notes_include: ["restrooms", "trash"] } },
  { id: "school-group-nwp", text: "On May 30th from 10am to noon there will be 120 school kids in Northwest Passage. Please keep nearby restrooms stocked and add one trash box by the exit.", expect: { event_name: "School Group", area_contains: "North West Passage", event_date: "2026-05-30", start_time: "10:00", end_time: "12:00", attendee_count: "120", notes_include: ["restrooms", "trash"] } },
  { id: "keeper-chat-aquarium", text: "Host Department: Education | Manager on Duty: TBD | Event: Keeper Chat Madness | Area: Aquarium | Event Date: June 3 | Start Time: 9:45 AM | End Time: 11:15 AM | Projected: 45 | Staff vendors security marketing animal staff | Notes: wipe counters, check restroom supplies, remove extra trash after group leaves", expect: { event_name: "Keeper Chat Madness", area_contains: "Aquarium", event_date: "2026-06-03", start_time: "09:45", end_time: "11:15", attendee_count: "45", notes_include: ["wipe counters", "restroom", "trash"], notes_exclude: ["vendors", "animal staff"] } },
  { id: "run-wild-courtyard", text: "I would like to request extra trash boxes and restroom checks for Run Wild near the courtyard on Saturday, June 14th. Race crowd starts coming in around 6:00am but event window is 7:00am-10:30am. Please keep courtyard restrooms open early.", expect: { event_name: "Run Wild", area_contains: "Courtyard", event_date: "2026-06-14", start_time: "07:00", end_time: "10:30", notes_include: ["trash", "restroom", "open early"], notes_exclude: ["event window"] } },
  { id: "member-preview-zambezi", text: "The member preview at Zambezi is Thursday June 19, 5:30-7:30 pm. Please check the bathrooms before 5 and again after close. No attendee count yet.", expect: { event_name: "Member Preview", area_contains: "Zambezi", event_date: "2026-06-19", start_time: "17:30", end_time: "19:30", notes_include: ["bathrooms", "after close"] } },
  { id: "corporate-picnic-cat-house", text: "Setup needed for Corporate Picnic in Cat House Cafe on 21 June from 4p to 7p. About 60 people. Need trash, restroom check, and mop after food service.", expect: { event_name: "Corporate Picnic", area_contains: "Cat", event_date: "2026-06-21", start_time: "16:00", end_time: "19:00", attendee_count: "60", notes_include: ["trash", "restroom", "mop"] } },
  { id: "vague-lunch-pavilion", text: "Big group coming next Thursday sometime around lunch at the pavilion. Maybe 100 people. Need extra trash and bathrooms checked.", expect: { event_name: "Large Group", area_contains: "Pavilion", start_time: "12:00", end_time: "13:00", attendee_count: "100", notes_include: ["trash", "bathrooms"] } },
  { id: "baby-day-event-center", text: "Baby Day EC 5/9 9a-6p 500 guests. Need trash pulls and restroom checks all day.", expect: { event_name: "Baby Day", area_contains: "Event Center", event_date: "2026-05-09", start_time: "09:00", end_time: "18:00", attendee_count: "500", notes_include: ["trash", "restroom"] } },
  { id: "windsor-prom-primate-typo", text: "Windsor Prom at Primate Pavillion on 4/28 630pm to 9pm 55 people. Need restroom check and trash after.", expect: { event_name: "Windsor Prom", area_contains: "Primate", event_date: "2026-04-28", start_time: "18:30", end_time: "21:00", attendee_count: "55", notes_include: ["restroom", "trash"] } },
  { id: "lebonheur-walmart-teton-lodge", text: "LeBonheur Walmart Day at Teton Trek Lodge Only on 4/30 8:00 AM-12:00 PM. Notes: Lodge only, keep restrooms stocked.", expect: { event_name: "LeBonheur Walmart Day", area_contains: "Teton", event_date: "2026-04-30", start_time: "08:00", end_time: "12:00", notes_include: ["Lodge", "restrooms"] } },
  { id: "china-theater-all-caps", text: "CHINA THEATER donor thing - June 8 - 1830 to 2030 - 75 guests - wipe counters and pull trash after.", expect: { event_name: "donor thing", area_contains: "China", event_date: "2026-06-08", start_time: "18:30", end_time: "20:30", attendee_count: "75", notes_include: ["wipe", "trash"] } },
  { id: "splash-pad-birthday", text: "Birthday party Splash Pad Event Center Sat June 13 10:30a-1p 35 guests. Need extra trash and bathroom check before party.", expect: { event_name: "Birthday party", area_contains: "Splash", event_date: "2026-06-13", start_time: "10:30", end_time: "13:00", attendee_count: "35", notes_include: ["trash", "bathroom"] } },
  { id: "farm-event-compact", text: "Farm event 6/18 730a-11a 90 kids. Extra cans, restrooms checked before buses arrive.", expect: { event_name: "Farm event", area_contains: "Farm", event_date: "2026-06-18", start_time: "07:30", end_time: "11:00", attendee_count: "90", notes_include: ["cans", "restrooms"] } },
  { id: "aquarium-after-hours", text: "After hours rental Aquarium June 25 6 to 9pm. No count yet. Need restroom check before guests arrive and trash pulled after.", expect: { event_name: "After hours rental", area_contains: "Aquarium", event_date: "2026-06-25", start_time: "18:00", end_time: "21:00", notes_include: ["restroom", "trash"] } },
  { id: "plaza-public-event", text: "Public event at plaza next Friday 11am-2pm maybe 300 people. Need extra trash boxes and restroom supply check.", expect: { event_name: "Public event", area_contains: "Plaza", start_time: "11:00", end_time: "14:00", attendee_count: "300", notes_include: ["trash", "restroom"] } }
];

function fail(res, error, fallback = "Events request failed", statusCode = 400) {
  res.status(statusCode).json({ ok: false, error: error?.message || fallback });
}

function sqlLiteral(value) {
  if (value == null) return "null";
  return `'${String(value).replace(/'/g, "''")}'`;
}

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "").trim());
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

function normalizeEventPayload(payload = {}) {
  const eventName = cleanEventName(payload.event_name);
  const locationGroupId = String(payload.location_group_id || "").trim();
  const eventDate = String(payload.event_date || "").trim();
  const startTime = normalizeTimeInput(payload.start_time);
  const endTime = normalizeTimeInput(payload.end_time);
  const attendeeCount = toNullableInt(payload.attendee_count);
  const notes = payload.notes == null ? null : String(payload.notes).trim() || null;
  const createdBy = payload.created_by == null ? null : String(payload.created_by).trim() || null;

  if (!eventName) throw new Error("event_name is required.");
  if (!isUuid(locationGroupId)) throw new Error("location_group_id must be a valid UUID.");
  if (!isIsoDate(eventDate)) throw new Error("event_date must be YYYY-MM-DD.");
  if (endTime <= startTime) throw new Error("end_time must be later than start_time.");

  return {
    event_name: eventName,
    location_group_id: locationGroupId,
    event_date: eventDate,
    start_time: startTime,
    end_time: endTime,
    attendee_count: attendeeCount,
    notes,
    created_by: createdBy,
  };
}

async function purgeExpiredEvents(runWriteSql) {
  if (typeof runWriteSql !== "function") return;
  await runWriteSql(
    "events_app_purge",
    `delete from public.events_app_events
     where event_date < (now() at time zone '${EVENTS_TIME_ZONE}')::date;`
  );
}

async function listUpcomingEvents(runReadOnlySql) {
  const rows = await runReadOnlySql(`
    select
      e.id,
      e.event_name,
      e.location_group_id,
      lg.group_code,
      lg.group_name,
      e.event_date,
      to_char(e.start_time, 'HH24:MI:SS') as start_time,
      to_char(e.end_time, 'HH24:MI:SS') as end_time,
      e.attendee_count,
      e.notes,
      e.created_by,
      e.created_at,
      e.updated_at
    from public.events_app_events e
    join public.location_groups lg on lg.id = e.location_group_id
    where e.event_date >= (now() at time zone '${EVENTS_TIME_ZONE}')::date
    order by e.event_date asc, e.start_time asc, e.event_name asc
  `);
  return Array.isArray(rows) ? rows : [];
}

function normalizeParserComparable(value) {
  return String(value == null ? "" : value).trim().toLowerCase();
}

function normalizeParserTime(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.slice(0, 5);
}

function parserExpectationFailures(row = {}, expect = {}) {
  const failures = [];
  if (expect.event_name && normalizeParserComparable(row.event_name) !== normalizeParserComparable(expect.event_name)) {
    failures.push(`event_name expected ${expect.event_name}, got ${row.event_name || "blank"}`);
  }
  if (expect.area_contains && !normalizeParserComparable(row.location_group_name).includes(normalizeParserComparable(expect.area_contains))) {
    failures.push(`area expected to contain ${expect.area_contains}, got ${row.location_group_name || "blank"}`);
  }
  if (expect.event_date && String(row.event_date || "") !== String(expect.event_date)) {
    failures.push(`event_date expected ${expect.event_date}, got ${row.event_date || "blank"}`);
  }
  if (expect.start_time && normalizeParserTime(row.start_time) !== String(expect.start_time)) {
    failures.push(`start_time expected ${expect.start_time}, got ${normalizeParserTime(row.start_time) || "blank"}`);
  }
  if (expect.end_time && normalizeParserTime(row.end_time) !== String(expect.end_time)) {
    failures.push(`end_time expected ${expect.end_time}, got ${normalizeParserTime(row.end_time) || "blank"}`);
  }
  if (expect.attendee_count && String(row.attendee_count ?? "") !== String(expect.attendee_count)) {
    failures.push(`attendee_count expected ${expect.attendee_count}, got ${row.attendee_count ?? "blank"}`);
  }
  const notes = normalizeParserComparable(row.notes);
  for (const required of Array.isArray(expect.notes_include) ? expect.notes_include : []) {
    if (!notes.includes(normalizeParserComparable(required))) failures.push(`notes missing ${required}`);
  }
  for (const banned of Array.isArray(expect.notes_exclude) ? expect.notes_exclude : []) {
    if (notes.includes(normalizeParserComparable(banned))) failures.push(`notes should not include ${banned}`);
  }
  return failures;
}

async function runParserRegressionTests({ runReadOnlySql, fixtures = EVENT_PARSER_TEST_FIXTURES, includeRows = true } = {}) {
  const groups = await listLocationGroups(runReadOnlySql);
  const results = [];
  let passed = 0;
  let failed = 0;
  for (const fixture of fixtures) {
    const parsedRows = await aiParseEventTexts({ texts: [fixture.text], locationGroups: groups });
    const row = Array.isArray(parsedRows) ? parsedRows[0] || {} : {};
    const failures = parserExpectationFailures(row, fixture.expect || {});
    const ok = failures.length === 0;
    if (ok) passed += 1;
    else failed += 1;
    results.push({
      id: fixture.id,
      ok,
      failures,
      expected: fixture.expect,
      parsed: includeRows ? row : undefined,
    });
  }
  return {
    ok: failed === 0,
    total: results.length,
    passed,
    failed,
    results,
  };
}

async function listLocationGroups(runReadOnlySql) {
  const rows = await runReadOnlySql(`
    select
      lg.id as location_group_id,
      lg.group_code,
      lg.group_name,
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
    group by lg.id, lg.group_code, lg.group_name
    order by lg.group_name asc
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
    where e.event_date between (now() at time zone '${EVENTS_TIME_ZONE}')::date
      and ((now() at time zone '${EVENTS_TIME_ZONE}')::date + 1)
    group by e.event_date
    order by e.event_date asc
  `);
  return Array.isArray(rows) ? rows : [];
}

async function ensureUpcomingEventScheduleState({ runReadOnlySql, runRpc }) {
  if (typeof runRpc !== "function") {
    return { ok: true, skipped: true, reason: "runRpc_missing", generated_dates: [] };
  }

  const states = await getUpcomingEventScheduleStates(runReadOnlySql);
  const generatedDates = [];

  for (const state of states) {
    if (Number(state?.schedule_assignment_count || 0) > 0) continue;
    const eventDate = String(state?.event_date || "").trim();
    if (!eventDate) continue;
    await runRpc("sch_generate_daily_schedule", { p_service_date: eventDate, p_force: true });
    generatedDates.push(eventDate);
  }

  return { ok: true, checked_dates: states.length, generated_dates: generatedDates };
}

async function createEventRecord(runWriteSql, payload) {
  const record = normalizeEventPayload(payload);
  await runWriteSql(
    "events_app_create",
    `insert into public.events_app_events (
       event_name,
       location_group_id,
       event_date,
       start_time,
       end_time,
       attendee_count,
       notes,
       created_by,
       updated_at
     ) values (
       ${sqlLiteral(record.event_name)},
       ${sqlLiteral(record.location_group_id)}::uuid,
       ${sqlLiteral(record.event_date)}::date,
       ${sqlLiteral(record.start_time)}::time,
       ${sqlLiteral(record.end_time)}::time,
       ${record.attendee_count == null ? "null" : record.attendee_count},
       ${sqlLiteral(record.notes)},
       ${sqlLiteral(record.created_by)},
       now()
     );`
  );
  return record;
}

async function deleteEventRecord(runWriteSql, eventId) {
  const normalizedId = String(eventId || "").trim();
  if (!isUuid(normalizedId)) throw new Error("A valid event id is required.");
  await runWriteSql(
    "events_app_delete",
    `delete from public.events_app_events where id = ${sqlLiteral(normalizedId)}::uuid;`
  );
  return { id: normalizedId, deleted: true };
}

function buildNotificationBody(eventRow, assignmentRow, kind) {
  const area = eventRow.group_name || eventRow.group_code || "Assigned area";
  const attendees = eventRow.attendee_count == null ? "unknown" : String(eventRow.attendee_count);
  const notes = eventRow.notes ? ` Notes: ${eventRow.notes}` : "";
  const when =
    kind === "day_before"
      ? "Reminder for tomorrow"
      : `Reminder for today. Your scheduled shift in ${area} began at ${assignmentRow.coverage_start || "the scheduled time"}.`;
  return `${when}: ${eventRow.event_name} is scheduled in ${area} on ${eventRow.event_date} from ${eventRow.start_time} to ${eventRow.end_time}. Expected attendees: ${attendees}.${notes}`.trim();
}

async function sendEventNotification({ runRpc, runWriteSql, eventRow, assignmentRow, memphisUserId, kind }) {
  const msgUserId = assignmentRow.msg_user_id;
  if (!msgUserId) {
    return { ok: false, status: "skipped", notes: "Missing msg_user_id" };
  }

  const thread = await runRpc("msg_get_or_create_memphis_thread", { p_user_id: msgUserId });
  const body = buildNotificationBody(eventRow, assignmentRow, kind);
  const message = await runRpc("msg_send_message", {
    p_thread_id: thread.id,
    p_sender_user_id: memphisUserId,
    p_body: body,
    p_message_type: "bot_response",
    p_metadata_json: {
      channel: "memphis",
      source: "events_app",
      event_id: eventRow.id,
      notification_kind: kind,
      location_group_id: eventRow.location_group_id,
    },
  });

  await runWriteSql(
    "events_app_notification_log",
    `insert into public.events_app_notification_log (
       event_id,
       employee_id,
       msg_user_id,
       thread_id,
       notification_kind,
       scheduled_for_local,
       sent_at,
       status,
       response_message_id,
       notes,
       updated_at
     ) values (
       ${sqlLiteral(eventRow.id)}::uuid,
       ${sqlLiteral(assignmentRow.employee_id)}::uuid,
       ${sqlLiteral(msgUserId)}::uuid,
       ${sqlLiteral(thread.id)}::uuid,
       ${sqlLiteral(kind)},
       ${
         kind === "day_before"
           ? `(${sqlLiteral(eventRow.event_date)}::date - interval '1 day' + time '${DAY_BEFORE_NOTIFICATION_TIME}')`
           : `(${sqlLiteral(eventRow.event_date)}::date + ${sqlLiteral(
               assignmentRow.coverage_start || "00:00:00"
             )}::time + interval '15 minutes')`
       },
       now(),
       'sent',
       ${sqlLiteral(message?.id || null)}::uuid,
       ${sqlLiteral(body)},
       now()
     )
     on conflict (event_id, employee_id, notification_kind)
     do nothing;`
  );

  const deviceIdentifiers = Array.isArray(assignmentRow.device_identifiers)
    ? assignmentRow.device_identifiers.map((value) => String(value || "").trim()).filter(Boolean)
    : [String(assignmentRow.device_identifier || "").trim()].filter(Boolean);

  for (const deviceIdentifier of deviceIdentifiers) {
    try {
      await runRpc("msg_unhide_thread_for_device", {
        p_thread_id: thread.id,
        p_device_identifier: deviceIdentifier,
      });
    } catch (_error) {
      // Non-fatal. Device visibility can lag behind message delivery.
    }
  }

  return { ok: true, status: "sent", thread_id: thread.id, response_message_id: message?.id || null };
}

async function getPendingNotifications(runReadOnlySql) {
  const rows = await runReadOnlySql(`
    with owner_assignments as (
      select
        dga.assignment_date,
        dga.location_group_id,
        dga.assigned_employee_id as employee_id,
        dga.coverage_start,
        dga.coverage_end,
        'daily_group_assignments'::text as assignment_source
      from public.daily_group_assignments dga
      where dga.active = true
        and dga.assigned_employee_id is not null

      union all

      select
        dsa.service_date as assignment_date,
        dsa.location_group_id,
        dsa.assigned_employee_id as employee_id,
        dsa.coverage_start,
        dsa.coverage_end,
        'daily_schedule_assignments'::text as assignment_source
      from public.daily_schedule_assignments dsa
      where dsa.assigned_employee_id is not null
        and coalesce(dsa.coverage_purpose, 'area_owner') = 'area_owner'
        and not exists (
          select 1
          from public.daily_group_assignments dga
          where dga.assignment_date = dsa.service_date
            and dga.location_group_id = dsa.location_group_id
            and dga.active = true
            and dga.assigned_employee_id is not null
        )
    ),
    msg_devices as (
      select
        mda.msg_user_id,
        coalesce(
          array_agg(distinct mda.device_identifier)
            filter (where mda.device_identifier is not null and btrim(mda.device_identifier) <> ''),
          array[]::text[]
        ) as device_identifiers
      from public.msg_device_assignments mda
      where mda.is_active = true
      group by mda.msg_user_id
    ),
    candidate_notifications as (
      select
        e.id,
        e.event_name,
        e.location_group_id,
        e.event_date,
        e.start_time,
        e.end_time,
        e.attendee_count,
        e.notes,
        lg.group_code,
        lg.group_name,
        emp.id as employee_id,
        emp.display_name as employee_name,
        mu.id as msg_user_id,
        coalesce(md.device_identifiers, array[]::text[]) as device_identifiers,
        min(oa.coverage_start) as coverage_start,
        max(oa.coverage_end) as coverage_end,
        min(oa.assignment_source) as assignment_source,
        'day_before'::text as notification_kind,
        ((e.event_date::timestamp - interval '1 day') + time '${DAY_BEFORE_NOTIFICATION_TIME}') as scheduled_for_local,
        public.msg_get_memphis_user_id() as memphis_user_id
      from public.events_app_events e
      join public.location_groups lg on lg.id = e.location_group_id
      join owner_assignments oa
        on oa.location_group_id = e.location_group_id
       and oa.assignment_date = e.event_date
      join public.employees emp on emp.id = oa.employee_id and emp.active = true
      join public.msg_users mu on mu.employee_id = emp.id and mu.is_active = true
      left join msg_devices md on md.msg_user_id = mu.id
      where (now() at time zone '${EVENTS_TIME_ZONE}')::date = (e.event_date - interval '1 day')::date
        and (now() at time zone '${EVENTS_TIME_ZONE}') >= ((e.event_date::timestamp - interval '1 day') + time '${DAY_BEFORE_NOTIFICATION_TIME}')
        and not exists (
          select 1
          from public.events_app_notification_log log
          where log.event_id = e.id
            and log.employee_id = emp.id
            and log.notification_kind = 'day_before'
        )
      group by
        e.id,
        e.event_name,
        e.location_group_id,
        e.event_date,
        e.start_time,
        e.end_time,
        e.attendee_count,
        e.notes,
        lg.group_code,
        lg.group_name,
        emp.id,
        emp.display_name,
        mu.id,
        md.device_identifiers

      union all

      select
        e.id,
        e.event_name,
        e.location_group_id,
        e.event_date,
        e.start_time,
        e.end_time,
        e.attendee_count,
        e.notes,
        lg.group_code,
        lg.group_name,
        emp.id as employee_id,
        emp.display_name as employee_name,
        mu.id as msg_user_id,
        coalesce(md.device_identifiers, array[]::text[]) as device_identifiers,
        min(oa.coverage_start) as coverage_start,
        max(oa.coverage_end) as coverage_end,
        min(oa.assignment_source) as assignment_source,
        'shift_plus_fifteen'::text as notification_kind,
        (e.event_date::timestamp + min(oa.coverage_start) + interval '15 minutes') as scheduled_for_local,
        public.msg_get_memphis_user_id() as memphis_user_id
      from public.events_app_events e
      join public.location_groups lg on lg.id = e.location_group_id
      join owner_assignments oa
        on oa.location_group_id = e.location_group_id
       and oa.assignment_date = e.event_date
       and oa.coverage_start is not null
      join public.employees emp on emp.id = oa.employee_id and emp.active = true
      join public.msg_users mu on mu.employee_id = emp.id and mu.is_active = true
      left join msg_devices md on md.msg_user_id = mu.id
      where (now() at time zone '${EVENTS_TIME_ZONE}')::date = e.event_date
        and (now() at time zone '${EVENTS_TIME_ZONE}') >= (e.event_date::timestamp + oa.coverage_start + interval '15 minutes')
        and not exists (
          select 1
          from public.events_app_notification_log log
          where log.event_id = e.id
            and log.employee_id = emp.id
            and log.notification_kind = 'shift_plus_fifteen'
        )
      group by
        e.id,
        e.event_name,
        e.location_group_id,
        e.event_date,
        e.start_time,
        e.end_time,
        e.attendee_count,
        e.notes,
        lg.group_code,
        lg.group_name,
        emp.id,
        emp.display_name,
        mu.id,
        md.device_identifiers
    )
    select *
    from candidate_notifications
    order by scheduled_for_local asc, event_date asc, event_name asc
    limit ${MAX_NOTIFICATIONS_PER_RUN}
  `);
  return Array.isArray(rows) ? rows : [];
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
      await purgeExpiredEvents(runWriteSql);
      const scheduleSync = await ensureUpcomingEventScheduleState({ runReadOnlySql, runRpc });
      const pending = await getPendingNotifications(runReadOnlySql);
      const notificationResults = [];
      if (pending.length) {
        const memphisUserId = pending[0]?.memphis_user_id || null;
        if (memphisUserId) {
          for (const row of pending) {
            const outcome = await sendEventNotification({
              runRpc,
              runWriteSql,
              eventRow: row,
              assignmentRow: row,
              memphisUserId,
              kind: row.notification_kind,
            });
            notificationResults.push({
              event_id: row.id,
              event_name: row.event_name,
              employee_id: row.employee_id,
              employee_name: row.employee_name,
              notification_kind: row.notification_kind,
              result: outcome,
            });
          }
        } else {
          notificationResults.push({ ok: false, error: "missing_memphis_user_id" });
        }
      }
      const scanAlerts = await queueDueScanAlerts(runRpc);
      const result = { ok: true, reason, processed: pending.length, notification_results: notificationResults, schedule_sync: scheduleSync, scan_alerts: scanAlerts };
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
      maintenanceController?.kick("events_public_list");
      if (typeof runWriteSql === "function") {
        await purgeExpiredEvents(runWriteSql);
      }
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
}) {
  const router = express.Router();
  if (typeof requireAdminApiAuth === "function") {
    router.use(requireAdminApiAuth);
  }

  router.get("/", async (_req, res) => {
    try {
      maintenanceController?.kick("events_admin_list");
      await purgeExpiredEvents(runWriteSql);
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

  router.post("/parse-ai", async (req, res) => {
    try {
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const texts = Array.isArray(body.texts)
        ? body.texts.map((text) => String(text || "").trim()).filter(Boolean)
        : [String(body.text || "").trim()].filter(Boolean);
      if (!texts.length) throw new Error("text or texts is required.");
      const groups = await listLocationGroups(runReadOnlySql);
      const parsed = await aiParseEventTexts({ texts, locationGroups: groups });
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

  router.post("/parse-test", async (req, res) => {
    try {
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const includeRows = body.include_rows !== false;
      const customFixtures = Array.isArray(body.fixtures)
        ? body.fixtures.filter((fixture) => fixture && fixture.text && fixture.expect)
        : null;
      const data = await runParserRegressionTests({
        runReadOnlySql,
        fixtures: customFixtures && customFixtures.length ? customFixtures : EVENT_PARSER_TEST_FIXTURES,
        includeRows,
      });
      res.status(200).json({
        ok: true,
        data,
        meta: {
          version: appVersion,
          release_id: releaseId,
          contract_version: EVENTS_CONTRACT_VERSION,
          fixture_count: data.total,
        },
      });
    } catch (error) {
      fail(res, error, "Parser regression test failed", 400);
    }
  });

  router.post("/", async (req, res) => {
    try {
      maintenanceController?.kick("events_admin_create_before");
      await purgeExpiredEvents(runWriteSql);
      const record = await createEventRecord(
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

  router.delete("/:eventId", async (req, res) => {
    try {
      const result = await deleteEventRecord(runWriteSql, req.params.eventId);
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
