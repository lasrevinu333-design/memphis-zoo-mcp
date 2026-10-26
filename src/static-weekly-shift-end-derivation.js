import {canonicalJson,snapshotDatedRosterSlot,serviceDateWeekday} from './static-weekly-schedule-model.js';
import {completeRecurringShiftEndCoverage} from './static-weekly-shift-end-coverage.js';
import {validateOwnerEligibilityConfig,assertNormalOwnerEligibility,normalGeographyRestrictionApplies} from './static-weekly-owner-eligibility.js';
import {prepareStaticWeeklySchedulingProblem} from './static-weekly-schedule-program.js';

export const SHIFT_END_POLICY_SCHEMA='memphis-zoo.shift-end-continuity-policy.v1';
export const SHIFT_END_ALGORITHM='dated-real-staff-directed-proximity-weighted-v1';
export const SHIFT_END_RECEIPT_SCHEMA='memphis-zoo.shift-end-derivation.v1';
const clone=v=>JSON.parse(JSON.stringify(v));
const fail=message=>{throw Object.assign(new Error(message),{code:'invalid_shift_end_continuity_authority'});};
const requireFact=(value,message)=>{if(!value)fail(message);};
const minute=t=>Number(t.slice(0,2))*60+Number(t.slice(3,5));
const physical=row=>Object.fromEntries(['locationId','locationCodeSnapshot','locationNameSnapshot','includedLocations',
 'serviceMode','requiredQualifications','restrictedSlotIds','restrictions','qualificationProvenance','restrictionProvenance']
 .map(key=>[key,row[key]??null]));
const dateForDay=(start,day)=>{
 const date=new Date(`${start}T12:00:00Z`);date.setUTCDate(date.getUTCDate()+(day-date.getUTCDay()+7)%7);
 return date.toISOString().slice(0,10);
};

export function createShiftEndContinuityPolicy(weights,sourceConfigurationSha256,digest,namedHandoffs=[]){
 const body={schema:SHIFT_END_POLICY_SCHEMA,algorithm:SHIFT_END_ALGORITHM,normalPhaseStart:'09:45',
  weights:clone(weights),provenance:`owner-configuration-sha256:${sourceConfigurationSha256}`,
  ...(namedHandoffs.length?{namedHandoffs:clone(namedHandoffs)}:{})};
 return {...body,policyDigest:digest(body)};
}

// All domain facts come from the immutable canonical source or its dated
// roster hydration. There is no filesystem, network, clock or mutable config.
export function deriveDatedShiftEndCoverage(source,digest,canonicalizeEffective=value=>value){
 const original=canonicalJson(source),policy=source.version?.shiftEndContinuityPolicy;
 requireFact(policy&&typeof digest==='function','source-bound continuity policy is required');
 const expectedKeys=['algorithm','normalPhaseStart','policyDigest','provenance','schema','weights',
  ...(Object.hasOwn(policy,'namedHandoffs')?['namedHandoffs']:[])];
 requireFact(canonicalJson(Object.keys(policy).sort())===canonicalJson(expectedKeys.sort()),'continuity policy has unknown or missing fields');
 const {policyDigest,...body}=policy;
 requireFact(policy.schema===SHIFT_END_POLICY_SCHEMA&&policy.algorithm===SHIFT_END_ALGORITHM
  &&policy.normalPhaseStart==='09:45'&&/^owner-configuration-sha256:[a-f0-9]{64}$/.test(policy.provenance)
  &&policyDigest===digest(body),'continuity policy identity mismatch');
 requireFact(policy.weights&&Object.getPrototypeOf(policy.weights)===Object.prototype
  &&Object.values(policy.weights).every(n=>typeof n==='number'&&Number.isSafeInteger(n*2)&&n>0&&n<=1000),
  'exact positive half-unit workload weights required');
 if(Object.hasOwn(policy,'namedHandoffs')){
  requireFact(Array.isArray(policy.namedHandoffs)&&policy.namedHandoffs.length<=14,'bounded named handoffs required');
  const seen=new Set();
  for(const handoff of policy.namedHandoffs){
   requireFact(handoff&&canonicalJson(Object.keys(handoff).sort())===canonicalJson(
    ['at','dayOfWeek','fromSlotId','locationCode','source','toSlotId'].sort()),'named handoff fields invalid');
   requireFact(Number.isInteger(handoff.dayOfWeek)&&handoff.dayOfWeek>=0&&handoff.dayOfWeek<=6
    &&/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(handoff.at)
    &&typeof handoff.locationCode==='string'&&Object.hasOwn(policy.weights,handoff.locationCode)
    &&typeof handoff.source==='string'&&handoff.source.length>=10&&handoff.source.length<=300
    &&typeof handoff.fromSlotId==='string'&&typeof handoff.toSlotId==='string'
    &&handoff.fromSlotId!==handoff.toSlotId,'named handoff identity invalid');
   const key=`${handoff.dayOfWeek}:${handoff.locationCode}:${handoff.at}`;
   requireFact(!seen.has(key),'duplicate named handoff');seen.add(key);
  }
 }
 requireFact(!source.version.shiftEndDerivationApplied,'effective derived source cannot be used as an immutable template');
 requireFact(Array.isArray(source.version.assignments)&&source.version.assignments.length<=1024,'bounded recurring template required');
 const positions={},roster=[];
 const capable=new Set(source.version.vacancyCapableSlotIds||[]);
 for(const slot of source.slots){
  if(slot.contractorCapacity===true)continue;
  const availability=source.version.slotAvailability.filter(a=>a.slotId===slot.id);
  if(!availability.length)continue;
  const datedAvailability={};
  for(const a of availability){
   requireFact(!Object.hasOwn(datedAvailability,a.dayOfWeek),'duplicate dated position availability');
   requireFact(a.shift&&a.lunch&&['working','vacant_unfilled','departed_named_absent'].includes(a.status)
    &&Array.isArray(a.qualifications)&&a.qualificationProvenance&&Array.isArray(a.restrictions)&&a.restrictionProvenance,'complete canonical availability eligibility required');
   const date=dateForDay(source.serviceDate,a.dayOfWeek);
   const incumbent=snapshotDatedRosterSlot(slot,date,{vacancyCapable:capable.has(slot.id)});
   requireFact((incumbent.vacant===true)===(a.status==='vacant_unfilled'),'dated vacancy and availability disagree');
   datedAvailability[a.dayOfWeek]={shift:[a.shift.start,a.shift.end],lunch:[a.lunch.start,a.lunch.end],
    status:a.status,qualifications:clone(a.qualifications),restrictions:clone(a.restrictions),
    acceptedRouteAnchorLocationId:a.acceptedRouteAnchorLocationId||null};
   roster.push({serviceDate:date,dayOfWeek:a.dayOfWeek,slotId:slot.id,personId:incumbent.personId,
    vacant:incumbent.vacant===true,status:a.status,shift:clone(a.shift),lunch:clone(a.lunch)});
  }
  positions[slot.id]={slotId:slot.id,workDays:availability.map(a=>a.dayOfWeek),datedAvailability};
 }
 const parentIds=new Set();
 for(const row of source.version.assignments){
  const id=`${row.dayOfWeek}:${row.workId}`;
  requireFact(!parentIds.has(id),'duplicate parent work identity');parentIds.add(id);
  requireFact(!row.workId.includes(':handoff:')&&!row.workId.includes(':open:'),'completed rows cannot replace the full template');
  if(row.window.start!==policy.normalPhaseStart)continue;
  const owner=positions[row.ownerSlotId]?.datedAvailability[row.dayOfWeek];
  requireFact(owner&&row.originSlotId===row.ownerSlotId&&row.window.end===owner.shift[1],
   'immutable normal parent must retain its complete owning position shift');
  requireFact(Object.hasOwn(policy.weights,row.locationCodeSnapshot),'family weight missing from immutable policy');
  requireFact(Array.isArray(row.restrictedSlotIds)&&row.restrictionProvenance&&Array.isArray(row.requiredQualifications)
   &&row.qualificationProvenance,'canonical parent eligibility provenance required');
 }
 const completed=completeRecurringShiftEndCoverage(source,{slots:positions,weights:policy.weights,
  sourceBoundEligibility:true,fullSegmentIdentity:true,namedHandoffs:policy.namedHandoffs||[]});
 requireFact(completed.input.version.assignments.length<=1024,'derived work exceeds bounded program limit');
 const generated=new Set(),chains=[];
 for(const parent of source.version.assignments){
  const prefix=`${parent.workId}:`;
  const rows=completed.input.version.assignments.filter(row=>row.dayOfWeek===parent.dayOfWeek
   &&(row.workId===parent.workId||row.workId.startsWith(prefix)&&!parentIds.has(`${row.dayOfWeek}:${row.workId}`)))
   .sort((a,b)=>a.window.start.localeCompare(b.window.start)||a.workId.localeCompare(b.workId));
  requireFact(rows.length>0,'parent responsibility was lost');
  const normal=parent.window.start===policy.normalPhaseStart;
  let previous=parent.window.start;
  for(const row of rows){
   const key=`${row.dayOfWeek}:${row.workId}`;
   requireFact(!generated.has(key),'duplicate/colliding derived segment identity');generated.add(key);
   requireFact(canonicalJson(physical(row))===canonicalJson(physical(parent)),'derived physical identity changed');
   requireFact(row.window.start===previous&&minute(row.window.end)>minute(row.window.start),'non-contiguous or nonpositive segment');previous=row.window.end;
   if(!normal)requireFact(canonicalJson(row)===canonicalJson(parent),'non-shift-end parent changed');
  }
  requireFact(rows.reduce((n,r)=>n+r.serviceEffortMinutes,0)===parent.serviceEffortMinutes,'parent workload is not conserved');
  requireFact(rows.every(r=>Number.isSafeInteger(r.serviceEffortMinutes)&&r.serviceEffortMinutes>0),'positive exact segment workload required');
  if(normal)requireFact(previous===completed.validation.staffedDepartureByDay[parent.dayOfWeek],'chain does not end at actual staffed boundary');
  chains.push({dayOfWeek:parent.dayOfWeek,parentWorkId:parent.workId,physicalIdentityDigest:digest(physical(parent)),
   workloadBefore:parent.serviceEffortMinutes,workloadAfter:rows.reduce((n,r)=>n+r.serviceEffortMinutes,0),
   segments:rows.map(r=>({workId:r.workId,ownerSlotId:r.ownerSlotId,window:clone(r.window),
    serviceEffortMinutes:r.serviceEffortMinutes,kind:r.workId===parent.workId?'baseline':r.workId.includes(':open:')?'open':'handoff'}))});
 }
 requireFact(generated.size===completed.input.version.assignments.length,'unknown derived segment');
 completed.input.version.shiftEndDerivationApplied=policyDigest;
 roster.sort((a,b)=>a.dayOfWeek-b.dayOfWeek||a.slotId.localeCompare(b.slotId));
 chains.sort((a,b)=>a.dayOfWeek-b.dayOfWeek||a.parentWorkId.localeCompare(b.parentWorkId));
 const effectiveInput=canonicalizeEffective(completed.input);
 const receipt={schema:SHIFT_END_RECEIPT_SCHEMA,algorithm:SHIFT_END_ALGORITHM,templateDigest:digest(source),policyDigest,
  datedRosterDigest:digest(roster),derivedBaselineDigest:digest(effectiveInput),
  staffedDepartureByDay:completed.validation.staffedDepartureByDay,parentChains:chains,
  outputWorkDigest:digest(effectiveInput.version.assignments),continuity:completed.validation};
 requireFact(canonicalJson(source)===original,'immutable source mutated during derivation');
 return {effectiveInput,receipt,...completed};
}

// Selected-day DATA only. Both week inputs are the same retained, canonical
// PRE-derivation publication (including its actual accepted exceptions). They
// are compared, not merged. The normal program independently hydrates those
// exceptions/incumbencies; no caller-supplied availability/applied flag is used.
// The import cycle is function-only: the program uses the unchanged ordinary
// derivation, never this selected-day entry. No optimizer or writer is invoked.
export function deriveApprovedDatedMappedShiftEndCoverage(context,digest){
 const exact=(value,keys,label)=>requireFact(value&&Object.getPrototypeOf(value)===Object.prototype
  &&canonicalJson(Object.keys(value).sort())===canonicalJson([...keys].sort()),`${label} fields differ`);
 exact(context,['originalWeekSource','currentWeekSource','approvedTemplateSource','operationDate','mappedParents','parentMappings','ownerConfig'],
  'approved dated context');
 const {originalWeekSource,currentWeekSource,approvedTemplateSource,operationDate,mappedParents,parentMappings,ownerConfig}=context;
 const before=canonicalJson(context),key=r=>`${r.dayOfWeek}:${r.workId??r.parentWorkId}`;
 requireFact(typeof digest==='function','approved dated digest required');
 requireFact(canonicalJson(originalWeekSource)===canonicalJson(currentWeekSource),'approved dated original/current week differs');
 requireFact(currentWeekSource.version&&approvedTemplateSource.version
  &&serviceDateWeekday(currentWeekSource.serviceDate)===1,'approved dated canonical Monday week required');
 const day=serviceDateWeekday(operationDate);
 requireFact(dateForDay(currentWeekSource.serviceDate,day)===operationDate,'approved dated operation is outside original week');
 requireFact(currentWeekSource.version.id&&(currentWeekSource.version.publicationId||currentWeekSource.version.publication_id),
  'approved dated original publication/version required');
 requireFact(serviceDateWeekday(currentWeekSource.version.effectiveStart)===1
  &&currentWeekSource.version.effectiveStart<=currentWeekSource.serviceDate
  &&(currentWeekSource.version.effectiveEnd==null||dateForDay(currentWeekSource.serviceDate,0)<currentWeekSource.version.effectiveEnd),
  'approved dated original publication must cover the entire current week');
 requireFact(Array.isArray(approvedTemplateSource.exceptions)&&approvedTemplateSource.exceptions.length===0
  &&approvedTemplateSource.version.effectiveStart<=operationDate
  &&(approvedTemplateSource.version.effectiveEnd==null||operationDate<approvedTemplateSource.version.effectiveEnd),
  'approved dated template is not an effective immutable zero-overlay Source');
 validateOwnerEligibilityConfig(ownerConfig);
 requireFact(canonicalJson(currentWeekSource.version.shiftEndContinuityPolicy)===canonicalJson(approvedTemplateSource.version.shiftEndContinuityPolicy)
  &&canonicalJson(currentWeekSource.proximity)===canonicalJson(approvedTemplateSource.proximity),'approved dated template policy/geography differs');
 // Independently validate immutable template geometry and original accepted
 // week through the existing normal program, including reversal/sequence and
 // source-version/publication binding. Do not reimplement exception admission.
 deriveDatedShiftEndCoverage(approvedTemplateSource,digest);
 const wire={...clone(currentWeekSource),versions:[clone(currentWeekSource.version)]};delete wire.version;
 const problem=prepareStaticWeeklySchedulingProblem(wire);
 requireFact(!problem.error,'approved dated original week preparation refused');
 requireFact(canonicalJson({...problem.baselineCanonicalInput,exceptions:currentWeekSource.exceptions})===canonicalJson(currentWeekSource),
  'approved dated week must be canonical pre-derivation Source');
 const state=problem.states.get(day),applied=problem.applied.filter(e=>e.serviceDate===operationDate);
 requireFact(applied.every(e=>['pto','daily_absence','partial_absence','shift_override','lunch'].includes(e.type)),
  'approved dated work-changing exception requires its own typed parent derivation');
 const parents=approvedTemplateSource.version.assignments.filter(r=>r.dayOfWeek===day),current=currentWeekSource.version.assignments.filter(r=>r.dayOfWeek===day);
 const dense=rows=>Array.isArray(rows)&&rows.length>0&&rows.length<=1024&&rows.every((_,i)=>Object.hasOwn(rows,i))
  &&Object.keys(rows).length===rows.length;
 requireFact(dense(mappedParents)&&dense(parentMappings)&&mappedParents.length===parents.length&&parentMappings.length===parents.length,
  'approved dated map must cover selected template day only');
 const originalByKey=new Map(parents.map(r=>[key(r),r])),mappedByKey=new Map(mappedParents.map(r=>[key(r),r]));
 requireFact(originalByKey.size===parents.length&&mappedByKey.size===parents.length,'approved dated parent duplicated');
 const domain=rows=>{
  const groups=new Map();
  for(const w of rows){
   const facts=canonicalJson({family:w.locationCodeSnapshot,phase:w.window.end==='09:45'?'morning':w.window.start==='09:45'?'equalized':w.window,
    mode:w.serviceMode??null,scheduling:w.schedulingMode??null,required:w.required!==false,priority:w.priority??null,
    qualifications:w.requiredQualifications,restrictions:w.restrictions,restrictedSlots:w.restrictedSlotIds||[],
    policy:w.coveragePolicy??null,order:w.coveragePolicyOrder??null});
   if(!groups.has(facts))groups.set(facts,{facts,members:[],effort:0});
   const g=groups.get(facts);g.members.push(...(w.includedLocations?.length?w.includedLocations:
    [{locationId:w.locationId,locationNameSnapshot:w.locationNameSnapshot}]).map(canonicalJson));
   requireFact(Number.isSafeInteger(w.serviceEffortMinutes)&&Number.isSafeInteger(g.effort+w.serviceEffortMinutes),'approved dated effort invalid');
   g.effort+=w.serviceEffortMinutes;
  }
  return [...groups.values()].map(g=>({...g,members:g.members.sort()})).sort((a,b)=>a.facts<b.facts?-1:a.facts>b.facts?1:0);
 };
 requireFact(canonicalJson(domain(parents))===canonicalJson(domain(current)),'approved dated current/template physical responsibility differs');
 const configBySlot=new Map(Object.entries(ownerConfig.slots).map(([key,value])=>[value.slotId,{key,...value}]));
 const positions=new Map(),capable=new Set(currentWeekSource.version.vacancyCapableSlotIds||[]);
 // Include absent/off/empty positions too. They remain original day facts,
 // never candidates; the selected result must not erase the accepted absence.
 const availability=[...state.availability].map(([slotId,a])=>{
  const person=problem.incumbencyByDaySlot.get(`${day}\u0000${slotId}`);
  requireFact(person,'approved dated operation-day roster identity missing');
  return {slotId,personId:person.personId,vacant:person.vacant===true,availability:clone(a)};
 });
 const time=w=>w&&/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(w.start)&&/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(w.end)&&w.start<w.end;
 for(const [slotId,a] of state.availability){
  if(!['working','vacant_unfilled'].includes(a.status))continue;
  const slot=currentWeekSource.slots.find(s=>s.id===slotId&&!s.contractorCapacity),configured=configBySlot.get(slotId);
  requireFact(slot&&configured&&time(a.shift)&&time(a.lunch),'approved dated current employee shift/lunch/config missing');
  const person=snapshotDatedRosterSlot(slot,operationDate,{vacancyCapable:capable.has(slotId)});
  requireFact((person.vacant===true)===(a.status==='vacant_unfilled')
   &&(person.vacant===true?configured.vacancy===true&&configured.personId==null:configured.vacancy!==true&&person.personId===configured.personId),
   'approved dated operation-day current incumbent differs');
  const base=currentWeekSource.version.slotAvailability.find(r=>r.dayOfWeek===day&&r.slotId===slotId);
  const shift=configured.shiftByDay?.[day]||configured.shift,lunch=configured.lunchByDay?.[day]||configured.lunch;
  requireFact(base&&configured.workDays?.includes(day)&&Array.isArray(shift)&&Array.isArray(lunch)
   &&canonicalJson(base.shift)===canonicalJson({start:shift[0],end:shift[1]})
   &&canonicalJson(base.lunch)===canonicalJson({start:lunch[0],end:lunch[1]}),'approved dated current configured shift/lunch differs');
  requireFact(Array.isArray(a.qualifications)&&Array.isArray(a.restrictions)&&a.qualificationProvenance&&a.restrictionProvenance,
   'approved dated current eligibility missing');
  const p={slotId,personId:person.personId,vacant:person.vacant===true,configured,availability:clone(a)};
  positions.set(slotId,p);
 }
 const seen=new Set(),references=[],roleMap=new Map(),actualRoles=new Map();
 for(const m of parentMappings){
  exact(m,['dayOfWeek','parentWorkId','patternSlotId','actualSlotId','actualPersonId'],'approved dated parent mapping');
  const id=key(m),originalParent=originalByKey.get(id),mappedParent=mappedByKey.get(id),p=positions.get(m.actualSlotId);
  requireFact(m.dayOfWeek===day&&originalParent&&mappedParent&&!seen.has(id),'approved dated foreign/duplicate day parent');seen.add(id);
  requireFact(m.patternSlotId===originalParent.ownerSlotId&&m.actualSlotId===mappedParent.ownerSlotId
   &&canonicalJson({...originalParent,ownerSlotId:m.actualSlotId})===canonicalJson(mappedParent),
   'approved dated mapped parent differs from original substitution');
  requireFact(p&&!p.vacant&&p.personId===m.actualPersonId,'approved dated mapped person is not currently available');
  requireFact((!roleMap.has(m.patternSlotId)||roleMap.get(m.patternSlotId)===m.actualSlotId)
   &&(!actualRoles.has(m.actualSlotId)||actualRoles.get(m.actualSlotId)===m.patternSlotId),
   'approved dated selected role mapping is inconsistent');
  roleMap.set(m.patternSlotId,m.actualSlotId);actualRoles.set(m.actualSlotId,m.patternSlotId);
  const a=p.availability;
  assertNormalOwnerEligibility(p.configured,mappedParent.locationCodeSnapshot);
  requireFact(mappedParent.window.start>=a.shift.start&&mappedParent.window.end<=a.shift.end
   &&(mappedParent.window.start!=='09:45'||mappedParent.window.end===a.shift.end),'approved dated mapped target shift conflicts');
  requireFact((mappedParent.requiredQualifications||[]).every(q=>a.qualifications.includes(q))
   &&!(mappedParent.restrictedSlotIds||[]).includes(m.actualSlotId)
   &&!(mappedParent.includedLocations?.length?mappedParent.includedLocations:[{locationId:mappedParent.locationId}]).some(l=>a.restrictions.includes(l.locationId))
   &&(!mappedParent.manualLock||m.actualSlotId===originalParent.ownerSlotId)
   &&(!state.manualLocks.has(mappedParent.workId)||state.manualLocks.get(mappedParent.workId)===m.actualSlotId),
   'approved dated parent eligibility/lock differs');
  references.push({dayOfWeek:day,parentWorkId:m.parentWorkId,originalParent:clone(originalParent),mappedParent:clone(mappedParent),
   originalOwnerSlotId:originalParent.ownerSlotId,mappedOwnerSlotId:m.actualSlotId,currentPersonId:p.personId});
 }
 // Same directed-proximity/load ranking, lunch-at-handoff exclusion and exact
 // largest-remainder budget split as normal completion; only ONE real day is
 // traversed here. No synthetic six-day source is fed to the weekly engine.
 const rows=clone(mappedParents),normal=rows.filter(r=>r.window.start==='09:45'),policy=approvedTemplateSource.version.shiftEndContinuityPolicy;
 const workers=[...positions.values()].filter(p=>!p.vacant);
 requireFact(workers.length>0,'approved dated no current staffed closing');
 const final=Math.max(...workers.map(p=>minute(p.availability.shift.end))),clock=n=>`${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;
 const ids=r=>r.includedLocations?.length?r.includedLocations.map(l=>l.locationId):[r.locationId];
 const distances=new Map(currentWeekSource.proximity.filter(e=>e.verified===true).map(e=>[`${e.fromLocationId}|${e.toLocationId}`,e.minutes]));
 const anchors=new Map([...positions].map(([id,p])=>{const own=normal.filter(r=>r.ownerSlotId===id).flatMap(ids);
  return [id,own.length?own:p.availability.acceptedRouteAnchorLocationId?[p.availability.acceptedRouteAnchorLocationId]:[]];}));
 for(const r of normal)r.window.end=clock(Math.min(minute(r.window.end),final));
 const units=normal.map(r=>({original:r,owner:r.ownerSlotId,rows:[r]})),added=[],handoffs=[],openResponsibilities=[];
 const namedHandoffReferences=(policy.namedHandoffs||[]).filter(h=>h.dayOfWeek===day).map(h=>({originalHandoff:clone(h),
  mappedFromSlotId:roleMap.get(h.fromSlotId)||h.fromSlotId,mappedToSlotId:roleMap.get(h.toSlotId)||h.toSlotId}));
 const named=new Map(namedHandoffReferences.map(r=>[`${r.originalHandoff.locationCode}:${r.originalHandoff.at}`,
  {...r.originalHandoff,fromSlotId:r.mappedFromSlotId,toSlotId:r.mappedToSlotId}])),used=new Set();
 const partial=applied.some(e=>e.type==='partial_absence')&&[...positions.values()].some(p=>!p.vacant
  &&(p.availability.blockedWindows||[]).some(w=>rows.some(r=>w.start<(r.window.start==='09:45'?clock(final):r.window.end)&&r.window.start<w.end)
   &&w.start<p.availability.shift.end&&p.availability.shift.start<w.end));
 if(partial){
  // Use the real accepted interval union, not a whole-person absence flag.
  // Boundaries only split responsibility when ownership actually changes;
  // unrelated shift/lunch/absence boundaries are coalesced before budgeting.
  // A closing parent's responsibility outlives its first owner's shift, just
  // as in normal completion. Extend only this internal coverage horizon;
  // every emitted owner still must fit its own actual shift/blocked windows.
  const intervalUnits=rows.map(r=>({original:{...r,window:{...r.window,end:r.window.start==='09:45'?clock(final):r.window.end}},segments:[],owner:r.ownerSlotId,
   flexible:r.schedulingMode==='flexible_coverage_ownership'&&r.serviceMode!=='reminder_only'}));
  const unresolved=[];
  const issue=(u,start,end,reason,requiredSegments=null)=>{
   const last=unresolved.at(-1);
   if(last&&last.parentWorkId===u.original.workId&&last.reason===reason&&last.window.end===clock(start)
    &&last.requiredSegments===requiredSegments){last.window.end=clock(end);return;}
   unresolved.push({dayOfWeek:day,parentWorkId:u.original.workId,window:{start:clock(start),end:clock(end)},reason,
    originalBudget:u.original.serviceEffortMinutes,requiredSegments});
  };
  const fits=(p,start,end,borrowed)=>{
   const a=p.availability;
   return !p.vacant&&minute(a.shift.start)<=start&&end<=minute(a.shift.end)
    &&!(a.blockedWindows||[]).some(w=>minute(w.start)<end&&start<minute(w.end))
    // Baseline lunch responsibility still needs the independent lunch plan.
    // A NEW borrowed interval/fixed appointment cannot be given to a person
    // during that person's protected lunch, even if its start is outside it.
    &&(!borrowed||!(minute(a.lunch.start)<end&&start<minute(a.lunch.end)));
  };
  const eligibleFor=(u,p,start,end)=>{
   const r=u.original,a=p.availability,c=p.configured;
   return fits(p,start,end,p.slotId!==r.ownerSlotId||!u.flexible)
    &&!(c.hardForbiddenFamilies||[]).includes(r.locationCodeSnapshot)
    &&(!normalGeographyRestrictionApplies(c)||c.normalAssignmentFamilies.includes(r.locationCodeSnapshot))
    &&!(r.restrictedSlotIds||[]).includes(p.slotId)&&(r.requiredQualifications||[]).every(q=>a.qualifications.includes(q))
    &&!ids(r).some(id=>a.restrictions.includes(id));
  };
  const rank=(u,start,end,loads)=>workers.filter(p=>eligibleFor(u,p,start,end)).map(p=>({p,
   distance:Math.max(...ids(u.original).map(target=>Math.min(...anchors.get(p.slotId).map(anchor=>
    target===anchor?0:distances.get(`${anchor}|${target}`)??Infinity)))),load:loads.get(p.slotId)||0}))
   .filter(x=>Number.isFinite(x.distance)).sort((a,b)=>a.distance-b.distance||a.load-b.load||a.p.slotId.localeCompare(b.p.slotId));
  // Reference ownership is the normal shift-end policy chain. Partial
  // unavailability does NOT become a new nominal roster or permanently erase
  // a planned successor's working portions. These references alone are never
  // emitted as available work: every actual interval still passes fits().
  const nominal=intervalUnits.filter(u=>u.original.window.start==='09:45').map(u=>({u,owner:u.owner,
   spans:[{start:minute(u.original.window.start),end:final,owner:u.owner}]}));
  for(const at of [...new Set([...positions.values()].map(p=>minute(p.availability.shift.end)))].filter(t=>t<final).sort((a,b)=>a-b)){
   const leaving=nominal.filter(n=>minute(positions.get(n.owner).availability.shift.end)===at);
   const remaining=workers.filter(p=>minute(p.availability.shift.start)<=at&&at<minute(p.availability.shift.end));
   const loads=new Map(remaining.map(p=>[p.slotId,nominal.filter(n=>n.owner===p.slotId)
    .reduce((n,x)=>n+Number(policy.weights[x.u.original.locationCodeSnapshot]??1),0)]));
   for(const n of leaving.sort((a,b)=>a.u.original.workId.localeCompare(b.u.original.workId))){
    const r=n.u.original,candidates=remaining.filter(p=>{
     const a=p.availability,c=p.configured;
     return !(c.hardForbiddenFamilies||[]).includes(r.locationCodeSnapshot)
      &&(!normalGeographyRestrictionApplies(c)||c.normalAssignmentFamilies.includes(r.locationCodeSnapshot))
      &&!(r.restrictedSlotIds||[]).includes(p.slotId)&&(r.requiredQualifications||[]).every(q=>a.qualifications.includes(q))
      &&!ids(r).some(id=>a.restrictions.includes(id))&&!(minute(a.lunch.start)<=at&&at<minute(a.lunch.end));
    }).map(p=>({p,distance:Math.max(...ids(r).map(target=>Math.min(...anchors.get(p.slotId).map(anchor=>
     target===anchor?0:distances.get(`${anchor}|${target}`)??Infinity)))),load:loads.get(p.slotId)||0}))
     .filter(x=>Number.isFinite(x.distance)).sort((a,b)=>a.distance-b.distance||a.load-b.load||a.p.slotId.localeCompare(b.p.slotId));
    const nk=`${r.locationCodeSnapshot}:${clock(at)}`,handoff=named.get(nk);let next=candidates[0];
    if(handoff)next=handoff.fromSlotId===n.owner?candidates.find(x=>x.p.slotId===handoff.toSlotId):null;
    if(!next){issue(n.u,at,final,handoff?'NAMED_HANDOFF_UNAVAILABLE':'NO_ELIGIBLE_INTERVAL_OWNER');continue;}
    n.spans.at(-1).end=at;n.spans.push({start:at,end:final,owner:next.p.slotId});n.owner=next.p.slotId;
    loads.set(n.owner,(loads.get(n.owner)||0)+Number(policy.weights[r.locationCodeSnapshot]??1));
   }
  }
  const boundaries=[...new Set(intervalUnits.flatMap(u=>[minute(u.original.window.start),minute(u.original.window.end)])
   .concat([...positions.values()].flatMap(p=>[p.availability.shift,p.availability.lunch,...(p.availability.blockedWindows||[])]
    .flatMap(w=>[minute(w.start),minute(w.end)])),[...named.values()].map(n=>minute(n.at))))].sort((a,b)=>a-b);
  for(let i=0;i<boundaries.length-1;i++){
   const start=boundaries[i],end=boundaries[i+1];
   const active=intervalUnits.filter(u=>minute(u.original.window.start)<=start&&end<=minute(u.original.window.end));
   const loads=new Map(workers.map(p=>[p.slotId,active.filter(u=>u.owner===p.slotId)
    .reduce((n,u)=>n+Number(policy.weights[u.original.locationCodeSnapshot]??1),0)]));
   for(const u of active.sort((a,b)=>a.original.workId.localeCompare(b.original.workId))){
    const r=u.original;
    if(!u.flexible&&u.segments.length)continue; // one original visit, never extra visits
    const from=u.flexible?start:minute(r.window.start),to=u.flexible?end:minute(r.window.end);
    const desired=nominal.find(n=>n.u===u)?.spans.find(s=>s.start<=from&&to<=s.end)?.owner??r.ownerSlotId;
    const candidates=rank(u,from,to,loads),preferred=candidates.find(x=>x.p.slotId===desired),prior=candidates.find(x=>x.p.slotId===u.owner);
    // Restore the normal policy owner (including a named/ordinary successor)
    // when that person's accepted absence ends; no working portion is erased.
    let next=preferred||prior||candidates[0];
    const nk=`${r.locationCodeSnapshot}:${clock(start)}`,n=r.window.start==='09:45'?named.get(nk):null;
    if(n){
     next=n.fromSlotId===u.owner?candidates.find(x=>x.p.slotId===n.toSlotId):null;
     if(!next){issue(u,from,to,'NAMED_HANDOFF_UNAVAILABLE');used.add(nk);continue;}
     used.add(nk);
    }
    if((r.manualLock||state.manualLocks.has(r.workId))&&next?.p.slotId!==r.ownerSlotId){
     issue(u,from,to,'LOCKED_PARENT_UNAVAILABLE');continue;
    }
    if(!next){issue(u,from,to,u.flexible?'NO_ELIGIBLE_INTERVAL_OWNER':'FIXED_VISIT_REQUIRES_SINGLE_AVAILABLE_OWNER');continue;}
    const previous=u.owner,last=u.segments.at(-1),owner=next.p.slotId;
    if(last&&last.ownerSlotId===owner&&last.window.end===clock(from))last.window.end=clock(to);
    else{
     const first=u.segments.length===0;
     const segment={...clone(r),workId:first?r.workId:`${r.workId}:handoff:${clock(from)}:${owner}`,ownerSlotId:owner,
      originSlotId:first?r.originSlotId:owner,window:{start:clock(from),end:clock(to)}};
     u.segments.push(segment);
     if(owner!==previous)handoffs.push({day,at:clock(from),workId:segment.workId,fromSlotId:previous,toSlotId:owner,
      locationCode:r.locationCodeSnapshot,locationIds:ids(r),directedProximityMinutes:next.distance,fromVacantPosition:false});
    }
    if(owner!==previous){
     const weight=Number(policy.weights[r.locationCodeSnapshot]??1);
     loads.set(previous,(loads.get(previous)||0)-weight);loads.set(owner,(loads.get(owner)||0)+weight);
    }
    u.owner=owner;
   }
  }
  for(const [nk,n] of named)if(!used.has(nk)){
   const u=intervalUnits.find(u=>u.original.window.start==='09:45'&&u.original.locationCodeSnapshot===n.locationCode);
   requireFact(u,'approved dated named policy lost its original parent');issue(u,minute(n.at),minute(u.original.window.end),'NAMED_HANDOFF_UNAVAILABLE');
  }
  for(const u of intervalUnits){
   const budget=u.original.serviceEffortMinutes,count=u.segments.length;
   if(!Number.isSafeInteger(budget)||budget<count){issue(u,minute(u.original.window.start),minute(u.original.window.end),
    'ORIGINAL_BUDGET_INSUFFICIENT_FOR_POSITIVE_SEGMENTS',count);continue;}
   if(count<=1)continue;
   const durations=u.segments.map(r=>minute(r.window.end)-minute(r.window.start)),total=durations.reduce((a,b)=>a+b,0);
   const allocation=durations.map((d,index)=>{const numerator=BigInt(budget-count)*BigInt(d);return {index,
    points:1+Number(numerator/BigInt(total)),remainder:numerator%BigInt(total)};});
   let left=budget-allocation.reduce((n,a)=>n+a.points,0);
   for(const a of allocation.slice().sort((a,b)=>a.remainder===b.remainder?a.index-b.index:a.remainder>b.remainder?-1:1)){
    if(left<=0)break;a.points++;left--;
   }
   for(const a of allocation){u.segments[a.index].serviceEffortMinutes=a.points;
    u.segments[a.index].serviceEffortProvenance+=';shift-split-preserves-budget';}
  }
  if(unresolved.length){
   requireFact(canonicalJson(context)===before,'approved dated immutable Source changed');
   const result={schema:'custodial.approved-dated-mapped-shift-end-unresolved.v1',status:'UNRESOLVED',operationDate,dayOfWeek:day,
    originalWeekSourceDigest:digest(originalWeekSource),currentWeekSourceDigest:digest(currentWeekSource),approvedTemplateSourceDigest:digest(approvedTemplateSource),
    ownerConfigDigest:digest(ownerConfig),parentReferences:references.sort((a,b)=>a.parentWorkId.localeCompare(b.parentWorkId)),
    selectedAvailability:availability.sort((a,b)=>a.slotId.localeCompare(b.slotId)),appliedExceptions:clone(applied),namedHandoffReferences,
    unresolved,originalWeekSource:clone(originalWeekSource)};
   const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};return freeze(result);
  }
  rows.splice(0,rows.length,...intervalUnits.flatMap(u=>u.segments));
  rows.sort((a,b)=>a.window.start.localeCompare(b.window.start)||a.workId.localeCompare(b.workId));
 }else{
 for(const at of [...new Set([...positions.values()].map(p=>minute(p.availability.shift.end)))].filter(t=>t<final).sort((a,b)=>a-b)){
  const leaving=units.filter(u=>minute(positions.get(u.owner).availability.shift.end)===at);
  const remaining=workers.filter(p=>minute(p.availability.shift.start)<=at&&at<minute(p.availability.shift.end));
  const loads=new Map(remaining.map(p=>[p.slotId,units.filter(u=>u.owner===p.slotId).reduce((n,u)=>n+Number(policy.weights[u.original.locationCodeSnapshot]??1),0)]));
  for(const u of leaving.sort((a,b)=>a.original.workId.localeCompare(b.original.workId))){
   const r=u.original,rank=domain=>domain.filter(p=>{
    const a=p.availability,c=p.configured;
    return !(c.hardForbiddenFamilies||[]).includes(r.locationCodeSnapshot)
     &&(!normalGeographyRestrictionApplies(c)||c.normalAssignmentFamilies.includes(r.locationCodeSnapshot))
     &&!(r.restrictedSlotIds||[]).includes(p.slotId)&&(r.requiredQualifications||[]).every(q=>a.qualifications.includes(q))
     &&!ids(r).some(id=>a.restrictions.includes(id))&&!(minute(a.lunch.start)<=at&&at<minute(a.lunch.end))
     &&!(a.blockedWindows||[]).some(w=>minute(w.start)<=at&&at<minute(w.end));
   }).map(p=>({p,distance:Math.max(...ids(r).map(target=>Math.min(...anchors.get(p.slotId).map(anchor=>
    target===anchor?0:distances.get(`${anchor}|${target}`)??Infinity)))),load:loads.get(p.slotId)||0}))
    .filter(x=>Number.isFinite(x.distance)).sort((a,b)=>a.distance-b.distance||a.load-b.load||a.p.slotId.localeCompare(b.p.slotId));
   let eligible=rank(remaining),open=eligible.length===0;
   if(open)eligible=rank([...positions.values()].filter(p=>p.vacant&&minute(p.availability.shift.start)<=at&&at<minute(p.availability.shift.end)));
   requireFact(eligible.length>0,'approved dated no eligible on-duty handoff owner');
   const nk=`${r.locationCodeSnapshot}:${clock(at)}`,n=named.get(nk);let next=eligible[0];
   if(n){requireFact(n.fromSlotId===u.owner&&!open,'approved dated named handoff source changed');next=eligible.find(x=>x.p.slotId===n.toSlotId);
    requireFact(next,'approved dated named handoff recipient unavailable');used.add(nk);}
   const previous=u.owner,p=next.p,handoff={...clone(r),workId:`${r.workId}:${open?'open':'handoff'}:${clock(at)}:${p.slotId}`,
    ownerSlotId:p.slotId,originSlotId:p.slotId,window:{start:clock(at),end:clock(Math.min(minute(p.availability.shift.end),final))}};
   u.owner=p.slotId;u.rows.push(handoff);added.push(handoff);loads.set(p.slotId,(loads.get(p.slotId)||0)+Number(policy.weights[r.locationCodeSnapshot]??1));
   (open?openResponsibilities:handoffs).push({day,at:clock(at),workId:handoff.workId,fromSlotId:previous,toSlotId:p.slotId,
    locationCode:r.locationCodeSnapshot,locationIds:ids(r),directedProximityMinutes:next.distance,fromVacantPosition:positions.get(previous).vacant,
    ...(open?{status:'OPEN',personId:null,reason:'no_eligible_real_on_duty_custodian'}:{})});
  }
 }
 requireFact(used.size===named.size,'approved dated named handoff was not applied');
 for(const u of units){
  requireFact(u.rows.at(-1).window.end===clock(final),'approved dated chain missed staffed closing');
  if(u.rows.length===1)continue;
  const budget=u.original.serviceEffortMinutes;
  requireFact(Number.isSafeInteger(budget)&&budget>=u.rows.length,'approved dated insufficient original split budget');
  const durations=u.rows.map(r=>minute(r.window.end)-minute(r.window.start)),total=durations.reduce((a,b)=>a+b,0),distributable=budget-u.rows.length;
  const allocation=durations.map((d,index)=>({index,points:1+Math.floor(distributable*d/total),remainder:(distributable*d)%total}));
  let left=budget-allocation.reduce((n,r)=>n+r.points,0);
  for(const a of allocation.slice().sort((a,b)=>b.remainder-a.remainder||a.index-b.index)){if(left<=0)break;a.points++;left--;}
  for(const a of allocation){u.rows[a.index].serviceEffortMinutes=a.points;u.rows[a.index].serviceEffortProvenance+=';shift-split-preserves-budget';}
 }
 rows.push(...added);rows.sort((a,b)=>a.window.start.localeCompare(b.window.start)||a.workId.localeCompare(b.workId));
 }
 const identities=new Set();
 for(const r of rows){
  requireFact(!identities.has(r.workId)&&r.dayOfWeek===day,'approved dated derived identity duplicated/foreign');identities.add(r.workId);
  const p=positions.get(r.ownerSlotId),a=p?.availability;
  requireFact(a&&r.window.start>=a.shift.start&&r.window.end<=a.shift.end&&r.window.start<r.window.end
   &&!(a.blockedWindows||[]).some(w=>w.start<r.window.end&&r.window.start<w.end),'approved dated segment conflicts with accepted availability');
 }
 const chains=[];
 for(const parent of mappedParents){
  const chain=rows.filter(r=>r.workId===parent.workId||r.workId.startsWith(`${parent.workId}:`)&&!mappedByKey.has(key(r)))
   .sort((a,b)=>a.window.start.localeCompare(b.window.start)||a.workId.localeCompare(b.workId));
  let previous=parent.window.start;
  for(const r of chain){
   requireFact(r.window.start===previous&&canonicalJson(physical(r))===canonicalJson(physical(parent))
    &&r.originSlotId===(r.workId===parent.workId?parent.originSlotId:r.ownerSlotId),'approved dated original lineage/chain differs');previous=r.window.end;
   if(parent.window.start!=='09:45'&&!partial)requireFact(canonicalJson(r)===canonicalJson(parent),'approved dated nonclosing parent changed');
  }
  requireFact(chain.length>0&&chain.every(r=>Number.isSafeInteger(r.serviceEffortMinutes)&&r.serviceEffortMinutes>0)
   &&chain.reduce((n,r)=>n+r.serviceEffortMinutes,0)===parent.serviceEffortMinutes,'approved dated parent workload differs');
  if(partial)requireFact(previous===(parent.window.start==='09:45'?clock(final):parent.window.end),'approved dated partial chain lost an interval');
  chains.push({dayOfWeek:day,parentWorkId:parent.workId,segments:clone(chain)});
 }
 const expected=new Set(normal.flatMap(ids));let locationMinuteChecks=0;
 for(let at=585;at<final;at++){
  const counts=new Map();
  for(const r of rows.filter(r=>r.serviceMode!=='reminder_only'&&minute(r.window.start)>=585&&minute(r.window.start)<=at&&at<minute(r.window.end)))
   for(const id of ids(r))counts.set(id,(counts.get(id)||0)+1);
  requireFact(counts.size===expected.size&&[...expected].every(id=>counts.get(id)===1),'approved dated closing physical coverage gap/duplicate');
  locationMinuteChecks+=expected.size;
 }
 const effectiveInput=clone(currentWeekSource),first=effectiveInput.version.assignments.findIndex(r=>r.dayOfWeek===day);
 requireFact(first>=0,'approved dated original selected day missing');
 effectiveInput.version.assignments=effectiveInput.version.assignments.flatMap((r,i)=>r.dayOfWeek===day?(i===first?clone(rows):[]):[r]);
 requireFact(canonicalJson(context)===before,'approved dated immutable Source changed');
 references.sort((a,b)=>a.parentWorkId.localeCompare(b.parentWorkId));availability.sort((a,b)=>a.slotId.localeCompare(b.slotId));
 const result={schema:'custodial.approved-dated-mapped-shift-end-derivation.v1',operationDate,dayOfWeek:day,
  originalWeekSourceDigest:digest(originalWeekSource),currentWeekSourceDigest:digest(currentWeekSource),approvedTemplateSourceDigest:digest(approvedTemplateSource),
  ownerConfigDigest:digest(ownerConfig),parentReferences:references,selectedAssignments:rows,selectedAvailability:availability,appliedExceptions:clone(applied),
  parentChains:chains,namedHandoffReferences,continuity:{staffedDeparture:clock(final),minuteSamples:final-585,locationMinuteChecks,coverageGaps:0,duplicateLocations:0,
   lunchScope:'handoff eligibility only; independent lunch coverage derivation required'},handoffs,openResponsibilities,effectiveInput};
 const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
 return freeze(result);
}

// Separate DATA derivation, never approval/admission. Original template rows,
// original owning positions and current mapped execution parents coexist.
// The ordinary entry above retains its origin===owner invariant unchanged.
// Normal publication must independently reconstruct these references from its
// actual immutable catalog/current roster, not trust this receipt or its hash.
export function deriveApprovedMappedShiftEndCoverage({originalSource,currentSource,mappedSource,ownerConfig,parentMappings},
 digest,canonicalizeEffective=value=>value){
 const before=canonicalJson({originalSource,currentSource,mappedSource,ownerConfig,parentMappings});
 const exact=(value,keys,label)=>requireFact(value&&typeof value==='object'&&!Array.isArray(value)
  &&canonicalJson(Object.keys(value).sort())===canonicalJson([...keys].sort()),`${label} fields differ`);
 requireFact(typeof digest==='function','approved derivation requires the normal digest function');
 requireFact(serviceDateWeekday(mappedSource.serviceDate)===1,'approved mapped derivation requires a Monday Source');
 validateOwnerEligibilityConfig(ownerConfig);
 requireFact(originalSource.exceptions?.length===0&&currentSource.exceptions?.length===0&&mappedSource.exceptions?.length===0,
  'approved mapped derivation is an ordinary week only');
 requireFact(mappedSource.version&&currentSource.version&&originalSource.version,'canonical original/current/mapped versions required');
 requireFact(canonicalJson({...mappedSource,version:{...mappedSource.version,assignments:[]}})
  ===canonicalJson({...currentSource,version:{...currentSource.version,assignments:[]}}),
 'approved mapped source changed current metadata');
 requireFact(canonicalJson(originalSource.version.shiftEndContinuityPolicy)===canonicalJson(mappedSource.version.shiftEndContinuityPolicy)
  &&canonicalJson(originalSource.proximity)===canonicalJson(mappedSource.proximity),'approved mapped policy/geography differs');
 // Validate the complete original policy and parent geometry without changing
 // the ordinary validator or using the resulting receipt as approval.
 deriveDatedShiftEndCoverage(originalSource,digest);
 const parents=originalSource.version.assignments,mapped=mappedSource.version.assignments;
 requireFact(Array.isArray(parentMappings)&&parentMappings.length===parents.length&&mapped.length===parents.length
  &&parents.length>0&&parents.length<=1024&&parentMappings.every((_,i)=>Object.hasOwn(parentMappings,i)),
 'approved parent map must cover every original exactly once');
 const key=r=>`${r.dayOfWeek}:${r.workId??r.parentWorkId}`;
 const originals=new Map(parents.map(r=>[key(r),r])),mappedByKey=new Map(mapped.map(r=>[key(r),r]));
 requireFact(originals.size===parents.length&&mappedByKey.size===mapped.length,'approved parent identity duplicated');
 const domain=source=>{
  const groups=new Map();
  for(const w of source.version.assignments){
   const f=canonicalJson({day:w.dayOfWeek,family:w.locationCodeSnapshot,
    phase:w.window.end==='09:45'?'morning':w.window.start==='09:45'?'equalized':w.window,
    mode:w.serviceMode??null,scheduling:w.schedulingMode??null,required:w.required!==false,priority:w.priority??null,
    qualifications:w.requiredQualifications,restrictions:w.restrictions,restrictedSlots:w.restrictedSlotIds||[],
    policy:w.coveragePolicy??null,order:w.coveragePolicyOrder??null});
   if(!groups.has(f))groups.set(f,{facts:f,members:[],effort:0});
   const g=groups.get(f);g.members.push(...(w.includedLocations?.length?w.includedLocations:
    [{locationId:w.locationId,locationNameSnapshot:w.locationNameSnapshot}]).map(canonicalJson));
   requireFact(Number.isSafeInteger(w.serviceEffortMinutes)&&Number.isSafeInteger(g.effort+w.serviceEffortMinutes),'approved physical effort invalid');
   g.effort+=w.serviceEffortMinutes;
  }
  return [...groups.values()].map(g=>({...g,members:g.members.sort()})).sort((a,b)=>a.facts<b.facts?-1:a.facts>b.facts?1:0);
 };
 requireFact(canonicalJson(domain(originalSource))===canonicalJson(domain(currentSource)),'approved current physical responsibility differs');
 const configBySlot=new Map(Object.entries(ownerConfig.slots).map(([key,value])=>[value.slotId,{key,...value}]));
 const positions={},roster=[],capable=new Set(mappedSource.version.vacancyCapableSlotIds||[]);
 for(const slot of mappedSource.slots){
  if(slot.contractorCapacity===true)continue;
  const availability=mappedSource.version.slotAvailability.filter(a=>a.slotId===slot.id),datedAvailability={};
  if(!availability.length)continue;
  const configured=configBySlot.get(slot.id);
  requireFact(configured,'approved current position configuration missing');
  for(const a of availability){
   requireFact(!Object.hasOwn(datedAvailability,a.dayOfWeek),'approved current availability duplicated');
   const serviceDate=dateForDay(mappedSource.serviceDate,a.dayOfWeek);
   const incumbent=snapshotDatedRosterSlot(slot,serviceDate,{vacancyCapable:capable.has(slot.id)});
   requireFact(a.shift&&a.lunch&&Array.isArray(a.qualifications)&&a.qualificationProvenance
    &&Array.isArray(a.restrictions)&&a.restrictionProvenance,'approved current availability eligibility missing');
   requireFact((incumbent.vacant===true)===(a.status==='vacant_unfilled'),'approved current vacancy differs');
   if(!incumbent.vacant)requireFact(configured.personId===incumbent.personId&&configured.vacancy!==true,
    'approved current person differs from owner configuration');
   if(a.status==='working'){
    const shift=configured.shiftByDay?.[a.dayOfWeek]||configured.shift,lunch=configured.lunchByDay?.[a.dayOfWeek]||configured.lunch;
    requireFact(configured.workDays?.includes(a.dayOfWeek)&&Array.isArray(shift)&&Array.isArray(lunch)
     &&canonicalJson(a.shift)===canonicalJson({start:shift[0],end:shift[1]})
     &&canonicalJson(a.lunch)===canonicalJson({start:lunch[0],end:lunch[1]}),
    'approved mapped closing parent must retain exact current target shift and configured lunch');
   }
   datedAvailability[a.dayOfWeek]={shift:[a.shift.start,a.shift.end],lunch:[a.lunch.start,a.lunch.end],status:a.status,
    qualifications:clone(a.qualifications),restrictions:clone(a.restrictions),acceptedRouteAnchorLocationId:a.acceptedRouteAnchorLocationId||null};
   roster.push({serviceDate,dayOfWeek:a.dayOfWeek,slotId:slot.id,personId:incumbent.personId,vacant:incumbent.vacant===true,
    status:a.status,shift:clone(a.shift),lunch:clone(a.lunch)});
  }
  positions[slot.id]={slotId:slot.id,workDays:availability.map(a=>a.dayOfWeek),datedAvailability,
   forbiddenFamilies:configured.hardForbiddenFamilies||[],
   ...(normalGeographyRestrictionApplies(configured)?{normalAllowedFamilies:configured.normalAssignmentFamilies}:{})};
 }
 const seen=new Set(),references=[];
 for(const mapping of parentMappings){
  exact(mapping,['dayOfWeek','parentWorkId','patternSlotId','actualSlotId','actualPersonId'],'approved parent mapping');
  const id=key(mapping),originalParent=originals.get(id),mappedParent=mappedByKey.get(id);
  requireFact(originalParent&&mappedParent&&!seen.has(id),'approved mapping foreign/duplicate parent');seen.add(id);
  requireFact(mapping.patternSlotId===originalParent.ownerSlotId&&mapping.actualSlotId===mappedParent.ownerSlotId
   &&canonicalJson({...originalParent,ownerSlotId:mapping.actualSlotId})===canonicalJson(mappedParent),
  'approved mapped parent differs from exact original owner substitution');
  const current=mappedSource.slots.find(s=>s.id===mapping.actualSlotId&&!s.contractorCapacity);
  requireFact(current,'approved mapped position is not a current employee position');
  const person=snapshotDatedRosterSlot(current,dateForDay(mappedSource.serviceDate,mapping.dayOfWeek),{vacancyCapable:capable.has(current.id)});
  const a=mappedSource.version.slotAvailability.find(a=>a.slotId===current.id&&a.dayOfWeek===mapping.dayOfWeek),configured=configBySlot.get(current.id);
  requireFact(person.personId&&person.personId===mapping.actualPersonId&&configured?.personId===person.personId
   &&a?.status==='working','approved mapped current person/availability differs');
  assertNormalOwnerEligibility(configured,mappedParent.locationCodeSnapshot);
  requireFact(mappedParent.window.start>=a.shift.start&&mappedParent.window.end<=a.shift.end
   &&(mappedParent.window.start!=='09:45'||mappedParent.window.end===a.shift.end),
  'approved mapped closing parent must retain exact current target shift');
  requireFact((mappedParent.requiredQualifications||[]).every(q=>a.qualifications.includes(q))
   &&!(mappedParent.restrictedSlotIds||[]).includes(current.id)
   &&!(mappedParent.includedLocations?.length?mappedParent.includedLocations:[{locationId:mappedParent.locationId}])
    .some(l=>a.restrictions.includes(l.locationId))
   &&(!mappedParent.manualLock||mapping.actualSlotId===originalParent.ownerSlotId),
  'approved mapped parent current eligibility or original lock differs');
  references.push({dayOfWeek:mapping.dayOfWeek,parentWorkId:mapping.parentWorkId,
   originalParent:clone(originalParent),mappedParent:clone(mappedParent),originalOwnerSlotId:originalParent.ownerSlotId,
   mappedOwnerSlotId:current.id,currentPersonId:person.personId});
 }
 const policy=mappedSource.version.shiftEndContinuityPolicy;
 const completed=completeRecurringShiftEndCoverage(mappedSource,{slots:positions,weights:policy.weights,
  sourceBoundEligibility:true,fullSegmentIdentity:true,namedHandoffs:policy.namedHandoffs||[]});
 const generated=new Set(),chains=[];
 for(const parent of mapped){
  const prefix=`${parent.workId}:`,rows=completed.input.version.assignments.filter(r=>r.dayOfWeek===parent.dayOfWeek
   &&(r.workId===parent.workId||r.workId.startsWith(prefix)&&!mappedByKey.has(key(r))))
   .sort((a,b)=>a.window.start.localeCompare(b.window.start)||a.workId.localeCompare(b.workId));
  requireFact(rows.length>0,'approved mapped parent responsibility lost');
  let previous=parent.window.start;
  for(const row of rows){
   requireFact(!generated.has(key(row)),'approved mapped derived identity duplicated');generated.add(key(row));
   requireFact(canonicalJson(physical(row))===canonicalJson(physical(parent)),'approved mapped derived physical identity differs');
   requireFact(row.window.start===previous&&minute(row.window.end)>minute(row.window.start),'approved mapped chain is not contiguous');previous=row.window.end;
   requireFact(row.originSlotId===(row.workId===parent.workId?parent.originSlotId:row.ownerSlotId),
    'approved original parent origin or derived handoff origin changed');
   if(parent.window.start!=='09:45')requireFact(canonicalJson(row)===canonicalJson(parent),'approved nonclosing parent changed');
  }
  requireFact(rows.every(r=>Number.isSafeInteger(r.serviceEffortMinutes)&&r.serviceEffortMinutes>0)
   &&rows.reduce((n,r)=>n+r.serviceEffortMinutes,0)===parent.serviceEffortMinutes,'approved mapped workload not conserved');
  if(parent.window.start==='09:45')requireFact(previous===completed.validation.staffedDepartureByDay[parent.dayOfWeek],'approved mapped chain missed staffed closing');
  chains.push({dayOfWeek:parent.dayOfWeek,parentWorkId:parent.workId,physicalIdentityDigest:digest(physical(parent)),
   workloadBefore:parent.serviceEffortMinutes,workloadAfter:rows.reduce((n,r)=>n+r.serviceEffortMinutes,0),
   segments:rows.map(r=>({workId:r.workId,ownerSlotId:r.ownerSlotId,window:clone(r.window),serviceEffortMinutes:r.serviceEffortMinutes,
    kind:r.workId===parent.workId?'baseline':r.workId.includes(':open:')?'open':'handoff'}))});
 }
 requireFact(generated.size===completed.input.version.assignments.length&&generated.size<=1024,'approved mapped unknown/overlimit derived row');
 completed.input.version.shiftEndDerivationApplied=policy.policyDigest;
 roster.sort((a,b)=>a.dayOfWeek-b.dayOfWeek||a.slotId.localeCompare(b.slotId));
 const compare=(a,b)=>a.dayOfWeek-b.dayOfWeek||a.parentWorkId.localeCompare(b.parentWorkId);
 chains.sort(compare);references.sort(compare);
 const effectiveInput=canonicalizeEffective(completed.input);
 const derivation={schema:SHIFT_END_RECEIPT_SCHEMA,algorithm:SHIFT_END_ALGORITHM,templateDigest:digest(mappedSource),policyDigest:policy.policyDigest,
  datedRosterDigest:digest(roster),derivedBaselineDigest:digest(effectiveInput),staffedDepartureByDay:completed.validation.staffedDepartureByDay,
  parentChains:chains,outputWorkDigest:digest(effectiveInput.version.assignments),continuity:completed.validation};
 const receipt={schema:'custodial.approved-mapped-shift-end-derivation.v1',algorithm:SHIFT_END_ALGORITHM,
  originalTemplateDigest:digest(originalSource),currentSourceDigest:digest(currentSource),mappedSourceDigest:digest(mappedSource),
  ownerConfigDigest:digest(ownerConfig),parentReferences:references,derivation};
 requireFact(canonicalJson({originalSource,currentSource,mappedSource,ownerConfig,parentMappings})===before,'approved source/context changed during derivation');
 return {effectiveInput,receipt,...completed};
}
