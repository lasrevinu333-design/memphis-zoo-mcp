#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  DEFAULT_EXPECTED_DEVICE_IDS,
  MANUAL_PHYSICAL_REQUIREMENTS,
  PHONE_READINESS_QUERY,
  evaluatePhoneReadiness,
} from "./phone-production-readiness.mjs";

const nowMs = Date.parse("2026-07-30T22:00:00.000Z");
const readyRow = {
  device_id: "KIOSK_02",
  device_pk: "fixture-device-id",
  active: true,
  assigned_employee_id: "fixture-employee-id",
  assignment_epoch: 1,
  last_seen_at: "2026-07-30T21:59:00.000Z",
  frontend_version: "release-2026.07.19.custodial-v3.12",
  queue_count: 0,
  retry_count: 3,
  last_error: null,
  sync_updated_at: "2026-07-30T21:59:00.000Z",
  active_credentials: 1,
  active_push_registrations: 1,
  last_push_delivery_at: "2026-07-30T21:58:00.000Z",
  last_successful_auth_at: "2026-07-30T21:57:00.000Z",
  last_scan_at: "2026-07-30T21:56:00.000Z",
  last_proximity_at: "2026-07-30T21:55:00.000Z",
  last_notification_ack_at: "2026-07-30T21:54:00.000Z",
};

const passing = evaluatePhoneReadiness([readyRow], {
  expectedRelease: readyRow.frontend_version,
  nowMs,
});
assert.equal(passing.ok, true);
assert.equal(passing.ready_device_count, 1);
assert.equal(passing.devices[0].gaps.length, 0);

const failing = evaluatePhoneReadiness([{
  ...readyRow,
  frontend_version: "release-2026.07.18.custodial-v3.11",
  queue_count: 5,
  active_credentials: 0,
  active_push_registrations: 0,
  last_scan_at: null,
  last_proximity_at: null,
  last_notification_ack_at: null,
  last_push_delivery_at: null,
}], {
  expectedRelease: readyRow.frontend_version,
  nowMs,
});
assert.equal(failing.ok, false);
assert.match(failing.devices[0].gaps.join("\n"), /expected release-2026\.07\.19/);
assert.match(failing.devices[0].gaps.join("\n"), /offline queue contains 5/);
assert.match(failing.devices[0].gaps.join("\n"), /credential is missing/);
assert.match(failing.devices[0].gaps.join("\n"), /push registration is missing/);
assert.match(failing.devices[0].gaps.join("\n"), /NFC scan is missing/);
assert.match(failing.devices[0].gaps.join("\n"), /GPS proximity result is missing/);
assert.match(failing.devices[0].gaps.join("\n"), /notification acknowledgement is missing/);
assert.match(failing.devices[0].gaps.join("\n"), /native push delivery is missing/);

assert.deepEqual(DEFAULT_EXPECTED_DEVICE_IDS, [
  "KIOSK_02", "KIOSK_03", "KIOSK_04", "KIOSK_05", "KIOSK_06",
  "KIOSK_07", "KIOSK_08", "KIOSK_09", "KIOSK_10",
]);
assert.equal(MANUAL_PHYSICAL_REQUIREMENTS.length, 6);
assert.match(PHONE_READINESS_QUERY, /begin|select/i);
assert.match(PHONE_READINESS_QUERY, /device_auth_credentials/);
assert.match(PHONE_READINESS_QUERY, /employee_push_registrations/);
assert.match(PHONE_READINESS_QUERY, /scan_events/);
assert.match(PHONE_READINESS_QUERY, /device_location_proximity_status/);
assert.match(PHONE_READINESS_QUERY, /device_notification_acknowledgements/);

console.log("PHONE_PRODUCTION_READINESS_TESTS_PASS");
