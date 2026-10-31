import assert from 'node:assert/strict';
import {buildEmployeeEventReminderBody} from '../src/employee-notifications.js';
import {nativeAlertPreview} from '../src/native-alert-text.js';
import {eventFixture} from './fixtures/native-event-dispatch-fixture.mjs';
import {qualifiedAlertDispatcher} from './fixtures/qualified-alert-dispatcher.mjs';
import {createHash} from 'node:crypto';

const base = {event_name:'Zoo event', display_location:'P'.repeat(181), event_date:'2026-11-01',
  start_time:'8:00 AM CST', end_time:'10:00 AM CST', attendee_count:120,
  custodial_note_codes:['trash_boxes'], custodial_public_notes:'Keep the entrance clear.'};
let checks = 0;
for (const place of ['P'.repeat(181), 'P'.repeat(240), 'é'.repeat(240)]) {
  const body = buildEmployeeEventReminderBody({...base, display_location:place}, 'Karen');
  assert.ok(body.includes(nativeAlertPreview(place,240)), 'deterministic current-source location preview must reach exact-source check'); checks++;
  for (const detail of ['Karen','Zoo event','2026-11-01','8:00 AM CST','10:00 AM CST','120']) {
    assert.ok(body.includes(detail), detail); checks++;
  }
  assert.ok(Buffer.byteLength(body) <= 1000); checks++;
}
const notes = buildEmployeeEventReminderBody({...base, custodial_public_notes:'😀'.repeat(250)}, 'Karen');
assert.ok(Buffer.byteLength(notes) <= 1000); checks++;
assert.ok(notes.includes(base.display_location)); checks++;
assert.ok(!notes.includes('\uFFFD')); checks++;
const boundaryNotes = buildEmployeeEventReminderBody({...base, custodial_public_notes:'A'.repeat(499)+'😀'}, 'Karen');
assert.ok(Buffer.byteLength(boundaryNotes) <= 1000); checks++;
assert.ok(!boundaryNotes.includes('\uFFFD')); checks++;
const fullSource={...base,event_name:'漢'.repeat(180),display_location:'漢'.repeat(240),custodial_public_notes:'😀'.repeat(250)};
const original=structuredClone(fullSource),employee='😀'.repeat(160);
const bounded=buildEmployeeEventReminderBody(fullSource,employee);
for (const [value,budget] of [[employee,120],[fullSource.event_name,180],[fullSource.display_location,240]]) {
  assert.ok(bounded.includes(nativeAlertPreview(value,budget))); checks++;
  assert.ok(nativeAlertPreview(value,budget).endsWith('…')); checks++;
}
assert.ok(Buffer.byteLength(bounded)<=1000); checks++;
assert.deepEqual(fullSource,original); checks++;
for (const value of [base.event_date,base.start_time,base.end_time,'120']) {assert.ok(bounded.includes(value));checks++;}
const f=eventFixture();
Object.assign(f.prepared.source_projection,{employee_name:employee,...fullSource,
  event_date:'2026-10-04',start_time:'10:30',end_time:'11:30'});
f.prepared.source_revision=createHash('sha256').update(JSON.stringify(f.prepared.source_projection)).digest('hex');
const projectionBefore=structuredClone(f.prepared.source_projection);
const dispatcher=await qualifiedAlertDispatcher(f),sent=await dispatcher.deliverClaimedJob(f.job);
assert.equal(sent.native_event,true);checks++;
assert.equal(f.requests.length,1);checks++;
const payload=f.requests[0].body.message.data;
assert.ok(Buffer.byteLength(payload.body)<=1000);checks++;
assert.match(payload.body,/…/);checks++;
assert.equal(payload.source_revision,f.prepared.source_revision);checks++;
assert.equal(payload.route,`events.html?hub=employee&event_id=${projectionBefore.event_id}`);checks++;
assert.deepEqual(f.prepared.source_projection,projectionBefore);checks++;
assert.doesNotMatch(payload.body,/PRIVATE CATERING/);checks++;
console.log(JSON.stringify({passed:checks,scope:'source-bound ellipsized preview, all required fact categories; full source retained for Events'}));
