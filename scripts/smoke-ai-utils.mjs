import assert from "node:assert/strict";
import {
  addMinutesToTime,
  computeWeekdayDate,
  esc,
  extractExplicitDate,
  extractTimeWindow,
  extractWeekdayReference,
  inferRelativeDateOffset,
  normalizeDate,
  normalizeLoose,
  sqlLikeLiteral,
  toSafeInt,
} from "../src/ai/memphis-ai-utils.js";

assert.equal(esc("Bob's"), "Bob''s");
assert.equal(sqlLikeLiteral("Zoo"), "'%Zoo%'");
assert.equal(normalizeLoose("Teton Pavilion!"), "teton pavilion");
assert.equal(normalizeDate("2026-04-25"), "2026-04-25");
assert.equal(normalizeDate("04/25/2026"), null);
assert.equal(extractExplicitDate("on 2026-04-25 please"), "2026-04-25");
assert.equal(inferRelativeDateOffset("tomorrow"), 1);
assert.equal(inferRelativeDateOffset("yesterday"), -1);
assert.deepEqual(extractWeekdayReference("next friday"), { modifier: "next", weekday: "friday" });
assert.deepEqual(extractTimeWindow("9am to 1030am"), { start: "09:00", end: "10:30" });
assert.equal(addMinutesToTime("09:30", 45), "10:15");
assert.equal(toSafeInt("100", 14, 1, 60), 60);
assert.equal(computeWeekdayDate("2026-04-25", "sunday", "this"), "2026-04-26");

console.log(JSON.stringify({ ok: true, smoke: "ai-utils passed" }, null, 2));
