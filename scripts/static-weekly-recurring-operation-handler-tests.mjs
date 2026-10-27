import assert from "node:assert/strict";
import { runRecurringWithRestoreCustody } from "../src/static-weekly-recurring-operation-handler.js";
import { createRecurringOperationRunner } from "../src/static-weekly-recurring-operation-runner.js";
import { recurringOperationSourceManifest } from "../src/static-weekly-recurring-operation-source.js";

const manager = { manager_id: "10000000-0000-4000-8000-000000000001", manager_display_name: "Named manager" };
const body = { effective_start: "2026-10-05", expected_revision: 1 };
function fixture(run) {
  const controller = new AbortController();
  let retained = 0;
  const request = { staticWeeklyManagerOperation: { deadlineAt: 59_999 },
    restoreMutationLease: { signal: controller.signal,
      settleBeforeSuccess: async () => {},
      retainUnprovenRecurringCustody() { retained++; controller.abort(); } } };
  return { call: () => runRecurringWithRestoreCustody({ run, request, kind: "preview", body, manager }),
    request, get retained() { return retained; } };
}
const prior = Object.assign(new Error("source changed before launch"), { code: "source_changed" });
const before = fixture(async () => { throw prior; });
await assert.rejects(before.call(), error => error === prior);
assert.equal(before.retained, 0, "pre-launch validation failure does not strand a lease");

const complete = fixture(async ({ onLaunch, onCustody, signal, deadlineAt, manager: actor }) => {
  assert.equal(signal, complete.request.restoreMutationLease.signal);
  assert.equal(deadlineAt, 59_999);
  assert.equal(actor, manager);
  onLaunch(); onCustody();
  return { status: "CANDIDATE_ONLY" };
});
assert.deepEqual(await complete.call(), { status: "CANDIDATE_ONLY" });
assert.equal(complete.retained, 0, "proved successful group takes the ordinary release-before-200 path");

const knownFailure = Object.assign(new Error("the operation failed"), { code: "operation_failed", groupAbsent: true });
const proved = fixture(async ({ onLaunch }) => { onLaunch(); throw knownFailure; });
await assert.rejects(proved.call(), error => error === knownFailure);
assert.equal(proved.retained, 0, "proved group absence permits ordinary exact lease settlement even with unknown COMMIT status");

const unproved = fixture(async ({ onLaunch }) => {
  onLaunch(); throw Object.assign(new Error("child failed"), { code: "child_failed" });
});
await assert.rejects(unproved.call(), error => error?.code === "static_weekly_recurring_operation_custody_unknown");
assert.equal(unproved.retained, 1);
assert.equal(unproved.request.restoreMutationLease.signal.aborted, true);

const early = fixture(async ({ onLaunch }) => { onLaunch(); throw new Error("identity unavailable before work"); });
await assert.rejects(early.call(), error => error?.code === "static_weekly_recurring_operation_custody_unknown");
assert.equal(early.retained, 1, "provisional launch without proved group absence is retained");

const duplicate = fixture(async ({ onLaunch }) => { onLaunch(); onLaunch();
  throw Object.assign(new Error("late result rejected"), { groupAbsent: false }); });
await assert.rejects(duplicate.call(), error => error?.code === "static_weekly_recurring_operation_custody_unknown");
assert.equal(duplicate.retained, 1, "duplicate late callback cannot release or multiply the unknown lease transition");

await assert.rejects(runRecurringWithRestoreCustody({ run: async () => {}, request: {}, kind: "preview", body, manager }),
  error => error?.code === "static_weekly_recurring_operation_custody_unknown");

const source = recurringOperationSourceManifest();
let bound;
const runner = createRecurringOperationRunner({ sourceManifest: () => source,
  run: async options => {
    bound = options;
    assert.equal(options.sourceDigest, source.digest);
    assert.equal(options.childDigest, source.files.find(row => row.path === "src/static-weekly-recurring-operation-child.js").sha256);
    assert.equal(options.childFile.protocol, "file:");
    assert.equal(options.input.manager.manager_id, manager.manager_id);
    return { groupAbsent: true, receipt: { kind: "preview", data: { source: "AUTHENTICATED_MANAGER_READBACK",
      admitted: false, published: false, affectedPhonesUpdated: false, previewDigest: "a".repeat(64) } } };
  } });
assert.equal((await runner({ kind: "preview", body, manager, deadlineAt: 60_000 })).source, "AUTHENTICATED_MANAGER_READBACK");
assert.equal(typeof bound.launch, "function", "production child launch carries the private process marker");
await assert.rejects(createRecurringOperationRunner({ sourceManifest: () => source,
  run: async () => ({ groupAbsent: false }) })({ kind: "preview", body, manager, deadlineAt: 60_000 }),
error => error?.code === "static_weekly_operation_reap_unproven");
console.log("static-weekly recurring restore-custody handler checks PASS");
