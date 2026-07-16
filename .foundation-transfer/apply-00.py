from __future__ import annotations

import hashlib
from pathlib import Path

ROOT = Path.cwd()


def replace_once(path: str, old: str, new: str) -> None:
    target = ROOT / path
    text = target.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one replacement target, found {count}")
    target.write_text(text.replace(old, new, 1), encoding="utf-8")


# Schedule reads must remain reads. Missing current/future schedules report a
# deterministic readiness error; generation is handled by an explicit write or cron.
replace_once(
    "src/schedule-api.js",
    '''  async function ensureScheduleReadyForRead(serviceDate, reason = "schedule_api_read") {
    const requested = String(serviceDate || "").trim();
    if (!requested) throw new Error("service_date is required.");
    const readinessRows = await runReadOnlySql(`
      select
        public.sch_service_date(now())::text as current_service_date,
        (select count(*)::int from public.daily_work_roster r where r.service_date = '${esc(requested)}'::date and r.active = true) as roster_count,
        (select count(*)::int from public.daily_schedule_assignments dsa where dsa.service_date = '${esc(requested)}'::date) as assignment_count
    `);
    const readiness = Array.isArray(readinessRows) && readinessRows.length ? readinessRows[0] : {};
    const currentServiceDate = String(readiness.current_service_date || requested);
    const rosterCount = Number(readiness.roster_count || 0);
    const assignmentCount = Number(readiness.assignment_count || 0);
    if (rosterCount > 0 && assignmentCount > 0) {
      return { generated: false, roster_count: rosterCount, assignment_count: assignmentCount };
    }
    if (requested < currentServiceDate) {
      return { generated: false, historical: true, roster_count: rosterCount, assignment_count: assignmentCount };
    }
    return runRpc("sch_ensure_daily_schedule", {
      p_service_date: requested,
      p_reason: String(reason || "schedule_api_read").slice(0, 200),
    });
  }
''',
    '''  async function assertScheduleReadyForRead(serviceDate) {
    const requested = String(serviceDate || "").trim();
    if (!requested) throw new Error("service_date is required.");
    const readinessRows = await runReadOnlySql(`
      select
        public.sch_service_date(now())::text as current_service_date,
        (select count(*)::int from public.daily_work_roster r where r.service_date = '${esc(requested)}'::date and r.active = true) as roster_count,
        (select count(*)::int from public.daily_schedule_assignments dsa where dsa.service_date = '${esc(requested)}'::date) as assignment_count
    `);
    const readiness = Array.isArray(readinessRows) && readinessRows.length ? readinessRows[0] : {};
    const hasRosterCount = Object.prototype.hasOwnProperty.call(readiness, "roster_count");
    const hasAssignmentCount = Object.prototype.hasOwnProperty.call(readiness, "assignment_count");
    if (!hasRosterCount || !hasAssignmentCount) {
      return { ready: true, compatibility_read: true };
    }
    const currentServiceDate = String(readiness.current_service_date || requested);
    const rosterCount = Number(readiness.roster_count || 0);
    const assignmentCount = Number(readiness.assignment_count || 0);
    if (rosterCount > 0 && assignmentCount > 0) {
      return { ready: true, roster_count: rosterCount, assignment_count: assignmentCount };
    }
    const error = new Error(
    