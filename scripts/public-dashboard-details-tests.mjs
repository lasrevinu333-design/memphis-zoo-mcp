import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import {once} from 'node:events';
import {installLeadershipHttpRoutes} from '../src/leadership-bootstrap.js';
import {installPublicDashboardDetails,publicDashboardDetails,publicOperationsDetails,readPublicSchedule} from '../src/public-dashboard-details.js';
const secret='MUST_NOT_LEAVE_SERVER';
const now=new Date('2026-11-09T18:00:00Z');
const row={location_id:'98000000-0000-4000-8000-000000000001',location_name:'West Admin',latest_employee_name:'Karen Robinson',
  status_code:'okay',services_performed:['Full cleaning services'],latest_original_completion:{credential_id:secret},token:secret,notes:secret};
const summary={meta:{contracts:{dashboard:'dashboard.v1'},generated_at:now.toISOString(),token:secret},snapshot:{open_ticket_count:1,secret},
  restrooms:[row],exhibits:[],open_tickets:[{ticket_id:'T1',location_name:'West Admin',maintenance_issue:'Soap dispenser',reported_by:'Karen',credential:secret}]};
const events=[{id:'E1',event_name:'Field trip',audience_scope:'all_working_employees',notes:secret,credentials:secret},
  {id:'E2',event_name:secret,audience_scope:'individual_employees'},{id:'E3',event_name:secret}];
const mail={schools:{state:'snapshot',generated_at:now.toISOString(),coverage:'imported_only',mailbox_completeness_verified:false,
  rows:[{id:'S1',name:'School',students:15,arrival_at:now.toISOString(),source_payload:secret,notes:secret}]},
  spiceworks:{state:'snapshot',generated_at:now.toISOString(),coverage:'imported_only',mailbox_completeness_verified:false,
    rows:[{ticket_id:'SW1',assignee:'Karen',active:true,custodial:true,status:'Open',source_mail:secret}]}};
const current={service_date:'2026-11-09',projection_status:'current',publication_id:'P1',projection_id:'Q1',token:secret,
  roster:[{employee_name:'Karen',shift_start:'07:00',lunch_start:'11:00',notes:secret,credential:secret}],
  assignments:[{assigned_employee_name:'Karen',group_name:'West Admin',included_locations:['WAUW'],notes:secret}]};
test('explicit public display projections retain approved work details and exclude private/future fields',()=>{
  const out=publicDashboardDetails(summary),ops=publicOperationsDetails(events,mail,now);
  assert.equal(out.restrooms[0].latest_employee_name,'Karen Robinson');assert.deepEqual(out.restrooms[0].services_performed,['Full cleaning services']);
  assert.equal(out.open_tickets[0].reported_by,'Karen');assert.equal(out.meta.audience,'public_readonly');
  assert.equal(ops.events.length,1);assert.equal(ops.schools.rows[0].students,15);assert.equal(ops.spiceworks.rows[0].assignee,'Karen');
  assert.equal(JSON.stringify({out,ops}).includes(secret),false);
});
test('schedule reader binds one authoritative snapshot, validates dates, and refuses stale rows',async()=>{
  const queries=[];const read=async sql=>{queries.push(sql);return[{data:current}];};
  const result=await readPublicSchedule(read,'2026-11-09');assert.equal(result.roster[0].employee_name,'Karen');
  assert.equal(JSON.stringify(result).includes(secret),false);assert.equal(queries.length,1);
  assert.match(queries[0],/r\.publication_id=a\.publication_id and r\.projection_id=a\.projection_id/);
  for(const date of ["2026-11-09';delete from employees--",'2026-02-30','bad',['2026-11-09']])await assert.rejects(readPublicSchedule(read,date),/invalid_service_date/);
  assert.equal(queries.length,1);
  const stale=await readPublicSchedule(async()=>[{data:{...current,projection_status:'stale_staffing_change'}}],'2026-11-09');
  assert.deepEqual(stale,{service_date:'2026-11-09',projection_status:'unavailable',roster:[],assignments:[]});
});
test('actual anonymous HTTP reads require no cookie or token; writes and manager access remain denied',async()=>{
  const app=express();installLeadershipHttpRoutes(app,{env:{},supabase:{}});
  let reads=0;installPublicDashboardDetails(app,{readSummary:async()=>{reads++;return summary;},readEvents:async()=>events,readMail:async()=>mail,
    runReadOnlySql:async()=>[{data:current}],now:()=>now});
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');const origin='http://127.0.0.1:'+server.address().port;
  try{
    for(const path of ['summary','operations','schedule?service_date=2026-11-09']){
      const response=await fetch(origin+'/viewer-api/'+path);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
      const body=await response.json();assert.equal(body.ok,true);assert.equal(JSON.stringify(body).includes(secret),false);
      for(const method of ['POST','PUT','PATCH','DELETE'])assert.equal((await fetch(origin+'/viewer-api/'+path,{method})).status,405);
    }
    assert.equal(reads,1);assert.equal((await fetch(origin+'/leadership-api/roster')).status,401);
    assert.equal((await fetch(origin+'/viewer-api/schedule?service_date=invalid')).status,400);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
