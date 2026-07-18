import assert from "node:assert/strict";
import { aiParseEventTexts } from "../src/events-ai-parser.js";

const locationGroups = [
  {
    location_group_id: "00000000-0000-4000-8000-000000000001",
    group_code: "EC",
    group_name: "Event Center",
    included_locations: ["Event Center", "Event Ctr", "EC", "event centre"],
    eligible_event_venue: true,
    eligible_custodial_coverage: true,
  },
  {
    location_group_id: "00000000-0000-4000-8000-000000000002",
    group_code: "PP",
    group_name: "Primate Pavilion",
    included_locations: ["Primate Pavilion", "Primate Pavillion", "PP"],
    eligible_event_venue: true,
    eligible_custodial_coverage: true,
  },
  {
    location_group_id: "00000000-0000-4000-8000-000000000009",
    group_code: "NWP",
    group_name: "Northwest Passage",
    included_locations: ["Northwest Passage", "North West Passage", "NWP"],
    eligible_event_venue: true,
    eligible_custodial_coverage: true,
  },
];

const eventVenues = [
  {
    venue_id: "10000000-0000-4000-8000-000000000000",
    venue_code: "ZOO_FOOTPRINT",
    display_name: "Zoo Footprint",
    event_scope: "ZOO_WIDE",
    location_group_id: "20000000-0000-4000-8000-000000000000",
    eligible_event_venue: false,
    eligible_event_scope: true,
    aliases: ["Zoo Footprint", "zoo wide", "zoo-wide", "entire zoo", "whole zoo", "across the zoo", "campus-wide", "park-wide"],
  },
  {
    venue_id: "10000000-0000-4000-8000-000000000001",
    venue_code: "EVENT_CENTER",
    display_name: "Event Center",
    event_scope: "SINGLE_VENUE",
    location_group_id: "00000000-0000-4000-8000-000000000001",
    eligible_event_venue: true,
    aliases: ["Event Center", "Event Ctr", "EC", "event centre"],
  },
  {
    venue_id: "10000000-0000-4000-8000-000000000002",
    venue_code: "PRIMATE_PAVILION",
    display_name: "Primate Pavilion",
    event_scope: "SINGLE_VENUE",
    location_group_id: "00000000-0000-4000-8000-000000000002",
    eligible_event_venue: true,
    aliases: ["Primate Pavilion", "Primate Pavillion", "PP"],
  },
  {
    venue_id: "10000000-0000-4000-8000-000000000009",
    venue_code: "NORTH_WEST_PASSAGE",
    display_name: "Northwest Passage",
    event_scope: "SINGLE_VENUE",
    location_group_id: "00000000-0000-4000-8000-000000000009",
    eligible_event_venue: true,
    aliases: ["Northwest Passage", "North West Passage", "NWP"],
  },
  {
    venue_id: "10000000-0000-4000-8000-000000000003",
    venue_code: "CAT_HOUSE_CAFE",
    display_name: "Cat House Café",
    event_scope: "SINGLE_VENUE",
    location_group_id: "20000000-0000-4000-8000-000000000003",
    eligible_event_venue: true,
    aliases: ["Cat House Cafe", "Cathouse Cafe", "Cat House", "Cathouse"],
  },
  {
    venue_id: "10000000-0000-4000-8000-000000000004",
    venue_code: "COURTYARD",
    display_name: "Courtyard",
    event_scope: "SINGLE_VENUE",
    location_group_id: "20000000-0000-4000-8000-000000000004",
    eligible_event_venue: true,
    aliases: ["Courtyard", "Entrance Courtyard"],
  },
  {
    venue_id: "10000000-0000-4000-8000-000000000005",
    venue_code: "SPLASH_PAD",
    display_name: "Splash Pad",
    event_scope: "SINGLE_VENUE",
    location_group_id: "20000000-0000-4000-8000-000000000005",
    eligible_event_venue: true,
    aliases: ["Splash Pad", "Splashpad"],
  },
  {
    venue_id: "10000000-0000-4000-8000-000000000006",
    venue_code: "TETON_LODGE",
    display_name: "Teton Lodge",
    event_scope: "SINGLE_VENUE",
    location_group_id: "00000000-0000-4000-8000-000000000006",
    eligible_event_venue: true,
    aliases: ["Teton", "Teton Trek", "Teton Lodge", "Teton Trek Lodge"],
  },
  {
    venue_id: "10000000-0000-4000-8000-000000000007",
    venue_code: "CHINA_EXHIBIT",
    display_name: "China Exhibit",
    event_scope: "SINGLE_VENUE",
    location_group_id: "00000000-0000-4000-8000-000000000007",
    eligible_event_venue: true,
    aliases: ["China", "China exhibit", "China Theater"],
  },
  {
    venue_id: "10000000-0000-4000-8000-000000000008",
    venue_code: "CAT_COUNTRY",
    display_name: "Cat Country",
    event_scope: "SINGLE_VENUE",
    location_group_id: "00000000-0000-4000-8000-000000000008",
    eligible_event_venue: true,
    aliases: ["Cat Country", "catcountry", "Cat Country Exhibit"],
  },
];

const eventDefaults = [
  {
    match_text: "Members Night",
    normalized_match: "members night",
    event_scope: "ZOO_WIDE",
    primary_venue_id: "10000000-0000-4000-8000-000000000000",
    display_location: "Zoo Footprint",
    location_group_id: "20000000-0000-4000-8000-000000000000",
    active: true,
  },
];

async function parseOne(text) {
  const [row] = await aiParseEventTexts({ texts: [text], locationGroups, eventVenues, eventDefaults });
  return row;
}

function assertTime(row, start, end) {
  assert.equal(row.start_time, start, `start_time for ${row.raw_text}`);
  assert.equal(row.end_time, end, `end_time for ${row.raw_text}`);
}

for (const phrase of ["zoo wide", "zoo-wide", "entire zoo", "across the zoo", "campus-wide", "park-wide"]) {
  const row = await parseOne(`Event Name: Members Night | Location: ${phrase} | Event Date: 7/17/2026 | Start Time: 6pm | End Time: 8:30pm | Attendance: Not listed`);
  assert.equal(row.event_scope, "ZOO_WIDE", `${phrase} should map to ZOO_WIDE`);
  assert.equal(row.display_location, "Zoo Footprint", `${phrase} should display Zoo Footprint`);
  assert.equal(row.primary_venue_id, "10000000-0000-4000-8000-000000000000");
}

const membersDefault = await parseOne("Event Name: Members Night | Location: MemMex Restrooms | Event Date: 7/17/2026 | Start Time: 6pm | End Time: 8:30pm");
assert.equal(membersDefault.event_scope, "ZOO_WIDE");
assert.equal(membersDefault.display_location, "Zoo Footprint");
assert.equal(membersDefault.location_group_name, "Zoo Footprint");

const zooWideCoverage = await aiParseEventTexts({
  texts: ["Members Night is zoo-wide on 7/17/2026 from 6pm to 8:30pm. Custodial coverage: MemMex Restrooms."],
  locationGroups: [
    ...locationGroups,
    {
      location_group_id: "30000000-0000-4000-8000-000000000001",
      group_code: "MEMMEX_RESTROOMS",
      group_name: "MemMex Restrooms",
      included_locations: ["MemMex Restrooms", "MemMex Men's Restroom", "MemMex Women's Restroom"],
      eligible_event_venue: false,
      eligible_custodial_coverage: true,
      public_restroom: true,
    },
  ],
  eventVenues,
  eventDefaults,
});
assert.equal(zooWideCoverage[0].event_scope, "ZOO_WIDE");
assert.equal(zooWideCoverage[0].display_location, "Zoo Footprint");
assert.ok(zooWideCoverage[0].coverage_location_ids.includes("30000000-0000-4000-8000-000000000001"), "MemMex Restrooms should remain coverage, not venue");

const restroomOnly = await aiParseEventTexts({
  texts: ["Event Name: Unknown Party | Event Area: MemMex Restrooms | Event Date: 7/17/2026 | Start Time: 6pm | End Time: 8pm"],
  locationGroups: [
    ...locationGroups,
    {
      location_group_id: "30000000-0000-4000-8000-000000000001",
      group_code: "MEMMEX_RESTROOMS",
      group_name: "MemMex Restrooms",
      included_locations: ["MemMex Restrooms", "MemMex"],
      eligible_event_venue: false,
      eligible_custodial_coverage: true,
      public_restroom: true,
    },
  ],
  eventVenues,
  eventDefaults: [],
});
assert.equal(restroomOnly[0].event_scope, "UNKNOWN");
assert.equal(restroomOnly[0].needs_review, true);
assert.match(restroomOnly[0].parse_reason, /custodial coverage/i);

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

const personNamedEvent = await parseOne("Lisa Horton at Event Center on June 14 from 10am to 2pm 75 guests");
assert.equal(personNamedEvent.event_name, "Lisa Horton", "person-name event titles must not be eaten by the Event Center area name");
assert.equal(personNamedEvent.location_group_name, "Event Center");
assert.match(personNamedEvent.event_date, /^\d{4}-06-14$/);
assertTime(personNamedEvent, "10:00:00", "14:00:00");
assert.equal(personNamedEvent.attendee_count, "75");
assert.equal(personNamedEvent.notes, "", "fully parsed event-name/location/date/time/count text should not become notes");

const personBirthdayEvent = await parseOne("Lisa Horton Birthday at Event Center on June 14 from 10am to 2pm 75 guests");
assert.equal(personBirthdayEvent.event_name, "Lisa Horton Birthday", "birthday/party-style person names can be event titles");
assert.equal(personBirthdayEvent.location_group_name, "Event Center");
assert.match(personBirthdayEvent.event_date, /^\d{4}-06-14$/);
assertTime(personBirthdayEvent, "10:00:00", "14:00:00");
assert.equal(personBirthdayEvent.notes, "");

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

const catCountryVenue = await aiParseEventTexts({
  texts: ["National Mountain Lion Day at Cat Country on 8/26/2026 from 10am to 2pm"],
  locationGroups: [
    ...locationGroups,
    {
      location_group_id: "00000000-0000-4000-8000-000000000008",
      group_code: "CAT_COUNTRY",
      group_name: "Cat Country",
      included_locations: ["Cat Country"],
      eligible_event_venue: true,
      eligible_custodial_coverage: true,
      exhibit: true,
    },
  ],
  eventVenues,
  eventDefaults,
});
assert.equal(catCountryVenue[0].event_scope, "SINGLE_VENUE");
assert.equal(catCountryVenue[0].display_location, "Cat Country");
assert.equal(catCountryVenue[0].primary_venue_id, "10000000-0000-4000-8000-000000000008");

const eventAreaGroups = [
  ...locationGroups,
  {
    location_group_id: "00000000-0000-4000-8000-000000000010",
    group_code: "SPLASH_PAD_RESTROOMS",
    group_name: "Splash Pad Restrooms",
    included_locations: ["Splash Pad Restrooms"],
    eligible_event_venue: false,
    eligible_custodial_coverage: true,
    public_restroom: true,
  },
  {
    location_group_id: "00000000-0000-4000-8000-000000000011",
    group_code: "COURTYARD_RESTROOMS",
    group_name: "Courtyard Restrooms",
    included_locations: ["Courtyard Restrooms"],
    eligible_event_venue: false,
    eligible_custodial_coverage: true,
    public_restroom: true,
  },
];
const splashPadEvent = await aiParseEventTexts({
  texts: ["Event Name: Splash Pad Birthday | Event Area: Splash Pad | Event Date: 7/11 | Start Time: 10am | End Time: 12pm | Guests: 45"],
  locationGroups: eventAreaGroups,
  eventVenues,
  eventDefaults,
});
assert.equal(splashPadEvent[0].event_scope, "SINGLE_VENUE");
assert.equal(splashPadEvent[0].location_group_id, "20000000-0000-4000-8000-000000000005");
assert.equal(splashPadEvent[0].location_group_name, "Splash Pad");
assert.doesNotMatch(splashPadEvent[0].location_group_name, /Restrooms/i);
const courtyardEvent = await aiParseEventTexts({
  texts: ["Donor mixer at Courtyard on 7/12 from 5pm to 7pm. 80 guests."],
  locationGroups: eventAreaGroups,
  eventVenues,
  eventDefaults,
});
assert.equal(courtyardEvent[0].event_scope, "SINGLE_VENUE");
assert.equal(courtyardEvent[0].location_group_id, "20000000-0000-4000-8000-000000000004");
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

const guestCountOnly = await parseOne("Event Name: Donor Dinner | Event Area: Event Center | Event Date: 6/12 | Start: 5:30 pm | End: 8:00 pm | Guest Count: 85");
assert.equal(guestCountOnly.event_name, "Donor Dinner");
assert.equal(guestCountOnly.attendee_count, "85");
assert.equal(guestCountOnly.notes, "", "guest-count-only labels must not leak into Notes");

const guestCountInsideNotes = await parseOne("Event Name: Donor Dinner | Event Area: Event Center | Event Date: 6/12 | Start: 5:30 pm | End: 8:00 pm | Notes: Guest Count: 85");
assert.equal(guestCountInsideNotes.attendee_count, "85");
assert.equal(guestCountInsideNotes.notes, "", "a duplicated guest count inside Notes should be stripped, not copied");

const guestCountInsideNotesWithActualNotes = await parseOne("Event Name: Donor Dinner | Event Area: Event Center | Event Date: 6/12 | Start: 5:30 pm | End: 8:00 pm | Notes: Guest Count: 85 | catering, extra trash, restroom check before dinner and after dessert");
assert.equal(guestCountInsideNotesWithActualNotes.attendee_count, "85");
assert.equal(guestCountInsideNotesWithActualNotes.notes, "Catering, extra trash, restroom check before dinner and after dessert", "count duplicated inside Notes should be removed while unlabeled actual notes after it survive");

const notesBeforeTrailingGuestCount = await parseOne("Event Name: Donor Dinner | Event Area: Event Center | Event Date: 6/12 | Start: 5:30 pm | End: 8:00 pm | Notes: catering, extra trash | Guest Count: 85");
assert.equal(notesBeforeTrailingGuestCount.attendee_count, "85");
assert.equal(notesBeforeTrailingGuestCount.notes, "Catering, extra trash", "trailing Guest Count should fill attendance without polluting Notes");

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
      included_locations: ["Cathouse Cafe Restrooms"],
      eligible_event_venue: false,
      eligible_custodial_coverage: true,
      public_restroom: true,
    },
  ],
  eventVenues,
  eventDefaults,
});
assert.equal(weddingSetup[0].event_name, "Wedding setup");
assert.equal(weddingSetup[0].event_scope, "SINGLE_VENUE");
assert.equal(weddingSetup[0].location_group_name, "Cat House Café");
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

const arpZooSnooze = await parseOne("Event Name: ARP Zoo Snooze | Event Area: North West Passage | Event Date: 6/19/2026 | Start Time: 10pm | End Time: 8am | Guests: 75 | Notes: overnight event ends the next morning");
assert.equal(arpZooSnooze.event_name, "ARP Zoo Snooze");
assert.equal(arpZooSnooze.location_group_name, "Northwest Passage");
assert.equal(arpZooSnooze.event_date, "2026-06-19");
assertTime(arpZooSnooze, "22:00:00", "08:00:00");
assert.doesNotMatch(arpZooSnooze.warnings.join(","), /end_not_after_start/);
assert.equal(arpZooSnooze.field_confidence.time, "high", "overnight Zoo Snooze should keep high time confidence");

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
                    event_scope: "SINGLE_VENUE",
                    primary_venue_id: eventVenues[1].venue_id,
                    venue_ids: [eventVenues[1].venue_id],
                    display_location: "Event Center",
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
    eventVenues,
    eventDefaults,
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
