import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {installStaticWeeklySha256HexAccelerator} from '../src/static-weekly-schedule-model.js';
import {postgresJsonbContentDigest as digest} from '../src/static-weekly-schedule-program.js';
import {createMorningPlanningDescriptor as create,assertMorningPlanningDescriptor as verify,
 MORNING_PLANNING_SCHEMA,MORNING_PLANNING_ERROR} from '../src/static-weekly-morning-planning-authority.js';
const sha=x=>createHash('sha256').update(x).digest('hex');
const clone=x=>structuredClone(x);
// These existing fixtures are read only. No generator, model, solver or retained
// host-only packet dependency. Synthetic source identity is not publication.
const read=path=>JSON.parse(fs.readFileSync(new URL(path,import.meta.url)));
function inputFor(source,ownerConfig,scope='ACCEPTED_PATTERN_PRESERVED',selectedWorkIds=[]){
 return {source,ownerConfig,bindings:{sourceDigest:digest(source),ownerConfigDigest:digest(ownerConfig)},
  scope,dayOfWeek:1,selectedWorkIds};
}
export function runMorningPlanningAuthorityTests(){
 installStaticWeeklySha256HexAccelerator(sha);
 let checks=0;
 const check=(a,b,label)=>{assert.deepEqual(a,b,label);checks++;};
 const rejects=(fn,label)=>{assert.throws(fn,e=>e.code===MORNING_PLANNING_ERROR,label);checks++;};
 const source=read('./fixtures/six-person-absence-source.json').compilerInput;
 const config=read('../config/custodial-six-person-static-20261005.json');
 const sourceBefore=JSON.stringify(source),configBefore=JSON.stringify(config);
 const input=inputFor(source,config),report=create(input);
 check(report.schema,MORNING_PLANNING_SCHEMA);check(verify(report,input),true);
 check(report.sourceDigest,digest(source));check(report.ownerConfigDigest,digest(config));
 check(report.sourceIdentity.authorityAuthenticatedHere,false);
 check(report.openingGoalLocal,'09:00');check(report.responsibilityPhaseBoundaryLocal,'09:45');
 check(report.packages.every(p=>p.responsibilityWindow.end==='09:45'),true);
 check(report.packages.every(p=>p.pre09Intersection?.end==='09:00'),true);
 check(report.packages.every(p=>p.openingCriticalClassification===null),true);
 check(report.packages.every(p=>p.physicalDurationMinutes===null&&p.performedWorkCategory==='NOT_INFERRED'),true);
 check(report.componentWeightUnit,'dimensionless_owner_component_weight');
 check(report.inheritedWorkloadUnit,'dimensionless_production_workload_points');
 check(report.packages.some(p=>!p.componentLoadComplete),true);
 check(report.packages.filter(p=>!p.componentLoadComplete).every(p=>p.physicalMembers.some(m=>m.componentWeight===null)),true);
 check(report.directedProximity.edges.length,source.proximity.length);
 check(report.directedProximity.symmetrized,false);
 check(report.adminPolicy.allowAdminMorning,true);check(report.adminPolicy.adminFamilies,config.adminFamilies);
 check(report.cleaningPolicy.allowedAccordingToActualNeed,['FULL','SELECTIVE','CHECK_ONLY']);
 check(report.cleaningPolicy.compulsoryFull,false);check(report.cleaningPolicy.inspectionRecording,false);
 check(report.baselineRoster.length,Object.keys(config.slots).length);
 const tammy=report.baselineRoster.find(x=>x.key==='TAMMY');
 check(tammy.baselineAvailablePre09ClockMinutes,210); //05:00-09:00 less08:30-09:00 fixed lunch
 check(tammy.baselineAvailability.lunch,{start:'08:30',end:'09:30'});
 check(tammy.normalGeographyApplies,true);
 check(report.baselineRoster.filter(x=>x.vacant).every(x=>x.personId===null&&x.effectiveAvailablePre09ClockMinutes===0),true);
 check(report.baselineRoster.find(x=>x.key==='KATHY').baselineStatus,'OFF_SOURCE_DAY');
 check(report.effectiveCandidateSet,null);
 check(report.missingAuthority.includes('COMPLETE_PHYSICAL_COMPONENT_WEIGHT_ALLOCATION'),true);
 const thursday=create({...input,dayOfWeek:4});
 check(thursday.baselineRoster.find(x=>x.key==='KATHY').baselineAvailability.lunch,{start:'10:00',end:'11:00'});
 check(thursday.packages.some(x=>config.adminFamilies.includes(x.family)),true);
 check(thursday.packages.filter(x=>config.adminFamilies.includes(x.family)).every(x=>x.openingCriticalClassification===null),true);
 for(const key of ['sourceMutated','solverExecuted','optimalityProven','openingReadinessProven',
  'physicalMinuteFeasibilityClaim','admitted','published','fullRecordClosed','priorityApplied','acceptedPatternReoptimized'])check(report[key],false,key);
 check(report.missingAuthority.includes('CLOSEST_FEASIBLE_START_LADDER_METRIC_AND_PROOF'),true);
 check(Object.isFrozen(report)&&Object.isFrozen(report.packages[0].sourceRow)&&Object.isFrozen(report.directedProximity.edges),true);
 assert.throws(()=>report.packages[0].physicalDurationMinutes=1,TypeError);checks++;
 const selected=report.packages.slice(0,2).map(p=>p.workId);
 const designInput=inputFor(source,config,'NEW_RECURRING_MORNING_DESIGN',selected),design=create(designInput);
 check(design.selectedWorkIds,[...selected].sort());check(verify(design,designInput),true);
 check(design.packages,report.packages);check(design.fixedSourceRowsDigest!==report.fixedSourceRowsDigest,true);
 check(design.intendedNewMorningPriority,['OPENING_READINESS','GEOGRAPHY_PROXIMITY','WORKLOAD_BALANCE']);
 rejects(()=>verify(design,input));rejects(()=>verify(report,designInput));
 const dated=clone(source),patch=read('./fixtures/opening-coverage-actual-results.json').cases.one.sourcePatch;
 Object.assign(dated.version,patch.versionIdentity);dated.slots=clone(patch.slots);dated.exceptions=clone(patch.exceptions);
 const datedInput=inputFor(dated,config,'DATED_RECOVERY'),datedReport=create(datedInput);
 check(verify(datedReport,datedInput),true);check(datedReport.exceptions.length,1);
 check(datedReport.exceptionDigest,digest(datedReport.exceptions));check(datedReport.datedOverlayApplied,false);
 check(datedReport.packages.every(p=>p.effectiveOwner===null),true);
 check(datedReport.baselineRoster.every(p=>p.effectiveAvailablePre09ClockMinutes===null),true);
 check(datedReport.missingAuthority.includes('CANONICAL_DATED_OVERLAY_APPLICATION'),true);
 // Changing an independently pinned input is rejected even where an ordinary
 // normalizer could deduplicate/reorder semantic input or ignore extra fields.
 for(const mutate of [x=>x.source.version.assignments[0].locationNameSnapshot+='x',
  x=>x.source.proximity[0].minutes++,x=>x.source.proximity.reverse(),x=>x.source.proximity.push(clone(x.source.proximity[0])),
  x=>x.source.version.slotAvailability[0].lunch.start='12:00',x=>x.ownerConfig.weights.AQUARIUM++,
  x=>x.ownerConfig.allowAdminMorning=false,x=>x.source.extraProvenance='changed']){
  const changed=clone(input);mutate(changed);rejects(()=>create(changed));
 }
 // Same-row/self-rehash attacks cannot replace independent recomputation.
 for(const mutate of [r=>r.scope='DATED_RECOVERY',r=>r.sourceDigest='a'.repeat(64),r=>r.ownerConfigDigest='b'.repeat(64),
  r=>r.packages[0].physicalMembers[0].locationId='00000000-0000-4000-8000-000000000001',
  r=>r.packages[0].knownComponentWeight++,r=>r.packages[0].physicalDurationMinutes=1,
  r=>r.packages[0].openingCriticalClassification='CRITICAL',r=>r.packages[0].effectiveOwner.personId='changed',
  r=>r.packages[0].responsibilityWindow.end='09:00',r=>r.packages.pop(),
  r=>r.baselineRoster.find(x=>x.key==='TAMMY').effectiveAvailablePre09ClockMinutes=240,
  r=>r.directedProximity.edges[0].minutes++,r=>r.directedProximity.edges.reverse(),
  r=>r.componentWeightUnit='minutes',r=>r.cleaningPolicy.compulsoryFull=true,
  r=>r.adminPolicy.allowAdminMorning=false,r=>r.missingAuthority=[],r=>r.optimalityProven=true,
  r=>r.admitted=true,r=>r.fullRecordClosed=true]){
  const forged=clone(report);mutate(forged);const {descriptorDigest,...body}=forged;forged.descriptorDigest=digest(body);
  rejects(()=>verify(forged,input));
 }
 const rebind=x=>{x.bindings={sourceDigest:digest(x.source),ownerConfigDigest:digest(x.ownerConfig)};return x;};
 for(const mutate of [x=>x.scope='UNRECOGNIZED',x=>x.dayOfWeek=7,x=>x.selectedWorkIds=selected,
  x=>x.scope='DATED_RECOVERY',x=>x.scope='NEW_RECURRING_MORNING_DESIGN',
  x=>{x.scope='NEW_RECURRING_MORNING_DESIGN';x.selectedWorkIds=[source.version.assignments.find(r=>r.window.start==='09:45').workId];},
  x=>{x.scope='NEW_RECURRING_MORNING_DESIGN';x.selectedWorkIds=[selected[0],selected[0]];},
  x=>x.source.versions=[clone(source.version)],x=>x.ownerConfig.allowAdminMorning=false,
  x=>x.ownerConfig.weights.ZAMBEZI++,x=>x.source.version.assignments.push(clone(x.source.version.assignments[0])),
  x=>x.source.version.slotAvailability.push(clone(x.source.version.slotAvailability[0])),
  x=>x.source.slots.push(clone(x.source.slots[0])),
  x=>x.source.slots.find(s=>s.id===config.slots.TAMMY.slotId).incumbencies[0].personId=config.slots.KAREN.personId,
  x=>x.source.version.slotAvailability.find(a=>a.slotId===config.slots.TAMMY.slotId&&a.dayOfWeek===1).status='off',
  x=>x.source.version.slotAvailability.find(a=>a.slotId===config.slots.TAMMY.slotId&&a.dayOfWeek===1).lunch.start='08:00',
  x=>x.source.proximity[0].minutes=-1,x=>x.source.proximity[0].provenance='',
  x=>x.source.proximity.push({...x.source.proximity[0],minutes:x.source.proximity[0].minutes+1}),
  x=>x.source.version.assignments.find(r=>r.workId===selected[0]).originSlotId=config.slots.OPTION1.slotId,
  x=>x.source.version.assignments.find(r=>r.workId===selected[0]).locationCodeSnapshot=config.retiredAreaFamilies[0],
  x=>x.source.version.assignments.find(r=>r.dayOfWeek===1&&r.window.end==='09:45'&&r.locationCodeSnapshot==='ZAMBEZI').includedLocations.push({locationId:'00000000-0000-4000-8000-000000000001',locationNameSnapshot:'foreign'}),
  x=>x.ownerConfig.weights.AQUARIUM=null,x=>x.source.version.effectiveEnd='2026-10-05',
  x=>x.source.version.assignments.find(r=>r.workId===selected[0]).schedulingMode='fixed_service',
  x=>x.extraAuthority=true]){
  const changed=clone(input);mutate(changed);rejects(()=>create(rebind(changed)),String(mutate));
 }
 // A legitimate raw change creates a DIFFERENT binding, never retrospectively
 // validates an old descriptor. Directionality is preserved, not averaged.
 const edgeChange=clone(input);edgeChange.source.proximity[0].minutes+=3;rebind(edgeChange);
 const changedReport=create(edgeChange);check(changedReport.directedProximity.digest!==report.directedProximity.digest,true);
 check(changedReport.directedProximity.edges.find(e=>e.fromLocationId===edgeChange.source.proximity[0].fromLocationId
  &&e.toLocationId===edgeChange.source.proximity[0].toLocationId).minutes,edgeChange.source.proximity[0].minutes);
 rejects(()=>verify(report,edgeChange));
 const spanning=clone(input);spanning.source.version.assignments.find(r=>r.workId===selected[0]).window.end='17:00';rebind(spanning);
 const spanningReport=create(spanning);check(spanningReport.unclassifiedCrossBoundaryRows.length,1);
 check(spanningReport.unclassifiedCrossBoundaryRows[0].sourceRow.window.end,'17:00');
 check(spanningReport.missingAuthority.includes('CROSS_BOUNDARY_RESPONSIBILITY_CLASSIFICATION'),true);
 spanning.scope='NEW_RECURRING_MORNING_DESIGN';spanning.selectedWorkIds=[selected[0]];rejects(()=>create(spanning));
 const split=clone(input),splitRow=split.source.version.assignments.find(r=>r.dayOfWeek===1&&r.window.end==='09:45'&&r.locationCodeSnapshot==='ZAMBEZI');
 splitRow.includedLocations=splitRow.includedLocations.filter(m=>m.locationId===splitRow.locationId);rebind(split);
 const splitPackage=create(split).packages.find(p=>p.workId===splitRow.workId);
 check(splitPackage.physicalMembers.length,1);check(splitPackage.componentLoadComplete,true);
 check(splitPackage.knownComponentWeight<splitPackage.configAggregateWeight,true);
 check(splitPackage.physicalDurationMinutes,null);
 const exotic=clone(input);let touched=false;Object.defineProperty(exotic.source,'hidden',{enumerable:false,get(){touched=true;return 1;}});
 rejects(()=>create(exotic));check(touched,false);
 const cycle=clone(input);cycle.source.loop=cycle;rejects(()=>create(cycle));
 const invisible=clone(input);invisible.source[Symbol('hidden')]=true;rejects(()=>create(invisible));
 const nan=clone(input);nan.source.proximity[0].minutes=NaN;rejects(()=>create(nan));
 check(JSON.stringify(source),sourceBefore);check(JSON.stringify(config),configBefore);
 return {status:'PASS',checks,scope:'pure morning planning input binding; no model or solver',solverExecuted:false,
  descriptorDigest:report.descriptorDigest,sourceDigest:report.sourceDigest,ownerConfigDigest:report.ownerConfigDigest,
  fullRecordClosed:false};
}
if(process.argv[1]===fileURLToPath(import.meta.url))console.log(JSON.stringify(runMorningPlanningAuthorityTests()));
