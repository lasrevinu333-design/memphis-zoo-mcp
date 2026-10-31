import assert from 'node:assert/strict';
import {outlookSyncSchema,OUTLOOK_SYNC_CONTRACT} from '../src/outlook-event-sync.js';
const id='12000000-0000-4000-8000-000000000001';
const source={mailbox:'eoperle@memphiszoo.org',message_id:'synthetic-off-campus-source',content_sha256:'a'.repeat(64),
  evidence_kind:'original_event_notice',source_at:'2026-10-31T10:00:00Z',received_at:'2026-10-31T10:01:00Z'};
const event={event_name:'Synthetic outside event',event_scope:'OFFSITE',display_location:'Known outside venue',
  event_date:'2026-11-01',end_date:'2026-11-01',start_time:'10:00:00',end_time:'11:00:00',
  start_instant_utc:'2026-11-01T16:00:00Z',end_instant_utc:'2026-11-01T17:00:00Z'};
const input=e=>({contract_version:OUTLOOK_SYNC_CONTRACT,request:{action:'apply',observation:{source,source_event_key:'synthetic-off-campus',event:e}}});
let checks=0;
for (const extra of [{},{location_group_id:null},{location_group_id:id,coverage_location_ids:[]}]) {
  const original=input({...event,...extra}),parsed=outlookSyncSchema.parse(original);
  assert.deepEqual(parsed,original,'source observation is not rewritten');checks++;
  assert.equal(parsed.request.observation.event.display_location,'Known outside venue');checks++;
}
assert.equal(outlookSyncSchema.safeParse(input({...event,coverage_location_ids:[id]})).success,false);checks++;
for (const scope of ['SINGLE_VENUE','MULTI_VENUE','ZOO_WIDE']) {
  const original=input({...event,event_scope:scope,location_group_id:id,primary_venue_id:id,venue_ids:[id],coverage_location_ids:[id]});
  assert.deepEqual(outlookSyncSchema.parse(original),original,'onsite valid grouping unchanged');checks++;
}
console.log(JSON.stringify({passed:checks,scope:'typed import schema only; actual SQL OFFSITE mapping requires root-owned database run'}));
