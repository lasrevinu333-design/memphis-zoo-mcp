import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {Pool} from 'pg';
import {datedRosterContinuityFixture} from './fixtures/dated-roster-continuity-fixture.mjs';
import {compileStaticWeeklySchedule} from '../src/static-weekly-schedule-compiler.js';
import {compileAndPrepareStaticWeeklyScheduleIsolated} from '../src/static-weekly-schedule-compiler-runtime.js';
import {createStaticWeeklyControlPlane} from '../src/static-weekly-control-plane.js';

const container=process.env.SHIFT_END_TEST_CONTAINER,socket=process.env.SHIFT_END_TEST_SOCKET;
assert.match(container??'',/^mz_schema_shift_end_[0-9]+$/);
assert.match(socket??'',/^\/tmp\/mz-shift-socket-[a-zA-Z0-9]+$/);
const inspect=JSON.parse(execFileSync('docker',['inspect',container],{encoding:'utf8',timeout:10000}))[0];
assert.equal(inspect.HostConfig.NetworkMode,'none');assert.equal(Object.keys(inspect.HostConfig.PortBindings??{}).length,0);
assert.ok(inspect.Mounts.some(m=>m.Type==='bind'&&m.Source===socket&&m.Destination==='/test-socket'));
const database='postgres';
const pool=new Pool({host:socket,database,user:'supabase_admin',password:'postgres',max:4,connectionTimeoutMillis:5000});
pool.on('error',e=>console.error('SYNTHETIC_POOL_ERROR',e.code));
let injectFailure=null,preparations=0,checks=0;
const db={async connect(){const client=await pool.connect(),query=client.query.bind(client);
 client.query=async (...args)=>{if(injectFailure&&String(args[0]).includes(injectFailure))throw new Error('synthetic downstream lunch rejection');return query(...args);};
 const release=client.release.bind(client);client.release=(...args)=>{client.query=query;release(...args);};return client;},end:()=>pool.end()};
const plane=createStaticWeeklyControlPlane({database:db,compilerPreparer:async(...args)=>{preparations++;return compileAndPrepareStaticWeeklyScheduleIsolated(...args);}});
const query=async(sql,args=[])=>{const {rows}=await pool.query(sql,args);return rows[0]?.result;};
const cp=async(name,args=[])=>{const c=await pool.connect();try{await c.query('begin');await c.query('set local role static_weekly_control_plane');
 const {rows}=await c.query(`select public.${name}(${args.map((_,i)=>`$${i+1}`).join(',')}) as result`,args);await c.query('commit');return rows[0].result;
 }catch(e){await c.query('rollback');throw e;}finally{c.release();}};
const release=async(name,args=[])=>{const c=await pool.connect();try{await c.query('begin');await c.query('set local role static_weekly_release_operator');
 const {rows}=await c.query(`select public.${name}(${args.map((_,i)=>`$${i+1}`).join(',')}) as result`,args);await c.query('commit');return rows[0].result;
 }catch(e){await c.query('rollback');throw e;}finally{c.release();}};
const check=(name,actual,expected)=>{assert.deepEqual(actual,expected,name);checks++;console.log('PASS',name);};
const revision=()=>query('select current_revision::integer as result from public.static_weekly_schedule_control where singleton');
const state=()=>query(`select jsonb_build_object('revision',(select current_revision from public.static_weekly_schedule_control where singleton),
 'people',(select count(*) from public.employees),'incumbencies',(select count(*) from public.weekly_roster_slot_incumbencies),
 'staffing',(select count(*) from public.weekly_roster_slot_staffing_states),'receipts',(select count(*) from public.weekly_schedule_command_receipts),
 'projections',(select count(*) from public.weekly_schedule_compiled_projections),'lunches',(select count(*) from public.weekly_schedule_lunch_documents)) as result`);
try {
 const week=await query("select (public.sch_service_date(statement_timestamp())+(8-extract(isodow from public.sch_service_date(statement_timestamp()))::integer))::text as result");
 const restoreDate=await query('select ($1::date+2)::text as result',[week]);
 const f=datedRosterContinuityFixture(week),managerId='10000000-0000-4000-8000-000000000101';
 const manager={manager_id:managerId,manager_display_name:'Synthetic Published Roster Manager',auth_mode:'trusted_device',trusted_device:true,read_only:false};
 await pool.query("insert into public.ops_manager_managers(manager_id,display_name,roles,active,is_system_principal) values($1,$2,array['OPS_MANAGER','CUSTODIAL_MANAGER'],true,false)",[managerId,manager.manager_display_name]);
 for(let i=0;i<4;i++){
  await pool.query("insert into public.employees(id,employee_code,display_name,role,active) values($1,$2,$3,'staff',$4)",[f.people[i],`EMP98${i}`,f.names[i],i<2]);
  await pool.query("insert into public.msg_users(employee_id,display_name,role,is_active) values($1,$2,'employee',$3)",[f.people[i],f.names[i],i<2]);
 }
 for(let i=0;i<f.locations.length;i++){
  await pool.query("insert into public.locations(id,location_code,location_name,location_type,form_type) values($1,$2,$3,'restroom','restroom')",[f.locations[i],`SYNTHETIC_${i}`,`Synthetic area ${i}`]);
  await pool.query('insert into public.location_groups(id,group_code,group_name) values($1,$2,$3)',[f.groups[i],`SYNTHETIC_${i}`,`Synthetic area ${i}`]);
  await pool.query('insert into public.location_group_memberships(location_group_id,location_id) values($1,$2)',[f.groups[i],f.locations[i]]);
 }
 const {version,...base}=f.source,compiled=await compileStaticWeeklySchedule({...base,versions:[version]});
 check('synthetic canonical source genuinely compiled',compiled.status,'FEASIBLE');check('synthetic canonical source fully verified',compiled.verifier.ok,true);
 const initialSource='50000000-0000-4000-8000-000000000101',sourceId='50000000-0000-4000-8000-000000000102';
 await release('static_weekly_v3_configure_initial_authority_key',['static-weekly-authority-hmac-v2','synthetic-published-roster-never-production-0123456789','Synthetic isolated proof']);
 // The historical one-time initializer requires occupied history. Empty
 // positions are created by the existing dedicated official vacancy command.
 const bootstrap=structuredClone(compiled.canonicalAuthority.compilerInput);
 bootstrap.slots=bootstrap.slots.filter(s=>f.slots.slice(0,2).includes(s.id));
 bootstrap.version.vacancyCapableSlotIds=[];bootstrap.version.vacantSlotIds=[];
 bootstrap.version.slotAvailability=bootstrap.version.slotAvailability.filter(a=>f.slots.slice(0,2).includes(a.slotId));
 bootstrap.version.assignments=bootstrap.version.assignments.filter(a=>f.slots.slice(0,2).includes(a.ownerSlotId));
 await release('static_weekly_v3_register_authority_source',[initialSource,bootstrap,'Synthetic occupied initialization']);
 await release('static_weekly_v6_initialize_registered_roster',[initialSource,managerId,'Synthetic official initialization']);
 for(const slotId of f.slots.slice(2))await cp('static_weekly_v7_create_vacant_roster_slot',[
  slotId,f.source.slots.find(s=>s.id===slotId).label,await revision(),managerId,'synthetic-create-'+slotId]);
 const source=structuredClone(compiled.canonicalAuthority.compilerInput);
 source.slots.find(s=>s.id===f.slots[3]).incumbencies=[{personId:f.people[3],displayName:f.names[3],effectiveStart:restoreDate,effectiveEnd:null}];
 await release('static_weekly_v3_register_authority_source',[sourceId,source,'Synthetic source-bound restoration plan']);
 const sourceBefore=await query('select source_digest as result from public.static_weekly_authority_source_documents where source_id=$1',[sourceId]);
 const draft=await plane.createInitialDraft({manager,sourceId,effectiveStart:week,expectedRevision:await revision(),idempotencyKey:'synthetic-create'});
 const published=await plane.publishDraft({manager,draftVersionId:draft.data.version_id,expectedDraftRevision:1,
  expectedRevision:draft.revision,idempotencyKey:'synthetic-publish',projectionWeekStart:week});
 const publicationId=published.data.publication_id;
 check('initial publication includes persisted lunch',(await cp('static_weekly_v8_read_lunch_document',[week])).persistence_status,'PERSISTED');
 const sourceFor=()=>cp('static_weekly_v3_read_publication_source',[publicationId,week]);
 const projectionEnvelope=()=>query('select projection_envelope as result from public.weekly_schedule_compiled_projections where projection_id=$1',[latestId]);
 let latestId=published.data.projection_id;
 const firstEnvelope=await projectionEnvelope();
 const baselineRows=()=>query('select md5(jsonb_agg(to_jsonb(a) order by a.assignment_id)::text) as result from public.weekly_schedule_slot_assignments a');
 const immutableBaseline=await baselineRows();
 check('first actual persisted baseline closes at 16:00',firstEnvelope.authority.shiftEndDerivation.staffedDepartureByDay[4],'16:00');
 const fillArgs={manager,sourceId,slotId:f.slots[2],newEmployeeName:'Synthetic Published New Hire',effectiveStart:week,
  reason:'Synthetic filling only',expectedRevision:await revision(),idempotencyKey:'synthetic-published-fill'};
 const beforeFailure=await state();injectFailure='static_weekly_v8_materialize_lunch_document';
 await assert.rejects(()=>plane.fillVacantRosterSlot(fillArgs),/synthetic downstream lunch rejection/);checks++;
 injectFailure=null;check('real transaction rolls back employee projection and lunch together',await state(),beforeFailure);
 const concurrent=await Promise.all([plane.fillVacantRosterSlot(fillArgs),plane.fillVacantRosterSlot(fillArgs)]);
 const filled=concurrent[0];latestId=filled.data.projection_id;
 check('concurrent identical fill has one exact completion',concurrent[1],filled);
 check('published fill advances mutation and projection exactly',filled.revision,fillArgs.expectedRevision+2);
 const nextEnvelope=await projectionEnvelope();
 check('same registered template now closes at 17:00',nextEnvelope.authority.shiftEndDerivation.staffedDepartureByDay[4],'17:00');
 check('new closing segments have exact stored immutable parent links',await query(`select count(*)::integer as result
  from public.weekly_schedule_occurrences o left join public.weekly_schedule_slot_assignments b on b.assignment_id=o.assignment_id
  where o.projection_id=$1 and not exists(select 1
   from public.weekly_schedule_compiled_projections p,
   jsonb_array_elements(p.projection_envelope#>'{authority,shiftEndDerivation,parentChains}') chain,
   jsonb_array_elements(chain->'segments') segment
   where p.projection_id=o.projection_id and chain->>'dayOfWeek'=o.day_of_week::text
    and segment->>'workId'=o.work_id and chain->>'parentWorkId'=b.work_id and b.version_id=o.version_id)`,[latestId]),0);
 check('fill actually materializes newly derived non-original work IDs',await query(`select exists(select 1 from public.weekly_schedule_occurrences o
  where o.projection_id=$1 and not exists(select 1 from public.weekly_schedule_slot_assignments b
   where b.version_id=o.version_id and b.day_of_week=o.day_of_week and b.work_id=o.work_id)) as result`,[latestId]),true);
 check('fill leaves every stored recurring assignment byte-identical',await baselineRows(),immutableBaseline);
 check('immutable registered source survives fill',await query('select source_digest as result from public.static_weekly_authority_source_documents where source_id=$1',[sourceId]),sourceBefore);
 check('persisted lunch binds filled projection',(await cp('static_weekly_v8_read_lunch_document',[week])).projection_id,latestId);
 const countBeforeReplay=preparations,filledState=await state();
 check('lost-response fill returns original complete result',await plane.fillVacantRosterSlot(fillArgs),filled);
 check('fill retry does not compile',preparations,countBeforeReplay);check('fill retry mutates nothing',await state(),filledState);
 for(const change of [{newEmployeeName:'Different Synthetic Hire'},{sourceId:initialSource},{expectedRevision:fillArgs.expectedRevision+1},
  {reason:'Different synthetic reason'},{slotId:f.slots[3]}]){
  await assert.rejects(()=>plane.fillVacantRosterSlot({...fillArgs,...change}),/idempotency/);checks++;
 }
 check('conflicting retries leave every authority count unchanged',await state(),filledState);
 const beforeRestore=await state(),restoreArgs={manager,sourceId,slotId:f.slots[3],employeeId:f.people[3],effectiveStart:restoreDate,
  reason:'Synthetic existing identity restoration',expectedRevision:await revision(),idempotencyKey:'synthetic-published-restore'};
 const restored=await plane.restoreExistingEmployee(restoreArgs);latestId=restored.data.projection_id;
 check('published restore retains exact existing person',restored.data.employee_id,f.people[3]);
 check('restore creates no employee',(await state()).people,beforeRestore.people);
 check('restore has no invented phone assignment',restored.data.phone_assignment,null);
 check('restore commits matching lunch',(await cp('static_weekly_v8_read_lunch_document',[week])).projection_id,latestId);
 const beforeRestoreReplay=preparations;check('restore exact complete retry',await plane.restoreExistingEmployee(restoreArgs),restored);
 check('restore replay does not compile',preparations,beforeRestoreReplay);
 check('old fill replays original completion after later restore',await plane.fillVacantRosterSlot(fillArgs),filled);
 check('old fill does not return latest projection',filled.data.projection_id===restored.data.projection_id,false);
 const hydrated=await sourceFor(),restoredSlot=hydrated.compiler_input.slots.find(s=>s.id===f.slots[3]);
 check('source hydration preserves precise midweek restore',restoredSlot.incumbencies[0].effectiveStart,restoreDate);
 check('source remains unchanged after all mutations',await query('select source_digest as result from public.static_weekly_authority_source_documents where source_id=$1',[sourceId]),sourceBefore);
 console.log(JSON.stringify({status:'PASS',checks,realPgTransaction:true,realIsolatedCompilerAndAdapter:true,publishedFillRestoreAndLunch:true,
  syntheticOnly:true,independentAudit:false,production:false,phoneProof:false,preparations}));
} finally {await plane.close();}
