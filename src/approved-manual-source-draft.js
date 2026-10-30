import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {canonicalJson} from './static-weekly-schedule-model.js';
import {postgresJsonbContentDigest as digest} from './static-weekly-schedule-program.js';
import {splitPreservedWorkloadBudget} from './static-weekly-shift-end-coverage.js';
import {prepareApprovedManualCompilerData} from './approved-manual-compiler-data.js';
import {prepareApprovedManualOwnerConfig} from './approved-manual-owner-config.js';
import {assertNormalOwnerEligibility} from './static-weekly-owner-eligibility.js';

const clone=structuredClone;
const minute=t=>Number(t.slice(0,2))*60+Number(t.slice(3));
const fields=(value,keys)=>Object.fromEntries(keys.map(k=>{assert.ok(Object.hasOwn(value,k),`Retained source is missing ${k}`);return [k,clone(value[k])];}));
const ELIGIBILITY=['requiredQualifications','qualificationProvenance','restrictions','restrictionProvenance','restrictedSlotIds','required'];

// Assemble the complete retained eligibility, capacity, physical membership,
// route and workload facts with the newly approved fixed ownership. Dates,
// publication IDs and fresh admission remain deliberately unset. This pure
// producer cannot register sources, create receipts or call a database.
export function prepareApprovedManualSourceDraft({week,referenceBytes}){
  const parts=prepareApprovedManualCompilerData(week),bytes=Buffer.from(referenceBytes);
  assert.equal(bytes.length,week.referenceBindings.reference.bytes);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),week.referenceBindings.reference.sha256,'Retained source bytes changed');
  const reference=JSON.parse(bytes),source=reference.template.source,version=source.version||source.versions?.[0],
    assignments=[],availability=[],budgetBindings=[],restrictionConflicts=[],restrictionClassifications=[];
  const groups=new Map();
  for(const row of parts.assignmentInputs){const key=`${row.dayOfWeek}:${row.locationCodeSnapshot}`;
    const rows=groups.get(key)||[];rows.push(row);groups.set(key,rows);}
  for(const [key,rows]of groups){
    rows.sort((a,b)=>a.window.start.localeCompare(b.window.start));
    const seeds=version.assignments.filter(r=>r.dayOfWeek===rows[0].dayOfWeek&&r.locationCodeSnapshot===rows[0].locationCodeSnapshot);
    assert.ok(seeds.length,'No retained physical/eligibility source for approved group');
    const seed=seeds.find(r=>r.window.start==='09:45')||seeds[0],eligibility=fields(seed,ELIGIBILITY);
    for(const other of seeds)assert.equal(canonicalJson(fields(other,ELIGIBILITY)),canonicalJson(eligibility),'Retained group eligibility differs by old phase');
    const budget=seeds.reduce((n,r)=>{assert.ok(Number.isSafeInteger(r.serviceEffortMinutes)&&r.serviceEffortMinutes>0);return n+r.serviceEffortMinutes;},0),
      allocated=splitPreservedWorkloadBudget(budget,rows.map(r=>r.window)),
      provenance=`retained-source-sha256:${week.referenceBindings.reference.sha256};group-day:${key};preserved-budget:${budget}`;
    budgetBindings.push({dayOfWeek:seed.dayOfWeek,locationCode:seed.locationCodeSnapshot,retainedFactsFromWorkId:seed.workId,
      retainedWork:seeds.map(r=>({workId:r.workId,value:r.serviceEffortMinutes,provenance:r.serviceEffortProvenance})),
      budget,segments:rows.map((r,i)=>({workId:r.workId,value:allocated[i]})),
      unit:'dimensionless_production_workload_points',newGroupRatingUsedAsBudget:false});
    for(const [index,row]of rows.entries()){
      const inherited=row.ownerSlotId!==row.originSlotId,
        current={...clone(row),...clone(eligibility),originSlotId:row.ownerSlotId,
          custodialCoverageMode:'zoo_employee_baseline',serviceEffortMinutes:allocated[index],serviceEffortProvenance:provenance,
          priority:seed.priority,priorityProvenance:seed.priorityProvenance,
          manualBaseOwnerSlotId:row.originSlotId,
          coveragePurpose:inherited?'INHERITED_ALERTS_AND_ISSUES_ONLY':'NORMAL_AREA_OWNERSHIP'};
      assert.ok(Number.isSafeInteger(current.priority)&&typeof current.priorityProvenance==='string');
      assignments.push(current);
    }
  }
  for(const requested of parts.availabilityInputs){
    const matches=version.slotAvailability.filter(r=>r.slotId===requested.slotId&&r.dayOfWeek===requested.dayOfWeek&&r.status==='working');
    assert.equal(matches.length,1,'Exact retained person/day capacity and eligibility required');
    const retained=matches[0],row={...clone(retained),...clone(requested)},
      productive=minute(requested.shift.end)-minute(requested.shift.start)-(minute(requested.lunch.end)-minute(requested.lunch.start));
    assert.ok(productive>0);row.maxDutyMinutes=productive;
    row.productiveCapacityProvenance=`approved-manual-shift-and-lunch:${week.manifestSha256}`;
    row.maxDutyProvenance=row.productiveCapacityProvenance;
    // The retained workload ceiling and route facts are copied exactly. New
    // ratings never increase that ceiling or create measured travel times.
    assert.equal(row.maxServiceEffortMinutes,retained.maxServiceEffortMinutes);
    availability.push(row);
  }
  const ownerConfig=prepareApprovedManualOwnerConfig({week,reference,availability}),alijah=ownerConfig.slots.ALIJAH;
  for(const row of assignments){
    // The retained rule is a Monday-only NORMAL scheduling rule. The exact
    // approved Friday handoff is alert/issue custody, not a new normal route.
    // Lower that distinction into the existing per-work restriction field;
    // every other retained prohibition and every normal-work ban stays exact.
    if(row.coveragePurpose==='INHERITED_ALERTS_AND_ISSUES_ONLY'&&row.locationCodeSnapshot==='HERPETARIUM'
      &&row.dayOfWeek!==1&&row.restrictedSlotIds.includes(alijah.slotId)){
      const original=clone(row.restrictedSlotIds);
      row.restrictedSlotIds=row.restrictedSlotIds.filter(id=>id!==alijah.slotId);
      row.normalAssignmentRestrictedSlotIds=[alijah.slotId];
      row.restrictionProvenance+=`;normal-assignment-scope:${week.manifestSha256}`;
      restrictionClassifications.push({workId:row.workId,dayOfWeek:row.dayOfWeek,locationCode:row.locationCodeSnapshot,
        personId:alijah.personId,slotId:alijah.slotId,coveragePurpose:row.coveragePurpose,
        retainedRestrictedSlotIds:original,effectiveRestrictedSlotIds:clone(row.restrictedSlotIds),
        normalAssignmentRestrictionRetained:true,nfcPermissionChanged:false});
    }
    const owner=Object.entries(ownerConfig.slots).find(([,o])=>o.slotId===row.ownerSlotId);
    assert.ok(owner);
    try{assertNormalOwnerEligibility({key:owner[0],...owner[1]},row.locationCodeSnapshot,row.dayOfWeek,row.coveragePurpose);
      assert.ok(!row.restrictedSlotIds.includes(row.ownerSlotId));}
    catch(error){restrictionConflicts.push({workId:row.workId,dayOfWeek:row.dayOfWeek,locationCode:row.locationCodeSnapshot,
      ownerSlotId:row.ownerSlotId,window:clone(row.window),coveragePurpose:row.coveragePurpose,issue:error.message});}
  }
  const sourceDraft={publicationAuthority:'REVIEW_REQUIRED',serviceDate:null,version:{
    id:null,publicationId:null,status:'draft',effectiveStart:null,effectiveEnd:null,
    objective:clone(version.objective),namedAbsentSlotIds:[],vacancyCapableSlotIds:clone(version.vacancyCapableSlotIds),
    vacantSlotIds:clone(version.vacantSlotIds),slotAvailability:availability,assignments,
    lunchCoveragePolicy:clone(parts.lunchCoveragePolicy),
    manualGroupRatingAuthority:clone(parts.groupRatingAuthority),
    manualPolicyDeltaSha256:week.policyDelta.sha256,manualNormalRestrictionAuthority:clone(ownerConfig.manualNormalRestrictionAuthority),
    manualAreaScopeDefinitions:{EDUCATION:clone(week.referenceBindings.approvedEducationScope)},
  },slots:clone(source.slots),exceptions:[],proximity:clone(source.proximity)};
  const body={schema:'custodial.approved-manual-source-draft.v1',manualDataDigest:week.dataDigest,
    policyDeltaSha256:week.policyDelta.sha256,sourceDraft,ownerConfig,budgetBindings,restrictionConflicts,restrictionClassifications,
    activationApprovalRecorded:week.activation.ownerApproved,registrationEligible:false,receiptEligible:false,published:false,
    unresolvedPolicies:clone(week.activation.unresolvedPolicies),effectiveStart:null,
    nextRequiredImplementation:['ADAPT_EXISTING_ABSENCE_ENGINE_TO_NEW_RATINGS_AND_COMPLETE_DAILY_PLANS',
      'SUPPORTED_EFFECTIVE_DATE_AND_ROSTER_ADMISSION','NORMAL_SOURCE_TEMPLATE_AND_PROJECTION_ADMISSION']};
  return {...body,sourceDraftDigest:digest(body)};
}
