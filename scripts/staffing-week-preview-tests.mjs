import assert from 'node:assert/strict';
import {createStaffingWeekPreviewInput} from '../src/static-weekly-staffing-preview.js';
import {assertExceptionCommand} from '../src/static-weekly-schedule-model.js';
let checks=0;const same=(a,b,m)=>{assert.deepEqual(a,b,m);checks++;};const rejects=(input,code)=>{assert.throws(()=>createStaffingWeekPreviewInput(input),e=>e?.code===code);checks++;};
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
