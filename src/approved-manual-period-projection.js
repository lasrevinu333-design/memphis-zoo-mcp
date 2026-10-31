import {approvedManualInheritedEligibility} from './approved-manual-inherited-eligibility.js';
import {validateApprovedManualLunchPrior,retainApprovedManualLunchIdentities} from './approved-manual-lunch-retention.js';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {contentDigest} from './static-weekly-schedule-model.js';
import {prepareStaticWeeklySchedulingProblem,postgresJsonbContentDigest as digest} from './static-weekly-schedule-program.js';
import {splitPreservedWorkloadBudget} from './static-weekly-shift-end-coverage.js';
import {createFullHourLunchPolicy} from './static-weekly-lunch-policy.js';
import {deriveFixedStaticWeeklyOwnershipWitness} from './static-weekly-fixed-ownership.js';
import {deriveLunchCoverageFromPreparedProblem} from './static-weekly-lunch-derivation.js';
import {serializePreparedStaticWeeklyLunchAuthorityDocument} from './static-weekly-lunch-authority-adapter.js';
import {prepareApprovedManualAbsenceDay,validateApprovedManualAbsenceProposal,readApprovedManualAbsenceObjective,
 applyApprovedManualCoverAllSubstitute} from './approved-manual-absence.js';

const clone=structuredClone,minute=t=>Number(t.slice(0,2))*60+Number(t.slice(3,5)),
 overlap=(a,b)=>a.start<b.end&&b.start<a.end,
 sameDigest=(object,key)=>{const {[key]:value,...body}=object;assert.equal(value,digest(body));};

// Lower validated dated DATA into native projection rows and full-hour lunch
// records. The immutable recurring Source is retained separately, unchanged.
// This adapter is not a publication command and cannot issue an attestation.
export function prepareApprovedManualPeriodProjection({week,source,ownerConfig,period,acceptedExceptions=[],priorProjection=null},{deadline=null}={}){
 const before=digest({week,source,ownerConfig,period,acceptedExceptions,priorProjection}),version=source.version||source.versions?.[0],
  proposal=readApprovedManualAbsenceObjective(),candidate=clone(source),
  approvedByDay=new Map(week.days.map(day=>[day.weekday,day])),
  groups=new Map(week.referenceBindings.groups.map(g=>[g.approvedGroup,g.referenceCode])),
  people=new Map(week.referenceBindings.people.map(p=>[p.approvedName,p])),
  changedDays=new Map(),loans=[],links=[],budgets=[],prearrivalUnowned=[];
 validateApprovedManualLunchPrior(priorProjection,{publicationId:version.publicationId,versionId:version.id,frameStart:period.frameStart,frameEnd:period.frameEnd});
 assert.equal(period.schema,'custodial.approved-manual-period-adjustments.v1');sameDigest(period,'periodDraftDigest');
 assert.equal(period.status,'COMPLETE_VALIDATED_DATED_DRAFTS');assert.equal(period.days.length,7);
 assert.equal(period.sourceDigest,digest(source));assert.equal(period.frameStart,source.serviceDate);
 assert.equal(period.manifestSha256,week.manifestSha256);assert.equal(period.manualDataDigest,week.dataDigest);
 assert.equal(period.formulaObjectiveDigest,digest(proposal));assert.deepEqual(source.exceptions,[]);
 assert.ok(!period.normalWeekChanged&&!period.publicationEligible&&!period.productionWritten&&!period.contractorBooked);
 assert.equal(version.manualGroupRatingAuthority.manifestSha256,week.manifestSha256);
 if(!candidate.version){candidate.version=candidate.versions[0];delete candidate.versions;}
 const dates=new Set();
 for(const item of period.days){
  assert.ok(!dates.has(item.serviceDate));dates.add(item.serviceDate);
  assert.ok(item.serviceDate>=period.frameStart&&item.serviceDate<=period.frameEnd);
  const day=new Date(item.serviceDate+'T12:00:00Z').getUTCDay(),approved=approvedByDay.get(day);
  assert.ok(approved);
  if(item.kind==='NORMAL'){
   assert.deepEqual(item.approvedDay,approved);
   for(const lunch of approved.lunches)loans.push({dayOfWeek:day,normalOwnerSlotId:people.get(lunch.recipient).slotId,
    window:{start:lunch.start,end:lunch.end},areas:lunch.groups.map(name=>({locationCode:groups.get(name),covererSlotId:people.get(lunch.coverer).slotId}))});
   continue;
  }
  assert.ok(['ABSENCE','COVERALL'].includes(item.kind));
  const fresh=prepareApprovedManualAbsenceDay({week,source,ownerConfig,serviceDate:item.serviceDate,absentPersonIds:item.input.absentPersonIds});
  assert.equal(fresh.inputDigest,item.input.inputDigest);sameDigest(item.input,'inputDigest');sameDigest(item.plan,'planDigest');
  validateApprovedManualAbsenceProposal({input:fresh,plan:item.plan,proposal});
  let selected=item.plan,roster=fresh.roster;
  if(item.kind==='COVERALL'){
   sameDigest(item.overlay,'overlayDigest');
   const extra=item.overlay.absentPersonIds.filter(id=>!fresh.absentPersonIds.includes(id));assert.equal(extra.length,1);
   const s=item.overlay.substitute,coverer=item.overlay.lunchPlans.find(l=>l.recipientSlotId===s.slotId).covererSlotId,
    replay=applyApprovedManualCoverAllSubstitute({acceptedPlan:item.plan,input:fresh,proposal,source,absentPersonId:extra[0],
     substitute:{...s,serviceDate:item.serviceDate,managerConfirmed:true,lunchCovererSlotId:coverer}});
   assert.deepEqual(replay,item.overlay);selected=replay;roster=replay.roster;
  }
  const record={...item,day,selected,roster};changedDays.set(day,record);
  for(const lunch of selected.lunchPlans)loans.push({dayOfWeek:day,normalOwnerSlotId:lunch.recipientSlotId,
   window:clone(lunch.window),areas:lunch.areas.map(code=>({locationCode:code,covererSlotId:lunch.covererSlotId}))});
  for(const a of candidate.version.slotAvailability.filter(a=>a.dayOfWeek===day)){
   const person=roster.find(p=>p.slotId===a.slotId);
   if(!person){if(a.status==='working'){a.status='absent';a.blockedWindows=[{start:'00:00',end:'23:59'}];}continue;}
   Object.assign(a,{status:'working',shift:clone(person.shift),lunch:clone(person.lunch),blockedWindows:[]});
  }
  if(item.kind==='COVERALL'){
   const s=item.overlay.substitute,slot=source.slots.find(slt=>slt.id===s.slotId),
    capacity=clone(slot.contractorAvailability.find(a=>a.dayOfWeek===day)),
    actual={...capacity,slotId:slot.id,dayOfWeek:day,status:'working',shift:clone(s.shift),lunch:clone(s.lunch),
     maxDutyMinutes:minute(s.shift.end)-minute(s.shift.start)-60,maxDutyProvenance:capacity.productiveCapacityProvenance,blockedWindows:[]};
   delete actual.breakChoice; // A scheduled lunch uses the maintained implicit choice.
   const at=candidate.version.slotAvailability.findIndex(a=>a.dayOfWeek===day&&a.slotId===slot.id);
   if(at<0)candidate.version.slotAvailability.push(actual);else candidate.version.slotAvailability[at]=actual;
   // The registered capacity template stays unchanged; actual dated hours
   // belong only to availability and the accepted CoverAll/lunch overlays.
  }
 }
 assert.equal(dates.size,7);
 const assignments=[];
 for(const parent of version.assignments){
  const item=changedDays.get(parent.dayOfWeek);
  if(!item){assignments.push(clone(parent));continue;}
  const pieces=[],normalWindow=approvedByDay.get(parent.dayOfWeek).checkedWindow,actualWindow=item.selected.checkedWindow,
   firstParent=parent.window.start<=normalWindow.start&&parent.window.end>normalWindow.start,
   effectiveParentWindow={start:firstParent&&actualWindow.start<parent.window.start?actualWindow.start:parent.window.start,end:parent.window.end},
   add=(start,end,slotId)=>{
    if(start>=end)return;const last=pieces.at(-1);
    if(last&&last.ownerSlotId===slotId&&last.window.end===start)last.window.end=end;
    else pieces.push({ownerSlotId:slotId,window:{start,end}});
   },earlyEnd=parent.window.end<actualWindow.start?parent.window.end:actualWindow.start;
  if(parent.window.start<earlyEnd){
   let owner=item.roster.find(p=>p.slotId===parent.ownerSlotId);
   if(!owner&&item.kind==='COVERALL'){
    const absent=source.slots.find(s=>s.id===parent.ownerSlotId),replaced=people.size&&week.referenceBindings.people.find(p=>p.slotId===absent?.id);
    if(replaced?.employeeId===item.overlay.replacedPersonId)owner=item.roster.find(p=>p.kind==='CONTRACTOR_CAPACITY');
   }
   const start=owner&&owner.shift.start>parent.window.start?owner.shift.start:parent.window.start;
   if(owner&&start<earlyEnd)add(start,earlyEnd,owner.slotId);
   if(!owner||start>parent.window.start)prearrivalUnowned.push({serviceDate:item.serviceDate,parentWorkId:parent.workId,
    locationCode:parent.locationCodeSnapshot,window:{start:parent.window.start,end:owner?start:earlyEnd},reason:'NO_APPROVED_TEMPORARY_PREARRIVAL_OWNER'});
  }
  for(const phase of item.selected.phaseOwners){
   if(!overlap(effectiveParentWindow,phase.window))continue;
   add(effectiveParentWindow.start>phase.window.start?effectiveParentWindow.start:phase.window.start,
    parent.window.end<phase.window.end?parent.window.end:phase.window.end,phase.owners[parent.locationCodeSnapshot]);
  }
  if(item.kind==='COVERALL'&&parent.window.end===normalWindow.end&&item.selected.checkedWindow.end>normalWindow.end)
   add(normalWindow.end,item.selected.checkedWindow.end,item.overlay.substitute.slotId);
  if(pieces.length===1&&pieces[0].ownerSlotId===parent.ownerSlotId&&digest(pieces[0].window)===digest(parent.window)){
   assignments.push(clone(parent));continue;
  }
  for(const piece of pieces){
   const key={parentWorkId:parent.workId,serviceDate:item.serviceDate,slotId:piece.ownerSlotId,window:piece.window},
    workId='manual-dated:'+createHash('sha256').update(JSON.stringify(key)).digest('hex'),
    phase=item.input.phases.find(p=>p.window.start<=piece.window.start&&piece.window.start<p.window.end),
    purpose=piece.window.start>=normalWindow.end||phase?.index>0?'INHERITED_ALERTS_AND_ISSUES_ONLY':parent.coveragePurpose,
    row=approvedManualInheritedEligibility({...clone(parent),...piece,workId,coveragePurpose:purpose},ownerConfig,purpose);
   assignments.push(row);links.push({...key,workId});
  }
 }
 // Preserve each combined group/day's whole native effort budget once. New
 // custody boundaries redistribute that budget; they never add cleaning work.
 for(const [day]of changedDays)for(const code of new Set(version.assignments.filter(w=>w.dayOfWeek===day).map(w=>w.locationCodeSnapshot))){
  const parents=version.assignments.filter(w=>w.dayOfWeek===day&&w.locationCodeSnapshot===code),
   rows=assignments.filter(w=>w.dayOfWeek===day&&w.locationCodeSnapshot===code).sort((a,b)=>a.window.start.localeCompare(b.window.start)),
   total=parents.reduce((n,w)=>n+w.serviceEffortMinutes,0),
   unchanged=rows.length===parents.length&&rows.every(r=>parents.some(p=>p.workId===r.workId&&digest(p)===digest(r))),
   allocation=unchanged?rows.map(r=>r.serviceEffortMinutes):splitPreservedWorkloadBudget(total,rows.map(w=>w.window)),
   dayBasis=changedDays.get(day),dayDigest=dayBasis.overlay?.overlayDigest||dayBasis.plan.planDigest;
  if(!unchanged)for(let i=0;i<rows.length;i++){rows[i].serviceEffortMinutes=allocation[i];rows[i].serviceEffortProvenance+=`;dated-group-budget:${dayDigest}`;}
  budgets.push({dayOfWeek:day,locationCode:code,sourceBudget:total,datedBudget:allocation.reduce((n,v)=>n+v,0)});
 }
 candidate.version.assignments=assignments;
 candidate.version.lunchCoveragePolicy=createFullHourLunchPolicy({sourceDigest:digest({normalSourceDigest:period.sourceDigest,periodDraftDigest:period.periodDraftDigest}),loans},digest);
 // A private fixed candidate locks the selected owners for feasibility only.
 // Original parent/origin identities remain in the unchanged Source and links.
 const wire={...clone(candidate),versions:[clone(candidate.version)],exceptions:clone(acceptedExceptions)};delete wire.version;
 for(const row of wire.versions[0].assignments)row.originSlotId=row.ownerSlotId;
 const problem=prepareStaticWeeklySchedulingProblem(wire,deadline);
 assert.ok(!problem.error,JSON.stringify(problem.error));
 const rowOwners=new Map(assignments.map(row=>[`${row.dayOfWeek}:${row.workId}`,row.ownerSlotId])),
  witness=deriveFixedStaticWeeklyOwnershipWitness(problem,{rowOwners,deadline,allowCapacity:true}),
  // Lunch is temporary inherited custody, not a new normal area assignment.
  // Its scoped view cannot alter the fixed-owner model or stored work facts.
  lunchProblem={...problem,work:problem.work.map(w=>approvedManualInheritedEligibility(w,ownerConfig,'INHERITED_ALERTS_AND_ISSUES_ONLY'))},
  lunch=deriveLunchCoverageFromPreparedProblem(lunchProblem,witness.assignments);
 assert.equal(lunch.status,'PLANNED',JSON.stringify(lunch.lunches.filter(l=>l.status!=='PLANNED').map(l=>({slot:l.normalOwnerSlotId,reason:l.reason}))));
 const byWork=new Map(problem.work.map(w=>[w.key,w])),byRaw=new Map(assignments.map(w=>[`${w.dayOfWeek}:${w.workId}`,w])),
  projectionAssignments=witness.assignments.map(row=>{
   const work={...byWork.get(row.planWorkId),originSlotId:byRaw.get(row.planWorkId).originSlotId},baseline=problem.incumbencyByDaySlot.get(`${row.dayOfWeek}\u0000${work.originSlotId}`);
   return{plan_work_id:row.planWorkId,work_id:row.workId,day_of_week:row.dayOfWeek,service_date:row.serviceDate,
    status:'assigned',reason_code:null,owner_slot_id:row.slotId,owner_person_id:row.personId,
    ...(row.ownerKind?{owner_kind:row.ownerKind,capacity_id:row.capacityId}:{}),
    owner_digest:digest({planWorkId:row.planWorkId,slotId:row.slotId,personId:row.personId,serviceDate:row.serviceDate}),
    exact_owner_identity:digest({plan_work_id:row.planWorkId,service_date:row.serviceDate,optimized_owner_slot_id:row.slotId,
     optimized_owner_person_id:row.personId,baseline_owner_slot_id:work.originSlotId||null,baseline_owner_person_id:baseline?.personId||null}),
    baseline_owner_slot_id:work.originSlotId||null,baseline_owner_person_id:baseline?.personId||null,
    baseline_owner_name:baseline?.displayName||null,original_actor_person_id:baseline?.personId||null,original_actor_name:baseline?.displayName||null,
    optimized_owner_slot_id:row.slotId,optimized_owner_person_id:row.personId,
    work_snapshot:{workId:work.workId,dayOfWeek:work.dayOfWeek,originSlotId:work.originSlotId||null,locationId:work.locationId,
     locationCodeSnapshot:work.locationCodeSnapshot,locationNameSnapshot:work.locationNameSnapshot,serviceMode:work.serviceMode,
     includedLocations:clone(work.includedLocations),window:{start:work.window.start,end:work.window.end},
     serviceEffortMinutes:work.effort.minutes,serviceEffortProvenance:work.effort.provenance,
     priority:work.priority,priorityProvenance:work.priorityProvenance??null,required:work.required,
     coveragePolicy:work.coveragePolicy??null,bestEffortCoverage:work.coverageClass==='best_effort',coveragePolicyOrder:work.coverageOrder,
     coveragePolicyProvenance:work.coveragePolicyProvenance??null,requiredQualifications:clone(work.requiredQualifications),
     qualificationProvenance:work.qualificationProvenance,restrictions:clone(work.restrictions),restrictionProvenance:work.restrictionProvenance,
     restrictedSlotIds:clone(work.restrictedSlotIds||[]),
     ...(work.normalAssignmentRestrictedSlotIds?.length?{normalAssignmentRestrictedSlotIds:clone(work.normalAssignmentRestrictedSlotIds),coveragePurpose:work.coveragePurpose}:{}),manualLock:Boolean(work.manualLock),manualLockSlotId:work.manualLock||null,overlayWork:Boolean(work.overlayWork)},
    explanation:{contract:changedDays.has(row.dayOfWeek)?'approved_manual_dated_adjustment':'fixed_approved_pattern',hardConstraints:'satisfied',reasons:[]}};
  }),projectionAvailability=[...problem.states].flatMap(([day,state])=>[...state.availability].map(([slotId,a])=>{
   const p=problem.incumbencyByDaySlot.get(`${day}\u0000${slotId}`);
   return{...clone(a),slotId,dayOfWeek:day,serviceDate:period.days.find(d=>new Date(d.serviceDate+'T12:00Z').getUTCDay()===day).serviceDate,
    incumbentPersonId:p?.personId??null,incumbentName:p?.displayName??null,
    ...(p?.kind==='CONTRACTOR_CAPACITY'?{ownerKind:p.kind,capacityId:p.capacityId}:{} )};
  })),authority={schema:'custodial.approved-manual-period-projection-authority.v1',sourceDigest:period.sourceDigest,
   sourcePublicationId:version.publicationId,sourceVersionId:version.id,frameStart:period.frameStart,frameEnd:period.frameEnd,
   periodDraftDigest:period.periodDraftDigest,formulaObjectiveDigest:period.formulaObjectiveDigest,acceptedExceptionsDigest:digest(acceptedExceptions),
   overlayInputDigest:problem.inputDigest,projectionAvailability,parentLinks:links,groupDayBudgets:budgets,prearrivalUnowned,
   hardConstraintCount:witness.model.modelBasis.constraints.count,hardConstraintDigest:witness.model.modelBasis.constraints.digest,
   fixedWitnessDigest:contentDigest([...witness.values]),datedDayBases:period.days.filter(d=>d.kind!=='NORMAL').map(d=>clone(d)),
   normalSourceChanged:false,objectiveSolverRerun:false};
 const provisionalAuthorityDigest=digest(authority),provisionalReplayDigest=digest({projectionAssignments,lunch}),
  provisionalDocument=serializePreparedStaticWeeklyLunchAuthorityDocument({candidate:lunch,authorityDigest:provisionalAuthorityDigest,replayDigest:provisionalReplayDigest}),
  retained=retainApprovedManualLunchIdentities({candidate:lunch,currentDocument:provisionalDocument,prior:priorProjection});
 if(retained.retention)authority.lunchIdentityRetention=retained.retention;
 const
  authorityDigest=digest(authority),replayDigest=digest({projectionAssignments,lunch:retained.candidate}),
  lunchDocument=serializePreparedStaticWeeklyLunchAuthorityDocument({candidate:retained.candidate,authorityDigest,replayDigest});
 assert.equal(digest({week,source,ownerConfig,period,acceptedExceptions,priorProjection}),before,'Native dated preparation mutated its source or accepted basis');
 const body={schema:'custodial.approved-manual-period-projection-data.v1',status:'NATIVE_DATA_PREPARED_NOT_PUBLISHED',
  frameStart:period.frameStart,frameEnd:period.frameEnd,authority,authorityDigest,replayDigest,projectionAssignments,lunchDocument,
  publicationEligible:false,productionWritten:false,normalWeekChanged:false,contractorBooked:false};
 return{...body,projectionDataDigest:digest(body)};
}
