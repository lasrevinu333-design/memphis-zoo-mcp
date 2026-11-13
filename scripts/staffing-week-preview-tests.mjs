import assert from 'node:assert/strict';
import {createStaffingWeekPreviewInput} from '../src/static-weekly-staffing-preview.js';
import {assertExceptionCommand} from '../src/static-weekly-schedule-model.js';
let checks=0;const same=(a,b,m)=>{assert.deepEqual(a,b,m);checks++;};const rejects=(input,code)=>{assert.throws(()=>createStaffingWeekPreviewInput(input),e=>e?.code===code);checks++;};
if(process.argv.includes('--current-plan-cancellation-reproduction-only')){
 // NEW exact owning-function counterexamples only; do not replay the retained
 // legacy suite below. These are pure fixture inputs, not accepted SQL facts.
 const employee='20000000-0000-4000-8000-000000000001',replacement='20000000-0000-4000-8000-000000000002';
 const target='40000000-0000-4000-8000-000000000001',operation='30000000-0000-4000-8000-000000000001';
 const semanticBody={commandKind:'cancel_absence',absenceKind:null,employeeId:employee,
  startDate:'2026-10-12',endDate:'2026-10-13',targetAbsenceId:target};
 const source={authority_revision:19,publication_id:'70000000-0000-4000-8000-000000000002',
  version_id:'60000000-0000-4000-8000-000000000002',exceptions:[],compiler_input:{timezone:'America/Chicago',
   proximity:[{from:'area-a',to:'area-b',minutes:1,verified:true,provenance:'pure directed fixture fact'}],
   slots:[{id:'current-slot',incumbencies:[{personId:replacement,effectiveStart:'2026-10-12',effectiveEnd:null}]}],
   version:{id:'60000000-0000-4000-8000-000000000002',assignments:[]}}};
 const base={operationId:operation,managerId:'10000000-0000-4000-8000-000000000001',expectedRevision:19,
  weekStart:'2026-10-12',source,currentServiceDate:'2026-10-12',semanticBody};
 const untouched=structuredClone(base);
 rejects(base,'staffing_preview_employee_slot_unavailable');
 same(base,untouched,'replaced-person rejection occurs without mutating the current plan or original target');
 // SQL compiler exception-set omits the old person's target after replacement:
 // no fabricated accepted row/metadata is inserted to get past that boundary.
 same(base.semanticBody,{commandKind:'cancel_absence',absenceKind:null,employeeId:employee,
  startDate:'2026-10-12',endDate:'2026-10-13',targetAbsenceId:target},'original immutable target/range retained');
 const moving=structuredClone(base);
 moving.source.compiler_input.slots=[
  {id:'day-one-slot',incumbencies:[{personId:employee,effectiveStart:'2020-01-01',effectiveEnd:'2026-10-13'}]},
  {id:'day-two-slot',incumbencies:[{personId:employee,effectiveStart:'2026-10-13',effectiveEnd:null}]}];
 moving.source.exceptions=['2026-10-12','2026-10-13'].map((serviceDate,index)=>({id:`${target}:${serviceDate}`,
  staffingAbsenceId:target,staffingAbsenceKind:'daily_absence',serviceDate,type:'daily_absence',status:'accepted',
  actorId:base.managerId,baseVersionId:source.version_id,publicationId:source.publication_id,
  payload:{slotId:index===0?'day-one-slot':'day-two-slot'}}));
 const movingUntouched=structuredClone(moving);
 rejects(moving,'staffing_preview_employee_slot_drift');
 same(moving,movingUntouched,'single-slot gate rejects current-plan movement before reading exact target rows');
 console.log(JSON.stringify({status:'REPRODUCED_NOT_REPAIRED',checks,
  observed:['staffing_preview_employee_slot_unavailable','staffing_preview_employee_slot_drift'],
  blocker:'current source omits replaced original target; trusted original employee/range/op read seam and SQL active-person policy are main-owned',
  scope:'new pure current-plan cancellation counterexamples; no SQL, compiler, acceptance, browser or product PASS'}));
}else if(process.argv.includes('--trusted-current-plan-cancellation-only')){
 const employee='20000000-0000-4000-8000-000000000001',replacement='20000000-0000-4000-8000-000000000002';
 const target='40000000-0000-4000-8000-000000000001',operation='30000000-0000-4000-8000-000000000001';
 const originalCancellationTarget={absenceId:target,employeeId:employee,startDate:'2026-10-11',endDate:'2026-10-13',
  acceptedOperationId:target,status:'accepted'};
 const source={authority_revision:19,publication_id:'70000000-0000-4000-8000-000000000002',
  version_id:'60000000-0000-4000-8000-000000000002',exceptions:[
   {id:'other-current-capacity',type:'cover_all',serviceDate:'2026-10-12',status:'accepted',payload:{availability:{slotId:'capacity-current'}}},
   {id:'other-current-lunch',type:'lunch',serviceDate:'2026-10-12',status:'accepted',window:{start:'11:30',end:'12:00'},payload:{slotId:'capacity-current'}}],
  compiler_input:{timezone:'America/Chicago',proximity:[{from:'area-b',to:'area-a',minutes:2,verified:true,provenance:'current directed fixture fact'}],
   slots:[{id:'current-slot',incumbencies:[{personId:replacement,effectiveStart:'2026-10-12',effectiveEnd:null}]}],
   version:{id:'60000000-0000-4000-8000-000000000002',assignments:[{workId:'current-not-old',ownerSlotId:'current-slot'}]}}};
 const base={operationId:operation,managerId:'10000000-0000-4000-8000-000000000001',expectedRevision:19,
  weekStart:'2026-10-12',source,currentServiceDate:'2026-10-12',originalCancellationTarget,
  semanticBody:{commandKind:'cancel_absence',absenceKind:null,employeeId:employee,startDate:'2026-10-12',endDate:'2026-10-13',targetAbsenceId:target}};
 const unchanged=structuredClone(base),preview=createStaffingWeekPreviewInput(base);
 same(preview.slotId,null,'replaced original has no invented current or old slot');
 same(preview.input,{serviceDate:base.weekStart,timezone:'America/Chicago',slots:source.compiler_input.slots,
  proximity:source.compiler_input.proximity,exceptions:source.exceptions,versions:[source.compiler_input.version]},
  'trusted exact original permits no-op current plan: no old people/geometry/manual capacity/lunch restore');
 same(base,unchanged,'pure overlay mutates no original target/body/current source');
 const vacant=structuredClone(base);vacant.source.compiler_input.slots=[];
 same(createStaffingWeekPreviewInput(vacant).slotId,null,'no current incumbent remains a no-op, not an invented replacement');
 rejects({...base,originalCancellationTarget:null},'staffing_preview_employee_slot_unavailable');
 const moved=structuredClone(base);moved.source.compiler_input.slots=[
  {id:'day-one-slot',incumbencies:[{personId:employee,effectiveStart:'2020-01-01',effectiveEnd:'2026-10-13'}]},
  {id:'day-two-slot',incumbencies:[{personId:employee,effectiveStart:'2026-10-13',effectiveEnd:null}]}];
 const fact=date=>({id:`${target}:${date}`,staffingAbsenceId:target,staffingAbsenceKind:'daily_absence',serviceDate:date,
  type:'daily_absence',status:'accepted',actorId:base.managerId,baseVersionId:source.version_id,publicationId:source.publication_id,
  payload:{slotId:date==='2026-10-13'?'day-two-slot':'day-one-slot'},
  staffingEmployeeId:employee,staffingStartDate:'2026-10-11',staffingEndDate:'2026-10-13',staffingAcceptedOperationId:target});
 const elapsed=fact('2026-10-11');moved.source.exceptions=[elapsed,...source.exceptions,fact('2026-10-12'),fact('2026-10-13')];
 const movedPreview=createStaffingWeekPreviewInput(moved);
 same(movedPreview.slotId,null,'moved original never fabricates a single historic slot');
 same(movedPreview.input.exceptions,[elapsed,...source.exceptions],'only exact remaining original fact removed; elapsed history preserved');
 same(movedPreview.input.slots,moved.source.compiler_input.slots,'today\'s current people remain unchanged');
 // Same-current-employee cancellation stays meaningful with supplied original
 // fact; no optimiser/clock/accepted-plan claim is made by this pure overlay.
 const current=structuredClone(moved);current.source.compiler_input.slots=[{id:'day-one-slot',incumbencies:[
  {personId:employee,effectiveStart:'2020-01-01',effectiveEnd:null}]}];
 same(createStaffingWeekPreviewInput(current).slotId,'day-one-slot','one actual current slot may still be reported');
 for(const changed of [{employeeId:replacement},{absenceId:operation},{acceptedOperationId:operation},{status:'cancelled'},
  {absenceId:[target]},{employeeId:[employee]},{acceptedOperationId:[target]},{unexpected:'browser field'}])
  rejects({...base,originalCancellationTarget:{...originalCancellationTarget,...changed}},'staffing_preview_original_cancellation_target_invalid');
 for(const changed of [{startDate:'2026-10-13'},{endDate:'2026-10-14'}])
  rejects({...base,originalCancellationTarget:{...originalCancellationTarget,...changed}},'staffing_preview_original_cancellation_target_window_invalid');
 rejects({...base,originalCancellationTarget:{...originalCancellationTarget,startDate:'2026-02-31'}},'staffing_invalid_service_date');
 rejects({...base,currentServiceDate:'2026-10-13'},'staffing_preview_cancellation_cannot_rewrite_elapsed_service_date');
 rejects({...base,currentServiceDate:'2026-02-31'},'staffing_invalid_service_date');
 for(const changed of [{staffingAbsenceId:operation},{staffingEmployeeId:replacement},{staffingAcceptedOperationId:operation},
  {status:'held'},{type:'cover_all'},{staffingAbsenceKind:'pto'},{publicationId:operation},{baseVersionId:operation},
  {id:`${target}:wrong-date`},{serviceDate:'2026-10-14',id:`${target}:2026-10-14`}])
  rejects({...base,source:{...source,exceptions:[{...fact('2026-10-12'),...changed}]}},'staffing_preview_cancellation_target_invalid');
 // The accepted original is not a source of new absence authority: missing
 // current employee and multiple positions still refuse actual creation.
 const creation={...base,originalCancellationTarget:null,semanticBody:{commandKind:'absence',absenceKind:'daily_absence',
  employeeId:employee,startDate:'2026-10-12',endDate:'2026-10-13',targetAbsenceId:null}};
 rejects(creation,'staffing_preview_employee_slot_unavailable');
 rejects({...creation,originalCancellationTarget},'staffing_preview_original_cancellation_target_forbidden');
 const duplicate=structuredClone(creation);duplicate.source.compiler_input.slots=['one','two'].map(id=>({id,incumbencies:[
  {personId:employee,effectiveStart:'2020-01-01',effectiveEnd:null}]}));
 rejects(duplicate,'staffing_preview_employee_multiple_slots');
 same(base,unchanged,'all hostile target probes preserve source/target/body');
 console.log(JSON.stringify({status:'PASS',checks,scope:'new private-target current-plan cancellation pure overlay ONLY; unmounted/authenticated target read and SQL active-person policy remain main-owned; no G18/runtime/SQL/solver/browser PASS'}));
}else{
const employee='20000000-0000-4000-8000-000000000001',operation='30000000-0000-4000-8000-000000000001';
const source={authority_revision:19,publication_id:'70000000-0000-4000-8000-000000000001',version_id:'60000000-0000-4000-8000-000000000001',exceptions:[],compiler_input:{timezone:'America/Chicago',proximity:[],slots:[{id:'slot-a',incumbencies:[{personId:employee,effectiveStart:'2020-01-01',effectiveEnd:null}]}],version:{id:'version-a'}}};
const base={operationId:operation,managerId:'10000000-0000-4000-8000-000000000001',expectedRevision:19,weekStart:'2026-09-28',source,
  semanticBody:{commandKind:'absence',absenceKind:'unavailable',employeeId:employee,startDate:'2026-09-30',endDate:'2026-10-02',targetAbsenceId:null}};
const preview=createStaffingWeekPreviewInput(base);same(preview.dates,['2026-09-30','2026-10-01','2026-10-02']);same(preview.slotId,'slot-a');
same(preview.input.exceptions.map(row=>[row.type,row.serviceDate,row.staffingAbsenceKind]),[
  ['daily_absence','2026-09-30','unavailable'],['daily_absence','2026-10-01','unavailable'],['daily_absence','2026-10-02','unavailable']]);
same(preview.input.exceptions.map(row=>row.sequence),[20,21,22],'absence ordering binds the one expected authority revision and exact date offset');
same(preview.input.exceptions.every(row=>assertExceptionCommand(row)===row),true,'every generated overlay passes the canonical compiler exception contract');
same(source.exceptions,[],'source remains immutable');
const accepted={...preview.input.exceptions[0],id:`40000000-0000-4000-8000-000000000001:2026-09-30`,staffingAbsenceId:'40000000-0000-4000-8000-000000000001'};
const cancelled=createStaffingWeekPreviewInput({...base,currentServiceDate:'2026-09-30',source:{...source,exceptions:[accepted]},semanticBody:{commandKind:'cancel_absence',absenceKind:null,employeeId:employee,startDate:'2026-09-30',endDate:'2026-10-02',targetAbsenceId:accepted.staffingAbsenceId}});
same(cancelled.input.exceptions,[],'cancellation removes only the exact accepted staffing fact from the preview');
const earlier={...accepted,id:`${accepted.staffingAbsenceId}:2026-09-29`,serviceDate:'2026-09-29'};
const partialCancelled=createStaffingWeekPreviewInput({...base,currentServiceDate:'2026-09-30',source:{...source,exceptions:[earlier,accepted]},semanticBody:{commandKind:'cancel_absence',absenceKind:null,employeeId:employee,startDate:'2026-09-30',endDate:'2026-10-02',targetAbsenceId:accepted.staffingAbsenceId}});
same(partialCancelled.input.exceptions,[earlier],'ending an absence preserves the immutable earlier date in the same week');
rejects({...base,currentServiceDate:'2026-09-30',source:{...source,exceptions:[]},semanticBody:{commandKind:'cancel_absence',absenceKind:null,employeeId:employee,startDate:'2026-09-30',endDate:'2026-10-02',targetAbsenceId:accepted.staffingAbsenceId}},'staffing_preview_cancellation_target_missing');
rejects({...base,currentServiceDate:'2026-10-01',source:{...source,exceptions:[accepted]},semanticBody:{commandKind:'cancel_absence',absenceKind:null,employeeId:employee,startDate:'2026-09-30',endDate:'2026-10-02',targetAbsenceId:accepted.staffingAbsenceId}},'staffing_preview_cancellation_cannot_rewrite_elapsed_service_date');
rejects({...base,source:{...source,compiler_input:{...source.compiler_input,slots:[]}}},'staffing_preview_employee_slot_unavailable');
console.log(JSON.stringify({status:'PASS',checks,scope:'pure person-to-position dated overlay for candidate preparation; no compiler, SQL, acceptance or publication'}));
}
