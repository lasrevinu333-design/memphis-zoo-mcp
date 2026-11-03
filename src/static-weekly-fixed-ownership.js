import {buildStaticWeeklySchedulingModel,remainingStaticWeeklyMilliseconds,weekdayDate} from './static-weekly-schedule-program.js';

// Evaluate a supplied fixed ownership against the maintained native hard
// constraints. This never chooses an owner or invokes an objective/solver.
// The graph and exact witness stay inside the isolated preparation boundary.
export function deriveFixedStaticWeeklyOwnershipWitness(problem,{rowOwners,deadline=null,allowCapacity=false}={}){
 const fail=code=>{throw Object.assign(new Error(code),{code});},
  tick=()=>{if(deadline!==null)remainingStaticWeeklyMilliseconds(deadline);},
  model=buildStaticWeeklySchedulingModel(problem,[],
   {name:'approved_static_fixed_feasibility',family:'approved_static_fixed_feasibility',terms:[]},deadline);
 if(model.error)fail('static_template_feasibility_model_invalid');
 if(model.general.size||model.priorBindings.length)fail('static_template_unexpected_rank_or_binding');
 const values=new Map([...model.binary].map(name=>[name,0])),assignments=[];
 for(const item of problem.work){
  tick();const slotId=rowOwners.get(item.key)||item.originSlotId,variable=model.x.get(`${item.key}\u0000${slotId}`);
  if(!variable){
   if(item.required!==false||item.coverageClass!=='permitted_open'){
    const error=Object.assign(new Error('static_template_fixed_owner_ineligible'),{code:'static_template_fixed_owner_ineligible',
     workId:item.workId,slotId,rejections:problem.staticRejections.get(item.key)?.find(r=>r.slotId===slotId)?.reasons||null});throw error;
   }
   values.set(model.uncovered.get(item.key),1);
   assignments.push({planWorkId:item.key,workId:item.workId,dayOfWeek:item.dayOfWeek,
    serviceDate:weekdayDate(problem.serviceDate,item.dayOfWeek),locationId:item.locationId,
    slotId:null,personId:null,displayName:null,status:'OPEN',coverageClass:item.coverageClass,
    window:structuredClone(item.window),serviceMode:item.serviceMode,
    serviceEffortMinutes:item.effort.minutes,includedLocations:structuredClone(item.includedLocations)});
   continue;
  }
  const person=problem.incumbencyByDaySlot.get(`${item.dayOfWeek}\u0000${slotId}`),capacity=person?.kind==='CONTRACTOR_CAPACITY';
  if(capacity?!allowCapacity:!person?.personId)fail('static_template_fixed_person_unavailable');
  values.set(variable,1);
  assignments.push({planWorkId:item.key,workId:item.workId,dayOfWeek:item.dayOfWeek,
   serviceDate:weekdayDate(problem.serviceDate,item.dayOfWeek),locationId:item.locationId,
   slotId,personId:capacity?null:person.personId,displayName:capacity?null:person.displayName,status:'ASSIGNED',
   ...(capacity?{ownerKind:'CONTRACTOR_CAPACITY',capacityId:person.capacityId}:{}),
   window:structuredClone(item.window),serviceMode:item.serviceMode,
   serviceEffortMinutes:item.effort.minutes,includedLocations:structuredClone(item.includedLocations)});
 }
 for(const group of model.routeGroups){
  tick();values.set(group.base,1);
  const middle=group.nodes.filter(node=>!['start','end'].includes(node.kind)&&values.get(node.active)===1)
   .sort((a,b)=>a.startMinute-b.startMinute||a.endMinute-b.endMinute||(a.id<b.id?-1:a.id>b.id?1:0)),
   path=[group.nodes.find(n=>n.kind==='start'),...middle,group.nodes.find(n=>n.kind==='end')];
  for(let i=1;i<path.length;i++){
   const arcs=group.arcs.filter(a=>a.from===path[i-1]&&a.to===path[i]);
   if(arcs.length!==1)fail('static_template_fixed_route_incompatible');
   values.set(arcs[0].name,1);
  }
 }
 for(const row of model.modelBasis.constraints.rows){
  tick();
  if(!Number.isSafeInteger(row.value)||row.terms.some(([n,v])=>!Number.isSafeInteger(n)||!values.has(v)))fail('static_template_hard_row_not_exact');
  const actual=row.terms.reduce((n,[coefficient,v])=>n+BigInt(coefficient)*BigInt(values.get(v)),0n),bound=BigInt(row.value);
  if(!(row.relation==='='?actual===bound:row.relation==='<='?actual<=bound:row.relation==='>='&&actual>=bound))
   fail('static_template_hard_constraint_violation');
 }
 return{assignments,model,values};
}
