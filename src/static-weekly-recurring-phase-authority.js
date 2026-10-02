// Normal selected-phase evidence only. No publication, generic owner unlock,
// solver, dated priority change, physical-time claim or caller-supplied witness.
import {contentDigest,canonicalJson,bytewiseCompare} from './static-weekly-schedule-model.js';
import {prepareStaticWeeklySchedulingProblem,buildStaticWeeklySchedulingModel} from './static-weekly-schedule-program.js';
import {getScheduleComponentWeightLedger,COMPONENT_WEIGHT_UNIT} from './schedule-component-weight-authority.js';
export const RECURRING_PHASE_SCHEMA='custodial.recurring-selected-phase-authority.v1';
export const RECURRING_PHASE_ENUMERATION_LIMIT=64;
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
const requireFact=(ok,message)=>{if(!ok)fail('recurring_phase_source_invalid',message);};
const clone=x=>structuredClone(x);
const digest=contentDigest;
const version=s=>s.version||(s.versions?.length===1?s.versions[0]:null);
function inputFor(source){
 const x=clone(source);requireFact(!(x.version&&x.versions),'Ambiguous source version.');
 if(x.version){x.versions=[x.version];delete x.version;}return x;
}
function prepared(source){
 const p=prepareStaticWeeklySchedulingProblem(inputFor(source));
 if(p.error)fail(p.error.code||'recurring_phase_source_invalid',p.error.message||'Canonical source preparation failed.');
 return p;
}
const known=new Map(getScheduleComponentWeightLedger().families.map(f=>[f.code,f]));
function packageFact(row,config){
 const w=config.weights?.[row.locationCodeSnapshot];
 requireFact(Number.isSafeInteger(w*2)&&w>0,'Explicit half-unit aggregate weight required; no default zero/one.');
 requireFact(row.schedulingMode==='flexible_coverage_ownership','Selected normal packages must be flexible ownership, not timed service.');
 requireFact(Array.isArray(row.includedLocations),'Explicit physical member list required.');
 requireFact(new Set(row.includedLocations.map(x=>x.locationId)).size===row.includedLocations.length,'Duplicate physical member.');
 const k=known.get(row.locationCodeSnapshot);
 if(k){
  requireFact(k.aggregateWeight===w&&k.primaryLocationId===row.locationId&&k.serviceMode===row.serviceMode,'Known package identity/unit/capability drift.');
  const ids=k.serviceMode==='response_only_no_clean'?[]:k.components.map(x=>x.locationId).sort(bytewiseCompare);
  requireFact(canonicalJson(row.includedLocations.map(x=>x.locationId).sort(bytewiseCompare))===canonicalJson(ids),'Known package member drift.');
 }
 return {workId:row.workId,family:row.locationCodeSnapshot,primaryLocationId:row.locationId,
  memberIds:row.includedLocations.map(x=>x.locationId),serviceMode:row.serviceMode,
  doubledWeight:w*2,componentBinding:k?'EXACT_KNOWN_COMPONENTS':'EXPLICIT_SOURCE_PACKAGE_AND_CONFIG_AGGREGATE_ONLY'};
}
export function createRecurringPhaseDescriptor({source,ownerConfig,dayOfWeek,selectedWorkIds=[]}){
 requireFact(source&&ownerConfig&&Array.isArray(selectedWorkIds),'Explicit source/config/selection required.');
 requireFact(Number.isInteger(dayOfWeek)&&dayOfWeek>=0&&dayOfWeek<=6,'Explicit weekday required.');
 requireFact(Array.isArray(source.exceptions)&&source.exceptions.length===0,'Dated overlays are not normal replacement scope.');
 const v=version(source);requireFact(v&&Array.isArray(v.assignments),'One canonical source required.');
 requireFact(new Set(selectedWorkIds).size===selectedWorkIds.length,'Duplicate selected work identity.');
 const p=prepared(source);
 const cfg=new Map(Object.values(ownerConfig.slots||{}).map(s=>[s.slotId,s]));
 const owners=[...p.availabilityByDaySlot.values()].filter(x=>x.availability.dayOfWeek===dayOfWeek&&!x.slot.contractorCapacity)
  .map(x=>{const c=cfg.get(x.slot.id);requireFact(c&&c.vacancy!==true&&c.workDays.includes(dayOfWeek),'Current ordinary owner/config mismatch.');
   requireFact(canonicalJson(c.shift)===canonicalJson([x.availability.shift.start,x.availability.shift.end]),'Fixed shift/config mismatch.');
   requireFact(canonicalJson(c.lunch)===canonicalJson([x.availability.lunch.start,x.availability.lunch.end]),'Fixed lunch/config mismatch.');
   const incumbent=p.incumbencyByDaySlot.get(`${dayOfWeek}\0${x.slot.id}`);
   requireFact(incumbent?.personId===c.personId&&incumbent?.displayName===c.name,'Current ordinary incumbent/config mismatch.');
   return {slotId:x.slot.id,shift:clone(x.availability.shift)};}).sort((a,b)=>bytewiseCompare(a.slotId,b.slotId));
 requireFact(owners.length>0,'No current working ordinary owners.');
 const rows=v.assignments.filter(r=>r.dayOfWeek===dayOfWeek&&r.window?.start==='09:45');
 requireFact(rows.length>0,'No explicit09:45 normal source rows.');
 const packages=rows.map(r=>packageFact(r,ownerConfig));
 requireFact(new Set(packages.map(r=>r.family)).size===packages.length,'Split/duplicate phase family unsupported; never flatten it.');
 requireFact(selectedWorkIds.every(id=>rows.some(r=>r.workId===id)),'Foreign, morning or absent selected work.');
 requireFact(selectedWorkIds.every(id=>v.assignments.filter(r=>r.workId===id).length===1),'Selected work ID must uniquely identify its source row across all days.');
 const selected=packages.filter(r=>selectedWorkIds.includes(r.workId)).sort((a,b)=>bytewiseCompare(a.workId,b.workId));
 const choices=selected.map(r=>({workId:r.workId,owners:owners.filter(o=>{
  const c=cfg.get(o.slotId),original=rows.find(row=>row.workId===r.workId);
  return !(ownerConfig.mondayOnlyFamilies?.includes(r.family)&&(original.originSlotId||original.ownerSlotId)!==o.slotId)
   &&!c.hardForbiddenFamilies?.includes(r.family)
   &&(!c.normalAssignmentFamilies||c.normalAssignmentFamilies.includes(r.family))&&o.shift.end>'09:45';
 }).map(o=>({slotId:o.slotId,window:{start:'09:45',end:o.shift.end},
  prospectiveWorkId:`${dayOfWeek}:${r.family}:equalized:${o.slotId.slice(0,8)}`}))}));
 const body={schema:RECURRING_PHASE_SCHEMA,scope:selected.length?'EXPLICIT_SELECTED_POST0945_NORMAL_REPLACEMENT':'PRESERVED_NOT_REOPTIMIZED',
  sourceDigest:digest(source),configDigest:digest(ownerConfig),dayOfWeek,
  unit:COMPONENT_WEIGHT_UNIT,integerScale:2,halfUnitDoubledBound:1,owners,packages,choices,
  fixedSourceRowsDigest:digest(v.assignments.filter(r=>!selectedWorkIds.includes(r.workId))),
  selectedWorkIds:selected.map(r=>r.workId),sourceMutated:false,published:false,
  existingNonemptyPhaseOwnerCondition:selected.length>0,
  fixedMondayOnlySourceOwners:rows.filter(r=>ownerConfig.mondayOnlyFamilies?.includes(r.locationCodeSnapshot))
   .map(r=>({workId:r.workId,slotId:r.originSlotId||r.ownerSlotId})),
  otherDaysAndMorningFixed:true,physicalMinuteFeasibilityClaim:false,
  geographyScope:'EXISTING_SOURCE_ELIGIBILITY_AND_DECLARED_FAMILY_RESTRICTIONS_NO_NEW_RADIUS'};
 return {...body,descriptorDigest:digest(body)};
}
export function createRecurringPhaseProspectiveSource({source,ownerConfig,descriptor,selection}){
 const exact=createRecurringPhaseDescriptor({source,ownerConfig,dayOfWeek:descriptor.dayOfWeek,selectedWorkIds:descriptor.selectedWorkIds});
 requireFact(canonicalJson(exact)===canonicalJson(descriptor),'Descriptor/source/config drift.');
 requireFact(Array.isArray(selection)&&selection.length===descriptor.choices.length,'Exact selected ownership multiplicity required.');
 const map=new Map(selection.map(x=>[x.workId,x.slotId]));
 requireFact(map.size===selection.length,'Duplicate selected ownership.');
 const out=clone(source),v=version(out);
 for(const c of descriptor.choices){
  const o=c.owners.find(x=>x.slotId===map.get(c.workId));requireFact(o,'Ownership not in explicit ordinary candidate set.');
  const row=v.assignments.find(r=>r.workId===c.workId);
  row.workId=o.prospectiveWorkId;row.ownerSlotId=o.slotId;row.originSlotId=o.slotId;row.window=clone(o.window);
 }
 return out;
}

// Build the actual canonical hard model with no optimization/rank tiers.
// Exact selected owner choices make a complete integer witness; all canonical
// row equations are checked, not a relaxed family/capacity approximation.
export function evaluateRecurringPhaseCanonicalSource(source){
 const p=prepared(source);
 const objective={name:'selected_normal_hard_feasibility',family:'required_coverage',terms:[]};
 const m=buildStaticWeeklySchedulingModel(p,[],objective);
 if(m.error)fail(m.error.code||'recurring_phase_model_unavailable','Canonical hard model unavailable.');
 requireFact(m.general.size===0,'Unexpected rank machinery; no invented rank witness.');
 const values=new Map([...m.binary].map(n=>[n,0])),violations=[],uncoveredWorkIds=[];
 for(const w of p.work){
  const chosen=p.candidates.find(c=>c.item.key===w.key&&c.slot.id===w.originSlotId);
  if(chosen)values.set(m.x.get(`${w.key}\0${chosen.slot.id}`),1);
  else {values.set(m.uncovered.get(w.key),1);uncoveredWorkIds.push(w.workId);
   if(w.required)violations.push({code:'required_owner_unavailable',workId:w.workId});}
 }
 for(const g of m.routeGroups){
  values.set(g.base,1);
  const active=g.nodes.filter(n=>n.kind==='start'||n.kind==='end'||n.kind==='accepted'||values.get(n.active)===1)
   .sort((a,b)=>a.startMinute-b.startMinute||a.endMinute-b.endMinute||bytewiseCompare(a.id,b.id));
  // Positive fixed windows imply canonical chronological DAG path. Both
  // endpoints can share times with work; explicit kinds determine order.
  const start=g.nodes.find(n=>n.kind==='start'),end=g.nodes.find(n=>n.kind==='end');
  const middle=active.filter(n=>n!==start&&n!==end);
  const chain=[start,...middle,end];
  for(let i=1;i<chain.length;i++){
   const arc=g.arcs.find(a=>a.from===chain[i-1]&&a.to===chain[i]);
   if(arc)values.set(arc.name,1);else violations.push({code:'canonical_route_path_unavailable',daySlot:g.daySlot});
  }
 }
 for(const row of m.modelBasis.constraints.rows){
  requireFact(row.terms.every(([,name])=>values.has(name)),'Canonical hard row contains an unbound witness variable.');
  const total=row.terms.reduce((n,[coefficient,name])=>n+BigInt(coefficient)*BigInt(values.get(name)??0),0n),bound=BigInt(row.value);
  if(row.relation==='='?total!==bound:row.relation==='<='?total>bound:total<bound)
   violations.push({code:'canonical_hard_row_violation',constraint:row.name});
 }
 const witness=[...values].sort(([a],[b])=>bytewiseCompare(a,b));
 return {feasible:violations.length===0,sourceDigest:digest(source),canonicalInputDigest:p.inputDigest,
  modelBasisDigest:m.modelBasisDigest,hardConstraintDigest:m.modelBasis.constraints.digest,
  hardConstraintCount:m.modelBasis.constraints.count,witnessDigest:digest(witness),
  integerWitness:witness,uncoveredWorkIds,violations,solver:false,rankOrPriorityChange:false};
}
function loads(source,descriptor){
 const rows=version(source).assignments.filter(r=>r.dayOfWeek===descriptor.dayOfWeek&&r.window.start==='09:45');
 const byOwner=new Map(descriptor.owners.map(o=>[o.slotId,{slotId:o.slotId,doubledLoad:0,publicSites:0}]));
 for(const r of rows){
  const pkg=descriptor.packages.find(p=>p.family===r.locationCodeSnapshot&&p.primaryLocationId===r.locationId);
  requireFact(pkg,'Prospective package drift.');const load=byOwner.get(r.originSlotId||r.ownerSlotId);
  requireFact(load,'Unknown selected phase owner.');load.doubledLoad+=pkg.doubledWeight;
 }
 return [...byOwner.values()];
}
export function enumerateRecurringPhaseMinimum({source,ownerConfig,dayOfWeek,selectedWorkIds=[]}){
 const before=canonicalJson(source),descriptor=createRecurringPhaseDescriptor({source,ownerConfig,dayOfWeek,selectedWorkIds});
 const combinations=descriptor.choices.reduce((n,c)=>n*c.owners.length,1);
 if(combinations>RECURRING_PHASE_ENUMERATION_LIMIT)return {schema:RECURRING_PHASE_SCHEMA,status:'UNKNOWN_RESOURCE_BOUND',
  descriptor,combinations,enumerated:0,minimumDoubledSpread:null,halfUnitFeasible:null,published:false};
 const choices=[],receipts=[];let minimum=null,minimumWitness=null;
 function visit(i){
  if(i<descriptor.choices.length){const c=descriptor.choices[i];for(const o of c.owners){choices.push({workId:c.workId,slotId:o.slotId});visit(i+1);choices.pop();}return;}
  const prospective=createRecurringPhaseProspectiveSource({source,ownerConfig,descriptor,selection:choices});
  const proof=evaluateRecurringPhaseCanonicalSource(prospective),ls=loads(prospective,descriptor);
  const spread=Math.max(...ls.map(x=>x.doubledLoad))-Math.min(...ls.map(x=>x.doubledLoad));
  const publicSites=descriptor.owners.map(o=>version(prospective).assignments.filter(r=>r.dayOfWeek===dayOfWeek&&r.window.start==='09:45'
   &&r.originSlotId===o.slotId&&ownerConfig.publicRestroomFamilies?.includes(r.locationCodeSnapshot)).length);
  const publicSiteValid=Math.max(...publicSites)-Math.min(...publicSites)<=1;
  ls.forEach((load,i)=>{load.publicSites=publicSites[i];});
  // The existing normal generator also rejects an empty staffed phase.
  // This is a source-generator condition, not invented canonical LP authority.
  const nonemptyPhaseOwners=descriptor.owners.every(o=>version(prospective).assignments.some(r=>r.dayOfWeek===dayOfWeek
   &&r.window.start==='09:45'&&(r.originSlotId||r.ownerSlotId)===o.slotId));
  const selectedPackagesCovered=descriptor.choices.every(c=>{
   const selected=c.owners.find(o=>o.slotId===choices.find(s=>s.workId===c.workId)?.slotId);
   return selected&&!proof.uncoveredWorkIds.includes(selected.prospectiveWorkId);
  });
  const eligible=proof.feasible&&publicSiteValid&&nonemptyPhaseOwners&&selectedPackagesCovered;
  receipts.push({selection:clone(choices),sourceDigest:proof.sourceDigest,canonicalInputDigest:proof.canonicalInputDigest,
   modelBasisDigest:proof.modelBasisDigest,hardConstraintDigest:proof.hardConstraintDigest,
   hardConstraintCount:proof.hardConstraintCount,witnessDigest:proof.witnessDigest,
   canonicalFeasible:proof.feasible,publicSiteValid,nonemptyPhaseOwners,selectedPackagesCovered,
   uncoveredWorkIds:proof.uncoveredWorkIds,violations:proof.violations,doubledSpread:spread});
  if(eligible&&(minimum===null||spread<minimum)){minimum=spread;minimumWitness={selection:clone(choices),loads:ls,proof};}
 }
 visit(0);
 requireFact(canonicalJson(source)===before,'Source mutation forbidden.');
 const preserved=descriptor.scope==='PRESERVED_NOT_REOPTIMIZED';
 const body={schema:RECURRING_PHASE_SCHEMA,status:preserved?'PRESERVED_NOT_REOPTIMIZED':minimum===null?'INFEASIBLE_COMPLETE_SELECTED_SCOPE':'PROVEN_MINIMUM_COMPLETE_SELECTED_SCOPE',
  descriptor,combinations,enumerated:receipts.length,receipts,
  minimumDoubledSpread:preserved?null:minimum,halfUnitFeasible:preserved||minimum===null?null:minimum<=1,
  preservedCanonicalFeasible:preserved?receipts[0]?.canonicalFeasible:null,minimumWitness:preserved?null:minimumWitness,
  minimumClaimScope:'EXACT_SELECTED_PACKAGES_ONLY_OTHER_MORNING_AND_DAYS_FIXED_NOT_GLOBAL_REDESIGN',
  physicalMinuteFeasibilityClaim:false,sourceMutated:false,published:false,solver:false,
  costOrTieSelectionPerformed:false};
 return {...body,proofDigest:digest(body)};
}
export function assertRecurringPhaseMinimum({proof,...input}){
 const actual=enumerateRecurringPhaseMinimum(input);
 requireFact(canonicalJson(actual)===canonicalJson(proof),'Phase proof differs from full canonical recomputation.');
 return true;
}
