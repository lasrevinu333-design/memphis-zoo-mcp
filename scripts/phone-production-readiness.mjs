#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import pg from "pg";

const { Client } = pg;

export const DEFAULT_EXPECTED_DEVICE_IDS = Object.freeze(
  Array.from({ length: 9 }, (_, index) => `KIOSK_${String(index + 2).padStart(2, "0")}`),
);

export const MANUAL_PHYSICAL_REQUIREMENTS = Object.freeze([
  "Fully Kiosk license is active and the kiosk configuration survives reboot",
  "NFC tag launches the correct assigned location while the phone is locked or asleep",
  "Wake, screen-lock, and kiosk-return behavior work on the physical phone",
  "Alerts and voice play at intelligible speed and remain audible for their full duration",
  "Voice response begins within four seconds; spoken output is not limited to four seconds",
  "Offline work survives reconnect without duplication or loss",
]);

export const PHONE_READINESS_QUERY = `
with expected(device_id) as (
  select unnest($1::text[])
)
select
  e.device_id,
  d.id as device_pk,
  d.active,
  d.assigned_employee_id,
  d.assignment_epoch,
  d.last_seen_at,
  s.frontend_version,
  s.queue_count,
  s.retry_count,
  s.last_error,
  s.updated_at as sync_updated_at,
  (select count(*)::integer from public.device_auth_credentials c
   where c.device_id=d.id and c.confirmed_at is not null and c.revoked_at is null
     and (c.expires_at is null or c.expires_at > now())) as active_credentials,
  (select count(*)::integer from public.employee_push_registrations p
   where p.device_id=d.id and p.active and p.revoked_at is null
     and p.employee_id=d.assigned_employee_id and p.assignment_epoch=d.assignment_epoch) as active_push_registrations,
  (select max(p.last_successful_delivery_at) from public.employee_push_registrations p
   where p.device_id=d.id and p.active and p.revoked_at is null
     and p.employee_id=d.assigned_employee_id and p.assignment_epoch=d.assignment_epoch) as last_push_delivery_at,
  (select max(a.created_at) from public.device_auth_events a
   where a.device_id=d.id and a.success) as last_successful_auth_at,
  nfc.last_scan_start_at,
  nfc.last_scan_at,
  proximity.last_proximity_at,
  (select max(n.created_at) from public.device_notification_acknowledgements n
   where n.device_identifier=e.device_id) as last_notification_ack_at
from expected e
left join public.devices d on d.device_id=e.device_id
left join public.device_sync_status s on s.device_id=d.id
left join lateral (
  select max(start_event.scanned_at) as last_scan_start_at,
         max(finish_event.scanned_at) as last_scan_at
  from public.custodial_offline_actor_contexts context
  join public.custodial_offline_reconciliation_records reconciliation
    on reconciliation.context_id=context.context_id and reconciliation.state='committed'
  join public.custodial_offline_scan_event_evidence start_evidence
    on start_evidence.context_id=context.context_id
   and start_evidence.reconciliation_id=reconciliation.reconciliation_id
   and start_evidence.client_event_id=context.native_scan_entry_id::text
  join public.scan_events start_event
    on start_event.client_event_id=start_evidence.client_event_id
   and start_event.session_id=reconciliation.session_id
  join public.custodial_offline_scan_event_evidence finish_evidence
    on finish_evidence.context_id=context.context_id
   and finish_evidence.reconciliation_id=reconciliation.reconciliation_id
  join public.scan_events finish_event
    on finish_event.client_event_id=finish_evidence.client_event_id
   and finish_event.session_id=reconciliation.session_id
  join public.sessions completed_session
    on completed_session.id=reconciliation.session_id and completed_session.status='closed'
  where context.device_id=d.id and context.status='committed'
    and context.native_scan_entry_id is not null
    and context.native_start_attestation_version='custodial-native-start.v1'
    and context.native_start_attestation_sha256 ~ '^[0-9a-f]{64}$'
    and context.native_completion_attestation_version='custodial-native-completion.v1'
    and context.native_completion_attestation_sha256 ~ '^[0-9a-f]{64}$'
    and context.native_completed_at is not null
    and start_event.device_id=context.device_id
    and start_event.event_type='scan_start' and start_event.result='ok'
    and start_event.payload_json->>'entry_source'='native-nfc'
    and start_event.scanned_at=context.started_at
    and finish_event.device_id=context.device_id
    and finish_event.event_type='scan_finish' and finish_event.result='ok'
    and finish_event.payload_json->>'entry_source'='native-nfc'
    and finish_event.scanned_at=context.native_completed_at
) nfc on true
left join lateral (
  select case when latest.result='near' then latest.observed_at end as last_proximity_at
  from (
    select lower(btrim(p.result)) as result,
           coalesce(p.observed_at,p.evaluated_at) as observed_at
    from public.device_location_proximity_status p
    where p.device_id=d.id
    order by coalesce(p.observed_at,p.evaluated_at) desc,p.evaluated_at desc,p.location_id,p.session_uuid
    limit 1
  ) latest
) proximity on true
order by e.device_id
`;

function recent(value, cutoffMs) {
  if (!value) return false;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) && timestamp >= cutoffMs;
}

export function evaluatePhoneReadiness(rows, {
  expectedRelease,
  maxStaleMinutes = 15,
  activityWindowHours = 24,
  nowMs = Date.now(),
} = {}) {
  if (!expectedRelease) throw new Error("expectedRelease is required");
  const freshnessCutoff = nowMs - maxStaleMinutes * 60_000;
  const activityCutoff = nowMs - activityWindowHours * 60 * 60_000;
  const devices = rows.map((row) => {
    const gaps = [];
    if (!row.device_pk) gaps.push("device record is missing");
    if (row.active !== true) gaps.push("device is not active");
    if (!row.assigned_employee_id) gaps.push("employee assignment is missing");
    if (!recent(row.last_seen_at, freshnessCutoff)) gaps.push(`device heartbeat is older than ${maxStaleMinutes} minutes`);
    if (!recent(row.sync_updated_at, freshnessCutoff)) gaps.push(`sync status is older than ${maxStaleMinutes} minutes`);
    if (row.frontend_version !== expectedRelease) gaps.push(`frontend is ${row.frontend_version || "missing"}; expected ${expectedRelease}`);
    if (Number(row.queue_count ?? -1) !== 0) gaps.push(`offline queue contains ${row.queue_count ?? "unknown"} item(s)`);
    if (row.last_error) gaps.push(`sync reports an error: ${row.last_error}`);
    if (Number(row.active_credentials || 0) < 1) gaps.push("active confirmed device credential is missing");
    if (Number(row.active_push_registrations || 0) < 1) gaps.push("employee-bound active push registration is missing");
    if (!recent(row.last_successful_auth_at, activityCutoff)) gaps.push(`successful device authentication is missing within ${activityWindowHours} hours`);
    if (!recent(row.last_scan_at, activityCutoff)) gaps.push(`accepted native NFC scan is missing within ${activityWindowHours} hours (start/finish required)`);
    if (!recent(row.last_proximity_at, activityCutoff)) gaps.push(`GPS proximity result is missing within ${activityWindowHours} hours`);
    if (!recent(row.last_notification_ack_at, activityCutoff)) gaps.push(`notification acknowledgement is missing within ${activityWindowHours} hours`);
    if (!recent(row.last_push_delivery_at, activityCutoff)) gaps.push(`successful native push delivery is missing within ${activityWindowHours} hours`);
    return {
      device_id: row.device_id,
      automated_ready: gaps.length === 0,
      gaps,
      evidence: {
        frontend_version: row.frontend_version || null,
        queue_count: row.queue_count == null ? null : Number(row.queue_count),
        retry_count: row.retry_count == null ? null : Number(row.retry_count),
        last_seen_at: row.last_seen_at || null,
        sync_updated_at: row.sync_updated_at || null,
        last_successful_auth_at: row.last_successful_auth_at || null,
        last_scan_start_at: row.last_scan_start_at || null,
        last_scan_at: row.last_scan_at || null,
        last_proximity_at: row.last_proximity_at || null,
        last_notification_ack_at: row.last_notification_ack_at || null,
        last_push_delivery_at: row.last_push_delivery_at || null,
      },
    };
  });
  return {
    ok: devices.every((device) => device.automated_ready),
    scope: "automated_phone_handoff_only",
    evaluated_at: new Date(nowMs).toISOString(),
    expected_release: expectedRelease,
    max_stale_minutes: maxStaleMinutes,
    activity_window_hours: activityWindowHours,
    ready_device_count: devices.filter((device) => device.automated_ready).length,
    expected_device_count: devices.length,
    devices,
    physical_acceptance_required_separately: MANUAL_PHYSICAL_REQUIREMENTS,
  };
}

async function main() {
  const databaseUrl = String(process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || "").trim();
  const databaseCaCertPath = String(process.env.SUPABASE_DB_CA_CERT_PATH || "").trim();
  const expectedIds = String(process.env.PHONE_READINESS_EXPECTED_DEVICE_IDS || DEFAULT_EXPECTED_DEVICE_IDS.join(","))
    .split(",").map((value) => value.trim()).filter(Boolean);
  const maxStaleMinutes = Number(process.env.PHONE_READINESS_MAX_STALE_MINUTES || 15);
  const activityWindowHours = Number(process.env.PHONE_READINESS_ACTIVITY_WINDOW_HOURS || 24);
  const enforce = String(process.env.PHONE_READINESS_ENFORCE || "false").toLowerCase() === "true";
  const manifest = JSON.parse(readFileSync(new URL("../release/frontend-release-manifest.json", import.meta.url), "utf8"));
  if (!databaseUrl) throw new Error("SUPABASE_DB_URL or DATABASE_URL is required");
  if (!expectedIds.length) throw new Error("At least one expected device identifier is required");
  if (!Number.isFinite(maxStaleMinutes) || maxStaleMinutes <= 0) throw new Error("PHONE_READINESS_MAX_STALE_MINUTES must be positive");
  if (!Number.isFinite(activityWindowHours) || activityWindowHours <= 0) throw new Error("PHONE_READINESS_ACTIVITY_WINDOW_HOURS must be positive");

  const client = new Client({
    connectionString: databaseUrl,
    application_name: "memphis-zoo-phone-readiness-monitor",
    ...(databaseCaCertPath ? {
      ssl: { ca: readFileSync(resolve(databaseCaCertPath), "utf8"), rejectUnauthorized: true },
    } : {}),
  });
  await client.connect();
  try {
    await client.query("begin read only");
    await client.query("set local statement_timeout = '10s'");
    const result = await client.query(PHONE_READINESS_QUERY, [expectedIds]);
    await client.query("commit");
    const report = evaluatePhoneReadiness(result.rows, {
      expectedRelease: manifest.release_id,
      maxStaleMinutes,
      activityWindowHours,
    });
    console.log(JSON.stringify(report, null, 2));
    if (enforce && !report.ok) process.exitCode = 1;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    await client.end().catch(() => {});
  }
}

const isMain = process.argv[1]
  && pathToFileURL(resolve(process.argv[1])).href === pathToFileURL(fileURLToPath(import.meta.url)).href;
if (isMain) await main();
