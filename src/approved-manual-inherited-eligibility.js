import assert from 'node:assert/strict';
import {MANUAL_NORMAL_RESTRICTION_AUTHORITY,assertNormalOwnerEligibility} from './static-weekly-owner-eligibility.js';

// Scope the one already approved NORMAL-only restriction. Qualifications,
// physical restrictions, every other slot ban and NFC permissions stay intact.
// This produces a private inherited-work view, never a modified normal Source.
export function approvedManualInheritedEligibility(work,ownerConfig,purpose){
 if(purpose!=='INHERITED_ALERTS_AND_ISSUES_ONLY'||work.locationCodeSnapshot!=='HERPETARIUM'||work.dayOfWeek===1)return work;
 assert.deepEqual(ownerConfig.manualNormalRestrictionAuthority,MANUAL_NORMAL_RESTRICTION_AUTHORITY);
 const alijah=ownerConfig.slots.ALIJAH;
 if(!(work.restrictedSlotIds||[]).includes(alijah.slotId))return work;
 try{assertNormalOwnerEligibility({key:'ALIJAH',...alijah},'HERPETARIUM',work.dayOfWeek,purpose);}catch{return work;}
 assert.ok(alijah.normalForbiddenFamiliesByDay?.[work.dayOfWeek]?.includes('HERPETARIUM'));
 return{...structuredClone(work),coveragePurpose:purpose,
  restrictedSlotIds:work.restrictedSlotIds.filter(id=>id!==alijah.slotId),
  normalAssignmentRestrictedSlotIds:[...new Set([...(work.normalAssignmentRestrictedSlotIds||[]),alijah.slotId])],
  restrictionProvenance:work.restrictionProvenance+`;normal-assignment-scope:${MANUAL_NORMAL_RESTRICTION_AUTHORITY.manifestSha256}`};
}
