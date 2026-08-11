/*
 * Static weekly schedule authority primitives.  This module deliberately has
 * no Node, database, or web-framework imports so a compiled schedule can be
 * replayed byte-for-byte in a browser, a worker, or a database test fixture.
 */

// v2 is append-only at the compiler/receipt layer. Existing v1 publications
// remain readable by their original validator; no caller may reinterpret them
// as monotonic-leximax v3 proof.
export const STATIC_WEEKLY_SCHEDULE_CONTRACT = "memphis-zoo.static-weekly-schedule.v4-monotonic-leximax";
export const MEMPHIS_TIME_ZONE = "America/Chicago";

export const AVAILABILITY_STATES = new Set([
  "working",
  "departed_named_absent",
  "absent",
  "unavailable",
]);

export const EXCEPTION_TYPES = new Set([
  "pto",
  "daily_absence",
  "partial_absence",
  "shift_override",
  "cover_all",
  "lunch",
  "nine_forty_five_rebalance",
  "event_impact",
  "manager_correction",
  "reverse",
]);

function assert(condition, message, code = "invalid_input") {
  if (!condition) {
    const error = new Error(message);
    error.code = code;
    throw error;
  }
}

export function isIsoServiceDate(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  const days = [31, (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= days[month - 1];
}

export function assertServiceDate(value, label = "service date") {
  assert(isIsoServiceDate(value), `${label} must be an ISO local date.`, "invalid_service_date");
  return String(value);
}

export function serviceDateWeekday(value) {
  const date = assertServiceDate(value);
  const [year, month, day] = date.split("-").map(Number);
  // Sakamoto's Gregorian weekday algorithm; Sunday is 0, Monday is 1.
  const offsets = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
  const adjustedYear = month < 3 ? year - 1 : year;
  return (adjustedYear + Math.floor(adjustedYear / 4) - Math.floor(adjustedYear / 100) + Math.floor(adjustedYear / 400) + offsets[month - 1] + day) % 7;
}

export function timeToMinutes(value, label = "time") {
  const match = String(value || "").match(/^(\d{2}):(\d{2})$/);
  assert(match, `${label} must be HH:MM local time.`, "invalid_time");
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  assert(hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59, `${label} is outside a local day.`, "invalid_time");
  return (hours * 60) + minutes;
}

export function normalizeWindow(window, label = "window") {
  assert(window && typeof window === "object", `${label} is required.`, "invalid_window");
  const start = String(window.start || "");
  const end = String(window.end || "");
  const startMinute = timeToMinutes(start, `${label} start`);
  const endMinute = timeToMinutes(end, `${label} end`);
  assert(startMinute < endMinute, `${label} may not be zero length or span midnight.`, "invalid_window");
  return { start, end, startMinute, endMinute };
}

export function windowsOverlap(left, right) {
  const a = normalizeWindow(left, "left window");
  const b = normalizeWindow(right, "right window");
  return a.startMinute < b.endMinute && b.startMinute < a.endMinute;
}

export function windowContains(container, contained) {
  const outer = normalizeWindow(container, "shift window");
  const inner = normalizeWindow(contained, "work window");
  return outer.startMinute <= inner.startMinute && outer.endMinute >= inner.endMinute;
}

export function stableCompare(left, right) {
  const ordered = String(left).localeCompare(String(right), "en", { numeric: true, sensitivity: "variant" });
  return ordered || bytewiseCompare(left, right);
}

// Locale-aware ordering is readable in diagnostics but it is not a total
// identity order: numeric collation can consider distinct spellings equal.
// Scheduler identities therefore use this UTF-8 byte order as their final
// tie-breaker.  TextEncoder is available in every supported compiler runtime.
export function bytewiseCompare(left, right) {
  const a = new TextEncoder().encode(String(left));
  const b = new TextEncoder().encode(String(right));
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  }
  return a.length - b.length;
}

export function canonicalJson(value) {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    assert(Number.isFinite(value), "Canonical JSON cannot contain non-finite numbers.", "invalid_canonical_value");
    return Object.is(value, -0) ? "0" : JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  assert(typeof value === "object", "Canonical JSON only accepts JSON values.", "invalid_canonical_value");
  const keys = Object.keys(value).sort(stableCompare);
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

// A small synchronous SHA-256 implementation keeps compiler replay pure. It
// is intentionally exported so fixtures can independently recompute digests
// without depending on Node's crypto implementation.
export function sha256Hex(text) {
  const bytes = new TextEncoder().encode(String(text));
  const bitLength = bytes.length * 8;
  const paddedLength = (((bytes.length + 9 + 63) >> 6) << 6);
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000), false);
  view.setUint32(paddedLength - 4, bitLength >>> 0, false);
  const constants = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const state = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const words = new Uint32Array(64);
  const rotateRight = (value, amount) => (value >>> amount) | (value << (32 - amount));
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) words[index] = view.getUint32(offset + (index * 4), false);
    for (let index = 16; index < 64; index += 1) {
      const a = words[index - 15];
      const b = words[index - 2];
      words[index] = (((rotateRight(a, 7) ^ rotateRight(a, 18) ^ (a >>> 3)) + words[index - 16] + (rotateRight(b, 17) ^ rotateRight(b, 19) ^ (b >>> 10)) + words[index - 7]) >>> 0);
    }
    let [a, b, c, d, e, f, g, h] = state;
    for (let index = 0; index < 64; index += 1) {
      const sigma1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choose = (e & f) ^ (~e & g);
      const next1 = (h + sigma1 + choose + constants[index] + words[index]) >>> 0;
      const sigma0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const next2 = (sigma0 + majority) >>> 0;
      h = g; g = f; f = e; e = (d + next1) >>> 0; d = c; c = b; b = a; a = (next1 + next2) >>> 0;
    }
    state[0] = (state[0] + a) >>> 0; state[1] = (state[1] + b) >>> 0;
    state[2] = (state[2] + c) >>> 0; state[3] = (state[3] + d) >>> 0;
    state[4] = (state[4] + e) >>> 0; state[5] = (state[5] + f) >>> 0;
    state[6] = (state[6] + g) >>> 0; state[7] = (state[7] + h) >>> 0;
  }
  return state.map((part) => part.toString(16).padStart(8, "0")).join("");
}

export function contentDigest(value) {
  return sha256Hex(canonicalJson(value));
}

export function validateEffectiveRanges(versions = []) {
  const published = versions
    .filter((version) => version?.status === "published")
    .map((version) => ({ ...version, effectiveStart: assertServiceDate(version.effectiveStart, "effective start"), effectiveEnd: version.effectiveEnd == null ? null : assertServiceDate(version.effectiveEnd, "effective end") }))
    .sort((left, right) => stableCompare(left.effectiveStart, right.effectiveStart) || stableCompare(left.id, right.id));
  for (let index = 0; index < published.length; index += 1) {
    const current = published[index];
    assert(!current.effectiveEnd || current.effectiveStart < current.effectiveEnd, `Version ${current.id} has an invalid effective range.`, "invalid_effective_range");
    const next = published[index + 1];
    if (next) assert(current.effectiveEnd != null && current.effectiveEnd <= next.effectiveStart, `Published versions ${current.id} and ${next.id} have overlapping authority.`, "overlapping_effective_ranges");
  }
  return published;
}

export function selectEffectiveWeeklyVersion(versions, serviceDate) {
  const date = assertServiceDate(serviceDate);
  const effective = validateEffectiveRanges(versions).filter((version) => version.effectiveStart <= date && (!version.effectiveEnd || date < version.effectiveEnd));
  assert(effective.length === 1, effective.length ? "More than one weekly version is effective." : `No published weekly version is effective for ${date}.`, effective.length ? "overlapping_effective_ranges" : "no_effective_weekly_version");
  return effective[0];
}

export function snapshotIncumbency(slot, serviceDate) {
  const date = assertServiceDate(serviceDate);
  const matches = (slot?.incumbencies || []).filter((incumbency) => {
    const start = assertServiceDate(incumbency.effectiveStart, "incumbency effective start");
    const end = incumbency.effectiveEnd == null ? null : assertServiceDate(incumbency.effectiveEnd, "incumbency effective end");
    return start <= date && (!end || date < end);
  });
  assert(matches.length === 1, `Slot ${slot?.id || "unknown"} has ${matches.length} incumbencies for ${date}.`, "invalid_incumbency_history");
  const incumbent = matches[0];
  assert(String(incumbent.personId || "").trim() && String(incumbent.displayName || "").trim(), `Slot ${slot.id} lacks an immutable person/name snapshot.`, "missing_incumbency_snapshot");
  return { slotId: String(slot.id), slotLabel: String(slot.label || slot.id), personId: String(incumbent.personId), displayName: String(incumbent.displayName) };
}

function exactPayloadObject(value, required, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an exact object.`, "invalid_exception_payload");
  const keys = Object.keys(value).sort(stableCompare);
  assert(keys.length === required.length && keys.every((key, index) => key === required.slice().sort(stableCompare)[index]), `${label} contains unknown, missing, or noncanonical fields.`, "invalid_exception_payload");
}

function nonblankPayloadText(value, label) {
  assert(String(value || "").trim(), `${label} is required.`, "invalid_exception_payload");
}

function payloadWindow(value, label) {
  exactPayloadObject(value, ["start", "end"], label);
  return normalizeWindow(value, label);
}

function exactStringArray(value, label) {
  assert(Array.isArray(value) && value.every((item) => String(item || "").trim()), `${label} must contain nonblank string identities.`, "invalid_exception_payload");
  assert(new Set(value).size === value.length, `${label} may not contain duplicate identities.`, "invalid_exception_payload");
}

// This is the portable half of the exception boundary.  It deliberately
// validates the same normalized JSON shapes accepted by I2 SQL; model callers
// cannot create a compiler authority that SQL would reject.  SQL adds the
// publication/version/dated-work target checks that only relational authority
// can establish.
export function assertStaticWeeklyExceptionPayload(exception) {
  const payload = exception?.payload;
  const type = exception?.type;
  const window = exception?.window ?? null;
  if (["pto", "daily_absence"].includes(type)) {
    exactPayloadObject(payload, ["slotId"], `${type} payload`); nonblankPayloadText(payload.slotId, `${type} slotId`); assert(window == null, `${type} may not carry a partial window.`, "invalid_exception_payload");
  } else if (type === "partial_absence" || type === "lunch") {
    exactPayloadObject(payload, ["slotId"], `${type} payload`); nonblankPayloadText(payload.slotId, `${type} slotId`); normalizeWindow(window, `${type} window`);
  } else if (type === "shift_override") {
    exactPayloadObject(payload, ["shift", "slotId", "status"], "shift override payload"); nonblankPayloadText(payload.slotId, "shift override slotId"); assert(AVAILABILITY_STATES.has(payload.status) && payload.status !== "departed_named_absent", "shift override status is invalid.", "invalid_exception_payload"); payloadWindow(payload.shift, "shift override shift"); assert(window == null, "shift override may not carry a second window.", "invalid_exception_payload");
  } else if (type === "cover_all") {
    exactPayloadObject(payload, ["availability"], "coverall payload");
    exactPayloadObject(payload.availability, ["acceptedRouteAnchorLocationId", "acceptedRouteProvenance", "maxServiceEffortMinutes", "maxServiceEffortProvenance", "productiveCapacityProvenance", "qualificationProvenance", "qualifications", "restrictionProvenance", "restrictions", "shift", "slotId"], "coverall availability");
    nonblankPayloadText(payload.availability.slotId, "coverall slotId"); payloadWindow(payload.availability.shift, "coverall shift"); exactStringArray(payload.availability.qualifications, "coverall qualifications"); exactStringArray(payload.availability.restrictions, "coverall restrictions"); assert(window == null, "coverall may not carry a second window.", "invalid_exception_payload");
  } else if (["nine_forty_five_rebalance", "manager_correction"].includes(type)) {
    exactPayloadObject(payload, ["locks"], `${type} payload`); assert(Array.isArray(payload.locks) && payload.locks.length > 0, `${type} requires locks.`, "invalid_exception_payload");
    const workIds = new Set();
    for (const lock of payload.locks) { exactPayloadObject(lock, ["slotId", "workId"], "manager correction lock"); nonblankPayloadText(lock.workId, "manager correction workId"); nonblankPayloadText(lock.slotId, "manager correction slotId"); assert(!workIds.has(lock.workId), "manager correction lock target is duplicated.", "invalid_exception_payload"); workIds.add(lock.workId); }
    assert(window == null, `${type} may not carry a window.`, "invalid_exception_payload");
  } else if (type === "event_impact") {
    exactPayloadObject(payload, ["addWork", "patchWork", "removeWorkIds"], "event impact payload");
    exactStringArray(payload.removeWorkIds, "event removal targets"); assert(Array.isArray(payload.patchWork) && Array.isArray(payload.addWork) && payload.removeWorkIds.length + payload.patchWork.length + payload.addWork.length > 0, "event impact must have a target.", "invalid_exception_payload");
    const patchIds = new Set(); const addIds = new Set();
    const workKeys = ["locationCodeSnapshot", "locationId", "locationNameSnapshot", "priority", "priorityProvenance", "qualificationProvenance", "requiredQualifications", "restrictionProvenance", "restrictions", "serviceEffortMinutes", "serviceEffortProvenance", "window", "workId"];
    for (const patch of payload.patchWork) { exactPayloadObject(patch, workKeys, "event patch work"); nonblankPayloadText(patch.workId, "event patch workId"); assert(!patchIds.has(patch.workId) && !payload.removeWorkIds.includes(patch.workId), "event patch target is duplicated or removed.", "invalid_exception_payload"); patchIds.add(patch.workId); payloadWindow(patch.window, "event patch window"); exactStringArray(patch.requiredQualifications, "event patch qualifications"); exactStringArray(patch.restrictions, "event patch restrictions"); }
    const addKeys = [...workKeys, "dayOfWeek", "originSlotId"];
    for (const add of payload.addWork) { exactPayloadObject(add, addKeys, "event added work"); nonblankPayloadText(add.workId, "event added workId"); nonblankPayloadText(add.originSlotId, "event add originSlotId"); assert(Number.isInteger(add.dayOfWeek) && add.dayOfWeek >= 0 && add.dayOfWeek <= 6, "event add weekday is invalid.", "invalid_exception_payload"); assert(!addIds.has(add.workId) && !patchIds.has(add.workId) && !payload.removeWorkIds.includes(add.workId), "event add target is duplicated or overlaps another event command.", "invalid_exception_payload"); addIds.add(add.workId); payloadWindow(add.window, "event add window"); exactStringArray(add.requiredQualifications, "event add qualifications"); exactStringArray(add.restrictions, "event add restrictions"); }
    assert(window == null, "event impact may not carry a window.", "invalid_exception_payload");
  } else if (type === "reverse") {
    exactPayloadObject(payload, ["reversesExceptionId"], "reverse payload"); nonblankPayloadText(payload.reversesExceptionId, "reverse target"); assert(String(exception.reversesExceptionId || payload.reversesExceptionId) === payload.reversesExceptionId, "reverse target is incoherent.", "invalid_exception_payload"); assert(window == null, "reverse may not carry a window.", "invalid_exception_payload");
  }
  return exception;
}

export function assertExceptionCommand(exception) {
  assert(exception && typeof exception === "object", "Exception command is required.", "invalid_exception");
  assert(EXCEPTION_TYPES.has(exception.type), `Unsupported exception type ${exception.type || ""}.`, "invalid_exception_type");
  assertServiceDate(exception.serviceDate, "exception service date");
  assert(String(exception.id || "").trim(), "Exception ID is required.", "invalid_exception");
  assert(String(exception.actorId || "").trim(), "Exception actor identity is required.", "invalid_exception");
  assert(String(exception.reason || "").trim(), "Exception reason is required.", "invalid_exception");
  assert(String(exception.idempotencyKey || "").trim(), "Exception idempotency key is required.", "invalid_exception");
  assert(Number.isInteger(exception.expectedRevision) && exception.expectedRevision >= 0, "Exception expected revision is required.", "invalid_exception");
  assertStaticWeeklyExceptionPayload(exception);
  return exception;
}
