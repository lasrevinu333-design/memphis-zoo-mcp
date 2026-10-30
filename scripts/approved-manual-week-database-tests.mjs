import assert from 'node:assert/strict';
import fs from 'node:fs';
import {resolve,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
import {types} from 'node:util';
import pg from 'pg';
import {createCiFreshOnlyFixture} from './ci-fresh-only-replay.mjs';
import {readApprovedManualWeek,previewApprovedManualDay} from '../src/approved-manual-week.js';
import {prepareApprovedManualSourceDraft} from '../src/approved-manual-source-draft.js';
import {prepareApprovedStaticTemplateProjection} from '../src/static-weekly-recurring-staffing-adaptation.js';
import {createStaticWeeklyControlPlane} from '../src/static-weekly-control-plane.js';
import {contentDigest,installStaticWeeklySha256HexAccelerator} from '../src/static-weekly-schedule-model.js';
import {postgresJsonbContentDigest as digest} from '../src/static-weekly-schedule-program.js';

// A complete normal Source/template/manager-preview/publication check in a
// newly owned, nonnetworked PostgreSQL fixture. The civil date below is test
// data; this executable cannot select a live rollout date or database URL.
export async function runApprovedManualWeekDatabaseTest({out,constructFixture=createCiFreshOnlyFixture,constructorMigrationCount=301,
 initialDate='2026-11-02',seedFixturePeopleAt=null,fixturePoolMax=3,afterSqlQualified=null}){
assert.ok(isAbsolute(out));fs.mkdirSync(out,{mode:0o700});
const save=(name,value)=>fs.writeFileSync(resolve(out,name),JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
const result={schema:'custodial.approved-manual-week-sql.v1',startedAt:new Date().toISOString(),status:'RUNNING',
 phase:'construct_owned_selected_source',constructorMigrationCount,productionWritten:false,operationalDateSelected:false,genuineManagerBrowser:false,physicalNfc:false};
save('INTENT.json',result);let fixture,pool,monitorTimer,monitorPending=Promise.resolve(),confirmationBackendPid=null;
const memoryDiagnostic=['1','trace'].includes(process.env.APPROVED_MANUAL_SQL_MEMORY_DIAGNOSTIC);
let memoryContextLogged=false;
const memorySamples=[];
const fixtureConnectionErrors=[];
installStaticWeeklySha256HexAccelerator(x=>createHash('sha256').update(x).digest('hex'),{
 schema:'memphis-zoo.sha256-incremental-native.v1',isProxy:types.isProxy,
 create(){const h=createHash('sha256');return{writeUtf8:x=>h.update(x),finishHex:()=>h.digest('hex')};}});
const phase=name=>{result.phase=name;console.log(JSON.stringify({phase:name,at:new Date().toISOString()}));};
try{
 fixture=await constructFixture({name:`mz_schema_rebuild_manual_${process.pid}`,hostSocket:true});
 await fixture.assertOwned();assert.equal(fixture.receipt.selected_replay.migrations,constructorMigrationCount);save('FIXTURE.json',fixture.receipt);
 assert.ok(Number.isInteger(fixturePoolMax)&&fixturePoolMax>=1&&fixturePoolMax<=3);
 pool=new pg.Pool({host:fixture.socketDirectory,database:'postgres',user:'supabase_admin',password:'postgres',max:fixturePoolMax,connectionTimeoutMillis:5000});
 const connectionError=error=>{fixtureConnectionErrors.push({code:error.code??null,message:String(error.message).slice(0,250)});};
 pool.on('error',connectionError);pool.on('connect',client=>client.on('error',connectionError));
 const query=async(sql,args=[])=>{await fixture.assertOwned();return pool.query(sql,args);};
 const rpc=async(role,name,args=[])=>{
  assert.ok(['static_weekly_release_operator','static_weekly_control_plane','custodial_application_reader'].includes(role));
  assert.match(name,/^[a-z][a-z0-9_]+$/);const client=await pool.connect();
  confirmationBackendPid=client.processID;
  try{await client.query('begin');await client.query('set local role '+role);
   const r=await client.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as result`,args);
   await client.query('commit');return r.rows[0].result;
  }catch(e){await client.query('rollback');throw e;}finally{client.release();}
 };
 const release=(name,args=[])=>rpc('static_weekly_release_operator',name,args),
  cp=(name,args=[])=>rpc('static_weekly_control_plane',name,args);
 const week=readApprovedManualWeek(),draft=prepareApprovedManualSourceDraft({week,
  referenceBytes:fs.readFileSync(new URL('../'+week.referenceBindings.reference.path,import.meta.url))});
 assert.deepEqual(draft.restrictionConflicts,[]);
 const source=structuredClone(draft.sourceDraft);delete source.publicationAuthority;
 const date=initialDate,sourceId=randomUUID(),managerId=randomUUID(),templateId='approved-manual-complete-sql-fixture';
 source.serviceDate=date;Object.assign(source.version,{id:randomUUID(),publicationId:randomUUID(),status:'published',effectiveStart:date});
 if(seedFixturePeopleAt!==null){
  assert.match(seedFixturePeopleAt,/^\d{4}-\d{2}-\d{2}$/);assert.ok(seedFixturePeopleAt<date);
  // Explicit synthetic predecessor data in this owned fixture only. It is
  // never a readback or change to real employee employment/roster history.
  for(const person of week.referenceBindings.people)source.slots.find(s=>s.id===person.slotId).incumbencies=[{
   personId:person.employeeId,displayName:person.approvedName,effectiveStart:seedFixturePeopleAt,effectiveEnd:null}];
 }
 const ownerConfig=structuredClone(draft.ownerConfig);ownerConfig.effectiveDate=date;
 const roleSlotIds=week.referenceBindings.people.map(p=>p.slotId).sort();
 const makeArgs=currentSource=>{
  const template={templateId,staffingCount:8,source:currentSource,roleSlotIds},
   binding={schema:'custodial.approved-static-template-binding.v1',templateId,staffingCount:8,
    sourceDigest:contentDigest(currentSource),roleSlotIdsDigest:contentDigest(roleSlotIds),
    patternAuthority:'OWNER_APPROVED_OPERATIONAL_PATTERN',artifactSha256:week.zipSha256,
    ownerConfigDigest:contentDigest(ownerConfig),patternPublicationStatus:'UNPUBLISHED_LOCAL_CANDIDATE'};
  return{templates:[template],admittedBindings:[binding],currentSource,currentOwnerConfig:ownerConfig,
   selection:{schema:'custodial.static-template-selection.v1',kind:'INITIAL_BASELINE',templateId,serviceDate:date,
    availablePersonIds:week.referenceBindings.people.map(p=>p.employeeId)}};
 };
 const initial=prepareApprovedStaticTemplateProjection(makeArgs(source));assert.equal(initial.solverInvoked,false);
 phase('seed_disposable_people_and_physical_catalog');
 await query("insert into public.ops_manager_managers(manager_id,display_name,roles) values($1,'Manual schedule fixture manager',array['OPS_MANAGER','CUSTODIAL_MANAGER'])",[managerId]);
 for(const p of week.referenceBindings.people){
  await query("insert into public.employees(id,display_name,role,active) values($1,$2,'staff',true)",[p.employeeId,p.approvedName]);
 }
 const locations=new Map();
 for(const g of week.referenceBindings.groups){
  locations.set(g.primaryLocationId,{locationId:g.primaryLocationId,locationNameSnapshot:g.approvedGroup});
  for(const l of g.includedLocations)locations.set(l.locationId,l);
 }
 for(const [id,l]of locations)await query("insert into public.locations(id,location_code,location_name,location_type,form_type) values($1,$2,$3,'restroom','restroom')",
  [id,'FIXTURE-'+id,l.locationNameSnapshot]);
 for(const g of week.referenceBindings.groups){
  await query('insert into public.location_groups(id,group_code,group_name) values($1,$2,$3)',[g.primaryLocationId,g.referenceCode,g.approvedGroup]);
  for(const l of g.includedLocations)await query('insert into public.location_group_memberships(location_group_id,location_id) values($1,$2)',[g.primaryLocationId,l.locationId]);
 }
 phase('register_normal_source_roster_and_approved_template');
 await release('static_weekly_v3_configure_initial_authority_key',['static-weekly-authority-hmac-v2',`disposable-fixture-${randomUUID()}-never-production`,'Manual complete SQL fixture']);
 await release('static_weekly_v3_register_authority_source',[sourceId,JSON.stringify(initial.compilerInput),'Manual complete SQL fixture']);
 await release('static_weekly_v6_initialize_registered_roster',[sourceId,managerId,'Manual complete SQL fixture']);
 const registered=await cp('static_weekly_v3_read_authority_source',[sourceId,date]),currentSource=registered.compiler_input,
  args=makeArgs(currentSource),feasibility=prepareApprovedStaticTemplateProjection(args);
 assert.equal(registered.source_id,sourceId);assert.equal(feasibility.mapping.unchanged,true);
 assert.equal(feasibility.initialBaseline.projection.assignments.length,346);assert.equal(feasibility.lunchDocument.loans.length,40);
 const evidence={classification:'OWNER_APPROVED_OPERATIONAL_PATTERN',artifactSha256:week.zipSha256,
  sourceReference:'config/schedules/manual-approved-20261030/packet#'+week.manifestSha256,
  ownerDecisionReference:'codex-chat:01a15718-2d88-7de1-8cec-6cdc241f0151; approved immutable manual week and full-hour lunch coverage'};
 await release('static_weekly_register_approved_template',[sourceId,JSON.stringify(args.templates[0]),JSON.stringify(args.admittedBindings[0]),JSON.stringify(ownerConfig),JSON.stringify(evidence)]);
 await release('static_weekly_register_approved_initial_baseline',[sourceId,templateId,JSON.stringify(feasibility)]);
 const tracedDatabase={connect:async()=>{const client=await pool.connect();confirmationBackendPid=client.processID;return client;}};
 const plane=createStaticWeeklyControlPlane({database:tracedDatabase,compiler:()=>{throw Error('APPROVED_MANUAL_MUST_NOT_REOPTIMIZE');},
  compilerPreparer:()=>{throw Error('APPROVED_MANUAL_MUST_NOT_REOPTIMIZE');}}),
  expectedRevision=Number((await query('select current_revision from public.static_weekly_schedule_control where singleton')).rows[0].current_revision),
  input={manager:{manager_id:managerId,manager_display_name:'Manual schedule fixture manager',auth_mode:'trusted_device',trusted_device:true,read_only:false},
   sourceId,effectiveStart:date,templateId,expectedRevision};
 const initialBasis=await cp('static_weekly_read_approved_initial_basis',[managerId,sourceId,date,expectedRevision,templateId]);
 await assert.rejects(cp('static_weekly_materialize_approved_initial_baseline',[managerId,sourceId,date,expectedRevision,initialBasis.generation,
  'refused-compact-digest',{schema:'custodial.approved-static-initial-materialization.compact.v1',managerId,sourceId,
   effectiveStart:date,expectedRevision,generation:initialBasis.generation,templateCatalogDigest:initialBasis.templateCatalogDigest,
   feasibilityDigest:'0'.repeat(64),previewDigest:'0'.repeat(64),request:{templateId}}]),
  e=>e.code==='23514'&&/snapshot digest changed/.test(e.message));
 result.changedCompactSnapshotRefused=true;
 phase('normal_manager_preview');
 const preview=await plane.previewApprovedInitialBaseline(input);assert.equal(preview.status,'PREVIEW_ONLY');assert.equal(preview.solverInvoked,false);
 phase('normal_manager_confirmation');
 if(memoryDiagnostic){
  const sample=async()=>{
   await fixture.assertOwned();
   const usage=Number(execFileSync('docker',['exec',fixture.container,'cat','/sys/fs/cgroup/memory.current'],{encoding:'utf8',timeout:3000}));
   memorySamples.push({at:new Date().toISOString(),bytes:usage,pid:confirmationBackendPid});
   const logContext=(cancel=false)=>{
    assert.ok(Number.isSafeInteger(confirmationBackendPid)&&confirmationBackendPid>0);
    execFileSync('docker',['exec',fixture.container,'psql','-X','-v','ON_ERROR_STOP=1','-At','-U','supabase_admin','-d','postgres','-c',
     `select pg_log_backend_memory_contexts(${confirmationBackendPid})${cancel?`,pg_cancel_backend(${confirmationBackendPid})`:''}`],{encoding:'utf8',timeout:5000});
   };
   if(usage>300*1024*1024&&process.env.APPROVED_MANUAL_SQL_MEMORY_DIAGNOSTIC==='1'){
    result.diagnosticCancellation={usage,pid:confirmationBackendPid,scope:'EXACT_OWNED_FIXTURE_CONFIRMATION_ONLY'};
    logContext(true);
   }else{
    if(usage>410*1024*1024&&!memoryContextLogged){memoryContextLogged=true;logContext();}
    monitorTimer=setTimeout(()=>{monitorPending=sample().catch(e=>{result.monitorError=String(e.message);});},300);
   }
  };
  monitorTimer=setTimeout(()=>{monitorPending=sample().catch(e=>{result.monitorError=String(e.message);});},300);
 }
 const accepted=await plane.publishApprovedInitialBaseline({...input,previewDigest:preview.previewDigest,idempotencyKey:'approved-manual-complete-week'});
 assert.equal(accepted.status,'PERSISTED_CURRENT');assert.equal(accepted.solverInvoked,false);save('PUBLICATION.json',accepted);
 const managerSnapshot=await plane.getManagerSnapshot({manager:input.manager,weekStart:date}),managerView=managerSnapshot.approved_manual_schedule;
 assert.equal(managerView?.groups.length,23);assert.equal(managerView.days.length,7);
 for(const d of managerView.days)for(const phase of d.phases)assert.equal(phase.totalPoints,136);
 save('MANAGER_VIEW.json',managerView);result.managerRatingViewSqlQualified=true;
 phase('read_every_day_full_hour_lunch_and_physical_ownership');
 const stored=(await query('select document_json from public.weekly_schedule_lunch_documents where projection_id=$1',[accepted.projection_id])).rows[0].document_json;
 assert.equal(stored.loans.length,40);assert.ok(stored.loans.every(l=>l.helper_slot_ids.length===1&&l.fallback===null));
 const minute=t=>Number(t.slice(0,2))*60+Number(t.slice(3,5)),time=m=>`${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
 let dayReads=0,minuteReads=0,physicalOwnershipComparisons=0,employeeReads=0;
 for(const day of week.days){
  const offset=(day.weekday+6)%7,serviceDate=new Date(Date.parse(date+'T12:00:00Z')+offset*86400000).toISOString().slice(0,10);
  // Use short role-scoped sessions for reads; the pool itself stays admin for
  // fixture setup and never grants the application reader write privileges.
  const client=await pool.connect();let assignments;
  try{await client.query('begin');await client.query('set local role custodial_application_reader');
   assignments=(await client.query('select * from public.custodial_operational_location_assignments($1::date)',[serviceDate])).rows;
   await client.query('commit');
  }catch(e){await client.query('rollback');throw e;}finally{client.release();}
  const lunch=await cp('static_weekly_v8_read_lunch_document',[serviceDate]);
  assert.equal(lunch.persistence_status,'PERSISTED');assert.equal(lunch.loans.length,day.lunches.length);dayReads++;
  for(const p of day.employees){const person=week.referenceBindings.people.find(x=>x.approvedName===p.name),
   read=await rpc('custodial_application_reader','static_weekly_v5_read_employee_day',[serviceDate,person.employeeId,serviceDate+'T15:00:00Z']);
   assert.equal(read.governed,true);assert.equal(read.projection_status,'current');assert.equal(read.projection_id,accepted.projection_id);employeeReads++;}
  for(let at=minute(day.checkedWindow.start);at<minute(day.checkedWindow.end);at++){
   const expected=previewApprovedManualDay(week,{day:day.day,time:time(at)});assert.equal(expected.owners.length,23);minuteReads++;
   for(const owner of expected.owners){
    const g=week.referenceBindings.groups.find(x=>x.referenceCode===owner.locationCode);if(g.retainedServiceModes[0]!=='scan_tracked')continue;
    for(const l of g.includedLocations){
     const active=assignments.filter(r=>r.location_id===l.locationId&&minute(r.coverage_start)<=at&&at<minute(r.coverage_end));
     assert.deepEqual(active.map(r=>r.assigned_employee_id),[owner.employeeId],`${serviceDate}/${time(at)}/${owner.group}/${l.locationId}`);physicalOwnershipComparisons++;
    }
   }
  }
 }
 assert.equal(dayReads,7);assert.equal(minuteReads,3780);assert.equal(employeeReads,40);
 const counts=(await query('select count(*)::integer as n from public.weekly_schedule_projection_assignments where projection_id=$1',[accepted.projection_id])).rows[0].n;
 assert.equal(counts,346);await fixture.assertOwned();
 if(afterSqlQualified){phase('current_day_atomic_activation');memoryContextLogged=false;result.currentDayActivation=await afterSqlQualified({
  fixture,pool,query,rpc,cp,release,week,draft,plane,managerId,manager:input.manager,accepted,source:currentSource,save});}
 Object.assign(result,{status:'PASS',sourceId,manualDataDigest:week.dataDigest,sourceDigest:digest(currentSource),
  assignments:counts,days:dayReads,scheduledLunches:stored.loans.length,oneNamedCovererPerLunch:true,
  coveredMinutes:minuteReads,physicalOwnershipComparisons,employeeDayReadbacks:employeeReads,
  normalManagerControlPlane:true,normalSourceAndTemplateRegistration:true,normalPublicationAndSqlReadback:true,
  fixedApprovedMappingPreserved:true,solverInvoked:false});
}catch(error){result.status='FAIL';result.failure={phase:result.phase,code:error.code??null,message:String(error.message).slice(0,1800),
 where:String(error.where??error.cause?.where??'').slice(0,5000),
 cause:error.cause?{code:error.cause.code??null,message:String(error.cause.message).slice(0,1800)}:null};process.exitCode=1;}
finally{
 clearTimeout(monitorTimer);await monitorPending;
 if(fixtureConnectionErrors.length){result.status='FAIL';result.fixtureConnectionErrors=fixtureConnectionErrors;process.exitCode=1;}
 if(memoryDiagnostic)save('MEMORY_SAMPLES.json',memorySamples);
 if(pool)await pool.end();
 if(fixture){try{
   const inspect=JSON.parse(execFileSync('docker',['inspect',fixture.container],{encoding:'utf8'}))[0];
   save('POSTGRES_STATE.json',{id:inspect.Id,state:inspect.State,memoryLimit:inspect.HostConfig.Memory});
   const logs=spawnSync('docker',['logs','--tail','1800',fixture.container],{encoding:'utf8',maxBuffer:16*1024*1024});
   fs.writeFileSync(resolve(out,'POSTGRES.log'),String(logs.stdout??'')+String(logs.stderr??''),{flag:'wx',mode:0o600});
  }catch(error){result.diagnosticError=String(error.message).slice(0,400);}
  try{await fixture.cleanup();result.cleanup='SUPPORTED_OWNED_FIXTURE_CLEANUP_RETURNED';}
  catch(error){result.status='FAIL';result.cleanup='UNRESOLVED';result.cleanupError=String(error.message).slice(0,1000);process.exitCode=1;}}
 else result.cleanup='NO_RETURNED_FIXTURE_CONSTRUCTION_OWNS_CLEANUP';
 result.finishedAt=new Date().toISOString();save('RESULT.json',result);console.log(JSON.stringify(result));
}
return result;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 assert.equal(process.argv.length,3,'One new absolute evidence directory is required');
 await runApprovedManualWeekDatabaseTest({out:process.argv[2]});
}
