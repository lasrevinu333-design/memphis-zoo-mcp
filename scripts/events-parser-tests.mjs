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

const undatedPastMonthStaysThisYear = await parseOne("Test event at Event Center on January 10 from 9am to 10am");
assert.equal(undatedPastMonthStaysThisYear.event_date, `${new Date().getFullYear()}-01-10`, "undated test/normal events stay in the current year unless it is within the year-end rollover window");

const compactHyphenDateOnly = await parseOne("Baby Day EC 5-9 500 guests");
assert.equal(compactHyphenDateOnly.event_name, "Baby Day");
assert.equal(compactHyphenDateOnly.location_group_name, "Event Center");
assert.match(compactHyphenDateOnly.event_date, /^\d{4}-05-09$/);
assert.equal(compactHyphenDateOnly.start_time, "", "date-only 5-9 must not become 5am start time");
assert.equal(compactHyphenDateOnly.end_time, "", "date-only 5-9 must not become 9am end time");
assert.match(compactHyphenDateOnly.warnings.join(","), /missing_time/);

const compactHyphenTimeWithSeparateDate = await parseOne("Baby Day EC 5/9 5-9 500 guests");
assert.equal(compactHyphenTimeWithSeparateDate.event_name, "Baby Day");
assert.match(compactHyphenTimeWithSeparateDate.event_date, /^\d{4}-05-09$/);
assertTime(compactHyphenTimeWithSeparateDate, "17:00:00", "21:00:00");

const endMeridiemOnly = await parseOne("Baby Day at Event Center on 5/9 from 6:30 to 9pm 500 guests");
assertTime(endMeridiemOnly, "18:30:00", "21:00:00");

const impossibleIsoDate = await parseOne("Event Date: 2026-99-99 | Event Name: Bad Date | Event Area: Event Center | Start Time: 9am | End Time: 10am");
assert.equal(impossibleIsoDate.event_date, "");
assert.match(impossibleIsoDate.warnings.join(","), /missing_date/);
assert.doesNotMatch(impossibleIsoDate.notes, /Event Date:|Event Name:|Event Area:|Start Time:|End Time/i);

const farFutureDate = await parseOne("Event Date: 12/31/2030 | Event Name: Future Party | Event Area: Event Center | Start Time: 9am | End Time: 10am");
assert.equal(farFutureDate.event_date, "");
assert.match(farFutureDate.warnings.join(","), /missing_date/);

const eventWillRun = await parseOne("Event will run from 9am to 6pm at Event Center on 5/9. 500 guests.");
assert.notEqual(eventWillRun.event_name, "Center");
assert.match(eventWillRun.warnings.join(","), /missing_event_name/);

const labeledWithoutNotes = await parseOne("Event: Baby Day | Event Area: Event Center | Date: 5/9 | Start: 9am | End: 6pm");
assert.equal(labeledWithoutNotes.event_name, "Baby Day");
assert.equal(labeledWithoutNotes.notes, "");
assert.doesNotMatch(labeledWithoutNotes.notes, /Event:|Event Area:|Date:|Start:|End/i);

const noMeridiemEnd = await parseOne("Baby Day at Event Ctr 5/9 start 9am end 630");
assert.equal(noMeridiemEnd.location_group_name, "Event Center");
assertTime(noMeridiemEnd, "09:00:00", "18:30:00");

const pavilionTypo = await parseOne("Windsor Prom at Primate Pavillion on 4/28 630pm to 9pm 55 people need 6 trash boxes");
assert.equal(pavilionTypo.location_group_name, "Primate Pavilion");
assert.match(pavilionTypo.event_date, /^\d{4}-04-28$/);
assertTime(pavilionTypo, "18:30:00", "21:00:00");
assert.equal(pavilionTypo.attendee_count, "55");
assert.ok(pavilionTypo.event_name.includes("Windsor Prom"));

const eventAreaGroups = [
  ...locationGroups,
  {
    location_group_id: "00000000-0000-4000-8000-000000000010",
    group_code: "SPLASH_PAD_RESTROOMS",
    group_name: "Splash Pad Restrooms",
    included_locations: ["Splash Pad", "Splashpad", "Splash Pad Restrooms"],
  },
  {
    location_group_id: "00000000-0000-4000-8000-000000000011",
    group_code: "COURTYARD_RESTROOMS",
    group_name: "Courtyard Restrooms",
    included_locations: ["Courtyard", "Courtyard Restrooms"],
  },
];
const splashPadEvent = await aiParseEventTexts({
  texts: ["Event Name: Splash Pad Birthday | Event Area: Splash Pad | Event Date: 7/11 | Start Time: 10am | End Time: 12pm | Guests: 45"],
  locationGroups: eventAreaGroups,
});
assert.equal(splashPadEvent[0].location_group_id, "00000000-0000-4000-8000-000000000010");
assert.equal(splashPadEvent[0].location_group_name, "Splash Pad");
assert.doesNotMatch(splashPadEvent[0].location_group_name, /Restrooms/i);
const courtyardEvent = await aiParseEventTexts({
  texts: ["Donor mixer at Courtyard on 7/12 from 5pm to 7pm. 80 guests."],
  locationGroups: eventAreaGroups,
});
assert.equal(courtyardEvent[0].location_group_id, "00000000-0000-4000-8000-000000000011");
assert.equal(courtyardEvent[0].location_group_name, "Courtyard");
assert.doesNotMatch(courtyardEvent[0].location_group_name, /Restrooms/i);

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

const monthNameBareRange = await parseOne("Test at Event Center June 14 10-2 75 ppl");
assert.equal(monthNameBareRange.event_name, "Test");
assert.equal(monthNameBareRange.location_group_name, "Event Center");
assert.match(monthNameBareRange.event_date, /^\d{4}-06-14$/, "month-name date must not be overwritten by bare 10-2 time range");
assertTime(monthNameBareRange, "10:00:00", "14:00:00");
assert.equal(monthNameBareRange.attendee_count, "75");
assert.doesNotMatch(monthNameBareRange.warnings.join(","), /end_not_after_start/);

const monthNameSeparatedRange = await parseOne("Test EC June 14 - 10-2 75 ppl");
assert.match(monthNameSeparatedRange.event_date, /^\d{4}-06-14$/);
assert.equal(monthNameSeparatedRange.event_name, "Test");
assertTime(monthNameSeparatedRange, "10:00:00", "14:00:00");
assert.doesNotMatch(monthNameSeparatedRange.warnings.join(","), /end_not_after_start/);
assert.equal(monthNameSeparatedRange.confidence, "high");

const invalidChronology = await parseOne("Event Name: Board Meeting | Event Area: EC | Event Date: 6/12 | Start Time: 12 | End Time: 1");
assert.match(invalidChronology.warnings.join(","), /end_not_after_start/);
assert.notEqual(invalidChronology.confidence, "high", "invalid start/end chronology must not remain high confidence");
assert.equal(invalidChronology.field_confidence.time, "low", "invalid chronology should lower time field confidence");

const nameLabel = await parseOne("Name: Baby Day | Event Area: Event Center | Date: 5/9 | Start: 9am | End: 6pm");
assert.equal(nameLabel.event_name, "Baby Day");
assert.equal(nameLabel.notes, "");
assert.doesNotMatch(nameLabel.notes, /Name/i);

const staffOnlyCount = await parseOne("Board Meeting at Event Center on June 14 from 10am to 2pm with 25 staff");
assert.equal(staffOnlyCount.attendee_count, null, "staff counts should not be treated as attendee/guest counts");
assert.equal(staffOnlyCount.notes, "", "staff-only counts should not pollute residual notes");

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
