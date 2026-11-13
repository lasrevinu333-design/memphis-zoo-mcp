// Current typed Outlook adapter -> synthetic saved row -> actual shared manager
// and employee HTTP readers. No real mail, SQL, signature, provider or browser.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,openSync,writeFileSync,closeSync,realpathSync,statSync,constants} from 'node:fs';
import {dirname,isAbsolute,resolve} from 'node:path';
import express from 'express';
import {createEventsEmployeeRouter,listSharedEvents} from '../src/events-api.js';
import {makeSharedManagerEventsHandler,retiredEventIntake} from '../src/shared-events-feed.js';
import {callOutlookEventSync,OUTLOOK_SYNC_CONTRACT} from '../src/outlook-event-sync.js';
const fixturePath=process.argv[2]==='--fixture-output'&&process.argv.length===4?process.argv[3]:'';
if(process.argv.length>2&&(!fixturePath||!isAbsolute(fixturePath)))throw Error('Optional --fixture-output requires a new absolute caller-owned file path.');
if(fixturePath){const parent=dirname(fixturePath);assert.equal(realpathSync(parent),parent);assert.ok(statSync(parent).isDirectory());}
const EVENT_ID='81000000-0000-4000-8000-000000000003',OPERATION_ID='81000000-0000-4000-8000-000000000004',
 VENUE_ID='81000000-0000-4000-8000-000000000005',GROUP_ID='81000000-0000-4000-8000-000000000006',
 MANAGER_ID='81000000-0000-4000-8000-000000000007',EMPLOYEE_ID='81000000-0000-4000-8000-000000000008',
 CREDENTIAL_ID='81000000-0000-4000-8000-000000000009',LEDGER_ID='81000000-0000-4000-8000-000000000010';
const COUNT=237,GATE_COUNT=1409,EVENT_DATE='2099-09-14',PRIVATE_NOTE='PRIVATE MANAGER SOURCE NOTE MUST NOT REACH EITHER FEED';
const sourceObservation={source:{mailbox:'eoperle@memphiszoo.org',message_id:'SYNTHETIC-ATT003-NOT-REAL-MAIL',content_sha256:'a'.repeat(64),
 evidence_kind:'original_event_notice',source_at:'2026-10-03T12:00:00Z',received_at:'2026-10-03T12:01:00Z'},
 source_event_key:'synthetic-att003-current-source',event:{event_name:'Attendance Authority Fixture',event_scope:'SINGLE_VENUE',
 primary_venue_id:VENUE_ID,venue_ids:[VENUE_ID],location_group_id:GROUP_ID,display_location:'Event Center',
 event_date:EVENT_DATE,end_date:EVENT_DATE,start_time:'10:00:00',end_time:'11:00:00',
 start_instant_utc:'2099-09-14T15:00:00Z',end_instant_utc:'2099-09-14T16:00:00Z',attendee_count:COUNT,
 custodial_public_notes:'Bring trash boxes.',custodial_note_codes:['trash_boxes'],coverage_location_ids:[GROUP_ID]}};
const args={contract_version:OUTLOOK_SYNC_CONTRACT,request:{action:'apply',observation:sourceObservation}};
const auth={authInfo:{clientId:'synthetic-att003-connected-agent',expiresAt:Math.floor(Date.now()/1000)+600,
 scopes:['mcp:read','mcp:write'],extra:{authSource:'self_contained_oauth',issuer:'synthetic-att003',subject:'synthetic-observer'}}};
let saved=null,ledger=null;const writes=[],sqlReads=[];
const rpcClient={rpc(name,input){
 assert.equal(name,'custodial_outlook_event_sync_v1');assert.equal(input.p_action,'apply');assert.equal(saved,null);
 assert.deepEqual(input.p_observation,sourceObservation);assert.equal(input.p_observation.event.attendee_count,COUNT);
 writes.push({name,observation:structuredClone(input.p_observation)});
 // Explicit synthetic database response/state only; SQL owns actual creation,
 // review/admission and writer authority and is not executed by this fixture.
 saved={...input.p_observation.event,id:EVENT_ID,revision:1,event_title:input.p_observation.event.event_name,
  status:'SCHEDULED',needs_review:false,notes:PRIVATE_NOTE,venue_name:'Event Center',group_name:'Event Center',
  event_timezone:'America/Chicago',place_admissible:true,audience_scope:'all_working_employees',audience_employee_ids:[],
  created_at:'2026-10-03T12:00:00Z',updated_at:'2026-10-03T12:00:00Z'};
 ledger={id:LEDGER_ID,event_id:EVENT_ID,outlook_message_id:sourceObservation.source.message_id,
  source_event_key:'custodial-outlook-events-v1/event/'+sourceObservation.source_event_key,payload_hash:'b'.repeat(64),
  sync_status:'APPLIED',source_payload:structuredClone(input.p_observation)};
 return{abortSignal(signal){assert.ok(signal instanceof AbortSignal);return this;},retry(value){assert.equal(value,false);return Promise.resolve({data:{schema:'custodial.outlook-event-sync.v1',state:'APPLIED',event_id:EVENT_ID,ledger_id:LEDGER_ID,source_sha256:ledger.payload_hash},error:null});}};
},from(table){assert.equal(table,'events_app_outlook_sync');const filters=[];return{
 select(columns){assert.equal(columns,'id,event_id,outlook_message_id,source_event_key,payload_hash,sync_status,source_payload');return this;},
 eq(key,value){filters.push([key,value]);return this;},abortSignal(signal){assert.ok(signal instanceof AbortSignal);return this;},retry(value){assert.equal(value,false);return this;},
 async single(){assert.deepEqual(filters,[['outlook_message_id',sourceObservation.source.message_id],['source_event_key',ledger.source_event_key]]);return{data:ledger,error:null};}};
}};
await assert.rejects(()=>callOutlookEventSync(args,{}, {client:rpcClient}),/outlook_sync_principal_required/);assert.equal(writes.length,0);
const bad=structuredClone(args);bad.request.observation.event.attendee_count=String(COUNT);
await assert.rejects(()=>callOutlookEventSync(bad,auth,{client:rpcClient}));assert.equal(writes.length,0);
const accepted=await callOutlookEventSync(args,auth,{client:rpcClient});assert.equal(accepted.readback_verified,true);assert.equal(accepted.state,'APPLIED');assert.equal(accepted.event_id,EVENT_ID);assert.equal(writes.length,1);assert.equal(saved.attendee_count,COUNT);
const runReadOnlySql=async sql=>{const query=String(sql);sqlReads.push(query);assert.match(query,/from public\.events_app_events e/i);return saved?[{...saved}]:[];};
const app=express();app.use(express.json());const expiresAt=new Date(Date.now()+600000).toISOString();
const managerAuth=(req,res,next)=>{
 if(req.get('x-test-manager-session')!=='named-manager')return res.status(401).json({ok:false,error:'named manager required'});
 req.memphisAuth={role:'ops_manager',manager_id:MANAGER_ID,manager_display_name:'Synthetic named manager',
  credential_id:CREDENTIAL_ID,device_id:'ATT003-MANAGER-FIXTURE',token:'SYNTHETIC-TEST-CONTEXT-NOT-A-REAL-SIGNATURE',expires_at:expiresAt,
  auth_mode:'trusted_device',read_only:false};next();};
app.use('/admin-api/events',retiredEventIntake);
app.get('/dashboard-api/events-feed',managerAuth,makeSharedManagerEventsHandler({readEvents:()=>listSharedEvents(runReadOnlySql),requireOpsManagerAuth:managerAuth}));
app.use('/employee-events-api',createEventsEmployeeRouter({runReadOnlySql,appVersion:'att003-current-source',releaseId:'synthetic',requireDeviceAccess:(req,res,next)=>{
 if(req.get('x-test-device-credential')!=='enrolled-current-employee')return res.status(401).json({ok:false,error:'enrolled device required'});
 req.memphisDevice={canonical_device_id:'KIOSK_08',assigned_employee_id:EMPLOYEE_ID,assignment_epoch:7};
 req.memphisDeviceCredential={credential_id:CREDENTIAL_ID};next();}}));
const server=await new Promise(ok=>{const listener=app.listen(0,'127.0.0.1',()=>ok(listener));});let managerReply,employeeReply;
try{
 const base=`http://127.0.0.1:${server.address().port}`;
 const retired=await fetch(base+'/admin-api/events/',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({attendee_count:GATE_COUNT})});
 assert.equal(retired.status,410);assert.equal((await retired.json()).code,'EVENT_INPUT_RETIRED');assert.equal(writes.length,1);
 assert.equal((await fetch(base+'/dashboard-api/events-feed')).status,401);
 const m=await fetch(base+'/dashboard-api/events-feed',{headers:{'x-test-manager-session':'named-manager'}});assert.equal(m.status,200);managerReply=await m.json();
 assert.equal(managerReply.feed.rows.length,1);const mr=managerReply.feed.rows[0];assert.equal(mr.id,EVENT_ID);assert.equal(mr.revision,1);assert.equal(mr.attendees,COUNT);assert.equal(mr.custodial_notes,'Bring trash boxes.');
 assert.equal('notes'in mr,false);assert.equal(JSON.stringify(managerReply).includes(PRIVATE_NOTE),false);assert.equal(m.headers.get('cache-control'),'private, no-store');
 assert.equal((await fetch(base+'/employee-events-api?window_days=30')).status,401);
 const e=await fetch(base+'/employee-events-api?window_days=30',{headers:{'x-test-device-credential':'enrolled-current-employee'}});assert.equal(e.status,200);employeeReply=await e.json();
 assert.equal(employeeReply.data.length,1);const er=employeeReply.data[0];assert.equal(er.id,EVENT_ID);assert.equal(er.attendee_count,COUNT);assert.equal(er.notes,'Bring trash boxes.');
 assert.equal(er.revision,1,'current employee contract carries the exact accepted revision');assert.equal('created_by'in er,false);assert.equal(JSON.stringify(employeeReply).includes(PRIVATE_NOTE),false);
 assert.equal(employeeReply.meta.employee_id,EMPLOYEE_ID);assert.equal(employeeReply.meta.assignment_epoch,7);assert.equal(e.headers.get('cache-control'),'private, no-store');
 assert.equal(employeeReply.feed.rows[0].attendees,COUNT);assert.equal(sqlReads.length,2);assert.ok(sqlReads.every(sql=>/place\.authority->>'admissible'/i.test(sql)));
 assert.notEqual(COUNT,GATE_COUNT);
 // Current employee visibility rejects an unreviewed or inadmissible row;
 // a count never makes a held Event accepted or individually addressed.
 saved.needs_review=true;const held=await(await fetch(base+'/employee-events-api',{headers:{'x-test-device-credential':'enrolled-current-employee'}})).json();assert.deepEqual(held.data,[]);assert.deepEqual(held.feed.rows,[]);saved.needs_review=false;
 saved.audience_scope='specific_employees';saved.audience_employee_ids=[MANAGER_ID];const foreign=await(await fetch(base+'/employee-events-api',{headers:{'x-test-device-credential':'enrolled-current-employee'}})).json();assert.deepEqual(foreign.data,[]);saved.audience_scope='all_working_employees';saved.audience_employee_ids=[];
}finally{await new Promise((ok,fail)=>server.close(error=>error?fail(error):ok()));}
const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const fixture={schema:'att003-event-count-synthetic-route-fixture.v2',provenance:{synthetic:true,actual_typed_outlook_adapter:true,actual_shared_manager_and_employee_routes:true,
 real_database:false,live_provider:false,real_mail_read:false,authorization:'explicit synthetic connected-agent and named-manager/enrolled-device contexts',
 saved_state:'synthetic RPC APPLIED state only; no real SQL review or publication proof',browser_transport:'not executed',
 backend_source_sha256:hash(resolve(import.meta.dirname,'../src/events-api.js')),producer_script_sha256:hash(new URL(import.meta.url))},
 identity:{event_id:EVENT_ID,event_revision:1,expected_guests:COUNT,separate_home_gate_entries:GATE_COUNT,employee_id:EMPLOYEE_ID,device_id:'KIOSK_08'},
 typed_write_readback:accepted,accepted_save:saved,manager_read:managerReply.feed.rows,manager_feed:managerReply.feed,employee_read:employeeReply.data,employee_meta:employeeReply.meta};
if(fixturePath){const fd=openSync(fixturePath,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);try{writeFileSync(fd,JSON.stringify(fixture,null,2)+'\n');}finally{closeSync(fd);}}
console.log(JSON.stringify({status:'ATT003_CURRENT_SYNTHETIC_ADAPTER_AND_FEEDS_PASS',event_id:EVENT_ID,revision:1,expected_guests:COUNT,separate_gate_entries:GATE_COUNT,writes:writes.length,
 loopback_closed:!server.listening,manual_intake_retired:true,fixture_path:fixturePath||null,fixture_sha256:fixturePath?hash(fixturePath):null,database:false,browser:false,real_mail:false,production:false}));
