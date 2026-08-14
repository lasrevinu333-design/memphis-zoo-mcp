#!/usr/bin/env node

import assert from "node:assert/strict";
import { PHONE_READINESS_QUERY, evaluatePhoneReadiness } from "./phone-production-readiness.mjs";

assert.match(PHONE_READINESS_QUERY, /custodial_offline_actor_contexts context/i);
assert.match(PHONE_READINESS_QUERY, /reconciliation\.state='committed'/i);
assert.match(PHONE_READINESS_QUERY, /context\.status='committed'/i);
assert.match(PHONE_READINESS_QUERY, /start_evidence\.client_event_id=context\.native_scan_entry_id::text/i);
assert.match(PHONE_READINESS_QUERY, /start_event\.event_type='scan_start' and start_event\.result='ok'/i);
assert.match(PHONE_READINESS_QUERY, /finish_event\.event_type='scan_finish' and finish_event\.result='ok'/i);
assert.match(PHONE_READINESS_QUERY, /start_event\.payload_json->>'entry_source'='native-nfc'/i);
assert.match(PHONE_READINESS_QUERY, /finish_event\.payload_json->>'entry_source'='native-nfc'/i);
assert.match(PHONE_READINESS_QUERY, /native_start_attestation_version='custodial-native-start\.v1'/i);
assert.match(PHONE_READINESS_QUERY, /native_completion_attestation_version='custodial-native-completion\.v1'/i);
assert.match(PHONE_READINESS_QUERY, /finish_event\.scanned_at=context\.native_completed_at/i);
assert.doesNotMatch(PHONE_READINESS_QUERY, /coalesce\(se\.result,''\) not ilike '%fail%'/i,
  "readiness must not treat arbitrary non-failure scan rows as accepted NFC evidence");

assert.match(PHONE_READINESS_QUERY, /order by coalesce\(p\.observed_at,p\.evaluated_at\) desc[\s\S]*?limit 1/i,
  "readiness must classify the newest proximity row rather than find an older favorable row");
assert.match(PHONE_READINESS_QUERY, /case when latest\.result='near' then latest\.observed_at end/i);
assert.doesNotMatch(PHONE_READINESS_QUERY, /latest\.result in \('near','ok'\)/i,
  "readiness must accept only the canonical proximity success result");
assert.doesNotMatch(PHONE_READINESS_QUERY, /max\(p\.evaluated_at\)/i,
  "away, stale, and low-accuracy evaluations must not become positive readiness timestamps");

const nowMs = Date.parse("2026-08-14T18:00:00.000Z");
const ready = {
  device_id: "KIOSK_02",
  device_pk: "device-pk",
  active: true,
  assigned_employee_id: "employee-pk",
  last_seen_at: "2026-08-14T17:59:00.000Z",
  sync_updated_at: "2026-08-14T17:59:00.000Z",
  frontend_version: "release-under-test",
  queue_count: 0,
  retry_count: 0,
  last_error: null,
  active_credentials: 1,
  active_push_registrations: 1,
  last_push_delivery_at: "2026-08-14T17:55:00.000Z",
  last_successful_auth_at: "2026-08-14T17:55:00.000Z",
  last_scan_start_at: "2026-08-14T17:50:00.000Z",
  last_scan_at: "2026-08-14T17:54:00.000Z",
  last_proximity_at: "2026-08-14T17:53:00.000Z",
  last_notification_ack_at: "2026-08-14T17:52:00.000Z",
};

assert.equal(evaluatePhoneReadiness([ready], { expectedRelease: ready.frontend_version, nowMs }).ok, true);

const noBoundScan = evaluatePhoneReadiness([{ ...ready, last_scan_start_at: null, last_scan_at: null }], {
  expectedRelease: ready.frontend_version,
  nowMs,
});
assert.equal(noBoundScan.ok, false);
assert.match(noBoundScan.devices[0].gaps.join("\n"), /accepted native NFC scan is missing.*start\/finish required/i);

for (const rejectedResult of ["away", "stale", "low_accuracy"]) {
  const rejected = evaluatePhoneReadiness([{ ...ready, last_proximity_at: null }], {
    expectedRelease: ready.frontend_version,
    nowMs,
  });
  assert.equal(rejected.ok, false, `${rejectedResult} proximity must not count as ready`);
  assert.match(rejected.devices[0].gaps.join("\n"), /GPS proximity result is missing/i);
}

console.log("PHONE_PRODUCTION_READINESS_CONTRACT_PASS");
