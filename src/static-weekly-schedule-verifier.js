/*
 * Independent JavaScript verifier for a returned HiGHS schedule.  This file
 * rebuilds eligibility, capacity, directed routes, and every objective from
 * authority input.  The program generator is solver-free and receives no
 * certificate rows or expressions.
 */
import {
  assertExceptionCommand,
  assertServiceDate,
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
import { STATIC_WEEKLY_ROUTE_CANONICALITY_SCHEMA, canonicalOptimizerAssignmentProjection, canonicalProgramMatches, canonicalSolverAuthorityCertificate, canonicalSolverAuthorityTierProjection, generateStaticWeeklySchedulingProgram, normalizeStaticWeeklyIncludedLocations, postgresJsonbContentDigest, remainingStaticWeeklyMilliseconds } from "./static-weekly-schedule-program.js";

const array = (value) => Array.isArray(value) ? value : [];
const text = (value) => String(value ?? "").trim();
const positiveInteger = (value) => Number.isInteger(Number(value)) && Number(value) > 0;
const push = (list, code, detail = {}) => list.push({ code, ...detail });
const MAX_SAFE_EXACT_INTEGER = BigInt(Number.MAX_SAFE_INTEGER);
const VERIFIER_VERSION = "static-weekly-js-verifier-v5-family-location-truth";
const MIP_FEASIBILITY_TOLERANCE = 1e-9;
const exactRatio = (numerator, denominator, scale) => {
  if (!Number.isInteger(Number(scale)) || Number(scale) <= 0 || BigInt(scale) % BigInt(denominator)) return null;
  const value = BigInt(numerator) * (BigInt(scale) / BigInt(denominator));
  return value <= MAX_SAFE_EXACT_INTEGER ? Number(value) : null;
};
function greatestCommonDivisor(left, right) {
  let a = BigInt(left); let b = BigInt(right);
  while (b) [a, b] = [b, a % b];
  return a;
}
function independentlyDerivedEquityScale(denominators, maximumEffort) {
  let scale = 1n;
  for (const denominator of [...new Set(denominators.map(Number))].sort((a, b) => a - b)) {
    if (!positiveInteger(denominator)) return null;
    scale = (scale / greatestCommonDivisor(scale, BigInt(denominator))) * BigInt(denominator);
    if (scale > MAX_SAFE_EXACT_INTEGER) return null;
  }
  if (scale * BigInt(Math.max(1, Number(maximumEffort) || 0)) > MAX_SAFE_EXACT_INTEGER) return null;
  return Number(scale);
}
const TERMINAL_REPORT_PARSER_VERSION = "highs-terminal-report-v1";
const TERMINAL_REPORT_REPRESENTATION = "highs-terminal-report-records-json-utf8-v1";
const RAW_SOLVER_RECEIPT_SCHEMA = "memphis-zoo.static-weekly-raw-solver-receipt.v1";
const PINNED_SOLVER_IDENTITY = Object.freeze({
  packageJsonSha256: "21e76a89d13d636f56d5cdda7dde590acd48d6fb683c97a327c10d43e74d9c56",
  wrapperJavaScriptSha256: "6d5be3ed3cbd1ce1924cc66cc9302b50753dabdb8c6e0e815845dce7f1890033",
  wasmSha256: "7e6432b2b26f4fab9f6d9bac55da43307c7a4b1b071cb204cb4d23e1901bc4d0",
  embeddedRuntimeBanner: "HiGHS 1.15.1 (git hash: 04024d7)",
});
function terminalReportRepresentation(records) {
  return JSON.stringify({ representation: TERMINAL_REPORT_REPRESENTATION, records: records.map(({ channel, text: reportText }) => ({ channel, text: reportText })) });
}
function rawSolverReceiptRepresentation(options, terminalReport) {
  return JSON.stringify({ schema: RAW_SOLVER_RECEIPT_SCHEMA, options, terminalReport });
}
function malformedDecimal(raw, code) { return { kind: "malformed", raw, code }; }
function normalizeTerminalDecimal(raw, { percentage = false } = {}) {
  const source = String(raw ?? "");
  const trimmed = source.trim();
  const nonfinite = /^[+-]?(?:inf|infinity|nan)$/i;
  let token = trimmed;
  if (percentage) {
    if (nonfinite.test(token)) return { kind: "nonfinite", raw: source };
    if (!token.endsWith("%")) return malformedDecimal(source, "missing_percent_suffix");
    token = token.slice(0, -1).trim();
  }
  if (nonfinite.test(token)) return { kind: "nonfinite", raw: source };
  const match = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/.exec(token);
  if (!match) return malformedDecimal(source, "malformed_decimal");
  const digits = `${match[2] || ""}${match[3] || match[4] || ""}`.replace(/^0+/, "") || "0";
  if (digits.length > 128) return malformedDecimal(source, "decimal_precision_overflow");
  let exponent;
  try { exponent = BigInt(match[5] || "0"); } catch { return malformedDecimal(source, "decimal_exponent_malformed"); }
  if (exponent > 10000n || exponent < -10000n) return malformedDecimal(source, "decimal_exponent_overflow");
  if (digits === "0") return { kind: "finite_decimal", coefficient: "0", power10: "0", canonical: "0e0", raw: source };
  let coefficient = BigInt(`${match[1] === "-" ? "-" : ""}${digits}`);
  let power10 = exponent - BigInt((match[3] || match[4] || "").length);
  while (coefficient % 10n === 0n) { coefficient /= 10n; power10 += 1n; }
  return { kind: "finite_decimal", coefficient: coefficient.toString(), power10: power10.toString(), canonical: `${coefficient}e${power10}`, raw: source };
}
function terminalDecimalIsZero(value) { return value?.kind === "finite_decimal" && value.coefficient === "0"; }
function terminalDecimalWithinIntegerTolerance(value) {
  if (value?.kind !== "finite_decimal") return false;
  try {
    const coefficient = BigInt(value.coefficient); const power = BigInt(value.power10); const absolute = coefficient < 0n ? -coefficient : coefficient;
    return coefficient === 0n || (power >= -9n ? absolute * (10n ** (power + 9n)) <= 1n : absolute <= (10n ** (-9n - power)));
  } catch { return false; }
}
function terminalDecimalEquals(left, right) { return left?.kind === "finite_decimal" && right?.kind === "finite_decimal" && left.coefficient === right.coefficient && left.power10 === right.power10; }
function terminalDecimalEqualsSafeInteger(value, integer) {
  if (!Number.isSafeInteger(integer) || value?.kind !== "finite_decimal") return false;
  let power;
  try { power = BigInt(value.power10); } catch { return false; }
  if (power < 0n || power > 16n) return false;
  try { return BigInt(value.coefficient) * (10n ** power) === BigInt(integer); } catch { return false; }
}
function parseTerminalSolverReport(report) {
  if (!report || report.representation !== TERMINAL_REPORT_REPRESENTATION || !Array.isArray(report.records)) return { ok: false, errors: ["terminal_report_representation_invalid"], raw: {}, normalized: {} };
  const records = report.records;
  const errors = [];
  if (records.some((record) => !record || !["print", "printErr"].includes(record.channel) || typeof record.text !== "string")) errors.push("terminal_report_record_invalid");
  if (records[0]?.text !== "Solving report" || records.at(-1)?.text !== "Writing the solution to solution.txt" || records.filter((record) => record.text === "Solving report").length !== 1 || records.filter((record) => record.text === "Writing the solution to solution.txt").length !== 1) errors.push("terminal_report_boundary_invalid");
  const fields = [
    ["status", /^\s*Status\s{2,}(.+)$/], ["primalBound", /^\s*Primal bound\s{2,}(.+)$/], ["dualBound", /^\s*Dual bound\s{2,}(.+)$/], ["gap", /^\s*Gap\s{2,}(.+)$/], ["solutionStatus", /^\s*Solution status\s{2,}(.+)$/],
    ["objective", /^\s+(.+?)\s+\(objective\)\s*$/], ["boundViolation", /^\s+(.+?)\s+\(bound viol\.\)\s*$/], ["integerViolation", /^\s+(.+?)\s+\(int\. viol\.\)\s*$/], ["rowViolation", /^\s+(.+?)\s+\(row viol\.\)\s*$/],
  ];
  const matches = new Map(fields.map(([name]) => [name, []]));
  records.forEach((record, index) => fields.forEach(([name, pattern]) => { const match = pattern.exec(record.text); if (match) matches.get(name).push({ index, raw: match[1] }); }));
  const raw = {}; const positions = [];
  for (const [name] of fields) {
    const fieldMatches = matches.get(name);
    if (fieldMatches.length !== 1) { errors.push(`${fieldMatches.length ? "duplicate" : "missing"}_report_field:${name}`); continue; }
    raw[name] = fieldMatches[0].raw; positions.push(fieldMatches[0].index);
  }
  if (positions.length === fields.length && positions.some((position, index) => index && position <= positions[index - 1])) errors.push("reordered_report_fields");
  const normalized = {
    primalBound: normalizeTerminalDecimal(raw.primalBound), dualBound: normalizeTerminalDecimal(raw.dualBound), gap: normalizeTerminalDecimal(raw.gap, { percentage: true }), objective: normalizeTerminalDecimal(raw.objective),
    boundViolation: normalizeTerminalDecimal(raw.boundViolation), integerViolation: normalizeTerminalDecimal(raw.integerViolation), rowViolation: normalizeTerminalDecimal(raw.rowViolation),
  };
  for (const [name, value] of Object.entries(normalized)) if (value.kind !== "finite_decimal") errors.push(`${value.kind === "nonfinite" ? "nonfinite" : "malformed"}_report_number:${name}`);
  return { ok: errors.length === 0, errors, raw, normalized };
}
function verifyTerminalAttestation(attestation, expectedValue, solverIdentity, options) {
  const errors = [];
  const report = attestation?.terminalReport;
  if (!attestation || attestation.evidenceSource !== "terminal_solver_report" || attestation.parserVersion !== TERMINAL_REPORT_PARSER_VERSION || report?.parserVersion !== TERMINAL_REPORT_PARSER_VERSION) errors.push("terminal_report_evidence_source_or_parser_invalid");
  if (attestation?.rawReceiptDigest !== sha256Hex(Buffer.from(rawSolverReceiptRepresentation(options, report), "utf8"))) errors.push("raw_worker_receipt_digest_invalid");
  if (!report || typeof report.utf8Base64 !== "string" || typeof report.utf8Sha256 !== "string" || !/^[0-9a-f]{64}$/.test(report.utf8Sha256)) errors.push("terminal_report_digest_missing");
  else {
    const decoded = Buffer.from(report.utf8Base64, "base64");
    if (decoded.toString("base64") !== report.utf8Base64 || sha256Hex(decoded) !== report.utf8Sha256 || decoded.toString("utf8") !== terminalReportRepresentation(array(report.records))) errors.push("terminal_report_digest_or_representation_mismatch");
  }
  const parsed = parseTerminalSolverReport(report);
  if (!parsed.ok) errors.push(...parsed.errors);
  if (canonicalJson(attestation?.parsedRaw || {}) !== canonicalJson(parsed.raw) || canonicalJson(attestation?.normalized || {}) !== canonicalJson(parsed.normalized)) errors.push("terminal_report_parsed_values_mismatch");
  if (attestation?.objectStatus !== parsed.raw.status || attestation?.reportStatus !== parsed.raw.status || attestation?.objectStatus !== "Optimal" || attestation?.reportStatus !== "Optimal") errors.push("object_report_status_disagreement");
  if (attestation?.reportPrimalBound !== parsed.raw.primalBound || attestation?.reportDualBound !== parsed.raw.dualBound || attestation?.reportGap !== parsed.raw.gap || attestation?.reportSolutionStatus !== parsed.raw.solutionStatus || parsed.raw.solutionStatus !== "feasible") errors.push("terminal_report_raw_field_disagreement");
  if (!Number.isSafeInteger(Number(attestation?.objectPrimalObjective)) || Number(attestation.objectPrimalObjective) !== expectedValue) errors.push("object_primal_objective_disagreement");
  const normalized = parsed.normalized;
  if (!terminalDecimalEquals(normalized.primalBound, normalized.dualBound) || !terminalDecimalEqualsSafeInteger(normalized.primalBound, expectedValue) || !terminalDecimalEqualsSafeInteger(normalized.dualBound, expectedValue) || !terminalDecimalEqualsSafeInteger(normalized.objective, expectedValue)) errors.push("report_bound_or_objective_disagreement");
  if (!terminalDecimalIsZero(normalized.gap) || !terminalDecimalIsZero(normalized.boundViolation) || !terminalDecimalWithinIntegerTolerance(normalized.integerViolation) || !terminalDecimalIsZero(normalized.rowViolation)) errors.push("report_gap_or_violation_nonzero");
  if (attestation?.embeddedRuntimeBanner !== PINNED_SOLVER_IDENTITY.embeddedRuntimeBanner || solverIdentity?.embeddedRuntimeBanner !== PINNED_SOLVER_IDENTITY.embeddedRuntimeBanner) errors.push("embedded_runtime_banner_mismatch");
  return errors;
}

function dateForDay(serviceDate, day) {
  const offset = (day - serviceDateWeekday(serviceDate) + 7) % 7;
  const [year, month, date] = serviceDate.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, date + offset));
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
}
function unavailableMinutes(windows, shift) {
  const ranges = windows.map((item) => normalizeWindow(item, "unavailable window"))
    .map((item) => ({ start: Math.max(item.startMinute, shift.startMinute), end: Math.min(item.endMinute, shift.endMinute) }))
    .filter((item) => item.start < item.end).sort((a, b) => a.start - b.start || a.end - b.end);
  let total = 0; let left = null; let right = null;
  for (const range of ranges) {
    if (left == null) { left = range.start; right = range.end; } else if (range.start > right) { total += right - left; left = range.start; right = range.end; } else right = Math.max(right, range.end);
  }
  return total + (left == null ? 0 : right - left);
}
function routeArcTiming(from, to, travelMinutes, availability) {
  const protectedMinutes = unavailableMinutes(
    [...array(availability?.blockedWindows), ...(availability?.lunch ? [availability.lunch] : [])],
    { startMinute: from.endMinute, endMinute: to.startMinute },
  );
  return {
    protectedMinutes,
    waitingMinutes: Math.max(0, to.startMinute - from.endMinute - travelMinutes - protectedMinutes),
  };
}
function capacity(availability, edges) {
  try {
    const shift = normalizeWindow(availability.shift, "shift");
    if (!text(availability.productiveCapacityProvenance || availability.capacityProvenance)) return null;
    const productiveMinutes = shift.endMinute - shift.startMinute - unavailableMinutes([...array(availability.blockedWindows), ...(availability.lunch ? [availability.lunch] : [])], shift);
    const maxServiceMinutes = availability.maxServiceEffortMinutes ?? availability.maxLoadPoints;
    const suppliedDutyCapacity = availability.maxDutyMinutes ?? availability.max_duty_minutes;
    const dutyCapacityMinutes = suppliedDutyCapacity == null ? productiveMinutes : Number(suppliedDutyCapacity);
    const source = availability.acceptedRoute && typeof availability.acceptedRoute === "object" ? availability.acceptedRoute : {};
    const startLocationId = text(source.startLocationId || source.start_location_id || availability.acceptedRouteStartLocationId || availability.acceptedRouteAnchorLocationId || availability.routeAnchorLocationId);
    const provenance = text(source.provenance || availability.acceptedRouteProvenance);
    const rawStops = source.stops ?? source.existingStops ?? availability.acceptedRouteStops ?? [];
    if (!positiveInteger(productiveMinutes) || !positiveInteger(dutyCapacityMinutes) || dutyCapacityMinutes > productiveMinutes || (suppliedDutyCapacity != null && !text(availability.maxDutyProvenance || availability.max_duty_provenance)) || !positiveInteger(maxServiceMinutes) || !text(availability.maxServiceEffortProvenance || availability.capacityProvenance) || !startLocationId || !provenance || !Array.isArray(rawStops)) return null;
    const stops = rawStops.map((raw, index) => {
      const window = normalizeWindow(raw.window, "accepted route stop window");
      return { stopId: text(raw.stopId || raw.id || `accepted-stop-${index + 1}`), locationId: text(raw.locationId || raw.location), window, serviceEffortMinutes: Number(raw.serviceEffortMinutes ?? raw.service_effort_minutes ?? window.endMinute - window.startMinute), serviceEffortProvenance: text(raw.serviceEffortProvenance || raw.service_effort_provenance || raw.provenance || provenance), provenance: text(raw.provenance || provenance) };
    }).sort((left, right) => left.window.startMinute - right.window.startMinute || stableCompare(left.stopId, right.stopId));
    if (stops.some((stop) => !stop.stopId || !stop.locationId || !stop.provenance) || stops.some((stop, index) => index && stops[index - 1].window.endMinute > stop.window.startMinute)) return null;
    if (stops.some((stop) => !positiveInteger(stop.serviceEffortMinutes) || stop.serviceEffortMinutes > stop.window.endMinute - stop.window.startMinute || !stop.serviceEffortProvenance || !windowContains(shift, stop.window) || (availability.lunch && windowsOverlap(availability.lunch, stop.window)) || array(availability.blockedWindows).some((blocked) => windowsOverlap(blocked, stop.window)))) return null;
    const points = [{ locationId: startLocationId, startMinute: shift.startMinute, endMinute: shift.startMinute }, ...stops.map((stop) => ({ locationId: stop.locationId, startMinute: stop.window.startMinute, endMinute: stop.window.endMinute }))];
    let baselineTravelMinutes = 0;
    for (let index = 1; index < points.length; index += 1) {
      const minutes = edge(edges, points[index - 1].locationId, points[index].locationId);
      if (minutes === undefined || !transitFits(points[index - 1].endMinute, points[index].startMinute, minutes, availability)) return null;
      baselineTravelMinutes += minutes;
    }
    const baselineServiceMinutes = stops.reduce((total, stop) => total + stop.serviceEffortMinutes, 0);
    if (baselineServiceMinutes > Number(maxServiceMinutes) || baselineServiceMinutes + baselineTravelMinutes > productiveMinutes) return null;
    return { shift, productiveMinutes, dutyCapacityMinutes, maxServiceMinutes: Number(maxServiceMinutes), baselineServiceMinutes, route: { startLocationId, stops, startMinute: shift.startMinute, endMinute: shift.endMinute, baselineTravelMinutes } };
  } catch { return null; }
}
function edgeIndex(rows) {
  const edges = new Map();
  for (const row of array(rows)) {
    const from = text(row.fromLocationId || row.from); const to = text(row.toLocationId || row.to); const minutes = Number(row.minutes ?? row.distance);
    if (!from || !to || from === to || !positiveInteger(minutes) || row.verified !== true || !text(row.provenance || row.source)) continue;
    const put = (a, b) => { const key = `${a}\u0000${b}`; const previous = edges.get(key); if (!previous || minutes < previous) edges.set(key, minutes); };
    put(from, to); if (row.bidirectional === true || row.symmetric === true) put(to, from);
  }
  return edges;
}
function edge(edges, from, to) { return from === to ? 0 : edges.get(`${from}\u0000${to}`); }
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
function exceptionSet(exceptions, serviceDate, version, violations) {
  const accepted = array(exceptions).filter((item) => item && item.serviceDate === serviceDate && [undefined, "accepted", "applied", "published"].includes(item.status)).map((item) => structuredClone(item));
  for (const item of accepted) {
    try { assertExceptionCommand(item); } catch (error) { push(violations, "invalid_exception", { id: item.id, detail: error.code || error.message }); continue; }
    if (text(item.baseVersionId || item.base_version_id) !== text(version.id) || text(item.publicationId || item.publication_id) !== text(version.publicationId || version.publication_id)) push(violations, "exception_authority_mismatch", { id: item.id });
  }
  const reversed = new Set(accepted.filter((item) => item.type === "reverse").map((item) => text(item.reversesExceptionId || item.payload?.reversesExceptionId)));
  return accepted.filter((item) => item.type !== "reverse" && !reversed.has(item.id)).sort((a, b) => stableCompare(a.acceptedAt || a.occurredAt || "", b.acceptedAt || b.occurredAt || "") || Number(a.sequence || 0) - Number(b.sequence || 0) || stableCompare(a.id, b.id));
}
function apply(state, item) {
  const payload = item.payload || {}; const slotId = text(payload.slotId || item.slotId); const window = item.window || payload.window;
  if (["pto", "daily_absence", "partial_absence"].includes(item.type)) { const prior = state.availability.get(slotId) || { slotId }; state.availability.set(slotId, !window ? { ...prior, status: "absent", blockedWindows: [{ start: "00:00", end: "23:59" }] } : { ...prior, blockedWindows: [...array(prior.blockedWindows), normalizeWindow(window, "absence window")] }); if (!window) state.fullDayAbsenceSlotIds.push(slotId); }
  else if (item.type === "shift_override") { const prior = state.availability.get(slotId) || { slotId }; state.availability.set(slotId, { ...prior, status: payload.status || prior.status || "working", shift: normalizeWindow(payload.shift || window, "shift override") }); }
  else if (item.type === "cover_all") { const supplied = structuredClone(payload.availability || payload); const cover = text(supplied.slotId || slotId); state.availability.set(cover, { ...(state.availability.get(cover) || {}), ...supplied, slotId: cover, status: "working" }); state.contractorCoverageSlotIds.push(cover); }
  else if (item.type === "lunch") { const prior = state.availability.get(slotId) || { slotId }; state.availability.set(slotId, { ...prior, lunch: normalizeWindow(payload.lunch || window, "lunch") }); }
  else if (["nine_forty_five_rebalance", "manager_correction"].includes(item.type)) for (const lock of array(payload.locks || payload.assignments || (payload.workId ? [payload] : []))) state.locks.set(text(lock.workId || lock.id), text(lock.slotId || lock.ownerSlotId));
  else if (item.type === "event_impact") {
    const remove = new Set(array(payload.removeWorkIds).map(text)); state.work.forEach((work) => { if (remove.has(work.workId)) work.cancelled = true; });
    for (const patch of array(payload.patchWork)) {
      const work = state.work.find((entry) => entry.workId === text(patch.workId));
      if (work) {
        const priorLocationId = text(work.locationId);
        const priorIncludedLocations = structuredClone(work.includedLocations);
        Object.assign(work, structuredClone(patch));
        if (!Object.hasOwn(patch, "includedLocations")) {
          if (text(work.locationId) === priorLocationId) work.includedLocations = priorIncludedLocations;
          else delete work.includedLocations;
        }
        work.includedLocations = normalizeStaticWeeklyIncludedLocations(work);
      }
    }
    for (const addition of array(payload.addWork)) {
      const normalized = { ...structuredClone(addition), workId: text(addition.workId || addition.id), originSlotId: text(addition.originSlotId || addition.ownerSlotId), cancelled: false };
      normalized.includedLocations = normalizeStaticWeeklyIncludedLocations(normalized);
      state.work.push(normalized);
    }
  }
}
function applyCustodialAbsenceCoveragePolicy(state, slotById, violations, serviceDate) {
  const absent = state.fullDayAbsenceSlotIds; const contractors = state.contractorCoverageSlotIds;
  const expectedContractors = Math.max(0, absent.length - 1);
  if (new Set(absent).size !== absent.length) push(violations, "duplicate_daily_absence", { serviceDate });
  if (new Set(contractors).size !== contractors.length) push(violations, "duplicate_coverall_capacity", { serviceDate });
  if (contractors.length !== expectedContractors) push(violations, "custodial_absence_coverage_mismatch", { serviceDate, absences: absent.length, contractorCapacity: contractors.length, expectedContractors });
  if (absent.some((slotId) => slotById.get(slotId)?.contractorCapacity === true)) push(violations, "custodial_absence_identity_mismatch", { serviceDate });
  if (contractors.some((slotId) => slotById.get(slotId)?.contractorCapacity !== true || absent.includes(slotId))) push(violations, "custodial_contractor_capacity_required", { serviceDate });
  for (const work of state.work) {
    const absenceIndex = absent.indexOf(work.originSlotId);
    if (absenceIndex === 0) { work.custodialCoverageMode = "internal_even"; work.custodialCoverageSlotId = null; }
    else if (absenceIndex > 0) { work.custodialCoverageMode = "contractor_exact"; work.custodialCoverageSlotId = contractors[absenceIndex - 1]; }
    else { work.custodialCoverageMode = "zoo_employee_baseline"; work.custodialCoverageSlotId = null; }
  }
}
function validWork(work) {
  try { const window = normalizeWindow(work.window, "work window"); return positiveInteger(work.serviceEffortMinutes) && Number(work.serviceEffortMinutes) <= window.endMinute - window.startMinute && text(work.serviceEffortProvenance) && Array.isArray(work.requiredQualifications) && text(work.qualificationProvenance) && Array.isArray(work.restrictions) && text(work.restrictionProvenance) && text(work.locationId); } catch { return false; }
}
function validEligibilityAuthority(availability) {
  return Array.isArray(availability?.qualifications) && text(availability.qualificationProvenance) && Array.isArray(availability?.restrictions) && text(availability.restrictionProvenance);
}
function exactTerms(terms, values) {
  try { return array(terms).reduce((total, term) => total + (BigInt(term[0]) * BigInt(values.get(term[1]) ?? 0)), 0n); } catch { return null; }
}

export function verifyStaticWeeklyScheduleResult(input = {}, result = {}, deadline = null) {
  const violations = [];
  const deadlineFailure = (stage) => ({ ok: false, violations: [{ code: "solver_timeout", stage }], metrics: null, digest: contentDigest({ input, result, timeout: stage }), verifierVersion: VERIFIER_VERSION });
  const expired = () => {
    if (deadline == null) return false;
    try { remainingStaticWeeklyMilliseconds(deadline); return false; } catch { return true; }
  };
  // Regenerate the complete candidate universe, variables, route graph,
  // constraints, ranks, and ordered objective expressions from authority
  // input before examining any carried certificate program fields.
  const regenerated = generateStaticWeeklySchedulingProgram(input, null, deadline);
  if (regenerated.error) return regenerated.error.code === "solver_timeout" ? deadlineFailure("program_regeneration") : { ok: false, violations: [{ code: "canonical_program_generation_failed", detail: regenerated.error.code || regenerated.error.message }], metrics: null, digest: contentDigest({ input, result, invalid: true }), verifierVersion: VERIFIER_VERSION };
  const { serviceDate } = regenerated.problem;
  // Program regeneration performs the shared raw/domain admission and the
  // pure authority normalizer.  The verifier intentionally reconstructs its
  // own work/availability graph from that normalized source rather than from
  // any optimizer projection.
  const normalizedInput = regenerated.problem.canonicalInput;
  const version = normalizedInput.version;
  const authority = result.canonicalAuthority;
  if (authority || result.authorityDigest || result.solutionDigest) {
    if (!authority || typeof authority !== "object") push(violations, "missing_canonical_server_authority");
    else {
      const currentInput = normalizedInput;
      const baselineInput = regenerated.problem.baselineCanonicalInput;
      const authorityWithoutIdentity = { ...authority }; delete authorityWithoutIdentity.databaseContentIdentity;
      if (postgresJsonbContentDigest(currentInput) !== authority.inputDigest || postgresJsonbContentDigest(authority.overlayCompilerInput || authority.compilerInput) !== authority.inputDigest || result.inputDigest !== authority.inputDigest || postgresJsonbContentDigest(authority.compilerInput) !== authority.baselineInputDigest || postgresJsonbContentDigest(baselineInput) !== authority.baselineInputDigest) push(violations, "canonical_input_mutation_or_digest_mismatch");
      if (authority.databaseContentIdentity !== postgresJsonbContentDigest(authorityWithoutIdentity)) push(violations, "canonical_authority_database_identity_mismatch");
      if (postgresJsonbContentDigest(authority.optimizerResult) !== result.solutionDigest) push(violations, "optimizer_result_digest_mismatch");
      if (postgresJsonbContentDigest(authority) !== result.authorityDigest) push(violations, "authority_digest_mismatch");
      const reportedTiers = array(result.solver?.tiers);
      const authorityTiers = canonicalSolverAuthorityTierProjection(reportedTiers);
      if (postgresJsonbContentDigest(array(authority.optimizerResult?.tiers)) !== postgresJsonbContentDigest(authorityTiers)) push(violations, "canonical_solver_tier_receipt_mismatch");
      const authorityCertificate = canonicalSolverAuthorityCertificate(result.certificate);
      if (postgresJsonbContentDigest(authority.optimizerResult?.certificate) !== postgresJsonbContentDigest(authorityCertificate)) push(violations, "canonical_solver_certificate_receipt_mismatch");
    }
  }
  const slotById = new Map(array(normalizedInput.slots).map((slot) => [text(slot.id), slot])); const edges = edgeIndex(normalizedInput.proximity);
  const expected = new Map(); const availability = new Map(); const locks = new Map();
  for (let day = 0; day < 7; day += 1) {
    if (expired()) return deadlineFailure("authority_reconstruction");
    const state = { availability: new Map(), work: [], locks: new Map(), fullDayAbsenceSlotIds: [], contractorCoverageSlotIds: [] };
    for (const item of array(version.slotAvailability)) if (item.dayOfWeek === day) {
      const inheritedRoute = version.acceptedRoutesBySlot?.[text(item.slotId)] || null;
      state.availability.set(text(item.slotId), { ...structuredClone(item), ...(item.acceptedRoute ? {} : (inheritedRoute ? { acceptedRoute: structuredClone(inheritedRoute) } : {})) });
    }
    for (const slotId of array(version.namedAbsentSlotIds).map(text)) if (!state.availability.has(slotId)) state.availability.set(slotId, { slotId, dayOfWeek: day, status: "departed_named_absent" });
    for (const item of array(version.assignments)) if (item.dayOfWeek === day) state.work.push({ ...structuredClone(item), workId: text(item.workId || item.id), originSlotId: text(item.originSlotId || version.originSlotOverrides?.[text(item.workId || item.id)] || item.ownerSlotId || item.baselineSlotId), cancelled: item.cancelled === true });
    const occurrenceDate = dateForDay(serviceDate, day);
    for (const item of exceptionSet(normalizedInput.exceptions, occurrenceDate, version, violations)) apply(state, item);
    applyCustodialAbsenceCoveragePolicy(state, slotById, violations, occurrenceDate);
    for (const item of state.work.filter((entry) => !entry.cancelled)) {
      const key = `${day}:${item.workId}`; if (!validWork(item)) push(violations, "missing_or_incompatible_provenance", { planWorkId: key }); expected.set(key, { ...item, key, day });
    }
    for (const [slotId, item] of state.availability) {
      if (item?.status === "working" && !validEligibilityAuthority(item)) push(violations, "working_slot_missing_eligibility_provenance", { dayOfWeek: day, slotId });
      availability.set(`${day}\u0000${slotId}`, item);
    }
    for (const [workId, slotId] of state.locks) locks.set(`${day}:${workId}`, slotId);
  }
  const assignments = array(result.weeklyAssignments); const seen = new Set(); const byDaySlot = new Map(); const priorityUncovered = new Map(); let travelCost = 0; let disruption = 0;
  const sourceRows = new Map([...expected.keys()].map((key) => [key, []]));
  for (const assignment of assignments) {
    const key = text(assignment.planWorkId || `${assignment.dayOfWeek}:${assignment.workId}`);
    if (sourceRows.has(key)) sourceRows.get(key).push(assignment);
  }
  for (const [planWorkId, rows] of sourceRows) {
    if (rows.length !== 1 || !["ASSIGNED", "OPEN", "REVIEW"].includes(rows[0]?.status)) push(violations, "source_work_retention_invariant_failed", { planWorkId, rowCount: rows.length, status: rows[0]?.status || null });
  }
  for (const assignment of assignments) {
    if (expired()) return deadlineFailure("projection_reconstruction");
    const key = text(assignment.planWorkId || `${assignment.dayOfWeek}:${assignment.workId}`); const work = expected.get(key);
    if (!work) { push(violations, "unexpected_assignment", { planWorkId: key }); continue; }
    if (seen.has(key)) { push(violations, "duplicate_assignment", { planWorkId: key }); continue; } seen.add(key);
    const occurrenceDate = dateForDay(serviceDate, work.day);
    const baselineSlotId = text(work.originSlotId);
    let baseline; let optimized = null;
    try { baseline = snapshotIncumbency(slotById.get(baselineSlotId), occurrenceDate); } catch (error) { push(violations, "baseline_identity_not_canonical", { planWorkId: key, detail: error.code || error.message }); }
    if (assignment.planWorkId !== key || assignment.workId !== work.workId || Number(assignment.dayOfWeek) !== work.day || assignment.serviceDate !== occurrenceDate || assignment.locationId !== work.locationId || assignment.window?.start !== work.window?.start || assignment.window?.end !== work.window?.end || Number(assignment.serviceEffortMinutes) !== Number(work.serviceEffortMinutes)) push(violations, "immutable_work_fact_mismatch", { planWorkId: key });
    if (assignment.status === "ASSIGNED") {
      try { optimized = snapshotIncumbency(slotById.get(text(assignment.slotId)), occurrenceDate); } catch (error) { push(violations, "optimized_identity_not_canonical", { planWorkId: key, detail: error.code || error.message }); }
    }
    const expectedOwnerDigest = postgresJsonbContentDigest({ planWorkId: key, slotId: optimized?.slotId || null, personId: optimized?.personId || null, serviceDate: occurrenceDate });
    const expectedExactOwnerIdentity = postgresJsonbContentDigest({ plan_work_id: key, service_date: occurrenceDate, optimized_owner_slot_id: optimized?.slotId || null, optimized_owner_person_id: optimized?.personId || null, baseline_owner_slot_id: baseline?.slotId || null, baseline_owner_person_id: baseline?.personId || null });
    const canonicalFacts = {
      personId: optimized?.personId || null, displayName: optimized?.displayName || null, slotId: optimized?.slotId || null, slotLabel: optimized?.slotLabel || null,
      baselineSlotId: baseline?.slotId || null, baselineSlotLabel: baseline?.slotLabel || null, baselineOwnerPersonId: baseline?.personId || null, baselineOwnerName: baseline?.displayName || null,
      originalActorSlotId: baseline?.slotId || null, originalActorPersonId: baseline?.personId || null, originalActorName: baseline?.displayName || null,
      optimizedOwnerSlotId: optimized?.slotId || null, optimizedOwnerPersonId: optimized?.personId || null, optimizedOwnerName: optimized?.displayName || null,
      actualActorPersonId: null, ownerDigest: expectedOwnerDigest, exactOwnerIdentity: expectedExactOwnerIdentity,
    };
    for (const [field, value] of Object.entries(canonicalFacts)) if ((assignment[field] ?? null) !== value) push(violations, "canonical_identity_fact_mismatch", { planWorkId: key, field });
    const canonicalStatus = assignment.status === "ASSIGNED" ? "ASSIGNED" : (work.required !== false ? "REVIEW" : "OPEN");
    if (assignment.status !== canonicalStatus) push(violations, "assignment_status_not_canonical", { planWorkId: key, expected: canonicalStatus, actual: assignment.status ?? null });
    if (assignment.status !== "ASSIGNED") {
      if (work.required !== false) priorityUncovered.set(Number(work.priority), (priorityUncovered.get(Number(work.priority)) || 0) + 1);
      disruption += 1; continue;
    }
    if (text(assignment.optimizedOwnerSlotId) !== text(assignment.slotId) || text(assignment.optimizedOwnerPersonId) !== text(assignment.personId)) push(violations, "optimized_owner_fact_mismatch", { planWorkId: key });
    if (!text(assignment.slotId) || !slotById.has(text(assignment.slotId))) { push(violations, "invalid_owner", { planWorkId: key }); continue; }
    const slotId = text(assignment.slotId); const candidate = availability.get(`${work.day}\u0000${slotId}`); const cap = candidate && candidate.status === "working" && validEligibilityAuthority(candidate) ? capacity(candidate, edges) : null;
    if (!cap) { push(violations, "ineligible_owner", { planWorkId: key, slotId }); continue; }
    const workWindow = normalizeWindow(work.window, "work window");
    if (!windowContains(cap.shift, workWindow)) push(violations, "shift_violation", { planWorkId: key, slotId });
    if (candidate.lunch && windowsOverlap(candidate.lunch, workWindow)) push(violations, "lunch_violation", { planWorkId: key, slotId });
    if (array(candidate.blockedWindows).some((window) => windowsOverlap(window, workWindow))) push(violations, "absence_violation", { planWorkId: key, slotId });
    if (array(work.restrictedSlotIds).map(text).includes(slotId) || array(candidate.restrictions).map(text).includes(text(work.locationId))) push(violations, "restriction_violation", { planWorkId: key, slotId });
    const ownerSlot = slotById.get(slotId);
    if (work.custodialCoverageMode === "contractor_exact") {
      if (ownerSlot?.contractorCapacity !== true || slotId !== work.custodialCoverageSlotId) push(violations, "coverall_capacity_mismatch", { planWorkId: key, slotId, requiredSlotId: work.custodialCoverageSlotId });
    } else if (ownerSlot?.contractorCapacity === true) push(violations, "coverall_capacity_reserved_for_second_or_later_absence", { planWorkId: key, slotId });
    const qualifications = new Set(array(candidate.qualifications).map(text)); if (array(work.requiredQualifications).map(text).some((qualification) => !qualifications.has(qualification))) push(violations, "qualification_violation", { planWorkId: key, slotId });
    if (locks.get(key) && locks.get(key) !== slotId) push(violations, "manual_lock_violation", { planWorkId: key, slotId });
    const groupKey = `${work.day}\u0000${slotId}`; if (!byDaySlot.has(groupKey)) byDaySlot.set(groupKey, []); byDaySlot.get(groupKey).push({ assignment, work, cap });
    if (slotId !== work.originSlotId) disruption += 1;
  }
  for (const [key, work] of expected) if (!seen.has(key)) { push(violations, "coverage_missing", { planWorkId: key }); if (work.required !== false) priorityUncovered.set(Number(work.priority), (priorityUncovered.get(Number(work.priority)) || 0) + 1); disruption += 1; }
  // The optimizer receipt is a single exact projection of the independently
  // validated public weekly assignments.  This binds assigned, OPEN and REVIEW
  // rows alike, preserves canonical row order, and rejects any missing,
  // duplicate, extra, identity, display, immutable-work or owner difference.
  if (authority) {
    const optimizerRows = authority.optimizerResult?.assignments;
    const expectedOptimizerRows = canonicalOptimizerAssignmentProjection(assignments);
    if (!Array.isArray(optimizerRows) || canonicalJson(optimizerRows) !== canonicalJson(expectedOptimizerRows)) push(violations, "canonical_optimizer_assignment_projection_mismatch");
  }
  const dailyLoads = new Map(); const weeklyLoads = new Map();
  for (let day = 0; day < 7; day += 1) {
    for (const [slotId] of slotById) {
      const record = availability.get(`${day}\u0000${slotId}`); if (record?.status !== "working") continue;
      const cap = capacity(record, edges); if (!cap) { push(violations, "missing_capacity_provenance", { dayOfWeek: day, slotId }); continue; }
      const acceptedServiceDutyMinutes = cap.route.stops.reduce((total, stop) => total + (stop.window.endMinute - stop.window.startMinute), 0);
      dailyLoads.set(`${day}\u0000${slotId}`, {
        dayOfWeek: day, slotId,
        acceptedStopServiceMinutes: cap.baselineServiceMinutes,
        serviceEffortMinutes: cap.baselineServiceMinutes,
        serviceDutyMinutes: acceptedServiceDutyMinutes,
        acceptedRouteTravelMinutes: cap.route.baselineTravelMinutes,
        travelDutyMinutes: cap.route.baselineTravelMinutes,
        waitingMinutes: 0,
        protectedBreakUnavailableMinutes: 0,
        routeSpanMinutes: 0,
        totalDutyMinutes: 0,
        productiveCapacityMinutes: cap.productiveMinutes,
        dutyCapacityMinutes: cap.dutyCapacityMinutes,
        maxServiceEffortMinutes: cap.maxServiceMinutes,
        normalizedServiceLoad: 0,
        workIds: [],
      });
    }
  }
  for (const [key, load] of dailyLoads) {
    const entries = (byDaySlot.get(key) || []).slice();
    const record = availability.get(key); const cap = record ? capacity(record, edges) : null;
    if (!cap) continue;
    for (const entry of entries) {
      const window = normalizeWindow(entry.work.window, "work window");
      load.serviceEffortMinutes += Number(entry.work.serviceEffortMinutes);
      load.serviceDutyMinutes += window.endMinute - window.startMinute;
      load.workIds.push(entry.work.workId);
    }
    if (load.serviceEffortMinutes > load.maxServiceEffortMinutes) push(violations, "maximum_service_capacity_violation", { daySlot: key });
    const routeNodes = [
      { kind: "shift_start", id: "shift-start", locationId: cap.route.startLocationId, startMinute: cap.shift.startMinute, endMinute: cap.shift.startMinute },
      ...cap.route.stops.map((stop) => ({ kind: "accepted", id: stop.stopId, locationId: stop.locationId, startMinute: stop.window.startMinute, endMinute: stop.window.endMinute })),
      ...entries.map((entry) => {
        const window = normalizeWindow(entry.work.window, "work window");
        return { kind: "work", id: entry.work.workId, locationId: entry.work.locationId, startMinute: window.startMinute, endMinute: window.endMinute };
      }),
    ];
    const start = routeNodes.shift();
    routeNodes.sort((left, right) => left.startMinute - right.startMinute || left.endMinute - right.endMinute || stableCompare(left.kind, right.kind) || stableCompare(left.id, right.id));
    let previous = start; let totalTravel = 0; let transitWaitingMinutes = 0; let protectedArcMinutes = 0;
    for (const node of routeNodes) {
      if (previous.endMinute > node.startMinute) { push(violations, "combined_route_overlap", { daySlot: key, previous: previous.id, next: node.id }); previous = node; continue; }
      const minutes = edge(edges, previous.locationId, node.locationId);
      if (minutes === undefined) { push(violations, "missing_directed_travel_provenance", { daySlot: key, from: previous.locationId, to: node.locationId }); previous = node; continue; }
      if (!transitFits(previous.endMinute, node.startMinute, minutes, record)) { push(violations, "travel_consumes_protected_window", { daySlot: key, from: previous.id, to: node.id, minutes }); previous = node; continue; }
      const timing = routeArcTiming(previous, node, minutes, record);
      totalTravel += minutes;
      transitWaitingMinutes += timing.waitingMinutes;
      protectedArcMinutes += timing.protectedMinutes;
      previous = node;
    }
    const routeEndMinute = routeNodes.length ? routeNodes.at(-1).endMinute : cap.shift.startMinute;
    const routeSpanMinutes = routeEndMinute - cap.shift.startMinute;
    const protectedBreakUnavailableMinutes = unavailableMinutes(
      [...array(record.blockedWindows), ...(record.lunch ? [record.lunch] : [])],
      { startMinute: cap.shift.startMinute, endMinute: routeEndMinute },
    );
    // A fixed service window can contain less provenanced service effort.  Its
    // remainder is committed waiting, not hidden productive capacity.  This
    // makes service + travel + waiting equal the non-protected route span.
    const fixedWindowWaitingMinutes = load.serviceDutyMinutes - load.serviceEffortMinutes;
    const waitingMinutes = fixedWindowWaitingMinutes + transitWaitingMinutes;
    load.travelDutyMinutes = totalTravel;
    load.waitingMinutes = waitingMinutes;
    load.fixedWindowWaitingMinutes = fixedWindowWaitingMinutes;
    load.transitWaitingMinutes = transitWaitingMinutes;
    load.protectedBreakUnavailableMinutes = protectedBreakUnavailableMinutes;
    load.routeSpanMinutes = routeSpanMinutes;
    load.routeNodeCount = routeNodes.length + 1;
    load.totalDutyMinutes = load.serviceEffortMinutes + totalTravel + waitingMinutes;
    if (protectedArcMinutes !== protectedBreakUnavailableMinutes || load.totalDutyMinutes !== routeSpanMinutes - protectedBreakUnavailableMinutes) {
      push(violations, "route_duty_accounting_mismatch", { daySlot: key, serviceDutyMinutes: load.serviceDutyMinutes, serviceEffortMinutes: load.serviceEffortMinutes, travelMinutes: totalTravel, waitingMinutes, protectedArcMinutes, protectedBreakUnavailableMinutes, routeSpanMinutes, totalDutyMinutes: load.totalDutyMinutes });
    }
    travelCost += totalTravel - load.acceptedRouteTravelMinutes;
    if (load.totalDutyMinutes > load.dutyCapacityMinutes) push(violations, "productive_duty_capacity_violation", { daySlot: key, serviceDutyMinutes: load.serviceDutyMinutes, serviceEffortMinutes: load.serviceEffortMinutes, travelMinutes: totalTravel, waitingMinutes, dutyCapacityMinutes: load.dutyCapacityMinutes, productiveCapacityMinutes: load.productiveCapacityMinutes });
  }
  const exactEquityScale = Number(result.objective?.exactEquityCommonDenominator);
  if (!Number.isInteger(exactEquityScale) || exactEquityScale <= 0) push(violations, "exact_equity_scale_missing");
  const verifiedCapacities = [...dailyLoads.values()].map((load) => load.productiveCapacityMinutes);
  const verifiedWeeklyCapacities = [...dailyLoads.values()].reduce((totals, load) => {
    totals.set(load.slotId, (totals.get(load.slotId) || 0) + load.productiveCapacityMinutes);
    return totals;
  }, new Map());
  const maximumEffort = [...expected.values()].reduce((total, work) => total + Number(work.serviceEffortMinutes || 0), 0)
    + [...dailyLoads.values()].reduce((total, load) => total + load.acceptedStopServiceMinutes, 0);
  const independentlyDerivedScale = independentlyDerivedEquityScale([...verifiedCapacities, ...verifiedWeeklyCapacities.values()], maximumEffort);
  if (independentlyDerivedScale == null || exactEquityScale !== independentlyDerivedScale) push(violations, "exact_equity_scale_not_canonical", { expected: independentlyDerivedScale, actual: exactEquityScale, maximumEffort });
  const daily = [];
  for (let day = 0; day < 7; day += 1) {
    const loads = [...dailyLoads.values()].filter((item) => item.dayOfWeek === day).sort((a, b) => stableCompare(a.slotId, b.slotId));
    loads.forEach((item) => { item.normalizedServiceLoad = item.serviceEffortMinutes / item.productiveCapacityMinutes; });
    const values = loads.map((item) => item.normalizedServiceLoad); const spread = values.length ? Math.max(...values) - Math.min(...values) : 0;
    const exactLoads = loads.map((item) => exactRatio(item.serviceEffortMinutes, item.productiveCapacityMinutes, exactEquityScale));
    if (exactLoads.some((value) => value == null)) push(violations, "exact_equity_scale_not_lossless", { dayOfWeek: day });
    daily.push({ dayOfWeek: day, normalizedInequity: spread, exactNormalizedInequity: loads.length && exactLoads.every((value) => value != null) ? Math.max(...exactLoads) - Math.min(...exactLoads) : null, loads });
    for (const item of loads) {
      const current = weeklyLoads.get(item.slotId) || { effort: 0, capacity: 0 };
      weeklyLoads.set(item.slotId, { effort: current.effort + item.serviceEffortMinutes, capacity: current.capacity + item.productiveCapacityMinutes });
    }
  }
  const weeklyUtilization = new Map([...weeklyLoads.entries()].map(([slotId, value]) => [slotId, value.effort / value.capacity]));
  const weeklyExactUtilization = new Map([...weeklyLoads.entries()].map(([slotId, value]) => [slotId, exactRatio(value.effort, value.capacity, exactEquityScale)]));
  const weeklyValues = [...weeklyUtilization.values()]; const weeklyInequity = weeklyValues.length ? Math.max(...weeklyValues) - Math.min(...weeklyValues) : 0;
  const dailyRanked = daily.flatMap((day) => day.loads.map((load) => ({ dayOfWeek: day.dayOfWeek, slotId: load.slotId, value: exactRatio(load.serviceEffortMinutes, load.productiveCapacityMinutes, exactEquityScale) }))).sort((left, right) => (right.value ?? -Infinity) - (left.value ?? -Infinity) || left.dayOfWeek - right.dayOfWeek || stableCompare(left.slotId, right.slotId));
  const weeklyRanked = [...weeklyExactUtilization.entries()].map(([slotId, value]) => ({ slotId, value })).sort((left, right) => (right.value ?? -Infinity) - (left.value ?? -Infinity) || stableCompare(left.slotId, right.slotId));
  if (dailyRanked.some((item) => item.value == null) || weeklyRanked.some((item) => item.value == null)) push(violations, "exact_equity_scale_not_lossless");
  const priorities = [...new Set([...expected.values()].filter((work) => work.required !== false).map((work) => Number(work.priority)))].sort((a, b) => b - a);
  const bestEffortOrders = [...new Set([...expected.values()].filter((work) => work.required === false && (work.coveragePolicy === "best_effort" || work.bestEffortCoverage === true)).map((work) => Number(work.coveragePolicyOrder ?? 1)))].sort((a, b) => a - b);
  const expectedTiers = [
    ...priorities.map((priority) => ({ name: `required_uncovered_priority_${priority}`, family: "required_coverage", value: priorityUncovered.get(priority) || 0 })),
    ...bestEffortOrders.map((coverageOrder) => ({ name: `best_effort_open_order_${coverageOrder}`, family: "best_effort_coverage", value: [...expected.values()].filter((work) => work.required === false && (work.coveragePolicy === "best_effort" || work.bestEffortCoverage === true) && Number(work.coveragePolicyOrder ?? 1) === coverageOrder).filter((work) => assignments.find((assignment) => text(assignment.planWorkId || `${assignment.dayOfWeek}:${assignment.workId}`) === work.key)?.status !== "ASSIGNED").length })),
    ...dailyRanked.map((item, index) => ({ name: `daily_service_effort_utilization_rank_${index + 1}`, family: "daily_leximax", rank: index + 1, value: item.value })),
    { name: "daily_stable_id_rank_tie", family: "daily_stable_tie", value: dailyRanked.reduce((total, item, rankIndex) => { const ordered = [...dailyLoads.values()].sort((left, right) => left.dayOfWeek - right.dayOfWeek || stableCompare(left.slotId, right.slotId)); return total + ((ordered.length - ordered.findIndex((source) => source.dayOfWeek === item.dayOfWeek && source.slotId === item.slotId)) * (rankIndex + 1)); }, 0) },
    ...weeklyRanked.map((item, index) => ({ name: `weekly_service_effort_utilization_rank_${index + 1}`, family: "weekly_leximax", rank: index + 1, value: item.value })),
    { name: "weekly_stable_id_rank_tie", family: "weekly_stable_tie", value: weeklyRanked.reduce((total, item, rankIndex) => { const ordered = [...weeklyLoads.keys()].sort(stableCompare); return total + ((ordered.length - ordered.indexOf(item.slotId)) * (rankIndex + 1)); }, 0) },
    { name: "incremental_directed_route_cost", family: null, value: travelCost }, { name: "accepted_baseline_disruption", family: null, value: disruption },
  ];
  const tiers = array(result.solver?.tiers);
  const certificate = result.certificate;
  const modelBasis = certificate?.modelBasis;
  const solverIdentity = certificate?.solverIdentity;
  if (!certificate || certificate.schema !== "memphis-zoo.static-weekly-solver-certificate.v4" || certificate.compilerVersion !== result.compilerVersion || certificate.verifierVersion !== VERIFIER_VERSION || certificate.objectivePolicyVersion !== "monotonic-leximax-v1") push(violations, "certificate_schema_or_identity_invalid");
  if (certificate && certificate.assignmentDigest !== sha256Hex(canonicalJson(assignments.map((assignment) => ({ planWorkId: assignment.planWorkId, status: assignment.status, slotId: assignment.slotId, serviceDate: assignment.serviceDate }))))) push(violations, "certificate_assignment_digest_mismatch");
  if (certificate && (certificate.canonicalInputDigest !== result.inputDigest || certificate.weeklyVersionDigest !== result.weeklyVersionDigest)) push(violations, "certificate_input_identity_mismatch");
  if (certificate && canonicalJson(certificate.solverIdentity) !== canonicalJson(result.solver?.identity) || certificate && canonicalJson(certificate.tiers) !== canonicalJson(tiers) || certificate && canonicalJson(certificate.options) !== canonicalJson(tiers.map((tier) => tier.options))) push(violations, "certificate_solver_receipt_binding_mismatch");
  if (!modelBasis || modelBasis.schema !== "memphis-zoo.static-weekly-model-basis.v1" || modelBasis.inputDigest !== result.inputDigest || certificate?.modelBasisDigest !== sha256Hex(canonicalJson(modelBasis))) push(violations, "model_basis_identity_invalid");
  if (modelBasis?.routeCanonicality?.schema !== STATIC_WEEKLY_ROUTE_CANONICALITY_SCHEMA
    || modelBasis?.routeCanonicality?.invariant !== "positive-fixed-windows-forward-only-dag-unique-path-v1"
    || !array(modelBasis?.routeCanonicality?.groups).every((group) => group?.positiveFixedWindows === true && group?.pathUniqueness === "every feasible selected-node set has one chronological start-to-end path" && Number.isSafeInteger(group?.forwardArcCount) && group.forwardArcCount >= 0)) push(violations, "route_canonicality_invariant_invalid");
  if (!regenerated.error) {
    if (!modelBasis || canonicalJson(modelBasis) !== canonicalJson(regenerated.modelBasis) || certificate?.modelBasisDigest !== regenerated.modelBasisDigest) push(violations, "regenerated_model_basis_mismatch");
    if (!certificate?.canonicalProgram || !canonicalProgramMatches(certificate.canonicalProgram, regenerated.descriptor)) push(violations, "regenerated_program_descriptor_mismatch");
  }
  const assignmentVariables = array(modelBasis?.assignmentVariables);
  const mutableKeys = new Set([...new Map(assignmentVariables.map((entry) => [entry.planWorkId, 0])).keys()].filter((key) => assignmentVariables.filter((entry) => entry.planWorkId === key).length > 1));
  for (const [key, work] of expected) if (work.required === false && (work.coveragePolicy === "best_effort" || work.bestEffortCoverage === true)) mutableKeys.add(key);
  const slotOrder = [...slotById.keys()].sort(stableCompare);
  for (const key of [...expected.keys()].sort(stableCompare)) if (mutableKeys.has(key)) { const assignment = assignments.find((item) => text(item.planWorkId || `${item.dayOfWeek}:${item.workId}`) === key); const encoded = `id_${key.length}_${Array.from({ length: key.length }, (_, index) => key.charCodeAt(index).toString(16).padStart(4, "0")).join("_")}`; expectedTiers.push({ name: `identity_${encoded}`, family: "stable_identity", value: assignment?.status === "ASSIGNED" ? slotOrder.indexOf(text(assignment.slotId)) + 1 : slotOrder.length + 1 }); }
  const witness = certificate?.finalWitness;
  const witnessValues = array(witness?.values);
  const witnessNames = [...array(modelBasis?.binaryVariables), ...array(modelBasis?.generalVariables)].sort(stableCompare);
  const diagnostics = array(witness?.integerDiagnostics);
  if (!witness || witness.schema !== "memphis-zoo.static-weekly-final-integer-witness.v2" || witness.digest !== sha256Hex(canonicalJson(witnessValues)) || witness.variableCount !== witnessNames.length || witnessValues.length !== witnessNames.length || diagnostics.length !== witnessNames.length || witnessValues.some((entry, index) => !Array.isArray(entry) || entry.length !== 2 || entry[0] !== witnessNames[index] || !Number.isSafeInteger(entry[1]) || (array(modelBasis?.binaryVariables).includes(entry[0]) && entry[1] !== 0 && entry[1] !== 1) || (array(modelBasis?.generalVariables).includes(entry[0]) && entry[1] < 0)) || diagnostics.some((entry, index) => entry?.variable !== witnessNames[index] || !Number.isFinite(entry.rawValue) || !Number.isSafeInteger(entry.canonicalValue) || entry.canonicalValue !== witnessValues[index][1] || !Number.isFinite(entry.residual) || entry.residual < 0 || entry.residual > MIP_FEASIBILITY_TOLERANCE || Math.abs(entry.rawValue - entry.canonicalValue) !== entry.residual)) push(violations, "final_integer_witness_invalid");
  const witnessByName = new Map(witnessValues);
  const regeneratedWitnessProgram = generateStaticWeeklySchedulingProgram(input, witnessByName, deadline);
  if (regeneratedWitnessProgram?.error?.code === "solver_timeout") return deadlineFailure("witness_program_regeneration");
  if (regeneratedWitnessProgram?.error) push(violations, "canonical_witness_program_generation_failed", { detail: regeneratedWitnessProgram.error.code || regeneratedWitnessProgram.error.message });
  for (const work of expected.values()) {
    const candidates = assignmentVariables.filter((entry) => entry.planWorkId === work.key);
    const selected = candidates.filter((entry) => witnessByName.get(entry.variable) === 1);
    const uncovered = array(modelBasis?.uncoveredVariables).find((entry) => entry.planWorkId === work.key);
    const expectedAssignment = assignments.find((entry) => text(entry.planWorkId || `${entry.dayOfWeek}:${entry.workId}`) === work.key);
    if (selected.length + Number(witnessByName.get(uncovered?.variable) || 0) !== 1) push(violations, "witness_coverage_constraint_invalid", { planWorkId: work.key });
    if (!expectedAssignment || (selected.length === 1) !== (expectedAssignment.status === "ASSIGNED") || (selected[0]?.slotId || null) !== (expectedAssignment.slotId || null)) push(violations, "witness_public_schedule_disagreement", { planWorkId: work.key });
  }
  const constraintRows = array(modelBasis?.constraints?.rows);
  if (modelBasis?.constraints?.count !== constraintRows.length || modelBasis?.constraints?.terms !== constraintRows.reduce((total, row) => total + array(row.terms).length, 0) || modelBasis?.constraints?.digest !== sha256Hex(canonicalJson(constraintRows)) || new Set(constraintRows.map((row) => row.name)).size !== constraintRows.length) push(violations, "model_constraint_manifest_invalid");
  for (const row of constraintRows) {
    if (expired()) return deadlineFailure("constraint_verification");
    const sum = array(row.terms).reduce((total, term) => total + Number(term?.[0]) * Number(witnessByName.get(term?.[1])), 0);
    if (!Number.isSafeInteger(sum) || array(row.terms).some((term) => !Array.isArray(term) || term.length !== 2 || !Number.isSafeInteger(Number(term[0])) || !witnessByName.has(term[1])) || !["=", "<=", ">="].includes(row.relation) || !Number.isSafeInteger(Number(row.value)) || (row.relation === "=" && sum !== Number(row.value)) || (row.relation === "<=" && sum > Number(row.value)) || (row.relation === ">=" && sum < Number(row.value))) push(violations, "witness_hard_constraint_violation", { constraint: row?.name || null });
  }
  if (!regenerated.error) for (const row of regenerated.modelBasis.constraints.rows) {
    if (expired()) return deadlineFailure("regenerated_constraint_verification");
    const sum = exactTerms(row.terms, witnessByName);
    const bound = Number.isSafeInteger(Number(row.value)) ? BigInt(row.value) : null;
    if (sum == null || bound == null || (row.relation === "=" && sum !== bound) || (row.relation === "<=" && sum > bound) || (row.relation === ">=" && sum < bound)) push(violations, "regenerated_witness_constraint_violation", { constraint: row.name });
  }
  const observedInitialization = solverIdentity?.initializationRecord;
  const observedInitializationBytes = observedInitialization && Buffer.from(JSON.stringify({ channel: observedInitialization.channel, text: observedInitialization.text }), "utf8");
  if (!solverIdentity || solverIdentity.package !== "highs@1.15.2" || solverIdentity.packageVersion !== "1.15.2" || solverIdentity.packageJsonSha256 !== PINNED_SOLVER_IDENTITY.packageJsonSha256 || solverIdentity.wrapperJavaScriptSha256 !== PINNED_SOLVER_IDENTITY.wrapperJavaScriptSha256 || solverIdentity.wasmSha256 !== PINNED_SOLVER_IDENTITY.wasmSha256 || solverIdentity.embeddedRuntimeBanner !== PINNED_SOLVER_IDENTITY.embeddedRuntimeBanner || !observedInitialization || !["print", "printErr"].includes(observedInitialization.channel) || typeof observedInitialization.text !== "string" || !observedInitialization.text.startsWith(`Running ${PINNED_SOLVER_IDENTITY.embeddedRuntimeBanner}: Copyright`) || observedInitialization.utf8Base64 !== observedInitializationBytes?.toString("base64") || observedInitialization.utf8Sha256 !== sha256Hex(observedInitializationBytes) || solverIdentity.initializationBannerUtf8Sha256 !== sha256Hex(observedInitializationBytes)) push(violations, "solver_identity_invalid");
  if (result.status === "FEASIBLE" && (!certificate || solverIdentity?.resultEvidenceCapabilities?.bestBound !== true || solverIdentity?.resultEvidenceCapabilities?.mipGap !== true || solverIdentity?.resultEvidenceCapabilities?.distinctTermination !== true || solverIdentity?.resultEvidenceCapabilities?.source !== "terminal_solver_report")) push(violations, "solver_evidence_capability_missing");
  const canonicalTierShape = regenerated.error ? expectedTiers : regenerated.objectives;
  if (tiers.length !== canonicalTierShape.length) push(violations, "tier_count_mismatch", { expected: canonicalTierShape.length, actual: tiers.length });
  canonicalTierShape.forEach((expectedTier, index) => {
    if (expired()) { push(violations, "solver_timeout", { stage: "tier_verification" }); return; }
    const actual = tiers[index]; const regeneratedTier = regeneratedWitnessProgram?.tiers?.[index];
    const expectedObjective = regeneratedTier?.objective || expectedTier;
    const expectedBindings = regeneratedWitnessProgram?.bindings?.slice(0, index) || [];
    const expectedModel = { schema: "memphis-zoo.static-weekly-tier-model.v1", basisDigest: regeneratedTier?.model?.modelBasisDigest || certificate?.modelBasisDigest, objective: { name: expectedObjective.name, family: expectedObjective.family || null, rank: expectedObjective.rank ?? null, terms: expectedObjective.terms }, priorBindings: expectedBindings };
    const allowedTierFields = new Set(["index", "name", "family", "rank", "objectiveExpression", "objectiveExpressionDigest", "objectiveValue", "modelBasisDigest", "modelDigest", "priorBindings", "priorBindingDigest", "preflight", "options", "attestation"]);
    if (!actual || !regeneratedTier || Object.keys(actual).some((key) => !allowedTierFields.has(key)) || actual.index !== index || actual.name !== expectedObjective.name || actual.family !== (expectedObjective.family ?? null) || (expectedObjective.rank ?? null) !== (actual.rank ?? null) || actual.modelBasisDigest !== regeneratedTier.model.modelBasisDigest || canonicalJson(actual.objectiveExpression?.terms) !== canonicalJson(expectedObjective.terms) || actual.objectiveExpressionDigest !== sha256Hex(canonicalJson({ terms: expectedObjective.terms })) || actual.priorBindingDigest !== sha256Hex(canonicalJson(actual.priorBindings)) || canonicalJson(actual.priorBindings) !== canonicalJson(expectedBindings) || actual.modelDigest !== sha256Hex(canonicalJson(expectedModel))) { push(violations, "solver_tier_receipt_invalid", { tier: expectedObjective.name }); return; }
    const witnessObjective = exactTerms(expectedObjective.terms, witnessByName);
    if (witnessObjective == null || witnessObjective !== BigInt(actual.objectiveValue) || witnessObjective !== BigInt(regeneratedTier.value) || expectedBindings.some((binding) => exactTerms(binding.terms, witnessByName) !== BigInt(binding.value))) push(violations, "witness_tier_expression_or_prior_binding_invalid", { tier: expectedObjective.name });
    if (actual.options?.output_flag !== true || actual.options?.threads !== 1 || actual.options?.random_seed !== 0 || actual.options?.mip_rel_gap !== 0 || actual.options?.mip_abs_gap !== 0 || actual.options?.mip_feasibility_tolerance !== 1e-9 || actual.options?.presolve !== "on" || actual.options?.parallel !== "off" || !Number.isFinite(actual.options?.time_limit) || actual.options.time_limit <= 0 || actual.options.time_limit > 30) push(violations, "solver_options_invalid", { tier: expectedTier.name });
    if (canonicalJson(actual.attestation?.workerModelAttestation) !== canonicalJson({ schema: "memphis-zoo.static-weekly-worker-model-attestation.v1", modelDigest: regeneratedTier.model.modelDigest, modelBasisDigest: regeneratedTier.model.modelBasisDigest, priorBindingDigest: regeneratedTier.model.priorBindingDigest })) push(violations, "worker_model_attestation_invalid", { tier: expectedObjective.name });
    const terminalErrors = verifyTerminalAttestation(actual.attestation, regeneratedTier.value, solverIdentity, actual.options);
    if (terminalErrors.length) push(violations, "solver_attestation_invalid", { tier: expectedTier.name, terminalErrors });
    if (!Number.isSafeInteger(Number(actual.objectiveValue)) || Number(actual.objectiveValue) !== regeneratedTier.value) push(violations, "objective_value_mismatch", { tier: expectedObjective.name, expected: regeneratedTier.value, actual: actual.objectiveValue });
  });
  const derivedReviewWork = assignments.filter((assignment) => assignment.status !== "ASSIGNED" && expected.get(text(assignment.planWorkId || `${assignment.dayOfWeek}:${assignment.workId}`))?.required !== false);
  const derivedOpenWork = assignments.filter((assignment) => assignment.status !== "ASSIGNED" && expected.get(text(assignment.planWorkId || `${assignment.dayOfWeek}:${assignment.workId}`))?.required === false).map((assignment) => {
    const work = expected.get(text(assignment.planWorkId || `${assignment.dayOfWeek}:${assignment.workId}`));
    const bestEffort = work?.coveragePolicy === "best_effort" || work?.bestEffortCoverage === true;
    return { ...assignment, openPolicy: bestEffort ? "best_effort" : "permitted_open", coveragePolicyOrder: bestEffort ? Number(work.coveragePolicyOrder ?? 1) : null };
  });
  const derivedStatus = derivedReviewWork.length ? "REVIEW" : "FEASIBLE";
  const derivedAuthority = derivedStatus === "FEASIBLE" ? "ACCEPTABLE" : "REVIEW";
  if (canonicalJson(array(result.reviewWork)) !== canonicalJson(derivedReviewWork) || canonicalJson(array(result.openWork)) !== canonicalJson(derivedOpenWork) || result.status !== derivedStatus || result.publicationAuthority !== derivedAuthority) push(violations, "derived_review_open_or_status_mismatch");
  if (result.status === "FEASIBLE" && violations.length) push(violations, "publishable_result_is_not_verified");
  const metrics = {
    dutySemantics: {
      service: "fixed accepted-stop and work coverage windows; provenanced service effort remains the equity resource",
      travel: "every directed arc in the one chronological route",
      waiting: "fixed-window non-effort commitment plus non-protected inter-stop slack",
      protected: "lunch and unavailable intervals; excluded from productive capacity and total duty",
      totalDuty: "service effort + directed travel + committed waiting = route span - protected time",
    },
    daily,
    weekly: { resource: "total provenanced accepted-stop and inserted service effort / total verified productive capacity", normalizedInequity: weeklyInequity, normalizedLoads: Object.fromEntries([...weeklyUtilization.entries()].sort(([a], [b]) => stableCompare(a, b))), provenancedEffortMinutes: Object.fromEntries([...weeklyLoads.entries()].sort(([a], [b]) => stableCompare(a, b)).map(([slotId, value]) => [slotId, value.effort])), productiveCapacityMinutes: Object.fromEntries([...weeklyLoads.entries()].sort(([a], [b]) => stableCompare(a, b)).map(([slotId, value]) => [slotId, value.capacity])), incrementalDirectedRouteCost: travelCost, disruption, uncoveredByPriority: Object.fromEntries([...priorityUncovered.entries()].sort(([a], [b]) => b - a)) },
  };
  if (authority && postgresJsonbContentDigest(authority.optimizerResult?.metrics) !== postgresJsonbContentDigest(metrics)) push(violations, "canonical_duty_metrics_mismatch");
  const digest = contentDigest({ verifierVersion: VERIFIER_VERSION, assignments: assignments.map((item) => ({ planWorkId: item.planWorkId, status: item.status, slotId: item.slotId })), metrics, violations });
  return {
    ok: violations.length === 0, violations, metrics, digest, verifierVersion: VERIFIER_VERSION,
    evidence: {
      independent: "canonical input, dated identity, coverage, eligibility, combined route, travel, service, duty, and objective values were recomputed without trusting optimizer owner branches",
      solverOptimality: "returned solver fields are only attestation; capability, exact witness, rank, prior-binding, and model identities are checked without importing the optimizer",
      independentlyProvesOptimality: false,
    },
  };
}
