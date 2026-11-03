import assert from 'node:assert/strict';
import {postgresJsonbContentDigest as digest,canonicalAuthorityInput} from 'file:///mnt/ai_models/codex-preserved-custodial/current-source-staging-20261024/root-manager-recovery-20261027/FULL_PROGRAM_FIRST_TEST_IMPLEMENTATION_20261028/backend-audit-candidate/src/static-weekly-schedule-program.js';
import {contentDigest} from 'file:///mnt/ai_models/codex-preserved-custodial/current-source-staging-20261024/root-manager-recovery-20261027/FULL_PROGRAM_FIRST_TEST_IMPLEMENTATION_20261028/backend-audit-candidate/src/static-weekly-schedule-model.js';
import {prepareApprovedStaticTemplateProjection} from 'file:///mnt/ai_models/codex-preserved-custodial/current-source-staging-20261024/root-manager-recovery-20261027/FULL_PROGRAM_FIRST_TEST_IMPLEMENTATION_20261028/backend-audit-candidate/src/static-weekly-recurring-staffing-adaptation.js';
import {mapLegacyContractorCapacitySourceData} from 'file:///mnt/ai_models/codex-preserved-custodial/current-source-staging-20261024/root-manager-recovery-20261027/FULL_PROGRAM_FIRST_TEST_IMPLEMENTATION_20261028/backend-audit-candidate/src/static-weekly-contractor-source-transition.js';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const date=value=>{assert.match(value,/^\d{4}-\d{2}-\d{2}$/);assert.equal(new Date(value+'T12:00:00Z').toISOString().slice(0,10),value);return value;};
const active=(row,at)=>row.effectiveStart<=at&&(row.effectiveEnd===null||at<row.effectiveEnd);
const history=row=>({personId:row.personId,displayName:row.displayName,effectiveStart:row.effectiveStart,effectiveEnd:row.effectiveEnd});

// Convert an explicit trusted readback into a proposed source/append-only
// transfer. Never bootstrap a populated roster or copy candidate-only history.
// This pure preparer cannot assert freshness, execute writers, grant devices,
// deactivate employees or authorize a publication. The normal atomic command
// must re-read the exact bound revision, parent and ranges before any write.
export function prepareApprovedManualRosterTransition({week,draft,snapshot,effectiveStart}){
 assert.equal(snapshot.schema,'custodial.manual-live-roster-readback.v1');
 const at=date(effectiveStart);assert.equal(at,date(snapshot.serviceDate),'NOW uses the server operational date, not a guessed civil date or future Monday');
 assert.ok(Number.isSafeInteger(snapshot.authorityRevision)&&snapshot.authorityRevision>=0);
 const parent=snapshot.parentPublication;assert.ok(parent);
 for(const key of ['publicationId','versionId','sourceId'])assert.match(parent[key],UUID);
 assert.ok(date(parent.effectiveStart)<=at);
 assert.equal(draft.schema,'custodial.approved-manual-source-draft.v1');
 const {sourceDraftDigest,...draftBody}=draft;assert.equal(digest(draftBody),sourceDraftDigest);
 assert.equal(draft.manualDataDigest,week.dataDigest);assert.equal(week.activation.ownerApproved,true);
 assert.ok(Array.isArray(snapshot.rosterSlots)&&Array.isArray(snapshot.employees));
 const slots=new Map(),employees=new Map();
 for(const slot of snapshot.rosterSlots){
  assert.match(slot.slotId,UUID);assert.ok(!slots.has(slot.slotId));assert.ok(slot.label&&slot.slotCode);
  assert.ok(Array.isArray(slot.incumbencies));
  const ids=new Set();
  for(const row of slot.incumbencies){
   assert.match(row.incumbencyId,UUID);assert.match(row.personId,UUID);assert.ok(!ids.has(row.incumbencyId));ids.add(row.incumbencyId);
   assert.ok(row.displayName);date(row.effectiveStart);if(row.effectiveEnd!==null)assert.ok(date(row.effectiveEnd)>row.effectiveStart);
  }
  const sorted=[...slot.incumbencies].sort((a,b)=>a.effectiveStart.localeCompare(b.effectiveStart));
  for(let i=1;i<sorted.length;i++)assert.ok(sorted[i-1].effectiveEnd!==null&&sorted[i-1].effectiveEnd<=sorted[i].effectiveStart,'Overlapping live roster ranges require resolution');
  slots.set(slot.slotId,slot);
 }
 for(const e of snapshot.employees){assert.match(e.employeeId,UUID);assert.ok(!employees.has(e.employeeId));employees.set(e.employeeId,e);}
 const source=structuredClone(draft.sourceDraft),transfers=[],unchanged=[],preservedSlots=[],wantedSlots=new Set(week.referenceBindings.people.map(p=>p.slotId));
 for(const slot of source.slots){
  const live=slots.get(slot.id);assert.ok(live,'The proposed source contains a position absent from the live roster');
  slot.label=live.label;slot.incumbencies=live.incumbencies.map(history);
  if(!wantedSlots.has(slot.id))preservedSlots.push({slotId:slot.id,liveRangeDigest:digest(live)});
 }
 for(const desired of week.referenceBindings.people){
  const employee=employees.get(desired.employeeId);assert.ok(employee,'Existing employee identity missing');
  assert.equal(employee.displayName,desired.approvedName);assert.match(employee.employeeCode,/^EMP\d+$/);
  assert.equal(employee.active,true,'Employee activation must use its normal onboarding control');
  assert.equal(employee.hasMessenger,true,'Reuse the existing Messenger principal; do not fabricate one');
  const live=slots.get(desired.slotId),target=source.slots.find(s=>s.id===desired.slotId);assert.ok(live&&target);
  const current=live.incumbencies.filter(r=>active(r,at));assert.ok(current.length<=1);
  for(const other of snapshot.rosterSlots)if(other.slotId!==desired.slotId)
   assert.ok(!other.incumbencies.some(r=>r.personId===desired.employeeId&&(r.effectiveEnd===null||at<r.effectiveEnd)),
    'Employee already has another current or future stable position');
  if(current[0]?.personId===desired.employeeId){
   assert.equal(current[0].displayName,desired.approvedName);
   assert.ok(!live.incumbencies.some(r=>r.effectiveStart>at),'Future authority needs explicit reconciliation');
   unchanged.push({slotId:desired.slotId,employeeId:desired.employeeId,incumbencyId:current[0].incumbencyId});continue;
  }
  assert.ok(!live.incumbencies.some(r=>r.effectiveStart>=at),'Current-day or future authority cannot be replaced by a guessed retry');
  let closure=null;
  if(current.length){
   const prior=current[0];assert.ok(prior.effectiveStart<at);
   closure={incumbencyId:prior.incumbencyId,personId:prior.personId,displayName:prior.displayName,
    effectiveStart:prior.effectiveStart,previousEffectiveEnd:prior.effectiveEnd,closeAt:at};
   const row=target.incumbencies.find(r=>r.personId===prior.personId&&r.effectiveStart===prior.effectiveStart);
   assert.ok(row);row.effectiveEnd=at; // PROJECTED data only; immutable rows are never edited.
  }
  target.incumbencies.push({personId:desired.employeeId,displayName:desired.approvedName,effectiveStart:at,effectiveEnd:null});
  transfers.push({slotId:desired.slotId,slotLabel:live.label,employeeId:desired.employeeId,employeeName:desired.approvedName,
   effectiveStart:at,operation:closure?'REASSIGN_EXISTING_EMPLOYEE':'ASSIGN_EXISTING_EMPLOYEE_TO_EMPTY_SLOT',closure,
   expectedLiveRangeDigest:digest(live),newEmployeeCreated:false,messengerPrincipalCreated:false,phoneAssignment:null});
 }
 source.serviceDate=at;source.version.effectiveStart=at;
 const untouched=snapshot.rosterSlots.filter(s=>!source.slots.some(t=>t.id===s.slotId)).map(s=>({slotId:s.slotId,liveRangeDigest:digest(s)}));
 const body={schema:'custodial.approved-manual-roster-transition.v1',status:'PREPARED_NOT_ADMITTED',
  serviceDate:at,expectedRevision:snapshot.authorityRevision,parentPublication:structuredClone(parent),
  readbackDigest:digest(snapshot),manualDataDigest:week.dataDigest,sourceDraftDigest,
  projectedSourceDraft:source,transfers,unchanged,preservedReferencedSlots:preservedSlots,unreferencedSlotsToPreserve:untouched,
  liveSlotCount:snapshot.rosterSlots.length,initialBootstrap:false,historyRewrite:false,productionWritten:false,
  registrationEligible:false,publicationEligible:false,normalAtomicAdmissionRequired:true,
  currentDateWeeklyAdmissionProven:false,normalScheduleOptimizationUsed:false,
  activationTiming:'AS_SOON_AS_READY_AND_VERIFIED',futureMondayHold:false};
 return{...body,transitionDigest:digest(body)};
}

// Prepare separate nonemployee capacity DATA using the maintained transition
// mapping. Do not feed this to the Source301 registration/activation command:
// fresh dependency/registry checks and atomic enrollment still belong to the
// native successor. Existing roster/history and all normal duties stay intact.
export function prepareApprovedManualCapacityTransition({week,draft,snapshot,selection}){
 const before=digest({week,draft,snapshot,selection}),
  roster=prepareApprovedManualRosterTransition({week,draft,snapshot,effectiveStart:snapshot.serviceDate}),
  mapped=mapLegacyContractorCapacitySourceData({source:roster.projectedSourceDraft,selection,
   allSlotIds:snapshot.rosterSlots.map(s=>s.slotId),serviceDate:roster.serviceDate}),
  source=mapped.candidate;
 assert.deepEqual(source.version,roster.projectedSourceDraft.version,'Capacity mapping cannot change any approved normal assignment, lunch or shift');
 const body={schema:'custodial.approved-manual-capacity-transition.v1',status:'DATA_REQUIRES_NATIVE_ATOMIC_ADMISSION',
  serviceDate:roster.serviceDate,expectedRevision:roster.expectedRevision,rosterReadbackDigest:roster.readbackDigest,
  normalRosterTransitionDigest:roster.transitionDigest,selection:structuredClone(selection),selectionDigest:digest(selection),
  projectedSourceDraft:source,projectedSourceDigest:digest(source),
  unchangedPositionIds:mapped.ordinary.map(s=>s.id),historicalCapacitySlotIds:mapped.legacy.map(s=>s.id),newCapacityIds:[...mapped.newIds],
  preservedLiveHistoryDigests:snapshot.rosterSlots.map(s=>({slotId:s.slotId,digest:digest(s)})),
  existingRosterPositions:snapshot.rosterSlots.length,additionalNonemployeeCapacityPositions:8,
  expectedTotalRosterPositions:snapshot.rosterSlots.length+8,employeeRowsCreated:0,legacyRowsChanged:false,normalSchedulesChanged:false,
  source301AdmissionEligible:false,registrationEligible:false,publicationEligible:false,productionWritten:false,
  requiredBeforeAtomicAdmission:['FRESH_LEGACY_DEPENDENCY_CHECKS','FRESH_EXISTING_CAPACITY_REGISTRATIONS',
   'SOURCE_BOUND_REGISTRY_AND_ROSTER_CAS','SAME_TRANSACTION_SOURCE_CAPACITY_ROSTER_NORMAL_PUBLICATION_AND_LUNCH']};
 assert.equal(digest({week,draft,snapshot,selection}),before);
 return{...body,capacityTransitionDigest:digest(body)};
}

// Prepare the EXISTING fixed-pattern adapter for the server's actual date.
// Trim only the compiler's seven-day view; the transition retains all original
// history and the SQL command appends closures/new ranges atomically. UUIDs are
// explicit new source/version identities, never guessed employee identities.
export function prepareApprovedManualActivationPackage({week,draft,snapshot,sourceId,versionId,templatePublicationId,templateId,packetId,managerId}){
 for(const id of [sourceId,versionId,templatePublicationId,packetId,managerId])assert.match(id,UUID);
 assert.ok(typeof templateId==='string'&&templateId.length>0&&templateId.length<=128);
 const transition=prepareApprovedManualRosterTransition({week,draft,snapshot,effectiveStart:snapshot.serviceDate}),
  at=transition.serviceDate,end=new Date(Date.parse(at+'T12:00:00Z')+6*86400000).toISOString().slice(0,10),
  raw=structuredClone(transition.projectedSourceDraft),config=structuredClone(draft.ownerConfig);
 delete raw.publicationAuthority;Object.assign(raw.version,{id:versionId,publicationId:templatePublicationId,status:'published',effectiveStart:at});
 config.effectiveDate=at;
 for(const slot of raw.slots)if(slot.kind!=='CONTRACTOR_CAPACITY')slot.incumbencies=slot.incumbencies.filter(r=>r.effectiveStart<=end&&(r.effectiveEnd===null||r.effectiveEnd>at));
 const vacant=raw.slots.filter(s=>s.kind!=='CONTRACTOR_CAPACITY'&&!s.incumbencies.length).map(s=>s.id).sort();
 assert.ok(vacant.every(id=>raw.version.vacancyCapableSlotIds.includes(id)),'No missing live incumbent may become an invented vacancy');
 raw.version.vacantSlotIds=vacant;
 const source=canonicalAuthorityInput(raw.version,raw.slots,[],raw.proximity,at),roleSlotIds=week.referenceBindings.people.map(p=>p.slotId).sort(),
  template={templateId,staffingCount:8,source,roleSlotIds},binding={schema:'custodial.approved-static-template-binding.v1',
   templateId,staffingCount:8,sourceDigest:contentDigest(source),roleSlotIdsDigest:contentDigest(roleSlotIds),
   patternAuthority:'OWNER_APPROVED_OPERATIONAL_PATTERN',artifactSha256:week.zipSha256,
   ownerConfigDigest:contentDigest(config),patternPublicationStatus:'UNPUBLISHED_LOCAL_CANDIDATE'},
  feasibility=prepareApprovedStaticTemplateProjection({templates:[template],admittedBindings:[binding],
   currentSource:source,currentOwnerConfig:config,selection:{schema:'custodial.static-template-selection.v1',kind:'INITIAL_BASELINE',
    templateId,serviceDate:at,availablePersonIds:week.referenceBindings.people.map(p=>p.employeeId)}});
 assert.equal(feasibility.solverInvoked,false);assert.equal(feasibility.mapping.unchanged,true);
 assert.equal(feasibility.initialBaseline.projection.week_start,at);assert.equal(feasibility.initialBaseline.projection.week_end,end);
 assert.equal(feasibility.projectionAssignments.length,346);assert.equal(feasibility.lunch.lunches.length,40);
 const dates=[...new Set(feasibility.projectionAssignments.map(r=>r.service_date))].sort();
 assert.equal(dates.length,7);assert.equal(dates[0],at);assert.equal(dates[6],end);
 const body={schema:'custodial.approved-manual-activation-package.v1',packetId,sourceId,managerId,templateId,
  serviceDate:at,windowEnd:end,transition,source,ownerConfig:config,template,binding,feasibility,
  approvalEvidence:{classification:'OWNER_APPROVED_OPERATIONAL_PATTERN',artifactSha256:week.zipSha256,
   sourceReference:'config/schedules/manual-approved-20261030/packet#'+week.manifestSha256,
   ownerDecisionReference:'codex-chat:01a15718-2d88-7de1-8cec-6cdc241f0151; seven locked normal days; activate as soon as ready and verified'},
  weeklyBaselineChanged:false,historyRewrite:false,newEmployeeCreated:false,messengerPrincipalCreated:false,
  registered:false,publicationEligible:false,productionWritten:false};
 return{...body,packageDigest:digest(body)};
}
