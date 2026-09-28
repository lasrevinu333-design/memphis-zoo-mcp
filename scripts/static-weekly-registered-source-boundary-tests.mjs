#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import { adaptRegisteredRecurringSource } from "../src/static-weekly-recurring-staffing-adaptation.js";

const packetPath = process.env.STATIC_WEEKLY_TEST_SIX_PACKET;
assert.ok(packetPath, "frozen six-person source packet required");
const source = JSON.parse(fs.readFileSync(packetPath)).compilerInput;
const patternConfig = JSON.parse(fs.readFileSync(new URL("../config/custodial-six-person-static-20260926.json", import.meta.url)));
const candidate = adaptRegisteredRecurringSource({ registeredSource: source, patternConfig });
assert.equal(candidate.status, "CANDIDATE_ONLY");
assert.equal(candidate.compilerInput.version.assignments.length, source.version.assignments.length);
assert.notEqual(candidate.compilerInput, source);
assert.equal(source.version.vacantSlotIds.length, 3);
let checks = 4;
const missing = structuredClone(source);
missing.version.assignments.pop();
assert.throws(() => adaptRegisteredRecurringSource({ registeredSource: missing, patternConfig }), /preserve every source family/); checks++;
const duplicate = structuredClone(source);
duplicate.version.assignments.push(structuredClone(duplicate.version.assignments[0]));
assert.throws(() => adaptRegisteredRecurringSource({ registeredSource: duplicate, patternConfig }), /source splits one family/); checks++;
const altered = structuredClone(source);
const karen = altered.slots.find((row) => row.id === patternConfig.slots.KAREN.slotId);
const current = karen.incumbencies.find((item) => item.effectiveStart <= patternConfig.effectiveDate
  && (!item.effectiveEnd || patternConfig.effectiveDate < item.effectiveEnd));
current.personId = "12345678-1234-4234-8234-123456789abc";
assert.throws(() => adaptRegisteredRecurringSource({ registeredSource: altered, patternConfig }), /registered person mismatch/); checks++;
console.log(JSON.stringify({ status: "PASS", checks, noProductionWrite: true,
  sourceRegistration: "NOT IMPLEMENTED" }));
