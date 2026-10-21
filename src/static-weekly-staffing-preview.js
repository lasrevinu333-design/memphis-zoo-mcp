/* Pure revision-bound staffing overlay used only to prepare non-authoritative candidates. */
import { enumerateStaffingServiceWindow } from './static-weekly-staffing-preparation.js';
import {types} from 'node:util';
import {postgresJsonbContentDigest} from './static-weekly-schedule-compiler.js';

const failure=code=>Object.assign(new Error(code),{code});
const clone=value=>structuredClone(value);
const day=86_400_000;
// Private IPC DATA only. Detach before the queue's first await; an accessor,
// proxy, sparse array or late caller mutation cannot replace the original.
function pendingWorkerData(value){
 let nodes=0,bytes=0;const seen=new Set(),bad=()=>{throw failure('staffing_approved_pending_protocol_invalid');};
 const copy=(v,depth)=>{
  if(++nodes>2_000_000||depth>64)bad();
  if(v===null||typeof v==='boolean')return v;
  if(typeof v==='string'){bytes+=Buffer.byteLength(v,'utf8');if(bytes>32*1024*1024)bad();return v;}
  if(typeof v==='number'){if(!Number.isFinite(v)||Object.is(v,-0))bad();return v;}
  if(typeof v!=='object'||types.isProxy(v)||seen.has(v))bad();
  const array=Array.isArray(v),proto=Object.getPrototypeOf(v);
  if(array?proto!==Array.prototype:proto!==Object.prototype&&proto!==null)bad();
  const keys=Reflect.ownKeys(v);if(keys.some(k=>typeof k!=='string'))bad();
  if(array&&(keys.length!==v.length+1||keys.some(k=>k!=='length'&&(!/^(0|[1-9][0-9]*)$/.test(k)||Number(k)>=v.length))))bad();
  seen.add(v);const out=array?[]:{};
  for(const k of keys){if(array&&k==='length')continue;
   const d=Object.getOwnPropertyDescriptor(v,k);if(!d||!Object.hasOwn(d,'value')||!d.enumerable||k==='__proto__')bad();
   Object.defineProperty(out,k,{value:copy(d.value,depth+1),enumerable:true,writable:true,configurable:true});
  }
  seen.delete(v);return Object.freeze(out);
 };return copy(value,0);
}
function pendingWorkerExact(value,keys){
 if(!value||Array.isArray(value)||typeof value!=='object'||Object.keys(value).length!==keys.length
  ||keys.some(k=>!Object.hasOwn(value,k)))throw failure('staffing_approved_pending_protocol_invalid');
}
export function captureApprovedPendingStaffingWorkerInput(input){
 const v=pendingWorkerData(input),bad=()=>{throw failure('staffing_approved_pending_protocol_invalid');},
  uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(x);
 pendingWorkerExact(v,['schema','command','managerId','actor','weekStart','source','bases','snapshot','window']);
 pendingWorkerExact(v.actor,['managerId','managerName']);
 const c=v.command;
 if(v.schema!=='custodial.approved-static-pending-staffing-worker-input.v1'||!c||c.state!=='PREPARING'
  ||!uuid(c.operation_id)||!uuid(v.managerId)||c.prepared_by_manager_id!==v.managerId||v.actor.managerId!==v.managerId
  ||typeof v.actor.managerName!=='string'||!v.actor.managerName.trim()||v.actor.managerName.length>256
  ||!Number.isSafeInteger(c.expected_revision)||c.expected_revision<0||!/^[0-9a-f]{64}$/.test(c.semantic_digest||'')
  ||postgresJsonbContentDigest(c.semantic_body)!==c.semantic_digest)bad();
 const window=enumerateStaffingServiceWindow(c.semantic_body.startDate,c.semantic_body.endDate);
 if(JSON.stringify(v.window)!==JSON.stringify(window)||!window.weeks.includes(v.weekStart)
  ||v.source?.authority_revision!==c.expected_revision||!uuid(v.source?.publication_id)
  ||v.snapshot?.authority_revision!==c.expected_revision
  ||v.snapshot?.current_publication?.publication_id!==v.source.publication_id)bad();
 const dates=window.dates.filter(date=>inWeek(date,v.weekStart));
 if(!Array.isArray(v.bases)||v.bases.length!==dates.length||v.bases.some((b,i)=>
  b?.schema!=='custodial.approved-static-template-basis.v1'||b.serviceDate!==dates[i]||b.kind!=='DATED_ABSENCE'
  ||b.publicationId!==v.source.publication_id||b.authorityRevision!==c.expected_revision
  ||!Number.isSafeInteger(b.generation)||b.generation<0||b.generation!==v.bases[0].generation))bad();
 return v;
}
export function captureApprovedPendingStaffingWorkerResult(result,input){
 const r=pendingWorkerData(result),c=input.command,bad=()=>{throw failure('staffing_approved_pending_protocol_invalid');};
 pendingWorkerExact(r,['publicationId','serviceDate','exceptionSetDigest','compilerVersion','objective','metrics','replayDigest',
  'envelope','expectedRevision','actorManagerId','actorManagerName','idempotencyKey','lunchDocument']);
 const e=r.envelope,s=e?.semantic_snapshot,l=r.lunchDocument,
  expected={operationId:c.operation_id,preparerId:input.managerId,semanticBody:c.semantic_body,semanticDigest:c.semantic_digest,
   expectedRevision:c.expected_revision,currentServiceDate:c.current_service_date,originalCancellationTarget:c.original_cancellation_target??null},
  same=(a,b)=>postgresJsonbContentDigest(a)===postgresJsonbContentDigest(b);
 if(r.publicationId!==input.source.publication_id||r.serviceDate!==input.weekStart||r.expectedRevision!==c.expected_revision
  ||r.actorManagerId!==input.managerId||r.actorManagerName!==input.actor.managerName||r.idempotencyKey!==`staffing:${c.operation_id}:${input.weekStart}`
  ||r.compilerVersion!=='approved-static-pending-staffing-v1'||e?.compiler_version!==r.compilerVersion
  ||e?.adapter?.schema!=='custodial.approved-static-pending-staffing-adapter.v1'
  ||s?.schema!=='custodial.approved-static-pending-staffing-projection-snapshot.v1'
  ||!same(s.originalCommand,expected)||!same(s.originalSource,input.source)||s.weekStart!==input.weekStart
  ||s.generation!==input.bases[0].generation||!same(s.scopeDates,input.bases.map(b=>b.serviceDate))
  ||s.templateCatalogDigest!==input.bases[0].templateCatalogDigest||s.templateInputsDigest!==input.bases[0].templateInputsDigest
  ||e?.authority?.schema!=='custodial.approved-static-pending-staffing-authority.v1'
  ||e.authority.solverInvoked!==false||e.authority.optimized!==false
  ||!Array.isArray(e.assignments)||!Array.isArray(s.partitions)||s.partitions.length!==input.bases.length
  ||s.partitions.some((p,i)=>p.serviceDate!==input.bases[i].serviceDate)
  ||l?.schema!=='memphis-zoo.static-weekly-lunch-authority-document.v1'||l.week_start!==input.weekStart
  ||l.persistence_authority!=='NOT_PERSISTED'||l.base_replay_digest!==r.replayDigest
  ||e.replay_digest!==r.replayDigest||e.authority_digest!==l.base_authority_digest)bad();
 if(e.database_projection_identity!==postgresJsonbContentDigest(Object.fromEntries(Object.entries(e).filter(([k])=>k!=='database_projection_identity')))
  ||l.document_identity!==postgresJsonbContentDigest(Object.fromEntries(Object.entries(l).filter(([k])=>k!=='document_identity'))))bad();
 return r;
}
export function captureApprovedPendingStaffingUnresolved(value,input){
 const v=pendingWorkerData(value),bad=()=>{throw failure('staffing_approved_pending_protocol_invalid');};
 pendingWorkerExact(v,['schema','status','operationDate','dayOfWeek','originalWeekSourceDigest','currentWeekSourceDigest',
  'approvedTemplateSourceDigest','ownerConfigDigest','parentReferences','selectedAvailability','appliedExceptions',
  'namedHandoffReferences','unresolved','originalWeekSource']);
 const reasons=['NO_ELIGIBLE_INTERVAL_OWNER','ORIGINAL_BUDGET_INSUFFICIENT_FOR_POSITIVE_SEGMENTS','NAMED_HANDOFF_UNAVAILABLE',
  'FIXED_VISIT_REQUIRES_SINGLE_AVAILABLE_OWNER','LOCKED_PARENT_UNAVAILABLE'],clock=/^([01][0-9]|2[0-3]):[0-5][0-9]$/;
 if(v.schema!=='custodial.approved-dated-mapped-shift-end-unresolved.v1'||v.status!=='UNRESOLVED'
  ||!input.bases.some(b=>b.serviceDate===v.operationDate)||v.dayOfWeek!==new Date(v.operationDate+'T00:00:00Z').getUTCDay()
  ||['originalWeekSourceDigest','currentWeekSourceDigest','approvedTemplateSourceDigest','ownerConfigDigest'].some(k=>!/^[0-9a-f]{64}$/.test(v[k]))
  ||['parentReferences','selectedAvailability','appliedExceptions','namedHandoffReferences'].some(k=>!Array.isArray(v[k]))
  ||!v.originalWeekSource||!Array.isArray(v.unresolved)||!v.unresolved.length||v.unresolved.length>10000)bad();
 for(const r of v.unresolved){pendingWorkerExact(r,['dayOfWeek','parentWorkId','window','reason','originalBudget','requiredSegments']);
  pendingWorkerExact(r.window,['start','end']);
  if(r.dayOfWeek!==v.dayOfWeek||typeof r.parentWorkId!=='string'||!r.parentWorkId.trim()||r.parentWorkId.length>512||/[\x00-\x1f\x7f]/.test(r.parentWorkId)
   ||!clock.test(r.window.start)||!clock.test(r.window.end)||r.window.start>=r.window.end||!reasons.includes(r.reason)
   ||!Number.isSafeInteger(r.originalBudget)||r.originalBudget<1
   ||(r.reason==='ORIGINAL_BUDGET_INSUFFICIENT_FOR_POSITIVE_SEGMENTS'
    ?!Number.isSafeInteger(r.requiredSegments)||r.requiredSegments<=r.originalBudget:r.requiredSegments!==null))bad();
 }
 return v;
}
function inWeek(date,week){const offset=(Date.parse(`${date}T00:00:00Z`)-Date.parse(`${week}T00:00:00Z`))/day;return Number.isInteger(offset)&&offset>=0&&offset<7;}
function incumbent(slot,employee,date){return (Array.isArray(slot?.incumbencies)?slot.incumbencies:[]).some(row=>row?.personId===employee
  && typeof row.effectiveStart==='string'&&row.effectiveStart<=date&&(!row.effectiveEnd||date<row.effectiveEnd));}

// Private original-ledger input, NEVER a browser request field or inferred
// current occupant. This pure module cannot authenticate it. Main's locked,
// authenticated CP read must supply/check the accepted uncancelled original
// before mounting this branch; SQL BEGIN/stage/accept remain authoritative.
function requireOriginalCancellationTarget(target,semantic){
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  const fields=['absenceId','employeeId','startDate','endDate','acceptedOperationId','status'];
  if(!target||typeof target!=='object'||Array.isArray(target)
    ||Object.keys(target).length!==fields.length||fields.some(field=>!Object.hasOwn(target,field))
    ||['absenceId','employeeId','acceptedOperationId'].some(field=>typeof target[field]!=='string'||!uuid.test(target[field]))
    ||target.status!=='accepted'||target.absenceId!==semantic.targetAbsenceId||target.employeeId!==semantic.employeeId
    // Current normal absence ledger inserts absence_id=accepted_operation_id.
    ||target.acceptedOperationId!==target.absenceId)throw failure('staffing_preview_original_cancellation_target_invalid');
  enumerateStaffingServiceWindow(target.startDate,target.endDate);
  if(semantic.startDate<target.startDate||semantic.startDate>target.endDate||semantic.endDate!==target.endDate)
    throw failure('staffing_preview_original_cancellation_target_window_invalid');
  return target;
}

export function createStaffingWeekPreviewInput({operationId,managerId,semanticBody,expectedRevision,weekStart,source,currentServiceDate,
  originalCancellationTarget=null}){
  if(!source?.compiler_input||!Array.isArray(source.compiler_input.slots)||!Array.isArray(source.exceptions))throw failure('staffing_preview_source_required');
  const window=enumerateStaffingServiceWindow(semanticBody?.startDate,semanticBody?.endDate);
  if(!window.weeks.includes(weekStart))throw failure('staffing_preview_week_outside_command');
  const dates=window.dates.filter(date=>inWeek(date,weekStart));
  const employee=semanticBody.employeeId;
  if(originalCancellationTarget!==null&&semanticBody.commandKind!=='cancel_absence')
    throw failure('staffing_preview_original_cancellation_target_forbidden');
  const originalTarget=originalCancellationTarget===null?null:requireOriginalCancellationTarget(originalCancellationTarget,semanticBody);
  const slots=new Set();
  // Absence creation retains its exact current person/one-slot checks. The
  // legacy no-private-target cancellation path also retains those refusals.
  // With a verified original fact, cancellation changes that fact only, not
  // today's incumbencies; a absent/moved original has no single slot to return.
  let allDatesHaveOneSlot=true;
  for(const date of dates){const matches=source.compiler_input.slots.filter(slot=>incumbent(slot,employee,date));
    if(matches.length!==1){
      if(!originalTarget)throw failure(matches.length?'staffing_preview_employee_multiple_slots':'staffing_preview_employee_slot_unavailable');
      allDatesHaveOneSlot=false;continue;
    }
    slots.add(matches[0].id);}
  if(!originalTarget&&slots.size!==1)throw failure('staffing_preview_employee_slot_drift');
  const slotId=allDatesHaveOneSlot&&slots.size===1?[...slots][0]:null;
  let exceptions=clone(source.exceptions);
  if(semanticBody.commandKind==='cancel_absence'){
    if(typeof currentServiceDate!=='string'||semanticBody.startDate<currentServiceDate)throw failure('staffing_preview_cancellation_cannot_rewrite_elapsed_service_date');
    if(originalTarget)enumerateStaffingServiceWindow(currentServiceDate,currentServiceDate);
    const target=semanticBody.targetAbsenceId;
    const before=exceptions.length;
    exceptions=exceptions.filter(item=>{
      const isTarget=item?.staffingAbsenceId===target;
      // A prefix alone is not an accepted original staffing fact. Refuse a
      // conflicting apparent target rather than deleting somebody else's row.
      if(String(item?.id||'').startsWith(`${target}:`)&&!isTarget)
        throw failure('staffing_preview_cancellation_target_invalid');
      if(isTarget){
        if(item.id!==`${target}:${item.serviceDate}`||item.status!=='accepted'
          ||!['daily_absence','pto'].includes(item.type)
          ||!['daily_absence','pto','unavailable'].includes(item.staffingAbsenceKind)
          ||item.type!==(item.staffingAbsenceKind==='pto'?'pto':'daily_absence')
          ||item.publicationId!==source.publication_id||item.baseVersionId!==source.version_id)
          throw failure('staffing_preview_cancellation_target_invalid');
        enumerateStaffingServiceWindow(item.serviceDate,item.serviceDate);
        if(originalTarget){
          if(item.serviceDate<originalTarget.startDate||item.serviceDate>originalTarget.endDate
            ||(Object.hasOwn(item,'staffingEmployeeId')&&item.staffingEmployeeId!==originalTarget.employeeId)
            ||(Object.hasOwn(item,'staffingStartDate')&&item.staffingStartDate!==originalTarget.startDate)
            ||(Object.hasOwn(item,'staffingEndDate')&&item.staffingEndDate!==originalTarget.endDate)
            ||(Object.hasOwn(item,'staffingAcceptedOperationId')&&item.staffingAcceptedOperationId!==originalTarget.acceptedOperationId))
            throw failure('staffing_preview_cancellation_target_invalid');
        }
      }
      return !isTarget||item?.serviceDate<semanticBody.startDate||item?.serviceDate>semanticBody.endDate;
    });
    // Replaced/deactivated originals may have no current compiler exception.
    // Only the separately supplied exact original ledger fact permits that
    // no-op overlay. Every current source field remains unchanged; no restore.
    if(before===exceptions.length&&!originalTarget)throw failure('staffing_preview_cancellation_target_missing');
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

// A private-ledger DATA adapter, not an admission port. The proposal's stage
// and accept branches independently reconstruct this relation from SQL rows.
export function createApprovedPendingStaffingWeekInput({command,managerId,weekStart,source}){
 const refuse=()=>{throw failure('staffing_approved_pending_relation_invalid');},
  uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v),
  plain=v=>v&&typeof v==='object'&&!types.isProxy(v)&&Object.getPrototypeOf(v)===Object.prototype,
  data=(v,keys)=>{
   if(!plain(v)||Reflect.ownKeys(v).length!==keys.length)refuse();
   const result={};for(const key of keys){const d=Object.getOwnPropertyDescriptor(v,key);
    if(!d||!Object.hasOwn(d,'value')||!d.enumerable)refuse();result[key]=d.value;}
   return result;
  };
 if(!plain(command)||!uuid(command.operation_id)||!uuid(managerId)||command.prepared_by_manager_id!==managerId
  ||command.state!=='PREPARING'||!Number.isSafeInteger(command.expected_revision)||command.expected_revision<0)refuse();
 const semantic=data(command.semantic_body,['absenceKind','commandKind','employeeId','endDate','startDate','targetAbsenceId']);
 if(!uuid(semantic.employeeId)||postgresJsonbContentDigest(semantic)!==command.semantic_digest
  ||!['absence','cancel_absence'].includes(semantic.commandKind)
  ||(semantic.commandKind==='absence'
   ?!['daily_absence','pto','unavailable'].includes(semantic.absenceKind)||semantic.targetAbsenceId!==null
   :semantic.absenceKind!==null||!uuid(semantic.targetAbsenceId)))refuse();
 const window=enumerateStaffingServiceWindow(semantic.startDate,semantic.endDate);
 enumerateStaffingServiceWindow(command.current_service_date,command.current_service_date);
 if(!window.weeks.includes(weekStart)||semantic.startDate<command.current_service_date
  ||!source||source.authority_revision!==command.expected_revision||!uuid(source.publication_id)||!uuid(source.version_id)
  ||source.compiler_input?.version?.id!==source.version_id
  ||(source.compiler_input.version.publicationId??source.compiler_input.version.publication_id)!==source.publication_id)refuse();
 const target=command.original_cancellation_target??null;
 if(semantic.commandKind==='cancel_absence'){
  requireOriginalCancellationTarget(target,semantic);
  if(semantic.startDate!==(target.startDate>command.current_service_date?target.startDate:command.current_service_date))refuse();
 }else if(target!==null)refuse();
 const original=clone(source),overlay=createStaffingWeekPreviewInput({operationId:command.operation_id,managerId,semanticBody:semantic,
  expectedRevision:command.expected_revision,weekStart,source:original,currentServiceDate:command.current_service_date,originalCancellationTarget:target});
 // The old adapter's status describes its compiler convention, NOT an accepted
 // absence. This bridge does not export that label on any proposed fact.
 for(const row of overlay.input.exceptions)if(row.staffingAbsenceId===command.operation_id){
  if(semantic.commandKind!=='absence'||row.id!==`${command.operation_id}:${row.serviceDate}`)refuse();delete row.status;
 }
 const pendingSource={...clone(original.compiler_input),serviceDate:weekStart,exceptions:clone(overlay.input.exceptions)};
 const originalCommand={operationId:command.operation_id,preparerId:managerId,semanticBody:semantic,semanticDigest:command.semantic_digest,
  expectedRevision:command.expected_revision,currentServiceDate:command.current_service_date,originalCancellationTarget:target===null?null:clone(target)};
 const dayViews=overlay.dates.map(serviceDate=>{
  // Only this day's PROPOSAL is applied in a component view; all original
  // accepted exceptions, including other dates, are retained byte-for-byte.
  const view={...clone(original.compiler_input),serviceDate,exceptions:clone(original.exceptions)};
  if(semantic.commandKind==='absence')view.exceptions.push(...clone(overlay.input.exceptions.filter(e=>e.staffingAbsenceId===command.operation_id&&e.serviceDate===serviceDate)));
  else view.exceptions=view.exceptions.filter(e=>!(e.staffingAbsenceId===semantic.targetAbsenceId&&e.serviceDate===serviceDate));
  return {serviceDate,source:view};
 });
 const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
 return freeze({schema:'custodial.approved-static-pending-staffing-relation.v1',originalCommand,
  originalSource:original,pendingSource,scopeDates:[...overlay.dates],dayViews,publication:clone(overlay.publication)});
}
