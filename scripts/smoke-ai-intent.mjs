import assert from "node:assert/strict";
import { findLocationCode, isSystemSpecificQuestion } from "../src/ai/memphis-ai-intent.js";

assert.equal(findLocationCode("TETX"), "TETX");
assert.equal(findLocationCode("TET-10"), "TET10");
assert.equal(findLocationCode("schedule today"), "");
assert.equal(findLocationCode("What is Haley's number?"), "");
assert.equal(findLocationCode("Who is the water quality manager?"), "");
assert.equal(findLocationCode("Which ops managers work today?"), "");

assert.equal(isSystemSpecificQuestion("TETX"), true);
assert.equal(isSystemSpecificQuestion("schedule today"), true);
assert.equal(isSystemSpecificQuestion("who is out on pto tomorrow?"), true);
assert.equal(isSystemSpecificQuestion("who's out tomorrow?"), true);
assert.equal(isSystemSpecificQuestion("who is on time off today?"), true);
assert.equal(isSystemSpecificQuestion("is Markeisha working today?"), true);
assert.equal(isSystemSpecificQuestion("capital france"), false);
assert.equal(isSystemSpecificQuestion("that today", { last_subject_type: "location" }), true);

console.log(JSON.stringify({ ok: true, smoke: "ai-intent passed" }, null, 2));
