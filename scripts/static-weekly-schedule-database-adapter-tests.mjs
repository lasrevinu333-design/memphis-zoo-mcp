#!/usr/bin/env node
import assert from "node:assert/strict";
import { compileStaticWeeklySchedule, postgresJsonbContentDigest } from "../src/static-weekly-schedule-compiler.js";
import {
  adaptCompiledStaticWeeklySchedule,
  createStaticWeeklyDraftRpcInput,
  createStaticWeeklyProjectionRpcInput,
} from "../src/static-weekly-schedule-database-adapter.js";
import { normalizeStaticWeeklyIncludedLocations } from "../src/static-weekly-schedule-program.js";

const clone = (value) => JSON.parse(JSON.stringify(value));
const manager = { managerId: "10000000-0000-4000-8000-000000000001", managerName: "Named Manager", idempotencyKey: "adapter-unit-draft" };

assert.deepEqual(
  normalizeStaticWeeklyIncludedLocations({ locationId: "location-a", locationNameSnapshot: "Area A" }),
  [{ locationId: "location-a", locationNameSnapshot: "Area A" }],
  "historical single-location source receives one exact canonical family member",
);
assert.deepEqual(
  normalizeStaticWeeklyIncludedLocations({ locationId: "reminder-family", locationNameSnapshot: "Reminder Family", serviceMode: "reminder_only", includedLocations: [] }),
  [],
  "reminder-only work preserves an explicit empty physical-location set",
);
assert.deepEqual(
  normalizeStaticWeeklyIncludedLocations({ locationId: "response-family", locationNameSnapshot: "Response Family", serviceMode: "response_only_no_clean", includedLocations: [] }),
  [],
  "response-only work preserves an explicit empty physical-location set",
);
for (const [label, work, errorCode = "invalid_included_location_facts"] of [
  ["routing anchor outside family", { locationId: "location-a", locationNameSnapshot: "Area A", includedLocations: [{ locationId: "location-b", locationNameSnapshot: "Area B" }] }],
  ["duplicate location identity", { locationId: "location-a", locationNameSnapshot: "Area A", includedLocations: [{ locationId: "location-a", locationNameSnapshot: "Area A" }, { locationId: "location-a", locationNameSnapshot: "Area A duplicate" }] }],
  ["malformed location object", { locationId: "location-a", locationNameSnapshot: "Area A", includedLocations: [{ locationId: "location-a", locationNameSnapshot: "Area A", routeOrder: 1 }] }],
  ["empty family", { locationId: "location-a", locationNameSnapshot: "Area A", includedLocations: [] }],
  ["reminder with physical members", { locationId: "location-a", locationNameSnapshot: "Area A", serviceMode: "reminder_only", includedLocations: [{ locationId: "location-a", locationNameSnapshot: "Area A" }] }],
  ["implicit reminder membership", { locationId: "location-a", locationNameSnapshot: "Area A", serviceMode: "reminder_only" }],
  ["unknown service mode", { locationId: "location-a", locationNameSnapshot: "Area A", serviceMode: "unknown", includedLocations: [] }, "invalid_service_mode"],
]) assert.throws(
  () => normalizeStaticWeeklyIncludedLocations(work),
  (error) => error?.code === errorCode,
  label,
);

function sevenDayInput({ review = false, eventOverlay = false } = {}) {
  const slotA = "20000000-0000-4000-8000-000000000001";
  const slotB = "20000000-0000-4000-8000-000000000002";
  const placeA = "40000000-0000-4000-8000-000000000011";
  const placeB = "40000000-0000-4000-8000-000000000012";
  const availability = (slotId, dayOfWeek, anchor) => ({
    slotId, dayOfWeek, status: "working", shift: { start: "07:00", end: "16:00" },
    productiveCapacityProvenance: "adapter-test-shift-v1", maxServiceEffortMinutes: 300,
    maxServiceEffortProvenance: "adapter-test-maximum-v1", qualifications: ["general"],
    qualificationProvenance: "adapter-test-qualification-v1", restrictions: [],
    restrictionProvenance: "adapter-test-restriction-v1", acceptedRouteAnchorLocationId: anchor,
    acceptedRouteProvenance: "adapter-test-route-v1",
  });
  const work = (workId, dayOfWeek, locationId, ownerSlotId, extra = {}) => ({
    workId, dayOfWeek, locationId, locationCodeSnapshot: `DAY_${dayOfWeek}`,
    locationNameSnapshot: `Day ${dayOfWeek}`, window: { start: "08:00", end: "09:00" }, ownerSlotId,
    serviceEffortMinutes: 20, serviceEffortProvenance: "adapter-test-service-v1", priority: 1,
    priorityProvenance: "adapter-test-priority-v1", requiredQualifications: [review && dayOfWeek === 3 ? "unavailable" : "general"],
    qualificationProvenance: "adapter-test-work-qualification-v1", restrictions: [],
    restrictionProvenance: "adapter-test-work-restriction-v1", ...extra,
  });
  const assignments = Array.from({ length: 7 }, (_, dayOfWeek) => work(
    dayOfWeek === 0 || dayOfWeek === 6 ? "repeated-work-id" : `work-${dayOfWeek}`,
    dayOfWeek, dayOfWeek % 2 ? placeB : placeA, dayOfWeek % 2 ? slotB : slotA,
  ));
  assignments[0].includedLocations = [
    { locationId: placeA, locationNameSnapshot: "Aquarium" },
    { locationId: placeB, locationNameSnapshot: "Aquarium Restroom" },
  ];
  assignments.push(work("optional-open", 4, placeB, slotB, { required: false, coveragePolicy: "permitted_open", requiredQualifications: ["unavailable-optional"] }));
  if (eventOverlay) {
    const family = () => [
      { locationId: placeA, locationNameSnapshot: "Patch Base" },
      { locationId: placeB, locationNameSnapshot: "Patch Restroom" },
    ];
    assignments.push(work("event-patch-target", 1, placeA, slotA, {
      locationCodeSnapshot: "PATCH_BASE", locationNameSnapshot: "Patch Base", includedLocations: family(),
      window: { start: "10:00", end: "11:00" }, serviceEffortMinutes: 20,
    }));
    assignments.push(work("event-relocated-target", 1, placeA, slotA, {
      locationCodeSnapshot: "RELOCATE_BASE", locationNameSnapshot: "Relocate Base", includedLocations: family(),
      window: { start: "11:00", end: "12:00" }, serviceEffortMinutes: 20,
    }));
  }
  const exceptions = eventOverlay ? [{
    id: "adapter-event-impact-accepted", type: "event_impact", status: "accepted", serviceDate: "2026-10-05",
    baseVersionId: "adapter-real-seven-day", publicationId: "adapter-real-publication", actorId: "adapter-test-event-manager",
    reason: "accepted event work overlay", idempotencyKey: "adapter-event-impact-accepted", expectedRevision: 0, acceptedAt: "2026-10-04T12:00:00Z", sequence: 1,
    payload: {
      removeWorkIds: ["work-1"],
      patchWork: [{
        workId: "event-patch-target", locationId: placeA, locationCodeSnapshot: "EVENT_PATCH", locationNameSnapshot: "Event Patch Exhibit",
        window: { start: "10:00", end: "11:30" }, serviceEffortMinutes: 45, serviceEffortProvenance: "adapter-test-event-patch-effort-v1",
        priority: 2, priorityProvenance: "adapter-test-event-patch-priority-v1", requiredQualifications: ["general"],
        qualificationProvenance: "adapter-test-event-patch-qualification-v1", restrictions: ["event-patch-restriction"],
        restrictionProvenance: "adapter-test-event-patch-restriction-v1",
      }, {
        workId: "event-relocated-target", locationId: placeB, locationCodeSnapshot: "EVENT_RELOCATED", locationNameSnapshot: "Relocated Event Exhibit",
        window: { start: "11:00", end: "12:30" }, serviceEffortMinutes: 35, serviceEffortProvenance: "adapter-test-event-relocated-effort-v1",
        priority: 3, priorityProvenance: "adapter-test-event-relocated-priority-v1", requiredQualifications: ["general"],
        qualificationProvenance: "adapter-test-event-relocated-qualification-v1", restrictions: ["event-relocated-restriction"],
        restrictionProvenance: "adapter-test-event-relocated-restriction-v1",
      }],
      addWork: [{
        workId: "event-added-work", dayOfWeek: 1, originSlotId: slotA, locationId: placeA, locationCodeSnapshot: "EVENT_ADD",
        locationNameSnapshot: "Event Added Exhibit", window: { start: "12:00", end: "13:00" }, serviceEffortMinutes: 30,
        includedLocations: [
          { locationId: placeA, locationNameSnapshot: "Event Added Exhibit" },
          { locationId: placeB, locationNameSnapshot: "Event Added Restroom" },
        ],
        serviceEffortProvenance: "adapter-test-event-add-effort-v1", priority: 1, priorityProvenance: "adapter-test-event-add-priority-v1",
        requiredQualifications: ["general"], qualificationProvenance: "adapter-test-event-add-qualification-v1", restrictions: ["event-add-restriction"],
        restrictionProvenance: "adapter-test-event-add-restriction-v1",
      }],
    },
  }] : [];
  return {
    serviceDate: "2026-10-05", timezone: "America/Chicago", exceptions,
    proximity: [
      { from: "START_A", to: placeA, minutes: 1, verified: true, provenance: "adapter-test-route-v1" },
      { from: "START_A", to: placeB, minutes: 4, verified: true, provenance: "adapter-test-route-v1" },
      { from: "START_B", to: placeA, minutes: 4, verified: true, provenance: "adapter-test-route-v1" },
      { from: "START_B", to: placeB, minutes: 1, verified: true, provenance: "adapter-test-route-v1" },
    ],
    slots: [
      { id: slotA, label: "Stable A", incumbencies: [{ personId: "30000000-0000-4000-8000-000000000001", displayName: "Morgan", effectiveStart: "2020-01-01", effectiveEnd: null }] },
      { id: slotB, label: "Stable B", incumbencies: [
        { personId: "30000000-0000-4000-8000-000000000002", displayName: "Jordan Old", effectiveStart: "2020-01-01", effectiveEnd: "2026-10-07" },
        { personId: "30000000-0000-4000-8000-000000000003", displayName: "Jordan New", effectiveStart: "2026-10-07", effectiveEnd: null },
      ] },
    ],
    versions: [{
      id: "adapter-real-seven-day", publicationId: "adapter-real-publication", status: "published", effectiveStart: "2026-10-05", effectiveEnd: null,
      objective: { requireVerifiedProximity: true },
      slotAvailability: Array.from({ length: 7 }, (_, day) => [availability(slotA, day, "START_A"), availability(slotB, day, "START_B")]).flat(),
      assignments,
    }],
  };
}

const real = await compileStaticWeeklySchedule(sevenDayInput());
assert.equal(real.status, "FEASIBLE", `the database adapter receives a real accepted seven-day compiler result: ${JSON.stringify(real.fatal || real.verifier)}`);
assert.equal(real.verifier.ok, true);
const document = adaptCompiledStaticWeeklySchedule(real, { requirePublishable: true });
assert.equal(document.slot_availability.length, 14, "all seven days and both dated roster slots are materialized");
assert.equal(document.assignments.some((row) => row.work_id === "repeated-work-id" && row.day_of_week === 0), true);
assert.equal(document.assignments.some((row) => row.work_id === "repeated-work-id" && row.day_of_week === 6), true, "same work ID remains distinct across weekdays");
assert.equal(document.slot_availability.find((row) => row.slot_id === "20000000-0000-4000-8000-000000000002" && row.day_of_week === 1).incumbent_name_snapshot, "Jordan Old");
assert.equal(document.slot_availability.find((row) => row.slot_id === "20000000-0000-4000-8000-000000000002" && row.day_of_week === 3).incumbent_name_snapshot, "Jordan New", "effective-dated incumbent change is adapter-derived");
assert.equal(document.assignments.some((row) => row.status === "open" && row.owner_slot_id === null && row.owner_person_id_snapshot === null && row.owner_name_snapshot === null), true, "OPEN rows retain no owner facts");
assert.equal(document.receipt.compiler.certificate.schema, "memphis-zoo.static-weekly-solver-certificate.v5");
assert.equal(document.receipt.compiler.independentVerification.ok, true);
assert.equal("attestation" in document, false, "the pure adapter never receives or emits a scheduler signing key; PostgreSQL v3 attests inside the control plane");

const vacancyInput = sevenDayInput();
const vacantSlot = "20000000-0000-4000-8000-000000000003";
vacancyInput.slots.push({ id: vacantSlot, label: "Stable vacant position", incumbencies: [] });
vacancyInput.versions[0].vacancyCapableSlotIds = [vacantSlot];
vacancyInput.versions[0].vacantSlotIds = [vacantSlot];
vacancyInput.versions[0].slotAvailability.push({
  ...vacancyInput.versions[0].slotAvailability[0],
  slotId: vacantSlot,
  dayOfWeek: 1,
  status: "vacant_unfilled",
  shift: { start: "08:00", end: "17:00" },
  lunch: { start: "12:30", end: "13:30" },
});
vacancyInput.versions[0].assignments.push({
  ...vacancyInput.versions[0].assignments[1],
  workId: "vacant-position-work",
  ownerSlotId: vacantSlot,
  required: true,
});
const vacancyCompiled = await compileStaticWeeklySchedule(vacancyInput);
assert.equal(vacancyCompiled.status, "FEASIBLE", `vacant adapter fixture compiles: ${JSON.stringify(vacancyCompiled.fatal || vacancyCompiled.verifier)}`);
const vacancyDocument = adaptCompiledStaticWeeklySchedule(vacancyCompiled, { requirePublishable: true });
const vacantAvailability = vacancyDocument.slot_availability.find((row) => row.slot_id === vacantSlot);
assert.equal(vacantAvailability.availability_state, "vacant_unfilled");
assert.equal(vacantAvailability.shift_start, "08:00");
assert.equal(vacantAvailability.shift_end, "17:00");
assert.equal(vacantAvailability.lunch_start, "12:30");
assert.equal(vacantAvailability.lunch_end, "13:30");
assert.equal(vacantAvailability.incumbent_person_id_snapshot, null);
assert.equal(vacantAvailability.incumbent_name_snapshot, null);
const vacantAssignment = vacancyDocument.assignments.find((row) => row.work_id === "vacant-position-work");
assert.equal(vacantAssignment.status, "open");
assert.equal(vacantAssignment.owner_slot_id, null);
assert.equal(vacantAssignment.payload_json.authority_facts.baseline_owner_slot_id, vacantSlot);
assert.equal(vacantAssignment.payload_json.authority_facts.baseline_owner_person_id, null);

const draft = createStaticWeeklyDraftRpcInput({ result: real, expectedRevision: 4, actor: manager });
assert.deepEqual(draft.document, document, "the adapter result is deterministic for the exact real compiler result");
assert.deepEqual(draft.objective, real.canonicalAuthority.optimizerResult.objective);
assert.equal(draft.inputProvenance.authority_digest, real.authorityDigest);
const projection = createStaticWeeklyProjectionRpcInput({ result: real, publicationId: "50000000-0000-4000-8000-000000000001", expectedRevision: 5, actor: { ...manager, idempotencyKey: "adapter-unit-projection" } });
assert.equal(projection.envelope.assignments.length, real.weeklyAssignments.length, "projection is the complete seven-day optimizer projection, never a same-day subset");
assert.equal(projection.envelope.assignments.filter((row) => row.status === "open").every((row) => row.owner_slot_id === null && row.owner_person_id === null), true);
assert.deepEqual(
  Object.keys(projection.envelope.semantic_snapshot).sort(),
  ["active_assignments_digest", "applied_exceptions_digest", "overlay_source_digest", "recurring_source_digest", "schema"],
  "the projection snapshot is one compact set of identities and never repeats production-sized source or assignment JSON",
);
assert.equal(projection.envelope.semantic_snapshot.schema, "memphis-zoo.static-weekly-projection-semantic-snapshot.v2");
assert.equal(projection.envelope.semantic_snapshot.active_assignments_digest, postgresJsonbContentDigest(projection.envelope.assignments));
assert.equal(projection.envelope.semantic_snapshot.applied_exceptions_digest, postgresJsonbContentDigest(projection.envelope.applied_exceptions));
assert.equal(Object.values(projection.envelope.semantic_snapshot).some(Array.isArray), false, "the compact snapshot carries no repeated arrays");
assert.deepEqual(
  projection.envelope.assignments.find((row) => row.plan_work_id === "0:repeated-work-id")?.work_snapshot?.includedLocations,
  [
    { locationId: "40000000-0000-4000-8000-000000000011", locationNameSnapshot: "Aquarium" },
    { locationId: "40000000-0000-4000-8000-000000000012", locationNameSnapshot: "Aquarium Restroom" },
  ],
  "a schedule family preserves every exact included area through the attested projection envelope",
);
assert.equal("attestation" in projection.envelope, false, "the pure adapter never emits a dated signing primitive");

const alteredOwner = clone(real);
alteredOwner.canonicalAuthority.optimizerResult.assignments[0].personId = "30000000-0000-4000-8000-000000000003";
assert.throws(() => adaptCompiledStaticWeeklySchedule(alteredOwner), /database_adapter_(compiler_identity_mismatch|independent_verification_failed)/);
const missingCertificate = clone(real); delete missingCertificate.certificate;
assert.throws(() => adaptCompiledStaticWeeklySchedule(missingCertificate), /database_adapter_compiler_verifier_receipt_missing/);
assert.throws(() => adaptCompiledStaticWeeklySchedule({ status: "FEASIBLE", canonicalAuthority: {} }), /database_adapter_authority_schema_invalid/);

const eventOverlay = await compileStaticWeeklySchedule(sevenDayInput({ eventOverlay: true }));
assert.equal(eventOverlay.status, "FEASIBLE", `the accepted event overlay compiles through the real frozen compiler: ${JSON.stringify(eventOverlay.fatal || eventOverlay.verifier)}`);
assert.equal(eventOverlay.verifier.ok, true, "the accepted event overlay compiles through the real frozen verifier");
assert.deepEqual(eventOverlay.canonicalAuthority.appliedExceptions.map((item) => item.id), ["adapter-event-impact-accepted"]);
assert.equal(eventOverlay.weeklyAssignments.some((row) => row.planWorkId === "1:work-1"), false, "event removeWorkIds removes baseline work from the active optimizer result");
assert.equal(eventOverlay.weeklyAssignments.some((row) => row.planWorkId === "1:event-added-work"), true, "event addWork reaches the active optimizer result");

assert.throws(
  () => createStaticWeeklyDraftRpcInput({ result: eventOverlay, expectedRevision: 6, actor: { ...manager, idempotencyKey: "adapter-event-draft" } }),
  /database_adapter_draft_requires_exception_free_baseline_authority/,
  "accepted dated exceptions can never become recurring draft authority",
);
const eventProjection = createStaticWeeklyProjectionRpcInput({ result: eventOverlay, publicationId: "50000000-0000-4000-8000-000000000002", expectedRevision: 7, actor: { ...manager, idempotencyKey: "adapter-event-projection" } });
const expectedEventWork = {
  "event-patch-target": {
    locationId: "40000000-0000-4000-8000-000000000011", locationCodeSnapshot: "EVENT_PATCH", locationNameSnapshot: "Event Patch Exhibit",
    includedLocations: [
      { locationId: "40000000-0000-4000-8000-000000000011", locationNameSnapshot: "Patch Base" },
      { locationId: "40000000-0000-4000-8000-000000000012", locationNameSnapshot: "Patch Restroom" },
    ],
    window: { start: "10:00", end: "11:30" }, serviceEffortMinutes: 45, serviceEffortProvenance: "adapter-test-event-patch-effort-v1",
    priority: 2, priorityProvenance: "adapter-test-event-patch-priority-v1", requiredQualifications: ["general"],
    qualificationProvenance: "adapter-test-event-patch-qualification-v1", restrictions: ["event-patch-restriction"], restrictionProvenance: "adapter-test-event-patch-restriction-v1",
    manualLock: false, overlayWork: false,
  },
  "event-relocated-target": {
    locationId: "40000000-0000-4000-8000-000000000012", locationCodeSnapshot: "EVENT_RELOCATED", locationNameSnapshot: "Relocated Event Exhibit",
    includedLocations: [
      { locationId: "40000000-0000-4000-8000-000000000012", locationNameSnapshot: "Relocated Event Exhibit" },
    ],
    window: { start: "11:00", end: "12:30" }, serviceEffortMinutes: 35, serviceEffortProvenance: "adapter-test-event-relocated-effort-v1",
    priority: 3, priorityProvenance: "adapter-test-event-relocated-priority-v1", requiredQualifications: ["general"],
    qualificationProvenance: "adapter-test-event-relocated-qualification-v1", restrictions: ["event-relocated-restriction"], restrictionProvenance: "adapter-test-event-relocated-restriction-v1",
    manualLock: false, overlayWork: false,
  },
  "event-added-work": {
    locationId: "40000000-0000-4000-8000-000000000011", locationCodeSnapshot: "EVENT_ADD", locationNameSnapshot: "Event Added Exhibit",
    includedLocations: [
      { locationId: "40000000-0000-4000-8000-000000000011", locationNameSnapshot: "Event Added Exhibit" },
      { locationId: "40000000-0000-4000-8000-000000000012", locationNameSnapshot: "Event Added Restroom" },
    ],
    window: { start: "12:00", end: "13:00" }, serviceEffortMinutes: 30, serviceEffortProvenance: "adapter-test-event-add-effort-v1",
    priority: 1, priorityProvenance: "adapter-test-event-add-priority-v1", requiredQualifications: ["general"],
    qualificationProvenance: "adapter-test-event-add-qualification-v1", restrictions: ["event-add-restriction"], restrictionProvenance: "adapter-test-event-add-restriction-v1",
    manualLock: false, overlayWork: true,
  },
};
for (const [workId, expected] of Object.entries(expectedEventWork)) {
  const projectionRow = eventProjection.envelope.assignments.find((row) => row.work_id === workId && row.day_of_week === 1);
  assert.deepEqual({
    workId: projectionRow?.work_snapshot?.workId, dayOfWeek: projectionRow?.work_snapshot?.dayOfWeek, locationId: projectionRow?.work_snapshot?.locationId,
    locationCodeSnapshot: projectionRow?.work_snapshot?.locationCodeSnapshot, locationNameSnapshot: projectionRow?.work_snapshot?.locationNameSnapshot,
    includedLocations: projectionRow?.work_snapshot?.includedLocations,
    window: { start: projectionRow?.work_snapshot?.window?.start, end: projectionRow?.work_snapshot?.window?.end },
    serviceEffortMinutes: projectionRow?.work_snapshot?.serviceEffortMinutes,
    serviceEffortProvenance: projectionRow?.work_snapshot?.serviceEffortProvenance, priority: projectionRow?.work_snapshot?.priority,
    priorityProvenance: projectionRow?.work_snapshot?.priorityProvenance, requiredQualifications: projectionRow?.work_snapshot?.requiredQualifications,
    qualificationProvenance: projectionRow?.work_snapshot?.qualificationProvenance, restrictions: projectionRow?.work_snapshot?.restrictions,
    restrictionProvenance: projectionRow?.work_snapshot?.restrictionProvenance, manualLock: projectionRow?.work_snapshot?.manualLock, overlayWork: projectionRow?.work_snapshot?.overlayWork,
  }, {
    workId, dayOfWeek: 1, locationId: expected.locationId, locationCodeSnapshot: expected.locationCodeSnapshot,
    locationNameSnapshot: expected.locationNameSnapshot, includedLocations: expected.includedLocations, window: expected.window, serviceEffortMinutes: expected.serviceEffortMinutes,
    serviceEffortProvenance: expected.serviceEffortProvenance, priority: expected.priority, priorityProvenance: expected.priorityProvenance,
    requiredQualifications: expected.requiredQualifications, qualificationProvenance: expected.qualificationProvenance,
    restrictions: expected.restrictions, restrictionProvenance: expected.restrictionProvenance, manualLock: expected.manualLock, overlayWork: expected.overlayWork,
  }, `projection uses exact reconstructed post-overlay ${workId} facts`);
  assert.deepEqual(Object.keys(projectionRow.work_snapshot.window).sort(), ["end", "start"], "projection envelope excludes internal minute-only window fields");
}
assert.equal(eventProjection.envelope.assignments.some((row) => row.plan_work_id === "1:work-1"), false, "projection excludes event-removed baseline work");

const mutatedWorkSnapshot = clone(eventOverlay);
mutatedWorkSnapshot.weeklyAssignments.find((row) => row.planWorkId === "1:event-patch-target").workSnapshot.window.end = "12:00";
assert.throws(() => adaptCompiledStaticWeeklySchedule(mutatedWorkSnapshot), /database_adapter_public_assignment_shared_program_mismatch/, "a returned post-overlay work snapshot cannot be mutated after verification");
for (const [field, mutate] of [
  ["location name", (snapshot) => { snapshot.locationNameSnapshot = "forged location name"; }],
  ["service provenance", (snapshot) => { snapshot.serviceEffortProvenance = "forged effort provenance"; }],
  ["qualification", (snapshot) => { snapshot.requiredQualifications = ["forged qualification"]; }],
  ["restriction", (snapshot) => { snapshot.restrictions = ["forged restriction"]; }],
]) {
  const forged = clone(eventOverlay);
  mutate(forged.weeklyAssignments.find((row) => row.planWorkId === "1:event-patch-target").workSnapshot);
  assert.throws(() => adaptCompiledStaticWeeklySchedule(forged), /database_adapter_public_assignment_shared_program_mismatch/, `caller-owned ${field} mutation is rejected against shared program authority`);
}
const mutatedOptimizerBinding = clone(eventOverlay);
mutatedOptimizerBinding.canonicalAuthority.optimizerResult.assignments.find((row) => row.planWorkId === "1:event-added-work").status = "OPEN";
assert.throws(() => adaptCompiledStaticWeeklySchedule(mutatedOptimizerBinding), /database_adapter_compiler_identity_mismatch/, "a canonical optimizer binding cannot be mutated after verification");

const review = await compileStaticWeeklySchedule(sevenDayInput({ review: true }));
assert.equal(review.status, "REVIEW");
const reviewDocument = adaptCompiledStaticWeeklySchedule(review);
assert.equal(reviewDocument.assignments.some((row) => row.status === "review" && row.owner_slot_id === null && row.owner_person_id_snapshot === null && row.owner_name_snapshot === null), true, "REVIEW rows are adapter-derived and ownerless");
assert.throws(() => createStaticWeeklyDraftRpcInput({ result: review, expectedRevision: 0, actor: manager }), /database_adapter_publishable_result_required/);

console.log("static weekly schedule database adapter tests: PASS");
