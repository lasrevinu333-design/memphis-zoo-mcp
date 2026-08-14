#!/usr/bin/env node
// Contract checks for the separated scheduler mutation process. These do not
// need a database: the v3 database suite proves the stored procedures, while
// this test proves the ordinary process cannot quietly become an authority
// caller or signer again.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createStaticWeeklyControlPlane } from "../src/static-weekly-control-plane.js";
import { compileStaticWeeklySchedule } from "../src/static-weekly-schedule-compiler.js";

const root = resolve(new URL("..", import.meta.url).pathname);
const controlPlaneSource = readFileSync(resolve(root, "src/static-weekly-control-plane.js"), "utf8");
const runtimeSource = readFileSync(resolve(root, "src/static-weekly-control-plane-runtime.js"), "utf8");
const ordinaryApiSource = readFileSync(resolve(root, "src/index.js"), "utf8");

assert.doesNotMatch(controlPlaneSource, /STATIC_WEEKLY_AUTHORITY_ATTESTATION_SECRET|createHmac\s*\(/, "the control plane must never hold an application HMAC secret");
assert.match(controlPlaneSource, /set local role static_weekly_control_plane/, "all database authority calls must enter the constrained control-plane role");
assert.doesNotMatch(controlPlaneSource, /static_weekly_v2_/, "the control plane may invoke only the v3 authority boundary");
assert.match(controlPlaneSource, /static_weekly_v3_read_authority_source/, "first-publication drafts must load a release-registered source of record server-side");
assert.match(controlPlaneSource, /source\.source_id/, "draft creation must bind the immutable server-side source identity to PostgreSQL");
assert.match(runtimeSource, /requireManagerWrite, namedManager/, "every scheduler mutation route must require a trusted named manager writer");
assert.match(runtimeSource, /\/static-weekly\/manager-snapshot[^\n]+requireManagerWrite, namedManager/, "the scheduler snapshot must use the same current named-manager association gate as mutations");
assert.match(runtimeSource, /\/static-weekly\/drafts\/initial/, "the separately deployed control plane must expose a deployable first-draft path without accepting source facts");
assert.match(runtimeSource, /\/static-weekly\/employees\/departed/, "the control plane must expose one bounded departure transaction");
assert.match(runtimeSource, /\/static-weekly\/employees\/replacements/, "the control plane must expose one bounded fresh-start replacement transaction");
assert.match(runtimeSource, /\/static-weekly\/rebuild-current-projection/, "the control plane must expose the named rebuild-only recovery command");
assert.match(controlPlaneSource, /projectionIdempotencyKey/, "atomic projection subcommands must derive their own idempotency key");
assert.doesNotMatch(runtimeSource, /\/static-weekly\/incumbencies/, "the arbitrary person/date incumbency writer must not be routable");
assert.doesNotMatch(controlPlaneSource, /replaceIncumbency|static_weekly_v3_replace_incumbency/, "the legacy incumbency client must be removed, not hidden");
assert.doesNotMatch(ordinaryApiSource, /static_weekly_v3_|static-weekly-control-plane/, "the ordinary API must not expose scheduler authority mutations");
assert.match(ordinaryApiSource, /\/scheduler-runtime-config/, "the ordinary API must expose the separately configured scheduler service origin to the static frontend");
assert.match(ordinaryApiSource, /STATIC_WEEKLY_CONTROL_PLANE_PUBLIC_URL/, "the scheduler service origin must come from deployment configuration");

const solverIdentity = { package: "highs@1.15.2" };
const manager = { manager_id: "10000000-0000-4000-8000-000000000001", manager_display_name: "Named Manager", auth_mode: "trusted_device", trusted_device: true, read_only: false };
const publicationId = "70000000-0000-4000-8000-000000000001";
const versionId = "60000000-0000-4000-8000-000000000001";
const contractorSlot = "20000000-0000-4000-8000-000000000099";

function compilerInput() {
  const availability = {
    slotId: "slot-a", dayOfWeek: 1, status: "working", shift: { start: "07:00", end: "16:00" },
    productiveCapacityProvenance: "control-plane-test-shift", maxServiceEffortMinutes: 300,
    maxServiceEffortProvenance: "control-plane-test-capacity", qualifications: ["general"],
    qualificationProvenance: "control-plane-test-qualification", restrictions: [],
    restrictionProvenance: "control-plane-test-restriction", acceptedRouteAnchorLocationId: "location-a",
    acceptedRouteProvenance: "control-plane-test-route",
  };
  return {
    serviceDate: "2026-10-05", timezone: "America/Chicago", exceptions: [], proximity: [],
    slots: [{ id: "slot-a", label: "Slot A", incumbencies: [{ personId: "person-a", displayName: "Worker A", effectiveStart: "2020-01-01", effectiveEnd: null }] }],
    versions: [{ id: "version-a", publicationId: "publication-a", status: "published", effectiveStart: "2026-10-05", effectiveEnd: null, objective: { requireVerifiedProximity: true }, slotAvailability: [availability], assignments: [{ workId: "work-a", dayOfWeek: 1, locationId: "location-a", window: { start: "08:00", end: "09:00" }, ownerSlotId: "slot-a", serviceEffortMinutes: 20, serviceEffortProvenance: "control-plane-test-effort", priority: 1, priorityProvenance: "control-plane-test-priority", requiredQualifications: ["general"], qualificationProvenance: "control-plane-test-work-qualification", restrictions: [], restrictionProvenance: "control-plane-test-work-restriction" }] }],
  };
}

const acceptedProjection = await compileStaticWeeklySchedule(compilerInput());
assert.equal(acceptedProjection.status, "FEASIBLE", "the control-plane transaction test needs one independently accepted projection");
assert.equal(acceptedProjection.verifier.ok, true);

function createAuthorityDatabase({ revision: initialRevision = 0 } = {}) {
  const queries = [];
  const materializations = new Map();
  let revision = initialRevision;
  let projection = null;
  let transactionRevision = null;
  let commits = 0;
  const source = {
    compiler_input: {
      slots: [{ id: contractorSlot, contractorCapacity: true, contractorAvailability: [{ dayOfWeek: 2, shift: { start: "07:00", end: "16:00" }, productiveCapacityProvenance: "approved contractor shift", maxServiceEffortMinutes: 300, maxServiceEffortProvenance: "approved contractor limit", qualifications: ["general"], qualificationProvenance: "approved contractor role", restrictions: [], restrictionProvenance: "approved contractor restrictions", acceptedRouteAnchorLocationId: "40000000-0000-4000-8000-000000000099", acceptedRouteProvenance: "approved contractor staging" }] }],
      version: { slotAvailability: [] }, proximity: [],
    },
    exceptions: [],
  };
  const client = {
    async query(statement, values = []) {
      queries.push({ statement, values });
      if (statement === "begin") { transactionRevision = revision; return { rows: [] }; }
      if (statement === "commit") { commits += 1; transactionRevision = null; return { rows: [] }; }
      if (statement === "rollback") { revision = transactionRevision; transactionRevision = null; return { rows: [] }; }
      if (statement.includes("static_weekly_v3_authority_health")) return { rows: [{ result: { ready: true, active_key_count: 1, key_ids: [{ key_id: "static-weekly-authority-hmac-v3", state: "active" }] } }] };
      if (statement.includes("static_weekly_v3_read_publication_source")) return { rows: [{ result: source }] };
      if (statement.includes("static_weekly_v3_read_manager_snapshot")) return { rows: [{ result: { schema: "memphis-zoo.static-weekly-manager-snapshot.v1", week_start: values[0], authority_revision: revision, current_publication: { publication_id: publicationId, version_id: versionId }, projection_status: projection ? "current" : "missing", latest_projection: projection } }] };
      if (statement.includes("static_weekly_v3_publish_draft")) { revision = values[2] + 1; return { rows: [{ result: { revision, data: { publication_id: publicationId, version_id: versionId, effective_start: "2026-10-05" } } }] }; }
      if (statement.includes("static_weekly_v3_apply_exception")) { revision = values[8] + 1; return { rows: [{ result: { revision, data: { exception_id: `exception-${revision}` } } }] }; }
      if (statement.includes("static_weekly_v4_mark_employee_departed")) { revision = values[2] + 1; return { rows: [{ result: { revision, data: { slot_id: values[0] } } }] }; }
      if (statement.includes("static_weekly_v4_replace_employee")) { revision = values[3] + 1; return { rows: [{ result: { revision, data: { new_employee_name: values[1] } } }] }; }
      if (statement.includes("static_weekly_v3_materialize_projection")) {
        const key = values[10];
        if (materializations.has(key)) return { rows: [{ result: materializations.get(key) }] };
        revision = values[8] + 1;
        projection = { projection_id: `projection-${revision}`, publication_id: values[0], week_start: values[1], assignments: [{ work_id: "work-a" }] };
        const result = { operation: "materialize_projection", revision, data: { projection_id: projection.projection_id, publication_id: values[0], week_start: values[1] } };
        materializations.set(key, result);
        return { rows: [{ result }] };
      }
      return { rows: [] };
    },
    release() {},
  };
  return { database: { async connect() { return client; } }, queries, revision: () => revision, commits: () => commits };
}

function controlPlaneFor(authority, compiler = async () => acceptedProjection) {
  return createStaticWeeklyControlPlane({
    database: authority.database,
    compiler,
    initializeSolver: async () => solverIdentity,
    getSolverReadiness: () => ({ state: "ready", available: true, identity: solverIdentity }),
  });
}

const authority = createAuthorityDatabase();
const controlPlane = controlPlaneFor(authority);

const applied = await controlPlane.applyException({
  manager,
  exceptionType: "pto",
  serviceDate: "2026-10-06",
  baseVersionId: "60000000-0000-4000-8000-000000000001",
  publicationId: "70000000-0000-4000-8000-000000000001",
  reason: "approved PTO",
  payload: { slotId: "20000000-0000-4000-8000-000000000001" },
  expectedRevision: 0,
  idempotencyKey: "control-plane-pto",
  projectionWeekStart: "2026-10-05",
});
assert.equal(applied.revision, 2, "a successful staffing mutation returns the final projection revision");
assert.equal(applied.data.current_projection.projection_id, "projection-2", "a successful staffing mutation returns the current projection");
assert.deepEqual(authority.queries.map((entry) => entry.statement), ["begin", "set local role static_weekly_control_plane", "select public.static_weekly_v3_apply_exception($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) as result", "select public.static_weekly_v3_read_publication_source($1,$2) as result", "select public.static_weekly_v3_materialize_projection($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) as result", "select public.static_weekly_v3_read_manager_snapshot($1) as result", "commit"], "a mutation, canonical compile, current projection, and confirmation share one transaction");
assert.equal(authority.queries[2].values[9], manager.manager_id, "the trusted manager ID is the only actor value passed to PostgreSQL");
assert.equal(authority.queries[2].values.includes(manager.manager_display_name), false, "PostgreSQL must derive the actor name from its manager registry");
assert.match(authority.queries[4].values[10], /^projection-[0-9a-f]{64}$/, "the projection subcommand uses a derived idempotency key");

const contractor = await controlPlane.applyContractorCapacity({
  manager, serviceDate: "2026-10-06", baseVersionId: versionId, publicationId, slotId: contractorSlot,
  shift: { start: "08:00", end: "17:00" }, reason: "Approved CoverAll help", expectedRevision: applied.revision,
  idempotencyKey: "contractor-capacity-test", projectionWeekStart: "2026-10-05",
});
assert.equal(contractor.revision, 4, "a second daily mutation starts from the returned final projection revision");
const materializeCalls = authority.queries.filter((entry) => entry.statement.includes("static_weekly_v3_materialize_projection"));
assert.deepEqual(materializeCalls.map((entry) => entry.values[8]), [1, 3], "multi-call daily changes materialize from each mutation's returned revision");
assert.deepEqual(authority.queries.find((entry) => entry.statement.includes("static_weekly_v3_apply_exception") && entry.values[0] === "cover_all").values[7].availability.shift, { start: "08:00", end: "17:00" }, "the server derives contractor capacity facts from the registered source");

const departed = await controlPlane.markEmployeeDeparted({ manager, slotId: "20000000-0000-4000-8000-000000000001", reason: "Employment turnover", expectedRevision: contractor.revision, idempotencyKey: "departed-employee", projectionWeekStart: "2026-10-05" });
assert.equal(departed.revision, 6, "departure materializes before its transaction commits");
const replacedEmployee = await controlPlane.replaceEmployee({ manager, slotId: "20000000-0000-4000-8000-000000000001", newEmployeeName: "Fresh Employee", reason: "Employment turnover", expectedRevision: departed.revision, idempotencyKey: "replace-employee", projectionWeekStart: "2026-10-05" });
assert.equal(replacedEmployee.revision, 8, "replacement materializes before its transaction commits");
const published = await controlPlane.publishDraft({ manager, draftVersionId: versionId, expectedDraftRevision: 1, expectedRevision: replacedEmployee.revision, idempotencyKey: "publish-week", projectionWeekStart: "2026-10-05" });
assert.equal(published.revision, 10, "publication materializes before its transaction commits");
const reversed = await controlPlane.applyException({ manager, exceptionType: "reverse", serviceDate: "2026-10-06", baseVersionId: versionId, publicationId, reason: "remove day change", payload: { reversesExceptionId: "exception-1" }, reversesExceptionId: "exception-1", expectedRevision: published.revision, idempotencyKey: "reverse-day-change", projectionWeekStart: "2026-10-05" });
assert.equal(reversed.revision, 12, "exception reversals materialize before their transaction commits");

await assert.rejects(() => controlPlane.applyException({
  manager: { ...manager, auth_mode: "operations_first" },
  exceptionType: "pto", serviceDate: "2026-10-06", baseVersionId: "a", publicationId: "b", reason: "no", payload: {}, expectedRevision: 0, idempotencyKey: "rejected", projectionWeekStart: "2026-10-05",
}), /named manager/i);
assert.equal(authority.commits(), 6, "all successful mutations commit exactly once");

const health = await controlPlane.health();
assert.equal(health.ready, true);
assert.equal(health.authority_ready, true);
assert.equal(health.solver.available, true);
assert.equal(JSON.stringify(health).includes("secret"), false, "health responses must expose key state, never key material");

const failedAuthority = createAuthorityDatabase();
const failedControlPlane = controlPlaneFor(failedAuthority, async () => ({ status: "REVIEW", publicationAuthority: "REVIEW", verifier: { ok: false } }));
await assert.rejects(() => failedControlPlane.publishDraft({ manager, draftVersionId: versionId, expectedDraftRevision: 1, expectedRevision: 0, idempotencyKey: "compile-failure", projectionWeekStart: "2026-10-05" }), /publishable verified schedule/i);
assert.equal(failedAuthority.commits(), 0, "a compile failure prevents the staffing/publication mutation transaction from committing");
assert.equal(failedAuthority.revision(), 0, "a compile failure rolls the mutation authority revision back");
assert.equal(failedAuthority.queries.some((entry) => entry.statement.includes("static_weekly_v3_materialize_projection")), false, "a failed compile never reaches projection materialization");
assert.equal(failedAuthority.queries.at(-1).statement, "rollback", "a failed compile rolls back the same database transaction");

const recoveryAuthority = createAuthorityDatabase({ revision: 12 });
const recoveryControlPlane = controlPlaneFor(recoveryAuthority);
const rebuilt = await recoveryControlPlane.rebuildCurrentProjection({ manager, weekStart: "2026-10-05", expectedRevision: 12, idempotencyKey: "rebuild-stale-projection" });
const rebuiltRetry = await recoveryControlPlane.rebuildCurrentProjection({ manager, weekStart: "2026-10-05", expectedRevision: 12, idempotencyKey: "rebuild-stale-projection" });
assert.equal(rebuilt.revision, 13, "rebuild-only recovery returns its final projection authority revision");
assert.deepEqual(rebuiltRetry, rebuilt, "rebuild-only recovery retries idempotently with no staffing replay");
assert.equal(recoveryAuthority.queries.some((entry) => /static_weekly_v3_apply_exception|static_weekly_v4_mark_employee_departed|static_weekly_v4_replace_employee/.test(entry.statement)), false, "rebuild-only recovery does not replay turnover or exceptions");

const snapshotAuthority = createAuthorityDatabase({ revision: 7 });
const snapshotControlPlane = controlPlaneFor(snapshotAuthority);
const snapshot = await snapshotControlPlane.getManagerSnapshot({ manager, weekStart: "2026-10-05" });
assert.equal(snapshot.authority_revision, 7);
assert.deepEqual(snapshotAuthority.queries.map((entry) => entry.statement), ["begin", "set local role static_weekly_control_plane", "select public.static_weekly_v3_read_manager_snapshot($1) as result", "commit"]);
await assert.rejects(() => snapshotControlPlane.getManagerSnapshot({ manager, weekStart: "2026-10-06" }), /Monday-aligned/i, "projection workflows reject non-Monday week identity before a transaction starts");

const splitCallerAuthority = createAuthorityDatabase();
const splitCallerControlPlane = controlPlaneFor(splitCallerAuthority);
const atomicPublication = await splitCallerControlPlane.publishDraft({ manager, draftVersionId: versionId, expectedDraftRevision: 1, expectedRevision: 0, idempotencyKey: "legacy-split-publish" });
assert.equal(atomicPublication.data.version_id, versionId, "atomic publication preserves the prior mutation response fields");
const materializationCount = splitCallerAuthority.queries.filter((entry) => entry.statement.includes("static_weekly_v3_materialize_projection")).length;
const splitCallerResult = await splitCallerControlPlane.materializeProjection({ manager, publicationId, serviceDate: "2026-10-05", expectedRevision: 1, idempotencyKey: "legacy-split-materialize" });
assert.equal(splitCallerResult.revision, atomicPublication.revision, "an old split caller receives the atomic publication's current projection revision");
assert.equal(splitCallerResult.data.no_op, true, "an old split materialization request becomes a read-only no-op");
assert.equal(splitCallerAuthority.queries.filter((entry) => entry.statement.includes("static_weekly_v3_materialize_projection")).length, materializationCount, "the split-call compatibility path never duplicates projection authority");
console.log("static weekly control-plane separation tests: PASS");
