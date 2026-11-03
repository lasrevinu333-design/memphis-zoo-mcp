import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateRecurringShiftEndCoverage} from '../src/static-weekly-shift-end-coverage.js';
import {deriveDatedShiftEndCoverage} from '../src/static-weekly-shift-end-derivation.js';
import {postgresJsonbContentDigest} from '../src/static-weekly-schedule-program.js';
if(process.argv.includes('--approved-dated-partial-interval-only')){
 const {deriveApprovedDatedMappedShiftEndCoverage}=await import('../src/static-weekly-shift-end-derivation.js');
 const {loadSixPersonAbsenceSource}=await import('./fixtures/six-person-absence-source.mjs');
 const {normalizeStaticWeeklyAuthority}=await import('../src/static-weekly-schedule-program.js');
 const {canonicalJson,installStaticWeeklySha256HexAccelerator}=await import('../src/static-weekly-schedule-model.js');
 const {createHash}=await import('node:crypto');installStaticWeeklySha256HexAccelerator(x=>createHash('sha256').update(x).digest('hex'));
 const packet=loadSixPersonAbsenceSource(),ownerConfig=JSON.parse(readFileSync(new URL('../config/custodial-six-person-static-20261005.json',import.meta.url)));
 const people=new Map(Object.values(ownerConfig.slots).filter(s=>!s.vacancy).map(s=>[s.slotId,s.personId]));
 const kaili=ownerConfig.slots.KAILI.slotId,gregory=ownerConfig.slots.GREGORY.slotId;
 // Retained real six-person parent DATA/config. Exceptions and conservative
 // current capacity declarations below are explicit UNIT facts, not captured
 // manager commands or observed production partial-absence records.
 const contextFor=(slotId,windows,day=2)=>{
  let source=structuredClone(packet.compilerInput);source.serviceDate='2026-10-12';const date=day===6?'2026-10-17':'2026-10-13';
  const a=source.version.slotAvailability.find(r=>r.dayOfWeek===day&&r.slotId===slotId);
  a.maxDutyMinutes=360;a.maxDutyProvenance='UNIT bounded current capacity under accepted partial absence';
  source.exceptions=windows.map((window,i)=>({id:`unit-partial-${i}`,idempotencyKey:`unit-partial-${i}`,sequence:i+1,type:'partial_absence',
   serviceDate:date,baseVersionId:source.version.id,publicationId:source.version.publicationId,actorId:'UNIT-partial-DATA-only',
   reason:'UNIT partial absence; not actual manager authority',expectedRevision:1,window,payload:{slotId}}));
  source=normalizeStaticWeeklyAuthority(source.version,source.slots,source.exceptions,source.proximity,source.serviceDate);
  const mappedParents=packet.compilerInput.version.assignments.filter(r=>r.dayOfWeek===day).map(r=>structuredClone(r));
  return {originalWeekSource:structuredClone(source),currentWeekSource:source,approvedTemplateSource:structuredClone(packet.compilerInput),
   operationDate:date,mappedParents,parentMappings:mappedParents.map(r=>({dayOfWeek:day,parentWorkId:r.workId,
    patternSlotId:r.ownerSlotId,actualSlotId:r.ownerSlotId,actualPersonId:people.get(r.ownerSlotId)})),ownerConfig:structuredClone(ownerConfig)};
 };
 const verify=(context,result)=>{
  assert.equal(result.schema,'custodial.approved-dated-mapped-shift-end-derivation.v1');assert.equal(result.continuity.coverageGaps,0);
  assert.deepEqual(result.effectiveInput.version.assignments.filter(r=>r.dayOfWeek!==result.dayOfWeek),
   context.currentWeekSource.version.assignments.filter(r=>r.dayOfWeek!==result.dayOfWeek));
  assert.deepEqual({...result.effectiveInput,version:null},{...context.currentWeekSource,version:null});
  assert.deepEqual({...result.effectiveInput.version,assignments:[]},{...context.currentWeekSource.version,assignments:[]});
  for(const chain of result.parentChains){
   const parent=context.mappedParents.find(p=>p.workId===chain.parentWorkId);
   assert.equal(chain.segments.reduce((n,r)=>n+r.serviceEffortMinutes,0),parent.serviceEffortMinutes);
   assert.ok(chain.segments.every(r=>Number.isSafeInteger(r.serviceEffortMinutes)&&r.serviceEffortMinutes>0));
   let end=parent.window.start;
   for(const row of chain.segments){
    assert.equal(row.window.start,end);end=row.window.end;
    const a=result.selectedAvailability.find(p=>p.slotId===row.ownerSlotId);assert.equal(a.vacant,false);assert.equal(a.availability.status,'working');
    assert.ok(row.window.start>=a.availability.shift.start&&row.window.end<=a.availability.shift.end);
    assert.ok(!(a.availability.blockedWindows||[]).some(w=>w.start<row.window.end&&row.window.start<w.end));
    if(row.ownerSlotId!==parent.ownerSlotId)assert.ok(!(a.availability.lunch.start<row.window.end&&row.window.start<a.availability.lunch.end));
    assert.deepEqual(row.includedLocations,parent.includedLocations);assert.equal(row.locationId,parent.locationId);
    assert.equal(row.originSlotId,row.workId===parent.workId?parent.originSlotId:row.ownerSlotId);
   }
  }
  const ids=r=>r.includedLocations?.length?r.includedLocations.map(x=>x.locationId):[r.locationId];
  const expected=new Set(context.mappedParents.filter(r=>r.window.start==='09:45'&&r.serviceMode!=='reminder_only').flatMap(ids));
  const m=t=>Number(t.slice(0,2))*60+Number(t.slice(3));
  for(let at=585;at<m(result.continuity.staffedDeparture);at++){
   const counts=new Map();for(const r of result.selectedAssignments.filter(r=>r.serviceMode!=='reminder_only'&&m(r.window.start)>=585&&m(r.window.start)<=at&&at<m(r.window.end)))
    for(const id of ids(r))counts.set(id,(counts.get(id)||0)+1);
   assert.equal(counts.size,expected.size);for(const id of expected)assert.equal(counts.get(id),1);
  }
  assert.ok(Object.isFrozen(result));
 };
 const context=contextFor(gregory,[{start:'15:00',end:'15:15'}]),before=canonicalJson(context);
 const result=deriveApprovedDatedMappedShiftEndCoverage(context,postgresJsonbContentDigest);verify(context,result);
 assert.equal(canonicalJson(context),before);
 const resumed=result.parentChains.find(c=>c.parentWorkId==='2:AQUARIUM:equalized:5d2d2a0e');assert.ok(resumed);
 assert.ok(resumed.segments.some(r=>r.ownerSlotId===gregory&&r.window.end==='15:00'));
 assert.ok(resumed.segments.some(r=>r.ownerSlotId===gregory&&r.window.start==='15:15'&&r.window.end==='17:00'));
 assert.ok(resumed.segments.some(r=>r.ownerSlotId!==gregory&&r.window.start==='15:00'&&r.window.end==='15:15'));
 let checks=1;
 const morning=contextFor(kaili,[{start:'08:30',end:'08:45'}]);verify(morning,deriveApprovedDatedMappedShiftEndCoverage(morning,postgresJsonbContentDigest));checks++;
 const overlaps=contextFor(gregory,[{start:'15:00',end:'15:15'},{start:'15:10',end:'15:20'}]);
 verify(overlaps,deriveApprovedDatedMappedShiftEndCoverage(overlaps,postgresJsonbContentDigest));checks++;
 const lunch=contextFor(gregory,[{start:'10:00',end:'11:00'}]);verify(lunch,deriveApprovedDatedMappedShiftEndCoverage(lunch,postgresJsonbContentDigest));checks++;
 const absentTail=contextFor(gregory,[{start:'16:30',end:'17:00'}]);
 const unresolved=deriveApprovedDatedMappedShiftEndCoverage(absentTail,postgresJsonbContentDigest);
 assert.equal(unresolved.schema,'custodial.approved-dated-mapped-shift-end-unresolved.v1');assert.equal(unresolved.status,'UNRESOLVED');
 assert.ok(unresolved.unresolved.some(r=>r.reason==='NO_ELIGIBLE_INTERVAL_OWNER'&&r.window.start==='16:30'));
 assert.equal(Object.hasOwn(unresolved,'effectiveInput'),false);assert.equal(Object.hasOwn(unresolved,'selectedAssignments'),false);
 assert.deepEqual(unresolved.originalWeekSource,absentTail.originalWeekSource);assert.ok(Object.isFrozen(unresolved.unresolved));checks++;
 const budget=contextFor(gregory,[{start:'15:00',end:'15:15'}]),budgetParent='2:AQUARIUM:equalized:5d2d2a0e';
 for(const source of [budget.originalWeekSource,budget.currentWeekSource,budget.approvedTemplateSource])source.version.assignments.find(r=>r.workId===budgetParent).serviceEffortMinutes=1;
 budget.mappedParents.find(r=>r.workId===budgetParent).serviceEffortMinutes=1;
 const low=deriveApprovedDatedMappedShiftEndCoverage(budget,postgresJsonbContentDigest);
 assert.equal(low.schema,'custodial.approved-dated-mapped-shift-end-unresolved.v1');
 assert.ok(low.unresolved.some(r=>r.parentWorkId===budgetParent&&r.reason==='ORIGINAL_BUDGET_INSUFFICIENT_FOR_POSITIVE_SEGMENTS'&&r.originalBudget===1));checks++;
 const named=contextFor(ownerConfig.slots.ALIJAH.slotId,[{start:'13:50',end:'14:10'}],6),namedResult=deriveApprovedDatedMappedShiftEndCoverage(named,postgresJsonbContentDigest);
 assert.equal(namedResult.schema,'custodial.approved-dated-mapped-shift-end-unresolved.v1');
 assert.ok(namedResult.unresolved.some(r=>r.reason==='NAMED_HANDOFF_UNAVAILABLE'));checks++;
 const reminder=contextFor(ownerConfig.slots.KATHY.slotId,[{start:'10:10',end:'10:20'}]);
 const reminderResult=deriveApprovedDatedMappedShiftEndCoverage(reminder,postgresJsonbContentDigest);verify(reminder,reminderResult);
 const visits=reminderResult.parentChains.find(r=>r.parentWorkId==='2:ELEPHANT_TRUNK_RESTROOMS:one-time:55e5939c');
 assert.equal(visits.segments.length,1);assert.equal(visits.segments[0].serviceEffortMinutes,35);
 assert.deepEqual(visits.segments[0].window,{start:'10:00',end:'10:30'});checks++;
 const successor=contextFor(kaili,[{start:'15:00',end:'15:15'}]);
 const successorResult=deriveApprovedDatedMappedShiftEndCoverage(successor,postgresJsonbContentDigest);
 assert.equal(successorResult.schema,'custodial.approved-dated-mapped-shift-end-unresolved.v1');
 assert.ok(successorResult.unresolved.some(r=>r.reason==='ORIGINAL_BUDGET_INSUFFICIENT_FOR_POSITIVE_SEGMENTS'));
 assert.equal(Object.hasOwn(successorResult,'selectedAssignments'),false);checks++;
 const locked=contextFor(gregory,[{start:'15:00',end:'15:15'}]);
 for(const source of [locked.originalWeekSource,locked.currentWeekSource,locked.approvedTemplateSource])source.version.assignments.find(r=>r.workId===budgetParent).manualLock=true;
 locked.mappedParents.find(r=>r.workId===budgetParent).manualLock=true;
 const lockedResult=deriveApprovedDatedMappedShiftEndCoverage(locked,postgresJsonbContentDigest);
 assert.equal(lockedResult.schema,'custodial.approved-dated-mapped-shift-end-unresolved.v1');
 assert.ok(lockedResult.unresolved.some(r=>r.parentWorkId===budgetParent&&r.reason==='LOCKED_PARENT_UNAVAILABLE'));checks++;
 console.log(JSON.stringify({scope:'NEW accepted partial-absence interval DATA only',checks,retainedFixtureSha256:packet.fixtureSha256,
  exceptionAndCurrentCapacity:'EXPLICIT_UNIT_INPUT_NOT_PRODUCTION_RECORD',workingPortions:'RETAINED_WITH_RETURN',
  unresolved:'NO_FALSE_COVERAGE_OR_NEW_BUDGET',SQL:'NOT_RUN',old_groups:0,solver_runs:0,resources0:true}));process.exit(0);
}
if(process.argv.includes('--approved-dated-mapped-day-only')){
 const {deriveApprovedDatedMappedShiftEndCoverage,deriveApprovedMappedShiftEndCoverage}=await import('../src/static-weekly-shift-end-derivation.js');
 const {loadSixPersonAbsenceSource}=await import('./fixtures/six-person-absence-source.mjs');
 const {canonicalJson,installStaticWeeklySha256HexAccelerator}=await import('../src/static-weekly-schedule-model.js');
 const {createHash}=await import('node:crypto');installStaticWeeklySha256HexAccelerator(x=>createHash('sha256').update(x).digest('hex'));
 const packet=loadSixPersonAbsenceSource(),approvedTemplateSource=packet.compilerInput;
 let currentWeekSource=structuredClone(approvedTemplateSource);const ownerConfig=JSON.parse(readFileSync(new URL('../config/custodial-six-person-static-20261005.json',import.meta.url)));
 const operationDate='2026-10-13',day=2,kaili=ownerConfig.slots.KAILI.slotId,target='74000000-0000-4000-8000-000000000003';
 // Explicit UNIT turnover: this is NOT an approved/current production roster.
 // Retain all six fixture employees, add one constructed seventh incumbent
 // in a new UNIT stable position, and accept one constructed Tuesday absence.
 const person='74000000-0000-4000-8000-000000000001',future='74000000-0000-4000-8000-000000000002';
 currentWeekSource.serviceDate='2026-10-12';
 currentWeekSource.slots.push({id:target,label:'UNIT Tuesday-only position',incumbencies:[
  {personId:person,displayName:'UNIT Tuesday substitute',effectiveStart:'2026-10-12',effectiveEnd:'2026-10-14'},
  {personId:future,displayName:'UNIT future replacement',effectiveStart:'2026-10-14',effectiveEnd:null}]});
 const substitute=structuredClone(currentWeekSource.version.slotAvailability.find(a=>a.dayOfWeek===day&&a.slotId===kaili));
 substitute.maxDutyMinutes=450;substitute.maxDutyProvenance='UNIT substitute bounded duty within shorter-shift/partial-absence refusal controls';
 substitute.acceptedRoute={startLocationId:substitute.acceptedRouteAnchorLocationId,provenance:'UNIT explicit Tuesday-only zero-stop route',stops:[]};
 delete substitute.acceptedRouteAnchorLocationId;delete substitute.acceptedRouteProvenance;
 substitute.slotId=target;currentWeekSource.version.slotAvailability.push(substitute);
 ownerConfig.slots.UNIT_SUBSTITUTE={slotId:target,personId:person,name:'UNIT Tuesday substitute',vacancy:false,
  workDays:[2],shiftByDay:{2:['07:00','16:00']},lunchByDay:{2:['10:30','11:30']}};
 currentWeekSource.exceptions=[{id:'unit-tuesday-absence',type:'daily_absence',serviceDate:operationDate,
  baseVersionId:currentWeekSource.version.id,publicationId:currentWeekSource.version.publicationId,actorId:'UNIT-manager-DATA-only',
  reason:'UNIT accepted Tuesday absence, not actual manager authority',idempotencyKey:'unit-tuesday-absence',expectedRevision:1,payload:{slotId:kaili}}];
 const mappedParents=approvedTemplateSource.version.assignments.filter(r=>r.dayOfWeek===day).map(r=>({...structuredClone(r),ownerSlotId:r.ownerSlotId===kaili?target:r.ownerSlotId}));
 const people=new Map(Object.values(ownerConfig.slots).filter(s=>!s.vacancy).map(s=>[s.slotId,s.personId]));
 const parentMappings=mappedParents.map(r=>({dayOfWeek:day,parentWorkId:r.workId,
  patternSlotId:approvedTemplateSource.version.assignments.find(p=>p.dayOfWeek===day&&p.workId===r.workId).ownerSlotId,
  actualSlotId:r.ownerSlotId,actualPersonId:people.get(r.ownerSlotId)}));
 const {normalizeStaticWeeklyAuthority,prepareStaticWeeklySchedulingProblem}=await import('../src/static-weekly-schedule-program.js');
 currentWeekSource=normalizeStaticWeeklyAuthority(currentWeekSource.version,currentWeekSource.slots,currentWeekSource.exceptions,currentWeekSource.proximity,currentWeekSource.serviceDate);
 const context={originalWeekSource:structuredClone(currentWeekSource),currentWeekSource,approvedTemplateSource,operationDate,mappedParents,parentMappings,ownerConfig};
 const wire={...structuredClone(currentWeekSource),versions:[structuredClone(currentWeekSource.version)]};delete wire.version;
 const prepared=prepareStaticWeeklySchedulingProblem(wire);assert.equal(prepared.error,undefined,JSON.stringify(prepared.error));
 const before=canonicalJson(context),result=deriveApprovedDatedMappedShiftEndCoverage(context,postgresJsonbContentDigest);
 assert.equal(result.schema,'custodial.approved-dated-mapped-shift-end-derivation.v1');assert.equal(result.dayOfWeek,day);
 assert.equal(result.continuity.coverageGaps,0);assert.equal(result.continuity.duplicateLocations,0);
 assert.ok(result.handoffs.length>0);assert.ok(result.selectedAssignments.every(r=>r.dayOfWeek===day&&r.ownerSlotId!==kaili));
 const ref=result.parentReferences.find(r=>r.originalOwnerSlotId===kaili&&r.mappedParent.window.start==='09:45');
 assert.ok(ref);assert.equal(ref.mappedOwnerSlotId,target);assert.equal(ref.currentPersonId,person);
 assert.equal(ref.originalParent.originSlotId,kaili);assert.equal(ref.mappedParent.originSlotId,kaili);
 assert.equal(result.selectedAssignments.find(r=>r.workId===ref.parentWorkId).originSlotId,kaili);
 assert.deepEqual(result.effectiveInput.version.assignments.filter(r=>r.dayOfWeek!==day),currentWeekSource.version.assignments.filter(r=>r.dayOfWeek!==day));
 assert.deepEqual({...result.effectiveInput.version,assignments:[]},{...currentWeekSource.version,assignments:[]});
 assert.deepEqual({...result.effectiveInput,version:null},{...currentWeekSource,version:null});
 assert.equal(result.appliedExceptions.length,1);assert.equal(result.appliedExceptions[0].id,'unit-tuesday-absence');
 assert.equal(result.selectedAvailability.find(a=>a.slotId===kaili).availability.status,'absent');
 assert.equal(canonicalJson(context),before);assert.ok(Object.isFrozen(result)&&Object.isFrozen(result.parentReferences[0].originalParent));
 const chosen=parentMappings.findIndex(m=>m.patternSlotId===kaili);
 let checks=1;const refusal=(mutate,pattern)=>{const c=structuredClone(context);mutate(c);
  assert.throws(()=>deriveApprovedDatedMappedShiftEndCoverage(c,postgresJsonbContentDigest),pattern);checks++;};
 refusal(c=>{c.parentMappings[chosen].dayOfWeek=3;},/foreign\/duplicate day parent/);
 refusal(c=>{c.parentMappings[chosen].actualPersonId=future;},/not currently available/);
 refusal(c=>{c.parentMappings[chosen].parentWorkId='foreign-parent';},/foreign\/duplicate day parent/);
 refusal(c=>{c.mappedParents[chosen].originSlotId=target;},/original substitution/);
 refusal(c=>{c.mappedParents[chosen].window.end='17:00';},/original substitution/);
 refusal(c=>{c.currentWeekSource.exceptions=[];},/original\/current week differs/);
 refusal(c=>{c.originalWeekSource.version.assignments[0].serviceEffortMinutes++;},/original\/current week differs/);
 refusal(c=>{c.approvedTemplateSource.version.assignments.find(r=>r.dayOfWeek===day).serviceEffortMinutes++;},/physical responsibility differs/);
 refusal(c=>{c.operationDate='2026-10-20';},/outside original week/);
 refusal(c=>{for(const s of [c.originalWeekSource,c.currentWeekSource])s.version.effectiveEnd='2026-10-14';},/publication must cover the entire current week/);
 refusal(c=>{c.ownerConfig.slots.UNIT_SUBSTITUTE.shiftByDay[2]=['07:00','15:00'];},/configured shift\/lunch differs/);
 refusal(c=>{c.approvedTemplateSource.version.effectiveEnd=operationDate;},/effective immutable zero-overlay/);
 refusal(c=>{for(const s of [c.originalWeekSource,c.currentWeekSource])s.slots.find(r=>r.id===target).incumbencies=[];},/original week preparation refused/);
 refusal(c=>{for(const s of [c.originalWeekSource,c.currentWeekSource])s.version.slotAvailability.find(a=>a.dayOfWeek===day&&a.slotId===target).shift.end='15:30';
  c.ownerConfig.slots.UNIT_SUBSTITUTE.shiftByDay[2][1]='15:30';},/mapped target shift conflicts/);
 // This one former refusal is the contract changed by the interval helper.
 // Retain this selector/name, but do not require the obsolete throw. Depending
 // on the immutable budgets, the new DATA is covered or explicitly unresolved.
 {
  const c=structuredClone(context);for(const s of [c.originalWeekSource,c.currentWeekSource]){
  const e=s.exceptions[0];s.exceptions.push({id:'unit-partial',idempotencyKey:'unit-partial',type:'partial_absence',sequence:1,serviceDate:operationDate,
   baseVersionId:e.baseVersionId,publicationId:e.publicationId,actorId:e.actorId,reason:'UNIT partial absence',expectedRevision:1,
   window:{start:'15:30',end:'16:00'},payload:{slotId:target}});
  }
  const partial=deriveApprovedDatedMappedShiftEndCoverage(c,postgresJsonbContentDigest);
  if(partial.schema==='custodial.approved-dated-mapped-shift-end-unresolved.v1'){
   assert.equal(partial.status,'UNRESOLVED');assert.equal(Object.hasOwn(partial,'selectedAssignments'),false);
  }else{
   assert.equal(partial.schema,'custodial.approved-dated-mapped-shift-end-derivation.v1');
   assert.ok(!partial.selectedAssignments.some(r=>r.ownerSlotId===target&&r.window.start<'16:00'&&'15:30'<r.window.end));
  }
  checks++;
 }
 refusal(c=>{c.parentMappings[chosen].actualSlotId=kaili;c.parentMappings[chosen].actualPersonId=ownerConfig.slots.KAILI.personId;
  c.mappedParents[chosen].ownerSlotId=kaili;},/not currently available/);
 // The new typed wrapper is never an ordinary v9 compiler Source or receipt.
 assert.throws(()=>deriveDatedShiftEndCoverage(result,postgresJsonbContentDigest),/source-bound continuity policy/);checks++;
 assert.throws(()=>deriveDatedShiftEndCoverage(result.effectiveInput,postgresJsonbContentDigest),/complete owning position shift|completed rows/);checks++;
 assert.throws(()=>deriveApprovedMappedShiftEndCoverage({originalSource:approvedTemplateSource,currentSource:currentWeekSource,
  mappedSource:currentWeekSource,ownerConfig,parentMappings},postgresJsonbContentDigest),/ordinary week only/);checks++;
 // Coupled selected-day policy check: the real retained Saturday named chain
 // keeps its original Karen->Alijah->Gregory references while a UNIT seventh
 // position owns Karen's mapped Saturday parents. Future Wednesday incumbent
 // is now actually current on Saturday; no Tuesday identity is reused.
 const saturday=structuredClone(context),karen=ownerConfig.slots.KAREN.slotId;
 saturday.operationDate='2026-10-17';saturday.ownerConfig.slots.UNIT_SUBSTITUTE={...saturday.ownerConfig.slots.UNIT_SUBSTITUTE,
  personId:future,workDays:[6],shiftByDay:{6:['05:00','14:00']},lunchByDay:{6:['09:30','10:30']}};
 let week=structuredClone(currentWeekSource);week.version.slotAvailability=week.version.slotAvailability.filter(a=>a.slotId!==target);
 const satAvailability=structuredClone(week.version.slotAvailability.find(a=>a.slotId===karen&&a.dayOfWeek===6));
 satAvailability.slotId=target;satAvailability.maxDutyMinutes=450;satAvailability.maxDutyProvenance='UNIT Saturday bounded duty';
 satAvailability.acceptedRoute={startLocationId:satAvailability.acceptedRouteAnchorLocationId,provenance:'UNIT Saturday zero-stop route',stops:[]};
 delete satAvailability.acceptedRouteAnchorLocationId;delete satAvailability.acceptedRouteProvenance;week.version.slotAvailability.push(satAvailability);
 week.exceptions=[{...structuredClone(currentWeekSource.exceptions[0]),id:'unit-saturday-absence',idempotencyKey:'unit-saturday-absence',
  serviceDate:saturday.operationDate,payload:{slotId:karen}}];
 week=normalizeStaticWeeklyAuthority(week.version,week.slots,week.exceptions,week.proximity,week.serviceDate);
 saturday.originalWeekSource=structuredClone(week);saturday.currentWeekSource=week;
 saturday.mappedParents=approvedTemplateSource.version.assignments.filter(r=>r.dayOfWeek===6).map(r=>({...structuredClone(r),ownerSlotId:r.ownerSlotId===karen?target:r.ownerSlotId}));
 saturday.parentMappings=saturday.mappedParents.map(r=>({dayOfWeek:6,parentWorkId:r.workId,
  patternSlotId:approvedTemplateSource.version.assignments.find(p=>p.dayOfWeek===6&&p.workId===r.workId).ownerSlotId,
  actualSlotId:r.ownerSlotId,actualPersonId:r.ownerSlotId===target?future:people.get(r.ownerSlotId)}));
 const sat=deriveApprovedDatedMappedShiftEndCoverage(saturday,postgresJsonbContentDigest);
 const named=sat.namedHandoffReferences.find(r=>r.originalHandoff.fromSlotId===karen);
 assert.ok(named);assert.equal(named.mappedFromSlotId,target);assert.equal(named.originalHandoff.fromSlotId,karen);
 assert.ok(sat.handoffs.some(h=>h.fromSlotId===target&&h.toSlotId===ownerConfig.slots.ALIJAH.slotId&&h.at==='14:00'));
 assert.deepEqual(sat.effectiveInput.version.assignments.filter(r=>r.dayOfWeek!==6),week.version.assignments.filter(r=>r.dayOfWeek!==6));checks++;
 console.log(JSON.stringify({scope:'NEW selected Tuesday typed closing DATA on retained six plus explicitly constructed seventh-person turnover/absence',
  checks,fixtureSha256:packet.fixtureSha256,parents:result.parentReferences.length,segments:result.selectedAssignments.length,
  unchangedDays:6,operationIncumbent:'Tuesday person, not future Wednesday replacement; Saturday uses actual future replacement',
  namedPolicy:'ORIGINAL_AND_MAPPED_ENDPOINTS_RETAINED',SQL:'NOT_RUN',lunchPlanner:'SEPARATE_REQUIRED',
  approvalOrPublication:false,solver_runs:0,old_groups:0,resources0:true}));process.exit(0);
}
if(process.argv.includes('--approved-mapped-week-boundary-only')){
 const {deriveApprovedMappedShiftEndCoverage}=await import('../src/static-weekly-shift-end-derivation.js');
 const {loadSixPersonAbsenceSource}=await import('./fixtures/six-person-absence-source.mjs');
 const source=loadSixPersonAbsenceSource().compilerInput,mappedSource=structuredClone(source);mappedSource.serviceDate='2026-10-13';
 const before=JSON.stringify(mappedSource);
 assert.throws(()=>deriveApprovedMappedShiftEndCoverage({originalSource:source,currentSource:mappedSource,mappedSource,
  ownerConfig:JSON.parse(readFileSync(new URL('../config/custodial-six-person-static-20261005.json',import.meta.url))),parentMappings:[]},
  postgresJsonbContentDigest),/requires a Monday Source/);
 assert.equal(JSON.stringify(mappedSource),before);
 console.log(JSON.stringify({scope:'NEW fixed ordinary-week entry boundary for coordinated DATED consumer',checks:1,
  datedAdmission:false,SQL_execution:'NOT_RUN',old_groups:0,resources0:true}));process.exit(0);
}
if(process.argv.includes('--approved-mapped-parent-only')){
 const {loadSixPersonAbsenceSource}=await import('./fixtures/six-person-absence-source.mjs');
 const {deriveApprovedMappedShiftEndCoverage}=await import('../src/static-weekly-shift-end-derivation.js');
 const {prepareApprovedRecurringMappedProblem}=await import('../src/static-weekly-recurring-staffing-adaptation.js');
 const {deriveLunchCoverageFromPreparedProblem}=await import('../src/static-weekly-lunch-derivation.js');
 const {weekdayDate}=await import('../src/static-weekly-schedule-program.js');
 const {canonicalJson,installStaticWeeklySha256HexAccelerator}=await import('../src/static-weekly-schedule-model.js');
 const {createHash}=await import('node:crypto');installStaticWeeklySha256HexAccelerator(x=>createHash('sha256').update(x).digest('hex'));
 const ownerConfig=JSON.parse(readFileSync(new URL('../config/custodial-six-person-static-20261005.json',import.meta.url)));
 const packet=loadSixPersonAbsenceSource(),originalSource=packet.compilerInput,currentSource=structuredClone(originalSource);
 currentSource.serviceDate='2026-10-12';const mappedSource=structuredClone(currentSource);
 const kaili=ownerConfig.slots.KAILI.slotId,alijah=ownerConfig.slots.ALIJAH.slotId;
 const parent=mappedSource.version.assignments.find(r=>r.dayOfWeek===0&&r.ownerSlotId===kaili&&r.window.start==='09:45'&&r.locationCodeSnapshot!=='HERPETARIUM');
 assert.ok(parent);parent.ownerSlotId=alijah;assert.equal(parent.originSlotId,kaili);
 const people=new Map(Object.values(ownerConfig.slots).filter(s=>!s.vacancy).map(s=>[s.slotId,s.personId]));
 const originalRows=new Map(originalSource.version.assignments.map(r=>[`${r.dayOfWeek}:${r.workId}`,r]));
 const parentMappings=mappedSource.version.assignments.map(r=>({dayOfWeek:r.dayOfWeek,parentWorkId:r.workId,
  patternSlotId:originalRows.get(`${r.dayOfWeek}:${r.workId}`).ownerSlotId,actualSlotId:r.ownerSlotId,actualPersonId:people.get(r.ownerSlotId)}));
 const context={originalSource,currentSource,mappedSource,ownerConfig,parentMappings},before=canonicalJson(context);
 // The ordinary API still refuses exactly the owner-only remap. The new API
 // is derivation DATA only, not a fabricated accepted global-role publication.
 assert.throws(()=>deriveDatedShiftEndCoverage(mappedSource,postgresJsonbContentDigest),/complete owning position shift/);
 const problem=prepareApprovedRecurringMappedProblem(context,performance.now()+20_000),receipt=problem.shiftEndDerivation;
 assert.equal(receipt.schema,'custodial.approved-mapped-shift-end-derivation.v1');
 const ref=receipt.parentReferences.find(r=>r.parentWorkId===parent.workId&&r.dayOfWeek===0);
 assert.deepEqual(ref.originalParent,originalRows.get(`0:${parent.workId}`));assert.deepEqual(ref.mappedParent,parent);
 assert.equal(ref.originalOwnerSlotId,kaili);assert.equal(ref.mappedOwnerSlotId,alijah);
 assert.equal(ref.currentPersonId,ownerConfig.slots.ALIJAH.personId);
 assert.equal(problem.baselineCanonicalInput.version.assignments.find(r=>r.workId===parent.workId&&r.dayOfWeek===0).originSlotId,kaili);
 const selected=problem.work.map(work=>{
  const candidate=problem.candidates.find(c=>c.item===work&&c.slot.id===work.ownerSlotId);
  if(!candidate){assert.equal(work.required,false);assert.equal(work.coverageClass,'permitted_open');}
  return {planWorkId:work.key,workId:work.workId,dayOfWeek:work.dayOfWeek,serviceDate:weekdayDate(problem.serviceDate,work.dayOfWeek),
   status:candidate?'ASSIGNED':'OPEN',slotId:candidate?work.ownerSlotId:null,personId:candidate?problem.incumbencyByDaySlot.get(`${work.dayOfWeek}\u0000${work.ownerSlotId}`).personId:null,
   window:{start:work.window.start,end:work.window.end},locationId:work.locationId,serviceMode:work.serviceMode,
   includedLocations:work.includedLocations,serviceEffortMinutes:work.effort.minutes};
 });
 // The existing lunch derivation consumes real newly mapped owner selections.
 const lunch=deriveLunchCoverageFromPreparedProblem(problem,selected);assert.equal(lunch.status,'PLANNED');
 assert.equal(receipt.derivation.continuity.coverageGaps,0);assert.equal(receipt.derivation.continuity.duplicateLocations,0);
 assert.equal(canonicalJson(context),before);
 const chosen=parentMappings.findIndex(r=>r.dayOfWeek===0&&r.parentWorkId===parent.workId);
 const wrongParent=structuredClone(context);wrongParent.originalSource.version.assignments.find(r=>r.workId===parent.workId&&r.dayOfWeek===0).serviceEffortMinutes++;
 assert.throws(()=>deriveApprovedMappedShiftEndCoverage(wrongParent,postgresJsonbContentDigest),/current physical responsibility differs/);
 const foreign=structuredClone(context);foreign.parentMappings[chosen].parentWorkId='foreign-original-parent';
 assert.throws(()=>deriveApprovedMappedShiftEndCoverage(foreign,postgresJsonbContentDigest),/foreign\/duplicate parent/);
 const wrongPerson=structuredClone(context);wrongPerson.parentMappings[chosen].actualPersonId=ownerConfig.slots.KAILI.personId;
 assert.throws(()=>deriveApprovedMappedShiftEndCoverage(wrongPerson,postgresJsonbContentDigest),/current person\/availability differs/);
 const wrongShift=structuredClone(context);
 for(const s of [wrongShift.currentSource,wrongShift.mappedSource])s.version.slotAvailability.find(a=>a.dayOfWeek===0&&a.slotId===alijah).shift.end='15:30';
 assert.throws(()=>deriveApprovedMappedShiftEndCoverage(wrongShift,postgresJsonbContentDigest),/exact current target shift/);
 const sql=readFileSync(new URL('../supabase/migrations/20261017200958_approved_static_original_confirmation_receipts.sql',import.meta.url),'utf8');
 for(const fragment of ['END $approved_mapped_derivation_copy$;',"approved_ref->'originalParent' is distinct from original_parent",
  "mapped_parent is distinct from jsonb_set(original_parent,'{ownerSlotId}',owner_mapping->'actualSlotId')",
  "mapped_parent->'originSlotId' is distinct from original_parent->'originSlotId'",'Approved mapped derivation copy has unexplained drift'])assert.ok(sql.includes(fragment));
 assert.doesNotMatch(sql,/CREATE OR REPLACE FUNCTION public\.static_weekly_v9_assert_shift_end_derivation/);
 console.log(JSON.stringify({scope:'NEW actual retained-six Sunday Kaili to Alijah typed-parent derivation and current model/lunch DATA',
  fixtureSha256:packet.fixtureSha256,checks:7,originalParents:receipt.parentReferences.length,derivedRows:problem.work.length,lunches:lunch.lunches.length,
  ordinaryAPI:'STILL_REFUSES',typedPath:'DERIVED_WITH_ORIGINAL_ORIGIN_RETAINED',SQL_compilation:'NOT_RUN',SQL_execution:'NOT_RUN',
  roleMappingPublication:'NOT_ASSERTED',solver_runs:0,old_groups:0,resources0:true}));process.exit(0);
}
const packetPath=process.env.STATIC_WEEKLY_COVERAGE_PACKET;
assert.ok(packetPath,'explicit candidate packet is required; no production connection');
const packet=JSON.parse(readFileSync(packetPath,'utf8'));
const ownerConfig=JSON.parse(readFileSync(new URL('../config/custodial-six-person-static-20260926.json',import.meta.url),'utf8'));
const input=packet.compilerInput,original=JSON.stringify(input);
// The production compiler derives these position facts from the canonical
// source. The old September 23 config omits the empty position's source-bound
// route anchor and must not be spliced into this official candidate test.
const config={slots:{},weights:input.version.shiftEndContinuityPolicy.weights,
 sourceBoundEligibility:true,fullSegmentIdentity:true};
for(const slot of input.slots){
 const availability=input.version.slotAvailability.filter(row=>row.slotId===slot.id);
 if(!availability.length)continue;
 config.slots[slot.id]={slotId:slot.id,workDays:availability.map(row=>row.dayOfWeek),
  datedAvailability:Object.fromEntries(availability.map(row=>[row.dayOfWeek,{
   shift:[row.shift.start,row.shift.end],lunch:[row.lunch.start,row.lunch.end],
   status:row.status,qualifications:row.qualifications,restrictions:row.restrictions,
   acceptedRouteAnchorLocationId:row.acceptedRouteAnchorLocationId||null,
  }]))};
}
assert.throws(()=>validateRecurringShiftEndCoverage(input,input,config),/coverage gap/,
 'the old all-week source must expose its missing afternoon handoffs');
const completed=deriveDatedShiftEndCoverage(input,postgresJsonbContentDigest);
const saturdayCatParent=input.version.assignments.find(r=>r.dayOfWeek===6
 &&r.window.start==='09:45'&&r.locationCodeSnapshot==='CAT_COUNTRY');
assert.ok(saturdayCatParent,'Saturday Cat Country parent required');
const saturdayCatChain=completed.input.version.assignments.filter(r=>r.dayOfWeek===6
 &&(r.workId===saturdayCatParent.workId||r.workId.startsWith(`${saturdayCatParent.workId}:`)))
 .sort((a,b)=>a.window.start.localeCompare(b.window.start));
assert.deepEqual(saturdayCatChain.map(r=>[r.ownerSlotId,r.window.start,r.window.end]),[
 [ownerConfig.slots.KAREN.slotId,'09:45','14:00'],
 [ownerConfig.slots.ALIJAH.slotId,'14:00','16:00'],
 [ownerConfig.slots.GREGORY.slotId,'16:00','17:00'],
],'named Saturday handoff must match the employee sheets without an intermediate Kathy reassignment');
assert.equal(saturdayCatChain.reduce((n,r)=>n+r.serviceEffortMinutes,0),3,
 'named handoff must conserve inherited workload without an invented extra point');
const changedNamed=structuredClone(input);
changedNamed.version.shiftEndContinuityPolicy.namedHandoffs[0].toSlotId=ownerConfig.slots.KATHY.slotId;
assert.throws(()=>deriveDatedShiftEndCoverage(changedNamed,postgresJsonbContentDigest),/identity mismatch/,
 'named employee handoff is bound by the immutable policy digest');
for(const day of [4,5])assert.ok(completed.input.version.assignments.filter(r=>r.dayOfWeek===day)
 .every(r=>r.window.end<='16:00'),'Thursday/Friday must end at real staffed departure, not a vacant 17:00 position');
assert.ok(completed.notes.every(n=>input.slots.find(s=>s.id===n.toSlotId)?.incumbencies.some(i=>
 i.effectiveStart<=input.serviceDate&&(!i.effectiveEnd||input.serviceDate<i.effectiveEnd))),
 'no vacant position may receive a handoff');
assert.equal(JSON.stringify(input),original,'input source must not mutate');
assert.ok(completed.notes.length>0,'must actually create handoff assignments');
assert.equal(completed.validation.coverageGaps,0);
assert.equal(completed.validation.duplicateLocations,0);
const sum=rows=>rows.reduce((n,r)=>n+r.serviceEffortMinutes,0);
assert.equal(sum(completed.input.version.assignments),sum(input.version.assignments),'retain exact existing workload-point budget');
assert.deepEqual(completed.input.slots,input.slots,'do not invent employees or overwrite incumbency history');
assert.deepEqual(completed.input.version.slotAvailability,input.version.slotAvailability,'do not change shifts or lunches');
for(const row of completed.input.version.assignments){
 const position=input.version.slotAvailability.find(s=>s.slotId===row.ownerSlotId&&s.dayOfWeek===row.dayOfWeek);
 assert.ok(position&&row.window.start>=position.shift.start&&row.window.end<=position.shift.end,
  'a later vacancy fill must not inherit responsibility outside its unchanged shift');
}
assert.equal(input.version.assignments.filter(r=>input.version.vacantSlotIds.includes(r.ownerSlotId)).length,0,
 'the six-person source removes normal work from all vacant positions');
assert.ok(completed.notes.length>0&&completed.notes.every(n=>!input.version.vacantSlotIds.includes(n.toSlotId)),
 'late physical handoffs go only to real staffed successors');
const fridayOpen=completed.openResponsibilities.find(n=>n.day===5&&n.at==='15:00'&&n.locationCode==='HERPETARIUM');
assert.ok(fridayOpen,'Friday Herpetarium must remain explicitly OPEN when the only real worker is restricted');
assert.equal(fridayOpen.personId,null);
assert.ok(!completed.notes.some(n=>n.workId===fridayOpen.workId),'OPEN is never reported as a physical handoff');
const broken=structuredClone(completed.input);
const addedIndex=broken.version.assignments.findIndex(r=>r.workId.includes(':handoff:'));
broken.version.assignments.splice(addedIndex,1);
assert.throws(()=>validateRecurringShiftEndCoverage(input,broken,config),/coverage gap/,'a missing handoff must fail');
const doubled=structuredClone(completed.input);
doubled.version.assignments.push(structuredClone(doubled.version.assignments.find(r=>r.workId.includes(':handoff:'))));
assert.throws(()=>validateRecurringShiftEndCoverage(input,doubled,config),/duplicate location/,'duplicate coverage must fail');
assert.deepEqual(deriveDatedShiftEndCoverage(input,postgresJsonbContentDigest),completed,'repeat generation must be deterministic');
const missingTravel=structuredClone(input);missingTravel.proximity=[];
assert.throws(()=>deriveDatedShiftEndCoverage(missingTravel,postgresJsonbContentDigest),/eligible on-duty handoff/,'missing proximity is not invented');
const offDuty=structuredClone(completed.input);
const departedHandoff=completed.notes.find(n=>!n.fromVacantPosition);
const bad=offDuty.version.assignments.find(r=>r.workId===departedHandoff.workId);
const originalOwner=departedHandoff.fromSlotId;
bad.ownerSlotId=originalOwner;
assert.throws(()=>validateRecurringShiftEndCoverage(input,offDuty,config),/off-duty recurring owner/,'ended shifts cannot remain responsible');
assert.ok(completed.notes.every(row=>!(row.toSlotId===ownerConfig.slots.ALIJAH.slotId&&row.locationCode==='HERPETARIUM')),'Alijah restriction survives every handoff');
assert.ok(completed.input.version.assignments.every(row=>!row.workId.includes(':handoff:')||!ownerConfig.mondayOnlyFamilies.includes(row.locationCodeSnapshot)),'gift-shop work never gains late handoffs');
const future=structuredClone(input);
for(const slot of future.slots.filter(s=>future.version.vacantSlotIds.includes(s.id))) {
 slot.incumbencies.push({personId:`SYNTHETIC-${slot.id}`,displayName:'TEST ONLY FUTURE HIRE',effectiveStart:future.serviceDate,effectiveEnd:null});
 for(const row of future.version.slotAvailability.filter(r=>r.slotId===slot.id))row.status='working';
}
future.version.vacantSlotIds=[];
const fullyStaffed=deriveDatedShiftEndCoverage(future,postgresJsonbContentDigest);
assert.equal(fullyStaffed.validation.staffedDepartureByDay[4],'17:00','17:00 is legitimate only after the synthetic vacancy is actually filled');
assert.equal(fullyStaffed.validation.staffedDepartureByDay[5],'17:00');
const turnover=structuredClone(input),late=ownerConfig.slots.OPTION1.slotId;
// Friday hire is relative to the tested Monday, including later recurring starts.
const hireDate=new Date(`${input.serviceDate}T12:00:00Z`);hireDate.setUTCDate(hireDate.getUTCDate()+4);
const fridayHireDate=hireDate.toISOString().slice(0,10);
turnover.slots.find(s=>s.id===late).incumbencies.push({personId:'SYNTHETIC-LATE-HIRE',displayName:'TEST ONLY',effectiveStart:fridayHireDate,effectiveEnd:null});
turnover.version.vacantSlotIds=turnover.version.vacantSlotIds.filter(s=>s!==late);
for(const row of turnover.version.slotAvailability.filter(r=>r.slotId===late&&(r.dayOfWeek===0||r.dayOfWeek>=5)))row.status='working';
const dated=deriveDatedShiftEndCoverage(turnover,postgresJsonbContentDigest);
assert.equal(dated.validation.staffedDepartureByDay[4],'16:00','future hire must not count before their effective day');
assert.equal(dated.validation.staffedDepartureByDay[5],'17:00','actual dated hire changes staffed boundary');
const forged=structuredClone(completed.input);
forged.version.assignments.find(r=>r.workId.includes(':handoff:')).ownerSlotId=ownerConfig.slots.OPTION1.slotId;
assert.throws(()=>validateRecurringShiftEndCoverage(input,forged,config),/vacancy cannot receive|off-duty/);
assert.equal(JSON.stringify(input),original,'synthetic future staff never enter the real source');
console.log(JSON.stringify({assertions:'all passed',failed:0,handoffRows:completed.notes.length,...completed.validation,
 geography_review:'separate; existing proposed geography is not accepted by this test',physical_verification:false},null,2));
