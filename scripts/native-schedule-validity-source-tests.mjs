import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {nativeScheduleOccurrenceFixture,syntheticId as id} from './fixtures/native-schedule-occurrence-source.mjs';
import {deriveNativeScheduleOccurrence} from '../src/native-schedule-occurrence.js';
const path=new URL('../src/native-schedule-validity-source.js',import.meta.url);
// The before-only branch exposes the current missing candidate interval, not
// a production fallback or authority upgrade. Product admission stays closed.
const module=existsSync(path)?await import(path):{deriveNativeScheduleValiditySource:deriveNativeScheduleOccurrence};
const clone=x=>structuredClone(x);
const input=()=>{const f=nativeScheduleOccurrenceFixture();return{request:f.request,snapshot:f.snapshot,targetBefore:f.target,targetAfter:clone(f.target)};};
export async function runNativeScheduleValiditySourceTests(){
 let checks=0;const eq=(a,b,message)=>{assert.deepEqual(a,b,message);checks++;};
 const good=input(),before=JSON.stringify(good),r=module.deriveNativeScheduleValiditySource(good);
 eq(r.status,'SOURCE_WINDOW_PREPARED_NOT_ADMITTED');eq(r.source_window.valid_from_local,'09:45:00.000000');
 // The pinned raw pattern's earliest recipient edge is14:00, not a guessed
 // universal16:00 shift end. Source points are never task clock minutes.
 eq(r.source_window.valid_until_local,'14:00:00.000000');eq(r.source_window.timezone,'America/Chicago');
 eq(r.source_window.service_date,good.request.serviceDate);eq(r.source_window.employee_id,good.request.employeeId);
 eq(r.source_window.logical_key,`schedule-ownership:${good.request.serviceDate}:${good.request.employeeId}:09:45`);
 for(const field of ['delivery_admitted','dispatch_authorized'])eq(r[field],false);
 for(const field of ['effect_authority','retention_authority','valid_until'])eq(r[field],null);
 eq(JSON.stringify(good),before);eq(module.deriveNativeScheduleValiditySource(good),r);eq(Object.isFrozen(r.source_window),true);
 const reordered=input();for(const field of ['segments','physical','lunch'])reordered.snapshot[field].reverse();
 eq(module.deriveNativeScheduleValiditySource(reordered),r);
 // A future accepted source edge is a conservative cutoff even if ownership
 // resumes unchanged later. No arbitrary5/15minute timeout is manufactured.
 function split(edge){const x=input(),s=x.snapshot.segments.find(s=>s.assigned_employee_id===x.request.employeeId&&s.coverage_start==='09:45');assert.ok(s);
  const end=s.coverage_end,post={...clone(s),segment_id:id('after-validity-edge-'+edge),coverage_start:edge};s.coverage_end=edge;
  x.snapshot.segments.push(post);const pieces=x.snapshot.physical.filter(p=>p.occurrence_id===s.segment_id);
  for(const p of pieces){const tail={...clone(p),occurrence_id:post.segment_id,coverage_start:edge,coverage_end:end};p.coverage_end=edge;x.snapshot.physical.push(tail);}
  return x;}
 for(const edge of ['09:45:00.000001','10:00','10:15:30.123456','12:00']){
  const x=split(edge),v=module.deriveNativeScheduleValiditySource(x);
  eq(v.status,'SOURCE_WINDOW_PREPARED_NOT_ADMITTED');eq(v.source_window.valid_until_local,
   edge==='10:00'?'10:00:00.000000':edge==='12:00'?'12:00:00.000000':edge);
  eq(v.source_window.logical_key,r.source_window.logical_key);eq(v.source_window.source_sha256===r.source_window.source_sha256,false);
 }
 const unrelated=input(),s=unrelated.snapshot.segments.find(s=>s.assigned_employee_id!==unrelated.request.employeeId&&s.coverage_start==='09:45');
 const post={...clone(s),segment_id:id('unrelated-10-edge'),coverage_start:'10:00'};s.coverage_end='10:00';unrelated.snapshot.segments.push(post);
 for(const p of unrelated.snapshot.physical.filter(p=>p.occurrence_id===s.segment_id)){
  const tail={...clone(p),occurrence_id:post.segment_id,coverage_start:'10:00:00'};p.coverage_end='10:00:00';unrelated.snapshot.physical.push(tail);}
 eq(module.deriveNativeScheduleValiditySource(unrelated).source_window.valid_until_local,'14:00:00.000000','unrelated person edge does not fabricate recipient expiry');
 const future=input(),template=future.snapshot.segments.find(s=>s.assigned_employee_id===future.request.employeeId&&s.coverage_start==='09:45');
 const newGroup=id('future-validity-group'),newLocation=id('future-validity-place'),newOccurrence=id('future-validity-occurrence');
 const extra={...clone(template),segment_id:newOccurrence,location_group_id:newGroup,included_location_ids:[newLocation],coverage_start:'10:00',coverage_end:'11:00'};
 future.snapshot.segments.push(extra);const physicalTemplate=future.snapshot.physical.find(p=>p.occurrence_id===template.segment_id);
 future.snapshot.physical.push({...clone(physicalTemplate),occurrence_id:newOccurrence,location_group_id:newGroup,location_id:newLocation,coverage_start:'10:00:00',coverage_end:'11:00:00'});
 eq(module.deriveNativeScheduleValiditySource(future).source_window.valid_until_local,'10:00:00.000000','future added responsibility caps the candidate interval');
 eq(module.deriveNativeScheduleValiditySource(future).delivery_admitted,false);
 const midnight=input();
 for(const s of midnight.snapshot.segments)if(s.assigned_employee_id===midnight.request.employeeId&&s.coverage_start==='09:45')s.coverage_end='24:00';
 for(const p of midnight.snapshot.physical)if(p.assigned_employee_id===midnight.request.employeeId&&p.coverage_start==='09:45:00')p.coverage_end='24:00:00';
 eq(module.deriveNativeScheduleValiditySource(midnight).source_window.valid_until_local,'24:00:00.000000');
 eq(module.deriveNativeScheduleValiditySource(midnight).valid_until,null,'local midnight candidate is not a fabricated UTC instant');
 // An exact accepted lunch loan supplies its own finite cutoff for a helper
 // who has no usual ownership in this source. Response-only duties are not
 // converted into routine cleaning or physical scans.
 function lunchInput(mode){
  const x=input(),anchor=x.snapshot.segments.find(s=>s.segment_id===x.request.sourceKey),post=x.snapshot.segments.find(s=>s.location_group_id===anchor.location_group_id&&s!==anchor);
  const helper=id('validity-only-lunch-coverer');x.snapshot.segments=[anchor,post];anchor.coverage_end='11:00';post.coverage_start='11:00';
  const original=x.snapshot.physical.filter(p=>p.occurrence_id===anchor.segment_id),after=x.snapshot.physical.filter(p=>p.occurrence_id===post.segment_id);
  x.snapshot.physical=after.map(p=>({...p,coverage_start:'11:00:00'}));
  for(const p of original)x.snapshot.physical.push({...p,coverage_end:'09:45:00'},
   {...p,coverage_start:'09:45:00',coverage_end:'10:00:00',assigned_employee_id:helper,authority_source:'static_weekly_lunch_coverage'},
   {...p,coverage_start:'10:00:00',coverage_end:'11:00:00'});
  for(const s of x.snapshot.segments){s.service_mode=mode;if(mode!=='scan_tracked')s.included_location_ids=[];}
  if(mode!=='scan_tracked')x.snapshot.physical=[];
  x.snapshot.lunch=[{projection_id:anchor.projection_id,loan_id:'synthetic-validity-loan',responsibility_id:'synthetic-validity-responsibility',
   normal_occurrence_id:anchor.segment_id,normal_owner_id:anchor.assigned_employee_id,coverer_id:helper,location_group_id:anchor.location_group_id,
   included_location_ids:[...anchor.included_location_ids],included_snapshots_empty:mode!=='scan_tracked',service_mode:mode,coverage_start:'09:45:00',coverage_end:'10:00:00'}];
  x.request.employeeId=helper;x.targetBefore.recipient.employee_id=helper;x.targetAfter=clone(x.targetBefore);return x;
 }
 for(const mode of ['scan_tracked','reminder_only','response_only_no_clean']){
  const x=lunchInput(mode),v=module.deriveNativeScheduleValiditySource(x);
  eq(v.status,'SOURCE_WINDOW_PREPARED_NOT_ADMITTED');eq(v.source_window.valid_until_local,'10:00:00.000000');
  eq(v.occurrence.before_units,[]);eq(v.occurrence.employee_id,x.request.employeeId);eq(v.delivery_admitted,false);
 }
 const noFuture=input(),other=id('no-future-normal-successor');
 for(const s of noFuture.snapshot.segments)if(s.assigned_employee_id===noFuture.request.employeeId&&s.coverage_start==='09:45')s.assigned_employee_id=other;
 for(const p of noFuture.snapshot.physical)if(p.assigned_employee_id===noFuture.request.employeeId&&p.coverage_start==='09:45:00')p.assigned_employee_id=other;
 const missing=module.deriveNativeScheduleValiditySource(noFuture);eq(missing.status,'SOURCE_WINDOW_UNAVAILABLE');eq(missing.source_window,null);eq(missing.valid_until,null);
 const prototype=input();prototype.snapshot=Object.assign(Object.create({unsupported:true}),prototype.snapshot);
 eq(module.deriveNativeScheduleValiditySource(prototype).status,'SOURCE_UNAVAILABLE','clone must not erase unsupported original source prototype');
 for(const mutate of [x=>x.targetAfter.recipient.assignment_epoch++,x=>x.targetAfter.source.source_revision='2',
  x=>x.snapshot.segments[0].coverage_end='25:00',x=>x.snapshot.physical[0].assigned_employee_id=id('foreign'),
  x=>x.snapshot.authority[0].projection_status='stale',x=>x.targetBefore.delivery_admitted=true]){
  const x=input();mutate(x);const v=module.deriveNativeScheduleValiditySource(x);eq(v.status,'SOURCE_UNAVAILABLE');eq(v.source_window,null);
 }
 const unchanged=input();for(const s of unchanged.snapshot.segments)s.assigned_employee_id=unchanged.request.employeeId;
 for(const p of unchanged.snapshot.physical)p.assigned_employee_id=unchanged.request.employeeId;
 eq(module.deriveNativeScheduleValiditySource(unchanged).status,'NO_OWNERSHIP_CHANGE');eq(module.deriveNativeScheduleValiditySource(unchanged).source_window,null);
 // Calendar facts at the fall/spring transitions remain Chicago local source
 // values. This layer must NOT fabricate a UTC offset or an actual clock.
 for(const date of ['2026-03-08','2026-11-01']){
  const x=input();x.request.serviceDate=date;
  for(const a of x.snapshot.authority)a.service_date=date;
  for(const rows of ['segments','physical'])for(const row of x.snapshot[rows])row.service_date=date;
  x.targetBefore.source.service_date=date;x.targetAfter=clone(x.targetBefore);
  const v=module.deriveNativeScheduleValiditySource(x);eq(v.source_window.service_date,date);eq(v.valid_until,null);eq(v.effect_authority,null);
 }
 // Actual new callable source preparation uses the existing trusted read
 // seams and one snapshot between two exact recipient/source observations.
 const calls=[];const p=await module.prepareNativeScheduleValiditySource({...good.request,
  runRpc:async(name,args)=>{calls.push(name);eq(args.p_kind,'SCHEDULE');return{data:clone(good.targetBefore)};},
  runReadOnlySql:async()=>{calls.push('one-snapshot');return[{data:clone(good.snapshot)}];}});
 eq(p,r);eq(calls,['custodial_native_target_source','one-snapshot','custodial_native_target_source']);
 for(const fault of ['read','target','snapshot','rotation']){
  let n=0;const v=await module.prepareNativeScheduleValiditySource({...good.request,
   runRpc:async()=>{if(fault==='target')throw Error('private transport detail');const t=clone(good.targetBefore);if(++n===2&&fault==='rotation')t.recipient.assignment_epoch++;return{data:t};},
   runReadOnlySql:async()=>{if(fault==='read')throw Error('private query detail');return fault==='snapshot'?[]:[{data:clone(good.snapshot)}];}});
  eq(v.status,'SOURCE_UNAVAILABLE');eq(v.source_window,null);eq(JSON.stringify(v).includes('private'),false);
 }
 let mutableTarget=clone(good.targetBefore),mutableSnapshot=clone(good.snapshot),n=0;
 const raced=await module.prepareNativeScheduleValiditySource({...good.request,
  runRpc:async()=>{if(++n===2){mutableTarget.recipient.assignment_epoch++;mutableSnapshot.authority[0].projection_authority_revision='2';}return{data:mutableTarget};},
  runReadOnlySql:async()=>[{data:mutableSnapshot}]});
 eq(raced.status,'SOURCE_UNAVAILABLE');eq(raced.source_window,null);
 return {status:'PASS',checks,source_only:true,sql_executed:false,clock_admitted:false,retention_admitted:false,delivery_admitted:false};
}
if(process.argv[1]===fileURLToPath(import.meta.url))console.log(JSON.stringify(await runNativeScheduleValiditySourceTests()));
