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
        notes: row.notes,
      });
    }
    return groups;
  }

  router.get("/health", (_req, res) => {
    res.status(200).json(buildHealthPayload("schedule", { contract_version: contractVersion }));
  });

  router.get("/today", async (_req, res) => {
    try {
      const serviceDate = await getServiceDate();
      if (!serviceDate) throw new Error("Could not resolve service date.");
      const rows = await runReadOnlySql(`select * from public.sch_get_daily_schedule('${esc(serviceDate)}'::date)`);
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
      const rows = await runReadOnlySql(`select * from public.sch_get_daily_schedule('${esc(serviceDate)}'::date)`);
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
        from public.sch_get_daily_schedule('${esc(serviceDate)}'::date)
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

  router.post("/absence-preview", requireSchedulePin, async (req, res) => {
    try {
      const serviceDate = requireDate(req.body?.service_date || req.body?.date || (await getServiceDate()));
      const absentIdsSql = uuidArrayLiteral(req.body?.absent_employee_ids || []);
      const rows = await runReadOnlySql(`select public.sch_absence_preview('${esc(serviceDate)}'::date, ${absentIdsSql}) as data`);
      const data = Array.isArray(rows) && rows.length ? rows[0].data : null;
      res.status(200).json({ ok: true, data, meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion } });
    } catch (error) {
      fail(res, error, "Absence preview failed");
    }
  });

  router.post("/absence-publish", requireSchedulePin, async (_req, res) => {
    res.status(501).json({
      ok: false,
      error: "Absence publish is intentionally not enabled in framework mode yet. Use preview-first workflow.",
      meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion },
    });
  });

  return router;
}
