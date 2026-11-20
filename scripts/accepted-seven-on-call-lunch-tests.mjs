import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {readApprovedManualWeek} from '../src/approved-manual-week.js';
import {readAcceptedSevenManualWeek} from '../src/accepted-seven-manual-week.js';
import {prepareApprovedManualSourceDraft} from '../src/approved-manual-source-draft.js';
import {acceptedSevenOnCallLunchAuthority,validateAcceptedSevenOnCallLunch,isAcceptedSevenOnCallLunch} from '../src/accepted-seven-on-call-lunch.js';
import {prepareApprovedStaticTemplateProjection} from '../src/static-weekly-recurring-staffing-adaptation.js';
import {contentDigest,installStaticWeeklySha256HexAccelerator} from '../src/static-weekly-schedule-model.js';
import {assertNormalOwnerEligibility} from '../src/static-weekly-owner-eligibility.js';
installStaticWeeklySha256HexAccelerator(x=>createHash('sha256').update(x).digest('hex'));
let checks=0;const check=(name,fn)=>{fn();checks++;};
const week=readAcceptedSevenManualWeek(readApprovedManualWeek()),draft=prepareApprovedManualSourceDraft({week,referenceBytes:fs.readFileSync(new URL('../'+week.referenceBindings.reference.path,import.meta.url))});
const raw=structuredClone(draft.sourceDraft);delete raw.publicationAuthority;
raw.serviceDate='2026-11-16';Object.assign(raw.version,{id:'00000000-0000-4000-8000-000000007101',publicationId:'00000000-0000-4000-8000-000000007102',status:'published',effectiveStart:raw.serviceDate});
// Clearly fixture-only post-supported-vacancy shape. This creates no live
// roster readback, vacancy receipt, source registration or publication.
const kiltra='7044faec-4bbd-57ca-a898-ddd719503113';raw.slots.find(s=>s.id===kiltra).incumbencies=[];
raw.version.vacantSlotIds=[...new Set([...raw.version.vacantSlotIds,kiltra])].sort();
const config=structuredClone(draft.ownerConfig);config.effectiveDate=raw.serviceDate;
const beforeAssignments=JSON.stringify(raw.version.assignments),a=acceptedSevenOnCallLunchAuthority();
const version=()=>({lunchCoveragePolicy:{sourceDigest:week.dataDigest},manualGroupRatingAuthority:{manifestSha256:week.manifestSha256,
 acceptedCandidateSha256:week.acceptedStaticPattern.artifactSha256,acceptedManualDataDigest:week.dataDigest,acceptedSevenOnCallLunch:structuredClone(a)}});
const allowed=validateAcceptedSevenOnCallLunch(version()),work={locationCodeSnapshot:a.locationCode,locationId:a.locationId,includedLocations:[{locationId:a.locationId}]};
const scope=()=>({authority:allowed,dayOfWeek:5,normalOwnerSlotId:a.windows[0].normalOwnerSlotId,window:{start:'10:00',end:'11:00'},
 covererSlotId:a.helperSlotId,covererPersonId:a.helperEmployeeId,sourceNamedCovererSlotId:a.helperSlotId,entries:[{work:structuredClone(work)}]});
for(const window of a.windows)check('each approved exact on-call window',()=>assert.equal(isAcceptedSevenOnCallLunch({...scope(),dayOfWeek:window.dayOfWeek,normalOwnerSlotId:window.normalOwnerSlotId,window:{start:window.start,end:window.end}}),true));
for(const mutate of [s=>{s.dayOfWeek=1;},s=>{s.dayOfWeek=2;},s=>{s.window.start='09:59';},s=>{s.window.end='11:01';},
 s=>{s.normalOwnerSlotId='00000000-0000-4000-8000-000000007999';},s=>{s.covererSlotId='other';},s=>{s.covererPersonId='replacement_employee';},
 s=>{s.sourceNamedCovererSlotId='another_helper';},s=>{s.sourceNamedCovererSlotId=null;},s=>{s.entries=[];},
 s=>{s.entries[0].work.locationCodeSnapshot='CHINA';},s=>{s.entries[0].work.locationId='other';},
 s=>{s.entries[0].work.includedLocations.push({locationId:'another_room'});},s=>{s.authority=structuredClone(a);}]){
 check('broader or unvalidated on-call scope refuses',()=>{const s=scope();mutate(s);assert.equal(isAcceptedSevenOnCallLunch(s),false);});
}
for(const mutate of [v=>{v.manualGroupRatingAuthority.acceptedSevenOnCallLunch.windows[0].end='12:00';},
 v=>{v.manualGroupRatingAuthority.acceptedSevenOnCallLunch.helperEmployeeId='replacement';},
 v=>{v.manualGroupRatingAuthority.acceptedSevenOnCallLunch.normalAssignmentEligibilityChanged=true;},
 v=>{v.manualGroupRatingAuthority.acceptedSevenOnCallLunch.ownerDecisionSha256='0'.repeat(64);},
 v=>{v.manualGroupRatingAuthority.acceptedCandidateSha256='0'.repeat(64);},
 v=>{v.manualGroupRatingAuthority.acceptedManualDataDigest='0'.repeat(64);},
 v=>{v.manualGroupRatingAuthority.manifestSha256='0'.repeat(64);},
 v=>{v.manualGroupRatingAuthority.acceptedSevenOnCallLunch.extraPermission=true;}]){
 check('unknown authority refuses',()=>{const v=version();mutate(v);assert.throws(()=>validateAcceptedSevenOnCallLunch(v));});
}
check('missing authority leaves legacy behavior',()=>assert.equal(validateAcceptedSevenOnCallLunch({}),null));
check('validated authority cannot be extended by a caller',()=>assert.throws(()=>allowed.windows.push(a.windows[0]),TypeError));
function prepare(source){
 const templateId='accepted-seven-on-call-fixture',roleSlotIds=week.referenceBindings.people.map(p=>p.slotId).sort(),
  template={templateId,staffingCount:7,source,roleSlotIds},binding={schema:'custodial.approved-static-template-binding.v1',templateId,staffingCount:7,
   sourceDigest:contentDigest(source),roleSlotIdsDigest:contentDigest(roleSlotIds),patternAuthority:'OWNER_APPROVED_OPERATIONAL_PATTERN',
   artifactSha256:week.acceptedStaticPattern.artifactSha256,ownerConfigDigest:contentDigest(config),patternPublicationStatus:'UNPUBLISHED_LOCAL_CANDIDATE'};
 return prepareApprovedStaticTemplateProjection({templates:[template],admittedBindings:[binding],currentSource:source,currentOwnerConfig:config,
  selection:{schema:'custodial.static-template-selection.v1',kind:'INITIAL_BASELINE',templateId,serviceDate:source.serviceDate,
   availablePersonIds:week.referenceBindings.people.map(p=>p.employeeId)}});
}
check('the prior native eligibility refusal is reproduced without owner exception',()=>assert.throws(()=>prepare(raw),e=>e.code==='static_template_lunch_coverage_incompatible'));
Object.assign(raw.version.manualGroupRatingAuthority,version().manualGroupRatingAuthority);
const result=prepare(raw);
check('all35 full scheduled lunches now qualify',()=>{assert.equal(result.lunch.lunches.length,35);assert.ok(result.lunch.lunches.every(l=>l.status==='PLANNED'));});
check('all323 normal rows stay unchanged and no optimizer runs',()=>{assert.equal(result.initialBaseline.projection.assignments.length,323);assert.equal(JSON.stringify(raw.version.assignments),beforeAssignments);assert.equal(result.solverInvoked,false);assert.equal(result.mapping.unchanged,true);});
check('normal Herpetarium assignment stays Monday-only',()=>{
 for(const day of [0,2,3,4,5,6])assert.throws(()=>assertNormalOwnerEligibility(config.slots.ALIJAH,'HERPETARIUM',day),/normal-only/);
 assert.doesNotThrow(()=>assertNormalOwnerEligibility(config.slots.ALIJAH,'HERPETARIUM',1));
 for(const r of raw.version.assignments.filter(r=>r.locationCodeSnapshot==='HERPETARIUM'&&r.dayOfWeek!==1&&r.coveragePurpose==='NORMAL_AREA_OWNERSHIP'))
  assert.ok(r.restrictedSlotIds.includes(a.helperSlotId));
});
check('loan layer adds no normal work or cleaning-clock policy',()=>{
 assert.ok(result.lunch.lunches.flatMap(l=>l.responsibilities).every(r=>r.createsDeepClean===false&&r.checkDeadlinePolicy==='inherit_existing_90_minute_deadline'));
 assert.equal(raw.version.manualGroupRatingAuthority.acceptedSevenOnCallLunch.newMandatoryCleaningRoute,false);
 assert.equal(raw.version.manualGroupRatingAuthority.acceptedSevenOnCallLunch.phoneNFCPermissionChanged,false);
});
console.log(JSON.stringify({status:'PASS_EXACT_SEVEN_ONCALL_LUNCH',checks,windows:3,lunches:35,normalRows:323,normalRestrictionPreserved:true,
 sourcePreparationOnly:true,actualSQLRehearsal:false,registered:false,published:false}));
