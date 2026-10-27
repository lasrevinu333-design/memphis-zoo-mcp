import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readGpsMapHistory,HISTORY_SQL,MAX_EVENTS_PER_OPEN_WORK} from '../src/gps-map-history.js';
const id=n=>`12000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const start='2026-10-09T12:00:00.000Z',now=()=>Date.parse('2026-10-09T12:03:00Z');
const authority={open_work_id:id(1),source_kind:'native_offline_context',work_session_id:null,
  work_context_id:id(1),work_session_uuid:'native-client-one',client_session_id:'native-client-one',
  employee_id:id(2),work_device_id:id(3),work_location_id:id(4),location_code:'SYNTHETIC',
  device_identifier:'SYNTHETIC_DEVICE',work_status:'active',started_at:start,ended_at:null};
const row=(n=5,change={})=>({...authority,event_id:id(n),event_session_id:null,
  event_device_id:id(3),event_location_id:id(4),event_device_identifier:'SYNTHETIC_DEVICE',
  event_location_code:'SYNTHETIC',event_result:'location_uncalibrated',association_count:1,
  received_at:'2026-10-09T12:02:00Z',payload_json:{session_uuid:'native-client-one',client_session_id:'native-client-one',
    observed_at:'2026-10-09T12:01:00Z',client_latitude:0.001,client_longitude:0.002,accuracy_m:5},...change});
const read=rows=>readGpsMapHistory({assertNamedManager:async()=>true,runReadOnlySql:async sql=>(assert.equal(sql,HISTORY_SQL),rows),now});
test('existing native context is read without inventing a sessions row or current assignee',async()=>{
  const work=(await read([row()]))[0];assert.equal(work.session.sessionId,null);assert.equal(work.session.contextId,id(1));
  assert.equal(work.session.employeeId,id(2));assert.equal(work.observations[0].employee_id,id(2));
  assert.equal(work.observations[0].payload_json.client_latitude,0.001);assert.equal(work.incomplete,false);
});
test('named-manager guard refuses before SQL',async()=>{
  let called=false;await assert.rejects(readGpsMapHistory({assertNamedManager:async()=>false,
    runReadOnlySql:async()=>{called=true;return[];},now}),/authorization/);assert.equal(called,false);
});
test('native event needs both original external identities',async()=>{
  for(const p of [{session_uuid:'foreign',client_session_id:'native-client-one'},
    {session_uuid:'native-client-one'}, {client_session_id:'native-client-one'}]){
    const work=(await read([row(5,{payload_json:{...p,observed_at:start}})]))[0];
    assert.equal(work.incomplete,true);assert.deepEqual(work.observations,[]);
  }
});
test('canonical UUID and identifier mismatch cannot be projected as original worker',async()=>{
  for(const change of [{event_device_id:id(99)},{event_location_id:id(99)},
    {event_device_identifier:'FOREIGN'},{event_location_code:'FOREIGN'},{event_session_id:id(99)}]){
    const work=(await read([row(5,change)]))[0];assert.equal(work.incomplete,true);assert.deepEqual(work.observations,[]);
  }
});
test('competing or duplicate event identity withholds the whole path',async()=>{
  for(const rows of [[row(5,{association_count:2})],[row(),row()]]){
    const work=(await read(rows))[0];assert.equal(work.incomplete,true);assert.deepEqual(work.observations,[]);
  }
});
test('changed original actor in one SQL snapshot is not merged',async()=>{
  const work=(await read([row(),row(6,{employee_id:id(99)})]))[0];
  assert.equal(work.incomplete,true);assert.equal(work.incompleteReason,'authority_identity_conflict');assert.deepEqual(work.observations,[]);
});
test('unknown capture remains a redacted marker, never receipt time',async()=>{
  const r=row();delete r.payload_json.observed_at;const sample=(await read([r]))[0].observations[0];
  assert.equal(sample.payload_json.observed_at,undefined);assert.equal(sample.payload_json.client_latitude,undefined);
  assert.equal(sample.received_at,r.received_at);assert.equal(sample.quality,'withheld_capture_or_quality');
});
test('off-work and future capture coordinates are not returned',async()=>{
  for(const observed of ['2026-10-09T11:59:59Z','2026-10-09T12:04:00Z','not-a-time']){
    const r=row();r.payload_json.observed_at=observed;const sample=(await read([r]))[0].observations[0];
    assert.equal(sample.payload_json.client_latitude,undefined);assert.equal(sample.payload_json.observed_at,observed);
  }
});
test('server rejected GPS quality is not drawn as a measured point',async()=>{
  for(const result of ['post_session','stale','future_clock','low_accuracy','implausible_jump','gps_duplicate_event','gps_unavailable','future_unknown_status',null]){
    const sample=(await read([row(5,{event_result:result})]))[0].observations[0];assert.equal(sample.payload_json.client_latitude,undefined);
  }
});
test('only known quality-checked measurement statuses preserve advisory coordinates',async()=>{
  for(const result of ['near','away','boundary_uncertain','location_uncalibrated','not_configured']){
    const sample=(await read([row(5,{event_result:result})]))[0].observations[0];
    assert.equal(sample.payload_json.client_latitude,0.001);
  }
});
test('exact cap is complete; one-extra marks actual truncation',async()=>{
  const rows=Array.from({length:MAX_EVENTS_PER_OPEN_WORK},(_,i)=>row(i+10));
  assert.equal((await read(rows))[0].truncated,false);
  const work=(await read([...rows,row(5000)]))[0];assert.equal(work.truncated,true);assert.equal(work.observations.length,MAX_EVENTS_PER_OPEN_WORK);
});
test('materialized session uses exact database identity with compatible old payload',async()=>{
  const r=row(5,{source_kind:'session',work_session_id:id(1),work_context_id:null,event_session_id:id(1)});
  r.payload_json={observed_at:'2026-10-09T12:01:00Z',client_latitude:0.001,client_longitude:0.002,accuracy_m:5};
  const work=(await read([r]))[0];assert.equal(work.incomplete,false);assert.equal(work.observations[0].payload_json.client_latitude,0.001);
});
test('closed, contradictory and fabricated authority shapes refuse',async()=>{
  for(const change of [{work_status:'pending_submit'},{ended_at:start},{work_context_id:id(99)},
    {work_session_id:'not-a-real-uuid'},{work_session_uuid:'different-client'}]){
    await assert.rejects(read([row(5,change)]),/authority identity/);
  }
});
test('bounded query is read-only and does not join current device assignee',()=>{
  assert.match(HISTORY_SQL,/native_offline_context/);assert.match(HISTORY_SQL,/association_count/);
  assert.match(HISTORY_SQL,/limit 1201/);assert.doesNotMatch(HISTORY_SQL,/\b(insert|update|delete|alter|grant)\b/i);
  assert.doesNotMatch(HISTORY_SQL,/assigned_employee|from public\.devices/i);
});
