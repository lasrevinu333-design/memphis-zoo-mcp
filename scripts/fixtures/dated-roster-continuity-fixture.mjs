import {createShiftEndContinuityPolicy} from '../../src/static-weekly-shift-end-derivation.js';
import {postgresJsonbContentDigest as digest} from '../../src/static-weekly-schedule-compiler.js';

// Synthetic input facts only. No authority, solver output or receipt is fabricated.
export function datedRosterContinuityFixture(week) {
 const ids=(prefix,count=4)=>Array.from({length:count},(_,n)=>`${prefix}0000000-0000-4000-8000-00000000010${n+1}`);
 const slots=ids('2'),people=ids('4'),locations=ids('3',8),groups=ids('8',8);
 const ends=['16:00','15:00','17:00','16:00'],lunches=['11:00','12:00','13:00','14:00'];
 const names=slots.map((_,i)=>`Synthetic Continuity Person ${i}`);
 const source={serviceDate:week,timezone:'America/Chicago',exceptions:[],
  slots:slots.map((id,i)=>({id,label:`Synthetic Stable Position ${i}`,incumbencies:i<2
   ?[{personId:people[i],displayName:names[i],effectiveStart:'2020-01-01',effectiveEnd:null}]:[]})),
  proximity:locations.flatMap(from=>locations.filter(to=>to!==from).map(to=>({fromLocationId:from,toLocationId:to,
   minutes:1,verified:true,provenance:'synthetic directed physical distance'}))),
  version:{id:'60000000-0000-4000-8000-000000000101',publicationId:'70000000-0000-4000-8000-000000000101',
   status:'published',effectiveStart:week,effectiveEnd:null,objective:{requireVerifiedProximity:true},
   vacancyCapableSlotIds:slots.slice(2),vacantSlotIds:slots.slice(2),
   shiftEndContinuityPolicy:createShiftEndContinuityPolicy(Object.fromEntries(locations.map((_,i)=>[`SYNTHETIC_${i}`,1])),'a'.repeat(64),digest),
   slotAvailability:Array.from({length:7},(_,dayOfWeek)=>slots.map((slotId,i)=>({slotId,dayOfWeek,
    status:i<2?'working':'vacant_unfilled',shift:{start:'07:00',end:ends[i]},
    lunch:{start:lunches[i],end:`${String(Number(lunches[i].slice(0,2))+1).padStart(2,'0')}:00`},
    productiveCapacityProvenance:'synthetic shift',maxServiceEffortMinutes:300,maxServiceEffortProvenance:'synthetic bounded effort',
    qualifications:['general'],qualificationProvenance:'synthetic role',restrictions:[],restrictionProvenance:'synthetic restriction',
    acceptedRouteAnchorLocationId:locations[i*2],acceptedRouteProvenance:'synthetic anchor'}))).flat(),
   assignments:Array.from({length:7},(_,dayOfWeek)=>slots.flatMap((ownerSlotId,i)=>[0,1].map(part=>({
    workId:`synthetic-parent-${dayOfWeek}-${i}-${part}`,dayOfWeek,ownerSlotId,originSlotId:ownerSlotId,
    locationId:locations[i*2+part],locationCodeSnapshot:`SYNTHETIC_${i*2+part}`,locationNameSnapshot:`Synthetic area ${i*2+part}`,
    includedLocations:[{locationId:locations[i*2+part],locationNameSnapshot:`Synthetic area ${i*2+part}`}],
    schedulingMode:'flexible_coverage_ownership',window:{start:'09:45',end:ends[i]},
    serviceEffortMinutes:20,serviceEffortProvenance:'synthetic effort',priority:2,priorityProvenance:'synthetic priority',
    requiredQualifications:['general'],qualificationProvenance:'synthetic eligibility',restrictedSlotIds:[],
    restrictions:[],restrictionProvenance:'synthetic restrictions'})))).flat()}};
 return {source,slots,people,locations,groups,names};
}
