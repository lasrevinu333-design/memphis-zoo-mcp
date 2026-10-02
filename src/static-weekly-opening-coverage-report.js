// Derived source evidence only: never a service request, solver or guest-ready certificate.
import {prepareStaticWeeklySchedulingProblem,postgresJsonbContentDigest as digest,
 weekdayDate} from './static-weekly-schedule-program.js';
import {getScheduleComponentWeightLedger,COMPONENT_WEIGHT_LEDGER_DIGEST,
 COMPONENT_WEIGHT_UNIT,INHERITED_WORKLOAD_UNIT} from './schedule-component-weight-authority.js';

export const OPENING_COVERAGE_SCHEMA='static-weekly.opening-planned-coverage-report.v1';
export const OPENING_DIAGNOSTIC_SCHEMA='static-weekly.opening-coverage-diagnostic.v1';
export const OPENING_COVERAGE_ERROR='static_weekly_opening_essential_facts_invalid';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hash=/^[0-9a-f]{64}$/;
const reasons=new Set(['source_invalid','context_invalid','assignment_identity_invalid','assignment_set_mismatch',
 'work_identity_mismatch','owner_identity_mismatch','owner_not_eligible','member_identity_invalid',
 'source_binding_mismatch','report_binding_mismatch','availability_binding_mismatch','lunch_binding_mismatch']);
const id=x=>typeof x==='string'&&uuid.test(x)?x:null;
const hex=x=>typeof x==='string'&&hash.test(x)?x:null;
const clone=x=>structuredClone(x);
const minute=x=>{if(typeof x!=='string'||!/^\d\d:\d\d$/.test(x))return null;
 const [h,m]=x.split(':').map(Number);return h<=24&&m<60&&(h<24||m===0)?h*60+m:null;};
const window=x=>({start:x?.start??null,end:x?.end??null});
const same=(a,b)=>digest(a)===digest(b);
const array=x=>Array.isArray(x)?x:[];
const safeDate=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)?x:null;

export function sanitizeOpeningCoverageDiagnostic(value){
 if(value?.schema!==OPENING_DIAGNOSTIC_SCHEMA||value.nonAdmissible!==true||!Array.isArray(value.findings))return null;
 const findings=value.findings.slice(0,24).filter(x=>reasons.has(x?.code)).map(x=>({
  code:x.code,serviceDate:safeDate(x.serviceDate),locationId:id(x.locationId),slotId:id(x.slotId)}));
 if(!findings.length)return null;
 return {schema:OPENING_DIAGNOSTIC_SCHEMA,nonAdmissible:true,
  sourceDigest:hex(value.sourceDigest),publicationId:id(value.publicationId),
  authorityRevision:Number.isSafeInteger(value.authorityRevision)&&value.authorityRevision>=0?value.authorityRevision:null,
  findings,physicalDurationFacts:'NOT_ESTABLISHED_NONBLOCKING',performedReadinessProven:false};
}
function invalid(code,context={},row={}){
 const error=Object.assign(new Error('Opening planned coverage in the complete manager decision could not be bound to its existing essential source facts. Nothing was admitted or published.'),{code:OPENING_COVERAGE_ERROR});
 error.openingCoverageDiagnostic=sanitizeOpeningCoverageDiagnostic({schema:OPENING_DIAGNOSTIC_SCHEMA,nonAdmissible:true,
  sourceDigest:context.sourceDigest,publicationId:context.publicationId,authorityRevision:context.authorityRevision,
  findings:[{code,serviceDate:row.serviceDate,locationId:row.locationId,slotId:row.slotId}]});
 throw error;
}
function unionMinutes(intervals,start,end){
 const sorted=intervals.map(w=>[Math.max(start,minute(w?.start)??end),Math.min(end,minute(w?.end)??start)])
  .filter(([a,b])=>b>a).sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
 let total=0,right=start;for(const [a,b]of sorted){total+=Math.max(0,b-Math.max(a,right));right=Math.max(right,b);}return total;
}
function normalizeSource(source){
 if(!source||typeof source!=='object'||Array.isArray(source)||!!source.version===!!source.versions)invalid('source_invalid');
 const input=clone(source);if(input.version){input.versions=[input.version];delete input.version;}return input;
}
const ledger=getScheduleComponentWeightLedger();
const weightByPhysical=new Map(ledger.families.flatMap(f=>f.components.map(c=>[c.locationId,c.weight])));
const responseById=new Map(ledger.families.filter(f=>f.serviceMode==='response_only_no_clean').map(f=>[f.primaryLocationId,f.aggregateWeight]));

// Uses existing canonical preparation/eligibility, not a solve. Final overlays and
// original immutable source are regenerated in the same way as compiler/verifier.
export function createOpeningCoverageReport({source,assignments,lunch,context={},decisionDigest=null}){
 const sourceDigest=digest(source),bound={...context,sourceDigest};
 if(context.sourceDigest!=null&&context.sourceDigest!==sourceDigest)invalid('source_binding_mismatch',bound);
 if(context.publicationId!=null&&!id(context.publicationId)
  ||context.authorityRevision!=null&&(!Number.isSafeInteger(context.authorityRevision)||context.authorityRevision<0)
  ||decisionDigest!=null&&!hex(decisionDigest))invalid('context_invalid',bound);
 let problem;try{problem=prepareStaticWeeklySchedulingProblem(normalizeSource(source));}catch{invalid('source_invalid',bound);}
 if(problem.error)invalid('source_invalid',bound);
 if(!Array.isArray(assignments)||!assignments.length||!lunch||!Array.isArray(lunch.loans)||!Array.isArray(lunch.responsibilities))invalid('source_invalid',bound);
 const byWork=new Map(problem.work.map(w=>[w.key,w])),seen=new Set(),availability=[];
 for(const [day,state]of problem.states)for(const av of state.availability.values()){
  const incumbent=problem.incumbencyByDaySlot.get(`${day}\u0000${av.slotId}`)||null;
  availability.push({dayOfWeek:day,serviceDate:weekdayDate(problem.serviceDate,day),slotId:av.slotId,
   status:av.status,shift:window(av.shift),lunch:av.lunch?window(av.lunch):null,blockedWindows:array(av.blockedWindows).map(window),
   personId:incumbent?.personId??null,ownerKind:incumbent?(incumbent.kind==='CONTRACTOR_CAPACITY'?'CONTRACTOR_CAPACITY':'EMPLOYEE'):null,
   capacityId:incumbent?.capacityId??null,qualifications:array(av.qualifications),restrictions:array(av.restrictions)});
 }
 availability.sort((a,b)=>a.serviceDate.localeCompare(b.serviceDate)||a.slotId.localeCompare(b.slotId));
 const ownerRows=new Map(),rows=[];
 // Include working source positions even when their explicit pre09 load is
 // zero. Clock availability is not a physical service-duration estimate.
 for(const av of availability.filter(a=>a.status==='working'&&a.ownerKind!==null)){
  const from=Math.max(0,minute(av.shift.start)),to=Math.min(540,minute(av.shift.end));
  ownerRows.set(`${av.serviceDate}:${av.slotId}`,{serviceDate:av.serviceDate,slotId:av.slotId,
   personId:av.personId,capacityId:av.capacityId,ownerKind:av.ownerKind,shift:av.shift,lunch:av.lunch,
   availablePre09ClockMinutes:Math.max(0,to-from-unionMinutes([...av.blockedWindows,...(av.lunch?[av.lunch]:[])],from,to)),
   knownComponentWeightSubtotal:0,componentLoadComplete:true,workIds:[],unweightedLocationIds:[],inheritedWorkloadPoints:0});
 }
 for(const row of assignments){
  const work=byWork.get(row?.planWorkId);
  if(!work||seen.has(row.planWorkId))invalid('assignment_identity_invalid',bound,row);seen.add(row.planWorkId);
  if(row.workId!==work.workId||row.serviceDate!==weekdayDate(problem.serviceDate,work.dayOfWeek)
   ||row.locationId!==work.locationId||!same(window(row.window),window(work.window))
   ||row.workSnapshot?.serviceMode!==work.serviceMode
   ||!same(row.workSnapshot?.includedLocations,work.includedLocations))invalid('work_identity_mismatch',bound,row);
  if(!['ASSIGNED','OPEN','REVIEW'].includes(row.status))invalid('assignment_identity_invalid',bound,row);
  if(row.status==='ASSIGNED'){
   const incumbent=problem.incumbencyByDaySlot.get(`${work.dayOfWeek}\u0000${row.slotId}`);
   if(!incumbent||row.personId!==(incumbent.personId??null)
    ||(row.ownerKind??'EMPLOYEE')!==(incumbent.kind==='CONTRACTOR_CAPACITY'?'CONTRACTOR_CAPACITY':'EMPLOYEE')
    ||(row.capacityId??null)!==(incumbent.capacityId??null))invalid('owner_identity_mismatch',bound,row);
   if(!problem.candidates.some(c=>c.item.key===work.key&&c.slot.id===row.slotId))invalid('owner_not_eligible',bound,row);
  }else if(row.slotId!=null||row.personId!=null||row.capacityId!=null)invalid('owner_identity_mismatch',bound,row);
  const start=minute(work.window.start),end=minute(work.window.end);
  if(start==null||end==null)invalid('work_identity_mismatch',bound,row);
  if(start>=540||end<=0)continue;
  const physical=array(work.includedLocations).map(m=>m.locationId);
  if(new Set(physical).size!==physical.length||physical.some(x=>!id(x)))invalid('member_identity_invalid',bound,row);
  const weights=physical.map(locationId=>({locationId,weight:weightByPhysical.get(locationId)??null}));
  // Response-only identities are explicit nonphysical source capabilities.
  const responseWeight=work.serviceMode==='response_only_no_clean'?responseById.get(work.locationId)??null:null;
  const knownWeight=weights.reduce((n,m)=>n+(m.weight??0),0)+(responseWeight??0);
  const unknownIds=physical.length?weights.filter(m=>m.weight==null).map(m=>m.locationId)
   :responseWeight==null?[work.locationId]:[];
  const unweighted=physical.length?unknownIds.length>0:responseWeight==null;
  const item={planWorkId:row.planWorkId,workId:row.workId,serviceDate:row.serviceDate,locationId:row.locationId,
   locationName:typeof work.locationNameSnapshot==='string'?work.locationNameSnapshot.slice(0,160):null,
   responsibilityWindow:window(work.window),pre09Intersection:{start:work.window.start,end:end>540?'09:00':work.window.end},
   sourceRequired:work.sourceRequired,required:work.required,coverageClass:work.coverageClass,status:row.status,
   slotId:row.slotId??null,personId:row.personId??null,ownerKind:row.ownerKind??(row.slotId?'EMPLOYEE':null),capacityId:row.capacityId??null,
   serviceMode:work.serviceMode,physicalMembers:weights,responseOnlyWeight:responseWeight,
   knownComponentWeight:knownWeight,componentLoadComplete:!unweighted,unweightedLocationIds:unknownIds,
   inheritedWorkloadPoints:work.effort.minutes,performedWorkCategory:'NOT_INFERRED',physicalDurationMinutes:null};
  rows.push(item);
  if(row.status==='ASSIGNED'){
   const key=`${row.serviceDate}:${row.slotId}`,av=availability.find(a=>a.serviceDate===row.serviceDate&&a.slotId===row.slotId);
   if(!av||av.status!=='working')invalid('owner_not_eligible',bound,row);
   let owner=ownerRows.get(key);
   if(!owner){
    const shiftStart=minute(av.shift.start),shiftEnd=minute(av.shift.end),from=Math.max(0,shiftStart),to=Math.min(540,shiftEnd);
    const blocked=unionMinutes([...av.blockedWindows,...(av.lunch?[av.lunch]:[])],from,to);
    owner={serviceDate:row.serviceDate,slotId:row.slotId,personId:row.personId??null,capacityId:row.capacityId??null,ownerKind:item.ownerKind,
     shift:av.shift,lunch:av.lunch,availablePre09ClockMinutes:Math.max(0,to-from-blocked),
     knownComponentWeightSubtotal:0,componentLoadComplete:true,workIds:[],unweightedLocationIds:[],inheritedWorkloadPoints:0};
    ownerRows.set(key,owner);
   }
   owner.knownComponentWeightSubtotal+=knownWeight;owner.componentLoadComplete&&=!unweighted;
   owner.workIds.push(row.planWorkId);owner.unweightedLocationIds.push(...unknownIds);owner.inheritedWorkloadPoints+=work.effort.minutes;
  }
 }
 if(seen.size!==byWork.size)invalid('assignment_set_mismatch',bound);
 rows.sort((a,b)=>a.serviceDate.localeCompare(b.serviceDate)||a.planWorkId.localeCompare(b.planWorkId));
 const lunchFacts={loans:lunch.loans,responsibilities:lunch.responsibilities,notification_intents:array(lunch.notification_intents)};
 const handoffs=lunch.responsibilities.filter(r=>minute(r.coverage_start)<540&&minute(r.coverage_end)>0).map(r=>({
  serviceDate:r.service_date,normalOwnerSlotId:r.normal_owner_slot_id??null,covererSlotId:r.coverer_slot_id??null,
  covererPersonId:r.coverer_person_id??null,covererCapacityId:r.coverer_capacity_id??null,
  window:{start:r.coverage_start,end:r.coverage_end},createsDeepClean:r.creates_deep_clean===true,
  segments:array(r.segments).map(s=>({workId:s.workId??null,window:window(s.window),
   physicalLocationIds:array(s.includedLocations).map(m=>m.locationId)}))}));
 const loanStatuses=lunch.loans.filter(r=>minute(r.coverage_start)<540&&minute(r.coverage_end)>0).map(r=>({
  serviceDate:r.service_date,normalOwnerSlotId:r.normal_owner_slot_id??null,status:r.status,
  window:{start:r.coverage_start,end:r.coverage_end}}));
 const dates=[...new Set(assignments.map(r=>r.serviceDate))].sort();
 const body={schema:OPENING_COVERAGE_SCHEMA,scope:'EXPLICIT_PREVIEW_DATES_ONLY_NOT_OPEN_ENDED_FUTURE_VALIDATION',
  sourceDigest,overlayDigest:digest(problem.canonicalInput),decisionDigest,assignmentDigest:digest(assignments),
  availabilityDigest:digest(availability),lunchDigest:digest(lunchFacts),ledgerDigest:COMPONENT_WEIGHT_LEDGER_DIGEST,
  publicationId:context.publicationId??null,authorityRevision:context.authorityRevision??null,
  timezone:'America/Chicago',serviceDates:dates,horizon:{first:dates[0],last:dates.at(-1)},
  componentWeightUnit:COMPONENT_WEIGHT_UNIT,inheritedWorkloadUnit:INHERITED_WORKLOAD_UNIT,
  physicalDurationFacts:'NOT_ESTABLISHED_NONBLOCKING',performedReadinessProven:false,timeFeasibilityClaimRequested:false,
  tasksCreated:false,sourceMutated:false,admitted:false,published:false,
  rows,owners:[...ownerRows.values()].sort((a,b)=>a.serviceDate.localeCompare(b.serviceDate)||a.slotId.localeCompare(b.slotId)),
  lunchHandoffs:handoffs,lunchStatuses:loanStatuses,gaps:rows.filter(r=>r.status!=='ASSIGNED').map(r=>({
   planWorkId:r.planWorkId,serviceDate:r.serviceDate,status:r.status,required:r.required,coverageClass:r.coverageClass}))};
 return {...body,reportDigest:digest(body)};
}
export function assertOpeningCoverageReport(report,expected={}){
 const {reportDigest,...body}=report||{};
 if(body.schema!==OPENING_COVERAGE_SCHEMA||!hex(reportDigest)||digest(body)!==reportDigest
  ||body.performedReadinessProven!==false||body.timeFeasibilityClaimRequested!==false||body.tasksCreated!==false
  ||body.sourceMutated!==false||body.admitted!==false||body.published!==false||body.timezone!=='America/Chicago'
  ||body.componentWeightUnit!==COMPONENT_WEIGHT_UNIT||body.inheritedWorkloadUnit!==INHERITED_WORKLOAD_UNIT
  ||body.ledgerDigest!==COMPONENT_WEIGHT_LEDGER_DIGEST
  ||body.physicalDurationFacts!=='NOT_ESTABLISHED_NONBLOCKING')invalid('report_binding_mismatch',expected);
 for(const key of ['sourceDigest','decisionDigest','assignmentDigest','publicationId','authorityRevision'])
  if(Object.hasOwn(expected,key)&&body[key]!==expected[key])invalid('report_binding_mismatch',expected);
 return true;
}
export function assertOpeningCoverageDecisionReport(candidate){
 assertOpeningCoverageReport(candidate?.openingCoverageReport,{sourceDigest:candidate?.candidateSourceDigest,
  decisionDigest:candidate?.decisionDigest,assignmentDigest:candidate?.weeklyAssignmentsDigest,
  publicationId:candidate?.publicationId,authorityRevision:candidate?.authorityRevision});
}
export function assertOpeningCoverageCanonicalReport(candidate,source){
 const expected=createOpeningCoverageReport({source,assignments:candidate.decision.assignments,
  lunch:{loans:candidate.decision.fixedLunch.loans,responsibilities:candidate.decision.fixedLunch.responsibilities,
   notification_intents:candidate.decision.fixedLunch.notificationIntents},context:{
   publicationId:candidate.publicationId,authorityRevision:candidate.authorityRevision},decisionDigest:candidate.decisionDigest});
 if(!same(candidate.openingCoverageReport,expected))invalid('report_binding_mismatch',expected);
 return true;
}
