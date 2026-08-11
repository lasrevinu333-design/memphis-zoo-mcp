#!/usr/bin/env node
import assert from "node:assert/strict";
import { compileStaticWeeklySchedule } from "../src/static-weekly-schedule-compiler.js";
import {
  adaptCompiledStaticWeeklySchedule,
  createStaticWeeklyDraftRpcInput,
  createStaticWeeklyProjectionRpcInput,
} from "../src/static-weekly-schedule-database-adapter.js";

const clone = (value) => JSON.parse(JSON.stringify(value));
const manager = { managerId: "10000000-0000-4000-8000-000000000001", managerName: "Named Manager", idempotencyKey: "adapter-unit-draft" };

function sevenDayInput({ review = false } = {}) {
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
  assignments.push(work("optional-open", 4, placeB, slotB, { required: false, coveragePolicy: "permitted_open", requiredQualifications: ["unavailable-optional"] }));
  return {
    serviceDate: "2026-10-05", timezone: "America/Chicago", exceptions: [],
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
assert.equal(real.status, "FEASIBLE", "the database adapter receives a real accepted seven-day compiler result");
assert.equal(real.verifier.ok, true);
const document = adaptCompiledStaticWeeklySchedule(real, { requirePublishable: true });
assert.equal(document.slot_availability.length, 14, "all seven days and both dated roster slots are materialized");
assert.equal(document.assignments.some((row) => row.work_id === "repeated-work-id" && row.day_of_week === 0), true);
assert.equal(document.assignments.some((row) => row.work_id === "repeated-work-id" && row.day_of_week === 6), true, "same work ID remains distinct across weekdays");
assert.equal(document.slot_availability.find((row) => row.slot_id === "20000000-0000-4000-8000-000000000002" && row.day_of_week === 1).incumbent_name_snapshot, "Jordan Old");
assert.equal(document.slot_availability.find((row) => row.slot_id === "20000000-0000-4000-8000-000000000002" && row.day_of_week === 3).incumbent_name_snapshot, "Jordan New", "effective-dated incumbent change is adapter-derived");
assert.equal(document.assignments.some((row) => row.status === "open" && row.owner_slot_id === null && row.owner_person_id_snapshot === null && row.owner_name_snapshot === null), true, "OPEN rows retain no owner facts");
assert.equal(document.receipt.compiler.certificate.schema, "memphis-zoo.static-weekly-solver-certificate.v4");
assert.equal(document.receipt.compiler.independentVerification.ok, true);

const draft = createStaticWeeklyDraftRpcInput({ result: real, expectedRevision: 4, actor: manager });
assert.deepEqual(draft.document, document, "the adapter result is deterministic for the exact real compiler result");
assert.deepEqual(draft.objective, real.canonicalAuthority.optimizerResult.objective);
assert.equal(draft.inputProvenance.authority_digest, real.authorityDigest);
const projection = createStaticWeeklyProjectionRpcInput({ result: real, publicationId: "50000000-0000-4000-8000-000000000001", expectedRevision: 5, actor: { ...manager, idempotencyKey: "adapter-unit-projection" } });
assert.equal(projection.envelope.assignments.length, real.weeklyAssignments.length, "projection is the complete seven-day optimizer projection, never a same-day subset");
assert.equal(projection.envelope.assignments.filter((row) => row.status === "open").every((row) => row.owner_slot_id === null && row.owner_person_id === null), true);

const alteredOwner = clone(real);
alteredOwner.canonicalAuthority.optimizerResult.assignments[0].personId = "30000000-0000-4000-8000-000000000003";
assert.throws(() => adaptCompiledStaticWeeklySchedule(alteredOwner), /database_adapter_(compiler_identity_mismatch|independent_verification_failed)/);
const missingCertificate = clone(real); delete missingCertificate.certificate;
assert.throws(() => adaptCompiledStaticWeeklySchedule(missingCertificate), /database_adapter_compiler_verifier_receipt_missing/);
assert.throws(() => adaptCompiledStaticWeeklySchedule({ status: "FEASIBLE", canonicalAuthority: {} }), /database_adapter_authority_schema_invalid/);

const review = await compileStaticWeeklySchedule(sevenDayInput({ review: true }));
assert.equal(review.status, "REVIEW");
const reviewDocument = adaptCompiledStaticWeeklySchedule(review);
assert.equal(reviewDocument.assignments.some((row) => row.status === "review" && row.owner_slot_id === null && row.owner_person_id_snapshot === null && row.owner_name_snapshot === null), true, "REVIEW rows are adapter-derived and ownerless");
assert.throws(() => createStaticWeeklyDraftRpcInput({ result: review, expectedRevision: 0, actor: manager }), /database_adapter_publishable_result_required/);

console.log("static weekly schedule database adapter tests: PASS");
