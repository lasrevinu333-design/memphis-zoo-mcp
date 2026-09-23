import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertOwnerRecurringWorkdays } from '../src/static-weekly-owner-workdays.js';
import { createStaticWeeklyControlPlane } from '../src/static-weekly-control-plane.js';
import { compileStaticWeeklySchedule, postgresJsonbContentDigest } from '../src/static-weekly-schedule-compiler.js';
import { prepareStaticWeeklyRegistrationArtifact } from './static-weekly-schedule-candidate-importer.mjs';
const rule=JSON.parse(readFileSync('config/custodial-owner-workdays.json','utf8')).rules[0];
let passed=0;const failures=[];
async function test(name,fn){try{await fn();passed++;}catch(error){failures.push({name,error:error.message});}}
const date='2026-09-28';
function input(days=[1,2,3,5,6]) {return {
 serviceDate:date,exceptions:[],proximity:[],
 slots:[{id:rule.slotId,label:'Karen existing position',incumbencies:[{
 personId:rule.employeeId,displayName:'Karen Robinson',effectiveStart:'2020-01-01',effectiveEnd:null}]}],
 version:{id:'60000000-0000-4000-8000-000000000001',publicationId:'70000000-0000-4000-8000-000000000001',
 status:'published',effectiveStart:date,slotAvailability:days.map(dayOfWeek=>({slotId:rule.slotId,
 dayOfWeek,status:'working',shift:{start:'05:00',end:'14:00'},lunch:{start:'09:30',end:'10:30'}})),assignments:[]}
};}
await test('correct five days accepted without mutation',()=>{const i=input(),before=JSON.stringify(i);assert.equal(assertOwnerRecurringWorkdays(i),true);assert.equal(JSON.stringify(i),before);});
await test('old Tuesday-Saturday rejected',()=>assert.throws(()=>assertOwnerRecurringWorkdays(input([2,3,4,5,6])),/Sunday and Thursday are off/));
await test('Sunday work rejected',()=>assert.throws(()=>assertOwnerRecurringWorkdays(input([0,1,2,3,5,6])),/Sunday and Thursday/));
await test('missing Monday rejected',()=>assert.throws(()=>assertOwnerRecurringWorkdays(input([2,3,5,6])),/Sunday and Thursday/));
await test('duplicate availability rejected',()=>assert.throws(()=>assertOwnerRecurringWorkdays(input([1,1,2,3,5,6])),/Sunday and Thursday/));
await test('historical schedule preserved',()=>{const i=input([2,3,4,5,6]);i.serviceDate='2026-09-14';assert.equal(assertOwnerRecurringWorkdays(i),true);});
await test('dated PTO not rewritten',()=>{const i=input();i.exceptions=[{type:'absence',serviceDate:'2026-09-28',payload:{slotId:rule.slotId}}];const before=JSON.stringify(i);assert.equal(assertOwnerRecurringWorkdays(i),true);assert.equal(JSON.stringify(i),before);});
await test('ended identity is not revived',()=>{const i=input([2,3,4,5,6]);i.slots[0].incumbencies[0].effectiveEnd='2026-09-21';assert.equal(assertOwnerRecurringWorkdays(i),true);});
await test('wrong stable identity rejected',()=>{const i=input();i.slots[0].id='20000000-0000-4000-8000-000000000002';assert.throws(()=>assertOwnerRecurringWorkdays(i),/stable identity/);});
await test('undated current identity rejected',()=>{const i=input();delete i.serviceDate;assert.throws(()=>assertOwnerRecurringWorkdays(i),/Dated source/);});
function controlPlane(days) {
 const calls=[];let prepared=0;
 const source={source_id:'50000000-0000-4000-8000-000000000001',compiler_input:input(days),exceptions:[]};
 const client={async query(statement,values){calls.push(statement);
  if(statement.includes('static_weekly_v3_read_authority_source')||statement.includes('static_weekly_v3_read_publication_source'))return {rows:[{result:source}]};
  if(statement.includes('static_weekly_v3_publish_draft'))return {rows:[{result:{revision:1,data:{publication_id:'70000000-0000-4000-8000-000000000001',effective_start:date}}}]};
  return {rows:[]};},release(){}};
 const plane=createStaticWeeklyControlPlane({database:{async connect(){return client;}},
  compiler:async()=>{throw Error('not used');},compilerPreparer:async()=>{prepared++;throw Error('COMPILER_REACHED');},
  initializeSolver:async()=>({package:'test'}),getSolverReadiness:()=>({available:true})});
 return {plane,calls,prepared:()=>prepared};
}
const manager={manager_id:'10000000-0000-4000-8000-000000000001',manager_display_name:'Synthetic Manager',
 auth_mode:'trusted_device',trusted_device:true,read_only:false};
const request={manager,sourceId:'50000000-0000-4000-8000-000000000001',effectiveStart:date,expectedRevision:0,idempotencyKey:'owner-workdays-test'};
await test('actual initial draft refuses old weekdays before compiler',async()=>{const t=controlPlane([2,3,4,5,6]);
 await assert.rejects(t.plane.createInitialDraft(request),error=>error.code==='static_weekly_owner_workdays_mismatch');
 assert.equal(t.prepared(),0);assert.ok(t.calls.includes('rollback'));assert.ok(!t.calls.some(s=>s.includes('static_weekly_v3_create_draft')));});
await test('actual corrected draft reaches normal compiler',async()=>{const t=controlPlane([1,2,3,5,6]);
 await assert.rejects(t.plane.createInitialDraft(request),/COMPILER_REACHED/);assert.equal(t.prepared(),1);});
await test('read-only manager cannot write corrected weekdays',async()=>{const t=controlPlane([1,2,3,5,6]);
 await assert.rejects(t.plane.createInitialDraft({...request,manager:{...manager,read_only:true}}),/trusted.*named manager/i);
 assert.equal(t.prepared(),0);assert.equal(t.calls.length,0);});
await test('actual publication rolls back outdated Karen weekdays',async()=>{const t=controlPlane([2,3,4,5,6]);
 await assert.rejects(t.plane.publishDraft({manager,draftVersionId:'60000000-0000-4000-8000-000000000001',
 expectedDraftRevision:1,expectedRevision:0,idempotencyKey:'publish-owner-workdays',projectionWeekStart:date}),error=>error.code==='static_weekly_owner_workdays_mismatch');
 assert.equal(t.prepared(),0);assert.ok(t.calls.includes('rollback'));assert.ok(!t.calls.includes('commit'));
 assert.ok(!t.calls.some(s=>s.includes('static_weekly_v3_materialize_projection')));});
await test('other people remain unaffected',()=>{const i=input([2,3,4,5,6]);i.slots[0].incumbencies[0].personId='30000000-0000-4000-8000-000000000099';assert.equal(assertOwnerRecurringWorkdays(i),true);});
await test('plural canonical input accepted',()=>{const i=input();i.versions=[i.version];delete i.version;assert.equal(assertOwnerRecurringWorkdays(i),true);});
await test('explicit off days accepted',()=>{const i=input();i.version.slotAvailability.push({slotId:rule.slotId,dayOfWeek:0,status:'off'},{slotId:rule.slotId,dayOfWeek:4,status:'off'});assert.equal(assertOwnerRecurringWorkdays(i),true);});
await test('source registration refuses obsolete Karen weekdays',async()=>{
 const i=input([2,3,4,5,6]);const packet={packetSchema:'memphis-zoo.static-weekly.verified-schedule-packet.v1',
 publicationAuthority:'VERIFIED_SERVER_PACKET',effectiveDate:date,sourceId:'50000000-0000-4000-8000-000000000001',
 compilerInput:i,rosterSlots:[{slotId:rule.slotId,personId:rule.employeeId,displayName:'Karen Robinson',availabilityState:'working'}],
 directedProximity:[],acceptedRoutes:[],serviceEffort:[],capacity:[],sourceDigest:postgresJsonbContentDigest(i),
 verifiedAt:date,verifiedBy:'SYNTHETIC TEST ONLY',evidence:[{kind:'synthetic',sha256:'a'.repeat(64)}]};
 const result=await prepareStaticWeeklyRegistrationArtifact(packet);
 assert.equal(result.admissibleForRegistration,false);assert.ok(result.errors.includes('static_weekly_owner_workdays_mismatch'));
});
await test('canonical compiler preserves all five corrected working days',async()=>{
 const i=input();i.timezone='America/Chicago';
 i.version.objective={requireVerifiedProximity:true};
 for(const row of i.version.slotAvailability)Object.assign(row,{productiveCapacityProvenance:'synthetic shift',
 maxServiceEffortMinutes:300,maxServiceEffortProvenance:'synthetic capacity',qualifications:['general'],
 qualificationProvenance:'synthetic',restrictions:[],restrictionProvenance:'synthetic',acceptedRouteAnchorLocationId:'synthetic-location',acceptedRouteProvenance:'synthetic same place'});
 i.version.assignments=rule.workDays.map(dayOfWeek=>({workId:'synthetic-'+dayOfWeek,dayOfWeek,
 locationId:'synthetic-location',ownerSlotId:rule.slotId,window:{start:'06:00',end:'06:30'},serviceEffortMinutes:20,
 serviceEffortProvenance:'synthetic',priority:1,priorityProvenance:'synthetic',requiredQualifications:['general'],
 qualificationProvenance:'synthetic',restrictions:[],restrictionProvenance:'synthetic'}));
 i.versions=[i.version];delete i.version;assertOwnerRecurringWorkdays(i);
 const compiled=await compileStaticWeeklySchedule(i);assert.equal(compiled.status,'FEASIBLE');assert.equal(compiled.verifier.ok,true);
 assert.deepEqual([...new Set(compiled.weeklyAssignments.map(row=>row.dayOfWeek))].sort((a,b)=>a-b),rule.workDays);
});
console.log(JSON.stringify({passed,failed:failures.length,failures,source_tests:true,production_written:false},null,2));
if(failures.length)process.exitCode=1;
