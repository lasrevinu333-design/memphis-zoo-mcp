import assert from 'node:assert/strict';
import {createStaticWeeklyControlPlane} from '../src/static-weekly-control-plane.js';
import {coverAllCanonicalBinding,scopeCanonicalCoverAllDocument} from '../src/static-weekly-coverall-access.js';
const id=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`,manifest='fe02bbdebc736d95360b55cc7dfe5b73c5a9eaa76f364f1c0f4420a0afb9950f',
 manager={manager_id:id(1),manager_display_name:'Synthetic period manager',credential_id:id(2),device_id:'synthetic-only',auth_mode:'trusted_device',access_level:'full_access',read_only:false,permissions:{schema:'custodial.manager-permissions.v1',owner:true,read:true,manage_coverall:true,regenerate_routes:true}},
 source={publication_id:id(3),version_id:id(4),authority_revision:7,effective_start:'2026-10-30',compiler_input:{version:{manualGroupRatingAuthority:{manifestSha256:manifest}},slots:[{id:id(6),label:'CoverAll01',kind:'CONTRACTOR_CAPACITY',capacityId:id(6),contractorCapacity:true,incumbencies:[]}]}},
 snapshot={week_start:'2026-10-30',week_end:'2026-11-05',authority_revision:7,current_publication:{publication_id:id(3),version_id:id(4)},projection_status:'missing',roster:[],
  exceptions:[{type:'cover_all',serviceDate:'2026-11-02',payload:{availability:{slotId:id(6),shift:{start:'07:00',end:'15:00'}}}}],
  latest_projection:{projection_id:id(5),publication_id:id(3),version_id:id(4),week_start:'2026-10-30',week_end:'2026-11-05',replay_digest:'a'.repeat(64),assignments:[]}},
 lunch={persistence_status:'PERSISTED',projection_id:id(5),document_identity:'b'.repeat(64),service_date:'2026-11-02',loans:[],responsibilities:[]};
const calls=[],client={async query(sql,args=[]){calls.push({sql,args});let result;
 if(sql.includes('static_weekly_v3_read_manager_snapshot'))result=structuredClone(snapshot);
 else if(sql.includes('static_weekly_v3_read_publication_source'))result=structuredClone(source);
 else if(sql.includes('static_weekly_v8_read_lunch_document'))result=structuredClone(lunch);
 else if(sql.includes('custodial_action_actor_v1'))result={manager_id:manager.manager_id,manager_name:manager.manager_display_name};
 else if(sql.includes('static_weekly_issue_coverall_link'))result={link_id:args[4],expires_at:'2026-11-03T12:00:00Z'};
 else if(sql.includes('static_weekly_v21_reconcile_dependency_changes'))result={authorityRevision:snapshot.authority_revision,processedChangeCount:0,invalidations:[],blockedPublications:[],affectedPhonesUpdated:false};
 else if(sql.includes('pg_backend_pid()'))return {rows:[{pid:100,xid:'1'}]};
 else if(sql.includes('static_weekly_begin_manual_recurring'))result={state:'ORIGINAL_RECEIPT',operationId:args[0].operationId,
  receipt:{authorityRevision:7,projectionId:id(5),lunchDocumentIdentity:lunch.document_identity}};
 return {rows:result?[{result}]:[]};},release(){},on(){},removeListener(){}};
const plane=createStaticWeeklyControlPlane({database:{async connect(){return client;}},initializeSolver:async()=>{},getSolverReadiness:()=>({available:true})}),cases=[];
async function test(name,fn){try{await fn();cases.push({name,status:'PASS'});}catch(e){cases.push({name,status:'FAIL',error:e.message});}}
try{
 for(const status of ['missing','stale'])await test('F03 '+status+' source identity without fabricated current work',async()=>{
  snapshot.projection_status=status;const before=calls.length,value=await plane.getManagerSnapshot({manager,weekStart:'2026-11-02'});
  assert.equal(value.approved_manual_period?.frameStart,'2026-10-30');assert.equal(value.projection_status,status);assert.equal(value.approved_manual_schedule,undefined);
  assert.equal(calls.slice(before).some(c=>c.sql.includes('read_lunch_document')),false);
 });
 await test('F03 source revision race refuses mixed snapshot metadata',async()=>{
  source.authority_revision=8;try{await assert.rejects(()=>plane.getManagerSnapshot({manager,weekStart:'2026-11-02'}),e=>e.code==='static_manual_period_source_changed');}finally{source.authority_revision=7;}
 });
 snapshot.projection_status='current';
 await test('F09 actual control-plane produces Friday-period CoverAll document',async()=>{
  const doc=await plane.getCoverAllPrintDocument({manager,weekStart:'2026-10-30',serviceDate:'2026-11-02',expectedRevision:7,projectionId:id(5)});
  assert.equal(doc.publicationId,id(3));assert.equal(doc.contractors[0].name,'CoverAll01');assert.equal(doc.serviceDate,'2026-11-02');
  const binding=coverAllCanonicalBinding(doc,id(6),'2026-10-30');assert.equal(binding.week_start,'2026-10-30');
  assert.equal(scopeCanonicalCoverAllDocument(doc,binding).contractors.length,1);
  assert.throws(()=>coverAllCanonicalBinding(doc,id(6),'2026-11-03'));
 });
 await test('F09 actual link issuance sends accepted Friday period to canonical SQL gate',async()=>{
  await plane.issueCoverAllAssignmentLink({manager,weekStart:'2026-10-30',serviceDate:'2026-11-02',expectedRevision:7,projectionId:id(5),capacityId:id(6),requestId:id(20),ttlHours:24});
  assert.equal(calls.find(c=>c.sql.includes('static_weekly_issue_coverall_link')).args[6].week_start,'2026-10-30');
 });
 for(const [week,date,revision,projection]of [['2026-11-02','2026-11-02',7,id(5)],['2026-10-30','2026-11-06',7,id(5)],['2026-10-30','2026-11-02',8,id(5)],['2026-10-30','2026-11-02',7,id(9)]])
  await test('F09 rejects changed period/date/revision/projection '+[week,date,revision,projection].join('/'),()=>assert.rejects(()=>plane.getCoverAllPrintDocument({manager,weekStart:week,serviceDate:date,expectedRevision:revision,projectionId:projection}),e=>e.code!=='static_weekly_named_manager_required'));
 await test('F03 exact original recurring retry performs actual readback',async()=>{
  const result=await plane.rebuildCurrentProjection({manager,weekStart:'2026-10-30',expectedRevision:7,idempotencyKey:'synthetic-original-materialize'});
  assert.equal(result.replayed,true);assert.equal(result.data.current_readback_repeated,true);assert.equal(result.data.current_projection.projection_id,id(5));
 });
 await test('F03 changed current revision preserves original outcome without current claim',async()=>{
  snapshot.authority_revision=8;
  const result=await plane.rebuildCurrentProjection({manager,weekStart:'2026-10-30',expectedRevision:7,idempotencyKey:'synthetic-original-materialize'});
  assert.equal(result.replayed,true);assert.equal(result.data.current_readback_repeated,false);assert.equal(result.data.current_projection,undefined);
 });
}finally{await plane.close();}
console.log(JSON.stringify({scope:'actual control-plane methods and presentation with synthetic SQL responses; no database publication proof',cases},null,2));
if(cases.some(c=>c.status==='FAIL'))process.exitCode=1;
