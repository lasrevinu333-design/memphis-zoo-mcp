      requested < currentServiceDate
        ? `No published schedule exists for historical date ${requested}.`
        : `Schedule for ${requested} is not ready. Use the explicit schedule generation control before opening employee schedules.`
    );
    error.status = requested < currentServiceDate ? 404 : 503;
    error.code = requested < currentServiceDate ? "schedule_not_found" : "schedule_not_ready";
    error.readiness = { service_date: requested, roster_count: rosterCount, assignment_count: assignmentCount };
    throw error;
  }
''',
)
replace_once(
    "src/schedule-api.js",
    '  function fail(res, error, fallback = "Schedule request failed", status = 400) {\n    res.status(status).json({ ok: false, error: error?.message || fallback });\n  }',
    '  function fail(res, error, fallback = "Schedule request failed", status = 400) {\n    res.status(Number(error?.status) || status).json({\n      ok: false,\n      code: error?.code || "schedule_request_failed",\n      error: error?.message || fallback,\n      readiness: error?.readiness || undefined,\n    });\n  }',
)
for old, new in [
    ('await ensureScheduleReadyForRead(serviceDate, "schedule_today");', 'await assertScheduleReadyForRead(serviceDate);'),
    ('await ensureScheduleReadyForRead(serviceDate, "schedule_day");', 'await assertScheduleReadyForRead(serviceDate);'),
    ('await ensureScheduleReadyForRead(serviceDate, "schedule_my_day");', 'await assertScheduleReadyForRead(serviceDate);'),
    ('await ensureScheduleReadyForRead(serviceDate, "schedule_my_day_summary");', 'await assertScheduleReadyForRead(serviceDate);'),
    ('await ensureScheduleReadyForRead(serviceDate, "schedule_my_schedule");', 'await assertScheduleReadyForRead(serviceDate);'),
]:
    replace_once("src/schedule-api.js", old, new)
replace_once(
    "src/schedule-api.js",
    '''      const triggerAuto = String(req.query.trigger_auto || "").trim() === "1";
      if (triggerAuto) await maybeAutoGenerateWindow(serviceDate);
      const window = await getScheduleRangeStatus(serviceDate, days);
      const ready_days = window.filter((row) => row.ready).length;
      const autoGeneration = { running: autoGenerateState.running, last_started_at: autoGenerateState.lastStartedAt || null, last_completed_at: autoGenerateState.lastCompletedAt || null, last_window_start: autoGenerateState.lastWindowStart || null, generated_days: Array.isArray(autoGenerateState.lastResult) ? autoGenerateState.lastResult.filter((row) => row.generated).length : 0 };
''',
    '''      const triggerAutoRequested = String(req.query.trigger_auto || "").trim() === "1";
      const window = await getScheduleRangeStatus(serviceDate, days);
      const ready_days = window.filter((row) => row.ready).length;
      const autoGeneration = {
        running: autoGenerateState.running,
        last_started_at: autoGenerateState.lastStartedAt || null,
        last_completed_at: autoGenerateState.lastCompletedAt || null,
        last_window_start: autoGenerateState.lastWindowStart || null,
        generated_days: Array.isArray(autoGenerateState.lastResult) ? autoGenerateState.lastResult.filter((row) => row.generated).length : 0,
        trigger_auto_requested: triggerAutoRequested,
        trigger_auto_ignored: triggerAutoRequested,
        generation_endpoint: "/schedule-api/generate-range",
      };
''',
)

# Moxie must never claim a password changed when authentication is disabled.
replace_once(
    "src/routes/moxie.js",
    '    if(r.ok){msg.textConte