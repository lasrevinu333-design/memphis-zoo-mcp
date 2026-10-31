import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {installStaticWeeklySha256HexAccelerator} from '../src/static-weekly-schedule-model.js';
import {postgresJsonbContentDigest as digest} from '../src/static-weekly-schedule-program.js';
import {createApprovedManualCoverAllManagement,parseApprovedManualCoverAllRequest,readApprovedManualCoverAllChoiceSummary} from '../src/approved-manual-coverall-management.js';
import {prepareApprovedManualCoverAllChoice} from '../src/approved-manual-coverall-workflow.js';
installStaticWeeklySha256HexAccelerator(x=>createHash('sha256').update(x).digest('hex'));
const fixture=JSON.parse(readFileSync(new URL('../release/worker1-coverall-workflow-20261030/TYPED_THIRD_ABSENCE_PURE_FIXTURE.json',import.meta.url),'utf8'));
const copy=structuredClone,uid=n=>`79100000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const manager={manager_id:uid(1),manager_display_name:'Synthetic manager',credential_id:uid(2),device_id:'synthetic-coverall-management',access_level:'full_access'};
const op=uid(3),choice=uid(4),sourceId=uid(5),projectionId=uid(6),publication=fixture.source.version.publicationId;
const substitute=fixture.thirdDay.overlay.substitute,lunchPlan=fixture.thirdDay.overlay.lunchPlans.find(l=>l.recipientSlotId===substitute.slotId);
const semantic={absenceKind:'pto',commandKind:'absence',employeeId:fixture.thirdDay.overlay.replacedPersonId,startDate:fixture.thirdDay.serviceDate,endDate:fixture.thirdDay.serviceDate,targetAbsenceId:null};
const original={operationId:op,preparerId:manager.manager_id,semanticBody:semantic,semanticDigest:digest(semantic),expectedRevision:42,currentServiceDate:'2026-10-30',originalCancellationTarget:null};
const base={schema:'custodial.approved-manual-coverall-manager-basis.v1',managerId:manager.manager_id,operationId:op,state:'PREPARING',eligible:true,authorityRevision:42,
 command:{operation_id:op,prepared_by_manager_id:manager.manager_id,state:'PREPARING',semantic_body:semantic,semantic_digest:original.semanticDigest,expected_revision:42},originalCommand:original,choice:null,
 normalSources:[{sourceId,publicationId:publication,source:fixture.source}],retainedDays:[{serviceDate:semantic.startDate,sourceId,publicationId:publication,projectionId,envelopeIdentity:'a'.repeat(64),dayBasis:fixture.retainedDay}]};
const request={choice_id:choice,days:[{service_date:semantic.startDate,capacity_id:substitute.slotId,shift:copy(substitute.shift),lunch:copy(substitute.lunch),lunch_coverer_slot_id:lunchPlan.covererSlotId,confirmation_reference:'Synthetic actual-hours confirmation; not a booking',actual_hours_confirmed:true}]};
const checks=[],test=async(name,fn)=>{await fn();checks.push(name);};
function harness({basis=copy(base),commitError=null,prepareError=null,mutateAtRead=null}={}){
 const log=[];let inTransaction=false,prepareCalls=0;
 const api=createApprovedManualCoverAllManagement({
  requireManager:(m,permission)=>{assert.equal(m,manager);assert.equal(permission,'manage_coverall');return{managerId:m.manager_id,managerName:m.manager_display_name};},
  transaction:async fn=>{assert.equal(inTransaction,false);inTransaction=true;log.push('BEGIN');try{const r=await fn({synthetic:true});if(commitError)throw commitError;log.push('COMMIT_RETURNED');return r;}finally{inTransaction=false;}},
  lockAuthority:async()=>{assert.equal(inTransaction,true);log.push('LOCK');},
  call:async(_client,name,args)=>{
   assert.equal(inTransaction,true);log.push(name);
   if(name==='static_weekly_read_coverall_manager_basis'){assert.equal(args[0],manager.manager_id);assert.equal(args[1],op);mutateAtRead?.();return copy(basis);}
   if(name==='static_weekly_prepare_coverall_choice'){basis.choice=copy(args[0]);return{state:'PREPARING',operationId:op,choiceId:args[0].choiceId,choiceDigest:args[0].choiceDigest};}
   throw Error('Unexpected synthetic SQL '+name);
  },
  prepareStaffingCommand:async input=>{assert.equal(inTransaction,false);assert.equal(log.at(-1),'COMMIT_RETURNED');assert.equal(input.operationId,op);prepareCalls++;log.push('EXISTING_PREPARE');if(prepareError)throw prepareError;return{...copy(base.command),state:'PREPARED',preview_digest:'b'.repeat(64)};}
 });
 return {api,log,basis,get prepareCalls(){return prepareCalls;}};
}
await test('Strict request retains actual five-to-two vendor shift and exact one-hour lunch',()=>{const parsed=parseApprovedManualCoverAllRequest(request);assert.equal(parsed.days[0].shift.start,'05:00');assert.deepEqual(parsed.days[0].lunch,substitute.lunch);});
for(const [name,change]of [
 ['extra top-level field',x=>x.sourceId=sourceId],['forged source identity',x=>x.days[0].sourceId=sourceId],
 ['unknown nested hour',x=>x.days[0].shift.owner=true],['unconfirmed hours',x=>x.days[0].actual_hours_confirmed=false],
 ['blank reference',x=>x.days[0].confirmation_reference=''],['whitespace reference',x=>x.days[0].confirmation_reference=' yes '],
 ['short lunch',x=>x.days[0].lunch.end='10:00'],['lunch outside actual hours',x=>x.days[0].lunch={start:'03:00',end:'04:00'}],
 ['duplicate day',x=>x.days.push(copy(x.days[0]))],['invalid civil date',x=>x.days[0].service_date='2026-02-30']
])await test('Reject '+name,()=>{const x=copy(request);change(x);assert.throws(()=>parseApprovedManualCoverAllRequest(x));});
await test('Options contain server-bound positions and no full private source/plan',async()=>{
 const h=harness(),r=await h.api.getApprovedManualCoverAllOptions({manager,operationId:op});assert.equal(r.days.length,1);assert.equal(r.days[0].retainedPlanDigest,fixture.retainedDay.plan.planDigest);
 assert.ok(r.days[0].capacities.some(c=>c.capacityId===substitute.slotId));assert.ok(!r.days[0].lunchCoverers.some(p=>fixture.retainedDay.input.roster.find(x=>x.slotId===p.slotId)?.personId===semantic.employeeId));
 assert.equal(r.vendorBooked,false);assert.equal(r.originalCommandPreserved,true);assert.ok(!JSON.stringify(r).includes('phaseOwners'));assert.equal(h.prepareCalls,0);
});
await test('Valid actual vendor hours use real retained-plan mathematics before maintained preparation',async()=>{
 const h=harness(),before=digest(base),r=await h.api.prepareApprovedManualCoverAllStaffing({manager,operationId:op,request});assert.equal(r.state,'PREPARED');assert.equal(h.prepareCalls,1);assert.equal(r.coverallChoice.choiceId,choice);
 assert.equal(h.basis.choice.canonicalSemanticBody.employeeId,semantic.employeeId);assert.equal(h.basis.choice.operationId,op);assert.equal(digest(base),before);
 assert.ok(h.log.indexOf('COMMIT_RETURNED')<h.log.indexOf('EXISTING_PREPARE'));
});
await test('Unknown choice COMMIT never launches another preparation',async()=>{
 const error=Object.assign(Error('Synthetic connection loss'),{code:'ECONNRESET'}),h=harness({commitError:error});await assert.rejects(h.api.prepareApprovedManualCoverAllStaffing({manager,operationId:op,request}),e=>e===error);assert.equal(h.prepareCalls,0);
});
await test('Unavailable full-hour helper refuses before any choice is written',async()=>{
 const x=copy(request);x.days[0].lunch_coverer_slot_id=uid(99);const h=harness();await assert.rejects(h.api.prepareApprovedManualCoverAllStaffing({manager,operationId:op,request:x}),e=>e.code==='static_manual_coverall_full_hour_helper_required');assert.equal(h.basis.choice,null);assert.equal(h.prepareCalls,0);
});
await test('Unlisted nonemployee capacity refuses before choice preparation',async()=>{
 const x=copy(request);x.days[0].capacity_id=uid(99);const h=harness();await assert.rejects(h.api.prepareApprovedManualCoverAllStaffing({manager,operationId:op,request:x}),e=>e.code==='static_manual_coverall_source_capacity_required');assert.equal(h.basis.choice,null);
});
await test('Hours that miss retained duties are rejected by maintained overlay',async()=>{
 const x=copy(request);x.days[0].shift.start='09:00';const h=harness();await assert.rejects(h.api.prepareApprovedManualCoverAllStaffing({manager,operationId:op,request:x}));assert.equal(h.basis.choice,null);
});
await test('Changed principal after SQL read cannot persist a choice',async()=>{
 const prior=manager.device_id,h=harness({mutateAtRead:()=>{manager.device_id='changed-device';}});try{await assert.rejects(h.api.prepareApprovedManualCoverAllStaffing({manager,operationId:op,request}),e=>e.code==='staffing_original_principal_changed');assert.equal(h.basis.choice,null);}finally{manager.device_id=prior;}
});
await test('Preparation failure returns original operation and already-committed choice identity',async()=>{
 const error=Object.assign(Error('Synthetic failed staging'),{code:'synthetic_staging_failed'}),h=harness({prepareError:error});await assert.rejects(h.api.prepareApprovedManualCoverAllStaffing({manager,operationId:op,request}),e=>e===error&&e.operationId===op&&e.coverallChoice.choiceId===choice);assert.equal(h.prepareCalls,1);
});
await test('Multi-frame same-source lookup selects exact retained source digest',()=>{
 const b=copy(base),wrong=copy(fixture.source);wrong.serviceDate='2026-11-09';b.normalSources.unshift({sourceId,publicationId:publication,source:wrong});const d=parseApprovedManualCoverAllRequest(request).days[0];
 assert.ok(prepareApprovedManualCoverAllChoice({originalCommand:original,basis:b,choiceId:choice,days:[{...d,sourceId,publicationId:publication}]}).choice.choiceDigest);
});
await test('Original operation read exposes only five verified companion fields',async()=>{
 const h=harness();await h.api.prepareApprovedManualCoverAllStaffing({manager,operationId:op,request});const r=await readApprovedManualCoverAllChoiceSummary({client:{},actor:{managerId:manager.manager_id},operationId:op,call:async()=>h.basis.choice});assert.deepEqual(Object.keys(r).sort(),['choiceDigest','choiceId','expectedRevision','operationId','semanticDigest']);
});
console.log(JSON.stringify({scope:'Pure real-overlay mathematics and synthetic CP transaction boundaries, not SQL/auth/browser/device proof',status:'PASS',checks:checks.length,cases:checks,productionWritten:false,finalAudit:false}));
