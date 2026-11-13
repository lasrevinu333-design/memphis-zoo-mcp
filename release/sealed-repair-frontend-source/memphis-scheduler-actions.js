(function(root){'use strict';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH=/^[a-f0-9]{64}$/;
const staffingCommandPath='/static-weekly/staffing-commands';
const coverAllRequiredCode='static_manual_coverall_choice_required';
const coverAllRequiredMessage='The original third-absence command needs a server-listed, explicitly confirmed CoverAll arrangement. Read its options; the accepted two-absence plan is preserved.';
const missingPatternCode='static_template_missing_approved_pattern';
const missingPatternMessage='No release-admitted approved pattern matches the current staffing. The original request is preserved; nothing was accepted.';
const isStaffingCommand=r=>r?.path===staffingCommandPath;
const commandRoute=path=>path===staffingCommandPath||/^\/static-weekly\/staffing-commands\/[0-9a-f-]{36}\/(prepare|confirm|cancel|coverall-prepare)$/.test(path)&&UUID.test(path.split('/')[3]);
const ownerPaths=new Set(['/static-weekly/employees/departed','/static-weekly/employees/replacements']);
const paths=new Set(['/static-weekly/exceptions','/static-weekly/contractor-capacity','/static-weekly/day-changes/batch','/static-weekly/rebuild-current-projection','/static-weekly/projections',...ownerPaths]);
function staffingOperation(path){if(path==='/static-weekly/employees/restores')return 'restore_existing_employee';
 if(/^\/static-weekly\/roster\/[0-9a-f-]{36}\/vacate$/i.test(path)&&UUID.test(path.split('/')[3]))return 'vacate_roster_slot';
 if(/^\/static-weekly\/roster\/vacant-slots\/[0-9a-f-]{36}\/fill$/i.test(path)&&UUID.test(path.split('/')[4]))return 'fill_vacant_slot';
 return null;}
const knownPath=path=>paths.has(path)||!!staffingOperation(path)||commandRoute(path);
const vacancyPreviewPath=path=>/^\/static-weekly\/roster\/[0-9a-f-]{36}\/vacate\/preview$/i.test(path)&&UUID.test(path.split('/')[3]);
const capacityId=v=>typeof v==='string'&&v.length>0&&v.length<=300&&v===v.trim()&&!/[\x00-\x1f\x7f]/.test(v);
async function textDigest(value){return Array.from(new Uint8Array(await root.crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');}
function requireRetainedVacancyPreview(value){if(value?.preview_retained!==true||value.published!==false)
 throw Error('The vacancy candidate is not verified as privately retained and unpublished. Review is held; no confirmation was sent.');}
function vacancyWitness(value){requireRetainedVacancyPreview(value);const p=value.preview;return{schema:value.schema,managerId:value.managerId,sourceId:value.sourceId,slotId:value.slotId,
 employeeId:value.employeeId,effectiveStart:value.effectiveStart,weekStart:value.weekStart,expectedRevision:value.expectedRevision,
 projectionExpectedRevision:value.projectionExpectedRevision,resultingRevision:value.resultingRevision,idempotencyKey:value.idempotencyKey,
 reasonDigest:value.reasonDigest,registeredSourceDigest:value.registeredSourceDigest,currentSourceDigest:value.currentSourceDigest,
 publicationId:value.publicationId,previewDigest:value.previewDigest,workerCandidateDigest:value.workerCandidateDigest,
 replayDigest:p.replayDigest,authorityDigest:p.authorityDigest,lunchDocumentIdentity:p.lunchDocument.documentIdentity};}
function requireVacancyWitness(w,r){const b=r.body;
 if(w?.schema!=='custodial.stable-vacancy-preview.v1'||w.managerId!==r.managerId||w.sourceId!==b.source_id
  ||w.slotId!==r.path.split('/')[3]||w.employeeId!==b.employee_id||w.effectiveStart!==b.effective_start
  ||w.weekStart!==staffingWeeks(b.effective_start,b.effective_start)[0]||w.expectedRevision!==b.expected_revision
  ||w.projectionExpectedRevision!==b.expected_revision+1||w.resultingRevision!==b.expected_revision+2
  ||w.idempotencyKey!==b.idempotency_key||w.previewDigest!==b.preview_digest||!UUID.test(w.publicationId||'')
  ||['previewDigest','workerCandidateDigest','reasonDigest','registeredSourceDigest','currentSourceDigest','replayDigest','authorityDigest','lunchDocumentIdentity'].some(k=>typeof w[k]!=='string'||!HASH.test(w[k])))
  throw Error('The exact saved vacancy review is unavailable. Preserve the original operation.');
 return w;
}
async function validateVacancyPreview(value,body,binding){
 requireRetainedVacancyPreview(value);
 const r={path:'/static-weekly/roster/'+binding.slotId+'/vacate',body:{...body,preview_digest:value?.previewDigest},managerId:binding.managerId};staffingRequest(r);
 if(value?.accepted!==false||value.persisted!==false||value.phoneUpdated!==false||value.publicationId!==binding.publicationId
  ||value.currentSourceDigest!==binding.currentSourceDigest||value.registeredSourceDigest!==binding.registeredSourceDigest
  ||value.reasonDigest!==await textDigest(body.reason)||value.projectionIdempotencyKey!=='projection-'+await textDigest(body.idempotency_key))
  throw Error('The source-bound unsubmitted vacancy candidate is unverified.');
 const p=value.preview,end=new Date(value.weekStart+'T00:00:00Z');end.setUTCDate(end.getUTCDate()+6);
 if(!p||p.weekStart!==value.weekStart||p.weekEnd!==end.toISOString().slice(0,10)||typeof p.compilerVersion!=='string'
  ||!HASH.test(p.databaseProjectionIdentity||'')||!HASH.test(p.exceptionSetDigest||'')||!HASH.test(p.sourceDigest||'')||p.sourceDigestBasis!=='envelope.authority.inputDigest'
  ||!p.objective||!p.metrics||!Array.isArray(p.assignments)||p.assignments.length>1024
  ||!Array.isArray(p.projectionAvailability)||p.projectionAvailability.length>1792
  ||!Array.isArray(p.lunchDocument?.loans)||p.lunchDocument.loans.length>1792
  ||!Array.isArray(p.lunchDocument.responsibilities)||p.lunchDocument.responsibilities.length>100000
  ||p.lunchDocument.weekStart!==p.weekStart||p.lunchDocument.baseAuthorityDigest!==p.authorityDigest||p.lunchDocument.baseReplayDigest!==p.replayDigest
  ||new TextEncoder().encode(JSON.stringify(value)).byteLength>4194304)throw Error('The COMPLETE bounded vacancy work, availability and paired lunch preview is required.');
 const dated=row=>civilDate(row.serviceDate)&&row.serviceDate>=p.weekStart&&row.serviceDate<=p.weekEnd
  &&row.dayOfWeek===new Date(row.serviceDate+'T00:00:00Z').getUTCDay(),seen=new Set();
 for(const row of p.assignments){if(!dated(row)||typeof row.planWorkId!=='string'||!row.planWorkId||seen.has(row.serviceDate+':'+row.planWorkId)
  ||!['assigned','open','review'].includes(row.status)||!row.workSnapshot||row.workSnapshot.workId!==row.workId
  ||row.ownerPersonId!=null&&!UUID.test(row.ownerPersonId)||row.ownerSlotId!=null&&!UUID.test(row.ownerSlotId)
  ||row.ownerKind==='CONTRACTOR_CAPACITY'&&(row.ownerPersonId!=null||!capacityId(row.capacityId)))throw Error('The vacancy dated work identity is invalid.');seen.add(row.serviceDate+':'+row.planWorkId);}
 seen.clear();for(const row of p.projectionAvailability){if(!dated(row)||!UUID.test(row.slotId||'')||seen.has(row.serviceDate+':'+row.slotId)
  ||row.incumbentPersonId!=null&&!UUID.test(row.incumbentPersonId)||row.ownerKind==='CONTRACTOR_CAPACITY'&&(row.incumbentPersonId!=null||!capacityId(row.capacityId))
  ||['blockedWindows','productiveWindows'].some(k=>row[k]!=null&&(!Array.isArray(row[k])||row[k].length>256)))throw Error('The vacancy dated availability identity is invalid.');seen.add(row.serviceDate+':'+row.slotId);}
 for(const row of [...p.lunchDocument.loans,...p.lunchDocument.responsibilities])if(!dated(row)
  ||row.segments!=null&&(!Array.isArray(row.segments)||row.segments.length>1024))throw Error('The paired dated lunch preview is invalid.');
 requireVacancyWitness(vacancyWitness(value),r);return value;
}
function civilDate(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
 const date=new Date(value+'T00:00:00Z');return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;}
function absenceCommand(body){
 const cancellation=body?.command_kind==='cancel_absence';
 const fields=['command_kind','employee_id','start_date','end_date',cancellation?'target_absence_id':'absence_kind','client_prepare_key','expected_revision'];
 if(!body||Object.keys(body).length!==fields.length||fields.some(key=>!Object.hasOwn(body,key))
  ||!['absence','cancel_absence'].includes(body.command_kind)||typeof body.employee_id!=='string'||!UUID.test(body.employee_id)||!civilDate(body.start_date)||!civilDate(body.end_date)
  ||(!cancellation&&!['daily_absence','pto'].includes(body.absence_kind))
  ||(cancellation&&(typeof body.target_absence_id!=='string'||!UUID.test(body.target_absence_id)))
  ||typeof body.client_prepare_key!=='string'||!UUID.test(body.client_prepare_key)
  ||!Number.isSafeInteger(body.expected_revision)||body.expected_revision<0)throw Error('One exact dated employee absence is required.');
 staffingWeeks(body.start_date,body.end_date);
 return{commandKind:body.command_kind,employeeId:body.employee_id,startDate:body.start_date,endDate:body.end_date,
  absenceKind:cancellation?null:body.absence_kind,targetAbsenceId:cancellation?body.target_absence_id:null};
}
function staffingWeeks(start,end){
 if(!civilDate(start)||!civilDate(end)||start.startsWith('0000-')||end.startsWith('0000-'))throw Error('Exact staffing civil dates are required.');
 const first=Date.parse(start+'T00:00:00Z'),last=Date.parse(end+'T00:00:00Z'),days=(last-first)/86400000+1;
 if(days<1||days>366)throw Error('The complete staffing window must be between 1 and 366 days; it was not shortened.');
 const weeks=[];for(let date=first;date<=last;date+=86400000){const day=new Date(date);day.setUTCDate(day.getUTCDate()-(day.getUTCDay()+6)%7);const week=day.toISOString().slice(0,10);if(weeks.at(-1)!==week)weeks.push(week);}
 if(weeks.length>54)throw Error('The complete staffing window exceeds 54 weeks.');return weeks;
}
function staffingBindings(record){
 staffingWeeks(record.body.start_date,record.body.end_date);
 const bindings=record.weekBindings??[{weekStart:record.weekStart,publicationId:record.publicationId,versionId:record.versionId,authorityRevision:record.body.expected_revision}],
  add=(date,n)=>new Date(Date.parse(date+'T12:00Z')+n*86400000).toISOString().slice(0,10);
 if(!Array.isArray(bindings)||!bindings.length||bindings.length>54||bindings.some((row,index)=>!civilDate(row?.weekStart)
   ||(index?row.weekStart!==add(bindings[index-1].weekStart,7):row.weekStart>record.body.start_date||add(row.weekStart,6)<record.body.start_date)
   ||row.weekStart>record.body.end_date
  ||typeof row.publicationId!=='string'||!UUID.test(row.publicationId)||typeof row.versionId!=='string'||!UUID.test(row.versionId)||row.authorityRevision!==record.body.expected_revision))
  throw Error('A current publication/version is required for EVERY remaining week; no first-week substitution is allowed.');
 if(add(bindings.at(-1).weekStart,6)<record.body.end_date)throw Error('The complete remaining staffing range is not covered.');
 return bindings;
}
// Walk the authenticated reader's actual periods, including two activation
// periods inside one calendar week. Never derive publication identity locally.
async function readStaffingBindings({api,snapshot,body,currentServiceDate=null,afterRead=()=>{}}){
 staffingWeeks(body.start_date,body.end_date);const bases=[],snapshots=[];
 let cursor=body.start_date;
 while(cursor<=body.end_date){
  const contains=s=>s?.week_start<=cursor&&cursor<=s?.week_end&&root.MemphisApprovedSchedule?.validSnapshotWindow(s,cursor)===true;
  const current=contains(snapshot)?snapshot:await api('/static-weekly/manager-snapshot?week_start='+encodeURIComponent(cursor));afterRead();
  if(!contains(current)||current.authority_revision!==body.expected_revision||currentServiceDate!==null&&current.current_service_date!==currentServiceDate)
   throw Error('A current publication/version/server-date basis is required for EVERY staffing period. The complete request remains unsubmitted.');
  bases.push({weekStart:current.week_start,publicationId:current.current_publication?.publication_id,versionId:current.current_publication?.version_id,authorityRevision:current.authority_revision});
  snapshots.push(current);if(bases.length>54)throw Error('The complete staffing range exceeds 54 periods.');
  cursor=new Date(Date.parse(current.week_end+'T12:00Z')+86400000).toISOString().slice(0,10);
 }
 staffingBindings({body,weekBindings:bases});return {bases,snapshots};
}
// A rolling manual frame may straddle two calendar weeks. It must still cover
// EVERY requested day in this particular publication binding; overlap alone is
// insufficient and never shortens a multi-week original request.
function staffingSnapshotCovers(snapshot,week,body){
 if(!civilDate(week)||!civilDate(body?.start_date)||!civilDate(body?.end_date))return false;
 const end=new Date(week+'T00:00:00Z');end.setUTCDate(end.getUTCDate()+6);
 const first=body.start_date>week?body.start_date:week,last=body.end_date<end.toISOString().slice(0,10)?body.end_date:end.toISOString().slice(0,10);
 if(first>last)return false;
 return snapshot?.week_start===week&&snapshot.week_end===end.toISOString().slice(0,10)
  &&root.MemphisApprovedSchedule?.validSnapshotWindow(snapshot,week)===true&&snapshot.week_start<=first&&snapshot.week_end>=last;
}
function preparedProjection(command,week){
 return command.projections?.[week]??{projectionIdentity:command.projectionIdentity,replayDigest:command.replayDigest};
}
function requireCancellationTarget(body,target,currentServiceDate){
 if(!target||target.staffingAbsenceId!==body.target_absence_id||target.staffingEmployeeId!==body.employee_id
  ||!civilDate(target.staffingStartDate)||!civilDate(target.staffingEndDate)||target.staffingStartDate>target.staffingEndDate
  ||typeof target.staffingAcceptedOperationId!=='string'||!UUID.test(target.staffingAcceptedOperationId)
  ||!civilDate(currentServiceDate)||body.start_date!==(target.staffingStartDate>currentServiceDate?target.staffingStartDate:currentServiceDate)
  ||body.end_date!==target.staffingEndDate)throw Error('The original accepted target and exact server-bounded remaining range cannot be verified. Preserve the saved request.');
}
function validateStaffingPreview(value,record){
 const expected=absenceCommand(record.body),command=record.command;
 if(value?.operation_id!==command.operationId||value.expected_revision!==record.body.expected_revision
  ||value.prepared_by_manager_id!==record.managerId||!exactObject(value.semantic_body,expected)
  ||value.semantic_digest!==command.semanticDigest||!HASH.test(value.semantic_digest||''))throw Error('The original staffing command identity changed.');
 if(value.state==='PREPARING')return value;
 if(!['PREPARED','ACCEPTED'].includes(value.state)||!HASH.test(value.preview_digest||'')||!HASH.test(value.input_digest||'')
  ||!HASH.test(value.candidate_set_digest||''))throw Error('The original staffing preview is unavailable.');
 const vector=value.publication_vector,bindings=staffingBindings(record);
 if(vector?.expectedRevision!==record.body.expected_revision||vector.weeks?.length!==bindings.length
  ||bindings.some((binding,index)=>!exactObject(vector.weeks[index],binding)))
  throw Error('The staffing publication or revision changed.');
 if(command.previewDigest&&(command.previewDigest!==value.preview_digest||command.inputDigest!==value.input_digest
  ||command.candidateSetDigest!==value.candidate_set_digest))throw Error('The reviewed staffing candidate changed.');
 if(value.state==='ACCEPTED'){
  const receipt=value.accepted_receipt;
  if(!command.confirmationAttempted||receipt?.event!=='ACCEPTED'||receipt.operation_id!==command.operationId
   ||receipt.manager_id!==record.managerId||receipt.preview_digest!==command.previewDigest
   ||receipt.semantic_digest!==command.semanticDigest||receipt.candidate_set_digest!==command.candidateSetDigest
   ||!Number.isSafeInteger(value.accepted_revision)||value.accepted_revision<=record.body.expected_revision
   ||receipt.authority_revision!==value.accepted_revision||Object.keys(receipt?.projections??{}).length!==bindings.length
   ||bindings.some(binding=>{const map=receipt.projections[binding.weekStart],projection=preparedProjection(command,binding.weekStart);
    return !UUID.test(map?.projection_id||'')||map.publication_id!==binding.publicationId||map.projection_identity!==projection.projectionIdentity||!HASH.test(map.lunch_document_identity||'');}))
   throw Error('The persisted staffing outcome is not the reviewed candidate.');
  return value;
 }
 const preview=value.preview;
 if(preview?.schema!=='memphis-zoo.staffing-command-preview.v1'||preview.weeks?.length!==bindings.length)throw Error('The COMPLETE remaining staffing preview is required.');
 if(new TextEncoder().encode(JSON.stringify(preview)).byteLength>16777216)throw Error('The complete staffing preview exceeds its bounded UTF-8 review size.');
 for(const [index,week] of preview.weeks.entries()){
 if(new TextEncoder().encode(JSON.stringify(week)).byteLength>4194304)throw Error('A complete remaining week exceeds its bounded UTF-8 review size; it was not truncated.');
 const binding=bindings[index],prior=preparedProjection(command,binding.weekStart);
 if(week.week_start!==binding.weekStart||week.publicationId!==binding.publicationId||week.versionId!==binding.versionId
  ||!HASH.test(week.database_projection_identity||'')||!HASH.test(week.replayDigest||'')||typeof week.compilerVersion!=='string'
  ||!HASH.test(week.sourceDigest||'')||week.sourceDigestBasis!==(week.compilerVersion==='approved-manual-period-v1'?'envelope.authority.sourceDigest':'envelope.authority.inputDigest')
  ||week.compilerVersion==='approved-manual-period-v1'&&(week.projectionAvailabilityBasis!=='envelope.authority.projectionAvailability'||!HASH.test(week.projectionAvailabilityDigest||''))
  ||!Array.isArray(week.assignments)||week.assignments.length>1024||!Array.isArray(week.projectionAvailability)
  ||week.projectionAvailability.length>1792||!Array.isArray(week.lunch_loans)||!Array.isArray(week.lunch_responsibilities))
  throw Error('The persisted staffing preview lacks its bound staged facts.');
 const end=new Date(binding.weekStart+'T00:00:00Z');end.setUTCDate(end.getUTCDate()+6);const last=end.toISOString().slice(0,10),seen=new Set();
 for(const row of week.assignments){
  if(!civilDate(row?.service_date)||row.service_date<binding.weekStart||row.service_date>last
   ||typeof row.plan_work_id!=='string'||!row.plan_work_id||seen.has(row.service_date+':'+row.plan_work_id)
   ||!['assigned','open','review'].includes(String(row.status).toLowerCase())
   ||row.owner_person_id!=null&&!UUID.test(row.owner_person_id)||row.owner_slot_id!=null&&!UUID.test(row.owner_slot_id)
   ||row.owner_kind==='CONTRACTOR_CAPACITY'&&(row.owner_person_id!=null||!UUID.test(row.capacity_id||'')))
   throw Error('The dated staffing work identity is invalid.');
  seen.add(row.service_date+':'+row.plan_work_id);
 }seen.clear();
 for(const row of week.projectionAvailability){
  if(!civilDate(row.serviceDate)||row.serviceDate<binding.weekStart||row.serviceDate>last||!UUID.test(row.slotId||'')
   ||!Number.isInteger(row.dayOfWeek)||row.dayOfWeek!==new Date(row.serviceDate+'T00:00:00Z').getUTCDay()
   ||row.incumbentPersonId!=null&&!UUID.test(row.incumbentPersonId)||row.capacityId!=null&&!UUID.test(row.capacityId)
   ||row.ownerKind==='CONTRACTOR_CAPACITY'&&(row.incumbentPersonId!=null||!UUID.test(row.capacityId||''))
   ||seen.has(row.serviceDate+':'+row.slotId))throw Error('A dated staffing identity is invalid.');
  seen.add(row.serviceDate+':'+row.slotId);
 }
 if(prior.projectionIdentity&&(prior.projectionIdentity!==week.database_projection_identity||prior.replayDigest!==week.replayDigest))
  throw Error('The reviewed projection identity changed.');
 }
 return value;
}
// Cancellation observation is a closed normal GET DTO, not the short POST
// summary and never an accepted-schedule receipt or mutation capability.
function validateUnpublishedOriginal(value,record){
 if(record.command.coverallAttempt)requireCoverAllSummary(value?.coverallChoice,record);
 const keys=['operation_id','state','original_cancellation_target','semantic_body','semantic_digest','expected_revision','prepared_by_manager_id',
  'preview_digest','candidate_set_digest','input_digest','publication_vector','candidate_row_count','candidate_bytes','candidate_summary',
  'accepted_revision','accepted_receipt','created_at','prepared_at','accepted_at','current_service_date','preview',...(Object.hasOwn(value||{},'coverallChoice')?['coverallChoice']:[])];
 if(!value||Object.keys(value).sort().join(',')!==keys.sort().join(',')
  ||!['PREPARING','PREPARED','CANCELLED'].includes(value.state)
  ||value.operation_id!==record.command.operationId||value.expected_revision!==record.body.expected_revision
  ||value.prepared_by_manager_id!==record.managerId||!exactObject(value.semantic_body,absenceCommand(record.body))
  ||value.semantic_digest!==record.command.semanticDigest||!HASH.test(value.semantic_digest||'')
  ||value.accepted_revision!==null||value.accepted_receipt!==null||value.accepted_at!==null
  ||typeof value.created_at!=='string'||!Number.isFinite(Date.parse(value.created_at))||!civilDate(value.current_service_date)
  ||record.command.cancellationAttempt&&value.created_at!==record.command.cancellationAttempt.createdAt)
  throw Error('The exact unpublished original cancellation readback is unavailable. Original work remains saved.');
 const bindings=staffingBindings(record),fields=['preview_digest','candidate_set_digest','input_digest','publication_vector','candidate_row_count','candidate_bytes','candidate_summary','prepared_at'];
 if(value.state==='PREPARING'&&fields.some(k=>value[k]!==null))throw Error('The original preparing cancellation readback is malformed.');
 if(fields.some(k=>value[k]!==null)){
  const v=value.publication_vector,s=value.candidate_summary;
  if(['preview_digest','candidate_set_digest','input_digest'].some(k=>!HASH.test(value[k]||''))
   ||typeof value.prepared_at!=='string'||!Number.isFinite(Date.parse(value.prepared_at))
   ||!Number.isSafeInteger(value.candidate_row_count)||value.candidate_row_count<0||value.candidate_row_count>100000
   ||!Number.isSafeInteger(value.candidate_bytes)||value.candidate_bytes<0||value.candidate_bytes>16777216
   ||!v||Object.keys(v).sort().join(',')!=='expectedRevision,weeks'||v.expectedRevision!==record.body.expected_revision
   ||!Array.isArray(v.weeks)||v.weeks.length!==bindings.length||bindings.some((b,i)=>!exactObject(v.weeks[i],b))
   ||!s||Object.keys(s).sort().join(',')!=='lunches,projections,scheduleRefreshes,weeks'
   ||Object.values(s).some(n=>!Number.isSafeInteger(n)||n<0||n>100000)
   ||s.weeks!==bindings.length||s.projections!==bindings.length||s.lunches!==bindings.length
   ||record.command.previewDigest&&(record.command.previewDigest!==value.preview_digest
    ||record.command.inputDigest!==value.input_digest||record.command.candidateSetDigest!==value.candidate_set_digest))
   throw Error('The original retained cancellation candidate binding changed. Original work remains saved.');
 }else if(value.state==='PREPARED'||record.command.phase==='PREPARED')throw Error('The original retained cancellation candidate is missing.');
 if(value.state==='CANCELLED'){
  if(value.preview!==null||value.original_cancellation_target!==null)throw Error('The terminal original cancellation readback is malformed.');
 }else{
  if(record.body.command_kind==='absence'&&value.original_cancellation_target!==null)
   throw Error('The original unpublished cancellation target changed.');
  if(record.body.command_kind==='cancel_absence'){
   const t=record.cancellationTarget;
   if(!exactObject(value.original_cancellation_target,{absenceId:t.staffingAbsenceId,employeeId:t.staffingEmployeeId,
    startDate:t.staffingStartDate,endDate:t.staffingEndDate,acceptedOperationId:t.staffingAcceptedOperationId,status:'accepted'}))
    throw Error('The original unpublished cancellation target changed.');
  }
  validateStaffingPreview(value,record);
 }
 return value;
}
function staffingRequest(record){const b=record.body,operation=staffingOperation(record.path);
 if(!operation)return null;
 const slot=operation==='restore_existing_employee'?b.slot_id:record.path.split('/')[operation==='vacate_roster_slot'?3:4];
 const value={operation,source_id:b.source_id,slot_id:slot,effective_start:b.effective_start,reason:b.reason,
  expected_revision:b.expected_revision,actor_manager_id:record.managerId};
 if(operation==='fill_vacant_slot')value.new_employee_name=b.new_employee_name;else value.employee_id=b.employee_id;
 const keys=['source_id','effective_start','reason','expected_revision','idempotency_key',
  operation==='fill_vacant_slot'?'new_employee_name':'employee_id',...(operation==='restore_existing_employee'?['slot_id']:[]),
  ...(operation==='vacate_roster_slot'&&Object.hasOwn(b,'preview_digest')?['preview_digest']:[])];
 if(Object.keys(b).length!==keys.length||keys.some(k=>!Object.hasOwn(b,k))||!UUID.test(value.source_id||'')||!UUID.test(slot||'')
  ||(operation!=='fill_vacant_slot'&&!UUID.test(value.employee_id||''))||typeof value.reason!=='string'||!value.reason.trim()
  ||!civilDate(value.effective_start)||!Number.isSafeInteger(value.expected_revision)||value.expected_revision<0
  ||Object.hasOwn(b,'preview_digest')&&(typeof b.preview_digest!=='string'||!HASH.test(b.preview_digest))
  ||(operation==='fill_vacant_slot'&&(typeof value.new_employee_name!=='string'||value.new_employee_name!==value.new_employee_name.trim()||!value.new_employee_name)))
  throw Error('Exact canonical staffing request required.');
 return value;}
const exactObject=(a,b)=>!!a&&!!b&&Object.keys(a).length===Object.keys(b).length&&Object.entries(b).every(([k,v])=>a[k]===v);
function acceptedStaffing(value,record){let expected;try{expected=staffingRequest(record);}catch{return false;}
 const receipt=value?.receipt;
 if(record.vacancy){try{requireVacancyWitness(record.vacancy,record);}catch{return false;}
  const w=record.vacancy,d=receipt?.data,p=receiptProjection(receipt);
  if(receipt?.revision!==w.resultingRevision||d?.completion_mode!=='projection_required'||d.original_publication_id!==w.publicationId
   ||d.worker_candidate_digest!==w.workerCandidateDigest||typeof d.persisted_projection_digest!=='string'||!HASH.test(d.persisted_projection_digest)
   ||d.paired_lunch_document_identity!==w.lunchDocumentIdentity||d.projection_authority_digest!==w.authorityDigest
   ||p?.publication_id!==w.publicationId||p.week_start!==w.weekStart||p.replay_digest!==w.replayDigest)return false;
 }else if(Object.hasOwn(record.body,'preview_digest')||expected?.operation==='vacate_roster_slot'&&receipt?.data?.completion_mode==='projection_required')return false;
 return !!expected&&value?.schema==='custodial.original-staffing-outcome.v1'&&value.state==='ACCEPTED_ORIGINAL'
  &&value.manager_id===record.managerId&&value.operation===expected.operation&&value.idempotency_key===record.body.idempotency_key
  &&UUID.test(value.command_id||'')&&/^[a-f0-9]{64}$/.test(value.original_request_digest||'')&&exactObject(value.original_request,expected)&&value.retry_safe===false&&value.phone_released===false
  &&Number.isSafeInteger(receipt?.revision)&&receipt.revision>record.body.expected_revision
  &&(receipt.data?.completion_mode==='mutation_only'&&receipt.data.original_publication_id===null
    ||receipt.data?.completion_mode==='projection_required'&&UUID.test(receiptProjection(receipt)?.projection_id||''));}
const copy=v=>JSON.parse(JSON.stringify(v));
function principal(auth){const s=auth?.readSession?.();if(s?.role!=='ops_manager'||!UUID.test(s.manager_id||'')||!s.credential_id||!s.token||!(Date.parse(s.expires_at)>Date.now()))return null;return{managerId:s.manager_id,credentialId:s.credential_id,deviceId:s.device_id||''};}
const same=(a,b)=>!!a&&!!b&&a.managerId===b.managerId&&a.credentialId===b.credentialId&&a.deviceId===b.deviceId;
const coverAllSummaryFields=['choiceId','choiceDigest','operationId','semanticDigest','expectedRevision'];
const coverAllDayFields=['service_date','capacity_id','shift','lunch','lunch_coverer_slot_id','confirmation_reference','actual_hours_confirmed'];
function coverAllClock(value){return typeof value==='string'&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);}
function coverAllWindow(value){return value&&Object.keys(value).sort().join(',')==='end,start'&&coverAllClock(value.start)&&coverAllClock(value.end)&&value.start<value.end;}
const clockMinutes=value=>Number(value.slice(0,2))*60+Number(value.slice(3));
function requireCoverAllSummary(value,record,choiceId=record.command?.coverallAttempt?.choiceId){
 if(!value||coverAllSummaryFields.some(k=>!Object.hasOwn(value,k))||!UUID.test(value.choiceId||'')||value.choiceId!==choiceId
  ||!HASH.test(value.choiceDigest||'')||value.operationId!==record.command.operationId||value.semanticDigest!==record.command.semanticDigest
  ||value.expectedRevision!==record.body.expected_revision)throw Error('The original CoverAll companion identity is unverified. Preserve the saved request.');
 const prior=record.command.coverallAttempt?.choiceDigest;if(prior&&prior!==value.choiceDigest)throw Error('The immutable original CoverAll choice digest changed.');
 return Object.fromEntries(coverAllSummaryFields.map(k=>[k,value[k]]));
}
function validateCoverAllOptions(value,record){
 if(!isStaffingCommand(record)||record.body.command_kind!=='absence'||!UUID.test(record.command.operationId||'')
  ||value?.schema!=='custodial.approved-manual-coverall-options.v1'||value.operationId!==record.command.operationId
  ||value.semanticDigest!==record.command.semanticDigest||value.expectedRevision!==record.body.expected_revision
  ||!['PREPARING','PREPARED'].includes(value.state)||value.originalCommandPreserved!==true||value.vendorBooked!==false
  ||!Array.isArray(value.days)||value.days.length<1||value.days.length>366)throw Error('No exact third-absence CoverAll options are available for this original operation.');
 const seen=new Set();for(const day of value.days){
  if(!civilDate(day?.serviceDate)||day.serviceDate<record.body.start_date||day.serviceDate>record.body.end_date||seen.has(day.serviceDate)
   ||!UUID.test(day.sourceId||'')||!UUID.test(day.publicationId||'')||!UUID.test(day.retainedProjectionId||'')
   ||!HASH.test(day.retainedEnvelopeIdentity||'')||!HASH.test(day.retainedPlanDigest||'')||!Array.isArray(day.capacities)||!day.capacities.length
   ||!Array.isArray(day.lunchCoverers)||!day.lunchCoverers.length)throw Error('The retained accepted two-absence day or source capacity is unavailable.');
  const dayTime=Date.parse(day.serviceDate+'T00:00:00Z');
  if(staffingBindings(record).find(b=>{const start=Date.parse(b.weekStart+'T00:00:00Z');return start<=dayTime&&dayTime<=start+6*86400000;})?.publicationId!==day.publicationId)throw Error('The retained day is not in the original publication vector.');seen.add(day.serviceDate);
  const slots=new Set();for(const [kind,rows,key] of [['capacity',day.capacities,'capacityId'],['helper',day.lunchCoverers,'slotId']]){
   const ids=new Set();for(const row of rows){if(!UUID.test(row?.[key]||'')||ids.has(row[key])||typeof row.label!=='string'||!row.label.trim()||row.label.length>400
    ||!coverAllWindow(row.shift)||(kind==='capacity'&&row.lunch===null?false:!coverAllWindow(row.lunch)||row.lunch.start<row.shift.start||row.lunch.end>row.shift.end))
    throw Error('Source-listed '+kind+' identity or actual hours are unavailable.');ids.add(row[key]);if(kind==='capacity')slots.add(row[key]);}
  }
 }
 if(value.choice!==null){if(!record.command.coverallAttempt)throw Error('An original server CoverAll choice exists without this browser’s saved request. Preserve it for recovery.');requireCoverAllSummary(value.choice,record);}
 return copy(value);
}
function validateCoverAllDays(options,days){
 if(!Array.isArray(days)||days.length!==options.days.length)throw Error('Enter the actual CoverAll arrangement for EVERY listed third-absence date. No date was omitted.');
 const seen=new Set(),result=[];for(const day of days){
  if(!day||Object.keys(day).sort().join(',')!==[...coverAllDayFields].sort().join(',')||seen.has(day.service_date))throw Error('Exact distinct source-bound CoverAll day selections are required.');seen.add(day.service_date);
  const source=options.days.find(x=>x.serviceDate===day.service_date),capacity=source?.capacities.find(x=>x.capacityId===day.capacity_id),helper=source?.lunchCoverers.find(x=>x.slotId===day.lunch_coverer_slot_id);
  if(!capacity||!helper||helper.slotId===capacity.capacityId)throw Error('Choose server-listed nonemployee capacity and a different approved lunch helper.');
  if(!coverAllWindow(day.shift))
   throw Error('Enter the explicitly confirmed actual CoverAll shift. Source template hours are reference only.');
  if(!coverAllWindow(day.lunch)||clockMinutes(day.lunch.end)-clockMinutes(day.lunch.start)!==60
   ||day.lunch.start<day.shift.start||day.lunch.end>day.shift.end||clockMinutes(day.shift.end)-clockMinutes(day.shift.start)<=60)
   throw Error('CoverAll needs one full-hour lunch inside the actual shift, leaving productive time.');
  if(day.lunch.start<helper.shift.start||day.lunch.end>helper.shift.end||day.lunch.start<helper.lunch.end&&helper.lunch.start<day.lunch.end)
   throw Error('The selected helper must be on shift and outside their own lunch for the ENTIRE hour.');
  if(day.actual_hours_confirmed!==true||typeof day.confirmation_reference!=='string'||!day.confirmation_reference.trim()
   ||day.confirmation_reference!==day.confirmation_reference.trim()||day.confirmation_reference.length>256||/[\x00-\x1f\x7f]/.test(day.confirmation_reference))
   throw Error('Explicitly confirm the actual CoverAll hours and enter the confirmation reference.');
  result.push(copy(day));
 }return result.sort((a,b)=>a.service_date.localeCompare(b.service_date));
}

function permissions(auth){const s=auth?.readSession?.(),p=s?.permissions,current=principal(auth),valid=!!current&&p?.schema==='custodial.manager-permissions.v1'&&p.read===true;const owner=valid&&p.owner===true&&s.read_only===false,managementAdmin=valid&&auth.isCustodialManagementAdmin?.(s)===true,management=owner||managementAdmin;return{read:valid,owner,managementAdmin,management,absences:valid&&(management||p.manage_absences===true),coverall:valid&&(management||p.manage_coverall===true),routes:valid&&(management||p.regenerate_routes===true),closeScanTickets:valid&&(management||p.close_scan_tickets===true)};}
function receiptProjection(value){return value?.data?.current_projection||value?.data?.projection||null;}
function accepted(value,record){if(isStaffingCommand(record)){try{return validateStaffingPreview(value,record).state==='ACCEPTED';}catch{return false;}}if(staffingOperation(record.path))return acceptedStaffing(value,record);const p=receiptProjection(value);return Number.isSafeInteger(value?.revision)&&value.revision>=record.body.expected_revision&&UUID.test(p?.projection_id||'')&&(!record.body.publication_id||p.publication_id===record.body.publication_id)&&(!p.week_start||p.week_start===record.body.week_start);}
function authorized(auth,path,body){const p=permissions(auth);if(vacancyPreviewPath(path))return p.read&&p.management;if(!p.read||!knownPath(path))return false;
 if(staffingOperation(path))return p.management;
 if(commandRoute(path))return p.absences&&(!path.endsWith('/coverall-prepare')||p.coverall)&&(path!==staffingCommandPath||['absence','cancel_absence'].includes(body?.command_kind));
 if(ownerPaths.has(path))return p.management;
 if(path==='/static-weekly/contractor-capacity')return p.coverall&&p.absences;
 if(path==='/static-weekly/projections'||path==='/static-weekly/rebuild-current-projection')return p.routes;
 return p.absences&&(path!=='/static-weekly/day-changes/batch'||!body?.operations?.some(x=>x.operation==='cover_all')||p.coverall);
}
// Volatile observation from an original server GET, never the browser clock or saved date.
function staffingDateEligibility(value,record){
 if(value?.state==='ACCEPTED')return{state:'ACCEPTED',currentServiceDate:null,message:''};
 if(!civilDate(value?.current_service_date))return{state:'UNAVAILABLE',currentServiceDate:null,message:'The server service date is unavailable. Original staffing work is saved; read its status only.'};
 const today=value.current_service_date;
 return record.body.start_date<today?{state:'EXPIRED',currentServiceDate:today,message:'This original staffing request starts before the server service date '+today+'. It is unavailable for changes; its complete original request is preserved. Read status only. A new dated request must be explicit and separate; nothing was shifted or cleared.'}
  :{state:'CURRENT',currentServiceDate:today,message:''};
}
function requireCurrentStaffingDate(value,record){const status=staffingDateEligibility(value,record);if(status.state!=='CURRENT')throw Object.assign(Error(status.message||'The original staffing request is no longer available for a change.'),{code:'STAFFING_ORIGINAL_DATE_UNAVAILABLE'});return status;}
function create({auth,api,baseUrl,storage=root.localStorage,onState=()=>{},nonce=()=>root.crypto.randomUUID()}={}){
 const owner=principal(auth);if(!owner||typeof api!=='function')throw Error('A current manager session is required.');const base=new URL(baseUrl).origin;
 const key='mz_scheduler_dated_operation_v1:'+encodeURIComponent(base)+':'+owner.managerId;let sending=false,cancelledOriginal=null,dateObservation=null;
 function identity(){if(!same(owner,principal(auth)))throw Error('Manager access changed. Saved scheduling work remains preserved.');}
 function read(){identity();const raw=storage.getItem(key);return raw===null?null:decodeControl(raw);}
 function decodeControl(raw){let r;try{r=JSON.parse(raw);}catch{throw Error('Saved scheduler request cannot be read. Preserve it for recovery.');}
  if(raw.length>200000||r?.schema!=='custodial.scheduler-pending.v1'||r.base!==base||r.managerId!==owner.managerId||!knownPath(r.path)
   ||typeof r.encoded!=='string'||r.encoded!==JSON.stringify(r.body)||!Number.isSafeInteger(r.body?.expected_revision)||r.body.expected_revision<0
   ||(!isStaffingCommand(r)&&(typeof r.body.idempotency_key!=='string'||!r.body.idempotency_key))||!['PENDING','ACCEPTED','REJECTED'].includes(r.state)
   ||(r.state==='ACCEPTED'&&!accepted(r.receipt,r)))throw Error('Saved scheduler request is invalid. No request was sent.');
  if(isStaffingCommand(r)){
   absenceCommand(r.body);staffingBindings(r);if(r.body.command_kind==='cancel_absence')requireCancellationTarget(r.body,r.cancellationTarget,r.preparationServiceDate);const c=r.command;
   if(!civilDate(r.weekStart)||!UUID.test(r.publicationId||'')||!UUID.test(r.versionId||'')||!c
    ||!['BEGIN','PREPARING','PREPARED','CONFIRMING','ACCEPTED'].includes(c.phase)||typeof c.confirmationAttempted!=='boolean'
    ||c.operationId!==null&&!UUID.test(c.operationId)||c.confirmationAttempted&&!UUID.test(c.confirmationKey||''))
    throw Error('The saved original staffing operation is invalid.');
   if(c.preparationUnknown!==undefined&&(c.preparationUnknown!==true||r.state!=='PENDING'||c.phase!=='PREPARING'||!UUID.test(c.operationId||'')))throw Error('Original preparation uncertainty is invalid; preserve it.');
   if(c.preparationIssue!==undefined){const issue=c.preparationIssue;
    if(!issue||Object.keys(issue).sort().join(',')!=='code,encoded,message,operationId,principal,semanticDigest,weekBindings'
     ||!(issue.code===missingPatternCode&&issue.message===missingPatternMessage||issue.code===coverAllRequiredCode&&issue.message===coverAllRequiredMessage)||!same(issue.principal,owner)
     ||Object.keys(issue.principal).sort().join(',')!=='credentialId,deviceId,managerId'
     ||issue.encoded!==r.encoded||issue.operationId!==c.operationId||issue.semanticDigest!==c.semanticDigest
     ||JSON.stringify(issue.weekBindings)!==JSON.stringify(staffingBindings(r))
     ||!UUID.test(c.operationId||'')||!HASH.test(c.semanticDigest||'')||r.state!=='PENDING'
     ||c.phase!=='PREPARING'||c.confirmationAttempted)
     throw Error('The saved preparation dependency or original manager changed. Original work remains preserved.');
   }
   if(c.coverallAttempt!==undefined){const a=c.coverallAttempt;let b;try{b=JSON.parse(a.encoded);}catch{throw Error('Original CoverAll request cannot be read.');}
    if(!a||!['ATTEMPTED','OBSERVED','PREPARED'].includes(a.phase)||!UUID.test(a.choiceId||'')||!same(a.principal,owner)
     ||a.operationId!==c.operationId||a.semanticDigest!==c.semanticDigest||JSON.stringify(a.weekBindings)!==JSON.stringify(staffingBindings(r))
     ||a.encoded!==JSON.stringify(b)||Object.keys(b).sort().join(',')!=='choice_id,days'||b.choice_id!==a.choiceId||!Array.isArray(b.days)
     ||!Array.isArray(a.dayBindings)||!b.days.length||b.days.length>366||b.days.length!==a.dayBindings.length||b.days.some((d,i)=>{const bind=a.dayBindings[i];return !bind||!civilDate(d.service_date)||d.service_date!==bind.serviceDate||i>0&&d.service_date<=b.days[i-1].service_date
      ||d.service_date<r.body.start_date||d.service_date>r.body.end_date||Object.keys(d).sort().join(',')!==[...coverAllDayFields].sort().join(',')
      ||!UUID.test(d.capacity_id||'')||!UUID.test(d.lunch_coverer_slot_id||'')||d.capacity_id===d.lunch_coverer_slot_id||!coverAllWindow(d.shift)||!coverAllWindow(d.lunch)
      ||clockMinutes(d.lunch.end)-clockMinutes(d.lunch.start)!==60||d.lunch.start<d.shift.start||d.lunch.end>d.shift.end||d.actual_hours_confirmed!==true
      ||typeof d.confirmation_reference!=='string'||!d.confirmation_reference.trim()||d.confirmation_reference!==d.confirmation_reference.trim()||d.confirmation_reference.length>256||/[\x00-\x1f\x7f]/.test(d.confirmation_reference)
      ||!UUID.test(bind.sourceId||'')||!UUID.test(bind.publicationId||'')||!UUID.test(bind.retainedProjectionId||'')||!HASH.test(bind.retainedEnvelopeIdentity||'')||!HASH.test(bind.retainedPlanDigest||'');})
     ||(a.phase!=='ATTEMPTED'&&!HASH.test(a.choiceDigest||''))||a.phase==='ATTEMPTED'&&a.choiceDigest!==null)
     throw Error('Original CoverAll request identity changed. Preserve it; do not resend.');
   }
   if(c.cancellationAttempt!==undefined){const attempt=c.cancellationAttempt;
    if(!attempt||Object.keys(attempt).sort().join(',')!=='createdAt,encoded,operationId,principal,semanticDigest,weekBindings'
     ||!same(attempt.principal,owner)||Object.keys(attempt.principal).sort().join(',')!=='credentialId,deviceId,managerId'
     ||attempt.encoded!==r.encoded||attempt.operationId!==c.operationId||attempt.semanticDigest!==c.semanticDigest
     ||JSON.stringify(attempt.weekBindings)!==JSON.stringify(staffingBindings(r))
     ||typeof attempt.createdAt!=='string'||!Number.isFinite(Date.parse(attempt.createdAt))
     ||r.state!=='PENDING'||!['PREPARING','PREPARED'].includes(c.phase)||c.confirmationAttempted||c.confirmationKey!==null
     ||!UUID.test(c.operationId||'')||!HASH.test(c.semanticDigest||''))
     throw Error('The saved original cancellation attempt changed. Original work remains preserved.');
   }
  }
  if(staffingOperation(r.path)){staffingRequest(r);if(r.vacancy)requireVacancyWitness(r.vacancy,r);else if(Object.hasOwn(r.body,'preview_digest'))throw Error('Saved vacancy witness missing; preserve original work.');}return r;
 }
 function save(r){identity();const raw=JSON.stringify(r);if(raw.length>200000)throw Error('The complete original control exceeds its existing recovery bound; nothing was truncated or sent.');storage.setItem(key,raw);if(storage.getItem(key)!==raw)throw Error('Cannot save the exact scheduler request. Nothing new was sent.');onState(copy(r));}
 function pending(){const r=read();onState(r?copy(r):null);return r;}
 function currentCommand(r){identity();
  if(!permissions(auth).absences)throw Error('Staffing absence permission changed.');
  const current=read();if(!isStaffingCommand(current)||current.encoded!==r.encoded||current.command.operationId!==r.command.operationId
   ||current.command.semanticDigest!==r.command.semanticDigest||current.command.confirmationAttempted!==r.command.confirmationAttempted
   ||current.command.confirmationKey!==r.command.confirmationKey||current.state!==r.state
   ||JSON.stringify(current.command.coverallAttempt)!==JSON.stringify(r.command.coverallAttempt)
   ||JSON.stringify(current.command.cancellationAttempt)!==JSON.stringify(r.command.cancellationAttempt)
   ||JSON.stringify(staffingBindings(current))!==JSON.stringify(staffingBindings(r)))
   throw Error('The saved staffing operation changed during its response.');return current;
 }
 async function commandCall(r,path,options){identity();absenceCommand(r.body);if(!permissions(auth).absences)throw Error('Current absence permission is required; original staffing work is preserved.');
  let value;try{value=await api(path,{...options,expectedManagerId:owner.managerId});}
  catch(error){currentCommand(r);throw error;}
  currentCommand(r);return value;
 }
 function staffingDateStatus(){const r=read();return r&&dateObservation?.encoded===r.encoded&&dateObservation.operationId===r.command?.operationId
  ?copy(dateObservation.status):{state:'UNAVAILABLE',currentServiceDate:null,message:'Read original status to obtain its current server service date. Original work remains saved.'};}
 async function readCommand(r){
  const value=validateStaffingPreview(await commandCall(r,staffingCommandPath+'/'+r.command.operationId,{method:'GET'}),r);
  const status=staffingDateEligibility(value,r);dateObservation={encoded:r.encoded,operationId:r.command.operationId,status};
  if(['PREPARING','PREPARED'].includes(value.state)&&status.state!=='CURRENT')return value;
  const current=read();let coverallAttempt=current.command.coverallAttempt;
  if(coverallAttempt&&(value.coverallChoice||['PREPARED','ACCEPTED'].includes(value.state))){const summary=requireCoverAllSummary(value.coverallChoice,current);coverallAttempt={...coverallAttempt,phase:['PREPARED','ACCEPTED'].includes(value.state)?'PREPARED':'OBSERVED',choiceDigest:summary.choiceDigest};}
  if(value.state==='PREPARING'&&coverallAttempt&&JSON.stringify(coverallAttempt)!==JSON.stringify(current.command.coverallAttempt))save({...current,command:{...current.command,coverallAttempt}});
  if(value.state==='ACCEPTED'){
   // The full preview was already verified above. Retain its immutable digests
   // and the exact accepted receipt/vector, not megabytes of duplicated staged
   // rows inside the bounded recovery control. The original command is unchanged.
   save({...current,state:'ACCEPTED',receipt:copy({...value,preview:null}),command:{...current.command,...(coverallAttempt?{coverallAttempt}:{}),phase:'ACCEPTED'}});return value;
  }
  if(value.state==='PREPARED'){
   const week=value.preview.weeks[0],{preparationIssue,preparationUnknown,...command}=current.command;save({...current,command:{...command,phase:current.command.confirmationAttempted?'CONFIRMING':'PREPARED',
    ...(coverallAttempt?{coverallAttempt}:{}),previewDigest:value.preview_digest,inputDigest:value.input_digest,candidateSetDigest:value.candidate_set_digest,
    projectionIdentity:week.database_projection_identity,replayDigest:week.replayDigest,
    projections:Object.fromEntries(value.preview.weeks.map(row=>[row.week_start,{projectionIdentity:row.database_projection_identity,replayDigest:row.replayDigest}]))}});
  }
  return value;
 }
 function cancellationCurrent(r){const current=currentCommand(r);
  if(JSON.stringify(current)!==JSON.stringify(r))throw Error('The original unpublished cancellation changed during readback.');
  return current;
 }
 async function readCancellationOutcome(r){
  cancelledOriginal=null;
  const value=validateUnpublishedOriginal(await commandCall(r,staffingCommandPath+'/'+r.command.operationId,{method:'GET'}),r);
  cancellationCurrent(r);
  if(value.state==='CANCELLED'){
   // Volatile DATA-only observation. The page must recheck its live view
   // after the await before retiring its local control. No caller DTO can
   // manufacture this observation; restart must perform another original GET.
   cancelledOriginal=copy(r);
  }
  return value;
 }
 function acknowledgeStaffing(snapshots){
  const r=read();if(!isStaffingCommand(r)||r.state!=='ACCEPTED'||!accepted(r.receipt,r)||!Array.isArray(snapshots))return false;
  const bindings=staffingBindings(r),receipt=r.receipt.accepted_receipt;
  if(snapshots.length!==bindings.length||bindings.some((binding,index)=>{
   const snapshot=snapshots[index],map=receipt.projections[binding.weekStart],projection=snapshot?.latest_projection;
   return !staffingSnapshotCovers(snapshot,binding.weekStart,r.body)||snapshot.authority_revision!==receipt.authority_revision||snapshot.projection_status!=='current'
    ||snapshot.current_publication?.publication_id!==binding.publicationId||snapshot.current_publication?.version_id!==binding.versionId
    ||projection?.projection_id!==map.projection_id||projection.replay_digest!==preparedProjection(r.command,binding.weekStart).replayDigest;
  }))return false;
  storage.removeItem(key);if(storage.getItem(key)!==null)throw Error('Accepted staffing receipt could not be cleared.');onState(null);return true;
 }
 async function reviewCommand(r,retryPreparation=false){
  if(r.command.cancellationAttempt)return readCancellationOutcome(r);
  if(r.command.operationId===null){
   // Explicit Resume may replay ONLY this exact idempotent private BEGIN. No
   // acceptance/confirmation is retried and no new prepare key is generated.
   const begun=await commandCall(r,staffingCommandPath,{method:'POST',body:r.encoded});
   if(!UUID.test(begun?.operation_id||'')||begun.expected_revision!==r.body.expected_revision||!HASH.test(begun.semantic_digest||''))
    throw Error('The original private BEGIN identity is unconfirmed.');
   save({...r,command:{...r.command,phase:'PREPARING',operationId:begun.operation_id,semanticDigest:begun.semantic_digest}});r=read();
  }
  let value=await readCommand(r);r=read();
  if(['PREPARING','PREPARED'].includes(value.state)&&staffingDateEligibility(value,r).state!=='CURRENT')return value;
  if(value.state==='PREPARING'&&!r.command.confirmationAttempted&&!r.command.coverallAttempt&&!r.command.preparationUnknown&&(!r.command.preparationIssue||retryPreparation)){
   if(retryPreparation){
    for(const basis of staffingBindings(r)){
     const snapshot=await api('/static-weekly/manager-snapshot?week_start='+encodeURIComponent(basis.weekStart),{method:'GET',expectedManagerId:owner.managerId});
     currentCommand(r);requireCurrentStaffingDate({current_service_date:snapshot.current_service_date},r);
     if(!staffingSnapshotCovers(snapshot,basis.weekStart,r.body)||snapshot.authority_revision!==r.body.expected_revision
      ||snapshot.current_publication?.publication_id!==basis.publicationId||snapshot.current_publication?.version_id!==basis.versionId)
      throw Error('The current original staffing publication/version/revision changed. No preparation retry was sent.');
    }
   }
   requireCurrentStaffingDate(value,r);
   save({...r,command:{...r.command,preparationUnknown:true}});r=read();
   try{await commandCall(r,staffingCommandPath+'/'+r.command.operationId+'/prepare',{method:'POST',body:'{}'});}
   catch(error){
    if(error?.status===409&&error.serverRejected===true&&error.acceptedResult===undefined
     &&(error.code===missingPatternCode&&error.message===missingPatternMessage&&error.operationOutcome==='rejected'
      ||error.code===coverAllRequiredCode&&error.operationOutcome!=='unknown')){
     const current=currentCommand(r),{preparationUnknown,...knownCommand}=current.command;
     save({...current,command:{...knownCommand,phase:'PREPARING',preparationIssue:{code:error.code,message:error.code===coverAllRequiredCode?coverAllRequiredMessage:missingPatternMessage,
      principal:copy(owner),encoded:r.encoded,operationId:r.command.operationId,semanticDigest:r.command.semanticDigest,weekBindings:copy(staffingBindings(r))}}});
    }
    throw error;
   }
   value=await readCommand(read());
  }
  return value;
 }
 async function readStaffing(r){identity();if(!authorized(auth,r.path,r.body))throw Error('Staffing access changed; original request preserved.');
  const op=staffingOperation(r.path),value=await api('/static-weekly/staffing/operations/'+encodeURIComponent(r.body.idempotency_key)+'?operation='+encodeURIComponent(op),
   {method:'GET',expectedManagerId:owner.managerId});identity();if(!authorized(auth,r.path,r.body))throw Error('Staffing access changed during readback; original request preserved.');
  if(!acceptedStaffing(value,r))throw Error('Original staffing outcome is unconfirmed. Do not resend or replace the saved request.');
  const current=read();if(current?.encoded!==r.encoded||JSON.stringify(current?.vacancy)!==JSON.stringify(r.vacancy))throw Error('Original staffing request changed during readback.');
  save({...current,state:'ACCEPTED',receipt:copy(value),error:null});return value;}
 async function send(r){identity();if(!authorized(auth,r.path,r.body))throw Error('This scheduler change is not authorized for your current manager session. The saved request is preserved.');if(sending)throw Error('The saved scheduler request is already in progress.');sending=true;let awaitingStaffingReadback=false;
  try{
   const result=await api(r.path,{method:'POST',body:r.encoded,expectedManagerId:owner.managerId});identity();
   if(staffingOperation(r.path)){awaitingStaffingReadback=true;return await readStaffing(r);}
   if(!accepted(result,r))throw Error('The server response does not prove schedule acceptance. Retry only this saved request.');
   const current=read();if(current?.encoded!==r.encoded)throw Error('Saved scheduler request changed during submission.');
   save({...r,state:'ACCEPTED',receipt:copy(result),error:null});return result;
  }catch(error){
   if(same(owner,principal(auth))&&error?.acceptedResult&&accepted(error.acceptedResult,r)){
    const current=read();if(current?.encoded!==r.encoded)throw error;
    // The database accepted this exact request even though later coordination
    // failed. Persist the bound result and require readback, not another POST.
    save({...r,state:'ACCEPTED',receipt:copy(error.acceptedResult),error:null,coordination_pending:true});
    return error.acceptedResult;
   }
   // Explicit 4xx rejection is not transport uncertainty. Unknown outcomes keep
   // the exact body/key and cannot be replaced by a fresh mutation.
   if(!awaitingStaffingReadback&&same(owner,principal(auth))&&error?.serverRejected===true&&[400,401,403,409,422].includes(error.status)){
    try{const current=read();if(current?.encoded===r.encoded)save({...current,state:'REJECTED',error:String(error.message).slice(0,600),rejectionCode:error.code||null});}catch{}
   }
   throw error;
  }finally{sending=false;}
 }
 
 const historyIndexKey=key+':elapsed-history-index',historyPrefix=key+':elapsed-history:';
 function historyIndex(){const raw=storage.getItem(historyIndexKey);if(raw===null)return{raw,ids:[]};let ids;try{ids=JSON.parse(raw);}catch{throw Error('Saved original history index cannot be read; preserve it.');}
  if(!Array.isArray(ids)||ids.some(id=>!UUID.test(id))||new Set(ids).size!==ids.length)throw Error('Saved original history index changed; preserve it.');return{raw,ids};}
 function historyEntry(operationId){if(!UUID.test(operationId||''))throw Error('Exact archived original identity required.');const raw=storage.getItem(historyPrefix+operationId);if(raw===null)throw Error('The preserved original history entry is missing.');let entry;try{entry=JSON.parse(raw);}catch{throw Error('The preserved original history entry cannot be read.');}
  if(!entry||Object.keys(entry).sort().join(',')!=='observedServerState,observedServiceDate,operationId,originalRaw,schema'||entry.schema!=='custodial.scheduler-elapsed-original-history.v1'||entry.operationId!==operationId||!['PREPARING','PREPARED'].includes(entry.observedServerState)||!civilDate(entry.observedServiceDate)||typeof entry.originalRaw!=='string')throw Error('The preserved original history entry changed.');
  const record=decodeControl(entry.originalRaw);if(!archivableOriginal(record)||record.command.operationId!==operationId||record.body.end_date>=entry.observedServiceDate)throw Error('Preserved history does not match this fully elapsed original.');return{raw,entry,record};}
 function expiredStaffingHistory(){identity();return historyIndex().ids.map(operationId=>{const{entry,record}=historyEntry(operationId);return{operationId,startDate:record.body.start_date,endDate:record.body.end_date,commandKind:record.body.command_kind,observedState:entry.observedServerState,observedServiceDate:entry.observedServiceDate};});}
 function archivableOriginal(r){return isStaffingCommand(r)&&r.state==='PENDING'&&['PREPARING','PREPARED'].includes(r.command.phase)&&UUID.test(r.command.operationId||'')&&!r.command.confirmationAttempted&&r.command.confirmationKey===null&&!r.command.preparationUnknown&&!r.command.cancellationAttempt&&(!r.command.coverallAttempt||r.command.coverallAttempt.phase==='PREPARED');}
 async function archiveElapsedStaffingOriginal(){identity();const originalRaw=storage.getItem(key),r=read();if(sending||!permissions(auth).absences||!archivableOriginal(r))throw Error('Only a known, unattempted, fully elapsed original may be preserved separately. UNKNOWN and in-flight work stays active.');
  sending=true;try{const value=await readCommand(r);currentCommand(r);const status=staffingDateEligibility(value,r);
   if(!['PREPARING','PREPARED'].includes(value.state)||status.state!=='EXPIRED'||r.body.end_date>=status.currentServiceDate||!archivableOriginal(read()))throw Error('The complete original window is not known to be elapsed. Preserve the active original; no dates were shifted.');
   if(r.command.coverallAttempt)requireCoverAllSummary(value.coverallChoice,r);
   const sameActive=()=>{identity();if(!permissions(auth).absences)throw Error('Absence permission changed; active original was not released.');if(storage.getItem(key)!==originalRaw)throw Error('The active original changed; it was not released.');};sameActive();
   const archiveKey=historyPrefix+r.command.operationId,entryRaw=JSON.stringify({schema:'custodial.scheduler-elapsed-original-history.v1',operationId:r.command.operationId,originalRaw,observedServerState:value.state,observedServiceDate:status.currentServiceDate}),existing=storage.getItem(archiveKey);
   if(existing!==null&&existing!==entryRaw)throw Error('A different immutable original already occupies this history identity. Active work is preserved.');
   if(existing===null)storage.setItem(archiveKey,entryRaw);if(storage.getItem(archiveKey)!==entryRaw)throw Error('The complete original could not be preserved; active work was not released.');sameActive();
   const index=historyIndex(),ids=index.ids.includes(r.command.operationId)?index.ids:[...index.ids,r.command.operationId],nextIndex=JSON.stringify(ids);
   if(storage.getItem(historyIndexKey)!==index.raw)throw Error('Original history changed concurrently; active work was not released.');
   if(index.raw!==nextIndex)storage.setItem(historyIndexKey,nextIndex);if(storage.getItem(historyIndexKey)!==nextIndex||storage.getItem(archiveKey)!==entryRaw)throw Error('Original history storage is unconfirmed; active work was not released.');sameActive();
   storage.removeItem(key);if(storage.getItem(key)!==null)throw Error('The active pointer changed; the immutable old original remains preserved.');dateObservation=null;onState(null);
   return{archived:true,operationId:r.command.operationId,serverState:value.state,serverRecordChanged:false,newRequestSubmitted:false};
  }finally{sending=false;}
 }
 async function readExpiredStaffingOriginal(operationId){identity();if(sending||!permissions(auth).absences)throw Error('Current absence read access and settled work are required.');const saved=historyEntry(operationId);sending=true;
  try{const value=validateStaffingPreview(await api(staffingCommandPath+'/'+operationId,{method:'GET',expectedManagerId:owner.managerId}),saved.record);identity();if(!permissions(auth).absences||storage.getItem(historyPrefix+operationId)!==saved.raw)throw Error('The original history or read permission changed.');if(saved.record.command.coverallAttempt)requireCoverAllSummary(value.coverallChoice,saved.record);
   return{operationId,state:value.state,currentServiceDate:civilDate(value.current_service_date)?value.current_service_date:null,startDate:saved.record.body.start_date,endDate:saved.record.body.end_date,readOnly:true};
  }finally{sending=false;}
 }

 return Object.freeze({pending,staffingDateStatus,expiredStaffingHistory,archiveElapsedStaffingOriginal,readExpiredStaffingOriginal,
  async runVacancy(body,reviewed,binding){identity();if(read()||sending)throw Error('Resolve the original scheduler work first.');
   if(!permissions(auth).management||binding?.managerId!==owner.managerId)throw Error('Current owner vacancy access is required.');
   await validateVacancyPreview(reviewed,body,binding);identity();if(read()||!permissions(auth).management)throw Error('The current vacancy operation changed.');
   binding.assertCurrent?.();
   const path='/static-weekly/roster/'+binding.slotId+'/vacate',confirmed={...copy(body),preview_digest:reviewed.previewDigest};
   const r={schema:'custodial.scheduler-pending.v1',base,managerId:owner.managerId,path,body:confirmed,encoded:JSON.stringify(confirmed),
    state:'PENDING',receipt:null,error:null,vacancy:vacancyWitness(reviewed)};save(r);return send(r);
  },
  async readCoverAllOptions(){let r=read();
   if(!isStaffingCommand(r)||r.state!=='PENDING'||r.body.command_kind!=='absence'||!UUID.test(r.command.operationId||'')
    ||r.command.confirmationAttempted||r.command.cancellationAttempt||!permissions(auth).coverall)throw Error('Current CoverAll access and an original unconfirmed third-absence command are required.');
   if(sending)throw Error('Original staffing work is already in progress.');sending=true;
   try{const original=await readCommand(r);if(!r.command.coverallAttempt)requireCurrentStaffingDate(original,r);r=read();
    const options=validateCoverAllOptions(await commandCall(r,staffingCommandPath+'/'+r.command.operationId+'/coverall-options',{method:'GET'}),r);
    if(!permissions(auth).coverall)throw Error('CoverAll permission changed during readback.');
    if(r.command.coverallAttempt&&options.choice&&staffingDateEligibility(original,r).state==='CURRENT'){const summary=requireCoverAllSummary(options.choice,r);const current=currentCommand(r);
     save({...current,command:{...current.command,coverallAttempt:{...current.command.coverallAttempt,phase:current.command.coverallAttempt.phase==='PREPARED'?'PREPARED':'OBSERVED',choiceDigest:summary.choiceDigest}}});}
    return options;
   }finally{sending=false;}
  },
  async prepareCoverAll(options,days,{assertCurrent=()=>{}}={}){const r=read();
   if(!isStaffingCommand(r)||r.state!=='PENDING'||r.body.command_kind!=='absence'||r.command.phase!=='PREPARING'
    ||r.command.confirmationAttempted||r.command.preparationUnknown||r.command.cancellationAttempt||r.command.coverallAttempt||!permissions(auth).coverall)
    throw Error('Only the original unattempted third-absence CoverAll choice may be prepared. Read UNKNOWN outcomes; do not resend.');
   validateCoverAllOptions(options,r);if(options.choice)throw Error('An original CoverAll choice already exists. Read its saved outcome.');
   const selected=validateCoverAllDays(options,days);if(sending)throw Error('Original staffing work is already in progress.');sending=true;
   try{
    const original=await readCommand(r);requireCurrentStaffingDate(original,r);if(original.state!=='PREPARING')throw Error('Read the original prepared staffing status; no new CoverAll choice was sent.');
    assertCurrent();const fresh=validateCoverAllOptions(await commandCall(r,staffingCommandPath+'/'+r.command.operationId+'/coverall-options',{method:'GET'}),r);
    if(JSON.stringify(fresh)!==JSON.stringify(options))throw Error('The retained two-absence plan or source-approved capacity changed. Review it again.');
    assertCurrent();currentCommand(r);validateCoverAllDays(fresh,selected);if(!permissions(auth).coverall)throw Error('CoverAll permission changed before preparation.');
    const finalOriginal=await readCommand(r);requireCurrentStaffingDate(finalOriginal,r);if(finalOriginal.state!=='PREPARING')throw Error('The original staffing state changed; no CoverAll choice was sent.');assertCurrent();currentCommand(r);if(!permissions(auth).coverall)throw Error('CoverAll permission changed before preparation.');
    const choice=nonce();if(!UUID.test(choice||''))throw Error('Original CoverAll choice identity unavailable.');
    const body={choice_id:choice,days:selected},attempted={...r,command:{...r.command,coverallAttempt:{phase:'ATTEMPTED',choiceId:choice,choiceDigest:null,encoded:JSON.stringify(body),
     principal:copy(owner),operationId:r.command.operationId,semanticDigest:r.command.semanticDigest,weekBindings:copy(staffingBindings(r)),
     dayBindings:fresh.days.map(d=>({serviceDate:d.serviceDate,sourceId:d.sourceId,publicationId:d.publicationId,retainedProjectionId:d.retainedProjectionId,retainedEnvelopeIdentity:d.retainedEnvelopeIdentity,retainedPlanDigest:d.retainedPlanDigest})).sort((a,b)=>a.serviceDate.localeCompare(b.serviceDate))}}};
    save(attempted);
    const result=await commandCall(attempted,staffingCommandPath+'/'+r.command.operationId+'/coverall-prepare',{method:'POST',body:attempted.command.coverallAttempt.encoded});
    if(!permissions(auth).coverall)throw Error('CoverAll permission changed; original preparation remains saved.');
    validateStaffingPreview(result,attempted);const summary=requireCoverAllSummary(result.coverallChoice,attempted);
    save({...attempted,command:{...attempted.command,coverallAttempt:{...attempted.command.coverallAttempt,phase:'OBSERVED',choiceDigest:summary.choiceDigest}}});
    return await readCommand(read());
   }finally{sending=false;}
  },
  async prepareStaffing(body,binding){identity();absenceCommand(body);
    if(historyIndex().ids.some(id=>historyEntry(id).record.body.client_prepare_key===body.client_prepare_key))throw Error('A new dated request needs a separate preparation identity; the preserved original key cannot be reused.');if(sending)throw Error('Original staffing work is already in progress.');if(read())throw Error('Resolve the original saved operation first.');
   if(!permissions(auth).absences||!civilDate(binding?.weekStart)||!UUID.test(binding?.publicationId||'')||!UUID.test(binding?.versionId||''))throw Error('A current published staffing basis and absence permission are required.');
   const firstDate=Date.parse(body.start_date+'T00:00:00Z'),periodStart=Date.parse(binding.weekStart+'T00:00:00Z');
   if(firstDate<periodStart||firstDate>periodStart+6*86400000)throw Error('The staffing date is outside its reviewed period.');
   const weekBindings=binding.weeks??[{weekStart:binding.weekStart,publicationId:binding.publicationId,versionId:binding.versionId,authorityRevision:body.expected_revision}];
   staffingBindings({body,weekBindings});
   if(body.command_kind==='cancel_absence')requireCancellationTarget(body,binding.target,binding.currentServiceDate);
   const r={schema:'custodial.scheduler-pending.v1',base,managerId:owner.managerId,path:staffingCommandPath,body:copy(body),encoded:JSON.stringify(body),
    state:'PENDING',receipt:null,error:null,weekStart:binding.weekStart,publicationId:binding.publicationId,versionId:binding.versionId,weekBindings:copy(weekBindings),
    ...(body.command_kind==='cancel_absence'?{cancellationTarget:copy(binding.target),preparationServiceDate:binding.currentServiceDate}:{}),
    command:{phase:'BEGIN',operationId:null,confirmationAttempted:false,confirmationKey:null}};save(r);
   sending=true;try{return await reviewCommand(r);}finally{sending=false;}
  },
  async reviewStaffing(){const r=read();if(!isStaffingCommand(r))throw Error('No saved staffing preview.');if(sending)throw Error('Original staffing work is already in progress.');
   sending=true;try{return await reviewCommand(r);}finally{sending=false;}
  },
  async retryStaffingPreparation(){const r=read();
   if(!isStaffingCommand(r)||r.state!=='PENDING'||r.command.phase!=='PREPARING'||!r.command.preparationIssue||r.command.preparationUnknown||r.command.confirmationAttempted||r.command.cancellationAttempt||r.command.coverallAttempt||r.command.preparationIssue.code!==missingPatternCode)
    throw Error('Only the original missing-pattern preparation may be explicitly retried. Confirmation recovery is read-only.');
   if(sending)throw Error('Original staffing work is already in progress.');
   sending=true;try{return await reviewCommand(r,true);}finally{sending=false;}
  },
  async cancelStaffingPreparation(){const r=read();
   if(!isStaffingCommand(r)||r.state!=='PENDING'||!['PREPARING','PREPARED'].includes(r.command.phase)
    ||!UUID.test(r.command.operationId||'')||!HASH.test(r.command.semanticDigest||'')||r.command.confirmationAttempted
    ||r.command.confirmationKey!==null||r.command.preparationUnknown||r.command.cancellationAttempt||r.command.coverallAttempt&&r.command.coverallAttempt.phase!=='PREPARED')
    throw Error('Only an unattempted original unpublished preparation may be cancelled. Read the original outcome.');
   if(sending)throw Error('Original staffing work is already in progress.');sending=true;
   try{
    const value=validateUnpublishedOriginal(await commandCall(r,staffingCommandPath+'/'+r.command.operationId,{method:'GET'}),r);
    cancellationCurrent(r);requireCurrentStaffingDate(value,r);
    if(!['PREPARING','PREPARED'].includes(value.state))throw Error('The original preparation is no longer cancellable.');
    const attempted={...r,command:{...r.command,cancellationAttempt:{principal:copy(owner),encoded:r.encoded,
     operationId:r.command.operationId,semanticDigest:r.command.semanticDigest,weekBindings:copy(staffingBindings(r)),createdAt:value.created_at}}};
    save(attempted);cancellationCurrent(attempted);
    const result=await commandCall(attempted,staffingCommandPath+'/'+r.command.operationId+'/cancel',{method:'POST',body:'{}'});
    cancellationCurrent(attempted);
    if(!result||Object.keys(result).sort().join(',')!=='cancelled,operation_id,replayed,state'
     ||result.operation_id!==r.command.operationId||result.state!=='CANCELLED'||result.cancelled!==true||typeof result.replayed!=='boolean')
     throw Error('The original cancellation response is unconfirmed. Read the saved original; do not resend.');
    return await readCancellationOutcome(attempted);
   }finally{sending=false;}
  },
  acknowledgeCancelledStaffing(){
   const observed=cancelledOriginal;if(!observed||sending)return false;
   cancellationCurrent(observed);cancelledOriginal=null;
   // Only the local control is retired, never SQL originals/receipts/history.
   storage.removeItem(key);if(storage.getItem(key)!==null)throw Error('The verified cancelled local control could not be retired.');onState(null);return true;
  },
  async confirmStaffing(reviewed){const r=read();if(!isStaffingCommand(r)||r.command.confirmationAttempted||r.command.cancellationAttempt||r.command.phase!=='PREPARED')throw Error('This staffing confirmation is unavailable or already attempted. Read its original outcome.');
   if(r.command.coverallAttempt&&(r.command.coverallAttempt.phase!=='PREPARED'||!permissions(auth).coverall))throw Error('Verified original CoverAll preparation and permission required.');
   validateStaffingPreview(reviewed,r);if(sending)throw Error('Original staffing work is already in progress.');sending=true;
   try{
    const current=await readCommand(r);const latest=read();
    requireCurrentStaffingDate(current,r);
    if(current.state!=='PREPARED'||current.preview_digest!==reviewed.preview_digest||current.input_digest!==reviewed.input_digest
      ||current.candidate_set_digest!==reviewed.candidate_set_digest||JSON.stringify(current.preview)!==JSON.stringify(reviewed.preview))throw Error('The staffing preview changed before confirmation.');
    if(latest.command.coverallAttempt&&!permissions(auth).coverall)throw Error('CoverAll permission changed before the original confirmation.');
    const confirmationKey=nonce();if(!UUID.test(confirmationKey||''))throw Error('An exact confirmation identity is required.');
    const attempted={...latest,command:{...latest.command,phase:'CONFIRMING',confirmationAttempted:true,confirmationKey}};save(attempted);
    await commandCall(attempted,staffingCommandPath+'/'+latest.command.operationId+'/confirm',{
      method:'POST',body:JSON.stringify({preview_digest:latest.command.previewDigest,confirmation_key:confirmationKey})});
    return await readCommand(read());
   }finally{sending=false;}
  },
  async run(path,body){if(read())throw Error('Resolve the saved scheduler request before submitting another change.');identity();
   if(commandRoute(path)&&path.endsWith('/cancel'))throw Error('Cancel only the exact saved unpublished preparation through its original control.');
   if(staffingOperation(path)==='vacate_roster_slot')throw Error('Review the genuine vacancy candidate first. Old saved vacancy work may only read its original outcome.');
   if(!authorized(auth,path,body)||!Number.isSafeInteger(body?.expected_revision)||body.expected_revision<0||typeof body.idempotency_key!=='string'||!body.idempotency_key)throw Error('This scheduler change is not authorized or complete.');
   const r={schema:'custodial.scheduler-pending.v1',base,managerId:owner.managerId,path,body:copy(body),encoded:JSON.stringify(body),state:'PENDING',receipt:null,error:null};if(staffingOperation(path))staffingRequest(r);save(r);return send(r);
  },
  async retry(){const r=read();if(!r)throw Error('No saved scheduler request.');if(r.state==='REJECTED')throw Error('This request was conclusively rejected. Refresh and dismiss it before entering a corrected change.');if(r.state==='ACCEPTED')return r.receipt;if(isStaffingCommand(r)){if(sending)throw Error('Staffing request is already in progress.');sending=true;try{return await reviewCommand(r);}finally{sending=false;}}if(staffingOperation(r.path)){if(sending)throw Error('Staffing request is already in progress.');sending=true;try{return await readStaffing(r);}finally{sending=false;}}return send({...r,state:'PENDING',error:null});},
  acknowledge(snapshot){const r=read();if(!r||r.state!=='ACCEPTED')return false;const p=receiptProjection(r.receipt);
   if(isStaffingCommand(r)){
    return acknowledgeStaffing([snapshot]);
   }
   if(staffingOperation(r.path)){const date=new Date(r.body.effective_start+'T12:00:00Z');date.setUTCDate(date.getUTCDate()-(date.getUTCDay()+6)%7);
    if(!acceptedStaffing(r.receipt,r)||snapshot?.week_start!==date.toISOString().slice(0,10)
     ||!Number.isSafeInteger(snapshot.authority_revision)||snapshot.authority_revision<r.receipt.receipt.revision)return false;
    if(staffingOperation(r.path)==='vacate_roster_slot'&&r.receipt.receipt.data?.completion_mode==='projection_required'){
     const projection=receiptProjection(r.receipt.receipt),slot=r.path.split('/')[3];
     const rows=snapshot.roster?.filter(row=>row.slot_id===slot),dated=rows?.[0]?.week_staffing?.filter(row=>row.service_date===r.body.effective_start);
     if(snapshot.authority_revision!==r.body.expected_revision+2||snapshot.authority_revision!==r.receipt.receipt.revision
      ||snapshot.projection_status!=='current'||snapshot.current_publication?.publication_id!==projection.publication_id
      ||snapshot.latest_projection?.projection_id!==projection.projection_id||snapshot.latest_projection.replay_digest!==projection.replay_digest
      ||rows?.length!==1||dated?.length!==1||dated[0].person_id!==null||dated[0].availability_state!=='vacant_unfilled')return false;
    }
    // Clear this manager's verified UI command only. Never inventory ACK,
    // phone release, original native work destruction or key removal.
    storage.removeItem(key);if(storage.getItem(key)!==null)throw Error('Accepted staffing receipt could not be cleared.');onState(null);return true;}
   if(snapshot?.week_start!==r.body.week_start||snapshot.projection_status!=='current'||!Number.isSafeInteger(snapshot.authority_revision)||snapshot.authority_revision<r.receipt.revision
    ||!UUID.test(snapshot.latest_projection?.projection_id||''))return false;
   if(snapshot.authority_revision===r.receipt.revision&&snapshot.latest_projection.projection_id!==p.projection_id)return false;
   storage.removeItem(key);if(storage.getItem(key)!==null)throw Error('Accepted schedule receipt could not be cleared.');onState(null);return true;
  },
  acknowledgeStaffing,
  discardRejected(){const r=read();if(!r||r.state!=='REJECTED'||sending)throw Error('Only an explicitly rejected request may be dismissed.');storage.removeItem(key);if(storage.getItem(key)!==null)throw Error('Could not dismiss rejected request.');onState(null);},
  samePrincipal:()=>same(owner,principal(auth)),principal:copy(owner),
 });
}
const api=Object.freeze({validateCoverAllOptions,validateCoverAllDays,requireCoverAllSummary,coverAllWindow,create,permissions,principal,same,accepted,receiptProjection,authorized,staffingOperation,staffingRequest,acceptedStaffing,staffingCommandPath,isStaffingCommand,validateStaffingPreview,staffingWeeks,staffingBindings,readStaffingBindings,staffingSnapshotCovers,validateVacancyPreview,textDigest});root.MemphisSchedulerActions=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
