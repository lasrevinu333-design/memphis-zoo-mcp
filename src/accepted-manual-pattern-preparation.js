// Fixed accepted-pattern DATA for a normal native source/template update.
// No first-enrollment capacity mapping, new capacity identities or optimizer.
import assert from 'node:assert/strict';
import {postgresJsonbContentDigest as digest,canonicalAuthorityInput} from './static-weekly-schedule-program.js';
import {contentDigest} from './static-weekly-schedule-model.js';
import {prepareApprovedManualSourceDraft} from './approved-manual-source-draft.js';
import {prepareApprovedManualRosterTransition} from './approved-manual-roster-transition.js';
import {prepareApprovedStaticTemplateProjection} from './static-weekly-recurring-staffing-adaptation.js';
import {acceptedManualPatternProfile} from './accepted-manual-pattern-profiles.js';
import {acceptedSevenOnCallLunchAuthority} from './accepted-seven-on-call-lunch.js';
import {withAcceptedSevenTetonReminder} from './accepted-seven-teton-reminder.js';
const clone=structuredClone;
const uuid=v=>assert.match(v,/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
export function prepareAcceptedManualPatternSourceData({week,referenceBytes,currentSourceRecord,snapshot,
 sourceId,versionId,templatePublicationId,templateId}){
 const profile=acceptedManualPatternProfile(week.dataDigest);
 for(const v of [sourceId,versionId,templatePublicationId])uuid(v);
 assert.ok(typeof templateId==='string'&&templateId.length>0&&templateId.length<=128);
 assert.equal(snapshot.parentPublication.sourceId,currentSourceRecord.source_id);
 assert.equal(digest(currentSourceRecord.canonical_source),currentSourceRecord.source_digest);
 const current=currentSourceRecord.canonical_source,
  draft=prepareApprovedManualSourceDraft({week,referenceBytes}),raw=clone(draft.sourceDraft);
 assert.equal(week.referenceBindings.people.length,profile.staff);
 assert.equal(raw.version.assignments.length,profile.assignments);
 assert.equal(raw.version.slotAvailability.length,profile.lunches);
 assert.equal(draft.restrictionConflicts.length,0);
 const ordinary=s=>s.kind!=='CONTRACTOR_CAPACITY'&&!s.contractorCapacity;
 assert.deepEqual(raw.slots.filter(ordinary).map(s=>s.id).sort(),current.slots.filter(ordinary).map(s=>s.id).sort(),
  'The existing normal positions must remain identical');
 const typed=current.slots.filter(s=>s.kind==='CONTRACTOR_CAPACITY');assert.equal(typed.length,8);
 for(const s of typed)assert.deepEqual(s.incumbencies,[],'Existing native nonemployee capacity must stay nonemployee');
 assert.deepEqual(raw.proximity,current.proximity,'Do not silently replace current travel facts');
 // Reuse the already registered native capacity slots, not the historical
 // predecessor's pseudo-employees or eight freshly generated replacements.
 raw.slots=clone(current.slots);
 assert.deepEqual([...raw.version.vacancyCapableSlotIds].sort(),[...current.version.vacancyCapableSlotIds].sort());
 raw.version.vacantSlotIds=clone(current.version.vacantSlotIds);
 if(profile.staff===7){
  raw.version.manualGroupRatingAuthority.acceptedCandidateSha256=week.acceptedStaticPattern.artifactSha256;
  raw.version.manualGroupRatingAuthority.acceptedManualDataDigest=week.dataDigest;
  raw.version.manualGroupRatingAuthority.acceptedSevenOnCallLunch=acceptedSevenOnCallLunchAuthority();
  raw.version=withAcceptedSevenTetonReminder({week,version:raw.version});
 }
 const {sourceDraftDigest,...body}=draft,hydrated={...body,sourceDraft:raw,
  existingCapacityHydration:{sourceId:currentSourceRecord.source_id,sourceDigest:currentSourceRecord.source_digest,
   capacitySlotIds:typed.map(s=>s.id).sort(),newPositionsCreated:0}};
 const next={...hydrated,sourceDraftDigest:digest(hydrated)};
 const transition=prepareApprovedManualRosterTransition({week,draft:next,snapshot,effectiveStart:snapshot.serviceDate});
 const at=snapshot.serviceDate,end=new Date(Date.parse(at+'T12:00Z')+6*86400000).toISOString().slice(0,10),
  proposed=clone(transition.projectedSourceDraft),config=clone(next.ownerConfig);
 delete proposed.publicationAuthority;
 Object.assign(proposed.version,{id:versionId,publicationId:templatePublicationId,status:'published',effectiveStart:at});
 config.effectiveDate=at;
 for(const s of proposed.slots)if(s.kind!=='CONTRACTOR_CAPACITY')
  s.incumbencies=s.incumbencies.filter(i=>i.effectiveStart<=end&&(i.effectiveEnd===null||i.effectiveEnd>at));
 proposed.version.vacantSlotIds=proposed.slots.filter(s=>s.kind!=='CONTRACTOR_CAPACITY'&&!s.incumbencies.length).map(s=>s.id).sort();
 assert.ok(proposed.version.vacantSlotIds.every(id=>proposed.version.vacancyCapableSlotIds.includes(id)));
 const source=canonicalAuthorityInput(proposed.version,proposed.slots,[],proposed.proximity,at),
  roleSlotIds=week.referenceBindings.people.map(p=>p.slotId).sort(),
  artifactSha256=week.acceptedStaticPattern?.artifactSha256??week.zipSha256,
  template={templateId,staffingCount:profile.staff,source,roleSlotIds},
  binding={schema:'custodial.approved-static-template-binding.v1',templateId,staffingCount:profile.staff,
   sourceDigest:contentDigest(source),roleSlotIdsDigest:contentDigest(roleSlotIds),
   patternAuthority:'OWNER_APPROVED_OPERATIONAL_PATTERN',artifactSha256,ownerConfigDigest:contentDigest(config),
   patternPublicationStatus:'UNPUBLISHED_LOCAL_CANDIDATE'};
 return {schema:'custodial.accepted-manual-pattern-source-data.v1',sourceId,templateId,
  acceptedArtifactSha256:artifactSha256,manualDataDigest:week.dataDigest,profile,
  currentSourceId:currentSourceRecord.source_id,currentSourceDigest:currentSourceRecord.source_digest,
  serviceDate:at,windowEnd:end,expectedRevision:snapshot.authorityRevision,transition,
  source,ownerConfig:config,template,binding,
  registrationEligible:false,publicationEligible:false,registered:false,published:false,
  productionWritten:false,newCapacityPositions:0,optimizerInvoked:false};
}
export function prepareAcceptedManualPatternData(input){
 const data=prepareAcceptedManualPatternSourceData(input),{source,ownerConfig,template,binding,profile,templateId,serviceDate}=data;
 const feasibility=prepareApprovedStaticTemplateProjection({templates:[template],admittedBindings:[binding],
  currentSource:source,currentOwnerConfig:ownerConfig,selection:{schema:'custodial.static-template-selection.v1',
   kind:'INITIAL_BASELINE',templateId,serviceDate,availablePersonIds:input.week.referenceBindings.people.map(p=>p.employeeId)}});
 assert.equal(feasibility.solverInvoked,false);assert.equal(feasibility.mapping.unchanged,true);
 assert.equal(feasibility.projectionAssignments.length,profile.assignments);
 assert.equal(feasibility.lunch.lunches.length,profile.lunches);
 assert.equal(feasibility.initialBaseline.projection.week_start,serviceDate);
 assert.equal(feasibility.initialBaseline.projection.week_end,data.windowEnd);
 return {...data,schema:'custodial.accepted-manual-pattern-data.v1',feasibility};
}
