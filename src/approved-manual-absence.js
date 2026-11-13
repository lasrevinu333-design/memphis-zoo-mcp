import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {postgresJsonbContentDigest as digest} from './static-weekly-schedule-program.js';
import {assertNormalOwnerEligibility,validateOwnerEligibilityConfig} from './static-weekly-owner-eligibility.js';
import {prepareApprovedManualAccessProposal} from './approved-manual-gps.js';
import {solveStaticWeeklyMip} from './static-weekly-schedule-solver.js';
import {snapshotContractorCapacity} from './static-weekly-schedule-model.js';

const minute=t=>Number(t.slice(0,2))*60+Number(t.slice(3));
const contains=(a,b)=>minute(a.start)<=minute(b.start)&&minute(a.end)>=minute(b.end);
const overlaps=(a,b)=>minute(a.start)<minute(b.end)&&minute(b.start)<minute(a.end);
const activeAt=(window,t)=>minute(window.start)<=t&&t<minute(window.end);
const time=m=>`${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
const inherited='INHERITED_ALERTS_AND_ISSUES_ONLY';
const tammyCore=['TETON','NORTH_WEST_PASSAGE','EAST_END_RESTROOMS'];
const preferredCore={KAREN:['ZAMBEZI','PRIMATE_PAVILLION'],KATHY:['EAST_ADMIN','WEST_ADMIN']};
export function readApprovedManualAbsenceObjective(){
 const objective=JSON.parse(readFileSync(new URL('../config/schedules/manual-approved-20261030/absence-objective-proposal.json',import.meta.url),'utf8'));
 assert.equal(objective.approval,'OWNER_APPROVED');assert.equal(objective.ownerApproval?.confirmed,true);
 assert.equal(objective.ownerApproval.questionId,'call_97aaa12c08a84a0e8afed222696e481c');
 assert.equal(objective.ownerApproval.chatId,'01a15718-2d88-7de1-8cec-6cdc241f0151');
 assert.equal(objective.ownerApproval.scope,'DATED_ABSENCE_ADJUSTMENTS_ONLY');
 assert.equal(objective.ownerApproval.normalSchedulesMayChange,false);
 return objective;
}

// Input preparation for the new full-day absence objective. Reuse maintained
// personal eligibility, qualifications and the bounded local HiGHS worker.
// This returns DATA only: it cannot authorize a publication, edit a weekly
// baseline, invent employee availability, book contractors or issue receipts.
export function prepareApprovedManualAbsenceDay({week,source,ownerConfig,serviceDate,absentPersonIds,preStartPersonIds=[]}){
 assert.match(serviceDate,/^\d{4}-\d{2}-\d{2}$/);
 const date=new Date(serviceDate+'T12:00:00Z');assert.equal(date.toISOString().slice(0,10),serviceDate);
 const weekday=date.getUTCDay(),day=week.days.find(d=>d.weekday===weekday),version=source.version||source.versions?.[0];
 assert.ok(day&&version);validateOwnerEligibilityConfig(ownerConfig);
 assert.equal(ownerConfig.approvedManualDataDigest,week.dataDigest);
 assert.equal(version.manualGroupRatingAuthority?.manifestSha256,week.manifestSha256);
 assert.equal(week.ratings.length,23);assert.equal(week.ratings.reduce((n,r)=>n+r.score,0),136);
 assert.ok(Array.isArray(absentPersonIds)&&absentPersonIds.every(p=>typeof p==='string'));
 assert.equal(new Set(absentPersonIds).size,absentPersonIds.length,'Duplicate absent employee');
 assert.ok(Array.isArray(preStartPersonIds)&&new Set(preStartPersonIds).size===preStartPersonIds.length&&preStartPersonIds.every(id=>absentPersonIds.includes(id)),'Pre-start is a distinct unavailable classification');
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
  formulaObjectiveDigest:digest(readApprovedManualAbsenceObjective()),
  absentPersonIds:[...absent].sort(),...(preStartPersonIds.length?{preStartPersonIds:[...preStartPersonIds].sort(),preStartClassification:'PRE_START_NOT_PTO'}:{}),checkedWindow:structuredClone(day.checkedWindow),
  publicationEligible:false,formulaApproved:true,productionWritten:false,contractorBooked:false};
 if(absent.size===0)return{...common,status:'UNCHANGED_APPROVED_DAY',day:structuredClone(day),solverInvoked:false};
 if(absent.size>=3)return{...common,status:'MANAGER_COVERALL_DECISION_REQUIRED',solverInvoked:false,
  reason:'Retain the accepted one/two-absence adjustment and request a manager-confirmed CoverAll substitute with verified actual hours. Do not reshuffle everyone for the third absence.'};
 const remaining=roster.filter(p=>!absent.has(p.personId)),groups=week.ratings.map(r=>{
  const b=groupBinding.get(r.group);return{code:b.referenceCode,name:r.group,points:r.score,locationId:b.primaryLocationId};
 }).sort((a,b)=>a.code.localeCompare(b.code)),issues=[];
 // Full-site custody starts once the remaining scheduled crew has arrived
 // and lasts to their actual final static departure. Absence never extends
 // another employee's shift or preserves a phantom closer's working hour.
 common.checkedWindow={start:remaining.map(p=>p.shift.start).sort().at(-1),end:remaining.map(p=>p.shift.end).sort().at(-1)};
 const checkedWindow=common.checkedWindow;
 const eligible=(person,work,purpose)=>{
  const code=work.locationCodeSnapshot;
  // These are dated-absence rules only. The normal owner config and all seven
  // approved normal days remain exact. Karen/Kathy geography is a preference;
  // personal hard restrictions and Alijah's normal-only rule still apply.
  if(person.owner.key==='TAMMY'&&![...tammyCore,'CHINA'].includes(code))return false;
  const owner=preferredCore[person.owner.key]?{...person.owner,normalAssignmentFamilies:groups.map(g=>g.code)}:person.owner;
  try{assertNormalOwnerEligibility(owner,code,weekday,purpose);}catch{return false;}
  const qualified=new Set(person.availability.qualifications);
  if((work.requiredQualifications||[]).some(q=>!qualified.has(q))||person.availability.restrictions.includes(work.locationId))return false;
  // Only the already classified Alijah NORMAL-only Herpetarium restriction
  // permits inherited radio/issue custody. All other source restrictions stay.
  const normalOnly=person.owner.normalForbiddenFamiliesByDay?.[weekday]?.includes(work.locationCodeSnapshot);
  return !(work.restrictedSlotIds||[]).includes(person.slotId)||(purpose===inherited&&normalOnly===true);
 };
 const phases=day.phases.map((phase,index)=>({phase,index,window:{start:index===0?checkedWindow.start:phase.start,
  end:phase.end<checkedWindow.end?phase.end:checkedWindow.end}})).filter(p=>p.window.start<p.window.end).map(({phase,index,window})=>{
  const onShift=remaining.filter(p=>contains(p.shift,window)),areas=groups.map(group=>{
   const rows=version.assignments.filter(w=>w.dayOfWeek===weekday&&w.locationCodeSnapshot===group.code&&contains(w.window,{start:phase.start,end:phase.end}));
   assert.equal(rows.length,1,'Every approved phase must retain one exact source requirement');
   const work=rows[0],purpose=index===0?'NORMAL_AREA_OWNERSHIP':inherited,
    approved=binding.get(phase.owners[group.name]);assert.equal(work.ownerSlotId,approved.slotId);
   let choices=onShift.filter(p=>eligible(p,work,purpose));
   const tammy=onShift.find(p=>p.owner.key==='TAMMY');
   if(tammy&&tammyCore.includes(group.code))choices=choices.filter(p=>p.slotId===tammy.slotId);
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
 const boundaries=new Set([minute(checkedWindow.start),minute(checkedWindow.end)]);
 for(const phase of phases){boundaries.add(minute(phase.window.start));boundaries.add(minute(phase.window.end));}
 for(const p of remaining){for(const window of [p.shift,p.lunch]){boundaries.add(minute(window.start));boundaries.add(minute(window.end));}}
 const edges=[...boundaries].filter(m=>m>=minute(checkedWindow.start)&&m<=minute(checkedWindow.end)).sort((a,b)=>a-b),slices=[];
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
  roster:remaining,groups,phases,lunches,slices,reliefEligibility,issues,access:prepareApprovedManualAccessProposal(week),
  conservedRatingTotal:136,priorityWeight:0,weeklyBaselineChanged:false,solverInvoked:false};
 return{...body,inputDigest:digest(body)};
}

// The owner approved this exact formula on October30. This existing bounded
// engine returns a validated dated draft, never a SQL publication receipt.
export async function solveApprovedManualAbsenceAdjustment(input,{proposal=readApprovedManualAbsenceObjective(),deadline=performance.now()+25000,signal}={}){
 assert.equal(proposal?.schema,'custodial.manual-absence-objective-proposal.v2');
 assert.deepEqual(proposal,readApprovedManualAbsenceObjective(),'Only the exact owner-approved formula may be used');
 assert.equal(proposal.approval,'OWNER_APPROVED');assert.equal(proposal.productionActive,false);
 assert.deepEqual(proposal.weights,{proximity:75,load:25,priority:0});
 assert.equal(proposal.proximity.metric,'SAVED_ACCESS_ADJUSTED_HAVERSINE_PENALTY');
 assert.equal(proposal.proximity.anchor,"Nearest of each recipient's approved normal base groups; never transferred groups");
 assert.equal(proposal.proximity.fixedDenominatorMeters,807.6262463035904);
 assert.equal(proposal.proximity.directConnectionFactor,.8);assert.equal(proposal.proximity.sharedNeighborhoodFactor,.9);
 assert.equal(proposal.proximity.otherFactor,1);assert.equal(proposal.proximity.overlapsStacked,false);
 assert.equal(proposal.proximity.transitiveNeighborhoodMerging,false);
 assert.equal(proposal.load.normalizer,'100 * sum_i abs(points_i - S/n) / (2*S*(1-1/n))');
 assert.equal(proposal.load.S,136);
 assert.equal(proposal.load.n,'Actual custodians available in the time slice, excluding their own lunches');
 assert.equal(proposal.load.singleCustodianLoss,0);
 if(input.status!=='PREPARED_FOR_EXPLICIT_OBJECTIVE')return structuredClone(input);
 const {inputDigest,...body}=input;assert.equal(digest(body),inputDigest,'Absence input changed after preparation');
 assert.equal(input.formulaObjectiveDigest,digest(proposal),'Prepared day belongs to a different objective approval');
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
 for(let i=0;i<input.lunches.length;i++)for(let j=i+1;j<input.lunches.length;j++){
  const a=input.lunches[i],b=input.lunches[j];if(!overlaps(a.window,b.window))continue;
  for(const slot of a.candidateSlotIds.filter(s=>b.candidateSlotIds.includes(s)))
   constraint([[1,helpers.get(a.recipientSlotId+':'+slot)],[1,helpers.get(b.recipientSlotId+':'+slot)]],'<=',1);
 }
 for(const slice of input.slices)for(const area of input.phases[slice.phase].areas){
  for(const slot of area.eligibleSlotIds){
   const y=owners.get(key(slice.phase,area.code,slot)),person=bySlot.get(slot);
   if(!activeAt(person.lunch,minute(slice.window.start))){addActual(slice.index,area.code,slot,y);continue;}
   const lunch=input.lunches.find(l=>l.recipientSlotId===slot);
   for(const coverer of lunch.candidateSlotIds){
    const h=helpers.get(slot+':'+coverer);
    if(!relief.has(key(slice.phase,area.code,coverer))){constraint([[1,y],[1,h]],'<=',1);continue;}
    // A product of two binary decisions is integral under these three rows;
    // a redundant binary declaration makes the bounded solve much harder.
    const v=variable('relief');bounds.push(` 0 <= ${v} <= 1`);constraint([[1,v],[-1,y]],'<=',0);constraint([[1,v],[-1,h]],'<=',0);
    constraint([[1,v],[-1,y],[-1,h]],'>=',-1);addActual(slice.index,area.code,coverer,v);
   }
  }
 }
 // Complete hard feasibility comes first. No weighted proximity/workload
 // objective is constructed or evaluated until this decoded plan passes the
 // independent ownership/lunch validator.
 for(const slice of input.slices)for(const group of input.groups){
  const all=slice.availableSlotIds.flatMap(slot=>actual.get(key(slice.index,group.code,slot))||[]);constraint(all,'=',1);
 }
 const decode=result=>{
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
  return{schema:'custodial.approved-manual-absence-plan.v1',status:'COMPLETE_APPROVED_FORMULA_ADJUSTMENT_DRAFT',
   inputDigest,proposalDigest:digest(proposal),serviceDate:input.serviceDate,absentPersonIds:input.absentPersonIds,
   checkedWindow:input.checkedWindow,phaseOwners,lunchPlans,coverage,groups:input.groups,
   roster:input.roster.map(({owner,availability,...p})=>p),conservedRatingTotal:input.conservedRatingTotal,
   formulaApproved:true,publicationEligible:false,weeklyBaselineChanged:false,productionWritten:false,contractorBooked:false};
 };
 const stages=[];
 const runStage=async(terms,name)=>{
  const lp=`Minimize\n objective: ${expression(terms)}\nSubject To\n${rows.join('\n')}\nBounds\n${bounds.join('\n')}\nBinary\n ${binary.join('\n ')}\nEnd`;
  assert.ok(Buffer.byteLength(lp)<4*1024*1024,'Absence proposal model exceeds its local bound');
  let solved;try{solved=await solveStaticWeeklyMip(lp,{deadline,signal});}catch(error){return{failure:{...input,status:'PROPOSAL_SOLVE_UNAVAILABLE',solverInvoked:true,reason:error.code||'LOCAL_SOLVER_FAILURE',solverDetail:error.message,failedStage:name,modelBytes:Buffer.byteLength(lp),completedStages:stages,publicationEligible:false}};}
  const result=solved.result;
  if(result?.Status!=='Optimal')return{failure:{...input,status:result?.Status==='Infeasible'?'COVERAGE_CONSTRAINTS_UNRESOLVED':'PROPOSAL_SOLVE_UNAVAILABLE',
   solverInvoked:true,solverStatus:result?.Status||null,issues:[{code:'FULL_DAY_LUNCH_AND_OWNERSHIP_CONSTRAINTS',constraint:'No accepted complete solution; no partial plan was published'}],publicationEligible:false}};
  const plan=decode(result);validateApprovedManualAbsenceCoverage({plan,input,proposal});
  const modelDigest=digest({lp});stages.push({stage:name,solverStatus:result.Status,objectiveValue:result.ObjectiveValue,modelDigest,coverageValidated:true});
  return{plan,result,identity:solved.identity,modelDigest};
 };
 let stage=await runStage([],'HARD_FEASIBILITY');if(stage.failure)return stage.failure;
 const tammy=input.roster.find(p=>p.owner.key==='TAMMY'),
  tammyExtras=tammy?input.slices.flatMap(s=>(actual.get(key(s.index,'CHINA',tammy.slotId))||[]).map(([c,v])=>[s.minutes*c,v])):[],
  tammyRelief=tammy?input.lunches.filter(l=>l.candidateSlotIds.includes(tammy.slotId)).map(l=>[1,helpers.get(l.recipientSlotId+':'+tammy.slotId)]):[];
 const coreMoves=input.phases.flatMap(phase=>input.roster.flatMap(person=>{
  if(!preferredCore[person.owner.key]||!phase.onShiftSlotIds.includes(person.slotId))return[];
  return phase.areas.filter(a=>preferredCore[person.owner.key].includes(a.code)).flatMap(area=>
   area.eligibleSlotIds.filter(slot=>slot!==person.slotId).map(slot=>[minute(phase.window.end)-minute(phase.window.start),owners.get(key(phase.index,area.code,slot))]));
 }));
 const policyLimits={tammyChinaExtraMinutes:0,tammyReliefAppointments:0,preferredCoreMovedMinutes:0};
 for(const [name,terms,field]of [['TAMMY_EXTRAS_LAST',tammyExtras,'tammyChinaExtraMinutes'],
  ['TAMMY_RELIEF_LAST',tammyRelief,'tammyReliefAppointments'],['RETAIN_PREFERRED_CORE',coreMoves,'preferredCoreMovedMinutes']]){
  if(!terms.length)continue;
  stage=await runStage(terms,name);if(stage.failure)return stage.failure;
  const best=Math.round(stage.result.ObjectiveValue);assert.ok(Math.abs(best-stage.result.ObjectiveValue)<1e-6);
  policyLimits[field]=best;constraint(terms,'=',best);
 }
 // Keep the already validated whole-hour appointments while optimizing area
 // owners. This removes helper/area product branching from the weighted solve
 // and stays inside the maintained worker's memory bound. Do not claim global
 // optimality across alternative helper rosters.
 for(const lunch of input.lunches){
  const selected=stage.plan.lunchPlans.find(l=>l.recipientSlotId===lunch.recipientSlotId).covererSlotId;
  for(const slot of lunch.candidateSlotIds)constraint([[1,helpers.get(lunch.recipientSlotId+':'+slot)]],'=',slot===selected?1:0);
 }
 const distances=new Map();for(const p of input.access.pairs){distances.set(p.from+':'+p.to,p.accessPenaltyMeters);distances.set(p.to+':'+p.from,p.accessPenaltyMeters);}
 const totalMinutes=input.slices.reduce((n,s)=>n+s.minutes,0),total=input.conservedRatingTotal;
 for(const slice of input.slices){
  const weight=slice.minutes/totalMinutes,n=slice.availableSlotIds.length;
  for(const group of input.groups){
   for(const slot of slice.availableSlotIds){
    const anchors=bySlot.get(slot).baseCodes;
    const cost=Math.min(...anchors.map(a=>a===group.code?0:distances.get(a+':'+group.code)))/input.access.fixedDenominatorMeters;
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
 stage=await runStage(objective.filter(([c])=>c!==0),'APPROVED_75_25_ADJUSTMENT');if(stage.failure)return stage.failure;
 const plan={...stage.plan,solverInvoked:true,solverIdentity:stage.identity,solverStatus:stage.result.Status,
  objectiveValue:stage.result.ObjectiveValue,solverObjectiveScale:100,modelDigest:stage.modelDigest,stages,policyLimits,
  hardFeasibilityValidatedBeforeScoring:true,optimizerScope:'AREA_OWNERS_WITH_VALIDATED_FULL_HOUR_HELPERS_FIXED',globalOptimalityClaim:false};
 const validated=validateApprovedManualAbsenceProposal({plan,input,proposal});
 plan.normalizedScore=validated.normalizedScore;plan.scoreBreakdown=validated.scoreBreakdown;
 plan.employeePlans=plan.roster.map(person=>({...person,baseGroups:Object.entries(plan.phaseOwners[0].owners)
  .filter(([,slot])=>slot===person.slotId).map(([code])=>code),
  lunchRelief:plan.lunchPlans.find(l=>l.recipientSlotId===person.slotId),
  responsibilities:plan.coverage.map(c=>({window:c.window,groups:Object.entries(c.owners).filter(([,slot])=>slot===person.slotId).map(([code])=>code),
   zooWideCoverage:c.zooWideCoverage&&Object.values(c.owners).every(slot=>slot===person.slotId)}))
   .filter(r=>r.groups.length)}));
 return{...plan,planDigest:digest(plan)};
}

// Validate full decoded ownership/relief independently of LP construction and
// solver objective claims. This deliberately confers no SQL or approval power.
export function validateApprovedManualAbsenceCoverage({plan,input,proposal}){
 const {inputDigest,...inputBody}=input;assert.equal(digest(inputBody),inputDigest,'Absence input changed after preparation');
 assert.equal(input.formulaObjectiveDigest,digest(readApprovedManualAbsenceObjective()));
 assert.equal(plan.inputDigest,input.inputDigest);assert.equal(plan.proposalDigest,digest(proposal));
 assert.equal(plan.phaseOwners.length,input.phases.length);assert.equal(plan.coverage.length,input.slices.length);
 assert.equal(plan.lunchPlans.length,input.roster.length);
 assert.equal(plan.serviceDate,input.serviceDate);assert.deepEqual(plan.absentPersonIds,input.absentPersonIds);
 assert.deepEqual(plan.checkedWindow,input.checkedWindow);assert.deepEqual(plan.groups,input.groups);
 assert.deepEqual(plan.roster,input.roster.map(({owner,availability,...p})=>p));
 assert.equal(plan.conservedRatingTotal,136);
 assert.equal(plan.formulaApproved,true);
 for(const flag of ['publicationEligible','weeklyBaselineChanged','productionWritten','contractorBooked'])assert.equal(plan[flag],false);
 const bySlot=new Map(input.roster.map(p=>[p.slotId,p])),groups=input.groups.map(g=>g.code).sort();
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
 for(let i=0;i<plan.lunchPlans.length;i++)for(let j=i+1;j<plan.lunchPlans.length;j++){
  const a=plan.lunchPlans[i],b=plan.lunchPlans[j];
  assert.ok(a.covererSlotId!==b.covererSlotId||!overlaps(a.window,b.window),'One helper cannot accept overlapping full-hour relief appointments');
 }
 let tammyChinaExtraMinutes=0,preferredCoreMovedMinutes=0;
 for(const phase of input.phases)for(const person of input.roster){
  if(!preferredCore[person.owner.key]||!phase.onShiftSlotIds.includes(person.slotId))continue;
  for(const code of preferredCore[person.owner.key])if(plan.phaseOwners[phase.index].owners[code]!==person.slotId)
   preferredCoreMovedMinutes+=minute(phase.window.end)-minute(phase.window.start);
 }
 for(const slice of input.slices){
  const selected=plan.coverage[slice.index],phase=plan.phaseOwners[slice.phase],points=new Map(slice.availableSlotIds.map(s=>[s,0]));
  assert.deepEqual(selected.window,slice.window);assert.deepEqual(Object.keys(selected.owners).sort(),groups);
  assert.equal(selected.zooWideCoverage,input.phases[slice.phase].onShiftSlotIds.length===1&&slice.availableSlotIds.length===1);
  for(const group of input.groups){
   const normal=phase.owners[group.code],onLunch=activeAt(bySlot.get(normal).lunch,minute(slice.window.start)),
    lunch=onLunch?plan.lunchPlans.find(l=>l.recipientSlotId===normal):null,expected=lunch?lunch.covererSlotId:normal,
    actual=selected.owners[group.code];assert.equal(actual,expected);assert.ok(points.has(actual),'Owner absent, off shift or on lunch');
   if(onLunch)assert.ok(input.reliefEligibility.includes(`${slice.phase}:${group.code}:${actual}`),'Helper lacks inherited custody eligibility');
   if(bySlot.get(actual).owner.key==='TAMMY'){
    assert.ok([...tammyCore,'CHINA'].includes(group.code),'Tammy received an unauthorized extra area');
    if(group.code==='CHINA')tammyChinaExtraMinutes+=slice.minutes;
   }
   const tammy=input.roster.find(p=>p.owner.key==='TAMMY');
   if(tammy&&tammyCore.includes(group.code)&&activeAt(tammy.shift,minute(slice.window.start))&&!activeAt(tammy.lunch,minute(slice.window.start)))
    assert.equal(actual,tammy.slotId,'Tammy lost a protected area while available');
   points.set(actual,points.get(actual)+group.points);
  }
  assert.equal([...points.values()].reduce((n,v)=>n+v,0),input.conservedRatingTotal);
 }
 const tammy=input.roster.find(p=>p.owner.key==='TAMMY'),tammyReliefAppointments=tammy?plan.lunchPlans.filter(l=>l.covererSlotId===tammy.slotId).length:0;
 if(plan.policyLimits){assert.equal(tammyChinaExtraMinutes,plan.policyLimits.tammyChinaExtraMinutes);assert.equal(tammyReliefAppointments,plan.policyLimits.tammyReliefAppointments);assert.equal(preferredCoreMovedMinutes,plan.policyLimits.preferredCoreMovedMinutes);}
 return{areaOwnershipChecks:input.groups.length*input.slices.length,fullHourLunches:input.lunches.length,
  tammyChinaExtraMinutes,tammyReliefAppointments,preferredCoreMovedMinutes,formulaApproved:true,publicationEligible:false};
}

export function validateApprovedManualAbsenceProposal({plan,input,proposal}){
 const coverage=validateApprovedManualAbsenceCoverage({plan,input,proposal}),bySlot=new Map(input.roster.map(p=>[p.slotId,p])),
  distances=new Map(input.access.pairs.flatMap(p=>[[p.from+':'+p.to,p.accessPenaltyMeters],[p.to+':'+p.from,p.accessPenaltyMeters]]));
 assert.equal(plan.hardFeasibilityValidatedBeforeScoring,true);
 assert.equal(plan.stages[0].stage,'HARD_FEASIBILITY');assert.ok(plan.stages.every(s=>s.coverageValidated===true));
 let proximity=0,load=0,totalMinutes=0;
 for(const slice of input.slices){
  const selected=plan.coverage[slice.index],points=new Map(slice.availableSlotIds.map(s=>[s,0]));let pLoss=0;
  for(const group of input.groups){
   const actual=selected.owners[group.code],anchors=bySlot.get(actual).baseCodes;
   points.set(actual,points.get(actual)+group.points);
   pLoss+=Math.min(...anchors.map(a=>a===group.code?0:distances.get(a+':'+group.code)))/input.access.fixedDenominatorMeters/input.groups.length;
  }
  const sum=input.conservedRatingTotal,n=points.size;
  const lLoss=n<=1?0:[...points.values()].reduce((v,p)=>v+Math.abs(p-sum/n),0)/(2*sum*(1-1/n));
  assert.ok(pLoss>=0&&pLoss<=1+1e-9&&lLoss>=0&&lLoss<=1+1e-9);
  proximity+=slice.minutes*pLoss;load+=slice.minutes*lLoss;totalMinutes+=slice.minutes;
 }
 proximity/=totalMinutes;load/=totalMinutes;const normalizedScore=.75*proximity+.25*load;
 assert.ok(Math.abs(plan.objectiveValue/plan.solverObjectiveScale-normalizedScore)<1e-6,
  `Decoded plan differs from solver objective: solver=${plan.objectiveValue}, scale=${plan.solverObjectiveScale}, score=${normalizedScore}, proximity=${proximity}, load=${load}`);
 return{...coverage,normalizedScore,scoreBreakdown:{proximityPenalty:100*proximity,workloadPenalty:100*load,
  combinedPenalty:100*normalizedScore,scale:{minimum:0,maximum:100,lowerIsBetter:true},priorityWeight:0}};
}

// A third absence replaces one person's duties in the retained dated plan.
// This does not run an optimizer, move the other normal owners, book a vendor,
// authenticate a manager or publish anything. The normal authenticated manager
// admission path must supply and retain the actual-hours confirmation.
export function applyApprovedManualCoverAllSubstitute({acceptedPlan,input,proposal,source,absentPersonId,substitute}){
 validateApprovedManualAbsenceProposal({plan:acceptedPlan,input,proposal});
 assert.equal(input.absentPersonIds.length,2,'A third-absence substitution requires the retained two-absence plan');
 assert.equal(digest(source),input.sourceDigest,'Contractor capacity must belong to the same source');
 const {planDigest,...acceptedBody}=acceptedPlan;assert.equal(digest(acceptedBody),planDigest,'Retained dated plan changed');
 const replaced=input.roster.find(p=>p.personId===absentPersonId);assert.ok(replaced,'Third absent employee must be working in the retained plan');
 assert.equal(substitute?.serviceDate,input.serviceDate);assert.equal(substitute.managerConfirmed,true);
 assert.equal(substitute.actualHoursConfirmed,true,'Actual CoverAll hours must be confirmed, never inferred from a template');
 assert.ok(typeof substitute.confirmationReference==='string'&&substitute.confirmationReference.trim().length>0&&substitute.confirmationReference.length<=256);
 const window=value=>{
  assert.ok(value&&typeof value==='object');for(const field of ['start','end'])assert.match(value[field],/^(?:[01]\d|2[0-3]):[0-5]\d$/);
  assert.ok(minute(value.end)>minute(value.start));return{start:value.start,end:value.end};
 },shift=window(substitute.shift),lunch=window(substitute.lunch);
 assert.equal(minute(lunch.end)-minute(lunch.start),60,'CoverAll also requires a full-hour lunch');
 assert.ok(contains(shift,lunch),'CoverAll lunch is outside confirmed actual hours');
 const capacity=source.slots.find(s=>s.id===substitute.slotId&&s.contractorCapacity===true),
  template=capacity?.contractorAvailability?.find(a=>a.dayOfWeek===input.weekday);
 assert.ok(capacity&&template,'Select existing source-bound CoverAll capacity');
 snapshotContractorCapacity(capacity,input.serviceDate);
 assert.ok(!input.roster.some(p=>p.slotId===capacity.id));
 assert.ok(Array.isArray(template.qualifications)&&template.qualificationProvenance);
 assert.ok(Array.isArray(template.restrictions)&&template.restrictionProvenance);
 const replaceSlot=slot=>slot===replaced.slotId?capacity.id:slot,
  retainedPhaseOwners=acceptedPlan.phaseOwners.map(p=>({window:structuredClone(p.window),owners:Object.fromEntries(Object.entries(p.owners).map(([g,s])=>[g,replaceSlot(s)]))})),
  phaseOwners=[...retainedPhaseOwners],phaseOrigins=input.phases.map(p=>p.index),
  checkedWindow={start:input.checkedWindow.start,
   end:shift.end>input.checkedWindow.end?shift.end:input.checkedWindow.end},
  roster=input.roster.filter(p=>p.slotId!==replaced.slotId).map(p=>({slotId:p.slotId,personId:p.personId,name:p.name,shift:p.shift,lunch:p.lunch,kind:'EMPLOYEE'}));
 roster.push({slotId:capacity.id,name:capacity.label,kind:'CONTRACTOR_CAPACITY',shift,lunch,replacesPersonId:replaced.personId});
 // Confirmed extra hours create only dated inherited custody, never an
 // extension of an employee's shift or a new normal cleaning assignment.
 const allAreas=()=>Object.fromEntries(input.groups.map(g=>[g.code,capacity.id]));
 if(checkedWindow.end>input.checkedWindow.end){phaseOwners.push({window:{start:input.checkedWindow.end,end:checkedWindow.end},owners:allAreas()});phaseOrigins.push(input.phases.length-1);}
 const bySlot=new Map(roster.map(p=>[p.slotId,p])),oldLunch=acceptedPlan.lunchPlans.find(l=>l.recipientSlotId===replaced.slotId),
  sameLunch=oldLunch.window.start===lunch.start&&oldLunch.window.end===lunch.end;
 const coverer=substitute.lunchCovererSlotId??(sameLunch?oldLunch.covererSlotId:null);
 assert.ok(typeof coverer==='string','A changed CoverAll lunch needs an explicit full-hour helper');
 const lunchPlans=acceptedPlan.lunchPlans.map(l=>{
  const recipientSlotId=replaceSlot(l.recipientSlotId),chosenWindow=l.recipientSlotId===replaced.slotId?lunch:l.window,
   covererSlotId=l.recipientSlotId===replaced.slotId?coverer:replaceSlot(l.covererSlotId),
   areas=[...new Set(phaseOwners.filter(p=>overlaps(p.window,chosenWindow)).flatMap(p=>Object.entries(p.owners).filter(([,s])=>s===recipientSlotId).map(([g])=>g)))].sort();
  return{recipientSlotId,covererSlotId,window:structuredClone(chosenWindow),areas};
 });
 for(const relief of lunchPlans){
  const recipient=bySlot.get(relief.recipientSlotId),helper=bySlot.get(relief.covererSlotId);
  assert.ok(recipient&&helper&&recipient!==helper,'Every lunch needs a different named helper');
  assert.ok(contains(recipient.shift,relief.window)&&contains(helper.shift,relief.window)&&!overlaps(helper.lunch,relief.window),'Actual CoverAll/employee hours cannot provide this full-hour relief');
  assert.equal(minute(relief.window.end)-minute(relief.window.start),60);
 }
 for(let i=0;i<lunchPlans.length;i++)for(let j=i+1;j<lunchPlans.length;j++){
  const a=lunchPlans[i],b=lunchPlans[j];
  assert.ok(a.covererSlotId!==b.covererSlotId||!overlaps(a.window,b.window),'CoverAll lunch creates overlapping helper appointments');
 }
 const edges=new Set([minute(checkedWindow.start),minute(checkedWindow.end)]);
 for(const p of phaseOwners)for(const t of Object.values(p.window))edges.add(minute(t));
 for(const p of roster)for(const w of [p.shift,p.lunch])for(const t of Object.values(w))edges.add(minute(t));
 const ordered=[...edges].filter(t=>t>=minute(checkedWindow.start)&&t<=minute(checkedWindow.end)).sort((a,b)=>a-b),coverage=[];
 for(let i=0;i<ordered.length-1;i++){
  const start=ordered[i],end=ordered[i+1],w={start:time(start),end:time(end)},phaseIndex=phaseOwners.findIndex(p=>activeAt(p.window,start)),sourcePhaseIndex=phaseOrigins[phaseIndex],
   phase=phaseOwners[phaseIndex],available=roster.filter(p=>contains(p.shift,w)&&!overlaps(p.lunch,w)),
   onShift=roster.filter(p=>contains(p.shift,w));assert.ok(phase&&available.length);
  const owners={};let total=0;
  for(const group of input.groups){
   const normal=bySlot.get(phase.owners[group.code]);assert.ok(normal&&contains(normal.shift,w),'CoverAll actual shift misses a retained normal or inherited duty');
   const onLunch=activeAt(normal.lunch,start),relief=onLunch?lunchPlans.find(l=>l.recipientSlotId===normal.slotId):null,
    actual=onLunch?bySlot.get(relief?.covererSlotId):normal;
   assert.ok(actual&&available.some(p=>p.slotId===actual.slotId),'An owner is off shift or on lunch');
   const area=input.phases[sourcePhaseIndex].areas.find(a=>a.code===group.code);
   if(actual.slotId===capacity.id){
    assert.ok((area.work.requiredQualifications||[]).every(q=>template.qualifications.includes(q))&&!template.restrictions.includes(area.work.locationId),'CoverAll source qualifications/restrictions do not permit these duties');
    assert.ok(!(area.work.restrictedSlotIds||[]).includes(capacity.id));
   }else if(onLunch){
    assert.ok(input.reliefEligibility.includes(`${sourcePhaseIndex}:${group.code}:${actual.slotId}`),'The named helper cannot inherit this area');
    const original=input.roster.find(p=>p.slotId===actual.slotId);
    if(original.owner.key==='TAMMY'&&group.code==='CHINA'){
     const prior=acceptedPlan.coverage.find(c=>activeAt(c.window,start));
     assert.equal(prior.owners.CHINA,actual.slotId,'CoverAll substitution cannot introduce new extras for Tammy');
    }
   }
   owners[group.code]=actual.slotId;total+=group.points;
  }
  assert.equal(total,136);assert.equal(Object.keys(owners).length,23);
  coverage.push({window:w,owners,zooWideCoverage:onShift.length===1&&available.length===1});
 }
 // Mechanical proof that every other normal assignment and relief appointment
 // remains the same. Only the missing person is replaced by source capacity.
 for(let i=0;i<retainedPhaseOwners.length;i++)for(const [g,slot]of Object.entries(acceptedPlan.phaseOwners[i].owners))assert.equal(retainedPhaseOwners[i].owners[g],replaceSlot(slot));
 for(const original of acceptedPlan.lunchPlans.filter(l=>l.recipientSlotId!==replaced.slotId)){
  const retained=lunchPlans.find(l=>l.recipientSlotId===original.recipientSlotId);
  assert.deepEqual(retained.window,original.window);assert.equal(retained.covererSlotId,replaceSlot(original.covererSlotId));
 }
 const extension=checkedWindow.start!==input.checkedWindow.start||checkedWindow.end!==input.checkedWindow.end;
 const body={schema:extension?'custodial.approved-manual-coverall-overlay.v2':'custodial.approved-manual-coverall-overlay.v1',status:'VALIDATED_UNPUBLISHED_COVERALL_OVERLAY',
  serviceDate:input.serviceDate,acceptedPlanDigest:planDigest,sourceDigest:input.sourceDigest,
  absentPersonIds:[...input.absentPersonIds,absentPersonId].sort(),replacedPersonId:absentPersonId,
  substitute:{slotId:capacity.id,kind:'CONTRACTOR_CAPACITY',shift,lunch,confirmationReference:substitute.confirmationReference,
   actualHoursConfirmed:true,managerConfirmationIsCallerInput:true},
  checkedWindow,phaseOwners,lunchPlans,coverage,roster,groups:input.groups,conservedRatingTotal:136,
  ...(extension?{normalCoverageWindow:structuredClone(input.checkedWindow),confirmedCoverageExtension:{
   beforeNormalMinutes:minute(input.checkedWindow.start)-minute(checkedWindow.start),
   afterNormalMinutes:minute(checkedWindow.end)-minute(input.checkedWindow.end),
   ownerSlotId:capacity.id,purpose:'INHERITED_ALERTS_AND_ISSUES_ONLY',employeeShiftExtensions:false}}:{}),
  solverInvoked:false,scoringRerun:false,otherNormalOwnersChanged:false,weeklyBaselineChanged:false,
  formulaApproved:true,publicationEligible:false,productionWritten:false,contractorBooked:false};
 return{...body,overlayDigest:digest(body)};
}

// Compose the existing day engine over one aligned coverage period. The
// authenticated owner must supply normalized ACCEPTED facts and any original
// accepted day basis. This pure DATA adapter has no SQL, signing or authority.
// Normal days bypass the solver; an unchanged accepted adjustment is validated
// and retained. The third-absence branch reuses its exact two-absence basis.
export async function solveApprovedManualAbsencePeriod({week,source,ownerConfig,frameStart,changes=[],priorDays=[]},
 {proposal=readApprovedManualAbsenceObjective(),deadline=performance.now()+45000,signal}={}){
 const date=value=>{assert.match(value,/^\d{4}-\d{2}-\d{2}$/);const parsed=new Date(value+'T12:00:00Z');assert.equal(parsed.toISOString().slice(0,10),value);return value;},
  dates=Array.from({length:7},(_,i)=>new Date(Date.parse(date(frameStart)+'T12:00:00Z')+i*86400000).toISOString().slice(0,10)),
  current=()=>{if(signal?.aborted||performance.now()>=deadline)throw Object.assign(Error('The dated preparation deadline elapsed; no publication was produced'),{code:'approved_manual_period_deadline_exceeded'});},
  fail=(serviceDate,reason)=>({serviceDate,reason}),sourceDigest=digest(source),before=digest({week,source,ownerConfig,changes,priorDays}),
  byDate=new Map(),previous=new Map(),issues=[],prepared=[],days=[],solvedDates=[],reusedDates=[];
 current();assert.equal(source.serviceDate,frameStart);assert.deepEqual(source.exceptions,[],
  'Pass the exact normal source separately from normalized accepted absence facts');
 assert.equal(digest(proposal),digest(readApprovedManualAbsenceObjective()));
 const version=source.version||source.versions?.[0];assert.equal(version.manualGroupRatingAuthority?.manifestSha256,week.manifestSha256);
 if(version.effectiveStart!==null&&version.effectiveStart!==undefined){
  date(version.effectiveStart);assert.ok(frameStart>=version.effectiveStart);
  assert.equal((Date.parse(frameStart+'T12:00:00Z')-Date.parse(version.effectiveStart+'T12:00:00Z'))%(7*86400000),0,
   'The period must retain its actual approved-source origin');
 }
 if(version.effectiveEnd!==null&&version.effectiveEnd!==undefined)assert.ok(dates[6]<date(version.effectiveEnd),
  'The full period must remain inside one actual approved publication');
 assert.ok(Array.isArray(changes)&&changes.length<=7&&Array.isArray(priorDays)&&priorDays.length<=7);
 for(const change of changes){
  assert.ok(change&&dates.includes(date(change.serviceDate))&&!byDate.has(change.serviceDate));
  assert.ok(Array.isArray(change.absentPersonIds)&&new Set(change.absentPersonIds).size===change.absentPersonIds.length);
  byDate.set(change.serviceDate,change);
 }
 for(const record of priorDays){assert.ok(record&&dates.includes(date(record.serviceDate))&&!previous.has(record.serviceDate));previous.set(record.serviceDate,record);}
 const validatePrior=(record,input)=>{
  assert.ok(record?.input&&record?.plan,'An original accepted two-absence basis is required');
  assert.equal(record.input.inputDigest,input.inputDigest,'The original accepted day source, employees or policy changed');
  const {planDigest,...body}=record.plan;assert.equal(digest(body),planDigest,'The original accepted plan changed');
  validateApprovedManualAbsenceProposal({plan:record.plan,input,proposal});
 };
 // Prepare every day and refuse known hard failures before the first solve.
 for(const serviceDate of dates){
  current();const change=byDate.get(serviceDate),absent=[...(change?.absentPersonIds||[])].sort(),prior=previous.get(serviceDate);
  if(absent.length>3){issues.push(fail(serviceDate,'MORE_THAN_THREE_ABSENCES_NEEDS_AN_EXPLICIT_COVERAGE_DECISION'));continue;}
  if(absent.length===3){
   if(!prior?.input||!prior?.plan||prior.input.absentPersonIds.length!==2
    ||prior.input.absentPersonIds.some(id=>!absent.includes(id))||!change.substitute){
    issues.push(fail(serviceDate,'THIRD_ABSENCE_NEEDS_THE_ACCEPTED_TWO_ABSENCE_PLAN_AND_CONFIRMED_COVERALL'));continue;
   }
   const basis=prepareApprovedManualAbsenceDay({week,source,ownerConfig,serviceDate,absentPersonIds:prior.input.absentPersonIds,preStartPersonIds:prior.input.preStartPersonIds||[]});
   validatePrior(prior,basis);const added=absent.filter(id=>!basis.absentPersonIds.includes(id));assert.equal(added.length,1);
   try{
    const overlay=applyApprovedManualCoverAllSubstitute({acceptedPlan:prior.plan,input:basis,proposal,source,
     absentPersonId:added[0],substitute:change.substitute});
    prepared.push({serviceDate,kind:'COVERALL',input:basis,plan:structuredClone(prior.plan),overlay});
   }catch(error){if(error?.code!=='ERR_ASSERTION')throw error;issues.push(fail(serviceDate,'CONFIRMED_COVERALL_HOURS_OR_RELIEF_DO_NOT_COVER_THE_RETAINED_PLAN'));}
   continue;
  }
  const input=prepareApprovedManualAbsenceDay({week,source,ownerConfig,serviceDate,absentPersonIds:absent,preStartPersonIds:change?.preStartPersonIds||[]});
  if(input.status==='UNCHANGED_APPROVED_DAY'){prepared.push({serviceDate,kind:'NORMAL',approvedDay:input.day});continue;}
  if(input.status!=='PREPARED_FOR_EXPLICIT_OBJECTIVE'){
   issues.push({serviceDate,reason:'STATIC_HOURS_OR_FULL_HOUR_COVERAGE_UNRESOLVED',constraints:structuredClone(input.issues||[])});continue;
  }
  if(prior&&prior.input?.inputDigest===input.inputDigest){
   validatePrior(prior,input);prepared.push({serviceDate,kind:'ABSENCE',input,plan:structuredClone(prior.plan),reused:true});
  }else prepared.push({serviceDate,kind:'ABSENCE',input});
 }
 const result=(status,extra={})=>{
  assert.equal(digest({week,source,ownerConfig,changes,priorDays}),before,'Dated composition mutated its source or original basis');
  const body={schema:'custodial.approved-manual-period-adjustments.v1',status,frameStart,frameEnd:dates[6],sourceDigest,
   manifestSha256:week.manifestSha256,manualDataDigest:week.dataDigest,acceptedFactsDigest:digest(changes),
   formulaObjectiveDigest:digest(proposal),days,issues,solvedDates,reusedDates,solverInvoked:solvedDates.length>0,
   normalWeekChanged:false,publicationEligible:false,productionWritten:false,contractorBooked:false,...extra};
  return{...body,periodDraftDigest:digest(body)};
 };
 if(issues.length)return result('COVERAGE_CONSTRAINTS_UNRESOLVED');
 for(const item of prepared){
  current();
  if(item.kind==='ABSENCE'&&!item.plan){
   const plan=await solveApprovedManualAbsenceAdjustment(item.input,{proposal,deadline,signal});current();solvedDates.push(item.serviceDate);
   if(plan.status!=='COMPLETE_APPROVED_FORMULA_ADJUSTMENT_DRAFT'){
    issues.push(fail(item.serviceDate,plan.status));return result('COVERAGE_CONSTRAINTS_UNRESOLVED');
   }
   item.plan=plan;
  }
  if(item.kind==='ABSENCE'){validateApprovedManualAbsenceProposal({plan:item.plan,input:item.input,proposal});if(item.reused)reusedDates.push(item.serviceDate);}
  days.push(item);
 }
 assert.equal(days.length,7);
 return result('COMPLETE_VALIDATED_DATED_DRAFTS');
}

// Compatibility name for previously saved callers; one implementation only.
export const solveApprovedManualAbsenceProposal=solveApprovedManualAbsenceAdjustment;
