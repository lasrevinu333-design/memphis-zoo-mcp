import assert from "node:assert/strict";
import { aiParseEventTexts } from "../src/events-ai-parser.js";

const locationGroups = [
  {
    location_group_id: "00000000-0000-4000-8000-000000000001",
    group_code: "EC",
    group_name: "Event Center",
    included_locations: ["Event Center", "Event Ctr", "EC", "event centre"],
  },
  {
    location_group_id: "00000000-0000-4000-8000-000000000002",
    group_code: "PP",
    group_name: "Primate Pavilion",
    included_locations: ["Primate Pavilion", "Primate Pavillion", "PP"],
  },
];

async function parseOne(text) {
  const [row] = await aiParseEventTexts({ texts: [text], locationGroups });
  return row;
}

function assertTime(row, start, end) {
  assert.equal(row.start_time, start, `start_time for ${row.raw_text}`);
  assert.equal(row.end_time, end, `end_time for ${row.raw_text}`);
}

const babyDay = await parseOne(`
Event Name
Baby Day
Event Area
Event Center
Start Time
9:00 AM
End Time
5/9/2026 6:00
Admissions Staff
Animal Staff
`);
assert.equal(babyDay.event_name, "Baby Day");
assert.equal(babyDay.location_group_name, "Event Center");
assert.equal(babyDay.event_date, "2026-05-09");
assertTime(babyDay, "09:00:00", "18:00:00");
assert.ok(!babyDay.event_name.includes("Staff"));

const compact = await parseOne("Baby Day EC 5/9 9a-6p 500 guests");
assert.equal(compact.event_name, "Baby Day");
assert.equal(compact.location_group_name, "Event Center");
assert.match(compact.event_date, /^\d{4}-05-09$/);
assertTime(compact, "09:00:00", "18:00:00");
assert.equal(compact.attendee_count, "500");

const noMeridiemEnd = await parseOne("Baby Day at Event Ctr 5/9 start 9am end 630");
assert.equal(noMeridiemEnd.location_group_name, "Event Center");
assertTime(noMeridiemEnd, "09:00:00", "18:30:00");

const pavilionTypo = await parseOne("Windsor Prom at Primate Pavillion on 4/28 630pm to 9pm 55 people need 6 trash boxes");
assert.equal(pavilionTypo.location_group_name, "Primate Pavilion");
assert.match(pavilionTypo.event_date, /^\d{4}-04-28$/);
assertTime(pavilionTypo, "18:30:00", "21:00:00");
assert.equal(pavilionTypo.attendee_count, "55");
assert.ok(pavilionTypo.event_name.includes("Windsor Prom"));

const labeledInline = await parseOne("Event Name: Baby Day | Event Area: Event Center | Event Date: 5-9 | Start Time: 9 | End Time: 6p | Guests: 1000");
assert.equal(labeledInline.event_name, "Baby Day");
assert.match(labeledInline.event_date, /^\d{4}-05-09$/);
assertTime(labeledInline, "09:00:00", "18:00:00");
assert.equal(labeledInline.attendee_count, "1000");

console.log("events parser golden tests passed");
