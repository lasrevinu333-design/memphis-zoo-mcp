import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { readFileSync, existsSync } from 'node:fs';
import { employeeVisibleEvents, sharedEventFeed, makeSharedManagerEventsHandler, retiredEventIntake } from '../src/shared-events-feed.js';
import { createEventsEmployeeRouter, listSharedEvents, normalizeEventPayload, createEventMaintenanceController } from '../src/events-api.js';
import { projectOperationsEvents } from '../src/operations-board.js';
const E='11111111-1111-4111-8111-111111111111', M='22222222-2222-4222-8222-222222222222', C='33333333-3333-4333-8333-333333333333';
const row=(delta={})=>({id:'44444444-4444-4444-8444-444444444444',revision:3,event_name:'Zoo evening',event_scope:'SINGLE_VENUE',
 status:'SCHEDULED',needs_review:false,place_admissible:true,audience_scope:'all_working_employees',audience_employee_ids:[],
 display_location:'Teton',event_date:'2026-10-06',end_date:'2026-10-06',start_time:'17:00:00',end_time:'20:00:00',
 start_instant_utc:'2026-10-06T22:00:00Z',end_instant_utc:'2026-10-07T01:00:00Z',attendee_count:0,
 custodial_public_notes:'Place two trash boxes.',custodial_note_codes:['trash_boxes'],source_text:'PRIVATE MAIL',notes:'PRIVATE NOTES',...delta});
const now=new Date('2026-10-06T03:00:00Z');
for(const scope of ['all_working_employees','assigned_location'])test(`general visibility: ${scope}`,()=>assert.equal(employeeVisibleEvents([row({audience_scope:scope})],E).length,1));
test('specific employee is isolated',()=>{const r=row({audience_scope:'specific_employees',audience_employee_ids:[E]});assert.equal(employeeVisibleEvents([r],E).length,1);assert.equal(employeeVisibleEvents([r],M).length,0);});
for(const delta of [{needs_review:true},{event_scope:'UNKNOWN'},{place_admissible:false},{audience_scope:'unknown'},{status:'ARCHIVED'}])test(`fail-closed staff row ${JSON.stringify(delta)}`,()=>assert.equal(employeeVisibleEvents([row(delta)],E).length,0));
test('employee identity required',()=>assert.throws(()=>employeeVisibleEvents([row()],null)));
test('all surfaces have identical safe projection and revision',()=>{const rows=[row()], manager=sharedEventFeed(rows,{now}),employee=sharedEventFeed(rows,{now,employeeId:E});assert.deepEqual(manager.rows,employee.rows);assert.deepEqual(manager.rows,projectOperationsEvents(rows));assert.equal(manager.rows[0].revision,3);assert.equal(manager.rows[0].attendees,0);assert.doesNotMatch(JSON.stringify(manager),/PRIVATE|audience_employee_ids|created_by/);assert.equal(manager.mailbox_completeness_verified,false);});
for(const status of ['CANCELLED','SUPERSEDED'])test(`lifecycle retained: ${status}`,()=>assert.equal(sharedEventFeed([row({status})],{now,employeeId:E}).rows[0].status,status));
test('unknown attendance is not zero',()=>assert.equal(sharedEventFeed([row({attendee_count:null})],{now}).rows[0].attendees,null));
test('duplicate event identities fail',()=>assert.throws(()=>sharedEventFeed([row(),row()],{now})));
test('missing revision fails',()=>assert.throws(()=>sharedEventFeed([row({revision:null})],{now})));
test('oversized feed fails',()=>assert.throws(()=>sharedEventFeed(Array.from({length:501},()=>row()),{now})));
test('canonical reader retains source and audience checks',async()=>{let sql='';await listSharedEvents(async value=>{sql=value;return[];});assert.match(sql,/events_app_events/);assert.match(sql,/audience_scope/);assert.match(sql,/place_admissible/);assert.match(sql,/limit 501/);});
test('shared validators and event reminder producer are retained',()=>{assert.equal(typeof normalizeEventPayload,'function');assert.equal(typeof createEventMaintenanceController,'function');});
test('console parser and router are absent from runtime',()=>{assert.equal(existsSync(new URL('../src/events-ai-parser.js',import.meta.url)),false);const api=readFileSync(new URL('../src/events-api.js',import.meta.url),'utf8');assert.doesNotMatch(api,/createEventsAdminRouter|parse-ai|aiParseEventTexts|Event Input Console/);const index=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');assert.match(index,/app\.use\("\/admin-api\/events", retiredEventIntake\)/);assert.match(index,/readEvents: \(\) => listSharedEvents\(runReadOnlySql\)/);});

await test('actual loopback HTTP boundaries and compatibility',async t=>{
 const app=express();app.use(express.json());let reads=0;
 const read=async()=>{reads++;return[row()];};
 app.use('/admin-api/events',retiredEventIntake);
 app.use((req,res,next)=>{if(req.get('x-test-manager')==='valid')req.memphisAuth={role:'ops_manager',manager_id:M,credential_id:C};next();});
 app.get('/dashboard-api/events-feed',makeSharedManagerEventsHandler({readEvents:read,now:()=>now}));
 app.use('/employee-events-api',createEventsEmployeeRouter({runReadOnlySql:read,appVersion:'test',releaseId:'test',
   requireDeviceAccess(req,res,next){if(req.get('x-test-device')!=='valid')return res.status(401).json({ok:false});req.memphisDevice={canonical_device_id:'KIOSK_08',assigned_employee_id:E,assignment_epoch:1};req.memphisDeviceCredential={credential_id:C};next();}}));
 const server=await new Promise(resolve=>{const instance=app.listen(0,'127.0.0.1',()=>resolve(instance));});
 const url=`http://127.0.0.1:${server.address().port}`;
 try{
  for(const method of ['GET','POST','PUT','PATCH','DELETE'])await t.test(`retired console ${method}`,async()=>{const before=reads;const response=await fetch(url+'/admin-api/events/parse-ai',{method});assert.equal(response.status,410);assert.equal((await response.json()).code,'EVENT_INPUT_RETIRED');assert.equal(reads,before);});
  await t.test('anonymous denied without reads',async()=>{const before=reads;assert.equal((await fetch(url+'/dashboard-api/events-feed')).status,403);assert.equal((await fetch(url+'/employee-events-api')).status,401);assert.equal(reads,before);});
  await t.test('manager and device feed parity',async()=>{const manager=await fetch(url+'/dashboard-api/events-feed',{headers:{'x-test-manager':'valid'}});const employee=await fetch(url+'/employee-events-api',{headers:{'x-test-device':'valid'}});assert.equal(manager.status,200);assert.equal(employee.status,200);assert.equal(employee.headers.get('cache-control'),'private, no-store');const a=await manager.json(),b=await employee.json();assert.deepEqual(a.feed.rows,b.feed.rows);assert.equal(b.data[0].notes,'Place two trash boxes.');assert.equal(b.data[0].revision,3);assert.equal(b.meta.employee_id,E);assert.equal(b.meta.credential_id,C);assert.equal(a.meta.manager_id,M);});
 }finally{server.closeAllConnections?.();await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
});

test("reader rejects partial or malformed source",async()=>{await assert.rejects(()=>listSharedEvents(async()=>null));await assert.rejects(()=>listSharedEvents(async()=>Array(501).fill(row())));});

test('only a recent complete collector checkpoint marks source current',()=>{const status={schema:'custodial.outlook-event-sync.v1',writer_ready:true,mailbox:'eoperle@memphiszoo.org',cursor:now.toISOString()};assert.equal(sharedEventFeed([row()],{now,syncStatus:status}).state,'current');for(const patch of [{cursor:null},{cursor:'2026-01-01T00:00:00Z'},{cursor:'2099-01-01T00:00:00Z'},{mailbox:'wrong@example.com'},{writer_ready:false}])assert.equal(sharedEventFeed([row()],{now,syncStatus:{...status,...patch}}).state,'snapshot');});
