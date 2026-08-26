#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const migration = readFileSync(resolve(root, "supabase/migrations/20260824213000_static_weekly_operational_truth_cutover.sql"), "utf8");
const runtimeAuthority = readFileSync(resolve(root, "supabase/migrations/20260825134500_scan_alert_runtime_authority_closure.sql"), "utf8");
const legacyWriterRetirement = readFileSync(resolve(root, "supabase/migrations/20260826114516_retire_legacy_daily_schedule_writers_after_static_weekly_cutover.sql"), "utf8");
const index = readFileSync(resolve(root, "src/index.js"), "utf8");
const scheduleApi = readFileSync(resolve(root, "src/schedule-api.js"), "utf8");
const messagingApi = readFileSync(resolve(root, "src/messaging-api.js"), "utf8");

assert.match(migration, /static_weekly_v6_schedule_authority_state[\s\S]*static_weekly_effective_version\(p_service_date\)/i,
  "one authority-state function must resolve the effective weekly publication");
assert.match(migration, /exception_set_digest\s*=\s*public\.static_weekly_digest_jsonb\([\s\S]*static_weekly_accepted_exception_set/i,
  "current projection selection must bind the accepted dated exception set");
assert.match(migration, /v_projection_revision\s*<=\s*v_staffing_revision[\s\S]*stale_staffing_change/i,
  "a staffing change after materialization must stale the projection");
assert.match(migration, /if authority\.governed and authority\.projection_status <> 'current' then\s*return;/i,
  "governed missing or stale authority must return no compatibility rows");
assert.match(migration, /if not authority\.governed then[\s\S]*sch_get_daily_schedule_with_purpose/i,
  "legacy compatibility must be explicit and restricted to ungoverned dates");
assert.equal((migration.match(/sch_get_daily_schedule_with_purpose/g) || []).length, 1,
  "the migration may reference the legacy daily scheduler only in its bounded ungoverned branch");

assert.match(migration, /custodial_operational_location_assignments[\s\S]*segment\.service_mode = 'scan_tracked'/i,
  "physical cleaning truth must include scan-tracked work only");
assert.match(migration, /response_only_no_clean[\s\S]*response_only/i,
  "response-only work must remain explicit non-cleaning schedule work");
assert.match(migration, /v_location_dashboard_status[\s\S]*custodial_operational_location_assignments\(day\.service_date\)/i,
  "manager dashboard due truth must consume canonical physical locations");
const dashboardBlock = migration.slice(
  migration.indexOf("create or replace view public.v_location_dashboard_status"),
  migration.indexOf("create or replace function public.mz_enqueue_employee_location_pushes"),
);
assert.doesNotMatch(dashboardBlock, /sch_get_daily_schedule_with_purpose|daily_schedule_assignments/i,
  "manager dashboard must not retain a shadow daily schedule source");
assert.match(dashboardBlock, /greatest\([\s\S]*latest_completed\.effective_completed_at[\s\S]*scheduled_baseline\.baseline_at/i,
  "a completion before the published coverage window must not make the next due window start early");
assert.match(migration, /mz_enqueue_employee_location_pushes[\s\S]*custodial_operational_location_assignments\(v_service_date\)/i,
  "durable employee push jobs must use the same physical-location authority");
assert.match(migration, /v_memphis_area_schedule[\s\S]*static_weekly_v6_read_schedule_segments/i,
  "compatibility AI and analytics views must be projections of canonical schedule authority");
assert.match(migration, /revoke all on function public\.static_weekly_v6_schedule_authority_state[\s\S]*from public, anon, authenticated, service_role/i,
  "new authority readers must not become public or generic service-role RPCs");
assert.match(migration, /grant execute on function public\.static_weekly_v6_schedule_authority_state[\s\S]*to custodial_application_reader/i,
  "only the dedicated application reader receives the canonical read surface");
assert.match(runtimeAuthority, /custodial_backend_queue_due_scan_alerts[\s\S]*custodial_require_backend_execution_secret/i,
  "scan-alert maintenance must cross a fixed backend-secret boundary");
assert.match(runtimeAuthority, /revoke execute on function public\.sch_queue_due_scan_alerts\(integer,boolean,integer,integer\)[\s\S]*from service_role/i,
  "the weaker direct service-role alert writer must be retired");
assert.match(index, /runScanAlertQueue[\s\S]*custodial_backend_queue_due_scan_alerts[\s\S]*p_backend_execution_secret:\s*offlineAuthoritySecret\(\)/i,
  "runtime maintenance must call the secret-bound scan-alert wrapper");

assert.match(legacyWriterRetirement,
  /static_weekly_reject_legacy_daily_schedule_write[\s\S]*static_weekly_v6_schedule_authority_state\(v_date\)[\s\S]*if v_authority\.governed then[\s\S]*legacy daily schedule writes are retired/i,
  "one database trigger boundary must reject all shadow daily writes for governed dates");
for (const table of ["daily_schedule_assignments", "daily_work_roster", "daily_group_assignments", "daily_absence_overrides"]) {
  assert.match(legacyWriterRetirement,
    new RegExp(`public\\.${table}[^\\n]*trg_static_weekly_fence_${table}`, "i"),
    `${table} must be fenced at the relation boundary`);
}
assert.match(legacyWriterRetirement,
  /create trigger %I before insert or update or delete on %s for each row execute function public\.static_weekly_reject_legacy_daily_schedule_write\(\)/i,
  "every listed legacy relation must receive the same insert/update/delete fence");
assert.match(legacyWriterRetirement,
  /sch_ensure_schedule_window[\s\S]*if v_authority\.governed then[\s\S]*legacy_mutation_skipped[\s\S]*continue;[\s\S]*sch_ensure_daily_schedule/i,
  "the retained window helper must skip governed dates before reaching the legacy generator");
assert.match(legacyWriterRetirement,
  /cron\.alter_job\(v_job_id,null,null,null,null,false\)/i,
  "the rolling daily-schedule cron must be disabled through the supported pg_cron API");
assert.doesNotMatch(legacyWriterRetirement, /update\s+cron\.job/i,
  "the migration must not write the extension-owned pg_cron catalog directly");
assert.match(legacyWriterRetirement,
  /custodial_release_authority_restore_inventory[\s\S]*static_weekly_reject_legacy_daily_schedule_write\(\)[\s\S]*sch_ensure_schedule_window\(date,integer,text\)[\s\S]*capture_legacy_writer_retirement_triggers/i,
  "release recovery must preserve the writer fence, helper body, grants, and four relation triggers");

const managerRouteBlock = scheduleApi.slice(
  scheduleApi.indexOf('router.get("/today"'),
  scheduleApi.indexOf('router.get("/my-day-summary"'),
);
assert.match(managerRouteBlock, /loadCanonicalScheduleSegments/g,
  "manager and enrolled-phone schedule routes must use canonical segments");
assert.match(managerRouteBlock, /loadCanonicalRoster/g,
  "manager schedule routes must use the static-weekly-aware roster");
assert.doesNotMatch(managerRouteBlock, /sch_get_daily_schedule_with_purpose|daily_work_roster/i,
  "normal governed manager/phone routes must not query legacy schedule tables");
assert.match(scheduleApi, /schedule_authority_unavailable[\s\S]*authority_adapter_missing/i,
  "a source/migration mismatch must fail closed with explicit readiness");
const workStatusBlock = scheduleApi.slice(
  scheduleApi.indexOf('router.get("/work-status"'),
  scheduleApi.indexOf('router.get("/today"'),
);
assert.match(workStatusBlock, /loadStaticWeeklyEmployeeDay/i,
  "manager work status must consume the canonical employee-day authority");
assert.doesNotMatch(workStatusBlock, /sch_get_employee_work_status[\s\S]*else|catch[\s\S]*sch_get_employee_work_status/i,
  "governed work status must not rescue canonical failure through a legacy reader");

const locationReminderBlock = messagingApi.slice(
  messagingApi.indexOf("assigned_locations as (", messagingApi.indexOf("device-location-status-reminders")),
  messagingApi.indexOf("reminder_rows", messagingApi.indexOf("device-location-status-reminders")),
);
assert.match(locationReminderBlock, /custodial_operational_location_assignments/i,
  "live employee reminder reads must use canonical physical locations");
assert.doesNotMatch(locationReminderBlock, /sch_get_daily_schedule_with_purpose|location_group_memberships/i,
  "live employee reminders must not reconstruct a shadow route from legacy groups");

console.log("STATIC_WEEKLY_OPERATIONAL_TRUTH_CONTRACT_PASS");
