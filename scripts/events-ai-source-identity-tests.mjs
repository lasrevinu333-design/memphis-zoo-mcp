import assert from 'node:assert/strict';
import { aiParseEventTexts } from '../src/events-ai-parser.js';

// Execute the real parser/normalizer with an in-process synthetic provider.
// No network, database, source-evidence claim, or independent review result.
const previousFetch = globalThis.fetch;
const previousKey = process.env.EVENTS_GEMINI_API_KEY;
process.env.EVENTS_GEMINI_API_KEY = 'synthetic-event-identity-key';
const groups = [{ location_group_id: '00000000-0000-4000-8000-000000000001', group_code: 'EC', group_name: 'Event Center', included_locations: ['Event Center', 'EC'], eligible_event_venue: true, eligible_custodial_coverage: true }];
const venues = [{ venue_id: '10000000-0000-4000-8000-000000000001', venue_code: 'EVENT_CENTER', display_name: 'Event Center', event_scope: 'SINGLE_VENUE', location_group_id: groups[0].location_group_id, eligible_event_venue: true, aliases: ['Event Center', 'EC'] }];
const candidate = { source_index: 0, event_name: 'Synthetic Gala', location_group_id: groups[0].location_group_id, location_group_name: 'Event Center', event_date: '2026-11-09', start_time: '10:00:00', end_time: '11:00:00', attendee_count: '42', confidence: 'high', warnings: [] };
let providerRows = [], calls = 0, checks = 0;
globalThis.fetch = async () => {
  calls += 1;
  return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ rows: providerRows }) }] } }] }) };
};
const equal = (actual, expected, message) => { checks += 1; assert.deepEqual(actual, expected, message); };
async function parse(rows, texts = ['Event Area: Event Center']) {
  providerRows = rows; calls = 0;
  const actual = await aiParseEventTexts({ texts, locationGroups: groups, eventVenues: venues });
  equal(calls, 1, 'One synthetic provider request');
  return actual;
}
try {
  for (const invalid of [null, false, true, '', '0', '1', [], {}, -1, 0.5, 999, undefined]) {
    const [row] = await parse([{ ...candidate, source_index: invalid }]);
    equal(row.source_index, 0, 'Caller source identity retained');
    equal(row.provider_used, 'local-parser', `Reject malformed/unsolicited source_index ${JSON.stringify(invalid)}`);
    equal(row.provider_fallback, true, 'Invalid provider identity is reported as fallback');
    equal(row.event_date, '', 'No invalid provider fields merged');
    equal(row.gemini_candidate, undefined, 'No invalid candidate retained as accepted');
  }
  for (const rows of [[], [candidate, candidate], [candidate, { ...candidate, event_date: '2027-02-14' }], [candidate, { ...candidate, source_index: 99 }]]) {
    const [row] = await parse(rows);
    equal(row.provider_used, 'local-parser', 'Empty, duplicated or unsolicited response is rejected as a unit');
    equal(row.provider_fallback, true, 'Fallback remains truthful');
    equal(row.event_date, '', 'No last-writer-wins fields');
  }
  const completeText = 'Baby Day EC 5/9/2026 9a-6p 500 guests';
  const sourceTexts = [completeText, 'Event Area: Event Center'];
  const onlyUncertain = await parse([{ ...candidate, source_index: 1 }], sourceTexts);
  equal(onlyUncertain[0].source_index, 0, 'Unrequested complete local row stays original');
  equal(onlyUncertain[0].provider_used, 'local-parser', 'No provider merge into skipped local row');
  equal(onlyUncertain[1].source_index, 1, 'Exact requested identity accepted');
  equal(onlyUncertain[1].gemini_candidate?.source_index, 1, 'Candidate binds to exact requested identity');
  const mixed = await parse([candidate, { ...candidate, source_index: 1 }], sourceTexts);
  equal(mixed[0].provider_fallback, false, 'Complete skipped local row is not falsely called provider fallback');
  equal(mixed[1].provider_fallback, true, 'An unsolicited complete-row ID invalidates the provider response');
  equal(mixed[1].event_date, '', 'Unsolicited mixed response cannot fill another row');
  const sparse = await parse([{ ...candidate, source_index: 1 }], ['', 'Event Area: Event Center']);
  equal(sparse.length, 1, 'Empty input keeps original index rather than reindexing');
  equal(sparse[0].source_index, 1, 'Sparse source identity retained');
  equal(sparse[0].gemini_candidate?.source_index, 1, 'Sparse requested identity accepted');
  const reordered = await parse([{ ...candidate, source_index: 1 }, candidate], ['Event Area: Event Center', 'Area: EC']);
  equal(reordered.map(row => row.source_index), [0, 1], 'Provider ordering cannot reorder caller rows');
  equal(reordered.map(row => row.gemini_candidate?.source_index), [0, 1], 'Each reordered candidate binds by exact identity');
  console.log(`events AI source identity: ${checks} checks PASS (actual parser, synthetic provider; source-evidence validation remains separate)`);
} finally {
  globalThis.fetch = previousFetch;
  if (previousKey === undefined) delete process.env.EVENTS_GEMINI_API_KEY;
  else process.env.EVENTS_GEMINI_API_KEY = previousKey;
}
