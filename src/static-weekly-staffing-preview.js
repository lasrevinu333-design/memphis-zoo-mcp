/* Pure revision-bound staffing overlay used only to prepare non-authoritative candidates. */
import { enumerateStaffingServiceWindow } from './static-weekly-staffing-preparation.js';

const failure=code=>Object.assign(new Error(code),{code});
const clone=value=>structuredClone(value);
const day=86_400_000;
function inWeek(date,week){const offset=(Date.parse(`${date}T00:00:00Z`)-Date.parse(`${week}T00:00:00Z`))/day;return Number.isInteger(offset)&&offset>=0&&offset<7;}
function incumbent(slot,employee,date){return (Array.isArray(slot?.incumbencies)?slot.incumbencies:[]).some(row=>row?.personId===employee
  && typeof row.effectiveStart==='string'&&row.effectiveStart<=date&&(!row.effectiveEnd||date<row.effectiveEnd));}

export function createStaffingWeekPreviewInput({operationId,managerId,semanticBody,expectedRevision,weekStart,source,currentServiceDate}){
  if(!source?.compiler_input||!Array.isArray(source.compiler_input.slots)||!Array.isArray(source.exceptions))throw failure('staffing_preview_source_required');
  const window=enumerateStaffingServiceWindow(semanticBody?.startDate,semanticBody?.endDate);
  if(!window.weeks.includes(weekStart))throw failure('staffing_preview_week_outside_command');
  const dates=window.dates.filter(date=>inWeek(date,weekStart));
  const employee=semanticBody.employeeId;
  const slots=new Set();
  for(const date of dates){const matches=source.compiler_input.slots.filter(slot=>incumbent(slot,employee,date));
    if(matches.length!==1)throw failure(matches.length?'staffing_preview_employee_multiple_slots':'staffing_preview_employee_slot_unavailable');
    slots.add(matches[0].id);}
  if(slots.size!==1)throw failure('staffing_preview_employee_slot_drift');
  const slotId=[...slots][0];
  let exceptions=clone(source.exceptions);
  if(semanticBody.commandKind==='cancel_absence'){
    if(typeof currentServiceDate!=='string'||semanticBody.startDate<currentServiceDate)throw failure('staffing_preview_cancellation_cannot_rewrite_elapsed_service_date');
    const target=semanticBody.targetAbsenceId;
    const before=exceptions.length;
    exceptions=exceptions.filter(item=>{
      const isTarget=item?.staffingAbsenceId===target||String(item?.id||'').startsWith(`${target}:`);
      return !isTarget||item?.serviceDate<semanticBody.startDate||item?.serviceDate>semanticBody.endDate;
    });
    if(before===exceptions.length)throw failure('staffing_preview_cancellation_target_missing');
  }else if(semanticBody.commandKind==='absence'){
    const type=semanticBody.absenceKind==='pto'?'pto':'daily_absence';
    exceptions.push(...dates.map((serviceDate,index)=>({id:`${operationId}:${serviceDate}`,type,serviceDate,
      staffingAbsenceId:operationId,staffingAbsenceKind:semanticBody.absenceKind,actorId:managerId,
      reason:'Approved staffing unavailability',idempotencyKey:`staffing:${operationId}:${serviceDate}`,
      expectedRevision,status:'accepted',payload:{slotId},
      baseVersionId:source.version_id,publicationId:source.publication_id,
      sequence:expectedRevision+1+window.dates.indexOf(serviceDate)})));
  }else throw failure('staffing_preview_command_kind_invalid');
  return Object.freeze({input:{serviceDate:weekStart,timezone:source.compiler_input.timezone||'America/Chicago',
    slots:clone(source.compiler_input.slots),proximity:clone(source.compiler_input.proximity||[]),exceptions,
    versions:[clone(source.compiler_input.version)]},dates:Object.freeze(dates),slotId,
    publication:Object.freeze({weekStart,publicationId:source.publication_id,versionId:source.version_id,
      authorityRevision:Number(source.authority_revision)})});
}
