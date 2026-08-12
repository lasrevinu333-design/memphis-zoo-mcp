#!/usr/bin/env node
// Contract checks for the separated scheduler mutation process. These do not
// need a database: the v3 database suite proves the stored procedures, while
// this test proves the ordinary process cannot quietly become an authority
// caller or signer again.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createStaticWeeklyControlPlane } from "../src/static-weekly-control-plane.js";

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
assert.doesNotMatch(ordinaryApiSource, /static_weekly_v3_|static-weekly-control-plane/, "the ordinary API must not expose scheduler authority mutations");
assert.match(ordinaryApiSource, /\/scheduler-runtime-config/, "the ordinary API must expose the separately configured scheduler service origin to the static frontend");
assert.match(ordinaryApiSource, /STATIC_WEEKLY_CONTROL_PLANE_PUBLIC_URL/, "the scheduler service origin must come from deployment configuration");

const queries = [];
const client = {
  async query(statement, values = []) {
    queries.push({ statement, values });
    if (statement.includes("static_weekly_v3_apply_exception")) return { rows: [{ result: { revision: 7, data: { exception_id: "exception-1" } } }] };
    if (statement.includes("static_weekly_v3_authority_health")) return { rows: [{ result: { ready: true, active_key_count: 1, key_ids: [{ key_id: "static-weekly-authority-hmac-v3", state: "active" }] } }] };
    return { rows: [] };
  },
  release() {},
};
const controlPlane = createStaticWeeklyControlPlane({ database: { async connect() { return client; } } });
const manager = { manager_id: "10000000-0000-4000-8000-000000000001", manager_display_name: "Named Manager", auth_mode: "trusted_device", trusted_device: true, read_only: false };

const applied = await controlPlane.applyException({
  manager,
  exceptionType: "pto",
  serviceDate: "2026-10-06",
  baseVersionId: "60000000-0000-4000-8000-000000000001",
  publicationId: "70000000-0000-4000-8000-000000000001",
  reason: "approved PTO",
  payload: { slotId: "20000000-0000-4000-8000-000000000001" },
  expectedRevision: 6,
  idempotencyKey: "control-plane-pto",
});
assert.equal(applied.revision, 7);
assert.deepEqual(queries.map((entry) => entry.statement), ["begin", "set local role static_weekly_control_plane", "select public.static_weekly_v3_apply_exception($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) as result", "commit"], "a mutation must use one explicit v3 transaction and no caller-supplied actor name");
assert.equal(queries[2].values[9], manager.manager_id, "the trusted manager ID is the only actor value passed to PostgreSQL");
assert.equal(queries[2].values.includes(manager.manager_display_name), false, "PostgreSQL must derive the actor name from its manager registry");

queries.length = 0;
await assert.rejects(() => controlPlane.applyException({
  manager: { ...manager, auth_mode: "operations_first" },
  exceptionType: "pto", serviceDate: "2026-10-06", baseVersionId: "a", publicationId: "b", reason: "no", payload: {}, expectedRevision: 0, idempotencyKey: "rejected",
}), /named manager/i);
assert.equal(queries.length, 0, "admin/API-key and operations-first identities must be rejected before a scheduler transaction starts");

const health = await controlPlane.health();
assert.equal(health.ready, true);
assert.equal(JSON.stringify(health).includes("secret"), false, "health responses must expose key state, never key material");

queries.length = 0;
client.query = async (statement, values = []) => {
  queries.push({ statement, values });
  if (statement.includes("static_weekly_v4_replace_employee")) return { rows: [{ result: { revision: 9, data: { new_employee_name: "Fresh Employee" } } }] };
  return { rows: [] };
};
const replacedEmployee = await controlPlane.replaceEmployee({ manager, slotId: "20000000-0000-4000-8000-000000000001", newEmployeeName: "Fresh Employee", effectiveStart: "2026-10-07", reason: "Employment turnover", expectedRevision: 8, idempotencyKey: "replace-employee" });
assert.equal(replacedEmployee.revision, 9);
assert.deepEqual(queries.map((entry) => entry.statement), ["begin", "set local role static_weekly_control_plane", "select public.static_weekly_v4_replace_employee($1,$2,$3,$4,$5,$6,$7) as result", "commit"]);
assert.equal(queries[2].values.includes(manager.manager_display_name), false, "turnover persists only the database-resolved manager name");

queries.length = 0;
const snapshotResult = { schema: "memphis-zoo.static-weekly-manager-snapshot.v1", week_start: "2026-10-05", authority_revision: 7 };
client.query = async (statement, values = []) => {
  queries.push({ statement, values });
  if (statement.includes("static_weekly_v3_read_manager_snapshot")) return { rows: [{ result: snapshotResult }] };
  return { rows: [] };
};
const snapshot = await controlPlane.getManagerSnapshot({ manager, weekStart: "2026-10-05" });
assert.deepEqual(snapshot, snapshotResult);
assert.deepEqual(queries.map((entry) => entry.statement), ["begin", "set local role static_weekly_control_plane", "select public.static_weekly_v3_read_manager_snapshot($1) as result", "commit"]);
assert.deepEqual(queries[2].values, ["2026-10-05"], "the read contract passes only the canonical week start; actor identity stays in the trusted runtime boundary");

queries.length = 0;
const contractorSlot = "20000000-0000-4000-8000-000000000099";
client.query = async (statement, values = []) => {
  queries.push({ statement, values });
  if (statement.includes("static_weekly_v3_read_publication_source")) return { rows: [{ result: { compiler_input: { slots: [{ id: contractorSlot, contractorCapacity: true, contractorAvailability: [{ dayOfWeek: 2, shift: { start: "07:00", end: "16:00" }, productiveCapacityProvenance: "approved contractor shift", maxServiceEffortMinutes: 300, maxServiceEffortProvenance: "approved contractor limit", qualifications: ["general"], qualificationProvenance: "approved contractor role", restrictions: [], restrictionProvenance: "approved contractor restrictions", acceptedRouteAnchorLocationId: "40000000-0000-4000-8000-000000000099", acceptedRouteProvenance: "approved contractor staging" }] }], version: { slotAvailability: [] } } } }] };
  if (statement.includes("static_weekly_v3_apply_exception")) return { rows: [{ result: { revision: 8, data: { exception_id: "contractor-exception" } } }] };
  return { rows: [] };
};
const contractor = await controlPlane.applyContractorCapacity({ manager, serviceDate: "2026-10-06", baseVersionId: "60000000-0000-4000-8000-000000000001", publicationId: "70000000-0000-4000-8000-000000000001", slotId: contractorSlot, shift: { start: "08:00", end: "17:00" }, reason: "Approved CoverAll help", expectedRevision: 7, idempotencyKey: "contractor-capacity-test" });
assert.equal(contractor.revision, 8);
assert.equal(queries[3].values[0], "cover_all");
assert.deepEqual(queries[3].values[7].availability.shift, { start: "08:00", end: "17:00" });
assert.equal(queries[3].values[7].availability.maxServiceEffortMinutes, 300, "the server must derive contractor capacity facts from the registered source");
await assert.rejects(() => controlPlane.applyContractorCapacity({ manager, serviceDate: "2026-10-06", baseVersionId: "v", publicationId: "p", slotId: "20000000-0000-4000-8000-000000000098", reason: "bad", expectedRevision: 8, idempotencyKey: "bad-contractor" }), /not registered contractor capacity/i);
console.log("static weekly control-plane separation tests: PASS");
