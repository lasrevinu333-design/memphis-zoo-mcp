import express from "express";

export function createScheduleRouter({
  runReadOnlySql,
  runRpc,
  buildHealthPayload,
  requireAdminApiAuth,
  appVersion,
  releaseId,
  contractVersion,
}) {
  const router = express.Router();
  const requireSchedulePin = requireAdminApiAuth;
  const AUTO_GENERATE_WINDOW_DAYS = 7;
  const AUTO_GENERATE_COOLDOWN_MS = 6 * 60 * 60 * 1000;
  let autoGenerateState = { lastStartedAt: 0, running: false, lastCompletedAt: 0, lastWindowStart: null, lastResult: [] };

  function fail(res, error, fallback = "Schedule request failed", status = 400) {
    res.status(status).json({ ok: false, error: error?.message || fallback });
  }

  function esc(value) {
    return String(value ?? "").replace(/'/g, "''");
  }

  function requireDate(value, fallback = null) {
    const raw = String(value || fallback || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      throw new Error("service_date must be YYYY-MM-DD.");
    }
    return raw;
  }

  function requireTime(value) {
    const raw = String(value || "").trim();
    if (!/^\d{2}:\d{2}(:\d{2})?$/.test(raw)) {
      throw new Error("closing_time must be HH:MM or HH:MM:SS.");
    }
    return raw;
  }

  function optionalTimestampLiteral(value) {
    const raw = String(value || "").trim();
    if (!raw) return "now()";
    if (!/^\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}/.test(raw)) {
      throw new Error("at must be an ISO-like timestamp.");
    }
    return `'${esc(raw)}'::timestamptz`;
  }

  function uuidArrayLiteral(values) {
    if (!Array.isArray(values)) throw new Error("absent_employee_ids must be an array of UUID strings.");
    const cleaned = values.map((x) => String(x || "").trim()).filter(Boolean);
    for (const id of cleaned) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
        throw new Error(`Invalid UUID: ${id}`);
      }
    }
    return `array[${cleaned.map((id) => `'${esc(id)}'::uuid`).join(",")}]::uuid[]`;
  }

  function toNullableRating(value) {
    if (value == null || value === "") return null;
    const parsed = Number.parseInt(String(value), 10);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 10) {
      throw new Error("Ratings must be integers from 1 to 10, or blank.");
    }
    return parsed;
  }

  async function getServiceDate() {
    const rows = await runReadOnlySql("select public.sch_service_date(now()) as service_date");
    return Array.isArray(rows) && rows.length ? rows[0].service_date : null;
  }

  async function getDailyGenerationState(serviceDate) {
    const rows = await runReadOnlySql(`
      select
        (select count(*)::int from public.daily_work_roster where service_date = '${esc(serviceDate)}'::date) as roster_count,
        (select count(*)::int from public.daily_schedule_assignments where service_date = '${esc(serviceDate)}'::date) as assignment_count
    `);
    return Array.isArray(rows) && rows.length
      ? {
          roster_count: Number(rows[0].roster_count || 0),
          assignment_count: Number(rows[0].assignment_count || 0),
        }
      : { roster_count: 0, assignment_count: 0 };
  }

  function addDaysToIsoDate(serviceDate, daysToAdd = 0) {
    const base = new Date(`${serviceDate}T12:00:00`);
    if (Number.isNaN(base.getTime())) return serviceDate;
    base.setDate(base.getDate() + Number(daysToAdd || 0));
    return base.toISOString().slice(0, 10);
  }

  async function getScheduleRangeStatus(startDate, days = 7) {
    const totalDays = Math.max(1, Math.min(14, Number.parseInt(String(days || 7), 10) || 7));
    const rows = [];
    for (let offset = 0; offset < totalDays; offset += 1) {
      const serviceDate = addDaysToIsoDate(startDate, offset);
      const state = await getDailyGenerationState(serviceDate);
      rows.push({
        service_date: serviceDate,
        roster_count: state.roster_count,
        assignment_count: state.assignment_count,
        ready: state.roster_count > 0 && state.assignment_count > 0,
      });
    }
    return rows;
  }

  async function ensureScheduleRange(startDate, days = 7, { force = false } = {}) {
    const statuses = await getScheduleRangeStatus(startDate, days);
    const generated = [];
    for (const row of statuses) {
      const shouldGenerate = force || !row.ready;
      if (shouldGenerate) {
        await runRpc("sch_generate_daily_schedule", { p_service_date: row.service_date, p_force: force });
      }
      const after = await getDailyGenerationState(row.service_date);
      generated.push({
        service_date: row.service_date,
        generated: shouldGenerate,
        roster_count: after.roster_count,
        assignment_count: after.assignment_count,
        ready: after.roster_count > 0 && after.assignment_count > 0,
      });
    }
    return generated;
  }

  async function maybeAutoGenerateWindow(anchorDate = null) {
    const now = Date.now();
    if (autoGenerateState.running) return autoGenerateState;
    if (now - autoGenerateState.lastStartedAt < AUTO_GENERATE_COOLDOWN_MS) return autoGenerateState;
    const startDate = requireDate(anchorDate || (await getServiceDate()));
    autoGenerateState = { ...autoGenerateState, running: true, lastStartedAt: now, lastWindowStart: startDate };
    try {
      const generated = await ensureScheduleRange(startDate, AUTO_GENERATE_WINDOW_DAYS, { force: false });
      autoGenerateState = { ...autoGenerateState, running: false, lastCompletedAt: Date.now(), lastResult: generated, lastWindowStart: startDate };
    } catch (error) {
      console.error("schedule auto-generate window failed:", error);
      autoGenerateState = { ...autoGenerateState, running: false };
    }
    return autoGenerateState;
  }

  async function getAssignedEmployeeForDevice(deviceId) {
    const rows = await runReadOnlySql(`
      select
        d.device_id,
        d.device_name,
        d.assigned_employee_id,
        e.display_name as assigned_employee_name,
        e.employee_code,
        e.role,
        d.active as device_active,
        coalesce(e.active, false) as employee_active
      from public.devices d
      left join public.employees e on e.id = d.assigned_employee_id
      where d.device_id = '${esc(deviceId)}'
      limit 1
    `);
    return Array.isArray(rows) && rows.length ? rows[0] : null;
  }

  function toCsvValue(value) {
    if (value == null) return "";
    const text = String(value);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function rowsToCsv(rows = [], columns = []) {
    const header = columns.map((column) => toCsvValue(column.label)).join(",");
    const body = rows.map((row) => columns.map((column) => toCsvValue(row[column.key])).join(","));
    return [header, ...body].join("\n") + "\n";
  }

  function groupScheduleRows(rows) {
    const groups = [];
    const byId = new Map();
    for (const row of rows || []) {
      const key = row.location_group_id || row.group_code || row.group_name;
      if (!byId.has(key)) {
        const group = {
          location_group_id: row.location_group_id,
          group_code: row.group_code,
          group_name: row.group_name,
          included_locations: row.included_locations || [],
          segments: [],
        };
        byId.set(key, group);
        groups.push(group);
      }
      byId.get(key).segments.push({
        segment_id: row.segment_id,
        segment_number: row.segment_number,
        owner_type: row.owner_type,
        assigned_employee_id: row.assigned_employee_id,
        assigned_employee_name: row.assigned_employee_name,
        coverage_start: row.coverage_start,
        coverage_end: row.coverage_end,
        status: row.status,
        load_points: row.load_points,
        coverage_purpose: row.coverage_purpose || "area_owner",
        notes: row.notes,
      });
    }
    return groups;
  }

  function htmlEscape(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  async function resolveEmployeeIdFromRequest(req) {
    const deviceId = String(req.query.device_id || req.query.device || "").trim();
    const employeeId = String(req.query.employee_id || "").trim();
    const employeeName = String(req.query.employee_name || req.query.name || "").trim();
    const employeeCode = String(req.query.employee_code || req.query.code || "").trim();

    if (deviceId) {
      const assignment = await getAssignedEmployeeForDevice(deviceId);
      if (!assignment || !assignment.device_active) throw new Error("Active device assignment not found.");
      if (!assignment.assigned_employee_id || !assignment.employee_active) {
        throw new Error("This device is not assigned to an active employee.");
      }
      return { employeeId: assignment.assigned_employee_id, assignment };
    }

    if (employeeId) return { employeeId, assignment: null };

    if (!employeeName && !employeeCode) {
      throw new Error("device_id, employee_id, employee_name, or employee_code is required.");
    }

    const predicate = employeeCode
      ? `employee_code ilike '${esc(employeeCode)}'`
      : `display_name ilike '${esc(employeeName)}'`;
    const employeeRows = await runReadOnlySql(`
      select id as employee_id
      from public.employees
      where active = true and ${predicate}
      order by display_name
      limit 1
    `);
    if (!Array.isArray(employeeRows) || !employeeRows.length) throw new Error("Active employee not found.");
    return { employeeId: employeeRows[0].employee_id, assignment: null };
  }

  function renderMyScheduleHtml(data) {
    const employee = data?.employee || {};
    const shift = data?.shift || {};
    const items = Array.isArray(data?.items) ? data.items : [];
    const restroomItems = items.filter((item) => item?.is_public_restroom);
    const otherItems = items.filter((item) => !item?.is_public_restroom);
    const renderItems = (list) => list.length
      ? list.map((item) => `<li>${htmlEscape(item.name)}</li>`).join("")
      : `<li class="muted">None listed</li>`;

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>My Schedule</title>
<style>
  :root { --teal:#0f4d57; --teal2:#0b3b43; --mint:#e8f4ef; --line:#cfe1db; --text:#173238; --muted:#63787d; --warn:#fff3cd; --warnline:#f0d98a; }
  * { box-sizing: border-box; }
  body { margin:0; font-family: system-ui, -apple-system, Segoe UI, sans-serif; background:#eef5f3; color:var(--text); }
  .top { background:linear-gradient(135deg,var(--teal),var(--teal2)); color:white; padding:22px 18px 26px; border-bottom-left-radius:24px; border-bottom-right-radius:24px; box-shadow:0 4px 16px rgba(0,0,0,.18); }
  .eyebrow { font-size:13px; opacity:.84; letter-spacing:.03em; text-transform:uppercase; }
  h1 { margin:6px 0 3px; font-size:30px; line-height:1.08; }
  .shift { font-size:17px; opacity:.95; }
  .wrap { max-width:720px; margin:0 auto; padding:16px; }
  .notice { background:var(--warn); border:1px solid var(--warnline); border-radius:16px; padding:12px 14px; margin-bottom:14px; font-weight:650; }
  .card { background:white; border:1px solid var(--line); border-radius:20px; padding:16px; margin:14px 0; box-shadow:0 2px 10px rgba(20,60,70,.07); }
  .card h2 { margin:0 0 10px; font-size:20px; color:var(--teal); }
  ul { list-style:none; padding:0; margin:0; display:grid; gap:8px; }
  li { padding:11px 12px; background:#f8fbfa; border:1px solid #e1ece8; border-radius:13px; font-weight:620; }
  li.muted { color:var(--muted); font-weight:500; }
  .meta { margin-top:14px; color:var(--muted); font-size:13px; text-align:center; }
  .pill { display:inline-block; padding:5px 9px; border-radius:999px; background:rgba(255,255,255,.16); font-size:13px; margin-top:8px; }
</style>
</head>
<body>
  <header class="top">
    <div class="eyebrow">Custodial Scheduler</div>
    <h1>${htmlEscape(employee.display_name || "My Schedule")}</h1>
    <div class="shift">${htmlEscape(shift.start || "")} - ${htmlEscape(shift.end || "")}</div>
    <div class="pill">${htmlEscape(data?.phase || "current")} • ${htmlEscape(data?.as_of_time || "")}</div>
  </header>
  <main class="wrap">
    ${data?.notice ? `<div class="notice">${htmlEscape(data.notice)}</div>` : ""}
    <section class="card">
      <h2>Public Restrooms</h2>
      <ul>${renderItems(restroomItems)}</ul>
    </section>
    <section class="card">
      <h2>Other Assigned Areas</h2>
      <ul>${renderItems(otherItems)}</ul>
    </section>
    <div class="meta">${htmlEscape(data?.service_date || "")} • Employee code: ${htmlEscape(employee.employee_code || "")}</div>
  </main>
</body>
</html>`;
  }

  router.get("/health", (_req, res) => {
    res.status(200).json(buildHealthPayload("schedule", { contract_version: contractVersion }));
  });

  router.get("/today", async (_req, res) => {
    try {
      const serviceDate = await getServiceDate();
      if (!serviceDate) throw new Error("Could not resolve service date.");
      const rows = await runReadOnlySql(`select * from public.sch_get_daily_schedule_with_purpose('${esc(serviceDate)}'::date)`);
      res.status(200).json({
        ok: true,
        data: { service_date: serviceDate, groups: groupScheduleRows(rows) },
        meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion },
      });
    } catch (error) {
      fail(res, error, "Today schedule failed");
    }
  });

  router.get("/day", async (req, res) => {
    try {
      const serviceDate = requireDate(req.query.service_date || req.query.date);
      const rows = await runReadOnlySql(`select * from public.sch_get_daily_schedule_with_purpose('${esc(serviceDate)}'::date)`);
      res.status(200).json({
        ok: true,
        data: { service_date: serviceDate, groups: groupScheduleRows(rows) },
        meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion },
      });
    } catch (error) {
      fail(res, error, "Schedule day failed");
    }
  });

  router.get("/my-day", async (req, res) => {
    try {
      const deviceId = String(req.query.device_id || req.query.device || "").trim();
      if (!deviceId) throw new Error("device_id is required.");
      const serviceDate = requireDate(req.query.service_date || req.query.date || (await getServiceDate()));
      const assignment = await getAssignedEmployeeForDevice(deviceId);
      if (!assignment || !assignment.device_active) {
        res.status(404).json({ ok: false, error: "Active device assignment not found." });
        return;
      }
      if (!assignment.assigned_employee_id || !assignment.employee_active) {
        res.status(404).json({ ok: false, error: "This device is not assigned to an active employee." });
        return;
      }
      const rows = await runReadOnlySql(`
        select *
        from public.sch_get_daily_schedule_with_purpose('${esc(serviceDate)}'::date)
        where assigned_employee_id = '${esc(assignment.assigned_employee_id)}'::uuid
        order by group_name, segment_number
      `);
      res.status(200).json({
        ok: true,
        data: {
          service_date: serviceDate,
          device_id: assignment.device_id,
          device_name: assignment.device_name,
          employee_id: assignment.assigned_employee_id,
          employee_name: assignment.assigned_employee_name,
          employee_code: assignment.employee_code,
          role: assignment.role,
          groups: groupScheduleRows(rows),
        },
        meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion },
      });
    } catch (error) {
      fail(res, error, "Personal schedule lookup failed");
    }
  });

  router.get("/my-day-summary", async (req, res) => {
    try {
      const deviceId = String(req.query.device_id || req.query.device || "").trim();
      const employeeId = String(req.query.employee_id || "").trim();
      const employeeName = String(req.query.employee_name || req.query.name || "").trim();
      if (!deviceId && !employeeId && !employeeName) {
        throw new Error("device_id, employee_id, or employee_name is required.");
      }

      const serviceDate = requireDate(req.query.service_date || req.query.date || (await getServiceDate()));
      const atSql = optionalTimestampLiteral(req.query.as_of || req.query.at);
      let resolvedEmployeeId = employeeId;
      let assignment = null;

      if (deviceId) {
        assignment = await getAssignedEmployeeForDevice(deviceId);
        if (!assignment || !assignment.device_active) {
          res.status(404).json({ ok: false, error: "Active device assignment not found." });
          return;
        }
        if (!assignment.assigned_employee_id || !assignment.employee_active) {
          res.status(404).json({ ok: false, error: "This device is not assigned to an active employee." });
          return;
        }
        resolvedEmployeeId = assignment.assigned_employee_id;
      } else if (employeeName) {
        const employeeRows = await runReadOnlySql(`
          select id as employee_id
          from public.employees
          where active = true
            and display_name ilike '${esc(employeeName)}'
          order by display_name
          limit 1
        `);
        if (!Array.isArray(employeeRows) || !employeeRows.length) {
          res.status(404).json({ ok: false, error: "Active employee not found." });
          return;
        }
        resolvedEmployeeId = employeeRows[0].employee_id;
      }

      const rows = await runReadOnlySql(`
        select public.sch_employee_my_schedule_page(
          '${esc(serviceDate)}'::date,
          '${esc(resolvedEmployeeId)}'::uuid,
          ${atSql}
        ) as data
      `);
      const data = Array.isArray(rows) && rows.length ? rows[0].data : null;
      res.status(200).json({
        ok: true,
        data: {
          ...(data || {}),
          device_id: assignment?.device_id || deviceId || null,
          device_name: assignment?.device_name || null,
        },
        meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion },
      });
    } catch (error) {
      fail(res, error, "Personal schedule summary failed");
    }
  });

  router.get("/my-schedule", async (req, res) => {
    try {
      const serviceDate = requireDate(req.query.service_date || req.query.date || (await getServiceDate()));
      const atSql = optionalTimestampLiteral(req.query.as_of || req.query.at);
      const { employeeId } = await resolveEmployeeIdFromRequest(req);
      const rows = await runReadOnlySql(`
        select public.sch_employee_my_schedule_page(
          '${esc(serviceDate)}'::date,
          '${esc(employeeId)}'::uuid,
          ${atSql}
        ) as data
      `);
      const data = Array.isArray(rows) && rows.length ? rows[0].data : null;
      if (!data?.ok) {
        res.status(404).send(renderMyScheduleHtml(data || { employee: { display_name: "My Schedule" }, items: [], notice: "Schedule not found." }));
        return;
      }
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.status(200).send(renderMyScheduleHtml(data));
    } catch (error) {
      res.status(400).send(renderMyScheduleHtml({
        employee: { display_name: "My Schedule" },
        shift: null,
        phase: "error",
        as_of_time: "",
        service_date: "",
        notice: error?.message || "Schedule preview failed.",
        items: [],
      }));
    }
  });

  router.get("/settings/close-time", async (req, res) => {
    try {
      const serviceDate = requireDate(req.query.service_date || req.query.date || (await getServiceDate()));
      const rows = await runReadOnlySql(`select public.sch_get_schedule_close_time('${esc(serviceDate)}'::date) as closing_time`);
      const closingTime = Array.isArray(rows) && rows.length ? rows[0].closing_time : null;
      res.status(200).json({
        ok: true,
        data: { service_date: serviceDate, closing_time: closingTime },
        meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion },
      });
    } catch (error) {
      fail(res, error, "Close time lookup failed");
    }
  });

  router.post("/settings/close-time", requireSchedulePin, async (req, res) => {
    try {
      const serviceDate = requireDate(req.body?.service_date || req.body?.date || (await getServiceDate()));
      const closingTime = requireTime(req.body?.closing_time);
      const notes = req.body?.notes == null ? null : String(req.body.notes);
      const data = await runRpc("sch_set_schedule_close_time", {
        p_service_date: serviceDate,
        p_closing_time: closingTime,
        p_notes: notes,
      });
      res.status(200).json({ ok: true, data, meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion } });
    } catch (error) {
      fail(res, error, "Close time update failed");
    }
  });

  router.get("/employees", async (_req, res) => {
    try {
      const rows = await runReadOnlySql(`
        select id as employee_id, employee_code, display_name, role, active
        from public.employees
        where active = true
        order by display_name
      `);
      res.status(200).json({ ok: true, data: rows || [], meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion } });
    } catch (error) {
      fail(res, error, "Employees failed");
    }
  });

  router.get("/location-groups", async (_req, res) => {
    try {
      const rows = await runReadOnlySql(`
        select lg.id as location_group_id, lg.group_code, lg.group_name,
               coalesce(array_agg(l.location_name order by l.sort_order nulls last, l.location_name)
                 filter (where l.id is not null), array[]::text[]) as included_locations
        from public.location_groups lg
        left join public.location_group_memberships m on m.location_group_id = lg.id and m.active = true
        left join public.locations l on l.id = m.location_id and l.active = true
        where lg.active = true
        group by lg.id, lg.group_code, lg.group_name
        order by lg.group_name
      `);
      res.status(200).json({ ok: true, data: rows || [], meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion } });
    } catch (error) {
      fail(res, error, "Location groups failed");
    }
  });

  router.get("/coverage-templates/export.csv", async (_req, res) => {
    try {
      const rows = await runReadOnlySql(`
        select
          ct.id as coverage_template_id,
          ct.day_of_week,
          case ct.day_of_week
            when 0 then 'Sunday'
            when 1 then 'Monday'
            when 2 then 'Tuesday'
            when 3 then 'Wednesday'
            when 4 then 'Thursday'
            when 5 then 'Friday'
            when 6 then 'Saturday'
          end as weekday,
          lg.group_name,
          lg.group_code,
          ct.segment_number,
          coalesce(e.display_name, '') as assigned_employee,
          ct.owner_type,
          ct.coverage_purpose,
          to_char(ct.coverage_start, 'HH24:MI:SS') as coverage_start,
          to_char(ct.coverage_end, 'HH24:MI:SS') as coverage_end,
          ct.active,
          coalesce(ct.notes, '') as notes
        from public.coverage_templates ct
        join public.location_groups lg on lg.id = ct.location_group_id
        left join public.employees e on e.id = ct.assigned_employee_id
        order by ct.day_of_week, lg.group_name, ct.segment_number, ct.coverage_start
      `);
      const csv = rowsToCsv(rows || [], [
        { key: "coverage_template_id", label: "coverage_template_id" },
        { key: "day_of_week", label: "day_of_week" },
        { key: "weekday", label: "weekday" },
        { key: "group_name", label: "group_name" },
        { key: "group_code", label: "group_code" },
        { key: "segment_number", label: "segment_number" },
        { key: "assigned_employee", label: "assigned_employee" },
        { key: "owner_type", label: "owner_type" },
        { key: "coverage_purpose", label: "coverage_purpose" },
        { key: "coverage_start", label: "coverage_start" },
        { key: "coverage_end", label: "coverage_end" },
        { key: "active", label: "active" },
        { key: "notes", label: "notes" },
      ]);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", "attachment; filename=coverage-templates.csv");
      res.status(200).send(csv);
    } catch (error) {
      fail(res, error, "Coverage template export failed");
    }
  });

  router.get("/locations/workload-settings", async (_req, res) => {
    try {
      const rows = await runReadOnlySql(`select * from public.sch_list_location_workload_settings()`);
      res.status(200).json({ ok: true, data: rows || [], meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion } });
    } catch (error) {
      fail(res, error, "Location workload settings failed");
    }
  });

  router.post("/locations/:locationId/workload-settings", requireSchedulePin, async (req, res) => {
    try {
      const locationId = String(req.params.locationId || "").trim();
      if (!locationId) throw new Error("locationId is required.");
      const difficultyRating = toNullableRating(req.body?.difficulty_rating);
      const priorityRating = toNullableRating(req.body?.priority_rating);
      const workloadNotes = req.body?.workload_notes == null ? null : String(req.body.workload_notes);
      const data = await runRpc("sch_set_location_workload_settings", {
        p_location_id: locationId,
        p_difficulty_rating: difficultyRating,
        p_priority_rating: priorityRating,
        p_workload_notes: workloadNotes,
      });
      res.status(200).json({ ok: true, data, meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion } });
    } catch (error) {
      fail(res, error, "Update location workload settings failed");
    }
  });

  router.use(async (req, _res, next) => {
    if (req.method === "GET" && !req.path.startsWith("/generation-window") && !req.path.startsWith("/health")) {
      maybeAutoGenerateWindow().catch((error) => console.error("schedule auto-generate trigger failed:", error));
    }
    next();
  });

  router.get("/current-owner", async (req, res) => {
    try {
      const locationCode = String(req.query.location_code || req.query.code || "").trim();
      if (!locationCode) throw new Error("location_code is required.");
      const atSql = optionalTimestampLiteral(req.query.at);
      const rows = await runReadOnlySql(`select * from public.sch_get_current_owner('${esc(locationCode)}', ${atSql})`);
      const data = Array.isArray(rows) && rows.length ? rows[0] : null;
      res.status(200).json({ ok: true, data, meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion } });
    } catch (error) {
      fail(res, error, "Current owner lookup failed");
    }
  });

  router.post("/generate-daily", requireSchedulePin, async (req, res) => {
    try {
      const serviceDate = requireDate(req.body?.service_date || req.body?.date || (await getServiceDate()));
      const force = req.body?.force !== false;
      const data = await runRpc("sch_generate_daily_schedule", { p_service_date: serviceDate, p_force: force });
      res.status(200).json({ ok: true, data, meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion } });
    } catch (error) {
      fail(res, error, "Generate daily schedule failed");
    }
  });

  router.get("/generation-window", async (req, res) => {
    try {
      const serviceDate = requireDate(req.query.service_date || req.query.date || (await getServiceDate()));
      const days = Math.max(1, Math.min(14, Number.parseInt(String(req.query.days || 7), 10) || 7));
      const triggerAuto = String(req.query.trigger_auto || "").trim() === "1";
      if (triggerAuto) await maybeAutoGenerateWindow(serviceDate);
      const window = await getScheduleRangeStatus(serviceDate, days);
      const ready_days = window.filter((row) => row.ready).length;
      res.status(200).json({ ok: true, data: { service_date: serviceDate, days, ready_days, missing_days: Math.max(0, days - ready_days), window, auto_generation: { running: autoGenerateState.running, last_started_at: autoGenerateState.lastStartedAt || null, last_completed_at: autoGenerateState.lastCompletedAt || null, last_window_start: autoGenerateState.lastWindowStart || null, generated_days: Array.isArray(autoGenerateState.lastResult) ? autoGenerateState.lastResult.filter((row) => row.generated).length : 0 } }, meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion } });
    } catch (error) {
      fail(res, error, "Schedule window status failed");
    }
  });

  router.post("/generate-range", requireSchedulePin, async (req, res) => {
    try {
      const serviceDate = requireDate(req.body?.service_date || req.body?.date || (await getServiceDate()));
      const days = Math.max(1, Math.min(14, Number.parseInt(String(req.body?.days || 7), 10) || 7));
      const force = req.body?.force === true;
      const generated_days = await ensureScheduleRange(serviceDate, days, { force });
      res.status(200).json({ ok: true, data: { service_date: serviceDate, days, generated_days }, meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion } });
    } catch (error) {
      fail(res, error, "Generate schedule range failed");
    }
  });

  router.post("/absence-preview", requireSchedulePin, async (req, res) => {
    try {
      const serviceDate = requireDate(req.body?.service_date || req.body?.date || (await getServiceDate()));
      const absentIdsSql = uuidArrayLiteral(req.body?.absent_employee_ids || []);
      const initialState = await getDailyGenerationState(serviceDate);
      let generatedBeforePreview = false;

      if (initialState.assignment_count === 0) {
        await runRpc("sch_generate_daily_schedule", { p_service_date: serviceDate, p_force: true });
        generatedBeforePreview = true;
      }

      const finalState = generatedBeforePreview ? await getDailyGenerationState(serviceDate) : initialState;
      const rows = await runReadOnlySql(`select public.sch_absence_preview('${esc(serviceDate)}'::date, ${absentIdsSql}) as data`);
      const data = Array.isArray(rows) && rows.length ? rows[0].data : null;
      res.status(200).json({
        ok: true,
        data,
        meta: {
          version: appVersion,
          release_id: releaseId,
          contract_version: contractVersion,
          generated_before_preview: generatedBeforePreview,
          generation_mode: generatedBeforePreview ? "auto_generated" : "existing",
          generated_roster_rows: finalState.roster_count,
          generated_assignment_rows: finalState.assignment_count,
        },
      });
    } catch (error) {
      fail(res, error, "Absence preview failed");
    }
  });

  router.post("/absence-publish", requireSchedulePin, async (req, res) => {
    try {
      const serviceDate = requireDate(req.body?.service_date || req.body?.date || (await getServiceDate()));
      const absentIds = Array.isArray(req.body?.absent_employee_ids)
        ? req.body.absent_employee_ids.map((x) => String(x || "").trim()).filter(Boolean)
        : [];
      const data = await runRpc("sch_absence_publish", {
        p_service_date: serviceDate,
        p_absent_employee_ids: absentIds,
      });
      res.status(200).json({ ok: true, data, meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion } });
    } catch (error) {
      fail(res, error, "Absence publish failed");
    }
  });

  return router;
}
