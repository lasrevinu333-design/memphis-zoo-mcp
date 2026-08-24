#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const migration = readFileSync(resolve(root, "supabase/migrations/20260824213000_static_weekly_operational_truth_cutover.sql"), "utf8");
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
