// Normal selected-phase evidence only. No publication, generic owner unlock,
// solver, dated priority change, physical-time claim or caller-supplied witness.
import {contentDigest,canonicalJson,bytewiseCompare} from './static-weekly-schedule-model.js';
import {prepareStaticWeeklySchedulingProblem,buildStaticWeeklySchedulingModel} from './static-weekly-schedule-program.js';
import {getScheduleComponentWeightLedger,COMPONENT_WEIGHT_UNIT} from './schedule-component-weight-authority.js';
import {normalGeographyRestrictionApplies,validateOwnerEligibilityConfig} from './static-weekly-owner-eligibility.js';
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
function descriptorWithPreparation({source,ownerConfig,dayOfWeek,selectedWorkIds=[]},prepareDescriptorSource=prepared){
 requireFact(source&&ownerConfig&&Array.isArray(selectedWorkIds),'Explicit source/config/selection required.');
 if(ownerConfig.schema==='custodial.owner-corrected-recurring-schedule.v2')validateOwnerEligibilityConfig(ownerConfig);
 requireFact(Number.isInteger(dayOfWeek)&&dayOfWeek>=0&&dayOfWeek<=6,'Explicit weekday required.');
 requireFact(Array.isArray(source.exceptions)&&source.exceptions.length===0,'Dated overlays are not normal replacement scope.');
 const v=version(source);requireFact(v&&Array.isArray(v.assignments),'One canonical source required.');
 requireFact(new Set(selectedWorkIds).size===selectedWorkIds.length,'Duplicate selected work identity.');
 const p=prepareDescriptorSource(source);
 const cfg=new Map(Object.entries(ownerConfig.slots||{}).map(([key,s])=>[s.slotId,{...s,key}]));
 const owners=[...p.availabilityByDaySlot.values()].filter(x=>x.availability.dayOfWeek===dayOfWeek&&!x.slot.contractorCapacity)
  .map(x=>{const c=cfg.get(x.slot.id);requireFact(c&&c.vacancy!==true&&c.workDays.includes(dayOfWeek),'Current ordinary owner/config mismatch.');
   requireFact(canonicalJson(c.shift)===canonicalJson([x.availability.shift.start,x.availability.shift.end]),'Fixed shift/config mismatch.');
   requireFact(canonicalJson(c.lunchByDay?.[String(dayOfWeek)]||c.lunch)===canonicalJson([x.availability.lunch.start,x.availability.lunch.end]),'Fixed lunch/config mismatch.');
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
  const named=(v.shiftEndContinuityPolicy?.namedHandoffs||[]).filter(h=>h.dayOfWeek===dayOfWeek
   &&h.locationCode===r.family&&h.at===original.window.end&&h.fromSlotId===(original.originSlotId||original.ownerSlotId));
  return !(ownerConfig.mondayOnlyFamilies?.includes(r.family)&&(original.originSlotId||original.ownerSlotId)!==o.slotId)
   &&named.every(h=>h.fromSlotId===o.slotId&&h.at===o.shift.end)
   &&!c.hardForbiddenFamilies?.includes(r.family)
   &&(!normalGeographyRestrictionApplies(c)||c.normalAssignmentFamilies.includes(r.family))&&o.shift.end>'09:45';
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
  namedHandoffPolicyDigest:v.shiftEndContinuityPolicy?.policyDigest||null,
  directNamedHandoffOwnerBindings:rows.flatMap(r=>(v.shiftEndContinuityPolicy?.namedHandoffs||[])
   .filter(h=>h.dayOfWeek===dayOfWeek&&h.locationCode===r.locationCodeSnapshot&&h.at===r.window.end
    &&h.fromSlotId===(r.originSlotId||r.ownerSlotId)).map(h=>({workId:r.workId,...h}))),
  otherDaysAndMorningFixed:true,physicalMinuteFeasibilityClaim:false,
  geographyScope:'EXISTING_SOURCE_ELIGIBILITY_AND_DECLARED_FAMILY_RESTRICTIONS_NO_NEW_RADIUS'};
 return {...body,descriptorDigest:digest(body)};
}
export function createRecurringPhaseDescriptor(input){return descriptorWithPreparation(input);}
function prospectiveWithDescriptorVerification({source,ownerConfig,descriptor,selection},verifyDescriptor=createRecurringPhaseDescriptor){
 const exact=verifyDescriptor({source,ownerConfig,dayOfWeek:descriptor.dayOfWeek,selectedWorkIds:descriptor.selectedWorkIds});
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
export function createRecurringPhaseProspectiveSource(input){return prospectiveWithDescriptorVerification(input);}

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

// A relaxation is only a lower bound. It becomes a canonical minimum/cost/tie
// proof when its EXACT terminal optima are attained by the full canonical
// source witness. Otherwise this path returns UNKNOWN, never a relaxed PASS.
const scalarExpression=terms=>terms.length?terms.map(([n,v])=>`${n<0?'-':'+'} ${Math.abs(n)} ${v}`).join(' ').replace(/^\+ /,''):'0';
const codeUnitCompare=(a,b)=>a<b?-1:a>b?1:0;
export const RECURRING_IDENTITY_RADIX_CHUNK_SIZE=3;
export function createRecurringIdentityRadixLayout({ownerRadix,orderedWorkIds,chunkSize=RECURRING_IDENTITY_RADIX_CHUNK_SIZE}){
 requireFact(Number.isSafeInteger(ownerRadix)&&ownerRadix>=1&&Number.isSafeInteger(chunkSize)&&chunkSize>=1&&chunkSize<=6,
  'Explicit safe positive identity radix/chunk required.');
 requireFact(Array.isArray(orderedWorkIds)&&orderedWorkIds.every(v=>typeof v==='string'&&v.length>0)
  &&new Set(orderedWorkIds).size===orderedWorkIds.length,'Explicit unique ordered work identities required.');
 const chunks=[];
 for(let offset=0;offset<orderedWorkIds.length;offset+=chunkSize){const ids=orderedWorkIds.slice(offset,offset+chunkSize),
  multipliers=ids.map((_,i)=>BigInt(ownerRadix)**BigInt(ids.length-i-1));
  requireFact(multipliers.every(n=>n<=BigInt(Number.MAX_SAFE_INTEGER))
   &&BigInt(ownerRadix)**BigInt(ids.length)-1n<=BigInt(Number.MAX_SAFE_INTEGER),'Identity radix objective overflow.');
  chunks.push({offset,orderedWorkIds:ids,multipliers:multipliers.map(Number)});
 }
 const body={schema:'custodial.recurring-identity-radix-layout.v1',ownerRadix,orderedWorkIds:clone(orderedWorkIds),chunkSize,chunks,
  order:'COMPLETE_EXISTING_CODE_UNIT_LEXVECTOR',prioritiesChanged:false};return {...body,layoutDigest:digest(body)};
}
export function assertRecurringIdentityRadixEncoding({layout,ownerIndexes,expectedOrderedWorkIds}){
 requireFact(canonicalJson(layout.orderedWorkIds)===canonicalJson(expectedOrderedWorkIds),'Identity omission/reordering changed.');
 const exact=createRecurringIdentityRadixLayout({ownerRadix:layout.ownerRadix,orderedWorkIds:expectedOrderedWorkIds,chunkSize:layout.chunkSize});
 requireFact(canonicalJson(layout)===canonicalJson(exact)&&Array.isArray(ownerIndexes)&&ownerIndexes.length===expectedOrderedWorkIds.length
  &&ownerIndexes.every(n=>Number.isSafeInteger(n)&&n>=0&&n<layout.ownerRadix),'Identity radix layout/vector changed.');
 const chunkObjectives=layout.chunks.map(c=>c.multipliers.reduce((n,m,i)=>n+BigInt(m)*BigInt(ownerIndexes[c.offset+i]),0n));
 let reconstructed=0n;for(const [i,c]of layout.chunks.entries())reconstructed=reconstructed*BigInt(layout.ownerRadix)**BigInt(c.orderedWorkIds.length)+chunkObjectives[i];
 const original=ownerIndexes.reduce((n,i)=>n*BigInt(layout.ownerRadix)+BigInt(i),0n);
 requireFact(reconstructed===original,'Identity radix exact reconstruction changed.');
 return {chunkObjectives:chunkObjectives.map(Number),completeLexvectorInteger:String(original)};
}
export function assertRecurringPhaseIdentityEncoding({proof,ownerConfig}){
 const raw=proof.lowerBoundEvidence||proof,d=raw.descriptor,keys=Object.keys(ownerConfig.slots).sort(),
  keyBySlot=new Map(keys.map(k=>[ownerConfig.slots[k].slotId,k])),packages=new Map(d.packages.map(p=>[p.workId,p])),
  owners=d.owners.slice().sort((a,b)=>codeUnitCompare(keyBySlot.get(a.slotId),keyBySlot.get(b.slotId))),
  choices=d.choices.slice().sort((a,b)=>codeUnitCompare(packages.get(a.workId).family,packages.get(b.workId).family));
 requireFact(d.configDigest===digest(ownerConfig)&&owners.every(o=>keyBySlot.has(o.slotId)),'Identity current owner/config binding changed.');
 const layout=createRecurringIdentityRadixLayout({ownerRadix:owners.length,orderedWorkIds:choices.map(c=>c.workId)}),
  selection=new Map(raw.selectedOwnership.map(s=>[s.workId,s.slotId]));
 requireFact(selection.size===raw.selectedOwnership.length&&selection.size===choices.length,'Identity ownership multiplicity changed.');
 const vector=choices.map(c=>{const slotId=selection.get(c.workId);requireFact(c.owners.some(o=>o.slotId===slotId),'Identity selection not eligible.');
  return owners.findIndex(o=>o.slotId===slotId);});
 const encoding=assertRecurringIdentityRadixEncoding({layout,ownerIndexes:vector,expectedOrderedWorkIds:choices.map(c=>c.workId)});
 requireFact(canonicalJson(raw.identityLayout)===canonicalJson(layout)&&canonicalJson(raw.identityEncoding)===canonicalJson(encoding)
  &&canonicalJson(raw.stableIdentity)===canonicalJson(vector)&&canonicalJson(proof.stableIdentity)===canonicalJson(vector),'Identity layout/vector/encoding changed.');
 const identityTiers=raw.tiers.filter(t=>t.name.startsWith('inherited_identity_'));
 requireFact(identityTiers.length===layout.chunks.length,'Missing/extra identity tier.');const originalTerms=[];
 for(const [chunkIndex,chunk]of layout.chunks.entries()){
  const terms=choices.slice(chunk.offset,chunk.offset+chunk.orderedWorkIds.length).flatMap((c,i)=>owners.flatMap((o,j)=>
   j&&c.owners.some(x=>x.slotId===o.slotId)?[[j*chunk.multipliers[i],`phase_x_${chunk.offset+i}_${j}`]]:[]));
  const tier=identityTiers[chunkIndex],values=new Map(tier.integerWitness);
  requireFact(tier.name===`inherited_identity_${chunk.offset}`&&tier.model.name===tier.name&&tier.model.descriptorDigest===d.descriptorDigest
   &&tier.modelDigest===digest(tier.model)&&canonicalJson(tier.model.terms)===canonicalJson(terms),'Identity tier model/order/coefficients changed.');
  const objective=exactPreferenceObjective(terms,values);
  requireFact(objective===encoding.chunkObjectives[chunkIndex]&&tier.objectiveValue===objective,'Identity raw objective/witness mismatch.');
  for(const [i,prior]of originalTerms.entries())requireFact(tier.model.rows.some(r=>r.name===`phase_fixed_${i+3}`&&r.relation==='='
   &&r.value===encoding.chunkObjectives[i]&&canonicalJson(r.terms)===canonicalJson(prior)),'Prior exact identity equality changed.');
  originalTerms.push(terms);
 }
 return {layout,encoding};
}
// Positive primitive scaling is algebra only: original100/4/2 units and
// subsequent fixed equalities remain unchanged. Never round a terminal bound.
export function createRecurringPreferencePrimitiveObjective(terms,binary){
 requireFact(Array.isArray(terms)&&Array.isArray(binary)&&new Set(binary).size===binary.length,'Explicit unique binary objective domain required.');
 requireFact(binary.every(v=>typeof v==='string'&&v.length>0),'Explicit binary variable names required.');
 const domain=new Set(binary),seen=new Set();let divisor=0n;
 const gcd=(a,b)=>{while(b){const r=a%b;a=b;b=r;}return a;};
 for(const t of terms){requireFact(Array.isArray(t)&&t.length===2&&Number.isSafeInteger(t[0])&&t[0]>0
  &&typeof t[1]==='string'&&domain.has(t[1])&&!seen.has(t[1]),'Preference coefficient/identity must be unique positive safe integer binary terms.');
  seen.add(t[1]);divisor=gcd(divisor,BigInt(t[0]));}
 if(divisor===0n)divisor=1n;
 const primitiveTerms=terms.map(([n,v])=>[Number(BigInt(n)/divisor),v]);
 const body={schema:'custodial.recurring-preference-primitive-objective.v1',originalUnit:'INHERITED_PREFERENCE_100_4_2_POINTS',
  primitiveUnit:'POSITIVE_INTEGER_GCD_SCALED_PREFERENCE_POINTS',positiveDivisor:Number(divisor),
  originalTerms:clone(terms),primitiveTerms,originalTermsDigest:digest(terms),primitiveTermsDigest:digest(primitiveTerms),
  sameMinimizers:true,prioritiesChanged:false,fixedEqualityUsesOriginalTerms:true};
 return {...body,normalizationDigest:digest(body)};
}
function exactPreferenceObjective(terms,values){
 const n=terms.reduce((sum,[c,v])=>{requireFact(values.has(v)&&[0,1].includes(values.get(v)),'Preference binary witness missing/nonbinary.');
  return sum+BigInt(c)*BigInt(values.get(v));},0n);
 requireFact(n>=0n&&n<=BigInt(Number.MAX_SAFE_INTEGER),'Preference objective reconstruction overflow.');return Number(n);
}
export function assertRecurringPreferencePrimitiveWitness({terms,binary,normalization,integerWitness,primitiveObjectiveValue,originalScaleObjectiveValue}){
 const expected=createRecurringPreferencePrimitiveObjective(terms,binary);
 requireFact(canonicalJson(normalization)===canonicalJson(expected),'Primitive transformation changed.');
 requireFact(Array.isArray(integerWitness)&&integerWitness.every(t=>Array.isArray(t)&&t.length===2),'Explicit primitive witness required.');
 const values=new Map(integerWitness);
 requireFact(values.size===integerWitness.length&&[...values].every(([v,n])=>Number.isSafeInteger(n)
  &&(binary.includes(v)?[0,1].includes(n):v==='phase_spread'&&n>=0))
  &&binary.every(v=>values.has(v)),'Primitive witness domain/integrality changed.');
 const primitive=exactPreferenceObjective(expected.primitiveTerms,values),original=exactPreferenceObjective(terms,values);
 requireFact(BigInt(primitive)*BigInt(expected.positiveDivisor)===BigInt(original)
  &&primitiveObjectiveValue===primitive&&originalScaleObjectiveValue===original,'Primitive/original objective reconstruction changed.');
 return {normalization:expected,primitiveObjectiveValue:primitive,originalScaleObjectiveValue:original};
}
function inheritedPreferenceTerms({descriptor,source,ownerConfig,fullOwners}){
 const keys=Object.keys(ownerConfig.slots).sort(),keyBySlot=new Map(keys.map(k=>[ownerConfig.slots[k].slotId,k]));
 const owners=descriptor.owners.slice().sort((a,b)=>codeUnitCompare(keyBySlot.get(a.slotId),keyBySlot.get(b.slotId))),
  packages=new Map(descriptor.packages.map(p=>[p.workId,p])),
  choices=descriptor.choices.slice().sort((a,b)=>codeUnitCompare(packages.get(a.workId).family,packages.get(b.workId).family)),terms=[],binary=[];
 for(const [i,c]of choices.entries())for(const [j,o]of owners.entries())if(c.owners.some(x=>x.slotId===o.slotId)){
  const pkg=packages.get(c.workId),rows=version(source).assignments.filter(r=>r.workId===c.workId);
  requireFact(rows.length===1&&rows[0].dayOfWeek===descriptor.dayOfWeek&&canonicalJson(packageFact(rows[0],ownerConfig))===canonicalJson(pkg),'Preference original source package drift.');
  const key=keyBySlot.get(o.slotId),guided=fullOwners?.[String(descriptor.dayOfWeek)]?.equalized?.[pkg.family];
  requireFact(typeof guided==='string'&&keys.includes(guided),'Exact existing full-position guidance missing.');
  const cost=((rows[0].originSlotId||rows[0].ownerSlotId)!==o.slotId?100:0)+(guided!==key?4:0)
   +(ownerConfig.slots[key].normalAssignmentFamilies?.includes(pkg.family)?0:2);
  const name=`phase_x_${i}_${j}`;binary.push(name);if(cost)terms.push([cost,name]);
 }return {terms,binary};
}
function assertPreferenceNormalization({proof,source,ownerConfig,fullOwners},lookupDescriptor=null){
 const rawProof=proof.lowerBoundEvidence||proof,d=rawProof.descriptor,{descriptorDigest,...descriptorBody}=d;
 const semantic=x=>Object.fromEntries(Object.entries(x).filter(([k])=>!['sourceDigest','descriptorDigest','fixedSourceRowsDigest'].includes(k)));
 requireFact(digest(descriptorBody)===descriptorDigest&&d.configDigest===digest(ownerConfig)
  &&rawProof.fullOwnersDigest===digest(fullOwners)&&canonicalJson(semantic(d))===canonicalJson(semantic(proof.descriptor))
  &&proof.preferenceCost===rawProof.preferenceCost,'Preference descriptor/config/guidance binding changed.');
 // Recover the exact raw invocation from its complete witness candidate plus
 // the ORIGINAL accepted-day rows. This also checks choices/owners, rather
 // than accepting a rehashed caller descriptor as its own authority.
 requireFact(rawProof.candidateSource&&rawProof.candidateSourceDigest===digest(rawProof.candidateSource),'Preference raw witness source changed.');
 const invocation=clone(rawProof.candidateSource),referenceRows=version(source).assignments,
  originalByFamily=new Map(d.selectedWorkIds.map(id=>{const r=referenceRows.find(r=>r.workId===id);requireFact(r,'Preference original work identity missing.');return[r.locationCodeSnapshot,r];}));
 version(invocation).assignments=version(invocation).assignments.map(r=>r.dayOfWeek===d.dayOfWeek&&r.window.start==='09:45'&&originalByFamily.has(r.locationCodeSnapshot)
  ?clone(originalByFamily.get(r.locationCodeSnapshot)):r);
 const actualKey=digest({source:invocation,ownerConfig,selectedWorkIds:d.selectedWorkIds}),sealed=lookupDescriptor?.(rawProof,actualKey);
 requireFact(canonicalJson(sealed||createRecurringPhaseDescriptor({source:invocation,ownerConfig,dayOfWeek:d.dayOfWeek,selectedWorkIds:d.selectedWorkIds}))===canonicalJson(d),
  'Preference descriptor differs from exact original-day/fixed-other-day recomputation.');
 const tier=rawProof.tiers?.find(t=>t.name==='inherited_preference');requireFact(tier,'Preference tier missing.');
 const {terms,binary}=inheritedPreferenceTerms({descriptor:d,source,ownerConfig,fullOwners});
 requireFact(canonicalJson(tier.model.binary)===canonicalJson(binary),'Preference binary domain drift.');
 const reconstructed=assertRecurringPreferencePrimitiveWitness({terms,binary,normalization:tier.objectiveNormalization,
  integerWitness:tier.integerWitness,primitiveObjectiveValue:tier.objectiveValue,originalScaleObjectiveValue:tier.originalScaleObjectiveValue}),
  expected=reconstructed.normalization,primitive=reconstructed.primitiveObjectiveValue,original=reconstructed.originalScaleObjectiveValue;
 requireFact(canonicalJson(tier.objectiveNormalization)===canonicalJson(expected)
  &&canonicalJson(tier.model.objectiveNormalization)===canonicalJson(expected)
  &&canonicalJson(tier.model.terms)===canonicalJson(expected.primitiveTerms)
  &&tier.model.descriptorDigest===descriptorDigest&&tier.modelDigest===digest(tier.model),'Preference primitive model/receipt drift.');
 requireFact(proof.preferenceCost===original,'Preference primitive/original objective mismatch.');
 const next=rawProof.tiers[rawProof.tiers.indexOf(tier)+1];
 requireFact(next?.model.rows.some(r=>r.name==='phase_fixed_2'&&r.relation==='='&&r.value===original
  &&canonicalJson(r.terms)===canonicalJson(terms)),'Original-scale preference fixed equality missing.');
 return {normalization:expected,primitiveObjectiveValue:primitive,originalScaleObjectiveValue:original,
  descriptorValidation:{method:sealed?'INVOCATION_LOCAL_PRIVATE_ORIGINAL_PROOF_SOURCE_HASH':'FULL_SOURCE_RECOMPUTATION',actualSourceConfigSelectionDigest:actualKey}};
}
export function assertRecurringPhasePreferenceNormalization(input){return assertPreferenceNormalization(input);}
function deepFreezeFact(x){if(x&&typeof x==='object'){for(const v of Object.values(x))deepFreezeFact(v);Object.freeze(x);}return x;}
// Facts belong to this explicit closure invocation ONLY. The private proof
// identity cannot be serialized or supplied by a caller, and only a freshly
// solved/checkPhaseTerminal/full-canonical result can populate its descriptor.
// No solver optimum, terminal evidence or canonical witness is cached.
export function createRecurringPhaseEvidenceInvocation(){
 const descriptors=new WeakMap(),originalDescriptors=new WeakMap(),preparedFacts=new Map();
 const prepareDescriptorSource=source=>{
  const key=digest(source);let fact=preparedFacts.get(key);
  if(!fact){const p=prepared(source);fact=deepFreezeFact({
   availability:[...p.availabilityByDaySlot].map(([id,x])=>[id,{slot:{id:x.slot.id,contractorCapacity:x.slot.contractorCapacity},
    availability:{dayOfWeek:x.availability.dayOfWeek,shift:clone(x.availability.shift),lunch:clone(x.availability.lunch)}}]),
   incumbencies:[...p.incumbencyByDaySlot].map(([id,x])=>[id,{personId:x.personId,displayName:x.displayName}]),
  });preparedFacts.set(key,fact);}
  return {availabilityByDaySlot:new Map(fact.availability),incumbencyByDaySlot:new Map(fact.incumbencies)};
 };
 const createDescriptor=input=>{
  const descriptor=descriptorWithPreparation(input,prepareDescriptorSource),key=digest({source:input.source,ownerConfig:input.ownerConfig,
   selectedWorkIds:[...input.selectedWorkIds].sort(bytewiseCompare)});
  originalDescriptors.set(descriptor,deepFreezeFact({key,descriptor:clone(descriptor)}));return descriptor;
 };
 const createProspective=input=>prospectiveWithDescriptorVerification(input,facts=>{
  const key=digest({source:facts.source,ownerConfig:facts.ownerConfig,selectedWorkIds:[...facts.selectedWorkIds].sort(bytewiseCompare)}),
   sealed=originalDescriptors.get(input.descriptor);
  return sealed?.key===key?sealed.descriptor:createRecurringPhaseDescriptor(facts);
 });
 return Object.freeze({
  solve(input){const proof=solvePhaseMinimum(input,createDescriptor,createProspective);
   if(proof.status==='PROVEN_CANONICAL_PHASE_MINIMUM'){
    requireFact(proof.descriptor.sourceDigest===digest(input.source)&&proof.descriptor.configDigest===digest(input.ownerConfig),'Invocation source/config mutated during solve.');
    const key=digest({source:input.source,ownerConfig:input.ownerConfig,selectedWorkIds:[...input.selectedWorkIds].sort(bytewiseCompare)});
    descriptors.set(proof,deepFreezeFact({key,descriptor:clone(proof.descriptor)}));
   }return proof;
  },
  assertPreference(input){return assertPreferenceNormalization(input,(proof,key)=>{const sealed=descriptors.get(proof);return sealed?.key===key?sealed.descriptor:null;});},
 });
}
const pinnedPhaseSolver={package:'highs@1.15.2',packageJsonSha256:'21e76a89d13d636f56d5cdda7dde590acd48d6fb683c97a327c10d43e74d9c56',
 wrapperJavaScriptSha256:'6d5be3ed3cbd1ce1924cc66cc9302b50753dabdb8c6e0e815845dce7f1890033',
 wasmSha256:'7e6432b2b26f4fab9f6d9bac55da43307c7a4b1b071cb204cb4d23e1901bc4d0',embeddedRuntimeBanner:'HiGHS 1.15.1 (git hash: 04024d7)'};
function exactDecimalEquals(raw,expected){
 const m=/^([+-]?)(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(String(raw).trim());if(!m)return false;
 const digits=m[2]+(m[3]||'');if(digits.length>128)return false;
 const power=Number(m[4]||0)-(m[3]?.length||0);if(!Number.isSafeInteger(power)||Math.abs(power)>128)return false;
 const coefficient=BigInt((m[1]==='-'?'-':'')+digits);
 return power>=0?coefficient*10n**BigInt(power)===BigInt(expected):coefficient===BigInt(expected)*10n**BigInt(-power);
}
function exactIntegerViolationWithinInheritedTolerance(raw){
 const m=/^([+-]?)(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(String(raw).trim());if(!m)return false;
 const digits=m[2]+(m[3]||''),power=Number(m[4]||0)-(m[3]?.length||0);if(digits.length>128||!Number.isSafeInteger(power)||Math.abs(power)>128)return false;
 const coefficient=BigInt(digits);return power+9>=0?coefficient*10n**BigInt(power+9)<=1n:coefficient<=10n**BigInt(-power-9);
}
function checkPhaseTerminal(solved,expected,attestation){
 const e=solved?.evidence,r=e?.terminalReport;
 requireFact(Object.entries(pinnedPhaseSolver).every(([key,value])=>solved?.identity?.[key]===value),'Pinned phase solver identity unavailable.');
 requireFact(canonicalJson(solved.modelAttestation)===canonicalJson(attestation),'Phase solver/model attestation mismatch.');
 requireFact(solved.result?.Status==='Optimal'&&e?.objectStatus==='Optimal'&&e?.reportStatus==='Optimal'
  &&e.parserOk===true&&!e.outputTruncated&&e.reportSolutionStatus==='feasible','Exact phase terminal optimum unavailable.');
 requireFact(solved.options?.threads===1&&solved.options.mip_rel_gap===0&&solved.options.mip_abs_gap===0
  &&solved.options.output_flag===true&&solved.options.mip_feasibility_tolerance===1e-9,'Phase solver evidence options changed.');
 requireFact(r?.representation==='highs-terminal-report-records-json-utf8-v1'&&r.parserVersion==='highs-terminal-report-v1'
  &&Array.isArray(r.records)&&r.records.every(x=>['print','printErr'].includes(x.channel)&&typeof x.text==='string'),'Phase terminal representation unavailable.');
 const representation=JSON.stringify({representation:r.representation,records:r.records.map(({channel,text})=>({channel,text}))});
 requireFact(r.utf8Sha256===contentDigestBytes(representation)&&r.utf8Base64===Buffer.from(representation).toString('base64'),'Phase terminal bytes changed.');
 const raw=JSON.stringify({schema:'memphis-zoo.static-weekly-raw-solver-receipt.v1',options:solved.options,terminalReport:r});
 requireFact(e.rawReceiptDigest===contentDigestBytes(raw),'Phase raw solver receipt changed.');
 requireFact(r.records[0]?.text==='Solving report'&&r.records.at(-1)?.text==='Writing the solution to solution.txt'
  &&r.records.filter(x=>x.text==='Solving report').length===1&&r.records.filter(x=>x.text==='Writing the solution to solution.txt').length===1,'Phase terminal boundaries changed.');
 const fields=[['status',/^\s*Status\s{2,}(.+)$/],['primal',/^\s*Primal bound\s{2,}(.+)$/],['dual',/^\s*Dual bound\s{2,}(.+)$/],
  ['gap',/^\s*Gap\s{2,}(.+)$/],['solution',/^\s*Solution status\s{2,}(.+)$/],['objective',/^\s+(.+?)\s+\(objective\)\s*$/],
  ['bound',/^\s+(.+?)\s+\(bound viol\.\)\s*$/],['integer',/^\s+(.+?)\s+\(int\. viol\.\)\s*$/],['row',/^\s+(.+?)\s+\(row viol\.\)\s*$/]];
 let last=-1;const actual={};
 for(const [key,pattern]of fields){const matches=r.records.flatMap((x,i)=>{const m=pattern.exec(x.text);return m?[{i,value:m[1]}]:[];});
  requireFact(matches.length===1&&matches[0].i>last,'Missing/duplicate/reordered phase terminal field.');last=matches[0].i;actual[key]=matches[0].value;}
 requireFact(actual.status==='Optimal'&&actual.solution==='feasible'&&actual.gap.trim().endsWith('%'),'Phase terminal status/gap invalid.');
 for(const key of ['primal','dual','objective'])requireFact(exactDecimalEquals(actual[key],expected),'Phase terminal bound/objective mismatch.');
 for(const key of ['bound','row'])requireFact(exactDecimalEquals(actual[key],0),'Phase terminal bound/row violation is nonzero.');
 // Exactly the existing audited1e-9 integer tolerance, followed by complete
 // rounded integer row verification above; never a looser feasibility test.
 requireFact(exactIntegerViolationWithinInheritedTolerance(actual.integer),'Phase terminal integer violation exceeds inherited tolerance.');
 const objectObjective=solved.result.ObjectiveValue;
 // The same existing compiler/verifier redundant object-scalar tolerance.
 // Terminal bounds/objective remain EXACT and integer witness rows checked.
 requireFact(exactDecimalEquals(actual.gap.trim().slice(0,-1),0)&&typeof objectObjective==='number'&&Number.isFinite(objectObjective)
  &&Math.round(objectObjective)===expected&&Math.abs(objectObjective-expected)<=1e-9
  &&e.objectPrimalObjective===objectObjective,'Phase terminal gap/object mismatch.');
}
// Existing portable hash implementation; raw receipts hash BYTES, not JSON.
import {sha256Hex as contentDigestBytes} from './static-weekly-schedule-model.js';

function solvePhaseMinimum({source,ownerConfig,fullOwners,dayOfWeek,selectedWorkIds=[],solver},createDescriptor=createRecurringPhaseDescriptor,createProspective=createRecurringPhaseProspectiveSource){
 const descriptor=createDescriptor({source,ownerConfig,dayOfWeek,selectedWorkIds});
 const basis={schema:RECURRING_PHASE_SCHEMA,descriptor,fullOwnersDigest:digest(fullOwners),published:false,sourceMutated:false,
  proofMethod:'RELAXED_LOWER_BOUND_PLUS_MATCHING_COMPLETE_CANONICAL_WITNESS',physicalMinuteFeasibilityClaim:false};
 if(!selectedWorkIds.length)return {...basis,status:'PRESERVED_NOT_REOPTIMIZED',minimumDoubledSpread:null,halfUnitFeasible:null,candidateSource:null};
 const tiers=[],started=performance.now(),budgetMs=30_000;let lastSolverAttempt=null;
 const unknown=reason=>({...basis,status:'UNKNOWN_CANONICAL_PHASE',reason,tiers,lastSolverAttempt,minimumDoubledSpread:null,halfUnitFeasible:null,candidateSource:null});
 try{
  requireFact(solver&&typeof solver.solve==='function','Owned pinned phase solver required.');
  const rows=version(source).assignments,keys=Object.keys(ownerConfig.slots).sort(),keyBySlot=new Map(keys.map(k=>[ownerConfig.slots[k].slotId,k]));
  const owners=descriptor.owners.slice().sort((a,b)=>codeUnitCompare(keyBySlot.get(a.slotId),keyBySlot.get(b.slotId)));
  const packages=new Map(descriptor.packages.map(p=>[p.workId,p])),choices=descriptor.choices.slice().sort((a,b)=>codeUnitCompare(packages.get(a.workId).family,packages.get(b.workId).family));
  const options=[],binary=[],bounds=[],constraints=[],bindings=[];
  for(const [i,c]of choices.entries())for(const [j,o]of owners.entries())if(c.owners.some(x=>x.slotId===o.slotId)){
   const pkg=packages.get(c.workId),original=rows.find(r=>r.workId===c.workId),key=keyBySlot.get(o.slotId),guided=fullOwners?.[String(dayOfWeek)]?.equalized?.[pkg.family];
   requireFact(typeof guided==='string'&&keys.includes(guided),'Exact existing full-position guidance missing.');
   const name=`phase_x_${i}_${j}`,cost=((original.originSlotId||original.ownerSlotId)!==o.slotId?100:0)+(guided!==key?4:0)
    +(ownerConfig.slots[key].normalAssignmentFamilies?.includes(pkg.family)?0:2);
   options.push({name,workId:c.workId,slotId:o.slotId,ownerIndex:j,family:pkg.family,weight:pkg.doubledWeight,cost});binary.push(name);
  }
  for(const [i,c]of choices.entries())constraints.push({name:`phase_cover_${i}`,terms:options.filter(o=>o.workId===c.workId).map(o=>[1,o.name]),relation:'=',value:1});
  const fixed=descriptor.packages.filter(p=>!selectedWorkIds.includes(p.workId));
  const loadFixed=o=>fixed.filter(p=>{const r=rows.find(x=>x.workId===p.workId);return(r.originSlotId||r.ownerSlotId)===o.slotId;}).reduce((n,p)=>n+p.doubledWeight,0);
  const siteFixed=o=>fixed.filter(p=>ownerConfig.publicRestroomFamilies?.includes(p.family)&&rows.find(x=>x.workId===p.workId)?.originSlotId===o.slotId).length;
  const countFixed=o=>fixed.filter(p=>{const r=rows.find(x=>x.workId===p.workId);return(r.originSlotId||r.ownerSlotId)===o.slotId;}).length;
  const load=o=>options.filter(x=>x.slotId===o.slotId).map(x=>[x.weight,x.name]);
  const sites=o=>options.filter(x=>x.slotId===o.slotId&&ownerConfig.publicRestroomFamilies?.includes(x.family)).map(x=>[1,x.name]);
  for(const [i,o]of owners.entries())constraints.push({name:`phase_nonempty_${i}`,terms:options.filter(x=>x.slotId===o.slotId).map(x=>[1,x.name]),relation:'>=',value:1-countFixed(o)});
  for(const [i,a]of owners.entries())for(const [j,b]of owners.entries())if(i!==j){
   constraints.push({name:`phase_spread_${i}_${j}`,terms:[...load(a),...load(b).map(([n,v])=>[-n,v]),[-1,'phase_spread']],relation:'<=',value:loadFixed(b)-loadFixed(a)});
   constraints.push({name:`phase_sites_${i}_${j}`,terms:[...sites(a),...sites(b).map(([n,v])=>[-n,v])],relation:'<=',value:1+siteFixed(b)-siteFixed(a)});
  }
  const maximum=descriptor.packages.reduce((n,p)=>n+p.doubledWeight,0);requireFact(Number.isSafeInteger(maximum),'Phase coefficient range unsupported.');
  bounds.push(`0 <= phase_spread <= ${maximum}`);
  const run=(name,terms)=>{
   const remaining=budgetMs-(performance.now()-started);requireFact(remaining>0,'Phase total time bound exhausted.');
   const normalization=name==='inherited_preference'?createRecurringPreferencePrimitiveObjective(terms,binary):null,
    actualTerms=normalization?.primitiveTerms||terms;
   const body={descriptorDigest:descriptor.descriptorDigest,name,terms:actualTerms,rows:[...constraints,...bindings],binary,general:['phase_spread'],bounds,
    ...(normalization?{objectiveNormalization:normalization}:{})};
   const attestation={schema:'custodial.recurring-phase-lower-bound-model.v1',modelDigest:digest(body),descriptorDigest:descriptor.descriptorDigest};
   const lp=`Minimize\n phase_objective: ${scalarExpression(actualTerms)}\nSubject To\n${body.rows.map(r=>` ${r.name}: ${scalarExpression(r.terms)} ${r.relation} ${r.value}`).join('\n')}\nBounds\n ${bounds.join('\n ')}\nGeneral\n phase_spread\nBinary\n ${binary.join(' ')}\nEnd\n`;
   const solved=solver.solve(lp,{timeLimitSeconds:remaining/1000,modelAttestation:attestation});
   lastSolverAttempt={name,model:body,modelDigest:attestation.modelDigest,lpDigest:contentDigestBytes(lp),
    status:solved?.result?.Status,rawReceiptDigest:solved?.evidence?.rawReceiptDigest,
    terminalReport:solved?.evidence?.terminalReport,solverIdentity:solved?.identity,solverOptions:solved?.options};
   const values=new Map([...binary,'phase_spread'].map(v=>{const x=solved?.result?.Columns?.[v]?.Primal;
    requireFact(Number.isFinite(x)&&Math.abs(x-Math.round(x))<=1e-9,'Missing/noninteger phase primal.');return[v,Math.round(x)];}));
   requireFact(binary.every(v=>[0,1].includes(values.get(v)))&&values.get('phase_spread')>=0&&values.get('phase_spread')<=maximum,'Phase primal bounds violated.');
   for(const row of body.rows){const n=row.terms.reduce((x,[c,v])=>x+BigInt(c)*BigInt(values.get(v)),0n),rhs=BigInt(row.value);
    requireFact(row.relation==='='?n===rhs:row.relation==='<='?n<=rhs:n>=rhs,'Phase primal exact row violation.');}
   const sum=actualTerms.reduce((n,[c,v])=>n+BigInt(c)*BigInt(values.get(v)),0n);
   requireFact(sum>=0n&&sum<=BigInt(Number.MAX_SAFE_INTEGER),'Phase objective range unsupported.');const primitiveOptimum=Number(sum);
   const original=terms.reduce((n,[c,v])=>n+BigInt(c)*BigInt(values.get(v)),0n),reconstructed=sum*BigInt(normalization?.positiveDivisor||1);
   requireFact(original===reconstructed&&original<=BigInt(Number.MAX_SAFE_INTEGER),'Original-scale preference reconstruction mismatch/overflow.');const optimum=Number(original);
   Object.assign(lastSolverAttempt,{integerWitness:[...values],expectedPrimitiveObjectiveValue:primitiveOptimum,
    expectedOriginalScaleObjectiveValue:optimum,objectPrimalObjective:solved.evidence?.objectPrimalObjective,
    ...(normalization?{objectiveNormalization:normalization}:{})});
   checkPhaseTerminal(solved,primitiveOptimum,attestation);
   const receipt={name,model:body,modelDigest:attestation.modelDigest,lpDigest:contentDigestBytes(lp),objectiveValue:primitiveOptimum,
    ...(normalization?{objectiveNormalization:normalization,originalScaleObjectiveValue:optimum}:{}),
    integerWitness:[...values],rawReceiptDigest:solved.evidence.rawReceiptDigest,terminalReport:solved.evidence.terminalReport,
    solverIdentity:solved.identity,solverOptions:solved.options};tiers.push(receipt);
   bindings.push({name:`phase_fixed_${tiers.length}`,terms,relation:'=',value:optimum});return {values,optimum};
  };
  const min=run('raw_spread',[[1,'phase_spread']]);
  const preference=run('inherited_preference',options.filter(o=>o.cost).map(o=>[o.cost,o.name]));
  let final=preference;
  // Smaller radix chunks preserve the identical complete code-unit lexvector
  // while avoiding unnecessarily large floating SDK objective sums. Terminal
  // integer bounds and inherited1e-9 tolerances are unchanged.
  const identityLayout=createRecurringIdentityRadixLayout({ownerRadix:owners.length,orderedWorkIds:choices.map(c=>c.workId)});
  for(const layoutChunk of identityLayout.chunks){const offset=layoutChunk.offset,chunk=choices.slice(offset,offset+layoutChunk.orderedWorkIds.length);
   const terms=chunk.flatMap((c,i)=>options.filter(o=>o.workId===c.workId&&o.ownerIndex).map(o=>[o.ownerIndex*layoutChunk.multipliers[i],o.name]));
   requireFact(terms.every(([n])=>Number.isSafeInteger(n)),'Phase tie coefficient range unsupported.');
   final=run(`inherited_identity_${offset}`,terms);
  }
  const selection=options.filter(o=>final.values.get(o.name)===1).map(o=>({workId:o.workId,slotId:o.slotId}));
  const candidateSource=createProspective({source,ownerConfig,descriptor,selection});
  const canonical=evaluateRecurringPhaseCanonicalSource(candidateSource),ls=loads(candidateSource,descriptor);
  const actualSpread=Math.max(...ls.map(x=>x.doubledLoad))-Math.min(...ls.map(x=>x.doubledLoad));
  requireFact(canonical.feasible&&descriptor.choices.every(c=>!canonical.uncoveredWorkIds.includes(c.owners.find(o=>o.slotId===selection.find(s=>s.workId===c.workId)?.slotId)?.prospectiveWorkId)),
   'Relaxed lower-bound allocation lacks matching complete canonical coverage witness.');
  requireFact(actualSpread===min.optimum,'Canonical spread does not attain relaxed lower bound.');
  const actualCost=options.filter(o=>final.values.get(o.name)===1).reduce((n,o)=>n+o.cost,0);
  requireFact(actualCost===preference.optimum,'Canonical preference does not attain relaxed lower bound.');
  const stableIdentity=choices.map(c=>options.find(o=>o.workId===c.workId&&final.values.get(o.name)===1).ownerIndex),
   identityEncoding=assertRecurringIdentityRadixEncoding({layout:identityLayout,ownerIndexes:stableIdentity,expectedOrderedWorkIds:choices.map(c=>c.workId)});
  requireFact(canonicalJson(tiers.filter(t=>t.name.startsWith('inherited_identity_')).map(t=>t.objectiveValue))===canonicalJson(identityEncoding.chunkObjectives),
   'Complete identity vector does not match each strict fixed radix tier.');
  const body={...basis,status:'PROVEN_CANONICAL_PHASE_MINIMUM',minimumDoubledSpread:min.optimum,halfUnitFeasible:min.optimum<=1,
   preferenceCost:actualCost,stableIdentity,identityEncoding,
   tiers,identityLayout,selectedOwnership:selection,candidateSource,candidateSourceDigest:digest(candidateSource),canonicalHardWitness:canonical,
   minimumClaimScope:'EXACT_SELECTED_PACKAGES_ONLY_OTHER_MORNING_AND_DAYS_FIXED_NOT_GLOBAL_REDESIGN',
   independentlyMatchedCanonicalWitness:true,solver:true,admitted:false,budgetMs};
  return {...body,proofDigest:digest(body)};
 }catch(error){return unknown(error.message);}
}
export function solveRecurringPhaseCanonicalMinimum(input){return solvePhaseMinimum(input);}
