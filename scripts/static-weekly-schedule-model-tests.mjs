import assert from "node:assert/strict";
import {
  assertExceptionCommand,
  canonicalJson,
  contentDigest,
  serviceDateWeekday,
  sha256Hex,
  snapshotIncumbency,
  selectEffectiveWeeklyVersion,
  normalizeWindow,
  validateEffectiveRanges,
  windowContains,
  windowsOverlap,
} from "../src/static-weekly-schedule-model.js";
import { MAX_TERMINAL_EXACT_OBJECTIVE, generateStaticWeeklySchedulingProgram, identityTierWidth, leximaxTierWidth, monotonicNowMilliseconds, staticWeeklyGroupedObjectiveBounds } from "../src/static-weekly-schedule-program.js";

assert.equal(sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
assert.equal(canonicalJson({ z: [true, null], a: { b: 2, a: 1 } }), '{"a":{"a":1,"b":2},"z":[true,null]}');
assert.equal(contentDigest({ b: 2, a: 1 }), contentDigest({ a: 1, b: 2 }), "content digest must ignore object input order");
assert.equal(serviceDateWeekday("2026-08-10"), 1, "fixture Monday must remain Memphis weekday one");
assert.equal(serviceDateWeekday("2026-03-08"), 0, "spring DST Sunday stays its local service weekday");
assert.equal(serviceDateWeekday("2026-11-01"), 0, "fall DST Sunday stays its local service weekday");
assert.equal(windowContains({ start: "07:00", end: "16:00" }, { start: "08:00", end: "09:00" }), true);
assert.equal(windowsOverlap({ start: "08:00", end: "09:00" }, { start: "09:00", end: "10:00" }), false);
assert.throws(() => normalizeWindow({ start: "08:00garbage", end: "09:00" }), /HH:MM local time/i, "time grammar must reject trailing text");

// Grouped identity/rank tiers must bound the entire encoded digit sequence,
// rather than just its leading coefficient.  Base eight, width ten is the
// exact historical counterexample: its largest term fits but its digit sum
// exceeds the terminal-report exactness envelope.
const baseEightWidthTen = staticWeeklyGroupedObjectiveBounds(8, 10);
assert.equal(baseEightWidthTen.completeMaximum, 1_073_741_823n);
assert.equal(baseEightWidthTen.completeMaximumSafe, false);
assert.equal(identityTierWidth(6), 9, "base-eight identity grouping stops before the aggregate overflow");
assert.equal(leximaxTierWidth(7), 9, "base-eight leximax grouping has the same aggregate bound");
const baseTenWidthNine = staticWeeklyGroupedObjectiveBounds(10, 9);
const baseTenWidthTen = staticWeeklyGroupedObjectiveBounds(10, 10);
assert.equal(baseTenWidthNine.completeMaximum, 999_999_999n);
assert.equal(baseTenWidthNine.completeMaximumSafe, true);
assert.equal(baseTenWidthTen.completeMaximumSafe, false);
assert.equal(leximaxTierWidth(9), 9, "leximax width changes exactly at the base-ten aggregate boundary");
assert.equal(MAX_TERMINAL_EXACT_OBJECTIVE, 1_000_000_000n);

const expiredAccessor = {};
Object.defineProperty(expiredAccessor, "serviceDate", { enumerable: true, get() { throw new Error("deadline must stop before preparation"); } });
assert.equal(generateStaticWeeklySchedulingProgram(expiredAccessor, null, monotonicNowMilliseconds() - 1).error.code, "solver_timeout", "an expired absolute monotonic deadline blocks admission and preparation before property access");

const versions = [
  { id: "a", status: "published", effectiveStart: "2026-08-03", effectiveEnd: "2026-08-17" },
  { id: "b", status: "published", effectiveStart: "2026-08-17", effectiveEnd: null },
];
assert.equal(selectEffectiveWeeklyVersion(versions, "2026-08-10").id, "a");
assert.equal(selectEffectiveWeeklyVersion(versions, "2026-08-17").id, "b");
assert.throws(() => validateEffectiveRanges([{ ...versions[0], effectiveEnd: "2026-08-20" }, versions[1]]), /overlapping authority/i);

const stableSlot = {
  id: "slot-departed", label: "Stable named slot",
  incumbencies: [
    { personId: "old-person", displayName: "Avery Departed", effectiveStart: "2020-01-01", effectiveEnd: "2026-08-17" },
    { personId: "new-person", displayName: "Morgan Replacement", effectiveStart: "2026-08-17", effectiveEnd: null },
  ],
};
assert.deepEqual(snapshotIncumbency(stableSlot, "2026-08-10"), { slotId: "slot-departed", slotLabel: "Stable named slot", personId: "old-person", displayName: "Avery Departed" });
assert.deepEqual(snapshotIncumbency(stableSlot, "2026-08-17"), { slotId: "slot-departed", slotLabel: "Stable named slot", personId: "new-person", displayName: "Morgan Replacement" });

assert.doesNotThrow(() => assertExceptionCommand({
  id: "pto-1", type: "pto", serviceDate: "2026-08-10", actorId: "manager-1", reason: "Approved PTO", idempotencyKey: "pto-1-key", expectedRevision: 3,
}));
assert.throws(() => assertExceptionCommand({ id: "bad", type: "pto", serviceDate: "2026-08-10" }), /actor identity/i);

console.log("static weekly schedule model tests: PASS");
