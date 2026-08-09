import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { resolveCanonicalDevice } from '../src/device-identity.js';

const root = process.cwd();
const read = (relative) => {
  const current = path.resolve(root, relative);
  if (fs.existsSync(current)) return fs.readFileSync(current, 'utf8');
  return fs.readFileSync(current.replace('/supabase/migrations/', '/supabase/legacy_migrations/'), 'utf8');
};

const indexSource = read('src/index.js');
const scheduleSource = read('src/schedule-api.js');
const messagingSource = read('src/messaging-api.js');
const eventsSource = read('src/events-api.js');
const migration = read('sql/2026-07-14_scheduler_notifications_gps_foundation.sql');
const foundationRepair = [
  'supabase/migrations/20260716193547_foundation_repair_schedule_audit.sql',
  'supabase/migrations/20260716193606_foundation_repair_schedule_window.sql',
  'supabase/migrations/20260716193627_foundation_repair_schedule_cron.sql',
].map(read).join('\n');
const gpsMotionHardening = read('supabase/migrations/20260719231728_gps_proximity_motion_hardening.sql');
const packageJson = JSON.parse(read('package.json'));

assert.equal(packageJson.scripts?.['test:foundation'], 'node scripts/scheduler-alerts-gps-foundation-tests.mjs');

const aliasRow = {
  requested_device_id: 'a7b69ce3-dc662d3d',
  matched_by: 'alias',
  canonical_device_id: 'KIOSK_08',
  device_id: 'KIOSK_08',
  device_name: 'Karen Robinson',
  device_active: true,
  assigned_employee_id: 'employee-karen',
  assigned_employee_name: 'Karen Robinson',
  employee_code: 'EMP008',
  role: 'staff',
  employee_active: true,
};
let identityQuery = '';
const resolved = await resolveCanonicalDevice({
  runReadOnlySql: async (sql) => {
    identityQuery = sql;
    return [aliasRow];
  },
  deviceIdentifier: 'a7b69ce3-dc662d3d',
});
assert.equal(resolved.canonical_device_id, 'KIOSK_08');
assert.equal(resolved.assigned_employee_name, 'Karen Robinson');
assert.match(identityQuery, /public\.device_aliases/i);
assert.match(identityQuery, /order by match_rank/i);
assert.match(identityQuery, /0 as match_rank,\s*'alias'::text as matched_by/i);
assert.match(identityQuery, /1 as match_rank,\s*'canonical'::text as matched_by/i);
assert.ok(
  identityQuery.indexOf("'alias'::text as matched_by") < identityQuery.indexOf("'canonical'::text as matched_by"),
  'Alias mapping must be considered before a legacy duplicate device row.'
);

assert.match(scheduleSource, /resolveCanonicalDevice/);
assert.match(scheduleSource, /requested_device_id/);
assert.match(scheduleSource, /canonical_device_id/);
assert.match(scheduleSource, /router\.get\("\/my-day-summary"/);
assert.match(scheduleSource, /assertScheduleReadyForRead/);
const readinessHelper = scheduleSource.match(/async function assertScheduleReadyForRead[\s\S]*?\n  }\n  async function loadFullDayScheduleItems/)?.[0] || "";
assert.doesNotMatch(readinessHelper, /runRpc|runWriteSql|sch_ensure_daily_schedule/);
assert.match(scheduleSource, /loadFullDayScheduleItems/);
assert.match(scheduleSource, /combineFullDaySchedule/);
assert.match(scheduleSource, /Not scheduled to work today\./);
assert.match(scheduleSource, /No assignment is active at this moment\. Your full-day schedule is shown below\./);
assert.match(foundationRepair, /sch_ensure_schedule_window/);
assert.match(foundationRepair, /scheduled_rolling_window_readiness/);
assert.match(scheduleSource, /resolveRestroomRebalanceScheduler\(process\.env\)/);
assert.match(scheduleSource, /scheduler:\s*restroomRebalanceScheduler/);
assert.doesNotMatch(scheduleSource, /explicit_runtime/);

assert.match(indexSource, /const SCAN_CONTRACT_VERSION = "scan\.v2"/);
assert.match(indexSource, /SCAN_READ_LIMIT_PER_MINUTE[^\n]*120/);
assert.match(indexSource, /SCAN_WRITE_LIMIT_PER_MINUTE[^\n]*30/);
assert.match(indexSource, /SCAN_SHARED_IP_EMERGENCY_LIMIT_PER_MINUTE[^\n]*1000/);
assert.match(indexSource, /app\.post\("\/scan-api\/rpc", requireDeviceOrOpsAccess, requireScanRpcAuthorization, scanRpcRateLimit/);
assert.match(indexSource, /tool_commit_cleaning_workflow/);
assert.match(indexSource, /tool_report_device_sync_status/);
assert.match(indexSource, /tool_evaluate_location_proximity/);
assert.match(indexSource, /tool_evaluate_location_proximity_v2/);
assert.match(indexSource, /canonicalizeScanArguments/);
assert.match(indexSource, /run_application_write/);
assert.match(indexSource, /async function runWriteSql\(namePrefix, sql\)[\s\S]{0,500}client\.rpc\("run_application_write"/);
assert.doesNotMatch(indexSource.match(/async function runWriteSql\(namePrefix, sql\)[\s\S]*?\n}\n/)?.[0] || '', /run_sql_migration/);
assert.doesNotMatch(indexSource, /app\.post\("\/scan-api\/rpc", rateLimit/);
assert.doesNotMatch(indexSource, /eventMaintenanceController\.kick\("scan_api_rpc"\)/);
assert.doesNotMatch(indexSource, /eventMaintenanceController\.kick\("messaging_api_request"\)/);
assert.doesNotMatch(indexSource, /eventMaintenanceController\.kick\("schedule_api_request"\)/);
assert.match(indexSource, /eventMaintenanceController\.kick\("scheduled_worker"\)/);
assert.match(indexSource, /where se\.event_type = 'work_position_check'/);

assert.match(eventsSource, /mz_enqueue_employee_event_pushes/);
assert.match(eventsSource, /native_employee_push_only/);
assert.match(eventsSource, /messenger_coupling:\s*false/);
assert.doesNotMatch(eventsSource, /claim_event_notification/);
assert.doesNotMatch(eventsSource, /finalize_event_notification/);
assert.doesNotMatch(eventsSource, /msg_send_message/);
assert.doesNotMatch(eventsSource, /client_message_id:\s*notificationKey/);
assert.doesNotMatch(eventsSource, /events_admin_list/);
assert.doesNotMatch(eventsSource, /events_admin_create_before/);
assert.doesNotMatch(eventsSource, /kind = "day_of_event"/);

assert.match(messagingSource, /router\.get\("\/device-event-reminders", requireDeviceOrOpsAuth/);
assert.match(messagingSource, /retired:\s*true/);
assert.match(messagingSource, /delivery:\s*"native_employee_push_only"/);
assert.match(messagingSource, /messenger_coupling:\s*false/);
assert.match(messagingSource, /router\.get\("\/device-location-status-reminders", requireDeviceOrOpsAuth/);
assert.match(messagingSource, /router\.post\("\/device-notifications\/ack", requireWritableDeviceOrOpsAuth/);
assert.doesNotMatch(
  messagingSource.match(/router\.get\("\/device-event-reminders"[\s\S]*?router\.get\("\/device-location-status-reminders"/)?.[0] || '',
  /from public\.msg_messages|events_app_events|events_app_notification_log/
);

assert.match(migration, /create table if not exists public\.device_aliases/);
assert.match(migration, /create table if not exists public\.device_sync_status/);
assert.match(migration, /create or replace function public\.tool_report_device_sync_status/);
assert.match(migration, /create or replace function public\.run_application_write/);
assert.match(migration, /create or replace function public\.sch_ensure_daily_schedule/);
assert.match(migration, /daily_static_schedule_ready/);
assert.match(migration, /create table if not exists public\.device_notification_acknowledgements/);
assert.match(migration, /create or replace function public\.ack_device_notification/);
assert.match(migration, /create or replace function public\.claim_event_notification/);
assert.match(migration, /create or replace function public\.finalize_event_notification/);
assert.match(migration, /status = any\(array\['sending'::text,'sent'::text,'error'::text\]\)/);
assert.match(migration, /gps_proximity_radius_m/);
assert.match(migration, /create table if not exists public\.device_location_proximity_status/);
assert.match(migration, /create or replace function public\.evaluate_location_proximity/);
assert.match(migration, /create or replace function public\.tool_evaluate_location_proximity/);
assert.match(migration, /'work_position_check'/);
assert.match(migration, /v_result := 'away'; v_badge_color := 'red'/);
assert.doesNotMatch(migration, /alter table public\.locations add column if not exists latitude/);
assert.match(gpsMotionHardening, /create or replace function public\.evaluate_location_proximity_v2/i);
assert.match(gpsMotionHardening, /p_observed_at timestamptz/i);
assert.match(gpsMotionHardening, /gps_max_observation_age_seconds/i);
assert.match(gpsMotionHardening, /gps_future_tolerance_seconds/i);
assert.match(gpsMotionHardening, /gps_boundary_hysteresis_m/i);
assert.match(gpsMotionHardening, /gps_max_human_speed_mps/i);
assert.match(gpsMotionHardening, /v_result := 'stale'/i);
assert.match(gpsMotionHardening, /v_result := 'future_clock'/i);
assert.match(gpsMotionHardening, /v_result := 'boundary_uncertain'/i);
assert.match(gpsMotionHardening, /v_result := 'implausible_jump'/i);
assert.match(gpsMotionHardening, /v_status_observed_at := least\(v_observed_at, v_now\)/i, 'future phone clocks must not pin current status ahead of valid readings');
assert.match(gpsMotionHardening, /v_motion_distance_m - greatest\(coalesce\(p_accuracy_m, 0\), 0\) - greatest\(coalesce\(v_previous_accuracy_m, 0\), 0\)/i, 'GPS accuracy uncertainty must be removed before implausible-motion classification');
assert.match(gpsMotionHardening, /where excluded\.observed_at >= coalesce\(device_location_proximity_status\.observed_at/i, 'offline replay must not replace a newer device-location status');
assert.match(gpsMotionHardening, /on conflict\(client_event_id\) where client_event_id is not null do nothing/i, 'concurrent duplicate GPS event IDs must converge without a unique-constraint failure');
assert.match(gpsMotionHardening, /never changes cleaning session authority/i);
assert.match(gpsMotionHardening, /revoke all on function public\.tool_evaluate_location_proximity_v2[\s\S]*from public, anon, authenticated/i);

console.log(JSON.stringify({
  ok: true,
  checked: [
    'canonical_device_alias_resolution',
    'alias_precedence_over_legacy_duplicate_device_rows',
    'karen_my_schedule_alias_path',
    'per_device_scan_rate_limits',
    'atomic_scan_workflow',
    'scheduled_event_worker',
    'schedule_readiness_read_only_guard',
    'native_employee_event_push_cutover',
    'durable_notification_acknowledgement',
    'authoritative_offsite_gps_contract',
    'scheduler_static_and_exception_audit_contract',
  ],
}, null, 2));
