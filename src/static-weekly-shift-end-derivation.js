import {canonicalJson,snapshotDatedRosterSlot} from './static-weekly-schedule-model.js';
import {completeRecurringShiftEndCoverage} from './static-weekly-shift-end-coverage.js';

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

export function createShiftEndContinuityPolicy(weights,sourceConfigurationSha256,digest){
 const body={schema:SHIFT_END_POLICY_SCHEMA,algorithm:SHIFT_END_ALGORITHM,normalPhaseStart:'09:45',
  weights:clone(weights),provenance:`owner-configuration-sha256:${sourceConfigurationSha256}`};
 return {...body,policyDigest:digest(body)};
}

// All domain facts come from the immutable canonical source or its dated
// roster hydration. There is no filesystem, network, clock or mutable config.
export function deriveDatedShiftEndCoverage(source,digest,canonicalizeEffective=value=>value){
 const original=canonicalJson(source),policy=source.version?.shiftEndContinuityPolicy;
 requireFact(policy&&typeof digest==='function','source-bound continuity policy is required');
 requireFact(canonicalJson(Object.keys(policy).sort())===canonicalJson(['algorithm','normalPhaseStart','policyDigest','provenance','schema','weights'].sort()),'continuity policy has unknown or missing fields');
 const {policyDigest,...body}=policy;
 requireFact(policy.schema===SHIFT_END_POLICY_SCHEMA&&policy.algorithm===SHIFT_END_ALGORITHM
  &&policy.normalPhaseStart==='09:45'&&/^owner-configuration-sha256:[a-f0-9]{64}$/.test(policy.provenance)
  &&policyDigest===digest(body),'continuity policy identity mismatch');
 requireFact(policy.weights&&Object.getPrototypeOf(policy.weights)===Object.prototype
  &&Object.values(policy.weights).every(n=>typeof n==='number'&&Number.isSafeInteger(n*2)&&n>0&&n<=1000),
  'exact positive half-unit workload weights required');
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
    status:a.status,qualifications:clone(a.qualifications),restrictions:clone(a.restrictions)};
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
  sourceBoundEligibility:true,fullSegmentIdentity:true});
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
