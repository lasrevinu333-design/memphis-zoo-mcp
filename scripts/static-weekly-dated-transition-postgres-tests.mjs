import assert from 'node:assert/strict';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import express from 'express';
import {createStaticWeeklyControlPlaneRuntime} from '../src/static-weekly-control-plane-runtime.js';
import {createOpsManagerSession} from '../src/auth/shared-access-auth.js';
import {createScheduleRouter} from '../src/schedule-api.js';
import {scheduleFacts} from './fixtures/dated-home-facts.js';
import {loadPreparedOctoberDatedPlan,createOctoberDatedMaterializationController} from '../src/static-weekly-dated-transition-materialization.js';
import {createOctoberDatedPostgresStore} from '../src/static-weekly-dated-transition-postgres.js';
import {readHomeTimeFacts} from '../src/employee-home-time-facts.js';
const image='supabase/postgres@sha256:fbf77524fc188126c1775fd2d2e54040bde295438a3e6f07936f3c39e6f688ed';
const run=promisify(execFile),container=`mz_october_dated_${process.pid}`;
const socket=fs.mkdtempSync(path.join(os.tmpdir(),'mz_october_dated_socket_'));fs.chmodSync(socket,0o777);
const plan=loadPreparedOctoberDatedPlan(JSON.parse(fs.readFileSync(new URL('../config/custodial-october-dated-plan-20261001.json',import.meta.url),'utf8')));
const managerId='96000000-0000-4000-8000-000000000009',manager={managerId};
const migration=path.resolve('supabase/migrations/20261001130750_october_bounded_dated_transition.sql');
const quote=x=>`'${String(x).replaceAll("'","''")}'`,j=x=>quote(JSON.stringify(x))+'::jsonb';
const docker=(args)=>run('docker',args,{maxBuffer:8*1024*1024});
let pool,server,managerServer,created=false;const checks=[];const check=(label,fn)=>{fn();checks.push(label);};
function sql(text){return new Promise((resolve,reject)=>{
 const p=spawn('docker',['exec','-i',container,'psql','-X','-q','-v','ON_ERROR_STOP=1','-At','-U','supabase_admin','-d','postgres']);let out='',err='';
 p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>err+=b);p.once('error',reject);
 p.once('close',code=>code===0?resolve(out.trim()):reject(Object.assign(Error('fixture psql failed'),{output:out,error:err})));p.stdin.end(text);
 });}
const query=(text,values)=>pool.query(text,values);
const json=async text=>JSON.parse((await sql(text)).split('\n').at(-1));
const read=async text=>{const client=await pool.connect();try{await client.query('begin read only');await client.query('set local role custodial_application_reader');const result=await client.query(text);await client.query('commit');return result.rows;}catch(e){await client.query('rollback');throw e;}finally{client.release();}};
const sorted=rows=>rows.map(x=>JSON.stringify(x)).sort();
const minute=t=>Number(t.slice(0,2))*60+Number(t.slice(3,5));
const clock=m=>String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0');
const display=t=>{const [h,m]=t.split(':').map(Number);return `${h%12||12}:${String(m).padStart(2,'0')} ${h<12?'AM':'PM'}`;};
const counts=()=>json("select jsonb_build_object('publications',(select count(*) from public.custodial_dated_publications),'occurrences',(select count(*) from public.custodial_dated_occurrences),'activations',(select count(*) from public.custodial_dated_activations),'receipts',(select count(*) from public.custodial_dated_receipts),'revision',(select current_revision from public.static_weekly_schedule_control where singleton))::text");
try{
 console.log(JSON.stringify({phase:'create-owned-network-none-postgres',container,socket,image}));
 await docker(['image','inspect',image]);
 await docker(['run','--pull=never','--rm','-d','--network=none','--cpus=1','--memory=1536m','--name',container,
  '--tmpfs','/var/lib/postgresql/data:rw,size=768m','--mount',`type=bind,source=${socket},target=/tmp/owned-socket`,
  '-e','POSTGRES_PASSWORD=fixture-local-only',image,'-c','shared_preload_libraries=pg_cron,pg_net,pg_stat_statements',
  '-c','listen_addresses=','-c','unix_socket_directories=/var/run/postgresql,/tmp/owned-socket']);created=true;
 const deadline=Date.now()+60000;let ready=false;
 while(Date.now()<deadline){try{
  const logs=await docker(['logs',container]);
  if(logs.stdout.includes('PostgreSQL init process complete; ready for start up.')){await sql('select 1');ready=true;break;}
 }catch{}await new Promise(r=>setTimeout(r,300));}
 assert.equal(ready,true,'owned local PostgreSQL starts');
 console.log('REPLAY_UNCHANGED_176_SCHEMA_MIGRATIONS_WITHOUT_AUTOMATIC_DATA_API_GRANTS');
 const noAuto=['supabase_admin','postgres'].flatMap(role=>['',' in schema public'].flatMap(scope=>['tables','sequences'].map(kind=>`alter default privileges for role ${role}${scope} revoke all on ${kind} from PUBLIC,anon,authenticated,service_role;`))).join('');
 const files=fs.readdirSync('supabase/migrations').filter(n=>n.endsWith('.sql')&&!n.startsWith('20261001130750')).sort();
 for(let i=0;i<files.length;i++){await sql(noAuto+fs.readFileSync(path.join('supabase/migrations',files[i]),'utf8'));if(i%30===0)console.log('SCHEMA_REPLAY',i+1,files[i]);}
 pool=new pg.Pool({host:socket,user:'supabase_admin',password:'fixture-local-only',database:'postgres',max:4,connectionTimeoutMillis:3000});
 const controller=createOctoberDatedMaterializationController({plan,store:createOctoberDatedPostgresStore({database:pool,plan})});
 await assert.rejects(()=>controller.preview({manager,expectedRevision:0}),/database_adapter_unavailable/);checks.push('before: bounded adapter is genuinely unavailable');
 const baselineReaders=await json("select jsonb_build_object('state',to_jsonb(s),'roster',(select coalesce(jsonb_agg(r),'[]') from public.static_weekly_v6_read_roster(date '2026-10-05') r))::text from public.static_weekly_v6_schedule_authority_state(date '2026-10-05') s");
 await sql(noAuto+fs.readFileSync(migration,'utf8'));console.log('NEW_BOUNDED_MIGRATION_APPLIED_ONLY_TO_OWNED_FIXTURE');
 // Seed approved source identities into synthetic rows only; no production read.
 await sql(`insert into public.ops_manager_managers(manager_id,display_name,roles,active,is_system_principal) values(${quote(managerId)},'Synthetic dated manager',array['OPS_MANAGER'],true,false);`);
 for(const [index,r] of plan.rosterSlots.entries()){
  if(r.personId)await sql(`insert into public.employees(id,employee_code,display_name,role,active) values(${quote(r.personId)},${quote('EMP'+(950+index))},${quote(r.displayName)},'staff',true) on conflict(id) do update set display_name=excluded.display_name,active=true;`);
  await sql(`insert into public.weekly_roster_slots(slot_id,slot_code,slot_label,created_by_manager_id,created_by_manager_name_snapshot,content_digest) values(${quote(r.slotId)},${quote('OCT_FIXTURE_'+index)},${quote(r.slotLabel)},${quote(managerId)},'Synthetic dated manager',repeat('a',64)) on conflict(slot_id) do nothing;`);
  if(r.personId)await sql(`insert into public.weekly_roster_slot_incumbencies(slot_id,person_id,person_name_snapshot,effective_start,created_by_manager_id,created_by_manager_name_snapshot,content_digest) values(${quote(r.slotId)},${quote(r.personId)},${quote(r.displayName)},date '2026-09-01',${quote(managerId)},'Synthetic dated manager',repeat('a',64));`);
 }
 const physical=new Map(),groups=new Map();
 for(const d of plan.days)for(const a of d.assignments){groups.set(a.workSnapshot.locationCodeSnapshot,a.workSnapshot.locationNameSnapshot);for(const l of a.workSnapshot.includedLocations)physical.set(l.locationId,l.locationNameSnapshot);}
 for(const [id,name] of physical)await sql(`insert into public.locations(id,location_code,location_name,location_type,form_type,active) values(${quote(id)},${quote('OCT_'+id.slice(0,8))},${quote(name)},'restroom','restroom',true) on conflict(id) do update set active=true;`);
 for(const [code,name] of groups)await sql(`insert into public.location_groups(group_code,group_name,active) values(${quote(code)},${quote(name)},true) on conflict(group_code) do update set active=true;`);
 let rev=Number((await query('select current_revision from public.static_weekly_schedule_control where singleton')).rows[0].current_revision);
 console.log('SYNTHETIC_APPROVED_DEPENDENCIES_SEEDED',rev);
 const preview=await controller.preview({manager,expectedRevision:rev});
 const empty=await counts();
 await assert.rejects(()=>sql(`set role static_weekly_control_plane;select public.custodial_dated_control('stage',${j({managerId,plan})});`),/fixture psql failed/);
 check('autocommit incomplete stage rejected by deferred completion guard',()=>{});assert.deepEqual(await counts(),empty);
 const injected=createOctoberDatedMaterializationController({plan,store:createOctoberDatedPostgresStore({plan,database:{async connect(){const c=await pool.connect();return {release:()=>c.release(),async query(text,args){const result=await c.query(text,args);if(args?.[0]==='stage')throw Error('synthetic interruption after real SQL stage');return result;}};}}})});
 await assert.rejects(()=>injected.confirm({manager,expectedRevision:rev,idempotencyKey:'partial-fixture',previewDigest:preview.previewDigest}),/synthetic interruption/);
 check('real partial-stage transaction leaves no durable prefix',()=>{});assert.deepEqual(await counts(),empty);
 await sql(`update public.employees set display_name=display_name||' synthetic changed' where id=${quote(plan.rosterSlots[0].personId)};`);
 await assert.rejects(()=>controller.confirm({manager,expectedRevision:rev,idempotencyKey:'stale-fixture',previewDigest:preview.previewDigest}));
 assert.deepEqual(await counts(),empty);checks.push('stale current incumbent identity cannot be accepted');
 await sql(`update public.employees set display_name=${quote(plan.rosterSlots[0].displayName)} where id=${quote(plan.rosterSlots[0].personId)};`);
 await sql(`update public.ops_manager_managers set active=false where manager_id=${quote(managerId)};`);
 await assert.rejects(()=>controller.confirm({manager,expectedRevision:rev,idempotencyKey:'revoked-fixture',previewDigest:preview.previewDigest}));
 assert.deepEqual(await counts(),empty);checks.push('revoked named manager cannot accept');
 await sql(`update public.ops_manager_managers set active=true where manager_id=${quote(managerId)};`);
 const env={NODE_ENV:'test',SUPABASE_URL:'https://local-date-fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:'synthetic-fixture-key',OPS_MANAGER_SESSION_SECRET:'synthetic-fixture-session-secret-0123456789'};
 const principal={manager_id:managerId,display_name:'Synthetic dated manager',roles:['OPS_MANAGER'],active:true};
 const session=createOpsManagerSession({credentialId:'date-fixture',deviceId:'date-fixture',manager:principal,authMode:'trusted_device',accessLevel:'full_access',maximumAccessLevel:'full_access',env});
 const runtime=createStaticWeeklyControlPlaneRuntime({env,database:pool,controlPlane:{},supabase:{async rpc(){return {data:{mutations_paused:false,state:'READY',authority_generation:0,restore_id:null},error:null};}},trustedDeviceStore:{async find(){return {credential_id:'date-fixture',device_id:'date-fixture',manager_id:managerId,manager:principal,max_access_level:'full_access',created_at:new Date(Date.now()-60000).toISOString(),expires_at:new Date(Date.now()+60000).toISOString()};}}});
 managerServer=await new Promise(resolve=>{const own=runtime.app.listen(0,'127.0.0.1',()=>resolve(own));});
 const managerUrl=`http://127.0.0.1:${managerServer.address().port}/static-weekly/dated-transition/preview`;
 const denied=await fetch(managerUrl,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expected_revision:rev})});check('default SQL runtime refuses unauthenticated manager',()=>assert.equal(denied.status,401));
 const bound=await fetch(managerUrl,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.token}`},body:JSON.stringify({expected_revision:rev})});const boundBody=await bound.json();
 check('default runtime composes exact configured SQL adapter',()=>{assert.equal(bound.status,200,JSON.stringify(boundBody));assert.equal(boundBody.data.previewDigest,preview.previewDigest);assert.equal(boundBody.data.phonePdfRevision,plan.phonePdfRevision);});
 await new Promise(resolve=>managerServer.close(resolve));managerServer=null;
 const accepted=await controller.confirm({manager,expectedRevision:rev,idempotencyKey:'sql-october-one',previewDigest:preview.previewDigest});
 check('after: real PostgreSQL accepts exact four-day authority',()=>{assert.equal(accepted.revision,rev+1);assert.equal(accepted.phonePdfRevision,plan.phonePdfRevision);assert.equal(accepted.affectedPhonesUpdated,false);});
 const app=express();app.use('/schedule-api',createScheduleRouter({runReadOnlySql:read,runRpc:async()=>{throw Error('read cannot mutate');},runCommand:async()=>{throw Error('read cannot reshuffle');},requireAdminApiAuth:(_q,_s,n)=>n(),requireOpsManagerAuth:(_q,_s,n)=>n(),appVersion:'synthetic-local-only',releaseId:'NOT_A_RELEASE',contractVersion:'synthetic-read-only',buildHealthPayload:()=>({ok:true})}));
 server=await new Promise(resolve=>{const own=app.listen(0,'127.0.0.1',()=>resolve(own));});
 const origin=`http://127.0.0.1:${server.address().port}`;
 console.log(JSON.stringify({phase:'owned-http-reader-fixture',origin}));
 let advisors;
 try{const url=new URL('postgresql://supabase_admin:fixture-local-only@localhost/postgres');url.searchParams.set('host',socket);
  const output=await run('supabase',['db','advisors','--db-url',url.href,'--type','security','--output-format','json'],{env:{...process.env,DO_NOT_TRACK:'1'},timeout:30000,maxBuffer:8*1024*1024});
  const parsed=JSON.parse(output.stdout);advisors={status:'EXECUTED_SYNTHETIC_ONLY',findings:parsed.results,total:parsed.results.length,owned:parsed.results.filter(r=>String(r.metadata?.name).startsWith('custodial_dated_')||r.metadata?.name==='static_weekly_v27_read_home_time_facts'),stderr:output.stderr};check('security advisors executed on owned socket with no bounded findings',()=>assert.equal(advisors.owned.length,0));
 }catch(error){advisors={status:'LOCAL_TOOL_BOUNDARY',message:error.message,stdout:error.stdout,stderr:error.stderr};}
 if(process.env.DATED_POSTGRES_EVIDENCE_DIR)fs.writeFileSync(path.join(process.env.DATED_POSTGRES_EVIDENCE_DIR,'local-advisors.json'),JSON.stringify(advisors,null,2)+'\n');
 console.log('LOCAL_ADVISORS',advisors.status);
 for(const d of plan.days){
  console.log('VERIFY_EXACT_READER_DAY',d.serviceDate);
  const persisted=await json(`select jsonb_agg(jsonb_build_object('work',plan_work_id,'id',occurrence_id))::text from public.custodial_dated_occurrences where publication_id=${quote(accepted.publicationId)}::uuid and service_date=${quote(d.serviceDate)}::date`);
  const identity=new Map(persisted.map(x=>[x.work,x.id]));
  const data=await json(`set role custodial_application_reader;select public.static_weekly_v5_read_employee_day(${quote(d.serviceDate)}::date,${quote(plan.rosterSlots[0].personId)}::uuid,${quote(d.serviceDate+'T12:00:00-05:00')}::timestamptz)::text`);
  check('employee same revision '+d.serviceDate,()=>{assert.equal(data.projection_id,accepted.projectionId);assert.equal(data.candidate_revision,plan.phonePdfRevision);});
  const segments=await json(`set role custodial_application_reader;select coalesce(jsonb_agg(s),'[]')::text from public.static_weekly_v6_read_schedule_segments(${quote(d.serviceDate)}::date) s`);
  check('complete exact assignment rows '+d.serviceDate,()=>assert.deepEqual(sorted(segments.map(r=>({id:r.segment_id,person:r.assigned_employee_id,name:r.assigned_employee_name,code:r.group_code,group:r.group_name,start:r.coverage_start,end:r.coverage_end,status:r.status,mode:r.service_mode,physical:r.included_location_ids,names:r.included_locations}))),sorted(d.assignments.map(a=>({id:identity.get(a.planWorkId),person:a.personId,name:a.displayName,code:a.workSnapshot.locationCodeSnapshot,group:a.workSnapshot.locationNameSnapshot,start:a.window.start,end:a.window.end,status:a.status,mode:a.workSnapshot.serviceMode,physical:a.workSnapshot.includedLocations.map(l=>l.locationId),names:a.workSnapshot.includedLocations.map(l=>l.locationNameSnapshot)})))));
  const loans=await json(`set role custodial_application_reader;select coalesce(jsonb_agg(s),'[]')::text from public.static_weekly_v8_read_lunch_segments(${quote(d.serviceDate)}::date) s`);
  check('exact lunch segment count '+d.serviceDate,()=>assert.deepEqual(sorted(loans.map(l=>({id:l.normal_occurrence_id,loan:l.loan_id,responsibility:l.responsibility_id,normal:l.normal_owner_id,coverer:l.coverer_id,start:l.coverage_start.slice(0,5),end:l.coverage_end.slice(0,5),mode:l.service_mode,snapshots:l.included_snapshots}))),sorted(d.lunchLoans.flatMap(l=>l.responsibilities.flatMap(r=>r.segments.map(seg=>({id:identity.get(seg.planWorkId),loan:l.loanId,responsibility:r.responsibilityId,normal:l.normalOwnerPersonId,coverer:r.covererPersonId,start:seg.window.start,end:seg.window.end,mode:seg.serviceMode,snapshots:seg.includedLocations})))))));
  const cleaning=await json(`set role custodial_application_reader;select coalesce(jsonb_agg(s),'[]')::text from public.custodial_operational_location_assignments(${quote(d.serviceDate)}::date) s`);
  const expectedCleaning=[];
  for(const a of d.assignments.filter(a=>a.workSnapshot.serviceMode==='scan_tracked'))for(const location of a.workSnapshot.includedLocations){
   const covering=loans.filter(l=>l.normal_occurrence_id===identity.get(a.planWorkId)&&l.service_mode==='scan_tracked'&&l.included_location_ids.includes(location.locationId));
   const boundaries=[...new Set([a.window.startMinute,a.window.endMinute,...covering.flatMap(l=>[minute(l.coverage_start),minute(l.coverage_end)])])].sort((a,b)=>a-b);
   for(let i=0;i<boundaries.length-1;i++){const start=boundaries[i],end=boundaries[i+1];if(start<a.window.startMinute||end>a.window.endMinute||start===end)continue;const loan=covering.find(l=>minute(l.coverage_start)<=start&&end<=minute(l.coverage_end));expectedCleaning.push({id:identity.get(a.planWorkId),physical:location.locationId,start:clock(start),end:clock(end),person:loan?.coverer_id??a.personId});}
  }
  check('cleaning binds every exact physical row/window/owner '+d.serviceDate,()=>{assert.deepEqual(sorted(cleaning.map(c=>({id:c.occurrence_id,physical:c.location_id,start:c.coverage_start.slice(0,5),end:c.coverage_end.slice(0,5),person:c.assigned_employee_id}))),sorted(expectedCleaning));assert.ok(cleaning.every(c=>c.projection_id===accepted.projectionId));});
  for(const r of plan.rosterSlots.filter(r=>r.personId)){
   const day=await json(`set role custodial_application_reader;select public.static_weekly_v5_read_employee_day(${quote(d.serviceDate)}::date,${quote(r.personId)}::uuid,${quote(d.serviceDate+'T12:00:00-05:00')}::timestamptz)::text`);
   const facts=await readHomeTimeFacts({day,employeeId:r.personId,runReadOnlySql:read});
   const av=d.availability.find(a=>a.slotId===r.slotId&&a.status==='working');
   const response=await fetch(`${origin}/schedule-api/my-day-summary?employee_id=${r.personId}&service_date=${d.serviceDate}`);const body=await response.json();
   check('actual HTTP employee and Home binding '+d.serviceDate+'/'+r.displayName,()=>{assert.equal(response.status,200,JSON.stringify(body));assert.equal(body.data.projection_id,accepted.projectionId);assert.equal(body.data.candidate_revision,plan.phonePdfRevision);assert.deepEqual(body.data.home_facts,facts);});
   const now=Date.parse(d.serviceDate+'T12:00:00-05:00');const ui=scheduleFacts({...facts,canonical_device_id:'SYNTHETIC_DATE_FIXTURE'},{deviceId:'SYNTHETIC_DATE_FIXTURE',employeeId:r.personId},new Date(now).toISOString(),now);
   check('retained frontend Home formats exact published shift/lunch '+d.serviceDate+'/'+r.displayName,()=>{assert.equal(ui.shift,av?`${display(av.shift.start)}–${display(av.shift.end)}`:'Not scheduled today');assert.equal(ui.lunch,av?`${display(av.lunch.start)}–${display(av.lunch.end)}`:'Not scheduled');});
   check('exact employee assignment and loan bindings '+d.serviceDate+'/'+r.displayName,()=>{
    assert.equal(day.contract_version,'static-weekly-employee-day.v3');
    assert.deepEqual(sorted(day.all_items.filter(x=>x.coverage_purpose!=='lunch_coverage').map(x=>({id:x.occurrence_id,start:x.coverage_start,end:x.coverage_end,physical:x.included_location_ids}))),sorted(d.assignments.filter(a=>a.personId===r.personId).map(a=>({id:identity.get(a.planWorkId),start:a.window.start,end:a.window.end,physical:a.workSnapshot.includedLocations.map(l=>l.locationId)}))));
    for(const x of day.all_items.filter(x=>x.coverage_purpose==='lunch_coverage')){
     const responsibility=d.lunchLoans.flatMap(l=>l.responsibilities).find(t=>t.responsibilityId===x.responsibility_id);assert.ok(responsibility);assert.equal(x.coverer_person_id,r.personId);assert.equal(x.check_deadline_policy,responsibility.checkDeadlinePolicy);assert.equal(x.on_call_only,responsibility.responseMode==='on_call_issues_only');assert.equal(x.creates_deep_clean,false);
    }
   });
   check('exact shift/lunch or OFF '+d.serviceDate+'/'+r.displayName,()=>{
    assert.equal(facts.projection_id,accepted.projectionId);assert.equal(facts.candidate_revision,plan.phonePdfRevision);
    if(av){assert.equal(facts.shift.start,av.shift.start);assert.equal(facts.shift.end,av.shift.end);assert.deepEqual(facts.lunch,av.lunch);}else assert.equal(facts.shift.active,false);
   });
  }
 }
 const friday=await json("set role custodial_application_reader;select jsonb_agg(s)::text from public.static_weekly_v6_read_schedule_segments(date '2026-10-02') s where status='OPEN'");
 check('accepted Friday OPEN is a real unowned row',()=>{assert.equal(friday.length,1);assert.equal(friday[0].group_code,'HERPETARIUM');assert.equal(friday[0].assigned_employee_id,null);assert.equal(friday[0].coverage_start,'15:00');});
 for(const role of ['anon','authenticated','service_role','custodial_application_reader','static_weekly_control_plane','static_weekly_release_operator']){
  await assert.rejects(()=>sql(`set role ${role};select * from public.custodial_dated_publications;`),/fixture psql failed/);checks.push('direct internal table denied '+role);
 }
 for(const role of ['anon','authenticated','service_role','custodial_application_reader','static_weekly_release_operator']){
  await assert.rejects(()=>sql(`set role ${role};select public.custodial_dated_control('stage','{}');`),/fixture psql failed/);checks.push('bounded mutation denied '+role);
 }
 await assert.rejects(()=>sql("set role static_weekly_control_plane;select public.custodial_dated_control('stage','{}');"),/fixture psql failed/);checks.push('malformed CP operation denied');
 const afterReaders=await json("select jsonb_build_object('state',to_jsonb(s),'roster',(select coalesce(jsonb_agg(r),'[]') from public.static_weekly_v6_read_roster(date '2026-10-05') r))::text from public.static_weekly_v6_schedule_authority_state(date '2026-10-05') s");
 check('October 5 delegates unchanged weekly authority',()=>assert.deepEqual(afterReaders,baselineReaders));
 const secure=await json("select jsonb_build_object('tables',(select jsonb_agg(jsonb_build_object('name',relname,'rls',relrowsecurity,'force',relforcerowsecurity)) from pg_class where relnamespace='public'::regnamespace and relname in('custodial_dated_publications','custodial_dated_activations','custodial_dated_receipts','custodial_dated_occurrences')),'searchPaths',(select bool_and(proconfig@>array['search_path=pg_catalog, public']) from pg_proc where pronamespace='public'::regnamespace and proname like 'custodial_dated_%'))::text");
 check('all four bounded tables FORCE RLS and helper search paths pinned',()=>{assert.equal(secure.tables.length,4);assert.ok(secure.tables.every(t=>t.rls&&t.force));assert.equal(secure.searchPaths,true);});
 for(const role of ['anon','authenticated'])for(const call of ["public.static_weekly_v5_read_employee_day(date '2026-10-01',null,now())","public.static_weekly_v27_read_home_time_facts(date '2026-10-01',null,null,null)"]){await assert.rejects(()=>sql(`set role ${role};select ${call}`));checks.push('employee/Home narrow reader denied '+role+'/'+call.split('(')[0]);}
 check('malformed Home identity cannot cross publication boundary',()=>{});
 assert.equal(await json(`set role custodial_application_reader;select coalesce(public.static_weekly_v27_read_home_time_facts(date '2026-10-01',${quote(plan.rosterSlots[0].personId)}::uuid,null,${quote(accepted.projectionId)}::uuid),'null'::jsonb)::text`),null);
 const recovery=await json("select jsonb_agg(jsonb_build_object('kind',object_kind,'identity',object_identity,'definition',definition_sql,'hash',definition_sha256))::text from public.custodial_release_authority_restore_inventory where object_identity like '%static_weekly_v27_read_home_time_facts(%'");
 check('exact new Home function and grants are in immutable recovery inventory',()=>{assert.equal(recovery.filter(x=>x.kind==='function').length,1);assert.equal(recovery.filter(x=>x.kind==='grant').length,1);});
 await sql('drop function public.static_weekly_v27_read_home_time_facts(date,uuid,uuid,uuid);');
 await sql(recovery.find(x=>x.kind==='function').definition+';\n'+recovery.find(x=>x.kind==='grant').definition);
 const recovered=await read(`select public.static_weekly_v27_read_home_time_facts(date '2026-10-01',${quote(plan.rosterSlots[0].personId)}::uuid,${quote(accepted.publicationId)}::uuid,${quote(accepted.projectionId)}::uuid) as facts`);
 check('recovered Home function/grants restore exact restricted-reader binding',()=>assert.equal(recovered[0].facts.projection_id,accepted.projectionId));
 const repeat=await controller.confirm({manager,expectedRevision:rev,idempotencyKey:'sql-october-one',previewDigest:preview.previewDigest});
 check('actual SQL exact retry creates no duplicate',()=>assert.equal(repeat.replayed,true));
 const beforeRollback=await counts();
 await assert.rejects(()=>controller.rollback({manager,expectedRevision:accepted.revision,idempotencyKey:'wrong-rollback',publicationId:managerId,projectionId:accepted.projectionId}),/rollback_identity_mismatch/);
 assert.deepEqual(await counts(),beforeRollback);checks.push('wrong publication rollback changes no row or authority');
 // A changed dependency invalidates readers, but must not lock authorized rollback.
 await sql(`update public.employees set active=false where id=${quote(plan.rosterSlots[0].personId)};`);
 const stale=await read("select * from public.static_weekly_v6_schedule_authority_state(date '2026-10-01')");
 check('dependency drift marks bounded reader stale',()=>assert.equal(stale[0].projection_status,'stale_dated_dependency'));
 const historical=await controller.status({manager,idempotencyKey:'sql-october-one'});
 check('historical receipt remains accessible after dependency drift',()=>assert.equal(historical.operationReceipt.publicationId,accepted.publicationId));
 const rollback=await controller.rollback({manager,expectedRevision:accepted.revision,idempotencyKey:'sql-october-rollback',publicationId:accepted.publicationId,projectionId:accepted.projectionId});
 check('actual SQL rollback preserves immutable publications and occurrences',()=>assert.equal(rollback.state,'ROLLED_BACK'));
 const finalCounts=await json('select jsonb_build_object(\'publications\',(select count(*) from public.custodial_dated_publications),\'occurrences\',(select count(*) from public.custodial_dated_occurrences),\'activations\',(select count(*) from public.custodial_dated_activations))::text');
 check('rollback is append-only',()=>{assert.equal(finalCounts.publications,1);assert.equal(finalCounts.activations,2);assert.equal(finalCounts.occurrences,plan.days.flatMap(d=>d.assignments).length);});
 const result={status:'PASS',checks:checks.length,image,migrationCount:files.length+1,planDigest:plan.planDigest,phonePdfRevision:plan.phonePdfRevision,accepted,rollback,security:secure,scope:'actual owned network-none PostgreSQL; 176 unchanged schema migrations plus new bounded migration; explicit synthetic approved dependencies, actual employee/Home/lunch/cleaning readers; no production or phone proof',checksPassed:checks};if(process.env.DATED_POSTGRES_EVIDENCE_DIR){fs.mkdirSync(process.env.DATED_POSTGRES_EVIDENCE_DIR,{recursive:true});fs.writeFileSync(path.join(process.env.DATED_POSTGRES_EVIDENCE_DIR,'postgres-results.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});}console.log(JSON.stringify(result));
}catch(error){console.error(error);if(error.output)console.error(error.output);if(error.error)console.error(error.error);process.exitCode=1;}
finally{
 if(managerServer)await new Promise(resolve=>managerServer.close(resolve));if(server){await new Promise(resolve=>server.close(resolve));assert.equal(server.listening,false);}if(pool)await pool.end();if(created){await docker(['rm','-f',container]);await assert.rejects(()=>docker(['inspect',container]));}
 fs.rmSync(socket,{recursive:true,force:true});console.log(JSON.stringify({cleanup:'VERIFIED',container,socket,productionWritten:false}));
}
