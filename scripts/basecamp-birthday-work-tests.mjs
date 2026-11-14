import test from 'node:test';
import assert from 'node:assert/strict';
import {readBasecampBirthdayWork, BASECAMP_WORK_SCHEMA} from '../src/basecamp-birthday-work.js';

// Source/component fixtures only. No real access code, event, assignment,
// credential, phone, notification, or database connection is used.
const E='10000000-0000-4000-8000-000000000001',D='10000000-0000-4000-8000-000000000002';
const C='10000000-0000-4000-8000-000000000003',P='10000000-0000-4000-8000-000000000004';
const V='10000000-0000-4000-8000-000000000005',EVENT='10000000-0000-4000-8000-000000000006';
const privateMarker='TEST ONLY private access instructions';
function fixture() {
  const day={employee_id:E,service_date:'2026-11-14',projection_id:P,publication_id:V,projection_status:'current',shift:{start:'08:00',end:'17:00'}};
  const assignment={canonical_device_pk:D,assignment_epoch:7};
  const req={headers:{origin:'https://localhost','x-memphis-app-edition':'custodial'},
    memphisDevice:{assigned_employee_id:E,assignment_epoch:7},memphisDeviceCredential:{credential_id:C,device_id:D}};
  const work={schema:BASECAMP_WORK_SCHEMA,state:'current',employee_id:E,service_date:day.service_date,projection_id:P,publication_id:V,
    items:[{event_id:EVENT,event_revision:1,display_name:'Safari Basecamp',party_start:'2026-11-14T19:00:00Z',party_end:'2026-11-14T21:00:00Z',
      voice_notice_at:'2026-11-14T14:15:00Z',voice_notice_state:'planned',honor_based:true,nfc_required:false,cleaning_instruction:'Clean before and after the party.',
      raw_mail:'PRIVATE SOURCE MUST NOT ESCAPE',access_note:'UNTRUSTED SOURCE NOTE MUST NOT ESCAPE'}]};
  const state={calls:[],secretReads:0};
  const env={get CUSTODIAL_BASECAMP_ACCESS_NOTE(){state.secretReads++;return privateMarker;}};
  const input={req,day,assignment,env,runReadOnlySql:async sql=>{state.calls.push(sql);return [{work}];}};
  return {input,req,day,assignment,work,state};
}
test('exact native owner obtains allowlisted honor work with the private runtime note',async()=>{
  const f=fixture(),value=await readBasecampBirthdayWork(f.input);
  assert.equal(value.state,'current');assert.equal(value.items.length,1);assert.equal(value.items[0].access_note,privateMarker);
  assert.equal(value.credential_id,C);assert.equal(value.assignment_epoch,7);assert.equal(value.items[0].nfc_required,false);
  assert.doesNotMatch(JSON.stringify(value),/PRIVATE SOURCE|UNTRUSTED SOURCE/);assert.equal(f.state.secretReads,1);
  assert.match(f.state.calls[0],/^select public\.custodial_basecamp_birthday_work\(/);
});
for(const [name,change]of [
  ['public browser',f=>f.req.headers.origin='https://lasrevinu333-design.github.io'],
  ['manager browser',f=>{delete f.req.memphisDeviceCredential;f.req.memphisAuth={manager_id:E};}],
  ['other edition',f=>f.req.headers['x-memphis-app-edition']='manager'],
  ['uncredentialed device',f=>delete f.req.memphisDeviceCredential],
  ['other employee',f=>f.req.memphisDevice.assigned_employee_id=D],
  ['other device',f=>f.req.memphisDeviceCredential.device_id=P],
  ['other epoch',f=>f.req.memphisDevice.assignment_epoch=8],
  ['unavailable projection',f=>f.day.projection_status='unavailable'],
  ['invalid date',f=>f.day.service_date='2026-02-30'],
])test(name+' never reads work or the private note',async()=>{
  const f=fixture();change(f);assert.equal(await readBasecampBirthdayWork(f.input),undefined);
  assert.equal(f.state.calls.length,0);assert.equal(f.state.secretReads,0);
});
for(const [name,change]of [
  ['different employee response',f=>f.work.employee_id=D],
  ['different projection response',f=>f.work.projection_id=D],
  ['different service date',f=>f.work.service_date='2026-11-15'],
  ['different party date',f=>f.work.items[0].party_start='2026-11-15T19:00:00Z'],
  ['unverified source state',f=>f.work.state='unavailable'],
  ['duplicate event',f=>f.work.items.push({...f.work.items[0]})],
  ['NFC completion request',f=>f.work.items[0].nfc_required=true],
  ['wrong venue',f=>f.work.items[0].display_name='Other'],
  ['bad revision',f=>f.work.items[0].event_revision=0],
])test(name+' withholds the note and reports unavailable supplemental work',async()=>{
  const f=fixture();change(f);const value=await readBasecampBirthdayWork(f.input);
  assert.equal(value.state,'unavailable');assert.deepEqual(value.items,[]);assert.equal(f.state.secretReads,0);
});
for(const [name,change]of [
  ['employee changed',f=>f.req.memphisDevice.assigned_employee_id=D],
  ['credential replaced',f=>f.req.memphisDeviceCredential={...f.req.memphisDeviceCredential}],
  ['epoch changed',f=>f.req.memphisDevice.assignment_epoch++],
  ['publication changed',f=>f.day.publication_id=D],
  ['edition changed',f=>f.req.headers['x-memphis-app-edition']='manager'],
])test('late '+name+' cannot publish private data',async()=>{
  const f=fixture();f.input.runReadOnlySql=async()=>{change(f);return [{work:f.work}];};
  assert.equal(await readBasecampBirthdayWork(f.input),undefined);assert.equal(f.state.secretReads,0);
});
test('a custodian without a party assignment never reads the access note',async()=>{
  const f=fixture();f.work.items=[];const value=await readBasecampBirthdayWork(f.input);
  assert.equal(value.state,'current');assert.deepEqual(value.items,[]);assert.equal(f.state.secretReads,0);
});
test('missing access input keeps the honor assignment and reports its unavailable note',async()=>{
  const f=fixture();f.input.env={};const value=await readBasecampBirthdayWork(f.input);
  assert.equal(value.state,'access_note_unavailable');assert.equal(value.items.length,1);assert.equal(value.items[0].access_note,null);
});
test('optional source failure reports unavailable without throwing or reading a note',async()=>{
  const f=fixture();f.input.runReadOnlySql=async()=>{throw Error('synthetic unavailable');};
  const value=await readBasecampBirthdayWork(f.input);assert.equal(value.state,'unavailable');assert.equal(f.state.secretReads,0);
});

test('withheld timing does not hide an admitted honor assignment or invent an instant',async()=>{
 const f=fixture();f.work.items[0].voice_notice_state='withheld';f.work.items[0].voice_notice_at=null;
 const value=await readBasecampBirthdayWork(f.input);assert.equal(value.state,'current');assert.equal(value.items.length,1);
 assert.equal(value.items[0].voice_notice_at,null);assert.equal(value.items[0].voice_notice_state,'withheld');assert.equal(value.items[0].access_note,privateMarker);
});
for(const [label,change]of [['off day',f=>f.day.shift=null],['unknown voice state',f=>f.work.items[0].voice_notice_state='sent'],['invented withheld instant',f=>f.work.items[0].voice_notice_state='withheld']])test(label+' does not disclose the note',async()=>{
 const f=fixture();change(f);const value=await readBasecampBirthdayWork(f.input);assert.equal(f.state.secretReads,0);assert.ok(value===undefined||value.state==='unavailable');
});
