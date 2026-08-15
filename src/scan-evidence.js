const EVENT_TYPES = new Set([
  "scan_received",
  "scan_blocked",
  "scan_start",
  "scan_finish",
  "scan_resume_pending",
  "scan_invalid_location",
  "scan_unauthorized_device",
  "scan_error",
]);
const ENTRY_SOURCES = new Set(["native-nfc", "manual-qr-fallback"]);
const EVENT_KEYS = new Set(["client_event_id", "event_type", "result", "notes", "scanned_at", "payload_json"]);

function fail(message) {
  throw Object.assign(new Error(message), { status: 422, code: "22023" });
}

function boundedNullableText(value, limit, field) {
  if (value == null) return null;
  if (typeof value !== "string" || value.length > limit) fail(`${field} must be null or bounded text.`);
  return value;
}

export function normalizeCanonicalScanEvidence(value) {
  if (!Array.isArray(value) || value.length > 100) fail("p_scan_evidence must be a bounded JSON array.");
  return value.map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("Each scan event must be a JSON object.");
    const keys = Object.keys(raw);
    if (keys.length !== EVENT_KEYS.size || keys.some((key) => !EVENT_KEYS.has(key))) {
      fail("Each scan event must use the exact canonical evidence shape.");
    }
    const eventType = String(raw.event_type || "").trim();
    const clientEventId = String(raw.client_event_id || "").trim();
    const scannedAt = String(raw.scanned_at || "").trim();
    if (!EVENT_TYPES.has(eventType) || !clientEventId || clientEventId.length > 200 || !scannedAt) {
      fail("Scan event identity, type, or timestamp is invalid.");
    }
    if (!raw.payload_json || typeof raw.payload_json !== "object" || Array.isArray(raw.payload_json)) {
      fail("Scan event payload_json must be a canonical JSON object.");
    }
    const payloadKeys = Object.keys(raw.payload_json);
    const entrySource = String(raw.payload_json.entry_source || "").trim().toLowerCase();
    if (payloadKeys.length !== 1 || payloadKeys[0] !== "entry_source" || !ENTRY_SOURCES.has(entrySource)) {
      fail("Scan provenance must be exactly native-nfc or manual-qr-fallback.");
    }
    return {
      client_event_id: clientEventId,
      event_type: eventType,
      result: boundedNullableText(raw.result, 200, "result"),
      notes: boundedNullableText(raw.notes, 4000, "notes"),
      scanned_at: scannedAt,
      payload_json: { entry_source: entrySource },
    };
  });
}
