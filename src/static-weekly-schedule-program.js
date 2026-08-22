/*
 * Pure, deterministic scheduling-program authority.
 *
 * This module deliberately owns canonical admission, normalization, candidate
 * construction, routes, variables, hard rows, leximax tiers, mutability and
 * ordered bindings.  It has no solver, compiler, verifier, receipt or worker
 * dependency; those callers consume this program rather than supplying it.
 */
import {
  MEMPHIS_TIME_ZONE,
  STATIC_WEEKLY_SCHEDULE_CONTRACT,
  assertExceptionCommand,
  assertServiceDate,
  bytewiseCompare,
  canonicalJson,
  contentDigest,
  normalizeWindow,
  selectEffectiveWeeklyVersion,
  serviceDateWeekday,
  snapshotIncumbency,
  stableCompare,
  sha256Hex,
  windowContains,
  windowsOverlap,
} from "./static-weekly-schedule-model.js";

export const STATIC_WEEKLY_PROGRAM_SCHEMA = "memphis-zoo.static-weekly-canonical-program.v1";

export function canonicalProgramDescriptor({ inputDigest, modelBasis, objectives }) {
  const basisDigest = sha256Hex(canonicalJson(modelBasis));
  const tiers = objectives.map((objective, index) => ({
    index,
    name: objective.name,
    family: objective.family || null,
    rank: objective.rank ?? null,
    terms: objective.terms,
  }));
  return {
    schema: STATIC_WEEKLY_PROGRAM_SCHEMA,
    inputDigest,
    modelBasisDigest: basisDigest,
    tierDigest: sha256Hex(canonicalJson(tiers)),
    tiers,
  };
}

export function canonicalProgramMatches(received, regenerated) {
  return canonicalJson(received) === canonicalJson(regenerated);
}

// prior spread-based receipt.  It is an immutable compiler identity, rather
// than a label which callers may override.
export const STATIC_WEEKLY_SCHEDULER_VERSION = "static-weekly-highs-mip-v4-monotonic-leximax";
export const STATIC_WEEKLY_SERVER_LIMITS = Object.freeze({
  maxVersions: 64,
  maxSlots: 256,
  maxProximityRows: 32_768,
  maxExceptions: 1_024,
  maxWorkItems: 1_024,
  // Bounds are applied before candidate/arc materialization.  The route
  // network is quadratic in per-slot candidates, so the final LP-byte cap is
  // intentionally not the first protection.
  maxCandidateAssignments: 12_000,
  maxRouteArcCandidates: 50_000,
  maxBinaryVariables: 60_000,
  maxModelBytes: 8 * 1024 * 1024,
  maxConstraintTerms: 1_000_000,
  maxConstraints: 160_000,
  maxStagedSolves: 192,
  maxProjectedWorkingMemoryBytes: 64 * 1024 * 1024,
  maxCompactReceiptBytes: 6 * 1024 * 1024,
  maxInputBytes: 6 * 1024 * 1024,
  // Raw admission is intentionally tighter than any later materialization.
  // These are shape limits, not scheduler-domain limits.
  maxInputDepth: 64,
  maxInputNodes: 100_000,
  maxObjectKeysPerNode: 4_096,
  maxArrayEntriesPerNode: 16_384,
  maxStringBytes: 256 * 1024,
  maxKeyBytes: 8 * 1024,
  maxWorkerOutputBytes: 256 * 1024,
  maxSolveSeconds: 30,
});
const EPSILON = 1e-9;
// Equity is represented as an exact bounded integer rational.  A fixed
// million-scale surrogate can order 1/1438 and 1/1439 as equal; this may not.
// Inputs whose exact common denominator cannot be represented losslessly by
// HiGHS' integer-as-double coefficients fail closed before a model is built.
export const STATIC_WEEKLY_EQUITY_SCALE = "exact-lossless-common-denominator";
export const MAX_SAFE_EXACT_INTEGER = BigInt(Number.MAX_SAFE_INTEGER);
// One compiler request performs a bounded sequence of independently bounded
// solver tiers and then regenerates/verifies the complete witness twice.  Do
// not reuse the 30-second *per-tier* worker limit as the deadline for that
// whole sequence: a valid 29-tier operational schedule can otherwise exhaust
// the parent deadline after every solve has succeeded.  Two minutes remains a
// finite fail-closed request boundary while preserving each worker's stricter
// 30-second ceiling.
export const REQUEST_DEADLINE_MILLISECONDS = 120_000;
// HiGHS terminal reports use bounded scientific formatting.  Keep every
// staged objective below this exact-print envelope so report attestation can
// equal the independently recomputed integer without relying on rounded text.
export const MAX_TERMINAL_EXACT_OBJECTIVE = 1_000_000_000n;
export const STATIC_WEEKLY_ROUTE_CANONICALITY_SCHEMA = "memphis-zoo.static-weekly-route-canonicality.v1";

const array = (value) => Array.isArray(value) ? value : [];
const text = (value) => String(value ?? "").trim();
const clone = (value) => JSON.parse(JSON.stringify(value));
const identityCompare = (left, right) => stableCompare(left, right) || bytewiseCompare(left, right);
const byId = (left, right) => identityCompare(left.id ?? left.workId ?? left.slotId, right.id ?? right.workId ?? right.slotId) || bytewiseCompare(canonicalJson(left), canonicalJson(right));
const finiteInteger = (value) => Number.isInteger(Number(value)) && Number(value) >= 0;
const positiveInteger = (value) => Number.isInteger(Number(value)) && Number(value) > 0;

const SEMANTIC_TEXT_SET_KEYS = new Set([
  "qualifications", "requiredQualifications", "restrictions", "restrictedSlotIds",
  "namedAbsentSlotIds", "establishedRouteLocationIds", "removeWorkIds",
]);
const SEMANTIC_OBJECT_SET_KEYS = new Set(["blockedWindows"]);

function canonicalWeekday(value, label) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 6) {
    throw Object.assign(new Error(`${label} must be a canonical integer in [0,6].`), { code: "invalid_weekday_domain" });
  }
  return value;
}
function semanticTextSet(values) {
  if (!Array.isArray(values)) return values;
  return [...new Set(values.map(text))].sort(identityCompare);
}
function semanticObjectSet(values) {
  if (!Array.isArray(values)) return values;
  const canonical = values.map((value) => normalizeSemanticCollections(value));
  const byCanonical = canonical.map((value) => ({ value, key: canonicalJson(value) }))
    .sort((left, right) => bytewiseCompare(left.key, right.key));
  return byCanonical.filter((entry, index) => index === 0 || entry.key !== byCanonical[index - 1].key).map((entry) => entry.value);
}
function normalizeSemanticCollections(value, key = null) {
  if (Array.isArray(value)) {
    if (SEMANTIC_TEXT_SET_KEYS.has(key)) return semanticTextSet(value);
    if (SEMANTIC_OBJECT_SET_KEYS.has(key)) return semanticObjectSet(value);
    return value.map((entry) => normalizeSemanticCollections(entry));
  }
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([field, entry]) => [field, normalizeSemanticCollections(entry, field)]));
}
function planWorkId(dayOfWeek, workId) { return `${dayOfWeek}:${text(workId)}`; }
function planWorkCompare(left, right) {
  return left.dayOfWeek - right.dayOfWeek
    || identityCompare(left.workId, right.workId)
    || bytewiseCompare(canonicalJson(left), canonicalJson(right));
}
function normalizeAssignment(raw) {
  const assignment = normalizeSemanticCollections(clone(raw));
  assignment.dayOfWeek = canonicalWeekday(assignment.dayOfWeek, "assignment dayOfWeek");
  assignment.workId = text(assignment.workId || assignment.id);
  if (Object.hasOwn(assignment, "id")) assignment.id = text(assignment.id);
  for (const field of ["originSlotId", "ownerSlotId", "baselineSlotId"]) if (Object.hasOwn(assignment, field)) assignment[field] = text(assignment[field]);
  return assignment;
}
function normalizeAvailability(raw) {
  const availability = normalizeSemanticCollections(clone(raw));
  availability.dayOfWeek = canonicalWeekday(availability.dayOfWeek, "slot availability dayOfWeek");
  availability.slotId = text(availability.slotId);
  return availability;
}
function normalizeSlot(raw) {
  const slot = normalizeSemanticCollections(clone(raw));
  slot.id = text(slot.id); slot.label = text(slot.label || slot.id);
  if (Array.isArray(slot.incumbencies)) slot.incumbencies = slot.incumbencies.map((incumbency) => ({ ...incumbency, personId: text(incumbency.personId), displayName: text(incumbency.displayName) }))
    .sort((left, right) => identityCompare(left.effectiveStart, right.effectiveStart) || identityCompare(left.personId, right.personId) || bytewiseCompare(canonicalJson(left), canonicalJson(right)));
  return slot;
}
function exceptionOrderIdentity(exception) {
  return [
    text(exception.baseVersionId || exception.base_version_id), text(exception.publicationId || exception.publication_id),
    text(exception.serviceDate), text(exception.acceptedAt || exception.occurredAt || ""), Number(exception.sequence || 0),
  ];
}
function exceptionOrderCompare(left, right) {
  const a = exceptionOrderIdentity(left); const b = exceptionOrderIdentity(right);
  for (let index = 0; index < a.length; index += 1) {
    const compare = typeof a[index] === "number" ? a[index] - b[index] : identityCompare(a[index], b[index]);
    if (compare) return compare;
  }
  return identityCompare(left.id, right.id) || bytewiseCompare(canonicalJson(left), canonicalJson(right));
}
function normalizeException(raw) {
  const exception = normalizeSemanticCollections(clone(raw));
  exception.id = text(exception.id); exception.idempotencyKey = text(exception.idempotencyKey);
  if (Object.hasOwn(exception, "baseVersionId")) exception.baseVersionId = text(exception.baseVersionId);
  if (Object.hasOwn(exception, "base_version_id")) exception.base_version_id = text(exception.base_version_id);
  if (Object.hasOwn(exception, "publicationId")) exception.publicationId = text(exception.publicationId);
  if (Object.hasOwn(exception, "publication_id")) exception.publication_id = text(exception.publication_id);
  if (Object.hasOwn(exception, "reversesExceptionId")) exception.reversesExceptionId = text(exception.reversesExceptionId);
  if (exception.payload && typeof exception.payload === "object" && Object.hasOwn(exception.payload, "reversesExceptionId")) exception.payload.reversesExceptionId = text(exception.payload.reversesExceptionId);
  if (exception.sequence != null) {
    if (typeof exception.sequence !== "number" || !Number.isSafeInteger(exception.sequence) || exception.sequence < 0) throw Object.assign(new Error("Exception sequence must be a non-negative canonical integer."), { code: "invalid_exception_order" });
  }
  return exception;
}
function acceptedException(exception) { return exception && [undefined, "accepted", "applied", "published"].includes(exception.status); }
function lockEntries(exception) {
  const payload = exception.payload || {};
  return array(payload.locks || payload.assignments || (payload.workId ? [payload] : [])).map((lock) => ({ workId: text(lock.workId || lock.id), slotId: text(lock.slotId || lock.ownerSlotId) }));
}
function validateExceptionCollection(exceptions) {
  const accepted = array(exceptions).filter(acceptedException);
  const ids = new Set(); const idempotency = new Set(); const orderIdentities = new Set(); const byId = new Map();
  for (const exception of accepted) {
    assertExceptionCommand(exception);
    if (ids.has(exception.id)) throw Object.assign(new Error("Duplicate normalized exception ID."), { code: "duplicate_exception_id" });
    if (idempotency.has(exception.idempotencyKey)) throw Object.assign(new Error("Duplicate exception idempotency identity."), { code: "duplicate_exception_idempotency" });
    const orderIdentity = canonicalJson(exceptionOrderIdentity(exception));
    if (orderIdentities.has(orderIdentity)) throw Object.assign(new Error("Ambiguous append-only exception order identity."), { code: "ambiguous_exception_order" });
    ids.add(exception.id); idempotency.add(exception.idempotencyKey); orderIdentities.add(orderIdentity); byId.set(exception.id, exception);
  }
  const reversed = new Set();
  for (const exception of accepted.filter((item) => item.type === "reverse")) {
    const targetId = text(exception.reversesExceptionId || exception.payload?.reversesExceptionId);
    const target = byId.get(targetId);
    if (!target || target.type === "reverse") throw Object.assign(new Error("Exception reversal target does not exist."), { code: "missing_reversal_target" });
    if (reversed.has(targetId)) throw Object.assign(new Error("Exception may be reversed only once."), { code: "duplicate_exception_reversal" });
    if (exception.serviceDate !== target.serviceDate
      || text(exception.baseVersionId || exception.base_version_id) !== text(target.baseVersionId || target.base_version_id)
      || text(exception.publicationId || exception.publication_id) !== text(target.publicationId || target.publication_id)
      || exceptionOrderCompare(exception, target) <= 0) throw Object.assign(new Error("Exception reversal target has incoherent authority or order."), { code: "exception_reversal_authority_mismatch" });
    reversed.add(targetId);
  }
  const locks = new Map();
  for (const exception of accepted.filter((item) => item.type !== "reverse" && !reversed.has(item.id) && ["nine_forty_five_rebalance", "manager_correction"].includes(item.type))) {
    for (const lock of lockEntries(exception)) {
      if (!lock.workId || !lock.slotId) throw Object.assign(new Error("Manager correction lock identity is incomplete."), { code: "invalid_manager_correction_lock" });
      const key = `${exception.serviceDate}\u0000${lock.workId}`;
      if (locks.has(key) && locks.get(key) !== lock.slotId) throw Object.assign(new Error("Conflicting manager corrections may not select owners by append order."), { code: "conflicting_manager_correction_lock" });
      locks.set(key, lock.slotId);
    }
  }
}

// This is the complete optimizer-row contract carried under canonicalAuthority.
// It is deliberately defined beside raw admission and program authority rather
// than in either caller, so the compiler and verifier bind the same canonical
// representation without either trusting a receipt-side digest.
export function canonicalOptimizerAssignmentProjection(weeklyAssignments) {
  return array(weeklyAssignments).map((assignment) => ({
    planWorkId: assignment.planWorkId,
    workId: assignment.workId,
    dayOfWeek: assignment.dayOfWeek,
    serviceDate: assignment.serviceDate,
    status: assignment.status,
    slotId: assignment.slotId,
    personId: assignment.personId,
    displayName: assignment.displayName,
    ownerDigest: assignment.ownerDigest,
    exactOwnerIdentity: assignment.exactOwnerIdentity,
    baselineSlotId: assignment.baselineSlotId,
    baselineOwnerPersonId: assignment.baselineOwnerPersonId,
    baselineOwnerName: assignment.baselineOwnerName,
    originalActorPersonId: assignment.originalActorPersonId,
    originalActorName: assignment.originalActorName,
    optimizedOwnerSlotId: assignment.optimizedOwnerSlotId,
    optimizedOwnerPersonId: assignment.optimizedOwnerPersonId,
    actualActorPersonId: assignment.actualActorPersonId,
    window: { start: assignment.window?.start ?? null, end: assignment.window?.end ?? null },
    serviceEffortMinutes: assignment.serviceEffortMinutes,
  })).sort((left, right) => stableCompare(left.planWorkId, right.planWorkId));
}

// Solver reports retain measured timing and deadline values for diagnostics,
// but those per-execution facts cannot become immutable schedule identity.
// Keep one shared authority projection so the compiler and independent
// verifier agree on the exact reproducible subset without discarding the raw
// receipt carried to the caller.
export function canonicalSolverAuthorityTierProjection(tiers) {
  return array(tiers).map((tier) => {
    const projection = clone(tier);
    if (projection.attestation) {
      delete projection.attestation.terminalReport;
      delete projection.attestation.rawReceiptDigest;
    }
    if (projection.options) delete projection.options.time_limit;
    return projection;
  });
}

export function canonicalSolverAuthorityCertificate(certificate) {
  const projection = certificate && typeof certificate === "object" ? clone(certificate) : {};
  projection.tiers = canonicalSolverAuthorityTierProjection(projection.tiers);
  for (const options of array(projection.options)) delete options.time_limit;
  if (projection.execution) {
    delete projection.execution.durationMilliseconds;
    delete projection.execution.receiptBytes;
    delete projection.execution.workerOutputBytes;
    delete projection.execution.resultBytes;
  }
  return projection;
}

export function monotonicNowMilliseconds() {
  return typeof performance?.now === "function" ? performance.now() : Number(process.hrtime.bigint() / 1_000_000n);
}
export function createStaticWeeklyDeadline(milliseconds = REQUEST_DEADLINE_MILLISECONDS) {
  return monotonicNowMilliseconds() + milliseconds;
}
export function remainingStaticWeeklyMilliseconds(deadline) {
  const remaining = Math.floor(deadline - monotonicNowMilliseconds());
  if (remaining <= 0) throw Object.assign(new Error("Static weekly request deadline expired."), { code: "solver_timeout" });
  return remaining;
}

// This occurs before clone(), sort(), candidate expansion, or route graph
// construction.  It walks the supplied JSON shape once without building a
// whole-input serialization, and rejects cycles, accessors, exotic objects and
// every oversized nested branch before any expensive scheduler work begins.
export function admitStaticWeeklyRawInput(input, deadline = createStaticWeeklyDeadline()) {
  try { remainingStaticWeeklyMilliseconds(deadline); } catch (error) { return programReason(error.code || "solver_timeout"); }
  const seen = new WeakSet();
  let nodes = 0; let estimatedBytes = 0;
  const addBytes = (bytes) => {
    estimatedBytes += bytes;
    if (estimatedBytes > STATIC_WEEKLY_SERVER_LIMITS.maxInputBytes) throw Object.assign(new Error("input_estimated_byte_limit"), { code: "input_estimated_byte_limit" });
  };
  const stringBytes = (value, kind) => {
    const rawBytes = Buffer.byteLength(value, "utf8");
    const limit = kind === "key" ? STATIC_WEEKLY_SERVER_LIMITS.maxKeyBytes : STATIC_WEEKLY_SERVER_LIMITS.maxStringBytes;
    if (rawBytes > limit) throw Object.assign(new Error(kind === "key" ? "input_key_byte_limit" : "input_string_byte_limit"), { code: kind === "key" ? "input_key_byte_limit" : "input_string_byte_limit" });
    // This is one scalar's JSON encoding, never a second full serialization.
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  };
  const walk = (value, depth) => {
    if ((nodes++ & 255) === 0) remainingStaticWeeklyMilliseconds(deadline);
    if (depth > STATIC_WEEKLY_SERVER_LIMITS.maxInputDepth) throw Object.assign(new Error("input_depth_limit"), { code: "input_depth_limit" });
    if (nodes > STATIC_WEEKLY_SERVER_LIMITS.maxInputNodes) throw Object.assign(new Error("input_node_limit"), { code: "input_node_limit" });
    if (value === null) { addBytes(4); return; }
    if (typeof value === "string") { addBytes(stringBytes(value, "string")); return; }
    if (typeof value === "boolean") { addBytes(value ? 4 : 5); return; }
    if (typeof value === "number") { if (!Number.isFinite(value)) throw Object.assign(new Error("unsupported_input_value"), { code: "unsupported_input_value" }); addBytes(Buffer.byteLength(JSON.stringify(value), "utf8")); return; }
    if (typeof value !== "object") throw Object.assign(new Error("unsupported_input_value"), { code: "unsupported_input_value" });
    if (seen.has(value)) throw Object.assign(new Error("input_cycle"), { code: "input_cycle" });
    seen.add(value);
    if (Array.isArray(value)) {
      if (value.length > STATIC_WEEKLY_SERVER_LIMITS.maxArrayEntriesPerNode) throw Object.assign(new Error("input_array_entry_limit"), { code: "input_array_entry_limit" });
      addBytes(2);
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, index);
        if (!descriptor) throw Object.assign(new Error("unsupported_input_array_hole"), { code: "unsupported_input_array_hole" });
        if (Object.hasOwn(descriptor, "get") || Object.hasOwn(descriptor, "set")) throw Object.assign(new Error("unsupported_input_accessor"), { code: "unsupported_input_accessor" });
        walk(descriptor.value, depth + 1);
        if (index) addBytes(1);
      }
      return;
    }
    if (Object.getPrototypeOf(value) !== Object.prototype) throw Object.assign(new Error("non_plain_input_structure"), { code: "non_plain_input_structure" });
    let keys = 0; addBytes(2);
    for (const key in value) {
      if (!Object.hasOwn(value, key)) continue;
      if (++keys > STATIC_WEEKLY_SERVER_LIMITS.maxObjectKeysPerNode) throw Object.assign(new Error("input_object_key_limit"), { code: "input_object_key_limit" });
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || Object.hasOwn(descriptor, "get") || Object.hasOwn(descriptor, "set")) throw Object.assign(new Error("unsupported_input_accessor"), { code: "unsupported_input_accessor" });
      if (keys > 1) addBytes(1);
      addBytes(stringBytes(key, "key") + 1);
      walk(descriptor.value, depth + 1);
    }
  };
  try { walk(input, 0); } catch (error) { return programReason(error.code || "invalid_input_encoding", { nodes, estimatedBytes }); }
  const versions = array(input?.versions); const slots = array(input?.slots); const proximity = array(input?.proximity); const exceptions = array(input?.exceptions);
  if (versions.length > STATIC_WEEKLY_SERVER_LIMITS.maxVersions || slots.length > STATIC_WEEKLY_SERVER_LIMITS.maxSlots || proximity.length > STATIC_WEEKLY_SERVER_LIMITS.maxProximityRows || exceptions.length > STATIC_WEEKLY_SERVER_LIMITS.maxExceptions) return programReason("input_count_limit");
  let availabilityCount = 0; let assignmentCount = 0; let acceptedStops = 0;
  for (const version of versions) {
    availabilityCount += array(version?.slotAvailability).length;
    assignmentCount += array(version?.assignments).length;
    for (const entry of array(version?.slotAvailability)) acceptedStops += array(entry?.acceptedRoute?.stops ?? entry?.acceptedRouteStops).length;
    for (const route of Object.values(version?.acceptedRoutesBySlot || {})) acceptedStops += array(route?.stops ?? route?.existingStops).length;
    if (availabilityCount > STATIC_WEEKLY_SERVER_LIMITS.maxSlots * 7 || assignmentCount > STATIC_WEEKLY_SERVER_LIMITS.maxWorkItems || acceptedStops > STATIC_WEEKLY_SERVER_LIMITS.maxWorkItems * 8) return programReason("nested_input_count_limit", { availabilityCount, assignmentCount, acceptedStops });
    try { remainingStaticWeeklyMilliseconds(deadline); } catch (error) { return programReason(error.code || "solver_timeout"); }
  }
  return { bytes: estimatedBytes, availabilityCount, assignmentCount, acceptedStops, nodes };
}

function postgresJsonbNumberText(value) {
  if (!Number.isFinite(value)) throw new TypeError("postgres_jsonb_number_must_be_finite");
  const source = String(value);
  if (!/[eE]/.test(source)) return source;
  const [coefficient, exponentText] = source.toLowerCase().split("e");
  const exponent = Number(exponentText);
  const negative = coefficient.startsWith("-");
  const unsigned = negative ? coefficient.slice(1) : coefficient;
  const [whole, fractional = ""] = unsigned.split(".");
  const digits = `${whole}${fractional}`.replace(/^0+(?=\d)/, "") || "0";
  const decimalPosition = whole.length + exponent;
  let output;
  if (decimalPosition <= 0) output = `0.${"0".repeat(-decimalPosition)}${digits}`;
  else if (decimalPosition >= digits.length) output = `${digits}${"0".repeat(decimalPosition - digits.length)}`;
  else output = `${digits.slice(0, decimalPosition)}.${digits.slice(decimalPosition)}`;
  return negative && output !== "0" ? `-${output}` : output;
}

export function postgresJsonbCanonicalText(value) {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return postgresJsonbNumberText(value);
  if (Array.isArray(value)) return `[${value.map(postgresJsonbCanonicalText).join(", ")}]`;
  // jsonb orders object keys by UTF-8 byte length, then bytewise memcmp.  A
  // locale/numeric comparator can disagree for keys such as `tier_10` and
  // `tier_2`, which would make a JavaScript digest bind a different document
  // than PostgreSQL's exact JSONB boundary.
  const utf8Length = (entry) => new TextEncoder().encode(entry).length;
  const keys = Object.keys(value || {}).sort((left, right) => utf8Length(left) - utf8Length(right) || bytewiseCompare(left, right));
  return `{${keys.map((key) => `${JSON.stringify(key)}: ${postgresJsonbCanonicalText(value[key])}`).join(", ")}}`;
}

// PostgreSQL jsonb::text uses the same deterministic object ordering and
// separators for this bounded JSON contract.  The database recomputes this
// value with static_weekly_digest_jsonb; it is deliberately separate from the
// portable replay digest (which remains canonicalJson based).
export function postgresJsonbContentDigest(value) { return sha256Hex(postgresJsonbCanonicalText(value)); }

function greatestCommonDivisor(left, right) {
  let a = BigInt(left); let b = BigInt(right);
  while (b) [a, b] = [b, a % b];
  return a;
}
function losslessEquityScale(denominators, maximumEffort) {
  let scale = 1n;
  for (const value of [...new Set(denominators.map(Number))].sort((a, b) => a - b)) {
    if (!positiveInteger(value)) return null;
    scale = (scale / greatestCommonDivisor(scale, BigInt(value))) * BigInt(value);
    if (scale > MAX_SAFE_EXACT_INTEGER) return null;
  }
  // Every coefficient and the largest possible resource total must remain an
  // exactly representable integer in the solver's IEEE-754 numeric domain.
  if (scale * BigInt(Math.max(1, Number(maximumEffort) || 0)) > MAX_SAFE_EXACT_INTEGER) return null;
  return Number(scale);
}
export function exactRatioCoefficient(numerator, denominator, scale) {
  const value = BigInt(numerator) * (BigInt(scale) / BigInt(denominator));
  return value <= MAX_SAFE_EXACT_INTEGER ? Number(value) : null;
}
// A grouped base-B objective with W digits has a complete maximum of
// B^W - 1, not merely (B - 1) * B^(W - 1).  The latter was the previous
// (unsound) highest-term-only check.  Keep the proof in BigInt so both the
// terminal-report envelope and the Number exactness boundary are explicit.
export function staticWeeklyGroupedObjectiveBounds(baseValue, widthValue) {
  const base = BigInt(baseValue); const width = Number(widthValue);
  if (base < 2n || !Number.isSafeInteger(width) || width < 1) throw Object.assign(new Error("Invalid grouped objective base or width."), { code: "invalid_grouped_objective_shape" });
  const highestPlace = base ** BigInt(width - 1);
  const completeMaximum = (base ** BigInt(width)) - 1n;
  return {
    base,
    width,
    highestPlace,
    completeMaximum,
    highestPlaceSafe: highestPlace <= MAX_TERMINAL_EXACT_OBJECTIVE && highestPlace <= MAX_SAFE_EXACT_INTEGER,
    completeMaximumSafe: completeMaximum <= MAX_TERMINAL_EXACT_OBJECTIVE && completeMaximum <= MAX_SAFE_EXACT_INTEGER,
  };
}
function groupedObjectiveWidth(base) {
  let width = 1;
  while (width < 16 && staticWeeklyGroupedObjectiveBounds(base, width + 1).completeMaximumSafe) width += 1;
  return width;
}
export function identityTierWidth(slotCount) {
  // A base-(slot-count + 2) representation encodes owner/open digits exactly.
  // Grouping is lexicographically equivalent to serial stable identity tiers.
  return groupedObjectiveWidth(BigInt(slotCount + 2));
}
export function leximaxTierWidth(maximum) {
  return groupedObjectiveWidth(BigInt(Math.max(2, maximum + 1)));
}
function programExactEvaluate(terms, values) {
  try { return terms.reduce((total, [coefficient, name]) => total + (BigInt(coefficient) * BigInt(values.get(name) ?? 0)), 0n); } catch { return null; }
}
function programEvaluate(terms, values) {
  const exact = programExactEvaluate(terms, values);
  return exact != null && exact <= MAX_SAFE_EXACT_INTEGER && exact >= -MAX_SAFE_EXACT_INTEGER ? Number(exact) : Number.NaN;
}
// The compiler and verifier both use this authority-side objective evaluator;
// rank values are derived from selected effort, never trusted from a witness.
export function recomputeStaticWeeklyObjective(objective, model, values, problem) {
  const selectedByDaySlot = new Map();
  for (const [key, variable] of model.x) if (values.get(variable) === 1) {
    const [workKey, slotId] = key.split("\u0000"); const item = problem.work.find((entry) => entry.key === workKey);
    if (item) { const loadKey = `${item.dayOfWeek}\u0000${slotId}`; selectedByDaySlot.set(loadKey, (selectedByDaySlot.get(loadKey) || 0) + item.effort.minutes); }
  }
  const dailyVector = [...problem.availabilityByDaySlot.entries()].map(([key, entry]) => ({ key, dayOfWeek: Number(key.split("\u0000")[0]), slotId: entry.slot.id, value: exactRatioCoefficient((selectedByDaySlot.get(key) || 0) + entry.capacity.baselineServiceMinutes, entry.capacity.productiveMinutes, problem.exactEquityScale) })).sort((left, right) => right.value - left.value || left.dayOfWeek - right.dayOfWeek || stableCompare(left.slotId, right.slotId));
  const weeklyVector = [...new Set(dailyVector.map((entry) => entry.slotId))].map((slotId) => { const contexts = [...problem.availabilityByDaySlot.entries()].filter(([, entry]) => entry.slot.id === slotId); const effort = contexts.reduce((total, [key, entry]) => total + entry.capacity.baselineServiceMinutes + (selectedByDaySlot.get(key) || 0), 0); const capacity = contexts.reduce((total, [, entry]) => total + entry.capacity.productiveMinutes, 0); return { slotId, value: exactRatioCoefficient(effort, capacity, problem.exactEquityScale) }; }).sort((left, right) => right.value - left.value || stableCompare(left.slotId, right.slotId));
  if (objective.family === "daily_leximax") return dailyVector.slice((objective.rank || 1) - 1, (objective.rank || 1) - 1 + (objective.rankCount || 1)).reduce((total, entry, index, values) => total + entry.value * Number(BigInt(objective.rankBase || 1) ** BigInt(values.length - index - 1)), 0);
  if (objective.family === "weekly_leximax") return weeklyVector.slice((objective.rank || 1) - 1, (objective.rank || 1) - 1 + (objective.rankCount || 1)).reduce((total, entry, index, values) => total + entry.value * Number(BigInt(objective.rankBase || 1) ** BigInt(values.length - index - 1)), 0);
  if (objective.family === "daily_stable_tie") return model.dailyRank.fixed ? 0 : dailyVector.reduce((total, entry, rankIndex) => total + ((model.dailyLoads.length - model.dailyLoads.findIndex((source) => source.dayOfWeek === entry.dayOfWeek && source.slotId === entry.slotId)) * (rankIndex + 1)), 0);
  if (objective.family === "weekly_stable_tie") return model.weeklyRank.fixed ? 0 : weeklyVector.reduce((total, entry, rankIndex) => total + ((model.weeklyLoads.length - model.weeklyLoads.findIndex((source) => source.slotId === entry.slotId)) * (rankIndex + 1)), 0);
  return programEvaluate(objective.terms, values);
}

// This gate deliberately counts the complete staged program before a route
// graph, constraint objects, or LP UTF-8 are materialized.  It is conservative
// by design: a REVIEW result is preferable to making the bounded whole-request
// budget depend on an unbounded allocation.
function preflightProblem(problem) {
  const byDaySlot = new Map();
  for (const candidate of problem.candidates) {
    const key = `${candidate.item.dayOfWeek}\u0000${candidate.slot.id}`;
    byDaySlot.set(key, (byDaySlot.get(key) || 0) + 1);
  }
  const routeNodes = [...problem.availabilityByDaySlot.entries()].map(([key, context]) => ({ key, count: 2 + context.capacity.route.stops.length + (byDaySlot.get(key) || 0) }));
  const acceptedStops = routeNodes.reduce((total, item) => total + Math.max(0, item.count - 2 - (byDaySlot.get(item.key) || 0)), 0);
  const routeArcs = routeNodes.reduce((total, item) => total + (item.count * Math.max(0, item.count - 1)), 0);
  const dailyEntries = problem.availabilityByDaySlot.size;
  const weeklyEntries = new Set([...problem.availabilityByDaySlot.values()].map((entry) => entry.slot.id)).size;
  const rankBinaryVariables = (dailyEntries ** 2) + (weeklyEntries ** 2);
  const rankIntegerVariables = dailyEntries + weeklyEntries;
  const routeBinaryVariables = problem.candidates.length + problem.work.length + problem.availabilityByDaySlot.size + routeArcs;
  const binaryVariables = routeBinaryVariables + rankBinaryVariables;
  const constraints = problem.work.length
    // coverage + route-active/start/end + capacity/duty + two in/out rows
    // for every accepted or candidate route node.  This is deliberately an
    // upper bound and must never understate the materialized graph.
    + (problem.availabilityByDaySlot.size * 6) + (2 * acceptedStops)
    + (problem.candidates.length * 2)
    + (2 * dailyEntries * dailyEntries) + (3 * dailyEntries)
    + (2 * weeklyEntries * weeklyEntries) + (3 * weeklyEntries);
  const constraintTerms = 2 * ((problem.work.length * Math.max(2, problem.slots.length + 1))
    + (routeArcs * 4) + (problem.candidates.length * 12)
    + (dailyEntries * dailyEntries * 8) + (weeklyEntries * weeklyEntries * 8));
  // Candidate count never proves a decision is fixed: coverage priority,
  // capacity, chronology and route constraints can leave a sole candidate
  // open.  Budget every assignment/open canonicalization tier.
  const mutableIdentity = problem.work.length <= 16 ? problem.work.length : Math.ceil(problem.work.length / identityTierWidth(problem.slots.length));
  const requiredTiers = new Set(problem.work.filter((item) => item.required).map((item) => item.priority)).size;
  const bestEffortTiers = new Set(problem.work.filter((item) => item.coverageClass === "best_effort").map((item) => item.coverageOrder)).size;
  const projectedDailyRankMaximum = Math.max(0, ...[...problem.availabilityByDaySlot.entries()].map(([daySlot, entry]) => exactRatioCoefficient(entry.capacity.baselineServiceMinutes + problem.candidates.filter((candidate) => `${candidate.item.dayOfWeek}\u0000${candidate.slot.id}` === daySlot).reduce((total, candidate) => total + candidate.item.effort.minutes, 0), entry.capacity.productiveMinutes, problem.exactEquityScale)));
  const projectedWeeklyRankMaximum = Math.max(0, ...[...new Set([...problem.availabilityByDaySlot.values()].map((entry) => entry.slot.id))].map((slotId) => {
    const contexts = [...problem.availabilityByDaySlot.entries()].filter(([, entry]) => entry.slot.id === slotId);
    const effort = contexts.reduce((total, [daySlot, entry]) => total + entry.capacity.baselineServiceMinutes + problem.candidates.filter((candidate) => `${candidate.item.dayOfWeek}\u0000${candidate.slot.id}` === daySlot).reduce((sum, candidate) => sum + candidate.item.effort.minutes, 0), 0);
    return exactRatioCoefficient(effort, contexts.reduce((total, [, entry]) => total + entry.capacity.productiveMinutes, 0), problem.exactEquityScale);
  }));
  const dailyLeximaxTiers = dailyEntries <= 16 ? dailyEntries : Math.ceil(dailyEntries / leximaxTierWidth(projectedDailyRankMaximum));
  const weeklyLeximaxTiers = weeklyEntries <= 16 ? weeklyEntries : Math.ceil(weeklyEntries / leximaxTierWidth(projectedWeeklyRankMaximum));
  const solveCount = requiredTiers + bestEffortTiers + dailyLeximaxTiers + 1 + weeklyLeximaxTiers + 1 + 2 + mutableIdentity;
  // LP row labels and fixed bindings have variable-length canonical IDs.  A
  // twofold structural envelope plus a fixed header allowance is conservative
  // for every materialized tier, including accepted-stop rows and bindings.
  const projectedLpBytes = 4_096 + (2 * Math.ceil((binaryVariables * 32) + (rankIntegerVariables * 28) + (constraints * 58) + (constraintTerms * 13)));
  const projectedWorkingMemoryBytes = projectedLpBytes * 3 + ((binaryVariables + rankIntegerVariables) * 48) + (constraints * 72);
  // Per-tier reports are capped in the worker by the receipt limit even when
  // the solver prints timing details.  The final witness is carried once.
  const projectedReceiptBytes = 8_192 + (solveCount * 32_768) + ((binaryVariables + rankIntegerVariables) * 24);
  const facts = { routeNodes: routeNodes.reduce((total, item) => total + item.count, 0), acceptedStops, routeArcs, binaryVariables, rankBinaryVariables, rankIntegerVariables, constraints, constraintTerms, mutableIdentity, projectedDailyRankMaximum, projectedWeeklyRankMaximum, dailyLeximaxTiers, weeklyLeximaxTiers, solveCount, projectedLpBytes, projectedWorkingMemoryBytes, projectedReceiptBytes };
  if (routeArcs > STATIC_WEEKLY_SERVER_LIMITS.maxRouteArcCandidates) return { error: programReason("route_arc_candidate_limit", { ...facts, limit: STATIC_WEEKLY_SERVER_LIMITS.maxRouteArcCandidates }) };
  if (binaryVariables > STATIC_WEEKLY_SERVER_LIMITS.maxBinaryVariables || constraints > STATIC_WEEKLY_SERVER_LIMITS.maxConstraints || constraintTerms > STATIC_WEEKLY_SERVER_LIMITS.maxConstraintTerms) return { error: programReason("model_preflight_limit", { ...facts }) };
  if (solveCount > STATIC_WEEKLY_SERVER_LIMITS.maxStagedSolves || projectedLpBytes > STATIC_WEEKLY_SERVER_LIMITS.maxModelBytes || projectedWorkingMemoryBytes > STATIC_WEEKLY_SERVER_LIMITS.maxProjectedWorkingMemoryBytes || projectedReceiptBytes > STATIC_WEEKLY_SERVER_LIMITS.maxCompactReceiptBytes) return { error: programReason("operational_preflight_limit", { ...facts, limits: STATIC_WEEKLY_SERVER_LIMITS }) };
  return { facts };
}

export function programReason(code, detail = {}) { return { code, ...detail }; }

function semanticProximityCompare(left, right) {
  return identityCompare(text(left.fromLocationId || left.from), text(right.fromLocationId || right.from))
    || identityCompare(text(left.toLocationId || left.to), text(right.toLocationId || right.to))
    || Number(left.minutes ?? left.distance ?? 0) - Number(right.minutes ?? right.distance ?? 0)
    || identityCompare(text(left.provenance || left.source), text(right.provenance || right.source))
    || identityCompare(text(left.id), text(right.id))
    || bytewiseCompare(canonicalJson(left), canonicalJson(right));
}

function normalizeProximity(raw) {
  const entries = array(raw).map((entry) => normalizeSemanticCollections(clone(entry))).map((entry) => ({
    ...entry,
    ...(Object.hasOwn(entry, "fromLocationId") ? { fromLocationId: text(entry.fromLocationId) } : {}),
    ...(Object.hasOwn(entry, "from") ? { from: text(entry.from) } : {}),
    ...(Object.hasOwn(entry, "toLocationId") ? { toLocationId: text(entry.toLocationId) } : {}),
    ...(Object.hasOwn(entry, "to") ? { to: text(entry.to) } : {}),
    ...(Object.hasOwn(entry, "provenance") ? { provenance: text(entry.provenance) } : {}),
    ...(Object.hasOwn(entry, "source") ? { source: text(entry.source) } : {}),
  })).sort(semanticProximityCompare);
  const result = [];
  for (const entry of entries) {
    const previous = result.at(-1);
    if (previous && canonicalJson(previous) === canonicalJson(entry)) continue;
    result.push(entry);
  }
  return result;
}

// This is the one authority normalizer.  It is deliberately before all fixed
// weekday projection, maps, candidate creation, compiler identities, and
// verifier regeneration.  Ordered accepted-route stops remain ordered
// operational authority; membership-style arrays are canonical sets.
export function normalizeStaticWeeklyAuthority(version, slots, exceptions, proximity, serviceDate = null) {
  const normalizedVersion = normalizeSemanticCollections(clone(version));
  normalizedVersion.assignments = array(version.assignments).map(normalizeAssignment).sort(planWorkCompare);
  normalizedVersion.slotAvailability = array(version.slotAvailability).map(normalizeAvailability)
    .sort((left, right) => left.dayOfWeek - right.dayOfWeek || identityCompare(left.slotId, right.slotId) || bytewiseCompare(canonicalJson(left), canonicalJson(right)));
  normalizedVersion.namedAbsentSlotIds = semanticTextSet(array(version.namedAbsentSlotIds));
  const normalizedSlots = array(slots).map(normalizeSlot).sort(byId);
  const normalizedExceptions = array(exceptions).map(normalizeException).sort(exceptionOrderCompare);
  validateExceptionCollection(normalizedExceptions);
  return {
    ...(serviceDate ? { serviceDate } : {}),
    version: normalizedVersion,
    slots: normalizedSlots,
    exceptions: normalizedExceptions,
    proximity: normalizeProximity(proximity),
  };
}

export function canonicalAuthorityInput(version, slots, exceptions, proximity, serviceDate = null) {
  return normalizeStaticWeeklyAuthority(version, slots, exceptions, proximity, serviceDate);
}

export function weekdayDate(serviceDate, targetDay) {
  const current = serviceDateWeekday(serviceDate);
  const offset = (targetDay - current + 7) % 7;
  const [year, month, day] = serviceDate.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day + offset));
  return `${utc.getUTCFullYear()}-${String(utc.getUTCMonth() + 1).padStart(2, "0")}-${String(utc.getUTCDate()).padStart(2, "0")}`;
}

function unionMinutes(windows, shift) {
  const normalized = windows.map((window) => normalizeWindow(window, "unavailable window"))
    .map((window) => ({ start: Math.max(window.startMinute, shift.startMinute), end: Math.min(window.endMinute, shift.endMinute) }))
    .filter((window) => window.start < window.end)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  let total = 0;
  let start = null; let end = null;
  for (const window of normalized) {
    if (start == null) { start = window.start; end = window.end; continue; }
    if (window.start > end) { total += end - start; start = window.start; end = window.end; } else end = Math.max(end, window.end);
  }
  return total + (start == null ? 0 : end - start);
}

// A route's duty is charged on its one chronological path.  Time inside a
// protected lunch/unavailable interval is neither productive capacity nor
// committed waiting; all other slack between consecutive route nodes is.
function routeArcTiming(from, to, travelMinutes, availability) {
  const elapsedMinutes = to.startMinute - from.endMinute;
  const protectedMinutes = unionMinutes(
    [...array(availability?.blockedWindows), ...(availability?.lunch ? [availability.lunch] : [])],
    { startMinute: from.endMinute, endMinute: to.startMinute },
  );
  return {
    protectedMinutes,
    waitingMinutes: Math.max(0, elapsedMinutes - travelMinutes - protectedMinutes),
  };
}

function productiveCapacity(availability, edges) {
  try {
    const shift = normalizeWindow(availability.shift, "shift");
    if (!text(availability.productiveCapacityProvenance || availability.capacityProvenance)) return { error: "missing_productive_capacity_provenance" };
    const unavailable = [...array(availability.blockedWindows), ...(availability.lunch ? [availability.lunch] : [])];
    const minutes = shift.endMinute - shift.startMinute - unionMinutes(unavailable, shift);
    if (!positiveInteger(minutes)) return { error: "nonpositive_productive_capacity" };
    const maxService = availability.maxServiceEffortMinutes ?? availability.maxLoadPoints;
    if (!positiveInteger(maxService) || !text(availability.maxServiceEffortProvenance || availability.capacityProvenance)) return { error: "missing_maximum_capacity_provenance" };
    const suppliedDutyCapacity = availability.maxDutyMinutes ?? availability.max_duty_minutes;
    const dutyCapacityMinutes = suppliedDutyCapacity == null ? minutes : Number(suppliedDutyCapacity);
    if (!positiveInteger(dutyCapacityMinutes) || dutyCapacityMinutes > minutes || (suppliedDutyCapacity != null && !text(availability.maxDutyProvenance || availability.max_duty_provenance))) return { error: "missing_or_invalid_duty_capacity_provenance" };
    const route = acceptedRoute(availability, shift);
    if (route.error) return route;
    const points = [{ locationId: route.startLocationId, startMinute: shift.startMinute, endMinute: shift.startMinute }, ...route.stops.map((stop) => ({ locationId: stop.locationId, startMinute: stop.window.startMinute, endMinute: stop.window.endMinute }))];
    let baselineTravelMinutes = 0;
    for (let index = 1; index < points.length; index += 1) {
      const edge = edgeFor(edges, points[index - 1].locationId, points[index].locationId);
      if (!edge || points[index - 1].endMinute + edge.minutes > points[index].startMinute) return { error: "missing_accepted_route_edge" };
      baselineTravelMinutes += edge.minutes;
    }
    route.baselineTravelMinutes = baselineTravelMinutes;
    if (route.stops.some((stop) => !windowContains(shift, stop.window)
      || (availability.lunch && windowsOverlap(availability.lunch, stop.window))
      || array(availability.blockedWindows).some((blocked) => windowsOverlap(blocked, stop.window)))) return { error: "accepted_stop_unavailable_window_overlap" };
    const baselineServiceMinutes = route.stops.reduce((total, stop) => total + stop.serviceEffortMinutes, 0);
    if (baselineServiceMinutes > Number(maxService) || baselineServiceMinutes + route.baselineTravelMinutes > minutes) return { error: "accepted_route_baseline_exceeds_capacity" };
    return { shift, productiveMinutes: minutes, dutyCapacityMinutes, maxServiceMinutes: Number(maxService), baselineServiceMinutes, route };
  } catch (error) { return { error: error.code || "invalid_shift_or_unavailable_window" }; }
}

function acceptedRoute(availability, shift) {
  const supplied = availability.acceptedRoute && typeof availability.acceptedRoute === "object" ? availability.acceptedRoute : {};
  // The old single anchor shape is accepted only as a zero-stop historical
  // route.  New authoritative inputs carry acceptedRoute with explicit stops.
  const startLocationId = text(supplied.startLocationId || supplied.start_location_id || availability.acceptedRouteStartLocationId || availability.acceptedRouteAnchorLocationId || availability.routeAnchorLocationId);
  const provenance = text(supplied.provenance || availability.acceptedRouteProvenance);
  const rawStops = supplied.stops ?? supplied.existingStops ?? availability.acceptedRouteStops ?? [];
  if (!startLocationId || !provenance || !Array.isArray(rawStops)) return { error: "missing_ordered_accepted_route_provenance" };
  try {
    const stops = rawStops.map((raw, index) => {
      const stopId = text(raw.stopId || raw.id || `accepted-stop-${index + 1}`);
      const locationId = text(raw.locationId || raw.location);
      const window = normalizeWindow(raw.window, `accepted route stop ${stopId || index + 1} window`);
      const serviceEffortMinutes = Number(raw.serviceEffortMinutes ?? raw.service_effort_minutes ?? window.endMinute - window.startMinute);
      const serviceEffortProvenance = text(raw.serviceEffortProvenance || raw.service_effort_provenance || raw.provenance || provenance);
      if (!stopId || !locationId || !text(raw.provenance || provenance)) throw Object.assign(new Error("missing accepted route stop provenance"), { code: "missing_ordered_accepted_route_provenance" });
      if (!positiveInteger(serviceEffortMinutes) || serviceEffortMinutes > window.endMinute - window.startMinute || !serviceEffortProvenance) throw Object.assign(new Error("missing accepted route service effort provenance"), { code: "missing_accepted_stop_service_provenance" });
      return { stopId, locationId, window, serviceEffortMinutes, serviceEffortProvenance, provenance: text(raw.provenance || provenance), immutable: raw.immutable !== false };
    }).sort((left, right) => left.window.startMinute - right.window.startMinute || stableCompare(left.stopId, right.stopId));
    for (let index = 1; index < stops.length; index += 1) if (stops[index - 1].window.endMinute > stops[index].window.startMinute) return { error: "accepted_route_existing_stop_conflict" };
    return { startLocationId, provenance, stops, startMinute: shift.startMinute, endMinute: shift.endMinute, baselineTravelMinutes: 0 };
  } catch (error) { return { error: error.code || "missing_ordered_accepted_route_provenance" }; }
}

function routeInsertion(work, capacity, edges, availability) {
  const route = capacity.route;
  const points = [
    { locationId: route.startLocationId, startMinute: route.startMinute, endMinute: route.startMinute, stopId: "route-start" },
    ...route.stops.map((stop) => ({ locationId: stop.locationId, startMinute: stop.window.startMinute, endMinute: stop.window.endMinute, stopId: stop.stopId })),
  ];
  let baselineTravelMinutes = 0;
  for (let index = 1; index < points.length; index += 1) {
    const edge = edgeFor(edges, points[index - 1].locationId, points[index].locationId);
    if (!edge) return { error: "missing_accepted_route_edge" };
    if (points[index - 1].endMinute + edge.minutes > points[index].startMinute) return { error: "accepted_route_existing_stop_conflict" };
    baselineTravelMinutes += edge.minutes;
  }
  route.baselineTravelMinutes = baselineTravelMinutes;
  const insertions = [];
  for (let index = 0; index < points.length; index += 1) {
    const left = points[index]; const right = points[index + 1] || null;
    const toWork = edgeFor(edges, left.locationId, work.locationId);
    const fromWork = right ? edgeFor(edges, work.locationId, right.locationId) : null;
    const oldEdge = right ? edgeFor(edges, left.locationId, right.locationId) : { minutes: 0 };
    if (!toWork || (right && (!fromWork || !oldEdge))) continue;
    if (!transitFits(left.endMinute, work.window.startMinute, toWork.minutes, availability)) continue;
    if (right && !transitFits(work.window.endMinute, right.startMinute, fromWork.minutes, availability)) continue;
    if (work.window.endMinute > route.endMinute) continue;
    const after = toWork.minutes + (fromWork?.minutes || 0);
    insertions.push({ beforeStopId: left.stopId, afterStopId: right?.stopId || null, incrementalCost: after - oldEdge.minutes, dutyIncrement: after - oldEdge.minutes });
  }
  if (!insertions.length) return { error: "no_feasible_directed_route_insertion" };
  insertions.sort((left, right) => left.incrementalCost - right.incrementalCost || stableCompare(left.beforeStopId, right.beforeStopId) || stableCompare(left.afterStopId, right.afterStopId));
  return { insertion: insertions[0], baselineTravelMinutes };
}

// Travel is a contiguous activity.  A wall-clock gap that crosses lunch or a
// blocked interval is not transit capacity.  Waiting is permitted around an
// arc, but every directed arc must fit wholly inside one available segment.
function transitFits(startMinute, endMinute, minutes, availability) {
  if (!Number.isFinite(minutes) || minutes < 0 || startMinute > endMinute) return false;
  if (minutes === 0) return true;
  const blocked = [...array(availability?.blockedWindows), ...(availability?.lunch ? [availability.lunch] : [])]
    .map((window) => normalizeWindow(window, "blocked transit window"))
    .map((window) => ({ start: Math.max(startMinute, window.startMinute), end: Math.min(endMinute, window.endMinute) }))
    .filter((window) => window.start < window.end)
    .sort((left, right) => left.start - right.start || left.end - right.end);
  let cursor = startMinute;
  for (const window of blocked) {
    if (window.start - cursor >= minutes) return true;
    cursor = Math.max(cursor, window.end);
  }
  return endMinute - cursor >= minutes;
}

function serviceEffort(work) {
  if (!positiveInteger(work.serviceEffortMinutes) || !text(work.serviceEffortProvenance)) return null;
  return { minutes: Number(work.serviceEffortMinutes), provenance: text(work.serviceEffortProvenance) };
}

function workReasons(work) {
  const reasons = [];
  if (!text(work.workId)) reasons.push(programReason("missing_work_identity"));
  try { normalizeWindow(work.window, `work ${work.workId} window`); } catch { reasons.push(programReason("missing_or_invalid_work_window")); }
  if (!text(work.locationId)) reasons.push(programReason("missing_location_identity"));
  const effort = serviceEffort(work);
  if (!effort) reasons.push(programReason("missing_time_equivalent_service_effort_provenance"));
  else {
    try { if (effort.minutes > normalizeWindow(work.window, `work ${work.workId} window`).endMinute - normalizeWindow(work.window, `work ${work.workId} window`).startMinute) reasons.push(programReason("service_effort_exceeds_fixed_window")); } catch { /* window is already reported above */ }
  }
  if (!Array.isArray(work.requiredQualifications) || !text(work.qualificationProvenance)) reasons.push(programReason("missing_qualification_provenance"));
  if (!Array.isArray(work.restrictions) || !text(work.restrictionProvenance)) reasons.push(programReason("missing_restriction_provenance"));
  if (work.required !== false && (!finiteInteger(work.priority) || !text(work.priorityProvenance))) reasons.push(programReason("missing_priority_provenance"));
  return reasons;
}

function activeExceptions(exceptions, serviceDate, version) {
  const accepted = array(exceptions).filter((exception) => acceptedException(exception) && exception.serviceDate === serviceDate).map((exception) => clone(exception));
  for (const exception of accepted) {
    assertExceptionCommand(exception);
    if (text(exception.baseVersionId || exception.base_version_id) !== text(version.id) || text(exception.publicationId || exception.publication_id) !== text(version.publicationId || version.publication_id)) {
      throw Object.assign(new Error("Exception is not bound to the selected weekly version/publication."), { code: "exception_authority_mismatch" });
    }
  }
  const reversed = new Set(accepted.filter((item) => item.type === "reverse").map((item) => text(item.reversesExceptionId || item.payload?.reversesExceptionId)));
  return accepted.filter((item) => item.type !== "reverse" && !reversed.has(item.id)).sort(exceptionOrderCompare);
}

function applyException(state, exception) {
  const payload = exception.payload || {};
  const slotId = text(payload.slotId || exception.slotId);
  const window = exception.window || payload.window;
  if (["pto", "daily_absence", "partial_absence"].includes(exception.type)) {
    const prior = state.availability.get(slotId) || { slotId };
    state.availability.set(slotId, !window ? { ...prior, status: "absent", blockedWindows: [{ start: "00:00", end: "23:59" }] } : { ...prior, blockedWindows: [...array(prior.blockedWindows), normalizeWindow(window, "absence window")] });
  } else if (exception.type === "shift_override") {
    const prior = state.availability.get(slotId) || { slotId };
    state.availability.set(slotId, { ...prior, status: payload.status || prior.status || "working", shift: normalizeWindow(payload.shift || window, "shift override") });
  } else if (exception.type === "cover_all") {
    const supplied = clone(payload.availability || payload); const coverSlotId = text(supplied.slotId || slotId);
    state.availability.set(coverSlotId, { ...(state.availability.get(coverSlotId) || {}), ...supplied, slotId: coverSlotId, status: "working" });
  } else if (exception.type === "lunch") {
    const prior = state.availability.get(slotId) || { slotId };
    state.availability.set(slotId, { ...prior, lunch: normalizeWindow(payload.lunch || window, "lunch") });
  } else if (["nine_forty_five_rebalance", "manager_correction"].includes(exception.type)) {
    for (const lock of array(payload.locks || payload.assignments || (payload.workId ? [payload] : []))) state.manualLocks.set(text(lock.workId || lock.id), text(lock.slotId || lock.ownerSlotId));
  } else if (exception.type === "event_impact") {
    const removed = new Set(array(payload.removeWorkIds).map(text));
    state.work.forEach((work) => { if (removed.has(work.workId)) work.cancelled = true; });
    for (const patch of array(payload.patchWork)) { const match = state.work.find((work) => work.workId === text(patch.workId)); if (match) Object.assign(match, clone(patch)); }
    for (const addition of array(payload.addWork)) state.work.push({ ...clone(addition), workId: text(addition.workId || addition.id), originSlotId: text(addition.originSlotId || addition.ownerSlotId), overlayWork: true, cancelled: false });
  }
  state.applied.push({ id: exception.id, type: exception.type, serviceDate: exception.serviceDate, payloadDigest: exception.payloadDigest || contentDigest(payload) });
}

function proximityIndex(rows) {
  const edges = new Map();
  for (const source of array(rows)) {
    const from = text(source.fromLocationId || source.from); const to = text(source.toLocationId || source.to);
    const minutes = Number(source.minutes ?? source.distance);
    const entry = { minutes, provenance: text(source.provenance || source.source), verified: source.verified === true };
    if (!from || !to || from === to || !positiveInteger(minutes) || !entry.verified || !entry.provenance) continue;
    const insert = (left, right) => { const key = `${left}\u0000${right}`; const old = edges.get(key); if (!old || minutes < old.minutes || (minutes === old.minutes && stableCompare(entry.provenance, old.provenance) < 0)) edges.set(key, entry); };
    insert(from, to); if (source.bidirectional === true || source.symmetric === true) insert(to, from);
  }
  return edges;
}
function edgeFor(edges, from, to) { return from === to ? { minutes: 0, provenance: "same_location", verified: true } : edges.get(`${from}\u0000${to}`) || null; }

function candidateReasons(work, slot, availability, capacity, lockOwner) {
  if (!availability) return [programReason("missing_slot_availability")];
  if (availability.status === "departed_named_absent") return [programReason("departed_named_absent")];
  if (availability.status !== "working") return [programReason("slot_not_working", { status: availability.status || "unknown" })];
  // An empty qualification/restriction set is authority only when the input
  // explicitly says who established that empty fact.  Absence is never a
  // default grant of eligibility.
  if (!Array.isArray(availability.qualifications) || !text(availability.qualificationProvenance)) return [programReason("missing_availability_qualification_provenance")];
  if (!Array.isArray(availability.restrictions) || !text(availability.restrictionProvenance)) return [programReason("missing_availability_restriction_provenance")];
  if (capacity.error) return [programReason(capacity.error)];
  if (lockOwner && lockOwner !== slot.id) return [programReason("manual_lock", { lockedSlotId: lockOwner })];
  const failures = [];
  const window = normalizeWindow(work.window, "work window");
  if (!windowContains(capacity.shift, window)) failures.push(programReason("not_full_window_qualified"));
  if (availability.lunch && windowsOverlap(availability.lunch, window)) failures.push(programReason("lunch_overlap"));
  if (array(availability.blockedWindows).some((blocked) => windowsOverlap(blocked, window))) failures.push(programReason("absence_window_overlap"));
  if (array(work.restrictedSlotIds).map(text).includes(slot.id) || array(availability.restrictions).map(text).includes(text(work.locationId))) failures.push(programReason("restriction"));
  const qualifications = new Set(array(availability.qualifications).map(text));
  const missing = array(work.requiredQualifications).map(text).filter((item) => !qualifications.has(item));
  if (missing.length) failures.push(programReason("missing_qualification", { qualifications: missing }));
  return failures;
}

export function prepareStaticWeeklySchedulingProblem(input, deadline = null) {
  if (deadline != null) remainingStaticWeeklyMilliseconds(deadline);
  const serviceDate = assertServiceDate(input.serviceDate);
  if (input.classification === "CANDIDATE_WORKBOOK_EVIDENCE_NOT_PRODUCTION_OR_PUBLICATION_AUTHORITY" || input.publicationAuthority === "REVIEW_REQUIRED") return { error: programReason("candidate_workbook_evidence_not_publishable", { classification: input.classification || null, reason: input.admission?.failClosedReason || "verified schedule packet required" }) };
  if (text(input.timezone || MEMPHIS_TIME_ZONE) !== MEMPHIS_TIME_ZONE) return { error: programReason("unsupported_service_timezone", { timezone: input.timezone }) };
  if (array(input.versions).length > STATIC_WEEKLY_SERVER_LIMITS.maxVersions || array(input.slots).length > STATIC_WEEKLY_SERVER_LIMITS.maxSlots || array(input.proximity).length > STATIC_WEEKLY_SERVER_LIMITS.maxProximityRows || array(input.exceptions).length > STATIC_WEEKLY_SERVER_LIMITS.maxExceptions) return { error: programReason("input_count_limit") };
  let version;
  try { version = selectEffectiveWeeklyVersion(array(input.versions), serviceDate); } catch (error) { return { error: programReason(error.code || "invalid_weekly_authority", { message: error.message }) }; }
  let normalizedAuthority;
  try { normalizedAuthority = normalizeStaticWeeklyAuthority(version, input.slots, input.exceptions, input.proximity || [], serviceDate); } catch (error) { return { error: programReason(error.code || "invalid_weekly_authority", { message: error.message }) }; }
  version = normalizedAuthority.version;
  const slots = normalizedAuthority.slots;
  const exceptions = normalizedAuthority.exceptions;
  const proximity = normalizedAuthority.proximity;
  if (version.objective?.requireVerifiedProximity === false) return { error: programReason("verified_proximity_required") };
  if (slots.some((slot) => !slot.id)) return { error: programReason("invalid_slot_id") };
  const slotIds = new Set();
  for (const slot of slots) {
    if (slotIds.has(slot.id)) return { error: programReason("duplicate_slot_id", { slotId: slot.id }) };
    slotIds.add(slot.id);
  }
  slots.sort(byId);
  const availabilityIdentities = new Set();
  for (const entry of array(version.slotAvailability)) {
    const identity = `${entry.dayOfWeek}\u0000${text(entry.slotId)}`;
    if (availabilityIdentities.has(identity)) return { error: programReason("duplicate_slot_availability_identity", { dayOfWeek: entry.dayOfWeek, slotId: text(entry.slotId) }) };
    availabilityIdentities.add(identity);
  }
  const incumbencyByDaySlot = new Map();
  for (let day = 0; day < 7; day += 1) for (const slot of slots) {
    if (deadline != null) remainingStaticWeeklyMilliseconds(deadline);
    const date = weekdayDate(serviceDate, day);
    try { incumbencyByDaySlot.set(`${day}\u0000${slot.id}`, snapshotIncumbency(slot, date)); } catch (error) { return { error: programReason("invalid_incumbency_history", { slotId: slot.id, serviceDate: date, detail: error.code || error.message }) }; }
  }
  const states = new Map(); const applied = [];
  for (let day = 0; day < 7; day += 1) {
    if (deadline != null) remainingStaticWeeklyMilliseconds(deadline);
    const state = { availability: new Map(), work: [], manualLocks: new Map(), applied: [] };
    for (const entry of array(version.slotAvailability)) if (entry.dayOfWeek === day) {
      const inheritedRoute = version.acceptedRoutesBySlot?.[text(entry.slotId)] || null;
      state.availability.set(text(entry.slotId), { ...clone(entry), ...(entry.acceptedRoute ? {} : (inheritedRoute ? { acceptedRoute: clone(inheritedRoute) } : {})) });
    }
    for (const slotId of array(version.namedAbsentSlotIds).map(text)) if (!state.availability.has(slotId)) state.availability.set(slotId, { slotId, dayOfWeek: day, status: "departed_named_absent", absentProvenance: "immutable-weekly-roster-slot" });
    for (const entry of array(version.assignments).filter((item) => item.dayOfWeek === day)) state.work.push({ ...clone(entry), workId: text(entry.workId || entry.id), originSlotId: text(entry.originSlotId || version.originSlotOverrides?.[text(entry.workId || entry.id)] || entry.ownerSlotId || entry.baselineSlotId), cancelled: entry.cancelled === true });
    const date = weekdayDate(serviceDate, day);
    let overlays = [];
    try { overlays = activeExceptions(exceptions, date, version); overlays.forEach((item) => applyException(state, item)); } catch (error) { return { error: programReason(error.code || "invalid_exception_overlay", { message: error.message }) }; }
    applied.push(...state.applied); states.set(day, state);
  }
  // This includes accepted overlays as well as the immutable version source.
  // It must precede candidate/x-map materialization, where identical plan-work
  // identities would otherwise share one decision variable.
  const planWorkIdentities = new Set();
  for (let day = 0; day < 7; day += 1) for (const raw of states.get(day).work) {
    if (raw.cancelled) continue;
    const workId = text(raw.workId || raw.id);
    const key = `${day}:${workId}`;
    if (!workId) return { error: programReason("invalid_plan_work_id", { dayOfWeek: day }) };
    if (planWorkIdentities.has(key)) return { error: programReason("duplicate_plan_work_id", { planWorkId: key }) };
    planWorkIdentities.add(key);
  }
  const edges = proximityIndex(proximity);
  const candidates = []; const work = []; const availabilityByDaySlot = new Map(); const staticRejections = new Map();
  for (let day = 0; day < 7; day += 1) {
    if (deadline != null) remainingStaticWeeklyMilliseconds(deadline);
    const state = states.get(day);
    for (const slot of slots) {
      const availability = state.availability.get(slot.id);
      if (availability?.status === "working") {
        if (!Array.isArray(availability.qualifications) || !text(availability.qualificationProvenance) || !Array.isArray(availability.restrictions) || !text(availability.restrictionProvenance)) return { error: programReason("working_slot_missing_eligibility_provenance", { slotId: slot.id, dayOfWeek: day }) };
        const capacity = productiveCapacity(availability, edges);
        if (capacity.error) return { error: programReason("working_slot_missing_provenance", { slotId: slot.id, dayOfWeek: day, detail: capacity.error }) };
        availabilityByDaySlot.set(`${day}\u0000${slot.id}`, { availability, capacity, slot });
      }
    }
    const activeWork = state.work.filter((item) => !item.cancelled).sort(byId);
    const workingSlots = slots.filter((slot) => availabilityByDaySlot.has(`${day}\u0000${slot.id}`));
    // Reject the full candidate cross-product before calling route insertion
    // or allocating candidate/transition arrays in the backend parent.
    const potentialCandidates = activeWork.length * workingSlots.length;
    if (candidates.length + potentialCandidates > STATIC_WEEKLY_SERVER_LIMITS.maxCandidateAssignments) {
      return { error: programReason("candidate_assignment_limit", { dayOfWeek: day, candidateAssignments: candidates.length + potentialCandidates, limit: STATIC_WEEKLY_SERVER_LIMITS.maxCandidateAssignments }) };
    }
    for (const raw of activeWork) {
      const issues = workReasons(raw);
      const key = `${day}:${raw.workId}`;
      if (issues.length) return { error: programReason("work_missing_or_incompatible_provenance", { workId: raw.workId, dayOfWeek: day, reasons: issues }) };
      const required = raw.required !== false; const bestEffort = !required && (raw.coveragePolicy === "best_effort" || raw.bestEffortCoverage === true);
      if (bestEffort && (!positiveInteger(raw.coveragePolicyOrder ?? 1) || !text(raw.coveragePolicyProvenance))) return { error: programReason("best_effort_coverage_missing_policy_provenance", { workId: raw.workId, dayOfWeek: day }) };
      const item = { ...raw, key, dayOfWeek: day, window: normalizeWindow(raw.window, `work ${raw.workId} window`), effort: serviceEffort(raw), priority: required ? Number(raw.priority) : 0, required, coverageClass: required ? "required" : (bestEffort ? "best_effort" : "permitted_open"), coverageOrder: bestEffort ? Number(raw.coveragePolicyOrder ?? 1) : null, manualLock: state.manualLocks.get(raw.workId) || null };
      work.push(item); const rejects = [];
      for (const slot of slots) {
        const context = availabilityByDaySlot.get(`${day}\u0000${slot.id}`);
        const failures = candidateReasons(item, slot, context?.availability, context?.capacity || { error: "missing_slot_availability" }, item.manualLock);
        if (!failures.length) {
          const route = routeInsertion(item, context.capacity, edges, context.availability);
          if (route.error) failures.push(programReason(route.error));
          else candidates.push({ item, slot, availability: context.availability, capacity: context.capacity, routeInsertion: route.insertion, baselineTravelMinutes: route.baselineTravelMinutes });
        }
        if (failures.length) rejects.push({ slotId: slot.id, reasons: failures });
      }
      staticRejections.set(key, rejects);
    }
  }
  if (work.length > STATIC_WEEKLY_SERVER_LIMITS.maxWorkItems) return { error: programReason("work_item_limit", { count: work.length }) };
  const dailyCapacityDenominators = [...availabilityByDaySlot.values()].map((entry) => entry.capacity.productiveMinutes);
  const weeklyCapacityDenominators = [...availabilityByDaySlot.values()].reduce((totals, entry) => {
    totals.set(entry.slot.id, (totals.get(entry.slot.id) || 0) + entry.capacity.productiveMinutes);
    return totals;
  }, new Map());
  const maximumEffort = work.reduce((total, item) => total + item.effort.minutes, 0)
    + [...availabilityByDaySlot.values()].reduce((total, entry) => total + entry.capacity.baselineServiceMinutes, 0);
  const exactEquityScale = losslessEquityScale([...dailyCapacityDenominators, ...weeklyCapacityDenominators.values()], maximumEffort);
  if (exactEquityScale == null) return { error: programReason("unrepresentable_exact_equity_denominators", { denominators: [...new Set([...dailyCapacityDenominators, ...weeklyCapacityDenominators.values()])].sort((a, b) => a - b), maximumEffort }) };
  const serviceDay = serviceDateWeekday(serviceDate); const serviceDayAvailability = states.get(serviceDay).availability;
  const roster = slots.map((slot) => ({ ...incumbencyByDaySlot.get(`${serviceDay}\u0000${slot.id}`), availability: serviceDayAvailability.get(slot.id)?.status || "unavailable" }));
  const baselineCanonicalInput = canonicalAuthorityInput(version, slots, [], proximity, serviceDate);
  const canonicalInput = canonicalAuthorityInput(version, slots, exceptions, proximity, serviceDate);
  const prepared = { serviceDate, version, slots, roster, incumbencyByDaySlot, states, work: work.sort((a, b) => stableCompare(a.key, b.key)), candidates, availabilityByDaySlot, staticRejections, edges, applied, exactEquityScale, baselineCanonicalInput, canonicalInput, inputDigest: postgresJsonbContentDigest(canonicalInput), baselineInputDigest: postgresJsonbContentDigest(baselineCanonicalInput), weeklyVersionDigest: version.contentDigest || postgresJsonbContentDigest(canonicalAuthorityInput(version, slots, [], [])) };
  const preflight = preflightProblem(prepared);
  if (preflight.error) return { error: preflight.error };
  return { ...prepared, preflight: preflight.facts };
}

function term(coefficient, variable) { return `${coefficient < 0 ? "-" : "+"} ${Math.abs(coefficient)} ${variable}`; }
function expression(terms) { const visible = terms.filter(([coefficient]) => Math.abs(coefficient) > EPSILON); return visible.length ? visible.map(([coefficient, variable]) => term(coefficient, variable)).join(" ").replace(/^\+ /, "") : "0"; }
// Encode UTF-16 code units with a length prefix.  Unlike punctuation
// replacement, `a-b` and `a_b` cannot collide, and every result is an LP-safe
// identifier.  Generated names are checked below as a second fail-closed
// guard against future builder changes.
export function staticWeeklySafeName(value) {
  const source = String(value);
  return `id_${source.length}_${Array.from({ length: source.length }, (_, index) => source.charCodeAt(index).toString(16).padStart(4, "0")).join("_")}`;
}
function assertUniqueGeneratedNames(names) {
  const unique = new Set(names);
  return unique.size === names.length ? null : programReason("generated_identifier_collision", { generated: names.length, unique: unique.size });
}

function publicDaySlotIdentity(daySlot) {
  const separator = daySlot.indexOf("\u0000");
  const dayOfWeek = Number(daySlot.slice(0, separator));
  const slotId = daySlot.slice(separator + 1);
  // Internal maps use NUL because it is collision-free. PostgreSQL JSONB does
  // not admit NUL, so public receipts carry the same tuple as JSON text.
  return JSON.stringify([dayOfWeek, slotId]);
}

// Every non-terminal route node has a positive, immutable window.  Arcs only
// move from a completed node to a later starting node.  Consequently the arc
// graph is a DAG, and the in/out equations make every feasible active-node set
// one start-to-end chronological path: a second path would need either a
// second start source or a directed cycle.  This structural evidence is part
// of the shared generated authority, so the verifier rejects any receipt that
// tries to substitute a route graph without this proof shape.
function routeCanonicalityEvidence(routeGroups) {
  const groups = [];
  for (const group of routeGroups) {
    const fixedNodes = group.nodes.filter((node) => node.kind === "accepted" || node.kind === "work");
    const ids = new Set(group.nodes.map((node) => node.id));
    if (ids.size !== group.nodes.length || fixedNodes.some((node) => !Number.isInteger(node.startMinute) || !Number.isInteger(node.endMinute) || node.startMinute >= node.endMinute)) {
      return { error: programReason("route_canonicality_invalid_fixed_node", { daySlot: group.daySlot }) };
    }
    const invalidArc = group.arcs.find((arc) => {
      if (arc.from.kind === "end" || arc.to.kind === "start" || arc.from === arc.to) return true;
      if (arc.from.kind === "start") return arc.from.endMinute > arc.to.startMinute;
      if (arc.to.kind === "end") return arc.from.endMinute > arc.to.startMinute;
      // Positive fixed windows convert non-overlap into strict chronological
      // progress, even when two jobs are contiguous.
      return arc.from.endMinute > arc.to.startMinute || arc.from.startMinute >= arc.to.startMinute;
    });
    if (invalidArc) return { error: programReason("route_canonicality_nonforward_arc", { daySlot: group.daySlot, arc: invalidArc.name }) };
    const pairs = new Set(group.arcs.map((arc) => `${arc.from.id}\u0000${arc.to.id}`));
    if (pairs.size !== group.arcs.length) return { error: programReason("route_canonicality_duplicate_arc", { daySlot: group.daySlot }) };
    groups.push({
      daySlot: publicDaySlotIdentity(group.daySlot),
      fixedNodeCount: fixedNodes.length,
      forwardArcCount: group.arcs.length,
      positiveFixedWindows: true,
      pathUniqueness: "every feasible selected-node set has one chronological start-to-end path",
    });
  }
  return {
    schema: STATIC_WEEKLY_ROUTE_CANONICALITY_SCHEMA,
    invariant: "positive-fixed-windows-forward-only-dag-unique-path-v1",
    groups,
  };
}

function groupedObjectiveError(objective, base, width) {
  let bounds;
  try { bounds = staticWeeklyGroupedObjectiveBounds(base, width); } catch (error) { return programReason(error.code || "invalid_grouped_objective_shape", { objective: objective.name }); }
  const invalidCoefficient = objective.terms.find(([coefficient]) => !Number.isSafeInteger(coefficient) || BigInt(Math.abs(coefficient)) > MAX_TERMINAL_EXACT_OBJECTIVE);
  if (!bounds.completeMaximumSafe || invalidCoefficient) return programReason("terminal_objective_bound", {
    objective: objective.name,
    base: String(bounds.base),
    width: bounds.width,
    completeMaximum: bounds.completeMaximum.toString(),
    limit: MAX_TERMINAL_EXACT_OBJECTIVE.toString(),
    coefficient: invalidCoefficient?.[0] ?? null,
  });
  return null;
}

export function buildStaticWeeklySchedulingModel(problem, bindings, objective, deadline = null) {
  if (deadline != null) remainingStaticWeeklyMilliseconds(deadline);
  // Rank permutations are optimization machinery, not hard scheduling rows.
  // Materialize them only when the current tier (or an exact earlier binding)
  // needs them; this keeps coverage admission from solving an irrelevant
  // quadratic rank MIP while preserving the same staged program semantics.
  const priorNames = bindings.map((binding) => binding.name);
  const includeDailyRanks = objective.family === "seed" || objective.family === "daily_leximax" || objective.family === "daily_stable_tie" || objective.family === "weekly_leximax" || objective.family === "weekly_stable_tie" || priorNames.some((name) => name.startsWith("daily_"));
  const includeWeeklyRanks = objective.family === "seed" || objective.family === "weekly_leximax" || objective.family === "weekly_stable_tie" || priorNames.some((name) => name.startsWith("weekly_"));
  const x = new Map(); const uncovered = new Map(); const binary = new Set(); const general = new Set();
  const candidatesByWork = new Map(problem.work.map((item) => [item.key, []]));
  const candidatesByDaySlot = new Map();
  problem.candidates.forEach((candidate, index) => {
    const name = `x_${index}`; const key = `${candidate.item.key}\u0000${candidate.slot.id}`;
    x.set(key, name); binary.add(name); candidatesByWork.get(candidate.item.key).push(candidate);
    const ds = `${candidate.item.dayOfWeek}\u0000${candidate.slot.id}`; if (!candidatesByDaySlot.has(ds)) candidatesByDaySlot.set(ds, []); candidatesByDaySlot.get(ds).push(candidate);
  });
  problem.work.forEach((item, index) => { const name = `u_${index}`; uncovered.set(item.key, name); binary.add(name); });
  // One directed path is built for every working slot/day.  Accepted stops are
  // fixed nodes in that path and each selected work node has exactly one
  // incoming and outgoing arc, so service, travel, and committed waiting are
  // each charged once in the same feasibility model.
  const routeGroups = [...problem.availabilityByDaySlot.entries()]
    .sort(([left], [right]) => stableCompare(left, right))
    .map(([daySlot, context], groupIndex) => {
      const list = (candidatesByDaySlot.get(daySlot) || []).slice().sort((left, right) => stableCompare(left.item.key, right.item.key));
      const base = `r_${groupIndex}`;
      const nodes = [
        { id: `start_${groupIndex}`, kind: "start", active: base, locationId: context.capacity.route.startLocationId, startMinute: context.capacity.shift.startMinute, endMinute: context.capacity.shift.startMinute },
        ...context.capacity.route.stops.map((stop, index) => ({ id: `accepted_${groupIndex}_${index}`, kind: "accepted", active: base, locationId: stop.locationId, startMinute: stop.window.startMinute, endMinute: stop.window.endMinute })),
        ...list.map((candidate, index) => ({ id: `work_${groupIndex}_${index}`, kind: "work", active: x.get(`${candidate.item.key}\u0000${candidate.slot.id}`), locationId: candidate.item.locationId, startMinute: candidate.item.window.startMinute, endMinute: candidate.item.window.endMinute })),
        { id: `end_${groupIndex}`, kind: "end", active: base, locationId: null, startMinute: context.capacity.shift.endMinute, endMinute: context.capacity.shift.endMinute },
      ];
      return { daySlot, context, list, base, nodes, arcs: [] };
    });
  const potentialArcs = routeGroups.reduce((total, group) => total + (group.nodes.length * (group.nodes.length - 1)), 0);
  if (potentialArcs > STATIC_WEEKLY_SERVER_LIMITS.maxRouteArcCandidates) return { error: programReason("route_arc_candidate_limit", { routeArcCandidates: potentialArcs, limit: STATIC_WEEKLY_SERVER_LIMITS.maxRouteArcCandidates }) };
  let arcIndex = 0;
  for (const group of routeGroups) {
    binary.add(group.base);
    for (const from of group.nodes) for (const to of group.nodes) {
      if (from === to || from.kind === "end" || to.kind === "start") continue;
      let minutes = 0; let waitingMinutes = 0; let protectedMinutes = 0;
      if (to.kind !== "end") {
        if (from.endMinute > to.startMinute) continue;
        const routeEdge = edgeFor(problem.edges, from.locationId, to.locationId);
        if (!routeEdge || !transitFits(from.endMinute, to.startMinute, routeEdge.minutes, group.context.availability)) continue;
        minutes = routeEdge.minutes;
        ({ waitingMinutes, protectedMinutes } = routeArcTiming(from, to, minutes, group.context.availability));
      } else if (from.endMinute > group.context.capacity.shift.endMinute) continue;
      const name = `arc_${arcIndex++}`;
      binary.add(name); group.arcs.push({ name, from, to, minutes, waitingMinutes, protectedMinutes });
    }
  }
  const routeCanonicality = routeCanonicalityEvidence(routeGroups);
  if (routeCanonicality.error) return routeCanonicality;
  // A complete leximax rank permutation is quadratic.  Reject projected
  // growth before allocating its variables or constraints.
  const dailyEntries = [...problem.availabilityByDaySlot.entries()]
    .map(([daySlot, context]) => ({ daySlot, dayOfWeek: Number(daySlot.split("\u0000")[0]), slotId: context.slot.id, context }))
    .sort((left, right) => left.dayOfWeek - right.dayOfWeek || stableCompare(left.slotId, right.slotId));
  const weeklyEntries = [...new Set(dailyEntries.map((entry) => entry.slotId))].sort(stableCompare).map((slotId) => ({ slotId, contexts: dailyEntries.filter((entry) => entry.slotId === slotId) }));
  const dailyRankLimit = !includeDailyRanks ? 0 : objective.family === "daily_leximax" ? Math.min(dailyEntries.length, Number(objective.rank || 1) + Number(objective.rankCount || 1) - 1) : dailyEntries.length;
  const weeklyRankLimit = !includeWeeklyRanks ? 0 : objective.family === "weekly_leximax" ? Math.min(weeklyEntries.length, Number(objective.rank || 1) + Number(objective.rankCount || 1) - 1) : weeklyEntries.length;
  const rankBinaryCount = (dailyEntries.length * dailyRankLimit) + (weeklyEntries.length * weeklyRankLimit);
  const rankIntegerCount = dailyRankLimit + weeklyRankLimit;
  const rankConstraintCount = (dailyRankLimit ? (2 * dailyEntries.length * dailyRankLimit) + dailyEntries.length + (2 * dailyRankLimit) : 0) + (weeklyRankLimit ? (2 * weeklyEntries.length * weeklyRankLimit) + weeklyEntries.length + (2 * weeklyRankLimit) : 0) + bindings.length;
  const projectedBinaryVariables = binary.size + rankBinaryCount;
  if (projectedBinaryVariables > STATIC_WEEKLY_SERVER_LIMITS.maxBinaryVariables) return { error: programReason("model_variable_limit", { binaryVariables: projectedBinaryVariables, baseBinaryVariables: binary.size, rankBinaryVariables: rankBinaryCount, rankIntegerVariables: rankIntegerCount, rankConstraints: rankConstraintCount, limit: STATIC_WEEKLY_SERVER_LIMITS.maxBinaryVariables }) };
  const constraints = [];
  for (const item of problem.work) constraints.push({ name: staticWeeklySafeName(`coverage_${item.key}`), terms: [...(candidatesByWork.get(item.key) || []).map((candidate) => [1, x.get(`${item.key}\u0000${candidate.slot.id}`)]), [1, uncovered.get(item.key)]], relation: "=", value: 1 });
  for (const group of routeGroups) {
    const { daySlot, context, list, base, nodes, arcs } = group;
    const incoming = (node) => arcs.filter((arc) => arc.to === node).map((arc) => [1, arc.name]);
    const outgoing = (node) => arcs.filter((arc) => arc.from === node).map((arc) => [1, arc.name]);
    const startNode = nodes.find((node) => node.kind === "start"); const endNode = nodes.find((node) => node.kind === "end");
    constraints.push({ name: `route_active_${base}`, terms: [[1, base]], relation: "=", value: 1 });
    constraints.push({ name: staticWeeklySafeName(`route_start_${daySlot}`), terms: [...outgoing(startNode), [-1, base]], relation: "=", value: 0 });
    constraints.push({ name: staticWeeklySafeName(`route_end_${daySlot}`), terms: [...incoming(endNode), [-1, base]], relation: "=", value: 0 });
    for (const node of nodes.filter((entry) => entry.kind !== "start" && entry.kind !== "end")) {
      constraints.push({ name: `route_in_${node.id}`, terms: [...incoming(node), [-1, node.active]], relation: "=", value: 0 });
      constraints.push({ name: `route_out_${node.id}`, terms: [...outgoing(node), [-1, node.active]], relation: "=", value: 0 });
    }
    constraints.push({ name: staticWeeklySafeName(`service_capacity_${daySlot}`), terms: list.map((candidate) => [candidate.item.effort.minutes, x.get(`${candidate.item.key}\u0000${candidate.slot.id}`)]), relation: "<=", value: context.capacity.maxServiceMinutes - context.capacity.baselineServiceMinutes });
    // Service effort remains the equity resource above.  Duty instead uses
    // fixed service-window commitment plus every selected arc's directed
    // travel and non-protected waiting, matching the independent verifier.
    const baselineServiceDutyMinutes = context.capacity.route.stops.reduce((total, stop) => total + (stop.window.endMinute - stop.window.startMinute), 0);
    constraints.push({ name: staticWeeklySafeName(`duty_capacity_${daySlot}`), terms: [
      ...list.map((candidate) => [candidate.item.window.endMinute - candidate.item.window.startMinute, x.get(`${candidate.item.key}\u0000${candidate.slot.id}`)]),
      ...arcs.map((arc) => [arc.minutes + arc.waitingMinutes, arc.name]),
    ], relation: "<=", value: context.capacity.dutyCapacityMinutes - baselineServiceDutyMinutes });
  }
  // U and UW use an exact common denominator; ratio displays never enter the MIP.
  const dailyLoads = dailyEntries.map((entry) => { const terms = (candidatesByDaySlot.get(entry.daySlot) || []).map((candidate) => [exactRatioCoefficient(candidate.item.effort.minutes, entry.context.capacity.productiveMinutes, problem.exactEquityScale), x.get(`${candidate.item.key}\u0000${entry.slotId}`)]); const constant = exactRatioCoefficient(entry.context.capacity.baselineServiceMinutes, entry.context.capacity.productiveMinutes, problem.exactEquityScale); return { ...entry, terms, constant, upper: constant + terms.reduce((total, [coefficient]) => total + coefficient, 0) }; });
  const weeklyLoads = weeklyEntries.map((entry) => { const capacity = entry.contexts.reduce((total, item) => total + item.context.capacity.productiveMinutes, 0); const baseline = entry.contexts.reduce((total, item) => total + item.context.capacity.baselineServiceMinutes, 0); const terms = entry.contexts.flatMap((item) => (candidatesByDaySlot.get(item.daySlot) || []).map((candidate) => [exactRatioCoefficient(candidate.item.effort.minutes, capacity, problem.exactEquityScale), x.get(`${candidate.item.key}\u0000${entry.slotId}`)])); const constant = exactRatioCoefficient(baseline, capacity, problem.exactEquityScale); return { ...entry, capacity, terms, constant, upper: constant + terms.reduce((total, [coefficient]) => total + coefficient, 0) }; });
  if ([...dailyLoads, ...weeklyLoads].some((entry) => !Number.isSafeInteger(entry.constant) || !Number.isSafeInteger(entry.upper) || entry.terms.some(([coefficient]) => !Number.isSafeInteger(coefficient)))) return { error: programReason("unrepresentable_exact_equity_coefficients") };
  const addRankFamily = (prefix, loads, limit) => {
    const maximum = Math.max(0, ...loads.map((entry) => entry.upper)); const ranks = Array.from({ length: limit }, (_, index) => `${prefix}_${index + 1}`); ranks.forEach((name) => general.add(name));
    const permutations = loads.map((entry, itemIndex) => ranks.map((rank, rankIndex) => `p_${prefix}_${itemIndex + 1}_${rankIndex + 1}`)); permutations.flat().forEach((name) => binary.add(name));
    loads.forEach((entry, itemIndex) => constraints.push({ name: `${prefix}_item_${itemIndex + 1}`, terms: permutations[itemIndex].map((name) => [1, name]), relation: limit === loads.length ? "=" : "<=", value: 1 }));
    ranks.forEach((rank, rankIndex) => constraints.push({ name: `${prefix}_rank_${rankIndex + 1}`, terms: permutations.map((row) => [1, row[rankIndex]]), relation: "=", value: 1 }));
    loads.forEach((entry, itemIndex) => ranks.forEach((rank, rankIndex) => { const permutation = permutations[itemIndex][rankIndex]; constraints.push({ name: `${prefix}_link_lo_${itemIndex + 1}_${rankIndex + 1}`, terms: [[1, rank], ...entry.terms.map(([coefficient, variable]) => [-coefficient, variable]), [-maximum, permutation]], relation: ">=", value: entry.constant - maximum }); constraints.push({ name: `${prefix}_link_hi_${itemIndex + 1}_${rankIndex + 1}`, terms: [[1, rank], ...entry.terms.map(([coefficient, variable]) => [-coefficient, variable]), [maximum, permutation]], relation: "<=", value: entry.constant + maximum }); }));
    ranks.slice(0, -1).forEach((rank, rankIndex) => constraints.push({ name: `${prefix}_descending_${rankIndex + 1}`, terms: [[1, rank], [-1, ranks[rankIndex + 1]]], relation: ">=", value: 0 }));
    if (limit && limit < loads.length) loads.forEach((entry, itemIndex) => constraints.push({ name: `${prefix}_top_${itemIndex + 1}`, terms: [[-1, ranks.at(-1)], ...entry.terms, ...permutations[itemIndex].map((name) => [-maximum, name])], relation: "<=", value: -entry.constant }));
    return { prefix, loads, maximum, ranks, permutations, fixed: false };
  };
  const dailyRank = includeDailyRanks ? addRankFamily("daily_rank", dailyLoads, dailyRankLimit) : { prefix: "daily_rank", loads: dailyLoads, maximum: 0, ranks: [], permutations: [], fixed: false };
  const weeklyRank = includeWeeklyRanks ? addRankFamily("weekly_rank", weeklyLoads, weeklyRankLimit) : { prefix: "weekly_rank", loads: weeklyLoads, maximum: 0, ranks: [], permutations: [], fixed: false };
  const leximaxObjectives = (prefix, family, rankFamily) => {
    const width = rankFamily.ranks.length <= 16 ? 1 : leximaxTierWidth(rankFamily.maximum);
    const base = Math.max(2, rankFamily.maximum + 1);
    return Array.from({ length: Math.ceil(rankFamily.ranks.length / width) }, (_, groupIndex) => {
      const ranks = rankFamily.ranks.slice(groupIndex * width, (groupIndex + 1) * width);
      const firstRank = groupIndex * width + 1;
      return {
        name: width === 1 ? `${prefix}_${firstRank}` : `${prefix}_${firstRank}_to_${firstRank + ranks.length - 1}`,
        family,
        rank: firstRank,
        rankCount: ranks.length,
        rankBase: base,
        terms: ranks.map((name, rankIndex) => [Number(BigInt(base) ** BigInt(ranks.length - rankIndex - 1)), name]),
      };
    });
  };
  const expressions = {
    coverage: [...new Set(problem.work.filter((item) => item.required).map((item) => item.priority))].sort((a, b) => b - a).map((priority) => ({ name: `required_uncovered_priority_${priority}`, family: "required_coverage", priority, terms: problem.work.filter((item) => item.required && item.priority === priority).map((item) => [1, uncovered.get(item.key)]) })),
    bestEffort: [...new Set(problem.work.filter((item) => !item.required && item.coverageClass === "best_effort").map((item) => item.coverageOrder))].sort((a, b) => a - b).map((coverageOrder) => ({ name: `best_effort_open_order_${coverageOrder}`, family: "best_effort_coverage", coverageOrder, terms: problem.work.filter((item) => !item.required && item.coverageClass === "best_effort" && item.coverageOrder === coverageOrder).map((item) => [1, uncovered.get(item.key)]) })),
    daily: leximaxObjectives("daily_service_effort_utilization_rank", "daily_leximax", dailyRank),
    // Higher weights on lower stable IDs make minimization put those IDs in
    // earlier equal-valued ranks.  The former increasing weights inverted the
    // declared deterministic tie rule once terminal evidence enabled solves.
    dailyTie: { name: "daily_stable_id_rank_tie", family: "daily_stable_tie", terms: dailyRank.permutations.flatMap((row, itemIndex) => row.map((name, rankIndex) => [(dailyRank.loads.length - itemIndex) * (rankIndex + 1), name])) },
    weekly: leximaxObjectives("weekly_service_effort_utilization_rank", "weekly_leximax", weeklyRank),
    weeklyTie: { name: "weekly_stable_id_rank_tie", family: "weekly_stable_tie", terms: weeklyRank.permutations.flatMap((row, itemIndex) => row.map((name, rankIndex) => [(weeklyRank.loads.length - itemIndex) * (rankIndex + 1), name])) },
    travel: { name: "incremental_directed_route_cost", terms: routeGroups.flatMap((group) => [
      ...group.arcs.map((arc) => [arc.minutes, arc.name]),
      [-group.context.capacity.route.baselineTravelMinutes, group.base],
    ]) },
    disruption: { name: "accepted_baseline_disruption", terms: problem.work.flatMap((item) => [[1, uncovered.get(item.key)], ...(candidatesByWork.get(item.key) || []).filter((candidate) => candidate.slot.id !== item.originSlotId).map((candidate) => [1, x.get(`${item.key}\u0000${candidate.slot.id}`)])]) },
    // Bind every assignment/open decision after material objectives.  Large
    // programs use safe base-encoded chunks, preserving the exact stable
    // lexicographic work/open/owner order without a process round-trip per
    // digit; small programs retain one tier per decision for transparency.
    identity: (() => {
      const width = problem.work.length <= 16 ? 1 : identityTierWidth(problem.slots.length);
      const base = problem.slots.length + 2;
      return Array.from({ length: Math.ceil(problem.work.length / width) }, (_, groupIndex) => {
        const items = problem.work.slice(groupIndex * width, (groupIndex + 1) * width);
        return {
          name: width === 1 ? `identity_${staticWeeklySafeName(items[0].key)}` : `identity_group_${groupIndex + 1}`,
          family: "stable_identity",
          identityBase: base,
          identityWidth: items.length,
          terms: items.flatMap((item, itemIndex) => {
            const place = Number(BigInt(base) ** BigInt(items.length - itemIndex - 1));
            return [...(candidatesByWork.get(item.key) || []).map((candidate) => [(problem.slots.findIndex((slot) => slot.id === candidate.slot.id) + 1) * place, x.get(`${item.key}\u0000${candidate.slot.id}`)]), [(problem.slots.length + 1) * place, uncovered.get(item.key)]];
          }),
        };
      });
    })(),
  };
  for (const expression of [...expressions.daily, ...expressions.weekly]) {
    const boundError = groupedObjectiveError(expression, expression.rankBase, expression.rankCount);
    if (boundError) return { error: boundError };
  }
  for (const expression of expressions.identity) {
    const boundError = groupedObjectiveError(expression, expression.identityBase, expression.identityWidth);
    if (boundError) return { error: boundError };
  }
  const collision = assertUniqueGeneratedNames([
    ...binary, ...general, ...constraints.map((constraint) => constraint.name), ...expressions.coverage, ...expressions.bestEffort, ...expressions.daily, expressions.dailyTie, ...expressions.weekly, expressions.weeklyTie, expressions.travel, expressions.disruption, ...expressions.identity,
  ].map((entry) => typeof entry === "string" ? entry : entry.name));
  if (collision) return { error: collision };
  const constraintLines = constraints.map((constraint) => ` ${constraint.name}: ${expression(constraint.terms)} ${constraint.relation} ${constraint.value}`);
  const bindingLines = bindings.map((binding) => ` bind_${staticWeeklySafeName(binding.name)}: ${expression(binding.terms)} = ${binding.value}`);
  constraintLines.push(...bindingLines);
  const lp = `Minimize\n objective: ${expression(objective.terms)}\nSubject To\n${constraintLines.join("\n")}\nBounds\n${[...binary].map((name) => ` 0 <= ${name} <= 1`).join("\n")}\n${[...general].map((name) => ` 0 <= ${name} <= ${name.startsWith("daily_rank_") ? dailyRank.maximum : weeklyRank.maximum}`).join("\n")}\n${[...binary].length ? `Binary\n ${[...binary].join(" ")}\n` : ""}${[...general].length ? `General\n ${[...general].join(" ")}\n` : ""}End\n`;
  const modelBytes = Buffer.byteLength(lp, "utf8");
  if (modelBytes > STATIC_WEEKLY_SERVER_LIMITS.maxModelBytes) return { error: programReason("model_size_limit", { bytes: modelBytes, limit: STATIC_WEEKLY_SERVER_LIMITS.maxModelBytes, projectedBinaryVariables, rankIntegerVariables: rankIntegerCount, rankConstraints: rankConstraintCount }) };
  const actualConstraintCount = constraints.length;
  const actualConstraintTerms = constraints.reduce((total, constraint) => total + constraint.terms.length, 0);
  const actualBinaryVariables = binary.size;
  const actualVariableCount = actualBinaryVariables + general.size;
  if (actualBinaryVariables > STATIC_WEEKLY_SERVER_LIMITS.maxBinaryVariables || actualConstraintCount > STATIC_WEEKLY_SERVER_LIMITS.maxConstraints || actualConstraintTerms > STATIC_WEEKLY_SERVER_LIMITS.maxConstraintTerms) return { error: programReason("materialized_model_limit", { actualBinaryVariables, actualVariableCount, actualConstraintCount, actualConstraintTerms, limits: STATIC_WEEKLY_SERVER_LIMITS }) };
  if (actualConstraintCount > problem.preflight.constraints || actualConstraintTerms > problem.preflight.constraintTerms || actualBinaryVariables > problem.preflight.binaryVariables || modelBytes > problem.preflight.projectedLpBytes) return { error: programReason("model_projection_undercount", { preflight: problem.preflight, actualBinaryVariables, actualVariableCount, actualConstraintCount, actualConstraintTerms, modelBytes }) };
  // The basis is transmitted once.  Each tier then carries only its objective
  // and exact ordered prior bindings; raw LPs are a local solver artifact and
  // must never be used as certificate authority.
  const modelBasis = {
    schema: "memphis-zoo.static-weekly-model-basis.v1",
    inputDigest: problem.inputDigest,
    equityScale: problem.exactEquityScale,
    binaryVariables: [...binary].sort(stableCompare),
    generalVariables: [...general].sort(stableCompare),
    assignmentVariables: [...x.entries()].map(([key, variable]) => ({ variable, planWorkId: key.split("\u0000")[0], slotId: key.split("\u0000")[1] })).sort((left, right) => stableCompare(left.variable, right.variable)),
    uncoveredVariables: [...uncovered.entries()].map(([planWorkId, variable]) => ({ variable, planWorkId })).sort((left, right) => stableCompare(left.variable, right.variable)),
    routeCanonicality,
    routeGroups: routeGroups.map((group) => ({ daySlot: publicDaySlotIdentity(group.daySlot), nodes: group.nodes.map((node) => ({ id: node.id, kind: node.kind, locationId: node.locationId, startMinute: node.startMinute, endMinute: node.endMinute, active: node.active })), arcs: group.arcs.map((arc) => ({ name: arc.name, from: arc.from.id, to: arc.to.id, minutes: arc.minutes, waitingMinutes: arc.waitingMinutes, protectedMinutes: arc.protectedMinutes })) })),
    constraints: { count: constraints.length, terms: constraints.reduce((total, constraint) => total + constraint.terms.length, 0), rows: constraints.map((constraint) => ({ name: constraint.name, terms: constraint.terms, relation: constraint.relation, value: constraint.value })), digest: sha256Hex(canonicalJson(constraints.map((constraint) => ({ name: constraint.name, terms: constraint.terms, relation: constraint.relation, value: constraint.value })))) },
  };
  const modelBasisDigest = sha256Hex(canonicalJson(modelBasis));
  const priorBindings = bindings.map((binding) => ({ name: binding.name, terms: binding.terms, value: binding.value }));
  const modelIdentity = { schema: "memphis-zoo.static-weekly-tier-model.v1", basisDigest: modelBasisDigest, objective: { name: objective.name, family: objective.family || null, rank: objective.rank ?? null, terms: objective.terms }, priorBindings };
  return { lp, x, uncovered, routeGroups, expressions, binary, general, objective, dailyRank, weeklyRank, dailyLoads, weeklyLoads, preflight: { ...problem.preflight, actualLpBytes: modelBytes, actualBinaryVariables, actualVariableCount, actualConstraintCount, actualConstraintTerms }, modelBasis, modelBasisDigest, priorBindings, priorBindingDigest: sha256Hex(canonicalJson(priorBindings)), modelDigest: sha256Hex(canonicalJson(modelIdentity)), modelBytes };
}

// Pure authority-input program generator.  It has no solver, worker, receipt,
// or caller-supplied model dependency.  The verifier invokes this again and
// treats every carried program field as untrusted until it matches.
export function generateStaticWeeklySchedulingProgram(input = {}, witnessValues = null, deadline = null) {
  const activeDeadline = deadline ?? createStaticWeeklyDeadline();
  const admission = admitStaticWeeklyRawInput(input, activeDeadline);
  if (admission.code) return { error: admission };
  const serviceDateDescriptor = input && typeof input === "object" ? Object.getOwnPropertyDescriptor(input, "serviceDate") : null;
  const failureServiceDate = typeof serviceDateDescriptor?.value === "string" ? serviceDateDescriptor.value : null;
  let problem;
  try { problem = prepareStaticWeeklySchedulingProblem(input, activeDeadline); } catch (error) { return { error: programReason(error.code || "invalid_program_input", { message: error.message }), failureServiceDate }; }
  if (problem.error) return { error: problem.error, failureServiceDate };
  let seed;
  try {
    seed = buildStaticWeeklySchedulingModel(problem, [], { name: "seed", family: "seed", terms: [] }, activeDeadline);
  } catch (error) {
    return { error: programReason(error.code || "canonical_program_generation_failed", { stage: "seed_model", message: error.message }), failureServiceDate: problem.serviceDate };
  }
  if (seed.error) return { error: seed.error, failureServiceDate: problem.serviceDate };
  const objectives = [...seed.expressions.coverage, ...seed.expressions.bestEffort, ...seed.expressions.daily, seed.expressions.dailyTie, ...seed.expressions.weekly, seed.expressions.weeklyTie, seed.expressions.travel, seed.expressions.disruption, ...seed.expressions.identity];
  const descriptor = canonicalProgramDescriptor({ inputDigest: problem.inputDigest, modelBasis: seed.modelBasis, objectives });
  const program = { problem, modelBasis: seed.modelBasis, modelBasisDigest: seed.modelBasisDigest, objectives, descriptor };
  if (!witnessValues) return program;
  const values = witnessValues instanceof Map ? witnessValues : new Map(witnessValues);
  const tiers = []; const bindings = [];
  for (const objective of objectives) {
    let model;
    try {
      model = buildStaticWeeklySchedulingModel(problem, bindings, objective, activeDeadline);
    } catch (error) {
      return { error: programReason(error.code || "canonical_program_generation_failed", { stage: "witness_model", tier: objective.name, message: error.message }), failureServiceDate: problem.serviceDate };
    }
    if (model.error) return { error: model.error, failureServiceDate: problem.serviceDate };
    const value = recomputeStaticWeeklyObjective(objective, model, values, problem);
    if (!Number.isSafeInteger(value)) return { error: programReason("canonical_program_objective_overflow", { tier: objective.name }), failureServiceDate: problem.serviceDate };
    tiers.push({ model, objective, value }); bindings.push({ name: objective.name, terms: objective.terms, value });
  }
  return { ...program, tiers, bindings };
}
