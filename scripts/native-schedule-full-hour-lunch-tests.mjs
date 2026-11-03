import assert from 'node:assert/strict';
import {deriveNativeScheduleOccurrence as derive} from '../src/native-schedule-occurrence.js';
import {nativeScheduleOccurrenceFixture,syntheticId as id} from './fixtures/native-schedule-occurrence-source.mjs';

function input(mode='scan_tracked',bothAnchors=true){
 const f=nativeScheduleOccurrenceFixture(),helper=id('full-hour-helper');
 const morning=f.snapshot.segments.find(s=>s.segment_id===f.request.sourceKey);
 const after=f.snapshot.segments.find(s=>s.location_group_id===morning.location_group_id&&s.segment_id!==morning.segment_id);
 f.snapshot.segments=[morning,after];
 for(const s of f.snapshot.segments){s.service_mode=mode;if(mode!=='scan_tracked')s.included_location_ids=[];}
 const base=f.snapshot.physical.filter(p=>f.snapshot.segments.some(s=>s.segment_id===p.occurrence_id));
 f.snapshot.physical=mode==='scan_tracked'?base.flatMap(p=>{
  const rows=[];
  if(p.occurrence_id===morning.segment_id)rows.push({...p,coverage_end:'09:30:00'});
  rows.push({...p,coverage_start:p.occurrence_id===morning.segment_id?'09:30:00':'09:45:00',
   coverage_end:p.occurrence_id===morning.segment_id?'09:45:00':'10:30:00',assigned_employee_id:helper,authority_source:'static_weekly_lunch_coverage'});
  if(p.occurrence_id===after.segment_id)rows.push({...p,coverage_start:'10:30:00'});
  return rows;
 }):[];
 f.snapshot.lunch=(bothAnchors?[morning,after]:[morning]).map(s=>({projection_id:s.projection_id,
  loan_id:'accepted-full-hour-loan',responsibility_id:'accepted-full-hour-responsibility',normal_occurrence_id:s.segment_id,
  normal_owner_id:s.assigned_employee_id,coverer_id:helper,location_group_id:s.location_group_id,
  included_location_ids:[...s.included_location_ids],included_snapshots_empty:mode!=='scan_tracked',service_mode:mode,
  coverage_start:'09:30:00',coverage_end:'10:30:00'}));
 f.request.employeeId=helper;f.target.recipient.employee_id=helper;
 return {request:f.request,snapshot:f.snapshot,targetBefore:f.target,targetAfter:structuredClone(f.target)};
}
let checks=0;
function eq(a,b){assert.deepEqual(a,b);checks++;}
for(const mode of ['scan_tracked','reminder_only','response_only_no_clean'])for(const both of [false,true]){
 const f=input(mode,both),before=JSON.stringify(f),result=derive(f);
 eq(result.status,'NO_OWNERSHIP_CHANGE');eq(result.occurrence,null);
 eq(result.delivery_admitted,false);eq(result.dispatch_authorized,false);eq(result.valid_until,null);
 eq(JSON.stringify(f),before);
 const reordered=structuredClone(f);reordered.snapshot.segments.reverse();reordered.snapshot.physical.reverse();reordered.snapshot.lunch.reverse();
 eq(derive(reordered),result);
 for(const mutate of [
  x=>x.snapshot.lunch[0].coverage_end='24:00',
  x=>x.snapshot.lunch[0].normal_owner_id=id('unrelated-owner'),
  x=>x.snapshot.lunch[0].normal_occurrence_id=id('unrelated-occurrence'),
  x=>x.snapshot.lunch[0].projection_id=id('unrelated-projection'),
  x=>x.snapshot.lunch.push(structuredClone(x.snapshot.lunch[0])),
  x=>x.targetAfter.recipient.assignment_epoch++,
 ]){const bad=input(mode,both);mutate(bad);eq(derive(bad).status,'SOURCE_UNAVAILABLE');}
}
for(const mutate of [
 x=>x.snapshot.physical.find(p=>p.authority_source==='static_weekly_lunch_coverage'&&p.coverage_end==='10:30:00').coverage_end='10:29:59',
 x=>x.snapshot.physical.find(p=>p.authority_source==='static_weekly_lunch_coverage'&&p.coverage_end==='10:30:00').assigned_employee_id=id('unrelated-helper'),
 x=>x.snapshot.physical.find(p=>p.authority_source==='static_weekly_lunch_coverage'&&p.coverage_end==='10:30:00').authority_source='static_weekly_projection',
 x=>x.snapshot.physical=x.snapshot.physical.filter(p=>!(p.authority_source==='static_weekly_lunch_coverage'&&p.coverage_end==='10:30:00')),
]){const bad=input();mutate(bad);eq(derive(bad).status,'SOURCE_UNAVAILABLE');}
console.log(JSON.stringify({status:'PASS',checks,wholeHourAcross0945:true,retainedOriginalAnchors:true,
 fullPhysicalReadbackRequired:true,duplicateAnchorDoesNotInventOwnershipChange:true,
 scope:'Actual maintained native source adapter with synthetic accepted-reader facts; no SQL target/effect/provider/phone proof',deliveryAdmitted:false}));
