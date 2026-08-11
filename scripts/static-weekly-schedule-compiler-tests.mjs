import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { compileStaticWeeklySchedule, postgresJsonbCanonicalText, postgresJsonbContentDigest, STATIC_WEEKLY_SERVER_LIMITS, verifyStaticWeeklyReplay } from "../src/static-weekly-schedule-compiler.js";
import { verifyStaticWeeklyScheduleResult } from "../src/static-weekly-schedule-verifier.js";
import { initializeStaticWeeklySolver, setStaticWeeklySolverTestOverride, solveStaticWeeklyMip } from "../src/static-weekly-schedule-solver.js";
import { admitStaticWeeklyRawInput, canonicalSolverAuthorityCertificate, canonicalSolverAuthorityTierProjection, createStaticWeeklyDeadline, monotonicNowMilliseconds, prepareStaticWeeklySchedulingProblem, remainingStaticWeeklyMilliseconds } from "../src/static-weekly-schedule-program.js";
import { validateStaticWeeklyPacket } from "./static-weekly-schedule-candidate-importer.mjs";

const clone = (value) => JSON.parse(JSON.stringify(value));
const rawReceiptDigest = (tier) => createHash("sha256").update(JSON.stringify({ schema: "memphis-zoo.static-weekly-raw-solver-receipt.v1", options: tier.options, terminalReport: tier.attestation.terminalReport })).digest("hex");
const candidateWorkbook = JSON.parse(fs.readFileSync(new URL("./fixtures/static-weekly-scheduler/candidate-workbook-authority.json", import.meta.url), "utf8"));
const compile = async (value) => compileStaticWeeklySchedule(clone(value));

function availability(slotId, anchor, extra = {}) {
  return { slotId, dayOfWeek: 1, status: "working", shift: { start: "07:00", end: "16:00" }, productiveCapacityProvenance: "verified-shift-lunch-v1", maxServiceEffortMinutes: 300, maxServiceEffortProvenance: "verified-maximum-v1", qualifications: ["general", "restroom"], qualificationProvenance: "credential-v1", restrictions: [], restrictionProvenance: "restriction-v1", acceptedRouteAnchorLocationId: anchor, acceptedRouteProvenance: "accepted-route-v1", ...extra };
}
function work(workId, locationId, start, end, ownerSlotId, extra = {}) {
  return { workId, dayOfWeek: 1, locationId, window: { start, end }, ownerSlotId, serviceEffortMinutes: 20, serviceEffortProvenance: "time-study-v1", priority: 2, priorityProvenance: "priority-policy-v1", requiredQualifications: ["general"], qualificationProvenance: "work-qualification-v1", restrictions: [], restrictionProvenance: "work-restriction-v1", ...extra };
}
function smallInput({ slots = ["a", "b"], availabilities = null, assignments = null, proximity = null, exceptions = [] } = {}) {
  return {
    serviceDate: "2026-08-10", timezone: "America/Chicago", exceptions, proximity: proximity || [
      { from: "A", to: "B", minutes: 1, verified: true, bidirectional: true, provenance: "walk-study-v1" },
      { from: "A", to: "C", minutes: 1, verified: true, bidirectional: true, provenance: "walk-study-v1" },
      { from: "B", to: "C", minutes: 1, verified: true, bidirectional: true, provenance: "walk-study-v1" },
    ],
    slots: slots.map((id) => ({ id, label: `slot-${id}`, incumbencies: [{ personId: `person-${id}`, displayName: `Worker ${id}`, effectiveStart: "2020-01-01", effectiveEnd: null }] })),
    versions: [{ id: "test-week", publicationId: "test-publication", status: "published", effectiveStart: "2026-08-03", effectiveEnd: null, objective: { requireVerifiedProximity: true }, slotAvailability: availabilities || slots.map((id, index) => availability(id, ["A", "B", "C"][index] || "A")), assignments: assignments || [work("one", "A", "08:00", "09:00", slots[0]), work("two", "B", "09:10", "10:00", slots[1] || slots[0])]}],
  };
}

async function runPhysicalScaleFixture() {
  const working = ["a", "b", "e", "f"]; const departed = ["departed-c", "departed-d"];
  const physical = smallInput({ slots: [...working, ...departed], assignments: [], availabilities: [], proximity: [] });
  physical.versions[0].namedAbsentSlotIds = departed;
  physical.proximity = ["A", "B", "C", "D"].flatMap((from, fromIndex) => ["A", "B", "C", "D"].filter((to) => to !== from).map((to, toIndex) => ({ from, to, minutes: 1 + ((fromIndex * 3 + toIndex) % 4), verified: true, provenance: "physical-directed-walk-study-v1" })));
  physical.versions[0].slotAvailability = Array.from({ length: 7 }, (_, day) => working.map((slotId, index) => availability(slotId, ["A", "B", "C", "D"][index], {
    dayOfWeek: day, maxDutyMinutes: 450, maxDutyProvenance: "physical-duty-v1",
    // Every worker has the common redistribution credential. The first item
    // on each of the first three days adds a two-worker pool credential; later
    // items use explicit owners to keep the full physical model bounded.
    qualifications: ["general", "redistribution", index < 2 ? "redistribution-pool-0" : "redistribution-pool-1", `redistribution-slot-${slotId}`],
    lunch: { start: "12:00", end: "12:30" }, blockedWindows: [{ start: "14:30", end: "14:45" }],
    ...(index === 0 ? { acceptedRoute: { startLocationId: ["A", "B", "C", "D"][index], provenance: "physical-accepted-route-v1", stops: [{ stopId: `baseline-${slotId}-${day}`, locationId: ["A", "B", "C", "D"][index], window: { start: "07:15", end: "07:30" }, serviceEffortMinutes: 10, serviceEffortProvenance: "physical-baseline-service-v1", provenance: "physical-accepted-route-v1" }] } } : {}),
  }))).flat();
  const windows = [["08:00", "08:30"], ["09:15", "09:45"], ["10:30", "11:00"], ["13:30", "14:00"]];
  physical.versions[0].assignments = Array.from({ length: 7 }, (_, day) => windows.map(([start, end], index) => work(`redistributed-${day}-${index}`, ["A", "B", "C", "D"][(day + index) % 4], start, end, departed[(day + index) % 2], {
    dayOfWeek: day, serviceEffortMinutes: 20 + (index * 2),
    // The first item of each day has two genuine pool candidates.  The rest
    // remain physically feasible workload with stable, explicit owners; this
    // keeps the full seven-day model small without erasing redistribution
    // choice from the evidence.
    requiredQualifications: ["redistribution", ...(index === 0 && day < 3 ? [`redistribution-pool-${day % 2}`] : [`redistribution-slot-${working[(day + index) % working.length]}`])],
    ...(day === 6 && index === 3 ? { required: false, coveragePolicy: "best_effort", bestEffortCoverage: true, coveragePolicyOrder: 1, coveragePolicyProvenance: "physical-best-effort-policy-v1", requiredQualifications: ["unavailable-optional-credential"] } : {}),
  }))).flat();
  assert.equal(physical.versions[0].slotAvailability.filter((entry) => entry.status === "working").length, 28, "four working employees are present on every scheduled day");
  assert.equal(physical.versions[0].assignments.length, 28, "physical-scale fixture carries at least 28 seven-day work items");
  assert.equal(physical.versions[0].assignments.filter((entry) => departed.includes(entry.ownerSlotId)).length >= 20, true, "departed slots remain named demand origins rather than deleted roster entries");
  const asymmetricArc = physical.proximity.find((edge) => physical.proximity.find((reverse) => reverse.from === edge.to && reverse.to === edge.from && reverse.minutes !== edge.minutes));
  assert.ok(asymmetricArc, "physical fixture contains asymmetric directed proximity evidence");
  const firstRequestStartedAt = performance.now();
  const result = await compile(physical);
  const firstRequestElapsedMilliseconds = performance.now() - firstRequestStartedAt;
  if (result.status !== "FEASIBLE") console.log(JSON.stringify({ physicalScaleFailure: result.fatal }));
  assert.equal(result.status, "FEASIBLE"); assert.equal(result.publicationAuthority, "ACCEPTABLE");
  const assignmentVariables = result.certificate.modelBasis.assignmentVariables;
  const candidateCounts = Object.fromEntries(result.weeklyAssignments.map((item) => [item.planWorkId, assignmentVariables.filter((candidate) => candidate.planWorkId === item.planWorkId).length]));
  const requiredPlanWorkIds = new Set(physical.versions[0].assignments.filter((item) => item.required !== false).map((item) => `${item.dayOfWeek}:${item.workId}`));
  const requiredCandidateCounts = result.weeklyAssignments.filter((item) => requiredPlanWorkIds.has(item.planWorkId)).map((item) => candidateCounts[item.planWorkId]);
  assert.equal(requiredCandidateCounts.filter((count) => count >= 2).length >= 3, true, "several departed-origin required items retain at least two genuine feasible owners");
  console.log(JSON.stringify({ physicalProgram: { preflight: result.certificate.execution.preflight, objectiveCount: result.solver.tiers.length, requiredCandidateCounts, asymmetricDirectedArc: asymmetricArc } }));
  assert.equal(result.weeklyAssignments.filter((item) => item.status === "ASSIGNED").length >= 20, true, "multiple departed-origin work items were genuinely redistributed");
  assert.equal(result.weeklyAssignments.some((item) => item.status === "ASSIGNED" && candidateCounts[item.planWorkId] >= 2), true, "a final owner is selected from the generated multi-candidate universe");
  assert.equal(result.openWork.some((item) => item.status === "OPEN"), true, "policy-permitted optional work has an explicit OPEN state");
  assert.equal(result.metrics.daily.every((day) => day.loads.length === 4), true, "daily leximax ranks include every working employee");
  assert.equal(result.solver.tiers.some((tier) => tier.family === "daily_leximax"), true, "daily equity ranks bind the schedule");
  assert.equal(result.solver.tiers.some((tier) => tier.family === "weekly_leximax"), true, "weekly equity ranks bind the schedule");
  assert.equal(result.solver.tiers.some((tier) => tier.name === "incremental_directed_route_cost"), true, "directed proximity tier binds the schedule");
  assert.equal(Number.isFinite(result.metrics.weekly.incrementalDirectedRouteCost), true, "directed route metric is projected from the final witness");
  assert.equal(result.certificate.execution.solveCount <= STATIC_WEEKLY_SERVER_LIMITS.maxStagedSolves, true); assert.equal(result.certificate.execution.receiptBytes <= STATIC_WEEKLY_SERVER_LIMITS.maxCompactReceiptBytes, true); assert.equal(result.certificate.execution.durationMilliseconds <= 30_000, true); assert.equal(firstRequestElapsedMilliseconds <= 30_000, true, "the canonical physical compile request remains within its 30-second contract");
  assert.equal(verifyStaticWeeklyScheduleResult(physical, result).ok, true, "physical-scale receipt verifies from canonical authority input");
  const permutedPhysical = clone(physical);
  permutedPhysical.slots.reverse();
  permutedPhysical.versions[0].assignments.reverse();
  permutedPhysical.versions[0].slotAvailability.reverse();
  permutedPhysical.proximity.reverse();
  const secondRequestStartedAt = performance.now();
  const replay = await verifyStaticWeeklyReplay(permutedPhysical, result.replayDigest);
  const secondRequestElapsedMilliseconds = performance.now() - secondRequestStartedAt;
  const permutedResult = replay.result;
  assert.equal(replay.ok, true, "the physical input-order permutation has the same canonical replay digest");
  assert.equal(permutedResult.canonicalReplay, result.canonicalReplay, "the physical input-order permutation has the same canonical replay payload");
  assert.equal(verifyStaticWeeklyScheduleResult(permutedPhysical, permutedResult).ok, true, "permuted physical-scale receipt verifies from canonical authority input");
  assert.equal(permutedResult.certificate.execution.durationMilliseconds <= 30_000, true);
  assert.equal(secondRequestElapsedMilliseconds <= 30_000, true, "the permuted physical compile request remains within its 30-second contract");
  const requestMetrics = (value, requestElapsedMilliseconds) => ({ variables: value.certificate.execution.modelVariables, rows: value.certificate.execution.modelRows, terms: value.certificate.execution.modelTerms, solveCount: value.certificate.execution.solveCount, modelBytes: value.certificate.execution.modelBytes, workerOutputBytes: value.certificate.execution.workerOutputBytes, receiptBytes: value.certificate.execution.receiptBytes, resultBytes: value.certificate.execution.resultBytes, solverDurationMilliseconds: value.certificate.execution.durationMilliseconds, requestElapsedMilliseconds, replayDigest: value.replayDigest });
  console.log(JSON.stringify({ physicalScale: { canonicalRequest: requestMetrics(result, firstRequestElapsedMilliseconds), permutedRequest: requestMetrics(permutedResult, secondRequestElapsedMilliseconds), replayDigest: result.replayDigest, candidateCounts, selectedMultiCandidateOwner: result.weeklyAssignments.find((item) => item.status === "ASSIGNED" && candidateCounts[item.planWorkId] >= 2)?.planWorkId, asymmetricDirectedArc: asymmetricArc } }));
}
if (process.env.STATIC_WEEKLY_PHYSICAL_SCALE === "1") { await runPhysicalScaleFixture(); console.log("static weekly physical-scale fixture: PASS"); process.exit(0); }

// The supplied workbook is bounded candidate evidence, never a production
// fixture.  Its UUID source facts are useful without inventing the two absent
// incumbents, and it cannot enter a publication path until a verified packet.
assert.equal(validateStaticWeeklyPacket(candidateWorkbook).ok, true);
assert.equal(validateStaticWeeklyPacket({ ...candidateWorkbook, admission: { ...candidateWorkbook.admission, canaryReady: true } }).ok, false);
assert.equal(candidateWorkbook.unresolved.absentUntilReplacedStableSlots.length, 2);

const solverIdentity = await initializeStaticWeeklySolver();
// Monotonic budget evidence: a wall-clock jump is irrelevant to the request
// deadline, while an already-expired monotonic deadline fails before raw
// admission, preparation, cloning or queueing can extend the request.
const originalDateNow = Date.now; const deadlineProbe = createStaticWeeklyDeadline(1_000); const beforeWallJump = remainingStaticWeeklyMilliseconds(deadlineProbe);
Date.now = () => originalDateNow() + 86_400_000;
const afterForwardWallJump = remainingStaticWeeklyMilliseconds(deadlineProbe);
Date.now = () => originalDateNow() - 86_400_000;
const afterBackwardWallJump = remainingStaticWeeklyMilliseconds(deadlineProbe);
Date.now = originalDateNow;
assert.equal(afterForwardWallJump > 0 && afterBackwardWallJump > 0 && Math.abs(beforeWallJump - afterForwardWallJump) < 100 && Math.abs(beforeWallJump - afterBackwardWallJump) < 100, true, "wall-clock jumps do not alter monotonic request budget");
assert.equal(admitStaticWeeklyRawInput({ irrelevant: { nested: true } }, monotonicNowMilliseconds() - 1).code, "solver_timeout", "expired shared deadline includes raw preparation admission");
const rawCode = (value) => admitStaticWeeklyRawInput(value).code || null;
const atDepth = (depth) => { let value = null; for (let index = 0; index < depth; index += 1) value = { nested: value }; return value; };
const atNodeCount = (count) => {
  const childCount = Math.ceil((count - 1) / STATIC_WEEKLY_SERVER_LIMITS.maxArrayEntriesPerNode);
  const leaves = count - 1 - childCount;
  const entries = []; let remaining = leaves;
  for (let index = 0; index < childCount; index += 1) { const length = Math.min(STATIC_WEEKLY_SERVER_LIMITS.maxArrayEntriesPerNode, remaining); entries.push(Array.from({ length }, () => null)); remaining -= length; }
  return entries;
};
const atEstimatedBytes = (bytes) => {
  const count = 100; const rawBytes = bytes - ((3 * count) + 1); const each = Math.floor(rawBytes / count); const extra = rawBytes - (each * count);
  return Array.from({ length: count }, (_, index) => "x".repeat(each + (index === count - 1 ? extra : 0)));
};
assert.equal(rawCode(atDepth(STATIC_WEEKLY_SERVER_LIMITS.maxInputDepth)), null, "raw depth exact limit is admitted");
assert.equal(rawCode(atDepth(STATIC_WEEKLY_SERVER_LIMITS.maxInputDepth + 1)), "input_depth_limit", "raw depth limit plus one fails before clone");
assert.equal(rawCode(atNodeCount(STATIC_WEEKLY_SERVER_LIMITS.maxInputNodes)), null, "raw node exact limit is admitted");
assert.equal(rawCode(atNodeCount(STATIC_WEEKLY_SERVER_LIMITS.maxInputNodes + 1)), "input_node_limit", "raw node limit plus one fails before expansion");
const exactKeys = Object.fromEntries(Array.from({ length: STATIC_WEEKLY_SERVER_LIMITS.maxObjectKeysPerNode }, (_, index) => [`k${index}`, null]));
const overKeys = { ...exactKeys, over: null };
assert.equal(rawCode(exactKeys), null, "raw object-key exact limit is admitted");
assert.equal(rawCode(overKeys), "input_object_key_limit", "raw object-key limit plus one fails");
assert.equal(rawCode(Array.from({ length: STATIC_WEEKLY_SERVER_LIMITS.maxArrayEntriesPerNode }, () => null)), null, "raw array-entry exact limit is admitted");
assert.equal(rawCode(Array.from({ length: STATIC_WEEKLY_SERVER_LIMITS.maxArrayEntriesPerNode + 1 }, () => null)), "input_array_entry_limit", "raw array-entry limit plus one fails");
const rawLimitText = "x".repeat(STATIC_WEEKLY_SERVER_LIMITS.maxStringBytes);
assert.equal(rawCode({ irrelevant: rawLimitText }), null, "raw string exact limit is admitted before materialization");
assert.equal(rawCode({ irrelevant: `${rawLimitText}x` }), "input_string_byte_limit", "raw string limit plus one fails closed even when irrelevant");
const rawLimitKey = "k".repeat(STATIC_WEEKLY_SERVER_LIMITS.maxKeyBytes);
assert.equal(rawCode({ [rawLimitKey]: null }), null, "raw key-byte exact limit is admitted");
assert.equal(rawCode({ [`${rawLimitKey}k`]: null }), "input_key_byte_limit", "raw key-byte limit plus one fails");
assert.equal(rawCode(atEstimatedBytes(STATIC_WEEKLY_SERVER_LIMITS.maxInputBytes)), null, "raw estimated-byte exact limit is admitted");
assert.equal(rawCode(atEstimatedBytes(STATIC_WEEKLY_SERVER_LIMITS.maxInputBytes + 1)), "input_estimated_byte_limit", "raw estimated-byte limit plus one fails");
const cyclicRaw = { nested: {} }; cyclicRaw.nested.self = cyclicRaw;
assert.equal(admitStaticWeeklyRawInput(cyclicRaw).code, "input_cycle", "cyclic raw input fails closed");
assert.equal(admitStaticWeeklyRawInput({ exotic: new Date() }).code, "non_plain_input_structure", "non-plain raw input fails closed");
const sparseRaw = []; sparseRaw[1] = null;
  assert.equal(rawCode(sparseRaw), "unsupported_input_array_hole", "sparse arrays fail closed");
  for (const unsupported of [undefined, 1n, Symbol("raw"), () => {}, Number.NaN, Number.POSITIVE_INFINITY]) assert.equal(rawCode({ unsupported }), "unsupported_input_value", "unsupported scalar values fail before clone");
  let arrayAccessorReads = 0; const arrayAccessorRaw = [];
  Object.defineProperty(arrayAccessorRaw, 0, { enumerable: true, get() { arrayAccessorReads += 1; return null; } });
  assert.equal(rawCode(arrayAccessorRaw), "unsupported_input_accessor", "array index accessors fail closed before traversal");
  assert.equal(arrayAccessorReads, 0, "raw array traversal never executes an own index getter");
  let accessorReads = 0; const accessorRaw = {};
Object.defineProperty(accessorRaw, "versions", { enumerable: true, get() { accessorReads += 1; return []; } });
assert.equal(rawCode(accessorRaw), "unsupported_input_accessor", "getters and setters are rejected in raw admission");
assert.equal(accessorReads, 0, "raw admission never executes a rejected getter");
const setterRaw = {}; let setterWrites = 0;
Object.defineProperty(setterRaw, "versions", { enumerable: true, set() { setterWrites += 1; } });
  assert.equal(rawCode(setterRaw), "unsupported_input_accessor", "setter-only properties fail raw admission");
  assert.equal(setterWrites, 0, "raw admission never executes a rejected setter");
  let rejectedServiceDateReads = 0; const rejectedServiceDate = { versions: [] };
  Object.defineProperty(rejectedServiceDate, "serviceDate", { enumerable: true, get() { rejectedServiceDateReads += 1; return "2026-08-10"; } });
  const rejectedServiceDateResult = await compileStaticWeeklySchedule(rejectedServiceDate);
  assert.equal(rejectedServiceDateResult.fatal.code, "unsupported_input_accessor", "compiler preserves the raw-admission rejection code");
  assert.equal(rejectedServiceDateResult.serviceDate, null, "pre-admission failure carries no reread service date");
  assert.equal(rejectedServiceDateReads, 0, "compiler never rereads rejected serviceDate accessors while building a failure result");
  assert.throws(() => prepareStaticWeeklySchedulingProblem({}, monotonicNowMilliseconds() - 1), (error) => error.code === "solver_timeout", "an expired absolute deadline blocks preparation itself");

// This is deliberately a mechanical search over the emitted authority graph,
// not a solver-order assumption.  For every bounded work-node selection it
// enumerates every start-to-end route containing exactly that selection.  A
// second route for one fixed selected-node set is a counterexample to the
// shared positive-window/forward-DAG canonicality invariant.
function boundedRouteCanonicalitySearch(modelBasis) {
  let selectedNodeSets = 0; let feasiblePaths = 0;
  for (const group of modelBasis.routeGroups) {
    const start = group.nodes.find((node) => node.kind === "start"); const end = group.nodes.find((node) => node.kind === "end");
    const fixed = group.nodes.filter((node) => node.kind === "accepted"); const workNodes = group.nodes.filter((node) => node.kind === "work");
    assert.ok(start && end && workNodes.length <= 8, "route counterexample search stays intentionally bounded");
    const arcPairs = new Set(group.arcs.map((arc) => `${arc.from}\u0000${arc.to}`));
    for (let mask = 0; mask < (1 << workNodes.length); mask += 1) {
      const selected = [...fixed, ...workNodes.filter((_node, index) => (mask & (1 << index)) !== 0)]; selectedNodeSets += 1;
      const count = (current, remaining) => {
        if (!remaining.length) return arcPairs.has(`${current.id}\u0000${end.id}`) ? 1 : 0;
        return remaining.reduce((total, next, index) => total + (arcPairs.has(`${current.id}\u0000${next.id}`) ? count(next, [...remaining.slice(0, index), ...remaining.slice(index + 1)]) : 0), 0);
      };
      const paths = count(start, selected); feasiblePaths += paths;
      assert.equal(paths <= 1, true, `route canonicality counterexample: ${group.daySlot} selected mask ${mask} has ${paths} chronological paths`);
    }
  }
  return { selectedNodeSets, feasiblePaths };
}
const supportsPublicationAttestation = solverIdentity.resultEvidenceCapabilities.bestBound === true && solverIdentity.resultEvidenceCapabilities.mipGap === true && solverIdentity.resultEvidenceCapabilities.distinctTermination === true;
if (supportsPublicationAttestation) {
const authorityInput = smallInput();
const authoritative = await compile(authorityInput);
assert.equal(authoritative.status, "FEASIBLE");
assert.equal(authoritative.verifier.ok, true);
assert.equal(authoritative.solver.tiers.every((tier) => tier.attestation?.evidenceSource === "terminal_solver_report" && tier.attestation?.objectStatus === "Optimal" && tier.attestation?.reportStatus === "Optimal" && tier.attestation?.normalized?.gap?.canonical === "0e0" && tier.attestation?.terminalReport?.records?.[0]?.text === "Solving report" && tier.attestation?.terminalReport?.records?.at(-1)?.text === "Writing the solution to solution.txt"), true);
assert.equal(authoritative.solver.tiers.every((tier) => tier.attestation.terminalReport.records.some((record) => /^\s*P-D integral\s+/i.test(record.text))), true, "returned solver receipts retain the worker's measured terminal report rows");
assert.equal(authoritative.solver.tiers.every((tier) => Number.isFinite(tier.options?.time_limit) && tier.options.time_limit > 0 && tier.options.time_limit <= 30), true, "returned solver receipts retain each actual bounded worker deadline");
assert.equal(authoritative.solver.tiers.every((tier) => tier.attestation.rawReceiptDigest === rawReceiptDigest(tier)), true, "worker-origin receipt fingerprints bind every returned option and terminal-report byte");
assert.deepEqual(authoritative.certificate.tiers, authoritative.solver.tiers, "certificate receipts retain the complete returned worker reports without a second projection");
assert.deepEqual(authoritative.certificate.options, authoritative.solver.tiers.map((tier) => tier.options), "certificate receipts retain the complete returned worker options without a second projection");
assert.equal(authoritative.canonicalAuthority.optimizerResult.tiers.every((tier) => !tier.attestation?.terminalReport && !tier.attestation?.rawReceiptDigest && tier.options?.time_limit == null), true, "immutable authority tiers exclude per-execution timing telemetry");
assert.equal(authoritative.canonicalAuthority.optimizerResult.certificate.tiers.every((tier) => !tier.attestation?.terminalReport && !tier.attestation?.rawReceiptDigest && tier.options?.time_limit == null), true, "immutable certificate tiers exclude per-execution timing telemetry");
assert.equal(authoritative.canonicalAuthority.optimizerResult.certificate.options.every((options) => options.time_limit == null), true, "immutable certificate options exclude remaining request deadlines");
const missingReceiptCertificate = clone(authoritative); delete missingReceiptCertificate.certificate;
assert.equal(verifyStaticWeeklyScheduleResult(authorityInput, missingReceiptCertificate).ok, false, "a missing diagnostic certificate fails closed without crashing authority projection verification");

// Weekday admission happens before every fixed seven-day projection.  The
// exact endpoints remain valid while strings, fractions, and out-of-domain
// values fail instead of disappearing from source work or availability.
for (const invalidDay of [-1, 7, 1.5, "1"]) {
  const assignmentDay = smallInput(); assignmentDay.versions[0].assignments[0].dayOfWeek = invalidDay;
  assert.equal(prepareStaticWeeklySchedulingProblem(assignmentDay).error.code, "invalid_weekday_domain", `assignment weekday ${String(invalidDay)} rejects before projection`);
  const availabilityDay = smallInput(); availabilityDay.versions[0].slotAvailability[0].dayOfWeek = invalidDay;
  assert.equal(prepareStaticWeeklySchedulingProblem(availabilityDay).error.code, "invalid_weekday_domain", `availability weekday ${String(invalidDay)} rejects before projection`);
}
for (const boundaryDay of [0, 6]) {
  const boundary = smallInput();
  boundary.versions[0].assignments.forEach((item) => { item.dayOfWeek = boundaryDay; });
  boundary.versions[0].slotAvailability.forEach((item) => { item.dayOfWeek = boundaryDay; });
  assert.equal(prepareStaticWeeklySchedulingProblem(boundary).error, undefined, `canonical weekday ${boundaryDay} is retained`);
}

const retention = smallInput({ assignments: [], availabilities: [] });
retention.versions[0].slotAvailability = [0, 6].flatMap((day) => [availability("a", "A", { dayOfWeek: day }), availability("b", "B", { dayOfWeek: day })]);
retention.versions[0].assignments = [
  work("repeat-work", "A", "08:00", "09:00", "a", { dayOfWeek: 0 }),
  work("repeat-work", "B", "09:10", "10:00", "b", { dayOfWeek: 6 }),
];
const retentionResult = await compile(retention);
assert.equal(retentionResult.verifier.ok, true);
assert.deepEqual(retentionResult.weeklyAssignments.map((item) => [item.planWorkId, item.status]), [["0:repeat-work", "ASSIGNED"], ["6:repeat-work", "ASSIGNED"]], "every non-cancelled day:work source identity has exactly one optimizer row");

const semanticCanonical = clone(retention);
semanticCanonical.versions[0].namedAbsentSlotIds = ["b", "a"];
semanticCanonical.versions[0].slotAvailability[0].qualifications = ["restroom", "general", "restroom"];
semanticCanonical.versions[0].slotAvailability[0].restrictions = ["unused-b", "unused-a", "unused-b"];
semanticCanonical.versions[0].slotAvailability[0].blockedWindows = [{ start: "11:30", end: "11:40" }, { start: "11:00", end: "11:10" }];
semanticCanonical.versions[0].assignments[0].requiredQualifications = ["restroom", "general", "restroom"];
semanticCanonical.versions[0].assignments[0].restrictions = ["unused-b", "unused-a", "unused-b"];
semanticCanonical.versions[0].assignments[0].restrictedSlotIds = ["b", "b"];
const semanticPermutation = clone(semanticCanonical);
semanticPermutation.slots.reverse(); semanticPermutation.versions[0].assignments.reverse(); semanticPermutation.versions[0].slotAvailability.reverse();
semanticPermutation.versions[0].namedAbsentSlotIds.reverse();
for (const entry of semanticPermutation.versions[0].slotAvailability) {
  entry.qualifications?.reverse(); entry.restrictions?.reverse(); entry.blockedWindows?.reverse();
}
for (const item of semanticPermutation.versions[0].assignments) {
  item.requiredQualifications?.reverse(); item.restrictions?.reverse(); item.restrictedSlotIds?.reverse();
}
const semanticCanonicalResult = await compile(semanticCanonical);
const semanticPermutationResult = await compile(semanticPermutation);
assert.equal(semanticPermutationResult.inputDigest, semanticCanonicalResult.inputDigest, "semantic set permutations have one canonical input identity");
const semanticAuthorityText = postgresJsonbCanonicalText(semanticCanonicalResult.canonicalAuthority);
const semanticPermutationAuthorityText = postgresJsonbCanonicalText(semanticPermutationResult.canonicalAuthority);
const semanticAuthorityDifference = [...Array(Math.max(semanticAuthorityText.length, semanticPermutationAuthorityText.length)).keys()].find((index) => semanticAuthorityText[index] !== semanticPermutationAuthorityText[index]);
assert.equal(semanticPermutationResult.authorityDigest, semanticCanonicalResult.authorityDigest, `semantic set permutations have one authority identity (first authority text difference: ${semanticAuthorityDifference}; ${semanticAuthorityText.slice(Math.max(0, (semanticAuthorityDifference || 0) - 100), (semanticAuthorityDifference || 0) + 100)} <> ${semanticPermutationAuthorityText.slice(Math.max(0, (semanticAuthorityDifference || 0) - 100), (semanticAuthorityDifference || 0) + 100)})`);
assert.equal(semanticPermutationResult.replayDigest, semanticCanonicalResult.replayDigest, "cross-day repeated work and semantic sets replay byte-identically");

const exception = (id, acceptedAt, payload = { locks: [{ workId: "one", slotId: "a" }] }, extra = {}) => ({
  id, type: "manager_correction", serviceDate: "2026-08-10", acceptedAt, sequence: 1,
  baseVersionId: "test-week", publicationId: "test-publication", actorId: "manager", reason: "approved", idempotencyKey: `${id}-key`, expectedRevision: 1, payload, ...extra,
});
const exceptionCode = (exceptions) => prepareStaticWeeklySchedulingProblem(smallInput({ exceptions })).error?.code;
assert.equal(exceptionCode([exception("duplicate", "2026-08-10T08:00:00Z"), exception("duplicate", "2026-08-10T08:01:00Z")]), "duplicate_exception_id");
assert.equal(exceptionCode([exception("idempotency-a", "2026-08-10T08:00:00Z"), exception("idempotency-b", "2026-08-10T08:01:00Z", undefined, { idempotencyKey: "idempotency-a-key" })]), "duplicate_exception_idempotency");
assert.equal(exceptionCode([exception("order-a", "2026-08-10T08:00:00Z"), exception("order-b", "2026-08-10T08:00:00Z")]), "ambiguous_exception_order");
assert.equal(exceptionCode([{ ...exception("reverse-missing", "2026-08-10T08:01:00Z", {}), type: "reverse", payload: { reversesExceptionId: "not-present" } }]), "missing_reversal_target");
const reversalTarget = exception("reverse-target", "2026-08-10T08:00:00Z");
assert.equal(exceptionCode([reversalTarget, { ...exception("reverse-one", "2026-08-10T08:01:00Z", {}), type: "reverse", payload: { reversesExceptionId: "reverse-target" } }, { ...exception("reverse-two", "2026-08-10T08:02:00Z", {}), type: "reverse", payload: { reversesExceptionId: "reverse-target" } }]), "duplicate_exception_reversal");
assert.equal(exceptionCode([reversalTarget, { ...exception("reverse-cross-authority", "2026-08-10T08:01:00Z", {}), type: "reverse", publicationId: "other-publication", payload: { reversesExceptionId: "reverse-target" } }]), "exception_reversal_authority_mismatch");
assert.equal(exceptionCode([exception("lock-a", "2026-08-10T08:00:00Z", { locks: [{ workId: "one", slotId: "a" }] }), exception("lock-b", "2026-08-10T08:01:00Z", { locks: [{ workId: "one", slotId: "b" }] })]), "conflicting_manager_correction_lock");
const shuffled = clone(authorityInput); shuffled.slots.reverse(); shuffled.versions[0].assignments.reverse(); shuffled.versions[0].slotAvailability.reverse();
const replay = await compile(shuffled);
const replayByteDifference = [...authoritative.canonicalReplay].findIndex((character, index) => character !== replay.canonicalReplay[index]);
assert.equal(replayByteDifference, -1, `canonical replay differs at byte ${replayByteDifference}`);
assert.equal(replay.replayDigest, authoritative.replayDigest, "canonical immutable IDs make shuffled input replay exactly");
assert.equal((await verifyStaticWeeklyReplay(authorityInput, authoritative.replayDigest)).ok, true);
const routeCanonicalityEvidence = boundedRouteCanonicalitySearch(authoritative.certificate.modelBasis);
assert.equal(authoritative.certificate.modelBasis.routeCanonicality.invariant, "positive-fixed-windows-forward-only-dag-unique-path-v1", "shared generated authority carries the route-canonicality invariant");
console.log(JSON.stringify({ routeCanonicality: routeCanonicalityEvidence }));

// Working-slot eligibility facts are authority inputs too: a missing
// provenance field, including an otherwise-authoritative empty restriction
// set, cannot create an owner.
const missingEligibilityProvenance = smallInput();
delete missingEligibilityProvenance.versions[0].slotAvailability[0].qualificationProvenance;
assert.equal((await compile(missingEligibilityProvenance)).fatal.code, "working_slot_missing_eligibility_provenance");
const safeIdentifierCollision = smallInput({ assignments: [work("a-b", "A", "08:00", "08:30", "a"), work("a_b", "B", "09:00", "09:30", "b")] });
const safeIdentifierResult = await compile(safeIdentifierCollision);
assert.equal(safeIdentifierResult.status, "FEASIBLE", "legal distinct external IDs retain distinct canonical LP names");
assert.equal(new Set(safeIdentifierResult.certificate.modelBasis.constraints.rows.map((row) => row.name)).size, safeIdentifierResult.certificate.modelBasis.constraints.rows.length);

// Stable slot IDs are an identity boundary, not a display sort key.  Two
// different dated incumbents under one normalized ID must fail before an
// incumbency, candidate, assignment-variable, or roster Map can collapse them.
const duplicateSlotInput = smallInput({ slots: ["dup", "dup"] });
duplicateSlotInput.slots[0].incumbencies[0] = { personId: "first-dup", displayName: "First duplicate", effectiveStart: "2020-01-01", effectiveEnd: null };
duplicateSlotInput.slots[1].incumbencies[0] = { personId: "second-dup", displayName: "Second duplicate", effectiveStart: "2020-01-01", effectiveEnd: null };
assert.equal(prepareStaticWeeklySchedulingProblem(duplicateSlotInput).error.code, "duplicate_slot_id", "duplicate normalized slot IDs reject before identity materialization");
const duplicateSlotResult = await compile(duplicateSlotInput);
assert.equal(duplicateSlotResult.status, "REVIEW");
assert.equal(duplicateSlotResult.publicationAuthority, "REVIEW");
assert.equal(duplicateSlotResult.serviceDate, "2026-08-10", "post-admission validation failures retain the proven-safe service date");
assert.equal(duplicateSlotResult.fatal.code, "duplicate_slot_id", "duplicate slots never produce a collapsed ACCEPTABLE candidate universe");
const emptySlotInput = smallInput({ slots: [" "] });
assert.equal(prepareStaticWeeklySchedulingProblem(emptySlotInput).error.code, "invalid_slot_id", "empty normalized slot IDs remain invalid");
const duplicateAvailabilityInput = smallInput();
duplicateAvailabilityInput.versions[0].slotAvailability.push({ ...availability("a", "B"), maxServiceEffortMinutes: 111 });
assert.equal(prepareStaticWeeklySchedulingProblem(duplicateAvailabilityInput).error.code, "duplicate_slot_availability_identity", "duplicate day/slot availability identities reject before availability Map collapse");
const duplicatePlanWorkInput = smallInput();
duplicatePlanWorkInput.versions[0].assignments.push(work("one", "C", "10:10", "11:00", "a"));
assert.equal(prepareStaticWeeklySchedulingProblem(duplicatePlanWorkInput).error.code, "duplicate_plan_work_id", "duplicate source plan-work identities reject before candidate/x-map materialization");

// The terminal report is solver attestation, not a relabelled status.  These
// adversaries rewrite every receipt copy and recompute outer authority digests;
// the independent verifier must still reject raw/report/parser disagreement.
const reportDigest = (report) => {
  const bytes = Buffer.from(JSON.stringify({ representation: report.representation, records: report.records.map(({ channel, text }) => ({ channel, text })) }), "utf8");
  report.utf8Base64 = bytes.toString("base64"); report.utf8Sha256 = createHash("sha256").update(bytes).digest("hex");
};
const receiptTiers = (value, index = 0) => [value.solver?.tiers?.[index], value.certificate?.tiers?.[index]].filter(Boolean);
const rehashAuthority = (value) => {
  value.solutionDigest = postgresJsonbContentDigest(value.canonicalAuthority.optimizerResult);
  const withoutIdentity = { ...value.canonicalAuthority }; delete withoutIdentity.databaseContentIdentity;
  value.canonicalAuthority.databaseContentIdentity = postgresJsonbContentDigest(withoutIdentity);
  value.authorityDigest = postgresJsonbContentDigest(value.canonicalAuthority);
};
const rewriteReceipt = (mutate) => {
  const value = clone(authoritative);
  for (const tier of receiptTiers(value)) mutate(tier);
  value.canonicalAuthority.optimizerResult.tiers = canonicalSolverAuthorityTierProjection(value.solver.tiers);
  value.canonicalAuthority.optimizerResult.certificate = canonicalSolverAuthorityCertificate(value.certificate);
  rehashAuthority(value);
  return value;
};
const replaceReportLine = (tier, pattern, line) => {
  const index = tier.attestation.terminalReport.records.findIndex((record) => pattern.test(record.text));
  assert.notEqual(index, -1, `terminal report fixture includes ${pattern}`);
  tier.attestation.terminalReport.records[index].text = line; reportDigest(tier.attestation.terminalReport);
};
const terminalAdversaries = [
  ["forged_object_status", (tier) => { tier.attestation.objectStatus = "Feasible"; }],
  ["forged_report_status", (tier) => replaceReportLine(tier, /^  Status\s+Optimal$/, "  Status            Feasible")],
  ["object_recomputed_objective_mismatch", (tier) => { tier.attestation.objectPrimalObjective = 999; }],
  ["primal_dual_objective_mismatch", (tier) => replaceReportLine(tier, /^  Primal bound\s+/, "  Primal bound      999")],
  ["nonzero_gap", (tier) => replaceReportLine(tier, /^  Gap\s+/, "  Gap               1%")],
  ["malformed_gap", (tier) => replaceReportLine(tier, /^  Gap\s+/, "  Gap               zero-percent")],
  ["missing_gap", (tier) => { tier.attestation.terminalReport.records = tier.attestation.terminalReport.records.filter((record) => !/^  Gap\s+/.test(record.text)); reportDigest(tier.attestation.terminalReport); }],
  ["duplicated_gap", (tier) => { const records = tier.attestation.terminalReport.records; records.splice(records.findIndex((record) => /^  Solution status\s+/.test(record.text)), 0, { channel: "print", text: "  Gap               0%" }); reportDigest(tier.attestation.terminalReport); }],
  ["injected_gap", (tier) => { const records = tier.attestation.terminalReport.records; records.splice(1, 0, { channel: "print", text: "  Gap               0%" }); reportDigest(tier.attestation.terminalReport); }],
  ["infinite_bound", (tier) => replaceReportLine(tier, /^  Dual bound\s+/, "  Dual bound        inf")],
  ["nonzero_bound_violation", (tier) => replaceReportLine(tier, /\(bound viol\.\)$/, "                    1 (bound viol.)")],
  ["nonzero_integer_violation", (tier) => replaceReportLine(tier, /\(int\. viol\.\)$/, "                    1 (int. viol.)")],
  ["nonzero_row_violation", (tier) => replaceReportLine(tier, /\(row viol\.\)$/, "                    1 (row viol.)")],
  ["missing_terminal_report", (tier) => { tier.attestation.terminalReport.records = []; reportDigest(tier.attestation.terminalReport); }],
  ["duplicated_terminal_report", (tier) => { const records = tier.attestation.terminalReport.records; records.push(...records.map((record) => ({ ...record }))); reportDigest(tier.attestation.terminalReport); }],
  ["reordered_terminal_report", (tier) => { const records = tier.attestation.terminalReport.records; const status = records.findIndex((record) => /^  Status\s+/.test(record.text)); const primal = records.findIndex((record) => /^  Primal bound\s+/.test(record.text)); [records[status], records[primal]] = [records[primal], records[status]]; reportDigest(tier.attestation.terminalReport); }],
  ["truncated_terminal_report", (tier) => { tier.attestation.terminalReport.records.pop(); reportDigest(tier.attestation.terminalReport); }],
  ["cross_solve_contaminated_terminal_report", (tier) => { const records = tier.attestation.terminalReport.records; records.splice(1, 0, ...records.map((record) => ({ ...record }))); reportDigest(tier.attestation.terminalReport); }],
  ["report_digest_tampering", (tier) => { tier.attestation.terminalReport.utf8Sha256 = "f".repeat(64); }],
  ["parser_version_tampering", (tier) => { tier.attestation.parserVersion = "forged-parser"; }],
  ["option_tampering", (tier) => { tier.options.output_flag = false; }],
  ["lp_bytes_tampering", (tier) => { tier.modelUtf8Base64 = Buffer.from("forged lp", "utf8").toString("base64"); }],
  ["prior_binding_tampering", (tier) => { tier.priorBindingBytes = "bind_forged: + 1 x = 0\n"; }],
  ["primal_digest_tampering", (tier) => { tier.canonicalPrimalDigest = "e".repeat(64); }],
];
for (const [name, mutate] of terminalAdversaries) assert.equal(verifyStaticWeeklyScheduleResult(authorityInput, rewriteReceipt(mutate)).ok, false, name);
for (const field of ["packageJsonSha256", "wrapperJavaScriptSha256", "wasmSha256"]) {
  const identityTamper = clone(authoritative);
  for (const identity of [identityTamper.solver.identity, identityTamper.certificate.solverIdentity, identityTamper.canonicalAuthority.optimizerResult.certificate.solverIdentity]) identity[field] = "d".repeat(64);
  rehashAuthority(identityTamper);
  assert.equal(verifyStaticWeeklyScheduleResult(authorityInput, identityTamper).ok, false, `${field} tampering`);
}
const assignmentTamper = clone(authoritative);
assignmentTamper.weeklyAssignments[0].slotId = "b";
assignmentTamper.canonicalAuthority.optimizerResult.assignments[0].slotId = "b";
rehashAuthority(assignmentTamper);
assert.equal(verifyStaticWeeklyScheduleResult(authorityInput, assignmentTamper).ok, false, "assignment tampering remains independently infeasible even after rehash");

// The optimizer rows are not a partial owner digest.  Rehashing ordinary
// authority containers cannot turn a changed OPEN/REVIEW/ASSIGNED row or any
// immutable/display field into an authority projection.
const openOptimizerInput = smallInput({
  slots: ["a"],
  assignments: [work("optional-open", "A", "08:00", "09:00", "a", {
    required: false,
    coveragePolicy: "best_effort",
    bestEffortCoverage: true,
    coveragePolicyOrder: 1,
    coveragePolicyProvenance: "optimizer-projection-test-policy",
    requiredQualifications: ["unavailable-optional-credential"],
  })],
});
const openOptimizerAuthority = await compile(openOptimizerInput);
assert.equal(openOptimizerAuthority.weeklyAssignments[0].status, "OPEN");
const forgedOpenOptimizer = clone(openOptimizerAuthority);
Object.assign(forgedOpenOptimizer.canonicalAuthority.optimizerResult.assignments[0], {
  status: "ASSIGNED",
  slotId: "invented-owner-slot",
  personId: "invented-owner-person",
  displayName: "Invented owner",
  optimizedOwnerSlotId: "invented-owner-slot",
  optimizedOwnerPersonId: "invented-owner-person",
});
rehashAuthority(forgedOpenOptimizer);
const forgedOpenVerification = verifyStaticWeeklyScheduleResult(openOptimizerInput, forgedOpenOptimizer);
assert.equal(forgedOpenVerification.ok, false, "a rehashed OPEN optimizer row cannot claim an invented assigned owner");
assert.equal(forgedOpenVerification.violations.some((violation) => violation.code === "canonical_optimizer_assignment_projection_mismatch"), true);
const forgedAssignedOptimizer = clone(authoritative);
Object.assign(forgedAssignedOptimizer.canonicalAuthority.optimizerResult.assignments[0], {
  workId: "forged-work-id",
  displayName: "Forged display name",
  window: { start: "08:10", end: "08:40" },
  serviceEffortMinutes: 999,
});
rehashAuthority(forgedAssignedOptimizer);
const forgedAssignedVerification = verifyStaticWeeklyScheduleResult(authorityInput, forgedAssignedOptimizer);
assert.equal(forgedAssignedVerification.ok, false, "a rehashed assigned optimizer row cannot alter immutable work or display facts");
assert.equal(forgedAssignedVerification.violations.some((violation) => violation.code === "canonical_optimizer_assignment_projection_mismatch"), true);

// A proof is inseparable from the one canonical authority object.  Changing
// any operational content under a previously valid proof fails independently
// before it can reach a publication RPC.
for (const mutate of [
  (value) => { value.versions[0].assignments[0].serviceEffortMinutes += 1; },
  (value) => { value.versions[0].assignments[0].ownerSlotId = "b"; },
  (value) => { value.versions[0].assignments[0].window.end = "09:10"; },
  (value) => { value.versions[0].slotAvailability[0].maxServiceEffortMinutes += 1; },
  (value) => { value.versions[0].slotAvailability[0].shift.end = "15:59"; },
  (value) => { value.slots[0].incumbencies[0].displayName = "Renamed history"; },
]) {
  const changed = clone(authorityInput); mutate(changed);
  assert.equal(verifyStaticWeeklyScheduleResult(changed, authoritative).ok, false, "canonical proof rejects mutated authority content");
}
const exceptionAuthority = clone(authorityInput);
exceptionAuthority.exceptions = [{ id: "proof-exception", type: "manager_correction", serviceDate: "2026-08-10", baseVersionId: "test-week", publicationId: "test-publication", actorId: "manager", reason: "approved", idempotencyKey: "proof-exception", expectedRevision: 1, payload: { locks: [{ workId: "one", slotId: "b" }] } }];
const exceptionProof = await compile(exceptionAuthority);
const changedException = clone(exceptionAuthority); changedException.exceptions[0].payload.locks[0].slotId = "slot-b";
assert.equal(verifyStaticWeeklyScheduleResult(changedException, exceptionProof).ok, false, "canonical proof rejects exception mutation");

// A negative mutation has to be caught by the verifier even though HiGHS did
// not produce it.  This keeps the authority check independent of solver trust.
const forged = clone(authoritative); forged.weeklyAssignments[0].slotId = "b"; forged.weeklyAssignments[0].personId = "person-b"; forged.weeklyAssignments[0].optimizedOwnerSlotId = "b"; forged.weeklyAssignments[0].optimizedOwnerPersonId = "person-b";
assert.equal(verifyStaticWeeklyScheduleResult(authorityInput, forged).ok, false, "canonical optimizer ownership beats caller-reported owner facts");

// Rehashing every caller-visible digest does not turn invented historical
// people into authority: the verifier resolves current, baseline, and original
// identities again from the canonical dated slot history.
const rehashedIdentity = clone(authoritative); const forgedAssignment = rehashedIdentity.weeklyAssignments[0];
Object.assign(forgedAssignment, { personId: "forged-person", displayName: "Forged Person", baselineOwnerPersonId: "forged-baseline", baselineOwnerName: "Forged Baseline", originalActorPersonId: "forged-original", originalActorName: "Forged Original", optimizedOwnerPersonId: "forged-person" });
forgedAssignment.ownerDigest = postgresJsonbContentDigest({ planWorkId: forgedAssignment.planWorkId, slotId: forgedAssignment.slotId, personId: forgedAssignment.personId, serviceDate: forgedAssignment.serviceDate });
forgedAssignment.exactOwnerIdentity = postgresJsonbContentDigest({ plan_work_id: forgedAssignment.planWorkId, service_date: forgedAssignment.serviceDate, optimized_owner_slot_id: forgedAssignment.slotId, optimized_owner_person_id: forgedAssignment.personId, baseline_owner_slot_id: forgedAssignment.baselineSlotId, baseline_owner_person_id: forgedAssignment.baselineOwnerPersonId });
const forgedOptimizer = rehashedIdentity.canonicalAuthority.optimizerResult.assignments[0];
for (const field of ["personId", "displayName", "baselineOwnerPersonId", "baselineOwnerName", "originalActorPersonId", "originalActorName", "optimizedOwnerPersonId", "ownerDigest", "exactOwnerIdentity"]) forgedOptimizer[field] = forgedAssignment[field];
rehashedIdentity.solutionDigest = postgresJsonbContentDigest(rehashedIdentity.canonicalAuthority.optimizerResult);
const forgedAuthorityWithoutIdentity = { ...rehashedIdentity.canonicalAuthority }; delete forgedAuthorityWithoutIdentity.databaseContentIdentity;
rehashedIdentity.canonicalAuthority.databaseContentIdentity = postgresJsonbContentDigest(forgedAuthorityWithoutIdentity);
rehashedIdentity.authorityDigest = postgresJsonbContentDigest(rehashedIdentity.canonicalAuthority);
assert.equal(verifyStaticWeeklyScheduleResult(authorityInput, rehashedIdentity).ok, false, "forged/rehashed optimized, baseline, and original identities fail canonical verification");
const forgedTierReceipt = clone(authoritative); forgedTierReceipt.solver.tiers[0].modelDigest = "f".repeat(64);
assert.equal(verifyStaticWeeklyScheduleResult(authorityInput, forgedTierReceipt).ok, false, "a tier receipt must remain bound to the canonical optimizer result");
const forgedSolutionDigest = clone(authoritative); forgedSolutionDigest.solutionDigest = "a".repeat(64);
assert.equal(verifyStaticWeeklyScheduleResult(authorityInput, forgedSolutionDigest).ok, false, "solution digest forgery fails before publication");
const forgedAuthorityDigest = clone(authoritative); forgedAuthorityDigest.authorityDigest = "b".repeat(64);
assert.equal(verifyStaticWeeklyScheduleResult(authorityInput, forgedAuthorityDigest).ok, false, "authority digest forgery fails before publication");

// Duty is one chronological route, not a display-only travel total.  The
// service-effort resource remains the equity input, while fixed windows,
// directed travel, waiting, lunch, and the route span reconcile exactly.
const dutyRoute = smallInput({
  slots: ["a"],
  availabilities: [availability("a", "A", {
    shift: { start: "07:00", end: "10:00" }, lunch: { start: "08:30", end: "09:30" },
    maxServiceEffortMinutes: 180, maxDutyMinutes: 120, maxDutyProvenance: "verified-route-duty-v1",
  })],
  assignments: [
    work("duty-before-lunch", "B", "07:30", "08:00", "a", { serviceEffortMinutes: 20 }),
    work("duty-after-lunch", "C", "09:30", "10:00", "a", { serviceEffortMinutes: 20 }),
  ],
  proximity: [
    { from: "A", to: "B", minutes: 2, verified: true, provenance: "directed-duty" },
    { from: "A", to: "C", minutes: 2, verified: true, provenance: "directed-duty" },
    { from: "B", to: "C", minutes: 3, verified: true, provenance: "directed-duty" },
  ],
});
const dutyRouteResult = await compile(dutyRoute);
assert.equal(dutyRouteResult.status, "FEASIBLE", "lunch may split a route when each directed arc remains outside the protected interval");
const dutyLoad = dutyRouteResult.metrics.daily.find((day) => day.dayOfWeek === 1).loads[0];
assert.equal(dutyLoad.travelDutyMinutes, 5, "directed A→B and B→C travel is charged once each");
assert.equal(dutyLoad.protectedBreakUnavailableMinutes, 60, "lunch remains protected rather than becoming productive capacity");
assert.equal(dutyLoad.totalDutyMinutes, dutyLoad.routeSpanMinutes - dutyLoad.protectedBreakUnavailableMinutes, "service, travel, and committed waiting reconcile to the non-protected route span");
assert.equal(dutyLoad.totalDutyMinutes, dutyLoad.serviceEffortMinutes + dutyLoad.travelDutyMinutes + dutyLoad.waitingMinutes, "waiting is charged to duty feasibility rather than display only");
assert.equal(dutyLoad.waitingMinutes > 0 && dutyLoad.fixedWindowWaitingMinutes > 0 && dutyLoad.transitWaitingMinutes > 0, true, "fixed-window and inter-stop committed waiting are both explicit");

// A maximum verified duty cap is distinct from workload equity.  Both work
// items are otherwise eligible and chronologically routable, but their one
// combined route exceeds its proved duty capacity once waiting is charged.
const jointlyDutyInfeasible = clone(dutyRoute);
jointlyDutyInfeasible.versions[0].slotAvailability[0].lunch = undefined;
jointlyDutyInfeasible.versions[0].slotAvailability[0].shift = { start: "07:00", end: "09:00" };
jointlyDutyInfeasible.versions[0].slotAvailability[0].maxDutyMinutes = 70;
jointlyDutyInfeasible.versions[0].assignments[0].window = { start: "07:20", end: "07:50" };
jointlyDutyInfeasible.versions[0].assignments[1].window = { start: "08:10", end: "08:40" };
const jointlyDutyInfeasibleResult = await compile(jointlyDutyInfeasible);
assert.equal(jointlyDutyInfeasibleResult.status, "REVIEW", "joint route fails its verified duty cap once committed waiting is included");

// The receipt is independently reconstructed.  Rehashing a forged receipt
// after deleting waiting cannot turn it into authority.
const forgedWaitingReceipt = clone(dutyRouteResult);
delete forgedWaitingReceipt.canonicalAuthority.optimizerResult.metrics.daily.find((day) => day.dayOfWeek === 1).loads[0].waitingMinutes;
const forgedDutyAuthorityWithoutIdentity = { ...forgedWaitingReceipt.canonicalAuthority };
delete forgedDutyAuthorityWithoutIdentity.databaseContentIdentity;
forgedWaitingReceipt.solutionDigest = postgresJsonbContentDigest(forgedWaitingReceipt.canonicalAuthority.optimizerResult);
forgedWaitingReceipt.canonicalAuthority.databaseContentIdentity = postgresJsonbContentDigest(forgedDutyAuthorityWithoutIdentity);
forgedWaitingReceipt.authorityDigest = postgresJsonbContentDigest(forgedWaitingReceipt.canonicalAuthority);
const forgedWaitingVerification = verifyStaticWeeklyScheduleResult(dutyRoute, forgedWaitingReceipt);
assert.equal(forgedWaitingVerification.ok, false, "forged solver receipt omitting waiting fails independent duty verification");
assert.equal(forgedWaitingVerification.violations.some((violation) => violation.code === "canonical_duty_metrics_mismatch"), true);

// Seven locally-equivalent day choices are not independently accepted: the
// joint weekly tier distributes four visits to A and three to B before route
// proximity can select the otherwise-attractive A owner every day.
const weeklyEquity = smallInput({ assignments: [], availabilities: [] });
weeklyEquity.versions[0].slotAvailability = [];
weeklyEquity.versions[0].assignments = [];
for (let day = 0; day < 7; day += 1) {
  weeklyEquity.versions[0].slotAvailability.push({ ...availability("a", "A"), dayOfWeek: day }, { ...availability("b", "B"), dayOfWeek: day });
  weeklyEquity.versions[0].assignments.push({ ...work(`daily-${day}`, "A", "08:00", "09:00", "a"), dayOfWeek: day });
}
const weeklyResult = await compile(weeklyEquity);
assert.equal(weeklyResult.status, "FEASIBLE", "a sub-unit rank permutation residual is canonicalized only at the exact solver boundary and then rechecked against the regenerated integer model");
assert.equal(weeklyResult.publicationAuthority, "ACCEPTABLE");
assert.equal(weeklyResult.weeklyAssignments.filter((item) => item.status === "ASSIGNED").length, 7);

// Complete bounded independent oracle.  It deliberately owns its own time,
// eligibility, protected-time, route, duty, leximax and identity calculations;
// it does not import or call the production program generator, objective
// recomputation, compiler recursively, or verifier.  The surrounding test
// driver alone invokes the compiler for the final comparison.
const oracleCompare = (left, right) => { for (let index = 0; index < left.length; index += 1) if (left[index] !== right[index]) return left[index] - right[index]; return 0; };
const oracleTextCompare = (left, right) => String(left).localeCompare(String(right), "en", { numeric: true, sensitivity: "variant" });
const oracleMinute = (value) => { const [hour, minute] = String(value).split(":").map(Number); return (hour * 60) + minute; };
const oracleWindow = (value) => ({ start: oracleMinute(value.start), end: oracleMinute(value.end) });
const oracleUnion = (windows, start, end) => {
  const ordered = windows.map(oracleWindow).map((window) => ({ start: Math.max(start, window.start), end: Math.min(end, window.end) })).filter((window) => window.start < window.end).sort((left, right) => left.start - right.start || left.end - right.end);
  let total = 0; let cursor = null; let finish = null;
  for (const window of ordered) { if (cursor == null) { cursor = window.start; finish = window.end; } else if (window.start > finish) { total += finish - cursor; cursor = window.start; finish = window.end; } else finish = Math.max(finish, window.end); }
  return total + (cursor == null ? 0 : finish - cursor);
};
const oracleLcm = (left, right) => { const gcd = (a, b) => { let x = a; let y = b; while (y) [x, y] = [y, x % y]; return x; }; return (left / gcd(left, right)) * right; };

function independentBoundedOracle(input) {
  const version = input.versions[0]; const slots = input.slots.map((slot) => String(slot.id)).sort(oracleTextCompare);
  const edges = new Map();
  for (const row of input.proximity) {
    const from = String(row.fromLocationId || row.from); const to = String(row.toLocationId || row.to); const minutes = Number(row.minutes ?? row.distance);
    if (from && to && Number.isInteger(minutes) && minutes > 0) { edges.set(`${from}\u0000${to}`, minutes); if (row.bidirectional === true || row.symmetric === true) edges.set(`${to}\u0000${from}`, minutes); }
  }
  const edge = (from, to) => from === to ? 0 : edges.get(`${from}\u0000${to}`);
  const availability = version.slotAvailability.filter((entry) => entry.status === "working").map((entry) => {
    const shift = oracleWindow(entry.shift); const blocked = [...(entry.blockedWindows || []), ...(entry.lunch ? [entry.lunch] : [])];
    const supplied = entry.acceptedRoute || { startLocationId: entry.acceptedRouteStartLocationId || entry.acceptedRouteAnchorLocationId, stops: [] };
    const stops = (supplied.stops || supplied.existingStops || []).map((stop, index) => ({ id: String(stop.stopId || stop.id || `stop-${index}`), locationId: String(stop.locationId || stop.location), window: oracleWindow(stop.window), effort: Number(stop.serviceEffortMinutes ?? (oracleWindow(stop.window).end - oracleWindow(stop.window).start)) })).sort((left, right) => left.window.start - right.window.start || oracleTextCompare(left.id, right.id));
    const productive = shift.end - shift.start - oracleUnion(blocked, shift.start, shift.end);
    let baselineTravel = 0; let previous = { locationId: String(supplied.startLocationId), end: shift.start };
    for (const stop of stops) { const minutes = edge(previous.locationId, stop.locationId); if (minutes == null || previous.end + minutes > stop.window.start) throw new Error("oracle accepted route is infeasible"); baselineTravel += minutes; previous = { locationId: stop.locationId, end: stop.window.end }; }
    return { slotId: String(entry.slotId), day: Number(entry.dayOfWeek), entry, shift, blocked, stops, productive, maxService: Number(entry.maxServiceEffortMinutes ?? entry.maxLoadPoints), maxDuty: Number(entry.maxDutyMinutes ?? entry.max_duty_minutes ?? productive), anchor: String(supplied.startLocationId), baselineService: stops.reduce((total, stop) => total + stop.effort, 0), baselineTravel };
  }).sort((left, right) => left.day - right.day || oracleTextCompare(left.slotId, right.slotId));
  const works = version.assignments.map((raw) => ({ raw, key: `${Number(raw.dayOfWeek)}:${raw.workId || raw.id}`, day: Number(raw.dayOfWeek), workId: String(raw.workId || raw.id), locationId: String(raw.locationId), window: oracleWindow(raw.window), effort: Number(raw.serviceEffortMinutes), origin: String(raw.originSlotId || raw.ownerSlotId || raw.baselineSlotId), required: raw.required !== false, bestEffort: raw.required === false && (raw.coveragePolicy === "best_effort" || raw.bestEffortCoverage === true), coverageOrder: Number(raw.coveragePolicyOrder ?? 1), priority: Number(raw.priority ?? 0), qualifications: (raw.requiredQualifications || []).map(String), restrictions: (raw.restrictions || []).map(String), restrictedSlots: (raw.restrictedSlotIds || []).map(String) })).sort((left, right) => oracleTextCompare(left.key, right.key));
  const contextsByDay = new Map(); for (const context of availability) { const list = contextsByDay.get(context.day) || []; list.push(context); contextsByDay.set(context.day, list); }
  const eligibleOwners = (work) => (contextsByDay.get(work.day) || []).filter((context) => {
    const qualifications = new Set((context.entry.qualifications || []).map(String)); const restrictions = new Set((context.entry.restrictions || []).map(String));
    return context.shift.start <= work.window.start && context.shift.end >= work.window.end
      && !context.blocked.some((window) => { const block = oracleWindow(window); return block.start < work.window.end && work.window.start < block.end; })
      && !work.restrictedSlots.includes(context.slotId) && !restrictions.has(work.locationId) && work.qualifications.every((qualification) => qualifications.has(qualification));
  }).map((context) => context.slotId).sort(oracleTextCompare);
  const transitFits = (start, end, minutes, blocked) => {
    if (minutes == null || start > end) return false;
    if (minutes === 0) return true;
    const windows = blocked.map(oracleWindow).map((window) => ({ start: Math.max(start, window.start), end: Math.min(end, window.end) })).filter((window) => window.start < window.end).sort((left, right) => left.start - right.start || left.end - right.end);
    let cursor = start; for (const window of windows) { if (window.start - cursor >= minutes) return true; cursor = Math.max(cursor, window.end); } return end - cursor >= minutes;
  };
  const pathsFor = (context, selected) => {
    const remaining = [...context.stops.map((stop) => ({ id: `accepted:${stop.id}`, locationId: stop.locationId, start: stop.window.start, end: stop.window.end, kind: "accepted" })), ...selected.map((work) => ({ id: `work:${work.key}`, locationId: work.locationId, start: work.window.start, end: work.window.end, kind: "work" }))];
    const paths = []; const visit = (current, unused, travel, arcDuty, arcs) => {
      if (!unused.length) { if (current.end <= context.shift.end) paths.push({ travel, arcDuty, arcs }); return; }
      for (let index = 0; index < unused.length; index += 1) {
        const next = unused[index]; const minutes = edge(current.locationId, next.locationId);
        if (current.end > next.start || !transitFits(current.end, next.start, minutes, context.blocked)) continue;
        const protectedMinutes = oracleUnion(context.blocked, current.end, next.start); const waiting = Math.max(0, next.start - current.end - minutes - protectedMinutes);
        visit(next, [...unused.slice(0, index), ...unused.slice(index + 1)], travel + minutes, arcDuty + minutes + waiting, [...arcs, `${current.id || "start"}->${next.id}`]);
      }
    };
    visit({ id: "start", locationId: context.anchor, start: context.shift.start, end: context.shift.start }, remaining, 0, 0, []);
    return paths.filter((path) => selected.reduce((sum, work) => sum + work.effort, 0) + context.baselineService <= context.maxService && selected.reduce((sum, work) => sum + (work.window.end - work.window.start), 0) + context.stops.reduce((sum, stop) => sum + (stop.window.end - stop.window.start), 0) + path.arcDuty <= context.maxDuty);
  };
  const candidates = []; let enumeratedRoutes = 0;
  const finalize = (owners) => {
    const routeChoices = availability.map((context) => pathsFor(context, works.filter((work) => work.day === context.day && owners.get(work.key) === context.slotId)));
    if (routeChoices.some((paths) => !paths.length)) return;
    const combine = (index, chosen) => {
      if (index < routeChoices.length) { for (const path of routeChoices[index]) combine(index + 1, [...chosen, path]); return; }
      enumeratedRoutes += 1;
      let scale = 1; for (const context of availability) scale = oracleLcm(scale, context.productive);
      const weeklyCapacity = new Map(); for (const slot of slots) weeklyCapacity.set(slot, availability.filter((context) => context.slotId === slot).reduce((total, context) => total + context.productive, 0)); for (const capacity of weeklyCapacity.values()) if (capacity) scale = oracleLcm(scale, capacity);
      const daily = availability.map((context) => ({ day: context.day, slotId: context.slotId, value: ((context.baselineService + works.filter((work) => owners.get(work.key) === context.slotId && work.day === context.day).reduce((total, work) => total + work.effort, 0)) * scale) / context.productive }));
      const rankDaily = daily.slice().sort((left, right) => right.value - left.value || left.day - right.day || oracleTextCompare(left.slotId, right.slotId)); const dailyOrder = daily.slice().sort((left, right) => left.day - right.day || oracleTextCompare(left.slotId, right.slotId));
      const weekly = slots.filter((slot) => weeklyCapacity.get(slot) > 0).map((slotId) => ({ slotId, value: 0 }));
      // Daily values are scale/capacity; recompute weekly directly from effort
      // so unequal daily capacities retain the exact aggregate denominator.
      for (const item of weekly) { const contexts = availability.filter((context) => context.slotId === item.slotId); const effort = contexts.reduce((total, context) => total + context.baselineService + works.filter((work) => owners.get(work.key) === item.slotId && work.day === context.day).reduce((sum, work) => sum + work.effort, 0), 0); item.value = (effort * scale) / weeklyCapacity.get(item.slotId); }
      const rankWeekly = weekly.slice().sort((left, right) => right.value - left.value || oracleTextCompare(left.slotId, right.slotId)); const weeklyOrder = weekly.slice().sort((left, right) => oracleTextCompare(left.slotId, right.slotId));
      const requiredPriorities = [...new Set(works.filter((work) => work.required).map((work) => work.priority))].sort((left, right) => right - left); const bestOrders = [...new Set(works.filter((work) => work.bestEffort).map((work) => work.coverageOrder))].sort((left, right) => left - right);
      const travel = chosen.reduce((total, path) => total + path.travel, 0) - availability.reduce((total, context) => total + context.baselineTravel, 0);
      const disruption = works.reduce((total, work) => total + Number(!owners.get(work.key)) + Number(owners.get(work.key) && owners.get(work.key) !== work.origin), 0);
      const vector = [
        ...requiredPriorities.map((priority) => works.filter((work) => work.required && work.priority === priority && !owners.get(work.key)).length),
        ...bestOrders.map((order) => works.filter((work) => work.bestEffort && work.coverageOrder === order && !owners.get(work.key)).length),
        ...rankDaily.map((item) => item.value),
        rankDaily.reduce((total, item, index) => total + ((dailyOrder.length - dailyOrder.findIndex((source) => source.day === item.day && source.slotId === item.slotId)) * (index + 1)), 0),
        ...rankWeekly.map((item) => item.value),
        rankWeekly.reduce((total, item, index) => total + ((weeklyOrder.length - weeklyOrder.findIndex((source) => source.slotId === item.slotId)) * (index + 1)), 0),
        travel, disruption,
        ...works.map((work) => owners.get(work.key) ? slots.indexOf(owners.get(work.key)) + 1 : slots.length + 1),
      ];
      candidates.push({ vector, owners: new Map(owners), routePaths: chosen });
    };
    combine(0, []);
  };
  const choose = (index, owners) => { if (index === works.length) { finalize(owners); return; } const work = works[index]; for (const owner of [...eligibleOwners(work), null]) { owners.set(work.key, owner); choose(index + 1, owners); } };
  choose(0, new Map());
  candidates.sort((left, right) => oracleCompare(left.vector, right.vector));
  if (!candidates.length) throw new Error("independent oracle found no feasible schedule");
  const best = candidates[0];
  const routeCountByFixedOwners = new Map();
  for (const candidate of candidates) { const key = works.map((work) => candidate.owners.get(work.key) || "OPEN").join("\u0000"); routeCountByFixedOwners.set(key, (routeCountByFixedOwners.get(key) || 0) + 1); }
  return { works, best, candidates, enumeratedRoutes, routeCountByFixedOwners: [...routeCountByFixedOwners.values()], projection: works.map((work) => ({ planWorkId: work.key, status: best.owners.get(work.key) ? "ASSIGNED" : (work.required ? "REVIEW" : "OPEN"), slotId: best.owners.get(work.key) || null })), priorTierSurvivors: best.vector.map((_, index) => candidates.filter((candidate) => oracleCompare(candidate.vector.slice(0, index + 1), best.vector.slice(0, index + 1)) === 0).length) };
}

function boundedMatrixInput({ slotIds, days, specs, availabilityExtras = {}, proximity = null }) {
  const input = smallInput({ slots: slotIds, assignments: [], availabilities: [], ...(proximity ? { proximity } : {}) });
  const locations = ["A", "B", "C"];
  input.versions[0].slotAvailability = days.flatMap((day) => slotIds.map((slotId, index) => availability(slotId, locations[index], {
    dayOfWeek: day,
    ...(availabilityExtras[`${day}:${slotId}`] || availabilityExtras[slotId] || {}),
  })));
  input.versions[0].assignments = specs.map((spec) => work(spec.workId, spec.locationId, spec.start, spec.end, spec.originSlotId, {
    dayOfWeek: spec.dayOfWeek,
    serviceEffortMinutes: spec.serviceEffortMinutes ?? 20,
    priority: spec.priority ?? 1,
    requiredQualifications: spec.requiredQualifications || ["general"],
    ...(spec.required === false ? { required: false } : {}),
    ...(spec.bestEffort ? { coveragePolicy: "best_effort", bestEffortCoverage: true, coveragePolicyOrder: spec.coverageOrder, coveragePolicyProvenance: "bounded-oracle-policy-v1" } : {}),
  }));
  return input;
}

const boundedOracleMatrix = [
  {
    id: "required-priority-and-single-owner-contention",
    expectedStatus: "REVIEW",
    input: boundedMatrixInput({ slotIds: ["a", "b"], days: [1], availabilityExtras: { a: { qualifications: ["general", "priority-only"], maxServiceEffortMinutes: 20 }, b: { qualifications: ["general"], maxServiceEffortMinutes: 20 } }, specs: [
      { workId: "high", dayOfWeek: 1, locationId: "A", start: "08:00", end: "09:00", originSlotId: "a", priority: 9, requiredQualifications: ["priority-only"] },
      { workId: "low", dayOfWeek: 1, locationId: "B", start: "09:10", end: "10:00", originSlotId: "a", priority: 1, requiredQualifications: ["priority-only"] },
    ] }),
  },
  {
    id: "best-effort-policy-order",
    input: boundedMatrixInput({ slotIds: ["a", "b"], days: [1], availabilityExtras: { a: { qualifications: ["general", "best-effort-only"], maxServiceEffortMinutes: 20 }, b: { qualifications: ["general"], maxServiceEffortMinutes: 20 } }, specs: [
      { workId: "first", dayOfWeek: 1, locationId: "A", start: "08:00", end: "09:00", originSlotId: "a", required: false, bestEffort: true, coverageOrder: 1, requiredQualifications: ["best-effort-only"] },
      { workId: "second", dayOfWeek: 1, locationId: "B", start: "09:10", end: "10:00", originSlotId: "a", required: false, bestEffort: true, coverageOrder: 2, requiredQualifications: ["best-effort-only"] },
    ] }),
  },
  {
    id: "three-day-three-worker-six-work-equity",
    input: boundedMatrixInput({ slotIds: ["a", "b", "c"], days: [0, 1, 2], availabilityExtras: { a: { qualifications: ["general", "matrix"] }, b: { qualifications: ["general", "matrix"] }, c: { qualifications: ["general"] } }, specs: Array.from({ length: 6 }, (_, index) => ({ workId: `equity-${index}`, dayOfWeek: Math.floor(index / 2), locationId: ["A", "B"][index % 2], start: index % 2 ? "10:00" : "08:00", end: index % 2 ? "11:00" : "09:00", originSlotId: index % 2 ? "b" : "a", requiredQualifications: ["matrix"] })) }),
  },
  {
    id: "accepted-stop-asymmetric-directed-route-and-disruption",
    input: boundedMatrixInput({ slotIds: ["a", "b"], days: [0, 1], proximity: [
      { from: "A0", to: "X", minutes: 10, verified: true, provenance: "oracle-directed" }, { from: "X", to: "A1", minutes: 100, verified: true, provenance: "oracle-directed" }, { from: "A0", to: "A1", minutes: 100, verified: true, provenance: "oracle-directed" },
      { from: "B0", to: "X", minutes: 1, verified: true, provenance: "oracle-directed" }, { from: "X", to: "B1", minutes: 1, verified: true, provenance: "oracle-directed" }, { from: "B0", to: "B1", minutes: 1, verified: true, provenance: "oracle-directed" },
    ], availabilityExtras: {
      a: { acceptedRoute: { startLocationId: "A0", provenance: "oracle-accepted", stops: [{ stopId: "a-stop", locationId: "A1", window: { start: "10:00", end: "10:30" }, serviceEffortMinutes: 30, serviceEffortProvenance: "oracle-accepted", provenance: "oracle-accepted" }] } },
      b: { acceptedRoute: { startLocationId: "B0", provenance: "oracle-accepted", stops: [{ stopId: "b-stop", locationId: "B1", window: { start: "10:00", end: "10:30" }, serviceEffortMinutes: 30, serviceEffortProvenance: "oracle-accepted", provenance: "oracle-accepted" }] } },
    }, specs: [
      { workId: "directed-zero", dayOfWeek: 0, locationId: "X", start: "08:00", end: "09:00", originSlotId: "a" },
      { workId: "directed-one", dayOfWeek: 1, locationId: "X", start: "08:00", end: "09:00", originSlotId: "a" },
    ] }),
  },
  {
    id: "equal-cost-alternatives-stable-owner-identity",
    input: boundedMatrixInput({ slotIds: ["a", "b"], days: [1], availabilityExtras: { b: { acceptedRouteAnchorLocationId: "A" } }, specs: [
      { workId: "equal-one", dayOfWeek: 1, locationId: "A", start: "08:00", end: "09:00", originSlotId: "a" },
      { workId: "equal-two", dayOfWeek: 1, locationId: "A", start: "09:10", end: "10:00", originSlotId: "a" },
    ] }),
  },
  {
    id: "nonmonotonic-optional-burden-counterexample",
    input: boundedMatrixInput({ slotIds: ["a", "b"], days: [1], specs: [{ workId: "optional", dayOfWeek: 1, locationId: "A", start: "08:00", end: "09:00", originSlotId: "a", required: false }] }),
  },
];
let boundedOracleComparisons = 0; let boundedOracleCandidates = 0; let boundedOracleRoutes = 0;
for (const matrixCase of boundedOracleMatrix) {
  const permutations = [matrixCase.input, (() => { const value = clone(matrixCase.input); value.slots.reverse(); value.versions[0].assignments.reverse(); value.versions[0].slotAvailability.reverse(); value.proximity.reverse(); return value; })()];
  for (const input of permutations) {
    const oracle = independentBoundedOracle(input); const result = await compile(input);
    assert.equal(result.status, matrixCase.expectedStatus || "FEASIBLE", `${matrixCase.id} produces the independently enumerated bounded schedule state`);
    assert.deepEqual(result.solver.tiers.map((tier) => tier.objectiveValue), oracle.best.vector, `${matrixCase.id} complete staged vector matches the independent oracle`);
    assert.deepEqual(result.weeklyAssignments.map((item) => ({ planWorkId: item.planWorkId, status: item.status, slotId: item.slotId || null })).sort((left, right) => oracleTextCompare(left.planWorkId, right.planWorkId)), oracle.projection, `${matrixCase.id} final projection matches the independent oracle`);
    assert.equal(oracle.routeCountByFixedOwners.every((count) => count === 1), true, `${matrixCase.id} enumerated every fixed-owner chronological route and found exactly one`);
    assert.equal(oracle.priorTierSurvivors.every((count) => count >= 1), true, `${matrixCase.id} preserves every earlier tier while resolving later tiers`);
    boundedOracleComparisons += 1; boundedOracleCandidates += oracle.candidates.length; boundedOracleRoutes += oracle.enumeratedRoutes;
    if (matrixCase.id === "equal-cost-alternatives-stable-owner-identity") {
      const materialPrefixLength = oracle.best.vector.length - oracle.works.length;
      assert.equal(oracle.candidates.filter((candidate) => oracleCompare(candidate.vector.slice(0, materialPrefixLength), oracle.best.vector.slice(0, materialPrefixLength)) === 0).length >= 2, true, "equal-cost alternatives remain before stable identity resolves them");
      assert.equal(oracle.candidates.filter((candidate) => oracleCompare(candidate.vector, oracle.best.vector) === 0).length, 1, "stable identity makes the complete vector canonical");
    }
    if (matrixCase.id === "nonmonotonic-optional-burden-counterexample") {
      const open = oracle.candidates.find((candidate) => !candidate.owners.get("1:optional")); const assigned = oracle.candidates.find((candidate) => candidate.owners.get("1:optional"));
      assert.ok(open && assigned && oracleCompare(open.vector, assigned.vector) < 0, "adding optional burden cannot improve the leximax vector");
    }
  }
}
console.log(JSON.stringify({ boundedIndependentOracle: { fixtures: boundedOracleMatrix.length, productionComparisons: boundedOracleComparisons, feasibleAlternatives: boundedOracleCandidates, enumeratedChronologicalRoutes: boundedOracleRoutes, days: "1-3", workingEmployees: "2-3", workItems: "1-6" } }));


// Hard-rule probes: directional travel, missing evidence, overlaps, lunch,
// partial absence, capacity, qualifications, priority, and infeasibility.
const reverseOnly = smallInput({ slots: ["a"], availabilities: [availability("a", "A")], assignments: [work("first", "A", "08:00", "09:00", "a"), work("second", "B", "09:01", "10:00", "a")], proximity: [{ from: "B", to: "A", minutes: 30, verified: true, provenance: "reverse-only" }] });
assert.equal((await compile(reverseOnly)).status, "REVIEW");
const noEdge = clone(reverseOnly); noEdge.proximity = []; assert.equal((await compile(noEdge)).status, "REVIEW");
const overlap = clone(reverseOnly); overlap.proximity = [{ from: "A", to: "B", minutes: 1, verified: true, provenance: "forward" }]; overlap.versions[0].assignments[1].window = { start: "08:30", end: "09:30" }; assert.equal((await compile(overlap)).status, "REVIEW");
const lunch = smallInput({ slots: ["a"], availabilities: [availability("a", "A", { lunch: { start: "08:00", end: "09:00" } })], assignments: [work("lunch", "A", "08:00", "09:00", "a")] }); assert.equal((await compile(lunch)).status, "REVIEW");
const absence = smallInput({ exceptions: [{ id: "partial", type: "partial_absence", serviceDate: "2026-08-10", baseVersionId: "test-week", publicationId: "test-publication", actorId: "manager", reason: "approved", idempotencyKey: "partial", expectedRevision: 1, window: { start: "08:00", end: "09:00" }, payload: { slotId: "a" } }] }); const absenceResult = await compile(absence); assert.equal(absenceResult.weeklyAssignments.find((entry) => entry.workId === "one").slotId, "b");
const overCapacity = smallInput({ slots: ["a"], availabilities: [availability("a", "A", { maxServiceEffortMinutes: 10 })], assignments: [work("capacity", "A", "08:00", "09:00", "a")] }); assert.equal((await compile(overCapacity)).status, "REVIEW");
const qualification = smallInput({ slots: ["a"], availabilities: [availability("a", "A", { qualifications: ["general"] })], assignments: [work("qualified", "A", "08:00", "09:00", "a", { requiredQualifications: ["restroom"] })] }); assert.equal((await compile(qualification)).status, "REVIEW");
const priority = smallInput({ slots: ["a"], availabilities: [availability("a", "A", { maxServiceEffortMinutes: 20 })], assignments: [work("high", "A", "08:00", "09:00", "a", { priority: 9 }), work("low", "A", "09:10", "10:00", "a", { priority: 1 })] }); const priorityResult = await compile(priority); assert.equal(priorityResult.weeklyAssignments.find((entry) => entry.workId === "high").status, "ASSIGNED"); assert.equal(priorityResult.weeklyAssignments.find((entry) => entry.workId === "low").status, "REVIEW");

// Every dated overlay drives the exact same optimizer-owner path without
// mutating the baseline work's origin slot or historic person snapshot.
const overlay = (id, type, payload, window = null) => ({ id, type, serviceDate: "2026-08-10", baseVersionId: "test-week", publicationId: "test-publication", actorId: "manager", reason: "approved", idempotencyKey: id, expectedRevision: 1, ...(window ? { window } : {}), payload });
for (const input of [
  smallInput({ exceptions: [overlay("pto-owner", "pto", { slotId: "a" })] }),
  smallInput({ exceptions: [overlay("partial-owner", "partial_absence", { slotId: "a" }, { start: "08:00", end: "09:00" })] }),
  smallInput({ exceptions: [overlay("manager-owner", "manager_correction", { locks: [{ workId: "one", slotId: "b" }] })] }),
]) {
  const result = await compile(input); const changed = result.weeklyAssignments.find((item) => item.workId === "one");
  assert.equal(changed.slotId, "b"); assert.equal(changed.originSlotId, "a");
}
const coverAll = smallInput({ slots: ["a", "b"], availabilities: [availability("a", "A", { status: "departed_named_absent" })], assignments: [work("one", "A", "08:00", "09:00", "a")] });
const coverallAvailability = availability("b", "B");
coverAll.exceptions = [overlay("coverall-owner", "cover_all", { availability: {
  slotId: coverallAvailability.slotId, shift: coverallAvailability.shift,
  productiveCapacityProvenance: coverallAvailability.productiveCapacityProvenance,
  maxServiceEffortMinutes: coverallAvailability.maxServiceEffortMinutes,
  maxServiceEffortProvenance: coverallAvailability.maxServiceEffortProvenance,
  qualifications: coverallAvailability.qualifications, qualificationProvenance: coverallAvailability.qualificationProvenance,
  restrictions: coverallAvailability.restrictions, restrictionProvenance: coverallAvailability.restrictionProvenance,
  acceptedRouteAnchorLocationId: coverallAvailability.acceptedRouteAnchorLocationId,
  acceptedRouteProvenance: coverallAvailability.acceptedRouteProvenance,
} })];
const coverAllResult = await compile(coverAll); assert.equal(coverAllResult.weeklyAssignments.find((item) => item.workId === "one").slotId, "b");

// The dated roster identity is resolved for each occurrence, never once at
// Monday.  Wednesday's replacement is a new immutable person snapshot.
const replacement = smallInput({ slots: ["a"], assignments: [], availabilities: [] });
replacement.slots[0].incumbencies = [
  { personId: "old-person", displayName: "Old Person", effectiveStart: "2020-01-01", effectiveEnd: "2026-08-12" },
  { personId: "new-person", displayName: "New Person", effectiveStart: "2026-08-12", effectiveEnd: null },
];
replacement.versions[0].slotAvailability = []; replacement.versions[0].assignments = [];
for (const day of [1, 2, 3]) { replacement.versions[0].slotAvailability.push({ ...availability("a", "A"), dayOfWeek: day }); replacement.versions[0].assignments.push({ ...work(`replace-${day}`, "A", "08:00", "09:00", "a"), dayOfWeek: day }); }
const replacementResult = await compile(replacement);
assert.deepEqual(replacementResult.weeklyAssignments.filter((item) => item.workId.startsWith("replace-")).map((item) => [item.serviceDate, item.personId, item.displayName]), [["2026-08-10", "old-person", "Old Person"], ["2026-08-11", "old-person", "Old Person"], ["2026-08-12", "new-person", "New Person"]]);

// Weekly utilization uses aggregate provenanced effort / aggregate verified
// capacity.  Summing daily ratios would incorrectly report 0.5555… here.
const unequalCapacity = smallInput({ slots: ["a", "b"], assignments: [], availabilities: [] });
unequalCapacity.versions[0].slotAvailability = []; unequalCapacity.versions[0].assignments = [];
for (let day = 0; day < 7; day += 1) {
  unequalCapacity.versions[0].slotAvailability.push({ ...availability("b", "B", { maxServiceEffortMinutes: 540 }), dayOfWeek: day });
  if (day === 1) unequalCapacity.versions[0].slotAvailability.push({ ...availability("a", "A", { maxServiceEffortMinutes: 540 }), dayOfWeek: day });
  unequalCapacity.versions[0].assignments.push({ ...work(`unequal-${day}`, "A", "08:00", "09:00", day === 1 ? "a" : "b", { serviceEffortMinutes: 60 }), dayOfWeek: day });
}
unequalCapacity.exceptions = [overlay("lock-a", "manager_correction", { locks: [{ workId: "unequal-1", slotId: "a" }] })];
const unequalResult = await compile(unequalCapacity);
assert.equal(unequalResult.metrics.weekly.normalizedInequity, 0.015873015873015872);
assert.deepEqual(unequalResult.metrics.weekly.normalizedLoads, { a: 0.1111111111111111, b: 0.09523809523809523 });

// The 1438/1439 counterexample used to collapse under a rounded million-scale
// objective.  Exact common-denominator coefficients must prefer b.
const exactCounterexample = smallInput({ slots: ["a", "b"], assignments: [], availabilities: [] });
exactCounterexample.versions[0].slotAvailability = [
  { ...availability("a", "A", { shift: { start: "00:00", end: "23:59" }, blockedWindows: [{ start: "00:00", end: "00:01" }], maxServiceEffortMinutes: 1438 }), dayOfWeek: 1 },
  { ...availability("b", "B", { shift: { start: "00:00", end: "23:59" }, maxServiceEffortMinutes: 1439 }), dayOfWeek: 1 },
];
exactCounterexample.versions[0].assignments = [{ ...work("exact-minute", "A", "01:00", "01:01", "a", { serviceEffortMinutes: 1 }), dayOfWeek: 1 }];
const exactCounterexampleResult = await compile(exactCounterexample);
assert.equal(exactCounterexampleResult.status, "FEASIBLE");
assert.equal(exactCounterexampleResult.weeklyAssignments[0].slotId, "b", "1/1439 is exactly better than 1/1438");
assert.equal(exactCounterexampleResult.objective.exactEquityCommonDenominator, 2069282);

// Established stop service is operational work.  An accepted stop colliding
// with lunch fails before it can disappear from capacity or duty accounting.
const acceptedStopLunchCollision = smallInput({ slots: ["a"], assignments: [work("insert-one", "A", "07:00", "07:50", "a", { serviceEffortMinutes: 50 }), work("insert-two", "A", "09:10", "10:00", "a", { serviceEffortMinutes: 50 })], availabilities: [availability("a", "A", { shift: { start: "07:00", end: "10:00" }, lunch: { start: "08:00", end: "09:00" }, maxServiceEffortMinutes: 300, acceptedRoute: { startLocationId: "A", provenance: "accepted-stop", stops: [{ id: "accepted", locationId: "A", window: { start: "08:00", end: "09:00" }, serviceEffortMinutes: 60, serviceEffortProvenance: "accepted-stop-study", provenance: "accepted-stop" }] } })] });
assert.equal((await compile(acceptedStopLunchCollision)).status, "REVIEW", "accepted stop may not overlap lunch");

const fixedWindow = smallInput({ slots: ["a"], availabilities: [availability("a", "A")], assignments: [work("too-long", "A", "08:00", "08:10", "a", { serviceEffortMinutes: 60 })] });
assert.equal((await compile(fixedWindow)).status, "REVIEW", "service effort cannot be silently reinterpreted when it does not fit its fixed execution window");

// Accepted-route insertions retain ordered immutable stops and minimize the
// directed before/after increment, rather than one anchor-distance proxy.
const routed = smallInput({ assignments: [work("routed", "X", "08:00", "09:00", "a")], proximity: [
  { from: "A0", to: "X", minutes: 10, verified: true, provenance: "route" }, { from: "X", to: "A1", minutes: 100, verified: true, provenance: "route" }, { from: "A0", to: "A1", minutes: 100, verified: true, provenance: "route" },
  { from: "B0", to: "X", minutes: 1, verified: true, provenance: "route" }, { from: "X", to: "B1", minutes: 1, verified: true, provenance: "route" }, { from: "B0", to: "B1", minutes: 1, verified: true, provenance: "route" },
] });
routed.versions[0].slotAvailability = [
  availability("a", "A0", { acceptedRoute: { startLocationId: "A0", provenance: "route", stops: [{ id: "a-stop", locationId: "A1", window: { start: "10:00", end: "10:30" }, provenance: "route" }] } }),
  availability("b", "B0", { acceptedRoute: { startLocationId: "B0", provenance: "route", stops: [{ id: "b-stop", locationId: "B1", window: { start: "10:00", end: "10:30" }, provenance: "route" }] } }),
];
const routedResult = await compile(routed); assert.equal(routedResult.weeklyAssignments[0].slotId, "b"); assert.equal(routedResult.metrics.weekly.incrementalDirectedRouteCost, 1);
const stopConflict = clone(routed); stopConflict.versions[0].slotAvailability[1].acceptedRoute.stops[0].window = { start: "08:30", end: "09:30" }; assert.equal((await compile(stopConflict)).status, "REVIEW");

// Each task can be inserted against the accepted route by itself, but their
// combined directed B→C travel has no contiguous non-lunch transit interval.
const protectedLunchRoute = smallInput({ slots: ["a"], availabilities: [availability("a", "A", { shift: { start: "07:00", end: "12:00" }, lunch: { start: "08:30", end: "09:30" }, maxServiceEffortMinutes: 240, acceptedRoute: { startLocationId: "A", provenance: "route", stops: [{ id: "accepted", locationId: "D", window: { start: "11:30", end: "12:00" }, serviceEffortMinutes: 30, serviceEffortProvenance: "route", provenance: "route" }] } })], assignments: [work("before-lunch", "B", "07:30", "08:00", "a", { serviceEffortMinutes: 30 }), work("after-lunch", "C", "10:00", "10:30", "a", { serviceEffortMinutes: 30 })], proximity: [
  { from: "A", to: "B", minutes: 1, verified: true, provenance: "route" }, { from: "B", to: "D", minutes: 1, verified: true, provenance: "route" },
  { from: "A", to: "C", minutes: 1, verified: true, provenance: "route" }, { from: "C", to: "D", minutes: 1, verified: true, provenance: "route" },
  { from: "B", to: "C", minutes: 90, verified: true, provenance: "route" },
] });
const protectedLunchResult = await compile(protectedLunchRoute);
assert.equal(protectedLunchResult.status, "REVIEW", "joint route fails when its directed travel would consume protected lunch");

// The parent bounds the per-slot route graph before creating a quadratic arc
// array or LP string.
const routeExplosion = smallInput({ slots: ["a"], availabilities: [availability("a", "A")], assignments: Array.from({ length: 230 }, (_, index) => work(`burst-${index}`, "A", "08:00", "09:00", "a")) });
const routeExplosionResult = await compile(routeExplosion);
assert.equal(routeExplosionResult.status, "REVIEW");
assert.equal(routeExplosionResult.fatal.code, "route_arc_candidate_limit");
assert.equal(STATIC_WEEKLY_SERVER_LIMITS.maxRouteArcCandidates < 230 * 230, true);

for (const [override, expected] of [["unavailable", "solver_unavailable"], ["timeout", "solver_timeout"], ["non_optimal", "solver_non_optimal"], ["malformed", "malformed_solver_output"]]) {
  setStaticWeeklySolverTestOverride(override); const result = await compile(smallInput()); assert.equal(result.status, "REVIEW"); assert.equal(result.fatal.code, expected);
}
setStaticWeeklySolverTestOverride(null);

// Receipt v4 contains one final integer witness and a single model basis; all
// tiers are compact deltas.  Resealing ordinary outer hashes cannot launder a
// changed witness, scale, model identity, or derived review/open projection.
assert.equal(authoritative.solver.tiers.some((tier) => Object.hasOwn(tier, "modelUtf8Base64") || Object.hasOwn(tier, "canonicalPrimal")), false);
assert.equal(authoritative.certificate.finalWitness.values.length > 0, true);
for (const mutate of [
  (value) => { value.certificate.finalWitness.values[0][1] = 1 - value.certificate.finalWitness.values[0][1]; },
  (value) => { value.certificate.modelBasis.binaryVariables.reverse(); },
  (value) => { value.objective.exactEquityCommonDenominator += 1; },
  (value) => { value.status = "REVIEW"; value.publicationAuthority = "REVIEW"; },
  (value) => { value.reviewWork = [{ planWorkId: "forged" }]; },
  (value) => { value.openWork = [{ planWorkId: "forged" }]; },
]) {
  const value = clone(authoritative); mutate(value); rehashAuthority(value);
  assert.equal(verifyStaticWeeklyScheduleResult(authorityInput, value).ok, false, "compact receipt mutation is rejected");
}
// These attacks reseal ordinary container digests but cannot substitute a
// row, objective, variable, or ordered prior binding for the regenerated
// authority program.
const certificateCopies = (value) => [value.certificate, value.canonicalAuthority?.optimizerResult?.certificate].filter(Boolean);
for (const mutate of [
  (certificate) => { certificate.modelBasis.constraints.rows.splice(0, 1); certificate.modelBasis.constraints.count -= 1; },
  (certificate) => { certificate.tiers[0].objectiveExpression.terms = []; },
  (certificate) => { certificate.modelBasis.binaryVariables.pop(); },
  (certificate) => { certificate.modelBasis.routeCanonicality.invariant = "forged-route-claim"; },
  (certificate) => { if (certificate.tiers[1]) certificate.tiers[1].priorBindings = []; },
]) {
  const value = clone(authoritative); for (const certificate of certificateCopies(value)) mutate(certificate); rehashAuthority(value);
  assert.equal(verifyStaticWeeklyScheduleResult(authorityInput, value).ok, false, "regenerated authority program rejects forged receipt components");
}

console.log("static weekly HiGHS compiler/verifier tests: PASS (candidate boundary, complete bounded independent oracle, exact equity, authority mutations)");
} else {
  const resultShape = JSON.parse(fs.readFileSync(new URL("./fixtures/static-weekly-scheduler/highs-1.15.2-result-shape.json", import.meta.url), "utf8"));
  const oracle = JSON.parse(fs.readFileSync(new URL("./fixtures/static-weekly-scheduler/monotonic-leximax-exhaustive-oracle.json", import.meta.url), "utf8"));
  assert.deepEqual(resultShape.cases.optimal.ownProperties, ["Columns", "ObjectiveValue", "Rows", "Status"]);
  assert.deepEqual(resultShape.capabilities, { bestBound: false, mipGap: false, distinctTermination: false });
  const result = await compile(smallInput());
  assert.equal(result.status, "REVIEW"); assert.equal(result.publicationAuthority, "REVIEW"); assert.equal(result.fatal.code, "solver_evidence_unavailable");
  assert.equal(result.fatal.actualEvidence.bestBound, null); assert.equal(result.fatal.actualEvidence.mipGap, null); assert.equal(result.fatal.actualEvidence.termination, null);
  const direct = await solveStaticWeeklyMip("Minimize\n objective: + 1 x\nSubject To\n c: + 1 x >= 1\nBounds\n 0 <= x <= 1\nBinary\n x\nEnd\n", { timeLimitSeconds: 1 });
  assert.equal(direct.result.Status, "Optimal"); assert.deepEqual(direct.evidence.ownProperties, ["Columns", "ObjectiveValue", "Rows", "Status"]);
  setStaticWeeklySolverTestOverride("tolerance_edge");
  const tolerance = await compile(smallInput()); assert.equal(tolerance.fatal.code, "noncanonical_integer_primal");
  setStaticWeeklySolverTestOverride(null);
  const forged = { ...result, status: "FEASIBLE", publicationAuthority: "ACCEPTABLE", certificate: { schema: "memphis-zoo.static-weekly-solver-certificate.v3", compilerVersion: result.compilerVersion, verifierVersion: "static-weekly-js-verifier-v2-monotonic-leximax", objectivePolicyVersion: "monotonic-leximax-v1", solverIdentity: { resultEvidenceCapabilities: { bestBound: true, mipGap: true, distinctTermination: true } }, canonicalInputDigest: "forged", weeklyVersionDigest: "forged", assignmentDigest: "forged" } };
  assert.equal(verifyStaticWeeklyScheduleResult(smallInput(), forged).ok, false);
  const compare = (left, right) => { for (let index = 0; index < left.length; index += 1) if (left[index] !== right[index]) return left[index] - right[index]; return 0; };
  for (const fixture of oracle.fixtures) assert.equal(fixture.candidates.slice().sort((left, right) => compare(left.vector, right.vector))[0].id, fixture.expectedBest, fixture.id);
  const counterexample = oracle.fixtures.find((fixture) => fixture.id === "optional-burden-range-counterexample");
  assert.ok(compare(counterexample.candidates.find((candidate) => candidate.id === "leave-open").vector, counterexample.candidates.find((candidate) => candidate.id === "assign-optional").vector) < 0, "adding optional burden cannot improve leximax");
  console.log("static weekly leximax fail-closed compiler tests: PASS");
}
