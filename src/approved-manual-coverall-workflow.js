// Current-date activation and original-operation CoverAll DATA only.
import assert from 'node:assert/strict';
import {contentDigest,snapshotContractorCapacity} from './static-weekly-schedule-model.js';
import {canonicalAuthorityInput,postgresJsonbContentDigest as digest} from './static-weekly-schedule-program.js';
import {prepareApprovedManualCapacityTransition,prepareApprovedManualRosterTransition,projectApprovedManualRosterSnapshot} from './approved-manual-roster-transition.js';
import {prepareApprovedStaticTemplateProjection} from './static-weekly-recurring-staffing-adaptation.js';
import {applyApprovedManualCoverAllSubstitute,readApprovedManualAbsenceObjective} from './approved-manual-absence.js';
import {approvedManualStaffingWorkerInput,approvedManualPeriodStaffingFacts} from './approved-manual-staffing-transport.js';
import {captureApprovedManualPeriodWorkerInput,captureApprovedManualPeriodWorkerResult} from './approved-manual-period-worker.js';
import {approvedManualEmploymentPeriod,approvedManualEmploymentChanges} from './approved-manual-employment-integration.js';
const clone=structuredClone;
const exact=(v,ks)=>{assert.ok(v&&typeof v==='object'&&!Array.isArray(v));assert.deepEqual(Object.keys(v).sort(),[...ks].sort());};
const uuid=v=>{assert.equal(typeof v,'string');assert.match(v,/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);return v;};
const hash=v=>{assert.equal(typeof v,'string');assert.match(v,/^[a-f0-9]{64}$/);return v;};
const rev=v=>{assert.ok(Number.isSafeInteger(v)&&v>=0&&v<Number.MAX_SAFE_INTEGER);};
const date=v=>{assert.match(v,/^[12]\d{3}-\d{2}-\d{2}$/);assert.equal(new Date(v+'T12:00Z').toISOString().slice(0,10),v);return v;};
function original(c){
 exact(c,['operationId','preparerId','semanticBody','semanticDigest','expectedRevision','currentServiceDate','originalCancellationTarget']);
 uuid(c.operationId);uuid(c.preparerId);rev(c.expectedRevision);date(c.currentServiceDate);hash(c.semanticDigest);
 exact(c.semanticBody,['absenceKind','commandKind','employeeId','endDate','startDate','targetAbsenceId']);
 assert.equal(digest(c.semanticBody),c.semanticDigest);uuid(c.semanticBody.employeeId);date(c.semanticBody.startDate);date(c.semanticBody.endDate);
 assert.ok(c.semanticBody.startDate>=c.currentServiceDate&&c.semanticBody.endDate>=c.semanticBody.startDate);
 assert.ok(['absence','cancel_absence'].includes(c.semanticBody.commandKind));assert.ok(['pto','daily_absence','unavailable'].includes(c.semanticBody.absenceKind));
 return c;
}
// Reuse the shared mapper and fixed-pattern adapter exactly once. No future-
// Monday bridge, optimizer, employee creation or history replacement occurs.
export function prepareApprovedManualCoverAllActivation({week,draft,snapshot,selection,
 sourceId,versionId,templatePublicationId,templateId,packetId,managerId}){
 snapshot=projectApprovedManualRosterSnapshot(snapshot);
 for(const id of [sourceId,versionId,templatePublicationId,packetId,managerId])uuid(id);
 assert.ok(typeof templateId==='string'&&templateId.length>0&&templateId.length<=128);
 assert.equal(snapshot.rosterSlots.length,22,'Fresh existing22-position snapshot required');
 const transition=prepareApprovedManualRosterTransition({week,draft,snapshot,effectiveStart:snapshot.serviceDate}),
  capacityTransition=prepareApprovedManualCapacityTransition({week,draft,snapshot,selection}),
  raw=clone(capacityTransition.projectedSourceDraft),config=clone(draft.ownerConfig),at=date(snapshot.serviceDate),
  end=new Date(Date.parse(at+'T12:00Z')+6*86400000).toISOString().slice(0,10);
 delete raw.publicationAuthority;Object.assign(raw.version,{id:versionId,publicationId:templatePublicationId,status:'published',effectiveStart:at});config.effectiveDate=at;
 for(const s of raw.slots)if(s.kind!=='CONTRACTOR_CAPACITY')s.incumbencies=s.incumbencies.filter(i=>i.effectiveStart<=end&&(i.effectiveEnd===null||i.effectiveEnd>at));
 raw.version.vacantSlotIds=raw.slots.filter(s=>s.kind!=='CONTRACTOR_CAPACITY'&&!s.incumbencies.length).map(s=>s.id).sort();
 assert.ok(raw.version.vacantSlotIds.every(id=>raw.version.vacancyCapableSlotIds.includes(id)));
 const source=canonicalAuthorityInput(raw.version,raw.slots,[],raw.proximity,at),roleSlotIds=week.referenceBindings.people.map(p=>p.slotId).sort(),
  template={templateId,staffingCount:8,source,roleSlotIds},binding={schema:'custodial.approved-static-template-binding.v1',templateId,staffingCount:8,
   sourceDigest:contentDigest(source),roleSlotIdsDigest:contentDigest(roleSlotIds),patternAuthority:'OWNER_APPROVED_OPERATIONAL_PATTERN',
   artifactSha256:week.zipSha256,ownerConfigDigest:contentDigest(config),patternPublicationStatus:'UNPUBLISHED_LOCAL_CANDIDATE'},
  feasibility=prepareApprovedStaticTemplateProjection({templates:[template],admittedBindings:[binding],currentSource:source,currentOwnerConfig:config,
   selection:{schema:'custodial.static-template-selection.v1',kind:'INITIAL_BASELINE',templateId,serviceDate:at,availablePersonIds:week.referenceBindings.people.map(p=>p.employeeId)}});
 assert.equal(feasibility.solverInvoked,false);assert.equal(feasibility.projectionAssignments.length,346);assert.equal(feasibility.lunch.lunches.length,40);
 const typed=source.slots.filter(s=>s.kind==='CONTRACTOR_CAPACITY');assert.equal(typed.length,8);
 for(const s of typed){assert.deepEqual(s.incumbencies,[]);assert.equal(snapshotContractorCapacity(s,at).personId,null);}
 const body={schema:'custodial.approved-manual-coverall-activation-data.v1',packetId,sourceId,managerId,templateId,serviceDate:at,windowEnd:end,
  transition,capacityTransition,source,sourceDigest:digest(source),ownerConfig:config,template,binding,feasibility,
  approvalEvidence:{classification:'OWNER_APPROVED_OPERATIONAL_PATTERN',artifactSha256:week.zipSha256,
   sourceReference:'config/schedules/manual-approved-20261030/packet#'+week.manifestSha256,
   ownerDecisionReference:'codex-chat:01a15718-2d88-7de1-8cec-6cdc241f0151; seven locked normal days; source-bound nonemployee capacity'},
  currentPositions:22,additionalCapacityPositions:8,prospectivePositions:30,newEmployees:0,weeklyBaselineChanged:false,
  registered:false,published:false,productionWritten:false};
 return {...body,activationDataDigest:digest(body)};
}
// Basis/retained projection must be freshly supplied by Main's owner RPC. An
// actual-hours checkbox in caller DATA is not accepted until its SQL companion.
export function prepareApprovedManualCoverAllChoice({originalCommand,basis,choiceId,days}){
 original(originalCommand);uuid(choiceId);assert.equal(originalCommand.semanticBody.commandKind,'absence');
 assert.equal(originalCommand.semanticBody.targetAbsenceId,null);
 assert.ok(Array.isArray(days)&&days.length>0&&days.length<=366);
 assert.equal(basis.originalCommand.operationId,originalCommand.operationId);assert.deepEqual(basis.originalCommand,originalCommand);
 const seen=new Set(),selected=[],overlays=[];
 for(const day of days){
  exact(day,['serviceDate','sourceId','publicationId','capacityId','shift','lunch','lunchCovererSlotId','confirmationReference','actualHoursConfirmed']);
  date(day.serviceDate);uuid(day.sourceId);uuid(day.publicationId);uuid(day.capacityId);uuid(day.lunchCovererSlotId);
  assert.ok(day.serviceDate>=originalCommand.semanticBody.startDate&&day.serviceDate<=originalCommand.semanticBody.endDate&&!seen.has(day.serviceDate));seen.add(day.serviceDate);
  assert.equal(day.actualHoursConfirmed,true);assert.ok(typeof day.confirmationReference==='string'&&day.confirmationReference.trim()===day.confirmationReference&&day.confirmationReference.length>0&&day.confirmationReference.length<=256);
  const retained=basis.retainedDays.find(p=>p.serviceDate===day.serviceDate);assert.ok(retained,'Actual retained accepted two-absence day is required');
  uuid(retained.projectionId);hash(retained.envelopeIdentity);assert.equal(retained.sourceId,day.sourceId);assert.equal(retained.publicationId,day.publicationId);
  const source=basis.normalSources.find(p=>p.sourceId===day.sourceId&&p.publicationId===day.publicationId
   &&digest(p.source)===retained.dayBasis.input.sourceDigest)?.source;assert.ok(source);
  assert.equal(digest(source),retained.dayBasis.input.sourceDigest);assert.equal(retained.dayBasis.input.absentPersonIds.length,2);
  assert.ok(!retained.dayBasis.input.absentPersonIds.includes(originalCommand.semanticBody.employeeId));
  const slot=source.slots.find(s=>s.id===day.capacityId);assert.equal(slot?.kind,'CONTRACTOR_CAPACITY');assert.deepEqual(slot.incumbencies,[]);
  snapshotContractorCapacity(slot,day.serviceDate);
  const overlay=applyApprovedManualCoverAllSubstitute({acceptedPlan:retained.dayBasis.plan,input:retained.dayBasis.input,
   proposal:readApprovedManualAbsenceObjective(),source,absentPersonId:originalCommand.semanticBody.employeeId,
   substitute:{slotId:day.capacityId,serviceDate:day.serviceDate,shift:day.shift,lunch:day.lunch,lunchCovererSlotId:day.lunchCovererSlotId,
    confirmationReference:day.confirmationReference,actualHoursConfirmed:true,managerConfirmed:true}});
  assert.equal(overlay.solverInvoked,false);assert.equal(overlay.otherNormalOwnersChanged,false);
  selected.push({...clone(day),retainedProjectionId:retained.projectionId,retainedEnvelopeIdentity:retained.envelopeIdentity,
   retainedPlanDigest:retained.dayBasis.plan.planDigest,overlayDigest:overlay.overlayDigest});overlays.push({serviceDate:day.serviceDate,overlay});
 }
 selected.sort((a,b)=>a.serviceDate.localeCompare(b.serviceDate));
 const body={schema:'custodial.approved-manual-coverall-choice.v1',choiceId,operationId:originalCommand.operationId,managerId:originalCommand.preparerId,
  semanticDigest:originalCommand.semanticDigest,expectedRevision:originalCommand.expectedRevision,days:selected,
  canonicalSemanticBody:clone(originalCommand.semanticBody),contractorBooked:false,vendorApprovalClaimed:false};
 return {status:'PREPARING_DATA_NOT_ACCEPTED',choice:{...body,choiceDigest:digest(body)},overlays};
}
export function approvedManualCoverAllWorkerInput({basis,week,actor,operationId,expectedRevision,frameStart,choice}){
 const {choiceDigest,...body}=choice;assert.equal(choiceDigest,digest(body));
 assert.equal(choice.operationId,operationId);assert.equal(choice.managerId,actor.managerId);assert.equal(choice.expectedRevision,expectedRevision);
 assert.equal(choice.semanticDigest,basis.originalCommand.semanticDigest);assert.deepEqual(choice.canonicalSemanticBody,basis.originalCommand.semanticBody);
 // The existing helper handles the exact canonical absence mathematics. The
 // SQL companion supplies the additional pending DATA separately, not as an
 // invented accepted fact or six-field staffing semantic change.
 const base=clone(approvedManualStaffingWorkerInput({basis,week,actor,operationId,expectedRevision,frameStart,pendingCoverAllChoice:choice}));
 if(base.employmentByDate)base.changes=approvedManualEmploymentChanges({week,changes:base.changes,employment:approvedManualEmploymentPeriod({frameStart,expectedRevision,employmentByDate:base.employmentByDate})});
 for(const day of choice.days.filter(d=>d.serviceDate>=frameStart&&d.serviceDate<=new Date(Date.parse(frameStart+'T12:00Z')+6*86400000).toISOString().slice(0,10))){
  const change=base.changes.find(c=>c.serviceDate===day.serviceDate);assert.equal(change?.absentPersonIds.length,3);
  change.substitute={slotId:day.capacityId,serviceDate:day.serviceDate,shift:clone(day.shift),lunch:clone(day.lunch),
   lunchCovererSlotId:day.lunchCovererSlotId,confirmationReference:day.confirmationReference,managerConfirmed:true,actualHoursConfirmed:true};
 }
 base.acceptedExceptions=clone(basis.preparedExceptions);return captureApprovedManualPeriodWorkerInput(base);
}

// Main owns BEGIN/COMMIT on ONE dedicated, already checked client. This helper
// never opens another client, releases the client, commits, or forges an original
// staffing command. The SQL deferred receipt makes an early COMMIT impossible.
export async function prepareApprovedManualCoverAllInitialOnCurrentTransaction({client,managerId,packetId,operationId,expectedRevision,previewDigest,
 credentialId,deviceId,sessionAccess,prepareOperational}){
 for(const id of [managerId,packetId,operationId,credentialId])uuid(id);rev(expectedRevision);hash(previewDigest);
 assert.ok(typeof deviceId==='string'&&deviceId.length>0);assert.ok(['full_access','read_only'].includes(sessionAccess));
 assert.equal(typeof client?.query,'function');assert.equal(typeof prepareOperational,'function');
 const first=await client.query('select pg_backend_pid() as pid,pg_current_xact_id()::text as xid'),physical=first.rows?.[0];
 assert.ok(Number.isSafeInteger(physical?.pid)&&physical.pid>0&&typeof physical.xid==='string'&&/^\d+$/.test(physical.xid));
 let originalConnection=true;
 async function same(){
  const next=(await client.query('select pg_backend_pid() as pid,pg_current_xact_id()::text as xid')).rows?.[0];
  if(!next||next.pid!==physical.pid||next.xid!==physical.xid){originalConnection=false;throw Object.assign(Error('Original activation physical client/transaction changed'),{code:'COVERALL_ACTIVATION_TRANSACTION_UNKNOWN',operationId});}
 }
 async function rpc(sql,args){await same();const r=await client.query(sql,args);assert.equal(r.rows?.length,1);return r.rows[0].value;}
 try{
  const beginning=await rpc('select public.static_weekly_begin_coverall_activation($1,$2,$3,$4,$5,$6,$7,$8) as value',
   [managerId,packetId,operationId,expectedRevision,previewDigest,credentialId,deviceId,sessionAccess]);
  assert.equal(beginning.schema,'custodial.coverall-initial-uncommitted.v1');assert.equal(beginning.operationId,operationId);
  assert.equal(beginning.managerId,managerId);assert.equal(beginning.transactionId,physical.xid);assert.equal(beginning.backendPid,physical.pid);
  assert.equal(beginning.committed,false);assert.equal(beginning.accepted,false);assert.equal(beginning.normalBaselineIsNotActualCoverage,true);
  assert.equal(beginning.basis.employmentByDate.length,7);assert.equal(beginning.basis.employmentRevisionVector.length,14);
  const native=await prepareOperational({kind:'INITIAL_EMPLOYMENT_OPERATIONALIZATION',operationId,managerId,beginning:clone(beginning),periodBasis:clone(beginning.basis),
   employmentByDate:clone(beginning.basis.employmentByDate),employmentRevisionVector:clone(beginning.basis.employmentRevisionVector)});
  assert.ok(native?.envelope&&native?.lunchDocument);assert.equal(native.envelope.semantic_snapshot?.initialActivation?.operationId,operationId);
  assert.deepEqual(native.envelope.authority?.employmentRevisionVector,beginning.basis.employmentRevisionVector);
  const staged=await rpc('select public.static_weekly_coverall_stage_initial_operational($1,$2,$3,$4) as value',[operationId,managerId,native.envelope,native.lunchDocument]);
  assert.equal(staged.state,'STAGED_UNCOMMITTED');assert.equal(staged.operationId,operationId);hash(staged.candidateDigest);assert.equal(staged.committed,false);
  const receipt=await rpc('select public.static_weekly_coverall_finalize_initial_operational($1,$2,$3) as value',[operationId,managerId,staged.candidateDigest]);
  assert.equal(receipt.schema,'custodial.approved-manual-coverall-source-confirmation.v2');assert.equal(receipt.operationId,operationId);
  assert.equal(receipt.kind,'INITIAL_EMPLOYMENT_OPERATIONALIZATION');assert.equal(receipt.status,'PERSISTED_CURRENT');
  assert.equal(receipt.sourceId,beginning.sourceId);assert.equal(receipt.publicationId,beginning.publicationId);assert.equal(receipt.samePhysicalTransaction,true);
  assert.deepEqual(receipt.employmentRevisionVector,beginning.basis.employmentRevisionVector);await same();
  return {state:'FINALIZED_IN_ORIGINAL_UNCOMMITTED_TRANSACTION',receipt,operationId,backendPid:physical.pid,transactionId:physical.xid,
   callerMustCommit:true,committed:false,readyForExternalResponse:false};
 }catch(error){
  if(originalConnection){try{await same();await client.query('ROLLBACK');error.coverAllOriginalTransactionRolledBack=true;}catch(rollbackError){error.coverAllOriginalTransactionState='UNKNOWN';}}
  error.operationId=operationId;throw error;
 }
}

// The initial owner request is not a canonical staffing absence. Prepare the
// existing v2 worker from real SQL basis/actual employment reads with NO fake
// six-field command, PTO row, solver receipt or attestation.
export function approvedManualCoverAllInitialWorkerInput({beginning,week}){
 assert.equal(beginning.schema,'custodial.coverall-initial-uncommitted.v1');assert.equal(beginning.committed,false);assert.equal(beginning.accepted,false);
 const b=beginning.basis,{basisDigest,...body}=b;assert.equal(basisDigest,digest(body));
 assert.equal(b.originalCommand,null);assert.equal(b.sourceId,beginning.sourceId);assert.equal(b.publicationId,beginning.publicationId);
 assert.equal(b.managerId,beginning.managerId);assert.equal(b.authorityRevision,beginning.authorityRevision);
 assert.equal(b.employmentByDate.length,7);assert.equal(b.employmentRevisionVector.length,14);
 const facts=approvedManualPeriodStaffingFacts({week,source:b.normalSource,exceptions:b.preparedExceptions,originalCommand:null});
 return captureApprovedManualPeriodWorkerInput({schema:'custodial.approved-manual-period-worker-input.v2',source:b.normalSource,ownerConfig:b.ownerConfig,
  frameStart:b.frameStart,changes:facts.changes,priorDays:b.priorDayBases,acceptedExceptions:b.preparedExceptions,priorProjection:b.priorProjection,
  actor:{managerId:b.managerId,managerName:b.actor.manager_name},expectedRevision:b.authorityRevision,idempotencyKey:'coverall-initial:'+beginning.operationId,
  employmentByDate:b.employmentByDate});
}
export function approvedManualCoverAllInitialNativeTransport({beginning,workerInput,workerResult}){
 const input=captureApprovedManualPeriodWorkerInput(workerInput),result=captureApprovedManualPeriodWorkerResult(workerResult,input),b=beginning.basis,n=result.nativeProjection;
 assert.ok(n&&result.period.status==='COMPLETE_VALIDATED_DATED_DRAFTS','Actual native v2 preparation must have complete validated DATA');
 assert.equal(input.schema,'custodial.approved-manual-period-worker-input.v2');assert.equal(input.idempotencyKey,'coverall-initial:'+beginning.operationId);
 assert.equal(input.actor.managerId,beginning.managerId);assert.equal(input.expectedRevision,beginning.authorityRevision);
 assert.equal(input.frameStart,b.frameStart);assert.equal(n.frameEnd,b.frameEnd);assert.equal(digest(input.source),b.normalSourceDigest);
 assert.deepEqual(n.authority.employmentRevisionVector,b.employmentRevisionVector);
 const authority={...clone(n.authority),compilerInput:clone(input.source)},authorityDigest=digest(authority),lunch=clone(n.lunchDocument);
 delete lunch.document_identity;delete lunch.base_authority_digest;delete lunch.base_replay_digest;
 const replayDigest=digest({projectionAssignments:n.projectionAssignments,lunchDocument:lunch}),
  adapter={schema:'custodial.approved-manual-period-database-adapter.v1',version:'approved-manual-period-v1'},
  envelope={adapter,service_date:input.frameStart,week_start:input.frameStart,week_end:n.frameEnd,authority,
   receipt:{schema:'custodial.approved-manual-native-feasibility-data.v1',nativePreparationDigest:n.projectionDataDigest,
    hardConstraintCount:authority.hardConstraintCount,hardConstraintDigest:authority.hardConstraintDigest,fixedWitnessDigest:authority.fixedWitnessDigest,selectionSolverInvoked:result.period.solverInvoked},
   authority_digest:authorityDigest,replay_digest:replayDigest,compiler_version:adapter.version,
   objective:{contract:'OWNER_APPROVED_MANUAL_DATED_75_25_V2',formulaObjectiveDigest:result.period.formulaObjectiveDigest,proximityPercent:75,workloadPercent:25,normalDaysOptimized:false},
   metrics:{hardConstraints:authority.hardConstraintCount,violations:0},applied_exceptions:clone(b.preparedSummary),assignments:clone(n.projectionAssignments),
   semantic_snapshot:{schema:'custodial.approved-manual-initial-employment-snapshot.v1',
    initialActivation:{operationId:beginning.operationId,managerId:beginning.managerId,sourceId:beginning.sourceId,publicationId:beginning.publicationId,authorityRevision:beginning.authorityRevision},
    originalSource:clone(b.originalSource),scopeDates:Array.from({length:7},(_,i)=>new Date(Date.parse(input.frameStart+'T12:00Z')+i*86400000).toISOString().slice(0,10)),
    weekStart:input.frameStart,generation:b.generation,catalogEntryDigest:b.catalogEntryDigest,nativeBasisDigest:b.basisDigest}};
 envelope.database_projection_identity=digest(envelope);
 const lunchDocument={...lunch,base_authority_digest:authorityDigest,base_replay_digest:replayDigest};lunchDocument.document_identity=digest(lunchDocument);
 return {envelope,lunchDocument};
}
