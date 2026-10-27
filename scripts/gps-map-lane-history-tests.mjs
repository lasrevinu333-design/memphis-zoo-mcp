import assert from 'node:assert/strict';
import {readGpsMapHistory,HISTORY_SQL,MAX_EVENTS_PER_OPEN_WORK} from '../src/gps-map-history.js';

assert.match(HISTORY_SQL,/public\.custodial_open_work\(\)/);
assert.match(HISTORY_SQL,/public\.scan_events/);
assert.match(HISTORY_SQL,/where status = 'active' and ended_at is null/);
assert.match(HISTORY_SQL,/native_offline_context/);
assert.match(HISTORY_SQL,/se\.session_id is null/);
assert.match(HISTORY_SQL,/work\.employee_id/);
assert.match(HISTORY_SQL,/limit 1201/);
assert.doesNotMatch(HISTORY_SQL,/\b(insert|update|delete|grant|alter)\b/i);

const id=n=>`12000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const work={open_work_id:id(1),source_kind:'native_offline_context',work_context_id:id(1),
  work_session_id:null,work_session_uuid:'session-one',client_session_id:'session-one',
  employee_id:id(2),work_device_id:id(3),work_location_id:id(4),location_code:'SYNTHETIC',
  device_identifier:'SYNTHETIC_DEVICE',work_status:'active',started_at:new Date('2026-10-09T12:00:00Z'),ended_at:null};
const row=(event_id,observed_at,overrides={})=>({...work,event_id,event_session_id:null,
  event_device_id:id(3),event_location_id:id(4),event_device_identifier:'SYNTHETIC_DEVICE',
  event_location_code:'SYNTHETIC',event_result:'location_uncalibrated',association_count:1,
  received_at:'2026-10-09T12:01:00Z',payload_json:{observed_at,session_uuid:'session-one',
    client_session_id:'session-one',client_latitude:0.001,client_longitude:0.002,accuracy_m:5},...overrides});
const calls=[],now=()=>Date.parse('2026-10-09T12:02:00Z');
const result=await readGpsMapHistory({assertNamedManager:async()=>(calls.push('auth'),true),
  runReadOnlySql:async sql=>(calls.push('read'),assert.equal(sql,HISTORY_SQL),[
    row(id(5),'2026-10-09T12:00:10Z'),row(id(6),'2026-10-09T12:00:40Z'),{...work,event_id:null}]),now});
assert.deepEqual(calls,['auth','read']);
assert.equal(result.length,1);
assert.equal(result[0].session.employeeId,id(2));
assert.equal(result[0].session.startedAt,'2026-10-09T12:00:00.000Z');
assert.deepEqual(result[0].observations.map(item=>item.id),[id(5),id(6)]);
assert.equal(result[0].observations[0].payload_json.client_latitude,0.001);
assert.equal(result[0].truncated,false);
assert.equal(result[0].incomplete,false);
assert.equal(MAX_EVENTS_PER_OPEN_WORK,1200);
await assert.rejects(readGpsMapHistory({assertNamedManager:async()=>false,
  runReadOnlySql:async()=>{throw Error('must not read');},now}),/authorization result/);
const changed=await readGpsMapHistory({assertNamedManager:async()=>true,
  runReadOnlySql:async()=>[row(id(5),'2026-10-09T12:00:10Z'),
    row(id(6),'2026-10-09T12:00:20Z',{employee_id:id(99)}),row(id(7),'2026-10-09T12:00:30Z')],now});
assert.equal(changed[0].incomplete,true);
assert.deepEqual(changed[0].observations,[]);
console.log('PASS changed history contract: guard, original native identity, measured payload and conflict withholding; SOURCE_MODEL_NOT_SQL');
