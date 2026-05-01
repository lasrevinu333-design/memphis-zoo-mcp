import express from "express";
import { aiParseEventTexts } from "./events-ai-parser.js";

const EVENTS_TIME_ZONE = "America/Chicago";
const EVENTS_CONTRACT_VERSION = "events.v1";
const DAY_BEFORE_NOTIFICATION_TIME = "08:00:00";
const EVENT_MAINTENANCE_COOLDOWN_MS = 20 * 1000;
const MAX_NOTIFICATIONS_PER_RUN = 50;
const MAX_SCAN_ALERTS_PER_RUN = 50;
const SCAN_ALERT_COOLDOWN_MINUTES = 30;

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
      res.status(200).json({
        ok: true,
        data: parsed,
        meta: {
          version: appVersion,
          release_id: releaseId,
          contract_version: EVENTS_CONTRACT_VERSION,
          provider: "gemini",
        },
      });
    } catch (error) {
      fail(res, error, "AI event parse failed", 400);
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
