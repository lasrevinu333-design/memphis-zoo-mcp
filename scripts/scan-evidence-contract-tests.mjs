import assert from "node:assert/strict";
import { normalizeCanonicalScanEvidence } from "../src/scan-evidence.js";

const canonical = {
  client_event_id: "scan-event-1",
  event_type: "scan_start",
  result: "ok",
  notes: null,
  scanned_at: "2026-08-12T12:00:00.000Z",
  payload_json: { entry_source: "native-nfc" },
};

assert.deepEqual(normalizeCanonicalScanEvidence([canonical]), [canonical]);
assert.equal(normalizeCanonicalScanEvidence([{ ...canonical, payload_json: { entry_source: "MANUAL-QR-FALLBACK" } }])[0].payload_json.entry_source, "manual-qr-fallback");
assert.throws(() => normalizeCanonicalScanEvidence([{ ...canonical, attacker_claim: true }]), /exact canonical evidence shape/i);
assert.throws(() => normalizeCanonicalScanEvidence([{ ...canonical, payload_json: { entry_source: "legacy-or-unknown" } }]), /provenance/i);
assert.throws(() => normalizeCanonicalScanEvidence([{ ...canonical, payload_json: { entry_source: "native-nfc", injected: true } }]), /provenance/i);
assert.throws(() => normalizeCanonicalScanEvidence([{ ...canonical, event_type: "forged_event" }]), /identity, type, or timestamp/i);

console.log("SCAN_EVIDENCE_CONTRACT_PASS");
