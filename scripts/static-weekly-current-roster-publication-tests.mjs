import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {Pool} from 'pg';
import {createStaticWeeklyControlPlane} from '../src/static-weekly-control-plane.js';
import {currentPatternFromPublishedReadback} from '../src/static-weekly-recurring-staffing-adaptation.js';
import {assertRecurringManagerDecision,assertRecurringAdmissionCandidate,RECURRING_DECISION_SCHEMA} from '../src/static-weekly-recurring-preview.js';
import {compileAndPrepareStaticWeeklyScheduleIsolated,prepareRecurringAdmissionCandidateIsolated} from '../src/static-weekly-schedule-compiler-runtime.js';
import {postgresJsonbContentDigest as digest} from '../src/static-weekly-schedule-program.js';
import {testRecurringTerminalTargets} from './static-weekly-recurring-terminal-integration.mjs';
import {testRecurringDependencyReconciliation} from './static-weekly-recurring-reconciliation-integration.mjs';
import {testRecurringApplicationTargets} from './static-weekly-recurring-application-integration.mjs';
import {testRecurringConfirmation} from './static-weekly-recurring-confirmation-integration.mjs';
import {testLunchMaterialization} from './static-weekly-lunch-materialization-integration.mjs';
import {assertCurrentManagerMigrationSet,assertCurrentManager217MigrationSet,assertCurrentManager218MigrationSet,loadCurrentManagerPublicationFixture} from './fixtures/current-manager-publication-source.mjs';
import {testNamedHandoffSql} from './static-weekly-named-handoff-contract-tests.mjs';

const container=process.env.SHIFT_END_TEST_CONTAINER,socket=process.env.SHIFT_END_TEST_SOCKET;
assert.match(container??'',/^mz_schema_shift_end_[0-9]+$/);
assert.match(socket??'',/^\/tmp\/mz-shift-socket-[a-zA-Z0-9]+$/);
const inspection=JSON.parse(execFileSync('docker',['inspect',container],{encoding:'utf8',timeout:10000}))[0];
assert.equal(inspection.HostConfig.NetworkMode,'none');assert.equal(Object.keys(inspection.HostConfig.PortBindings??{}).length,0);
assert.ok(inspection.Mounts.some(m=>m.Source===socket&&m.Destination==='/test-socket'));
const currentManager216Stage=process.env.STATIC_WEEKLY_TEST_CURRENT_216==='1';
const currentManager217Stage=process.env.STATIC_WEEKLY_TEST_CURRENT_217==='1';
const currentManager218Stage=process.env.STATIC_WEEKLY_TEST_CURRENT_218==='1';
assert.ok([currentManager216Stage,currentManager217Stage,currentManager218Stage].filter(Boolean).length<=1,
 'only one pinned current-manager stage may run');
const currentManagerStage=currentManager216Stage||currentManager217Stage||currentManager218Stage;
if(currentManager216Stage)assertCurrentManagerMigrationSet();
if(currentManager217Stage)assertCurrentManager217MigrationSet();
if(currentManager218Stage)assertCurrentManager218MigrationSet();
if(currentManagerStage)assert.equal(process.env.STATIC_WEEKLY_TEST_RECURRING_CONFIRMATION,'1','current manager proof must execute confirmation');
else assert.ok(process.env.STATIC_WEEKLY_CONTINUITY_TEMPLATE,'explicit immutable local source');
const bytes=currentManagerStage?loadCurrentManagerPublicationFixture().bytes:readFileSync(process.env.STATIC_WEEKLY_CONTINUITY_TEMPLATE),packet=JSON.parse(bytes),source=packet.compilerInput;
assert.equal(digest(source),packet.sourceDigest);
const sourceRows=source.version.assignments.length;
assert.ok(currentManagerStage?sourceRows===323:[312,313].includes(sourceRows),'only the exact selected source lineage is in scope');
const derivedRows=currentManagerStage?packet.expectedDerivedRows:packet.verification.shiftEndDerivation.parentChains
 .reduce((count,chain)=>count+chain.segments.length,0);
assert.equal(derivedRows,currentManagerStage?494:sourceRows===312?454:458,'exact source-specific derivation count');
assert.equal(source.version.vacantSlotIds.length,3);
const pool=new Pool({host:socket,database:'postgres',user:'supabase_admin',password:'postgres',max:3,connectionTimeoutMillis:5000});
pool.on('error',e=>console.error('SYNTHETIC_POOL_ERROR',e.code));
const preparations=[];
const plane=createStaticWeeklyControlPlane({database:pool,compilerPreparer:async(...args)=>{
 const result=await compileAndPrepareStaticWeeklyScheduleIsolated(...args);preparations.push(result);return result;
}});
const query=async(sql,args=[])=>{const r=await pool.query(sql,args);return r.rows[0]?.result;};
async function rpc(role,name,args=[]){const c=await pool.connect();try{await c.query('begin');await c.query('set local role '+role);
 const r=await c.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as result`,args);await c.query('commit');return r.rows[0].result;
 }catch(e){await c.query('rollback');throw e;}finally{c.release();}}
const cp=(name,args)=>rpc('static_weekly_control_plane',name,args),release=(name,args)=>rpc('static_weekly_release_operator',name,args);
const revision=()=>query('select current_revision::integer as result from public.static_weekly_schedule_control where singleton');
let checks=0,recurringPreview=null,recurringAdmissionProof=null,recurringConfirmationProof=null,lunchMaterializationProof=null;const check=(name,a,b)=>{assert.deepEqual(a,b,name);checks++;console.log('PASS',name);};
try{
 const initialEmployees=await query('select count(*)::integer as result from public.employees');
 const week=source.serviceDate,managerId='10000000-0000-4000-8000-000000000131';
 const manager={manager_id:managerId,manager_display_name:'Synthetic Full Source Manager',auth_mode:'trusted_device',trusted_device:true,read_only:false};
 await pool.query("insert into public.ops_manager_managers(manager_id,display_name,roles,active,is_system_principal) values($1,$2,array['OPS_MANAGER','CUSTODIAL_MANAGER'],true,false)",[managerId,manager.manager_display_name]);
 let number=820;
 for(const s of source.slots.filter(s=>!s.contractorCapacity))for(const p of s.incumbencies.filter(p=>p.effectiveStart<=week&&(!p.effectiveEnd||week<p.effectiveEnd))){
  await pool.query("insert into public.employees(id,employee_code,display_name,role,active) values($1,$2,$3,'staff',true)",[p.personId,'EMP'+number++,p.displayName]);
  await pool.query("insert into public.msg_users(employee_id,display_name,role,is_active) values($1,$2,'employee',true)",[p.personId,p.displayName]);
 }
 const families=new Map(),places=new Set();
 for(const row of source.version.assignments){const f=families.get(row.locationCodeSnapshot)||{id:row.locationId,name:row.locationNameSnapshot,locations:new Map()};
  for(const l of row.includedLocations||[])f.locations.set(l.locationId,l.locationNameSnapshot);families.set(row.locationCodeSnapshot,f);}
 for(const [code,f] of families){
  await pool.query('insert into public.location_groups(id,group_code,group_name,active) values($1,$2,$3,true)',[f.id,code,f.name]);
  for(const [id,name] of f.locations){if(!places.has(id)){
   const type=/restroom/i.test(name)?'restroom':'exhibit';
   await pool.query('insert into public.locations(id,location_code,location_name,location_type,form_type,active) values($1,$2,$3,$4,$4,true)',[id,'SYNTH_'+id,name,type]);places.add(id);}
   await pool.query('insert into public.location_group_memberships(location_group_id,location_id,active) values($1,$2,true)',[f.id,id]);
  }
 }
 await release('static_weekly_v3_configure_initial_authority_key',['static-weekly-authority-hmac-v2','synthetic-current-roster-not-production-0123456789','Synthetic full-source proof']);
 if(currentManagerStage){
  await release('static_weekly_v3_register_authority_source',[packet.original.sourceId,packet.original.compilerInput,'Immutable original V6 input; isolated source registration only']);
  check('registered original314 exact digest without historical person import',await query('select source_digest as result from public.static_weekly_authority_source_documents where source_id=$1',[packet.original.sourceId]),packet.original.sourceDigest);
 }
 const bootstrap=structuredClone(source),vacancies=new Set(source.version.vacantSlotIds),initial='50000000-0000-4000-8000-000000000131';
 bootstrap.slots=bootstrap.slots.filter(s=>!vacancies.has(s.id));
 bootstrap.version.vacantSlotIds=[];bootstrap.version.vacancyCapableSlotIds=[];
 bootstrap.version.slotAvailability=bootstrap.version.slotAvailability.filter(a=>!vacancies.has(a.slotId));
 bootstrap.version.assignments=bootstrap.version.assignments.filter(a=>!vacancies.has(a.ownerSlotId));
 await release('static_weekly_v3_register_authority_source',[initial,bootstrap,'Synthetic occupied initialization only']);
 await release('static_weekly_v6_initialize_registered_roster',[initial,managerId,'Synthetic initialization']);
 for(const id of vacancies)await cp('static_weekly_v7_create_vacant_roster_slot',[id,source.slots.find(s=>s.id===id).label,await revision(),managerId,'synthetic-vacancy-'+id]);
 await release('static_weekly_v3_register_authority_source',[packet.sourceId,source,'Exact corrected full recurring source; isolated only']);
 check('registered exact immutable source digest',await query('select source_digest as result from public.static_weekly_authority_source_documents where source_id=$1',[packet.sourceId]),packet.sourceDigest);
 check('exactly six employees added; existing migration-seeded contractor rows unchanged',await query('select count(*)::integer as result from public.employees'),initialEmployees+6);
 console.log('ACTUAL_FULL_SOURCE_INITIAL_DRAFT_BEGIN');
 const draft=await plane.createInitialDraft({manager,sourceId:packet.sourceId,effectiveStart:week,expectedRevision:await revision(),idempotencyKey:'synthetic-full-source-draft'});
 const published=await plane.publishDraft({manager,draftVersionId:draft.data.version_id,expectedDraftRevision:1,expectedRevision:draft.revision,idempotencyKey:'synthetic-full-source-publish',projectionWeekStart:week});
 const projection=await query('select projection_envelope as result from public.weekly_schedule_compiled_projections where projection_id=$1',[published.data.projection_id]);
 if(currentManager217Stage||currentManager218Stage)await testNamedHandoffSql({pool,authority:projection.authority,check,
  versionId:published.data.version_id,publicationId:published.data.publication_id});
 check('published source retains exact recurring assignments',projection.authority.compilerInput.version.assignments.length,sourceRows);
 check('current dated derivation has exact responsibility segments',projection.authority.overlayCompilerInput.version.assignments.length,derivedRows);
 // The approved v2 adapter stores the exception-free DERIVED baseline in
 // relational rows; the separately registered compilerInput remains immutable.
 check('SQL accepted relational baseline matches derived segments',await query('select count(*)::integer as result from public.weekly_schedule_slot_assignments where version_id=$1',[published.data.version_id]),derivedRows);
 const relationalDigest=await query('select md5(jsonb_agg(to_jsonb(a) order by assignment_id)::text) as result from public.weekly_schedule_slot_assignments a where version_id=$1',[published.data.version_id]);
 const lunch=await query('select document_json as result from public.weekly_schedule_lunch_documents where projection_id=$1',[published.data.projection_id]);
 if(process.env.STATIC_WEEKLY_TEST_LUNCH_MATERIALIZATION==='1')lunchMaterializationProof=await testLunchMaterialization({pool,projectionId:published.data.projection_id,lunch,check});
 check('actual persisted current-six lunch count',lunch.loans.length,30);
 check('actual persisted current-six no unresolved lunch',lunch.loans.filter(l=>l.status==='REVIEW_REQUIRED').length,0);
 for(let offset=0;offset<7;offset++){
  const day=new Date(Date.parse(week+'T12:00:00Z')+offset*86400000),date=day.toISOString().slice(0,10),dow=day.getUTCDay();
  const roster=await query('select coalesce(jsonb_agg(to_jsonb(r)),\'[]\') as result from public.static_weekly_v6_read_roster($1::date) r',[date]);
  const slots=packet.rosterSlots.filter(s=>s.days.includes(dow)),staff=slots.filter(s=>s.personId);
  check(date+' exact positions including vacancies',roster.length,slots.length);
  check(date+' no vacancy employee invented',roster.filter(s=>s.employee_id).length,staff.length);
  check(date+' Karen fixed workdays',roster.some(s=>s.employee_id==='3da709bb-2223-4e15-8e3a-db02e3f32e97'),[1,2,3,5,6].includes(dow));
  const doc=await cp('static_weekly_v8_read_lunch_document',[date]);
  check(date+' official lunch bound to accepted projection',doc.projection_id,published.data.projection_id);
  check(date+' fixed employee lunches only',doc.loans.length,staff.length);
  check(date+' current database authority',await query('select projection_status as result from public.static_weekly_v6_schedule_authority_state($1::date)',[date]),'current');
 }
 const registered=await cp('static_weekly_v3_read_publication_source',[published.data.publication_id,week]);
 if(sourceRows===312){
  const snapshot=await cp('static_weekly_v3_read_manager_snapshot',[week]);
  const templateConfig=JSON.parse(readFileSync(new URL('../config/custodial-six-person-static-20260926.json',import.meta.url)));
  const fullOwners=JSON.parse(readFileSync(new URL('../config/custodial-full-nine-family-owners-20260926.json',import.meta.url))).owners;
  const boundary=currentPatternFromPublishedReadback({publishedSource:registered,managerSnapshot:snapshot,
   templateConfig,fullOwners,effectiveDate:week,expectedRevision:snapshot.authority_revision});
  check('actual SQL publication and manager snapshot reconstruct current six-person recurring source',
   boundary.currentConfig.overrides,templateConfig.overrides);
  const beforePreview=await revision();
  const candidate=await plane.previewRecurringStaffing({manager,effectiveStart:week,expectedRevision:beforePreview});
  check('actual manager recurring preview remains candidate only',candidate.status,'CANDIDATE_ONLY');
  check('actual manager recurring preview retains exact publication',candidate.publicationId,published.data.publication_id);
  check('actual manager recurring preview changes no authority revision',await revision(),beforePreview);
  assert.equal(candidate.compilerStatus,'FEASIBLE');assert.equal(candidate.publicationAuthority,'ACCEPTABLE');
  assert.equal(candidate.verifierOk,true);assert.equal(candidate.reviewWorkCount,0);
  assert.match(candidate.previewDigest,/^[a-f0-9]{64}$/);checks++;
  assertRecurringManagerDecision(candidate);checks++;
  check('actual SQL recurring preview has complete manager decision schema',candidate.decision.schema,RECURRING_DECISION_SCHEMA);
  check('actual SQL recurring preview full decision hash',digest(candidate.decision),candidate.decisionDigest);
  check('actual SQL recurring preview full assignment bytes hash',digest(candidate.decision.assignments),candidate.weeklyAssignmentsDigest);
  check('actual SQL recurring preview fixed lunch count',candidate.decision.fixedLunch.loans.length,30);
  check('actual SQL recurring preview no unresolved lunch',candidate.decision.fixedLunch.loans.filter(l=>l.status==='REVIEW_REQUIRED').length,0);
  // The independently reviewed six-person source already has one truthful
  // Friday 15:00-16:00 Herpetarium OPEN requirement: the remaining worker is
  // restricted there. Preserve that exact gap; never invent an eligible owner.
  const gapFacts=candidate.decision.gaps.open.map(r=>({date:r.serviceDate,workId:r.workId,
   locationId:r.locationId,personId:r.personId,start:r.window.start,end:r.window.end}));
  const acceptedGapFacts=projection.assignments.filter(r=>r.status==='open').map(r=>({
   date:r.service_date,workId:r.work_id,locationId:r.work_snapshot.locationId,
   personId:r.owner_person_id,start:r.work_snapshot.window.start,end:r.work_snapshot.window.end}));
  check('actual SQL recurring preview preserves exact accepted gap identities and windows',gapFacts,acceptedGapFacts);
  check('actual SQL recurring preview exact known Friday gap',gapFacts.map(({date,locationId,personId,start,end})=>({date,locationId,personId,start,end})),
   [{date:'2026-10-02',locationId:'7a6ef424-142e-4d0b-9202-8007c3283ae7',personId:null,start:'15:00',end:'16:00'}]);
  check('actual SQL recurring preview review gaps',candidate.decision.gaps.review,[]);
  check('actual SQL recurring preview explicit nonpublication flags',
   [candidate.admitted,candidate.published,candidate.affectedPhonesUpdated],[false,false,false]);
  recurringPreview=candidate;
  if(process.env.STATIC_WEEKLY_TEST_RECURRING_DRAFT==='1'){
   console.log('ACTUAL_RECURRING_SOURCE_DRAFT_ROLLBACK_PROOF_BEGIN');
   const privateReply=await prepareRecurringAdmissionCandidateIsolated({publishedSource:registered,
    managerSnapshot:snapshot,effectiveDate:week,expectedRevision:beforePreview});
   assertRecurringAdmissionCandidate(privateReply);checks++;
   check('private exact source retains displayed decision',privateReply.candidate.decision,candidate.decision);
   const confirmationKey='30000000-0000-4000-8000-000000000172';
   const childKey=`recurring:${managerId}:${confirmationKey}:draft`;
   const draftInput=structuredClone(privateReply.canonicalSource);
   draftInput.version.id='60000000-0000-4000-8000-000000000172';
   draftInput.version.publicationId='70000000-0000-4000-8000-000000000172';
   draftInput.versions=[draftInput.version];delete draftInput.version;
   const prepared=await compileAndPrepareStaticWeeklyScheduleIsolated(draftInput,{kind:'draft',
    expectedRevision:beforePreview,actor:{managerId,managerName:manager.manager_display_name,idempotencyKey:childKey}});
   const client=await pool.connect();
   const sameRpc=async(name,args)=>(await client.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as result`,args)).rows[0].result;
   try{
    await client.query('begin');await client.query('set local role static_weekly_control_plane');
    await client.query('select public.custodial_begin_application_mutation()');
    const reservation=await sameRpc('static_weekly_v13_begin_recurring_confirmation',[
     managerId,confirmationKey,week,beforePreview,candidate.previewDigest,null]);
    const admission=await sameRpc('static_weekly_v14_admit_recurring_source',[
     managerId,confirmationKey,privateReply.canonicalSource,privateReply.candidate.candidateSourceDigest]);
    const draft=await sameRpc('static_weekly_v3_create_draft',[prepared.effectiveStart,prepared.objectiveVersion,
     prepared.objective,prepared.inputProvenance,prepared.document,prepared.expectedRevision,managerId,childKey,admission.source_id]);
    check('actual derived source draft advances exactly one revision',draft.revision,beforePreview+1);
    check('actual draft result uses deterministic child version',draft.data.version_id,draftInput.versions[0].id);
    await client.query('reset role');
    const binding=(await client.query('select authority_source_id from public.weekly_schedule_versions where version_id=$1',[draft.data.version_id])).rows[0];
    check('actual draft binds exact private source',binding.authority_source_id,admission.source_id);
    recurringAdmissionProof={classification:'SYNTHETIC_TRANSACTION_ROLLED_BACK',reservation,admission,
     draftVersionId:draft.data.version_id,sourceDigest:privateReply.candidate.candidateSourceDigest,
     publication:'NOT_ATTEMPTED',phoneTargets:'NOT_IMPLEMENTED'};
    if(process.env.STATIC_WEEKLY_TEST_RECURRING_SAME_MONDAY==='1'){
     const publishKey=`recurring:${managerId}:${confirmationKey}:publish`;
     const guard='static_weekly_v16_assert_future_same_monday';
     const guardSignature='public.'+guard+'(uuid,uuid,uuid,text,text,uuid)';
     const guardArgs=[draft.data.version_id,published.data.version_id,managerId,publishKey,'supersede',null];
     const rejected=async(label,action,pattern)=>{
      await client.query('savepoint hostile_same_monday');
      try{await assert.rejects(action,pattern,label);checks++;console.log('PASS',label);}
      finally{await client.query('rollback to savepoint hostile_same_monday');}
     };
     for(const role of ['anon','authenticated','service_role','static_weekly_control_plane','static_weekly_release_operator','custodial_application_reader']){
      await rejected('same-Monday private helper denied '+role,async()=>{
       await client.query('set local role '+role);await sameRpc(guard,guardArgs);
      },/permission denied/);
     }
     await rejected('wrong parent publication key cannot replace same Monday',
      ()=>sameRpc(guard,[...guardArgs.slice(0,3),'not-the-child-key',...guardArgs.slice(4)]),/cannot escape/);
     await rejected('ordinary publish cannot replace same Monday',
      ()=>sameRpc(guard,[...guardArgs.slice(0,4),'publish',null]),/same-Monday replacement requires/);
     await rejected('rollback compensation cannot replace same Monday',
      ()=>sameRpc(guard,[...guardArgs.slice(0,4),'rollback_compensation',published.data.version_id]),/same-Monday replacement requires/);
     await rejected('release-registered source alone is not recurring confirmation',
      ()=>sameRpc(guard,[published.data.version_id,published.data.version_id,managerId,publishKey,'supersede',null]),/same-Monday replacement requires/);
     // Recover the actual private function and its deny-by-default ACL before
     // using the existing public wrapper; no fake publication or guard bypass.
     const recovery=(await client.query("select object_kind,definition_sql from public.custodial_release_authority_restore_inventory where object_kind in ('function','grant') and to_regprocedure(case when object_identity like '%(%' then object_identity else null end)=$1::regprocedure order by restore_order",[guardSignature])).rows;
     check('same-Monday guard and grant recovery definitions',recovery.map(r=>r.object_kind),['function','grant']);
     await client.query('drop function '+guardSignature);
     for(const entry of recovery)await client.query(entry.definition_sql);
     await sameRpc(guard,guardArgs);checks++;
     await client.query('set local role static_weekly_control_plane');
     const sameMonday=await sameRpc('static_weekly_v3_publish_draft',[
      draft.data.version_id,1,draft.revision,managerId,publishKey,'supersede',null]);
     check('actual future same-Monday publish advances one revision',sameMonday.revision,draft.revision+1);
     await client.query('reset role');
     const selected=(await client.query('select public.static_weekly_effective_version($1::date) as version_id',[week])).rows[0];
     check('same Monday selects highest accepted authority revision',selected.version_id,draft.data.version_id);
     const ranges=(await client.query('select version_id,effective_start::text,effective_end::text from public.v_weekly_schedule_effective_ranges where effective_start=$1::date',[week])).rows;
     check('same Monday has exactly one effective winner',ranges,[{version_id:draft.data.version_id,effective_start:week,effective_end:null}]);
     check('same-Monday publication binds exact predecessor',(await client.query('select prior_version_id from public.weekly_schedule_publications where publication_id=$1',[sameMonday.data.publication_id])).rows[0].prior_version_id,published.data.version_id);
     check('no zero-length closure or immutable history rewrite',(await client.query('select count(*)::int as n from public.weekly_schedule_effective_range_closures where closed_version_id=$1',[published.data.version_id])).rows[0].n,0);
     await rejected('stale predecessor cannot become winner again',()=>sameRpc(guard,guardArgs),/same-Monday replacement requires/);
     check('original publication remains readable by identity',(await client.query('select version_id from public.weekly_schedule_publications where publication_id=$1',[published.data.publication_id])).rows[0].version_id,published.data.version_id);
     const viewRecovery=(await client.query("select definition_sql from public.custodial_release_authority_restore_inventory where object_kind='view' and object_identity='public.v_weekly_schedule_effective_ranges'")).rows;
     check('winner-first range selector has exact recovery definition',viewRecovery.length,1);
     await client.query(viewRecovery[0].definition_sql);
     check('recovered selector retains latest winner',(await client.query('select public.static_weekly_effective_version($1::date) as id',[week])).rows[0].id,draft.data.version_id);
     recurringAdmissionProof.publication=sameMonday;
     if(process.env.STATIC_WEEKLY_TEST_RECURRING_BINDING==='1'){
      const generation=Number((await client.query('select generation from public.static_weekly_recurring_generation where singleton')).rows[0].generation);
      const bindArgs=[managerId,confirmationKey,sameMonday.data.publication_id,generation,candidate.decision];
      const bind=()=>sameRpc('static_weekly_v18_bind_recurring_publication',bindArgs);
      check('publication binding forced RLS',(await client.query("select relrowsecurity and relforcerowsecurity as protected from pg_class where oid='public.static_weekly_recurring_publication_bindings'::regclass")).rows[0].protected,true);
      for(const role of ['anon','authenticated','service_role','static_weekly_control_plane','static_weekly_release_operator','custodial_application_reader']){
       await rejected('publication binding table denied '+role,async()=>{await client.query('set local role '+role);await client.query('select * from public.static_weekly_recurring_publication_bindings');},/permission denied/);
       if(role!=='static_weekly_control_plane')await rejected('publication binding RPC denied '+role,async()=>{await client.query('set local role '+role);await bind();},/permission denied/);
      }
      await client.query('set local role static_weekly_control_plane');
      await rejected('binding cannot use older publication',()=>sameRpc('static_weekly_v18_bind_recurring_publication',[managerId,confirmationKey,published.data.publication_id,generation,candidate.decision]),/exact current parent-bound child/);
      await rejected('binding detects changed generation',()=>sameRpc('static_weekly_v18_bind_recurring_publication',[managerId,confirmationKey,sameMonday.data.publication_id,generation-1,candidate.decision]),/generation changed/);
      for(const [label,change] of [
       ['changed source bytes',d=>{d.candidateSourceDigest='f'.repeat(64);}],
       ['changed assigned employee',d=>{d.assignments.find(a=>a.status==='ASSIGNED').personId='00000000-0000-4000-8000-000000000000';}],
       ['changed display clock',d=>{d.assignments[0].window.start='00:00';}],
       ['changed display minute expansion',d=>{d.assignments[0].window.startMinute+=1;}],
       ['omitted duty',d=>{d.assignments.pop();}],
       ['duplicate duty',d=>{d.assignments.push(d.assignments[0]);}],
      ]){
       const hostile=structuredClone(candidate.decision);change(hostile);
       await rejected(label+' cannot bind as displayed publication',()=>sameRpc('static_weekly_v18_bind_recurring_publication',[managerId,confirmationKey,sameMonday.data.publication_id,generation,hostile]),/displayed decision|displayed assignments|displayed window/);
      }
      const bound=await bind();
      check('publication binding is explicitly incomplete',bound.state,'BOUND_PENDING_FINALIZATION');
      check('publication binding reports no acceptance or phone update',[bound.accepted,bound.affectedPhonesUpdated],[false,false]);
      check('publication binding hashes complete decision',bound.decisionDigest,digest(candidate.decision));
      check('publication binding exact predecessor',bound.predecessorPublicationId,published.data.publication_id);
      check('same transaction binding replay exact',await bind(),bound);
      const changed=structuredClone(candidate.decision);changed.changes=[{forged:'different displayed changes'}];
      await rejected('existing publication binding is immutable on different decision',()=>sameRpc('static_weekly_v18_bind_recurring_publication',[managerId,confirmationKey,sameMonday.data.publication_id,generation,changed]),/already binds different/);
      await client.query('reset role');
      const stored=(await client.query('select decision_json,dependency_snapshot,dependency_digest from public.static_weekly_recurring_publication_bindings where publication_id=$1',[sameMonday.data.publication_id])).rows[0];
      check('stored full displayed decision exact',stored.decision_json,candidate.decision);
      check('stored dependency hash exact',stored.dependency_digest,digest(stored.dependency_snapshot));
      check('stored dependency exact source',stored.dependency_snapshot.sourceId,admission.source_id);
      await rejected('publication binding cannot be edited even by owner',()=>client.query("update public.static_weekly_recurring_publication_bindings set implementation_digest=repeat('c',64) where publication_id=$1",[sameMonday.data.publication_id]),/immutable|append-only/);
      recurringAdmissionProof.publicationBinding=bound;
      if(process.env.STATIC_WEEKLY_TEST_RECURRING_APPLICATION==='1')recurringAdmissionProof.applicationPrimitives=await testRecurringApplicationTargets({
       client,managerId,managerName:manager.manager_display_name,confirmationKey,publicationId:sameMonday.data.publication_id,week,check});
      if(process.env.STATIC_WEEKLY_TEST_RECURRING_RECONCILIATION==='1')recurringAdmissionProof.dependencyReconciliation=await testRecurringDependencyReconciliation({
       client,managerId,publicationId:sameMonday.data.publication_id,week,check});
      if(process.env.STATIC_WEEKLY_TEST_RECURRING_TERMINAL==='1')recurringAdmissionProof.terminalPrimitives=await testRecurringTerminalTargets({
       client,managerId,publicationId:sameMonday.data.publication_id,oldPublicationId:published.data.publication_id,week,check});
     }
    }
    // Finalizer checks above deliberately rolled back their savepoint. No
    // fabricated final receipt or partial parent may survive this fixture.
    await client.query('set local role static_weekly_control_plane');
    await assert.rejects(()=>client.query('commit'),/cannot commit without its complete atomic receipt/);checks++;
   }finally{await client.query('rollback');client.release();}
   check('failed partial commit preserves original authority revision',await revision(),beforePreview);
   check('failed partial commit removes new source',await query('select count(*)::integer as result from public.static_weekly_authority_source_documents where source_id=$1',[recurringAdmissionProof.admission.source_id]),0);
   check('failed partial commit removes new draft',await query('select count(*)::integer as result from public.weekly_schedule_versions where version_id=$1',[recurringAdmissionProof.draftVersionId]),0);
   check('failed partial commit removes new parent',await query('select count(*)::integer as result from public.static_weekly_recurring_confirmations where operation_id=$1',[recurringAdmissionProof.reservation.operationId]),0);
   if(process.env.STATIC_WEEKLY_TEST_RECURRING_SAME_MONDAY==='1'){
    check('failed partial commit removes new publication',await query('select count(*)::integer as result from public.weekly_schedule_publications where publication_id=$1',[recurringAdmissionProof.publication.data.publication_id]),0);
    check('failed partial commit restores original range winner',await query('select public.static_weekly_effective_version($1::date) as result',[week]),published.data.version_id);
    if(process.env.STATIC_WEEKLY_TEST_RECURRING_BINDING==='1')check('failed partial commit removes dependency binding',await query('select count(*)::integer as result from public.static_weekly_recurring_publication_bindings where publication_id=$1',[recurringAdmissionProof.publication.data.publication_id]),0);
   }
  }
 }
 const {version,...rest}=registered.compiler_input,input={...rest,versions:[version],exceptions:registered.exceptions};
 const args={kind:'projection',publicationId:published.data.publication_id,expectedRevision:await revision(),actor:{managerId,managerName:manager.manager_display_name,idempotencyKey:'synthetic-deterministic-replay'}};
 console.log('ACTUAL_FULL_SOURCE_DETERMINISTIC_REPLAY_BEGIN');
 const replay=await compileAndPrepareStaticWeeklyScheduleIsolated(input,args);
 check('same actual hydrated input deterministic replay digest',replay.replayDigest,projection.replay_digest??preparations.at(-1).replayDigest);
 check('same actual hydrated input deterministic lunch identity',replay.lunchDocument.document_identity,lunch.document_identity);
 const c=await pool.connect();try{
  await c.query('begin');await c.query('alter table public.weekly_schedule_lunch_documents disable trigger trg_weekly_schedule_lunch_documents_immutable');
  await c.query("update public.weekly_schedule_lunch_documents set document_json=jsonb_set(document_json,'{loans,0,status}','\"REVIEW_REQUIRED\"') where projection_id=$1",[published.data.projection_id]);
  await assert.rejects(()=>c.query('select public.static_weekly_v8_read_lunch_document($1::date)',[week]),e=>
   e.code==='P0001'&&e.message==='lunch document is not bound to the exact verified projection'
    &&e.where.includes('static_weekly_v8_assert_lunch_document'));checks++;
 }finally{await c.query('rollback');c.release();}
 check('failed tamper leaves exact accepted lunch', (await cp('static_weekly_v8_read_lunch_document',[week])).document_identity,lunch.document_identity);
 check('full source remains unchanged in database',await query('select source_digest as result from public.static_weekly_authority_source_documents where source_id=$1',[packet.sourceId]),packet.sourceDigest);
 check('accepted relational baseline remains byte-identical',await query('select md5(jsonb_agg(to_jsonb(a) order by assignment_id)::text) as result from public.weekly_schedule_slot_assignments a where version_id=$1',[published.data.version_id]),relationalDigest);
 assert.deepEqual(currentManagerStage?loadCurrentManagerPublicationFixture().bytes:readFileSync(process.env.STATIC_WEEKLY_CONTINUITY_TEMPLATE),bytes);
 if(process.env.STATIC_WEEKLY_TEST_RECURRING_CONFIRMATION==='1')recurringConfirmationProof=await testRecurringConfirmation({pool,week,originalManagerId:managerId,check});
 const evidence={classification:'SYNTHETIC_LOCAL_NOT_ADMITTED',sourcePacketSha256:createHash('sha256').update(bytes).digest('hex'),source,projection,lunch,replay,recurringPreview,recurringAdmissionProof,recurringConfirmationProof,lunchMaterializationProof,checks,production:false,independentAudit:false};
 if(process.env.STATIC_WEEKLY_CONTINUITY_EVIDENCE)writeFileSync(process.env.STATIC_WEEKLY_CONTINUITY_EVIDENCE,JSON.stringify(evidence)+'\n',{flag:'wx'});
 console.log(JSON.stringify({status:'PASS',checks,sourceDigest:packet.sourceDigest,loans:30,immutableRows:sourceRows,derivedRows,production:false,independentAudit:false}));
}finally{await plane.close();}
