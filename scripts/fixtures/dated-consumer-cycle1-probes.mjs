import assert from 'node:assert/strict';
import fs from 'node:fs';
import {consolidateScheduleItems as beforeDisplay} from './dated-display-before-cycle1.js';
async function fixedDashboard(sql,definition,now,columns='distinct schedule_authority_source,schedule_projection_status',where=''){
 const fixed=definition.replace(/;\s*$/,'').replaceAll('now()',`timestamptz '${now}'`);
 const output=await sql(`begin;create or replace view public.v_location_dashboard_status as ${fixed};set local role custodial_application_reader;select coalesce(jsonb_agg(d),'[]')::text from (select ${columns} from public.v_location_dashboard_status ${where}) d;rollback;`);
 return JSON.parse(output.split('\n').find(line=>line.startsWith('['))||'[]');
}
export async function correctAndVerifyConsumers({sql,query,read,plan,origin,check}){
 const dependencies=()=>query("select distinct v.relname as view,p.proname as function from pg_depend d join pg_rewrite r on r.oid=d.objid and d.classid='pg_rewrite'::regclass join pg_class v on v.oid=r.ev_class join pg_proc p on p.oid=d.refobjid and d.refclassid='pg_proc'::regclass where v.relname in('v_location_dashboard_status','v_memphis_area_schedule','v_restroom_check_timers') and p.proname like '%_dated_base'");
 const prior=await dependencies();assert.equal(prior.rows.length,3);
 const oldArea=await query("select count(*)::int n from public.v_memphis_area_schedule where service_date=date '2026-10-01'");assert.equal(oldArea.rows[0].n,0);
 const tammy=plan.rosterSlots.find(r=>r.displayName==='Tammy Miller');
 const times=['2026-09-30T17:00:00-05:00','2026-10-02T06:00:00-05:00','2026-10-01T06:00:00-05:00'];
 const beforePhases=[];
 for(const now of times){const r=await read(`select public.static_weekly_v5_read_employee_day(date '2026-10-01','${tammy.personId}'::uuid,'${now}'::timestamptz) as day`);beforePhases.push(r[0].day.phase);}
 assert.deepEqual(beforePhases,['after_shift','assigned_areas','assigned_areas']);
 const oldTimer=(await query("select * from public.mz_verified_visit_reminder_cycle('restroom',timestamptz '2026-10-01T09:00:00-05:00',null,timestamptz '2026-10-01T11:00:00-05:00')")).rows[0];assert.equal(oldTimer.status_code,'overdue');
 const rawBefore=plan.days[0].assignments.find(a=>a.workSnapshot.serviceMode==='response_only_no_clean'&&a.window.start<'09:45');
 const oldDisplay=beforeDisplay([{occurrence_id:'synthetic-before',coverage_start:rawBefore.window.start,coverage_end:rawBefore.window.end,coverage_purpose:'area_owner',service_mode:'response_only_no_clean'}]).items[0];assert.equal(oldDisplay.coverage_purpose,'deep_clean');assert.equal(oldDisplay.service_mode,undefined);
 const failing={viewDependencies:prior.rows,oldAreaRows:oldArea.rows[0].n,oldPhases:beforePhases,oldTimer,oldDisplay,allFourFailuresReproduced:true};
 if(process.env.DATED_POSTGRES_EVIDENCE_DIR)fs.mkdirSync(process.env.DATED_POSTGRES_EVIDENCE_DIR,{recursive:true});
 if(process.env.DATED_POSTGRES_EVIDENCE_DIR)fs.writeFileSync(process.env.DATED_POSTGRES_EVIDENCE_DIR+'/consumer-fail-before.json',JSON.stringify(failing,null,2)+'\n');
 check('cycle1 four failures reproduced on retained SQL and display before correction',()=>{});
 await sql(fs.readFileSync(new URL('../../supabase/migrations/20261001152633_october_dated_consumer_corrections.sql',import.meta.url),'utf8'));
 assert.equal((await dependencies()).rows.length,0);check('stored dashboard/area/restroom views rebind public authority OIDs',()=>{});
 for(const d of plan.days){
  const areas=await read(`select * from public.v_memphis_area_schedule where service_date=date '${d.serviceDate}'`);
  check('area view enumerates exact active dated assignments '+d.serviceDate,()=>assert.equal(areas.length,d.assignments.length));
  const employees=await read(`select count(*)::int n from public.v_memphis_employee_schedule where service_date=date '${d.serviceDate}'`);
  check('dependent employee view includes exact named assignments '+d.serviceDate,()=>assert.equal(employees[0].n,d.assignments.filter(a=>a.personId).length));
  const load=await read(`select coalesce(sum(assigned_segments),0)::int n from public.v_memphis_employee_load_summary where service_date=date '${d.serviceDate}'`);
  check('dependent load view includes exact assigned rows '+d.serviceDate,()=>assert.equal(load[0].n,d.assignments.filter(a=>a.status==='ASSIGNED').length));
 }
 const open=await read("select * from public.v_memphis_open_segments where service_date=date '2026-10-02'");check('dependent OPEN view preserves Friday owner exception',()=>{assert.equal(open.length,1);assert.equal(open[0].group_code,'HERPETARIUM');assert.equal(open[0].coverage_start,'15:00');assert.equal(open[0].coverage_end,'16:00');});
 const view=(await query("select pg_get_viewdef('public.v_location_dashboard_status'::regclass,true) as definition")).rows[0].definition.replace(/;\s*$/,'');
 const fixed=now=>view.replaceAll('now()',`timestamptz '${now}'`);
 const dashboard=await fixedDashboard(sql,view,'2026-10-01T11:00:00-05:00');
 check('actual dashboard agrees with direct accepted dated authority',()=>assert.deepEqual(dashboard,[{schedule_authority_source:'static_weekly_projection',schedule_projection_status:'current'}]));
 const phaseCases=[['2026-09-30T06:00:00-05:00','before_shift'],['2026-09-30T17:00:00-05:00','before_shift'],['2026-10-02T06:00:00-05:00','after_shift'],['2026-10-02T17:00:00-05:00','after_shift'],['2026-10-01T04:59:00-05:00','before_shift'],['2026-10-01T06:00:00-05:00','assigned_areas'],['2026-10-01T14:00:00-05:00','after_shift']];
 for(const [now,expected] of phaseCases){const response=await fetch(`${origin}/schedule-api/my-day-summary?employee_id=${tammy.personId}&service_date=2026-10-01&as_of=${encodeURIComponent(now)}`);const body=await response.json();check('actual HTTP calendar/date shift phase '+now,()=>{assert.equal(response.status,200);assert.equal(body.data.phase,expected);if(expected!=='assigned_areas')assert.equal(body.data.current_items.length,0);});}
 let normal=0,lunch=0;
 for(const day of plan.days)for(const person of plan.rosterSlots.filter(p=>p.personId)){
  const response=await fetch(`${origin}/schedule-api/my-day-summary?employee_id=${person.personId}&service_date=${day.serviceDate}&as_of=${encodeURIComponent(day.serviceDate+'T08:00:00-05:00')}`);const body=await response.json();assert.equal(response.status,200);
  for(const raw of body.data.raw_items.filter(r=>r.service_mode==='response_only_no_clean')){
   const display=body.data.display_items.find(r=>r.occurrence_id===raw.occurrence_id&&r.coverage_purpose===raw.coverage_purpose);assert.ok(display);assert.equal(display.service_mode,raw.service_mode);assert.equal(display.creates_deep_clean,false);assert.notEqual(display.coverage_purpose,'deep_clean');assert.match(display.instruction,/Respond to issues only/);assert.ok(body.data.display_sections.some(s=>s.items.some(i=>i===display||i.occurrence_id===display.occurrence_id&&i.service_mode===raw.service_mode)));
   if(raw.coverage_purpose==='lunch_coverage')lunch++;else normal++;
  }
 }
 check('actual HTTP normal and loan response-only items/sections preserve no-clean mode',()=>{assert.equal(normal,26);assert.equal(lunch,plan.days.flatMap(d=>d.lunchLoans.flatMap(l=>l.responsibilities.flatMap(r=>r.segments.filter(s=>s.serviceMode==='response_only_no_clean')))).length);});
 const adminIds=[...new Set(plan.days.flatMap(d=>d.assignments.filter(a=>['EAST_ADMIN','WEST_ADMIN'].includes(a.workSnapshot.locationCodeSnapshot)).flatMap(a=>a.workSnapshot.includedLocations.map(l=>l.locationId))))];
 const nonAdmin=plan.days[0].assignments.find(a=>a.workSnapshot.locationCodeSnapshot==='AQUARIUM'&&a.workSnapshot.serviceMode==='scan_tracked').workSnapshot.includedLocations[0].locationId;
 for(const id of adminIds)for(const form of ['restroom','exhibit']){
  const timer=(await query(`select * from public.mz_verified_location_reminder_cycle('${id}'::uuid,'${form}',timestamptz '2026-10-01T09:00:00-05:00',null,timestamptz '2026-10-01T11:00:00-05:00')`)).rows[0];
  check('actual 180-minute Admin deadline '+id+'/'+form,()=>{assert.equal(timer.overdue_at.toISOString(),'2026-10-01T17:00:00.000Z');assert.equal(timer.status_code,null);assert.equal(timer.cycle_base_evidence,'completed_cleaning');});
 }
 for(const form of ['restroom','exhibit']){
  const r=(await query(`select to_jsonb(c) new, (select to_jsonb(o) from public.mz_verified_visit_reminder_cycle('${form}',timestamptz '2026-10-01T09:00:00-05:00',null,timestamptz '2026-10-01T11:00:00-05:00') o) old from public.mz_verified_location_reminder_cycle('${nonAdmin}'::uuid,'${form}',timestamptz '2026-10-01T09:00:00-05:00',null,timestamptz '2026-10-01T11:00:00-05:00') c`)).rows[0];check('non-Admin timer behavior unchanged '+form,()=>assert.deepEqual(r.new,r.old));
 }
 const id=adminIds[0];
 const reset=(await query(`select * from public.mz_verified_location_reminder_cycle('${id}'::uuid,'restroom',timestamptz '2026-10-01T09:00:00-05:00',timestamptz '2026-10-01T10:00:00-05:00',timestamptz '2026-10-01T11:00:00-05:00')`)).rows[0];check('verified check resets actual Admin cycle without fabricating a clean',()=>{assert.equal(reset.overdue_at.toISOString(),'2026-10-01T18:00:00.000Z');assert.equal(reset.cycle_base_evidence,'verified_check_checkout');});
 assert.equal((await query(`select * from public.mz_verified_location_reminder_cycle('${id}'::uuid,'restroom',null,timestamptz '2026-10-01T10:00:00-05:00',timestamptz '2026-10-01T11:00:00-05:00')`)).rows.length,0);check('check-only visit cannot arm an uncleaned Admin area',()=>{});
 // Explicit synthetic completed-cleaning rows; no native/physical proof is
 // inferred. Preserve the actual dashboard/evidence/reset calculation.
 const kathy=plan.rosterSlots.find(r=>r.displayName==='Kathy Phelps');
 await query(`insert into public.devices(id,device_id,device_name,assigned_employee_id) values('97000000-0000-4000-8000-000000000001','SYNTHETIC_TIMER_FIXTURE','Synthetic timer fixture','${kathy.personId}')`);
 for(const [i,location] of [adminIds[0],nonAdmin].entries()){
  const sid=`97000000-0000-4000-8000-${String(i+2).padStart(12,'0')}`;
  await query(`insert into public.sessions(id,session_uuid,location_id,employee_id,device_id,status,started_at,ended_at) values('${sid}','${sid}','${location}','${kathy.personId}','97000000-0000-4000-8000-000000000001','closed',timestamptz '2026-10-01T08:30:00-05:00',timestamptz '2026-10-01T09:00:00-05:00')`);
  await query(`insert into public.completion_responses(session_id,location_id,submitted_by_employee_id,device_id,response_json,submitted_at) values('${sid}','${location}','${kathy.personId}','97000000-0000-4000-8000-000000000001','{"work_result":"full","services_performed":["Full cleaning services"]}'::jsonb,timestamptz '2026-10-01T09:00:00-05:00')`);
 }
 for(const now of ['2026-10-01T10:15:00-05:00','2026-10-01T10:45:00-05:00','2026-10-01T11:15:00-05:00']){
  const result=await fixedDashboard(sql,view,now,'location_id,status_code',`where location_id in('${adminIds[0]}','${nonAdmin}') order by location_id`);
  check('actual dashboard Admin policy survives lunch ownership boundary '+now,()=>{assert.equal(result.find(r=>r.location_id===adminIds[0]).status_code,'okay');assert.equal(result.find(r=>r.location_id===nonAdmin).status_code,now.includes('10:15')?'due_soon':'overdue');});
 }
 const midnight=(await query(`select public.mz_is_approved_admin_location('${adminIds[0]}',timestamptz '2026-09-30T23:59:00-05:00') prior,public.mz_is_approved_admin_location('${adminIds[0]}',timestamptz '2026-10-01T00:00:00-05:00') current`)).rows[0];check('three-hour policy begins October1 without backdating',()=>assert.deepEqual(midnight,{prior:false,current:true}));
 // Rebind the actual existing view to a fixed observation ONLY in a rolled-back
 // fixture transaction; execute the actual caller, then restore its definition.
 await sql(`begin;create or replace view public.v_location_dashboard_status as ${fixed('2026-10-01T11:00:00-05:00')};select public.mz_location_reminder_candidates(date '2026-10-01',timestamptz '2026-10-01T11:00:00-05:00');rollback;`);
 const caller=await sql(`begin;create or replace view public.v_location_dashboard_status as ${fixed('2026-10-01T11:00:00-05:00')};select jsonb_agg(location_id)::text from public.mz_location_reminder_candidates(date '2026-10-01',timestamptz '2026-10-01T11:00:00-05:00');rollback;`);
 check('actual reminder candidates suppress Admin before three-hour due while retaining non-Admin overdue',()=>{const ids=JSON.parse(caller.split('\n').find(line=>line.startsWith('['))||'[]');assert.ok(!ids.includes(adminIds[0]));assert.ok(ids.includes(nonAdmin));});
 const definition=(await query("select pg_get_functiondef('public.mz_location_reminder_candidates(date,timestamptz)'::regprocedure) definition")).rows[0].definition.replace(/;\s*$/,'');
 check('actual reminder candidate caller supplies canonical location to timer',()=>{assert.match(definition,/mz_verified_location_reminder_cycle\(status.location_id,/);assert.match(view,/mz_is_approved_admin_location/);});
 return {view,fixed};
}
export async function verifyConsumerViewState({sql,query,read,check,stage}){
 const area=await read("select count(*)::int n from public.v_memphis_area_schedule where service_date>=date '2026-10-01' and service_date<date '2026-10-05'");check('compatibility area fails closed or returns baseline after '+stage,()=>assert.equal(area[0].n,0));
 const view=(await query("select pg_get_viewdef('public.v_location_dashboard_status'::regclass,true) definition")).rows[0].definition.replace(/;\s*$/,'');
 const rows=await fixedDashboard(sql,view,'2026-10-01T11:00:00-05:00');
 check('dashboard source truth after '+stage,()=>assert.deepEqual(rows,[{schedule_authority_source:stage==='staleness'?'static_weekly_projection':'legacy_daily_schedule',schedule_projection_status:stage==='staleness'?'stale_dated_dependency':'legacy_ungoverned'}]));
}
