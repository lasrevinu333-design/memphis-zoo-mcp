import assert from 'node:assert/strict';
import {MANUAL_NORMAL_RESTRICTION_AUTHORITY,validateOwnerEligibilityConfig} from './static-weekly-owner-eligibility.js';

export function prepareApprovedManualOwnerConfig({week,reference,availability}){
  assert.equal(week.manifestSha256,MANUAL_NORMAL_RESTRICTION_AUTHORITY.manifestSha256);
  assert.equal(week.policyDelta.sha256,MANUAL_NORMAL_RESTRICTION_AUTHORITY.policyDeltaSha256);
  assert.equal(week.referenceBindings.reference.sha256,MANUAL_NORMAL_RESTRICTION_AUTHORITY.referenceSha256);
  const groups=new Map(week.referenceBindings.groups.map(g=>[g.approvedGroup,g.referenceCode])),slots={};
  for(const person of week.referenceBindings.people){
    const prior=Object.entries(reference.ownerConfig.slots).find(([,s])=>s.personId===person.employeeId);
    assert.ok(prior&&prior[1].slotId===person.slotId,'Exact retained person/position notes required');
    const days=week.days.filter(d=>d.employees.some(e=>e.name===person.approvedName)),
      plans=days.map(d=>({day:d.weekday,...d.employees.find(e=>e.name===person.approvedName)})),
      approvedFamilies=[...new Set(plans.flatMap(p=>p.baseGroups.map(g=>groups.get(g))))],
      key=person.approvedName.split(' ')[0].toUpperCase(),old=structuredClone(prior[1]),
      confirmedMandatory=(old.mandatoryNormalFamilies||[]).filter(f=>plans.every(p=>p.baseGroups.some(g=>groups.get(g)===f)));
    slots[key]={...old,slotId:person.slotId,personId:person.employeeId,name:person.approvedName,vacancy:false,
      workDays:plans.map(p=>p.day).sort((a,b)=>a-b),shift:[plans[0].shift.start,plans[0].shift.end],
      lunch:[plans[0].lunch.start,plans[0].lunch.end],
      normalAssignmentFamilies:[...new Set([...(old.normalAssignmentFamilies||[]).filter(f=>f!=='ELEPHANT_TRUNK_RESTROOMS'),...approvedFamilies])].sort(),
      mandatoryNormalFamilies:confirmedMandatory,
      inheritedAlertCustodyMode:'APPROVED_MANUAL_ALERTS_AND_ISSUES_ONLY',
      datedAvailability:Object.fromEntries(availability.filter(a=>a.slotId===person.slotId).map(a=>[a.dayOfWeek,{
        shift:[a.shift.start,a.shift.end],lunch:[a.lunch.start,a.lunch.end],status:a.status,
        qualifications:structuredClone(a.qualifications),restrictions:structuredClone(a.restrictions),
        acceptedRouteAnchorLocationId:a.acceptedRouteAnchorLocationId,
      }])),
      priorNormalRules:{sourceKey:prior[0],normalAssignmentFamilies:old.normalAssignmentFamilies||[],mandatoryNormalFamilies:old.mandatoryNormalFamilies||[]},
    };
    if(key==='ALIJAH'){
      slots[key].hardForbiddenFamilies=[];delete slots[key].hardForbiddenFamiliesByDay;
      slots[key].normalForbiddenFamiliesByDay=Object.fromEntries(Array.from({length:7},(_,d)=>[d,d===1?[]:['HERPETARIUM']]));
    }
  }
  const config={schema:'custodial.owner-corrected-recurring-schedule.v2',effectiveDate:null,slots,
    weights:Object.fromEntries(week.ratings.map(r=>[groups.get(r.group),r.score])),
    ratingUnit:week.ratingUnit,manualNormalRestrictionAuthority:structuredClone(MANUAL_NORMAL_RESTRICTION_AUTHORITY),
    approvedManualDataDigest:week.dataDigest,global0945Changeovers:false,objectiveNormalization:null};
  validateOwnerEligibilityConfig(config);return config;
}
