import assert from "node:assert/strict";
import { createStaticWeeklyControlPlane } from "../src/static-weekly-control-plane.js";

const ID = "10000000-0000-4000-8000-000000000091";
const KEY = "20000000-0000-4000-8000-000000000091";
const manager = { manager_id: ID, manager_display_name: "Named manager" };
let connects = 0;
const database = { async connect() { connects++;
  return { on() {}, removeListener() {}, release() {},
    async query() { return { rows: [{ result: { state: "NOT_FOUND", ready: true } }] }; } };
}, async end() {} };
function plane(transactionConcurrency = 3) {
  return createStaticWeeklyControlPlane({ database,
    compiler: async () => {}, compilerPreparer: async () => {},
    shutdownCompiler: async () => {}, initializeSolver: async () => {},
    getSolverReadiness: () => ({ available: true }),
    transactionConcurrency, maxQueuedTransactions: 16 });
}
const control = plane();
const deadlineAt = performance.now() + 60_000;
const started = [], done = [];
for (let index = 0; index < 3; index++) {
  const work = control.runExternalRecurringOperation({ deadlineAt, action: () => new Promise(resolve => {
    started.push(index); done[index] = resolve;
  }) });
  done[`work${index}`] = work;
}
for (let attempt = 0; attempt < 20 && started.length < 3; attempt++) await new Promise(resolve => setImmediate(resolve));
assert.deepEqual(started, [0,1,2], "private children occupy the existing three ordinary slots, not a parallel budget");
const status = control.getRecurringConfirmationStatus({ manager, confirmationKey: KEY });
await new Promise(resolve => setImmediate(resolve));
assert.equal(connects, 0, "an ordinary SQL status waits behind the same three child reservations");
const health = control.health();
assert.equal((await health).ready, true);
assert.equal(connects, 1, "the existing fourth health slot remains usable while ordinary slots are held");
done[0]("accepted"); assert.equal(await done.work0, "accepted");
assert.deepEqual(await status, { state: "NOT_FOUND", ready: true });
assert.equal(connects, 2, "releasing one exact proved child slot admits the queued ordinary status");
done[1]("second"); done[2]("third");
await Promise.all([done.work1, done.work2]);
await control.close();

const held = plane(1), controller = new AbortController();
const unproved = Object.assign(new Error("unproved child"), { code: "static_weekly_recurring_operation_custody_unknown" });
await assert.rejects(held.runExternalRecurringOperation({ deadlineAt: performance.now() + 60_000,
  action: async () => { throw unproved; } }), error => error === unproved);
const waiting = held.runExternalRecurringOperation({ deadlineAt: performance.now() + 60_000, signal: controller.signal,
  action: async () => { throw new Error("an ordinary slot must not reopen"); } });
await new Promise(resolve => setImmediate(resolve));
assert.equal(connects, 2, "unknown custody does not open another SQL connection");
controller.abort(new Error("original clock expired"));
await assert.rejects(waiting, error => error?.message === "original clock expired");
// No close() on the deliberately held synthetic UNKNOWN: production keeps
// this in-process slot and the exact expired restore row until recovery.
console.log("static-weekly recurring shared authority admission checks PASS");
