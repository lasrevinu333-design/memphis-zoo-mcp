import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {deriveNativeScheduleOccurrence as derive} from '../src/native-schedule-occurrence.js';
import {nativeScheduleOccurrenceFixture,syntheticId as id} from './fixtures/native-schedule-occurrence-source.mjs';
const clone=x=>structuredClone(x);
// Accepted-loan-shaped DTOs exercise the actual adapter. Current SQL target
// eligibility is a separate proof; none of these simulated targets admit an
// effect, delivery time, native profile or provider dispatch.
function input(mode='scan_tracked'){
 const f=nativeScheduleOccurrenceFixture(),helper=id('09:45-lunch-helper');
 const anchor=f.snapshot.segments.find(x=>x.segment_id===f.request.sourceKey),post=f.snapshot.segments.find(x=>x.location_group_id===anchor.location_group_id&&x.segment_id!==anchor.segment_id);
 assert.ok(post);f.snapshot.segments=[anchor,post];
 f.snapshot.physical=f.snapshot.physical.filter(x=>x.occurrence_id===anchor.segment_id||x.occurrence_id===post.segment_id);
 anchor.coverage_end='10:00';post.coverage_start='10:00';
 for(const p of f.snapshot.physical)if(p.occurrence_id===post.segment_id)p.coverage_start='10:00:00';
 const morning=f.snapshot.physical.filter(x=>x.occurrence_id===anchor.segment_id);
 f.snapshot.physical=f.snapshot.physical.filter(x=>x.occurrence_id!==anchor.segment_id);
 for(const p of morning)f.snapshot.physical.push({...p,coverage_end:'09:45:00'},
  {...p,coverage_start:'09:45:00',coverage_end:'10:00:00',assigned_employee_id:helper,authority_source:'static_weekly_lunch_coverage'});
 for(const s of f.snapshot.segments){s.service_mode=mode;if(mode!=='scan_tracked')s.included_location_ids=[];}
 if(mode!=='scan_tracked')f.snapshot.physical=[];
 f.snapshot.lunch=[{projection_id:anchor.projection_id,loan_id:'synthetic-accepted-loan',responsibility_id:'synthetic-accepted-responsibility',
  normal_occurrence_id:anchor.segment_id,normal_owner_id:anchor.assigned_employee_id,coverer_id:helper,location_group_id:anchor.location_group_id,
  included_location_ids:[...anchor.included_location_ids],included_snapshots_empty:mode!=='scan_tracked',service_mode:mode,coverage_start:'09:45:00',coverage_end:'10:00:00'}];
 f.request.employeeId=helper;f.target.recipient.employee_id=helper;
 return {request:f.request,snapshot:f.snapshot,targetBefore:f.target,targetAfter:clone(f.target)};
}
export function runNativeScheduleLunchRecipientTests(){
 let checks=0;const eq=(a,b)=>{assert.deepEqual(a,b);checks++;};
 for(const mode of ['scan_tracked','reminder_only','response_only_no_clean']){
  const f=input(mode),before=JSON.stringify(f),r=derive(f);
  eq(r.status,'POLICY_AUTHORITY_REQUIRED');eq(r.occurrence.before_units,[]);eq(r.occurrence.after_units.length,mode==='scan_tracked'?f.snapshot.lunch[0].included_location_ids.length:1);
  eq(r.occurrence.employee_id,f.request.employeeId);eq(r.occurrence.changes.every(c=>c.after.employee_id===f.request.employeeId),true);
  eq(r.delivery_admitted,false);eq(r.dispatch_authorized,false);eq(r.effect_authority,null);eq(r.valid_until,null);
  eq(derive(f),r);eq(JSON.stringify(f),before);
  for(const mutate of [x=>x.snapshot.lunch=[],x=>x.snapshot.lunch[0].coverer_id=id('unrelated-helper'),
   x=>x.snapshot.lunch[0].normal_owner_id=id('unrelated-owner'),x=>x.snapshot.lunch[0].normal_occurrence_id=id('unrelated-occurrence'),
   x=>x.snapshot.lunch[0].projection_id=id('cross-projection'),x=>x.snapshot.lunch[0].coverage_start='09:46:00',
   x=>x.snapshot.lunch[0].coverage_end='09:45:00',x=>x.snapshot.lunch.push(clone(x.snapshot.lunch[0])),
   x=>x.targetAfter.recipient.assignment_epoch++,x=>x.targetAfter.source.source_revision='2']){
   const bad=input(mode);mutate(bad);const result=derive(bad);eq(result.status,'SOURCE_UNAVAILABLE');eq(result.occurrence,null);
  }
 }
 return {status:'PASS',checks,scope:'Actual source adapter with explicitly simulated authenticated accepted-loan edges; no SQL target or native effect admission',
  sql_executed:false,delivery_admitted:false,provider_dispatch:false,phone:false};
}
if(process.argv[1]===fileURLToPath(import.meta.url))console.log(JSON.stringify(runNativeScheduleLunchRecipientTests()));
