// Translate approved DATA into the maintained compiler's field names and
// native full-hour lunch policy. This is an undated, incomplete Source draft:
// it carries no registration, compiler receipt or publication capability.
import assert from 'node:assert/strict';
import {postgresJsonbContentDigest as digest} from './static-weekly-schedule-program.js';
import {createFullHourLunchPolicy} from './static-weekly-lunch-policy.js';

const clone=structuredClone;
const freeze=value=>{if(value&&typeof value==='object'){for(const v of Object.values(value))freeze(v);Object.freeze(value);}return value;};

export function prepareApprovedManualCompilerData(week){
  assert.equal(week?.schema,'custodial.approved-manual-week-data.v1');
  const {dataDigest,...body}=week;
  assert.equal(dataDigest,digest(body),'Manual planning data changed after intake');
  assert.equal(week.activation.state,'HELD');assert.equal(week.activation.published,false);
  assert.equal(week.runtimeBinding.registeredSourceId,null);assert.equal(week.receiptEligible,false);
  const people=new Map(week.referenceBindings.people.map(p=>[p.approvedName,p])),
    groups=new Map(week.referenceBindings.groups.map(g=>[g.approvedGroup,g])),
    ratings=new Map(week.ratings.map(r=>[r.group,r.score])),assignments=[],availability=[],loans=[],closing={};
  for(const day of week.days){
    for(const person of day.employees){
      const identity=people.get(person.name);assert.ok(identity);
      availability.push({slotId:identity.slotId,dayOfWeek:day.weekday,status:'working',
        shift:clone(person.shift),lunch:clone(person.lunch)});
    }
    for(const [name,group]of groups){
      assert.equal(group.retainedServiceModes.length,1,'A combined group has ambiguous retained capability');
      const baseOwner=day.employees.find(p=>p.baseGroups.includes(name));assert.ok(baseOwner);
      const segments=[];
      // Coalesce only adjacent ownership by the SAME employee. Another area's
      // departure never creates a new duty or duplicates this group's rating.
      for(const phase of day.phases){
        const owner=phase.owners[name],last=segments.at(-1);assert.ok(people.has(owner));
        if(last&&last.owner===owner&&last.end===phase.start)last.end=phase.end;
        else segments.push({owner,start:phase.start,end:phase.end});
      }
      // The approved base owner starts their own areas at their actual static
      // shift start. Temporary custody of colleagues' not-yet-started areas is
      // unspecified; the complete-site coverage window is retained separately.
      assert.equal(segments[0].owner,baseOwner.name);
      assert.ok(baseOwner.shift.start<=segments[0].start);
      segments[0].start=baseOwner.shift.start;
      for(const segment of segments)assignments.push({
        workId:`manual:${week.manifestSha256.slice(0,16)}:${day.weekday}:${group.referenceCode}:${segment.start}`,
        dayOfWeek:day.weekday,locationId:group.primaryLocationId,locationCodeSnapshot:group.referenceCode,
        locationNameSnapshot:name,serviceMode:group.retainedServiceModes[0],
        includedLocations:clone(group.includedLocations),window:{start:segment.start,end:segment.end},
        ownerSlotId:people.get(segment.owner).slotId,originSlotId:people.get(baseOwner.name).slotId,
        schedulingMode:'flexible_coverage_ownership',
      });
    }
    for(const lunch of day.lunches)loans.push({dayOfWeek:day.weekday,
      normalOwnerSlotId:people.get(lunch.recipient).slotId,window:{start:lunch.start,end:lunch.end},
      areas:lunch.groups.map(name=>({locationCode:groups.get(name).referenceCode,covererSlotId:people.get(lunch.coverer).slotId}))});
    closing[day.weekday]=day.phases.slice(1).map(phase=>({start:phase.start,end:phase.end,
      owners:Object.fromEntries(Object.entries(phase.owners).map(([name,owner])=>[groups.get(name).referenceCode,people.get(owner).slotId]))}));
  }
  const ratingAuthority={schema:'custodial.approved-manual-group-ratings.v1',manifestSha256:week.manifestSha256,
    unit:week.ratingUnit,groups:[...groups].map(([name,group])=>({locationCode:group.referenceCode,
      primaryLocationId:group.primaryLocationId,score:ratings.get(name)})),
    completeCoverageWindows:week.days.map(day=>({dayOfWeek:day.weekday,...clone(day.checkedWindow)})),
    prearrivalPolicy:'OWN_BASE_AREAS_FROM_ACTUAL_SHIFT_START_ONLY',
    proximityPercent:week.objective.proximityPercent,loadPercent:week.objective.loadPercent,
    normalizedFormula:null,formulaApproved:false,legacyComponentWeightsReplaced:false,physicalMinutesEstablished:false};
  const result={schema:'custodial.approved-manual-compiler-data.v1',manualDataDigest:dataDigest,
    candidateReferenceDigest:week.referenceBindings.bindingDigest,
    assignmentInputs:assignments,availabilityInputs:availability,
    lunchCoveragePolicy:createFullHourLunchPolicy({sourceDigest:dataDigest,loans},digest),
    plannedClosingOwnership:closing,groupRatingAuthority:ratingAuthority,
    checkedWindows:week.days.map(day=>({dayOfWeek:day.weekday,...clone(day.checkedWindow)})),
    unresolvedLegacyDuties:clone(week.referenceBindings.unresolvedLegacyDuties.filter(d=>!week.effectivePolicies.excludedLegacyDuties.includes(d.referenceCode))),
    excludedLegacyDuties:clone(week.effectivePolicies.excludedLegacyDuties),policy0945:week.effectivePolicies.policy0945,
    coveragePurpose:'INHERITED_ALERTS_AND_ISSUES_ONLY',createsMandatoryInheritedCleaningRoutes:false,
    activation:clone(week.activation),sourceId:null,effectiveStart:null,canonicalCompilerInput:null,
    requiredSourceHydration:['APPROVED_EFFECTIVE_DATE_AND_ROSTER_READBACK','CANONICAL_ELIGIBILITY_AND_CAPACITY',
      'APPROVED_GROUP_RATING_ENGINE_ADAPTATION'],
    completeCanonicalSource:false,registrationEligible:false,receiptEligible:false,published:false};
  return freeze({...result,compilerDataDigest:digest(result)});
}
