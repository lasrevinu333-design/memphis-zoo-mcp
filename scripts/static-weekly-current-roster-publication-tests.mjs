import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {Pool} from 'pg';
import {createStaticWeeklyControlPlane} from '../src/static-weekly-control-plane.js';
import {currentPatternFromPublishedReadback,prepareApprovedStaticTemplateProjection} from '../src/static-weekly-recurring-staffing-adaptation.js';
import {contentDigest,installStaticWeeklySha256HexAccelerator} from '../src/static-weekly-schedule-model.js';
import {assertRecurringManagerDecision,assertRecurringAdmissionCandidate,RECURRING_DECISION_SCHEMA} from '../src/static-weekly-recurring-preview.js';
import {compileAndPrepareStaticWeeklyScheduleIsolated,prepareRecurringAdmissionCandidateIsolated} from '../src/static-weekly-schedule-compiler-runtime.js';
import {createStaticWeeklyCompilerRuntime} from '../src/static-weekly-schedule-compiler-runtime.js';
import {postgresJsonbContentDigest as digest} from '../src/static-weekly-schedule-program.js';
import {testRecurringTerminalTargets} from './static-weekly-recurring-terminal-integration.mjs';
import {testRecurringDependencyReconciliation} from './static-weekly-recurring-reconciliation-integration.mjs';
import {testRecurringApplicationTargets} from './static-weekly-recurring-application-integration.mjs';
import {testRecurringConfirmation} from './static-weekly-recurring-confirmation-integration.mjs';
import {testRecurringConfirmationHttp} from './static-weekly-recurring-confirmation-http-integration.mjs';
import {runRecurringChromiumConfirmationStage} from './static-weekly-recurring-browser-stage.mjs';
import {testLunchMaterialization} from './static-weekly-lunch-materialization-integration.mjs';
import {assertCurrentManagerMigrationSet,assertCurrentManager217MigrationSet,assertCurrentManager218MigrationSet,loadCurrentManagerPublicationFixture} from './fixtures/current-manager-publication-source.mjs';
import {assertCurrentManager219MigrationSet,assertCurrentManager219Manifest} from './fixtures/current-manager-219-source.mjs';
import {testNamedHandoffSql} from './static-weekly-named-handoff-contract-tests.mjs';
import {createCurrentManager219OwnedCheckpoint} from './static-weekly-current-manager-owned-checkpoint.mjs';

const container=process.env.SHIFT_END_TEST_CONTAINER,socket=process.env.SHIFT_END_TEST_SOCKET;
const approvedInitialMode=process.argv.includes('--approved-initial');
assert.match(container??'',/^mz_schema_shift_end_[0-9]+$/);
assert.match(socket??'',/^\/tmp\/mz-shift-socket-[a-zA-Z0-9]+$/);
const inspection=JSON.parse(execFileSync('docker',['inspect',container],{encoding:'utf8',timeout:10000}))[0];
assert.equal(inspection.HostConfig.NetworkMode,'none');assert.equal(Object.keys(inspection.HostConfig.PortBindings??{}).length,0);
assert.ok(inspection.Mounts.some(m=>m.Source===socket&&m.Destination==='/test-socket'));
const currentManager216Stage=process.env.STATIC_WEEKLY_TEST_CURRENT_216==='1';
const currentManager217Stage=process.env.STATIC_WEEKLY_TEST_CURRENT_217==='1';
const currentManager218Stage=process.env.STATIC_WEEKLY_TEST_CURRENT_218==='1';
const currentManager219Stage=process.env.STATIC_WEEKLY_TEST_CURRENT_219==='1';
const ownedCheckpointMode=process.env.STATIC_WEEKLY_TEST_OWNED_CHECKPOINT_219==='1';
assert.ok(!ownedCheckpointMode||currentManager219Stage,'owned checkpoint requires the exact current219 fixture');
const currentManager218Http=process.env.STATIC_WEEKLY_TEST_RECURRING_CONFIRMATION_HTTP==='1';
const currentManager218Browser=process.env.STATIC_WEEKLY_TEST_RECURRING_CONFIRMATION_BROWSER==='1';
assert.ok(process.env.STATIC_WEEKLY_TEST_RECURRING_CONFIRMATION_HTTP==null||currentManager218Http,
 'recurring HTTP SQL variant accepts only explicit 1');
assert.ok(process.env.STATIC_WEEKLY_TEST_RECURRING_CONFIRMATION_BROWSER==null||currentManager218Browser,
 'recurring browser SQL variant accepts only explicit 1');
assert.ok(!currentManager218Http||currentManager218Stage||currentManager219Stage,
 'authenticated HTTP SQL confirmation variant belongs only to exact current-manager-218 or current-manager-219');
assert.ok(!currentManager218Browser||currentManager218Stage||currentManager219Stage,
 'authenticated browser SQL confirmation variant belongs only to exact current-manager-218 or current-manager-219');
assert.ok(!(currentManager218Http&&currentManager218Browser),'only one authenticated HTTP confirmation transport');
assert.ok([currentManager216Stage,currentManager217Stage,currentManager218Stage,currentManager219Stage].filter(Boolean).length<=1,
 'only one pinned current-manager stage may run');
const currentManagerStage=currentManager216Stage||currentManager217Stage||currentManager218Stage||currentManager219Stage;
if(approvedInitialMode){
 assert.equal(currentManagerStage,false,'static initial has its own exact219-prefix-plus-forward-module binding, not an optimized stage label');
 assert.equal(ownedCheckpointMode,false);
 assert.equal(inspection.Config.Image,'supabase/postgres@sha256:fbf77524fc188126c1775fd2d2e54040bde295438a3e6f07936f3c39e6f688ed');
 const dir=new URL('../supabase/migrations/',import.meta.url),forward='20261004140657_approved_static_template_authority.sql';
 const rows=readdirSync(dir).filter(file=>file.endsWith('.sql')).sort().map(file=>({file,
  sha256:createHash('sha256').update(readFileSync(new URL(file,dir))).digest('hex')}));
 assert.equal(rows.length,220,'only authoritative219 prefix plus exact initial forward module');
 assertCurrentManager219Manifest(rows.filter(row=>row.file!==forward));
 assert.equal(rows.at(-1).file,forward);
 assert.equal(rows.at(-1).sha256,process.env.STATIC_WEEKLY_APPROVED_INITIAL_SQL_SHA256,'root-owned launcher must bind exact reviewed forward SQL');
}
if(currentManager216Stage)assertCurrentManagerMigrationSet();
if(currentManager217Stage)assertCurrentManager217MigrationSet();
if(currentManager218Stage)assertCurrentManager218MigrationSet();
if(currentManager219Stage)assertCurrentManager219MigrationSet();
if(currentManagerStage&&!ownedCheckpointMode)assert.equal(process.env.STATIC_WEEKLY_TEST_RECURRING_CONFIRMATION,'1','current manager proof must execute confirmation');
if(!currentManagerStage&&!approvedInitialMode)assert.ok(process.env.STATIC_WEEKLY_CONTINUITY_TEMPLATE,'explicit immutable local source');
const bytes=currentManagerStage||approvedInitialMode?loadCurrentManagerPublicationFixture().bytes:readFileSync(process.env.STATIC_WEEKLY_CONTINUITY_TEMPLATE),packet=JSON.parse(bytes),source=packet.compilerInput;
assert.equal(digest(source),packet.sourceDigest);
const sourceRows=source.version.assignments.length;
assert.ok(currentManagerStage||approvedInitialMode?sourceRows===323:[312,313].includes(sourceRows),'only the exact selected source lineage is in scope');
const derivedRows=currentManagerStage||approvedInitialMode?packet.expectedDerivedRows:packet.verification.shiftEndDerivation.parentChains
 .reduce((count,chain)=>count+chain.segments.length,0);
assert.equal(derivedRows,currentManagerStage||approvedInitialMode?494:sourceRows===312?454:458,'exact source-specific derivation count');
assert.equal(source.version.vacantSlotIds.length,3);
const pool=new Pool({host:socket,database:'postgres',user:'supabase_admin',password:'postgres',max:3,connectionTimeoutMillis:5000});
pool.on('error',e=>console.error('SYNTHETIC_POOL_ERROR',e.code));
const preparations=[];
// The new stage is itself a detached, identity-checked group leader. Its
// compiler/solver must inherit that same group for absolute-deadline cleanup.
const ownedCompiler=ownedCheckpointMode?createStaticWeeklyCompilerRuntime({workerDetached:false}):null;
const plane=createStaticWeeklyControlPlane({database:pool,
 ...(approvedInitialMode?{compiler:()=>{throw Error('FORBIDDEN_STATIC_INITIAL_SOLVER');}}:{}),
 ...(ownedCompiler?{shutdownCompiler:ownedCompiler.shutdown}:{}),compilerPreparer:async(...args)=>{
 if(approvedInitialMode)throw Error('FORBIDDEN_STATIC_INITIAL_SOLVER');
 const result=await (ownedCompiler?.compileAndPrepare||compileAndPrepareStaticWeeklyScheduleIsolated)(...args);
 preparations.push(result);return result;
}});
const query=async(sql,args=[])=>{const r=await pool.query(sql,args);return r.rows[0]?.result;};
async function rpc(role,name,args=[]){const c=await pool.connect();try{await c.query('begin');await c.query('set local role '+role);
 const r=await c.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as result`,args);await c.query('commit');return r.rows[0].result;
 }catch(e){await c.query('rollback');throw e;}finally{c.release();}}
const cp=(name,args)=>rpc('static_weekly_control_plane',name,args),release=(name,args)=>rpc('static_weekly_release_operator',name,args);
const revision=()=>query('select current_revision::integer as result from public.static_weekly_schedule_control where singleton');
let checks=0,recurringPreview=null,recurringAdmissionProof=null,recurringConfirmationProof=null,lunchMaterializationProof=null;const check=(name,a,b)=>{assert.deepEqual(a,b,name);checks++;console.log('PASS',name);};
async function runApprovedInitial(){
 // The outer root-owned launcher binds exact219 prefix plus this forward SQL,
 // image/roles/source and a legitimate retained historical publication. This
 // mode refuses an empty DB; it never manufactures historical certificates.
 const external=Number(process.env.STATIC_WEEKLY_APPROVED_INITIAL_ABSOLUTE_DEADLINE_UNIX_MS);
 assert.ok(Number.isSafeInteger(external)&&external>Date.now()&&external-Date.now()<=60000,'one inherited absolute60 origin required');
 const deadlineAt=Math.min(60000,performance.now()+external-Date.now());
 const remaining=()=>{const ms=Math.floor(deadlineAt-performance.now());assert.ok(ms>0,'initial fixture absolute deadline exhausted');return ms;};
 const prior=JSON.parse(process.env.STATIC_WEEKLY_APPROVED_INITIAL_PRIOR_JSON||'null');
 assert.ok(prior&&typeof prior==='object','exact legitimate prior publication custody required');
 for(const key of ['sourceId','versionId','publicationId','managerId'])assert.match(prior[key]||'',/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
 assert.match(prior.documentDigest||'',/^[0-9a-f]{64}$/);
 assert.ok(Number.isSafeInteger(prior.authorityRevision)&&prior.authorityRevision>=0);
 const previous=await query('select jsonb_build_object(\'sourceId\',v.authority_source_id,\'versionId\',v.version_id,\'publicationId\',p.publication_id,\'effectiveStart\',p.effective_start,\'documentDigest\',public.static_weekly_digest_jsonb(v.draft_document)) as result from public.weekly_schedule_publications p join public.weekly_schedule_versions v using(version_id) where p.publication_id=$1',[prior.publicationId]);
 check('actual prior historical publication/source/document custody, not empty database',previous,
  {sourceId:prior.sourceId,versionId:prior.versionId,publicationId:prior.publicationId,effectiveStart:prior.effectiveStart,documentDigest:prior.documentDigest});
 assert.ok(prior.effectiveStart<source.serviceDate);
 check('preexisting exact expected authority revision',await revision(),prior.authorityRevision);
 installStaticWeeklySha256HexAccelerator(x=>createHash('sha256').update(x).digest('hex'));
 const configBytes=readFileSync(new URL('../config/custodial-six-person-static-20261005.json',import.meta.url));
 assert.equal(createHash('sha256').update(configBytes).digest('hex'),'40da4e1d4cce52b2361b5403b7e5e4477ca00def0fd3649a1d76dacb48422f30');
 const ownerConfig=JSON.parse(configBytes),manager={manager_id:prior.managerId,manager_display_name:'Isolated Approved Initial Manager',auth_mode:'trusted_device',trusted_device:true,read_only:false};
 remaining();
 const registered=await cp('static_weekly_v3_read_authority_source',[packet.sourceId,source.serviceDate]);
 check('exact current323 registered immutable source digest',await query('select source_digest as result from public.static_weekly_authority_source_documents where source_id=$1',[packet.sourceId]),packet.sourceDigest);
 const currentSource=registered.compiler_input;
 assert.equal(registered.source_id,packet.sourceId);assert.equal(currentSource.serviceDate,'2026-10-05');
 const templateId='owner-corrected-six-initial',roleSlotIds=Object.values(ownerConfig.slots).filter(s=>!s.vacancy).map(s=>s.slotId).sort();
 const template={templateId,staffingCount:6,source:currentSource,roleSlotIds};
 const binding={schema:'custodial.approved-static-template-binding.v1',templateId,staffingCount:6,
  sourceDigest:contentDigest(currentSource),roleSlotIdsDigest:contentDigest(roleSlotIds),patternAuthority:'OWNER_APPROVED_OPERATIONAL_PATTERN',
  artifactSha256:createHash('sha256').update(configBytes).digest('hex'),ownerConfigDigest:contentDigest(ownerConfig),patternPublicationStatus:'UNPUBLISHED_LOCAL_CANDIDATE'};
 const approvalEvidence={classification:'OWNER_APPROVED_OPERATIONAL_PATTERN',artifactSha256:binding.artifactSha256,
  sourceReference:'config/custodial-six-person-static-20261005.json',ownerDecisionReference:'OWNER_STATIC_TEMPLATE_MAPPING_AND_EIGHT_DRAFT_20261004.json'};
 await release('static_weekly_register_approved_template',[packet.sourceId,JSON.stringify(template),JSON.stringify(binding),JSON.stringify(ownerConfig),JSON.stringify(approvalEvidence)]);
 remaining();
 const feasibility=prepareApprovedStaticTemplateProjection({templates:[template],admittedBindings:[binding],currentSource,currentOwnerConfig:ownerConfig,
  selection:{schema:'custodial.static-template-selection.v1',kind:'INITIAL_BASELINE',templateId,serviceDate:source.serviceDate,
   availablePersonIds:Object.values(ownerConfig.slots).filter(s=>!s.vacancy).map(s=>s.personId)},deadline:deadlineAt});
 await release('static_weekly_register_approved_initial_baseline',[packet.sourceId,templateId,JSON.stringify(feasibility)]);
 check('artifact/snapshot registration alone does not publish',await revision(),prior.authorityRevision);
 const input={manager,sourceId:packet.sourceId,effectiveStart:source.serviceDate,templateId,expectedRevision:prior.authorityRevision,deadlineAt};
 const preview=await plane.previewApprovedInitialBaseline(input);
 check('actual static preview no publication or solver', [preview.status,preview.solverInvoked,await revision()],['PREVIEW_ONLY',false,prior.authorityRevision]);
 const accepted=await plane.publishApprovedInitialBaseline({...input,previewDigest:preview.previewDigest,idempotencyKey:'isolated-approved-initial-six'});
 check('actual static accepted receipt',accepted.status,'PERSISTED_CURRENT');
 const lineage=await query('select jsonb_build_object(\'priorVersion\',prior_version_id,\'kind\',publication_kind) as result from public.weekly_schedule_publications where publication_id=$1',[accepted.publication_id]);
 check('actual prior publication supersession not empty-first-publish',lineage,{priorVersion:prior.versionId,kind:'supersede'});
 check('original historical document unchanged',await query('select public.static_weekly_digest_jsonb(draft_document) as result from public.weekly_schedule_versions where version_id=$1',[prior.versionId]),prior.documentDigest);
 const versionId=await query('select version_id as result from public.weekly_schedule_publications where publication_id=$1',[accepted.publication_id]);
 check('static relational original parents323',await query('select count(*)::int as result from public.weekly_schedule_slot_assignments where version_id=$1',[versionId]),323);
 check('derived relational dated occurrences494',await query('select count(*)::int as result from public.weekly_schedule_occurrences where projection_id=$1',[accepted.projection_id]),494);
 const lunch=await query('select document_json as result from public.weekly_schedule_lunch_documents where projection_id=$1',[accepted.projection_id]);
 check('actual persisted lunch loans30',lunch.loans.length,30);
 const identities=new Set(Object.values(ownerConfig.slots).filter(s=>!s.vacancy).map(s=>s.personId));
 assert.ok(lunch.responsibilities.every(r=>identities.has(r.coverer_person_id)&&r.creates_deep_clean===false));checks++;
 for(let offset=0;offset<7;offset++){
  remaining();const date=new Date(Date.parse(source.serviceDate+'T12:00:00Z')+offset*86400000).toISOString().slice(0,10);
  const status=await query('select projection_status as result from public.static_weekly_v6_schedule_authority_state($1::date)',[date]);
  const persisted=await cp('static_weekly_v8_read_lunch_document',[date]);
  check(date+' stored current projection+lunch', [status,persisted.persistence_status,persisted.projection_id,persisted.document_identity],
   ['current','PERSISTED',accepted.projection_id,lunch.document_identity]);
  for(const personId of identities){
   remaining();
   const r=await rpc('custodial_application_reader','static_weekly_v5_read_employee_day',[date,personId,date+'T15:00:00Z']);
   assert.equal(r.governed,true);assert.equal(r.projection_status,'current');
   assert.equal(r.projection_id,accepted.projection_id);assert.equal(r.employee_id,personId);
  }
  checks++;
 }
 check('no compiler preparation invoked',preparations.length,0);
 remaining();console.log(JSON.stringify({status:'PASS',checks,scope:'ISOLATED_FIXED_APPROVED_INITIAL_SIX_OVER_HISTORICAL_PUBLICATION',
  sourceDigest:packet.sourceDigest,feasibilityDigest:feasibility.digest,projectionId:accepted.projection_id,lunchIdentity:lunch.document_identity,
  originalParents:323,datedOccurrences:494,solverInvoked:false,production:false,independentAudit:false}));
}
try{
 if(approvedInitialMode){await runApprovedInitial();}else{
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
 if(currentManager217Stage||currentManager218Stage||currentManager219Stage)await testNamedHandoffSql({pool,authority:projection.authority,check,
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
 const dateReadback=[];
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
  const projectionStatus=await query('select projection_status as result from public.static_weekly_v6_schedule_authority_state($1::date)',[date]);
  check(date+' current database authority',projectionStatus,'current');
  dateReadback.push({date,projectionId:published.data.projection_id,projectionStatus,
   lunchIdentity:doc.document_identity,rosterCount:roster.length,loanCount:doc.loans.length});
 }
 if(ownedCheckpointMode){
  const output=process.env.STATIC_WEEKLY_TEST_OWNED_CHECKPOINT_OUTPUT;
  assert.match(output??'',/^\/tmp\/mz-manager-owned-[A-Za-z0-9]+\/checkpoint\.json$/,
   'caller-owned checkpoint output only');
  check('checkpoint original source remains exact registered SQL bytes',
   await query('select source_digest as result from public.static_weekly_authority_source_documents where source_id=$1',[packet.original.sourceId]),packet.original.sourceDigest);
  check('checkpoint current source remains exact registered SQL bytes',
   await query('select source_digest as result from public.static_weekly_authority_source_documents where source_id=$1',[packet.sourceId]),packet.sourceDigest);
  const publication={managerId,secondManagerId:'10000000-0000-4000-8000-000000000273',week,
   currentSourceId:packet.sourceId,currentSourceDigest:packet.sourceDigest,
   originalSourceId:packet.original.sourceId,originalSourceDigest:packet.original.sourceDigest,
   versionId:published.data.version_id,publicationId:published.data.publication_id,
   projectionId:published.data.projection_id,authorityRevision:await revision(),
   projectionStatus:'current',acceptedRows:derivedRows,relationalDigest,
   lunchIdentity:lunch.document_identity,lunchLoans:lunch.loans.length,dates:dateReadback,
   defaultApiGrants:Number(execFileSync('docker',['exec','-i',container,'psql','-X','-q','-At','-v','ON_ERROR_STOP=1',
    '-U','supabase_admin','-d','postgres','-c',"select count(*) from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a where d.defaclnamespace in (0,'public'::regnamespace) and d.defaclrole in ('postgres'::regrole,'supabase_admin'::regrole) and d.defaclobjtype in ('r','S') and a.grantee in (0,'anon'::regrole,'authenticated'::regrole,'service_role'::regrole)"],{encoding:'utf8',timeout:5000}).trim()),
   confirmationStatus:'NOT_YET_ATTEMPTED'};
  const checkpoint=createCurrentManager219OwnedCheckpoint({publication,environment:{
   containerName:container,containerId:inspection.Id,
   image:'supabase/postgres@sha256:fbf77524fc188126c1775fd2d2e54040bde295438a3e6f07936f3c39e6f688ed',
   network:inspection.HostConfig.NetworkMode,socket,socketMount:'/test-socket',database:'postgres'}});
  writeFileSync(output,JSON.stringify(checkpoint)+'\n',{flag:'wx',mode:0o600});
  console.log('OWNED_219_PERSISTED_CHECKPOINT_SOURCE_BOUND',checkpoint.digest,checks);
 }else{
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
 if(process.env.STATIC_WEEKLY_TEST_RECURRING_CONFIRMATION==='1')recurringConfirmationProof=await (
  currentManager218Browser?runRecurringChromiumConfirmationStage:
   currentManager218Http?testRecurringConfirmationHttp:testRecurringConfirmation)({pool,week,originalManagerId:managerId,check});
 const evidence={classification:'SYNTHETIC_LOCAL_NOT_ADMITTED',sourcePacketSha256:createHash('sha256').update(bytes).digest('hex'),source,projection,lunch,replay,recurringPreview,recurringAdmissionProof,recurringConfirmationProof,lunchMaterializationProof,checks,production:false,independentAudit:false};
 if(process.env.STATIC_WEEKLY_CONTINUITY_EVIDENCE)writeFileSync(process.env.STATIC_WEEKLY_CONTINUITY_EVIDENCE,JSON.stringify(evidence)+'\n',{flag:'wx'});
 console.log(JSON.stringify({status:'PASS',checks,sourceDigest:packet.sourceDigest,loans:30,immutableRows:sourceRows,derivedRows,production:false,independentAudit:false}));
 }
 }
}finally{await plane.close();}
