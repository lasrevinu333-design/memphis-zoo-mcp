/*
 * Static-weekly database authority adapter.
 *
 * This is the one intentional trust boundary between the frozen I1 compiler /
 * independent verifier and I2's relational authority store.  It never accepts
 * a caller-assembled schedule, owner, receipt, digest, or feasibility claim:
 * every such value below is derived from a successful compiler result and is
 * reverified before it can become an RPC argument.
 */
import { postgresJsonbContentDigest } from "./static-weekly-schedule-compiler.js";
import { verifyStaticWeeklyScheduleResult } from "./static-weekly-schedule-verifier.js";

export const STATIC_WEEKLY_DATABASE_ADAPTER_SCHEMA = "memphis-zoo.static-weekly-database-adapter.v1";
export const STATIC_WEEKLY_DATABASE_ADAPTER_VERSION = "static-weekly-database-adapter-v1";

const clone = (value) => JSON.parse(JSON.stringify(value));
const array = (value) => Array.isArray(value) ? value : [];
const text = (value) => typeof value === "string" ? value : "";
const fail = (code, detail = {}) => {
  const error = new Error(code);
  error.code = code;
  Object.assign(error, detail);
  throw error;
};
const stable = (rows, compare) => rows.slice().sort(compare);
const dayCompare = (left, right) => Number(left.dayOfWeek ?? left.day_of_week) - Number(right.dayOfWeek ?? right.day_of_week)
  || text(left.slotId ?? left.slot_id ?? left.workId ?? left.work_id).localeCompare(text(right.slotId ?? right.slot_id ?? right.workId ?? right.work_id));

function requireActor(actor = {}) {
  if (!text(actor.managerId) || !text(actor.managerName) || !text(actor.idempotencyKey)) fail("database_adapter_actor_identity_required");
  return { managerId: actor.managerId, managerName: actor.managerName, idempotencyKey: actor.idempotencyKey };
}

function requireRevision(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) fail("database_adapter_expected_revision_required", { field });
  return value;
}

function optimizerBinding(assignment) {
  return {
    planWorkId: assignment?.planWorkId,
    workId: assignment?.workId,
    dayOfWeek: assignment?.dayOfWeek,
    serviceDate: assignment?.serviceDate,
    status: assignment?.status,
    slotId: assignment?.slotId,
    personId: assignment?.personId,
    displayName: assignment?.displayName,
    ownerDigest: assignment?.ownerDigest,
    exactOwnerIdentity: assignment?.exactOwnerIdentity,
    baselineSlotId: assignment?.baselineSlotId,
    baselineOwnerPersonId: assignment?.baselineOwnerPersonId,
    baselineOwnerName: assignment?.baselineOwnerName,
    originalActorPersonId: assignment?.originalActorPersonId,
    originalActorName: assignment?.originalActorName,
    optimizedOwnerSlotId: assignment?.optimizedOwnerSlotId,
    optimizedOwnerPersonId: assignment?.optimizedOwnerPersonId,
    actualActorPersonId: assignment?.actualActorPersonId,
    window: { start: assignment?.window?.start ?? null, end: assignment?.window?.end ?? null },
    serviceEffortMinutes: assignment?.serviceEffortMinutes,
  };
}

function activeWorkByPlanId(result, authority) {
  // The compiler's canonical optimizer rows establish the immutable binding,
  // while its independently verified public weekly assignments are the only
  // source of post-overlay work snapshots.  In particular, do not reconstruct
  // event overlays from compilerInput here: that would create a second overlay
  // implementation at the database trust boundary.
  const optimizer = stable(array(authority?.optimizerResult?.assignments), (left, right) => text(left.planWorkId).localeCompare(text(right.planWorkId)));
  const canonical = new Map();
  for (const assignment of optimizer) {
    const binding = optimizerBinding(assignment);
    const planWorkId = text(binding.planWorkId);
    const workId = text(binding.workId);
    const dayOfWeek = Number(binding.dayOfWeek);
    const status = text(binding.status);
    if (!planWorkId || !workId || !Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6
      || planWorkId !== `${dayOfWeek}:${workId}` || !text(binding.serviceDate)
      || !["ASSIGNED", "OPEN", "REVIEW"].includes(status)
      || !binding.window?.start || !binding.window?.end || !Number.isFinite(Number(binding.serviceEffortMinutes))) {
      fail("database_adapter_canonical_optimizer_assignment_invalid", { planWorkId });
    }
    if (status === "ASSIGNED" && (!text(binding.slotId) || !text(binding.personId) || !text(binding.displayName))) fail("database_adapter_optimizer_owner_invalid", { planWorkId });
    if (status !== "ASSIGNED" && (binding.slotId != null || binding.personId != null || binding.displayName != null)) fail("database_adapter_open_review_owner_invalid", { planWorkId });
    if (canonical.has(planWorkId)) fail("database_adapter_duplicate_optimizer_assignment", { planWorkId });
    canonical.set(planWorkId, binding);
  }

  const source = array(result?.weeklyAssignments);
  if (source.length !== canonical.size) fail("database_adapter_optimizer_work_cardinality_invalid", { optimizerCount: canonical.size, sourceCount: source.length });
  const workByPlanId = new Map();
  for (const assignment of source) {
    const planWorkId = text(assignment?.planWorkId);
    const binding = canonical.get(planWorkId);
    if (!planWorkId || workByPlanId.has(planWorkId)) fail("database_adapter_duplicate_compiled_work_snapshot", { planWorkId });
    if (!binding) fail("database_adapter_extra_compiled_work_snapshot", { planWorkId });
    if (postgresJsonbContentDigest(optimizerBinding(assignment)) !== postgresJsonbContentDigest(binding)) {
      fail("database_adapter_compiler_optimizer_binding_mismatch", { planWorkId });
    }
    const work = assignment?.workSnapshot;
    if (!work || typeof work !== "object" || Array.isArray(work)
      || work.workId !== binding.workId || Number(work.dayOfWeek) !== Number(binding.dayOfWeek)
      || (work.locationId ?? null) !== (assignment.locationId ?? null)
      || work.window?.start !== binding.window.start || work.window?.end !== binding.window.end
      || Number(work.serviceEffortMinutes) !== Number(binding.serviceEffortMinutes)
      || !text(work.locationCodeSnapshot) || !text(work.locationNameSnapshot)
      || !text(work.serviceEffortProvenance) || !Array.isArray(work.requiredQualifications)
      || !Array.isArray(work.restrictions)) {
      fail("database_adapter_work_snapshot_binding_mismatch", { planWorkId });
    }
    workByPlanId.set(planWorkId, clone(work));
  }
  for (const planWorkId of canonical.keys()) if (!workByPlanId.has(planWorkId)) fail("database_adapter_compiled_work_snapshot_missing", { planWorkId });
  return { optimizer, workByPlanId };
}

function slotById(authority) {
  const map = new Map();
  for (const slot of array(authority?.compilerInput?.slots)) {
    if (!text(slot?.id) || !text(slot?.label) || map.has(slot.id)) fail("database_adapter_compiler_slot_identity_invalid");
    map.set(slot.id, slot);
  }
  return map;
}

function canonicalReceipt(result, authority, verification) {
  return {
    schema: STATIC_WEEKLY_DATABASE_ADAPTER_SCHEMA,
    adapterVersion: STATIC_WEEKLY_DATABASE_ADAPTER_VERSION,
    trustedAdapterBoundary: "I1 compileStaticWeeklySchedule result independently reverified before I2 persistence",
    compiler: {
      contract: result.contract,
      compilerVersion: result.compilerVersion,
      serviceDate: result.serviceDate,
      status: result.status,
      publicationAuthority: result.publicationAuthority,
      inputDigest: result.inputDigest,
      weeklyVersionId: result.weeklyVersionId,
      weeklyVersionDigest: result.weeklyVersionDigest,
      solutionDigest: result.solutionDigest,
      authorityDigest: result.authorityDigest,
      replayDigest: result.replayDigest,
      canonicalAuthority: clone(authority),
      authorityCertificate: clone(authority.optimizerResult?.certificate),
      authorityTiers: clone(authority.optimizerResult?.tiers),
      certificate: clone(result.certificate),
      solver: clone(result.solver),
      verifier: clone(result.verifier),
      independentVerification: clone(verification),
    },
  };
}

function verifierInputFromCanonicalAuthority(authority, result) {
  const canonical = clone(authority.overlayCompilerInput);
  const version = canonical.version;
  delete canonical.version;
  return {
    ...canonical,
    serviceDate: canonical.serviceDate || authority.effectiveDate,
    timezone: result.timezone,
    versions: [version],
  };
}

function validateCompiledResult(result, { allowReview = true } = {}) {
  if (!result || typeof result !== "object" || !result.canonicalAuthority) fail("database_adapter_compiler_result_required");
  const authority = result.canonicalAuthority;
  if (authority.schema !== "memphis-zoo.static-weekly-authority.v3" || !text(authority.effectiveDate)) fail("database_adapter_authority_schema_invalid");
  if (!allowReview && result.status !== "FEASIBLE") fail("database_adapter_publishable_result_required");
  if (!allowReview && result.publicationAuthority !== "ACCEPTABLE") fail("database_adapter_publishable_authority_required");
  if (!text(result.replayDigest) || !text(result.authorityDigest) || !text(result.solutionDigest) || !text(result.inputDigest)) fail("database_adapter_compiler_identity_missing");
  if (postgresJsonbContentDigest(authority) !== result.authorityDigest
    || postgresJsonbContentDigest(authority.optimizerResult) !== result.solutionDigest
    || postgresJsonbContentDigest(authority.overlayCompilerInput) !== result.inputDigest) fail("database_adapter_compiler_identity_mismatch");
  const authorityWithoutIdentity = clone(authority);
  delete authorityWithoutIdentity.databaseContentIdentity;
  if (authority.databaseContentIdentity !== postgresJsonbContentDigest(authorityWithoutIdentity)) fail("database_adapter_authority_content_identity_mismatch");
  if (!result.certificate || !result.solver || !result.verifier?.ok || result.verifier?.verifierVersion !== "static-weekly-js-verifier-v4-monotonic-leximax") fail("database_adapter_compiler_verifier_receipt_missing");
  if (result.certificate.schema !== "memphis-zoo.static-weekly-solver-certificate.v4"
    || !result.certificate.modelBasis || !Array.isArray(result.certificate.tiers)
    || !Array.isArray(result.solver.tiers) || !Array.isArray(authority.optimizerResult?.tiers)
    || !authority.optimizerResult?.certificate) fail("database_adapter_solver_receipt_incomplete");
  const independentlyVerified = verifyStaticWeeklyScheduleResult(verifierInputFromCanonicalAuthority(authority, result), result);
  if (!independentlyVerified.ok || independentlyVerified.digest !== result.verifier.digest) fail("database_adapter_independent_verification_failed", { violations: independentlyVerified.violations });
  return { authority, independentlyVerified };
}

function slotAvailabilityRows(authority) {
  const slots = slotById(authority);
  const rows = stable(array(authority.projectionAvailability), dayCompare).map((availability) => {
    const slot = slots.get(availability.slotId);
    if (!slot || !Number.isInteger(availability.dayOfWeek) || availability.dayOfWeek < 0 || availability.dayOfWeek > 6) fail("database_adapter_projection_availability_invalid");
    const state = text(availability.status);
    const working = state === "working";
    const shift = availability.shift || {};
    const lunch = availability.lunch || {};
    return {
      slot_id: availability.slotId,
      day_of_week: availability.dayOfWeek,
      availability_state: state,
      shift_start: working ? shift.start ?? null : null,
      shift_end: working ? shift.end ?? null : null,
      lunch_start: lunch.start ?? null,
      lunch_end: lunch.end ?? null,
      capacity_units: working ? availability.productiveCapacityMinutes ?? null : null,
      max_load_points: working ? availability.maxServiceEffortMinutes ?? null : null,
      qualification_snapshot: clone(availability.qualifications || []),
      qualification_provenance: { source: availability.qualificationProvenance || null },
      restriction_snapshot: clone(availability.restrictions || []),
      restriction_provenance: { source: availability.restrictionProvenance || null },
      slot_label_snapshot: slot.label,
      incumbent_person_id_snapshot: availability.incumbentPersonId ?? null,
      incumbent_name_snapshot: availability.incumbentName ?? null,
    };
  });
  if (!rows.length) fail("database_adapter_projection_availability_missing");
  return rows;
}

function draftAssignmentRows(authority, activeWork) {
  const { workByPlanId, optimizer } = activeWork;
  const slotMap = slotById(authority);
  if (optimizer.length !== workByPlanId.size) fail("database_adapter_optimizer_work_cardinality_invalid");
  const seen = new Set();
  return optimizer.map((assignment) => {
    const planWorkId = text(assignment.planWorkId);
    const work = workByPlanId.get(planWorkId);
    if (!work || seen.has(planWorkId) || !["ASSIGNED", "OPEN", "REVIEW"].includes(assignment.status)) fail("database_adapter_optimizer_assignment_invalid", { planWorkId });
    seen.add(planWorkId);
    const assigned = assignment.status === "ASSIGNED";
    const ownerSlot = assigned ? slotMap.get(assignment.slotId) : null;
    if (assigned && (!ownerSlot || !assignment.personId || !assignment.displayName)) fail("database_adapter_optimizer_owner_invalid", { planWorkId });
    if (!assigned && (assignment.slotId != null || assignment.personId != null || assignment.displayName != null)) fail("database_adapter_open_review_owner_invalid", { planWorkId });
    return {
      work_id: text(work.workId || work.id),
      day_of_week: work.dayOfWeek,
      status: assignment.status.toLowerCase(),
      location_id: work.locationId ?? null,
      location_code_snapshot: text(work.locationCodeSnapshot || work.locationCode || work.locationId),
      location_name_snapshot: text(work.locationNameSnapshot || work.locationName || work.locationId),
      coverage_start: work.window?.start ?? null,
      coverage_end: work.window?.end ?? null,
      owner_slot_id: assigned ? assignment.slotId : null,
      owner_slot_label_snapshot: assigned ? ownerSlot.label : null,
      owner_person_id_snapshot: assigned ? assignment.personId : null,
      owner_name_snapshot: assigned ? assignment.displayName : null,
      required_qualifications_snapshot: clone(work.requiredQualifications || []),
      restriction_snapshot: clone(work.restrictions || []),
      workload_points: work.serviceEffortMinutes,
      workload_provenance: { source: work.serviceEffortProvenance || null },
      manual_lock: Boolean(work.manualLock),
      payload_json: {
        plan_work_id: planWorkId,
        status: assignment.status.toLowerCase(),
        owner_digest: assignment.ownerDigest,
        exact_owner_identity: assignment.exactOwnerIdentity,
        authority_facts: {
          stable_roster_slot_id: assignment.baselineSlotId,
          baseline_owner_slot_id: assignment.baselineSlotId,
          baseline_owner_person_id: assignment.baselineOwnerPersonId,
          baseline_owner_name: assignment.baselineOwnerName,
          original_actor_person_id: assignment.originalActorPersonId,
          original_actor_name: assignment.originalActorName,
          optimized_owner_slot_id: assignment.optimizedOwnerSlotId,
          optimized_owner_person_id: assignment.optimizedOwnerPersonId,
        },
      },
    };
  });
}

function projectionAssignmentRows(activeWork) {
  const { workByPlanId, optimizer } = activeWork;
  return optimizer.map((assignment) => {
    const work = workByPlanId.get(text(assignment.planWorkId));
    if (!work) fail("database_adapter_projection_work_missing", { planWorkId: assignment.planWorkId });
    const assigned = assignment.status === "ASSIGNED";
    return {
      plan_work_id: assignment.planWorkId,
      work_id: text(work.workId || work.id),
      day_of_week: work.dayOfWeek,
      service_date: assignment.serviceDate,
      status: assignment.status.toLowerCase(),
      reason_code: assignment.explanation?.reasons?.[0]?.code ?? null,
      owner_slot_id: assigned ? assignment.slotId : null,
      owner_person_id: assigned ? assignment.personId : null,
      owner_digest: assignment.ownerDigest,
      exact_owner_identity: assignment.exactOwnerIdentity,
      baseline_owner_slot_id: assignment.baselineSlotId,
      baseline_owner_person_id: assignment.baselineOwnerPersonId,
      baseline_owner_name: assignment.baselineOwnerName,
      original_actor_person_id: assignment.originalActorPersonId,
      original_actor_name: assignment.originalActorName,
      optimized_owner_slot_id: assignment.optimizedOwnerSlotId,
      optimized_owner_person_id: assignment.optimizedOwnerPersonId,
      work_snapshot: {
        workId: text(work.workId || work.id), dayOfWeek: work.dayOfWeek, locationId: work.locationId ?? null,
        locationCodeSnapshot: text(work.locationCodeSnapshot || work.locationCode || work.locationId),
        locationNameSnapshot: text(work.locationNameSnapshot || work.locationName || work.locationId),
        window: clone(work.window), serviceEffortMinutes: work.serviceEffortMinutes,
        requiredQualifications: clone(work.requiredQualifications || []), restrictions: clone(work.restrictions || []),
      },
      explanation: clone(assignment.explanation || {}),
    };
  });
}

function buildAdaptedStaticWeeklySchedule(result, { requirePublishable = false } = {}) {
  const { authority, independentlyVerified } = validateCompiledResult(result, { allowReview: !requirePublishable });
  const activeWork = activeWorkByPlanId(result, authority);
  const document = {
    adapter: { schema: STATIC_WEEKLY_DATABASE_ADAPTER_SCHEMA, version: STATIC_WEEKLY_DATABASE_ADAPTER_VERSION },
    authority: clone(authority),
    receipt: canonicalReceipt(result, authority, independentlyVerified),
    slot_availability: slotAvailabilityRows(authority),
    assignments: draftAssignmentRows(authority, activeWork),
    objective_inputs: [{
      input_key: "static_weekly_compiler_receipt",
      input_value: { compiler_version: result.compilerVersion, authority_digest: result.authorityDigest, replay_digest: result.replayDigest },
      provenance: { adapter_schema: STATIC_WEEKLY_DATABASE_ADAPTER_SCHEMA, independently_verified: true },
    }],
  };
  document.validation = {
    status: result.status,
    publication_authority: result.publicationAuthority,
    compiler_version: result.compilerVersion,
    input_digest: result.inputDigest,
    solution_digest: result.solutionDigest,
    authority_digest: result.authorityDigest,
    replay_digest: result.replayDigest,
    receipt_digest: postgresJsonbContentDigest(document.receipt),
  };
  const identity = { adapter: document.adapter, authority: document.authority, receipt: document.receipt, slot_availability: document.slot_availability, assignments: document.assignments, objective_inputs: document.objective_inputs };
  document.validation.database_document_identity = postgresJsonbContentDigest(identity);
  return { document, activeWork };
}

export function adaptCompiledStaticWeeklySchedule(result, options = {}) {
  return buildAdaptedStaticWeeklySchedule(result, options).document;
}

export function createStaticWeeklyDraftRpcInput({ result, expectedRevision, actor }) {
  const identity = requireActor(actor);
  const { document } = buildAdaptedStaticWeeklySchedule(result, { requirePublishable: true });
  return {
    effectiveStart: result.serviceDate,
    objectiveVersion: result.compilerVersion,
    objective: clone(result.canonicalAuthority.optimizerResult.objective),
    inputProvenance: {
      adapter_schema: STATIC_WEEKLY_DATABASE_ADAPTER_SCHEMA,
      compiler_version: result.compilerVersion,
      input_digest: result.inputDigest,
      baseline_input_digest: result.canonicalAuthority.baselineInputDigest,
      authority_digest: result.authorityDigest,
      replay_digest: result.replayDigest,
    },
    document,
    expectedRevision: requireRevision(expectedRevision, "expectedRevision"),
    actorManagerId: identity.managerId,
    actorManagerName: identity.managerName,
    idempotencyKey: identity.idempotencyKey,
  };
}

export function createStaticWeeklyProjectionRpcInput({ result, publicationId, expectedRevision, actor }) {
  const identity = requireActor(actor);
  if (!text(publicationId)) fail("database_adapter_publication_identity_required");
  const { document, activeWork } = buildAdaptedStaticWeeklySchedule(result, { requirePublishable: false });
  const authority = document.authority;
  const assignments = projectionAssignmentRows(activeWork);
  const envelope = {
    adapter: document.adapter,
    service_date: result.serviceDate,
    week_start: authority.effectiveDate,
    week_end: new Date(`${authority.effectiveDate}T00:00:00Z`).toISOString().slice(0, 10),
    authority: clone(authority),
    receipt: clone(document.receipt),
    authority_digest: result.authorityDigest,
    replay_digest: result.replayDigest,
    compiler_version: result.compilerVersion,
    objective: clone(authority.optimizerResult.objective),
    metrics: clone(authority.optimizerResult.metrics),
    applied_exceptions: clone(authority.appliedExceptions),
    assignments,
  };
  // SQL derives the inclusive seven-day date set from the stored compiler
  // authority; this field is merely a deterministic adapter echo, never a
  // caller-selected projection scope.
  const start = new Date(`${authority.effectiveDate}T00:00:00Z`);
  envelope.week_end = new Date(start.getTime() + (6 * 86_400_000)).toISOString().slice(0, 10);
  envelope.database_projection_identity = postgresJsonbContentDigest({ ...envelope });
  return {
    publicationId,
    serviceDate: result.serviceDate,
    exceptionSetDigest: postgresJsonbContentDigest(array(authority.appliedExceptions).map((item) => ({ id: item.id, type: item.type, serviceDate: item.serviceDate, payloadDigest: item.payloadDigest }))),
    compilerVersion: result.compilerVersion,
    objective: clone(authority.optimizerResult.objective),
    metrics: clone(authority.optimizerResult.metrics),
    replayDigest: result.replayDigest,
    envelope,
    expectedRevision: requireRevision(expectedRevision, "expectedRevision"),
    actorManagerId: identity.managerId,
    actorManagerName: identity.managerName,
    idempotencyKey: identity.idempotencyKey,
  };
}
