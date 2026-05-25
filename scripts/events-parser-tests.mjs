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

const endOfSummer = await parseOne("Event Name: End of Summer Bash | Event Area: Event Center | Event Date: 5-9 | Start Time: 9 | End Time: 6p");
assert.equal(endOfSummer.event_name, "End of Summer Bash");
assertTime(endOfSummer, "09:00:00", "18:00:00");

const startStrong = await parseOne("Event Name: Start Strong Camp | Event Area: Event Center | Event Date: 5-9 | Start Time: 9 | End Time: 6p");
assert.equal(startStrong.event_name, "Start Strong Camp");
assertTime(startStrong, "09:00:00", "18:00:00");

const narrativeNeeds = await parseOne("Need 1 custodian and extra trash boxes for Donor Dinner at Event Center on June 12 from 5:30pm to 8pm. 85 guests.");
assert.equal(narrativeNeeds.event_name, "Donor Dinner");
assert.match(narrativeNeeds.notes, /custodian/i);
assert.match(narrativeNeeds.notes, /trash boxes/i);
assert.doesNotMatch(narrativeNeeds.notes, /Event Center/i);
assert.doesNotMatch(narrativeNeeds.notes, /June 12|5:30|8pm|85 guests/i);

const labeledNotes = await parseOne("Event Name: Donor Dinner | Event Area: Event Center | Event Date: 6/12 | Start: 5:30 pm | End: 8:00 pm | Guests: 85 | Notes: catering, extra trash, restroom check before dinner and after dessert");
assert.equal(labeledNotes.event_name, "Donor Dinner");
assert.equal(labeledNotes.notes, "Catering, extra trash, restroom check before dinner and after dessert");
assert.doesNotMatch(labeledNotes.notes, /Event:|Location:|Date:|Start:|End:|Guests:/i);

const repeatedFieldsInNotes = await parseOne("Event Name: Donor Dinner | Event Area: Event Center | Event Date: 6/12 | Start: 5:30 pm | End: 8:00 pm | Guests: 85 | Notes: Donor Dinner Event Center 6/12 5:30 pm to 8:00 pm 85 guests catering, extra trash");
assert.equal(repeatedFieldsInNotes.event_name, "Donor Dinner");
assert.equal(repeatedFieldsInNotes.location_group_name, "Event Center");
assert.equal(repeatedFieldsInNotes.attendee_count, "85");
assert.equal(repeatedFieldsInNotes.notes, "Catering, extra trash");
assert.doesNotMatch(repeatedFieldsInNotes.notes, /Donor Dinner|Event Center|6\/12|5:30|8:00|85 guests/i);

const weddingSetup = await aiParseEventTexts({
  texts: [
    "Wedding setup - Cat House Cafe - June 14th - 10-2 - approx 75 ppl. Actually ceremony is 11am, cleanup after 2:30. Put dumpsters by back gate.",
    "Event Name: Wedding setup | Location: Cat House Cafe | Date: June 14 | Start Time: 10 | End Time: 2 | Guests: 75 | Notes: Wedding setup at Cat House Cafe on June 14 from 10-2 for 75 ppl. Actually ceremony is 11am, cleanup after 2:30. Put dumpsters by back gate.",
  ],
  locationGroups: [
    ...locationGroups,
    {
      location_group_id: "00000000-0000-4000-8000-000000000003",
      group_code: "CATHOUSE_CAFE_RESTROOMS",
      group_name: "Cathouse Cafe Restrooms",
      included_locations: ["Cat House Cafe", "Cathouse Cafe", "Cafe"],
    },
  ],
});
assert.equal(weddingSetup[0].event_name, "Wedding setup");
assert.equal(weddingSetup[0].location_group_name, "Cathouse Cafe Restrooms");
assert.match(weddingSetup[0].event_date, /^\d{4}-06-14$/);
assertTime(weddingSetup[0], "10:00:00", "14:00:00");
assert.equal(weddingSetup[0].attendee_count, "75");
for (const row of weddingSetup) {
  assert.match(row.notes, /Ceremony is 11am/i);
  assert.match(row.notes, /cleanup after 2:30/i);
  assert.match(row.notes, /Put dumpsters by back gate/i);
  assert.doesNotMatch(row.notes, /Wedding setup|Cat House Cafe|June 14|approx 75 ppl|75 guests|10-2/i);
}
assert.doesNotMatch(weddingSetup[0].warnings.join(","), /end_not_after_start/);

const originalFetch = global.fetch;
const originalGeminiApiKey = process.env.EVENTS_GEMINI_API_KEY;

try {
  process.env.EVENTS_GEMINI_API_KEY = "test-key";
  let capturedPrompt = "";
  global.fetch = async (_url, options = {}) => {
    const body = JSON.parse(String(options.body || "{}"));
    capturedPrompt = String(body?.contents?.[0]?.parts?.[0]?.text || "");
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          candidates: [{
            content: {
              parts: [{
                text: JSON.stringify({
                  rows: [{
                    source_index: 1,
                    event_name: "End of Summer Bash",
                    location_group_id: locationGroups[0].location_group_id,
                    location_group_name: locationGroups[0].group_name,
                    event_date: "2026-05-09",
                    start_time: "10:00:00",
                    end_time: "11:00:00",
                    attendee_count: "42",
                    notes: "",
                    confidence: "high",
                    review_notes: null,
                    warnings: [],
                  }],
                }),
              }],
            },
          }],
        };
      },
    };
  };

  const rows = await aiParseEventTexts({
    texts: [
      "Baby Day EC 5/9 9a-6p 500 guests",
      "Event Area: Event Center",
    ],
    locationGroups,
  });

  assert.match(capturedPrompt, /"source_index":1/);
  assert.doesNotMatch(capturedPrompt, /"source_index":0,"text":"Event Area: Event Center"/);
  assert.equal(rows[0].event_name, "Baby Day");
  assert.equal(rows[0].provider_used, "local-parser");
  assert.equal(rows[1].event_name, "End of Summer Bash");
  assert.equal(rows[1].provider_used, "local-parser+gemini-fill");
  assert.equal(rows[1].start_time, "10:00:00");
  assert.equal(rows[1].end_time, "11:00:00");
  assert.equal(rows[1].attendee_count, "42");
} finally {
  global.fetch = originalFetch;
  if (originalGeminiApiKey == null) delete process.env.EVENTS_GEMINI_API_KEY;
  else process.env.EVENTS_GEMINI_API_KEY = originalGeminiApiKey;
}

console.log("events parser golden tests passed");
