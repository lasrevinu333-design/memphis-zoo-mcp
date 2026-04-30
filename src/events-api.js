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
  const raw = String(value || "").trim();
  if (!raw) throw new Error("Time is required.");
  if (!/^\d{2}:\d{2}(:\d{2})?$/.test(raw)) {
    throw new Error("Time must be HH:MM or HH:MM:SS.");
  }
  return raw.length === 5 ? `${raw}:00` : raw;
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

  if (assignmentRow.device_identifier) {
    try {
      await runRpc("msg_unhide_thread_for_device", {
        p_thread_id: thread.id,
        p_device_identifier: assignmentRow.device_identifier,
      });
    } catch (_error) {
      // Non-fatal. Device visibility can lag behind message delivery.
    }
  }

  return { ok: true, status: "sent", thread_id: thread.id, response_message_id: message?.id || null };
}

async function getPendingNotifications(runReadOnlySql) {
  const rows = await runReadOnlySql(`
    select *
    from (
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
        dga.coverage_start,
        dga.coverage_end,
        'day_before'::text as notification_kind,
        ((e.event_date::timestamp - interval '1 day') + time '${DAY_BEFORE_NOTIFICATION_TIME}') as scheduled_for_local,
        public.msg_get_memphis_user_id() as memphis_user_id
      from public.events_app_events e
      join public.location_groups lg on lg.id = e.location_group_id
      join public.daily_group_assignments dga
        on dga.location_group_id = e.location_group_id
       and dga.assignment_date = e.event_date
       and dga.active = true
       and dga.assigned_employee_id is not null
      join public.employees emp on emp.id = dga.assigned_employee_id and emp.active = true
      join public.msg_users mu on mu.employee_id = emp.id and mu.is_active = true
      where (now() at time zone '${EVENTS_TIME_ZONE}')::date = (e.event_date - interval '1 day')::date
        and (now() at time zone '${EVENTS_TIME_ZONE}') >= ((e.event_date::timestamp - interval '1 day') + time '${DAY_BEFORE_NOTIFICATION_TIME}')
        and not exists (
          select 1
          from public.events_app_notification_log log
          where log.event_id = e.id
            and log.employee_id = emp.id
            and log.notification_kind = 'day_before'
        )

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
        dga.coverage_start,
        dga.coverage_end,
        'shift_plus_fifteen'::text as notification_kind,
        (e.event_date::timestamp + dga.coverage_start + interval '15 minutes') as scheduled_for_local,
        public.msg_get_memphis_user_id() as memphis_user_id
      from public.events_app_events e
      join public.location_groups lg on lg.id = e.location_group_id
      join public.daily_group_assignments dga
        on dga.location_group_id = e.location_group_id
       and dga.assignment_date = e.event_date
       and dga.active = true
       and dga.assigned_employee_id is not null
       and dga.coverage_start is not null
      join public.employees emp on emp.id = dga.assigned_employee_id and emp.active = true
      join public.msg_users mu on mu.employee_id = emp.id and mu.is_active = true
      where (now() at time zone '${EVENTS_TIME_ZONE}')::date = e.event_date
        and (now() at time zone '${EVENTS_TIME_ZONE}') >= (e.event_date::timestamp + dga.coverage_start + interval '15 minutes')
        and not exists (
          select 1
          from public.events_app_notification_log log
          where log.event_id = e.id
            and log.employee_id = emp.id
            and log.notification_kind = 'shift_plus_fifteen'
        )
    ) pending
    order by pending.scheduled_for_local asc, pending.event_date asc, pending.event_name asc
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

  async function runMaintenance(reason = "manual") {
    if (running) return { ok: true, skipped: true, reason: "already_running" };
    const now = Date.now();
    if (now - lastRunAt < EVENT_MAINTENANCE_COOLDOWN_MS) {
      return { ok: true, skipped: true, reason: "cooldown" };
    }

    running = true;
    lastRunAt = now;
    try {
      await purgeExpiredEvents(runWriteSql);
      const pending = await getPendingNotifications(runReadOnlySql);
      if (pending.length) {
        const memphisUserId = pending[0]?.memphis_user_id || null;
        if (memphisUserId) {
          for (const row of pending) {
            await sendEventNotification({
              runRpc,
              runWriteSql,
              eventRow: row,
              assignmentRow: row,
              memphisUserId,
              kind: row.notification_kind,
            });
          }
        }
      }
      const scanAlerts = await queueDueScanAlerts(runRpc);
      return { ok: true, reason, processed: pending.length, scan_alerts: scanAlerts };
    } catch (error) {
      console.error("events maintenance failed:", error);
      return { ok: false, error: error?.message || "Events maintenance failed" };
    } finally {
      running = false;
    }
  }

  return {
    kick(reason = "kick") {
      runMaintenance(reason).catch((error) => {
        console.error("events maintenance kick failed:", error);
      });
    },
    runMaintenance,
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
    res.status(200).json(
      buildHealthPayload("events_public", {
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

  return router;
}

export function createEventsAdminRouter({
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
