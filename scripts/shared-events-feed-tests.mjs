import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { readFileSync, existsSync } from 'node:fs';
import { employeeVisibleEvents, sharedEventFeed, makeSharedManagerEventsHandler, retiredEventIntake } from '../src/shared-events-feed.js';
import { createEventsPublicRouter, createEventsEmployeeRouter, listSharedEvents, normalizeEventPayload, createEventMaintenanceController } from '../src/events-api.js';
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
 const sessionExpiry=new Date(Date.now()+60000).toISOString();
 const requireOpsManagerAuth=(req,res,next)=>{if(req.get('x-test-manager')!=='valid')return res.status(403).json({ok:false});req.memphisAuth={role:'ops_manager',manager_id:M,credential_id:C,device_id:'synthetic-manager-device',token:'synthetic-session',expires_at:sessionExpiry};next();};
 app.get('/dashboard-api/events-feed',makeSharedManagerEventsHandler({readEvents:read,requireOpsManagerAuth,now:()=>now}));
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

for(const boundary of ['sync manager changed','events revoked','events session changed','events failed revoked','sync unavailable','stable'])test(`current manager source boundary: ${boundary}`,async()=>{
 let current={role:'ops_manager',manager_id:M,credential_id:C,device_id:'synthetic-manager-device',token:'synthetic-session',auth_mode:'trusted_device',expires_at:new Date(Date.now()+60000).toISOString()},allowed=true,reads=0,auths=0;
 const req={memphisAuth:{...current}},res={headersSent:false,writableEnded:false,setHeader(){},status(value){this.code=value;return this;},json(value){this.body=value;this.headersSent=true;return this;}};
 const requireOpsManagerAuth=async(req,res,next)=>{auths++;if(!allowed)return res.status(403).json({ok:false});req.memphisAuth={...current};next();};
 const handler=makeSharedManagerEventsHandler({requireOpsManagerAuth,now:()=>now,
   readSyncStatus:async()=>{reads++;if(boundary==='sync manager changed')current={...current,manager_id:E};if(boundary==='sync unavailable')throw Error('private source failure');return null;},
   readEvents:async()=>{reads++;if(boundary==='events revoked'||boundary==='events failed revoked')allowed=false;if(boundary==='events failed revoked')throw Error('private source failure');if(boundary==='events session changed')current={...current,token:'synthetic-new-session'};return[row()];}});
 await handler(req,res);
 if(['stable','sync unavailable'].includes(boundary)){assert.equal(res.code,200);assert.equal(res.body.feed.rows.length,1);assert.equal(res.body.feed.state,'snapshot');assert.equal(auths,3);assert.deepEqual(res.body.meta,{manager_id:M,credential_id:C});assert.doesNotMatch(JSON.stringify(res.body),/synthetic-session|synthetic-manager-device|private source failure/);}
 else{assert.equal(res.code,403);assert.equal(res.body.ok,false);assert.equal(Object.hasOwn(res.body,'feed'),false);assert.equal(reads,boundary==='sync manager changed'?1:2);}
});


await test('legacy public compatibility excludes private and unresolved audiences without changing enrolled feeds', async t => {
 const id = value => `55555555-5555-4555-8555-${String(value).padStart(12,'0')}`;
 const general = row({id:id(1),event_name:'General operations'});
 const assigned = row({id:id(2),event_name:'Assigned location operations',audience_scope:'assigned_location'});
 const privateE = row({id:id(3),event_name:'PRIVATE ADDRESSED E',audience_scope:'specific_employees',audience_employee_ids:[E]});
 const privateM = row({id:id(4),event_name:'PRIVATE ADDRESSED M',audience_scope:'specific_employees',audience_employee_ids:[M]});
 const unresolved = [row({id:id(5),audience_scope:'unknown'}),row({id:id(6),audience_scope:null}),row({id:id(7),audience_scope:undefined})];
 const rows=[general,assigned,privateE,privateM,...unresolved];let publicSql='';
 const app=express();
 app.use('/dashboard-api/events',createEventsPublicRouter({runReadOnlySql:async sql=>{publicSql=sql;return rows;},buildHealthPayload:()=>({ok:true}),appVersion:'test',releaseId:'test'}));
 const expires_at=new Date(Date.now()+60000).toISOString();
 const managerAuth=(req,res,next)=>{if(req.get('x-test-manager')!=='valid')return res.status(403).json({ok:false});req.memphisAuth={role:'ops_manager',manager_id:M,credential_id:C,device_id:'synthetic-manager-device',token:'synthetic-session',expires_at};next();};
 app.get('/dashboard-api/events-feed',makeSharedManagerEventsHandler({readEvents:async()=>rows,requireOpsManagerAuth:managerAuth,now:()=>now}));
 app.use('/employee-events-api',createEventsEmployeeRouter({runReadOnlySql:async()=>rows,appVersion:'test',releaseId:'test',requireDeviceAccess(req,res,next){
  const employee=req.get('x-test-device');if(![E,M].includes(employee))return res.status(401).json({ok:false});
  req.memphisDevice={canonical_device_id:'KIOSK_08',assigned_employee_id:employee,assignment_epoch:1};req.memphisDeviceCredential={credential_id:C};next();
 }}));
 const server=await new Promise(resolve=>{const instance=app.listen(0,'127.0.0.1',()=>resolve(instance));});const url=`http://127.0.0.1:${server.address().port}`;
 try {
  for(const headers of [{},{'x-test-device':E,'x-test-manager':'valid','authorization':'Bearer synthetic-untrusted','cookie':'synthetic=untrusted'}])await t.test('public response admits only explicit general audiences regardless of claimed principal',async()=>{
   const response=await fetch(url+'/dashboard-api/events',{headers});assert.equal(response.status,200);const body=await response.json();
   assert.deepEqual(body.data.map(value=>value.id),[general.id,assigned.id]);assert.equal(body.data[0].attendee_count,0);assert.equal(body.data[0].status,'SCHEDULED');
   assert.doesNotMatch(JSON.stringify(body),/PRIVATE|audience_employee_ids|audience_scope|custodial_public_notes|source_text/);
   assert.match(publicSql,/e\.audience_scope in \('assigned_location','all_working_employees'\)/);
   assert.match(publicSql,/coalesce\(e\.status, 'SCHEDULED'\) = 'SCHEDULED'/);assert.match(publicSql,/e\.event_scope <> 'UNKNOWN'/);
   assert.match(publicSql,/place\.authority->>'admissible'/);assert.match(publicSql,/coalesce\(e\.end_date, e\.event_date\) >=/);
  });
  await t.test('normal manager retains addressed source projection',async()=>{
   const response=await fetch(url+'/dashboard-api/events-feed',{headers:{'x-test-manager':'valid'}});assert.equal(response.status,200);const body=await response.json();
   assert.ok(body.feed.rows.some(value=>value.id===privateE.id));assert.ok(body.feed.rows.some(value=>value.id===privateM.id));
   assert.doesNotMatch(JSON.stringify(body),/audience_employee_ids|source_text|PRIVATE MAIL|PRIVATE NOTES/);
  });
  for(const [employee,own,other]of [[E,privateE,privateM],[M,privateM,privateE]])await t.test('normal enrolled employee sees own addressed event and never another employee event',async()=>{
   const response=await fetch(url+'/employee-events-api',{headers:{'x-test-device':employee}});assert.equal(response.status,200);const body=await response.json();
   assert.deepEqual(new Set(body.feed.rows.map(value=>value.id)),new Set([general.id,assigned.id,own.id]));assert.ok(!body.data.some(value=>value.id===other.id));
   assert.equal(response.headers.get('cache-control'),'private, no-store');assert.doesNotMatch(JSON.stringify(body),/audience_employee_ids|source_text|PRIVATE MAIL|PRIVATE NOTES/);
  });
 } finally { server.closeAllConnections?.();await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve())); }
});


await test('viewer public route excludes addressed and unresolved audiences with no credential dependence', async () => {
 const {installLeadershipHttpRoutes}=await import('../src/leadership-bootstrap.js');
 const fields=['id','event_name','event_date','end_date','start_time','end_time','display_location','event_scope','status'];
 const base={event_date:'2099-01-01',end_date:'2099-01-01',start_time:'12:00',end_time:'13:00',display_location:'Public fixture place',event_scope:'PLACE',status:'SCHEDULED'};
 const data=['assigned_location','all_working_employees','specific_employees','unknown',null,undefined].map((scope,index)=>({...base,id:`viewer-${index}`,event_name:index<2?'General fixture event':'PRIVATE ADDRESSED FIXTURE',audience_scope:scope,audience_employee_ids:['private-recipient-fixture'],notes:'PRIVATE INTERNAL FIELD'}));
 const calls=[];
 const db={from(table){assert.equal(table,'events_app_events');const q={};for(const method of ['select','eq','in','gte','lte','order'])q[method]=(...args)=>{calls.push([method,...args]);return q;};q.limit=async value=>{calls.push(['limit',value]);return{data,error:null};};return q;}};
 const app=express();installLeadershipHttpRoutes(app,{env:{},supabase:db});
 const server=await new Promise(resolve=>{const instance=app.listen(0,'127.0.0.1',()=>resolve(instance));});
 try{
  const url=`http://127.0.0.1:${server.address().port}/viewer-api/events?days=999`;
  for(const headers of [{},{authorization:'Bearer synthetic-untrusted',cookie:'synthetic=untrusted'}]){
   const response=await fetch(url,{headers});assert.equal(response.status,200);const body=await response.json();
   assert.deepEqual(body.data.events.map(event=>event.id),['viewer-0','viewer-1']);
   for(const event of body.data.events)assert.deepEqual(Object.keys(event).sort(),[...fields].sort());
   assert.doesNotMatch(JSON.stringify(body),/PRIVATE|audience_scope|audience_employee_ids|private-recipient/);
   assert.match(response.headers.get('cache-control'),/^public,/);
  }
  assert.ok(calls.some(([method,key,value])=>method==='in'&&key==='audience_scope'&&JSON.stringify(value)===JSON.stringify(['assigned_location','all_working_employees'])));
  assert.ok(calls.some(([method,value])=>method==='select'&&value.split(',').includes('audience_scope')));
  assert.ok(calls.some(([method,key,value])=>method==='eq'&&key==='status'&&value==='SCHEDULED'));
  assert.ok(calls.some(([method,value])=>method==='limit'&&value===250));
 }finally{server.closeAllConnections?.();await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
});
