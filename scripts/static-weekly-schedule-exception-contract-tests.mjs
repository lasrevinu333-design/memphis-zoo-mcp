#!/usr/bin/env node
// Exhaustive portable half of the exception contract. The v3 database suite
// runs each enum through the same no-mutation fence; this file mutates every
// normalized field family before a compiler result can even be constructed.
import assert from "node:assert/strict";
import { assertExceptionCommand, EXCEPTION_TYPES } from "../src/static-weekly-schedule-model.js";

const clone = (value) => JSON.parse(JSON.stringify(value));
const base = (type, payload, window = null) => ({ id: `exception-${type}`, type, serviceDate: "2026-10-06", actorId: "named-manager", reason: "approved operational adjustment", idempotencyKey: `key-${type}`, expectedRevision: 4, payload, ...(window ? { window } : {}) });
const availability = {
  slotId: "slot-a", shift: { start: "07:00", end: "16:00" }, productiveCapacityProvenance: "roster", maxServiceEffortMinutes: 300,
  maxServiceEffortProvenance: "capacity", qualifications: ["general"], qualificationProvenance: "qualification", restrictions: [], restrictionProvenance: "restriction",
  acceptedRouteAnchorLocationId: "location-a", acceptedRouteProvenance: "directed-proximity",
};
const work = (added = false) => ({
  workId: added ? "event-added-work" : "event-patch-work", ...(added ? { dayOfWeek: 2, originSlotId: "slot-a" } : {}), locationId: "location-a", locationCodeSnapshot: "EVENT", locationNameSnapshot: "Event area",
  window: { start: "10:00", end: "11:00" }, serviceEffortMinutes: 20, serviceEffortProvenance: "event-effort", priority: 1, priorityProvenance: "event-priority",
  requiredQualifications: ["general"], qualificationProvenance: "event-qualification", restrictions: [], restrictionProvenance: "event-restriction",
});
const commands = new Map([
  ["pto", base("pto", { slotId: "slot-a" })],
  ["daily_absence", base("daily_absence", { slotId: "slot-a" })],
  ["partial_absence", base("partial_absence", { slotId: "slot-a" }, { start: "10:00", end: "11:00" })],
  ["shift_override", base("shift_override", { slotId: "slot-a", status: "working", shift: { start: "07:00", end: "16:00" } })],
  ["cover_all", base("cover_all", { availability })],
  ["lunch", base("lunch", { slotId: "slot-a" }, { start: "12:00", end: "12:30" })],
  ["nine_forty_five_rebalance", base("nine_forty_five_rebalance", { locks: [{ workId: "work-a", slotId: "slot-a" }] })],
  ["event_impact", base("event_impact", { removeWorkIds: ["work-a"], patchWork: [], addWork: [] })],
  ["manager_correction", base("manager_correction", { locks: [{ workId: "work-a", slotId: "slot-a" }] })],
  ["reverse", { ...base("reverse", { reversesExceptionId: "exception-pto" }), reversesExceptionId: "exception-pto" }],
]);

assert.deepEqual([...commands.keys()].sort(), [...EXCEPTION_TYPES].sort(), "every accepted exception enum needs one normalized contract fixture");
for (const [type, command] of commands) {
  assert.doesNotThrow(() => assertExceptionCommand(clone(command)), `${type} valid portable fixture must be accepted`);
  const missing = clone(command); delete missing.payload;
  assert.throws(() => assertExceptionCommand(missing), /payload|object/i, `${type} rejects a missing payload`);
  const wrongPayloadType = clone(command); wrongPayloadType.payload = [];
  assert.throws(() => assertExceptionCommand(wrongPayloadType), /payload|object/i, `${type} rejects a non-object payload`);
  const unknown = clone(command); unknown.payload.unexpected = true;
  assert.throws(() => assertExceptionCommand(unknown), /unknown|missing|canonical/i, `${type} rejects unknown payload fields`);
}

const attack = (name, mutate) => {
  const command = clone(commands.get(name)); mutate(command); assert.throws(() => assertExceptionCommand(command), undefined, `${name} field-family mutation must reject`);
};
for (const type of ["pto", "daily_absence", "partial_absence", "lunch", "shift_override"]) attack(type, (command) => { command.payload.slotId = false; });
attack("partial_absence", (command) => { command.window = { start: "11:00", end: "11:00" }; });
attack("lunch", (command) => { command.window = { start: "12:30", end: "12:00" }; });
attack("shift_override", (command) => { command.payload.status = "departed_named_absent"; });
attack("shift_override", (command) => { command.payload.shift.end = 12; });
attack("cover_all", (command) => { command.payload.availability.maxServiceEffortMinutes = 1.5; });
attack("cover_all", (command) => { command.payload.availability.qualifications = ["general", "general"]; });
attack("cover_all", (command) => { command.payload.availability.acceptedRouteAnchorLocationId = null; });
for (const type of ["nine_forty_five_rebalance", "manager_correction"]) {
  attack(type, (command) => { command.payload.locks = []; });
  attack(type, (command) => { command.payload.locks = [{ workId: "work-a", slotId: "slot-a" }, { workId: "work-a", slotId: "slot-b" }]; });
}
attack("event_impact", (command) => { command.payload.removeWorkIds = ["work-a", "work-a"]; });
attack("event_impact", (command) => { command.payload.patchWork = [work(false), work(false)]; command.payload.removeWorkIds = []; });
attack("event_impact", (command) => { command.payload.addWork = [work(true)]; command.payload.removeWorkIds = []; command.payload.addWork[0].dayOfWeek = 7; });
attack("event_impact", (command) => { command.payload.addWork = [work(true)]; command.payload.removeWorkIds = []; command.payload.addWork[0].serviceEffortMinutes = -1; });
attack("reverse", (command) => { command.reversesExceptionId = "different-target"; });
attack("reverse", (command) => { command.payload.reversesExceptionId = 42; });
console.log("static weekly exhaustive portable exception contract tests: PASS");
