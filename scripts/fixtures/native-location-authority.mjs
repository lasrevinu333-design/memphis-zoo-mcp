import {randomUUID} from 'node:crypto';
// The established four-person/two-helper lunch publication fixture, narrowed
// to one provider recipient. No forged projection or reader substitution.
export function nativeLocationAuthoritySource(week,dayOfWeek){
 const slots=['a','b','c','d'].map((key,i)=>({key,id:randomUUID(),person:randomUUID(),name:`Synthetic provider ${i}`}));
 const codes=['W','E','B','B2','C','C2','D','D2'];
 const places=Object.fromEntries(codes.map(code=>[code,{id:randomUUID(),group:randomUUID(),code:`PROVIDER_${code}`,name:code==='W'?'Synthetic café / restroom':`Synthetic ${code}`} ]));
 const ownerCodes=[['W','E'],['B','B2'],['C','C2'],['D','D2']];
 const lunches=[['12:00','13:00'],['12:30','13:30'],['10:00','11:00'],['14:00','15:00']];
 const source={serviceDate:week,timezone:'America/Chicago',exceptions:[],
  slots:slots.map(s=>({id:s.id,label:s.name,incumbencies:[{personId:s.person,displayName:s.name,effectiveStart:'2020-01-01',effectiveEnd:null}]})),
  proximity:codes.flatMap(from=>codes.filter(to=>from!==to).map(to=>({from:places[from].id,to:places[to].id,
   minutes:(from==='B'&&to==='W')||(from==='C'&&to==='E')?1:10,verified:true,provenance:'synthetic geometry'}))),
  versions:[{id:randomUUID(),publicationId:randomUUID(),status:'published',effectiveStart:week,effectiveEnd:null,
   objective:{requireVerifiedProximity:true},slotAvailability:slots.map((s,i)=>({slotId:s.id,dayOfWeek,status:'working',
    shift:{start:'07:00',end:'17:00'},lunch:{start:lunches[i][0],end:lunches[i][1]},
    productiveCapacityProvenance:'fixture-shift',maxServiceEffortMinutes:300,maxServiceEffortProvenance:'fixture-capacity',
    qualifications:['general'],qualificationProvenance:'fixture-role',restrictions:[],restrictionProvenance:'fixture-restrictions',
    acceptedRouteAnchorLocationId:places[ownerCodes[i][0]].id,acceptedRouteProvenance:'fixture-normal-area'})),
   assignments:slots.flatMap((s,i)=>ownerCodes[i].map(code=>({workId:code,dayOfWeek,ownerSlotId:s.id,
    locationId:places[code].id,locationCodeSnapshot:places[code].code,locationNameSnapshot:places[code].name,
    includedLocations:[{locationId:places[code].id,locationNameSnapshot:places[code].name}],
    schedulingMode:'flexible_coverage_ownership',window:{start:'09:45',end:'16:00'},serviceEffortMinutes:20,
    serviceEffortProvenance:'fixture-effort',priority:2,priorityProvenance:'fixture-priority',requiredQualifications:['general'],
    qualificationProvenance:'fixture-work-role',restrictions:[],restrictionProvenance:'fixture-work-restrictions'})))}]};
 return{source,slots,places};
}
