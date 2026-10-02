// Planning inputs only. No model construction, solve, prospective assignment,
// policy selection, publication or opening-readiness certificate occurs here.
import {canonicalJson, snapshotDatedRosterSlot, assertServiceDate, normalizeWindow,selectEffectiveWeeklyVersion,
 bytewiseCompare} from './static-weekly-schedule-model.js';
import {admitStaticWeeklyRawInput, normalizeStaticWeeklyAuthority, weekdayDate,
 STATIC_WEEKLY_SERVER_LIMITS, postgresJsonbContentDigest as digest} from './static-weekly-schedule-program.js';
import {validateOwnerEligibilityConfig, normalGeographyRestrictionApplies} from './static-weekly-owner-eligibility.js';
import {getScheduleComponentWeightLedger, COMPONENT_WEIGHT_LEDGER_DIGEST,
 COMPONENT_WEIGHT_UNIT, INHERITED_WORKLOAD_UNIT} from './schedule-component-weight-authority.js';

export const MORNING_PLANNING_SCHEMA='custodial.morning-planning-authority.v1';
export const MORNING_PLANNING_ERROR='static_weekly_morning_authority_invalid';
const scopes=['ACCEPTED_PATTERN_PRESERVED','DATED_RECOVERY','NEW_RECURRING_MORNING_DESIGN'];
const hex=/^[0-9a-f]{64}$/, uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const requireFact=(ok,reason)=>{if(!ok)throw Object.assign(new Error(`Morning planning inputs: ${reason}`),{code:MORNING_PLANNING_ERROR,reason});};
const same=(a,b)=>canonicalJson(a)===canonicalJson(b);
const sorted=x=>[...x].sort(bytewiseCompare);
const clone=x=>structuredClone(x);
const ledger=getScheduleComponentWeightLedger();
const families=new Map(ledger.families.map(f=>[f.code,f]));
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
function jsonInput(value){
 const admission=admitStaticWeeklyRawInput(value);
 requireFact(!admission.code,`raw_${admission.code||'invalid'}`);
 // Also refuse invisible properties/toJSON: the existing raw resource guard
 // bounds this traversal, but its enumerable walk is not an identity contract.
 const walk=x=>{if(!x||typeof x!=='object')return;
  for(const key of Reflect.ownKeys(x)){
   if(Array.isArray(x)&&key==='length')continue;
   const d=Object.getOwnPropertyDescriptor(x,key);
   requireFact(typeof key==='string'&&d.enumerable&&Object.hasOwn(d,'value')
    &&(!Array.isArray(x)||/^(0|[1-9]\d*)$/.test(key)),'non_json_property');walk(d.value);
  }
 };walk(value);
}
function exact(value,keys,reason){requireFact(value&&typeof value==='object'&&!Array.isArray(value)
 &&same(sorted(Object.keys(value)),sorted(keys)),reason);}
function unique(values,reason){requireFact(new Set(values).size===values.length,reason);}
function pre09Minutes(shift,blocked){
 const w=normalizeWindow(shift),start=w.startMinute,end=Math.min(540,w.endMinute);
 if(end<=start)return 0;
 const intervals=blocked.map(x=>normalizeWindow(x)).map(x=>[Math.max(start,x.startMinute),Math.min(end,x.endMinute)])
  .filter(([a,b])=>a<b).sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
 let removed=0,right=start;for(const [a,b]of intervals){removed+=Math.max(0,b-Math.max(a,right));right=Math.max(right,b);}
 return end-start-removed;
}
function packageFact(row,config){
 requireFact(typeof row.workId==='string'&&row.workId.length>0&&uuid.test(row.locationId),'work_identity');
 requireFact(row.schedulingMode==='flexible_coverage_ownership','timed_morning_unsupported');
 requireFact(Array.isArray(row.includedLocations),'members_missing');
 unique(row.includedLocations.map(m=>m.locationId),'duplicate_member');
 requireFact(row.includedLocations.every(m=>uuid.test(m.locationId)),'member_identity');
 requireFact(!config.retiredAreaFamilies?.includes(row.locationCodeSnapshot),'retired_family');
 requireFact(Number.isSafeInteger(config.weights[row.locationCodeSnapshot]*2)
  &&config.weights[row.locationCodeSnapshot]>0,'explicit_config_weight_missing');
 const known=families.get(row.locationCodeSnapshot);
 if(known){
  requireFact(known.primaryLocationId===row.locationId&&known.serviceMode===row.serviceMode,'known_family_identity');
  requireFact(config.weights[row.locationCodeSnapshot]===known.aggregateWeight,'known_family_weight');
  // Preserve a genuine split's exact subset. Never charge the whole package
  // aggregate for one physical member, or silently fill omitted members.
  const ids=new Set(known.components.map(m=>m.locationId));
  requireFact(row.includedLocations.every(m=>ids.has(m.locationId)),'foreign_family_member');
  requireFact(known.serviceMode!=='response_only_no_clean'||row.includedLocations.length===0,'response_has_members');
 }
 requireFact(Number.isSafeInteger(row.serviceEffortMinutes)&&row.serviceEffortMinutes>0
  &&typeof row.serviceEffortProvenance==='string'&&row.serviceEffortProvenance.length>0,'inherited_points_missing');
 const members=row.includedLocations.map(m=>({...clone(m),componentWeight:known?.components.find(c=>c.locationId===m.locationId)?.weight??null}));
 const responseWeight=known?.serviceMode==='response_only_no_clean'?known.aggregateWeight:null;
 const complete=members.length?members.every(m=>m.componentWeight!==null):responseWeight!==null;
 const w=normalizeWindow(row.window);
 return {workId:row.workId,sourceRowDigest:digest(row),sourceRow:clone(row),
  family:row.locationCodeSnapshot,primaryLocationId:row.locationId,physicalMembers:members,
  responsibilityWindow:clone(row.window),pre09Intersection:w.startMinute<540?{start:row.window.start,end:w.endMinute>540?'09:00':row.window.end}:null,
  openingCriticalClassification:null,openingClassificationAuthority:'MISSING_NOT_INFERRED_FROM_FAMILY_OR_WINDOW',
  knownComponentWeight:members.reduce((sum,m)=>sum+(m.componentWeight??0),0)+(responseWeight??0),
  componentLoadComplete:complete,responseOnlyWeight:responseWeight,
  configAggregateWeight:config.weights[row.locationCodeSnapshot]??null,
  inheritedWorkloadPoints:row.serviceEffortMinutes,physicalDurationMinutes:null,performedWorkCategory:'NOT_INFERRED'};
}

/** bindings must come from the caller's independently held source/config, not
 * from a received descriptor. They bind inputs; they do NOT authenticate a
 * manager, prove current publication or authorize a recurring change. Dated
 * output deliberately retains baseline facts plus raw canonical exceptions;
 * a later consumer MUST use canonical dated preparation, not these baseline
 * rows, to decide effective ownership/availability/candidates. */
export function createMorningPlanningDescriptor(input){
 try{return derive(input);}catch(error){if(error.code===MORNING_PLANNING_ERROR)throw error;
  throw Object.assign(new Error('Morning planning inputs: canonical_source_invalid'),{code:MORNING_PLANNING_ERROR,reason:'canonical_source_invalid'});}
}
function derive(input){
 jsonInput(input);
 exact(input,['source','ownerConfig','bindings','scope','dayOfWeek','selectedWorkIds'],'input_fields');
 const {source,ownerConfig:config,bindings,scope,dayOfWeek,selectedWorkIds}=input;
 exact(bindings,['sourceDigest','ownerConfigDigest'],'binding_fields');
 requireFact(hex.test(bindings.sourceDigest)&&hex.test(bindings.ownerConfigDigest)
  &&bindings.sourceDigest===digest(source)&&bindings.ownerConfigDigest===digest(config),'source_config_binding');
 requireFact(scopes.includes(scope)&&Number.isInteger(dayOfWeek)&&dayOfWeek>=0&&dayOfWeek<=6,'scope_or_day');
 requireFact(Array.isArray(selectedWorkIds)&&selectedWorkIds.every(x=>typeof x==='string'),'selection');unique(selectedWorkIds,'duplicate_selection');
 requireFact(source.version&&!source.versions&&Array.isArray(source.version.assignments)
  &&Array.isArray(source.version.slotAvailability)&&Array.isArray(source.slots)
  &&Array.isArray(source.exceptions)&&Array.isArray(source.proximity),'canonical_raw_shape');
 requireFact(source.version.assignments.length>0&&source.version.assignments.length<=STATIC_WEEKLY_SERVER_LIMITS.maxWorkItems,'assignment_count');
 const dated=scope==='DATED_RECOVERY',design=scope==='NEW_RECURRING_MORNING_DESIGN';
 requireFact(dated?source.exceptions.length>0:source.exceptions.length===0,'scope_exception_mismatch');
 requireFact(design?selectedWorkIds.length>0:selectedWorkIds.length===0,'scope_selection_mismatch');
 validateOwnerEligibilityConfig(config);
 requireFact(config.allowAdminMorning===true,'current_admin_correction_required');
 assertServiceDate(source.serviceDate);
 const canonical=normalizeStaticWeeklyAuthority(source.version,source.slots,source.exceptions,source.proximity,source.serviceDate);
 const v=canonical.version,date=weekdayDate(source.serviceDate,dayOfWeek);
 selectEffectiveWeeklyVersion([v],date);
 requireFact(uuid.test(v.id)&&uuid.test(v.publicationId),'source_version_identity');
 unique(v.assignments.map(r=>r.workId),'duplicate_work_identity');
 unique(canonical.slots.map(s=>s.id),'duplicate_slot_identity');
 unique(v.slotAvailability.map(a=>`${a.dayOfWeek}:${a.slotId}`),'duplicate_availability');
 const configured=Object.entries(config.slots).map(([key,c])=>({key,...c}));
 unique(configured.map(c=>c.slotId),'duplicate_config_slot');
 requireFact(configured.length>0,'empty_roster');
 const ordinary=new Map(configured.map(c=>[c.slotId,c]));
 const baselineRoster=configured.map(c=>{
  const slot=canonical.slots.find(s=>s.id===c.slotId);requireFact(slot&&!slot.contractorCapacity&&!slot.kind,'ordinary_slot_required');
  const incumbent=snapshotDatedRosterSlot(slot,date,{vacancyCapable:v.vacancyCapableSlotIds.includes(c.slotId),declaredVacant:v.vacantSlotIds.includes(c.slotId)});
  requireFact(incumbent.personId===(c.personId??null)&&incumbent.displayName===(c.name??null)
   &&Boolean(incumbent.vacant)===Boolean(c.vacancy),'current_incumbent_config');
  requireFact(Array.isArray(c.workDays),'config_workdays');unique(c.workDays,'duplicate_workday');
  const av=v.slotAvailability.find(a=>a.dayOfWeek===dayOfWeek&&a.slotId===c.slotId);
  requireFact(Boolean(av)===c.workDays.includes(dayOfWeek),'day_availability_config');
  if(av){
   requireFact(av.status===(c.vacancy?'vacant_unfilled':'working'),'baseline_status_config');
   requireFact(same(c.shift,[av.shift.start,av.shift.end]),'shift_config');
   requireFact(same(c.lunchByDay?.[String(dayOfWeek)]||c.lunch,[av.lunch.start,av.lunch.end]),'lunch_config');
   normalizeWindow(av.shift);normalizeWindow(av.lunch);
  }
  return {key:c.key,...incumbent,baselineStatus:av?.status??'OFF_SOURCE_DAY',
   baselineAvailability:av?clone(av):null,sourceIncumbencies:clone(slot.incumbencies),
   baselineAvailablePre09ClockMinutes:av?.status==='working'?pre09Minutes(av.shift,[av.lunch,...(av.blockedWindows||[])]):0,
   effectiveAvailablePre09ClockMinutes:dated?null:av?.status==='working'?pre09Minutes(av.shift,[av.lunch,...(av.blockedWindows||[])]):0,
   normalGeographyApplies:normalGeographyRestrictionApplies(c),
   normalAssignmentFamilies:clone(c.normalAssignmentFamilies||[]),hardForbiddenFamilies:clone(c.hardForbiddenFamilies||[])};
 }).sort((a,b)=>bytewiseCompare(a.slotId,b.slotId));
 requireFact(v.slotAvailability.filter(a=>a.dayOfWeek===dayOfWeek).every(a=>ordinary.has(a.slotId)),'unbound_baseline_capacity');
 const morning=v.assignments.filter(r=>r.dayOfWeek===dayOfWeek&&normalizeWindow(r.window).startMinute<585
  &&normalizeWindow(r.window).endMinute<=585);
 const crossBoundary=v.assignments.filter(r=>r.dayOfWeek===dayOfWeek&&normalizeWindow(r.window).startMinute<585
  &&normalizeWindow(r.window).endMinute>585);
 requireFact(morning.length>0,'morning_rows_missing');
 requireFact(selectedWorkIds.every(id=>morning.some(r=>r.workId===id)),'non_morning_selection');
 const packages=morning.map(r=>{
  const owner=baselineRoster.find(o=>o.slotId===(r.originSlotId||r.ownerSlotId));
  requireFact(owner?.baselineStatus==='working'&&owner.personId,'baseline_owner_not_working');
  requireFact(!r.ownerSlotId||r.ownerSlotId===owner.slotId,'baseline_owner_alias');
  return {...packageFact(r,config),baselineOwner:{slotId:owner.slotId,personId:owner.personId},
   effectiveOwner:dated?null:{slotId:owner.slotId,personId:owner.personId}};
 });
 for(const e of canonical.proximity)requireFact(uuid.test(e.fromLocationId)&&uuid.test(e.toLocationId)
  &&typeof e.minutes==='number'&&Number.isFinite(e.minutes)&&e.minutes>=0
  &&typeof e.provenance==='string'&&e.provenance.length>0&&typeof e.verified==='boolean','directed_edge_shape');
 unique(canonical.proximity.map(e=>`${e.fromLocationId}:${e.toLocationId}`),'ambiguous_directed_edge');
 const body={schema:MORNING_PLANNING_SCHEMA,scope,dayOfWeek,serviceDate:date,timezone:'America/Chicago',
  sourceDigest:bindings.sourceDigest,ownerConfigDigest:bindings.ownerConfigDigest,canonicalAuthorityDigest:digest(canonical),
  sourceIdentity:{versionId:v.id,publicationId:v.publicationId,declaredStatus:v.status??null,authorityAuthenticatedHere:false},
  selectedWorkIds:sorted(selectedWorkIds),fixedSourceRowsDigest:digest(v.assignments.filter(r=>!selectedWorkIds.includes(r.workId))),
  baselineRoster,packages,unclassifiedCrossBoundaryRows:crossBoundary.map(r=>({sourceRow:clone(r),sourceRowDigest:digest(r)})),
  exceptions:clone(canonical.exceptions),exceptionDigest:digest(canonical.exceptions),
  datedOverlayApplied:false,effectiveCandidateSet:null,
  directedProximity:{edges:clone(canonical.proximity),digest:digest(canonical.proximity),
   interpretation:'SOURCE_DIRECTED_ADVISORY_COST_NOT_LIVE_GPS_OR_PHYSICAL_TRAVEL_PROOF',symmetrized:false},
  ledgerDigest:COMPONENT_WEIGHT_LEDGER_DIGEST,componentWeightUnit:COMPONENT_WEIGHT_UNIT,inheritedWorkloadUnit:INHERITED_WORKLOAD_UNIT,
  openingGoalLocal:'09:00',responsibilityPhaseBoundaryLocal:'09:45',sourceWindowsTruncated:false,
  intendedNewMorningPriority:['OPENING_READINESS','GEOGRAPHY_PROXIMITY','WORKLOAD_BALANCE'],
  priorityApplied:false,datedOptimizerUnchanged:true,acceptedPatternReoptimized:false,
  cleaningPolicy:{allowedAccordingToActualNeed:['FULL','SELECTIVE','CHECK_ONLY'],compulsoryFull:false,inspectionRecording:false,performedCategoryInferred:false},
  adminPolicy:{allowAdminMorning:config.allowAdminMorning,adminFamilies:clone(config.adminFamilies),retiredAreaFamilies:clone(config.retiredAreaFamilies)},
  missingAuthority:['OPENING_CRITICAL_CLASSIFICATION_AND_PLANNING_PREDICATE','DIRECTED_GEOGRAPHY_OBJECTIVE_AND_PROOF',
   'CLOSEST_FEASIBLE_START_LADDER_METRIC_AND_PROOF','CANONICAL_CANDIDATE_FEASIBILITY_AND_CURRENT_MANAGER_ADMISSION',
   ...(packages.some(p=>!p.componentLoadComplete)?['COMPLETE_PHYSICAL_COMPONENT_WEIGHT_ALLOCATION']:[]),
   ...(crossBoundary.length?['CROSS_BOUNDARY_RESPONSIBILITY_CLASSIFICATION']:[]),
   ...(dated?['CANONICAL_DATED_OVERLAY_APPLICATION']:[])],
  planningInputsOnly:true,sourceMutated:false,solverExecuted:false,optimalityProven:false,openingReadinessProven:false,
  physicalMinuteFeasibilityClaim:false,admitted:false,published:false,fullRecordClosed:false};
 return freeze({...body,descriptorDigest:digest(body)});
}
/** No self-hash-only acceptance. Scope, selection and bindings are supplied
 * independently, never read from the potentially hostile descriptor. */
export function assertMorningPlanningDescriptor(descriptor,input){
 jsonInput(descriptor);
 requireFact(same(descriptor,createMorningPlanningDescriptor(input)),'descriptor_recomputation_mismatch');
 return true;
}
