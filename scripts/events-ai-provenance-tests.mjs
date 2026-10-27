import assert from 'node:assert/strict';
import { aiParseEventTexts } from '../src/events-ai-parser.js';

// Actual parser with a synthetic provider. No external AI, database or write.
const originalFetch = globalThis.fetch;
const originalKey = process.env.EVENTS_GEMINI_API_KEY;
process.env.EVENTS_GEMINI_API_KEY = 'synthetic-provenance-key';
const groups = [{ location_group_id: '00000000-0000-4000-8000-000000000001', group_code: 'EC', group_name: 'Event Center', included_locations: ['EC', 'Event Center'], eligible_event_venue: true }];
const venues = [{ venue_id: '10000000-0000-4000-8000-000000000001', venue_code: 'EVENT_CENTER', display_name: 'Event Center', event_scope: 'SINGLE_VENUE', location_group_id: groups[0].location_group_id, aliases: ['EC', 'Event Center'], eligible_event_venue: true }];
let responseRows = [];
let calls = 0;
globalThis.fetch = async () => {
  calls += 1;
  return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ rows: responseRows }) }] } }] }) };
};

async function parse(text, candidate) {
  responseRows = [{ source_index: 0, ...candidate }];
  calls = 0;
  const [row] = await aiParseEventTexts({ texts: [text], locationGroups: groups, eventVenues: venues });
  assert.equal(calls, 1, 'uncertain input reaches synthetic provider');
  return row;
}

try {
  const forged = await parse('Event Area: Event Center', {
    event_name: 'Synthetic Gala', location_group_id: groups[0].location_group_id,
    location_group_name: 'Event Center', event_date: '2026-11-09',
    start_time: '10:00:00', end_time: '11:00:00', attendee_count: '42',
    notes: 'VIP catering', confidence: 'high', warnings: [],
  });
  assert.notEqual(forged.event_name, 'Synthetic Gala');
  assert.equal(forged.event_date, '');
  assert.equal(forged.start_time, '');
  assert.equal(forged.end_time, '');
  assert.equal(forged.attendee_count, null);
  assert.notEqual(forged.notes, 'VIP catering');
  assert.ok(forged.warnings.includes('missing_date'));
  assert.ok(forged.warnings.includes('missing_time'));
  assert.notEqual(forged.confidence, 'high');

  const exactSource = '  Event Area: Event Center\nStarts at 6pm  ';
  const preserved = await parse(exactSource, { start_time: '18:00:00', warnings: [] });
  assert.equal(preserved.raw_text, exactSource, 'caller source bytes remain available for preview and save');
  assert.equal(preserved.start_time, '18:00:00');

  const conflictingCount = await parse('Event Area: Event Center | Guests: 42', {
    event_name: 'Synthetic Gala', attendee_count: '43', event_date: '2026-11-09',
    start_time: '10:00:00', end_time: '11:00:00', confidence: 'high', warnings: [],
  });
  assert.equal(conflictingCount.attendee_count, '42', 'source count wins over provider');
  assert.equal(conflictingCount.event_date, '');
  assert.equal(conflictingCount.start_time, '');

  const forgedVenue = await parse('Event Name: Gala | Event Date: Nov 9 2026', {
    event_name: 'Gala', location_group_id: groups[0].location_group_id,
    location_group_name: 'Event Center', display_location: 'Event Center',
    event_scope: 'SINGLE_VENUE', primary_venue_id: venues[0].venue_id,
    venue_ids: [venues[0].venue_id], event_date: '2026-11-09',
    start_time: '10:00:00', end_time: '11:00:00', warnings: [],
  });
  assert.equal(forgedVenue.event_date, '2026-11-09', 'source date remains available');
  assert.equal(forgedVenue.primary_venue_id, '', 'provider cannot add absent venue');
  assert.ok(forgedVenue.needs_review, 'unknown venue needs review');
  assert.equal(forgedVenue.start_time, '');

  const labeledStart = await parse('Event Area: Event Center | Starts at 6pm', {
    start_time: '18:00:00', warnings: [], confidence: 'high',
  });
  assert.equal(labeledStart.start_time, '18:00:00', 'AI may interpret a source labeled time the local range parser missed');
  assert.equal(labeledStart.end_time, '', 'one supported endpoint does not invent the other');
  assert.ok(labeledStart.warnings.includes('missing_time'), 'partial time remains unresolved');
  assert.equal(labeledStart.provider_used, 'local-parser+gemini-fill');

  const unlabeledStart = await parse('Event Area: Event Center | Doors at 6pm', {
    start_time: '18:00:00', warnings: [], confidence: 'high',
  });
  assert.equal(unlabeledStart.start_time, '', 'doors time is not silently promoted to event start');

  console.log('events AI provenance: source grounded name, venue, date, time, count and notes PASS');
} finally {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.EVENTS_GEMINI_API_KEY;
  else process.env.EVENTS_GEMINI_API_KEY = originalKey;
}
