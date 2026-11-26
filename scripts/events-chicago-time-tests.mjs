import assert from 'node:assert/strict';
import {parseManualEventTexts} from '../src/manual-events-parser.js';
import { chicagoLocalTimeOptions, resolveChicagoEventInterval } from '../src/events-time.js';

assert.deepEqual(chicagoLocalTimeOptions('2026-03-08','02:30:00'), [],
  'spring-forward gap must not be coerced to another wall time');
const fold = chicagoLocalTimeOptions('2026-11-01','01:30:00');
assert.equal(fold.length, 2);
assert.deepEqual(fold.map((row) => row.instant_utc),
  ['2026-11-01T06:30:00.000Z','2026-11-01T07:30:00.000Z']);
assert.deepEqual(fold.map((row) => row.utc_offset_minutes), [-300,-360]);
assert.throws(() => resolveChicagoEventInterval({ event_date:'2026-03-08',end_date:'2026-03-08',
  start_time:'02:30:00',end_time:'03:30:00' }), { code:'NONEXISTENT_EVENT_TIME' });
assert.throws(() => resolveChicagoEventInterval({ event_date:'2026-11-01',end_date:'2026-11-01',
  start_time:'01:30:00',end_time:'01:45:00' }), { code:'AMBIGUOUS_EVENT_TIME' });
const chosen = resolveChicagoEventInterval({ event_date:'2026-11-01',end_date:'2026-11-01',
  start_time:'01:30:00',end_time:'01:45:00',
  start_instant_utc:'2026-11-01T06:30:00.000Z',end_instant_utc:'2026-11-01T07:45:00.000Z' });
assert.equal(chosen.start.utc_offset_minutes,-300);
assert.equal(chosen.end.utc_offset_minutes,-360);
assert.throws(() => resolveChicagoEventInterval({ event_date:'2026-11-01',end_date:'2026-11-01',
  start_time:'01:30:00',end_time:'01:45:00',
  start_instant_utc:'2026-11-01T07:30:00.000Z',end_instant_utc:'2026-11-01T06:45:00.000Z' }),
  { code:'INVALID_EVENT_INTERVAL' });
assert.throws(() => resolveChicagoEventInterval({ event_date:'2026-07-17',end_date:'2026-07-17',
  start_time:'18:00:00',end_time:'20:30:00',start_instant_utc:'2026-07-17T18:00:00.000Z' }),
  { code:'INVALID_EVENT_INSTANT' });
assert.equal(resolveChicagoEventInterval({ event_date:'2026-07-17',end_date:'2026-07-17',
  start_time:'18:00:00',end_time:'20:30:00' }).start.instant_utc,'2026-07-17T23:00:00.000Z');
console.log('Chicago event gap/fold/instant tests passed');

const parseEvent=(input,now)=>parseManualEventTexts({
  texts:[`Event Name: Synthetic review
Event Date: ${input}
Start Time: 2:00 PM
End Time: 3:00 PM`],
  now:new Date(now),
})[0];
for(const timezone of ['UTC','America/Chicago','Pacific/Auckland']){
 const prior=process.env.TZ;
 try{
  process.env.TZ=timezone;
  const sameDay=parseEvent('December 23','2026-12-23T20:30:00Z');
  assert.equal(sameDay.event_date,'2026-12-23');
  assert.ok(sameDay.warnings.includes('ambiguous_date'));
  assert.equal(sameDay.field_confidence.date,'medium');
  const friday=parseEvent('Friday','2026-11-27T03:30:00Z');
  assert.equal(friday.event_date,'2026-11-27');
  assert.ok(friday.warnings.includes('ambiguous_date'));
  const explicit=parseEvent('2026-12-23','2026-12-23T20:30:00Z');
  assert.equal(explicit.event_date,'2026-12-23');
  assert.equal(explicit.warnings.includes('ambiguous_date'),false);
 }finally{
  if(prior===undefined)delete process.env.TZ;
  else process.env.TZ=prior;
 }
}
