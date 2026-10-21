// Private source-grounded NEW recurring design only. Not a publication, timed
// cleaning plan, dated optimizer, or certification of performed opening work.
import {canonicalJson,contentDigest,sha256Hex,bytewiseCompare,normalizeWindow} from './static-weekly-schedule-model.js';
import {postgresJsonbContentDigest} from './static-weekly-schedule-program.js';
import {createMorningPlanningDescriptor,assertMorningPlanningDescriptor} from './static-weekly-morning-planning-authority.js';
import {assertNormalOwnerEligibility} from './static-weekly-owner-eligibility.js';
import {getScheduleComponentWeightLedger} from './schedule-component-weight-authority.js';
import {recurringSecondaryOwnerReference} from './static-weekly-recurring-staffing-adaptation.js';
import {evaluateRecurringPhaseCanonicalSource,createRecurringPreferencePrimitiveObjective,
 assertRecurringPreferencePrimitiveWitness,createRecurringIdentityRadixLayout} from './static-weekly-recurring-phase-authority.js';
export const RECURRING_MORNING_SCHEMA='custodial.recurring-source-planned-morning.v1';
export const RECURRING_MORNING_ERROR='static_weekly_recurring_morning_invalid';
const fail=(ok,reason)=>{if(!ok)throw Object.assign(new Error(`Recurring morning: ${reason}`),{code:RECURRING_MORNING_ERROR,reason});};
const clone=x=>structuredClone(x),same=(a,b)=>canonicalJson(a)===canonicalJson(b),safe=n=>Number.isSafeInteger(n);
const integer=n=>{fail(safe(n),'integer_range');return n;};
const number=n=>{fail(n>=0n&&n<=BigInt(Number.MAX_SAFE_INTEGER),'exact_objective_overflow');return Number(n);};
const freeze=x=>{if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x);}return x;};
const ledger=new Map(getScheduleComponentWeightLedger().families.map(f=>[f.code,f]));
const design='NEW_RECURRING_MORNING_DESIGN';
function scalar(terms){return terms.length?terms.map(([c,v])=>`${c<0?'-':'+'} ${Math.abs(c)} ${v}`).join(' '):'0';}
function exactKeys(x,keys){fail(x&&same(Object.keys(x).sort(),keys.sort()),'exact_input_fields');}

export function createRecurringMorningObjectiveContract(input){
 exactKeys(input,input?.originalReference?['planningInput','fullOwners','originalReference']:['planningInput','fullOwners']);
 const p=input.planningInput,descriptor=createMorningPlanningDescriptor(p);
 if(descriptor.scope==='ACCEPTED_PATTERN_PRESERVED')return freeze({schema:RECURRING_MORNING_SCHEMA,
  status:'PRESERVED_NOT_REOPTIMIZED',descriptor,objectiveApplied:false,admitted:false,published:false});
 fail(descriptor.scope===design,'dated_or_unknown_scope_is_not_morning_design');
 const cfg=p.ownerConfig,packages=descriptor.packages.filter(x=>x.pre09Intersection!==null),selected=new Set(descriptor.selectedWorkIds);
 fail(descriptor.selectedWorkIds.every(id=>packages.some(x=>x.workId===id)),'selection_without_pre09_responsibility');
 fail(new Set(packages.map(x=>x.family)).size===packages.length,'split_morning_requires_explicit_basis');
 const owners=descriptor.baselineRoster.filter(o=>o.baselineStatus==='working'&&o.personId&&o.baselineAvailablePre09ClockMinutes>0).map(clone)
  .sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0);
 fail(owners.length>0,'no_current_pre09_employees');
 const earliest=Math.min(...owners.map(o=>normalizeWindow(o.baselineAvailability.shift).startMinute));
 const edges=new Map(descriptor.directedProximity.edges.map(e=>[`${e.fromLocationId}\0${e.toLocationId}`,e]));
 const choices=packages.filter(x=>selected.has(x.workId)).sort((a,b)=>a.family<b.family?-1:a.family>b.family?1:bytewiseCompare(a.workId,b.workId));
 const options=[],missingEdges=[],secondaryOwnerReferences=[];
 const sourceOwner=new Map(packages.map(p=>[p.family,descriptor.baselineRoster.find(o=>o.slotId===p.baselineOwner.slotId)?.key]));
 const originalPreferenceOwners=new Map();
 const originalReference=input.originalReference;
 if(originalReference){
  exactKeys(originalReference,['schema','reductionContextDigest','historicalSource','currentCorrectionSource',
   'dayAvailabilityReferences','morningComparisonLedger']);
  fail(originalReference.schema==='custodial.original-target-morning-reference.v1'&&
   /^[a-f0-9]{64}$/.test(originalReference.reductionContextDigest),'original_target_reference_schema');
  const historical=originalReference.historicalSource,current=originalReference.currentCorrectionSource;
  fail(Array.isArray(historical?.version?.slotAvailability)&&Array.isArray(current?.version?.slotAvailability),
   'original_target_availability_sources_missing');
  for(const owner of owners){
   const key=`${descriptor.dayOfWeek}\0${owner.slotId}`;
   const old=historical.version.slotAvailability.filter(r=>`${r.dayOfWeek}\0${r.slotId}`===key),
    now=current.version.slotAvailability.filter(r=>`${r.dayOfWeek}\0${r.slotId}`===key),
    refs=originalReference.dayAvailabilityReferences.filter(r=>`${r.day}\0${r.slotId}`===key);
   fail(old.length<=1&&now.length===1&&refs.length===1,'original_target_day_reference_multiplicity');
   const expected=old[0]||now[0],kind=old.length?'ORIGINAL_ACCEPTED_SAME_DAY':'CURRENT_CORRECTION_NEW_DAY';
   fail(refs[0].kind===kind&&refs[0].sourceDigest===contentDigest(expected),
    'original_target_day_reference_provenance');
   fail(owner.baselineAvailability.acceptedRouteAnchorLocationId===expected.acceptedRouteAnchorLocationId&&
    owner.baselineAvailability.acceptedRouteProvenance===expected.acceptedRouteProvenance,
    'original_target_directed_anchor_changed');
  }
  for(const pkg of packages){
   const ledger=originalReference.morningComparisonLedger.filter(r=>r.day===descriptor.dayOfWeek&&r.family===pkg.family);
   fail(ledger.length===1&&descriptor.baselineRoster.some(o=>o.slotId===ledger[0].referenceSlotId),
    'original_target_100_reference_changed');
   originalPreferenceOwners.set(pkg.workId,ledger[0].referenceSlotId);
   const admin=ledger[0].referenceKind==='AUTHORIZED_ADMIN_MORNING_CURRENT_SOURCE';
   const rows=(admin?current:historical).version.assignments.filter(r=>r.dayOfWeek===descriptor.dayOfWeek&&
    r.locationCodeSnapshot===pkg.family&&r.window?.end==='09:45');
   if(admin)fail(rows.length===1&&rows[0].originSlotId===ledger[0].referenceSlotId&&
    contentDigest(rows[0])===ledger[0].currentCorrectionRowDigest,'original_target_admin_source_owner_changed');
   else fail(rows.length>=1&&rows.some(r=>r.originSlotId===ledger[0].referenceSlotId)&&
    canonicalJson(rows)===canonicalJson(ledger[0].originalRows),'original_target_historical_owner_changed');
  }
 }
 for(const pkg of packages){
  const row=pkg.sourceRow,known=ledger.get(pkg.family),owner=descriptor.baselineRoster.find(o=>o.slotId===pkg.baselineOwner.slotId);
  fail(row.window.start===owner?.baselineAvailability?.shift.start&&row.window.end==='09:45','non_structural_morning_window');
  fail(row.required!==false&&safe(row.priority)&&row.priority>0&&row.priorityProvenance,'required_source_priority_missing_or_optional_unsupported');
  if(known){
   // Cat/Primate are area-response bindings, not physical cleaning members.
   // Their exact ledger area/primary identity is validated by the descriptor;
   // converting that area into a cleaning member would invent a service.
   const expected=known.components.filter(m=>m.bindingKind!=='RESPONSE_ONLY_AREA').map(m=>m.locationId).sort();
   fail(same(pkg.physicalMembers.map(m=>m.locationId).sort(),expected),'partial_known_package_cannot_use_full_aggregate');
  }
  integer(pkg.configAggregateWeight*2);
 }
 for(const owner of owners){
  const av=owner.baselineAvailability,start=normalizeWindow(av.shift).startMinute;
  fail((start-earliest)%30===0,'unsupported_start_time_halfhour_lattice');
  fail(typeof av.acceptedRouteAnchorLocationId==='string'&&av.acceptedRouteAnchorLocationId.length>0
   &&typeof av.acceptedRouteProvenance==='string'&&av.acceptedRouteProvenance.length>0,'missing_original_anchor');
  owner.startAdvantageDoubledWeight=integer((start-earliest)/30);
 }
 for(const [i,pkg]of choices.entries()){
  const reference=recurringSecondaryOwnerReference({currentConfig:cfg,fullOwners:input.fullOwners,day:descriptor.dayOfWeek,
   phase:'morning',family:pkg.family,sourceOwner}),guided=reference.owner;
  secondaryOwnerReferences.push({workId:pkg.workId,reference});
  for(const [j,owner]of owners.entries()){
   const av=owner.baselineAvailability,c={key:owner.key,...cfg.slots[owner.key]},row=pkg.sourceRow;
   try{assertNormalOwnerEligibility(c,pkg.family);}catch{continue;}
   if(cfg.mondayOnlyFamilies?.includes(pkg.family)&&pkg.baselineOwner.slotId!==owner.slotId)continue;
   if((row.restrictedSlotIds||[]).includes(owner.slotId)||(av.restrictions||[]).includes(pkg.primaryLocationId))continue;
   fail(Array.isArray(av.qualifications)&&av.qualificationProvenance&&Array.isArray(av.restrictions)&&av.restrictionProvenance,'missing_eligibility_provenance');
   if(!(row.requiredQualifications||[]).every(q=>av.qualifications.includes(q)))continue;
   if(normalizeWindow(av.shift).endMinute<585)continue;
   const anchor=av.acceptedRouteAnchorLocationId,nonphysical=row.serviceMode==='reminder_only';
   const edge=anchor===pkg.primaryLocationId?{minutes:0,verified:true,provenance:'same_location'}:edges.get(`${anchor}\0${pkg.primaryLocationId}`);
   if(!nonphysical&&(!edge||!edge.verified||!safe(edge.minutes)||edge.minutes<0||!edge.provenance)){
    missingEdges.push({workId:pkg.workId,slotId:owner.slotId,anchorLocationId:anchor,locationId:pkg.primaryLocationId});continue;
   }
   options.push({name:`morning_x_${i}_${j}`,workId:pkg.workId,family:pkg.family,slotId:owner.slotId,ownerIndex:j,
    prospectiveWorkId:`${descriptor.dayOfWeek}:${pkg.family}:morning:${owner.slotId.slice(0,8)}`,
    doubledAggregateWeight:integer(pkg.configAggregateWeight*2),geographyCost:nonphysical?0:edge.minutes,
    originalAnchorLocationId:anchor,edgeProvenance:nonphysical?'nonphysical_schedule_reminder':edge.provenance,
    preferenceCost:((originalPreferenceOwners.get(pkg.workId)||pkg.baselineOwner.slotId)!==owner.slotId?100:0)
      +(guided!==owner.key?4:0)+(c.normalAssignmentFamilies?.includes(pkg.family)?0:2),
    window:{start:av.shift.start,end:'09:45'}});
  }
 }
 // An unknown required directed edge cannot silently narrow the optimum's
 // domain: that would certify a minimum over an invented smaller candidate set.
 fail(missingEdges.length===0,'required_directed_edges_unavailable');
 const fixed=packages.filter(x=>!selected.has(x.workId));
 const fixedLoads=owners.map(o=>fixed.filter(x=>x.baselineOwner.slotId===o.slotId).reduce((n,x)=>n+x.configAggregateWeight*2,0));
 const fixedCounts=owners.map(o=>fixed.filter(x=>x.baselineOwner.slotId===o.slotId).length);
 fail(fixed.every(x=>owners.some(o=>o.slotId===x.baselineOwner.slotId)),'fixed_pre09_owner_unavailable');
 const priorityOrder=[...new Set(choices.map(x=>x.sourceRow.priority))].sort((a,b)=>b-a);
 const body={schema:RECURRING_MORNING_SCHEMA,status:'OBJECTIVE_CONTRACT_ONLY',descriptor,
  originalSourceDigest:descriptor.sourceDigest,ownerConfigDigest:descriptor.ownerConfigDigest,fullOwnersDigest:contentDigest(input.fullOwners),
  objectiveOrder:['PLANNED_SOURCE_RESPONSIBILITY_COVERAGE_BY_EXISTING_PRIORITY','ANCHORED_DIRECTED_PACKAGE_PROXIMITY_COST',
   'START_LADDER_MAXIMUM_EXACT_DEVIATION','START_LADDER_TOTAL_EXACT_DEVIATION','INHERITED_100_4_2_PREFERENCE','COMPLETE_CODE_UNIT_IDENTITY'],
  owners,choices,options,fixedLoads,fixedCounts,priorityOrder,secondaryOwnerReferences,
  aggregateWeightUnit:'AUTHORIZED_AGGREGATE_SCHEDULE_WORKLOAD_WEIGHT',componentWeightUnit:descriptor.componentWeightUnit,
  startAdvantageRule:'ONE_AGGREGATE_WEIGHT_PER_SOURCE_START_HOUR_EXACT_HALF_UNIT_LATTICE',integerWeightScale:2,
  geographyReference:originalReference?'ORIGINAL_SAME_DAY_OR_TYPED_CURRENT_CORRECTION_NEW_DAY_NOT_CANDIDATE_ANCHOR':
   'FROZEN_ORIGINAL_SOURCE_DAY_POSITION_ANCHOR_NOT_CANDIDATE_ANCHOR',
  ...(originalReference?{originalReferenceDigest:contentDigest(originalReference),
   originalReductionContextDigest:originalReference.reductionContextDigest}:{}),
  missingCriticalClassification:true,physicalMinuteFeasibilityClaim:false,compulsoryFull:false,
  admitted:false,published:false,acceptedStaticChanged:false,datedOptimizerChanged:false};
 return freeze({...body,contractDigest:contentDigest(body)});
}
function selectionFacts(contract,selection){
 fail(Array.isArray(selection)&&selection.length===contract.choices.length,'exact_selection_multiplicity');
 fail(new Set(selection.map(s=>s.workId)).size===selection.length,'duplicate_selected_work');
 return contract.choices.map(c=>{const s=selection.find(s=>s.workId===c.workId);exactKeys(s,['workId','slotId']);
  if(s.slotId===null)return null;const option=contract.options.find(o=>o.workId===c.workId&&o.slotId===s.slotId);
  fail(option,'owner_not_in_bound_source_candidate_set');return option;});
}
function score(contract,selection){
 const selected=selectionFacts(contract,selection),n=contract.owners.length,loads=[...contract.fixedLoads],counts=[...contract.fixedCounts];
 selected.forEach(o=>{if(o){loads[o.ownerIndex]+=o.doubledAggregateWeight;counts[o.ownerIndex]++;}});
 fail(counts.every(x=>x>0),'meaningful_source_morning_work_missing');
 const adjusted=loads.map((q,i)=>integer(q+contract.owners[i].startAdvantageDoubledWeight)),sum=integer(adjusted.reduce((a,b)=>a+b,0)),
  deviations=adjusted.map(q=>integer(Math.abs(integer(n*q)-sum))),coverage=contract.priorityOrder.map(priority=>
   contract.choices.reduce((count,c,i)=>count+Number(c.sourceRow.priority===priority&&selected[i]===null),0));
 const geography=integer(selected.reduce((sum,o)=>sum+(o?.geographyCost||0),0)),preference=integer(selected.reduce((sum,o)=>sum+(o?.preferenceCost||0),0));
 return {coverage,geography,ladderMax:Math.max(...deviations),ladderL1:integer(deviations.reduce((a,b)=>a+b,0)),preference,
  identity:selected.map(o=>o?.ownerIndex??n),doubledLoads:loads,adjustedLoads:adjusted,scaledIndividualDeviations:deviations,
  exactIdealAdjustedLoad:{numerator:sum,denominator:n},vector:[...coverage,geography,Math.max(...deviations),deviations.reduce((a,b)=>a+b,0),preference,...selected.map(o=>o?.ownerIndex??n)]};
}
export function scoreRecurringMorningOwnership(input,selection){return score(createRecurringMorningObjectiveContract(input),selection);}
export function enumerateRecurringMorningObjectiveOracle(input){
 const contract=createRecurringMorningObjectiveContract(input);fail(contract.status==='OBJECTIVE_CONTRACT_ONLY','design_required');
 const domains=contract.choices.map(c=>[...contract.options.filter(o=>o.workId===c.workId).map(o=>o.slotId),null]);
 const count=domains.reduce((n,d)=>n*d.length,1);if(count>4096)return {status:'UNKNOWN_ENUMERATION_BOUND',combinations:count,limit:4096,canonicalFeasibilityProven:false};
 let minimum=null,selection=null,visited=0;const compare=(a,b)=>a.reduce((d,v,i)=>d||v-b[i],0);
 const visit=(i,rows)=>{if(i<domains.length){for(const slotId of domains[i])visit(i+1,[...rows,{workId:contract.choices[i].workId,slotId}]);return;}
  visited++;let result;try{result=score(contract,rows);}catch{return;}
  if(!minimum||compare(result.vector,minimum.vector)<0){minimum=result;selection=rows;}};visit(0,[]);
 return {status:minimum?'RELAXED_OBJECTIVE_ORACLE_NOT_CANONICAL':'NO_NONEMPTY_RELAXED_SELECTION',contractDigest:contract.contractDigest,
  visited,minimum,selection,solver:false,canonicalFeasibilityProven:false,openingReadinessProven:false,admitted:false,published:false};
}
function prospective(input,contract,selection){
 const options=selectionFacts(contract,selection);fail(options.every(Boolean),'required_planned_responsibility_uncovered');
 const source=clone(input.planningInput.source),byId=new Map(options.map(o=>[o.workId,o]));
 source.version.assignments=source.version.assignments.map(row=>{const o=byId.get(row.workId);return o?{...row,
  workId:o.prospectiveWorkId,ownerSlotId:o.slotId,originSlotId:o.slotId,window:clone(o.window)}:row;});
 fail(new Set(source.version.assignments.map(r=>r.workId)).size===source.version.assignments.length,'prospective_identity_collision');
 return source;
}
export function createRecurringMorningProspectiveSource(input,selection){return prospective(input,createRecurringMorningObjectiveContract(input),selection);}

function model(contract){
 const binary=contract.options.map(o=>o.name),rows=[],u=contract.choices.map((c,i)=>({name:`morning_u_${i}`,workId:c.workId,priority:c.sourceRow.priority}));
 binary.push(...u.map(x=>x.name));
 for(const [i,c]of contract.choices.entries())rows.push({name:`morning_cover_${i}`,terms:[...contract.options.filter(o=>o.workId===c.workId).map(o=>[1,o.name]),[1,u[i].name]],relation:'=',value:1});
 const n=contract.owners.length,load=i=>contract.options.filter(o=>o.ownerIndex===i).map(o=>[o.doubledAggregateWeight,o.name]),allLoads=contract.options.map(o=>[o.doubledAggregateWeight,o.name]),
  constants=contract.fixedLoads.map((q,i)=>q+contract.owners[i].startAdvantageDoubledWeight),sum=integer(constants.reduce((a,b)=>a+b,0)),
  maximum=integer(n*(contract.fixedLoads.reduce((a,b)=>a+b,0)+contract.choices.reduce((a,c)=>a+c.configAggregateWeight*2,0)
    +Math.max(...contract.owners.map(o=>o.startAdvantageDoubledWeight)))+sum),general=['morning_ladder_max'],bounds=[{name:'morning_ladder_max',min:0,max:maximum}];
 for(let i=0;i<n;i++){
  rows.push({name:`morning_nonempty_${i}`,terms:contract.options.filter(o=>o.ownerIndex===i).map(o=>[1,o.name]),relation:'>=',value:1-contract.fixedCounts[i]});
  const d=`morning_deviation_${i}`;general.push(d);bounds.push({name:d,min:0,max:maximum});
  const positive=[...load(i).map(([c,v])=>[n*c,v]),...allLoads.map(([c,v])=>[-c,v])],constant=integer(n*constants[i]-sum);
  rows.push({name:`morning_deviation_pos_${i}`,terms:[...positive,[-1,d]],relation:'<=',value:-constant});
  rows.push({name:`morning_deviation_neg_${i}`,terms:[...positive.map(([c,v])=>[-c,v]),[-1,d]],relation:'<=',value:constant});
  rows.push({name:`morning_max_${i}`,terms:[[1,d],[-1,'morning_ladder_max']],relation:'<=',value:0});
 }
 const identityLayout=createRecurringIdentityRadixLayout({ownerRadix:n+1,orderedWorkIds:contract.choices.map(c=>c.workId)});
 const objectives=[...contract.priorityOrder.map(priority=>({name:`planned_uncovered_priority_${priority}`,terms:u.filter(x=>x.priority===priority).map(x=>[1,x.name])})),
  {name:'directed_original_anchor_cost',terms:contract.options.filter(o=>o.geographyCost).map(o=>[o.geographyCost,o.name])},
  {name:'ladder_max_deviation',terms:[[1,'morning_ladder_max']]},
  {name:'ladder_total_deviation',terms:general.filter(v=>v!=='morning_ladder_max').map(v=>[1,v])},
  {name:'inherited_preference',terms:contract.options.filter(o=>o.preferenceCost).map(o=>[o.preferenceCost,o.name])},
  ...identityLayout.chunks.map(chunk=>({name:`complete_identity_${chunk.offset}`,terms:chunk.orderedWorkIds.flatMap((id,i)=>[
   ...contract.options.filter(o=>o.workId===id&&o.ownerIndex).map(o=>[o.ownerIndex*chunk.multipliers[i],o.name]),
   [n*chunk.multipliers[i],u.find(x=>x.workId===id).name]])}))];
 for(const row of rows)fail(row.terms.every(([c,v])=>safe(c)&&binary.includes(v)||safe(c)&&general.includes(v))&&safe(row.value),'model_integer_domain');
 return {binary,general,bounds,rows,objectives,identityLayout,u};
}
function tierModel(contract,basis,objective,bindings){
 const normalization=objective.name==='inherited_preference'?createRecurringPreferencePrimitiveObjective(objective.terms,basis.binary):null;
 const terms=normalization?.primitiveTerms||objective.terms;
 const body={schema:'custodial.recurring-morning-tier-model.v1',contractDigest:contract.contractDigest,name:objective.name,terms,
  rows:[...basis.rows,...bindings],binary:basis.binary,general:basis.general,bounds:basis.bounds,...(normalization?{normalization}:{})};
 const lp=`Minimize\n morning_objective: ${scalar(terms)}\nSubject To\n${body.rows.map(r=>` ${r.name}: ${scalar(r.terms)} ${r.relation} ${r.value}`).join('\n')}\nBounds\n${basis.bounds.map(b=>` ${b.min} <= ${b.name} <= ${b.max}`).join('\n')}\nGeneral\n ${basis.general.join(' ')}\nBinary\n ${basis.binary.join(' ')}\nEnd\n`;
 return {body,lp,normalization,attestation:{schema:'custodial.recurring-morning-model-attestation.v1',modelDigest:contentDigest(body),contractDigest:contract.contractDigest}};
}
function integerWitness(basis,body,solved){
 exactKeys(solved.result,['Status','ObjectiveValue','Columns']);
 fail(same(Object.keys(solved.result.Columns).sort(),[...basis.binary,...basis.general].sort()),'exact_primal_columns');
 const values=new Map([...basis.binary,...basis.general].map(v=>{const x=solved?.result?.Columns?.[v]?.Primal;
  exactKeys(solved.result.Columns[v],['Primal']);
  fail(Number.isFinite(x)&&Math.abs(x-Math.round(x))<=1e-9,'missing_noninteger_primal');return[v,Math.round(x)];}));
 fail(basis.binary.every(v=>[0,1].includes(values.get(v)))&&basis.bounds.every(b=>values.get(b.name)>=b.min&&values.get(b.name)<=b.max),'primal_domain');
 for(const row of body.rows){const value=row.terms.reduce((sum,[c,v])=>sum+BigInt(c)*BigInt(values.get(v)),0n),rhs=BigInt(row.value);
  fail(row.relation==='='?value===rhs:row.relation==='<='?value<=rhs:value>=rhs,'exact_primal_row_violation');}
 return values;
}
const sumTerms=(terms,values)=>number(terms.reduce((sum,[c,v])=>sum+BigInt(c)*BigInt(values.get(v)),0n));
const pinned={package:'highs@1.15.2',packageJsonSha256:'21e76a89d13d636f56d5cdda7dde590acd48d6fb683c97a327c10d43e74d9c56',
 wrapperJavaScriptSha256:'6d5be3ed3cbd1ce1924cc66cc9302b50753dabdb8c6e0e815845dce7f1890033',
 wasmSha256:'7e6432b2b26f4fab9f6d9bac55da43307c7a4b1b071cb204cb4d23e1901bc4d0',embeddedRuntimeBanner:'HiGHS 1.15.1 (git hash: 04024d7)'};
function decimal(raw){const m=/^([+-]?)(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(String(raw).trim());
 fail(m&&(m[2]+(m[3]||'')).length<=128,'terminal_decimal');const power=Number(m[4]||0)-(m[3]?.length||0);fail(safe(power)&&Math.abs(power)<=128,'terminal_decimal');
 return {coefficient:BigInt((m[1]==='-'?'-':'')+m[2]+(m[3]||'')),power};}
function equals(raw,n){const {coefficient:c,power:p}=decimal(raw);return p>=0?c*10n**BigInt(p)===BigInt(n):c===BigInt(n)*10n**BigInt(-p);}
function terminal(solved,expected,attestation){
 const e=solved?.evidence,r=e?.terminalReport;
 fail(Object.entries(pinned).every(([k,v])=>solved?.identity?.[k]===v),'pinned_engine_identity');
 fail(same(solved.modelAttestation,attestation),'model_attestation');
 fail(solved.result?.Status==='Optimal'&&e?.objectStatus==='Optimal'&&e?.reportStatus==='Optimal'&&e.parserOk===true
  &&!e.outputTruncated&&e.reportSolutionStatus==='feasible','strict_terminal_optimum');
 fail(solved.options?.threads===1&&solved.options.random_seed===0&&solved.options.mip_rel_gap===0&&solved.options.mip_abs_gap===0
  &&solved.options.mip_feasibility_tolerance===1e-9&&solved.options.output_flag===true&&solved.options.parallel==='off'
  &&solved.options.time_limit>0&&solved.options.time_limit<=30,'solver_options');
 fail(r?.representation==='highs-terminal-report-records-json-utf8-v1'&&r.parserVersion==='highs-terminal-report-v1'
  &&Array.isArray(r.records)&&r.records.every(x=>['print','printErr'].includes(x.channel)&&typeof x.text==='string'),'terminal_representation');
 const raw=JSON.stringify({representation:r.representation,records:r.records.map(({channel,text})=>({channel,text}))});
 fail(r.utf8Sha256===sha256Hex(raw)&&r.utf8Base64===Buffer.from(raw).toString('base64'),'terminal_bytes');
 fail(e.rawReceiptDigest===sha256Hex(JSON.stringify({schema:'memphis-zoo.static-weekly-raw-solver-receipt.v1',options:solved.options,terminalReport:r})),'raw_receipt_digest');
 fail(r.records[0]?.text==='Solving report'&&r.records.at(-1)?.text==='Writing the solution to solution.txt'
  &&r.records.filter(x=>x.text==='Solving report').length===1&&r.records.filter(x=>x.text==='Writing the solution to solution.txt').length===1,'terminal_boundaries');
 const fields=[['status',/^\s*Status\s{2,}(.+)$/],['primal',/^\s*Primal bound\s{2,}(.+)$/],['dual',/^\s*Dual bound\s{2,}(.+)$/],
  ['gap',/^\s*Gap\s{2,}(.+)$/],['solution',/^\s*Solution status\s{2,}(.+)$/],['objective',/^\s+(.+?)\s+\(objective\)\s*$/],
  ['bound',/^\s+(.+?)\s+\(bound viol\.\)\s*$/],['integer',/^\s+(.+?)\s+\(int\. viol\.\)\s*$/],['row',/^\s+(.+?)\s+\(row viol\.\)\s*$/]];
 const actual={};let last=-1;
 for(const [key,pattern]of fields){const matches=r.records.flatMap((x,i)=>{const m=pattern.exec(x.text);return m?[{i,value:m[1]}]:[];});
  fail(matches.length===1&&matches[0].i>last,'terminal_field_order_multiplicity');last=matches[0].i;actual[key]=matches[0].value;}
 fail(actual.status==='Optimal'&&actual.solution==='feasible'&&actual.gap.endsWith('%'),'terminal_status');
 for(const key of ['primal','dual','objective'])fail(equals(actual[key],expected),'terminal_exact_objective');
 for(const key of ['bound','row'])fail(equals(actual[key],0),'terminal_nonzero_violation');
 const {coefficient:c,power:p}=decimal(actual.integer);fail(c>=0n&&(p+9>=0?c*10n**BigInt(p+9)<=1n:c<=10n**BigInt(-p-9)),'integer_tolerance');
 fail(equals(actual.gap.slice(0,-1),0)&&Number.isFinite(solved.result.ObjectiveValue)&&Math.abs(solved.result.ObjectiveValue-expected)<=1e-9
  &&Math.round(solved.result.ObjectiveValue)===expected&&e.objectPrimalObjective===solved.result.ObjectiveValue,'redundant_object_scalar');
}
function finish(input,contract,basis,tiers,selection){
 const metrics=score(contract,selection);fail(metrics.coverage.every(n=>n===0),'planned_required_responsibility_uncovered');
 const candidateSource=prospective(input,contract,selection),canonical=evaluateRecurringPhaseCanonicalSource(candidateSource);
 fail(canonical.feasible&&contract.options.filter(o=>selection.some(s=>s.workId===o.workId&&s.slotId===o.slotId))
  .every(o=>!canonical.uncoveredWorkIds.includes(o.prospectiveWorkId)),'relaxed_bound_not_matched_by_complete_canonical_witness');
 const expected=[...metrics.coverage,metrics.geography,metrics.ladderMax,metrics.ladderL1,metrics.preference];
 fail(tiers.slice(0,expected.length).every((t,i)=>t.originalObjectiveValue===expected[i]),'objective_selection_does_not_match_strict_bound');
 const body={schema:RECURRING_MORNING_SCHEMA,status:'PROVEN_SOURCE_PLANNED_MORNING_MINIMUM',contract,tiers,selection,metrics,
  identityLayout:basis.identityLayout,candidateSource,candidateSourceDigest:contentDigest(candidateSource),canonicalHardWitness:canonical,
  proofMethod:'RELAXED_LEX_LOWER_BOUNDS_PLUS_MATCHING_COMPLETE_CANONICAL_WITNESS',
  proofScope:'EXPLICIT_SELECTED_NEW_RECURRING_PRE09_SOURCE_RESPONSIBILITIES_WITH_OTHER_WORK_FIXED',
  missingOpeningCriticalClassification:true,openingReadinessProven:false,physicalMinuteFeasibilityClaim:false,
  unknownIndividualComponentAllocations:contract.descriptor.packages.filter(p=>!p.componentLoadComplete).map(p=>p.workId),
  originalSourceMutated:false,admitted:false,published:false,fullRecordClosed:false};
 return {...body,proofDigest:contentDigest(body)};
}
export function solveRecurringMorningCanonicalMinimum(input,solver){
 const contract=createRecurringMorningObjectiveContract(input);
 if(contract.status==='PRESERVED_NOT_REOPTIMIZED')return contract;
 const basis=model(contract),bindings=[],tiers=[],started=performance.now(),budgetMs=30_000;let lastSolverAttempt=null;
 try{
  fail(solver&&typeof solver.solve==='function','owned_pinned_solver_required');let values;
  for(const objective of basis.objectives){
   const remaining=budgetMs-(performance.now()-started);fail(remaining>0,'morning_solver_admission_time_bound_exhausted');
   const t=tierModel(contract,basis,objective,bindings),raw=solver.solve(t.lp,{timeLimitSeconds:remaining/1000,modelAttestation:t.attestation});
   // Retain exactly the actual primal fields checked against independently
   // reconstructed rows. HiGHS's unused display Lower/Upper fields can contain
   // infinities; neither those nor rounded JSON nulls are proof authority.
   // Terminal record bytes, raw receipt, identity and attestation stay lossless.
   const solved={identity:clone(raw.identity),modelAttestation:clone(raw.modelAttestation),options:clone(raw.options),evidence:clone(raw.evidence),
    result:{Status:raw.result?.Status,ObjectiveValue:raw.result?.ObjectiveValue,
     Columns:Object.fromEntries([...basis.binary,...basis.general].map(v=>[v,{Primal:raw.result?.Columns?.[v]?.Primal}]))}};
   lastSolverAttempt={name:objective.name,model:t.body,lpDigest:sha256Hex(t.lp),solved};
   values=integerWitness(basis,t.body,solved);const primitive=sumTerms(t.body.terms,values),original=sumTerms(objective.terms,values);
   if(t.normalization)assertRecurringPreferencePrimitiveWitness({terms:objective.terms,binary:basis.binary,normalization:t.normalization,
    integerWitness:[...values].filter(([v])=>basis.binary.includes(v)),primitiveObjectiveValue:primitive,originalScaleObjectiveValue:original});
   terminal(solved,primitive,t.attestation);
   tiers.push({name:objective.name,model:t.body,modelDigest:t.attestation.modelDigest,lpDigest:sha256Hex(t.lp),
    objectiveValue:primitive,originalObjectiveValue:original,integerWitness:[...values],solved});
   bindings.push({name:`morning_fixed_${tiers.length}`,terms:objective.terms,relation:'=',value:original});
  }
  // The full actual input is independently regenerated after all fresh calls;
  // no seal, mutation-sensitive cached authority or caller descriptor is used.
  fail(same(contract,createRecurringMorningObjectiveContract(input)),'source_config_changed_during_solve');
  const selection=contract.choices.map(c=>({workId:c.workId,slotId:contract.options.find(o=>o.workId===c.workId&&values.get(o.name)===1)?.slotId??null}));
  return finish(input,contract,basis,tiers,selection);
 }catch(error){return {schema:RECURRING_MORNING_SCHEMA,status:'UNKNOWN_CANONICAL_MORNING',reason:error.reason||error.message,
  contract,tiers,lastSolverAttempt,candidateSource:null,solverAdmissionBudgetMs:budgetMs,openingReadinessProven:false,admitted:false,published:false};}
}
export function assertRecurringMorningCanonicalProof(proof,input){
 const {proofDigest,...body}=proof;fail(contentDigest(body)===proofDigest&&proof.status==='PROVEN_SOURCE_PLANNED_MORNING_MINIMUM','proof_identity');
 const contract=createRecurringMorningObjectiveContract(input);fail(same(contract,proof.contract),'independent_objective_contract');
 assertMorningPlanningDescriptor(proof.contract.descriptor,input.planningInput);
 const basis=model(contract),bindings=[];fail(proof.tiers.length===basis.objectives.length,'tier_multiplicity');
 for(const [i,objective]of basis.objectives.entries()){
  const expected=tierModel(contract,basis,objective,bindings),actual=proof.tiers[i];
  fail(actual.name===objective.name&&same(actual.model,expected.body)&&actual.modelDigest===expected.attestation.modelDigest
   &&actual.lpDigest===sha256Hex(expected.lp),'tier_model_binding');
  const values=integerWitness(basis,expected.body,actual.solved);
  fail(same([...values],actual.integerWitness),'integer_witness_binding');
  const primitive=sumTerms(expected.body.terms,values),original=sumTerms(objective.terms,values);
  fail(actual.objectiveValue===primitive&&actual.originalObjectiveValue===original,'primitive_original_objective_binding');
  terminal(actual.solved,primitive,expected.attestation);
  bindings.push({name:`morning_fixed_${i+1}`,terms:objective.terms,relation:'=',value:original});
 }
 const finalValues=new Map(proof.tiers.at(-1).integerWitness),selection=contract.choices.map(c=>({workId:c.workId,
  slotId:contract.options.find(o=>o.workId===c.workId&&finalValues.get(o.name)===1)?.slotId??null}));
 fail(same(selection,proof.selection),'selection_witness_binding');
 fail(same(finish(input,contract,basis,proof.tiers,selection),proof),'fresh_canonical_proof_recomputation');return true;
}
