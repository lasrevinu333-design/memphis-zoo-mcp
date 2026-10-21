import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {deriveNativeScheduleOccurrence as derive,NATIVE_SCHEDULE_SOURCE_LIMITS as limits} from '../src/native-schedule-occurrence.js';
import {prepareNativeScheduleOccurrence as prepare,nativeScheduleSnapshotSql} from '../src/native-schedule-preparation.js';
import {nativeScheduleOccurrenceFixture,syntheticId as id} from './fixtures/native-schedule-occurrence-source.mjs';
import {runNativeScheduleDatedReaderTests} from './native-schedule-dated-reader-tests.mjs';
const clone=x=>structuredClone(x);
export async function runNativeScheduleOccurrenceTests(){
 let checks=0;const equal=(a,b,n)=>{assert.deepEqual(a,b,n);checks++;};
 const input=()=>{const f=nativeScheduleOccurrenceFixture();return {request:f.request,snapshot:f.snapshot,targetBefore:f.target,targetAfter:clone(f.target)};};
 const good=input(),unchangedInput=JSON.stringify(good),report=derive(good);
 equal(report.status,'POLICY_AUTHORITY_REQUIRED');equal(report.occurrence.changes.length>1,true,'one occurrence aggregates several changed units');
 for(const field of ['delivery_admitted','dispatch_authorized'])equal(report[field],false);
 equal(report.valid_until,null);equal(report.effect_authority,null);equal(JSON.stringify(good),unchangedInput,'input unchanged');
 equal(Object.isFrozen(report.occurrence.recipient),true);equal(Object.isFrozen(report.occurrence.changes),true);
 equal(report.occurrence.logical_key,`schedule-ownership:${good.request.serviceDate}:${good.request.employeeId}:09:45`);
 equal(derive(input()),report,'response loss/repeated preparation stable');
 const reorder=input();reorder.snapshot.segments.reverse();reorder.snapshot.physical.reverse();
 equal(derive(reorder),report,'transport row order cannot change bytes');
 const second=input();second.snapshot.authority[0].projection_authority_revision='2';second.targetBefore.source.source_revision='2';second.targetAfter=clone(second.targetBefore);
 const secondReport=derive(second);equal(secondReport.occurrence.logical_key,report.occurrence.logical_key,'revision does not mint another episode');
 equal(secondReport.occurrence.semantic_sha256,report.occurrence.semantic_sha256);equal(secondReport.occurrence.source_sha256!==report.occurrence.source_sha256,true);
 // Exact whole-day pattern source is preserved. A separate synthetic source
 // assigns the same semantic physical/nonphysical ownership on both sides.
 const stable=input(),owner=stable.request.employeeId;
 for(const s of stable.snapshot.segments)s.assigned_employee_id=owner;
 for(const p of stable.snapshot.physical)p.assigned_employee_id=owner;
 const stableReport=derive(stable);equal(stableReport.status,'NO_OWNERSHIP_CHANGE');equal(stableReport.occurrence,null);
 stable.snapshot.authority[0].projection_authority_revision='3';stable.targetBefore.source.source_revision='3';stable.targetAfter=clone(stable.targetBefore);
 equal(derive(stable),stableReport,'revision churn alone is silent');
 function reject(change,reason){const x=input();change(x);const r=derive(x);equal(r.status,'SOURCE_UNAVAILABLE');if(reason)equal(r.reason,reason);equal(r.occurrence,null);}
 const shapeMutations=[x=>x.snapshot.extra=true,x=>x.snapshot.authority.push(clone(x.snapshot.authority[0])),x=>x.snapshot.authority=[],
  x=>x.snapshot.authority[0].governed=false,x=>x.snapshot.authority[0].projection_status='stale',
  x=>x.snapshot.authority[0].authority_source='legacy',x=>x.snapshot.segments[0].extra=true,x=>x.snapshot.physical[0].extra=true,
  x=>x.snapshot.segments[0].coverage_start='99:00',x=>x.snapshot.segments[0].coverage_end='00:00',
  x=>x.snapshot.segments[0].coverage_start='09:45:00.0000001',x=>x.snapshot.segments[0].service_mode='service_only',
  x=>x.snapshot.segments[0].governed=false,x=>x.snapshot.segments[0].included_location_ids.push(x.snapshot.segments[0].included_location_ids[0]),
  x=>x.snapshot.segments[0].status='REVIEW',x=>x.snapshot.segments[0].owner_type='OPEN',x=>x.snapshot.segments[0].assigned_employee_id=null,
  x=>x.snapshot.segments.push(clone(x.snapshot.segments[0])),x=>x.snapshot.physical.push(clone(x.snapshot.physical[0])),
  x=>x.snapshot.physical.splice(0,1),x=>x.snapshot.segments=[],x=>x.snapshot.segments[0].included_location_ids=[],
  x=>x.snapshot.physical[0].assigned_employee_id=id('wrong'),x=>x.snapshot.physical[0].occurrence_id=id('wrong'),
  x=>x.snapshot.physical[0].location_id=id('wrong'),x=>x.snapshot.physical[0].location_group_id=id('wrong'),
  x=>x.snapshot.physical[0].authority_source='static_weekly_lunch_coverage',x=>x.snapshot.physical[0].coverage_end='24:00:00.000001',
  x=>x.snapshot.segments[0].included_location_ids=Array(limits.units+1).fill(id('x')),
  x=>x.snapshot.physical=Array(limits.rows+1).fill(x.snapshot.physical[0]),
  x=>x.snapshot.segments[0].owner_type='CONTRACTOR_CAPACITY'];
 for(const change of shapeMutations)reject(change);
 for(const key of ['service_date','projection_id','publication_id','version_id']){
  reject(x=>x.snapshot.segments[0][key]=key==='service_date'?'2026-10-06':id('cross'));
  reject(x=>x.snapshot.physical[0][key]=key==='service_date'?'2026-10-06':id('cross'));
 }
 for(const key of ['generation_id','credential_id','device_id','employee_id','device_identifier','assignment_epoch','principal_digest','token_digest']){
  reject(x=>x.targetAfter.recipient[key]=key==='assignment_epoch'?2:key.endsWith('digest')?'e'.repeat(64):key==='device_identifier'?'KIOSK_09':id('rotated'));
 }
 for(const key of ['source_revision','source_digest','publication_id','version_id','source_id','assignment_occurrence_id'])
  reject(x=>x.targetAfter.source[key]=key==='source_revision'?'2':key==='source_digest'?'e'.repeat(64):id('republished'));
 for(const change of [x=>x.targetBefore.source.valid_until='2026-10-05T23:59:59Z',x=>x.targetBefore.source.valid_from='2026-10-05T09:45:00Z',
  x=>x.targetBefore.source.delivery_occurrence_id=id('made-up-job'),x=>x.targetBefore.delivery_admitted=true,
  x=>x.targetBefore.source.source_revision='9223372036854775808',x=>x.targetBefore.source.source_revision='01',
  x=>x.targetBefore.recipient.fcm_token='synthetic-prohibited-token',x=>x.targetBefore.status='SOURCE_STALE',x=>x.targetBefore.source=null])reject(change);
 // Exact half-open boundary, not a 1-second approximation. Membership just
 // before the boundary survives fractional starts/ends without a JS wall clock.
 const fractional=clone(stable);fractional.snapshot.segments.forEach(s=>{if(s.coverage_end==='09:45')s.coverage_start='09:44:59.999999';});
 fractional.snapshot.physical.forEach(p=>{if(p.coverage_end==='09:45:00')p.coverage_start='09:44:59.999999';});
 equal(derive(fractional).status,'NO_OWNERSHIP_CHANGE');
 // CoverAll is explicit nonemployee authority, never a phantom employee.
 const contractor=input(),s=contractor.snapshot.segments.find(s=>s.segment_id!==contractor.request.sourceKey&&s.coverage_start==='09:45');
 s.owner_type='COVERALL';s.assigned_employee_id=null;
 contractor.snapshot.physical.filter(p=>p.occurrence_id===s.segment_id).forEach(p=>p.assigned_employee_id=null);
 equal(derive(contractor).status,'POLICY_AUTHORITY_REQUIRED');
 // Lunch can cross the boundary. The actual operational owner must agree
 // with the accepted loan, including null nonemployee coverage (no coalesce).
 function lunchCase(mode='scan_tracked',coverer=null){
  const x=input(),s=x.snapshot.segments.find(s=>s.segment_id===x.request.sourceKey);
  const selected=x.snapshot.segments.filter(s=>s.location_group_id===x.snapshot.segments.find(a=>a.segment_id===x.request.sourceKey).location_group_id);
  x.snapshot.segments=selected;x.snapshot.physical=x.snapshot.physical.filter(p=>selected.some(s=>s.segment_id===p.occurrence_id));
  for(const s of selected){s.service_mode=mode;if(mode!=='scan_tracked')s.included_location_ids=[];}
  if(mode!=='scan_tracked')x.snapshot.physical=[];
  s.coverage_start='09:00';s.coverage_end='10:00';
  const post=selected.find(v=>v!==s);post.coverage_start='10:00';
  if(mode==='scan_tracked'){
   const original=x.snapshot.physical.filter(p=>p.occurrence_id===s.segment_id);
   x.snapshot.physical=x.snapshot.physical.filter(p=>p.occurrence_id!==s.segment_id);
   x.snapshot.physical.filter(p=>p.occurrence_id===post.segment_id).forEach(p=>p.coverage_start='10:00:00');
   for(const p of original)x.snapshot.physical.push({...p,coverage_start:'09:00:00',coverage_end:'09:45:00'},
    {...p,coverage_start:'09:45:00',coverage_end:'10:00:00',assigned_employee_id:coverer,authority_source:'static_weekly_lunch_coverage'});
  }
  x.snapshot.lunch=[{projection_id:s.projection_id,loan_id:'synthetic-loan',responsibility_id:'synthetic-responsibility',normal_occurrence_id:s.segment_id,
   normal_owner_id:s.assigned_employee_id,coverer_id:coverer,location_group_id:s.location_group_id,included_location_ids:[...s.included_location_ids],
   included_snapshots_empty:mode!=='scan_tracked',service_mode:mode,coverage_start:'09:45:00',coverage_end:'10:00:00'}];
  return x;
 }
 for(const mode of ['scan_tracked','reminder_only','response_only_no_clean']){
  const x=lunchCase(mode),r=derive(x);equal(r.status,'POLICY_AUTHORITY_REQUIRED');equal(r.occurrence.after_units,[]);
  equal(r.occurrence.changes.every(c=>c.after.employee_id===null&&c.after.loan_id==='synthetic-loan'),true);
  equal(r.occurrence.changes.every(c=>c.after.recipient_kind==='NO_EMPLOYEE_RECIPIENT'),true);
  x.snapshot.lunch[0].coverer_id=id('employee-helper');
  if(mode==='scan_tracked')x.snapshot.physical.filter(p=>p.authority_source==='static_weekly_lunch_coverage').forEach(p=>p.assigned_employee_id=id('employee-helper'));
  equal(derive(x).status,'POLICY_AUTHORITY_REQUIRED');
  x.snapshot.lunch.push(clone(x.snapshot.lunch[0]));equal(derive(x).status,'SOURCE_UNAVAILABLE');
 }
 for(const mutate of [x=>x.snapshot.lunch[0].normal_owner_id=id('wrong'),x=>x.snapshot.lunch[0].projection_id=id('wrong'),
  x=>x.snapshot.lunch[0].normal_occurrence_id=id('wrong'),x=>x.snapshot.lunch[0].coverage_end='10:01',
  x=>x.snapshot.lunch[0].extra=true,x=>x.snapshot.lunch[0].included_location_ids=[],
  x=>x.snapshot.lunch[0].responsibility_id='',x=>x.snapshot.physical.find(p=>p.authority_source==='static_weekly_lunch_coverage').assigned_employee_id=x.request.employeeId]){
  const x=lunchCase();mutate(x);equal(derive(x).status,'SOURCE_UNAVAILABLE');
 }
 const overlap=input(),row=clone(overlap.snapshot.segments[0]);row.segment_id=id('overlap');overlap.snapshot.segments.push(row);
 overlap.snapshot.physical.push(...overlap.snapshot.physical.filter(p=>p.occurrence_id===overlap.snapshot.segments[0].segment_id).map(p=>({...p,occurrence_id:row.segment_id})));
 equal(derive(overlap).status,'SOURCE_UNAVAILABLE');
 const illegal=input();illegal.request.serviceDate="2026-10-05');delete from users;--";
 assert.throws(()=>derive(illegal),e=>e.code==='REQUEST_INVALID');checks++;
 for(const day of ['2026-02-29','0000-01-01','2026-10-5',null]){assert.throws(()=>nativeScheduleSnapshotSql(day),e=>e.code==='REQUEST_INVALID');checks++;}
 // Actual callable preparation: current principal -> single source snapshot ->
 // same principal, with no caller-provided SQL/expiry or fallback reader.
 const calls=[];let rpcIndex=0;
 const result=await prepare({...good.request,runRpc:async(name,args)=>{calls.push('rpc');equal(name,'custodial_native_target_source');
  equal(args,{p_kind:'SCHEDULE',p_source_key:good.request.sourceKey,p_employee_id:good.request.employeeId,p_generation_id:good.request.generationId});rpcIndex++;return{data:clone(good.targetBefore)};},
  runReadOnlySql:async sql=>{calls.push('sql');equal(sql,nativeScheduleSnapshotSql(good.request.serviceDate));return[{data:clone(good.snapshot)}];}});
 equal(result,report);equal(calls,['rpc','sql','rpc']);equal(rpcIndex,2);
 const sql=nativeScheduleSnapshotSql(good.request.serviceDate);
 for(const fn of ['static_weekly_v6_schedule_authority_state','static_weekly_v6_read_schedule_segments','custodial_operational_location_assignments','static_weekly_v8_read_lunch_segments'])equal(sql.includes('public.'+fn+'('),true);
 equal(/\b(insert|update|delete|create|grant|now|clock_timestamp)\b/i.test(sql),false);equal((sql.match(/limit 4097/g)||[]).length,3);
 async function preparation(mutator){const f=input();let reads=0;const deps={...f.request,runRpc:async()=>({data:clone(++reads===1?f.targetBefore:f.targetAfter)}),runReadOnlySql:async()=>[{data:clone(f.snapshot)}]};mutator(deps,f);return prepare(deps);}
 for(const mutate of [d=>d.runRpc=async()=>{throw Error('private transport detail');},d=>d.runReadOnlySql=async()=>{throw Error('private sql detail');},
  d=>d.runReadOnlySql=async()=>[],d=>d.runReadOnlySql=async()=>[{data:{},extra:true}],
  (d,f)=>f.targetAfter.recipient.assignment_epoch++,
  (d,f)=>{f.targetBefore.status='SOURCE_STALE';delete f.targetBefore.source;delete f.targetBefore.recipient;},
  (d,f)=>f.snapshot.authority[0].projection_id=id('publication-race')]){
  const r=await preparation(mutate);equal(r.status,'SOURCE_UNAVAILABLE');equal(JSON.stringify(r).includes('private'),false);
 }
 let mutableTarget=clone(good.targetBefore),mutableSnapshot=clone(good.snapshot),n=0;
 const raced=await prepare({...good.request,runRpc:async()=>{if(++n===2){mutableTarget.recipient.assignment_epoch++;mutableSnapshot.authority[0].projection_authority_revision='2';}return{data:mutableTarget};},runReadOnlySql:async()=>[{data:mutableSnapshot}]});
 equal(raced.status,'SOURCE_UNAVAILABLE','mutable return objects cannot erase original observation');
 const fixture=nativeScheduleOccurrenceFixture();equal(fixture.provenance.assignment_count,46);equal(fixture.provenance.sql_executed,false);equal(fixture.provenance.solver_executed,false);
 equal(report.occurrence.before_units,fixture.raw_pattern_expected.before,'actual pinned pattern before-members are retained');
 equal(report.occurrence.after_units,fixture.raw_pattern_expected.after,'actual pinned pattern resulting ownership retained');
 // Guard the existing schema dependencies; this is source inspection, not SQL
 // execution. The known dated recipient gap is intentionally not papered over.
 const targetSql=fs.readFileSync(new URL('../supabase/migrations/20261003170000_native_target_source_projection.sql',import.meta.url),'utf8');
 equal(targetSql.includes('from public.weekly_schedule_occurrences'),true);equal(targetSql.includes('from public.custodial_dated_occurrences'),false);
 const source=fs.readFileSync(new URL('../src/native-schedule-preparation.js',import.meta.url),'utf8');
 equal(/fetch\(|execute\(|sendMessage\(|Date\.now/.test(source),false);
 const dated=await runNativeScheduleDatedReaderTests();
 return {status:'PASS',checks:checks+dated.checks,original_checks:checks,dated_checks:dated.checks,scope:'source-only SCHEDULE 09:45 occurrence adapter; synthetic read edges',sql_executed:false,solver_executed:false,delivery_admitted:false};
}
if(process.argv[1]===fileURLToPath(import.meta.url))console.log(JSON.stringify(await runNativeScheduleOccurrenceTests()));
