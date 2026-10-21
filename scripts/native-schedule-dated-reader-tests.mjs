import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {deriveNativeScheduleOccurrence as derive} from '../src/native-schedule-occurrence.js';
import {prepareNativeScheduleOccurrence as prepare,nativeScheduleSnapshotSql} from '../src/native-schedule-preparation.js';
import {nativeScheduleDatedReaderFixture as fixture,EMPTY_NONPHYSICAL_SQL} from './fixtures/native-schedule-dated-reader-source.mjs';
const clone=x=>structuredClone(x);
export async function runNativeScheduleDatedReaderTests(){
 let checks=0;const eq=(a,b,m)=>{assert.deepEqual(a,b,m);checks++;};
 const input=f=>({request:f.request,targetBefore:f.target,targetAfter:clone(f.target),snapshot:f.snapshotForSql(nativeScheduleSnapshotSql(f.request.serviceDate))});
 for(const [i,date]of ['2026-10-01','2026-10-02','2026-10-03','2026-10-04'].entries()){
  const f=fixture(date),raw=JSON.stringify(f.raw),sql=nativeScheduleSnapshotSql(date);
  eq(f.raw.lunch.filter(l=>l.included_location_ids===null).length,[2,4,4,2][i],'actual plan empty nonphysical lunch rows');
  const result=derive(input(f));eq(result.status,f.expected.changed?'POLICY_AUTHORITY_REQUIRED':'NO_OWNERSHIP_CHANGE','dated source-derived reader shape '+date);
  if(f.expected.changed){eq(result.occurrence.before_units,f.expected.before);eq(result.occurrence.after_units,f.expected.after);}
  else eq(result.occurrence,null,'unchanged employee receives no synthetic episode');
  eq(result.delivery_admitted,false);eq(result.dispatch_authorized,false);eq(result.valid_until,null);eq(result.effect_authority,null);
  eq(JSON.stringify(f.raw),raw,'raw SQL-shaped NULL evidence unchanged');eq(f.provenance.sql_executed,false);eq(f.provenance.target_synthetic,true);
  eq(sql.includes(EMPTY_NONPHYSICAL_SQL),true);
  const observed=input(f),serialized=JSON.stringify(observed.snapshot);
  eq(observed.snapshot.lunch.filter(l=>l.included_location_ids===null).length,[2,4,4,2][i],'raw NULL retained in actual adapter input');
  derive(observed);eq(JSON.stringify(observed.snapshot),serialized,'derivation never normalizes input in place');
  const calls=[];const r=await prepare({...f.request,runRpc:async()=>{calls.push('target');return{data:clone(f.target)};},
   runReadOnlySql:async actual=>{calls.push('snapshot');eq(actual,sql);return[{data:f.snapshotForSql(actual)}];}});
  eq(r,result);eq(calls,['target','snapshot','target']);eq(derive(input(f)),result,'repeat cannot mint another identity');
  const x=input(f);x.snapshot.segments.reverse();x.snapshot.physical.reverse();x.snapshot.lunch.reverse();eq(derive(x),result,'reader order immaterial');
 }
 const openFixture=fixture('2026-10-02'),open=openFixture.raw.segments.find(s=>s.status==='OPEN');
 eq([open.owner_type,open.assigned_employee_id,open.coverage_start,open.coverage_end],['OPEN',null,'15:00','16:00']);
 const openReport=derive(input(openFixture));const without=input(openFixture);
 without.snapshot.segments=without.snapshot.segments.filter(s=>s.segment_id!==open.segment_id);
 without.snapshot.physical=without.snapshot.physical.filter(p=>p.occurrence_id!==open.segment_id);
 eq(derive(without).occurrence?.semantic_sha256,openReport.occurrence?.semantic_sha256,'unrelated later truthful gap is not employee coverage');
 const bad=(mutate,date='2026-10-03')=>{const f=fixture(date);mutate(f);const raw=JSON.stringify(f.raw);const r=derive(input(f));eq(r.status,'SOURCE_UNAVAILABLE');eq(r.occurrence,null);eq(JSON.stringify(f.raw),raw);};
 bad(f=>f.raw.lunch.find(l=>l.service_mode==='scan_tracked').included_location_ids=null);
 bad(f=>f.raw.lunch.find(l=>l.service_mode==='scan_tracked').included_location_ids=[]);
 for(const value of [null,{},['unknown'],{length:0}])bad(f=>{f.raw.lunch.find(l=>l.included_location_ids===null).included_snapshots=value;});
 bad(f=>{const l=f.raw.lunch.find(l=>l.included_location_ids===null);l.included_location_ids=undefined;});
 bad(f=>{const l=f.raw.lunch.find(l=>l.included_location_ids===null);l.service_mode='unknown';});
 for(const mutate of [s=>s.owner_type='EMPLOYEE',s=>s.assigned_employee_id=openFixture.request.employeeId,s=>s.status='ASSIGNED',s=>s.owner_type='COVERALL'])
  bad(f=>mutate(f.raw.segments.find(s=>s.status==='OPEN')),'2026-10-02');
 bad(f=>{const s=f.raw.segments.find(s=>s.status==='OPEN'),l=f.raw.lunch[0];
  Object.assign(l,{normal_occurrence_id:s.segment_id,normal_owner_id:null,location_group_id:s.location_group_id,
   included_location_ids:[...s.included_location_ids],service_mode:s.service_mode,coverage_start:'15:00:00',coverage_end:'15:30:00'});},'2026-10-02');
 bad(f=>{f.raw.segments.find(s=>s.status==='ASSIGNED').assigned_employee_id=null;});
 bad(f=>f.raw.authority[0].authority_source='dated_projection');
 bad(f=>f.raw.segments[0].source_type='dated_projection');
 bad(f=>f.raw.physical[0].authority_source='dated_projection');
 bad(f=>f.raw.authority[0].projection_status='stale_dated_dependency');
 bad(f=>f.raw.physical[0].assigned_employee_id=f.request.generationId);
 const changed=fixture('2026-10-04'),rawNull=input(changed),explicitEmpty=clone(rawNull);
 for(const l of explicitEmpty.snapshot.lunch)if(l.included_location_ids===null)l.included_location_ids=[];
 const nullReport=derive(rawNull),emptyReport=derive(explicitEmpty);
 eq(nullReport.occurrence.semantic_sha256,emptyReport.occurrence.semantic_sha256,'equivalent empty membership');
 eq(nullReport.occurrence.source_sha256!==emptyReport.occurrence.source_sha256,true,'raw NULL evidence remains distinct from []');
 for(const edit of [x=>delete x.snapshot.lunch[0].included_snapshots_empty,x=>x.snapshot.lunch[0].included_snapshots_empty='false',
  x=>x.snapshot.lunch.find(l=>l.service_mode!=='scan_tracked').included_snapshots_empty=false,
  x=>x.snapshot.lunch.find(l=>l.service_mode==='scan_tracked').included_snapshots_empty=true]){
  const x=input(fixture('2026-10-03'));edit(x);eq(derive(x).status,'SOURCE_UNAVAILABLE');
 }
 const f=fixture('2026-10-03');let n=0;
 const race=await prepare({...f.request,runReadOnlySql:async sql=>[{data:f.snapshotForSql(sql)}],runRpc:async()=>{
  const t=clone(f.target);if(++n===2)t.recipient.assignment_epoch++;return{data:t};}});
 eq(race.status,'SOURCE_UNAVAILABLE');
 return {status:'PASS',checks,scope:'source-pinned simulated dated reader DTO and actual pure preparation; no SQL/authority/dispatch proof',sql_executed:false,solver_executed:false};
}
if(process.argv[1]===fileURLToPath(import.meta.url))console.log(JSON.stringify(await runNativeScheduleDatedReaderTests()));
