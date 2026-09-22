import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { partitionLunchAreas, deriveLunchCoverageFromPreparedProblem,
  createStaticWeeklyLunchCoverageCandidate, verifyStaticWeeklyLunchCoverageCandidate } from '../src/static-weekly-lunch-coverage.js';
import { compileStaticWeeklySchedule } from '../src/static-weekly-schedule-compiler.js';
import { generateStaticWeeklySchedulingProgram } from '../src/static-weekly-schedule-program.js';

const results=[];
async function check(name,fn){try{await fn();results.push({name,passed:true});}catch(error){results.push({name,passed:false,error:error.stack});}}
const clone=value=>structuredClone(value);
await check('two closest helpers actually split the areas',()=>{
  const plan=partitionLunchAreas([{areaId:'west',costs:{b:1,c:9,d:20}},{areaId:'east',costs:{b:9,c:1,d:20}}],['b','c','d']);
  assert.equal(plan.status,'PLANNED');assert.deepEqual(plan.helperSlotIds,['b','c']);assert.equal(plan.totalDistance,2);
  assert.equal(new Set(plan.assignments.map(row=>row.covererSlotId)).size,2);
});
await check('exact-two requirement is enforced even when one helper is nearest to every area',()=>{
  const plan=partitionLunchAreas([{areaId:'x',costs:{b:1,c:2}},{areaId:'y',costs:{b:1,c:3}}],['b','c']);
  assert.equal(new Set(plan.assignments.map(row=>row.covererSlotId)).size,2);assert.equal(plan.totalDistance,3);
});
await check('one available person covers without an approval stop',()=>{
  const plan=partitionLunchAreas([{areaId:'x',costs:{b:1}},{areaId:'y',costs:{b:2}}],['b']);
  assert.equal(plan.status,'PLANNED');assert.equal(plan.helperCount,1);assert.equal(plan.fallback,'only_one_eligible_custodian');
});
await check('no available person produces unresolved coverage, not invented staff',()=>{
  const plan=partitionLunchAreas([{areaId:'x',costs:{}}],[]);assert.equal(plan.status,'REVIEW_REQUIRED');assert.deepEqual(plan.assignments,[]);
});
await check('an indivisible single package cannot be faked as two assignments',()=>{
  const plan=partitionLunchAreas([{areaId:'pair',costs:{b:1,c:2}}],['b','c']);
  assert.equal(plan.reason,'indivisible_area_cannot_use_two_custodians');assert.deepEqual(plan.assignments,[]);
});
await check('three mutually restricted areas cannot silently choose three helpers',()=>{
  const plan=partitionLunchAreas([{areaId:'x',costs:{b:1}},{areaId:'y',costs:{c:1}},{areaId:'z',costs:{d:1}}],['b','c','d']);
  assert.equal(plan.reason,'no_eligible_two_person_partition');assert.deepEqual(plan.assignments,[]);
});
await check('input order has no effect on a tied solution',()=>{
  const areas=[{areaId:'x',costs:{b:1,c:1,d:1}},{areaId:'y',costs:{b:1,c:1,d:1}}];
  assert.deepEqual(partitionLunchAreas(areas,['b','c','d']),partitionLunchAreas(areas.toReversed(),['d','c','b']));
});
await check('invalid and unbounded proximity/identity cannot enter a plan',()=>{
  for(const cost of [-1,Infinity,NaN,0.5,1441])assert.throws(()=>partitionLunchAreas([{areaId:'x',costs:{b:cost}}],['b']));
  assert.throws(()=>partitionLunchAreas([{areaId:'x',costs:{b:1}},{areaId:'x',costs:{b:1}}],['b']));
  assert.throws(()=>partitionLunchAreas([{areaId:'x',costs:{b:1}}],['b','b']));
  assert.throws(()=>partitionLunchAreas(Array.from({length:129},(_,i)=>({areaId:String(i),costs:{b:1}})),['b']));
});

// Independent brute-force oracle: enumerate every assignment, not the planner's DP.
let seed=2137,oracleCases=0;
const random=n=>{seed=(1664525*seed+1013904223)>>>0;return seed%n;};
await check('exact partition agrees with exhaustive independent enumeration in 120 fixtures',()=>{
  for(let t=0;t<120;t++){
    const slots=['b','c','d'],areas=Array.from({length:2+random(5)},(_,i)=>({areaId:String(i),costs:Object.fromEntries(slots.filter(()=>random(5)>0).map(slot=>[slot,random(8)]))}));
    const eligible=slots.filter(slot=>areas.some(row=>Object.hasOwn(row.costs,slot))),required=Math.min(2,eligible.length);
    let best=null;
    function enumerate(i,owners,cost){
      if(i===areas.length){if(new Set(owners).size!==required)return;const key=owners.join('\0');if(!best||cost<best.cost||cost===best.cost&&key<best.key)best={cost,key};return;}
      for(const slot of eligible)if(Object.hasOwn(areas[i].costs,slot))enumerate(i+1,[...owners,slot],cost+areas[i].costs[slot]);
    }
    if(required)enumerate(0,[],0);
    const actual=partitionLunchAreas(areas,slots);
    assert.equal(actual.status==='PLANNED',best!==null,JSON.stringify({areas,actual,best}));
    if(best){assert.equal(actual.totalDistance,best.cost);assert.equal(actual.assignments.map(row=>row.covererSlotId).join('\0'),best.key);}
    oracleCases++;
  }
});

function inputFixture(){
  const slots=['a','b','c','d'],locations=['W','E','B','B2','C','C2','D','D2'];
  const ownership=[['west','W','a'],['east','E','a'],['helper-b','B','b'],['helper-b2','B2','b'],['helper-c','C','c'],['helper-c2','C2','c'],['helper-d','D','d'],['helper-d2','D2','d']];
  return {serviceDate:'2026-09-21',timezone:'America/Chicago',exceptions:[],
    slots:slots.map(slot=>({id:slot,label:slot,incumbencies:[{personId:'person-'+slot,displayName:'Fixture '+slot,effectiveStart:'2020-01-01',effectiveEnd:null}]})),
    proximity:locations.flatMap(from=>locations.filter(to=>to!==from).map(to=>({from,to,minutes:from==='B'&&to==='W'||from==='C'&&to==='E'?1:10,verified:true,provenance:'synthetic-directed-proximity'}))),
    versions:[{id:'week',publicationId:'publication',status:'published',effectiveStart:'2026-09-21',effectiveEnd:null,objective:{requireVerifiedProximity:true},
      slotAvailability:slots.map((slot,i)=>({slotId:slot,dayOfWeek:1,status:'working',shift:{start:'07:00',end:'17:00'},
        lunch:{a:{start:'12:00',end:'13:00'},b:{start:'10:00',end:'11:00'},c:{start:'14:00',end:'15:00'},d:{start:'15:00',end:'16:00'}}[slot],productiveCapacityProvenance:'fixture-shift',maxServiceEffortMinutes:300,
        maxServiceEffortProvenance:'fixture-capacity',qualifications:['general'],qualificationProvenance:'fixture-qualification',
        restrictions:[],restrictionProvenance:'fixture-restriction',acceptedRouteAnchorLocationId:['W','B','C','D'][i],acceptedRouteProvenance:'fixture-anchor'})),
      assignments:ownership.map(([workId,locationId,ownerSlotId])=>({workId,locationId,ownerSlotId,dayOfWeek:1,
        schedulingMode:'flexible_coverage_ownership',window:{start:'09:45',end:'16:00'},serviceEffortMinutes:20,serviceEffortProvenance:'fixture-workload',
        priority:2,priorityProvenance:'fixture-priority',requiredQualifications:['general'],qualificationProvenance:'fixture-work-qualification',restrictions:[],restrictionProvenance:'fixture-work-restriction'}))}]};
}
let input=inputFixture(),result;
await check('actual compiler and its independent verifier provide the candidate baseline',async()=>{
  result=await compileStaticWeeklySchedule(input);
  assert.equal(result.status,'FEASIBLE',JSON.stringify(result.fatal));assert.equal(result.verifier.ok,true);
});
if(result?.status==='FEASIBLE'){
  const program=generateStaticWeeklySchedulingProgram(input),problem=program.problem;
  await check('verified source wrapper produces west/east split without altering normal ownership',()=>{
    const before=JSON.stringify({input,result}),candidate=createStaticWeeklyLunchCoverageCandidate(input,result),loan=candidate.lunches[0];
    assert.equal(candidate.publicationAuthority,'NOT_PUBLISHED');assert.equal(loan.status,'PLANNED');assert.deepEqual(loan.helperSlotIds,['b','c']);
    assert.equal(loan.responsibilities.find(row=>row.segments.some(segment=>segment.workId==='west')).covererSlotId,'b');
    assert.equal(loan.responsibilities.find(row=>row.segments.some(segment=>segment.workId==='east')).covererSlotId,'c');
    assert.equal(JSON.stringify({input,result}),before);assert.equal(result.weeklyAssignments.find(row=>row.workId==='west').slotId,'a');
  });
  await check('covering a lunch ending at their own lunch start is allowed; overlap is not',()=>{
    const p=clone(problem);p.availabilityByDaySlot.get('1\0b').availability.lunch={start:'13:00',end:'14:00'};
    let loan=deriveLunchCoverageFromPreparedProblem(p,result.weeklyAssignments).lunches[0];assert.ok(loan.helperSlotIds.includes('b'));
    p.availabilityByDaySlot.get('1\0b').availability.lunch={start:'12:30',end:'13:30'};
    loan=deriveLunchCoverageFromPreparedProblem(p,result.weeklyAssignments).lunches[0];assert.ok(!loan.helperSlotIds.includes('b'));
  });
  await check('partial absence and ending shift exclude a helper for the full lunch hour',()=>{
    for(const patch of [{blockedWindows:[{start:'12:30',end:'12:45'}]},{shift:{start:'07:00',end:'12:30'}}]){
      const p=clone(problem);Object.assign(p.availabilityByDaySlot.get('1\0b').availability,patch);
      const loan=deriveLunchCoverageFromPreparedProblem(p,result.weeklyAssignments).lunches[0];assert.ok(!loan.helperSlotIds.includes('b'));
    }
  });
  await check('location and slot restrictions remain effective for borrowed work',()=>{
    const p=clone(problem);p.availabilityByDaySlot.get('1\0b').availability.restrictions=['W'];
    p.work.find(work=>work.workId==='east').restrictedSlotIds=['c'];
    const loan=deriveLunchCoverageFromPreparedProblem(p,result.weeklyAssignments).lunches[0];
    assert.ok(!loan.responsibilities.some(row=>row.covererSlotId==='b'&&row.segments.some(segment=>segment.workId==='west')));
    assert.ok(!loan.responsibilities.some(row=>row.covererSlotId==='c'&&row.segments.some(segment=>segment.workId==='east')));
  });
  await check('missing proximity is unavailable, never a fabricated zero distance or phone GPS',()=>{
    const p=clone(problem);p.edges=new Map();const loan=deriveLunchCoverageFromPreparedProblem(p,result.weeklyAssignments).lunches[0];
    assert.equal(loan.status,'REVIEW_REQUIRED');assert.equal(loan.responsibilities.length,0);
  });
  await check('paired restroom members remain in one coverer responsibility',()=>{
    const p=clone(problem),west=p.work.find(work=>work.workId==='west');
    west.includedLocations.push({locationId:'W-WOMEN',locationNameSnapshot:'Fixture Women Restroom'});
    const loan=deriveLunchCoverageFromPreparedProblem(p,result.weeklyAssignments).lunches[0];
    const area=loan.responsibilities.find(row=>row.segments.some(segment=>segment.workId==='west'));
    assert.deepEqual(area.segments[0].includedLocations.map(row=>row.locationId),['W','W-WOMEN']);
    assert.equal(loan.responsibilities.filter(row=>row.segments.some(segment=>segment.includedLocations.some(location=>location.locationId==='W-WOMEN'))).length,1);
  });
  await check('reminder-only gift-shop work is excluded from lunch responsibility',()=>{
    const p=clone(problem);p.work.find(work=>work.workId==='east').serviceMode='reminder_only';
    const loan=deriveLunchCoverageFromPreparedProblem(p,result.weeklyAssignments).lunches[0];
    assert.ok(loan.responsibilities.every(row=>row.segments.every(segment=>segment.workId!=='east')));
    assert.equal(loan.reason,'indivisible_area_cannot_use_two_custodians');
  });
  await check('off-day, departed and vacant workers are never invented as helpers',()=>{
    const p=clone(problem);p.availabilityByDaySlot.get('1\0b').availability.status='absent';
    p.incumbencyByDaySlot.get('1\0c').personId=null;
    const loan=deriveLunchCoverageFromPreparedProblem(p,result.weeklyAssignments).lunches[0];
    assert.deepEqual(loan.helperSlotIds,['d']);assert.equal(loan.fallback,'only_one_eligible_custodian');
  });
  await check('same helpers may cover overlapping lunches with separate identities and end events',()=>{
    const p=clone(problem),rows=clone(result.weeklyAssignments),d=p.states.get(1).availability.get('d');
    d.lunch={start:'12:30',end:'13:30'};
    const extra=clone(p.work.find(work=>work.workId==='helper-d'));extra.key='1:helper-d-second';extra.workId='helper-d-second';extra.locationId='D2';extra.includedLocations=[{locationId:'D2',locationNameSnapshot:'Fixture D2'}];p.work.push(extra);
    for(const helper of ['B','C'])p.edges.set(`${helper}\0D2`,{minutes:1,verified:true,provenance:'fixture-overlap'});
    rows.push({...clone(rows.find(row=>row.workId==='helper-d')),planWorkId:extra.key,workId:extra.workId,locationId:'D2'});
    const loans=deriveLunchCoverageFromPreparedProblem(p,rows).lunches.filter(loan=>['a','d'].includes(loan.normalOwnerSlotId));
    assert.equal(loans.length,2);assert.ok(loans.every(loan=>loan.status==='PLANNED'));
    assert.deepEqual(loans[0].helperSlotIds,['b','c']);assert.deepEqual(loans[1].helperSlotIds,['b','c']);
    assert.notEqual(loans[0].loanId,loans[1].loanId);assert.equal(loans[0].window.end,'13:00');assert.equal(loans[1].window.end,'13:30');
    assert.notEqual(loans[0].notificationIntents[0].endKey,loans[1].notificationIntents[0].endKey);
  });
  await check('existing due-check references are inherited; no new clean or receipt is claimed',()=>{
    const candidate=createStaticWeeklyLunchCoverageCandidate(input,result);
    for(const loan of candidate.lunches){
      for(const row of loan.responsibilities){assert.equal(row.checkDeadlinePolicy,'inherit_existing_90_minute_deadline');assert.equal(row.createsDeepClean,false);assert.equal(Object.hasOwn(row,'nextCheckDueAt'),false);}
      for(const intent of loan.notificationIntents)assert.equal(intent.deliveryState,'NOT_ENQUEUED');
    }
  });
  await check('sub-hour lunch is explicitly unresolved rather than changed to one hour',()=>{
    const p=clone(problem);p.states.get(1).availability.get('a').lunch={start:'12:00',end:'12:30'};
    assert.equal(deriveLunchCoverageFromPreparedProblem(p,result.weeklyAssignments).lunches[0].reason,'scheduled_lunch_must_be_one_hour_within_shift');
  });
  await check('tampered baseline and candidate cannot pass consistency verification',()=>{
    const candidate=createStaticWeeklyLunchCoverageCandidate(input,result);
    assert.equal(verifyStaticWeeklyLunchCoverageCandidate(input,result,candidate).ok,true);
    const tampered=clone(candidate);tampered.lunches[0].window.end='15:00';
    assert.equal(verifyStaticWeeklyLunchCoverageCandidate(input,result,tampered).ok,false);
    const broken=clone(result);broken.weeklyAssignments[0].slotId='attacker';
    assert.throws(()=>createStaticWeeklyLunchCoverageCandidate(input,broken));
  });
  await check('normal source and result array ordering do not change the derived plan',()=>{
    const p=clone(problem);p.slots.reverse();p.work.reverse();p.states=new Map([...p.states].reverse());
    assert.deepEqual(deriveLunchCoverageFromPreparedProblem(problem,result.weeklyAssignments),deriveLunchCoverageFromPreparedProblem(p,result.weeklyAssignments.toReversed()));
  });
}

await check('complete baseline authority is required, not a provisional core',()=>{
  const incomplete=clone(result);delete incomplete.canonicalAuthority;
  assert.throws(()=>createStaticWeeklyLunchCoverageCandidate(input,incomplete),/lunch_complete_base_authority_required/);
});
await check('prototype-like stable slot identifiers are handled as data',()=>{
  const costs=Object.fromEntries([['__proto__',1],['constructor',2]]);
  const actual=partitionLunchAreas([{areaId:'a',costs},{areaId:'b',costs}],['constructor','__proto__']);
  assert.equal(actual.status,'PLANNED');assert.equal(new Set(actual.assignments.map(row=>row.covererSlotId)).size,2);
});
await check('missing work qualification excludes a helper even when its area is closest',()=>{
  const p=generateStaticWeeklySchedulingProgram(input).problem;
  p.availabilityByDaySlot.get('1\0b').availability.qualifications=[];
  const loan=deriveLunchCoverageFromPreparedProblem(p,result.weeklyAssignments).lunches[0];
  assert.ok(!loan.helperSlotIds.includes('b'));
});


await check('local CLI accepts a verified baseline and remains explicitly unpublished',()=>{
  const dir=mkdtempSync(join(tmpdir(),'custodial-lunch-cli-'));
  try {
    const inputPath=join(dir,'synthetic-input.json'),resultPath=join(dir,'synthetic-result.json');
    writeFileSync(inputPath,JSON.stringify(input));writeFileSync(resultPath,JSON.stringify(result));
    const output=JSON.parse(execFileSync(process.execPath,[new URL('./static-weekly-lunch-coverage-preview.mjs',import.meta.url).pathname,inputPath,resultPath],{encoding:'utf8',timeout:30000}));
    assert.equal(output.ok,true);assert.equal(output.publicationAuthority,'NOT_PUBLISHED');
    assert.equal(output.databaseWritten,false);assert.equal(output.notificationsEnqueued,false);
    assert.equal(output.candidate.lunches[0].helperSlotIds.length,2);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});


await check('missing lunch time never implies uninterrupted helper availability',()=>{
  const p=generateStaticWeeklySchedulingProgram(input).problem;
  delete p.availabilityByDaySlot.get('1\0b').availability.lunch;
  const candidate=deriveLunchCoverageFromPreparedProblem(p,result.weeklyAssignments);
  assert.ok(!candidate.lunches.find(loan=>loan.normalOwnerSlotId==='a').helperSlotIds.includes('b'));
  assert.equal(candidate.lunches.find(loan=>loan.normalOwnerSlotId==='b').reason,'scheduled_lunch_missing');
  assert.equal(candidate.status,'REVIEW_REQUIRED');
});

console.log(JSON.stringify({scope:'Source/verified-compiler candidate only; NOT persisted lunch authority, delivery, or physical phone proof',oracleCases,passed:results.filter(row=>row.passed).length,failed:results.filter(row=>!row.passed).length,results},null,2));
process.exitCode=results.some(row=>!row.passed)?1:0;
