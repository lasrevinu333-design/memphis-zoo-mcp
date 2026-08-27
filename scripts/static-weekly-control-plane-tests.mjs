#!/usr/bin/env node
// Contract checks for the separated scheduler mutation process. These do not
// need a database: the v3 database suite proves the stored procedures, while
// this test proves the ordinary process cannot quietly become an authority
// caller or signer again.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createStaticWeeklyControlPlane, STATIC_WEEKLY_DATABASE_OPERATION_STATEMENT_TIMEOUT_MS } from "../src/static-weekly-control-plane.js";
import { createStaticWeeklyDraftRpcInput } from "../src/static-weekly-schedule-database-adapter.js";
import { compileStaticWeeklySchedule } from "../src/static-weekly-schedule-compiler.js";

const root = resolve(new URL("..", import.meta.url).pathname);
const controlPlaneSource = readFileSync(resolve(root, "src/static-weekly-control-plane.js"), "utf8");
const runtimeSource = readFileSync(resolve(root, "src/static-weekly-control-plane-runtime.js"), "utf8");
const ordinaryApiSource = readFileSync(resolve(root, "src/index.js"), "utf8");

assert.doesNotMatch(controlPlaneSource, /STATIC_WEEKLY_AUTHORITY_ATTESTATION_SECRET|createHmac\s*\(/, "the control plane must never hold an application HMAC secret");
assert.match(controlPlaneSource, /set local role static_weekly_control_plane/, "all database authority calls must enter the constrained control-plane role");
assert.equal(STATIC_WEEKLY_DATABASE_OPERATION_STATEMENT_TIMEOUT_MS, 120_000, "production-sized signed schedule validation receives one bounded database statement budget inside the overall request deadline");
assert.doesNotMatch(controlPlaneSource, /static_weekly_v2_/, "the control plane may invoke only the v3 authority boundary");
assert.match(controlPlaneSource, /static_weekly_v3_read_authority_source/, "first-publication drafts must load a release-registered source of record server-side");
assert.match(controlPlaneSource, /source\.source_id/, "draft creation must bind the immutable server-side source identity to PostgreSQL");
assert.match(controlPlaneSource, /compileAndPrepareStaticWeeklyScheduleIsolated/, "production must isolate both compilation and database-adapter preparation so the transaction owner can keep its database lease alive");
assert.match(runtimeSource, /requireManagerWrite, namedManager/, "every scheduler mutation route must require a trusted named manager writer");
assert.match(runtimeSource, /\/static-weekly\/manager-snapshot[^\n]+requireManagerWrite, namedManager/, "the scheduler snapshot must use the same current named-manager association gate as mutations");
assert.match(runtimeSource, /\/static-weekly\/drafts\/initial/, "the separately deployed control plane must expose a deployable first-draft path without accepting source facts");
assert.match(runtimeSource, /\/static-weekly\/drafts\/:versionId\/refresh[^\n]+requireManagerWrite, namedManager/, "a roster change before first publication must refresh the same draft through the trusted named-manager boundary");
assert.match(runtimeSource, /\/static-weekly\/employees\/departed/, "the control plane must expose one bounded departure transaction");
assert.match(runtimeSource, /\/static-weekly\/employees\/replacements/, "the control plane must expose one bounded fresh-start replacement transaction");
assert.match(runtimeSource, /\/static-weekly\/rebuild-current-projection/, "the control plane must expose the named rebuild-only recovery command");
assert.match(runtimeSource, /\/static-weekly\/day-changes\/batch[^\n]+requireManagerWrite, namedManager/, "the bounded daily batch route must require a trusted named manager writer");
assert.match(controlPlaneSource, /async applyDayChanges\(/, "the control plane must own the daily batch transaction rather than split it across HTTP requests");
assert.match(controlPlaneSource, /pg_advisory_xact_lock\(pg_catalog\.hashtextextended\(\$1,0\)\)/, "the outer batch must acquire the database transaction lock before starting the receipt-gate statement snapshot");
assert.match(controlPlaneSource, /dayChangeOperationIdempotencyKey/, "daily batch child mutations must use deterministic idempotency keys");
assert.match(controlPlaneSource, /projectionIdempotencyKey/, "atomic projection subcommands must derive their own idempotency key");
assert.doesNotMatch(runtimeSource, /\/static-weekly\/incumbencies/, "the arbitrary person/date incumbency writer must not be routable");
assert.doesNotMatch(controlPlaneSource, /replaceIncumbency|static_weekly_v3_replace_incumbency/, "the legacy incumbency client must be removed, not hidden");
assert.doesNotMatch(ordinaryApiSource, /static_weekly_v3_|static-weekly-control-plane/, "the ordinary API must not expose scheduler authority mutations");
assert.match(ordinaryApiSource, /\/scheduler-runtime-config/, "the ordinary API must expose the separately configured scheduler service origin to the static frontend");
assert.match(ordinaryApiSource, /STATIC_WEEKLY_CONTROL_PLANE_PUBLIC_URL/, "the scheduler service origin must come from deployment configuration");
assert.throws(() => createStaticWeeklyControlPlane({ database: { connect() {} }, operationStatementMilliseconds: 29_999 }), /statement_deadline_invalid/, "the production statement budget cannot be weakened below the proven legacy failure boundary");
assert.throws(() => createStaticWeeklyControlPlane({ database: { connect() {} }, operationStatementMilliseconds: 180_001 }), /statement_deadline_invalid/, "the production statement budget remains bounded below the outer request deadline");

const solverIdentity = { package: "highs@1.15.2" };
const manager = { manager_id: "10000000-0000-4000-8000-000000000001", manager_display_name: "Named Manager", auth_mode: "trusted_device", trusted_device: true, read_only: false };
const authoritySourceId = "50000000-0000-4000-8000-000000000001";
const publicationId = "70000000-0000-4000-8000-000000000001";
const versionId = "60000000-0000-4000-8000-000000000001";
const contractorSlot = "20000000-0000-4000-8000-000000000099";
const childKey = (parent, index) => `day-change-${createHash("sha256").update(`${parent}:${index}`).digest("hex")}`;
const projectionKey = (parent) => `projection-${createHash("sha256").update(parent).digest("hex")}`;

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

function createAuthorityDatabase({ revision: initialRevision = 0, failMutationAt = null, failHeartbeatAt = null, heartbeatDelayMs = 0 } = {}) {
  const queries = [];
  const materializations = new Map();
  const projectionSnapshots = new Map();
  const mutations = new Map();
  let revision = initialRevision;
  let projection = null;
  let transactionState = null;
  let commits = 0;
  let mutationAttempts = 0;
  let heartbeatAttempts = 0;
  const source = {
    source_id: authoritySourceId,
    compiler_input: {
      slots: [{ id: contractorSlot, contractorCapacity: true, contractorAvailability: [{ dayOfWeek: 2, shift: { start: "07:00", end: "16:00" }, productiveCapacityProvenance: "approved contractor shift", maxServiceEffortMinutes: 300, maxServiceEffortProvenance: "approved contractor limit", qualifications: ["general"], qualificationProvenance: "approved contractor role", restrictions: [], restrictionProvenance: "approved contractor restrictions", acceptedRouteAnchorLocationId: "40000000-0000-4000-8000-000000000099", acceptedRouteProvenance: "approved contractor staging" }] }],
      version: { slotAvailability: [] }, proximity: [],
    },
    exceptions: [],
    publication_id: publicationId,
    version_id: versionId,
  };
  const client = {
    async query(statement, values = []) {
      queries.push({ statement, values });
      if (statement === "select 1") {
        heartbeatAttempts += 1;
        if (heartbeatDelayMs > 0) await new Promise((resolveDelay) => setTimeout(resolveDelay, heartbeatDelayMs));
        if (heartbeatAttempts === failHeartbeatAt) throw new Error("transaction keepalive failed");
        return { rows: [{ "?column?": 1 }] };
      }
      if (statement === "begin") {
        transactionState = { revision, projection, materializations: new Map(materializations), projectionSnapshots: new Map(projectionSnapshots), mutations: new Map(mutations) };
        return { rows: [] };
      }
      if (statement === "commit") { commits += 1; transactionState = null; return { rows: [] }; }
      if (statement === "rollback") {
        revision = transactionState.revision;
        projection = transactionState.projection;
        materializations.clear(); for (const [key, value] of transactionState.materializations) materializations.set(key, value);
        projectionSnapshots.clear(); for (const [key, value] of transactionState.projectionSnapshots) projectionSnapshots.set(key, value);
        mutations.clear(); for (const [key, value] of transactionState.mutations) mutations.set(key, value);
        transactionState = null;
        return { rows: [] };
      }
      if (statement.includes("static_weekly_v3_authority_health")) return { rows: [{ result: { ready: true, active_key_count: 1, key_ids: [{ key_id: "static-weekly-authority-hmac-v3", state: "active" }] } }] };
      if (statement.includes("static_weekly_v4_day_changes_health")) return { rows: [{ result: { ready: true, receipt_model: "deterministic_child_projection_chain.v1" } }] };
      if (statement.includes("static_weekly_v4_begin_day_changes")) {
        const operations = JSON.parse(values[4]);
        const parent = values[7];
        const children = operations.map((_, index) => mutations.get(childKey(parent, index)));
        const materialized = materializations.get(projectionKey(parent));
        if (!materialized && children.every((item) => item == null)) return { rows: [{ result: { replayed: false } }] };
        if (!materialized || children.some((item) => item == null)) throw Object.assign(new Error("idempotency key is bound to a different complete day-change batch"), { code: "23505" });
        return { rows: [{ result: { replayed: true, response: { ...materialized, operation: "apply_day_changes", data: { ...materialized.data, current_projection: projectionSnapshots.get(projectionKey(parent)), mutations: children.map((item) => item.data) } } } }] };
      }
      if (statement.includes("static_weekly_v3_read_authority_source")) return { rows: [{ result: source }] };
      if (statement.includes("static_weekly_v3_read_publication_source")) return { rows: [{ result: source }] };
      if (statement.includes("static_weekly_v3_read_manager_snapshot")) return { rows: [{ result: { schema: "memphis-zoo.static-weekly-manager-snapshot.v1", week_start: values[0], authority_revision: revision, current_publication: { publication_id: publicationId, version_id: versionId }, projection_status: projection ? "current" : "missing", latest_projection: projection } }] };
      if (statement.includes("static_weekly_v3_publish_draft")) { revision = values[2] + 1; return { rows: [{ result: { revision, data: { publication_id: publicationId, version_id: versionId, effective_start: "2026-10-05" } } }] }; }
      if (statement.includes("static_weekly_v3_create_draft")) { revision = values[5] + 1; return { rows: [{ result: { revision, data: { version_id: versionId, draft_revision: 1, effective_start: values[0] } } }] }; }
      if (statement.includes("static_weekly_v3_update_draft")) { revision = values[5] + 1; return { rows: [{ result: { revision, data: { version_id: values[0], draft_revision: values[4] + 1 } } }] }; }
      if (statement.includes("static_weekly_v3_apply_exception")) {
        const key = values[10];
        if (mutations.has(key)) return { rows: [{ result: mutations.get(key) }] };
        if (values[8] !== revision) throw Object.assign(new Error("authority revision conflict"), { code: "static_weekly_control_plane_revision_conflict" });
        mutationAttempts += 1;
        if (failMutationAt === mutationAttempts) throw Object.assign(new Error("infeasible day change"), { code: "static_weekly_control_plane_compiler_rejected" });
        revision += 1;
        const result = { revision, data: { exception_id: `exception-${revision}` } };
        mutations.set(key, result);
        return { rows: [{ result }] };
      }
      if (statement.includes("static_weekly_v4_mark_employee_departed")) { revision = values[2] + 1; return { rows: [{ result: { revision, data: { slot_id: values[0] } } }] }; }
      if (statement.includes("static_weekly_v4_replace_employee")) { revision = values[3] + 1; return { rows: [{ result: { revision, data: { new_employee_name: values[1] } } }] }; }
      if (statement.includes("static_weekly_v7_create_vacant_roster_slot")) { revision = values[2] + 1; return { rows: [{ result: { revision, data: { slot_id: values[0], slot_label: values[1], vacant: true } } }] }; }
      if (statement.includes("static_weekly_v7_fill_vacant_roster_slot")) { revision = values[4] + 1; return { rows: [{ result: { revision, data: { slot_id: values[0], new_employee_name: values[1], effective_start: values[2] } } }] }; }
      if (statement.includes("static_weekly_v3_materialize_projection")) {
        const key = values[10];
        if (materializations.has(key)) return { rows: [{ result: materializations.get(key) }] };
        if (values[8] !== revision) throw Object.assign(new Error("authority revision conflict"), { code: "static_weekly_control_plane_revision_conflict" });
        revision += 1;
        projection = { projection_id: `projection-${revision}`, publication_id: values[0], week_start: values[1], assignments: [{ work_id: "work-a" }] };
        const result = { operation: "materialize_projection", revision, data: { projection_id: projection.projection_id, publication_id: values[0], week_start: values[1] } };
        materializations.set(key, result);
        projectionSnapshots.set(key, projection);
        return { rows: [{ result }] };
      }
      return { rows: [] };
    },
    release() {},
  };
  return { database: { async connect() { return client; } }, queries, revision: () => revision, commits: () => commits, mutationAttempts: () => mutationAttempts, heartbeatAttempts: () => heartbeatAttempts };
}

function controlPlaneFor(authority, compiler = async () => acceptedProjection, options = {}) {
  return createStaticWeeklyControlPlane({
    database: authority.database,
    compiler,
    initializeSolver: async () => solverIdentity,
    getSolverReadiness: () => ({ state: "ready", available: true, identity: solverIdentity }),
    ...options,
  });
}

let admittedConnections = 0;
let maximumAdmittedConnections = 0;
let startedSnapshotReads = 0;
let releaseSnapshotReads;
const snapshotReadGate = new Promise((resolve) => { releaseSnapshotReads = resolve; });
const healthReserveDatabase = {
  async connect() {
    admittedConnections += 1;
    maximumAdmittedConnections = Math.max(maximumAdmittedConnections, admittedConnections);
    let released = false;
    return {
      async query(statement, values = []) {
        if (statement.includes("static_weekly_v3_authority_health")) return { rows: [{ result: { ready: true } }] };
        if (statement.includes("static_weekly_v4_day_changes_health")) return { rows: [{ result: { ready: true } }] };
        if (statement.includes("static_weekly_v3_read_manager_snapshot")) {
          startedSnapshotReads += 1;
          await snapshotReadGate;
          return { rows: [{ result: { week_start: values[0], authority_revision: 0 } }] };
        }
        return { rows: [] };
      },
      release() {
        if (released) return;
        released = true;
        admittedConnections -= 1;
      },
    };
  },
};
const healthReserveControlPlane = createStaticWeeklyControlPlane({
  database: healthReserveDatabase,
  compiler: async () => acceptedProjection,
  initializeSolver: async () => solverIdentity,
  getSolverReadiness: () => ({ state: "ready", available: true, identity: solverIdentity }),
});
const blockedSnapshots = Array.from({ length: 4 }, (_, index) => healthReserveControlPlane.getManagerSnapshot({
  manager,
  weekStart: "2026-10-05",
  idempotencyKey: `health-reserve-${index}`,
}));
for (let attempt = 0; attempt < 1_000 && startedSnapshotReads < 3; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 1));
assert.equal(startedSnapshotReads, 3, "ordinary operations admit at most three concurrent database transactions");
const healthDuringContention = await Promise.race([
  healthReserveControlPlane.health(),
  new Promise((_, reject) => setTimeout(() => reject(new Error("reserved health transaction timed out")), 1_000)),
]);
assert.equal(healthDuringContention.ready, true, "liveness retains a database connection while ordinary operations are queued");
assert.equal(startedSnapshotReads, 3, "the fourth ordinary operation waits outside the database pool");
assert.equal(maximumAdmittedConnections, 4, "three ordinary operations plus one health check use the four-connection pool");
releaseSnapshotReads();
await Promise.all(blockedSnapshots);
assert.equal(startedSnapshotReads, 4, "the queued operation enters only after an admitted transaction releases its connection");

let healthConnections = 0;
let maximumHealthConnections = 0;
let healthPoolWaiters = 0;
const boundedHealthQueries = [];
let releaseHeldHealth;
let heldHealthStarted;
const heldHealthGate = new Promise((resolve) => { releaseHeldHealth = resolve; });
const heldHealthStartedGate = new Promise((resolve) => { heldHealthStarted = resolve; });
const boundedHealthDatabase = {
  async connect() {
    healthConnections += 1;
    maximumHealthConnections = Math.max(maximumHealthConnections, healthConnections);
    if (healthConnections > 4) healthPoolWaiters += 1;
    let released = false;
    return {
      async query(statement) {
        boundedHealthQueries.push(statement);
        if (statement.includes("static_weekly_v3_authority_health")) {
          heldHealthStarted();
          await heldHealthGate;
          return { rows: [{ result: { ready: true } }] };
        }
        if (statement.includes("static_weekly_v4_day_changes_health")) return { rows: [{ result: { ready: true } }] };
        return { rows: [] };
      },
      release() {
        if (released) return;
        released = true;
        healthConnections -= 1;
      },
    };
  },
  async end() {},
};
const boundedHealthControlPlane = createStaticWeeklyControlPlane({
  database: boundedHealthDatabase,
  compiler: async () => acceptedProjection,
  initializeSolver: async () => solverIdentity,
  getSolverReadiness: () => ({ state: "ready", available: true, identity: solverIdentity }),
});
const concurrentHealthChecks = Array.from({ length: 21 }, () => boundedHealthControlPlane.health());
await heldHealthStartedGate;
await new Promise((resolve) => setTimeout(resolve, 10));
assert.equal(maximumHealthConnections, 1, "concurrent health probes coalesce onto one reserved database transaction");
assert.equal(healthPoolWaiters, 0, "concurrent health probes cannot create a database-pool FIFO");
assert.equal(boundedHealthQueries.includes("set local statement_timeout = '5000ms'"), true, "the admitted health transaction has its own bounded database deadline");
let boundedHealthCloseSettled = false;
const boundedHealthClose = boundedHealthControlPlane.close().then(() => { boundedHealthCloseSettled = true; });
await new Promise((resolve) => setTimeout(resolve, 10));
assert.equal(boundedHealthCloseSettled, false, "shutdown tracks the one admitted health transaction before closing the pool");
await assert.rejects(() => boundedHealthControlPlane.health(), /closing/i, "shutdown rejects new health admission");
releaseHeldHealth();
await Promise.all(concurrentHealthChecks);
await boundedHealthClose;
assert.equal(healthConnections, 0, "the tracked health transaction releases its connection before shutdown completes");

const keepaliveAuthority = createAuthorityDatabase();
const keepaliveControlPlane = controlPlaneFor(keepaliveAuthority, async () => {
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 30));
  return acceptedProjection;
}, { transactionKeepaliveMs: 5 });
const slowInitialDraft = await keepaliveControlPlane.createInitialDraft({
  manager,
  sourceId: authoritySourceId,
  effectiveStart: "2026-10-05",
  expectedRevision: 0,
  idempotencyKey: "slow-initial-draft",
});
assert.equal(slowInitialDraft.revision, 1, "a bounded slow compiler still creates one initial draft");
assert.equal(keepaliveAuthority.heartbeatAttempts() >= 2, true, "a bounded slow compiler keeps its atomic database transaction active");
const keepaliveSourceIndex = keepaliveAuthority.queries.findIndex((entry) => entry.statement.includes("static_weekly_v3_read_authority_source"));
assert.deepEqual(
  keepaliveAuthority.queries[keepaliveSourceIndex].values,
  [authoritySourceId, "2026-10-05"],
  "first-draft source reads must hydrate the registered vacancy-capable template for the exact effective week",
);
const keepaliveWriteIndex = keepaliveAuthority.queries.findIndex((entry) => entry.statement.includes("static_weekly_v3_create_draft"));
const keepaliveIndexes = keepaliveAuthority.queries.map((entry, index) => entry.statement === "select 1" ? index : -1).filter((index) => index >= 0);
assert.equal(keepaliveIndexes.every((index) => index > keepaliveSourceIndex && index < keepaliveWriteIndex), true, "only the bounded solver interval receives read-only transaction keepalives");
assert.equal(keepaliveAuthority.commits(), 1, "a slow initial draft still commits exactly once");

const preparedKeepaliveAuthority = createAuthorityDatabase();
let preparedCompilerCalls = 0;
let rawCompilerCalls = 0;
const preparedKeepaliveControlPlane = controlPlaneFor(preparedKeepaliveAuthority, async () => {
  rawCompilerCalls += 1;
  return acceptedProjection;
}, {
  compilerPreparer: async (_input, preparation) => {
    preparedCompilerCalls += 1;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 30));
    return createStaticWeeklyDraftRpcInput({
      result: acceptedProjection,
      expectedRevision: preparation.expectedRevision,
      actor: preparation.actor,
    });
  },
  transactionKeepaliveMs: 5,
});
const preparedSlowInitialDraft = await preparedKeepaliveControlPlane.createInitialDraft({
  manager,
  sourceId: authoritySourceId,
  effectiveStart: "2026-10-05",
  expectedRevision: 0,
  idempotencyKey: "slow-prepared-initial-draft",
});
assert.equal(preparedSlowInitialDraft.revision, 1, "a bounded slow isolated adapter creates one initial draft");
assert.equal(preparedCompilerCalls, 1, "the production-shaped initial draft performs compiler and adapter preparation in one isolated request");
assert.equal(rawCompilerCalls, 0, "the production-shaped initial draft cannot fall back to event-loop-blocking local adapter preparation");
assert.equal(preparedKeepaliveAuthority.heartbeatAttempts() >= 2, true, "the transaction keepalive continues through isolated database-adapter preparation");
assert.equal(preparedKeepaliveAuthority.commits(), 1, "the prepared initial draft commits exactly once");

const refreshAuthority = createAuthorityDatabase({ revision: 11 });
const refreshControlPlane = controlPlaneFor(refreshAuthority);
const refreshedDraft = await refreshControlPlane.refreshInitialDraft({
  manager,
  draftVersionId: versionId,
  sourceId: authoritySourceId,
  effectiveStart: "2026-10-05",
  expectedDraftRevision: 1,
  expectedRevision: 11,
  idempotencyKey: "refresh-filled-vacancy-draft",
});
assert.equal(refreshedDraft.revision, 12, "a filled position refresh advances the same draft exactly once");
assert.equal(refreshedDraft.data.draft_revision, 2);
const refreshSourceRead = refreshAuthority.queries.find((entry) => entry.statement.includes("static_weekly_v3_read_authority_source"));
assert.deepEqual(refreshSourceRead.values, [authoritySourceId, "2026-10-05"], "draft refresh hydrates the exact effective roster before recompilation");
const refreshWrite = refreshAuthority.queries.find((entry) => entry.statement.includes("static_weekly_v3_update_draft"));
assert.deepEqual(refreshWrite.values.slice(0, 1), [versionId], "draft refresh updates the existing version instead of creating a competing draft");
assert.equal(refreshAuthority.commits(), 1, "draft refresh commits as one bounded transaction");

const failedKeepaliveAuthority = createAuthorityDatabase({ failHeartbeatAt: 1 });
const failedKeepaliveControlPlane = controlPlaneFor(failedKeepaliveAuthority, async () => {
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
  return acceptedProjection;
}, { transactionKeepaliveMs: 5 });
await assert.rejects(() => failedKeepaliveControlPlane.createInitialDraft({
  manager,
  sourceId: authoritySourceId,
  effectiveStart: "2026-10-05",
  expectedRevision: 0,
  idempotencyKey: "failed-initial-draft-keepalive",
}), /transaction keepalive failed/);
assert.equal(failedKeepaliveAuthority.commits(), 0, "a failed transaction keepalive cannot commit a draft");
assert.equal(failedKeepaliveAuthority.revision(), 0, "a failed transaction keepalive leaves authority unchanged");
assert.equal(failedKeepaliveAuthority.queries.at(-1).statement, "rollback", "a failed transaction keepalive rolls back the same transaction");

const lateFailedKeepaliveAuthority = createAuthorityDatabase({ failHeartbeatAt: 1, heartbeatDelayMs: 20 });
const lateFailedKeepaliveControlPlane = controlPlaneFor(lateFailedKeepaliveAuthority, async () => {
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 8));
  return acceptedProjection;
}, { transactionKeepaliveMs: 5 });
await assert.rejects(() => lateFailedKeepaliveControlPlane.createInitialDraft({
  manager,
  sourceId: authoritySourceId,
  effectiveStart: "2026-10-05",
  expectedRevision: 0,
  idempotencyKey: "late-failed-initial-draft-keepalive",
}), /transaction keepalive failed/);
assert.equal(lateFailedKeepaliveAuthority.commits(), 0, "a heartbeat that fails after compilation cannot commit a draft");
assert.equal(lateFailedKeepaliveAuthority.revision(), 0, "a late keepalive failure leaves authority unchanged");
assert.equal(lateFailedKeepaliveAuthority.queries.at(-1).statement, "rollback", "a late keepalive failure rolls back the same transaction");

const interruptedClient = new EventEmitter();
const interruptedQueries = [];
let interruptedReleaseError = null;
const interruptedConnectionError = new Error("Connection terminated unexpectedly");
interruptedClient.query = async (statement) => {
  interruptedQueries.push(statement);
  const registeredInput = compilerInput();
  return { rows: statement.includes("static_weekly_v3_read_authority_source")
    ? [{ result: { source_id: authoritySourceId, compiler_input: { timezone: registeredInput.timezone, slots: registeredInput.slots, proximity: registeredInput.proximity, version: registeredInput.versions[0] }, exceptions: [] } }]
    : [] };
};
interruptedClient.release = (error) => { interruptedReleaseError = error || null; };
const interruptedControlPlane = createStaticWeeklyControlPlane({
  database: { async connect() { return interruptedClient; } },
  compiler: async () => {
    assert.equal(interruptedClient.listenerCount("error") > 0, true, "a checked-out authority client owns an asynchronous connection-error boundary");
    interruptedClient.emit("error", interruptedConnectionError);
    return acceptedProjection;
  },
  initializeSolver: async () => solverIdentity,
  getSolverReadiness: () => ({ state: "ready", available: true, identity: solverIdentity }),
});
await assert.rejects(() => interruptedControlPlane.createInitialDraft({
  manager,
  sourceId: authoritySourceId,
  effectiveStart: "2026-10-05",
  expectedRevision: 0,
  idempotencyKey: "interrupted-initial-draft",
}), (error) => error?.code === "static_weekly_control_plane_database_unavailable" && /No schedule change was accepted/.test(error.message));
assert.equal(interruptedQueries.includes("commit"), false, "an interrupted authority connection cannot commit");
assert.equal(interruptedQueries.at(-1), "rollback", "an interrupted authority transaction attempts rollback before failing closed");
assert.equal(interruptedReleaseError, interruptedConnectionError, "the broken authority client is destroyed instead of returned to the pool");
assert.equal(interruptedClient.listenerCount("error"), 0, "the checked-out client listener is removed at the release boundary");

let rejectedQueryReleaseError = null;
const rejectedQueryError = Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" });
const rejectedQueryClient = {
  async query(statement) {
    if (statement === "begin") throw rejectedQueryError;
    throw rejectedQueryError;
  },
  release(error) { rejectedQueryReleaseError = error || null; },
};
const rejectedQueryControlPlane = createStaticWeeklyControlPlane({
  database: { async connect() { return rejectedQueryClient; } },
  compiler: async () => acceptedProjection,
  initializeSolver: async () => solverIdentity,
  getSolverReadiness: () => ({ state: "ready", available: true, identity: solverIdentity }),
});
await assert.rejects(() => rejectedQueryControlPlane.getManagerSnapshot({ manager, weekStart: "2026-10-05" }),
  (error) => error?.code === "static_weekly_control_plane_database_unavailable");
assert.equal(rejectedQueryReleaseError, rejectedQueryError, "a rejected connection query also destroys the broken client when no separate error event was emitted");

const rejectedConnectError = Object.assign(new Error("timeout exceeded when trying to connect"), { code: "ETIMEDOUT" });
const rejectedConnectControlPlane = createStaticWeeklyControlPlane({
  database: { async connect() { throw rejectedConnectError; } },
  compiler: async () => acceptedProjection,
  initializeSolver: async () => solverIdentity,
  getSolverReadiness: () => ({ state: "ready", available: true, identity: solverIdentity }),
});
await assert.rejects(() => rejectedConnectControlPlane.getManagerSnapshot({ manager, weekStart: "2026-10-05" }),
  (error) => error?.code === "static_weekly_control_plane_database_unavailable" && error?.cause === rejectedConnectError,
  "connection admission failure is normalized before it reaches the HTTP authority boundary");

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
assert.deepEqual(authority.queries.map((entry) => entry.statement), ["begin", "set local role static_weekly_control_plane", "set local statement_timeout = '120000ms'", "select public.static_weekly_v3_apply_exception($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) as result", "select public.static_weekly_v3_read_publication_source($1,$2) as result", "select public.static_weekly_v3_materialize_projection($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) as result", "select public.static_weekly_v3_read_manager_snapshot($1) as result", "commit"], "a mutation, canonical compile, current projection, and confirmation share one bounded transaction");
assert.equal(authority.queries[3].values[9], manager.manager_id, "the trusted manager ID is the only actor value passed to PostgreSQL");
assert.equal(authority.queries[3].values.includes(manager.manager_display_name), false, "PostgreSQL must derive the actor name from its manager registry");
assert.match(authority.queries[5].values[10], /^projection-[0-9a-f]{64}$/, "the projection subcommand uses a derived idempotency key");

const contractor = await controlPlane.applyContractorCapacity({
  manager, serviceDate: "2026-10-06", baseVersionId: versionId, publicationId, slotId: contractorSlot,
  shift: { start: "15:00", end: "24:00" }, reason: "Approved CoverAll help", expectedRevision: applied.revision,
  idempotencyKey: "contractor-capacity-test", projectionWeekStart: "2026-10-05",
});
assert.equal(contractor.revision, 4, "a second daily mutation starts from the returned final projection revision");
const materializeCalls = authority.queries.filter((entry) => entry.statement.includes("static_weekly_v3_materialize_projection"));
assert.deepEqual(materializeCalls.map((entry) => entry.values[8]), [1, 3], "multi-call daily changes materialize from each mutation's returned revision");
assert.deepEqual(authority.queries.find((entry) => entry.statement.includes("static_weekly_v3_apply_exception") && entry.values[0] === "cover_all").values[7].availability.shift, { start: "15:00", end: "24:00" }, "the server preserves an exact midnight-ended employee shift for contractor coverage");

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

const dayChangesAuthority = createAuthorityDatabase();
let dayChangesCompilerCalls = 0;
const dayChangesControlPlane = controlPlaneFor(dayChangesAuthority, async () => { dayChangesCompilerCalls += 1; return acceptedProjection; });
const dayChangesRequest = {
  manager,
  serviceDate: "2026-10-06",
  projectionWeekStart: "2026-10-05",
  publicationId,
  baseVersionId: versionId,
  versionId,
  expectedRevision: 0,
  idempotencyKey: "day-changes-atomic-replay",
  operations: [
    { operation: "exception", exceptionType: "pto", reason: "approved call-out", payload: { slotId: "20000000-0000-4000-8000-000000000001" } },
    { operation: "exception", exceptionType: "daily_absence", reason: "second approved call-out", payload: { slotId: "20000000-0000-4000-8000-000000000002" } },
    { operation: "cover_all", slotId: contractorSlot, shift: { start: "08:00", end: "17:00" }, reason: "approved CoverAll help" },
  ],
};
const dayChanges = await dayChangesControlPlane.applyDayChanges(dayChangesRequest);
assert.equal(dayChanges.operation, "apply_day_changes");
assert.equal(dayChanges.revision, 4, "one daily batch advances two absences, one CoverAll call, and one final projection");
assert.equal(dayChanges.data.mutations.length, 3, "the batch returns every applied daily mutation");
assert.equal(dayChanges.data.current_projection.projection_id, "projection-4");
assert.equal(dayChangesCompilerCalls, 1, "the complete daily operation set compiles exactly once");
const dayChangesLockIndex = dayChangesAuthority.queries.findIndex((entry) => entry.statement.includes("pg_advisory_xact_lock"));
const dayChangesGateIndex = dayChangesAuthority.queries.findIndex((entry) => entry.statement.includes("static_weekly_v4_begin_day_changes"));
assert.equal(dayChangesLockIndex > 1 && dayChangesLockIndex < dayChangesGateIndex, true, "the batch acquires its transaction lock in a completed statement before the receipt gate takes a snapshot");
assert.equal(dayChangesAuthority.queries.filter((entry) => entry.statement.includes("static_weekly_v4_begin_day_changes")).length, 1, "a batch reaches the database-authoritative recognition gate before source reads");
assert.equal(dayChangesAuthority.queries.filter((entry) => entry.statement.includes("static_weekly_v3_materialize_projection")).length, 1, "the complete daily operation set materializes exactly once");
const dayChangeCommands = dayChangesAuthority.queries.filter((entry) => entry.statement.includes("static_weekly_v3_apply_exception"));
assert.deepEqual(dayChangeCommands.map((entry) => entry.values[8]), [0, 1, 2], "batch child mutations advance from one shared expected revision");
assert.equal(dayChangeCommands.every((entry) => entry.values[4] === versionId && entry.values[5] === publicationId), true, "every batch child mutation is bound to the requested published version");
assert.match(dayChangeCommands[0].values[10], /^day-change-[0-9a-f]{64}$/, "batch child mutations receive deterministic derived idempotency keys");
const dayChangesReplay = await dayChangesControlPlane.applyDayChanges(dayChangesRequest);
assert.deepEqual(dayChangesReplay, dayChanges, "replaying an accepted daily batch returns the same result");
assert.equal(dayChangesAuthority.mutationAttempts(), 3, "replaying a daily batch does not apply any child mutation again");
assert.equal(dayChangesAuthority.revision(), 4, "replaying a daily batch does not advance authority revision");
const replayQueries = dayChangesAuthority.queries.slice(dayChangesAuthority.queries.findLastIndex((entry) => entry.statement === "begin"));
assert.deepEqual(replayQueries.map((entry) => entry.statement), ["begin", "set local role static_weekly_control_plane", "set local statement_timeout = '120000ms'", "select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended($1,0))", "select public.static_weekly_v4_begin_day_changes($1,$2,$3,$4,$5,$6,$7,$8) as result", "commit"], "accepted whole-action replay locks and stops before mutable publication authority is reread");

const invalidDayChangesAuthority = createAuthorityDatabase();
await assert.rejects(() => controlPlaneFor(invalidDayChangesAuthority).applyDayChanges({
  ...dayChangesRequest,
  operations: [{ operation: "cover_all", slotId: "unregistered-contractor", reason: "invalid CoverAll request" }],
}), /not registered contractor capacity/i);
assert.equal(invalidDayChangesAuthority.commits(), 0, "an invalid operation anywhere in a daily batch commits nothing");
assert.equal(invalidDayChangesAuthority.mutationAttempts(), 0, "every daily operation is validated before the first batch mutation");
assert.equal(invalidDayChangesAuthority.revision(), 0);

const failedDayChangesAuthority = createAuthorityDatabase({ failMutationAt: 2 });
await assert.rejects(() => controlPlaneFor(failedDayChangesAuthority).applyDayChanges(dayChangesRequest), /infeasible day change/i);
assert.equal(failedDayChangesAuthority.commits(), 0, "a later daily mutation failure rolls back the accepted prefix");
assert.equal(failedDayChangesAuthority.revision(), 0, "a later daily mutation failure leaves no partial authority revision");
assert.equal(failedDayChangesAuthority.queries.some((entry) => entry.statement.includes("static_weekly_v3_materialize_projection")), false, "a failed daily batch never materializes a prefix");

const concurrentDayChangesAuthority = createAuthorityDatabase({ revision: 1 });
await assert.rejects(() => controlPlaneFor(concurrentDayChangesAuthority).applyDayChanges(dayChangesRequest), /revision conflict/i);
assert.equal(concurrentDayChangesAuthority.commits(), 0, "a stale expected revision commits no daily mutation");
assert.equal(concurrentDayChangesAuthority.revision(), 1, "a stale expected revision preserves the concurrent authority state");

const versionMismatchAuthority = createAuthorityDatabase();
await assert.rejects(() => controlPlaneFor(versionMismatchAuthority).applyDayChanges({ ...dayChangesRequest, versionId: "60000000-0000-4000-8000-000000000099" }), /one published schedule version/i);
assert.equal(versionMismatchAuthority.commits(), 0, "a mismatched version is rejected before any daily mutation commits");
assert.equal(versionMismatchAuthority.mutationAttempts(), 0);

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
assert.deepEqual(snapshotAuthority.queries.map((entry) => entry.statement), ["begin", "set local role static_weekly_control_plane", "set local statement_timeout = '120000ms'", "select public.static_weekly_v3_read_manager_snapshot($1) as result", "commit"]);
await assert.rejects(() => snapshotControlPlane.getManagerSnapshot({ manager, weekStart: "2026-10-06" }), /Monday-aligned/i, "projection workflows reject non-Monday week identity before a transaction starts");

const vacancyAuthority = createAuthorityDatabase();
const vacancyControlPlane = controlPlaneFor(vacancyAuthority);
const vacantSlot = await vacancyControlPlane.createVacantRosterSlot({ manager, slotId: "20000000-0000-4000-8000-000000000099", slotLabel: "Employee 1 schedule position", expectedRevision: 0, idempotencyKey: "create-vacant-position" });
assert.equal(vacantSlot.revision, 1);
assert.equal(vacantSlot.data.vacant, true);
const filledSlot = await vacancyControlPlane.fillVacantRosterSlot({ manager, slotId: vacantSlot.data.slot_id, newEmployeeName: "New Custodian", effectiveStart: "2026-10-05", reason: "Approved hire", expectedRevision: vacantSlot.revision, idempotencyKey: "fill-vacant-position" });
assert.equal(filledSlot.revision, 2);
assert.equal(filledSlot.data.new_employee_name, "New Custodian");
assert.deepEqual(vacancyAuthority.queries.map((entry) => entry.statement), [
  "begin", "set local role static_weekly_control_plane", "set local statement_timeout = '120000ms'", "select public.static_weekly_v7_create_vacant_roster_slot($1,$2,$3,$4,$5) as result", "commit",
  "begin", "set local role static_weekly_control_plane", "set local statement_timeout = '120000ms'", "select public.static_weekly_v7_fill_vacant_roster_slot($1,$2,$3,$4,$5,$6,$7) as result", "commit",
], "vacant position creation and later hiring are bounded named-manager operations without an APK or schedule-template rewrite");

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
