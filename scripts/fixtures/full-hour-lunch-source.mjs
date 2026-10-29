import {createFullHourLunchPolicy} from '../../src/static-weekly-lunch-policy.js';
import {postgresJsonbContentDigest} from '../../src/static-weekly-schedule-program.js';

// Synthetic local source only; no real manager, employee, credential or effect.
export function fullHourLunchFixture(){
  const uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
  const ids=['a','b','c','d'],times=[['09:30','10:30'],['11:00','12:00'],['12:00','13:00'],['13:00','14:00']];
  const people=Object.fromEntries(ids.map((key,i)=>[key,{slotId:uuid(i+1),personId:uuid(i+11)}]));
  const families=['W','E','B','B2','C','C2','D','D2'];
  const locations=Object.fromEntries(families.map((f,i)=>[f,uuid(i+21)]));
  const rows=[['W','a','07:00','09:45'],['E','a','07:00','09:45'],['W','d','09:45','17:00'],['E','a','09:45','17:00'],
    ['B','b','07:00','17:00'],['B2','b','07:00','17:00'],['C','c','07:00','17:00'],['C2','c','07:00','17:00'],
    ['D','d','07:00','17:00'],['D2','d','07:00','17:00']];
  const version={id:uuid(101),publicationId:uuid(102),status:'published',effectiveStart:'2026-11-02',effectiveEnd:null,
    objective:{requireVerifiedProximity:true},
    slotAvailability:ids.map((key,i)=>({slotId:people[key].slotId,dayOfWeek:1,status:'working',shift:{start:'07:00',end:'17:00'},
      lunch:{start:times[i][0],end:times[i][1]},productiveCapacityProvenance:'local-fixture-shift',maxServiceEffortMinutes:300,
      maxServiceEffortProvenance:'local-fixture-capacity',qualifications:['general'],qualificationProvenance:'local-fixture-role',
      restrictions:[],restrictionProvenance:'local-fixture-restrictions',acceptedRouteAnchorLocationId:locations[['W','B','C','D'][i]],
      acceptedRouteProvenance:'local-fixture-normal-area'})),
    assignments:rows.map(([family,owner,start,end],i)=>({workId:`full-lunch-${i}`,dayOfWeek:1,ownerSlotId:people[owner].slotId,
      locationId:locations[family],locationCodeSnapshot:family,locationNameSnapshot:`Synthetic ${family}`,
      includedLocations:[{locationId:locations[family],locationNameSnapshot:`Synthetic ${family}`}],
      serviceMode:'scan_tracked',schedulingMode:'flexible_coverage_ownership',window:{start,end},serviceEffortMinutes:20,
      serviceEffortProvenance:'local-fixture-work',priority:2,priorityProvenance:'local-fixture-priority',
      requiredQualifications:['general'],qualificationProvenance:'local-fixture-qualification',restrictions:[],restrictionProvenance:'local-fixture-restriction'}))};
  const mapping={a:{W:'b',E:'c'},b:{B:'a',B2:'c'},c:{C:'a',C2:'d'},d:{W:'b',D:'b',D2:'c'}};
  version.lunchCoveragePolicy=createFullHourLunchPolicy({sourceDigest:'a'.repeat(64),loans:ids.map((key,i)=>({
    dayOfWeek:1,normalOwnerSlotId:people[key].slotId,window:{start:times[i][0],end:times[i][1]},
    areas:Object.entries(mapping[key]).map(([locationCode,helper])=>({locationCode,covererSlotId:people[helper].slotId}))}))},postgresJsonbContentDigest);
  const input={serviceDate:'2026-11-02',timezone:'America/Chicago',exceptions:[],
    slots:ids.map(key=>({id:people[key].slotId,label:`Synthetic ${key}`,incumbencies:[{personId:people[key].personId,
      displayName:`Synthetic ${key}`,effectiveStart:'2020-01-01',effectiveEnd:null}]})),
    proximity:families.flatMap(from=>families.filter(to=>from!==to).map(to=>({from:locations[from],to:locations[to],minutes:1,
      verified:true,provenance:'local-fixture-proximity'}))),versions:[version]};
  return {input,people,locations};
}
