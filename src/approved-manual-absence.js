import assert from 'node:assert/strict';
import {postgresJsonbContentDigest as digest} from './static-weekly-schedule-program.js';
import {assertNormalOwnerEligibility,validateOwnerEligibilityConfig} from './static-weekly-owner-eligibility.js';
import {prepareApprovedManualGpsDistances} from './approved-manual-gps.js';
import {solveStaticWeeklyMip} from './static-weekly-schedule-solver.js';

const minute=t=>Number(t.slice(0,2))*60+Number(t.slice(3));
const contains=(a,b)=>minute(a.start)<=minute(b.start)&&minute(a.end)>=minute(b.end);
const overlaps=(a,b)=>minute(a.start)<minute(b.end)&&minute(b.start)<minute(a.end);
const activeAt=(window,t)=>minute(window.start)<=t&&t<minute(window.end);
const time=m=>`${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
const inherited='INHERITED_ALERTS_AND_ISSUES_ONLY';

// Input preparation for the new full-day absence objective. Reuse maintained
// personal eligibility, qualifications and the bounded local HiGHS worker.
// This returns DATA only: it cannot authorize a publication, edit a weekly
// baseline, invent employee availability, book contractors or issue receipts.
export function prepareApprovedManualAbsenceDay({week,source,ownerConfig,serviceDate,absentPersonIds}){
 assert.match(serviceDate,/^\d{4}-\d{2}-\d{2}$/);
 const date=new Date(serviceDate+'T12:00:00Z');assert.equal(date.toISOString().slice(0,10),serviceDate);
 const weekday=date.getUTCDay(),day=week.days.find(d=>d.weekday===weekday),version=source.version||source.versions?.[0];
 assert.ok(day&&version);validateOwnerEligibilityConfig(ownerConfig);
 assert.equal(ownerConfig.approvedManualDataDigest,week.dataDigest);
 assert.equal(version.manualGroupRatingAuthority?.manifestSha256,week.manifestSha256);
 assert.equal(week.ratings.length,23);assert.equal(week.ratings.reduce((n,r)=>n+r.score,0),136);
 assert.ok(Array.isArray(absentPersonIds)&&absentPersonIds.every(p=>typeof p==='string'));
 assert.equal(new Set(absentPersonIds).size,absentPersonIds.length,'Duplicate absent employee');
 const binding=new Map(week.referenceBindings.people.map(p=>[p.approvedName,p])),
  groupBinding=new Map(week.referenceBindings.groups.map(g=>[g.approvedGroup,g])),
  absent=new Set(absentPersonIds),roster=day.employees.map(p=>{
   const identity=binding.get(p.name),owner=Object.entries(ownerConfig.slots).find(([,s])=>s.slotId===identity.slotId);
   assert.ok(owner&&owner[1].personId===identity.employeeId);
   const available=version.slotAvailability.filter(a=>a.slotId===identity.slotId&&a.dayOfWeek===weekday);
   assert.equal(available.length,1);assert.equal(available[0].status,'working');
   assert.deepEqual(available[0].shift,p.shift);assert.deepEqual(available[0].lunch,p.lunch);
   assert.ok(Array.isArray(available[0].qualifications)&&available[0].qualificationProvenance);
   assert.ok(Array.isArray(available[0].restrictions)&&available[0].restrictionProvenance);
   assert.ok(!available[0].blockedWindows?.length,'Partial-window changes use the existing partial-absence path');
   return{...structuredClone(p),personId:identity.employeeId,slotId:identity.slotId,
    owner:{key:owner[0],...structuredClone(owner[1])},availability:structuredClone(available[0]),
    baseCodes:p.baseGroups.map(g=>groupBinding.get(g).referenceCode)};
  });
 for(const id of absent)assert.ok(roster.some(p=>p.personId===id),'Absent employee is not scheduled on this day');
 const common={schema:'custodial.approved-manual-absence-day-input.v1',serviceDate,weekday,
  manifestSha256:week.manifestSha256,manualDataDigest:week.dataDigest,sourceDigest:digest(source),
  absentPersonIds:[...absent].sort(),checkedWindow:structuredClone(day.checkedWindow),
  publicationEligible:false,formulaApproved:false,productionWritten:false,contractorBooked:false};
 if(absent.size===0)return{...common,status:'UNCHANGED_APPROVED_DAY',day:structuredClone(day),solverInvoked:false};
 if(absent.size>=3)return{...common,status:'MANAGER_COVERALL_DECISION_REQUIRED',solverInvoked:false,
  reason:'Three or more absences normally require a manager to arrange and confirm additional coverage.'};
 const remaining=roster.filter(p=>!absent.has(p.personId)),groups=week.ratings.map(r=>{
  const b=groupBinding.get(r.group);return{code:b.referenceCode,name:r.group,points:r.score,locationId:b.primaryLocationId};
 }).sort((a,b)=>a.code.localeCompare(b.code)),issues=[];
 const eligible=(person,work,purpose)=>{
  try{assertNormalOwnerEligibility(person.owner,work.locationCodeSnapshot,weekday,purpose);}catch{return false;}
  const qualified=new Set(person.availability.qualifications);
  if((work.requiredQualifications||[]).some(q=>!qualified.has(q))||person.availability.restrictions.includes(work.locationId))return false;
  // Only the already classified Alijah NORMAL-only Herpetarium restriction
  // permits inherited radio/issue custody. All other source restrictions stay.
  const normalOnly=person.owner.normalForbiddenFamiliesByDay?.[weekday]?.includes(work.locationCodeSnapshot);
  return !(work.restrictedSlotIds||[]).includes(person.slotId)||(purpose===inherited&&normalOnly===true);
 };
 const phases=day.phases.map((phase,index)=>{
  const window={start:phase.start,end:phase.end},onShift=remaining.filter(p=>contains(p.shift,window)),areas=groups.map(group=>{
   const rows=version.assignments.filter(w=>w.dayOfWeek===weekday&&w.locationCodeSnapshot===group.code&&contains(w.window,window));
   assert.equal(rows.length,1,'Every approved phase must retain one exact source requirement');
   const work=rows[0],purpose=index===0?'NORMAL_AREA_OWNERSHIP':inherited,
    approved=binding.get(phase.owners[group.name]);assert.equal(work.ownerSlotId,approved.slotId);
   let choices=onShift.filter(p=>eligible(p,work,purpose));
   if(index===0&&!absent.has(approved.employeeId))choices=choices.filter(p=>p.slotId===approved.slotId);
   if(!choices.length)issues.push({code:'NO_ELIGIBLE_OWNER',window,groups:[group.code],
    constraint:onShift.length?'Retained normal/qualification restrictions':'No employee remains on the static schedule'});
   return{code:group.code,sourceWorkId:work.workId,work:structuredClone(work),purpose,
    eligibleSlotIds:choices.map(p=>p.slotId).sort()};
  });
  return{index,window,areas,onShiftSlotIds:onShift.map(p=>p.slotId).sort()};
 });
 const lunches=remaining.map(p=>{
  const candidates=remaining.filter(c=>c.slotId!==p.slotId&&contains(c.shift,p.lunch)&&!overlaps(c.lunch,p.lunch));
  if(!candidates.length)issues.push({code:'NO_FULL_HOUR_LUNCH_HELPER',window:p.lunch,recipientSlotId:p.slotId,
   constraint:'A named helper must be on shift and outside their own lunch for the entire scheduled hour'});
  return{recipientSlotId:p.slotId,window:structuredClone(p.lunch),candidateSlotIds:candidates.map(c=>c.slotId).sort()};
 });
 const boundaries=new Set([minute(day.checkedWindow.start),minute(day.checkedWindow.end)]);
 for(const phase of phases){boundaries.add(minute(phase.window.start));boundaries.add(minute(phase.window.end));}
 for(const p of remaining){for(const window of [p.shift,p.lunch]){boundaries.add(minute(window.start));boundaries.add(minute(window.end));}}
 const edges=[...boundaries].filter(m=>m>=minute(day.checkedWindow.start)&&m<=minute(day.checkedWindow.end)).sort((a,b)=>a-b),slices=[];
 for(let i=0;i<edges.length-1;i++){
  const start=edges[i],end=edges[i+1],phase=phases.find(p=>activeAt(p.window,start)),
   available=remaining.filter(p=>activeAt(p.shift,start)&&!activeAt(p.lunch,start));
  assert.ok(phase);if(!available.length)issues.push({code:'NO_AVAILABLE_EMPLOYEE',window:{start:time(start),end:time(end)},groups:groups.map(g=>g.code),constraint:'All remaining employees are off shift or on their static lunches'});
  slices.push({index:i,phase:phase.index,window:{start:time(start),end:time(end)},minutes:end-start,
   availableSlotIds:available.map(p=>p.slotId).sort(),lunchRecipientSlotIds:remaining.filter(p=>activeAt(p.lunch,start)).map(p=>p.slotId).sort()});
 }
 const reliefEligibility=[];
 for(const phase of phases)for(const area of phase.areas)for(const p of remaining)
  if(eligible(p,area.work,inherited))reliefEligibility.push(`${phase.index}:${area.code}:${p.slotId}`);
 const body={...common,status:issues.length?'COVERAGE_CONSTRAINTS_UNRESOLVED':'PREPARED_FOR_EXPLICIT_OBJECTIVE',
  roster:remaining,groups,phases,lunches,slices,reliefEligibility,issues,gps:prepareApprovedManualGpsDistances(week),
  conservedRatingTotal:136,priorityWeight:0,weeklyBaselineChanged:false,solverInvoked:false};
 return{...body,inputDigest:digest(body)};
}

// The exact formula is still awaiting the owner's response. This explicitly
// named proposal runner cannot be confused with a production compiler receipt.
// It exercises the complete day and reuses the existing local solver only.
export async function solveApprovedManualAbsenceProposal(input,{proposal,deadline=performance.now()+25000,signal}={}){
 assert.equal(proposal?.schema,'custodial.manual-absence-objective-proposal.v1');
 assert.equal(proposal.approval,'PENDING_OWNER_RESPONSE');assert.equal(proposal.productionActive,false);
 assert.deepEqual(proposal.weights,{proximity:75,load:25,priority:0});
 assert.equal(proposal.proximity.metric,'HAVERSINE_STRAIGHT_LINE_GPS');
 assert.equal(proposal.proximity.anchor,'Each recipient s retained normal base groups; never transferred groups');
 assert.equal(proposal.proximity.normalizer,'Maximum pairwise GPS distance among all23 combined groups');
 assert.equal(proposal.proximity.aggregation,'Mean normalized distance across23 current owners in each phase');
 assert.equal(proposal.load.normalizer,'sum_i abs(points_i - S/n) / (2*S*(1-1/n))');
 assert.equal(proposal.load.n,'Custodians available during this phase, excluding their own lunches');
 assert.equal(proposal.load.singleCustodianLoss,0);
 if(input.status!=='PREPARED_FOR_EXPLICIT_OBJECTIVE')return structuredClone(input);
 const {inputDigest,...body}=input;assert.equal(digest(body),inputDigest,'Absence input changed after preparation');
 const rows=[],binary=[],bounds=[],objective=[],owners=new Map(),helpers=new Map(),actual=new Map(),
  bySlot=new Map(input.roster.map(p=>[p.slotId,p])),relief=new Set(input.reliefEligibility);
 let seq=0;const variable=prefix=>`${prefix}_${seq++}`,zero=variable('zero');binary.push(zero);
 const expression=terms=>{
   // An owner persists across several lunch slices. Aggregate its repeated
   // objective coefficients before serialization; LP readers need not sum
   // duplicate objective entries the way a mathematical sum would.
   const sums=new Map();for(const [c,v]of terms)sums.set(v,(sums.get(v)||0)+c);
   const entries=[...sums].filter(([,c])=>c!==0);
   return entries.length?entries.map(([v,c])=>`${c<0?'-':'+'} ${Math.abs(c)} ${v}`).join(' ').replace(/^\+ /,''):`1 ${zero}`;
  },
  constraint=(terms,relation,value)=>rows.push(` c_${rows.length}: ${expression(terms)} ${relation} ${value}`),
  key=(phase,code,slot)=>`${phase}:${code}:${slot}`,
  addActual=(slice,code,slot,v)=>{const k=key(slice,code,slot),terms=actual.get(k)||[];terms.push([1,v]);actual.set(k,terms);};
 constraint([[1,zero]],'=',0);
 for(const phase of input.phases)for(const area of phase.areas){
  const choices=area.eligibleSlotIds.map(slot=>{const v=variable('owner');binary.push(v);owners.set(key(phase.index,area.code,slot),v);return[1,v];});
  constraint(choices,'=',1);
 }
 // Keep an assigned owner until their static departure. A missing colleague
 // therefore causes a fresh, complete handoff rather than a stale old target.
 for(let i=0;i<input.phases.length-1;i++)for(const area of input.phases[i].areas)for(const slot of area.eligibleSlotIds){
  const next=owners.get(key(i+1,area.code,slot));if(next)constraint([[1,owners.get(key(i,area.code,slot))],[-1,next]],'<=',0);
 }
 for(const lunch of input.lunches){
  const terms=lunch.candidateSlotIds.map(slot=>{const v=variable('helper');binary.push(v);helpers.set(lunch.recipientSlotId+':'+slot,v);return[1,v];});constraint(terms,'=',1);
 }
 for(const slice of input.slices)for(const area of input.phases[slice.phase].areas){
  for(const slot of area.eligibleSlotIds){
   const y=owners.get(key(slice.phase,area.code,slot)),person=bySlot.get(slot);
   if(!activeAt(person.lunch,minute(slice.window.start))){addActual(slice.index,area.code,slot,y);continue;}
   const lunch=input.lunches.find(l=>l.recipientSlotId===slot);
   for(const coverer of lunch.candidateSlotIds){
    const h=helpers.get(slot+':'+coverer);
    if(!relief.has(key(slice.phase,area.code,coverer))){constraint([[1,y],[1,h]],'<=',1);continue;}
    const v=variable('relief');binary.push(v);constraint([[1,v],[-1,y]],'<=',0);constraint([[1,v],[-1,h]],'<=',0);
    constraint([[1,v],[-1,y],[-1,h]],'>=',-1);addActual(slice.index,area.code,coverer,v);
   }
  }
 }
 const distances=new Map();for(const p of input.gps.pairs){distances.set(p.from+':'+p.to,p.meters);distances.set(p.to+':'+p.from,p.meters);}
 const totalMinutes=input.slices.reduce((n,s)=>n+s.minutes,0),total=input.conservedRatingTotal;
 for(const slice of input.slices){
  const weight=slice.minutes/totalMinutes,n=slice.availableSlotIds.length;
  for(const group of input.groups){
   const all=slice.availableSlotIds.flatMap(slot=>actual.get(key(slice.index,group.code,slot))||[]);constraint(all,'=',1);
   for(const slot of slice.availableSlotIds){
    const anchors=bySlot.get(slot).baseCodes;
    const cost=anchors.reduce((sum,a)=>sum+(a===group.code?0:distances.get(a+':'+group.code)),0)/anchors.length/input.gps.maximumPairwiseMeters;
    assert.ok(Number.isFinite(cost)&&cost>=0&&cost<=1+1e-12);
    for(const [c,v]of actual.get(key(slice.index,group.code,slot))||[])objective.push([weight*75/input.groups.length*cost*c,v]);
   }
  }
  if(n>1)for(const slot of slice.availableSlotIds){
   const load=input.groups.flatMap(g=>(actual.get(key(slice.index,g.code,slot))||[]).map(([c,v])=>[c*g.points*n,v])),d=variable('deviation');
   bounds.push(` 0 <= ${d} <= ${n*total}`);
   constraint([...load,[-1,d]],'<=',total);constraint(load.map(([c,v])=>[-c,v]).concat([[-1,d]]),'<=',-total);
   objective.push([weight*25/(2*total*(n-1)),d]);
  }
 }
 const lp=`Minimize\n objective: ${expression(objective.filter(([c])=>c!==0))}\nSubject To\n${rows.join('\n')}\nBounds\n${bounds.join('\n')}\nBinary\n ${binary.join('\n ')}\nEnd`;
 assert.ok(Buffer.byteLength(lp)<4*1024*1024,'Absence proposal model exceeds its local bound');
 let solved;try{solved=await solveStaticWeeklyMip(lp,{deadline,signal});}catch(error){return{...input,status:'PROPOSAL_SOLVE_UNAVAILABLE',solverInvoked:true,reason:error.code||error.message,publicationEligible:false};}
 const result=solved.result;
 if(result?.Status!=='Optimal')return{...input,status:result?.Status==='Infeasible'?'COVERAGE_CONSTRAINTS_UNRESOLVED':'PROPOSAL_SOLVE_UNAVAILABLE',
  solverInvoked:true,solverStatus:result?.Status||null,issues:[{code:'FULL_DAY_LUNCH_AND_OWNERSHIP_CONSTRAINTS',constraint:'No accepted complete solution; no partial plan was published'}],publicationEligible:false};
 const value=v=>{const x=result.Columns?.[v]?.Primal;assert.ok(Number.isFinite(x)&&Math.abs(x-Math.round(x))<=1e-8&&x>=-1e-8&&x<=1+1e-8);return Math.round(x);};
 const phaseOwners=input.phases.map(phase=>({window:phase.window,owners:Object.fromEntries(phase.areas.map(a=>{
  const chosen=a.eligibleSlotIds.filter(s=>value(owners.get(key(phase.index,a.code,s))));assert.equal(chosen.length,1);return[a.code,chosen[0]];
 }))})),lunchPlans=input.lunches.map(l=>{
  const chosen=l.candidateSlotIds.filter(s=>value(helpers.get(l.recipientSlotId+':'+s)));assert.equal(chosen.length,1);
  const areas=[...new Set(phaseOwners.filter(p=>overlaps(p.window,l.window)).flatMap(p=>Object.entries(p.owners)
   .filter(([,owner])=>owner===l.recipientSlotId).map(([code])=>code)))].sort();
  return{recipientSlotId:l.recipientSlotId,covererSlotId:chosen[0],window:l.window,areas};
 }),coverage=input.slices.map(slice=>({window:slice.window,owners:Object.fromEntries(input.groups.map(g=>{
  const chosen=slice.availableSlotIds.filter(s=>(actual.get(key(slice.index,g.code,s))||[]).reduce((n,[c,v])=>n+c*value(v),0)===1);
  assert.equal(chosen.length,1);return[g.code,chosen[0]];
 })),zooWideCoverage:input.phases[slice.phase].onShiftSlotIds.length===1&&slice.availableSlotIds.length===1}));
 const plan={schema:'custodial.approved-manual-absence-proposal.v1',status:'COMPLETE_UNAPPROVED_FORMULA_PROPOSAL',
  inputDigest,proposalDigest:digest(proposal),serviceDate:input.serviceDate,absentPersonIds:input.absentPersonIds,
  checkedWindow:input.checkedWindow,phaseOwners,lunchPlans,coverage,groups:input.groups,
  roster:input.roster.map(({owner,availability,...p})=>p),conservedRatingTotal:total,
  solverInvoked:true,solverIdentity:solved.identity,solverStatus:result.Status,objectiveValue:result.ObjectiveValue,
  solverObjectiveScale:100,modelDigest:digest({lp}),formulaApproved:false,publicationEligible:false,weeklyBaselineChanged:false,productionWritten:false,contractorBooked:false};
 const validated=validateApprovedManualAbsenceProposal({plan,input,proposal});
 plan.normalizedScore=validated.normalizedScore;plan.scoreBreakdown=validated.scoreBreakdown;
 plan.employeePlans=plan.roster.map(person=>({...person,baseGroups:Object.entries(phaseOwners[0].owners)
  .filter(([,slot])=>slot===person.slotId).map(([code])=>code),
  lunchRelief:lunchPlans.find(l=>l.recipientSlotId===person.slotId),
  responsibilities:coverage.map(c=>({window:c.window,groups:Object.entries(c.owners).filter(([,slot])=>slot===person.slotId).map(([code])=>code),
   zooWideCoverage:c.zooWideCoverage&&Object.values(c.owners).every(slot=>slot===person.slotId)}))
   .filter(r=>r.groups.length)}));
 return{...plan,planDigest:digest(plan)};
}

// Validate full decoded ownership/relief independently of LP construction and
// solver objective claims. This deliberately confers no SQL or approval power.
export function validateApprovedManualAbsenceProposal({plan,input,proposal}){
 const {inputDigest,...inputBody}=input;assert.equal(digest(inputBody),inputDigest,'Absence input changed after preparation');
 assert.equal(plan.inputDigest,input.inputDigest);assert.equal(plan.proposalDigest,digest(proposal));
 assert.equal(plan.phaseOwners.length,input.phases.length);assert.equal(plan.coverage.length,input.slices.length);
 assert.equal(plan.lunchPlans.length,input.roster.length);
 const bySlot=new Map(input.roster.map(p=>[p.slotId,p])),groups=input.groups.map(g=>g.code).sort(),
  distances=new Map(input.gps.pairs.flatMap(p=>[[p.from+':'+p.to,p.meters],[p.to+':'+p.from,p.meters]]));
 for(const phase of input.phases){
  const selected=plan.phaseOwners[phase.index];assert.deepEqual(selected.window,phase.window);assert.deepEqual(Object.keys(selected.owners).sort(),groups);
  for(const area of phase.areas)assert.ok(area.eligibleSlotIds.includes(selected.owners[area.code]),'Ineligible normal or inherited owner');
  if(phase.index){const previous=plan.phaseOwners[phase.index-1];for(const code of groups){const owner=previous.owners[code];
   if(contains(bySlot.get(owner).shift,phase.window))assert.equal(selected.owners[code],owner,'Coverage moved before the static departure');
  }}
 }
 assert.equal(new Set(plan.lunchPlans.map(l=>l.recipientSlotId)).size,input.roster.length);
 for(const requested of input.lunches){
  const chosen=plan.lunchPlans.find(l=>l.recipientSlotId===requested.recipientSlotId);assert.ok(chosen);
  assert.deepEqual(chosen.window,requested.window);assert.ok(requested.candidateSlotIds.includes(chosen.covererSlotId));
  assert.equal(minute(chosen.window.end)-minute(chosen.window.start),60);
  const areas=[...new Set(plan.phaseOwners.filter(p=>overlaps(p.window,requested.window)).flatMap(p=>Object.entries(p.owners)
   .filter(([,owner])=>owner===requested.recipientSlotId).map(([code])=>code)))].sort();assert.deepEqual(chosen.areas,areas);
 }
 let proximity=0,load=0,totalMinutes=0;
 for(const slice of input.slices){
  const selected=plan.coverage[slice.index],phase=plan.phaseOwners[slice.phase],points=new Map(slice.availableSlotIds.map(s=>[s,0]));
  assert.deepEqual(selected.window,slice.window);assert.deepEqual(Object.keys(selected.owners).sort(),groups);
  assert.equal(selected.zooWideCoverage,input.phases[slice.phase].onShiftSlotIds.length===1&&slice.availableSlotIds.length===1);
  let pLoss=0;
  for(const group of input.groups){
   const normal=phase.owners[group.code],onLunch=activeAt(bySlot.get(normal).lunch,minute(slice.window.start)),
    lunch=onLunch?plan.lunchPlans.find(l=>l.recipientSlotId===normal):null,expected=lunch?lunch.covererSlotId:normal,
    actual=selected.owners[group.code];assert.equal(actual,expected);assert.ok(points.has(actual),'Owner absent, off shift or on lunch');
   if(onLunch)assert.ok(input.reliefEligibility.includes(`${slice.phase}:${group.code}:${actual}`),'Helper lacks inherited custody eligibility');
   points.set(actual,points.get(actual)+group.points);
   const anchors=bySlot.get(actual).baseCodes;
   pLoss+=anchors.reduce((n,a)=>n+(a===group.code?0:distances.get(a+':'+group.code)),0)/anchors.length/input.gps.maximumPairwiseMeters/input.groups.length;
  }
  const sum=[...points.values()].reduce((n,v)=>n+v,0),n=points.size;assert.equal(sum,input.conservedRatingTotal);
  const lLoss=n<=1?0:[...points.values()].reduce((v,p)=>v+Math.abs(p-sum/n),0)/(2*sum*(1-1/n));
  assert.ok(pLoss>=0&&pLoss<=1+1e-9&&lLoss>=0&&lLoss<=1+1e-9);
  proximity+=slice.minutes*pLoss;load+=slice.minutes*lLoss;totalMinutes+=slice.minutes;
 }
 proximity/=totalMinutes;load/=totalMinutes;const normalizedScore=.75*proximity+.25*load;
 assert.ok(Math.abs(plan.objectiveValue/plan.solverObjectiveScale-normalizedScore)<1e-6,
  `Decoded plan differs from solver objective: solver=${plan.objectiveValue}, scale=${plan.solverObjectiveScale}, score=${normalizedScore}, proximity=${proximity}, load=${load}`);
 return{normalizedScore,scoreBreakdown:{proximityLoss:proximity,loadLoss:load,priorityWeight:0},
  areaOwnershipChecks:input.groups.length*input.slices.length,fullHourLunches:input.lunches.length,formulaApproved:false,publicationEligible:false};
}
